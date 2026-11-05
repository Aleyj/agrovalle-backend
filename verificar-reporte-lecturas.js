// Prueba aislada: consulta historial publicado en lectura y prepara MIME en memoria.
// El adaptador NO es una conexion directa a Supabase ni un fallback de la aplicacion.
const { once } = require('node:events');
const assert = require('node:assert/strict');
const { crearApp } = require('./index');
const { crearCorreoPreparacion } = require('./local-validacion');

async function main() {
    let registros = 0;
    const supabaseLectura = { from(tabla) {
        assert.equal(tabla, 'telemetria');
        return { select: () => ({ order: () => ({ limit: async limite => {
            const r = await fetch('https://agrovalle-backend-api.onrender.com/api/historial', { signal: AbortSignal.timeout(45000) });
            if (!r.ok) throw new Error('HISTORIAL_PUBLICADO_FALLO');
            const datos = await r.json();
            assert.ok(Array.isArray(datos));
            const data = datos.sort((a, b) => b.id - a.id).slice(0, limite);
            registros = data.length;
            return { data, error: null };
        } }) }) };
    } };
    const app = crearApp({ supabase: supabaseLectura, correo: crearCorreoPreparacion({
        nombreEvidencia: 'reporte-lecturas-render.json', fuente: 'GET historial publicado Render; adaptador de lectura de prueba, no Supabase directo',
    }) });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const r = await fetch(`http://127.0.0.1:${server.address().port}/api/reporte`, { method: 'POST', signal: AbortSignal.timeout(50000) });
        const data = await r.json();
        assert.equal(r.status, 200);
        assert.equal(data.preparado, true);
        console.log(JSON.stringify({ status: r.status, lecturasExistentes: registros, preparado: true,
            enviosSMTP: 0, escriturasSupabase: 0, fuente: 'historial publicado; conexion directa pendiente' }));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(() => { console.error('No se pudo preparar el reporte de lecturas existentes.'); process.exitCode = 1; });
