const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { setImmediate: tick } = require('node:timers/promises');
const nodemailer = require('nodemailer');
const { GoogleGenerativeAIAbortError } = require('@google/generative-ai');
const { crearApp } = require('../index');
const { cargarContexto, CONTEXTO_ALTERNATIVO, crearGenerador, crearCorreo, opcionesSMTP, registrarError, errorChat } = require('../integraciones');

test('El timeout real del SDK conserva name Error y debe clasificarse como 504', () => {
    const error = new GoogleGenerativeAIAbortError('mensaje ficticio del proveedor');
    assert.equal(error.name, 'Error');
    assert.equal(errorChat(error).status, 504);
    assert.equal(errorChat(error).codigo, 'GEMINI_TIMEOUT');
});

const env = { EMAIL_USER: 'prueba@example.invalid', EMAIL_PASS: 'clave-ficticia', GEMINI_API_KEY: '' };
const silent = { warn() {}, error() {}, info() {} };

async function servidor(t, opciones = {}) {
    const enviados = [], insertados = [], logs = [];
    const supabase = { from(tabla) {
        assert.equal(tabla, 'telemetria');
        return {
            insert: async datos => { insertados.push(...datos); return { error: null }; },
            select: () => ({ order: () => ({ limit: async n => {
                assert.equal(n, 10);
                return { data: [{ temperatura: 27, humedad: 65, fecha_hora: '2026-11-04T12:00:00Z' }], error: null };
            } }) }),
        };
    } };
    const app = crearApp({ env, supabase, correo: { async sendMail(mensaje) { enviados.push(mensaje); } },
        cargarContexto: async () => ({ texto: CONTEXTO_ALTERNATIVO, fuente: 'alternativo' }),
        logger: { warn: (...v) => logs.push(v), info: (...v) => logs.push(v), error: (...v) => logs.push(v) }, ...opciones });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function post(ruta, body) {
        const response = await fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    return { base, post, enviados, insertados, logs };
}

test('HTTP: preguntas invalidas no invocan Gemini; CORS permite el origen de Vercel', async t => {
    let llamadas = 0;
    const s = await servidor(t, { generarRespuesta: async () => { llamadas++; } });
    for (const pregunta of [undefined, '', '   ', 123, 'x'.repeat(4001)]) {
        const r = await s.post('/api/chatbot', { pregunta });
        assert.equal(r.status, 400);
    }
    assert.equal(llamadas, 0);
    const r = await fetch(s.base + '/api/chatbot', { method: 'OPTIONS', headers: {
        Origin: 'https://agrovalle-frontend.vercel.app', 'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
    } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.equal(r.headers.get('access-control-allow-headers'), 'content-type');
});

test('HTTP: falta de clave produce 503 explicito, sin llamadas externas', async t => {
    const s = await servidor(t);
    const r = await s.post('/api/chatbot', { pregunta: 'Hola' });
    assert.equal(r.status, 503);
    assert.equal(r.body.codigo, 'GEMINI_NO_CONFIGURADO');
});

test('HTTP: contexto alternativo llega al generador y se conserva el contrato de respuesta', async t => {
    const s = await servidor(t, { generarRespuesta: async (pregunta, contexto) => {
        assert.equal(pregunta, 'Humedad óptima');
        assert.match(contexto.texto, /60% a 80%/);
        return 'Entre 60% y 80%.';
    } });
    const r = await s.post('/api/chatbot', { pregunta: ' Humedad óptima ' });
    assert.deepEqual(r, { status: 200, body: { ok: true, respuesta: 'Entre 60% y 80%.' } });
});

test('HTTP: errores de Gemini se clasifican sin exponer mensajes del proveedor', async t => {
    for (const [error, status, codigo] of [
        [{ status: 403 }, 502, 'GEMINI_RECHAZADO'], [{ status: 404 }, 502, 'GEMINI_RECHAZADO'],
        [{ status: 429 }, 503, 'GEMINI_CUOTA'], [{ name: 'GoogleGenerativeAIAbortError' }, 504, 'GEMINI_TIMEOUT'],
        [{}, 502, 'GEMINI_ERROR'],
    ]) {
        const s = await servidor(t, { generarRespuesta: async () => { throw Object.assign(new Error('SECRETO_FICTICIO'), error); } });
        const r = await s.post('/api/chatbot', { pregunta: 'Hola' });
        assert.equal(r.status, status);
        assert.equal(r.body.codigo, codigo);
        assert.ok(!JSON.stringify([r, s.logs]).includes('SECRETO_FICTICIO'));
    }
});

// Documento PDF minimo sintetico con offsets reales: prueba el parser instalado, sin mocks.
function pdfTexto(texto) {
    const stream = `BT /F1 12 Tf 50 750 Td (${texto}) Tj ET`;
    const objetos = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
    let contenido = '%PDF-1.4\n';
    const offsets = [0];
    objetos.forEach((objeto, i) => { offsets.push(Buffer.byteLength(contenido)); contenido += `${i + 1} 0 obj\n${objeto}\nendobj\n`; });
    const xref = Buffer.byteLength(contenido);
    contenido += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(contenido);
}

test('PDF real: texto extraido con v2; ausente, corrupto o sin texto usan alternativa', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agrovalle-pdf-'));
    t.after(async () => {
        const resolved = path.resolve(dir);
        if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('agrovalle-pdf-')) {
            throw new Error('Directorio temporal fuera del destino esperado');
        }
        await fs.rm(resolved, { recursive: true, force: true });
    });
    const ruta = path.join(dir, 'manual.pdf');
    assert.equal((await cargarContexto(ruta, silent)).texto, CONTEXTO_ALTERNATIVO);
    await fs.writeFile(ruta, 'corrupto');
    assert.equal((await cargarContexto(ruta, silent)).fuente, 'alternativo');
    await fs.writeFile(ruta, pdfTexto(''));
    assert.equal((await cargarContexto(ruta, silent)).fuente, 'alternativo');
    await fs.writeFile(ruta, pdfTexto('Humedad entre 60 y 80 por ciento'));
    const resultado = await cargarContexto(ruta, silent);
    assert.equal(resultado.fuente, 'manual.pdf');
    assert.match(resultado.texto, /Humedad entre 60 y 80/);
});

test('SDK instalado: solicitud y response.text compatibles; respuesta vacia es error', async t => {
    const generar = crearGenerador({ GEMINI_API_KEY: 'ficticia', GEMINI_MODEL: 'modelo-prueba' });
    let modeloEsperado = 'modelo-prueba';
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
        assert.ok(String(url).includes(`models/${modeloEsperado}:generateContent`));
        assert.match(options.body, /60% a 80%/);
        return Response.json({ candidates: [{ content: { parts: [{ text: 'Respuesta simulada' }], role: 'model' }, finishReason: 'STOP' }] });
    });
    assert.equal(await generar('Humedad', { texto: CONTEXTO_ALTERNATIVO }), 'Respuesta simulada');
    modeloEsperado = 'gemini-3.5-flash-lite';
    assert.equal(await crearGenerador({ GEMINI_API_KEY: 'ficticia' })('Humedad', { texto: CONTEXTO_ALTERNATIVO }), 'Respuesta simulada');
    fetchMock.mock.mockImplementation(async () => Response.json({ candidates: [] }));
    await assert.rejects(generar('Hola', { texto: '' }), { codigo: 'GEMINI_RESPUESTA_VACIA' });
});

test('Reporte HTTP: 10 lecturas como maximo, destinatario fijo y MIME generado localmente', async t => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    let mime;
    const s = await servidor(t, { correo: { async sendMail(mensaje) {
        assert.equal(mensaje.to, env.EMAIL_USER);
        assert.match(mensaje.html, /27°C/);
        assert.match(mensaje.html, /65%/);
        mime = (await transport.sendMail(mensaje)).message.toString();
    } } });
    const r = await s.post('/api/reporte', { to: 'no-autorizado@example.invalid' });
    assert.equal(r.status, 200);
    assert.match(mime, /To: prueba@example.invalid/);
    assert.ok(!mime.includes('no-autorizado'));
    assert.equal(s.insertados.length, 0);
});

test('Reporte HTTP: fallo SMTP se devuelve como error y no se registra exito', async t => {
    const s = await servidor(t, { correo: { async sendMail() {
        throw Object.assign(new Error('SECRETO_FICTICIO'), { code: 'EAUTH', responseCode: 535 });
    } } });
    assert.equal((await s.post('/api/reporte', {})).status, 502);
    assert.ok(JSON.stringify(s.logs).includes('EAUTH'));
    assert.ok(!JSON.stringify(s.logs).includes('SECRETO_FICTICIO'));
});

test('Reporte HTTP preparado en memoria no anuncia envio SMTP', async t => {
    const s = await servidor(t, { correo: { async sendMail() { return { preparado: true }; } } });
    const r = await s.post('/api/reporte', {});
    assert.equal(r.status, 200);
    assert.equal(r.body.preparado, true);
    assert.match(r.body.mensaje, /no se envió correo/);
    assert.equal(s.insertados.length, 0);
});

test('Reporte HTTP: credenciales ausentes producen 503 sin conectar SMTP', async t => {
    const s = await servidor(t, { correo: crearCorreo({}) });
    const r = await s.post('/api/reporte', {});
    assert.equal(r.status, 503);
    assert.equal(r.body.codigo, 'SMTP_NO_CONFIGURADO');
});

test('Alerta HTTP: 30 no envia, 31 envia una vez; Supabase es simulado', async t => {
    const s = await servidor(t);
    for (const temperatura of [30, 31]) {
        assert.equal((await s.post('/api/telemetria', { dispositivo_id: 'prueba', temperatura, humedad: 70, bomba_encendida: false })).status, 200);
    }
    await tick();
    assert.equal(s.enviados.length, 1);
    assert.equal(s.enviados[0].to, env.EMAIL_USER);
    assert.match(s.enviados[0].html, /31°C/);
    assert.equal(s.insertados.length, 2);
    assert.ok(JSON.stringify(s.logs).includes('Alerta aceptada'));
});

test('Alerta HTTP: fallo SMTP conserva telemetria y registra fallo sin anunciar exito', async t => {
    const s = await servidor(t, { correo: { async sendMail() { throw Object.assign(new Error('clave secreta'), { code: 'ETIMEDOUT' }); } } });
    assert.equal((await s.post('/api/telemetria', { temperatura: 31 })).status, 200);
    await tick();
    assert.equal(s.insertados.length, 1);
    assert.match(JSON.stringify(s.logs), /ETIMEDOUT/);
    assert.ok(!JSON.stringify(s.logs).includes('Alerta aceptada'));
    assert.ok(!JSON.stringify(s.logs).includes('clave secreta'));
});

test('SMTP: TLS para 465, STARTTLS para 587, y nunca se cambia destinatario por entrada externa', async t => {
    assert.equal(opcionesSMTP({}).secure, true);
    assert.deepEqual([opcionesSMTP({ SMTP_PORT: '587' }).secure, opcionesSMTP({ SMTP_PORT: '587' }).requireTLS], [false, true]);
    assert.throws(() => opcionesSMTP({ SMTP_PORT: 'invalido' }), { codigo: 'SMTP_NO_CONFIGURADO' });
    let mensaje;
    const transporte = { verify: async () => true, sendMail: async m => { mensaje = m; return { accepted: ['prueba@example.invalid'], rejected: [] }; } };
    t.mock.method(nodemailer, 'createTransport', () => transporte);
    const correo = crearCorreo(env);
    assert.equal(await correo.verify(), true);
    await correo.sendMail({ to: 'otro@example.invalid', from: 'otro@example.invalid', text: 'prueba' });
    assert.equal(mensaje.to, env.EMAIL_USER);
    assert.equal(mensaje.from, env.EMAIL_USER);
    transporte.sendMail = async () => ({ accepted: [], rejected: [env.EMAIL_USER] });
    await assert.rejects(correo.sendMail({ text: 'prueba' }), { codigo: 'CORREO_NO_ACEPTADO' });
    const logs = [];
    registrarError({ error: (...args) => logs.push(args) }, 'SMTP', { code: 'secreto', message: 'secreto', response: 'secreto' });
    assert.ok(!JSON.stringify(logs).includes('secreto'));
});
