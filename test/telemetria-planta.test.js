const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { crearApp } = require('../index');
const { crearSupabaseSimulado } = require('../testing/supabase-simulado');
const { plantaConfigurada } = require('../telemetria');

const env = { TELEMETRIA_API_TOKEN:'token-ficticio-esp-solo-tests-1234567890', DISPOSITIVO_ID:'ESP32-AGRO-01', PLANTA_NOMBRE:'Planta de prueba', ALERT_TRIGGER:'webhook' };
const medicion = { dispositivo_id:env.DISPOSITIVO_ID, temperatura:22, humedad:60, bomba_encendida:false };
async function preparar(t, opciones = {}) {
    const db=crearSupabaseSimulado(opciones.filas || []), correos=[], logs=[];
    const server=crearApp({env, supabase:opciones.supabase || db.cliente,
        correo:{async sendMail(m){correos.push(m);return {preparado:true};}},
        logger:{info(){},warn(){},error(...v){logs.push(v);}} }).listen(0,'127.0.0.1');
    await once(server,'listening');
    t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
    const base=`http://127.0.0.1:${server.address().port}`;
    return {db,correos,logs, async request(ruta,body){
        const r=await fetch(base+ruta,body===undefined?{}:{method:'POST',headers: { 'Content-Type':'application/json', ...(ruta === '/api/telemetria' ? { Authorization:'Bearer ' + env.TELEMETRIA_API_TOKEN } : {}) },body:JSON.stringify(body)});
        return {status:r.status,body:await r.json()};
    }};
}

test('Una planta: baseline, duplicados y cambios de temperatura/humedad/bomba conservan snapshots',async t=>{
    const s=await preparar(t);
    const primera=await s.request('/api/telemetria',medicion);
    assert.equal(primera.body.registrado,true);
    assert.equal(primera.body.lectura.dispositivo_id,env.DISPOSITIVO_ID);
    const repetida=await s.request('/api/telemetria',medicion);
    assert.equal(repetida.body.registrado,false);
    assert.deepEqual(repetida.body.campos_cambiados,[]);
    for(const [datos,campo] of [[{humedad:65},'humedad'],[{humedad:65,temperatura:25},'temperatura'],[{humedad:65,temperatura:25,bomba_encendida:true},'bomba_encendida']]) {
        const r=await s.request('/api/telemetria',{...medicion,...datos});
        assert.equal(r.status,200);
        assert.deepEqual(r.body.campos_cambiados,[campo]);
    }
    assert.equal(s.db.insertados.length,4);
    assert.equal(s.db.filas[0].temperatura,22);
    assert.equal(s.db.filas[0].humedad,60);
    assert.equal(s.correos.length,0);
});

test('Estado, historial y reporte pertenecen solo a la planta configurada',async t=>{
    const filas=[{...medicion,id:1,fecha_hora:'2026-11-22T12:00:00Z'},
        {...medicion,id:2,temperatura:28,fecha_hora:'2026-11-22T12:01:00Z'},
        {...medicion,id:3,dispositivo_id:'otro-ESP',temperatura:99}];
    const s=await preparar(t,{filas});
    const estado=await s.request('/api/estado');
    assert.deepEqual(estado.body.planta,{nombre:env.PLANTA_NOMBRE,dispositivo_id:env.DISPOSITIVO_ID});
    assert.equal(estado.body.lectura.id,2);
    const historial=await s.request('/api/historial');
    assert.deepEqual(historial.body.map(f=>f.id),[2,1]);
    assert.equal((await s.request('/api/reporte',{})).status,200);
    assert.ok(s.correos[0].html.includes('28°C'));
    assert.ok(!s.correos[0].html.includes('99°C'));
    assert.deepEqual(s.db.consultas.map(c=>c.limite),[1,20,10]);
    assert.equal(s.db.rpc.length,0);
});

test('Sin mediciones el estado es null y no se inventan valores',async t=>{
    const s=await preparar(t);
    assert.equal((await s.request('/api/estado')).body.lectura,null);
    assert.deepEqual((await s.request('/api/historial')).body,[]);
});

test('Otro ESP y datos invalidos se rechazan antes de escribir',async t=>{
    const s=await preparar(t);
    assert.equal((await s.request('/api/telemetria',{...medicion,dispositivo_id:'otro'})).status,409);
    for(const datos of [{},null,[],{...medicion,temperatura:'22'},{...medicion,humedad:null},
        {...medicion,humedad:-1},{...medicion,humedad:101},{...medicion,bomba_encendida:'false'}]) {
        assert.equal((await s.request('/api/telemetria',datos)).status,400);
    }
    assert.equal(s.db.rpc.length,0);
    assert.equal(s.correos.length,0);
});

test('Sin ID se usa el unico configurado; el cliente no controla fecha ni ID de log',async t=>{
    const s=await preparar(t);
    const r=await s.request('/api/telemetria',{temperatura:22,humedad:60,id:999,fecha_hora:'1900-01-01',planta:'otra'});
    assert.equal(r.body.lectura.id,1);
    assert.equal(r.body.lectura.dispositivo_id,env.DISPOSITIVO_ID);
    assert.equal(r.body.lectura.bomba_encendida,false);
    assert.deepEqual(Object.keys(s.db.rpc[0]).sort(),['p_bomba_encendida','p_dispositivo_id','p_humedad','p_temperatura']);
});

test('RPC ausente o fallo de guardado no simula exito ni expone detalles',async t=>{
    for(const codigo of ['PGRST202','XX000']) {
        const s=await preparar(t,{supabase:{async rpc(){return {data:null,error:{code:codigo,message:'DETALLE_PRIVADO'}};}}});
        const r=await s.request('/api/telemetria',medicion);
        assert.equal(r.status,503);
        assert.equal(r.body.codigo,codigo==='PGRST202'?'TELEMETRIA_MIGRACION_PENDIENTE':'TELEMETRIA_GUARDADO_ERROR');
        assert.ok(!JSON.stringify([r,s.logs]).includes('DETALLE_PRIVADO'));
        assert.equal(s.correos.length,0);
    }
});

test('Lecturas consecutivas identicas usan la frontera atomica RPC',async t=>{
    const s=await preparar(t);
    const r=await Promise.all([s.request('/api/telemetria',medicion),s.request('/api/telemetria',medicion)]);
    assert.equal(r.filter(x=>x.body.registrado).length,1);
    assert.equal(s.db.insertados.length,1);
    assert.equal(s.db.rpc.length,2);
});

test('Configuracion por defecto representa una sola planta; ID invalido se rechaza',()=>{
    assert.deepEqual(plantaConfigurada({}),{nombre:'Mi planta',dispositivo_id:'ESP32-AGRO-01'});
    assert.throws(()=>plantaConfigurada({DISPOSITIVO_ID:'../otro'}),{codigo:'PLANTA_NO_CONFIGURADA'});
});
