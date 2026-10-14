#!/usr/bin/env node
// server/bots/fakeserver.mjs — SCRIPTED FAKE game server for developing/testing the bot harness while the real game
// modules (S2/S3) are being written. NOT the game server: no DB, no JWT, naive AOI. It speaks the real wire protocol
// (js/shared/codec.js) and the documented HTTP shapes so every bot code path can be exercised:
//   POST /v1/auth/guest {nickname, deviceId, inviteCode} → {accessToken, refreshToken, recoveryCode, account}
//   POST /v1/auth/refresh {refreshToken} → {accessToken, refreshToken};  POST /v1/join → {wsUrl, ticket, spawnHint} | {queue}
//   WS /play: HELLO{ticket | RESUME token} → WELCOME → READY → 10 Hz snapshots (cap 96, ≤ 32 ENTER per snapshot),
//   NAMES, PONG, CHAT within 40 m (+ crude filter / rate), CORRECT (1 s window speed check, teleport), token buckets,
//   close 1008 after 10 malformed, 1009 oversize (ws maxPayload), 4001 bad/reused ticket, 4004 proto, 4007 no HELLO.
//   Admin port: /metrics (hp_sim_tick_ms, hp_snapshot_assembly_ms, hp_ccu, hp_degrade_level + process metrics), /healthz.
// Usage: node server/bots/fakeserver.mjs --port 9130 --admin-port 9131 [--capacity 1200] [--invite CODE]
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  Writer, SnapshotBuilder, decodeC2S, encodeWelcome, encodePong, encodeSystem, encodeNames, encodeEvent, encodeChatS, encodeCorrect,
} from '../../js/shared/codec.js';
import { C2S, SYS, CLOSE, EVENT, CHAT_CODE, AUTH_REASON, KICK_REASON, CORRECT_REASON, PROTO_VERSION, SNAP_FLAG, CHANNEL, API_ERR } from '../../js/shared/protocol.js';
import { AOI, NET, RATE, CHAT, MODE_VMAX, VALIDATE, PLAY_RADIUS } from '../../js/shared/constants.js';
import { qPos, qY, qYaw, qSpd, stateMode } from '../../js/shared/quant.js';
import { pickSpawn, nearestSpawn, SPAWNS } from '../../js/shared/spawns.js';
import { cellOf, neighbors } from '../../js/shared/grid.js';
import { createMetrics } from '../src/metrics.js';

const BAD_RE = /(https?:|www\.|\.\s*c\s*o\s*m\b|\bchấm\s*(com|net|vn)\b|\d[\d\s.\-]{7,}\d|\b(zalo|fb|tele|ig|tiktok|ib)\b|@\w|nạp thẻ|bán acc|chuyển khoản|tài khoản|\bd\s*m+\b|đ\s*[.\s]?\s*m+\b|\bvcl\b|\bclgt\b|\bcl\s*gt\b|d!t|óc chó|\bv\s+l\b|\bc\.c\b|không chín|ngu nhu cho)/i;
const ENTER_CAP = 32;

class Bucket {
  constructor([rate, burst]) { this.rate = rate; this.burst = burst; this.tok = burst; this.t = performance.now(); this.over = 0; }
  take() {
    const now = performance.now();
    this.tok = Math.min(this.burst, this.tok + ((now - this.t) / 1000) * this.rate); this.t = now;
    if (this.tok >= 1) { this.tok -= 1; return true; }
    this.over++;
    return false;
  }
}

export async function startFakeServer({ port = 0, adminPort = 0, host = '127.0.0.1', capacity = 1200, invite = null, publicWsUrl = null } = {}) {
  const metrics = createMetrics();
  const mTick = metrics.histogram('sim_tick_ms', 'fake sim tick duration');
  const mSnap = metrics.histogram('snapshot_assembly_ms', 'fake snapshot assembly per client (ms)');
  const mDec = metrics.counter('ws_play_decode_errors_total', 'malformed messages');
  const mOut = metrics.counter('ws_play_bytes_out_total', 'bytes out');
  const mIn = metrics.counter('ws_play_bytes_in_total', 'bytes in');
  const mCorr = metrics.counter('corrections_total', 'CORRECT sent');
  const mKick = metrics.counter('kicks_total', 'kicks');
  const w = new Writer(65536), sb = new SnapshotBuilder(w), pool = {};
  const accounts = new Map();      // accessToken → acct
  const refresh = new Map();       // refreshToken → acct
  const tickets = new Map();       // ticket → {acct, exp, used}
  const sessions = new Map();      // netId → session
  const byAccount = new Map();     // acct.id → session
  const resumable = new Map();     // hex token → session
  let nextAcct = 1, nextNet = 1, msgRef = 1, tick = 0;
  const dayEpoch = Date.now();
  const now = () => performance.timeOrigin + performance.now();
  metrics.gauge('ccu', 'live sessions', () => [...sessions.values()].filter((s) => s.conn).length);
  metrics.gauge('degrade_level', 'degrade level (fake: always 0)', () => 0);

  const send = (s, bytes) => { if (!s.conn || s.conn.readyState !== 1) return; mOut.inc(bytes.length); s.conn.send(bytes); };
  const kick = (s, sysCode, arg, closeCode, reason) => {
    if (!s.conn) return;
    send(s, encodeSystem(w, sysCode, arg));
    try { s.conn.close(closeCode, reason); } catch { /* ignore */ }
  };

  // ---- HTTP (game port) ----------------------------------------------------------------------------------------
  const body = (req) => new Promise((res) => { let d = ''; req.on('data', (c) => { d += c; if (d.length > 16384) req.destroy(); }); req.on('end', () => { try { res(JSON.parse(d || '{}')); } catch { res(null); } }); });
  const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const game = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET' && url === '/healthz') return json(res, 200, { ok: true, transport: 'fake', proto: PROTO_VERSION, ccu: byAccount.size });
    if (req.method !== 'POST') return json(res, 404, { error: API_ERR.NOT_FOUND });
    const b = await body(req);
    if (!b) return json(res, 400, { error: API_ERR.BAD_REQUEST });
    if (url === '/v1/auth/guest') {
      if (!b.nickname || !b.deviceId) return json(res, 400, { error: API_ERR.BAD_REQUEST });
      if (invite && b.inviteCode !== invite) return json(res, 403, { error: API_ERR.INVITE_INVALID });
      const acct = { id: nextAcct++, name: `${b.nickname}#${String(1000 + (nextAcct % 9000))}` };
      const at = 'fa.' + crypto.randomBytes(12).toString('base64url'), rt = crypto.randomBytes(24).toString('base64url');
      accounts.set(at, acct); refresh.set(rt, acct);
      return json(res, 200, { accessToken: at, refreshToken: rt, recoveryCode: 'FAKE-CODE-1234', account: { id: acct.id, displayName: acct.name } });
    }
    if (url === '/v1/auth/refresh') {
      const acct = refresh.get(b.refreshToken);
      if (!acct) return json(res, 401, { error: API_ERR.UNAUTHORIZED });
      refresh.delete(b.refreshToken);
      const at = 'fa.' + crypto.randomBytes(12).toString('base64url'), rt = crypto.randomBytes(24).toString('base64url');
      accounts.set(at, acct); refresh.set(rt, acct);
      return json(res, 200, { accessToken: at, refreshToken: rt });
    }
    if (url === '/v1/join') {
      const acct = accounts.get(b.accessToken);
      if (!acct) return json(res, 401, { error: API_ERR.UNAUTHORIZED });
      if (b.proto !== PROTO_VERSION) return json(res, 409, { error: API_ERR.PROTO_MISMATCH });
      const live = [...sessions.values()].filter((s) => s.conn).length;
      if (live >= capacity && !byAccount.has(acct.id)) return json(res, 200, { queue: { position: live - capacity + 1, etaS: 5 } });
      const ticket = crypto.randomBytes(32).toString('base64url');
      tickets.set(ticket, { acct, exp: Date.now() + NET.TICKET_TTL_S * 1000, used: false });
      const sp = pickSpawn(spawnCounts());
      return json(res, 200, { wsUrl: publicWsUrl || `ws://${host}:${game.address().port}/play`, ticket, spawnHint: { x: sp.x, z: sp.z, yaw: sp.yaw } });
    }
    return json(res, 404, { error: API_ERR.NOT_FOUND });
  });
  const spawnCounts = () => {
    const c = new Array(SPAWNS.length).fill(0);
    for (const s of sessions.values()) if (s.conn) c[nearestSpawn(s.x, s.z)]++;
    return c;
  };

  // ---- WebSocket /play ---------------------------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true, maxPayload: NET.MAX_C2S_BYTES, perMessageDeflate: false });
  game.on('upgrade', (req, sock, head) => {
    if (req.url.split('?')[0] !== '/play') { sock.destroy(); return; }
    wss.handleUpgrade(req, sock, head, (ws) => onConn(ws));
  });

  function newSession(acct, conn) {
    const sp = pickSpawn(spawnCounts());
    const s = {
      netId: nextNet++ & 0xffff || nextNet++, acct, conn, name: acct.name, x: sp.x, z: sp.z, y: 2, yaw: sp.yaw, spd: 0, state: 0,
      lastSeq: 0, corrEpoch: 0, ready: false, keyframe: true, slots: new Map(), free: Array.from({ length: 255 }, (_, i) => 254 - i),
      named: new Set(), win: null, viol: 0, violT: performance.now(), stateB: new Bucket(RATE.STATE), pingB: new Bucket(RATE.PING),
      chatB: new Bucket(RATE.CHAT), token: crypto.randomBytes(NET.RESUME_TOKEN_BYTES), awayAt: 0,
    };
    sessions.set(s.netId, s); byAccount.set(acct.id, s);
    return s;
  }
  function welcome(s) {
    send(s, encodeWelcome(w, { netId: s.netId, serverTime: now(), tickHz: 20, snapHz: 10, dayEpoch, dayLength: 1440, resumeToken: s.token, weather: { kind: 0, seed: 7 }, spawn: { x: s.x, z: s.z, yaw: s.yaw } }));
  }
  function bad(ws) { mDec.inc(); if (++ws._bad >= RATE.BAD_MSG_CLOSE) ws.close(CLOSE.POLICY, 'malformed'); }

  function onConn(ws) {
    ws._bad = 0; ws._s = null;
    const helloT = setTimeout(() => { if (!ws._s) { ws.send(encodeSystem(w, SYS.AUTH_FAILED, AUTH_REASON.NO_HELLO)); ws.close(CLOSE.HELLO_TIMEOUT, 'no hello'); } }, NET.HELLO_TIMEOUT_S * 1000);
    ws.on('message', (data, isBinary) => {
      mIn.inc(data.length);
      if (!isBinary) return bad(ws);
      const m = decodeC2S(data, pool);
      if (m.err) return bad(ws);
      const s = ws._s;
      if (!s) {
        if (m.op !== C2S.HELLO) return bad(ws);
        clearTimeout(helloT);
        if (m.proto !== PROTO_VERSION) { ws.send(encodeSystem(w, SYS.RELOAD, PROTO_VERSION)); ws.close(CLOSE.PROTO, 'proto'); return; }
        if (m.resumeToken) {
          const r = resumable.get(Buffer.from(m.resumeToken).toString('hex'));
          if (!r || r.conn) { ws.send(encodeSystem(w, SYS.AUTH_FAILED, AUTH_REASON.BAD_RESUME)); ws.close(CLOSE.AUTH, 'bad resume'); return; }
          resumable.delete(r.token.toString('hex'));
          r.conn = ws; r.awayAt = 0; r.ready = false; r.keyframe = true; r.slots.clear(); r.free = Array.from({ length: 255 }, (_, i) => 254 - i); r.named.clear();
          r.token = crypto.randomBytes(NET.RESUME_TOKEN_BYTES); r.win = null;
          ws._s = r;
          send(r, encodeSystem(w, SYS.RESUMED, r.netId));
          welcome(r);
          return;
        }
        const t = tickets.get(m.ticket);
        if (!t || t.exp < Date.now()) { ws.send(encodeSystem(w, SYS.AUTH_FAILED, t ? AUTH_REASON.EXPIRED : AUTH_REASON.BAD_TICKET)); ws.close(CLOSE.AUTH, 'ticket'); return; }
        if (t.used) { ws.send(encodeSystem(w, SYS.AUTH_FAILED, AUTH_REASON.REUSED)); ws.close(CLOSE.AUTH, 'reused'); return; }
        t.used = true;
        const old = byAccount.get(t.acct.id);
        if (old) { kick(old, SYS.DUPLICATE_SESSION, 0, CLOSE.DUPLICATE, 'dup'); drop(old, true); }
        const ns = newSession(t.acct, ws);
        ws._s = ns;
        welcome(ns);
        return;
      }
      switch (m.op) {
        case C2S.READY: s.ready = true; s.keyframe = true; break;
        case C2S.PING:
          if (!s.pingB.take()) { if (s.pingB.over > 200) { mKick.inc(); kick(s, SYS.KICK, KICK_REASON.ABUSE, CLOSE.RATE, 'ping flood'); } break; }
          send(s, encodePong(w, m.clientTime, now()));
          break;
        case C2S.STATE: onState(s, m); break;
        case C2S.CHAT: onChat(s, m); break;
        default: break;
      }
    });
    ws.on('close', () => { clearTimeout(helloT); const s = ws._s; if (s && s.conn === ws) drop(s, false); });
    ws.on('error', () => {});
  }

  function drop(s, forever) {
    s.conn = null; s.ready = false;
    if (forever) { sessions.delete(s.netId); if (byAccount.get(s.acct.id) === s) byAccount.delete(s.acct.id); return; }
    s.awayAt = Date.now();
    resumable.set(s.token.toString('hex'), s);
  }

  function onState(s, m) {
    if (!s.stateB.take()) { if (s.stateB.over > 100) { mKick.inc(); kick(s, SYS.KICK, KICK_REASON.ABUSE, CLOSE.RATE, 'state flood'); } return; }
    if (m.corrEpoch !== s.corrEpoch) return;           // client has not applied our last CORRECT yet
    const t = performance.now();
    const x = m.x, z = m.z, mode = stateMode(m.state);
    const vmax = MODE_VMAX[mode] || 3;
    if (!s.win) s.win = { t, x: s.x, z: s.z, vmax };
    s.win.vmax = Math.max(s.win.vmax, vmax);
    const step = Math.hypot(x - s.x, z - s.z);
    const correct = (reason) => {
      s.corrEpoch = (s.corrEpoch + 1) & 255; mCorr.inc();
      s.x = s.win.x; s.z = s.win.z; s.win = null; s.viol = 0;
      send(s, encodeCorrect(w, s.x, s.z, s.y, s.yaw, s.corrEpoch, reason));
    };
    if (step > VALIDATE.TELEPORT_MUL * (s.win.vmax * VALIDATE.SLACK_MUL + VALIDATE.SLACK_ADD_M)) return correct(CORRECT_REASON.TELEPORT);
    if (Math.hypot(x, z) > PLAY_RADIUS) return correct(CORRECT_REASON.OUT_OF_BOUNDS);
    s.x = x; s.z = z; s.y = m.y; s.yaw = m.yaw; s.spd = Math.hypot(m.vx, m.vz); s.state = m.state; s.lastSeq = m.seq;
    const age = (t - s.win.t) / 1000;
    // decay
    s.viol = Math.max(0, s.viol - ((t - s.violT) / 1000) * VALIDATE.VIOL_DECAY_PER_S); s.violT = t;
    if (age >= VALIDATE.WINDOW_S) {
      const d = Math.hypot(x - s.win.x, z - s.win.z), lim = s.win.vmax * age * VALIDATE.SLACK_MUL + VALIDATE.SLACK_ADD_M;
      if (d > lim) s.viol += d > lim * 1.5 ? VALIDATE.VIOL_CORRECT + 1 : 1;
      if (s.viol > VALIDATE.VIOL_KICK) { mKick.inc(); kick(s, SYS.KICK, KICK_REASON.CHEAT, CLOSE.KICKED, 'cheat'); return; }
      if (s.viol > VALIDATE.VIOL_CORRECT) return correct(CORRECT_REASON.SPEED);
      s.win = { t, x, z, vmax };
    }
  }

  function onChat(s, m) {
    if (m.channel !== CHANNEL.SAY) { send(s, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.CHANNEL, 0])); return; }
    if (!s.chatB.take()) {
      if (s.chatB.over > 300) { mKick.inc(); kick(s, SYS.KICK, KICK_REASON.ABUSE, CLOSE.RATE, 'chat flood'); return; }
      send(s, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.RATE, 2000])); return;
    }
    const text = String(m.text).normalize('NFC').replace(/[​-‏⁠﻿]/g, '');
    if (!text.trim()) { send(s, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.EMPTY, 0])); return; }
    if ([...text].length > CHAT.MAX_CHARS) { send(s, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.TOO_LONG, 0])); return; }
    if (BAD_RE.test(text)) { send(s, encodeEvent(w, EVENT.CHAT_REJECTED, [CHAT_CODE.BLOCKED, 0])); return; }
    const ref = msgRef++ >>> 0;
    const r2 = CHAT.RADIUS * CHAT.RADIUS;
    for (const o of sessions.values()) {
      if (!o.conn || !o.ready) continue;
      if ((o.x - s.x) ** 2 + (o.z - s.z) ** 2 <= r2) send(o, encodeChatS(w, s.netId, CHANNEL.SAY, ref, text));
    }
  }

  // ---- 20 Hz loop: snapshots for half of the clients each tick (10 Hz each, staggered) ----------------------------
  const cells = new Map();
  const nb = [];
  const R2 = AOI.RADIUS * AOI.RADIUS;
  function step() {
    const t0 = performance.now();
    tick++;
    cells.clear();
    for (const s of sessions.values()) {
      if (s.awayAt && Date.now() - s.awayAt > NET.RESUME_S * 1000) { resumable.delete(s.token.toString('hex')); drop(s, true); continue; }
      s.cell = cellOf(s.x, s.z);
      let c = cells.get(s.cell); if (!c) cells.set(s.cell, (c = [])); c.push(s);
    }
    for (const s of sessions.values()) {
      if (!s.conn || !s.ready || ((tick + s.netId) & 1)) continue;
      const ta = performance.now();
      snapshotFor(s);
      mSnap.observe(performance.now() - ta);
    }
    mTick.observe(performance.now() - t0);
  }
  function snapshotFor(s) {
    if (s.conn.bufferedAmount > NET.DROP_SNAPSHOT_BUFFERED) { s.keyframe = true; return; }
    const cand = [];
    const k = neighbors(s.cell, nb);
    for (let i = 0; i < k; i++) {
      for (const o of cells.get(nb[i]) || []) {
        if (o === s) continue;
        const d2 = (o.x - s.x) ** 2 + (o.z - s.z) ** 2;
        if (d2 <= R2) cand.push([d2, o]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    if (cand.length > AOI.CAP) cand.length = AOI.CAP;
    const vis = new Set(cand.map((c) => c[1].netId));
    let flags = 0;
    if (s.keyframe) { flags |= SNAP_FLAG.KEYFRAME; s.slots.clear(); s.free = Array.from({ length: 255 }, (_, i) => 254 - i); s.keyframe = false; }
    sb.begin(tick >>> 0, flags, qPos(s.x), qPos(s.z), qY(s.y), s.corrEpoch, s.lastSeq);
    for (const [nid, slot] of s.slots) if (!vis.has(nid)) { sb.leave(slot); s.slots.delete(nid); s.free.push(slot); }
    sb.enters();
    const names = [];
    let entered = 0;
    for (const [, o] of cand) {
      if (s.slots.has(o.netId) || entered >= ENTER_CAP || !s.free.length) continue;
      const slot = s.free.pop();
      s.slots.set(o.netId, slot); entered++;
      sb.enter(slot, o.netId, qPos(o.x), qPos(o.z), qY(o.y), qYaw(o.yaw), qSpd(o.spd), o.state, null);
      o._justEntered = s;
      if (!s.named.has(o.netId)) { s.named.add(o.netId); names.push({ netId: o.netId, name: o.name, badge: 0 }); }
    }
    sb.updates();
    for (const [, o] of cand) {
      if (o._justEntered === s) { o._justEntered = null; continue; }
      const slot = s.slots.get(o.netId);
      if (slot === undefined) continue;
      sb.update(slot, qPos(o.x), qPos(o.z), qY(o.y), qYaw(o.yaw), qSpd(o.spd), o.state);
    }
    send(s, sb.end());
    if (names.length) send(s, encodeNames(w, names));
  }

  // ---- admin --------------------------------------------------------------------------------------------------------
  const admin = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/metrics') { res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }); res.end(metrics.render()); return; }
    if (url === '/healthz') return json(res, 200, { ok: true });
    json(res, 404, { error: 'not_found' });
  });

  await new Promise((r) => game.listen(port, host, r));
  await new Promise((r) => admin.listen(adminPort, host, r));
  // drift-compensated-enough 20 Hz loop
  let next = performance.now() + 50, timer = null, stopped = false;
  const loop = () => { if (stopped) return; try { step(); } catch (e) { console.error('[fake] tick', e); } next += 50; const d = next - performance.now(); if (d < -200) next = performance.now(); timer = setTimeout(loop, Math.max(0, d)); };
  timer = setTimeout(loop, 50);
  return {
    ports: { game: game.address().port, admin: admin.address().port },
    url: `http://${host}:${game.address().port}`, adminUrl: `http://${host}:${admin.address().port}`,
    sessions,
    async stop() {
      stopped = true; clearTimeout(timer);
      for (const c of wss.clients) c.terminate();
      metrics.stop();
      await new Promise((r) => game.close(r));
      await new Promise((r) => admin.close(r));
      game.closeAllConnections?.(); admin.closeAllConnections?.();
    },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = process.argv.slice(2);
  const arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
  const srv = await startFakeServer({ port: +arg('port', 9130), adminPort: +arg('admin-port', 9131), capacity: +arg('capacity', 1200), invite: arg('invite', null) });
  console.log(`[fake] game ${srv.url} · admin ${srv.adminUrl}/metrics (Ctrl+C to stop)`);
  const bye = async () => { await srv.stop(); process.exit(0); };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
}
