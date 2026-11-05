const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const path = require("path");
const { temperaturaAlta, construirAlerta, modoAlertas, autenticarWebhook, evaluarEventoAlerta } = require('./alertas');
const { cargarContexto, crearGenerador, errorChat, crearCorreo, registrarError, errorCorreo } = require('./integraciones');
require("dotenv").config({ path: path.join(__dirname, '.env'), quiet: true });

function crearApp(opciones = {}) {
    const env = opciones.env || process.env;
    const logger = opciones.logger || console;
    const app = express();
    app.use(cors());
    app.use(express.json());

    const supabase = opciones.supabase || createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    const transporter = opciones.correo || crearCorreo(env);
    const correoAlertas = opciones.correoAlertas || opciones.correo || crearCorreo(env, 'alerta');
    const generarRespuesta = opciones.generarRespuesta || crearGenerador(env);
    const obtenerContexto = opciones.cargarContexto || (() => cargarContexto(undefined, logger));

    app.post("/api/login", (req, res) => {
        const { usuario, password } = req.body;
        if (usuario === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
            const token = jwt.sign({ usuario }, process.env.JWT_SECRET, { expiresIn: '2h' });
            res.json({ ok: true, token });
        } else {
            res.status(401).json({ ok: false, mensaje: "Credenciales incorrectas" });
        }
    });

    app.post("/api/reporte", async (req, res) => {
        try {
            const { data, error } = await supabase.from('telemetria').select('*').order('id', { ascending: false }).limit(10);
            if (error) return res.status(500).json({ ok: false, error: error.message });

            const filasHtml = data.map(lec => `<tr><td>${lec.temperatura}°C</td><td>${lec.humedad}%</td><td>${new Date(lec.fecha_hora).toLocaleString()}</td></tr>`).join('');
            const mailOptions = {
                from: env.EMAIL_USER,
                to: env.REPORT_EMAIL_TO ?? env.EMAIL_USER,
                subject: "📊 Reporte de Estado - AgroValle",
                html: `<h2>Reporte de Sensores</h2><table border="1" cellpadding="5"><tr><th>Temperatura</th><th>Humedad</th><th>Fecha</th></tr>${filasHtml}</table>`
            };
            const resultadoCorreo = await transporter.sendMail(mailOptions);
            res.json({ ok: true,
                ...(resultadoCorreo?.preparado ? { preparado: true } : {}),
                ...(resultadoCorreo?.estado === 'aceptado' ? { correo: {
                    proveedor: resultadoCorreo.proveedor, estado: 'aceptado', entrega: 'no_confirmada',
                    ...(resultadoCorreo.proveedor === 'resend' ? { messageId: resultadoCorreo.messageId } : {}),
                } } : {}),
                mensaje: resultadoCorreo?.preparado ? 'Reporte preparado para revisión; no se envió correo' :
                    resultadoCorreo?.proveedor === 'resend' ? 'Reporte aceptado por Resend; entrega aún no confirmada' : 'Reporte aceptado por el servidor de correo',
            });
        } catch (error) {
            registrarError(logger, 'Reporte: fallo de correo o consulta', error);
            const resultado = errorCorreo(error);
            res.status(resultado.status).json({ ok: false, codigo: resultado.codigo, error: resultado.error });
        }
    });

    app.post("/api/telemetria", async (req, res) => {
        const { dispositivo_id, humedad, temperatura, bomba_encendida } = req.body;
        const { error } = await supabase.from('telemetria').insert([{ dispositivo_id, humedad, temperatura, bomba_encendida }]);
        if (error) return res.status(500).json({ ok: false, error: error.message });

        // El INSERT y su respuesta permanecen iguales. Solo una fuente envia alertas.
        try {
            if (modoAlertas(env) === 'express' && temperaturaAlta(req.body)) {
                const mailOptions = { ...construirAlerta(req.body), from: env.EMAIL_USER, to: env.ALERT_EMAIL_TO };
                void Promise.resolve().then(() => correoAlertas.sendMail(mailOptions))
                    .then(resultado => logger.info(resultado?.preparado ? 'Alerta preparada; no se envió correo' :
                        resultado?.proveedor === 'resend' ? 'Alerta aceptada por Resend; entrega aún no confirmada' : 'Alerta aceptada por el servidor de correo'))
                    .catch(error => registrarError(logger, 'Alerta: fallo de correo', error));
            }
        } catch (error) { registrarError(logger, 'Alerta: configuracion invalida', error); }
        res.json({ ok: true, mensaje: "Datos guardados" });
    });

    // Receptor de INSERT/UPDATE de Supabase. Nunca inserta ni actualiza telemetria.
    app.post('/api/webhooks/supabase/telemetria', async (req, res) => {
        const acceso = autenticarWebhook(req, env);
        if (acceso) return res.status(acceso.status).json({ ok: false, codigo: acceso.codigo });
        try {
            if (modoAlertas(env) !== 'webhook') return res.status(409).json({ ok: false, codigo: 'WEBHOOK_DESACTIVADO' });
            const evento = req.body;
            if (!['INSERT', 'UPDATE'].includes(evento?.type) || evento.schema !== 'public' || evento.table !== 'telemetria') {
                return res.json({ ok: true, alerta: 'omitida', motivo: 'EVENTO_NO_APLICABLE' });
            }
            const { idempotencyKey, motivo } = evaluarEventoAlerta(evento, env);
            if (motivo) return res.json({ ok: true, alerta: 'omitida', motivo });
            const resultado = await correoAlertas.sendMail({ ...construirAlerta(evento.record), to: env.ALERT_EMAIL_TO }, { idempotencyKey });
            logger.info(resultado?.preparado ? 'Alerta webhook preparada; no se envió correo' : 'Alerta webhook aceptada por Resend; entrega aún no confirmada');
            return res.json({ ok: true, alerta: resultado?.preparado ? 'preparada' : 'aceptada',
                entrega: resultado?.preparado ? 'no_enviada' : 'no_confirmada',
                ...(resultado?.messageId ? { messageId: resultado.messageId } : {}),
            });
        } catch (error) {
            registrarError(logger, 'Alerta webhook: fallo', error);
            if (['WEBHOOK_REGISTRO_INVALIDO', 'WEBHOOK_ANTERIOR_INVALIDO', 'WEBHOOK_VERSION_REQUERIDA'].includes(error.codigo)) {
                return res.status(400).json({ ok: false, codigo: error.codigo });
            }
            if (error.codigo === 'ALERT_TRIGGER_INVALIDO') return res.status(503).json({ ok: false, codigo: error.codigo });
            const resultado = errorCorreo(error);
            return res.status(resultado.status).json({ ok: false, codigo: resultado.codigo, error: resultado.error });
        }
    });

    app.get("/api/historial", async (req, res) => {
        const { data, error } = await supabase.from('telemetria').select('*').order('id', { ascending: false }).limit(20);
        if (error) return res.status(500).json({ ok: false, error: error.message });
        res.json(data);
    });

    app.post("/api/chatbot", async (req, res) => {
        const pregunta = req.body?.pregunta;
        if (typeof pregunta !== 'string' || !pregunta.trim() || pregunta.length > 4000) {
            return res.status(400).json({ ok: false, codigo: 'PREGUNTA_INVALIDA', error: 'Escribe una pregunta de entre 1 y 4000 caracteres.' });
        }
        try {
            const contexto = await obtenerContexto();
            const respuesta = await generarRespuesta(pregunta.trim(), contexto);
            res.json({ ok: true, respuesta });
        } catch (error) {
            registrarError(logger, 'AgroBot: fallo de Gemini', error);
            const resultado = errorChat(error);
            res.status(resultado.status).json({ ok: false, codigo: resultado.codigo, error: resultado.error });
        }
    });

    return app;
}

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    crearApp().listen(PORT, "0.0.0.0", () => {
        console.log(`Servidor en puerto ${PORT} activo`);
    });
}

module.exports = { crearApp };
