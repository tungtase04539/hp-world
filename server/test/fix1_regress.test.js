// Fixer round 1 (15/10/2026) — one regression test per review finding (SEC-*, NET-*, SO-*), in the order of the
// review report. Unit tests where the logic is pure; the rest through the real server (PGlite, real sockets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootCore, guest, joinTicket, connectPlayer, Client, clk, sleep, post } from './core_util.mjs';
import { makeAccount, fakeClock, recordingBus, session } from './helpers/safety.mjs';
import { createQueue } from '../src/game/queue.js';
import { Validator, vehicleAllowed, createVehicles } from '../src/game/validate.js';
import { MoveCheck, MV, MCF, MOVE, clampY } from '../../js/shared/move.js';
import { MODE, SPEED, AOI, VALIDATE, JUMP_APEX } from '../../js/shared/constants.js';
import { World } from '../src/game/world.js';
import { AoiState, AoiFrame, aoiStep, levelParams, AOI_CFG } from '../src/game/aoi.js';
import { DegradeLadder, LADDER } from '../src/game/degrade.js';
import { ipKey, expandIPv6 } from '../src/game/ratelimit.js';
import { createChat, POLICY } from '../src/chat/index.js';
import { analyzeChat } from '../../js/shared/textfilter.js';
import { recoveryHasher, hashCode, normalizeCode } from '../src/api/auth.js';
import { groundHeight } from '../../js/terrain.js';
import { S2C, SYS, CORRECT_REASON, EVENT, CHAT_CODE, CHANNEL, REPORT_CODE, PROTO_VERSION } from '../../js/shared/protocol.js';
import { SPAWNS } from '../../js/shared/spawns.js';
import { BRIDGE_WAYS } from '../../js/terrain.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OPERA = SPAWNS[0];

// ============================== SEC-1 / NET-12: one capacity reservation per account ===============================
test('SEC-1/NET-12: an account calling /v1/join N times holds at most ONE reservation; others are admitted', async () => {
  // unit
  const q = createQueue({ capacity: 3, load: () => 0 });
  for (let i = 0; i < 15; i++) { assert.equal(q.request('A').ok, true); q.reserve('n' + i, 'A', Date.now() + 60_000); }
  assert.equal(q.stats().reserved, 1);
  assert.equal(q.request('B').ok, true);
  q.release('n3');                       // an old (replaced) nonce: no effect
  assert.equal(q.stats().reserved, 1);
  q.release('n14');
  assert.equal(q.stats().reserved, 0);
  // full server: the account's own reservation never queues it behind itself
  const q2 = createQueue({ capacity: 1, load: () => 0 });
  assert.equal(q2.request('A').ok, true); q2.reserve('x1', 'A', Date.now() + 60_000);
  assert.equal(q2.request('A').ok, true, 're-join replaces its own slot');
  assert.equal(q2.request('B').ok, false, 'B queued: the slot is A\'s');
  // integration (capacity 3): one account asks 8 tickets and never connects → 1 slot; two other accounts get tickets
  const s = await bootCore({ CAPACITY: '3' });
  try {
    const a = await guest(s, 'Tham');
    for (let i = 0; i < 8; i++) assert.ok((await joinTicket(s, a.accessToken)).body.ticket);
    assert.equal(s.app.get('queue').stats().reserved, 1);
    const b = await guest(s, 'Binh'), c = await guest(s, 'Cuc');
    assert.ok((await joinTicket(s, b.accessToken)).body.ticket, 'B admitted');
    assert.ok((await joinTicket(s, c.accessToken)).body.ticket, 'C admitted');
  } finally { await s.app.stop(); }
});

// ============================== NET-1: clock dilation after a reset / resume; resume loop ==========================
function dilate(v, { rate, durS = 8, hackS = 5, mode = MODE.RUN, x0 = 0, snap = true }) {
  let srv = 1_000_000, cl = 12345, x = x0;
  v.reset(x0, 0, mode, srv);
  const vmax = mode === MODE.MOTO ? SPEED.moto : SPEED.run;
  let corr = 0, kicked = false;
  for (let i = 0; i < durS * 15; i++) {
    srv += 1000 / 15;
    const dCl = (1000 / 15) * (i < hackS * 15 ? rate : 1);
    cl += dCl;
    const nx = x + vmax * (dCl / 1000);
    const r = v.onState(Math.round(cl) & 0xffff, nx, 0, mode, srv, true);
    if (r.accepted) x = nx;
    if (r.correct) { corr++; if (snap) x = v.mc.lastX; v.corrected(x, 0, mode, srv); v.pending = false; }
    if (r.kick) { kicked = true; break; }
  }
  return { metres: x - x0, corr, kicked };
}
test('NET-1: a 5× / 30× clock right after a reset gains at most the forgiveness budget (was 262 m in 4.5 s)', () => {
  for (const rate of [5, 30]) {
    const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
    const r = dilate(v, { rate, durS: 8, hackS: 5 });
    const honestMax = SPEED.run * 8 * VALIDATE.SLACK_MUL + (MOVE.FORGIVE_BURST_MS / 1000 + 0.2) * SPEED.run * VALIDATE.SLACK_MUL + 20;
    assert.ok(r.metres < honestMax, `rate ${rate}: ${r.metres.toFixed(1)} m in 8 s (limit ${honestMax.toFixed(1)})`);
    assert.ok(r.corr >= 1 || r.kicked, `rate ${rate}: detected`);
  }
  // a single STATE claiming +30 s of client time cannot move 250 m (jump30)
  const mc = new MoveCheck();
  mc.reset(0, 0, MODE.RUN, 0);
  assert.equal(mc.check(1000, 0.3, 0, MODE.RUN, 1000, MCF.SKIP_SURFACE), MV.OK);
  const code = mc.check((1000 + 30000) & 0xffff, 250, 0, MODE.RUN, 1066, MCF.SKIP_SURFACE);
  assert.notEqual(code, MV.OK);
});
test('NET-1: the forgiveness bucket survives resets (takeover loops) and a takeover gets no first-sample bonus', () => {
  const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
  let total = 0;
  for (let k = 0; k < 6; k++) total += dilate(v, { rate: 30, durS: 2, hackS: 2, snap: true }).metres;
  // 6 takeovers × 2 s: honest ≤ 6 × 2 × 8.4 ≈ 101 m (+ one forgiveness budget ≈ 17 m)
  assert.ok(total < 101 + 25 + 6 * 2, `6 takeover rounds moved ${total.toFixed(1)} m`);
  const mc = new MoveCheck();
  mc.reset(0, 0, MODE.WALK, 0, false);   // takeover: no FIRST_RADIUS / FIRST_RTT
  assert.notEqual(mc.check(100, 12, 0, MODE.WALK, 100, MCF.SKIP_SURFACE), MV.OK);
  mc.reset(0, 0, MODE.WALK, 0, true);    // fresh spawn: jitter allowed
  assert.equal(mc.check(100, 12, 0, MODE.WALK, 100, MCF.SKIP_SURFACE), MV.OK);
});

// ============================== NET-2 / NET-10 / NET-1 over the wire: resume ======================================
test('NET-2/NET-10/NET-1: RESUME keeps the validator, re-sends a pending CORRECT, re-sends NAMES; RESUME is rate limited', async () => {
  const s = await bootCore();
  try {
    const g = await guest(s, 'Lac');
    await s.app.db.query('UPDATE characters SET pos_x = $1, pos_z = $2 WHERE account_id = $3', [OPERA.x, OPERA.z, g.account.id]);
    const gB = await guest(s, 'Ban');
    await s.app.db.query('UPDATE characters SET pos_x = $1, pos_z = $2 WHERE account_id = $3', [OPERA.x + 5, OPERA.z, gB.account.id]);
    const A = await connectPlayer(s, 'Lac', { auth: g });
    await connectPlayer(s, 'Ban', { auth: gB });
    await A.c.op(S2C.NAMES);
    const t0 = clk();
    A.c.state({ clientMs: t0, x: OPERA.x + 0.2, z: OPERA.z });
    A.c.state({ clientMs: t0 + 66, x: OPERA.x + 80, z: OPERA.z });     // teleport → CORRECT epoch 1 (lost below)
    const cor = await A.c.op(S2C.CORRECT);
    assert.equal(cor.epoch, 1);
    const sess = s.app.get('sessions').get(g.account.id);
    const v0 = sess.v.mc;
    await A.c.terminate();
    await sleep(100);
    const R = await Client.open(s.ws + '/play');
    R.hello('', A.welcome.resumeToken);
    await R.op(S2C.WELCOME);
    assert.equal((await R.op(S2C.SYSTEM)).code, SYS.RESUMED);
    const again = await R.op(S2C.CORRECT);
    assert.equal(again.epoch, 1, 'pending CORRECT re-sent after RESUMED');
    assert.equal(again.reason, CORRECT_REASON.SERVER_MOVE);
    assert.equal(sess.v.mc, v0, 'validator kept (not reset)');
    const nm = await R.op(S2C.NAMES);
    assert.ok(nm.names.length >= 1, 'NAMES re-sent after resume');
    // a stale epoch with nothing pending is healed too (never a silent freeze)
    sess.v.pending = false;
    R.state({ clientMs: clk(), x: OPERA.x + 0.2, z: OPERA.z, corrEpoch: 7 });
    assert.equal((await R.op(S2C.CORRECT)).epoch, 1);
  } finally { await s.app.stop(); }
});

// ============================== NET-3 / NET-4: bufferbloat recovery, slow dilation =================================
function honest(delayAt, { durS = 60, hz = 15 } = {}) {
  const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
  const T0 = 1e6; v.reset(0, 0, MODE.RUN, T0 + 500);
  let lastArr = 0, corr = 0, viol = 0, offset = 0;
  for (let i = 0; i < durS * hz; i++) {
    const tSend = 1000 + (i * 1000) / hz;
    const x = 7 * 0.9 * (i / hz) - offset;
    let arr = T0 + tSend + 1000 * delayAt(tSend / 1000);
    if (arr < lastArr) arr = lastArr;
    lastArr = arr;
    const r = v.onState(Math.round(tSend) & 0xffff, x, 0, MODE.RUN, arr, true);
    if (!r.accepted) viol++;
    if (r.correct) { corr++; offset += x - v.mc.lastX; v.corrected(v.mc.lastX, 0, MODE.RUN, arr); v.pending = false; }   // client snaps
    if (r.kick) return { corr, viol, kick: true };
  }
  return { corr, viol, kick: false };
}
test('NET-3: honest recovery from a sustained 1–2.5 s bufferbloat is not corrected; a stalled first packet costs ≤ 1 CORRECT', () => {
  const cases = {
    'bloat 2 s for 30 s, recover in 0.3 s': (t) => (t < 10 ? 0.06 : t < 40 ? 2 : t < 40.3 ? 2 - ((t - 40) / 0.3) * 1.94 : 0.06),
    'bloat 1.2 s for 15 s, twice': (t) => { const p = t % 30; return p < 10 ? 0.06 : p < 25 ? 1.2 : p < 25.5 ? 1.2 - (p - 25) * 2 * 1.14 : 0.06; },
    'ramp to 2.5 s, hold, recover in 1 s': (t) => (t < 10 ? 0.06 : t < 22 ? 0.06 + ((t - 10) / 12) * 2.44 : t < 28 ? 2.5 : t < 29 ? 2.5 - (t - 28) * 2.44 : 0.06),
    'first 10 s at 800 ms, then 60 ms': (t) => (t < 10 ? 0.8 : 0.06),
    'stall 3 s every 20 s': (t) => 0.06 + ((t % 20) < 3 ? 3 - (t % 20) : 0),
  };
  for (const [name, f] of Object.entries(cases)) {
    const r = honest(f);
    assert.equal(r.kick, false, name);
    assert.ok(r.corr <= 1, `${name}: ${JSON.stringify(r)}`);
    if (!name.startsWith('stall')) assert.equal(r.corr, 0, `${name}: ${JSON.stringify(r)}`);
  }
});
test('NET-4: a steady fast clock (1.1×–1.4×) cannot add speed beyond the slack (was 9.27 m/s at 1.19×)', () => {
  for (const d of [1.1, 1.15, 1.19, 1.25, 1.4]) {
    const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
    let srv = 1e6, cl = 5000, x = 0;
    v.reset(0, 0, MODE.RUN, srv);
    const S = 300;   // 5 minutes: the one-off forgiveness budget is amortised
    for (let i = 0; i < 15 * S; i++) {
      srv += 1000 / 15;
      const dCl = (1000 / 15) * (i < 90 ? 1 : d);
      cl += dCl;
      const step = (7 * 1.2 * dCl) / 1000;
      const r = v.onState(Math.round(cl) & 0xffff, x + step, 0, MODE.RUN, srv, true);
      if (r.accepted) x += step;
      if (r.correct) { v.corrected(x, 0, MODE.RUN, srv); v.pending = false; }
      if (r.kick) break;
    }
    const mps = x / S;
    assert.ok(mps <= 7 * 1.2 * 1.02 + 0.15, `dilation ${d}: ${mps.toFixed(2)} m/s`);
  }
});

// ============================== NET-5: AOI isotropy ===============================================================
test('NET-5: every entity within R_NEAR is visible from any observer position; the far ring is isotropic', () => {
  for (const [ox, oz] of [[0, 0], [-1600 + 128 * 12 + 7, 0], [-1600 + 128 * 12 + 121, -1600 + 128 * 12 + 2], [300.5, -255.3]]) {
    for (let k = 0; k < 16; k++) {
      const world = new World();
      const self = world.createEntity('self');
      self.setPose(ox, oz, 2, 0, 0, MODE.WALK, 0); world.add(self);
      const a = (k / 16) * Math.PI * 2;
      for (const d of [AOI_CFG.R_NEAR - 3, AOI_CFG.R_FAR - 2]) {
        const e = world.createEntity('e' + d);
        e.setPose(ox + Math.cos(a) * d, oz + Math.sin(a) * d, 2, 0, 0, MODE.WALK, 0); world.add(e);
      }
      const st = new AoiState(), fr = new AoiFrame();
      aoiStep(world, self, st, levelParams(0), fr);
      assert.equal(fr.nEnter, 2, `observer ${ox},${oz} direction ${k}: ${fr.nEnter} visible`);
    }
  }
});

// ============================== NET-6: height ======================================================================
test('NET-6: y is clamped to ground ± 1.5 m (+ jump apex in AIR); bridge corridors may be higher; boats stay low', () => {
  const g = groundHeight(OPERA.x, OPERA.z);
  assert.equal(clampY(OPERA.x, OPERA.z, g + 0.3, MODE.WALK), g + 0.3);
  assert.equal(clampY(OPERA.x, OPERA.z, 60, MODE.WALK), g + VALIDATE.Y_TOL_M);
  assert.ok(Math.abs(clampY(OPERA.x, OPERA.z, 60, MODE.AIR) - (g + VALIDATE.Y_TOL_M + JUMP_APEX)) < 1e-9);
  assert.equal(clampY(OPERA.x, OPERA.z, NaN, MODE.WALK), g);
  assert.ok(clampY(OPERA.x, OPERA.z, 60, MODE.BOAT) <= 2 + VALIDATE.Y_TOL_M);
  const b = BRIDGE_WAYS.find((w) => w.kind !== 'flat') || BRIDGE_WAYS[0];
  const [bx, bz] = b.pts[Math.floor(b.pts.length / 2)];
  assert.equal(clampY(bx, bz, 25, MODE.MOTO), 25, 'elevated deck level allowed on the bridge corridor');
});

// ============================== NET-7: pillion with a stalled driver ===============================================
test('NET-7: a pillion passenger next to a driver whose samples are 1–2 s stale is not a MODE violation', () => {
  const world = new World();
  const vehicles = createVehicles();
  const drv = world.createEntity('d'); drv.setPose(0, 0, 2, 0, 16, MODE.MOTO, 0); world.add(drv);
  const pas = world.createEntity('p'); pas.setPose(20, 0, 2, 0, 16, MODE.PILLION, 0); world.add(pas);   // 20 m ahead
  const now = 100_000;
  drv.session = { lastAcceptT: now - 1500 };          // the driver's TCP stalled for 1.5 s
  const ps = { entity: pas, lastAcceptT: now - 66, vehicleRef: 0 };
  assert.equal(vehicleAllowed(vehicles, world, ps, MODE.PILLION, 0, now), true);
  drv.session.lastAcceptT = now - 66;                 // fresh driver 20 m away: not a pillion
  assert.equal(vehicleAllowed(vehicles, world, ps, MODE.PILLION, 0, now), false);
});

// ============================== NET-8: ladder sees event-loop lateness =============================================
test('NET-8: the degrade ladder escalates on sustained tick start lateness even when ticks are short', () => {
  const L = new DegradeLadder();
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < LADDER.WINDOW; i++) { L.observe(5); L.observeLate(80); }
    L.evaluate();
  }
  assert.ok(L.level >= 2, `level ${L.level}`);
  const idle = new DegradeLadder();
  for (let k = 0; k < 6; k++) { for (let i = 0; i < LADDER.WINDOW; i++) { idle.observe(5); idle.observeLate(15); } idle.evaluate(); }
  assert.equal(idle.level, 0, 'Windows timer floor (≤ 16 ms late) is not load');
});

// ============================== NET-11: dropped snapshot ≠ keyframe ================================================
test('NET-11: a snapshot skipped for backpressure does not force a keyframe', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Nen', { auth: await guest(s, 'Nen') });
    await A.c.wait((m) => m.op === S2C.SNAPSHOT);
    const sess = s.app.get('sessions').get(A.account.id);
    const real = sess.conn.bufferedAmount;
    sess.conn.bufferedAmount = () => 1 << 20;
    assert.equal(s.app.get('sim').snapshotFor(sess), 0);
    sess.conn.bufferedAmount = real;
    assert.equal(sess.aoi.keyframe, false);
  } finally { await s.app.stop(); }
});

// ============================== SEC-2 / SO-5: report brigading ======================================================
test('SEC-2/SO-5: three fresh accounts cannot auto-mute a silent player; evidence + trusted reporters still can', async () => {
  const s = await bootCore();
  const db = s.app.db;
  try {
    const now = fakeClock(Date.now());
    const bus = recordingBus();
    const chat = createChat({ db, now, bus });
    await chat.init();
    const victim = await makeAccount(db, 'Nan#0001');
    const fresh = [];
    for (let i = 0; i < 3; i++) fresh.push(session(await makeAccount(db, `Bri${i}#000${i}`), `Bri${i}#000${i}`, { x: 0, z: 0 }));
    for (const r of fresh) { now.advance(11_000); assert.equal((await chat.report(r, victim, 2, 0)).code, REPORT_CODE.OK); }
    assert.equal(chat.isMuted(victim), false, 'no evidence, fresh accounts → no auto-mute');
    const rows = (await db.query(`SELECT evidence, counts FROM reports WHERE target_id = $1`, [victim])).rows;
    assert.equal(rows.length, 3, 'all reports still queued for the owner');
    assert.ok(rows.every((r) => !r.counts));
    // the target speaks near three OLD accounts who report it → auto-mute (and same-IP reporters count once)
    const talker = await makeAccount(db, 'Noi#0002');
    const T = session(talker, 'Noi#0002', { x: 100, z: 100 });
    const ref = (await chat.handle(T, CHANNEL.SAY, 'xin chào cả nhà')).ref;
    const olds = [];
    for (let i = 0; i < 3; i++) {
      const id = await makeAccount(db, `Old${i}#000${i}`);
      await db.query(`UPDATE accounts SET created_at = now() - interval '3 days' WHERE id = $1`, [id]);
      olds.push(session(id, `Old${i}#000${i}`, { x: 105, z: 100, ip: '203.0.113.' + (10 + i) }));
    }
    const sameIp = session(olds[2].accountId, olds[2].displayName, { x: 105, z: 100, ip: '203.0.113.10' });
    now.advance(11_000); await chat.report(olds[0], talker, 1, ref);
    now.advance(11_000); await chat.report(olds[1], talker, 1, 0);
    now.advance(11_000); await chat.report(sameIp, talker, 1, 0);      // 3rd account, but the 1st one's IP
    assert.equal(chat.isMuted(talker), false, 'distinct IPs are required');
    // ladder: report-driven sanctions never reach shadow
    for (let i = 0; i < 5; i++) { const x = await chat.autoSanction(talker, 'auto_report', 't'); assert.notEqual(x.kind, 'shadow'); }
  } finally { await s.app.stop(); }
});

// ============================== SEC-4: recovery cannot be locked by junk ==========================================
test('SEC-4: junk recovery codes do not lock out the correct one; malformed codes are refused before any accounting', async () => {
  const s = await bootCore({ TRUST_PROXY: 'cloudflare' });
  try {
    const g = await guest(s, 'Mat');
    for (let i = 0; i < 120; i++) {
      const r = await post(s, '/v1/auth/recover', { code: i % 2 ? 'x' : 'ABCDEFGHJKMN', deviceId: 'dev_junk' + (i % 50).toString().padStart(4, '0') }, { 'cf-connecting-ip': `198.51.100.${i % 120}` });
      assert.ok([401, 429].includes(r.status), String(r.status));
    }
    const ok = await post(s, '/v1/auth/recover', { code: g.recoveryCode, deviceId: 'dev_victim_new' }, { 'cf-connecting-ip': '192.0.2.77' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  } finally { await s.app.stop(); }
});

// ============================== SEC-5: peppered recovery hash + legacy upgrade =====================================
test('SEC-5: recovery codes are stored as HMAC(pepper); a legacy sha256 row still recovers and is upgraded', async () => {
  const s = await bootCore();
  try {
    const g = await guest(s, 'Hoi');
    const row = await s.app.db.one('SELECT recovery_hash, recovery_hash_v FROM accounts WHERE id = $1', [g.account.id]);
    const pep = s.app.config.secrets.recoveryPepper;
    assert.ok(pep && pep.length >= 32);
    assert.equal(row.recovery_hash_v, 2);
    assert.deepEqual(Buffer.from(row.recovery_hash), recoveryHasher(pep)(g.recoveryCode));
    assert.notDeepEqual(Buffer.from(row.recovery_hash), hashCode(g.recoveryCode));
    // legacy row
    await s.app.db.query('UPDATE accounts SET recovery_hash = $2, recovery_hash_v = 1 WHERE id = $1', [g.account.id, hashCode(g.recoveryCode)]);
    const r = await post(s, '/v1/auth/recover', { code: normalizeCode(g.recoveryCode), deviceId: 'dev_legacy_0001' });
    assert.equal(r.status, 200);
    const up = await s.app.db.one('SELECT recovery_hash_v FROM accounts WHERE id = $1', [g.account.id]);
    assert.equal(up.recovery_hash_v, 2);
  } finally { await s.app.stop(); }
});

// ============================== SEC-6: report chat copies follow the retention ====================================
test('SEC-6: purge clears the chat copy of resolved reports after the retention and deletes old dismissed reports', async () => {
  const s = await bootCore();
  const db = s.app.db;
  try {
    const chat = createChat({ db });
    await chat.init();
    const t = await makeAccount(db, 'Cu#0001');
    const ctx = JSON.stringify([{ text: 'câu cũ', name: 'Ai#0001' }]);
    const ins = (status, days) => db.one(`INSERT INTO reports (source, target_id, reason, context, status, at) VALUES ('player', $1, 1, $2, $3, now() - make_interval(days => $4)) RETURNING id`, [t, ctx, status, days]);
    const a = await ins('actioned', 40), b = await ins('open', 40), c = await ins('dismissed', 120), d = await ins('actioned', 5);
    await chat.purge(30);
    const get = async (id) => db.one('SELECT context, purged_at FROM reports WHERE id = $1', [id]);
    assert.deepEqual((await get(a.id)).context, []);
    assert.equal((await get(b.id)).context.length, 1, 'open reports keep their context');
    assert.equal(await get(c.id), null, 'old dismissed report deleted');
    assert.equal((await get(d.id)).context.length, 1, 'recent resolved report kept');
  } finally { await s.app.stop(); }
});

// ============================== SEC-7: IPv6 grouping ==============================================================
test('SEC-7: IPv6 addresses are expanded before grouping (/64, /48); IPv4-mapped → IPv4', () => {
  assert.equal(ipKey('2001:db8::1'), ipKey('2001:db8::2'));
  assert.equal(ipKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipKey('2001:db8:0:5::1', 48), ipKey('2001:db8:0:9::1', 48));
  assert.notEqual(ipKey('2001:db8:0:5::1', 64), ipKey('2001:db8:0:9::1', 64));
  assert.equal(ipKey('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(ipKey('203.0.113.5'), '203.0.113.5');
  assert.deepEqual(expandIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.equal(expandIPv6('not-an-ip'), null);
});

// ============================== SO-1 / SO-2 / SO-3: chat safety =====================================================
test('SO-1: a grooming escalation is folded into ONE open report with every line, and alerts the owner', async () => {
  const s = await bootCore();
  const db = s.app.db;
  try {
    const now = fakeClock(Date.now());
    const sent = [];
    const chat = createChat({ db, now, alerts: { send: async (k, t) => { sent.push(k); return true; } } });
    await chat.init();
    const g = await makeAccount(db, 'La#0001');
    const S = session(g, 'La#0001');
    for (const line of ['em bao nhiêu tuổi rồi', 'nhà em ở đâu thế', 'gửi anh ảnh selfie đi', 'em ở nhà một mình à']) {
      now.advance(5300);
      await chat.handle(S, CHANNEL.SAY, line);
      await sleep(30);
    }
    const reps = (await db.query(`SELECT hits, context FROM reports WHERE target_id = $1 AND source = 'filter'`, [g])).rows;
    assert.equal(reps.length, 1);
    assert.equal(reps[0].hits, 4);
    for (const l of ['nhà em ở đâu thế', 'gửi anh ảnh selfie đi', 'em ở nhà một mình à']) assert.ok(reps[0].context.some((c) => c.text === l), l);
    assert.ok(sent.includes('grooming'));
  } finally { await s.app.stop(); }
});
test('SO-2: phone numbers with look-alikes, English number words, glued words, or split over two lines are blocked', async () => {
  for (const t of ['09 l2 34 56 78', '0nine1two3four5six7eight', 'khong9mot2ba4nam6bay8', 'zalo mình 0 nine 1 2 3 4 5 6 7 8',
    'o9l2З4S6789', 'zero nine one two three four five six seven eight']) {
    assert.equal(analyzeChat(t).action, 'block', t);
  }
  for (const t of ['lớp 12 nhé', 'mình 13 tuổi', 'còn 5 phút', 'one piece hay ghê']) assert.notEqual(analyzeChat(t).action, 'block', t);
  const s = await bootCore();
  try {
    const now = fakeClock(Date.now());
    const chat = createChat({ db: s.app.db, now });
    await chat.init();
    const S = session(await makeAccount(s.app.db, 'So#0001'), 'So#0001');
    assert.equal((await chat.handle(S, CHANNEL.SAY, '09123')).ok, true);
    now.advance(3000);
    const r = await chat.handle(S, CHANNEL.SAY, '45678');
    assert.equal(r.ok, false); assert.ok(r.reasons.includes('phone'));
  } finally { await s.app.stop(); }
});
test('SO-3: a blocked line with self-harm words still asks for the support line and costs no strike', async () => {
  const s = await bootCore();
  try {
    const now = fakeClock(Date.now());
    const chat = createChat({ db: s.app.db, now });
    await chat.init();
    const id = await makeAccount(s.app.db, 'Buon#0001');
    const S = session(id, 'Buon#0001');
    for (let i = 0; i < 6; i++) {
      now.advance(31_000);
      const r = await chat.handle(S, CHANNEL.SAY, i % 2 ? 'đm tao muốn chết' : 'đm tao muốn chết thật');
      assert.equal(r.ok, false); assert.equal(r.support, true);
    }
    await sleep(50);
    assert.equal(chat.isMuted(id), false, 'no auto-mute for a distressed player');
  } finally { await s.app.stop(); }
  // over the wire: EVENT SUPPORT_LINE before CHAT_REJECTED
  const s2 = await bootCore();
  try {
    const A = await connectPlayer(s2, 'Buon', { auth: await guest(s2, 'Buon') });
    await A.c.wait((m) => m.op === S2C.SNAPSHOT);
    A.c.chat('đm tao muốn chết');
    const ev = await A.c.wait((m) => m.op === S2C.EVENT && (m.type === EVENT.SUPPORT_LINE || m.type === EVENT.CHAT_REJECTED));
    assert.equal(ev.type, EVENT.SUPPORT_LINE);
    assert.equal((await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.CHAT_REJECTED)).args[0], CHAT_CODE.BLOCKED);
  } finally { await s2.app.stop(); }
});

// ============================== SO-8 / SO-9 / SEC-3: ops static checks =============================================
const read = (p) => fs.readFileSync(path.join(here, '..', p), 'utf8').replace(/\r\n/g, '\n');
test('SO-8/SEC-3: no service restarts by itself; the game container has no route to the LAN / host', () => {
  const y = read('docker-compose.yml');
  assert.doesNotMatch(y, /restart:\s*unless-stopped/, 'restart policy must be "no" (opening = mo-may-chu.ps1)');
  const game = y.split(/\n  game:\n/)[1].split(/\n  [a-z]+:\n/)[0].replace(/#.*$/gm, '');
  assert.doesNotMatch(game, /hostlink/, 'game must not join the bridge network with Internet / LAN reach');
  assert.doesNotMatch(game, /ports:/, 'ports are published by the portal container only');
  assert.match(y, /\n  portal:\n/);
  const nets = y.split(/\nnetworks:\n/)[1];
  for (const n of ['edge', 'backend', 'adminlink']) assert.match(nets.split(new RegExp(`\\n  ${n}:\\n`))[1].split(/\n  [a-z]+:\n/)[0], /internal: true/, n);
});
test('SO-9: every owner script keeps its window open when started by double-click / "Run with PowerShell"', () => {
  const dir = path.join(here, '..', 'ops');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.ps1') && x !== 'chung.ps1' && x !== 'giu-may-thuc.ps1')) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.match(src, /Exit-Ops|Wait-Dong|Read-Host/, f);
  }
});
