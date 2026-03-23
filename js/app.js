'use strict';

// ─── CONFIGURACIÓN DE DROPBOX ────────────────────────────────────────────────
const DROPBOX = {
    appKey:       'xnn97yqq7toflho',
    appSecret:    '34k2iq4rbn0zqgk',
    refreshToken: 'OI-7RpuZyfkAAAAAAAAAATgnbXUlpcY6QHNc3tW3Otg_QO5Tle5F7eaFC7kMpcxB'
};

// ─── BANDERAS ────────────────────────────────────────────────────────────────
const BANDERAS = { be:'be', de:'de', fr:'fr', gb:'gb', nl:'nl', es:'es', pt:'pt', it:'it' };

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
const estado = {
    token:         '',
    usuario:       '',
    archivos:      [],
    intentos:      0,
    bloqueadoHasta: 0,
    pdfDoc:        null,
    paginaActual:  1,
    totalPaginas:  0,
};

// ─── UTILIDADES ──────────────────────────────────────────────────────────────

/** Hashea un string con SHA-256 y devuelve hex.
 *  Disponible en consola: sha256("TuPIN").then(console.log) */
async function sha256(texto) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}
window.sha256 = sha256; // expuesto para generar hashes desde la consola

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

    // Spinner
    $('btn-login-text').textContent = 'Verificando...';
    $('btn-login-spinner').classList.remove('hidden');
    $('btn-login').disabled = true;
    $('error-msg').classList.add('hidden');

    // Buscar usuario: texto plano primero, luego hash SHA-256
    let usuarioEncontrado = null;
    const inputUpper = input.toUpperCase();

    for (const [clave, nombre] of Object.entries(USUARIOS)) {
        // Texto plano (compatible mientras se migra a hashes)
        if (clave === input || clave === inputUpper) {
            usuarioEncontrado = nombre;
            break;
        }
        // Hash SHA-256 (valores de exactamente 64 caracteres hex)
        if (clave.length === 64) {
            const hashInput = await sha256(input);
            if (clave === hashInput) {
                usuarioEncontrado = nombre;
                break;
            }
        }
    }

    // Restaurar botón
    $('btn-login-text').textContent = 'Entrar';
    $('btn-login-spinner').classList.add('hidden');
    $('btn-login').disabled = false;

    if (usuarioEncontrado) {
        estado.intentos = 0;
        estado.usuario  = usuarioEncontrado;
        entrarApp();
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

// ─── INICIAR APP ──────────────────────────────────────────────────────────────

async function entrarApp() {
    $('login-screen').remove();
    $('app-screen').classList.remove('hidden');

    if (estado.usuario === 'ADMIN_MASTER') {
        $('saludo-usuario').textContent = 'ADMINISTRACIÓN';
        $('saludo-usuario').classList.add('text-yellow-400');
        $('sub-titulo').textContent = 'Acceso Maestro';
    } else {
        $('saludo-usuario').textContent = estado.usuario.replace(/_/g, ' ');
    }

    mostrarSkeletons();
    estado.token = await refreshToken();
    estado.token ? cargarArchivos() : errorLista('Error al conectar con el servidor');
}

// ─── SKELETONS ────────────────────────────────────────────────────────────────

function mostrarSkeletons() {
    $('lista-archivos').innerHTML = Array.from({length: 5}).map(() => `
        <div class="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex items-center gap-4">
            <div class="skeleton w-12 h-8 rounded-lg flex-shrink-0"></div>
            <div class="flex-1 space-y-2">
                <div class="skeleton h-3 w-3/4 rounded"></div>
                <div class="skeleton h-2 w-1/3 rounded"></div>
            </div>
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
                refresh_token: DROPBOX.refreshToken.trim(),
                client_id:     DROPBOX.appKey.trim(),
                client_secret: DROPBOX.appSecret.trim()
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
                : JSON.stringify({ path: '', recursive: true });

            const res  = await fetch(url, {
                method:  'POST',
                headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
                body
            });
            const data = await res.json();
            if (data.entries) todos = todos.concat(data.entries);
            hayMas = data.has_more;
            cursor = data.cursor;
        }

        let filtrados = todos.filter(a => a['.tag'] !== 'folder');

        if (estado.usuario !== 'ADMIN_MASTER') {
            filtrados = filtrados.filter(a =>
                a.name.toUpperCase().includes(estado.usuario.toUpperCase())
            );
        }

        estado.archivos = filtrados;
        renderizar(filtrados);

    } catch {
        errorLista('Error de conexión con Dropbox');
    }
}

// ─── RENDERIZADO ──────────────────────────────────────────────────────────────

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
        .map(archivo => {
            const cp       = bandera(archivo.name);
            const flag     = cp
                ? `<img src="https://flagcdn.com/w80/${cp}.png" class="h-full w-full object-cover" loading="lazy">`
                : `<span class="text-[8px] font-black text-slate-400">DOC</span>`;
            const titulo   = archivo.name.replace('.pdf', '').replace(/_/g, ' ');
            const pathSafe = archivo.path_lower.replace(/'/g, "\\'");
            const nomSafe  = archivo.name.replace(/'/g, "\\'");

            return `
                <div class="item fade-in bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-shadow hover:shadow-md">
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
        })
        .join('');
}

// ─── BUSCADOR ─────────────────────────────────────────────────────────────────

function filtrar() {
    const q = $('buscador').value.toLowerCase().trim();
    renderizar(q ? estado.archivos.filter(a => a.name.toLowerCase().includes(q)) : estado.archivos);
}

// ─── VISOR PDF.js ─────────────────────────────────────────────────────────────

pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function previsualizar(path, nombre) {
    $('visor-nombre').textContent = nombre;
    $('visor-modal').style.display = 'flex';
    $('pdf-loading').classList.remove('hidden');
    $('pdf-container').classList.add('hidden');
    $('pdf-container').innerHTML = '';
    $('paginacion').classList.add('hidden');

    try {
        const res  = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
            method:  'POST',
            headers: { Authorization: `Bearer ${estado.token}`, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ path })
        });
        const data = await res.json();
        if (!data.link) throw new Error('Sin link');

        $('btn-descargar').href = data.link;

        const pdf = await pdfjsLib.getDocument(data.link).promise;
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

    } catch {
        $('pdf-loading').innerHTML =
            `<p class="text-red-400 font-bold text-sm uppercase">Error al cargar el documento</p>`;
    }
}

async function renderPagina(num) {
    $('pdf-container').innerHTML = '';
    const page     = await estado.pdfDoc.getPage(num);
    const scale    = window.devicePixelRatio > 1 ? 1.8 : 1.4;
    const viewport = page.getViewport({ scale });
    const canvas   = document.createElement('canvas');
    const ctx      = canvas.getContext('2d');

    canvas.width        = viewport.width;
    canvas.height       = viewport.height;
    canvas.style.width  = '100%';

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