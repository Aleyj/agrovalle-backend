const { timingSafeEqual } = require('node:crypto');

function autenticarEsp(req, env) {
    const token = env.TELEMETRIA_API_TOKEN;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
        return { status: 503, codigo: 'ESP_NO_CONFIGURADO' };
    }
    const esperado = Buffer.from(`Bearer ${token}`);
    const recibido = Buffer.from(req.get('authorization') || '');
    if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) {
        return { status: 401, codigo: 'ESP_NO_AUTORIZADO' };
    }
    return null;
}

module.exports = { autenticarEsp };
