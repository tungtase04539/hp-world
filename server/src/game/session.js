// game/session.js — OWNER: S2. Session objects (one per connected account) and the session manager:
// netId allocation (world.js), per-client AOI state, lastSeq / corrEpoch, one-session-per-account, the 60 s resume
// window ("limbo": the avatar stays, flagged AWAY), staggered snapshot phases, persistence rows (dirty flush every
// 30 s + on disconnect + on shutdown) and play time.
//
// Service 'sessions' (also used by S3's admin page):
//   load()                       live + resumable sessions (capacity accounting)
//   count()                      sessions receiving snapshots (CCU)
//   get(accountId) / byNetId(netId)
//   list() → [{netId, accountId, displayName, x, z, mode, away, connectedS, ip, tier, corrections, violations}]
//   kick(accountId, kickReason = KICK_REASON.ADMIN) → bool
//   sendSystem(accountId, code, arg) → bool ;  broadcastSystem(code, arg) → n
//   broadcastChat(text, channel = CHANNEL.SYSTEM) → n       (S2C CHAT from netId 0)
//   flush() → Promise<number>   write dirty characters + play time now
//   world                        the World (entities, grid) — read-only for other modules
import { Writer, encodeSystem, encodeChatS } from '../../../js/shared/codec.js';
import { SYS, KICK_REASON, CLOSE, CHANNEL, PROTO_VERSION } from '../../../js/shared/protocol.js';
import { NET, RATE, SFLAG, TICK_HZ, SNAP_HZ } from '../../../js/shared/constants.js';
import { World } from './world.js';
import { AoiState } from './aoi.js';
import { TokenBucket } from './ratelimit.js';
import { flushRows } from './persist.js';

export const SESSION = Object.freeze({
  LIMBO_MS: NET.RESUME_S * 1000,
  FLUSH_MS: 30000,
  CHAT_GW_RATE: [2, 6],         // gateway hard cap for CHAT (S3 applies the real policy: 1 / 2 s, burst 3)
  RATE_DROP_CLOSE: 500,         // messages dropped by rate limits within RATE_DROP_WINDOW_MS → close 4006
  RATE_DROP_WINDOW_MS: 10000,
});

let SID = 0;

export class Session {
  constructor(accountId, now) {
    this.id = ++SID;
    this.accountId = accountId;
    this.conn = null;
    this.state = 'new';            // new → welcomed → active ⇄ limbo → closed
    this.entity = null;
    this.aoi = new AoiState();
    this.v = null;                 // Validator
    this.nickname = ''; this.displayName = ''; this.characterId = null; this.kind = 'guest';
    this.playSeconds = 0;          // lifetime (chat slow mode reads this)
    this.playAcc = 0;              // seconds not flushed yet
    this.dirty = false;
    this.corrEpoch = 0;
    this.lastSeq = -1;
    this.snapPhase = 0;
    this.vehicleRef = 0;
    this.resumeHex = null; this.resumeToken = null;
    this.limboUntil = 0;
    this.joinedAt = now; this.connectedAt = now;
    this.ready = false;            // entity has been added to the world at least once (player:join emitted)
    this.ip = ''; this.tier = 0; this.worldVersion = 0;
    this.blocked = null;           // Set of accountIds this player blocked (fallback when chat has no block API)
    this.lastMsgRef = 0;
    this.rateDrops = 0; this.rateDropT = 0;
    const t = performance.now();
    this.bState = new TokenBucket(RATE.STATE[0], RATE.STATE[1], t);
    this.bAction = new TokenBucket(RATE.ACTION[0], RATE.ACTION[1], t);
    this.bChat = new TokenBucket(SESSION.CHAT_GW_RATE[0], SESSION.CHAT_GW_RATE[1], t);
    this.bPing = new TokenBucket(RATE.PING[0], RATE.PING[1], t);
    this.bReport = new TokenBucket(RATE.REPORT[0], RATE.REPORT[1], t);
    this.snapBytes = 0; this.snapCount = 0;
  }
  get netId() { return this.entity ? this.entity.netId : 0; }
  get active() { return this.state === 'active' && !!this.conn; }
}

// deps: object whose (possibly lazy getter) properties resume / vehicles / queue are the other services (optional)
export function createSessions({ log, metrics, bus, db, now = () => performance.timeOrigin + performance.now(), deps = {}, tickHz = TICK_HZ, snapHz = SNAP_HZ }) {
  const world = new World();
  const byAccount = new Map();
  const active = [];             // sessions receiving snapshots (swap-remove via s._ai)
  const w = new Writer(2048);
  const ended = [];              // persistence rows of sessions that ended since the last flush
  let phaseRR = 0;
  let flushing = Promise.resolve(0);
  const div = Math.max(1, Math.round(tickHz / snapHz));   // snapshot phases (sim.js uses the same formula)

  const mCcu = metrics.gauge('ccu', 'sessions receiving snapshots', () => active.length);
  const mLimbo = metrics.gauge('sessions_limbo', 'sessions waiting for resume (60 s)', () => byAccount.size - active.length);
  const mJoin = metrics.counter('session_join_total', 'sessions that became active (READY or resume)');
  const mLeave = metrics.counter('session_end_total', 'sessions ended');
  const mFlush = metrics.histogram('persist_flush_ms', 'character + play-time flush duration (ms)');
  const mFlushRows = metrics.counter('persist_rows_total', 'character rows written');
  void mCcu; void mLimbo;

  const send = (s, bytes) => (s.conn ? s.conn.send(bytes) : 2);

  const mgr = {
    world,
    div,
    active,
    byAccount,
    load: () => byAccount.size,
    count: () => active.length,
    get: (accountId) => byAccount.get(accountId) || null,
    byNetId(netId) { const e = world.byNetId.get(netId); return e ? e.session : null; },

    create(accountId) {
      const s = new Session(accountId, now());
      s.entity = world.createEntity(accountId);
      s.entity.session = s;
      byAccount.set(accountId, s);
      return s;
    },
    setActive(s) {
      if (s._ai !== undefined && s._ai >= 0) return;
      s._ai = active.length;
      active.push(s);
      s.snapPhase = phaseRR++ % div;
    },
    unsetActive(s) {
      const i = s._ai;
      if (i === undefined || i < 0) return;
      const last = active.pop();
      if (last !== s) { active[i] = last; last._ai = i; }
      s._ai = -1;
    },
    // a NEW client (fresh page, takeover) knows no slots and no names yet; a resumed client keeps both
    resetView(s) { s.aoi = new AoiState(); },
    // READY / resume: avatar visible, snapshots start with a keyframe
    activate(s) {
      s.state = 'active';
      s.aoi.keyframe = true;
      const e = s.entity;
      if (e.flags & SFLAG.AWAY) { e.flags &= ~SFLAG.AWAY; e.requant(); }
      if (!e.inWorld) world.add(e);
      mgr.setActive(s);
      mJoin.inc();
      if (!s.ready) { s.ready = true; bus.emit('player:join', { session: s }); }
    },
    // the socket went away: keep the avatar for LIMBO_MS (resume), flagged AWAY; flush its character now
    toLimbo(s) {
      if (s.state === 'closed') return;
      mgr.unsetActive(s);
      s.conn = null;
      s.state = 'limbo';
      s.limboUntil = now() + SESSION.LIMBO_MS;
      const e = s.entity;
      if (e.inWorld && !(e.flags & SFLAG.AWAY)) { e.flags |= SFLAG.AWAY; e.requant(); }
      mgr.flush([s]);
    },
    // end for good: avatar leaves, netId released, resume revoked, final persistence row queued
    end(s, why = 'end') {
      if (s.state === 'closed') return;
      mgr.unsetActive(s);
      const wasReady = s.ready;
      ended.push(mgr._row(s, true));
      s.state = 'closed';
      if (s.conn) { const c = s.conn; s.conn = null; if (c.data) c.data.session = null; }
      world.destroy(s.entity, Date.now());
      if (byAccount.get(s.accountId) === s) byAccount.delete(s.accountId);
      deps.resume?.revoke(s);
      deps.vehicles?.release(s);
      deps.queue?.noteDeparture();
      mLeave.inc(1, { why });
      if (wasReady) bus.emit('player:leave', { session: s, why });
      mgr.flush([]);
    },
    // close the socket with a SYSTEM message first; no limbo
    kick(accountIdOrSession, reason = KICK_REASON.ADMIN, closeCode = CLOSE.KICKED) {
      const s = typeof accountIdOrSession === 'string' ? byAccount.get(accountIdOrSession) : accountIdOrSession;
      if (!s || s.state === 'closed') return false;
      const c = s.conn;
      if (c) { c.send(encodeSystem(w, SYS.KICK, reason)); c.data.kicked = true; c.close(closeCode, 'kicked'); }
      mgr.end(s, 'kick');
      return true;
    },
    sendSystem(accountId, code, arg = 0) {
      const s = byAccount.get(accountId);
      if (!s || !s.conn) return false;
      return send(s, encodeSystem(w, code, arg)) !== 2;
    },
    broadcastSystem(code, arg = 0) {
      const b = encodeSystem(w, code, arg);
      let n = 0;
      for (const s of byAccount.values()) if (s.conn) { s.conn.send(b); n++; }
      return n;
    },
    broadcastChat(text, channel = CHANNEL.SYSTEM) {
      const b = encodeChatS(w, 0, channel, 0, String(text || ''));
      let n = 0;
      for (const s of active) { s.conn.send(b); n++; }
      return n;
    },
    list() {
      const t = now();
      const out = [];
      for (const s of byAccount.values()) {
        const e = s.entity;
        out.push({
          netId: e.netId, accountId: s.accountId, displayName: s.displayName, x: Math.round(e.x * 10) / 10,
          z: Math.round(e.z * 10) / 10, mode: e.mode, away: s.state !== 'active', state: s.state,
          connectedS: Math.round((t - s.connectedAt) / 1000), ip: s.ip, tier: s.tier,
          corrections: s.v ? s.v.corrections : 0, points: s.v ? Math.round(s.v.pointsNow * 10) / 10 : 0,
        });
      }
      return out;
    },
    // per-second housekeeping: play time, limbo expiry
    sweep(dtS) {
      const t = now();
      for (const s of active) { s.playAcc += dtS; s.playSeconds += dtS; }
      for (const s of [...byAccount.values()]) {
        if (s.state === 'limbo' && t >= s.limboUntil) mgr.end(s, 'limbo_expired');
        else if (s.conn && s.conn.closed && s.state !== 'closed') mgr.toLimbo(s);   // safety net
      }
    },
    _row(s, final) {
      const e = s.entity;
      const play = Math.floor(s.playAcc);
      s.playAcc -= play;
      const row = { accountId: s.accountId, play };
      if ((s.dirty || final) && s.ready) {
        row.x = e.x; row.z = e.z; row.y = e.y; row.yaw = e.yaw; row.cell = e.cell >= 0 ? e.cell : null;
      }
      s.dirty = false;
      return row;
    },
    // write dirty characters + play time. only: list of sessions (disconnect) or undefined = all dirty
    flush(only) {
      if (mgr.stopped) return flushing;     // shutdown: the final flush already ran, the DB is closing
      const rows = ended.splice(0);
      const list = only || byAccount.values();
      for (const s of list) {
        if (s.state === 'closed') continue;
        if (s.dirty || s.playAcc >= 1) rows.push(mgr._row(s, false));
      }
      const useful = rows.filter((r) => r.x !== undefined || r.play >= 1);
      if (!useful.length) return flushing;
      flushing = flushing.then(async () => {
        const t0 = performance.now();
        try {
          await flushRows(db, useful);
          mFlushRows.inc(useful.length);
          return useful.length;
        } catch (e) {
          log.error('persist flush failed', { err: e, rows: useful.length });
          return 0;
        } finally { mFlush.observe(performance.now() - t0); }
      });
      return flushing;
    },
    get flushing() { return flushing; },
    proto: PROTO_VERSION,
  };
  return mgr;
}

export function register(app) {
  const has = (n) => (app.has(n) ? app.get(n) : null);
  const sessions = createSessions({
    log: app.log.child({ mod: 'sessions' }), metrics: app.metrics, bus: app.bus, db: app.db, now: app.nowMs,
    tickHz: app.config.tickHz, snapHz: app.config.snapHz,
    deps: { get resume() { return has('resume'); }, get vehicles() { return has('validate')?.vehicles; }, get queue() { return has('queue'); } },
  });
  app.provide('sessions', sessions);
}
