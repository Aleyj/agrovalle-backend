const assert = require('node:assert/strict');

// Doble de la frontera RPC/consultas. No ejecuta SQL ni representa una prueba de PostgreSQL.
function crearSupabaseSimulado(iniciales = []) {
    const filas = structuredClone(iniciales), insertados = [], consultas = [], rpc = [];
    const cliente = {
        from(tabla) {
            assert.equal(tabla, 'telemetria');
            let filtro, anteriorA;
            const consulta = {
                select() { return consulta; },
                eq(campo, valor) { assert.equal(campo, 'dispositivo_id'); filtro = valor; return consulta; },
                lt(campo, valor) { assert.equal(campo, 'id'); anteriorA = valor; return consulta; },
                order(campo, opciones) { assert.equal(campo, 'id'); assert.equal(opciones.ascending, false); return consulta; },
                async limit(limite) {
                    assert.ok(filtro, 'Todas las consultas deben filtrar el único ESP32');
                    consultas.push({ dispositivo: filtro, limite, anteriorA });
                    return { data: filas.filter(f => f.dispositivo_id === filtro && (anteriorA === undefined || f.id < anteriorA))
                        .sort((a, b) => b.id - a.id).slice(0, limite), error: null };
                },
            };
            return consulta;
        },
        async rpc(nombre, params) {
            assert.equal(nombre, 'agrovalle_registrar_cambio');
            rpc.push(params);
            const anterior = filas.filter(f => f.dispositivo_id === params.p_dispositivo_id).sort((a,b) => b.id-a.id)[0] || null;
            const siguiente = { dispositivo_id:params.p_dispositivo_id, temperatura:params.p_temperatura,
                humedad:params.p_humedad, bomba_encendida:params.p_bomba_encendida ?? anterior?.bomba_encendida ?? false };
            const iguales = anterior && ['temperatura','humedad','bomba_encendida'].every(k => anterior[k] === siguiente[k]);
            if (iguales) return { data:{ registrado:false, lectura:anterior, anterior }, error:null };
            const lectura = { ...siguiente, id:Math.max(0, ...filas.map(f => Number(f.id))) + 1,
                fecha_hora:new Date(Date.UTC(2026,10,22,12,0,insertados.length)).toISOString() };
            filas.push(lectura); insertados.push(lectura);
            return { data:{ registrado:true, lectura, anterior }, error:null };
        },
    };
    return { cliente, filas, insertados, consultas, rpc };
}
module.exports = { crearSupabaseSimulado };
