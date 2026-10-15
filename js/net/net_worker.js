// js/net/net_worker.js — Web Worker giữ WebSocket của game (MP-2 C1, SPEC §1.4).
//
// Vì sao worker: luồng chính bị khoá 17–35 s khi dựng thế giới → socket ở luồng chính lỡ PING/đồng bộ đồng hồ và mọi
// tin dồn lại. Ở đây: HELLO/RESUME, PING 2 Hz (10 s đầu) rồi 1 Hz + ClockSync, giải mã bằng js/shared/codec.js, bảng slot
// SNAPSHOT → bản ghi theo netId đóng gói Float64Array (TRANSFER về luồng chính, không sao chép), nối lại (RESUME trong
// 60 s, backoff 1-2-4-8 s + ngẫu nhiên). Không có HTTP ở đây — vé mới do luồng chính (session.js) lấy rồi gửi xuống.
//
// Thời gian: `eNow()` = performance.timeOrigin + performance.now() của WORKER (cùng thang epoch ms với luồng chính —
// mỗi luồng có timeOrigin riêng nhưng đều là epoch). Gửi lên `off` = giờ máy chủ − eNow → luồng chính:
// serverNow = (performance.timeOrigin + performance.now()) + off.
//
// Tin luồng chính → worker: connect{url, ticket, tier} · state{s} · ready · chat{text} · action{reqId,type,target,arg}
//   · report{target, reason, chatRef} · close · drop (QA: rớt mạng giả, không close frame) · stats
// Tin worker → luồng chính: status · welcome · snap{buf} · names · chat · event · system · correct · clock · world
//   · needTicket{reason} · stats
import {
  Writer, encodeHello, encodeReady, encodeState, encodePing, encodeChat, encodeAction, encodeReport, decodeS2C,
} from '../shared/codec.js';
import { S2C, SYS, CLOSE, SNAP_FLAG, PROTO_VERSION } from '../shared/protocol.js';
import { NET, PING_FAST_S } from '../shared/constants.js';
import { ClockSync } from '../shared/clock.js';

const W = new Writer(2048);
const eNow = () => performance.timeOrigin + performance.now();
const post = (m, tr) => { try { tr ? self.postMessage(m, tr) : self.postMessage(m); } catch (e) { /* luồng chính đóng */ } };

// ---------------------------------------------------------------------------------------------------------------------
let url = '', tier = 0;
let ws = null;
let phase = 'idle';            // idle | open | hello | live | wait | closed
let intentional = false;       // close() do luồng chính yêu cầu → không nối lại
let resumeToken = null;        // Uint8Array(16) của WELCOME gần nhất
let resuming = false;
let lostAt = 0;                // eNow() lúc mất kết nối (0 = đang có)
let backoffMs = 1000;
let serverBackoffMs = 0;       // SYSTEM BACKOFF arg
let reconnectTimer = 0;
let helloAt = 0, liveAt = 0;
let readyWanted = false, readySent = false;
let netId = -1, tickMs = 50;
const clock = new ClockSync();
const pings = new Map();       // clientTime u32 → eNow lúc gửi
let pingTimer = 0;
const slots = new Map();       // slot → netId (bảng của MÁY CHỦ cho người xem này)
const pool = {};               // decodeS2C dùng lại object theo opcode
// mốc tick → giờ máy chủ: base = min(giờ đến − tick·tickMs) trên cửa sổ 64 snapshot (bỏ dao động mạng)
const BASE_N = 64;
const baseRing = new Float64Array(BASE_N);
let baseN = 0, baseI = 0, tickBase = NaN;
const st = { rx: 0, tx: 0, snaps: 0, keyframes: 0, decodeErrors: 0, badSlot: 0, reconnects: 0, resumeOk: 0, resumeFail: 0,
  pingSent: 0, pongs: 0, opens: 0, closes: {} };

function setPhase(p, extra) { phase = p; post({ t: 'status', s: p, ...(extra || {}) }); }

function send(bytes) {
  if (!ws || ws.readyState !== 1) return false;
  try { ws.send(bytes); st.tx += bytes.length; return true; } catch (e) { return false; }
}

// ---------------------------------------------------------------------------------------------------------------------
// kết nối
function open(ticket) {
  clearTimeout(reconnectTimer); reconnectTimer = 0;
  if (ws) { const o = ws; ws = null; try { o.onclose = o.onerror = o.onmessage = o.onopen = null; o.close(); } catch (e) { } }
  intentional = false;
  const useResume = !ticket && !!resumeToken;
  resuming = useResume;
  let sock;
  try { sock = new WebSocket(url); } catch (e) { onLost(1006); return; }
  sock.binaryType = 'arraybuffer';
  ws = sock;
  st.opens++;
  setPhase(useResume ? 'resuming' : 'connecting');
  sock.onopen = () => {
    if (ws !== sock) return;
    phase = 'hello';
    helloAt = eNow();
    send(encodeHello(W, { proto: PROTO_VERSION, worldVersion: 0, tier, ticket: useResume ? '' : ticket, resumeToken: useResume ? resumeToken : null }));
  };
  sock.onmessage = (ev) => { if (ws === sock) onMessage(ev.data); };
  sock.onerror = () => { /* onclose theo sau */ };
  sock.onclose = (ev) => { if (ws === sock) { ws = null; onLost(ev.code || 1006); } };
}

function onLost(code) {
  stopPings();
  st.closes[code] = (st.closes[code] || 0) + 1;
  const wasResuming = resuming;
  resuming = false;
  if (intentional) { setPhase('closed', { code }); return; }
  if (!lostAt) lostAt = eNow();
  // không bao giờ tự nối lại: bị đuổi / cấm / phiên trùng / lệch giao thức
  if (code === CLOSE.KICKED || code === CLOSE.BANNED || code === CLOSE.DUPLICATE || code === CLOSE.PROTO) {
    resumeToken = null;
    setPhase('closed', { code });
    return;
  }
  if (code === CLOSE.AUTH) {                       // vé/resume sai → luồng chính lấy vé mới
    if (wasResuming) st.resumeFail++;
    resumeToken = null;
    setPhase('wait', { code });
    post({ t: 'needTicket', reason: wasResuming ? 'resume_rejected' : 'auth' });
    return;
  }
  scheduleReconnect(code);
}

function scheduleReconnect(code) {
  clearTimeout(reconnectTimer);
  const lostFor = eNow() - lostAt;
  // quá 60 s → phiên (limbo) đã mất trên máy chủ → vé mới
  if (!resumeToken || lostFor > (NET.RESUME_S - 2) * 1000) {
    resumeToken = null;
    setPhase('wait', { code });
    post({ t: 'needTicket', reason: 'expired' });
    return;
  }
  const d = Math.max(backoffMs, serverBackoffMs) + Math.random() * 1000;
  backoffMs = Math.min(8000, backoffMs * 2);
  serverBackoffMs = 0;
  st.reconnects++;
  setPhase('wait', { code, retryInMs: Math.round(d) });
  reconnectTimer = setTimeout(() => { reconnectTimer = 0; open(''); }, d);
}

// ---------------------------------------------------------------------------------------------------------------------
// PING + đồng bộ đồng hồ (2 Hz trong 10 s đầu, rồi 1 Hz)
function startPings() {
  stopPings();
  const loop = () => {
    if (phase !== 'live') return;
    const now = eNow();
    const ct = Math.floor(performance.now()) >>> 0;
    pings.set(ct, now);
    if (pings.size > 16) pings.delete(pings.keys().next().value);
    if (send(encodePing(W, ct))) st.pingSent++;
    const fast = now - liveAt < PING_FAST_S * 1000;
    pingTimer = setTimeout(loop, fast ? 500 : 1000);
  };
  pingTimer = setTimeout(loop, 50);
}
function stopPings() { clearTimeout(pingTimer); pingTimer = 0; pings.clear(); }

function postClock(rtt) {
  const now = eNow();
  const sn = clock.serverNow(now);
  if (!Number.isFinite(sn)) return;
  post({ t: 'clock', off: sn - now, rtt, rttMed: clock.rttMedian, samples: clock.samples });
}

// ---------------------------------------------------------------------------------------------------------------------
// giải mã
function onMessage(data) {
  if (!(data instanceof ArrayBuffer)) return;
  st.rx += data.byteLength;
  const m = decodeS2C(new Uint8Array(data), pool);
  if (m.err) { st.decodeErrors++; return; }
  switch (m.op) {
    case S2C.WELCOME: return onWelcome(m);
    case S2C.SNAPSHOT: return onSnapshot(m);
    case S2C.PONG: {
      const sent = pings.get(m.clientTime);
      if (sent === undefined) return;
      pings.delete(m.clientTime);
      st.pongs++;
      const rtt = clock.addSample(sent, m.serverTime, eNow());
      postClock(rtt);
      return;
    }
    case S2C.NAMES: post({ t: 'names', names: m.names.map((n) => ({ netId: n.netId, name: n.name, badge: n.badge })) }); return;
    case S2C.CHAT: post({ t: 'chat', from: m.from, channel: m.channel, msgRef: m.msgRef, text: m.text }); return;
    case S2C.EVENT: post({ t: 'event', type: m.type, args: m.args.slice() }); return;
    case S2C.CORRECT: post({ t: 'correct', x: m.x, z: m.z, y: m.y, yaw: m.yaw, epoch: m.epoch, reason: m.reason }); return;
    case S2C.WORLD: post({ t: 'world', dayEpoch: m.dayEpoch, dayLength: m.dayLength, weather: m.weather.map((w) => ({ ...w })) }); return;
    case S2C.SYSTEM: {
      if (m.code === SYS.BACKOFF) serverBackoffMs = Math.max(500, Math.min(60000, m.arg));
      if (m.code === SYS.RESUMED) { st.resumeOk++; }
      post({ t: 'system', code: m.code, arg: m.arg });
      return;
    }
    default: return;
  }
}

function onWelcome(m) {
  const now = eNow();
  if (helloAt) clock.addSample(helloAt, m.serverTime, now);   // mẫu đồng hồ đầu (RTT gồm cả thời gian xử lý HELLO)
  const wasResume = resuming;
  resuming = false;
  netId = m.netId;
  tickMs = 1000 / (m.tickHz || 20);
  resumeToken = m.resumeToken;
  lostAt = 0; backoffMs = 1000;
  liveAt = now;
  slots.clear();
  baseN = 0; baseI = 0; tickBase = NaN;
  phase = 'live';
  post({
    t: 'welcome', netId: m.netId, serverTime: m.serverTime, tickHz: m.tickHz, snapHz: m.snapHz, dayEpoch: m.dayEpoch,
    dayLength: m.dayLength, weather: { ...m.weather }, spawn: { ...m.spawn }, resumed: wasResume,
  });
  postClock(NaN);
  setPhase('live', { resumed: wasResume });
  startPings();
  // READY: sau khi thế giới dựng xong (luồng chính báo). RESUME không cần READY (máy chủ gửi KEYFRAME ngay).
  if (wasResume) readySent = true;
  else { readySent = false; if (readyWanted) sendReady(); }
}
function sendReady() { if (phase === 'live' && !readySent && send(encodeReady(W))) readySent = true; }

function tickServerMs(tick) {
  const arr = clock.synced ? clock.serverNow(eNow()) : NaN;
  if (!Number.isFinite(arr)) return NaN;
  const b = arr - tick * tickMs;
  baseRing[baseI] = b; baseI = (baseI + 1) % BASE_N; if (baseN < BASE_N) baseN++;
  let mn = Infinity;
  for (let i = 0; i < baseN; i++) if (baseRing[i] < mn) mn = baseRing[i];
  tickBase = mn;
  return tickBase + tick * tickMs;
}

// SNAPSHOT → Float64Array (transfer):
// [0 tick, 1 flags, 2 serverMs, 3 selfX, 4 selfZ, 5 selfY, 6 corrEpoch, 7 lastSeq, 8 nLeave, 9 nEnter, 10 nUpd]
// + nLeave × netId + nEnter × (netId, x, z, y, yaw, spd, state, app0 u32, app1 u32) + nUpd × (netId, x, z, y, yaw, spd, state)
// (bố cục này lặp lại ở js/net/net.js — sửa cả hai; file worker KHÔNG được import từ luồng chính)
const SNAP_HDR = 11, ENTER_F = 9, UPD_F = 7;
const _seen = new Set();
function onSnapshot(m) {
  st.snaps++;
  const leaves = [];
  if (m.flags & SNAP_FLAG.KEYFRAME) {
    st.keyframes++;
    // máy chủ gửi lại MỌI người đang thấy trong ENTER: ai không còn trong đó = rời
    _seen.clear();
    for (const e of m.enters) _seen.add(e.netId);
    for (const id of slots.values()) if (!_seen.has(id)) leaves.push(id);
    slots.clear();
  }
  for (const s of m.leaves) {
    const id = slots.get(s);
    if (id === undefined) { st.badSlot++; continue; }
    slots.delete(s);
    leaves.push(id);
  }
  for (const e of m.enters) slots.set(e.slot, e.netId);
  let nU = 0;
  for (const u of m.updates) if (slots.has(u.slot)) nU++; else st.badSlot++;
  const nE = m.enters.length;
  const buf = new Float64Array(SNAP_HDR + leaves.length + nE * ENTER_F + nU * UPD_F);
  const sv = m.self;
  buf[0] = m.tick; buf[1] = m.flags; buf[2] = tickServerMs(m.tick);
  buf[3] = sv.x; buf[4] = sv.z; buf[5] = sv.y; buf[6] = sv.corrEpoch; buf[7] = sv.lastSeq;
  buf[8] = leaves.length; buf[9] = nE; buf[10] = nU;
  let p = SNAP_HDR;
  for (const id of leaves) buf[p++] = id;
  for (const e of m.enters) {
    const a = e.appearance;
    buf[p++] = e.netId; buf[p++] = e.x; buf[p++] = e.z; buf[p++] = e.y; buf[p++] = e.yaw; buf[p++] = e.spd; buf[p++] = e.state;
    buf[p++] = (a[0] | (a[1] << 8) | (a[2] << 16) | (a[3] << 24)) >>> 0;
    buf[p++] = (a[4] | (a[5] << 8) | (a[6] << 16) | (a[7] << 24)) >>> 0;
  }
  for (const u of m.updates) {
    const id = slots.get(u.slot);
    if (id === undefined) continue;
    buf[p++] = id; buf[p++] = u.x; buf[p++] = u.z; buf[p++] = u.y; buf[p++] = u.yaw; buf[p++] = u.spd; buf[p++] = u.state;
  }
  post({ t: 'snap', buf: buf.buffer }, [buf.buffer]);
}

// ---------------------------------------------------------------------------------------------------------------------
self.onmessage = (ev) => {
  const m = ev.data || {};
  try {
    switch (m.t) {
      case 'connect':
        url = m.url; tier = m.tier | 0;
        resumeToken = null; lostAt = 0; backoffMs = 1000;
        open(m.ticket || '');
        break;
      case 'state':
        if (phase === 'live') send(encodeState(W, m.s));
        break;
      case 'ready': readyWanted = true; sendReady(); break;
      case 'chat': if (phase === 'live') send(encodeChat(W, m.channel | 0, String(m.text || ''))); break;
      case 'action': if (phase === 'live') send(encodeAction(W, m.reqId | 0, m.type | 0, m.target >>> 0, m.arg >>> 0)); break;
      case 'report': if (phase === 'live') send(encodeReport(W, m.target & 0xffff, m.reason | 0, m.chatRef >>> 0)); break;
      case 'close':
        intentional = true; resumeToken = null; clearTimeout(reconnectTimer); reconnectTimer = 0; stopPings();
        if (ws) { const o = ws; ws = null; try { o.close(CLOSE.NORMAL, 'bye'); } catch (e) { } }
        setPhase('closed', { code: CLOSE.NORMAL });
        break;
      case 'drop':                                   // QA: rớt mạng giả → máy chủ giữ avatar 60 s (limbo) → RESUME
        if (ws) { const o = ws; ws = null; try { o.onclose = o.onerror = o.onmessage = null; o.close(4999, 'drop'); } catch (e) { } onLost(1006); }
        break;
      case 'stats': post({ t: 'stats', st: { ...st, phase, netId, rttMed: clock.rttMedian, samples: clock.samples } }); break;
      default: break;
    }
  } catch (e) {
    post({ t: 'error', msg: String(e && e.message || e) });
  }
};
