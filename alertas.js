const { createHash, timingSafeEqual } = require('node:crypto');

function escapar(valor) {
    return String(valor).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function temperaturaAlta(lectura) {
    const valor = lectura?.temperatura;
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return false;
    return Number.isFinite(Number(valor)) && Number(valor) > 30;
}

function construirAlerta(lectura) {
    const dispositivo = ['string', 'number'].includes(typeof lectura.dispositivo_id) ? String(lectura.dispositivo_id) : '';
    const humedadValida = (typeof lectura.humedad === 'number' || typeof lectura.humedad === 'string' && lectura.humedad.trim()) && Number.isFinite(Number(lectura.humedad));
    const fecha = typeof lectura.fecha_hora === 'string' && Number.isFinite(Date.parse(lectura.fecha_hora)) ? new Date(lectura.fecha_hora).toISOString() : '';
    return {
        subject: `🚨 ALERTA: Temperatura Crítica${dispositivo ? ` en ${dispositivo.replace(/[\r\n]/g, ' ')}` : ''}`,
        html: `<h2>Alerta de Sensores</h2>${dispositivo ? `<p>Dispositivo: ${escapar(dispositivo)}</p>` : ''}<p>Temperatura: <b style="color:red;">${escapar(Number(lectura.temperatura))}°C</b></p>${humedadValida ? `<p>Humedad: ${escapar(Number(lectura.humedad))}%</p>` : ''}${fecha ? `<p>Fecha: ${escapar(fecha)}</p>` : ''}`,
    };
}

function modoAlertas(env) {
    const modo = env.ALERT_TRIGGER || 'express';
    if (!['express', 'webhook'].includes(modo)) throw Object.assign(new Error('Modo de alerta inválido.'), { codigo: 'ALERT_TRIGGER_INVALIDO' });
    return modo;
}

function autenticarWebhook(req, env) {
    const secret = env.SUPABASE_WEBHOOK_SECRET;
    if (typeof secret !== 'string' || secret.length < 32) return { status: 503, codigo: 'WEBHOOK_NO_CONFIGURADO' };
    const authorization = req.get('authorization') || '';
    const esperado = Buffer.from(`Bearer ${secret}`);
    const recibido = Buffer.from(authorization);
    if (recibido.length !== esperado.length || !timingSafeEqual(recibido, esperado)) return { status: 401, codigo: 'WEBHOOK_NO_AUTORIZADO' };
    return null;
}

function claveAlerta(lectura, env) {
    const id = lectura?.id;
    if (!(typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) || Number.isSafeInteger(id) && id > 0)) {
        throw Object.assign(new Error('Falta el ID canónico de la lectura.'), { codigo: 'WEBHOOK_REGISTRO_INVALIDO' });
    }
    const proyecto = createHash('sha256').update(env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : 'supabase').digest('hex').slice(0, 16);
    return `agrovalle/${proyecto}/public.telemetria/${id}/temperatura-alta/v1`;
}

module.exports = { temperaturaAlta, construirAlerta, modoAlertas, autenticarWebhook, claveAlerta };
