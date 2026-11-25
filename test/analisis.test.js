const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { crearApp } = require('../index');

const token = 'token-ficticio-analisis-solo-tests-123456789';
const desde = '2026-11-01T00:00:00.000Z', hasta = '2026-11-04T00:00:00.000Z';
const filas = [
    { id:1, dispositivo_id:'ESP32-AGRO-01', temperatura:22, humedad:50, fecha_hora:desde },
    { id:2, dispositivo_id:'ESP32-AGRO-01', temperatura:35, humedad:50, fecha_hora:'2026-11-02T00:00:00.000Z' },
    { id:3, dispositivo_id:'otro', temperatura:99, fecha_hora:desde },
    { id:4, dispositivo_id:'ESP32-AGRO-01', temperatura:26, fecha_hora:hasta },
    { id:5, dispositivo_id:'ESP32-AGRO-01', temperatura:28, fecha_hora:'2026-11-03T00:00:00.000Z' },
];
async function preparar(t, opciones={}) {
    const consultas=[];
    const db={from(tabla){
        assert.equal(tabla,'telemetria');
        let data=[...filas];
        const q={
            select(campos){ assert.equal(campos,'id,dispositivo_id,temperatura,humedad,bomba_encendida,fecha_hora'); return q; },
            eq(c,v){ assert.equal(c,'dispositivo_id'); data=data.filter(f=>f[c]===v); return q; },
            gte(c,v){ data=data.filter(f=>f[c]>=v); return q; },
            lt(c,v){ data=data.filter(f=>f[c]<v); return q; },
            order(c,o){ assert.equal(c,'id'); assert.equal(o.ascending,false); data.sort((a,b)=>b.id-a.id); return q; },
            async limit(n){ consultas.push(n); return opciones.error ? {error:{message:'DETALLE_PRIVADO'}} : {data:data.slice(0,n),error:null}; },
        }; return q;
    }};
    const server=crearApp({env:{ANALISIS_API_TOKEN:token,...opciones.env},supabase:db,
        correo:{async sendMail(){throw Error('NO_CORREO');}},logger:{info(){},error(){}}}).listen(0,'127.0.0.1');
    await once(server,'listening');
    t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
    return {consultas,async get(query=`desde=${desde}&hasta=${hasta}`,clave=token){
        const r=await fetch(`http://127.0.0.1:${server.address().port}/api/analisis?${query}`,{headers:{Authorization:`Bearer ${clave}`}});
        return {status:r.status,body:await r.json(),cache:r.headers.get('cache-control')};
    }};
}

test('Analisis: token exclusivo y falta de configuracion no consultan Supabase',async t=>{
    const s=await preparar(t);
    for (const clave of ['', 'incorrecto', 'token-ficticio-esp-solo-tests-1234567890']) assert.equal((await s.get(undefined,clave)).status,401);
    assert.equal(s.consultas.length,0);
    const sin=await preparar(t,{env:{ANALISIS_API_TOKEN:''}});
    assert.equal((await sin.get()).status,503);
    assert.equal(sin.consultas.length,0);
});
test('Analisis: pagina por ID y filtra solo el ESP y rango [desde,hasta)',async t=>{
    const s=await preparar(t);
    const p=await s.get(`desde=${desde}&hasta=${hasta}&limite=2`);
    assert.equal(p.status,200);
    assert.equal(p.cache,'no-store');
    assert.deepEqual(p.body.lecturas.map(f=>f.id),[5,2]);
    assert.equal(p.body.siguiente_cursor,2);
    const segunda=await s.get(`desde=${desde}&hasta=${hasta}&limite=2&cursor=2`);
    assert.deepEqual(segunda.body.lecturas.map(f=>f.id),[1]);
    assert.equal(segunda.body.siguiente_cursor,null);
    const vacia=await s.get(`desde=${desde}&hasta=${hasta}&cursor=1`);
    assert.deepEqual(vacia.body.lecturas,[]);
    assert.deepEqual(s.consultas,[3,3,501]);
});
test('Analisis: rechaza fechas, rangos, cursores y limites invalidos antes de consultar',async t=>{
    const s=await preparar(t);
    for(const query of ['', `desde=${hasta}&hasta=${desde}`, `desde=2026-02-30T00:00:00Z&hasta=${hasta}`,
        `desde=2020-01-01T00:00:00Z&hasta=${hasta}`, `desde=${desde}&hasta=${hasta}&cursor=-1`,
        `desde=${desde}&hasta=${hasta}&limite=501`, `desde=${desde}&desde=${desde}&hasta=${hasta}`]) {
        assert.equal((await s.get(query)).status,400,query);
    }
    assert.equal(s.consultas.length,0);
});
test('Analisis: falla de consulta no expone detalle ni anuncia datos vacios',async t=>{
    const s=await preparar(t,{error:true});
    const r=await s.get();
    assert.equal(r.status,503);
    assert.equal(r.body.codigo,'ANALISIS_CONSULTA_ERROR');
    assert.ok(!JSON.stringify(r).includes('DETALLE_PRIVADO'));
});
