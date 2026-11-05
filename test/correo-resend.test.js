const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { setImmediate: tick } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const nodemailer = require('nodemailer');
const { crearApp } = require('../index');
const { crearCorreo, registrarError } = require('../integraciones');
const { crearCorreoPreparacion } = require('../local-validacion');

const env = { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'clave-ficticia-solo-pruebas',
    EMAIL_FROM: 'onboarding@resend.dev', EMAIL_USER: 'cuenta@example.invalid' };
const mensaje = { subject: 'Reporte de prueba', html: '<table><tr><td>27°C</td><td>65%</td></tr></table>' };

function apiSimulada(t, responder) {
    const fetchOriginal = globalThis.fetch;
    const llamadas = [];
    t.mock.method(globalThis, 'fetch', async (input, options) => {
        const url = new URL(String(input));
        if (url.hostname === '127.0.0.1') return fetchOriginal(input, options);
        assert.equal(url.href, 'https://api.resend.com/emails');
        llamadas.push({ payload: JSON.parse(options.body), signal: options.signal });
        return responder(options, llamadas.length);
    });
    // Ningun fallo de Resend debe intentar SMTP como respaldo.
    t.mock.method(nodemailer, 'createTransport', () => { throw new Error('SMTP_NO_PERMITIDO_EN_PRUEBA_RESEND'); });
    return llamadas;
}

async function servidor(t, config = env) {
    const insertados = [], logs = [];
    const supabase = { from(tabla) {
        assert.equal(tabla, 'telemetria');
        return {
            select: () => ({ order: () => ({ limit: async limite => {
                assert.equal(limite, 10);
                return { data: [{ temperatura: 27, humedad: 65, fecha_hora: '2026-11-04T12:00:00Z' }], error: null };
            } }) }),
            insert: async datos => { insertados.push(...datos); return { error: null }; },
        };
    } };
    const server = crearApp({ env: config, supabase,
        logger: { error: (...args) => logs.push(args), info: (...args) => logs.push(args) },
    }).listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    return { insertados, logs, async post(ruta, datos = {}) {
        const r = await fetch(`http://127.0.0.1:${server.address().port}${ruta}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(datos),
        });
        return { status: r.status, body: await r.json() };
    } };
}

test('Resend SDK real con fetch simulado: HTTPS, HTML y destinatario unico; sin cc/bcc/envelope', async t => {
    const llamadas = apiSimulada(t, () => Response.json({ id: 'id-simulado' }));
    const r = await crearCorreo(env).sendMail({ ...mensaje, to: 'arbitrario@example.invalid', from: 'otro@example.invalid',
        cc: 'cc@example.invalid', bcc: 'bcc@example.invalid', envelope: { to: ['extra@example.invalid'] },
        headers: { Bcc: 'oculto@example.invalid' } });
    assert.equal(llamadas.length, 1);
    assert.deepEqual(llamadas[0].payload, { ...mensaje, from: env.EMAIL_FROM, to: [env.EMAIL_USER] });
    assert.ok(llamadas[0].signal instanceof AbortSignal);
    assert.deepEqual(r, { proveedor: 'resend', estado: 'aceptado', entrega: 'no_confirmada', messageId: 'id-simulado' });
});

test('Resend: configuracion ausente, destinatarios multiples, proveedor y timeout invalidos no hacen peticiones', async t => {
    const llamadas = apiSimulada(t, () => { throw new Error('NO_DEBE_LLAMARSE'); });
    for (const [config, codigo] of [
        [{ ...env, RESEND_API_KEY: '' }, 'RESEND_NO_CONFIGURADO'],
        [{ ...env, EMAIL_FROM: '' }, 'RESEND_NO_CONFIGURADO'],
        [{ ...env, EMAIL_USER: '' }, 'EMAIL_DESTINATARIO_INVALIDO'],
        [{ ...env, EMAIL_USER: 'uno@example.invalid,dos@example.invalid' }, 'EMAIL_DESTINATARIO_INVALIDO'],
        [{ ...env, RESEND_TIMEOUT_MS: 'NaN' }, 'RESEND_NO_CONFIGURADO'],
        [{ ...env, RESEND_TIMEOUT_MS: '0' }, 'RESEND_NO_CONFIGURADO'],
        [{ ...env, RESEND_TIMEOUT_MS: '60001' }, 'RESEND_NO_CONFIGURADO'],
        [{ ...env, EMAIL_PROVIDER: 'desconocido' }, 'EMAIL_PROVIDER_INVALIDO'],
    ]) await assert.rejects(crearCorreo(config).sendMail(mensaje), { codigo });
    await assert.rejects(crearCorreo(env).verify(), { codigo: 'EMAIL_VERIFY_NO_DISPONIBLE' });
    assert.equal(llamadas.length, 0);
});

test('Resend: no activar logs crudos del SDK mediante RESEND_DEBUG', async t => {
    const llamadas = apiSimulada(t, () => Response.json({ id: 'no' }));
    const anterior = process.env.RESEND_DEBUG;
    t.after(() => { if (anterior === undefined) delete process.env.RESEND_DEBUG; else process.env.RESEND_DEBUG = anterior; });
    process.env.RESEND_DEBUG = 'true';
    await assert.rejects(crearCorreo(env).sendMail(mensaje), { codigo: 'RESEND_NO_CONFIGURADO' });
    assert.equal(llamadas.length, 0);
});

test('Reporte HTTP con Resend: conserva contenido y contrato; aceptado no equivale a entregado', async t => {
    const llamadas = apiSimulada(t, () => Response.json({ id: 'reporte-simulado' }));
    const s = await servidor(t);
    const r = await s.post('/api/reporte', { to: 'ajeno@example.invalid', cc: 'ajeno@example.invalid', from: 'ajeno@example.invalid' });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.correo, { proveedor: 'resend', estado: 'aceptado', entrega: 'no_confirmada', messageId: 'reporte-simulado' });
    assert.match(r.body.mensaje, /entrega aún no confirmada/);
    assert.match(llamadas[0].payload.html, /27°C/);
    assert.match(llamadas[0].payload.html, /65%/);
    assert.match(llamadas[0].payload.html, /Fecha/);
    assert.deepEqual(llamadas[0].payload.to, [env.EMAIL_USER]);
    assert.equal(s.insertados.length, 0);
});

for (const [statusProveedor, statusHTTP, codigo] of [
    [401, 502, 'RESEND_RECHAZADO'], [403, 502, 'RESEND_RECHAZADO'], [422, 502, 'RESEND_RECHAZADO'],
    [429, 503, 'RESEND_CUOTA'], [500, 503, 'RESEND_NO_DISPONIBLE'],
]) test(`Reporte Resend: error ${statusProveedor} sanitizado, sin reintentos ni fallback SMTP`, async t => {
    const llamadas = apiSimulada(t, () => Response.json({ statusCode: statusProveedor, name: 'validation_error',
        message: 'SECRETO_PROVEEDOR cuenta-privada@example.invalid clave-privada' }, { status: statusProveedor }));
    const s = await servidor(t);
    const r = await s.post('/api/reporte');
    assert.equal(r.status, statusHTTP);
    assert.equal(r.body.codigo, codigo);
    assert.equal(llamadas.length, 1);
    assert.ok(!JSON.stringify([r, s.logs]).includes('SECRETO_PROVEEDOR'));
    assert.ok(!JSON.stringify([r, s.logs]).includes('cuenta-privada'));
    assert.ok(JSON.stringify(s.logs).includes(String(statusProveedor)));
});

test('Resend: timeout del SDK produce 504 y no repite un envio de resultado incierto', async t => {
    const llamadas = apiSimulada(t, options => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    const s = await servidor(t, { ...env, RESEND_TIMEOUT_MS: '10' });
    const r = await s.post('/api/reporte');
    assert.equal(r.status, 504);
    assert.equal(r.body.codigo, 'RESEND_TIMEOUT');
    assert.equal(llamadas.length, 1);
});

test('Resend: fallo de red o respuesta sin ID no anuncia aceptacion', async t => {
    let modo = 'red';
    const llamadas = apiSimulada(t, () => {
        if (modo === 'red') throw new TypeError('SECRETO_EN_ERROR_RED');
        return Response.json({});
    });
    const correo = crearCorreo(env);
    await assert.rejects(correo.sendMail(mensaje), { codigo: 'RESEND_ERROR' });
    modo = 'vacio';
    await assert.rejects(correo.sendMail(mensaje), { codigo: 'RESEND_RESPUESTA_INVALIDA' });
    assert.equal(llamadas.length, 2);
});

test('Resend: alertas solo sobre 30, HTML original y destinatario fijo; inserciones simuladas', async t => {
    const llamadas = apiSimulada(t, () => Response.json({ id: 'alerta-simulada' }));
    const s = await servidor(t);
    for (const temperatura of [30, 31]) {
        const r = await s.post('/api/telemetria', { temperatura, humedad: 70, dispositivo_id: 'prueba', to: 'ajeno@example.invalid' });
        assert.equal(r.status, 200);
        assert.equal(r.body.mensaje, 'Datos guardados');
    }
    await tick();
    assert.equal(llamadas.length, 1);
    assert.equal(s.insertados.length, 2);
    assert.deepEqual(llamadas[0].payload.to, [env.EMAIL_USER]);
    assert.match(llamadas[0].payload.subject, /Temperatura Crítica en prueba/);
    assert.match(llamadas[0].payload.html, /31°C/);
    assert.ok(JSON.stringify(s.logs).includes('entrega aún no confirmada'));
});

test('Resend: error de alerta no convierte la telemetria guardada en fallo ni registra exito', async t => {
    apiSimulada(t, () => Response.json({ statusCode: 403, message: 'SECRETO_PROVEEDOR' }, { status: 403 }));
    const s = await servidor(t);
    const r = await s.post('/api/telemetria', { temperatura: 31 });
    await tick();
    assert.equal(r.status, 200);
    assert.equal(s.insertados.length, 1);
    assert.match(JSON.stringify(s.logs), /RESEND_RECHAZADO/);
    assert.ok(!JSON.stringify(s.logs).includes('Alerta aceptada'));
    assert.ok(!JSON.stringify(s.logs).includes('SECRETO_PROVEEDOR'));
});

test('Memoria local con EMAIL_PROVIDER=resend no llama Resend ni SMTP', async t => {
    const proveedorAnterior = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = 'resend';
    t.after(() => { if (proveedorAnterior === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = proveedorAnterior; });
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('RED_NO_PERMITIDA'); });
    const original = nodemailer.createTransport;
    t.mock.method(nodemailer, 'createTransport', options => {
        assert.equal(options.streamTransport, true);
        return original.call(nodemailer, options);
    });
    const nombreEvidencia = `prueba-memoria-${randomUUID()}.json`;
    const ruta = path.join(__dirname, '../evidencia', nombreEvidencia);
    t.after(() => fs.rm(ruta, { force: true }));
    const correo = crearCorreoPreparacion({ nombreEvidencia });
    const r = await correo.sendMail({ ...mensaje, from: env.EMAIL_FROM, to: env.EMAIL_USER });
    assert.equal(r.preparado, true);
    const metadata = JSON.parse(await fs.readFile(ruta, 'utf8'));
    assert.equal(metadata.enviosSMTP, 0);
    assert.ok(metadata.bytesMIME > 0);
    assert.equal(fetchMock.mock.calls.length, 0);
});

test('SMTP conserva proveedor explicito e implicito y descarta destinatarios adicionales', async t => {
    let recibido;
    t.mock.method(nodemailer, 'createTransport', () => ({ sendMail: async payload => {
        recibido = payload; return { accepted: ['cuenta@example.invalid'], rejected: [] };
    } }));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('NO_DEBE_USAR_RESEND'); });
    for (const proveedor of [undefined, 'smtp']) {
        const r = await crearCorreo({ EMAIL_PROVIDER: proveedor, EMAIL_USER: env.EMAIL_USER, EMAIL_PASS: 'ficticia' })
            .sendMail({ ...mensaje, cc: 'ajeno@example.invalid', bcc: 'ajeno@example.invalid', envelope: { to: 'ajeno@example.invalid' } });
        assert.equal(r.proveedor, 'smtp');
        assert.equal(r.entrega, 'no_confirmada');
        assert.deepEqual(recibido, { ...mensaje, from: env.EMAIL_USER, to: env.EMAIL_USER });
    }
    assert.equal(fetchMock.mock.calls.length, 0);
});
