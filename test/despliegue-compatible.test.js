const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const nodemailer = require('nodemailer');
const { crearApp } = require('../index');
const { crearSupabaseSimulado } = require('../testing/supabase-simulado');

test('Deploy sin tokens nuevos: lecturas, login, AgroBot, reporte y webhook siguen operativos', async t => {
    const env = {
        EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'ficticia-no-utilizable', EMAIL_FROM: 'onboarding@resend.dev',
        REPORT_EMAIL_TO: 'reportes@example.invalid', ALERT_EMAIL_TO: 'alertas@example.invalid',
        ALERT_TRIGGER: 'webhook', SUPABASE_WEBHOOK_SECRET: 'secreto-ficticio-webhook-solo-test-1234567890',
    };
    // Configuración previa al dashboard/ESP, sin ANALISIS_API_TOKEN ni TELEMETRIA_API_TOKEN.
    const original = globalThis.fetch, enviados = [];
    t.mock.method(nodemailer, 'createTransport', () => { throw Error('SMTP_NO_PERMITIDO'); });
    t.mock.method(globalThis, 'fetch', async (input, opciones) => {
        const url = new URL(String(input));
        if (url.hostname === '127.0.0.1') return original(input, opciones);
        assert.equal(url.href, 'https://api.resend.com/emails');
        enviados.push({ cuerpo: JSON.parse(opciones.body), clave: new Headers(opciones.headers).get('idempotency-key') });
        return Response.json({ id: `aceptado-simulado-${enviados.length}` });
    });
    const anterior = { id: 1, dispositivo_id: 'ESP32-AGRO-01', temperatura: 29, humedad: 40,
        bomba_encendida: false, fecha_hora: '2026-11-25T12:00:00Z' };
    const actual = { ...anterior, id: 2, temperatura: 35, fecha_hora: '2026-11-25T12:01:00Z' };
    const db = crearSupabaseSimulado([anterior, actual]);
    const preguntas = [];
    const server = crearApp({ env, supabase: db.cliente,
        generarRespuesta: async (pregunta, contexto) => { preguntas.push({ pregunta, contexto }); return 'Respuesta simulada de AgroBot'; },
        cargarContexto: async () => 'Manual simulado', logger: { info() {}, error() {} },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function peticion(ruta, datos, token) {
        const r = await fetch(base + ruta, datos === undefined ? {} : { method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(datos) });
        return { status: r.status, body: await r.json() };
    }
    for (const [ruta, datos, codigo] of [
        ['/api/analisis', undefined, 'ANALISIS_NO_CONFIGURADO'],
        ['/api/telemetria', { temperatura: 22, humedad: 40 }, 'ESP_NO_CONFIGURADO'],
    ]) {
        const r = await peticion(ruta, datos);
        assert.equal(r.status, 503);
        assert.equal(r.body.codigo, codigo);
    }
    const estado = await peticion('/api/estado');
    assert.equal(estado.status, 200);
    assert.equal(estado.body.lectura.id, 2);
    assert.equal(estado.body.planta.dispositivo_id, anterior.dispositivo_id);
    const historial = await peticion('/api/historial');
    assert.equal(historial.status, 200);
    assert.deepEqual(historial.body.map(f => f.id), [2, 1]);

    // El login actual usa las variables del proceso; el runner aísla este archivo.
    const previos = Object.fromEntries(['ADMIN_USER', 'ADMIN_PASS', 'JWT_SECRET'].map(k => [k, process.env[k]]));
    Object.assign(process.env, { ADMIN_USER: 'usuario-simulado', ADMIN_PASS: 'password-simulado', JWT_SECRET: 'jwt-ficticio-solo-test' });
    t.after(() => { for (const [k, v] of Object.entries(previos)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
    const login = await peticion('/api/login', { usuario: 'usuario-simulado', password: 'password-simulado' });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.token, 'string');
    const chat = await peticion('/api/chatbot', { pregunta: '¿Qué temperatura se recomienda?' });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.respuesta, 'Respuesta simulada de AgroBot');
    assert.equal(preguntas[0].contexto, 'Manual simulado');

    const reporte = await peticion('/api/reporte', { to: 'ajeno@example.invalid' });
    assert.equal(reporte.status, 200);
    assert.equal(reporte.body.correo.estado, 'aceptado');
    assert.equal(reporte.body.correo.entrega, 'no_confirmada');
    const evento = { type: 'INSERT', schema: 'public', table: 'telemetria', record: actual, old_record: null };
    assert.equal((await peticion('/api/webhooks/supabase/telemetria', evento, 'incorrecto')).status, 401);
    const alerta = await peticion('/api/webhooks/supabase/telemetria', evento, env.SUPABASE_WEBHOOK_SECRET);
    assert.equal(alerta.status, 200);
    assert.equal(alerta.body.alerta, 'aceptada');
    assert.equal(alerta.body.entrega, 'no_confirmada');
    assert.deepEqual(enviados.map(m => m.cuerpo.to), [[env.REPORT_EMAIL_TO], [env.ALERT_EMAIL_TO]]);
    assert.ok(enviados[1].clave.includes('/public.telemetria/2/'));
    assert.equal(db.rpc.length, 0);
    assert.equal(db.insertados.length, 0);
});
