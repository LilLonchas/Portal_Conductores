'use strict';

// ─── BANDERAS ────────────────────────────────────────────────────────────────
const BANDERAS = { be:'be', de:'de', fr:'fr', gb:'gb', nl:'nl', es:'es', pt:'pt', it:'it' };

// ─── CARPETA MOVILIDAD EN DROPBOX ────────────────────────────────────────────
// Convención de nombre de archivo dentro de /movilidad/:
//   APELLIDO_NOMBRE_XX_.pdf   (XX = código de país, ej: BE, DE, FR...)
//   Ejemplo: AACHOUCH_MOHAMED_BE_.pdf
//
// La caducidad se calcula automáticamente:
//   fecha de subida a Dropbox (client_modified) + 6 meses
// ─────────────────────────────────────────────────────────────────────────────
const CARPETA_MOVILIDAD  = '/movilidad';
const DIAS_AVISO_PROXIMO = 45;  // días antes de caducidad para mostrar amarillo
const MESES_VALIDEZ      = 6;   // validez del permiso en meses

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
const estado = {
    token:          '',
    usuario:        '',
    archivos:       [],
    permisos:       [],      // archivos de /movilidad/
    tabActiva:      'certificados',
    filtroMov:      'todos', // filtro activo en panel movilidad
    intentos:       0,
    bloqueadoHasta: 0,
    pdfDoc:         null,
    paginaActual:   1,
    totalPaginas:   0,
    portalListo:    false,
};

// ─── UTILIDADES ──────────────────────────────────────────────────────────────

async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
window.sha256 = sha256;

function $(id) { return document.getElementById(id); }

function mostrarError(msg) {
    $('error-msg').textContent = msg;
    $('error-msg').classList.remove('hidden');
    $('pass-input').classList.add('shake');
    setTimeout(() => $('pass-input').classList.remove('shake'), 400);
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────

async function verificar() {
    if (Date.now() < estado.bloqueadoHasta) return;

    const input = $('pass-input').value.trim();
    if (!input) return;

    $('btn-login-text').textContent = 'Verificando...';
    $('btn-login-spinner').classList.remove('hidden');
    $('btn-login').disabled = true;
    $('error-msg').classList.add('hidden');

    let usuarioEncontrado = null;
    const inputUpper = input.toUpperCase();

    for (const [clave, nombre] of Object.entries(USUARIOS)) {
        if (clave === input || clave === inputUpper) {
            usuarioEncontrado = nombre;
            break;
        }
        if (clave.length === 64) {
            const h = await sha256(input);
            if (clave === h) { usuarioEncontrado = nombre; break; }
        }
    }

    $('btn-login-text').textContent = 'Entrar';
    $('btn-login-spinner').classList.add('hidden');
    $('btn-login').disabled = false;

    if (usuarioEncontrado) {
        estado.intentos = 0;
        estado.usuario  = usuarioEncontrado;
        mostrarBienvenida();
    } else {
        estado.intentos++;
        $('pass-input').value = '';
        estado.intentos >= 5 ? bloquear() : mostrarError(`Código incorrecto (${estado.intentos}/5)`);
    }
}

function bloquear() {
    const ESPERA = 30;
    estado.bloqueadoHasta = Date.now() + ESPERA * 1000;
    estado.intentos = 0;
    $('error-msg').classList.add('hidden');
    $('bloqueo-msg').classList.remove('hidden');
    $('btn-login').disabled  = true;
    $('pass-input').disabled = true;

    let restante = ESPERA;
    const tick = setInterval(() => {
        restante--;
        $('countdown').textContent = restante;
        if (restante <= 0) {
            clearInterval(tick);
            $('bloqueo-msg').classList.add('hidden');
            $('btn-login').disabled  = false;
            $('pass-input').disabled = false;
            $('pass-input').focus();
        }
    }, 1000);
}

// ─── PANTALLA DE BIENVENIDA ───────────────────────────────────────────────────

async function mostrarBienvenida() {
    $('login-screen').remove();

    const esAdmin  = estado.usuario === 'ADMIN_MASTER';
    const nombre   = esAdmin ? 'ADMINISTRACIÓN' : estado.usuario.replace(/_/g, ' ');
    const partes   = nombre.trim().split(' ').filter(Boolean);
    const iniciales = partes.length >= 2 ? partes[0][0] + partes[1][0] : nombre.substring(0, 2);

    $('welcome-nombre').textContent = nombre;
    $('welcome-avatar').textContent = iniciales.toUpperCase();
    if (esAdmin) {
        $('welcome-avatar').classList.replace('bg-blue-500', 'bg-yellow-500');
        $('welcome-docs').textContent = 'Acceso maestro activado';
    } else {
        $('welcome-docs').textContent = 'Cargando tus certificados...';
    }

    const ws = $('welcome-screen');
    ws.classList.remove('hidden');
    ws.classList.add('flex');

    estado.token = await refreshToken();
    if (estado.token) {
        cargarArchivos();   // certificados en background
        cargarPermisos();   // permisos movilidad en background
    }

    setTimeout(irAlPortal, 2500);
}

function irAlPortal() {
    if (estado.portalListo) return;
    estado.portalListo = true;

    $('welcome-screen').classList.add('hidden');
    $('welcome-screen').classList.remove('flex');
    $('app-screen').classList.remove('hidden');

    const esAdmin = estado.usuario === 'ADMIN_MASTER';
    if (esAdmin) {
        $('saludo-usuario').textContent = 'ADMINISTRACIÓN';
        $('saludo-usuario').classList.add('text-yellow-400');
        $('sub-titulo').textContent = 'Acceso Maestro';
        // Mostrar controles admin en panel movilidad
        $('resumen-movilidad').classList.remove('hidden');
        $('filtro-movilidad').classList.remove('hidden');
        $('buscador-movilidad-wrap').classList.remove('hidden');
    } else {
        $('saludo-usuario').textContent = estado.usuario.replace(/_/g, ' ');
        // Ocultar tab Movilidad UE — solo accesible para admin
        $('tab-movilidad').classList.add('hidden');
    }

    if (estado.archivos.length) renderizar(estado.archivos);
    else mostrarSkeletons();
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function cambiarTab(tab) {
    estado.tabActiva = tab;

    // Paneles
    $('panel-certificados').classList.toggle('hidden', tab !== 'certificados');
    $('panel-certificados').classList.toggle('flex',   tab === 'certificados');
    $('panel-movilidad').classList.toggle('hidden',    tab !== 'movilidad');
    $('panel-movilidad').classList.toggle('flex',      tab === 'movilidad');

    // Estilos tabs
    $('tab-certificados').classList.toggle('tab-active', tab === 'certificados');
    $('tab-movilidad').classList.toggle('tab-active',    tab === 'movilidad');

    // Limpiar badge alertas al abrir movilidad
    if (tab === 'movilidad') {
        $('badge-alertas').classList.add('hidden');
        if (!estado.permisos.length && estado.portalListo) mostrarSkeletonsMov();
    }
}

// ─── SKELETONS ────────────────────────────────────────────────────────────────

function mostrarSkeletons() {
    $('lista-archivos').innerHTML = Array.from({length: 5}).map(() => `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 mb-3">
            <div class="skeleton w-12 h-8 rounded-lg flex-shrink-0"></div>
            <div class="flex-1 space-y-2">
                <div class="skeleton h-3 w-3/4 rounded"></div>
                <div class="skeleton h-2 w-1/3 rounded"></div>
            </div>
        </div>
    `).join('');
}

function mostrarSkeletonsMov() {
    $('lista-movilidad').innerHTML = Array.from({length: 4}).map(() => `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-4 mb-3">
            <div class="skeleton w-10 h-10 rounded-xl flex-shrink-0"></div>
            <div class="flex-1 space-y-2">
                <div class="skeleton h-3 w-2/3 rounded"></div>
                <div class="skeleton h-2 w-1/4 rounded"></div>
            </div>
            <div class="skeleton w-16 h-5 rounded-full flex-shrink-0"></div>
        </div>
    `).join('');
}

// ─── DROPBOX API ──────────────────────────────────────────────────────────────

async function refreshToken() {
    try {
        const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type:    'refresh_token',
                refresh_token: CONFIG.dropbox.refreshToken.trim(),
                client_id:     CONFIG.dropbox.appKey.trim(),
                client_secret: CONFIG.dropbox.appSecret.trim()
            })
        });
        const data = await res.json();
        return data.access_token || null;
    } catch { return null; }
}

async function cargarArchivos() {
    try {
        let todos = [], cursor = '', hayMas = true;

        while (hayMas) {
            const url  = cursor
                ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
                : 'https://api.dropboxapi.com/2/files/list_folder';
            const body = cursor
                ? JSON.stringify({ cursor })
                : JSON.stringify({ path: '', recursive: false });

            let res = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
                body
            });
            // Si 401 refrescar token y reintentar una vez
            if (res.status === 401) {
                estado.token = await refreshToken();
                res = await fetch(url, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
                    body
                });
            }
            const data = await res.json();
            if (data.entries) todos = todos.concat(data.entries);
            hayMas = data.has_more || false;
            cursor = data.cursor || '';
            if (!data.entries && !data.has_more) break; // salir si respuesta inesperada
        }

        // Solo archivos (no carpetas, excluir carpeta movilidad)
        let filtrados = todos.filter(a =>
            a['.tag'] !== 'folder' &&
            !a.path_lower.startsWith(CARPETA_MOVILIDAD + '/')
        );

        if (estado.usuario !== 'ADMIN_MASTER') {
            filtrados = filtrados.filter(a =>
                a.name.toUpperCase().includes(estado.usuario.toUpperCase())
            );
        }

        estado.archivos = filtrados;

        if (!estado.portalListo && $('welcome-docs')) {
            $('welcome-docs').textContent =
                `${filtrados.length} certificado${filtrados.length !== 1 ? 's' : ''} encontrado${filtrados.length !== 1 ? 's' : ''}`;
        }

        if (estado.portalListo) renderizar(filtrados);

    } catch {
        if (estado.portalListo) errorLista('Error de conexión con Dropbox');
    }
}

// ─── MOVILIDAD UE — CARGA ─────────────────────────────────────────────────────

async function cargarPermisos() {
    try {
        const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: CARPETA_MOVILIDAD, recursive: false })
        });

        if (!res.ok) {
            // La carpeta puede no existir aún — no es un error crítico
            estado.permisos = [];
            if (estado.portalListo && estado.tabActiva === 'movilidad') renderizarPermisos([]);
            return;
        }

        const data = await res.json();
        const archivos = (data.entries || []).filter(a =>
            a['.tag'] !== 'folder' && a.name.toLowerCase().endsWith('.pdf')
        );

        estado.permisos = archivos;

        // Calcular alertas (expirado + próximo) para el badge
        const alertas = archivos.filter(a => {
            const st = estadoPermiso(extraerFechaPermiso(a));
            return st === 'expirado' || st === 'proximo';
        });

        if (alertas.length && estado.tabActiva === 'certificados') {
            const badge = $('badge-alertas');
            badge.textContent = alertas.length > 9 ? '9+' : alertas.length;
            badge.classList.remove('hidden');
        }

        if (estado.portalListo && estado.tabActiva === 'movilidad') {
            renderizarPermisos(permisosParaUsuario());
            actualizarResumen();
        }

    } catch {
        estado.permisos = [];
        if (estado.portalListo && estado.tabActiva === 'movilidad') {
            $('lista-movilidad').innerHTML =
                `<div class="text-center py-16 text-slate-400 text-[10px] font-bold uppercase tracking-widest">
                    No se pudo cargar los permisos de movilidad
                 </div>`;
        }
    }
}

// ─── MOVILIDAD UE — LÓGICA ───────────────────────────────────────────────────

/**
 * Calcula la fecha de caducidad a partir del campo client_modified del archivo en Dropbox.
 * Caducidad = fecha de subida + MESES_VALIDEZ (6 meses).
 * Devuelve un objeto Date o null si no hay metadato.
 */
function extraerFechaPermiso(archivo) {
    const fechaSubida = archivo.client_modified || archivo.server_modified;
    if (!fechaSubida) return null;
    const base = new Date(fechaSubida);
    base.setMonth(base.getMonth() + MESES_VALIDEZ);
    base.setHours(23, 59, 59, 0);
    return base;
}

/**
 * Devuelve la fecha de subida formateada para mostrarla al admin.
 */
function fechaSubidaStr(archivo) {
    const f = archivo.client_modified || archivo.server_modified;
    if (!f) return '—';
    return new Date(f).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });
}

/**
 * Extrae el código de país (BE, DE, FR…) del nombre del archivo.
 * Formato: APELLIDO_NOMBRE_XX_.pdf
 */
function extraerPais(nombre) {
    const m = nombre.match(/_([A-Z]{2})_/);
    return m ? m[1] : null;
}

/**
 * Devuelve el estado del permiso: 'vigente' | 'proximo' | 'expirado' | 'sin-fecha'
 */
function estadoPermiso(fecha) {
    if (!fecha) return 'sin-fecha';
    const hoy     = new Date();
    hoy.setHours(0, 0, 0, 0);
    const diffMs  = fecha - hoy;
    const diffDias = Math.ceil(diffMs / 86400000);

    if (diffDias < 0)               return 'expirado';
    if (diffDias <= DIAS_AVISO_PROXIMO) return 'proximo';
    return 'vigente';
}

/**
 * Formatea días restantes o tiempo transcurrido de forma legible.
 */
function textoRestante(fecha) {
    if (!fecha) return 'Fecha desconocida';
    const hoy     = new Date();
    hoy.setHours(0, 0, 0, 0);
    const diffDias = Math.ceil((fecha - hoy) / 86400000);

    if (diffDias === 0) return 'Caduca hoy';
    if (diffDias > 0)  return `Caduca en ${diffDias} día${diffDias !== 1 ? 's' : ''}`;
    return `Caducó hace ${Math.abs(diffDias)} día${Math.abs(diffDias) !== 1 ? 's' : ''}`;
}

/**
 * Devuelve las clases y etiqueta del badge según estado.
 */
function badgeEstado(st) {
    switch (st) {
        case 'vigente':   return { cls: 'badge-vigente',  label: 'Vigente' };
        case 'proximo':   return { cls: 'badge-proximo',  label: 'Próx. vencer' };
        case 'expirado':  return { cls: 'badge-expirado', label: 'Expirado' };
        default:          return { cls: 'badge-sin',      label: 'Sin fecha' };
    }
}

/**
 * Filtra los permisos según el usuario logueado.
 * Admin ve todos; conductores solo el suyo.
 */
function permisosParaUsuario() {
    if (estado.usuario === 'ADMIN_MASTER') return estado.permisos;
    return estado.permisos.filter(a =>
        a.name.toUpperCase().includes(estado.usuario.toUpperCase())
    );
}

/**
 * Construye la lista de todos los conductores cruzada con sus permisos (solo admin).
 * Devuelve array de objetos { nombre, archivo|null, estado, fecha }
 */
function cruzarConductoresPermisos() {
    const conductores = Object.values(USUARIOS).filter(n => n !== 'ADMIN_MASTER');

    return conductores.map(nombre => {
        // Buscar permiso cuyo nombre de archivo contenga el nombre del conductor
        const archivo = estado.permisos.find(a =>
            a.name.toUpperCase().includes(nombre.toUpperCase())
        ) || null;

        const fecha = archivo ? extraerFechaPermiso(archivo) : null;
        const st    = archivo ? estadoPermiso(fecha) : 'sin';

        return { nombre, archivo, fecha, estado: st };
    }).sort((a, b) => {
        // Ordenar: expirado → proximo → sin → vigente
        const orden = { expirado: 0, proximo: 1, sin: 2, vigente: 3 };
        return (orden[a.estado] ?? 4) - (orden[b.estado] ?? 4);
    });
}

// ─── MOVILIDAD UE — RENDERIZADO ──────────────────────────────────────────────

function actualizarResumen() {
    if (estado.usuario !== 'ADMIN_MASTER') return;
    const todos = cruzarConductoresPermisos();
    $('cnt-vigente').textContent  = todos.filter(c => c.estado === 'vigente').length;
    $('cnt-proximo').textContent  = todos.filter(c => c.estado === 'proximo').length;
    $('cnt-expirado').textContent = todos.filter(c => c.estado === 'expirado' || c.estado === 'sin').length;
}

function filtrarPermisos(filtro) {
    estado.filtroMov = filtro;

    // Actualizar botones activos
    ['todos','expirado','proximo','vigente','sin'].forEach(f => {
        const btn = $(`fm-${f}`);
        if (btn) btn.classList.toggle('fm-activo', f === filtro);
    });

    const todos = cruzarConductoresPermisos();
    const filtrados = filtro === 'todos'
        ? todos
        : todos.filter(c => c.estado === filtro);

    renderizarTablaAdmin(filtrados);
}

function buscarPermiso() {
    const q = $('buscador-movilidad').value.toUpperCase().trim();
    const todos = cruzarConductoresPermisos();
    const filtrados = q
        ? todos.filter(c => c.nombre.replace(/_/g,' ').includes(q))
        : todos;
    renderizarTablaAdmin(filtrados);
}

function renderizarPermisos(archivos) {
    const esAdmin = estado.usuario === 'ADMIN_MASTER';

    if (esAdmin) {
        actualizarResumen();
        const todos = cruzarConductoresPermisos();
        renderizarTablaAdmin(todos);
        return;
    }

    // Vista conductor individual
    const lista = $('lista-movilidad');

    if (!archivos.length) {
        lista.innerHTML = `
            <div class="text-center py-20 px-4">
                <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <svg class="h-7 w-7 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                </div>
                <p class="text-slate-400 text-[10px] font-black uppercase tracking-widest">Sin permiso de movilidad registrado</p>
                <p class="text-slate-300 text-[9px] mt-1">Contacta con administración</p>
            </div>`;
        return;
    }

    // Conductor puede tener más de un permiso (ej. varios países)
    lista.innerHTML = archivos.map(a => cardPermisoHTML(a)).join('');
}

function renderizarTablaAdmin(conductores) {
    const lista = $('lista-movilidad');

    if (!conductores.length) {
        lista.innerHTML = `<div class="text-center py-16 text-slate-400 text-[10px] font-bold uppercase tracking-widest">Sin resultados</div>`;
        return;
    }

    lista.innerHTML = conductores.map(c => {
        const nombre   = c.nombre.replace(/_/g, ' ');
        const iniciales = nombre.trim().split(' ').filter(Boolean).slice(0,2).map(p=>p[0]).join('');
        const { cls, label } = badgeEstado(c.estado === 'sin' ? 'sin-fecha' : c.estado);
        const restante = c.fecha ? textoRestante(c.fecha) : 'Sin permiso registrado';
        const fechaStr = c.fecha
            ? c.fecha.toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' })
            : '—';
        const subida   = c.archivo ? fechaSubidaStr(c.archivo) : '—';
        const pais     = c.archivo ? extraerPais(c.archivo.name) : null;

        const pathSafe = c.archivo ? c.archivo.path_lower.replace(/'/g,"\\'") : '';
        const nomSafe  = c.archivo ? c.archivo.name.replace(/'/g,"\\'")       : '';

        const flagHtml = pais
            ? `<img src="https://flagcdn.com/w80/${pais.toLowerCase()}.png" class="h-full w-full object-cover" loading="lazy">`
            : `<span class="text-[8px] font-black text-slate-400">${iniciales}</span>`;

        const btnVer = c.archivo
            ? `<button onclick="previsualizar('${pathSafe}','${nomSafe}')"
                   class="flex-shrink-0 bg-slate-800 hover:bg-slate-700 text-white text-[9px] font-black uppercase px-2.5 py-1.5 rounded-lg transition-all active:scale-95">
                   Ver PDF
               </button>`
            : `<span class="flex-shrink-0 text-[9px] text-slate-300 font-bold uppercase">Sin archivo</span>`;

        return `
            <div class="item fade-in bg-white rounded-2xl shadow-sm border border-slate-200 p-3 mb-2 flex items-center gap-3">
                <div class="w-10 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                    ${flagHtml}
                </div>
                <div class="flex-1 min-w-0">
                    <p class="text-slate-800 font-black text-[10px] uppercase truncate">${nombre}</p>
                    <p class="text-slate-400 text-[9px] font-bold mt-0.5">${restante}${subida !== '—' ? ' · subido '+subida : ''}</p>
                </div>
                <span class="badge ${cls} flex-shrink-0">${label}</span>
                ${btnVer}
            </div>`;
    }).join('');
}

function cardPermisoHTML(archivo) {
    const fecha    = extraerFechaPermiso(archivo);
    const st       = estadoPermiso(fecha);
    const { cls, label } = badgeEstado(st);
    const restante = textoRestante(fecha);
    const fechaCad = fecha
        ? fecha.toLocaleDateString('es-ES', { day:'2-digit', month:'long', year:'numeric' })
        : 'No calculada';
    const subida   = fechaSubidaStr(archivo);
    const pais     = extraerPais(archivo.name);
    const titulo   = archivo.name.replace('.pdf','').replace(/_/g,' ').trim();
    const pathSafe = archivo.path_lower.replace(/'/g,"\\'");
    const nomSafe  = archivo.name.replace(/'/g,"\\'");

    const flagHtml = pais
        ? `<img src="https://flagcdn.com/w80/${pais.toLowerCase()}.png" class="h-full w-full object-cover" loading="lazy">`
        : `<svg class="h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9"/></svg>`;

    const iconColor = st === 'vigente' ? 'text-green-500' : st === 'proximo' ? 'text-yellow-500' : 'text-red-500';
    const bgColor   = st === 'vigente' ? 'bg-green-50 border-green-200' : st === 'proximo' ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200';

    return `
        <div class="item fade-in rounded-2xl border ${bgColor} p-4 mb-3">
            <div class="flex items-start justify-between gap-3 mb-3">
                <div class="flex items-center gap-3 flex-1 min-w-0">
                    <div class="w-10 h-8 rounded-xl bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 shadow-sm overflow-hidden">
                        ${flagHtml}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-slate-700 font-black text-[10px] uppercase truncate">Permiso Movilidad UE${pais ? ' · '+pais : ''}</p>
                        <p class="text-slate-400 text-[9px] font-bold mt-0.5">Subido: ${subida}</p>
                    </div>
                </div>
                <span class="badge ${cls} flex-shrink-0">${label}</span>
            </div>

            <div class="bg-white rounded-xl p-3 mb-3 border border-white/80">
                <div class="flex justify-between items-center">
                    <div>
                        <p class="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-0.5">Caduca el</p>
                        <p class="text-sm font-black text-slate-700">${fechaCad}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[9px] text-slate-400 font-black uppercase tracking-wider mb-0.5">Estado</p>
                        <p class="text-[10px] font-black ${iconColor}">${restante}</p>
                    </div>
                </div>
            </div>

            <button
                onclick="previsualizar('${pathSafe}','${nomSafe}')"
                class="w-full bg-slate-800 hover:bg-slate-700 active:scale-95 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5"
            >
                <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
                Ver permiso
            </button>
        </div>`;
}

// ─── RENDERIZADO CERTIFICADOS ─────────────────────────────────────────────────

function renderizar(archivos) {
    const lista = $('lista-archivos');

    $('contador').textContent = archivos.length
        ? `${archivos.length} documento${archivos.length !== 1 ? 's' : ''}`
        : '';

    if (!archivos.length) {
        lista.innerHTML = `<div class="text-center py-20 text-slate-400 text-[10px] font-bold uppercase tracking-widest">No se encontraron documentos</div>`;
        return;
    }

    lista.innerHTML = archivos
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(archivo => cardHTML(archivo))
        .join('');
}

function cardHTML(archivo) {
    const cp       = bandera(archivo.name);
    const flag     = cp
        ? `<img src="https://flagcdn.com/w80/${cp}.png" class="h-full w-full object-cover" loading="lazy">`
        : `<span class="text-[8px] font-black text-slate-400">DOC</span>`;
    const titulo   = archivo.name.replace('.pdf', '').replace(/_/g, ' ');
    const pathSafe = archivo.path_lower.replace(/'/g, "\\'");
    const nomSafe  = archivo.name.replace(/'/g, "\\'");

    return `
        <div class="item fade-in bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-shadow hover:shadow-md mb-3">
            <button onclick="previsualizar('${pathSafe}','${nomSafe}')" class="w-full flex items-center p-4 text-left active:bg-slate-50">
                <div class="w-12 h-8 flex-shrink-0 bg-slate-100 rounded-lg flex items-center justify-center border border-slate-200 overflow-hidden shadow-inner">
                    ${flag}
                </div>
                <div class="ml-4 flex-1 min-w-0">
                    <h3 class="text-slate-800 font-bold text-[11px] uppercase truncate">${titulo}</h3>
                    <p class="text-blue-500 text-[9px] font-black uppercase mt-0.5 tracking-wide">Ver certificado ›</p>
                </div>
                <svg class="h-4 w-4 text-slate-300 ml-2 flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </button>
        </div>`;
}

// ─── BUSCADOR CERTIFICADOS ────────────────────────────────────────────────────

function filtrar() {
    const q = $('buscador').value.toLowerCase().trim();
    renderizar(q ? estado.archivos.filter(a => a.name.toLowerCase().includes(q)) : estado.archivos);
}

// ─── UTILIDADES DE RENDERIZADO ───────────────────────────────────────────────

function bandera(nombre) {
    const n = nombre.toLowerCase();
    for (const [k, v] of Object.entries(BANDERAS)) {
        if (n.includes(`_${k}_`) || n.includes(`_${k}.`)) return v;
    }
    return null;
}

function errorLista(msg) {
    $('lista-archivos').innerHTML =
        `<div class="text-center py-20 text-red-400 font-bold text-sm uppercase">${msg}</div>`;
}

// ─── VISOR PDF.js ─────────────────────────────────────────────────────────────

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function obtenerLinkTemporal(path) {
    // Intenta con el token actual; si falla con 401 refresca y reintenta
    for (let intento = 0; intento < 2; intento++) {
        const res = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
            method:  'POST',
            headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ path })
        });
        if (res.status === 401) {
            // Token expirado — refrescar y reintentar
            estado.token = await refreshToken();
            if (!estado.token) throw new Error('No se pudo refrescar el token de Dropbox');
            continue;
        }
        const data = await res.json();
        if (!data.link) throw new Error(`Dropbox error: ${JSON.stringify(data)}`);
        return data.link;
    }
    throw new Error('Token inválido tras refresco');
}

async function previsualizar(path, nombre) {
    $('visor-nombre').textContent = nombre;
    $('visor-modal').style.display = 'flex';
    $('pdf-loading').classList.remove('hidden');
    $('pdf-container').classList.add('hidden');
    $('pdf-container').innerHTML = '';
    $('paginacion').classList.add('hidden');

    try {
        const link = await obtenerLinkTemporal(path);

        $('btn-descargar').href     = link;
        $('btn-descargar').download = nombre;

        const pdf = await pdfjsLib.getDocument(link).promise;
        estado.pdfDoc       = pdf;
        estado.totalPaginas = pdf.numPages;
        estado.paginaActual = 1;

        if (pdf.numPages > 1) {
            $('paginacion').classList.remove('hidden');
            $('paginacion').classList.add('flex');
        }

        await renderPagina(1);
        $('pdf-loading').classList.add('hidden');
        $('pdf-container').classList.remove('hidden');

    } catch(e) {
        console.error('Error visor PDF:', e.message);
        $('pdf-loading').innerHTML =
            `<p class="text-red-400 font-bold text-sm uppercase">Error al cargar el documento</p>
             <p class="text-slate-500 text-xs mt-2">${e.message}</p>`;
    }
}

async function renderPagina(num) {
    $('pdf-container').innerHTML = '';
    const page     = await estado.pdfDoc.getPage(num);
    const scale    = window.devicePixelRatio > 1 ? 1.8 : 1.4;
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    const ctx      = canvas.getContext('2d');

    canvas.width       = viewport.width;
    canvas.height      = viewport.height;
    canvas.style.width = '100%';

    $('pdf-container').appendChild(canvas);
    await page.render({ canvasContext: ctx, viewport }).promise;
    $('info-pagina').textContent = `${num} / ${estado.totalPaginas}`;
}

async function cambiarPagina(delta) {
    const nueva = estado.paginaActual + delta;
    if (nueva < 1 || nueva > estado.totalPaginas) return;
    estado.paginaActual = nueva;
    $('pdf-container').innerHTML =
        '<div class="text-white text-xs font-bold animate-pulse py-10">Cargando página...</div>';
    await renderPagina(nueva);
}

function cerrarVisor() {
    $('visor-modal').style.display = 'none';
    $('pdf-container').innerHTML   = '';
    estado.pdfDoc = null;
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => $('pass-input').focus());
