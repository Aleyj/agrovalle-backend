const { timingSafeEqual } = require('node:crypto');
const { plantaConfigurada } = require('./telemetria');

function autorizar(req, env) {
    const token = env.ANALISIS_API_TOKEN;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return 503;
    const esperado = Buffer.from(`Bearer ${token}`);
    const recibido = Buffer.from(req.get('authorization') || '');
    return recibido.length === esperado.length && timingSafeEqual(recibido, esperado) ? null : 401;
}

function parametros(query) {
    function fecha(valor) {
        if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(valor)) return null;
        const d = new Date(valor);
        if (!Number.isFinite(d.getTime())) return null;
        return d.toISOString() === (valor.includes('.') ? valor : valor.replace('Z', '.000Z')) ? d : null;
    }
    const desde = fecha(query.desde), hasta = fecha(query.hasta);
    const entero = (valor, max) => typeof valor === 'string' && /^[1-9]\d*$/.test(valor) && Number(valor) <= max ? Number(valor) : null;
    const limite = query.limite === undefined ? 500 : entero(query.limite, 500);
    const cursor = query.cursor === undefined ? undefined : entero(query.cursor, 2147483647);
    if (!desde || !hasta || hasta <= desde || hasta - desde > 366 * 86400000 || !limite || cursor === null) return null;
    return { desde:desde.toISOString(), hasta:hasta.toISOString(), limite, cursor };
}

function instalarAnalisis(app, supabase, env) {
    app.get('/api/analisis', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const acceso = autorizar(req, env);
        if (acceso) return res.status(acceso).json({ ok:false, codigo:acceso === 401 ? 'ANALISIS_NO_AUTORIZADO' : 'ANALISIS_NO_CONFIGURADO' });
        const p = parametros(req.query);
        if (!p) return res.status(400).json({ ok:false, codigo:'ANALISIS_FILTROS_INVALIDOS' });
        try {
            const planta = plantaConfigurada(env);
            let q = supabase.from('telemetria')
                .select('id,dispositivo_id,temperatura,humedad,bomba_encendida,fecha_hora')
                .eq('dispositivo_id', planta.dispositivo_id).gte('fecha_hora', p.desde).lt('fecha_hora', p.hasta);
            if (p.cursor !== undefined) q = q.lt('id', p.cursor);
            const { data, error } = await q.order('id', { ascending:false }).limit(p.limite + 1);
            if (error || !Array.isArray(data)) throw new Error('CONSULTA');
            const lecturas = data.slice(0, p.limite);
            return res.json({ ok:true, planta, desde:p.desde, hasta:p.hasta, lecturas,
                siguiente_cursor:data.length > p.limite ? lecturas.at(-1).id : null });
        } catch {
            return res.status(503).json({ ok:false, codigo:'ANALISIS_CONSULTA_ERROR' });
        }
    });
}

module.exports = { instalarAnalisis, parametros };
