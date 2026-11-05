// Solo consulta AgroBot y CORS. No escribe telemetria ni envia correos.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

async function probe(base) {
    const results = [];
    for (const pregunta of ['Hola, responde brevemente.', '¿Cuál es el rango óptimo de humedad según el manual?']) {
        const start = Date.now();
        try {
            const response = await fetch(`${base}/api/chatbot`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://agrovalle-frontend.vercel.app' },
                body: JSON.stringify({ pregunta }), signal: AbortSignal.timeout(45000),
            });
            const body = await response.text();
            // Solo el contrato publico conocido; nunca errores crudos de SDK o paginas HTML.
            let publicBody;
            try {
                const data = JSON.parse(body);
                publicBody = { ok: data.ok, respuesta: data.respuesta, error: data.error, codigo: data.codigo };
            } catch { publicBody = { formato: response.headers.get('content-type'), bytes: body.length }; }
            results.push({ base, pregunta, status: response.status, ms: Date.now() - start,
                cors: response.headers.get('access-control-allow-origin'), body: publicBody });
        } catch (error) {
            results.push({ base, pregunta, ms: Date.now() - start, error: error.name, code: error.cause?.code });
        }
    }
    try {
        const response = await fetch(`${base}/api/chatbot`, { method: 'OPTIONS', headers: {
            Origin: 'https://agrovalle-frontend.vercel.app', 'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        }, signal: AbortSignal.timeout(45000) });
        results.push({ base, metodo: 'OPTIONS', status: response.status,
            origen: response.headers.get('access-control-allow-origin'),
            metodos: response.headers.get('access-control-allow-methods'),
            headers: response.headers.get('access-control-allow-headers') });
    } catch (error) { results.push({ base, metodo: 'OPTIONS', error: error.name, code: error.cause?.code }); }
    return results;
}

async function main() {
    const local = process.argv.includes('--local');
    const modelo = process.argv.find(arg => arg.startsWith('--model='))?.slice('--model='.length);
    if (modelo && (!local || !/^[a-z0-9.-]+$/.test(modelo))) throw new Error('Modelo de prueba invalido');
    let child;
    try {
        if (local) {
            child = spawn(process.execPath, ['index.js'], { cwd: __dirname,
                env: { ...process.env, PORT: '43127', ...(modelo ? { GEMINI_MODEL: modelo } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
            // Consumir logs sin imprimirlos: el codigo original registra errores completos.
            child.stdout.resume(); child.stderr.resume();
            let ready = false;
            for (let i = 0; i < 40; i++) {
                if (child.exitCode !== null) throw new Error('El backend termino antes de iniciar');
                try { await fetch('http://127.0.0.1:43127', { signal: AbortSignal.timeout(500) }); ready = true; break; }
                catch { await delay(250); }
            }
            if (!ready) throw new Error('El backend no inicio en 10 segundos');
        }
        const base = local ? 'http://127.0.0.1:43127' : 'https://agrovalle-backend-api.onrender.com';
        const results = await probe(base);
        const report = { fecha: new Date().toISOString(), entorno: process.platform, node: process.version,
            ...(modelo ? { modeloPrueba: modelo } : {}), results };
        if (process.argv.includes('--save')) {
            const name = process.argv.includes('--after') ? 'despues' : 'antes';
            fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
            fs.writeFileSync(path.join(__dirname, 'evidencia', `${local ? 'local' : 'render'}-${name}${modelo ? '-' + modelo : ''}.json`), JSON.stringify(report, null, 2));
        }
        console.log(JSON.stringify(report, null, 2));
    } finally { child?.kill(); }
}
main().catch(error => { console.error(error.name); process.exitCode = 1; });
