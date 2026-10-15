// Fixer round 2 (15/10/2026) — regression tests for the verifier's findings:
//   scenario:ramp-eventloop / reconnect-tick → sliced sim tick (game/sim.js) + external-event lag probe (metrics.js)
//   NET-4 residual                          → 4 s long distance window (js/shared/move.js MOVE.LONG_MS)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../src/game/validate.js';
import { MOVE } from '../../js/shared/move.js';
import { MODE, SPEED, VALIDATE } from '../../js/shared/constants.js';
import { SPAWNS } from '../../js/shared/spawns.js';
import { createMetrics } from '../src/metrics.js';
import { createTimers } from '../src/app.js';
import { createSessions } from '../src/game/session.js';
import { createSim } from '../src/game/sim.js';
import { nullLogger } from '../src/log.js';

// ============================== NET-4 residual: the additive slack cannot be re-spent every second ===================
// Moves at `speed` (m/s, in CLIENT time) for durS real seconds; the client clock runs `dil` × real time after the first
// 6 s. Rejected samples do not advance the player (the server keeps the last accepted position). The path is a circle
// of radius R (arc length = distance travelled) so a 5 min run stays inside the play disc.
const R = 400;
const onCircle = (sArc) => [R * Math.cos(sArc / R) - R, R * Math.sin(sArc / R)];
function run({ dil = 1, speed, durS = 60, hz = 15, mode = MODE.RUN }) {
  const v = new Validator(); v.extraFlags = 2;          // SKIP_SURFACE: time / distance logic only
  let srv = 1_000_000, cl = 5000, x = 0;   // x = arc length
  v.reset(0, 0, mode, srv);
  let viol = 0, corr = 0, kick = false;
  for (let i = 0; i < hz * durS; i++) {
    srv += 1000 / hz;
    const dCl = (1000 / hz) * (i < hz * 6 ? 1 : dil);
    cl += dCl;
    const step = (speed * dCl) / 1000;
    const [px, pz] = onCircle(x + step);
    const r = v.onState(Math.round(cl) & 0xffff, px, pz, mode, srv, true);
    if (r.accepted) x += step; else viol++;
    if (r.correct) { corr++; const [cx, cz] = onCircle(x); v.corrected(cx, cz, mode, srv); }
    if (r.kick) { kick = true; break; }
  }
  return { mps: x / durS, viol, corr, kick };
}

test('NET-4 residual: a true-clock client at vmax·1.2 + 0.9 m/s (old ceiling) is flagged and held near vmax·1.2', () => {
  // before: 9.3 m/s in run mode (1.33 × vmax) passed with 0 violations, forever
  const r = run({ speed: SPEED.run * VALIDATE.SLACK_MUL + 0.9 });
  assert.ok(r.viol > 20, `violations ${r.viol}`);
  assert.ok(r.corr >= 1, 'corrected');
  assert.ok(r.mps <= SPEED.run * VALIDATE.SLACK_MUL + 0.3, `average ${r.mps.toFixed(2)} m/s`);
});

test('NET-4 residual: a 1.1× clock is corrected and its 60 s average stays below the old ceiling', () => {
  // before: 9.0 m/s average, 15 violations, 0 CORRECT
  const r = run({ dil: 1.1, speed: SPEED.run * VALIDATE.SLACK_MUL });
  assert.ok(r.corr >= 1, `corrections ${r.corr}`);
  // vmax·1.2 + long-window slack (0.25 m/s) + the one-off forgiveness bucket (≤ 2.1 s of allowance per session)
  const ceiling = SPEED.run * VALIDATE.SLACK_MUL + VALIDATE.SLACK_ADD_M / (MOVE.LONG_MS / 1000) + ((MOVE.FORGIVE_BURST_MS + MOVE.TIME_AHEAD_MS) / 1000) * SPEED.run * VALIDATE.SLACK_MUL / 60;
  assert.ok(r.mps <= ceiling + 0.05, `average ${r.mps.toFixed(2)} m/s > ${ceiling.toFixed(2)}`);
  // the original NET-4 evidence (1.19×) stays caught
  const r2 = run({ dil: 1.19, speed: SPEED.run * VALIDATE.SLACK_MUL });
  assert.ok(r2.kick || r2.corr > 10);
});

test('NET-4 residual: honest movement is never flagged by the long window (run, walk, moto, 15 Hz and 30 Hz, 5 min)', () => {
  for (const [mode, v] of [[MODE.RUN, SPEED.run], [MODE.WALK, SPEED.walk], [MODE.MOTO, SPEED.moto]]) {
    for (const hz of [15, 30, 2]) {
      const r = run({ mode, speed: v, hz, durS: 300 });
      assert.equal(r.viol, 0, `mode ${mode} @${hz} Hz: ${r.viol} violations`);
    }
    // the honest bots move at 0.9 × vmax; a client at exactly vmax · 1.2 (the multiplicative slack) still passes
    assert.equal(run({ mode, speed: v * VALIDATE.SLACK_MUL }).viol, 0);
  }
  // honest client with a jittery frame clock: client steps of 40–90 ms, same real cadence on average
  const val = new Validator(); val.extraFlags = 2;
  let srv = 1_000_000, cl = 777, x = 0, viol = 0, seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  val.reset(0, 0, MODE.RUN, srv);
  for (let i = 0; i < 15 * 120; i++) {
    const d = 40 + rnd() * 50;
    srv += d + (rnd() - 0.5) * 30;      // network jitter on arrival
    cl += d;
    x += (SPEED.run * d) / 1000;
    const [px, pz] = onCircle(x);
    if (!val.onState(Math.round(cl) & 0xffff, px, pz, MODE.RUN, srv, true).accepted) viol++;
  }
  assert.equal(viol, 0, `jittery honest client: ${viol} violations`);
});

test('NET-4 residual: the long window never reaches back across a mount / dismount', () => {
  const v = new Validator(); v.extraFlags = 2;
  let srv = 1_000_000, cl = 1000, x = 0, viol = 0;
  v.reset(0, 0, MODE.MOTO, srv);
  const go = (mode, speed, s) => {
    for (let i = 0; i < 15 * s; i++) {
      srv += 1000 / 15; cl += 1000 / 15; x += speed / 15;
      if (!v.onState(Math.round(cl) & 0xffff, x, 0, mode, srv, true).accepted) viol++;
    }
  };
  go(MODE.MOTO, SPEED.moto, 5);      // fast on the moto …
  go(MODE.WALK, SPEED.walk, 3);      // … then walk: the 4 s window must not mix in the moto samples
  go(MODE.MOTO, SPEED.moto, 2);
  assert.equal(viol, 0);
  // and walking speed-hack right after a dismount is still caught
  go(MODE.WALK, SPEED.walk * 2.5, 2);
  assert.ok(viol > 0);
});

// ============================== ramp-eventloop: the sim tick is sliced ==============================================
function fakeConn(busyMs) {
  return {
    closed: false, sent: 0,
    send() { const t = performance.now(); while (performance.now() - t < busyMs); this.sent++; return 1; },
    cork(fn) { fn(); },
    bufferedAmount() { return 0; },
  };
}
function crowd(n, busyMs) {
  const metrics = createMetrics({ processMetrics: false });
  const bus = { emit() {}, on() {} };
  const mgr = createSessions({ log: nullLogger, metrics, bus, db: null });
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = mgr.create('acc' + i);
    s.entity.setPose(SPAWNS[0].x + (i % 10) * 3, SPAWNS[0].z + Math.floor(i / 10) * 3, 2, 0, 0, MODE.WALK, 0);
    s.conn = fakeConn(busyMs);
    mgr.activate(s);
    list.push(s);
  }
  return { metrics, bus, mgr, list };
}

test('ramp-eventloop: a sliced tick yields to the event loop, skips sessions that left, finishes overruns synchronously', () => {
  const { metrics, bus, mgr, list } = crowd(48, 0.3);
  const q = [];
  const sim = createSim({ sessions: mgr, metrics, log: nullLogger, bus, tickHz: 20, snapHz: 10, defer: (fn) => { q.push(fn); return fn; }, undefer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); } });
  const phase0 = list.filter((s) => s.snapPhase === 0);
  assert.equal(phase0.length, 24);
  let done = 0, doneMs = 0;
  sim.tickSliced(1, (ms) => { done++; doneMs = ms; });
  assert.equal(done, 0, 'not finished in the first turn');
  assert.equal(q.length, 1, 'continuation scheduled');
  const firstSlice = phase0.filter((s) => s.snapCount === 1).length;
  assert.ok(firstSlice > 0 && firstSlice < 24, `first slice did ${firstSlice}`);
  const leaver = phase0.find((s) => s.snapCount === 0);
  mgr.toLimbo(leaver);                       // leaves between two slices
  while (q.length) q.shift()();
  assert.equal(done, 1);
  assert.ok(doneMs >= 24 * 0.3 * 0.8, `work ${doneMs.toFixed(2)} ms`);
  assert.equal(leaver.snapCount, 0, 'a session that left is skipped');
  for (const s of phase0) if (s !== leaver) assert.equal(s.snapCount, 1);
  assert.ok(metrics.get('sim_tick_slices').quantile(1) >= 3);
  assert.equal(sim.tickNo, 1);
  // overrun: the next tick is due before the slices finished → the rest runs synchronously first
  const phase1 = list.filter((s) => s.snapPhase === 1);
  let d1 = 0;
  sim.tickSliced(1, () => d1++);
  assert.equal(d1, 0);
  sim.tickSliced(1, () => {});
  assert.equal(d1, 1, 'previous tick completed synchronously');
  for (const s of phase1) assert.equal(s.snapCount, 1);
  assert.equal(metrics.get('sim_tick_overrun_total').get(), 1);
  while (q.length) q.shift()();
  // synchronous tick (tests / TICK_SLICE_MS=0) still does everything at once
  const before = phase1.reduce((a, s) => a + s.snapCount, 0);
  assert.ok(sim.tick() > 0);
  assert.equal(phase1.reduce((a, s) => a + s.snapCount, 0), before + 24);
  sim.cancel();
});

test('ramp-eventloop: timers.loop external timing records the reported tick work, not the synchronous part', async () => {
  const metrics = createMetrics({ processMetrics: false });
  const timers = createTimers(nullLogger, metrics);
  let h = null, n = 0;
  h = timers.loop(100, 'xt', () => { n++; setImmediate(() => h.record(42)); }, { external: true });
  await new Promise((r) => setTimeout(r, 120));
  h.cancel();
  await new Promise((r) => setImmediate(r));
  const hist = metrics.get('xt_ms');
  assert.ok(n >= 1 && hist.count >= 1);
  assert.equal(hist.quantile(0.5), 42);
});

test('ramp-eventloop: the event-loop lag gauges measure the wait of an external event, not the platform timer', async () => {
  const m = createMetrics();
  try {
    await new Promise((r) => setTimeout(r, 400));
    const idleP50 = m.get('eventloop_delay_p50_ms').get();
    assert.ok(idleP50 < 5, `idle lag p50 ${idleP50} ms`);   // the old timer reading is ~15 ms idle on Windows
    m.get('eventloop_delay_max_ms').get();                  // reset the max window
    const t = performance.now();
    while (performance.now() - t < 40);                     // a 40 ms synchronous block
    await new Promise((r) => setTimeout(r, 150));
    const mx = m.get('eventloop_delay_max_ms').get();
    assert.ok(mx >= 20 && mx < 400, `max after a 40 ms block: ${mx} ms`);
    assert.match(m.render(), /hp_eventloop_timer_delay_p99_ms /);
  } finally { m.stop(); }
});
