const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const jwt = require("jsonwebtoken");
const path = require("path");
const { construirAlerta, modoAlertas, autenticarWebhook, claveAlerta, cruceTemperatura } = require('./alertas');
const { plantaConfigurada, validarMedicion, consultarHistorial, registrarCambio, camposCambiados } = require('./telemetria');
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
    function responderErrorTelemetria(res, error) {
        registrarError(logger, 'Telemetria: fallo', error);
        const mensajes = {
            PLANTA_NO_CONFIGURADA: 'Revisa la configuración de la planta y su ESP32.',
            DISPOSITIVO_NO_PERMITIDO: 'Solo se admite el ESP32 asociado a la planta.',
            MEDICION_INVALIDA: 'Envía temperatura y humedad numéricas válidas, humedad de 0 a 100 y bomba booleana si se indica.',
            TELEMETRIA_MIGRACION_PENDIENTE: 'Falta instalar la función de registro de cambios en la base de datos.',
            TELEMETRIA_CONSULTA_ERROR: 'No se pudieron consultar las lecturas de la planta.',
            TELEMETRIA_GUARDADO_ERROR: 'No se pudo registrar la medición.',
            TELEMETRIA_RESPUESTA_INVALIDA: 'No se pudo confirmar el registro de la medición.',
        };
        const codigo = mensajes[error.codigo] ? error.codigo : 'TELEMETRIA_GUARDADO_ERROR';
        return res.status([400, 409].includes(error.status) ? error.status : 503).json({ ok: false, codigo, error: mensajes[codigo] });
    }

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
            const data = await consultarHistorial(supabase, plantaConfigurada(env), 10);

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
            if (error.codigo?.startsWith('TELEMETRIA_') || error.codigo === 'PLANTA_NO_CONFIGURADA') return responderErrorTelemetria(res, error);
            registrarError(logger, 'Reporte: fallo de correo o consulta', error);
            const resultado = errorCorreo(error);
            res.status(resultado.status).json({ ok: false, codigo: resultado.codigo, error: resultado.error });
        }
    });

    app.post("/api/telemetria", async (req, res) => {
        try {
            const medicion = validarMedicion(req.body, plantaConfigurada(env));
            const resultado = await registrarCambio(supabase, medicion);
            try {
                if (resultado.registrado && modoAlertas(env) === 'express' && cruceTemperatura(resultado.anterior, resultado.lectura)) {
                    const idempotencyKey = claveAlerta(resultado.lectura, env);
                    void Promise.resolve().then(() => correoAlertas.sendMail({ ...construirAlerta(resultado.lectura),
                        to: env.ALERT_EMAIL_TO, from: env.EMAIL_FROM || env.EMAIL_USER }, { idempotencyKey }))
                        .then(info => logger.info(info?.preparado ? 'Alerta preparada; no se envió correo' : 'Alerta aceptada por Resend; entrega aún no confirmada'))
                        .catch(error => registrarError(logger, 'Alerta: fallo de correo', error));
                }
            } catch (error) { registrarError(logger, 'Alerta: configuracion invalida', error); }
            return res.json({ ok: true, mensaje: resultado.registrado ? 'Datos guardados' : 'Sin cambios; no se agregó otra lectura',
                registrado: resultado.registrado, lectura: resultado.lectura,
                campos_cambiados: resultado.registrado ? camposCambiados(resultado.anterior, resultado.lectura) : [] });
        } catch (error) {
            return responderErrorTelemetria(res, error);
        }
    });

    // Los logs se añaden por INSERT; UPDATE deja de ser una fuente de alertas.
    app.post('/api/webhooks/supabase/telemetria', async (req, res) => {
        const acceso = autenticarWebhook(req, env);
        if (acceso) return res.status(acceso.status).json({ ok: false, codigo: acceso.codigo });
        try {
            if (modoAlertas(env) !== 'webhook') return res.status(409).json({ ok: false, codigo: 'WEBHOOK_DESACTIVADO' });
            const evento = req.body;
            if (evento?.type !== 'INSERT' || evento.schema !== 'public' || evento.table !== 'telemetria') {
                return res.json({ ok: true, alerta: 'omitida', motivo: 'EVENTO_NO_APLICABLE' });
            }
            const planta = plantaConfigurada(env);
            if (evento.record?.dispositivo_id !== planta.dispositivo_id) return res.json({ ok: true, alerta: 'omitida', motivo: 'OTRO_DISPOSITIVO' });
            const idempotencyKey = claveAlerta(evento.record, env);
            const anteriores = await consultarHistorial(supabase, planta, 1, evento.record.id);
            if (!cruceTemperatura(anteriores[0], evento.record)) return res.json({ ok: true, alerta: 'omitida', motivo: 'SIN_NUEVO_CRUCE_DE_TEMPERATURA' });
            const resultado = await correoAlertas.sendMail({ ...construirAlerta(evento.record), to: env.ALERT_EMAIL_TO }, { idempotencyKey });
            logger.info(resultado?.preparado ? 'Alerta webhook preparada; no se envió correo' : 'Alerta webhook aceptada por Resend; entrega aún no confirmada');
            return res.json({ ok: true, alerta: resultado?.preparado ? 'preparada' : 'aceptada',
                entrega: resultado?.preparado ? 'no_enviada' : 'no_confirmada',
                ...(resultado?.messageId ? { messageId: resultado.messageId } : {}),
            });
        } catch (error) {
            if (error.codigo?.startsWith('TELEMETRIA_') || error.codigo === 'PLANTA_NO_CONFIGURADA') return responderErrorTelemetria(res, error);
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
        try {
            res.json(await consultarHistorial(supabase, plantaConfigurada(env), 20));
        } catch (error) { responderErrorTelemetria(res, error); }
    });

    app.get('/api/estado', async (req, res) => {
        try {
            const planta = plantaConfigurada(env);
            const data = await consultarHistorial(supabase, planta, 1);
            res.json({ ok: true, planta, lectura: data[0] || null });
        } catch (error) { responderErrorTelemetria(res, error); }
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

    app.use((error, req, res, next) => {
        if (error.type === 'entity.parse.failed') return res.status(400).json({ ok:false, codigo:'JSON_INVALIDO', error:'Envía un objeto JSON válido.' });
        if (error.type === 'entity.too.large') return res.status(413).json({ ok:false, codigo:'JSON_DEMASIADO_GRANDE', error:'La solicitud excede el tamaño permitido.' });
        next(error);
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
