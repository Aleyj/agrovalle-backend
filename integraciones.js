const fs = require('node:fs/promises');
const path = require('node:path');
const { PDFParse } = require('pdf-parse');
const { GoogleGenerativeAI, GoogleGenerativeAIAbortError } = require('@google/generative-ai');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');

const CONTEXTO_ALTERNATIVO = 'Manual del sistema AgroValle: Rango óptimo de temperatura: 18°C a 28°C. Rango óptimo de humedad: 60% a 80%. Bomba se activa con humedad menor a 40%.';

function fallo(codigo, mensaje, status = 503) {
    return Object.assign(new Error(mensaje), { codigo, status });
}

// Solo campos controlados. Nunca registrar message/stack/URL/credenciales del proveedor.
function registrarError(logger, servicio, error) {
    const permitidos = ['EAUTH', 'ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EDNS',
        'EENVELOPE', 'SMTP_NO_CONFIGURADO', 'CORREO_NO_ACEPTADO', 'GEMINI_NO_CONFIGURADO',
        'GEMINI_RESPUESTA_VACIA', 'EMAIL_PROVIDER_INVALIDO', 'EMAIL_DESTINATARIO_INVALIDO',
        'RESEND_NO_CONFIGURADO', 'RESEND_TIMEOUT', 'RESEND_RECHAZADO', 'RESEND_CUOTA',
        'RESEND_NO_DISPONIBLE', 'RESEND_ERROR', 'RESEND_RESPUESTA_INVALIDA', 'EMAIL_VERIFY_NO_DISPONIBLE',
        'ALERT_TRIGGER_INVALIDO', 'WEBHOOK_NO_CONFIGURADO', 'WEBHOOK_REGISTRO_INVALIDO',
        'WEBHOOK_ANTERIOR_INVALIDO', 'WEBHOOK_VERSION_REQUERIDA', 'EMAIL_PROPOSITO_INVALIDO'];
    logger.error(servicio, {
        codigo: permitidos.includes(error.codigo || error.code) ? (error.codigo || error.code) : 'ERROR_PROVEEDOR',
        status: Number.isInteger(error.status) ? error.status : undefined,
        smtpStatus: Number.isInteger(error.responseCode) ? error.responseCode : undefined,
        proveedorStatus: Number.isInteger(error.proveedorStatus) ? error.proveedorStatus : undefined,
    });
}

async function cargarContexto(ruta = path.join(__dirname, 'manual.pdf'), logger = console) {
    let parser;
    try {
        const data = await fs.readFile(ruta);
        parser = new PDFParse({ data });
        const resultado = await parser.getText();
        // Un PDF sin texto util (por ejemplo escaneado) requiere contexto alternativo.
        if (!resultado.pages?.some(page => page.text.trim())) throw new Error('PDF sin texto');
        return { texto: resultado.text.slice(0, 15000), fuente: 'manual.pdf' };
    } catch (error) {
        logger.warn('AgroBot: contexto alternativo', { motivo: error.code === 'ENOENT' ? 'PDF_AUSENTE' : 'PDF_NO_LEIBLE' });
        return { texto: CONTEXTO_ALTERNATIVO, fuente: 'alternativo' };
    } finally {
        if (parser) await parser.destroy().catch(() => logger.warn('AgroBot: no se pudo liberar el parser PDF'));
    }
}

function crearGenerador(env = process.env) {
    return async (pregunta, contexto) => {
        if (!env.GEMINI_API_KEY?.trim()) throw fallo('GEMINI_NO_CONFIGURADO', 'AgroBot no está configurado en el servidor.');
        const modelo = new GoogleGenerativeAI(env.GEMINI_API_KEY).getGenerativeModel({
            model: env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite',
        });
        const prompt = `Eres "AgroBot", el asistente de inteligencia artificial del sistema AgroValle.
Información técnica del manual: "${contexto.texto}".
Pregunta del usuario: "${pregunta}".
Responde de forma concisa, útil y clara.`;
        const resultado = await modelo.generateContent(prompt, { timeout: 25000 });
        const texto = resultado.response.text();
        if (!texto?.trim()) throw fallo('GEMINI_RESPUESTA_VACIA', 'AgroBot no devolvió texto. Intenta reformular la pregunta.', 502);
        return texto;
    };
}

function errorChat(error) {
    if (['GEMINI_NO_CONFIGURADO', 'GEMINI_RESPUESTA_VACIA'].includes(error.codigo)) {
        return { status: error.status, codigo: error.codigo, error: error.message };
    }
    if (error.status === 429) return { status: 503, codigo: 'GEMINI_CUOTA', error: 'Gemini alcanzó su cuota o límite de solicitudes. Intenta más tarde.' };
    if ([400, 401, 403, 404].includes(error.status)) return {
        status: 502, codigo: 'GEMINI_RECHAZADO', error: 'Gemini rechazó la solicitud. Revisa la clave, permisos y modelo en el servidor.',
    };
    if (error instanceof GoogleGenerativeAIAbortError || ['AbortError', 'TimeoutError', 'GoogleGenerativeAIAbortError'].includes(error.name)) return {
        status: 504, codigo: 'GEMINI_TIMEOUT', error: 'Gemini tardó demasiado en responder. Intenta más tarde.',
    };
    return { status: 502, codigo: 'GEMINI_ERROR', error: 'No se pudo obtener una respuesta de Gemini.' };
}

function opcionesSMTP(env = process.env) {
    const port = Number(env.SMTP_PORT || 465);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw fallo('SMTP_NO_CONFIGURADO', 'SMTP_PORT debe ser un puerto válido.');
    return {
        host: env.SMTP_HOST?.trim() || 'smtp.gmail.com', port,
        secure: port === 465,
        requireTLS: port !== 465,
        auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    };
}

function destinatarioAutorizado(env, proposito) {
    const valor = proposito === 'alerta' ? env.ALERT_EMAIL_TO : (env.REPORT_EMAIL_TO ?? env.EMAIL_USER);
    const destinatario = valor?.trim();
    if (!destinatario || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(destinatario)) {
        throw fallo('EMAIL_DESTINATARIO_INVALIDO', 'Configura un único destinatario autorizado para el tipo de correo.');
    }
    return destinatario;
}

function contenidoCorreo(mensaje) {
    // Lista permitida: no propagar cc, bcc, envelope, headers ni destinatarios externos.
    return { subject: mensaje.subject,
        ...(typeof mensaje.html === 'string' ? { html: mensaje.html } : {}),
        ...(typeof mensaje.text === 'string' ? { text: mensaje.text } : {}),
    };
}

function crearCorreoSMTP(env, proposito) {
    let transporter;
    function obtenerTransporte() {
        if (!env.EMAIL_USER?.trim() || !env.EMAIL_PASS?.trim()) throw fallo('SMTP_NO_CONFIGURADO', 'El correo no está configurado en el servidor.');
        transporter ||= nodemailer.createTransport(opcionesSMTP(env));
        return transporter;
    }
    return {
        verify: () => obtenerTransporte().verify(),
        async sendMail(mensaje) {
            // Destinatario fijo: ninguna entrada HTTP puede cambiarlo.
            const transporte = obtenerTransporte();
            const destinatario = destinatarioAutorizado(env, proposito);
            const info = await transporte.sendMail({ ...contenidoCorreo(mensaje), from: env.EMAIL_USER, to: destinatario });
            if (!info.accepted?.length || info.rejected?.length) throw fallo('CORREO_NO_ACEPTADO', 'El servidor SMTP no aceptó el correo.', 502);
            return { ...info, proveedor: 'smtp', estado: 'aceptado', entrega: 'no_confirmada' };
        },
    };
}

function crearCorreoResend(env, proposito) {
    let cliente;
    return {
        async verify() {
            throw fallo('EMAIL_VERIFY_NO_DISPONIBLE', 'Resend no usa autenticación SMTP. La prueba real de envío requiere autorización.');
        },
        async sendMail(mensaje, opciones = {}) {
            if (!env.RESEND_API_KEY?.trim() || !env.EMAIL_FROM?.trim() || process.env.RESEND_DEBUG === 'true') {
                throw fallo('RESEND_NO_CONFIGURADO', 'Configura RESEND_API_KEY y EMAIL_FROM y mantén RESEND_DEBUG desactivado.');
            }
            const destinatario = destinatarioAutorizado(env, proposito);
            const timeout = Number(env.RESEND_TIMEOUT_MS || 15000);
            if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000) {
                throw fallo('RESEND_NO_CONFIGURADO', 'RESEND_TIMEOUT_MS debe estar entre 1 y 60000 milisegundos.');
            }
            cliente ||= new Resend(env.RESEND_API_KEY, { baseUrl: 'https://api.resend.com' });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            try {
                let resultado;
                try {
                    resultado = await cliente.emails.send({ ...contenidoCorreo(mensaje),
                        from: env.EMAIL_FROM.trim(), to: [destinatario],
                    }, { signal: controller.signal,
                        ...(opciones.idempotencyKey ? { idempotencyKey: opciones.idempotencyKey } : {}),
                    });
                } catch {
                    throw fallo(controller.signal.aborted ? 'RESEND_TIMEOUT' : 'RESEND_ERROR', 'No se pudo confirmar la aceptación del correo por Resend.', controller.signal.aborted ? 504 : 502);
                }
                if (controller.signal.aborted) throw fallo('RESEND_TIMEOUT', 'No se pudo confirmar la aceptación del correo por Resend.', 504);
                if (resultado?.error) {
                    const status = resultado.error.statusCode;
                    const codigo = status === 429 ? 'RESEND_CUOTA' : status >= 500 ? 'RESEND_NO_DISPONIBLE' :
                        status >= 400 ? 'RESEND_RECHAZADO' : 'RESEND_ERROR';
                    throw Object.assign(fallo(codigo, 'No se pudo confirmar la aceptación del correo por Resend.',
                        codigo === 'RESEND_CUOTA' || codigo === 'RESEND_NO_DISPONIBLE' ? 503 : 502), {
                        proveedorStatus: Number.isInteger(status) ? status : undefined,
                    });
                }
                if (typeof resultado?.data?.id !== 'string' || !resultado.data.id.trim()) {
                    throw fallo('RESEND_RESPUESTA_INVALIDA', 'Resend no confirmó la aceptación del correo.', 502);
                }
                return { proveedor: 'resend', estado: 'aceptado', entrega: 'no_confirmada', messageId: resultado.data.id };
            } finally { clearTimeout(timer); }
        },
    };
}

function crearCorreo(env = process.env, proposito = 'reporte') {
    if (!['reporte', 'alerta'].includes(proposito)) {
        const invalido = async () => { throw fallo('EMAIL_PROPOSITO_INVALIDO', 'Tipo de correo no permitido.'); };
        return { verify: invalido, sendMail: invalido };
    }
    // Las alertas nuevas siempre usan Resend; SMTP se conserva para reportes/local.
    const proveedor = proposito === 'alerta' ? 'resend' : (env.EMAIL_PROVIDER || 'smtp').trim().toLowerCase();
    if (proveedor === 'smtp') return crearCorreoSMTP(env, proposito);
    if (proveedor === 'resend') return crearCorreoResend(env, proposito);
    const invalido = async () => { throw fallo('EMAIL_PROVIDER_INVALIDO', 'EMAIL_PROVIDER debe ser smtp o resend.'); };
    return { verify: invalido, sendMail: invalido };
}

function errorCorreo(error) {
    const errores = {
        SMTP_NO_CONFIGURADO: [503, 'El correo SMTP no está configurado en el servidor.'],
        EMAIL_PROVIDER_INVALIDO: [503, 'EMAIL_PROVIDER debe ser smtp o resend.'],
        EMAIL_DESTINATARIO_INVALIDO: [503, 'Revisa el destinatario autorizado configurado en el servidor.'],
        RESEND_NO_CONFIGURADO: [503, 'Revisa la configuración de Resend en el servidor.'],
        RESEND_RECHAZADO: [502, 'Resend rechazó el correo. Revisa clave, remitente y destinatario autorizado en el servidor.'],
        RESEND_CUOTA: [503, 'Resend alcanzó su cuota o límite de solicitudes.'],
        RESEND_NO_DISPONIBLE: [503, 'Resend no está disponible en este momento.'],
        RESEND_TIMEOUT: [504, 'No se pudo confirmar la aceptación del correo a tiempo. No se reintentó el envío.'],
        RESEND_ERROR: [502, 'No se pudo confirmar la aceptación del correo por Resend.'],
        RESEND_RESPUESTA_INVALIDA: [502, 'Resend no confirmó la aceptación del correo.'],
    };
    const entrada = errores[error.codigo];
    return entrada ? { status: entrada[0], codigo: error.codigo, error: entrada[1] } :
        { status: 502, codigo: 'REPORTE_ERROR', error: 'No se pudo enviar el reporte. Revisa los logs del servidor.' };
}

module.exports = { CONTEXTO_ALTERNATIVO, cargarContexto, crearGenerador, errorChat, crearCorreo, opcionesSMTP, registrarError, errorCorreo };
