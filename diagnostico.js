// Sin flags: inspeccion local. --models: API real. --smtp: autentica sin enviar.
// --send-test: envia UN mensaje exclusivamente a EMAIL_USER; no consulta Supabase.
const path = require('node:path');
const fs = require('node:fs');
require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
const nodemailer = require('nodemailer');
const { crearCorreo, registrarError, opcionesSMTP } = require('./integraciones');

async function main() {
    const flags = new Set(process.argv.slice(2));
    for (const flag of flags) {
        if (!['--models', '--smtp', '--smtp-network', '--send-test'].includes(flag)) throw new Error('Opcion desconocida');
    }
    console.log('Entorno', { plataforma: process.platform, node: process.version,
        manualPDF: fs.existsSync(path.join(__dirname, 'manual.pdf')),
        modelo: process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
        proveedorCorreo: ['smtp', 'resend'].includes((process.env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase()) ?
            (process.env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase() : 'invalido' });
    console.log('Configuracion (solo presencia)', Object.fromEntries(
        ['GEMINI_API_KEY', 'EMAIL_USER', 'EMAIL_PASS', 'SMTP_HOST', 'SMTP_PORT', 'RESEND_API_KEY', 'EMAIL_FROM'].map(
            key => [key, process.env[key]?.trim() ? 'configurada' : 'vacia / valor predeterminado si aplica'])));
    if (flags.has('--models')) {
        if (!process.env.GEMINI_API_KEY?.trim()) {
            console.log('OMITIDO: listado de modelos; falta GEMINI_API_KEY.');
        } else {
            try {
                const modelos = [];
                let pageToken;
                do {
                    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
                    if (pageToken) url.searchParams.set('pageToken', pageToken);
                    const response = await fetch(url, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, signal: AbortSignal.timeout(15000) });
                    if (!response.ok) throw Object.assign(new Error('Fallo del listado'), { status: response.status });
                    const data = await response.json();
                    modelos.push(...(data.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name));
                    pageToken = data.nextPageToken;
                } while (pageToken);
                console.log('Modelos con generateContent:', modelos);
                const configurado = `models/${process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite'}`;
                console.log('Modelo configurado presente:', modelos.includes(configurado));
            } catch (error) { registrarError(console, 'Listado Gemini', error); process.exitCode = 1; }
        }
    }
    if (flags.has('--smtp-network')) {
        for (const port of [465, 587]) {
            // Solo saludo SMTP y TLS: no autentica, no envia y no usa EMAIL_PASS.
            const options = opcionesSMTP({ SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: String(port) });
            delete options.auth;
            const transport = nodemailer.createTransport(options);
            try {
                await transport.verify();
                console.log('SMTP red:', { host: 'smtp.gmail.com', port, conexionTLS: 'correcta', autenticacion: 'no probada', envios: 0 });
            } catch (error) { registrarError(console, `SMTP red puerto ${port}`, error); process.exitCode = 1; }
            finally { transport.close(); }
        }
    }
    if (flags.has('--smtp')) {
        if (!process.env.EMAIL_USER?.trim() || !process.env.EMAIL_PASS?.trim()) {
            console.log('OMITIDO: SMTP; faltan EMAIL_USER y/o EMAIL_PASS.');
        } else {
            try {
                const correo = crearCorreo({ ...process.env, EMAIL_PROVIDER: 'smtp' });
                await correo.verify();
                console.log('SMTP: conexion y autenticacion correctas; no se envio correo.');
            } catch (error) { registrarError(console, 'Diagnostico SMTP', error); process.exitCode = 1; }
        }
    }
    if (flags.has('--send-test')) {
        try {
            await crearCorreo().sendMail({ subject: 'AgroValle: prueba controlada de correo', text: 'Unico mensaje de prueba del diagnostico AgroValle. No se escribieron datos en Supabase.' });
            console.log('Correo: un mensaje aceptado para el destinatario de reportes configurado; entrega no confirmada.');
        } catch (error) { registrarError(console, 'Diagnostico de correo', error); process.exitCode = 1; }
    }
}

main().catch(() => { console.error('No se pudo ejecutar el diagnostico. Opciones: --models --smtp --smtp-network --send-test'); process.exitCode = 1; });
