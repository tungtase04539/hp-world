// S5: /probe WebSocket, POST /v1/netprobe (+ migration 030), admin summary, admin edge guard.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootTestServer, openWs, nextMessage, waitClose } from './helpers/client.mjs';
import { Writer, encodePing, encodeReady } from '../../js/shared/codec.js';
import { S2C } from '../../js/shared/protocol.js';
import { validateResult, PROBE } from '../src/api/netprobe.js';
import { parseCidr, ipInCidrs, cameThroughCloudflare } from '../src/api/admin_edge_guard.js';

const good = { carrier: 'viettel', netType: '4g', device: 'dienthoai', samples: 30, lost: 1, medianMs: 41.2, p95Ms: 63.5, jitterMs: 6.1, minMs: 30.2, maxMs: 80.9 };

test('validateResult accepts clean results and rejects junk', () => {
  assert.deepEqual(validateResult(good), good);
  assert.equal(validateResult({ ...good, carrier: 'abc' }), null);
  assert.equal(validateResult({ ...good, netType: '3g' }), null);
  assert.equal(validateResult({ ...good, samples: 0 }), null);
  assert.equal(validateResult({ ...good, lost: 31 }), null);
  assert.equal(validateResult({ ...good, medianMs: -1 }), null);
  assert.equal(validateResult({ ...good, medianMs: 'x' }), null);
  assert.equal(validateResult({ ...good, maxMs: 1e9 }), null);
  assert.equal(validateResult({ ...good, minMs: 100 }), null);       // min > median
  assert.equal(validateResult([]), null);
  assert.equal(validateResult(null), null);
  // all lost → numbers 0 are fine
  assert.ok(validateResult({ ...good, lost: 30, medianMs: 0, p95Ms: 0, jitterMs: 0, minMs: 0, maxMs: 0 }));
});

test('CIDR helpers', () => {
  const c = [parseCidr('172.30.140.0/24'), parseCidr('10.1.2.3')];
  assert.ok(ipInCidrs('172.30.140.7', c));
  assert.ok(ipInCidrs('10.1.2.3', c));
  assert.ok(!ipInCidrs('10.1.2.4', c));
  assert.ok(!ipInCidrs('172.30.141.1', c));
  assert.ok(!ipInCidrs('::1', c));
  assert.throws(() => parseCidr('172.30.140.0/33'));
  assert.throws(() => parseCidr('nope'));
  assert.ok(cameThroughCloudflare({ 'cf-connecting-ip': '1.2.3.4' }));
  assert.ok(cameThroughCloudflare({ 'cdn-loop': 'cloudflare; loops=1' }));
  assert.ok(!cameThroughCloudflare({ host: 'x' }));
});

test('/probe answers PING, closes on anything else, enforces the per-socket limits', async () => {
  const s = await bootTestServer();
  try {
    const w = new Writer(64);
    const ws = await openWs(s.ws + '/probe');
    for (let i = 0; i < 3; i++) {
      ws.send(encodePing(w, 1000 + i));
      const m = await nextMessage(ws);
      assert.equal(m.op, S2C.PONG);
      assert.equal(m.clientTime, 1000 + i);
      await new Promise((r) => setTimeout(r, PROBE.MIN_GAP_MS + 5));
    }
    ws.send(encodeReady(w));
    const { code } = await waitClose(ws);
    assert.equal(code, 1008);

    // too fast → closed
    const ws2 = await openWs(s.ws + '/probe');
    ws2.send(encodePing(w, 1)); ws2.send(encodePing(w, 2)); ws2.send(encodePing(w, 3));
    assert.equal((await waitClose(ws2)).code, 4006);
    assert.equal(s.app.get('netprobe').stats().open, 0);
  } finally { await s.app.stop('test'); }
});

test('/probe caps sockets per address', async () => {
  const s = await bootTestServer();
  const socks = [];
  try {
    for (let i = 0; i < PROBE.MAX_PER_IP; i++) socks.push(await openWs(s.ws + '/probe'));
    await assert.rejects(openWs(s.ws + '/probe'), (e) => e.status === 429);
    socks.pop().close();
    await new Promise((r) => setTimeout(r, 100));
    socks.push(await openWs(s.ws + '/probe'));
  } finally { for (const x of socks) x.terminate(); await s.app.stop('test'); }
});

test('POST /v1/netprobe stores results, rate-limits, admin summary aggregates by carrier', async () => {
  const s = await bootTestServer();
  try {
    const post = (body, headers = {}) => fetch(s.game + '/v1/netprobe', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    let r = await post(good);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
    assert.ok(j.id > 0);
    r = await post({ ...good, carrier: 'fpt', netType: 'wifi', medianMs: 12, minMs: 9, p95Ms: 20, maxMs: 25 }, { 'cf-connecting-ip': '203.0.113.9' });
    assert.equal(r.status, 200);
    r = await post({ ...good, carrier: 'xx' });
    assert.equal(r.status, 400);
    // per-address limit: 6 per 10 min (the limiter runs before validation, so the 400 above counted too)
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await post(good)).status;
    assert.equal(last, 429);

    // admin summary needs the token
    const tok = s.config.secrets.adminToken;
    assert.equal((await fetch(s.admin + '/admin/api/netprobe')).status, 401);
    const a = await (await fetch(s.admin + '/admin/api/netprobe', { headers: { authorization: 'Bearer ' + tok } })).json();
    const vt = a.summary.find((x) => x.carrier === 'viettel' && x.netType === '4g');
    assert.ok(vt && vt.n >= 1);
    assert.equal(vt.medianMs, 41.2);
    const fpt = a.recent.find((x) => x.carrier === 'fpt');
    assert.equal(fpt.via, 'tunnel');
    assert.equal(a.recent.find((x) => x.carrier === 'viettel').via, 'local');
    // nothing personal is stored
    const cols = (await s.app.db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'netprobe_results'`)).rows.map((x) => x.column_name);
    for (const c of cols) assert.ok(!/ip|agent|account|user/.test(c), c);
    assert.equal(await s.app.get('netprobe').purge(0), 5);   // 2 + 3 accepted before the limiter tripped
  } finally { await s.app.stop('test'); }
});

test('admin edge guard: Cloudflare headers and edge-network sources are refused on the admin port', async () => {
  const prev = process.env.ADMIN_DENY_CIDRS;
  process.env.ADMIN_DENY_CIDRS = '127.0.0.0/8';     // pretend loopback is the edge network
  let s = await bootTestServer();
  try {
    const r = await fetch(s.admin + '/healthz');
    assert.equal(r.status, 403);
    assert.equal((await fetch(s.game + '/healthz')).status, 200);   // game port unaffected
  } finally { await s.app.stop('test'); if (prev === undefined) delete process.env.ADMIN_DENY_CIDRS; else process.env.ADMIN_DENY_CIDRS = prev; }

  s = await bootTestServer();
  try {
    assert.equal((await fetch(s.admin + '/healthz')).status, 200);
    assert.equal((await fetch(s.admin + '/healthz', { headers: { 'cf-connecting-ip': '1.2.3.4' } })).status, 403);
    assert.equal((await fetch(s.admin + '/metrics', { headers: { 'cdn-loop': 'cloudflare' } })).status, 403);
    const tok = s.config.secrets.adminToken;
    assert.equal((await fetch(s.admin + '/admin/api/status', { headers: { authorization: 'Bearer ' + tok, 'cf-ray': 'abc' } })).status, 403);
    // and secrets never leak in responses
    const txt = await (await fetch(s.admin + '/metrics')).text();
    assert.ok(!txt.includes(tok));
  } finally { await s.app.stop('test'); }
});
