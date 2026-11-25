const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { crearApp } = require('../index');
const { crearSupabaseSimulado } = require('../testing/supabase-simulado');

test('ESP: falta de configuracion, credenciales invalidas y webhook no permiten escrituras', async t => {
    const token = 'token-ficticio-esp-solo-tests-1234567890';
    for (const configurado of [undefined, 'corto', token]) {
        const db = crearSupabaseSimulado([]);
        const server = crearApp({ env: { TELEMETRIA_API_TOKEN:configurado, ALERT_TRIGGER:'webhook' },
            supabase:db.cliente, correo:{ async sendMail(){ throw Error('NO_ENVIAR'); } },
            logger:{info(){},error(){}} }).listen(0, '127.0.0.1');
        await once(server, 'listening');
        t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
        const base = `http://127.0.0.1:${server.address().port}`;
        for (const authorization of ['', 'Bearer incorrecto', 'Bearer secreto-webhook-distinto-1234567890', `Bearer ${token}extra`]) {
            const r = await fetch(base + '/api/telemetria', {method:'POST',
                headers:{'Content-Type':'application/json', authorization},
                body:JSON.stringify({temperatura:22,humedad:50})});
            assert.equal(r.status, configurado === token ? 401 : 503);
            assert.ok(!JSON.stringify(await r.json()).includes(token));
        }
        assert.equal(db.rpc.length, 0);
        assert.equal((await fetch(base + '/api/estado')).status, 200);
        if (configurado === token) {
            const r = await fetch(base + '/api/telemetria', {method:'POST',
                headers:{'Content-Type':'application/json',authorization:`Bearer ${token}`},
                body:JSON.stringify({temperatura:22,humedad:50})});
            assert.equal(r.status, 200);
            assert.equal((await r.json()).registrado, true);
            assert.equal(db.rpc.length, 1);
        }
    }
});
