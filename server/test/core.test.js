// config, log, metrics, app (bus / timers / services), router units, transport backpressure + IP helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, ensureEnvFile, parseEnv, publicConfig, SECRET_KEYS } from '../src/config.js';
import { createLogger } from '../src/log.js';
import { createMetrics } from '../src/metrics.js';
import { createBus, createTimers, createServices } from '../src/app.js';
import { createRouter, originMatcher, httpError } from '../src/http/router.js';
import { createTransport, clientIp, loadUws } from '../src/net/transport.js';
import { openWs, waitClose } from './helpers/client.mjs';

test('config: .env parsing, first-run generation, precedence, validation', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nexport B = "two words"\nC=x # trailing\nbad line\nD=\'q\'\nE=    # only a comment'), { A: '1', B: 'two words', C: 'x', D: 'q', E: '' });
  // .env.example parses to defaults / empty secrets (copying it must not create junk secrets)
  const ex = parseEnv(fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf8'));
  for (const k of SECRET_KEYS) assert.equal(ex[k], '', k);
  const exCfg = loadConfig({ env: {}, envFile: null, overrides: ex });
  assert.equal(exCfg.game.port, 9100); assert.equal(exCfg.db.driver, 'pglite'); assert.equal(exCfg.transport, 'auto');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpcfg-'));
  try {
    const f = path.join(dir, '.env');
    const r1 = ensureEnvFile(f);
    assert.equal(r1.created, true);
    const vars = parseEnv(fs.readFileSync(f, 'utf8'));
    for (const k of SECRET_KEYS) assert.ok(vars[k], `missing ${k}`);
    // the JWT key is a valid Ed25519 PKCS#8 key
    const key = crypto.createPrivateKey({ key: Buffer.from(vars.JWT_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
    assert.equal(key.asymmetricKeyType, 'ed25519');
    assert.equal(ensureEnvFile(f).created, false);
    // removing a secret re-adds only that one
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^ADMIN_TOKEN=.*$/m, ''));
    const r3 = ensureEnvFile(f);
    assert.deepEqual(r3.added, ['ADMIN_TOKEN']);
    assert.equal(parseEnv(fs.readFileSync(f, 'utf8')).JWT_PRIVATE_KEY, vars.JWT_PRIVATE_KEY);
    // precedence: overrides > env > file
    const c = loadConfig({ env: { GAME_PORT: '9200' }, envFile: f, overrides: { ADMIN_PORT: '9201' } });
    assert.equal(c.game.port, 9200); assert.equal(c.admin.port, 9201);
    assert.equal(c.secrets.jwtPrivateKey, vars.JWT_PRIVATE_KEY);
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.secrets));
    assert.equal(c.game.host, '127.0.0.1'); assert.equal(c.admin.host, '127.0.0.1');
    assert.equal(c.db.driver, 'pglite');
    assert.equal(c.inviteRequired, true); assert.equal(c.capacity, 1200);
    const d = loadConfig({ env: { IN_DOCKER: '1', DB_URL: 'postgres://u:pw@db:5432/hp' }, envFile: f });
    assert.equal(d.game.host, '0.0.0.0'); assert.equal(d.db.driver, 'pg');
    assert.equal(publicConfig(d).db.url, 'postgres://u:***@db:5432/hp');
    assert.equal(publicConfig(d).secrets.adminToken, '[set]');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.throws(() => loadConfig({ env: { GAME_PORT: 'x' }, envFile: null }), /GAME_PORT/);
  assert.throws(() => loadConfig({ env: { TRANSPORT: 'tcp' }, envFile: null }), /TRANSPORT/);
  assert.throws(() => loadConfig({ env: { NODE_ENV: 'production' }, envFile: null }), /missing secrets/);
  assert.throws(() => loadConfig({ env: { DB_DRIVER: 'pg' }, envFile: null }), /DB_URL/);
  // dev without a file → ephemeral secrets
  const e = loadConfig({ env: {}, envFile: null });
  assert.ok(e.secrets.adminToken.length >= 24);
});

test('log: JSON lines, levels, redaction, child bindings', () => {
  const lines = [];
  const stream = { write: (s) => lines.push(s) };
  const log = createLogger({ level: 'info', stream, bindings: { svc: 't' } });
  log.debug('hidden');
  log.child({ mod: 'm' }).info('hello', { accessToken: 'secret-x', nested: { password: 'p', ok: 1 }, err: new Error('e1') });
  assert.equal(lines.length, 1);
  const rec = JSON.parse(lines[0]);
  assert.equal(rec.msg, 'hello'); assert.equal(rec.svc, 't'); assert.equal(rec.mod, 'm');
  assert.equal(rec.accessToken, '[redacted]'); assert.equal(rec.nested.password, '[redacted]'); assert.equal(rec.nested.ok, 1);
  assert.equal(rec.err.message, 'e1');
  assert.ok(!lines[0].includes('secret-x'));
});

test('metrics: counter, gauge, histogram quantiles, prom text, idempotent registration', () => {
  const m = createMetrics({ processMetrics: false });
  const c = m.counter('x_total', 'x');
  c.inc(); c.inc(2, { op: 'PING' });
  assert.equal(m.counter('x_total'), c);
  assert.throws(() => m.gauge('x_total'));
  m.gauge('g', 'g', () => 42);
  const h = m.histogram('lat_ms', 'lat');
  for (let i = 1; i <= 100; i++) h.observe(i);
  assert.equal(h.quantile(0.5), 50); assert.equal(h.quantile(0.99), 99);
  const txt = m.render();
  assert.match(txt, /# TYPE hp_x_total counter/);
  assert.match(txt, /hp_x_total{op="PING"} 2/);
  assert.match(txt, /hp_g 42/);
  assert.match(txt, /hp_lat_ms_bucket{le="\+Inf"} 100/);
  assert.match(txt, /hp_lat_ms_count 100/);
  assert.equal(m.snapshot().lat_ms.p99, 99);
  const pm = createMetrics();
  assert.match(pm.render(), /hp_process_rss_bytes \d+/);
  pm.stop();
});

test('app: bus isolation, services, timers + fixed-rate loop', async () => {
  const errs = [];
  const log = { error: (m, f) => errs.push([m, f]), info() {}, warn() {}, debug() {} };
  const bus = createBus(log);
  const got = [];
  bus.on('e', () => { throw new Error('bad handler'); });
  const off = bus.on('e', (p) => got.push(p));
  bus.once('e', (p) => got.push('once:' + p));
  assert.equal(bus.emit('e', 1), 3);
  off();
  bus.emit('e', 2);
  assert.deepEqual(got, [1, 'once:1']);
  assert.equal(errs.length, 2);

  const sv = createServices();
  sv.provide('a', 1);
  assert.throws(() => sv.provide('a', 2));
  assert.throws(() => sv.get('b'), /not provided/);
  sv.replace('a', 3);
  assert.equal(sv.get('a'), 3);

  const metrics = createMetrics({ processMetrics: false });
  const timers = createTimers(log, metrics);
  let ticks = 0;
  const loop = timers.loop(50, 'test_loop', () => { ticks++; });
  let fired = false;
  timers.after(30, () => { fired = true; });
  const cancelled = timers.after(30, () => { throw new Error('should not run'); });
  cancelled();
  await new Promise((r) => setTimeout(r, 420));
  loop.cancel();
  assert.ok(fired);
  assert.ok(ticks >= 15 && ticks <= 23, `50 Hz loop ran ${ticks} ticks in ~0.4 s`);
  assert.ok(loop.stats().p99 >= 0);
  timers.clearAll();
  assert.equal(timers.count, 0);
});

test('router: params, wildcard, auth, errors, origin matcher', async () => {
  assert.ok(originMatcher(['http://localhost:*'])('http://localhost:5173'));
  assert.ok(!originMatcher(['http://localhost:*'])('http://localhost.evil.com'));
  assert.ok(!originMatcher(['https://a.github.io'])('https://a.github.io.evil'));
  const r = createRouter({ allowedOrigins: ['https://ok.example'], auth: { admin: (req) => req.headers.authorization === 'Bearer t' } });
  r.get('/p/:id', (req) => ({ id: req.params.id, q: req.queryObj.x }));
  r.get('/s/*', (req) => ({ rest: req.params['*'] }));
  r.get('/secret', () => ({ ok: 1 }), { auth: 'admin' });
  r.get('/boom', () => { throw new Error('x'); });
  r.get('/teapot', () => { throw httpError(418, 'teapot'); });
  r.post('/echo', (req) => req.json);
  const call = async (method, p, { headers = {}, body = '' } = {}) => {
    const [pth, query = ''] = p.split('?');
    let out;
    const res = { sent: false, aborted: false, send(status, h, b) { this.sent = true; out = { status, h, b }; return true; } };
    await r.handle({ method, path: pth, query, url: p, headers, ip: '1.2.3.4', body: async () => Buffer.from(body) }, res);
    return { ...out, json: out.b ? JSON.parse(out.b) : null };
  };
  assert.deepEqual((await call('GET', '/p/a%20b?x=1')).json, { id: 'a b', q: '1' });
  assert.deepEqual((await call('GET', '/s/a/b.png')).json, { rest: 'a/b.png' });
  assert.equal((await call('GET', '/secret')).status, 401);
  assert.equal((await call('GET', '/secret', { headers: { authorization: 'Bearer t' } })).status, 200);
  assert.equal((await call('GET', '/boom')).status, 500);
  assert.equal((await call('GET', '/teapot')).json.error, 'teapot');
  assert.deepEqual((await call('POST', '/echo', { body: '{"a":1}' })).json, { a: 1 });
  assert.equal((await call('POST', '/echo', { body: '{"a":1}', headers: { origin: 'https://bad.example' } })).status, 403);
  const okO = await call('POST', '/echo', { body: '{}', headers: { origin: 'https://ok.example' } });
  assert.equal(okO.h['access-control-allow-origin'], 'https://ok.example');
  assert.equal((await call('OPTIONS', '/echo', { headers: { origin: 'https://bad.example' } })).status, 403);
  assert.ok(r.routes.includes('GET /p/:id'));
});

test('transport helpers: client IP normalisation and Cloudflare header trust', () => {
  assert.equal(clientIp({}, '::ffff:10.0.0.1', 'none'), '10.0.0.1');
  assert.equal(clientIp({}, '0000:0000:0000:0000:0000:ffff:7f00:0001', 'none'), '127.0.0.1');
  assert.equal(clientIp({ 'cf-connecting-ip': '1.2.3.4' }, '127.0.0.1', 'none'), '127.0.0.1');
  assert.equal(clientIp({ 'cf-connecting-ip': '1.2.3.4' }, '127.0.0.1', 'cloudflare'), '1.2.3.4');
});

for (const kind of ['uws', 'ws']) {
  test(`transport (${kind}): send/backpressure/cork/close contract`, { skip: kind === 'uws' && !loadUws() }, async () => {
    const t = await createTransport({ kind, limits: { maxBackpressure: 256 * 1024, idleTimeout: 30 } });
    const events = [];
    let serverConn = null;
    let res;
    const opened = new Promise((r) => { res = r; });
    t.route('/x', {
      open(c) { serverConn = c; c.data = { n: 0 }; events.push('open'); res(); },
      message(c, bytes) { c.data.n += bytes.length; },
      close(c, code) { events.push('close:' + code); },
    });
    const port = await t.listen('127.0.0.1', 0);
    try {
      const ws = await openWs(`ws://127.0.0.1:${port}/x`);
      await opened;
      assert.equal(t.connections, 1);
      assert.ok(serverConn.id > 0);
      assert.equal(serverConn.ip, '127.0.0.1');
      // client does not read → server buffers → send returns 0 at some point, never throws
      ws.pause();
      const chunk = new Uint8Array(16 * 1024);
      let results = new Set();
      serverConn.cork(() => { for (let i = 0; i < 64; i++) results.add(serverConn.send(chunk)); });
      for (let i = 0; i < 64 && serverConn.bufferedAmount() < 200 * 1024; i++) results.add(serverConn.send(chunk));
      assert.ok(results.has(1) || results.has(0));
      assert.ok(serverConn.bufferedAmount() >= 0);
      ws.resume();
      // over maxBackpressure → dropped (2) and socket closed
      const closing = waitClose(ws, 5000).catch(() => ({ code: -2 }));
      ws.pause();
      let dropped = false;
      for (let i = 0; i < 400 && !dropped; i++) if (serverConn.send(new Uint8Array(64 * 1024)) === 2) dropped = true;
      ws.resume();
      assert.ok(dropped, 'send should report 2 once over maxBackpressure');
      await closing;
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(serverConn.closed, true);
      assert.equal(serverConn.send(new Uint8Array(1)), 2);    // closed conn: no throw
      serverConn.close(); serverConn.terminate();              // idempotent
    } finally { await t.close(); }
    assert.ok(events[0] === 'open' && events.some((e) => e.startsWith('close:')));
  });
}
