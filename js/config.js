// ─────────────────────────────────────────────────────────────────────────────
// js/config.js  —  PORTAL CONDUCTORES
//
// ⚠️  Solo contiene credenciales de Dropbox (solo lectura).
//     NO incluye API Key de RTPD ni ningún dato de administración.
//
//     Si el repositorio GitHub es público, considera moverlo a repo privado
//     o rotar las credenciales de Dropbox periódicamente.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {
    dropbox: {
        appKey:           'xnn97yqq7toflho',
        appSecret:        '34k2iq4rbn0zqgk',
        refreshToken:     'OI-7RpuZyfkAAAAAAAAAATgnbXUlpcY6QHNc3tW3Otg_QO5Tle5F7eaFC7kMpcxB',
        carpetaMovilidad: '/movilidad'
    },

    // Días de antelación para mostrar aviso de permiso próximo a vencer
    diasAvisoProximo: 45,

    // Validez del permiso en meses (para calcular caducidad desde fecha de subida)
    mesesValidez: 6
};
