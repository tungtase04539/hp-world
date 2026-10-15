// game/sim.js — OWNER: S2. The 20 Hz world loop (ARCH §7): STATEs are validated and applied on arrival by the
// gateway; each tick assembles the snapshots of the sessions whose phase matches (10 Hz per client, staggered so each
// tick carries half the clients), skips a snapshot under backpressure (bufferedAmount > 16 KB → next one is a
// keyframe), sends NAMES for newly seen players, and feeds the degrade ladder (game/degrade.js). Once per second:
// play time, resume expiry, degrade evaluation. Every 30 s: dirty characters + play time are flushed (game/persist.js).
//
// Sliced tick (fixer round 2): the live loop does at most TICK_SLICE_MS (4 ms) of snapshot work per event-loop turn and
// continues with setImmediate, so inbound STATE / PING / HTTP wait at most one slice instead of a whole tick (at
// 1,200 CCU on the owner's PC a tick is ~14–19 ms, almost all of it uWS send() syscalls). The sessions of a tick are
// fixed when it starts; a session that left meanwhile is skipped. If the next tick is due before the slices finish,
// the rest runs synchronously first (counted in hp_sim_tick_overrun_total). The tick duration fed to the ladder and to
// hp_sim_tick_ms is the SUM of the slices (the real work); hp_sim_tick_span_ms is the wall time first → last snapshot.
//
// Service 'sim': { tick, level, stats(), forceDegrade(level | -1), snapshotFor(session) (tests/bench), step(n) }
import { Writer, SnapshotBuilder } from '../../../js/shared/codec.js';
import { NET } from '../../../js/shared/constants.js';
import { SYS } from '../../../js/shared/protocol.js';
import { AoiFrame, aoiStep, levelParams, takeNames } from './aoi.js';
import { encodeFrame, encodeNamesFor } from './encoder.js';
import { DegradeLadder } from './degrade.js';
import { SESSION } from './session.js';

// Diagnostic: HP_DEBUG_LONG_TICK_MS=30 logs every tick longer than 30 ms with its anatomy (snapshots, ms in AOI vs
// send) — how the integration found that slow ticks on the owner's PC carry the same work as normal ones.
const DBG_TICK = Number(process.env.HP_DEBUG_LONG_TICK_MS) || 0;
const DBG = { send: 0, aoi: 0 };
const SNAP_BUCKETS =[32, 64, 128, 256, 384, 512, 640, 768, 896, 1024, 1100, 1280, 1536, 2048];

export function createSim({ sessions, metrics, log, bus, now, tickHz = 20, snapHz = 10, onLevel, defer = setImmediate, undefer = clearImmediate }) {
  const w = new Writer(8192);
  const sb = new SnapshotBuilder(w);
  const wn = new Writer(8192);
  const frame = new AoiFrame();
  const ladder = new DegradeLadder();
  const params = [0, 1, 2, 3, 4].map(levelParams);
  const div = Math.max(1, Math.round(tickHz / snapHz));
  let tickNo = 0;

  const mSnapBytes = metrics.histogram('snapshot_bytes', 'snapshot size (bytes)', SNAP_BUCKETS, 4096);
  const mSnapMs = metrics.histogram('snapshot_ms', 'snapshot assembly + send per tick (ms)');
  const mRecords = metrics.histogram('snapshot_records', 'ENTER + UPDATE records per snapshot', [0, 8, 16, 24, 32, 48, 64, 80, 96], 4096);
  const mDropped = metrics.counter('snapshots_dropped_total', 'snapshots skipped because of backpressure');
  const mKey = metrics.counter('snapshots_keyframe_total', 'keyframe snapshots');
  const mSent = metrics.counter('snapshots_sent_total', 'snapshots sent');
  const mNames = metrics.counter('names_sent_total', 'NAMES entries sent');
  const mCapped = metrics.counter('aoi_capped_total', 'in-range entities left out by the 96 cap (summed per snapshot)');
  const mDeferred = metrics.counter('aoi_deferred_total', 'changed records deferred (far tier / budget / thin)');
  const mOut = metrics.counter('ws_play_bytes_out_total', 'bytes sent on /play');
  const mLevel = metrics.gauge('degrade_level', 'degrade ladder level 0..4', () => ladder.level);
  const mLevelChg = metrics.counter('degrade_changes_total', 'degrade level changes');
  const mSpan = metrics.histogram('sim_tick_span_ms', 'wall time from the first to the last snapshot of a sliced tick (ms)');
  const mSlices = metrics.histogram('sim_tick_slices', 'event-loop turns used by one tick', [1, 2, 3, 4, 6, 8, 12, 16], 2048);
  const mOverrun = metrics.counter('sim_tick_overrun_total', 'ticks whose remaining slices ran synchronously because the next tick was due');
  void mLevel;

  function snapshotFor(s) {
    const conn = s.conn;
    if (!conn) return 0;
    // backpressure: skip this snapshot. NO keyframe afterwards (fixer round 1, NET-11): aoiStep did not run, so the
    // per-client AOI state still matches what the client has (P1 records are absolute) and the next normal delta is
    // correct; a keyframe would clear every slot and re-enter at most ENTER_MAX per snapshot exactly on the congested
    // link. Keyframes stay for READY and RESUME only.
    if (conn.bufferedAmount() > NET.DROP_SNAPSHOT_BUFFERED) { mDropped.inc(); return 0; }
    const lv = ladder.level;
    const ta = DBG_TICK ? performance.now() : 0;
    aoiStep(sessions.world, s.entity, s.aoi, params[lv], frame);
    if (DBG_TICK) DBG.aoi += performance.now() - ta;
    if (frame.keyframe) mKey.inc();
    if (frame.capped) mCapped.inc(frame.capped);
    if (frame.deferred) mDeferred.inc(frame.deferred);
    mRecords.observe(frame.nEnter + frame.nUpd);
    const bytes = encodeFrame(sb, tickNo, s.entity, s.corrEpoch, s.lastSeq < 0 ? 0 : s.lastSeq, frame, lv > 0);
    const n = bytes.length;
    let names = s.aoi.pendingNames.length ? takeNames(s.aoi) : null;
    let total = n;
    const ts = DBG_TICK ? performance.now() : 0;
    if (!names) conn.send(bytes);
    else {
      conn.cork(() => {
        conn.send(bytes);
        while (names) {
          const nb = encodeNamesFor(wn, names);
          mNames.inc(names.length);
          total += nb.length;
          conn.send(nb);
          names = takeNames(s.aoi);
        }
      });
    }
    if (DBG_TICK) DBG.send += performance.now() - ts;
    mSnapBytes.observe(n);
    mSent.inc();
    mOut.inc(total);
    s.snapBytes += total; s.snapCount++;
    return n;
  }

  // ---- one tick = the snapshots of the sessions in this phase, possibly in several slices --------------------------
  const work = [];          // sessions of the running tick (fixed at its start)
  let ti = 0, tn = 0, workMs = 0, slices = 0, spanT0 = 0, running = false, contH = null, onDone = null;

  function begin() {
    const phase = tickNo % div;
    const list = sessions.active;
    tn = 0; ti = 0; workMs = 0; slices = 0;
    for (let i = 0; i < list.length; i++) { const s = list[i]; if (s.snapPhase === phase) work[tn++] = s; }
    if (work.length > tn * 2 + 64) work.length = tn;   // shrink after a crowd left
    spanT0 = performance.now();
    running = true;
  }
  // run up to budgetMs of snapshot work (Infinity = to the end); true when the tick is complete
  function runSlice(budgetMs) {
    const t0 = performance.now();
    slices++;
    while (ti < tn) {
      const s = work[ti]; work[ti++] = null;
      if (!(s._ai < 0)) snapshotFor(s);            // _ai = -1: left the active list since the tick started
      if ((ti & 7) === 0 && performance.now() - t0 >= budgetMs) break;
    }
    workMs += performance.now() - t0;
    if (ti < tn) return false;
    finish();
    return true;
  }
  function finish() {
    const dt = workMs;
    running = false;
    if (DBG_TICK && dt > DBG_TICK) {
      log.warn('long tick', { ms: Math.round(dt * 10) / 10, phase: tickNo % div, snaps: tn, active: sessions.active.length, slices, sendMs: Math.round(DBG.send * 10) / 10, aoiMs: Math.round(DBG.aoi * 10) / 10 });
    }
    DBG.send = 0; DBG.aoi = 0;
    mSnapMs.observe(dt);
    mSpan.observe(performance.now() - spanT0);
    mSlices.observe(slices);
    tickNo++;
    const cb = onDone; onDone = null;
    if (cb) cb(dt);
  }
  // the rest of a running sliced tick, synchronously (the next tick is due / shutdown / a synchronous tick)
  function drain() {
    if (!running) return;
    if (contH) { undefer(contH); contH = null; }
    mOverrun.inc();
    runSlice(Infinity);
  }
  function step() {
    contH = null;
    if (!running) return;
    if (!runSlice(sliceBudget)) contH = defer(step);
  }
  let sliceBudget = 0;

  // synchronous tick (tests, bench, TICK_SLICE_MS=0) → duration (ms)
  function tick() {
    drain();
    begin();
    runSlice(Infinity);
    return workMs;
  }
  // sliced tick: done(workMs) is called when its last slice ran (maybe synchronously, when everything fits one slice)
  function tickSliced(sliceMs, done) {
    if (!(sliceMs > 0)) { const dt = tick(); done?.(dt); return; }
    drain();
    sliceBudget = sliceMs;
    begin();
    onDone = done || null;
    step();
  }
  function cancel() { if (contH) { undefer(contH); contH = null; } running = false; onDone = null; }

  function evaluate() {
    const ch = ladder.evaluate();
    if (!ch) return null;
    mLevelChg.inc(1, { to: String(ch.level) });
    log.warn('degrade level changed', { level: ch.level, prev: ch.prev, decide: Math.round(ladder.lastQ * 100) / 100, tickP90: Math.round(ladder.lastTickQ * 100) / 100, lateP90: Math.round(ladder.lastLateQ * 100) / 100, p99: Math.round(ladder.lastP99 * 100) / 100 });
    bus.emit('degrade', { level: ch.level, prev: ch.prev, p90: ladder.lastQ, p99: ladder.lastP99 });
    onLevel?.(ch.level, ch.prev);
    return ch;
  }

  return {
    tick, tickSliced, cancel, snapshotFor, evaluate, ladder,
    get tickNo() { return tickNo; },
    get level() { return ladder.level; },
    observe: (ms) => ladder.observe(ms),
    forceDegrade(level) { ladder.force(level); return evaluate(); },
  };
}

export function register(app) {
  const log = app.log.child({ mod: 'sim' });
  let loop = null, sim = null;
  const get = () => {
    if (!sim) {
      sim = createSim({
        sessions: app.get('sessions'), metrics: app.metrics, log, bus: app.bus, now: app.nowMs,
        tickHz: app.config.tickHz, snapHz: app.config.snapHz,
        onLevel: (level, prev) => {
          if (app.has('queue')) app.get('queue').setBlocked(level >= 4);
          if (level >= 2 && prev < 2 && app.has('alerts')) app.get('alerts').send('degrade', `Máy chủ quá tải: mức giảm tải L${level}`).catch(() => {});
          app.get('sessions').broadcastSystem(SYS.DEGRADE, level);
        },
      });
    }
    return sim;
  };
  app.provide('sim', {
    get tick() { return loop ? loop.tick : 0; },
    get level() { return sim ? sim.level : 0; },
    stats: () => {
      const st = loop ? loop.stats() : null;
      const h = app.metrics.get('snapshot_bytes');
      return {
        ...(st || {}), level: sim ? sim.level : 0, p99Window: sim ? sim.ladder.lastP99 : 0, p90Window: sim ? sim.ladder.lastQ : 0, tickP90Window: sim ? sim.ladder.lastTickQ : 0, lateP90Window: sim ? sim.ladder.lastLateQ : 0,
        snapshotBytesP50: h ? h.quantile(0.5) : NaN, snapshotBytesP95: h ? h.quantile(0.95) : NaN,
        ccu: app.has('sessions') ? app.get('sessions').count() : 0,
      };
    },
    forceDegrade: (level) => get().forceDegrade(level),
    snapshotFor: (s) => get().snapshotFor(s),
    step: (n = 1) => { const s = get(); let t = 0; for (let i = 0; i < n; i++) { const d = s.tick(); s.observe(d); t += d; } return t; },
    get core() { return get(); },
  });

  let lastSec = 0;
  app.bus.on('start', () => {
    const s = get();
    const sessions = app.get('sessions');
    lastSec = performance.now();
    const sliceMs = app.config.tickSliceMs ?? 0;
    loop = app.timers.loop(app.config.tickHz, 'sim_tick', (tick, now, dt, lateMs) => {
      const t0 = performance.now();
      if (Number.isFinite(lateMs)) s.ladder.observeLate(lateMs);
      // 1 Hz housekeeping first (synchronous, counted into this tick's duration)
      if (t0 - lastSec >= 1000) {
        const dtS = (t0 - lastSec) / 1000;
        lastSec = t0;
        sessions.sweep(dtS);
        s.evaluate();
      }
      const pre = performance.now() - t0;
      s.tickSliced(sliceMs, (workMs) => {
        const total = workMs + pre;
        s.observe(total);
        loop.record(total);
      });
    }, { external: true });
    app.timers.every(SESSION.FLUSH_MS, 'persist_flush', () => sessions.flush());
    app.timers.every(60000, 'world_sweep', () => sessions.world.sweepRecent());
  });
  app.onStop(async () => {
    if (loop) loop.cancel();
    if (sim) sim.cancel();
    if (!app.has('sessions')) return;
    const sessions = app.get('sessions');
    for (const s of sessions.byAccount.values()) s.dirty = s.dirty || s.ready;
    await sessions.flush();
    sessions.stopped = true;
  });
}
