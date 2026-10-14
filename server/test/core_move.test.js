// S2: movement validation (js/shared/move.js MoveCheck + server/src/game/validate.js Validator).
// Honest movement â€” network jitter, bursts after stalls, bufferbloat, idle 2 Hz, mode switches, dismount jumps, long
// hidden tabs, clock drift, 5 cm quantisation â€” must never be CORRECTed. Cheats must be: speed, time dilation,
// teleport, time banking, play disc, water walking, boats on land, shared vehicles without a claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MoveCheck, MV, MCF, MOVE, landOk, waterOk, onBridge, onPier, pierRects, surfaceKind, inPlayDisc, stepAllowance } from '../../js/shared/move.js';
import { Validator } from '../src/game/validate.js';
import { MODE, PLAY_RADIUS, SPEED } from '../../js/shared/constants.js';
import { qPos, dqPos } from '../../js/shared/quant.js';
import { isWater, BRIDGE_WAYS } from '../../js/terrain.js';
import { SPAWNS } from '../../js/shared/spawns.js';

// deterministic PRNG
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0) / 4294967296); }
const q = (v) => dqPos(qPos(v));

// Drive a Validator with a client trajectory. pos(tS) â†’ {x, z, mode}; returns stats.
// opts: hz, durS, delay(k, tClientMs) â†’ one-way delay ms, clockRate (client clock speed), frameJitterMs, flags
function drive(pos, { hz = 15, durS = 60, delay = () => 40, clockRate = 1, frameJitterMs = 6, flags = MCF.SKIP_SURFACE | MCF.VEHICLE_OK, seed = 1, sendIf = null, v = new Validator() } = {}) {
  v.extraFlags = flags & MCF.SKIP_SURFACE;
  const r = rng(seed);
  const p0 = pos(0);
  const serverT0 = 1_000_000;
  v.reset(p0.x, p0.z, p0.mode, serverT0);
  const pk = [];
  const n = Math.floor(durS * hz);
  for (let k = 1; k <= n; k++) {
    const tReal = (k * 1000) / hz + (r() * 2 - 1) * frameJitterMs;        // real ms since start
    if (sendIf && !sendIf(tReal / 1000)) continue;
    const p = pos(tReal / 1000);
    const clientMs = Math.floor(5000 + tReal * clockRate);               // client's performance.now (fast if > 1)
    pk.push({ tReal, clientMs, x: q(p.x), z: q(p.z), mode: p.mode, arr: serverT0 + tReal + delay(k, tReal, r) });
  }
  // WebSocket is ordered: arrival times are non-decreasing in send order
  for (let i = 1; i < pk.length; i++) if (pk[i].arr < pk[i - 1].arr) pk[i].arr = pk[i - 1].arr + 0.01;
  const out = { n: pk.length, viol: 0, corrections: 0, kicks: 0, byCode: {}, firstCorrectS: null };
  let epochOk = true;
  for (const p of pk) {
    if (!epochOk) {   // the client applies a CORRECT ~one RTT later: model it as "next sample is from the corrected spot"
      epochOk = true;
    }
    const res = v.onState(p.clientMs & 0xffff, p.x, p.z, p.mode, p.arr, (flags & MCF.VEHICLE_OK) !== 0);
    if (!res.accepted) { out.viol++; out.byCode[res.violation] = (out.byCode[res.violation] || 0) + 1; }
    if (res.kick) { out.kicks++; break; }
    if (res.correct) {
      out.corrections++;
      if (out.firstCorrectS === null) out.firstCorrectS = p.tReal / 1000;
      v.corrected(p.x, p.z, p.mode, p.arr);    // an honest-looking client would snap; cheats keep going (worst case)
      v.pending = false;
    }
  }
  return out;
}
const line = (speed, mode, x0 = 0, z0 = 0, dir = [1, 0]) => (t) => ({ x: x0 + dir[0] * speed * t, z: z0 + dir[1] * speed * t, mode });
const circle = (speed, R, mode) => (t) => ({ x: R * Math.cos((speed * t) / R), z: R * Math.sin((speed * t) / R), mode });

test('honest: walk / run / moto at full speed with 0â€“300 ms jitter â€” 0 corrections', () => {
  const jit = (lo, hi) => (k, t, r) => lo + r() * (hi - lo);
  for (const [name, f, d] of [
    ['walk 3 m/s', line(SPEED.walk, MODE.WALK, -500, 0), jit(30, 150)],
    ['run 7 m/s', line(SPEED.run, MODE.RUN, -800, -100), jit(20, 300)],
    ['moto 16 m/s straight', line(SPEED.moto, MODE.MOTO, -1200, 50), jit(20, 300)],
    ['moto 16 m/s circle R 25', circle(SPEED.moto, 25, MODE.MOTO), jit(10, 250)],
    ['cyclo 4.2', line(SPEED.cyclo, MODE.CYCLO, 0, -300), jit(10, 200)],
    ['boat 10', line(SPEED.boat, MODE.BOAT, 100, 100), jit(10, 200)],
  ]) {
    for (let seed = 1; seed <= 3; seed++) {
      const r = drive(f, { durS: 60, delay: d, seed });
      assert.equal(r.corrections, 0, `${name} seed ${seed}: ${JSON.stringify(r)}`);
      assert.ok(r.viol <= 1, `${name} seed ${seed} violations ${r.viol}`);
    }
  }
});

test('honest: bursts after 1â€“3 s stalls (4G hiccups) and bufferbloat are not corrected', () => {
  // every 8 s the network stalls for 1â€“3 s; everything sent during the stall arrives at once at its end
  const stalls = (k, t, r) => {
    const cyc = t % 8000;
    const len = 1000 + ((Math.floor(t / 8000) * 7919) % 2000);
    return 40 + (cyc < len ? len - cyc : 0) + r() * 20;
  };
  for (const [f, name] of [[line(SPEED.run, MODE.RUN, -800, 0), 'run'], [line(SPEED.moto, MODE.MOTO, -1200, 0), 'moto']]) {
    const r = drive(f, { durS: 120, delay: stalls });
    assert.equal(r.corrections, 0, `${name} stalls ${JSON.stringify(r)}`);
  }
  // bufferbloat: delay ramps 40 â†’ peak over 20 s, holds 15 s, then collapses back to 40 ms within 1 s
  const bloat = (peak) => (k, t) => {
    const sec = t / 1000;
    if (sec < 10) return 40;
    if (sec < 30) return 40 + ((sec - 10) / 20) * (peak - 40);
    if (sec < 45) return peak;
    if (sec < 46) return peak - (sec - 45) * (peak - 40);
    return 40;
  };
  for (const seed of [1, 2, 3]) {
    const rb = drive(line(SPEED.run, MODE.RUN, -800, 0), { durS: 80, delay: bloat(800), seed });
    assert.equal(rb.corrections, 0, `bufferbloat 800 ms ${JSON.stringify(rb)}`);
    // the time budget caps lag credit at +200 ms after 10 s: a 1.5 s bloat collapsing in 1 s costs at most one CORRECT
    const rb2 = drive(line(SPEED.run, MODE.RUN, -800, 0), { durS: 80, delay: bloat(1500), seed });
    assert.ok(rb2.corrections <= 1, `bufferbloat 1500 ms ${JSON.stringify(rb2)}`);
  }
});

test('honest: idle 2 Hz, mode switches, mount/dismount jumps, quantisation â€” 0 corrections', () => {
  // 0â€“10 s walk, 10â€“20 run, 20 mount the personal moto (+2 m snap), 20â€“40 moto, 40 dismount (8 m spot), 40â€“50 idle 2 Hz
  const f = (t) => {
    let x = 0, mode = MODE.WALK;
    if (t < 10) x = SPEED.walk * t;
    else if (t < 20) { x = 30 + SPEED.run * (t - 10); mode = MODE.RUN; }
    else if (t < 40) { x = 100 + 2 + SPEED.moto * (t - 20); mode = MODE.MOTO; }
    else { x = 102 + 320 + 8; mode = MODE.WALK; }
    return { x: x - 500, z: 0, mode };
  };
  const r = drive(f, { durS: 50, delay: (k, t, rr) => 30 + rr() * 200, sendIf: (t) => t < 40 || Math.round(t * 15) % 7 === 0 });
  assert.equal(r.corrections, 0, JSON.stringify(r));
  assert.equal(r.viol, 0, JSON.stringify(r));
});

test('honest: hidden tab (no STATE for 70 s, u16 clock wraps), slow clock drift â€” 0 corrections', () => {
  const r = drive(line(0, MODE.WALK, 10, 10), { durS: 100, sendIf: (t) => t < 10 || t > 80, delay: () => 50 });
  assert.equal(r.corrections, 0, JSON.stringify(r));
  // client clock 0.1 % fast for 20 minutes (quartz drift is far smaller)
  const d = drive(line(SPEED.walk, MODE.WALK, -1000, 0), { durS: 600, clockRate: 1.001, hz: 2, delay: () => 50 });
  assert.equal(d.corrections, 0, JSON.stringify(d));
});

test('cheat: speed hacks are corrected quickly', () => {
  for (const [mult, f, name] of [
    [1.5, (m) => line(SPEED.run * m, MODE.RUN, -800, 0), 'run Ã—1.5'],
    [2, (m) => line(SPEED.moto * m, MODE.MOTO, -1200, 0), 'moto Ã—2'],
    [3, (m) => line(SPEED.walk * m, MODE.WALK, -500, 0), 'walk Ã—3'],
    [1.6, (m) => line(SPEED.moto * m, MODE.MOTO, -1200, 0), 'moto Ã—1.6'],
  ]) {
    const r = drive(f(mult), { durS: 20, delay: (k, t, rr) => 40 + rr() * 100 });
    assert.ok(r.corrections >= 1, `${name}: ${JSON.stringify(r)}`);
    assert.ok(r.firstCorrectS < 2.5, `${name}: first CORRECT after ${r.firstCorrectS} s`);
  }
});

test('cheat: time dilation (client clock 1.25Ã— / 1.5Ã— / 2Ã—) is detected by the time budget', () => {
  for (const [rate, within] of [[1.25, 45], [1.5, 12], [2, 8]]) {
    // positions honest relative to the (fast) client clock â†’ the 1 s window alone would pass
    const f = (t) => ({ x: -1500 + SPEED.run * t * rate, z: 0, mode: MODE.RUN });
    const r = drive(f, { durS: 60, clockRate: rate, delay: (k, t, rr) => 40 + rr() * 60 });
    assert.ok(r.corrections >= 1, `rate ${rate}: ${JSON.stringify(r)}`);
    assert.ok(r.firstCorrectS < within, `rate ${rate}: first CORRECT after ${r.firstCorrectS} s`);
    assert.ok((r.byCode[MV.TIME] || 0) >= 3, `rate ${rate}: ${JSON.stringify(r)}`);
  }
});

test('cheat: teleport is a hard flag (immediate CORRECT); far outside the disc too', () => {
  const v = new Validator();
  v.reset(0, 0, MODE.WALK, 0);
  let r = v.onState(1000, 0.2, 0, MODE.WALK, 1000, true);
  assert.equal(r.accepted, true);
  r = v.onState(1066, 60, 0, MODE.WALK, 1066, true);
  assert.equal(r.violation, MV.TELEPORT); assert.equal(r.hard, true); assert.ok(r.correct > 0);
  const v2 = new Validator();
  v2.reset(PLAY_RADIUS - 1, 0, MODE.WALK, 0);
  r = v2.onState(1000, PLAY_RADIUS + 1, 0, MODE.WALK, 1000, true);
  assert.equal(r.accepted, true, 'clampToPlayArea tolerance');
  r = v2.onState(1066, PLAY_RADIUS + 1.2, 0, MODE.WALK, 1066, true);
  assert.equal(r.accepted, true);
  r = v2.onState(1132, PLAY_RADIUS + 3, 0, MODE.WALK, 1132, true);
  assert.equal(r.violation, MV.OUT_OF_BOUNDS); assert.equal(r.hard, false);
});

test('cheat: time banking (frozen client clock, then a dash) is capped at ~10 s', () => {
  const mc = new MoveCheck();
  mc.reset(-800, 0, MODE.RUN, 0);
  let t = 0;
  // 40 s of standing still while the client clock does not advance (claims no time passes)
  for (let i = 0; i < 600; i++) { t += 66; mc.check(5000, -800, 0, MODE.RUN, t, MCF.SKIP_SURFACE); }
  // then a 160 m dash in 1 s of real time, client clock "catching up" 23 s (allowance 7Â·23Â·1.2 > 160)
  let viol = 0;
  for (let i = 1; i <= 15; i++) {
    t += 66;
    const code = mc.check((5000 + i * 1533) & 0xffff, -800 + i * (160 / 15), 0, MODE.RUN, t, MCF.SKIP_SURFACE);
    if (code !== MV.OK) viol++;
  }
  assert.ok(viol >= 3, `banking dash violations ${viol}`);
});

test('surface: land, water, bridge decks, pier, boats', () => {
  for (const s of SPAWNS) { assert.ok(landOk(s.x, s.z), s.id); assert.equal(waterOk(s.x, s.z), false, s.id); }
  // find open water inside the play disc (river), well away from banks
  let wp = null;
  for (let z = -1500; z < 1500 && !wp; z += 10) {
    for (let x = -1500; x < 1500; x += 10) {
      if (!inPlayDisc(x, z, -50)) continue;
      let all = true;
      for (const [dx, dz] of [[0, 0], [12, 0], [-12, 0], [0, 12], [0, -12]]) if (!isWater(x + dx, z + dz) || onBridge(x + dx, z + dz)) all = false;
      if (all && surfaceKind(x, z) === 3) { wp = [x, z]; break; }
    }
  }
  assert.ok(wp, 'an open-water point inside the play disc');
  assert.equal(landOk(wp[0], wp[1]), false);
  assert.equal(waterOk(wp[0], wp[1]), true);
  // every point along the deck of every bridge way inside the disc is walkable (even where the ground below is water)
  let wet = 0, pts = 0;
  for (const b of BRIDGE_WAYS) {
    for (let i = 0; i + 1 < b.pts.length; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[i + 1];
      for (let t = 0; t < 1; t += 0.25) {
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (!inPlayDisc(x, z)) continue;
        pts++;
        if (isWater(x, z)) wet++;
        assert.ok(landOk(x, z), `${b.n} deck point ${x.toFixed(1)},${z.toFixed(1)}`);
        // half a deck width off the centre line too
        const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L, o = (b.w || 10) / 2 - 0.5;
        assert.ok(landOk(x + nx * o, z + nz * o) && landOk(x - nx * o, z - nz * o), `${b.n} deck edge`);
      }
    }
  }
  assert.ok(pts > 100 && wet > 50, `bridge sample: ${pts} points, ${wet} over water`);
  // Báº¿n BÃ­nh pier (world.js buildPier) is walkable
  const p = pierRects()[0];
  assert.ok(p, 'pier rect');
  const cx = (p.x0 + p.x1) / 2;
  for (let z = p.z0 + 3; z < p.z1 - 3; z += 2) assert.ok(onPier(cx, z) && landOk(cx, z), `pier ${cx},${z}`);
  assert.ok(stepAllowance(MODE.WALK, MODE.MOTO, 1) === SPEED.moto);
});

test('validator: walking into the river is corrected; boats on land and cyclo without a claim are refused', () => {
  // walk from a bank straight into open water
  let bank = null;
  for (let x = -1400; x < 1400 && !bank; x += 4) {
    for (let z = -1400; z < 1400; z += 4) {
      if (!inPlayDisc(x, z, -60) || isWater(x, z)) continue;
      let ok = true;
      for (let d = 6; d <= 40; d += 2) if (surfaceKind(x + d, z) !== 3) { ok = false; break; }
      if (ok) { bank = [x, z]; break; }
    }
  }
  assert.ok(bank, 'a bank with open water to the east');
  const v = new Validator();
  v.reset(bank[0], bank[1], MODE.WALK, 0);
  let corrected = 0, t = 0;
  for (let i = 1; i <= 150; i++) {
    t += 66;
    const r = v.onState(t, bank[0] + i * 0.2, bank[1], MODE.WALK, t, true);
    if (r.correct) { corrected++; v.corrected(bank[0], bank[1], MODE.WALK, t); v.pending = false; break; }
  }
  assert.equal(corrected, 1, 'walking on water gets corrected');
  assert.ok(v.counts[MV.WATER] >= 5);
  // boat on land
  const s0 = SPAWNS[0];
  const mc = new MoveCheck();
  mc.reset(s0.x, s0.z, MODE.BOAT, 0);
  assert.equal(mc.check(1000, s0.x + 0.5, s0.z, MODE.BOAT, 1000, MCF.VEHICLE_OK), MV.MODE);
  // cyclo without a confirmed vehicle
  mc.reset(s0.x, s0.z, MODE.WALK, 0);
  assert.equal(mc.check(1000, s0.x + 0.2, s0.z, MODE.CYCLO, 1000, 0), MV.MODE);
  assert.equal(mc.check(1066, s0.x + 0.3, s0.z, MODE.CYCLO, 1066, MCF.VEHICLE_OK), MV.OK);
  // personal moto anywhere on land (flag VEHICLE_OK is set by the server for vehicleRef 0)
  assert.equal(mc.check(1132, s0.x + 0.6, s0.z, MODE.MOTO, 1132, MCF.VEHICLE_OK), MV.OK);
  assert.ok(MOVE.TIME_AHEAD_MS === 100 && MOVE.TIME_LAG_MS === 200);
});

test('validator: points decay; a client ignoring CORRECT is re-sent then kicked; > 20 points kicks', () => {
  const v = new Validator();
  v.reset(0, 0, MODE.WALK, 0);
  // 6 violations in a row â†’ CORRECT on the 6th
  let r, t = 0;
  for (let i = 1; i <= 7; i++) { t += 66; r = v.onState(t, i * 1.5, 0, MODE.WALK, t, true); }   // 1st accepted, then 6 violations
  assert.ok(r.correct > 0, 'CORRECT after > 5 points');
  v.corrected(0, 0, MODE.WALK, t);
  // stale STATEs: resend every 3 s, kick after 5 resends
  const acts = [];
  for (let i = 0; i < 400; i++) { t += 66; const a = v.onStale(t); if (a) acts.push(a); if (a === 'kick') break; }
  assert.deepEqual(acts, ['resend', 'resend', 'resend', 'resend', 'resend', 'kick']);
  // decay: 5 points disappear after ~5 s of clean movement
  const v2 = new Validator();
  v2.reset(0, 0, MODE.WALK, 0);
  t = 0;
  for (let i = 1; i <= 6; i++) { t += 66; v2.onState(t, i * 1.5, 0, MODE.WALK, t, true); }
  assert.ok(v2.pointsNow >= 3.5);
  t += 6000;
  v2.onState(t, 0.1, 0, MODE.WALK, t, true);
  assert.equal(v2.pointsNow, 0);
  // > 20 points â†’ kick
  const v3 = new Validator();
  v3.reset(0, 0, MODE.WALK, 0);
  let kicked = false;
  t = 0;
  for (let i = 1; i <= 10 && !kicked; i++) { t += 66; const rr = v3.onState(t, 100 * i, 0, MODE.WALK, t, true); kicked = rr.kick; }
  assert.ok(kicked, 'repeated teleports kick');
});
