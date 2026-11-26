const { createHash, timingSafeEqual } = require('node:crypto');

function escapar(valor) {
    return String(valor).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function temperaturaNumerica(lectura) {
    const valor = lectura?.temperatura;
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null;
    return Number.isFinite(Number(valor)) ? Number(valor) : null;
}

function temperaturaAlta(lectura) {
    const valor = temperaturaNumerica(lectura);
    return valor !== null && valor >= 30;
}

function cruceTemperatura(anterior, nueva) {
    if (!temperaturaAlta(nueva)) return false;
    if (!anterior) return true; // Primera lectura, ya crítica.
    const previo = temperaturaNumerica(anterior);
    if (previo === null) throw Object.assign(new Error('Estado anterior inválido.'), { codigo: 'WEBHOOK_ANTERIOR_INVALIDO' });
    return previo < 30;
}

function humedadNumerica(lectura) {
    const valor = lectura?.humedad;
    if (typeof valor !== 'number' && (typeof valor !== 'string' || !valor.trim())) return null;
    const n = Number(valor);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function cruceHumedad(anterior, nueva) {
    const actual = humedadNumerica(nueva);
    if (actual === null || actual >= 30) return false;
    if (!anterior) return true;
    const previo = humedadNumerica(anterior);
    if (previo === null) throw Object.assign(new Error('Humedad anterior inválida.'), { codigo: 'WEBHOOK_ANTERIOR_INVALIDO' });
    return previo >= 30;
}

function tiposAlertas(anterior, nueva) {
    return [
        ...(cruceTemperatura(anterior, nueva) ? ['temperatura-alta'] : []),
        ...(cruceHumedad(anterior, nueva) ? ['suelo-seco'] : []),
    ];
}

function construirAlerta(lectura, tipo = 'temperatura-alta') {
    const dispositivo = ['string', 'number'].includes(typeof lectura.dispositivo_id) ? String(lectura.dispositivo_id) : '';
    const humedadValida = (typeof lectura.humedad === 'number' || typeof lectura.humedad === 'string' && lectura.humedad.trim()) && Number.isFinite(Number(lectura.humedad));
    const fecha = typeof lectura.fecha_hora === 'string' && Number.isFinite(Date.parse(lectura.fecha_hora)) ? new Date(lectura.fecha_hora).toISOString() : '';
    if (tipo === 'suelo-seco') return {
        subject: `🚨 ALERTA: Suelo seco${dispositivo ? ` en ${dispositivo.replace(/[\r\n]/g, ' ')}` : ''}`,
        html: `<h2>Alerta de humedad del suelo</h2>${dispositivo ? `<p>Dispositivo: ${escapar(dispositivo)}</p>` : ''}<p>Humedad del suelo: <b style="color:red;">${escapar(humedadNumerica(lectura))}%</b></p><p>Suelo seco: humedad menor a 30% en la escala relativa calibrada del YL-69.</p>${temperaturaNumerica(lectura) !== null ? `<p>Temperatura: ${escapar(temperaturaNumerica(lectura))}°C</p>` : ''}${fecha ? `<p>Fecha: ${escapar(fecha)}</p>` : ''}`,
    };
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

function claveAlerta(lectura, env, tipo = 'temperatura-alta') {
    const id = lectura?.id;
    if (!(typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id) || Number.isSafeInteger(id) && id > 0)) {
        throw Object.assign(new Error('Falta el ID canónico de la lectura.'), { codigo: 'WEBHOOK_REGISTRO_INVALIDO' });
    }
    const proyecto = createHash('sha256').update(env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : 'supabase').digest('hex').slice(0, 16);
    if (!['temperatura-alta', 'suelo-seco'].includes(tipo)) throw Object.assign(new Error('Tipo inválido.'), { codigo: 'WEBHOOK_REGISTRO_INVALIDO' });
    return `agrovalle/${proyecto}/public.telemetria/${id}/${tipo}/v1`;
}

module.exports = { temperaturaAlta, construirAlerta, modoAlertas, autenticarWebhook, claveAlerta, cruceTemperatura, cruceHumedad, tiposAlertas };
