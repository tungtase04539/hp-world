// game/sim.js — OWNER: S2. The 20 Hz world loop (ARCH §7): STATEs are validated and applied on arrival by the
// gateway; each tick assembles the snapshots of the sessions whose phase matches (10 Hz per client, staggered so each
// tick carries half the clients), skips a snapshot under backpressure (bufferedAmount > 16 KB → next one is a
// keyframe), sends NAMES for newly seen players, and feeds the degrade ladder (game/degrade.js). Once per second:
// play time, resume expiry, degrade evaluation. Every 30 s: dirty characters + play time are flushed (game/persist.js).
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

export function createSim({ sessions, metrics, log, bus, now, tickHz = 20, snapHz = 10, onLevel }) {
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
  void mLevel;

  function snapshotFor(s) {
    const conn = s.conn;
    if (!conn) return 0;
    if (conn.bufferedAmount() > NET.DROP_SNAPSHOT_BUFFERED) { s.aoi.keyframe = true; mDropped.inc(); return 0; }
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

  // one tick: snapshots for the sessions in this phase
  function tick() {
    const t0 = performance.now();
    const phase = tickNo % div;
    const list = sessions.active;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.snapPhase === phase) snapshotFor(s);
    }
    const dt = performance.now() - t0;
    if (DBG_TICK && dt > DBG_TICK) {
      let nS = 0; for (let i = 0; i < list.length; i++) if (list[i].snapPhase === phase) nS++;
      log.warn('long tick', { ms: Math.round(dt * 10) / 10, phase, snaps: nS, active: list.length, sendMs: Math.round(DBG.send * 10) / 10, aoiMs: Math.round(DBG.aoi * 10) / 10 });
    }
    DBG.send = 0; DBG.aoi = 0;
    mSnapMs.observe(dt);
    tickNo++;
    return dt;
  }

  function evaluate() {
    const ch = ladder.evaluate();
    if (!ch) return null;
    mLevelChg.inc(1, { to: String(ch.level) });
    log.warn('degrade level changed', { level: ch.level, prev: ch.prev, p90: Math.round(ladder.lastQ * 100) / 100, p99: Math.round(ladder.lastP99 * 100) / 100 });
    bus.emit('degrade', { level: ch.level, prev: ch.prev, p90: ladder.lastQ, p99: ladder.lastP99 });
    onLevel?.(ch.level, ch.prev);
    return ch;
  }

  return {
    tick, snapshotFor, evaluate, ladder,
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
        ...(st || {}), level: sim ? sim.level : 0, p99Window: sim ? sim.ladder.lastP99 : 0, p90Window: sim ? sim.ladder.lastQ : 0,
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
    loop = app.timers.loop(app.config.tickHz, 'sim_tick', () => {
      const t0 = performance.now();
      s.tick();
      const t1 = performance.now();
      if (t1 - lastSec >= 1000) {
        const dtS = (t1 - lastSec) / 1000;
        lastSec = t1;
        sessions.sweep(dtS);
        s.evaluate();
      }
      s.observe(performance.now() - t0);
    });
    app.timers.every(SESSION.FLUSH_MS, 'persist_flush', () => sessions.flush());
    app.timers.every(60000, 'world_sweep', () => sessions.world.sweepRecent());
  });
  app.onStop(async () => {
    if (loop) loop.cancel();
    if (!app.has('sessions')) return;
    const sessions = app.get('sessions');
    for (const s of sessions.byAccount.values()) s.dirty = s.dirty || s.ready;
    await sessions.flush();
    sessions.stopped = true;
  });
}
