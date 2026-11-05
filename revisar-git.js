// Audita archivos versionables y staged sin imprimir valores sensibles ni cambiar Git.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dotenv = require('dotenv');

const env = dotenv.parse(fs.readFileSync(path.join(__dirname, '.env')));
const keys = ['SUPABASE_KEY', 'GEMINI_API_KEY', 'RESEND_API_KEY', 'SUPABASE_WEBHOOK_SECRET', 'EMAIL_PASS', 'EMAIL_USER', 'ALERT_EMAIL_TO', 'REPORT_EMAIL_TO', 'ADMIN_PASS', 'JWT_SECRET'];
const coincidencias = [];
function revisar(contenido, repo, archivo, version) {
    for (const key of keys) {
        const valor = env[key];
        if (!valor) continue;
        const escaped = valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = valor.length >= 8 ? contenido.includes(valor) : new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(contenido);
        if (match) coincidencias.push({ repo, archivo, version, campo: key });
    }
    if (/AIza[A-Za-z0-9_-]{30,}|sb_secret_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(contenido)) {
        coincidencias.push({ repo, archivo, version, campo: 'patron de secreto' });
    }
}
const repos = [];
for (const [nombre, dir] of [['backend', __dirname], ['frontend', path.resolve(__dirname, '../frontend')]]) {
    const git = args => execFileSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true }).trim();
    const archivos = git(['ls-files', '--cached', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
    const staged = git(['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
    for (const archivo of archivos) {
        const ruta = path.join(dir, archivo);
        if (fs.existsSync(ruta) && fs.statSync(ruta).isFile()) revisar(fs.readFileSync(ruta, 'utf8'), nombre, archivo, 'working tree');
    }
    for (const archivo of staged) revisar(git(['show', `:${archivo}`]), nombre, archivo, 'staged');
    repos.push({ nombre, archivosRevisados: archivos.length, staged,
        pendientes: git(['status', '--short']).split(/\r?\n/).filter(Boolean),
        envIgnorado: git(['check-ignore', nombre === 'backend' ? '.env' : 'frontend-react/.env.local']),
    });
}
const report = { fecha: new Date().toISOString(), repos, coincidenciasSensibles: coincidencias,
    notas: 'Comparacion con valores locales y patrones comunes; no constituye una auditoria del historial completo de commits.' };
fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'evidencia', 'revision-git.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exitCode = coincidencias.length ? 1 : 0;
