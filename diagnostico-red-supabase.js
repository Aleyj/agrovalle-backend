// Solo DNS, TCP, TLS y HTTPS sin credenciales. No cambia proxy, DNS ni certificados.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const net = require('node:net');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const host = new URL(process.env.SUPABASE_URL).hostname;
const errorCode = e => e?.code || e?.cause?.code || e?.name || 'ERROR';

function conexion(tipo, options) {
    return new Promise(resolve => {
        const start = Date.now();
        let finished = false;
        const done = result => { if (!finished) { finished = true; socket.destroy(); resolve({ ...result, ms: Date.now() - start }); } };
        const socket = tipo === 'tcp' ? net.connect({ host, port: 443, ...options }) : tls.connect({ host, port: 443, servername: host, rejectUnauthorized: true, ...options });
        socket.setTimeout(8000, () => done({ ok: false, codigo: 'TIMEOUT' }));
        socket.once('error', error => done({ ok: false, codigo: errorCode(error) }));
        socket.once(tipo === 'tcp' ? 'connect' : 'secureConnect', () => done({ ok: true,
            ...(tipo === 'tls' ? { autorizado: socket.authorized, protocolo: socket.getProtocol(),
                emisor: socket.getPeerCertificate()?.issuer?.O, expiracion: socket.getPeerCertificate()?.valid_to } : {}),
        }));
    });
}

async function main() {
    const r = { fecha: new Date().toISOString(), node: process.version, credencialesEnviadas: false, validacionSSL: true };
    r.proxy = Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'].map(key => {
        try { const url = new URL(process.env[key]); return [key, { presente: true, protocolo: url.protocol, puerto: url.port,
            loopback: ['127.0.0.1','localhost','[::1]'].includes(url.hostname), autenticado: Boolean(url.username || url.password) }]; }
        catch { return [key, { presente: false }]; }
    }));
    r.proxy.noProxyCoincideProyecto = (process.env.NO_PROXY || '').split(',').some(x => x.trim() === '*' || x.trim() === host || x.trim() === '.supabase.co');
    r.ca = { adicionalesConfiguradas: Boolean(process.env.NODE_EXTRA_CA_CERTS), validacionDesactivada: process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0',
        raicesNode: tls.getCACertificates('bundled').length, raicesSistema: tls.getCACertificates('system').length };
    r.dns = {};
    for (const [name, fn] of [['lookup', () => dns.lookup(host, { all: true })], ['A', () => dns.resolve4(host)], ['AAAA', () => dns.resolve6(host)]]) {
        try { r.dns[name] = { ok: true, registros: await fn() }; }
        catch (error) { r.dns[name] = { ok: false, codigo: errorCode(error) }; }
    }
    const hostsFile = fs.readFileSync(path.join(process.env.SystemRoot, 'System32/drivers/etc/hosts'), 'utf8');
    r.hostsEntradaProyecto = hostsFile.split(/\r?\n/).some(line => !line.trim().startsWith('#') && line.includes(host));
    r.tcpIPv4 = await conexion('tcp', { family: 4 });
    r.tlsIPv4 = await conexion('tls', { family: 4 });
    r.tls12IPv4 = await conexion('tls', { family: 4, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    r.tlsIPv6 = r.dns.AAAA.ok ? await conexion('tls', { family: 6 }) : { omitida: 'Sin registro AAAA' };
    r.curl = [];
    for (const [modo, args] of [['entorno', []], ['directo-ipv4', ['--noproxy','*','--ipv4']]]) {
        const result = spawnSync('curl.exe', ['--silent','--head','--output','NUL','--max-time','12',
            '--write-out','%{http_code} %{http_connect} %{ssl_verify_result}', ...args, `https://${host}/rest/v1/`], { encoding: 'utf8', windowsHide: true });
        r.curl.push({ modo, exitCode: result.status, metricas: result.stdout?.trim(), errorProceso: result.error?.code });
    }
    r.httpsNode = [];
    const code = `fetch(process.env.SUPABASE_URL+'/rest/v1/',{signal:AbortSignal.timeout(12000)}).then(r=>console.log(JSON.stringify({status:r.status}))).catch(e=>console.log(JSON.stringify({codigo:e.cause?.code||e.name})))`;
    for (const flags of [[], ['--use-system-ca'], ['--use-env-proxy']]) {
        const result = spawnSync(process.execPath, [...flags, '-e', code], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
        let respuesta;
        try { respuesta = JSON.parse(result.stdout.trim()); } catch { respuesta = { codigo: result.error?.code || 'SIN_RESULTADO' }; }
        r.httpsNode.push({ modo: flags.join(' ') || 'predeterminado', ...respuesta });
    }
    r.controlHTTPS = [];
    for (const url of ['https://supabase.com', 'https://generativelanguage.googleapis.com']) {
        try { const response = await fetch(url, { signal: AbortSignal.timeout(12000) }); r.controlHTTPS.push({ destino: url, status: response.status }); }
        catch (error) { r.controlHTTPS.push({ destino: url, codigo: errorCode(error.cause || error) }); }
    }
    fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'evidencia', 'red-supabase-windows.json'), JSON.stringify(r, null, 2));
    console.log(JSON.stringify(r, null, 2));
}
main().catch(() => { console.error('Diagnostico de red incompleto; no se imprimen detalles sensibles.'); process.exitCode = 1; });
