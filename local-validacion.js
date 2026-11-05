// Arranque exclusivamente local: Supabase en lectura y correo preparado en memoria.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const nodemailer = require('nodemailer');
const { crearApp } = require('./index');

const modelo = 'gemini-3.5-flash-lite';
function crearCorreoPreparacion(opciones = {}) {
const transporteMemoria = nodemailer.createTransport({ streamTransport: true, buffer: true });
return {
    async sendMail(mensaje) {
        const resultado = await transporteMemoria.sendMail(mensaje);
        const metadata = {
            fecha: new Date().toISOString(),
            modo: 'preparacion-en-memoria', enviosSMTP: 0,
            fuente: opciones.fuente || 'consulta directa Supabase',
            destinatario: 'REPORT_EMAIL_TO (o EMAIL_USER de compatibilidad; direccion omitida)',
            asunto: mensaje.subject,
            lecturas: Math.max(0, (mensaje.html.match(/<tr>/g) || []).length - 1),
            bytesMIME: resultado.message.length,
            contieneTabla: mensaje.html.includes('<table'),
            contieneTemperaturaHumedadFecha: ['Temperatura', 'Humedad', 'Fecha'].every(texto => mensaje.html.includes(texto)),
        };
        fs.mkdirSync(path.join(__dirname, 'evidencia'), { recursive: true });
        fs.writeFileSync(path.join(__dirname, 'evidencia', opciones.nombreEvidencia || 'reporte-preparado-windows.json'), JSON.stringify(metadata, null, 2));
        return { preparado: true };
    },
};
}

function crearAppValidacion() {
const app = express();
// En este arranque no se permite ninguna ruta que escriba lecturas.
app.use((req, res, next) => {
    const lectura = req.method === 'GET' && req.path === '/api/historial';
    const preflight = req.method === 'OPTIONS';
    const prueba = req.method === 'POST' && ['/api/login', '/api/chatbot', '/api/reporte', '/api/webhooks/supabase/telemetria'].includes(req.path);
    if (!lectura && !preflight && !prueba) return res.status(405).json({ ok: false, error: 'Ruta deshabilitada en la validación local.' });
    next();
});
app.use(crearApp({ env: { ...process.env, GEMINI_MODEL: modelo }, correo: crearCorreoPreparacion() }));
return app;
}
if (require.main === module) {
    const port = Number(process.env.LOCAL_VALIDACION_PORT || 3000);
    crearAppValidacion().listen(port, '127.0.0.1', () => console.log(`Validación local: http://127.0.0.1:${port}; modelo gemini-3.5-flash-lite; correo en memoria; telemetría bloqueada.`));
}
module.exports = { crearCorreoPreparacion, crearAppValidacion };
