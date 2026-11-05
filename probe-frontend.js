const fs = require('node:fs');
const path = require('node:path');

async function main() {
    const base = 'https://agrovalle-frontend.vercel.app';
    const r = await fetch(base, { signal: AbortSignal.timeout(20000) });
    const html = await r.text();
    const srcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
    const assets = [];
    for (const src of srcs) {
        const url = new URL(src, base);
        if (url.origin !== base) continue;
        const asset = await fetch(url, { signal: AbortSignal.timeout(20000) });
        const js = await asset.text();
        assets.push({ path: url.pathname, status: asset.status,
            apuntaARender: js.includes('https://agrovalle-backend-api.onrender.com'),
            tieneChatbot: js.includes('/api/chatbot'), tieneReporte: js.includes('/api/reporte') });
    }
    const report = { fecha: new Date().toISOString(), base, status: r.status, assets };
    fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'evidencia', 'vercel.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(JSON.stringify({ error: error.name, code: error.cause?.code })); process.exitCode = 1; });
