// End-to-end boot: npm start equivalent on ephemeral ports (both transports), /healthz on both ports, /metrics on the
// admin port only, stub routes answer 501, admin token required, WS /play PING→PONG with js/shared/codec.js, Origin
// allow-list on upgrade, malformed messages → 1008, /probe PING-only, graceful stop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestServer, openWs, nextMessage, waitClose, pingRtts, getJson } from './helpers/client.mjs';
import { Writer, encodePing, encodeHello, encodeChat } from '../../js/shared/codec.js';
import { S2C, SYS, CLOSE, PROTO_VERSION } from '../../js/shared/protocol.js';
import { loadUws } from '../src/net/transport.js';

for (const kind of ['uws', 'ws']) {
  test(`boot + endpoints + PING/PONG (${kind})`, { skip: kind === 'uws' && !loadUws() }, async () => {
    const s = await bootTestServer({ TRANSPORT: kind });
    try {
      assert.equal(s.app.ws.kind, kind);
      // health on both ports
      for (const base of [s.game, s.admin]) {
        const h = await getJson(base + '/healthz');
        assert.equal(h.status, 200);
        assert.equal(h.body.ok, true); assert.equal(h.body.db, 'ok'); assert.equal(h.body.proto, PROTO_VERSION);
        assert.equal(h.body.transport, kind);
      }
      // migrations applied
      const t = await s.app.db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name IN ('accounts','identities','refresh_tokens','characters','invites','admin_audit','playtime_daily')");
      assert.equal(t.rows[0].n, 7);
      // metrics only on the admin port
      const m = await fetch(s.admin + '/metrics');
      assert.equal(m.status, 200);
      const mt = await m.text();
      assert.match(mt, /hp_process_rss_bytes \d+/);
      assert.match(mt, /hp_sim_tick_ms_count/);
      assert.equal((await fetch(s.game + '/metrics')).status, 404);
      // stubs answer 501 (/v1/netprobe is implemented by S5: see ops_netprobe.test.js)
      for (const p of ['/v1/auth/guest', '/v1/auth/refresh', '/v1/auth/recover', '/v1/join']) {
        const r = await getJson(s.game + p, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
        assert.equal(r.status, 501, p); assert.equal(r.body.error, 'not_implemented');
      }
      // bad JSON → 400, unknown → 404, wrong method → 405
      assert.equal((await getJson(s.game + '/v1/join', { method: 'POST', body: '{nope' })).status, 400);
      assert.equal((await getJson(s.game + '/nope')).status, 404);
      assert.equal((await getJson(s.game + '/v1/join')).status, 405);
      // body limit
      assert.equal((await getJson(s.game + '/v1/join', { method: 'POST', body: 'x'.repeat(20000) })).status, 413);
      // CORS: allowed origin echoed, foreign origin refused for POST
      const ok = await fetch(s.game + '/healthz', { headers: { origin: 'https://tungtase04539.github.io' } });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'https://tungtase04539.github.io');
      const pre = await fetch(s.game + '/v1/join', { method: 'OPTIONS', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
      assert.equal(pre.status, 204);
      const bad = await getJson(s.game + '/v1/join', { method: 'POST', body: '{}', headers: { origin: 'https://evil.example' } });
      assert.equal(bad.status, 403); assert.equal(bad.body.error, 'origin_not_allowed');
      // admin API needs the token
      assert.equal((await getJson(s.admin + '/admin/api/status')).status, 401);
      assert.equal((await getJson(s.admin + '/admin/api/status', { headers: { authorization: 'Bearer wrong' } })).status, 401);
      const st = await getJson(s.admin + '/admin/api/status', { headers: { authorization: 'Bearer ' + s.config.secrets.adminToken } });
      assert.equal(st.status, 200);
      assert.equal(st.body.config.secrets.adminToken, '[set]');
      assert.ok(!JSON.stringify(st.body).includes(s.config.secrets.adminToken));
      assert.equal((await fetch(s.admin + '/admin')).status, 200);

      // WebSocket /play: PING → PONG with a sane server time
      const ws = await openWs(s.ws + '/play');
      const w = new Writer(64);
      const before = Date.now();
      ws.send(encodePing(w, 123456));
      const pong = await nextMessage(ws);
      assert.equal(pong.op, S2C.PONG); assert.equal(pong.clientTime, 123456);
      assert.ok(Math.abs(pong.serverTime - before) < 5000);
      const rtts = await pingRtts(ws, 20);
      assert.ok(rtts.every((x) => x < 1000));
      // HELLO answered by the stub
      ws.send(encodeHello(w, { ticket: 't' }));
      const sys = await nextMessage(ws);
      assert.equal(sys.op, S2C.SYSTEM); assert.equal(sys.code, SYS.NOT_IMPLEMENTED);
      assert.equal(s.app.ws.connections, 1);
      // malformed traffic → close 1008
      for (let i = 0; i < 12; i++) ws.send(Buffer.from([0xee, i]));
      const c = await waitClose(ws);
      assert.equal(c.code, CLOSE.POLICY);

      // oversize message (> 512 B) is refused by the transport
      const ws2 = await openWs(s.ws + '/play');
      ws2.send(encodeChat(w, 0, 'x'.repeat(420)));      // 424 B: fine
      ws2.send(Buffer.alloc(600));
      const c2 = await waitClose(ws2);
      assert.ok([1009, 1006].includes(c2.code), `oversize close code ${c2.code}`);

      // Origin allow-list on upgrade
      await assert.rejects(openWs(s.ws + '/play', { origin: 'https://evil.example' }), (e) => e.status === 403);
      const ws3 = await openWs(s.ws + '/play', { origin: 'http://localhost:8000' });
      ws3.close();
      // unknown path
      await assert.rejects(openWs(s.ws + '/nope'), (e) => e.status === 404);

      // /probe: PING only
      const p = await openWs(s.ws + '/probe');
      p.send(encodePing(w, 7));
      assert.equal((await nextMessage(p)).clientTime, 7);
      p.send(encodeHello(w, {}));
      assert.equal((await waitClose(p)).code, CLOSE.POLICY);

      // graceful stop closes open sockets with 1001
      const ws4 = await openWs(s.ws + '/play');
      const closing = waitClose(ws4);
      await s.app.stop('test');
      assert.equal((await closing).code, 1001);
    } finally {
      await s.app.stop('test-finally');
    }
  });
}
