// Riders fixer (15/10/2026) — honest players and honest bots must never be CORRECTed:
//   1. bot STATE stamp = the time its POSITION belongs to (MP-2 e2e: 28 riding bots corrected in the same millisecond after
//      an event-loop pause inside the shared bot tick loop)                                   → server/bots/lib/bot.mjs
//   2. a bot that gets a FRESH session (server restarted) behaves like the real client: corrEpoch 0, moves to the server's
//      spawn when it is farther than REJOIN_SNAP_M                                             → bot.mjs _rejoin
//   3. mount / dismount spam: the client sends a STATE right after every mount and dismount   → js/net/net.js
//   4. REJOIN_SNAP_M (client keeps its own spot on a fresh session) stays inside the first-sample tolerance
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../src/game/validate.js';
import { MOVE, MCF } from '../../js/shared/move.js';
import { MODE, REJOIN_SNAP_M } from '../../js/shared/constants.js';
import { S2C } from '../../js/shared/protocol.js';
import { SPAWNS } from '../../js/shared/spawns.js';
import { Bot } from '../bots/lib/bot.mjs';
import { buildRoadGraph } from '../bots/lib/roadgraph.mjs';
import { rng } from '../bots/lib/stats.mjs';

const W = () => ({ c: new Proxy({}, { get: (o, k) => o[k] || 0, set: (o, k, v) => { o[k] = v; return true; } }), bump() {}, err() {}, correctReasons: {}, resumeMs: { add() {} }, resumeHsMs: { add() {} } });

// Bots riding towards one point (mp2_int_e2e step 2), ticked like the e2e harness: one shared `now` per 20 ms loop.
// pause(k) → ms the event loop stalls in the MIDDLE of loop k (after half the bots were ticked). stampAtSend: emulate the
// old bug (clientMs read from the clock at send time). Returns violations / corrections over all bots.
function rideWithPauses({ n = 24, durS = 60, pause, stampAtSend = false, seed = 3 }) {
  const ctx = { W: W(), graph: buildRoadGraph(), pool: {}, rand: rng(seed) };
  let clock = 1000;                                    // the harness process clock (performance.now)
  const sp = SPAWNS[0];
  const bots = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot({ idx: i, behavior: 'plaza', target: { x: sp.x, z: sp.z, r: 13 }, travelMode: MODE.MOTO, chat: false, mode: 'full' }, ctx);
    b.t0 = 0;
    const s = SPAWNS[1 + (i % (SPAWNS.length - 1))];
    b._place(s.x, s.z, s.yaw);
    b.state = 'live'; b.lastTick = clock; b.nextStateAt = clock + (i * 7) % 66; b.nextPingAt = Infinity;
    b.val = new Validator(); b.val.reset(b.x, b.z, b.mode, clock, true);
    b.sendRaw = () => true;
    const orig = b.stateMsg.bind(b);
    b.stateMsg = (o) => {
      const m = orig(stampAtSend ? { clientMs: Math.floor(clock - b.t0) & 0xffff, ...o } : o);
      const r = b.val.onState(m.clientMs, m.x, m.z, m.state & 7, clock + 25, true);
      if (!r.accepted) out.viol++;
      if (r.correct) { out.corr++; const mc = b.val.mc; b.val.corrected(mc.lastX, mc.lastZ, b.mode, clock + 25); b.x = mc.lastX; b.z = mc.lastZ; b.v = 0; if (b.walker) { b.walker.x = b.x; b.walker.z = b.z; } }
      return m;
    };
    bots.push(b);
  }
  const out = { viol: 0, corr: 0, states: 0 };
  for (let k = 0; clock < durS * 1000; k++) {
    clock += 20;
    const now = clock;                                 // shared `now` of this loop (mp2_int_e2e.mjs botTimer)
    const p = pause(k);
    bots.forEach((b, i) => { if (i === n >> 1) clock += p; b.tick(now); });
  }
  return out;
}

test('bots: STATE stamped with the position time — pauses inside the shared tick loop cost 0 violations', () => {
  const pause = (k) => (k % 97 === 50 ? 120 + (k % 5) * 40 : 0);    // 120–280 ms stalls every ~2 s (GC, Playwright IPC)
  const fixed = rideWithPauses({ pause });
  assert.equal(fixed.viol, 0, `violations with the fix: ${JSON.stringify(fixed)}`);
  assert.equal(fixed.corr, 0);
  // sensitivity: the old stamping (clock at SEND time) reproduces the MP-2 e2e burst of SPEED corrections
  const old = rideWithPauses({ pause, stampAtSend: true });
  assert.ok(old.corr > 0, `old stamping should be corrected: ${JSON.stringify(old)}`);
});

test('bots: fresh session after a server restart → corrEpoch 0, moved to the server spawn when > REJOIN_SNAP_M', () => {
  const ctx = { W: W(), graph: buildRoadGraph(), pool: {}, rand: rng(5) };
  const sp = SPAWNS[0];
  const mk = () => {
    const b = new Bot({ idx: 1, behavior: 'plaza', target: { x: sp.x, z: sp.z, r: 13 }, travelMode: MODE.MOTO, chat: false, mode: 'full' }, ctx);
    b.sendRaw = () => true;
    b._place(SPAWNS[2].x, SPAWNS[2].z, 0);
    b.corrEpoch = 3; b.mode = MODE.MOTO; b.v = 14;
    return b;
  };
  const welcome = (x, z) => ({ op: S2C.WELCOME, proto: 1, netId: 7, resumeToken: new Uint8Array(16), spawn: { x, z, yaw: 0.5 } });
  // far: adopt the server's anchor (like js/net/net.js applySpawn), on foot, epoch 0
  const far = mk();
  far._onLive(welcome(far.x + 40, far.z));
  assert.equal(far.corrEpoch, 0);
  assert.ok(Math.hypot(far.x - (SPAWNS[2].x + 40), far.z - SPAWNS[2].z) < 1e-6, 'moved to the spawn');
  assert.equal(far.v, 0);
  // near: keep riding where it is (the server's first-sample tolerance covers it)
  const near = mk();
  const x0 = near.x, z0 = near.z;
  near._onLive(welcome(x0 + REJOIN_SNAP_M - 1, z0));
  assert.equal(near.corrEpoch, 0);
  assert.equal(near.x, x0); assert.equal(near.z, z0);
  // RESUME (same session): nothing changes
  const res = mk();
  res.resuming = true; res.r.netId = 7;
  res._onLive(welcome(res.x + 40, res.z));
  assert.equal(res.corrEpoch, 3);
  assert.ok(Math.hypot(res.x - SPAWNS[2].x, res.z - SPAWNS[2].z) < 1e-6);
});

test('REJOIN_SNAP_M stays inside the first-sample tolerance: a fresh session 12 m away is accepted', () => {
  assert.ok(REJOIN_SNAP_M + 1 <= MOVE.FIRST_RADIUS_M, `${REJOIN_SNAP_M} vs ${MOVE.FIRST_RADIUS_M}`);
  for (const mode of [MODE.WALK, MODE.MOTO]) {
    const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
    v.reset(0, 0, MODE.WALK, 1_000_000, true);
    const r = v.onState(5000, REJOIN_SNAP_M, 0, mode, 1_000_000 + 30, true);
    assert.ok(r.accepted, `mode ${mode}: ${JSON.stringify(r)}`);
  }
});

// Mount / dismount spam as js/main.js does it: walk at A; mount → position jumps to the bike (≤ 5 m: personal moto 2.4 m
// in front); dismount → spot ≤ 8 m from the bike. `immediate`: the client sends a STATE right after each (net.js
// stateNowAfterMount, ≥ 30 ms after the previous STATE); otherwise only the 15 Hz STATE (the old client).
function mountSpam({ immediate, gaps }) {
  const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
  let t = 5000, srv = 1_000_000;
  v.reset(0, 0, MODE.WALK, srv);
  let px = 0, pz = 0, mode = MODE.WALK, nextAt = t, lastSent = -1e9;
  const out = { viol: 0, corr: 0, states: 0 };
  const send = () => {
    const r = v.onState(t & 0xffff, px, pz, mode, srv + 40, true);
    out.states++; lastSent = t;
    if (!r.accepted) out.viol++;
    if (r.correct) { out.corr++; v.corrected(v.mc.lastX, v.mc.lastZ, mode, srv + 40); px = v.mc.lastX; pz = v.mc.lastZ; }
  };
  let gi = 0, nextToggle = 300;
  for (let ms = 0; ms < 12000; ms += 16) {             // 60 fps frames
    t += 16; srv += 16;
    pz += (mode === MODE.MOTO ? 8 : 1.5) * 0.016;     // creeping forward between toggles
    if (ms >= nextToggle) {
      nextToggle += gaps[gi % gaps.length];
      gi++;
      if (mode === MODE.WALK) { pz += 2.4; mode = MODE.MOTO; } else { px += 1.3 + (gi % 3) * 2.2; mode = MODE.WALK; }   // dismount spot 1.3–5.7 m
      if (immediate) { if (t - lastSent >= 30) send(); else nextAt = lastSent + 30; }
    }
    if (t >= nextAt) { send(); nextAt = t + 1000 / 15; }
  }
  return out;
}

test('mount/dismount spam (60–400 ms): a STATE right after every toggle → 0 violations; the old 15 Hz-only client was corrected', () => {
  const gaps = [60, 90, 120, 160, 220, 300, 400];
  for (let s = 0; s < gaps.length; s++) {
    const g = gaps.slice(s).concat(gaps.slice(0, s));
    const fixed = mountSpam({ immediate: true, gaps: g });
    assert.equal(fixed.viol, 0, `rotation ${s}: ${JSON.stringify(fixed)}`);
  }
  const old = mountSpam({ immediate: false, gaps: [70, 80, 75, 90] });
  assert.ok(old.viol > 0, `old client should violate: ${JSON.stringify(old)}`);
});

test('a teleport that lands in the soft out-of-bounds band is still a hard TELEPORT (corrected at once)', () => {
  const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
  const a = 1500 / Math.SQRT2;                         // r 1500, inside the disc
  v.reset(a, a, MODE.WALK, 1_000_000, false);
  let t = 5000, srv = 1_000_000;
  for (let i = 0; i < 10; i++) { t += 66; srv += 66; assert.ok(v.onState(t, a, a, MODE.WALK, srv, true).accepted); }
  const b = (1500 + 120) / Math.SQRT2;                 // r 1620: 32 m outside, 120 m away
  const r = v.onState(t + 66, b, b, MODE.WALK, srv + 66, true);
  assert.equal(r.accepted, false);
  assert.ok(r.hard && r.correct, JSON.stringify(r));
  // an honest player sliding along the edge (small step, 1 m outside) is only a soft out-of-bounds point
  const v2 = new Validator(); v2.extraFlags = MCF.SKIP_SURFACE;
  const e = 1589 / Math.SQRT2, e2 = 1591 / Math.SQRT2;
  v2.reset(e, e, MODE.WALK, 1_000_000, false);
  const r2 = v2.onState(5066, e2, e2, MODE.WALK, 1_000_066, true);
  assert.equal(r2.hard, false);
  assert.equal(r2.correct, 0);
});
