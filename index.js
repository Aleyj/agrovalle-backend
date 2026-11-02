const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const jwt = require("jsonwebtoken");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURACIONES ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- RUTA DE LOGIN ---
app.post("/api/login", (req, res) => {
    const { usuario, password } = req.body;
    if (usuario === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
        const token = jwt.sign({ usuario }, process.env.JWT_SECRET, { expiresIn: '2h' });
        res.json({ ok: true, token });
    } else {
        res.status(401).json({ ok: false, mensaje: "Credenciales incorrectas" });
    }
});

// --- RUTA PARA ENVIAR REPORTE MANUAL ---
app.post("/api/reporte", async (req, res) => {
    const { data, error } = await supabase.from('telemetria').select('*').order('id', { ascending: false }).limit(10);
    if (error) return res.status(500).json({ ok: false, error: error.message });

    let filasHtml = data.map(lec => `<tr><td>${lec.temperatura}°C</td><td>${lec.humedad}%</td><td>${new Date(lec.fecha_hora).toLocaleString()}</td></tr>`).join('');
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_USER,
        subject: "📊 Reporte de Estado - AgroValle",
        html: `<h2>Reporte de Sensores</h2><table border="1" cellpadding="5"><tr><th>Temperatura</th><th>Humedad</th><th>Fecha</th></tr>${filasHtml}</table>`
    };
    transporter.sendMail(mailOptions, (err) => {
        if (err) return res.status(500).json({ ok: false, error: "Error enviando correo" });
        res.json({ ok: true, mensaje: "Reporte enviado" });
    });
});

// --- RUTAS DE TELEMETRÍA ---
app.post("/api/telemetria", async (req, res) => {
    const { dispositivo_id, humedad, temperatura, bomba_encendida } = req.body;
    const { error } = await supabase.from('telemetria').insert([{ dispositivo_id, humedad, temperatura, bomba_encendida }]);
    if (error) return res.status(500).json({ ok: false, error: error.message });

    if (temperatura > 30) {
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: `🚨 ALERTA: Temperatura Crítica en ${dispositivo_id}`,
            html: `<h2>Alerta de Sensores</h2><p>Temperatura: <b style="color:red;">${temperatura}°C</b></p>`
        };
        transporter.sendMail(mailOptions, () => console.log("Alerta enviada"));
    }
    res.json({ ok: true, mensaje: "Datos guardados" });
});

app.get("/api/historial", async (req, res) => {
    const { data, error } = await supabase.from('telemetria').select('*').order('id', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json(data);
});

// --- RUTA: CHATBOT IA (LECTURA DE PDF PREDETERMINADO) ---
app.post("/api/chatbot", async (req, res) => {
    try {
        const { pregunta } = req.body;
        let contextoPdf = "";

        const rutaPdf = path.join(__dirname, "manual.pdf");
        if (fs.existsSync(rutaPdf)) {
            const dataBuffer = fs.readFileSync(rutaPdf);
            const pdfData = await pdfParse(dataBuffer);
            contextoPdf = pdfData.text;
        } else {
            contextoPdf = "Manual del sistema AgroValle: Rango óptimo de temperatura: 18°C a 28°C. Rango óptimo de humedad: 60% a 80%. Bomba se activa con humedad menor a 40%.";
        }

        const prompt = `Eres "AgroBot", el asistente de inteligencia artificial del sistema AgroValle.
        Información técnica del manual: "${contextoPdf.substring(0, 15000)}".
        Pregunta del usuario: "${pregunta}".
        Responde de forma concisa, útil y clara.`;

        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent(prompt);
        const respuesta = result.response.text();

        res.json({ ok: true, respuesta });
    } catch (error) {
        console.error("Error en Chatbot:", error);
        res.status(500).json({ ok: false, error: "Error interno del servidor en la IA." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor en puerto ${PORT} activo`);
});
