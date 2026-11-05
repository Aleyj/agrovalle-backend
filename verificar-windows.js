// Navegador real via Chrome DevTools Protocol. No instala dependencias ni envia correo.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const dotenv = require('dotenv');
const assert = require('node:assert/strict');

async function main() {
    const env = dotenv.parse(await fs.readFile(path.join(__dirname, '.env')));
    const localDir = path.resolve(__dirname, '../.local');
    await fs.mkdir(localDir, { recursive: true });
    const perfil = await fs.mkdtemp(path.join(localDir, 'chrome-validacion-'));
    const backend = process.env.VALIDACION_BACKEND_URL || 'http://127.0.0.1:3000';
    const frontend = process.env.VALIDACION_FRONTEND_URL || 'http://127.0.0.1:5173';
    for (const direccion of [backend, frontend]) {
        const url = new URL(direccion);
        if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('VALIDACION_SOLO_LOCAL');
    }
    const report = { fecha: new Date().toISOString(), plataforma: process.platform,
        backend, frontend,
        modeloTemporal: 'gemini-3.5-flash-lite', solicitudesAPI: [], erroresNavegador: 0, dialogs: [], enviosSMTP: 0 };
    const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
        '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${perfil}`,
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        '--disable-extensions', '--window-size=1440,1100', 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    chrome.on('error', () => {});
    let ws;
    let cerrarNavegador;
    const pendientes = new Map();
    let siguiente = 0;
    try {
        let puerto;
        for (let i = 0; i < 100; i++) {
            try { puerto = (await fs.readFile(path.join(perfil, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
            catch { await delay(150); }
        }
        if (!puerto) throw new Error('CHROME_NO_INICIO');
        const pages = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
        const page = pages.find(item => item.type === 'page');
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('CDP_NO_CONECTA')); });
        const call = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++siguiente;
            pendientes.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
        cerrarNavegador = () => call('Browser.close');
        ws.onmessage = event => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const item = pendientes.get(message.id);
                pendientes.delete(message.id);
                if (message.error) item?.reject(new Error('CDP_COMANDO_FALLIDO'));
                else item?.resolve(message.result);
            } else if (message.method === 'Network.responseReceived') {
                const { response } = message.params;
                const url = new URL(response.url);
                if (url.pathname.startsWith('/api/')) report.solicitudesAPI.push({ origen: url.origin, ruta: url.pathname, status: response.status });
            } else if (message.method === 'Runtime.exceptionThrown') report.erroresNavegador++;
            else if (message.method === 'Page.javascriptDialogOpening') {
                // Los dialogos contienen solo mensajes publicos de la aplicacion.
                const texto = message.params.message;
                report.dialogs.push(texto.includes('fetch failed') ? 'Consulta Supabase: fetch failed (detalle omitido)' :
                    texto === 'Reporte preparado para revisión; no se envió correo' ? texto : 'La interfaz mostro un error (detalle omitido)');
                void call('Page.handleJavaScriptDialog', { accept: true });
            }
        };
        const evaluate = async expression => {
            const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
            if (result.exceptionDetails) throw new Error('EVALUACION_NAVEGADOR_FALLIDA');
            return result.result.value;
        };
        const esperar = async (expression, timeout = 15000) => {
            const inicio = Date.now();
            while (Date.now() - inicio < timeout) {
                if (await evaluate(expression)) return;
                await delay(200);
            }
            throw new Error('ESPERA_INTERFAZ_AGOTADA');
        };
        await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
        await call('Page.navigate', { url: report.frontend });
        await esperar(`Boolean(document.querySelector('input[placeholder="Usuario"]'))`);
        for (const [selector, value] of [['input[placeholder="Usuario"]', env.ADMIN_USER], ['input[type="password"]', env.ADMIN_PASS]]) {
            if (!value) throw new Error('CREDENCIALES_LOGIN_AUSENTES');
            await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
            await call('Input.insertText', { text: value });
        }
        await evaluate(`document.querySelector('button[type="submit"]').click()`);
        await esperar(`document.body.innerText.includes('Panel AgroValle')`);
        report.loginUI = true;
        const respuestaHistorial = await fetch(report.backend + '/api/historial', { signal: AbortSignal.timeout(30000) });
        const historial = await respuestaHistorial.json();
        report.supabase = { status: respuestaHistorial.status, registrosRecuperados: Array.isArray(historial) ? historial.length : null,
            columnasEsperadas: Array.isArray(historial) && historial.every(item => ['id','temperatura','humedad','fecha_hora'].every(key => key in item)),
            falloFetch: typeof historial.error === 'string' && historial.error.includes('fetch failed') };
        if (respuestaHistorial.status === 200) await esperar(`document.querySelectorAll('.tarjeta').length === ${historial.length}`, 30000);
        report.tarjetasUI = await evaluate(`document.querySelectorAll('.tarjeta').length`);
        report.consultas = [];
        for (const pregunta of ['Hola, responde brevemente.', '¿Cuál es el rango óptimo de humedad según el manual?']) {
            const anteriores = await evaluate(`document.querySelectorAll('.mensajes span').length`);
            await evaluate(`document.querySelector('input[placeholder="Pregunta sobre los parámetros del cultivo..."]').focus()`);
            await call('Input.insertText', { text: pregunta });
            await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Enviar').click()`);
            await esperar(`document.querySelectorAll('.mensajes span').length === ${anteriores + 2}`, 35000);
            const respuesta = await evaluate(`Array.from(document.querySelectorAll('.mensajes span')).at(-1).innerText`);
            report.consultas.push({ pregunta, respuesta });
        }
        await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Enviar Reporte')).click()`);
        const inicioReporte = Date.now();
        while (!report.dialogs.length && Date.now() - inicioReporte < 35000) await delay(200);
        report.reporteUI = report.dialogs.some(text => text.includes('no se envió correo'));
        assert.ok(report.solicitudesAPI.every(item => item.origen === report.backend), 'API_NO_LOCAL');
        report.reactConectadoAPILocal = true;
        await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
        const captura = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        await fs.writeFile(path.join(localDir, 'validacion-windows.png'), Buffer.from(captura.data, 'base64'));
        report.captura = '.local/validacion-windows.png';
        report.ok = report.supabase.status === 200 && report.reporteUI;
        if (!report.ok) { report.error = 'SUPABASE_O_REPORTE_PENDIENTE'; process.exitCode = 1; }
    } catch (error) {
        // Solo mensajes internos controlados; nunca volcar parametros CDP, headers o tokens.
        const codigos = ['CHROME_NO_INICIO', 'CDP_NO_CONECTA', 'CDP_COMANDO_FALLIDO', 'EVALUACION_NAVEGADOR_FALLIDA',
            'ESPERA_INTERFAZ_AGOTADA', 'CREDENCIALES_LOGIN_AUSENTES', 'HISTORIAL_NO_DISPONIBLE', 'REPORTE_NO_PREPARADO', 'API_NO_LOCAL'];
        report.ok = false;
        report.error = codigos.includes(error.message) ? error.message : 'VALIDACION_FALLIDA';
        process.exitCode = 1;
    } finally {
        if (cerrarNavegador) await Promise.race([cerrarNavegador().catch(() => {}), delay(1500)]);
        ws?.close(); chrome.kill();
        // Solo se elimina el perfil temporal creado por esta ejecucion.
        const perfilResuelto = path.resolve(perfil);
        if (path.dirname(perfilResuelto) === localDir && path.basename(perfilResuelto).startsWith('chrome-validacion-')) {
            await fs.rm(perfilResuelto, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
        }
        await fs.mkdir(path.join(__dirname, 'evidencia'), { recursive: true });
        await fs.writeFile(path.join(__dirname, 'evidencia', 'validacion-windows.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report, null, 2));
    }
}
main().catch(() => { console.error('No se pudo iniciar la validacion Windows.'); process.exitCode = 1; });
