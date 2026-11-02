const axios = require('axios');
require('dotenv').config();

async function probar() {
    console.log("Conectando con Google AI...");
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`;
        const res = await axios.get(url);
        
        const modelos = res.data.models
            .map(m => m.name)
            .filter(m => m.includes("gemini"));
            
        console.log("✅ ÉXITO. Tu llave tiene acceso a estos modelos:");
        console.log(modelos);
    } catch (error) {
        console.error("❌ ERROR de llave:", error.response ? error.response.data : error.message);
    }
}
probar();
