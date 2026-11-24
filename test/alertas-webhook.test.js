const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setImmediate: tick } = require('node:timers/promises');
const nodemailer = require('nodemailer');
const { crearApp } = require('../index');
const { crearCorreo } = require('../integraciones');
const { construirAlerta } = require('../alertas');
const { crearSupabaseSimulado } = require('../testing/supabase-simulado');

const env = { DISPOSITIVO_ID:'prueba', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'ficticia-no-utilizable',
    EMAIL_FROM: 'onboarding@resend.dev', EMAIL_USER: 'smtp@example.invalid',
    REPORT_EMAIL_TO: 'reportes@example.invalid', ALERT_EMAIL_TO: 'alertas@example.invalid',
    ALERT_TRIGGER: 'webhook', SUPABASE_WEBHOOK_SECRET: 'secreto-ficticio-para-tests-1234567890' };
const registro = temperatura => ({ id: 123, dispositivo_id: 'prueba', temperatura, humedad: 70, fecha_hora: '2026-11-04T12:00:00Z' });
const evento = temperatura => ({ type: 'INSERT', schema: 'public', table: 'telemetria', record: registro(temperatura), old_record: null });

async function preparar(t, opciones = {}) {
    const config = { ...env, ...opciones.env };
    const originales = globalThis.fetch;
    const peticiones = [], mensajesUnicos = new Map(), logs = [];
    t.mock.method(nodemailer, 'createTransport', () => { throw new Error('SMTP_NO_PERMITIDO'); });
    t.mock.method(globalThis, 'fetch', async (input, options) => {
        const url = new URL(String(input));
        if (url.hostname === '127.0.0.1') return originales(input, options);
        assert.equal(url.href, 'https://api.resend.com/emails');
        const payload = JSON.parse(options.body);
        const key = new Headers(options.headers).get('idempotency-key');
        peticiones.push({ payload, key });
        if (opciones.errorAPI) return Response.json({ statusCode: 503, message: 'DETALLE_PRIVADO' }, { status: 503 });
        if (key && mensajesUnicos.has(key)) {
            const previo = mensajesUnicos.get(key);
            assert.deepEqual(payload, previo.payload);
            return Response.json({ id: previo.id });
        }
        const id = `aceptado-simulado-${mensajesUnicos.size + 1}`;
        mensajesUnicos.set(key || id, { payload, id });
        return Response.json({ id });
    });
    const db = crearSupabaseSimulado(opciones.filas || []);
    const supabase = db.cliente, inserts = db.insertados;
    const server = crearApp({ env: config, supabase,
        logger: { info: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return { peticiones, mensajesUnicos, inserts, logs, filas:db.filas, async post(ruta, body, token = config.SUPABASE_WEBHOOK_SECRET) {
        const r = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`, { method: 'POST',
            headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}) },
            body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json() };
    } };
}

test('Webhook simulado 29/30/35: solo 35 prepara una alerta al destinatario de alertas', async t => {
    const s = await preparar(t);
    for (const temperatura of [29, 30, 35]) {
        const r = await s.post('/api/webhooks/supabase/telemetria', { ...evento(temperatura), to: 'ajeno@example.invalid' });
        assert.equal(r.status, 200);
        assert.equal(r.body.alerta, temperatura === 35 ? 'aceptada' : 'omitida');
        if (temperatura === 35) assert.equal(r.body.entrega, 'no_confirmada');
    }
    assert.equal(s.peticiones.length, 1);
    assert.equal(s.inserts.length, 0);
    const { payload } = s.peticiones[0];
    assert.deepEqual(payload.to, [env.ALERT_EMAIL_TO]);
    assert.match(payload.html, /35°C/);
    assert.match(payload.html, /70%/);
    assert.match(payload.html, /prueba/);
    assert.match(payload.html, /2026-11-04T12:00:00\.000Z/);
});

test('Modo express 29/30/35: registra cambios y genera una sola alerta Resend', async t => {
    const s = await preparar(t, { env: { ALERT_TRIGGER:'express', EMAIL_PROVIDER:'smtp' } });
    for (const temperatura of [29, 30, 35]) {
        const r = await s.post('/api/telemetria', { ...registro(temperatura), to:'ajeno@example.invalid' });
        assert.equal(r.status, 200);
        assert.equal(r.body.registrado, true);
        assert.equal(r.body.mensaje, 'Datos guardados');
    }
    await tick();
    assert.equal(s.inserts.length, 3);
    assert.deepEqual(s.inserts.map(x => x.temperatura), [29,30,35]);
    assert.equal(s.peticiones.length, 1);
    assert.deepEqual(s.peticiones[0].payload.to, [env.ALERT_EMAIL_TO]);
    assert.equal((await s.post('/api/webhooks/supabase/telemetria', evento(35))).status, 409);
    assert.equal(s.peticiones.length, 1);
});

test('Express + webhook + repeticion: una fuente, clave estable y una aceptacion unica del proveedor simulado', async t => {
    const s = await preparar(t);
    const insert = await s.post('/api/telemetria', registro(35));
    await tick();
    assert.equal(s.peticiones.length, 0);
    const hook = { ...evento(35), record:insert.body.lectura };
    const a = await s.post('/api/webhooks/supabase/telemetria', hook);
    const b = await s.post('/api/webhooks/supabase/telemetria', hook);
    assert.equal(a.body.messageId, b.body.messageId);
    assert.equal(s.inserts.length, 1);
    assert.equal(s.peticiones.length, 2); // Dos peticiones, un unico mensaje por idempotencia del proveedor.
    assert.ok(s.peticiones[0].key);
    assert.equal(s.peticiones[0].key, s.peticiones[1].key);
    assert.equal(s.mensajesUnicos.size, 1);
});

test('Webhook: secreto ausente/incorrecto, otra tabla, DELETE e ID invalido no envian correo', async t => {
    const s = await preparar(t);
    assert.equal((await s.post('/api/webhooks/supabase/telemetria', evento(35), '')).status, 401);
    assert.equal((await s.post('/api/webhooks/supabase/telemetria', evento(35), 'incorrecto')).status, 401);
    for (const body of [{ ...evento(35), type:'DELETE' }, { ...evento(35), table:'otra' }, { ...evento(35), schema:'otro' }]) {
        assert.equal((await s.post('/api/webhooks/supabase/telemetria', body)).body.alerta, 'omitida');
    }
    assert.equal((await s.post('/api/webhooks/supabase/telemetria', { ...evento(35), record:{ dispositivo_id:'prueba', temperatura:35 } })).status, 400);
    const sinSecret = await preparar(t, { env: { SUPABASE_WEBHOOK_SECRET:'' } });
    assert.equal((await sinSecret.post('/api/webhooks/supabase/telemetria', evento(35))).status, 503);
    assert.equal(s.peticiones.length, 0);
    assert.equal(sinSecret.peticiones.length, 0);
});

test('INSERT de cambios: humedad o temperatura ya alta no repiten alerta; un nuevo cruce si', async t => {
    const s = await preparar(t);
    const temperaturas = [22,30,35,35,36,29,34];
    for (const [i, temperatura] of temperaturas.entries()) {
        const record = { ...registro(temperatura), id:i+1, humedad:60+i };
        s.filas.push(record); // El evento corresponde a una fila ya almacenada.
        const r = await s.post('/api/webhooks/supabase/telemetria', { ...evento(temperatura), record });
        assert.equal(r.status, 200);
        assert.equal(r.body.alerta, [2,6].includes(i) ? 'aceptada' : 'omitida');
    }
    assert.equal(s.peticiones.length, 2);
    assert.notEqual(s.peticiones[0].key, s.peticiones[1].key);
    assert.equal(s.inserts.length, 0);
});

test('UPDATE de log antiguo y eventos de otro ESP no envian alertas', async t => {
    const s = await preparar(t);
    for (const body of [{ ...evento(35), type:'UPDATE', old_record:registro(22) },
        { ...evento(35), record:{ ...registro(35), dispositivo_id:'otro' } }]) {
        assert.equal((await s.post('/api/webhooks/supabase/telemetria', body)).body.alerta, 'omitida');
    }
    assert.equal(s.peticiones.length, 0);
    assert.equal(s.inserts.length, 0);
});

test('Reentrega de un log conserva clave aunque ya existan logs mas recientes', async t => {
    const s = await preparar(t, { filas:[{ ...registro(22), id:1 }] });
    const record = { ...registro(35), id:2 };
    s.filas.push(record);
    const a = await s.post('/api/webhooks/supabase/telemetria', { ...evento(35), record });
    s.filas.push({ ...registro(29), id:3 });
    const b = await s.post('/api/webhooks/supabase/telemetria', { ...evento(35), record });
    assert.equal(a.body.messageId, b.body.messageId);
    assert.equal(s.peticiones[0].key, s.peticiones[1].key);
    assert.equal(s.mensajesUnicos.size, 1);
});

test('Destinatarios separados y sin fallback antiguo para alerta; reporte conserva compatibilidad', async t => {
    const s = await preparar(t);
    await s.post('/api/reporte', { to:'ajeno@example.invalid', ALERT_EMAIL_TO:'ajeno@example.invalid' });
    await s.post('/api/webhooks/supabase/telemetria', evento(35));
    assert.deepEqual(s.peticiones[0].payload.to, [env.REPORT_EMAIL_TO]);
    assert.deepEqual(s.peticiones[1].payload.to, [env.ALERT_EMAIL_TO]);
    await assert.rejects(crearCorreo({ ...env, ALERT_EMAIL_TO:'' }, 'alerta').sendMail({ subject:'test', text:'test' }), { codigo:'EMAIL_DESTINATARIO_INVALIDO' });
    await assert.rejects(crearCorreo({ ...env, ALERT_EMAIL_TO:'uno@example.invalid,dos@example.invalid' }, 'alerta').sendMail({ subject:'test', text:'test' }), { codigo:'EMAIL_DESTINATARIO_INVALIDO' });
    await assert.rejects(crearCorreo(env, 'arbitrario').sendMail({}), { codigo:'EMAIL_PROPOSITO_INVALIDO' });
    assert.equal(s.peticiones.length, 2);
});

test('Webhook fallido permite reentrega con la misma clave y logs sanitizados', async t => {
    const s = await preparar(t, { errorAPI:true });
    for (let i = 0; i < 2; i++) assert.equal((await s.post('/api/webhooks/supabase/telemetria', evento(35))).status, 503);
    assert.equal(s.peticiones[0].key, s.peticiones[1].key);
    assert.ok(!JSON.stringify(s.logs).includes('DETALLE_PRIVADO'));
    assert.equal(s.inserts.length, 0);
});

test('HTML conserva temperatura y escapa datos; campos faltantes se omiten sin fechas inventadas', () => {
    const a = construirAlerta({ temperatura:35, dispositivo_id:'<img src=x>', humedad:70 });
    assert.match(a.html, /&lt;img src=x&gt;/);
    assert.ok(!a.html.includes('<img'));
    assert.match(a.html, /35°C/);
    assert.ok(!a.html.includes('Fecha:'));
});
