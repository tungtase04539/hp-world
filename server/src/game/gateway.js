// game/gateway.js — OWNER: S2. WebSocket endpoint /play (ARCH §6.2, SPEC §3.1):
//   open → (≤ 10 s) HELLO{ticket | resumeToken} → one session per account (the old socket gets SYSTEM
//   DUPLICATE_SESSION + close 4002) → WELCOME + WORLD → READY → snapshots start with a keyframe.
//   Resume within 60 s (HELLO_FLAG.RESUME + the 16-byte token from WELCOME): same netId/state, SYSTEM RESUMED, keyframe
//   immediately (no READY needed). Proto mismatch → SYSTEM RELOAD + close 4004. Bad / expired / replayed ticket →
//   SYSTEM AUTH_FAILED(reason) + close 4001. Banned → SYSTEM BANNED + close 4003.
//   STATE → validation (game/validate.js) → accepted pose / CORRECT / kick. ACTION: MOUNT/DISMOUNT/CALL_MOTO/
//   BLOCK_PLAYER/UNBLOCK_PLAYER/EMOTE (EVENT ACTION_RESULT [reqId, ACTION_RESULT]). CHAT → chat.handle() → SAY within
//   40 m (shadow-mute → sender only; recipients' block lists respected). REPORT → chat.report(). PING → PONG.
//   Per-session token buckets (RATE); 10 malformed messages → close 1008; sustained rate abuse → close 4006.
//   Per-IP: new connections and pre-HELLO sockets are capped leniently (CGNAT); loopback/private IPs are exempt.
//
// Service 'gateway' (tests / bench): { handlers: {open, message, close}, stats() }
import { Writer, decodeC2S, encodePong, encodeSystem, encodeWelcome, encodeWorld, encodeCorrect, encodeEvent, encodeChatS } from '../../../js/shared/codec.js';
import { C2S, SYS, CLOSE, OP_NAMES, PROTO_VERSION, HELLO_FLAG, AUTH_REASON, KICK_REASON, CORRECT_REASON, ACTION, EVENT, CHAT_CODE, REPORT_CODE, CHANNEL, ACTION_RESULT, SANCTION_KIND } from '../../../js/shared/protocol.js';
import { RATE, NET, CHAT, MODE, LAND_H, SFLAG } from '../../../js/shared/constants.js';
import { vmaxOf } from '../../../js/shared/move.js';
import { TokenBucket, isExemptIp, ipKey } from './ratelimit.js';
import { vehicleAllowed, MV_NAMES } from './validate.js';
import { loadPlayer } from './persist.js';
import { chooseSpawn } from './spawn.js';

// EVENT ACTION_RESULT args[1] — the constant lives in js/shared/protocol.js since the integration (re-exported here)
export { ACTION_RESULT };
export const GW = Object.freeze({
  PRE_AUTH_PER_IP: 64,          // sockets that have not sent HELLO yet, per IP (exempt: loopback/private)
  PRE_AUTH_TOTAL: 5000,
  READY_TIMEOUT_MS: 180000,     // WELCOME → READY (world build on a slow phone takes 17–35 s)
  PRE_AUTH_PINGS: 3000,         // PINGs allowed before HELLO (then close 1008)
  BAN_FOREVER: 0xffffffff,
});

export function register(app) {
  const log = app.log.child({ mod: 'gateway' });
  const { config, metrics } = app;
  const w = new Writer(2048);
  const pool = {};
  const pending = new Set();
  const preAuthByIp = new Map();
  let msgRef = (Math.random() * 1e6) >>> 0;

  const msgIn = metrics.counter('ws_play_messages_in_total', 'messages received on /play');
  const bytesIn = metrics.counter('ws_play_bytes_in_total', 'bytes received on /play');
  const bytesOut = metrics.counter('ws_play_bytes_out_total', 'bytes sent on /play');
  const decErr = metrics.counter('ws_play_decode_errors_total', 'malformed messages on /play');
  const mHello = metrics.counter('hello_total', 'HELLO results');
  const mViol = metrics.counter('violations_total', 'movement violations by reason');
  const mCorrect = metrics.counter('corrections_total', 'CORRECT messages by reason');
  const mKick = metrics.counter('kicks_total', 'sessions kicked by reason');
  const mRate = metrics.counter('rate_dropped_total', 'messages dropped by per-session rate limits');
  const mChat = metrics.counter('chat_delivered_total', 'SAY chat deliveries (recipients)');

  let S, V, Q, R, T, W;   // services, resolved on 'start' (registered after this module or before)
  const resolve = () => {
    S = app.get('sessions'); V = app.get('validate'); Q = app.get('queue'); R = app.get('resume'); T = app.get('tickets'); W = app.get('worldclock');
  };
  const chat = () => app.get('chat');
  // S3 temporary / permanent bans (sanctions table, cached in the chat service) → seconds left, 0 = not banned
  const banSecondsLeft = (accountId) => {
    const c = app.has('chat') ? chat() : null;
    if (!c || typeof c.isBanned !== 'function' || !c.isBanned(accountId)) return 0;
    const until = typeof c.sanctionOf === 'function' ? c.sanctionOf(accountId).ban : null;
    return until ? Math.max(1, Math.min(GW.BAN_FOREVER - 1, Math.ceil((until - Date.now()) / 1000))) : GW.BAN_FOREVER;
  };
  const send = (conn, bytes) => { bytesOut.inc(bytes.length); return conn.send(bytes); };
  const now = () => app.nowMs();

  function bad(conn) {
    decErr.inc();
    if (++conn.data.bad >= RATE.BAD_MSG_CLOSE) conn.close(CLOSE.POLICY, 'malformed');
  }
  function rateDrop(conn, s) {
    mRate.inc();
    const t = performance.now();
    if (t - s.rateDropT > 10000) { s.rateDropT = t; s.rateDrops = 0; }
    if (++s.rateDrops > 500) {
      send(conn, encodeSystem(w, SYS.BACKOFF, R.backoffMs(2)));
      mKick.inc(1, { reason: 'rate' });
      conn.data.kicked = true;
      conn.close(CLOSE.RATE, 'rate');
      S.end(s, 'rate');
    }
  }
  function authFail(conn, reason) {
    mHello.inc(1, { r: 'auth_' + reason });
    send(conn, encodeSystem(w, SYS.AUTH_FAILED, reason));
    conn.close(CLOSE.AUTH, 'auth');
  }
  const preAuthDone = (conn) => {
    if (!pending.delete(conn)) return;
    const k = conn.data.ipk;
    if (k) { const n = (preAuthByIp.get(k) || 1) - 1; if (n <= 0) preAuthByIp.delete(k); else preAuthByIp.set(k, n); }
  };

  // ---- session attach (fresh / takeover / resume) -------------------------------------------------------------------
  function attach(conn, s, { resumed }) {
    preAuthDone(conn);
    conn.data.session = s; conn.data.st = 'session';
    s.conn = conn; s.ip = conn.ip; s.connectedAt = now();
    const e = s.entity;
    const token = R.issue(s);
    const t = now();
    send(conn, encodeWelcome(w, {
      netId: e.netId, serverTime: t, tickHz: config.tickHz, snapHz: config.snapHz, dayEpoch: W.dayEpoch,
      dayLength: W.dayLength, resumeToken: token, weather: W.weather(t), spawn: { x: e.x, z: e.z, yaw: e.yaw },
    }));
    send(conn, encodeWorld(w, W.world(t)));
    if (resumed) {
      // the client keeps its world; the time base is re-learned (its worker may have restarted), the first STATE is
      // judged from the last accepted position with the real time elapsed since then
      s.v.reset(e.x, e.z, e.mode, s.lastAcceptT || t);
      s.lastSeq = -1;
      send(conn, encodeSystem(w, SYS.RESUMED, e.netId));
      S.activate(s);
      mHello.inc(1, { r: 'resumed' });
    } else {
      s.state = 'welcomed';
      s.welcomedAt = t;
      S.resetView(s);
      s.corrEpoch = 0; s.lastSeq = -1;
      s.v.reset(e.x, e.z, e.mode, t);
      if (e.inWorld) {   // takeover of a live avatar: AWAY until the new client is READY
        S.unsetActive(s);
        if (!(e.flags & SFLAG.AWAY)) { e.flags |= SFLAG.AWAY; e.requant(); }
      }
    }
  }

  async function hello(conn, m) {
    const proto = m.proto, flags = m.flags, ticket = m.ticket, rt = m.resumeToken, tier = m.tier, wv = m.worldVersion;
    if (proto !== PROTO_VERSION) {
      mHello.inc(1, { r: 'proto' });
      send(conn, encodeSystem(w, SYS.RELOAD, PROTO_VERSION));
      conn.close(CLOSE.PROTO, 'proto');
      return;
    }
    if (flags & HELLO_FLAG.RESUME) {
      const s = R.take(rt);
      if (s && s.state !== 'closed') {
        if (s.conn && s.conn !== conn) {     // half-open old socket: replace it
          const old = s.conn;
          S.unsetActive(s);
          old.data.session = null; old.data.kicked = true;
          old.send(encodeSystem(w, SYS.DUPLICATE_SESSION, 0));
          old.close(CLOSE.DUPLICATE, 'duplicate');
        }
        s.tier = tier; s.worldVersion = wv;
        attach(conn, s, { resumed: true });
        return;
      }
      if (!ticket) { authFail(conn, AUTH_REASON.BAD_RESUME); return; }
    }
    const v = T.verify(ticket);
    if (!v.ok) { authFail(conn, v.reason); return; }
    if (!T.consume(v.nonce, v.exp)) { authFail(conn, AUTH_REASON.REUSED); return; }
    // the ticket's capacity reservation is held until the session exists (or the HELLO fails). Releasing it before the
    // async player load let /v1/join hand out tickets beyond the cap in the meantime (integration stress run: 2,000
    // bots → 10 SYSTEM SERVER_FULL at HELLO for holders of valid tickets).
    try { await admit(conn, v, tier, wv); } finally { Q.release(v.nonce); }
  }

  async function admit(conn, v, tier, wv) {
    const lim = app.get('ratelimit').http.helloAccount;
    if (!lim.take(v.accountId)) {
      send(conn, encodeSystem(w, SYS.BACKOFF, R.backoffMs(1)));
      conn.close(CLOSE.RATE, 'rate');
      mHello.inc(1, { r: 'rate' });
      return;
    }
    let p;
    try { p = await loadPlayer(app.db, v.accountId); } catch (e) {
      log.error('hello: loading the player failed', { err: e });
      send(conn, encodeSystem(w, SYS.BACKOFF, R.backoffMs(1)));
      conn.close(CLOSE.GOING_AWAY, 'db');
      return;
    }
    if (conn.closed) return;
    if (!p || !p.character) { authFail(conn, AUTH_REASON.BAD_TICKET); return; }
    const banLeft = banSecondsLeft(v.accountId);
    if (p.account.status !== 'active' || banLeft) {
      mHello.inc(1, { r: 'banned' });
      send(conn, encodeSystem(w, SYS.BANNED, banLeft || GW.BAN_FOREVER));
      conn.close(CLOSE.BANNED, 'banned');
      return;
    }
    let s = S.get(v.accountId);
    if (s) {
      // one session per account: the newest connection wins, the avatar (netId, position) is kept
      if (s.conn && s.conn !== conn) {
        const old = s.conn;
        S.unsetActive(s);
        s.conn = null;
        old.data.session = null; old.data.kicked = true;
        old.send(encodeSystem(w, SYS.DUPLICATE_SESSION, 0));
        old.close(CLOSE.DUPLICATE, 'duplicate');
      }
      R.revoke(s);
      s.tier = tier; s.worldVersion = wv;
      mHello.inc(1, { r: 'takeover' });
      attach(conn, s, { resumed: false });
      return;
    }
    if (S.load() >= Q.capacity) {
      mHello.inc(1, { r: 'full' });
      send(conn, encodeSystem(w, SYS.SERVER_FULL, 30));
      conn.close(CLOSE.FULL, 'full');
      return;
    }
    s = S.create(v.accountId);
    const c = p.character;
    s.characterId = c.id; s.nickname = c.nickname; s.displayName = c.displayName; s.kind = p.account.kind;
    s.playSeconds = p.account.play_seconds; s.tier = tier; s.worldVersion = wv;
    s.v = V.createValidator();
    const e = s.entity;
    e.name = c.displayName;
    if (c.appearance && c.appearance.length === 8) e.appearance.set(c.appearance);
    const sp = chooseSpawn(S.world, c.x == null ? null : { x: c.x, z: c.z, yaw: c.yaw });
    e.setPose(sp.x, sp.z, sp.id === 'saved' && Number.isFinite(c.y) ? c.y : LAND_H, sp.yaw, 0, MODE.WALK, 0);
    mHello.inc(1, { r: 'ok' });
    attach(conn, s, { resumed: false });
  }

  // ---- in-game messages ---------------------------------------------------------------------------------------------
  function sendCorrect(s, reason, bump = true) {
    const e = s.entity;
    if (bump) s.corrEpoch = (s.corrEpoch + 1) & 255;
    send(s.conn, encodeCorrect(w, e.x, e.z, e.y, e.yaw, s.corrEpoch, reason));
    if (bump) s.v.corrected(e.x, e.z, e.mode, now());
    mCorrect.inc(1, { reason: String(reason) });
  }

  function onState(conn, s, m) {
    if (s.state !== 'active') return;
    if (!s.bState.take(performance.now())) { rateDrop(conn, s); return; }
    s.lastSeq = m.seq;
    const t = now();
    if (m.corrEpoch !== s.corrEpoch) {
      const a = s.v.onStale(t);
      if (a === 'resend') sendCorrect(s, CORRECT_REASON.SERVER_MOVE, false);
      else if (a === 'kick') { mKick.inc(1, { reason: 'ignored_correct' }); S.kick(s, KICK_REASON.CHEAT); }
      return;
    }
    const mode = m.mode;
    const vOk = vehicleAllowed(V.vehicles, S.world, s, mode, m.vehicleRef);
    const r = s.v.onState(m.clientMs, m.x, m.z, mode, t, vOk);
    if (r.accepted) {
      const e = s.entity;
      let spd = Math.sqrt(m.vx * m.vx + m.vz * m.vz);
      const cap = vmaxOf(mode) * 1.25;
      if (spd > cap) spd = cap;
      e.setPose(m.x, m.z, m.y, m.yaw, spd, mode, m.flags);
      S.world.relocate(e);
      s.dirty = true;
      s.lastAcceptT = t;
      return;
    }
    mViol.inc(1, { reason: MV_NAMES[r.violation] || String(r.violation) });
    if (r.kick) {
      mKick.inc(1, { reason: 'cheat' });
      log.info('kicked for movement violations', { account: s.accountId, netId: s.netId, reason: MV_NAMES[r.violation] });
      S.kick(s, KICK_REASON.CHEAT);
      return;
    }
    if (r.correct) sendCorrect(s, r.correct);
  }

  function actionResult(s, reqId, code) { send(s.conn, encodeEvent(w, EVENT.ACTION_RESULT, [reqId, code])); }
  function onAction(conn, s, m) {
    if (s.state !== 'active') return;
    if (!s.bAction.take(performance.now())) { rateDrop(conn, s); return; }
    const V2 = V.vehicles;
    switch (m.type) {
      case ACTION.MOUNT: {
        const ref = m.target & 0xffff;
        if (!ref) { actionResult(s, m.reqId, ACTION_RESULT.INVALID); return; }
        actionResult(s, m.reqId, V2.claim(s, ref) ? ACTION_RESULT.OK : ACTION_RESULT.BUSY);
        return;
      }
      case ACTION.DISMOUNT: V2.release(s); actionResult(s, m.reqId, ACTION_RESULT.OK); return;
      case ACTION.CALL_MOTO: case ACTION.EMOTE: actionResult(s, m.reqId, ACTION_RESULT.OK); return;
      case ACTION.BLOCK_PLAYER: case ACTION.UNBLOCK_PLAYER: {
        const target = S.world.accountOf(m.target & 0xffff);
        if (!target || target === s.accountId) { actionResult(s, m.reqId, ACTION_RESULT.INVALID); return; }
        const block = m.type === ACTION.BLOCK_PLAYER;
        // the in-RAM set applies at once (and is the fallback without a persistent block API); S3's chat.setBlock
        // persists it (social_blocks): arg = 1 → one-way 'mute', otherwise a two-way 'block'
        if (!s.blocked) s.blocked = new Set();
        if (block) s.blocked.add(target); else s.blocked.delete(target);
        const c = chat();
        if (typeof c.setBlock === 'function') {
          Promise.resolve(c.setBlock(s.accountId, target, block, m.arg === 1 ? 'mute' : 'block')).then(
            (r) => { if (s.conn) actionResult(s, m.reqId, r && r.ok === false ? ACTION_RESULT.DENIED : ACTION_RESULT.OK); },
            (e) => { log.warn('block failed', { err: e }); if (s.conn) actionResult(s, m.reqId, ACTION_RESULT.DENIED); });
          return;
        }
        actionResult(s, m.reqId, ACTION_RESULT.OK);
        return;
      }
      default: actionResult(s, m.reqId, ACTION_RESULT.UNSUPPORTED);
    }
  }

  function isBlocked(recipient, sender) {
    if (recipient.blocked && recipient.blocked.has(sender.accountId)) return true;
    const c = chat();
    const b = typeof c.blocks === 'function' ? c.blocks(recipient.accountId) : null;
    return !!(b && b.has(sender.accountId));
  }
  // SAY: everyone active within CHAT.RADIUS (sender included, so it learns msgRef); shadow → sender only
  function deliverSay(s, channel, text, shadow, ref) {
    const bytes = encodeChatS(w, s.entity.netId, channel, ref, text);
    if (shadow) { send(s.conn, bytes); return 1; }
    let n = 0;
    const e = s.entity;
    S.world.forNear(e.x, e.z, CHAT.RADIUS, (o) => {
      const r = o.session;
      if (!r || !r.conn || r.state !== 'active') return false;
      if (r !== s && isBlocked(r, s)) return false;
      send(r.conn, bytes); n++;
      return false;
    }, e.cell >= 0 ? e.cell : undefined);
    mChat.inc(n);
    return n;
  }
  async function onChat(conn, s, m) {
    if (s.state !== 'active') return;
    const channel = m.channel, text = m.text;
    if (!s.bChat.take(performance.now())) {
      rateDrop(conn, s);
      send(conn, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.RATE, s.bChat.retryAfterMs(performance.now())]));
      return;
    }
    let res;
    try { res = await chat().handle(s, channel, text); } catch (e) { log.error('chat.handle threw', { err: e }); return; }
    if (s.state !== 'active' || !s.conn) return;
    if (!res || !res.ok) {
      send(s.conn, encodeEvent(w, EVENT.CHAT_REJECTED, [res?.code ?? CHAT_CODE.BLOCKED, res?.retryAfterMs | 0]));
      return;
    }
    // msgRef: S3's chat log reference (REPORT.chatRef points back to it); own counter only if the service has none
    const ref = res.ref > 0 ? res.ref >>> 0 : (msgRef = (msgRef + 1) >>> 0);
    s.lastMsgRef = ref;
    const out = res.deliverText ?? text;
    const n = deliverSay(s, channel === CHANNEL.SAY ? CHANNEL.SAY : channel, out, !!res.shadow, ref);
    if (res.support) send(s.conn, encodeEvent(w, EVENT.SUPPORT_LINE, []));
    app.bus.emit('chat:message', {
      session: s, channel, text: out, shadow: !!res.shadow, flagged: !!res.flagged, msgRef: ref,
      x: s.entity.x, z: s.entity.z, recipients: n, at: Date.now(),
    });
  }
  async function onReport(conn, s, m) {
    if (s.state !== 'active') return;
    const rep = (code) => { if (s.conn) send(s.conn, encodeEvent(w, EVENT.REPORT_RESULT, [code])); };
    if (!s.bReport.take(performance.now())) { rep(REPORT_CODE.RATE); return; }
    const target = S.world.accountOf(m.targetNetId);
    if (!target) { rep(REPORT_CODE.UNKNOWN_TARGET); return; }
    if (target === s.accountId) { rep(REPORT_CODE.SELF); return; }
    const reason = m.reason, ref = m.chatRef;
    try {
      const r = await chat().report(s, target, reason, ref);
      rep(r && Number.isInteger(r.code) ? r.code : REPORT_CODE.OK);
    } catch (e) { log.error('chat.report threw', { err: e }); }
  }

  // ---- socket handlers ----------------------------------------------------------------------------------------------
  const handlers = {
    open(conn) {
      const ipk = isExemptIp(conn.ip) ? '' : ipKey(conn.ip);
      conn.data = { st: 'hello', bad: 0, t: now(), session: null, kicked: false, ipk, pings: 0 };
      if (ipk) {
        const n = (preAuthByIp.get(ipk) || 0) + 1;
        preAuthByIp.set(ipk, n);
        pending.add(conn);
        if (n > GW.PRE_AUTH_PER_IP) { send(conn, encodeSystem(w, SYS.BACKOFF, R.backoffMs(2))); conn.close(CLOSE.RATE, 'rate'); return; }
      } else pending.add(conn);
      if (pending.size > GW.PRE_AUTH_TOTAL) { send(conn, encodeSystem(w, SYS.BACKOFF, R.backoffMs(3))); conn.close(CLOSE.FULL, 'busy'); return; }
      app.bus.emit('conn:open', { conn });
    },
    message(conn, bytes, isBinary) {
      bytesIn.inc(bytes.length);
      const d = conn.data;
      const m = isBinary ? decodeC2S(bytes, pool) : null;
      if (!m || m.err) { bad(conn); return; }
      msgIn.inc(1, { op: OP_NAMES[m.op] });
      const s = d.session;
      switch (m.op) {
        case C2S.PING:
          // before HELLO (clock sync while the world loads, loopback RTT tools): no token bucket, but the socket is
          // closed after PRE_AUTH_PINGS and anyway by the 10 s HELLO timeout; in a session: RATE.PING bucket
          if (!s) {
            if (++d.pings > GW.PRE_AUTH_PINGS) { conn.close(CLOSE.POLICY, 'ping flood'); return; }
            send(conn, encodePong(w, m.clientTime, now()));
          } else if (s.bPing.take(performance.now())) send(conn, encodePong(w, m.clientTime, now()));
          else rateDrop(conn, s);
          return;
        case C2S.HELLO:
          if (d.st !== 'hello') { bad(conn); return; }
          d.st = 'auth';
          hello(conn, m).catch((e) => { log.error('hello failed', { err: e }); conn.close(CLOSE.GOING_AWAY, 'error'); });
          return;
        default: break;
      }
      if (!s) { if (d.st === 'hello') bad(conn); return; }   // in-game messages before HELLO / during auth
      switch (m.op) {
        case C2S.READY:
          if (s.state === 'welcomed') S.activate(s);
          return;
        case C2S.STATE: onState(conn, s, m); return;
        case C2S.ACTION: onAction(conn, s, m); return;
        case C2S.CHAT: onChat(conn, s, m).catch((e) => log.error('chat failed', { err: e })); return;
        case C2S.REPORT: onReport(conn, s, m).catch((e) => log.error('report failed', { err: e })); return;
        default: bad(conn);
      }
    },
    close(conn, code) {
      preAuthDone(conn);
      const d = conn.data;
      const s = d && d.session;
      if (s && s.conn === conn && !d.kicked && s.state !== 'closed') S.toLimbo(s);
      app.bus.emit('conn:close', { conn, code });
    },
  };
  app.ws.route('/play', handlers);
  app.ws.guard((info) => {
    if (info.path !== '/play' || isExemptIp(info.ip)) return null;
    return app.get('ratelimit').http.wsNewIp.take(ipKey(info.ip)) ? null : { status: 429, reason: 'too many connections' };
  });

  app.provide('gateway', {
    handlers,
    stats: () => ({ pending: pending.size, preAuthIps: preAuthByIp.size }),
    deliverSay: (s, text) => deliverSay(s, CHANNEL.SAY, text, false, (msgRef = (msgRef + 1) >>> 0)),
  });

  app.bus.on('start', () => {
    resolve();
    // HELLO timeout, READY timeout
    app.timers.every(1000, 'gateway_sweep', () => {
      const t = now();
      for (const c of pending) {
        if (c.data.st === 'hello' && t - c.data.t > NET.HELLO_TIMEOUT_S * 1000) {
          send(c, encodeSystem(w, SYS.AUTH_FAILED, AUTH_REASON.NO_HELLO));
          c.close(CLOSE.HELLO_TIMEOUT, 'hello timeout');
          preAuthDone(c);
        }
      }
      for (const s of S.byAccount.values()) {
        if (s.state === 'welcomed' && s.conn && t - s.welcomedAt > GW.READY_TIMEOUT_MS) {
          s.conn.close(CLOSE.HELLO_TIMEOUT, 'ready timeout');
        }
      }
    });
  });
  // sanctions from the moderation side (S3, SERVER.md §3.3 item 5): kick → SYSTEM KICK(ADMIN) + close 4009;
  // ban → SYSTEM BANNED(seconds) + close 4003; mute → EVENT SANCTION [MUTE, seconds] (revoked → seconds 0);
  // warn → EVENT SANCTION [WARN, 0]; shadow → nothing (a shadow mute is never revealed)
  app.bus.on('sanction', ({ accountId, kind, until, seconds, revoked } = {}) => {
    if (!S || !accountId) return;
    let left;
    if (Number.isFinite(seconds) && seconds >= 0) left = Math.min(GW.BAN_FOREVER, Math.round(seconds));
    else left = until ? Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)) : GW.BAN_FOREVER;
    const s = S.get(accountId);
    if (!s) return;
    if (kind === 'kick' || kind === 'ban') {
      if (revoked) return;
      if (kind === 'ban' && s.conn) s.conn.send(encodeSystem(w, SYS.BANNED, left || GW.BAN_FOREVER));
      S.kick(s, KICK_REASON.ADMIN, kind === 'ban' ? CLOSE.BANNED : CLOSE.KICKED);
    } else if (kind === 'mute' && s.conn) {
      send(s.conn, encodeEvent(w, EVENT.SANCTION, [SANCTION_KIND.MUTE, revoked ? 0 : Math.min(left, 0x7fffffff)]));
    } else if (kind === 'warn' && s.conn && !revoked) {
      send(s.conn, encodeEvent(w, EVENT.SANCTION, [SANCTION_KIND.WARN, 0]));
    }
  });
  // owner broadcast (admin page) → S2C CHAT on the SYSTEM channel from netId 0; restart notice → SYSTEM RESTART_IN
  app.bus.on('admin:broadcast', ({ text, ref } = {}) => { if (S && text) S.broadcastChat(text, CHANNEL.SYSTEM, ref >>> 0); });
  app.bus.on('admin:restart', ({ seconds } = {}) => { if (S) S.broadcastSystem(SYS.RESTART_IN, Math.max(0, Math.round(Number(seconds) || 0))); });
  // shutdown: tell clients to come back after a short randomised backoff
  app.onStop(() => {
    if (!S) return;
    for (const s of S.byAccount.values()) if (s.conn) s.conn.send(encodeSystem(w, SYS.BACKOFF, R.backoffMs(0)));
  });
}
