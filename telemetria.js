// Una planta y un dispositivo lógico; telemetria es un historial de cambios.
function fallo(codigo, status = 503) {
    return Object.assign(new Error(codigo), { codigo, status });
}

function plantaConfigurada(env) {
    const dispositivo_id = env.DISPOSITIVO_ID?.trim() || 'ESP32-AGRO-01';
    const nombre = env.PLANTA_NOMBRE?.trim() || 'Mi planta';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(dispositivo_id) || nombre.length > 100) throw fallo('PLANTA_NO_CONFIGURADA');
    return { nombre, dispositivo_id };
}

function validarMedicion(body, planta) {
    if (!body || Array.isArray(body) || typeof body !== 'object') throw fallo('MEDICION_INVALIDA', 400);
    if (body.dispositivo_id !== undefined && body.dispositivo_id !== planta.dispositivo_id) throw fallo('DISPOSITIVO_NO_PERMITIDO', 409);
    if (typeof body.temperatura !== 'number' || !Number.isFinite(body.temperatura) ||
        typeof body.humedad !== 'number' || !Number.isFinite(body.humedad) || body.humedad < 0 || body.humedad > 100 ||
        body.bomba_encendida !== undefined && typeof body.bomba_encendida !== 'boolean') throw fallo('MEDICION_INVALIDA', 400);
    // El cliente no puede imponer ID, fecha, planta, destinatarios ni estado previo.
    return { dispositivo_id: planta.dispositivo_id, temperatura: body.temperatura,
        humedad: body.humedad, bomba_encendida: body.bomba_encendida ?? null };
}

async function consultarHistorial(supabase, planta, limite, anteriorA) {
    let consulta = supabase.from('telemetria').select('*').eq('dispositivo_id', planta.dispositivo_id);
    if (anteriorA !== undefined) consulta = consulta.lt('id', anteriorA);
    const { data, error } = await consulta.order('id', { ascending: false }).limit(limite);
    if (error || !Array.isArray(data)) throw fallo('TELEMETRIA_CONSULTA_ERROR');
    return data;
}

async function registrarCambio(supabase, medicion) {
    const { data, error } = await supabase.rpc('agrovalle_registrar_cambio', {
        p_dispositivo_id: medicion.dispositivo_id, p_temperatura: medicion.temperatura,
        p_humedad: medicion.humedad, p_bomba_encendida: medicion.bomba_encendida,
    });
    if (error) throw fallo(error.code === 'PGRST202' ? 'TELEMETRIA_MIGRACION_PENDIENTE' : 'TELEMETRIA_GUARDADO_ERROR');
    if (typeof data?.registrado !== 'boolean' || !data.lectura?.id || !Object.hasOwn(data, 'anterior') || data.lectura.dispositivo_id !== medicion.dispositivo_id) {
        throw fallo('TELEMETRIA_RESPUESTA_INVALIDA');
    }
    return data;
}

function camposCambiados(anterior, lectura) {
    return ['temperatura', 'humedad', 'bomba_encendida'].filter(campo => !anterior || anterior[campo] !== lectura[campo]);
}

module.exports = { plantaConfigurada, validarMedicion, consultarHistorial, registrarCambio, camposCambiados };
