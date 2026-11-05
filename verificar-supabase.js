// Diagnostico de lectura. No imprime host del proyecto, claves ni registros.
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns/promises');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });

async function main() {
    const report = { fecha: new Date().toISOString(), consultas: [], escrituras: 0 };
    const url = new URL(process.env.SUPABASE_URL);
    report.urlHTTPS = url.protocol === 'https:';
    report.hostSupabase = url.hostname.endsWith('.supabase.co');
    try {
        const direcciones = await dns.lookup(url.hostname, { all: true });
        report.dns = { ok: true, familias: [...new Set(direcciones.map(d => d.family))] };
    } catch (error) { report.dns = { ok: false, codigo: error.code }; }
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        global: { fetch: async (input, options) => {
            try { return await fetch(input, { ...options, signal: AbortSignal.timeout(20000) }); }
            catch (error) {
                const conocidos = ['ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET',
                    'UND_ERR_CONNECT_TIMEOUT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED'];
                report.errorRed = { codigo: conocidos.includes(error.cause?.code) ? error.cause.code : 'OTRO',
                    timeout: ['TimeoutError', 'AbortError'].includes(error.name) };
                throw error;
            }
        } },
    });
    for (const limite of [20, 10]) {
        const start = Date.now();
        const { data, error, status } = await client.from('telemetria').select('*').order('id', { ascending: false }).limit(limite);
        report.consultas.push({ limite, status, ms: Date.now() - start, ok: !error, registros: data?.length ?? null,
            falloFetch: Boolean(error?.message?.includes('fetch failed')) });
        if (error) break;
    }
    fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'evidencia', 'supabase-windows.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('No se pudo completar el diagnostico Supabase.'); process.exitCode = 1; });
