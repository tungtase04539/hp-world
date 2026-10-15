// js/shared/codec.js — the ONLY place that reads/writes the binary wire format (ARCH §6). Pure ESM, no three, no DOM.
// Used by the client network worker, the game server and the headless bots.
//
// Conventions
// - One WebSocket binary message = one protocol message; byte 0 = opcode (protocol.js C2S / S2C). Little-endian.
// - Encoders write into a preallocated Writer and return a Uint8Array VIEW of the writer's buffer. The view is valid
//   until the next encode with the same writer: send it right away (uWS copies; the ws fallback copies), or copy it.
// - Decoders never throw. They return the message object, or one of the frozen DECODE_ERR objects (`msg.err` is set).
//   They read bytes directly (no DataView/allocation per message). Pass a `pool` object (`{}`) to reuse one output
//   object per opcode → zero allocation per STATE/PING on the server hot path (strings/arrays still allocate).
// - Strict: unknown opcode, truncated input, trailing bytes, out-of-range counts, invalid UTF-8 → error.
// - P1 = absolute update records (9 B). P2 delta records are reserved behind SNAP_FLAG.DELTA_P2 (rejected in proto 1).
//
// Byte layouts (sizes include the opcode byte)
// C2S HELLO    op, proto u8, worldVersion u32, tier u8, flags u8, ticketLen u8, ticket[ticketLen] (ASCII/UTF-8),
//              [resumeToken 16 B if flags & HELLO_FLAG.RESUME]                                    9 + ticket (+16)
// C2S READY    op                                                                                  1
// C2S STATE    op, seq u16, clientMs u16, x u16, z u16, y u8, yaw u8, vx i8, vz i8, state u8, corrEpoch u8,
//              vehicleRef u16                                                                      17
// C2S ACTION   op, reqId u16, type u8, target u32, arg u32                                         12
// C2S CHAT     op, channel u8, len u16, UTF-8[len ≤ 420]                                            4 + len
// C2S PING     op, clientTime u32                                                                  5
// C2S REPORT   op, targetNetId u16, reason u8, chatRef u32                                         8
// S2C WELCOME  op, proto u8, netId u16, serverTime f64, tickHz u8, snapHz u8, dayEpoch f64, dayLength u16,
//              resumeToken 16 B, weather{kind u8, intensity u8, windDir u8, windSpeed u8, seed u32},
//              spawn x u16, z u16, yaw u8                                                          53
// S2C SNAPSHOT op, tick u32, flags u8, self{x u16, z u16, y u8, corrEpoch u8, lastSeq u16},
//              nLeave u8, slot u8[nLeave],
//              nEnter u8, {slot u8, netId u16, x u16, z u16, y u8, yaw u8, spd u8, state u8, appearance 8 B}[nEnter],
//              nUpd u8, {slot u8, x u16, z u16, y u8, yaw u8, spd u8, state u8}[nUpd]
//              = 17 + nLeave + 19·nEnter + 9·nUpd   (96 updates → 881 B)
// S2C NAMES    op, n u8, {netId u16, badge u8, len u8, UTF-8[len ≤ 72]}[n]
// S2C EVENT    op, type u16, n u8, args i32[n ≤ 8]                                                4 + 4n
// S2C STATS    op, mask u8, {value u8, rate i8}[popcount(mask & 31)], [money uLEB128 if mask & 32]
// S2C CHAT     op, from u16, channel u8, msgRef u32, len u16, UTF-8[len ≤ 420]                      10 + len
// S2C SYSTEM   op, code u8, arg u32                                                                6
// S2C PONG     op, clientTime u32, serverTime f64                                                  13
// S2C CORRECT  op, x u16, z u16, y u8, yaw u8, epoch u8, reason u8                                 9
// S2C WORLD    op, dayEpoch f64, dayLength u16, n u8,
//              {kind u8, intensity u8, windDir u8, windSpeed u8, seed u32, t0 f64, t1 f64}[n ≤ 16]   12 + 24n
import { PROTO_VERSION, C2S, S2C, HELLO_FLAG, SNAP_FLAG } from './protocol.js';
import { CHAT, NET, NICK } from './constants.js';
import { qPos, dqPos, qY, dqY, qYaw, dqYaw, qSpd, dqSpd, qVel, dqVel, stateMode, stateFlags } from './quant.js';

export const APPEARANCE_BYTES = 8;
export const RESUME_TOKEN_BYTES = NET.RESUME_TOKEN_BYTES;
export const MAX_EVENT_ARGS = 8;
export const MAX_WORLD_ENTRIES = 16;
export const SNAPSHOT_HEADER_BYTES = 17;
export const ENTER_RECORD_BYTES = 19;
export const UPDATE_RECORD_BYTES = 9;
export const MAX_NAME_BYTES = NICK.DISPLAY_MAX_BYTES;

// Fixed message sizes (opcode included) for the fixed-size messages.
export const SIZE = Object.freeze({
  READY: 1, STATE: 17, ACTION: 12, PING: 5, REPORT: 8,
  WELCOME: 53, SYSTEM: 6, PONG: 13, CORRECT: 9,
});

const mkErr = (err) => Object.freeze({ op: -1, err });
export const DECODE_ERR = Object.freeze({
  EMPTY: mkErr('empty'),
  OPCODE: mkErr('opcode'),
  TRUNCATED: mkErr('truncated'),
  LENGTH: mkErr('length'),          // trailing bytes after a complete message
  OVERSIZE: mkErr('oversize'),
  VALUE: mkErr('value'),            // a field is out of its allowed range
  UTF8: mkErr('utf8'),
  UNSUPPORTED: mkErr('unsupported'),
  INPUT: mkErr('input'),            // not a byte buffer
});

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

// =====================================================================================================================
// Writer — preallocated little-endian byte writer
// =====================================================================================================================
export class Writer {
  constructor(size = 65536) {
    this.buf = new Uint8Array(size);
    this.dv = new DataView(this.buf.buffer);
    this.pos = 0;
  }
  reset() { this.pos = 0; return this; }
  _need(n) { if (this.pos + n > this.buf.length) throw new RangeError('codec Writer overflow'); }
  u8(v) { this._need(1); this.buf[this.pos++] = v & 255; return this; }
  i8(v) { return this.u8(v); }
  u16(v) { this._need(2); const b = this.buf, p = this.pos; b[p] = v & 255; b[p + 1] = (v >>> 8) & 255; this.pos = p + 2; return this; }
  u32(v) { this._need(4); this.dv.setUint32(this.pos, v >>> 0, true); this.pos += 4; return this; }
  i32(v) { this._need(4); this.dv.setInt32(this.pos, v | 0, true); this.pos += 4; return this; }
  f64(v) { this._need(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; return this; }
  bytes(src, off = 0, len = src.length - off) {
    this._need(len);
    for (let i = 0; i < len; i++) this.buf[this.pos + i] = src[off + i];
    this.pos += len;
    return this;
  }
  zeros(n) { this._need(n); this.buf.fill(0, this.pos, this.pos + n); this.pos += n; return this; }
  // unsigned LEB128 for integers in [0, 2^53)
  uleb(v) {
    let n = Math.floor(v);
    if (!(n >= 0)) n = 0;
    if (n > Number.MAX_SAFE_INTEGER) n = Number.MAX_SAFE_INTEGER;
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n > 0) b |= 128;
      this.u8(b);
    } while (n > 0);
    return this;
  }
  // UTF-8 string with a length prefix of `prefixBytes` (1 or 2). Truncates at a code-point boundary to maxBytes.
  // Returns the number of string bytes written.
  str(s, maxBytes, prefixBytes) {
    const lenPos = this.pos;
    this._need(prefixBytes);
    this.pos += prefixBytes;
    const room = Math.min(maxBytes, this.buf.length - this.pos);
    const r = enc.encodeInto(String(s ?? ''), this.buf.subarray(this.pos, this.pos + room));
    const n = r.written;
    if (prefixBytes === 1) this.buf[lenPos] = n;
    else { this.buf[lenPos] = n & 255; this.buf[lenPos + 1] = (n >>> 8) & 255; }
    this.pos += n;
    return n;
  }
  view() { return this.buf.subarray(0, this.pos); }
  copy() { return this.buf.slice(0, this.pos); }
}

// =====================================================================================================================
// BitWriter / BitReader — LSB-first bit packing on top of a Writer / a byte array (for P2 delta masks and future use)
// =====================================================================================================================
export class BitWriter {
  constructor(w) { this.w = w; this.acc = 0; this.n = 0; }
  bits(v, count) {               // count ≤ 24
    this.acc |= (v & ((1 << count) - 1)) << this.n;
    this.n += count;
    while (this.n >= 8) { this.w.u8(this.acc & 255); this.acc >>>= 8; this.n -= 8; }
    return this;
  }
  bit(b) { return this.bits(b ? 1 : 0, 1); }
  flush() { if (this.n > 0) { this.w.u8(this.acc & 255); this.acc = 0; this.n = 0; } return this; }
}
export class BitReader {
  constructor(bytes, pos = 0, end = bytes.length) { this.b = bytes; this.pos = pos; this.end = end; this.acc = 0; this.n = 0; }
  bits(count) {
    while (this.n < count) {
      if (this.pos >= this.end) throw TRUNC;
      this.acc |= this.b[this.pos++] << this.n;
      this.n += 8;
    }
    const v = this.acc & ((1 << count) - 1);
    this.acc >>>= count;
    this.n -= count;
    return v;
  }
  bit() { return this.bits(1) === 1; }
}

// =====================================================================================================================
// Reader — module-level, zero-allocation (decode is synchronous and non-reentrant)
// =====================================================================================================================
const TRUNC = { truncated: true };   // thrown internally, caught by the top-level decoders
const f64s = new DataView(new ArrayBuffer(8));
let B = null, P = 0, E = 0;

function rU8() { if (P >= E) throw TRUNC; return B[P++]; }
function rI8() { const v = rU8(); return v > 127 ? v - 256 : v; }
function rU16() { if (P + 2 > E) throw TRUNC; const v = B[P] | (B[P + 1] << 8); P += 2; return v; }
function rU32() { if (P + 4 > E) throw TRUNC; const v = (B[P] | (B[P + 1] << 8) | (B[P + 2] << 16) | (B[P + 3] << 24)) >>> 0; P += 4; return v; }
function rI32() { return rU32() | 0; }
function rF64() {
  if (P + 8 > E) throw TRUNC;
  for (let i = 0; i < 8; i++) f64s.setUint8(i, B[P + i]);
  P += 8;
  return f64s.getFloat64(0, true);
}
// always a COPY (Node's Buffer#slice returns a view; uWS message memory is only valid during the callback)
function rBytes(n) { if (P + n > E) throw TRUNC; const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = B[P + i]; P += n; return out; }
function rStr(n) {
  if (P + n > E) throw TRUNC;
  const s = n === 0 ? '' : dec.decode(B.subarray(P, P + n));   // throws TypeError on invalid UTF-8
  P += n;
  return s;
}
function rUleb() {
  let v = 0, mul = 1;
  for (let i = 0; i < 8; i++) {
    const b = rU8();
    v += (b & 127) * mul;
    if (!(b & 128)) return v;
    mul *= 128;
  }
  throw BADVAL;
}
const BADVAL = { badValue: true };
const UNSUP = { unsupported: true };

function asBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return null;
}
function obj(pool, op) {
  if (!pool) return { op };
  let o = pool[op];
  if (!o) { o = { op }; pool[op] = o; }
  return o;
}
function finish(m) { return P === E ? m : DECODE_ERR.LENGTH; }
function mapErr(e) {
  if (e === TRUNC) return DECODE_ERR.TRUNCATED;
  if (e === BADVAL) return DECODE_ERR.VALUE;
  if (e === UNSUP) return DECODE_ERR.UNSUPPORTED;
  if (e instanceof TypeError) return DECODE_ERR.UTF8;
  return DECODE_ERR.VALUE;
}

// =====================================================================================================================
// Client → server
// =====================================================================================================================
export function encodeHello(w, { proto = PROTO_VERSION, worldVersion = 0, tier = 0, ticket = '', resumeToken = null } = {}) {
  w.reset().u8(C2S.HELLO).u8(proto).u32(worldVersion).u8(tier).u8(resumeToken ? HELLO_FLAG.RESUME : 0);
  w.str(ticket, NET.MAX_TICKET_BYTES, 1);
  if (resumeToken) {
    if (resumeToken.length !== RESUME_TOKEN_BYTES) throw new RangeError('resumeToken must be 16 bytes');
    w.bytes(resumeToken);
  }
  return w.view();
}
export function encodeReady(w) { return w.reset().u8(C2S.READY).view(); }
// s: {seq, clientMs, x, z, y, yaw, vx, vz, state, corrEpoch, vehicleRef}  (floats in metres / radians / m/s)
export function encodeState(w, s) {
  return w.reset().u8(C2S.STATE).u16(s.seq & 0xffff).u16(s.clientMs & 0xffff)
    .u16(qPos(s.x)).u16(qPos(s.z)).u8(qY(s.y)).u8(qYaw(s.yaw)).i8(qVel(s.vx || 0)).i8(qVel(s.vz || 0))
    .u8(s.state & 255).u8(s.corrEpoch & 255).u16((s.vehicleRef || 0) & 0xffff).view();
}
export function encodeAction(w, reqId, type, target = 0, arg = 0) {
  return w.reset().u8(C2S.ACTION).u16(reqId & 0xffff).u8(type).u32(target).u32(arg).view();
}
export function encodeChat(w, channel, text) {
  w.reset().u8(C2S.CHAT).u8(channel);
  w.str(text, CHAT.MAX_BYTES, 2);
  return w.view();
}
export function encodePing(w, clientTime) { return w.reset().u8(C2S.PING).u32(clientTime >>> 0).view(); }
export function encodeReport(w, targetNetId, reason, chatRef = 0) {
  return w.reset().u8(C2S.REPORT).u16(targetNetId).u8(reason).u32(chatRef).view();
}

function dHello(m) {
  m.proto = rU8(); m.worldVersion = rU32(); m.tier = rU8();
  const flags = rU8();
  if (flags & ~HELLO_FLAG.RESUME) throw BADVAL;
  m.flags = flags;
  m.ticket = rStr(rU8());
  m.resumeToken = flags & HELLO_FLAG.RESUME ? rBytes(RESUME_TOKEN_BYTES) : null;
  return m;
}
function dState(m) {
  m.seq = rU16(); m.clientMs = rU16();
  m.qx = rU16(); m.qz = rU16(); m.qy = rU8(); m.qyaw = rU8();
  m.x = dqPos(m.qx); m.z = dqPos(m.qz); m.y = dqY(m.qy); m.yaw = dqYaw(m.qyaw);
  m.vx = dqVel(rI8()); m.vz = dqVel(rI8());
  m.state = rU8(); m.mode = stateMode(m.state); m.flags = stateFlags(m.state);
  m.corrEpoch = rU8(); m.vehicleRef = rU16();
  return m;
}
function dAction(m) { m.reqId = rU16(); m.type = rU8(); m.target = rU32(); m.arg = rU32(); return m; }
function dChatC(m) {
  m.channel = rU8();
  const n = rU16();
  if (n > CHAT.MAX_BYTES) throw BADVAL;
  m.text = rStr(n);
  return m;
}
function dPing(m) { m.clientTime = rU32(); return m; }
function dReport(m) { m.targetNetId = rU16(); m.reason = rU8(); m.chatRef = rU32(); return m; }

const C2S_DEC = new Array(256).fill(null);
C2S_DEC[C2S.HELLO] = dHello;
C2S_DEC[C2S.READY] = (m) => m;
C2S_DEC[C2S.STATE] = dState;
C2S_DEC[C2S.ACTION] = dAction;
C2S_DEC[C2S.CHAT] = dChatC;
C2S_DEC[C2S.PING] = dPing;
C2S_DEC[C2S.REPORT] = dReport;

// Decode a client → server message. Never throws. `pool` (optional {}) reuses one object per opcode.
export function decodeC2S(input, pool) {
  const b = asBytes(input);
  if (!b) return DECODE_ERR.INPUT;
  if (b.length === 0) return DECODE_ERR.EMPTY;
  if (b.length > NET.MAX_C2S_BYTES) return DECODE_ERR.OVERSIZE;
  const fn = C2S_DEC[b[0]];
  if (!fn) return DECODE_ERR.OPCODE;
  B = b; P = 1; E = b.length;
  try { return finish(fn(obj(pool, b[0]))); } catch (e) { return mapErr(e); } finally { B = null; }
}

// =====================================================================================================================
// Server → client
// =====================================================================================================================
// msg: {netId, serverTime, tickHz, snapHz, dayEpoch, dayLength, resumeToken(16 B), weather{kind,intensity,windDir,
//       windSpeed,seed}, spawn{x,z,yaw}}
export function encodeWelcome(w, m) {
  w.reset().u8(S2C.WELCOME).u8(m.proto ?? PROTO_VERSION).u16(m.netId).f64(m.serverTime).u8(m.tickHz).u8(m.snapHz)
    .f64(m.dayEpoch).u16(m.dayLength);
  if (m.resumeToken) {
    if (m.resumeToken.length !== RESUME_TOKEN_BYTES) throw new RangeError('resumeToken must be 16 bytes');
    w.bytes(m.resumeToken);
  } else w.zeros(RESUME_TOKEN_BYTES);
  const wx = m.weather || {};
  w.u8(wx.kind || 0).u8(wx.intensity || 0).u8(wx.windDir || 0).u8(wx.windSpeed || 0).u32(wx.seed || 0);
  const sp = m.spawn || {};
  w.u16(qPos(sp.x || 0)).u16(qPos(sp.z || 0)).u8(qYaw(sp.yaw || 0));
  return w.view();
}

// Incremental snapshot writer for the server hot path. Takes QUANTISED values (quantise once per entity per tick).
// Order: begin → leave()* → enters() → enter()* → updates() → update()* → end(). enter/update return false when full.
export class SnapshotBuilder {
  constructor(w) { this.w = w; this.cPos = 0; this.count = 0; this.phase = 0; }
  begin(tick, flags, qx, qz, qy, corrEpoch, lastSeq) {
    const w = this.w;
    w.reset().u8(S2C.SNAPSHOT).u32(tick).u8(flags & ~SNAP_FLAG.DELTA_P2).u16(qx).u16(qz).u8(qy).u8(corrEpoch).u16(lastSeq);
    this.cPos = w.pos; w.u8(0); this.count = 0; this.phase = 1;
    return this;
  }
  _next(phase) {
    if (this.phase !== phase - 1) throw new Error('SnapshotBuilder: wrong order');
    this.w.buf[this.cPos] = this.count;
    this.cPos = this.w.pos; this.w.u8(0); this.count = 0; this.phase = phase;
  }
  leave(slot) {
    if (this.phase !== 1) throw new Error('SnapshotBuilder: leave() after enters()');
    if (this.count >= 255) return false;
    this.w.u8(slot); this.count++;
    return true;
  }
  enters() { this._next(2); return this; }
  enter(slot, netId, qx, qz, qy, qyaw, qspd, state, appearance, appOff = 0) {
    if (this.phase !== 2) throw new Error('SnapshotBuilder: enter() outside enters()');
    if (this.count >= 255) return false;
    const w = this.w;
    w.u8(slot).u16(netId).u16(qx).u16(qz).u8(qy).u8(qyaw).u8(qspd).u8(state);
    if (appearance) w.bytes(appearance, appOff, APPEARANCE_BYTES); else w.zeros(APPEARANCE_BYTES);
    this.count++;
    return true;
  }
  updates() { this._next(3); return this; }
  update(slot, qx, qz, qy, qyaw, qspd, state) {
    if (this.phase !== 3) throw new Error('SnapshotBuilder: update() outside updates()');
    if (this.count >= 255) return false;
    this.w.u8(slot).u16(qx).u16(qz).u8(qy).u8(qyaw).u8(qspd).u8(state);
    this.count++;
    return true;
  }
  end() {
    if (this.phase === 1) this._next(2);
    if (this.phase === 2) this._next(3);
    this.w.buf[this.cPos] = this.count;
    this.phase = 0;
    return this.w.view();
  }
  get size() { return this.w.pos; }
}

// Convenience (bots/tests): snapshot from an object with float fields.
// snap: {tick, flags, self{x,z,y,corrEpoch,lastSeq}, leaves[], enters[{slot,netId,x,z,y,yaw,spd,state,appearance}],
//        updates[{slot,x,z,y,yaw,spd,state}]}
export function encodeSnapshot(w, s) {
  const sb = new SnapshotBuilder(w);
  const me = s.self || {};
  sb.begin(s.tick >>> 0, s.flags || 0, qPos(me.x || 0), qPos(me.z || 0), qY(me.y || 0), me.corrEpoch || 0, me.lastSeq || 0);
  for (const l of s.leaves || []) sb.leave(l);
  sb.enters();
  for (const e of s.enters || []) sb.enter(e.slot, e.netId, qPos(e.x), qPos(e.z), qY(e.y), qYaw(e.yaw), qSpd(e.spd), e.state & 255, e.appearance);
  sb.updates();
  for (const u of s.updates || []) sb.update(u.slot, qPos(u.x), qPos(u.z), qY(u.y), qYaw(u.yaw), qSpd(u.spd), u.state & 255);
  return sb.end();
}

// names: [{netId, name, badge}]
export function encodeNames(w, names) {
  const n = Math.min(255, names.length);
  w.reset().u8(S2C.NAMES).u8(n);
  for (let i = 0; i < n; i++) {
    const e = names[i];
    w.u16(e.netId).u8(e.badge || 0);
    w.str(e.name, MAX_NAME_BYTES, 1);
  }
  return w.view();
}
export function encodeEvent(w, type, args) {
  const n = args ? Math.min(MAX_EVENT_ARGS, args.length) : 0;
  w.reset().u8(S2C.EVENT).u16(type).u8(n);
  for (let i = 0; i < n; i++) w.i32(args[i]);
  return w.view();
}
// stats: {mask, v[5] (0..255), r[5] (-128..127), money}. Bits 0..4 → v/r pairs, bit 5 → money.
export function encodeStats(w, st) {
  const mask = st.mask & 63;
  w.reset().u8(S2C.STATS).u8(mask);
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) w.u8(st.v[i]).i8(st.r ? st.r[i] : 0);
  if (mask & 32) w.uleb(st.money);
  return w.view();
}
export function encodeChatS(w, from, channel, msgRef, text) {
  w.reset().u8(S2C.CHAT).u16(from).u8(channel).u32(msgRef);
  w.str(text, CHAT.MAX_BYTES, 2);
  return w.view();
}
export function encodeSystem(w, code, arg = 0) { return w.reset().u8(S2C.SYSTEM).u8(code).u32(arg).view(); }
export function encodePong(w, clientTime, serverTime) {
  return w.reset().u8(S2C.PONG).u32(clientTime >>> 0).f64(serverTime).view();
}
export function encodeCorrect(w, x, z, y, yaw, epoch, reason) {
  return w.reset().u8(S2C.CORRECT).u16(qPos(x)).u16(qPos(z)).u8(qY(y)).u8(qYaw(yaw)).u8(epoch & 255).u8(reason).view();
}
// world: {dayEpoch, dayLength, weather: [{kind,intensity,windDir,windSpeed,seed,t0,t1}]}
export function encodeWorld(w, m) {
  const list = m.weather || [];
  const n = Math.min(MAX_WORLD_ENTRIES, list.length);
  w.reset().u8(S2C.WORLD).f64(m.dayEpoch).u16(m.dayLength).u8(n);
  for (let i = 0; i < n; i++) {
    const e = list[i];
    w.u8(e.kind || 0).u8(e.intensity || 0).u8(e.windDir || 0).u8(e.windSpeed || 0).u32(e.seed || 0).f64(e.t0 || 0).f64(e.t1 || 0);
  }
  return w.view();
}

function dWelcome(m) {
  m.proto = rU8(); m.netId = rU16(); m.serverTime = rF64(); m.tickHz = rU8(); m.snapHz = rU8();
  m.dayEpoch = rF64(); m.dayLength = rU16(); m.resumeToken = rBytes(RESUME_TOKEN_BYTES);
  m.weather = { kind: rU8(), intensity: rU8(), windDir: rU8(), windSpeed: rU8(), seed: rU32() };
  m.spawn = { x: dqPos(rU16()), z: dqPos(rU16()), yaw: dqYaw(rU8()) };
  return m;
}
function dSnapshot(m) {
  m.tick = rU32();
  m.flags = rU8();
  if (m.flags & SNAP_FLAG.DELTA_P2) throw UNSUP;
  m.self = { x: dqPos(rU16()), z: dqPos(rU16()), y: dqY(rU8()), corrEpoch: rU8(), lastSeq: rU16() };
  const nL = rU8();
  m.leaves = new Array(nL);
  for (let i = 0; i < nL; i++) m.leaves[i] = rU8();
  const nE = rU8();
  m.enters = new Array(nE);
  for (let i = 0; i < nE; i++) {
    const slot = rU8(), netId = rU16(), x = dqPos(rU16()), z = dqPos(rU16()), y = dqY(rU8()), yaw = dqYaw(rU8()),
      spd = dqSpd(rU8()), state = rU8(), appearance = rBytes(APPEARANCE_BYTES);
    m.enters[i] = { slot, netId, x, z, y, yaw, spd, state, appearance };
  }
  const nU = rU8();
  m.updates = new Array(nU);
  for (let i = 0; i < nU; i++) {
    m.updates[i] = { slot: rU8(), x: dqPos(rU16()), z: dqPos(rU16()), y: dqY(rU8()), yaw: dqYaw(rU8()), spd: dqSpd(rU8()), state: rU8() };
  }
  return m;
}
function dNames(m) {
  const n = rU8();
  m.names = new Array(n);
  for (let i = 0; i < n; i++) {
    const netId = rU16(), badge = rU8(), len = rU8();
    if (len > MAX_NAME_BYTES) throw BADVAL;
    m.names[i] = { netId, badge, name: rStr(len) };
  }
  return m;
}
function dEvent(m) {
  m.type = rU16();
  const n = rU8();
  if (n > MAX_EVENT_ARGS) throw BADVAL;
  m.args = new Array(n);
  for (let i = 0; i < n; i++) m.args[i] = rI32();
  return m;
}
function dStats(m) {
  const mask = rU8();
  if (mask & 0xc0) throw BADVAL;
  m.mask = mask;
  m.v = [0, 0, 0, 0, 0]; m.r = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5; i++) if (mask & (1 << i)) { m.v[i] = rU8(); m.r[i] = rI8(); }
  m.money = mask & 32 ? rUleb() : null;
  return m;
}
function dChatS(m) {
  m.from = rU16(); m.channel = rU8(); m.msgRef = rU32();
  const n = rU16();
  if (n > CHAT.MAX_BYTES) throw BADVAL;
  m.text = rStr(n);
  return m;
}
function dSystem(m) { m.code = rU8(); m.arg = rU32(); return m; }
function dPong(m) { m.clientTime = rU32(); m.serverTime = rF64(); return m; }
function dCorrect(m) {
  m.x = dqPos(rU16()); m.z = dqPos(rU16()); m.y = dqY(rU8()); m.yaw = dqYaw(rU8()); m.epoch = rU8(); m.reason = rU8();
  return m;
}
function dWorld(m) {
  m.dayEpoch = rF64(); m.dayLength = rU16();
  const n = rU8();
  if (n > MAX_WORLD_ENTRIES) throw BADVAL;
  m.weather = new Array(n);
  for (let i = 0; i < n; i++) {
    m.weather[i] = { kind: rU8(), intensity: rU8(), windDir: rU8(), windSpeed: rU8(), seed: rU32(), t0: rF64(), t1: rF64() };
  }
  return m;
}

const S2C_DEC = new Array(256).fill(null);
S2C_DEC[S2C.WELCOME] = dWelcome;
S2C_DEC[S2C.SNAPSHOT] = dSnapshot;
S2C_DEC[S2C.NAMES] = dNames;
S2C_DEC[S2C.EVENT] = dEvent;
S2C_DEC[S2C.STATS] = dStats;
S2C_DEC[S2C.CHAT] = dChatS;
S2C_DEC[S2C.SYSTEM] = dSystem;
S2C_DEC[S2C.PONG] = dPong;
S2C_DEC[S2C.CORRECT] = dCorrect;
S2C_DEC[S2C.WORLD] = dWorld;

export const MAX_S2C_BYTES = 65536;

// Decode a server → client message. Never throws.
export function decodeS2C(input, pool) {
  const b = asBytes(input);
  if (!b) return DECODE_ERR.INPUT;
  if (b.length === 0) return DECODE_ERR.EMPTY;
  if (b.length > MAX_S2C_BYTES) return DECODE_ERR.OVERSIZE;
  const fn = S2C_DEC[b[0]];
  if (!fn) return DECODE_ERR.OPCODE;
  B = b; P = 1; E = b.length;
  try { return finish(fn(obj(pool, b[0]))); } catch (e) { return mapErr(e); } finally { B = null; }
}

// Decode either direction (tools, logging).
export function decode(input, pool) {
  const b = asBytes(input);
  if (!b || b.length === 0) return b ? DECODE_ERR.EMPTY : DECODE_ERR.INPUT;
  return b[0] & 0x80 ? decodeS2C(b, pool) : decodeC2S(b, pool);
}

// Generic object encoder (tests, bots, tools). msg.op selects the message.
export function encode(w, m) {
  switch (m.op) {
    case C2S.HELLO: return encodeHello(w, m);
    case C2S.READY: return encodeReady(w);
    case C2S.STATE: return encodeState(w, m);
    case C2S.ACTION: return encodeAction(w, m.reqId, m.type, m.target, m.arg);
    case C2S.CHAT: return encodeChat(w, m.channel, m.text);
    case C2S.PING: return encodePing(w, m.clientTime);
    case C2S.REPORT: return encodeReport(w, m.targetNetId, m.reason, m.chatRef);
    case S2C.WELCOME: return encodeWelcome(w, m);
    case S2C.SNAPSHOT: return encodeSnapshot(w, m);
    case S2C.NAMES: return encodeNames(w, m.names);
    case S2C.EVENT: return encodeEvent(w, m.type, m.args);
    case S2C.STATS: return encodeStats(w, m);
    case S2C.CHAT: return encodeChatS(w, m.from, m.channel, m.msgRef, m.text);
    case S2C.SYSTEM: return encodeSystem(w, m.code, m.arg);
    case S2C.PONG: return encodePong(w, m.clientTime, m.serverTime);
    case S2C.CORRECT: return encodeCorrect(w, m.x, m.z, m.y, m.yaw, m.epoch, m.reason);
    case S2C.WORLD: return encodeWorld(w, m);
    default: throw new RangeError('encode: unknown op ' + m.op);
  }
}

// u32 wrap-around difference (a - b) for ping clocks: performance.now() truncated to u32 ms.
export const u32Diff = (a, b) => ((a - b) >>> 0);
