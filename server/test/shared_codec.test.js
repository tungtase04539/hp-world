// Round-trip, size and robustness tests for js/shared/codec.js (every opcode of ARCH §6.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as codec from '../../js/shared/codec.js';
import { C2S, S2C, PROTO_VERSION, SNAP_FLAG, CHANNEL } from '../../js/shared/protocol.js';
import { packState } from '../../js/shared/quant.js';
import { MODE, SFLAG, CHAT } from '../../js/shared/constants.js';

const { Writer, decodeC2S, decodeS2C, decode, encode, DECODE_ERR, SIZE } = codec;
const w = new Writer();

// deterministic PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tok = Uint8Array.from({ length: 16 }, (_, i) => i * 7 + 1);
const app = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

// one valid sample of every message, plus the expected decoded fields
function samples() {
  return [
    { op: C2S.HELLO, proto: PROTO_VERSION, worldVersion: 0xdeadbeef, tier: 2, ticket: 'abc.DEF-123_xyz' },
    { op: C2S.HELLO, proto: PROTO_VERSION, worldVersion: 7, tier: 1, ticket: '', resumeToken: tok },
    { op: C2S.READY },
    { op: C2S.STATE, seq: 65535, clientMs: 12345, x: -1234.55, z: 987.65, y: 2.25, yaw: -1.5, vx: 3.25, vz: -16,
      state: packState(MODE.MOTO, SFLAG.HORN | SFLAG.CARGO), corrEpoch: 200, vehicleRef: 513 },
    { op: C2S.ACTION, reqId: 4242, type: 3, target: 0xfffffffe, arg: 77 },
    { op: C2S.CHAT, channel: CHANNEL.SAY, text: 'Xin chào cả nhà, đi ăn bánh đa cua không? 🦀' },
    { op: C2S.PING, clientTime: 0xfffffff0 },
    { op: C2S.REPORT, targetNetId: 999, reason: 2, chatRef: 123456 },
    { op: S2C.WELCOME, netId: 4321, serverTime: 1790000000123.25, tickHz: 20, snapHz: 10, dayEpoch: 1767225600000,
      dayLength: 1440, resumeToken: tok, weather: { kind: 3, intensity: 128, windDir: 64, windSpeed: 9, seed: 0xabcdef01 },
      spawn: { x: -10.7, z: 75.6, yaw: 1.82 } },
    { op: S2C.SNAPSHOT, tick: 123456789, flags: SNAP_FLAG.KEYFRAME, self: { x: 10, z: -20, y: 2, corrEpoch: 3, lastSeq: 999 },
      leaves: [1, 2, 250],
      enters: [{ slot: 5, netId: 777, x: 100.05, z: -200.1, y: 2.25, yaw: 0.5, spd: 7, state: packState(MODE.RUN, 0), appearance: app }],
      updates: [{ slot: 6, x: 1, z: 2, y: 3, yaw: -3, spd: 16, state: packState(MODE.MOTO, SFLAG.HORN) }] },
    { op: S2C.NAMES, names: [{ netId: 1, name: 'Tùng#1234', badge: 0 }, { netId: 65535, name: 'Hoa Phượng Đỏ#0001', badge: 3 }] },
    { op: S2C.EVENT, type: 1, args: [42, -1, 2147483647, -2147483648] },
    { op: S2C.STATS, mask: 0b111111, v: [10, 20, 30, 40, 50], r: [-1, 2, -128, 127, 0], money: 150000 },
    { op: S2C.STATS, mask: 0b000101, v: [99, 0, 7, 0, 0], r: [1, 0, -2, 0, 0] },
    { op: S2C.CHAT, from: 12, channel: CHANNEL.SAY, msgRef: 0xffffffff, text: 'Đẹp quá!' },
    { op: S2C.SYSTEM, code: 3, arg: 17 },
    { op: S2C.PONG, clientTime: 5, serverTime: 1790000000000.5 },
    { op: S2C.CORRECT, x: 5.5, z: -6.25, y: 2, yaw: 3.0, epoch: 9, reason: 1 },
    { op: S2C.WORLD, dayEpoch: 1767225600000, dayLength: 1440,
      weather: [{ kind: 1, intensity: 2, windDir: 3, windSpeed: 4, seed: 5, t0: 1790000000000, t1: 1790000600000 }] },
  ];
}

const near = (a, b, eps) => Math.abs(a - b) <= eps;

test('every opcode round-trips', () => {
  const seen = new Set();
  for (const m of samples()) {
    const bytes = encode(w, m).slice();
    const d = decode(bytes);
    assert.equal(d.err, undefined, `decode error for op ${m.op}: ${d.err}`);
    assert.equal(d.op, m.op);
    seen.add(m.op);
    switch (m.op) {
      case C2S.HELLO:
        assert.equal(d.proto, m.proto); assert.equal(d.worldVersion, m.worldVersion); assert.equal(d.tier, m.tier);
        assert.equal(d.ticket, m.ticket);
        assert.deepEqual(d.resumeToken ? [...d.resumeToken] : null, m.resumeToken ? [...m.resumeToken] : null);
        break;
      case C2S.STATE:
        assert.equal(d.seq, m.seq); assert.equal(d.clientMs, m.clientMs);
        assert.ok(near(d.x, m.x, 0.026) && near(d.z, m.z, 0.026), `${d.x},${d.z}`);
        assert.ok(near(d.y, m.y, 0.126)); assert.ok(near(Math.abs(d.yaw - m.yaw), 0, 0.013));
        assert.equal(d.vx, 3.25); assert.equal(d.vz, -16);
        assert.equal(d.mode, MODE.MOTO); assert.equal(d.flags, SFLAG.HORN | SFLAG.CARGO);
        assert.equal(d.corrEpoch, 200); assert.equal(d.vehicleRef, 513);
        assert.equal(bytes.length, SIZE.STATE);
        break;
      case C2S.ACTION: assert.deepEqual([d.reqId, d.type, d.target, d.arg], [m.reqId, m.type, m.target, m.arg]); break;
      case C2S.CHAT: case S2C.CHAT: assert.equal(d.text, m.text); assert.equal(d.channel, m.channel); break;
      case C2S.PING: assert.equal(d.clientTime, m.clientTime); break;
      case C2S.REPORT: assert.deepEqual([d.targetNetId, d.reason, d.chatRef], [m.targetNetId, m.reason, m.chatRef]); break;
      case S2C.WELCOME:
        assert.equal(d.netId, m.netId); assert.equal(d.serverTime, m.serverTime); assert.equal(d.dayEpoch, m.dayEpoch);
        assert.equal(d.dayLength, 1440); assert.deepEqual(d.weather, m.weather); assert.deepEqual([...d.resumeToken], [...tok]);
        assert.ok(near(d.spawn.x, m.spawn.x, 0.026) && near(d.spawn.z, m.spawn.z, 0.026));
        assert.equal(d.proto, PROTO_VERSION); assert.equal(bytes.length, SIZE.WELCOME);
        break;
      case S2C.SNAPSHOT:
        assert.equal(d.tick, m.tick); assert.equal(d.flags, m.flags); assert.deepEqual(d.leaves, m.leaves);
        assert.equal(d.self.lastSeq, 999); assert.equal(d.self.corrEpoch, 3);
        assert.equal(d.enters[0].netId, 777); assert.deepEqual([...d.enters[0].appearance], [...app]);
        assert.ok(near(d.enters[0].x, 100.05, 0.026)); assert.equal(d.enters[0].spd, 7);
        assert.equal(d.updates[0].slot, 6); assert.equal(d.updates[0].spd, 16);
        assert.equal(bytes.length, codec.SNAPSHOT_HEADER_BYTES + 3 + codec.ENTER_RECORD_BYTES + codec.UPDATE_RECORD_BYTES);
        break;
      case S2C.NAMES: assert.deepEqual(d.names, m.names); break;
      case S2C.EVENT: assert.equal(d.type, m.type); assert.deepEqual(d.args, m.args); break;
      case S2C.STATS:
        assert.equal(d.mask, m.mask);
        for (let i = 0; i < 5; i++) if (m.mask & (1 << i)) { assert.equal(d.v[i], m.v[i]); assert.equal(d.r[i], m.r[i]); }
        assert.equal(d.money, m.mask & 32 ? m.money : null);
        break;
      case S2C.SYSTEM: assert.deepEqual([d.code, d.arg], [m.code, m.arg]); break;
      case S2C.PONG: assert.equal(d.clientTime, m.clientTime); assert.equal(d.serverTime, m.serverTime); break;
      case S2C.CORRECT: assert.equal(d.epoch, 9); assert.equal(d.reason, 1); assert.ok(near(d.x, 5.5, 0.026)); break;
      case S2C.WORLD: assert.deepEqual(d.weather, m.weather); assert.equal(d.dayEpoch, m.dayEpoch); break;
      default: break;
    }
  }
  for (const op of [...Object.values(C2S), ...Object.values(S2C)]) assert.ok(seen.has(op), `no sample for op ${op}`);
});

test('fixed sizes', () => {
  assert.equal(codec.encodeReady(w).length, SIZE.READY);
  assert.equal(codec.encodePing(w, 1).length, SIZE.PING);
  assert.equal(codec.encodeAction(w, 1, 2, 3, 4).length, SIZE.ACTION);
  assert.equal(codec.encodeReport(w, 1, 2, 3).length, SIZE.REPORT);
  assert.equal(codec.encodeSystem(w, 1, 2).length, SIZE.SYSTEM);
  assert.equal(codec.encodePong(w, 1, 2).length, SIZE.PONG);
  assert.equal(codec.encodeCorrect(w, 0, 0, 0, 0, 0, 0).length, SIZE.CORRECT);
});

test('snapshot with 96 updates fits the 1,100 B budget', () => {
  const sb = new codec.SnapshotBuilder(w);
  sb.begin(1, 0, 32768, 32768, 8, 0, 0).enters().updates();
  for (let i = 0; i < 96; i++) assert.ok(sb.update(i, 30000 + i, 31000, 8, i, 40, 1));
  const v = sb.end();
  assert.equal(v.length, 17 + 96 * 9);
  assert.ok(v.length <= 1100);
  const d = decodeS2C(v);
  assert.equal(d.updates.length, 96);
  assert.equal(d.updates[95].slot, 95);
});

test('SnapshotBuilder caps at 255 records and enforces order', () => {
  const sb = new codec.SnapshotBuilder(w);
  sb.begin(1, 0, 0, 0, 0, 0, 0);
  for (let i = 0; i < 255; i++) assert.ok(sb.leave(i));
  assert.equal(sb.leave(1), false);
  assert.throws(() => sb.update(1, 0, 0, 0, 0, 0, 0));
  sb.enters().updates();
  const d = decodeS2C(sb.end());
  assert.equal(d.leaves.length, 255);
});

test('pool reuses objects (zero alloc decode of STATE / PING)', () => {
  const pool = {};
  const a = decodeC2S(codec.encodePing(w, 1), pool);
  const b = decodeC2S(codec.encodePing(w, 2), pool);
  assert.equal(a, b);
  assert.equal(b.clientTime, 2);
  const s1 = decodeC2S(codec.encodeState(w, { seq: 1, clientMs: 0, x: 0, z: 0, y: 0, yaw: 0, state: 0, corrEpoch: 0 }), pool);
  const s2 = decodeC2S(codec.encodeState(w, { seq: 2, clientMs: 0, x: 0, z: 0, y: 0, yaw: 0, state: 0, corrEpoch: 0 }), pool);
  assert.equal(s1, s2);
  assert.equal(s2.seq, 2);
});

test('direction is enforced', () => {
  assert.equal(decodeC2S(codec.encodePong(w, 1, 2)), DECODE_ERR.OPCODE);
  assert.equal(decodeS2C(codec.encodePing(w, 1)), DECODE_ERR.OPCODE);
});

test('every truncation of every valid message is rejected, never throws', () => {
  for (const m of samples()) {
    const full = encode(w, m).slice();
    for (let n = 0; n < full.length; n++) {
      const d = decode(full.subarray(0, n));
      assert.ok(d.err, `op ${m.op} truncated to ${n} decoded without error`);
    }
    // trailing garbage
    const longer = new Uint8Array(full.length + 1); longer.set(full); longer[full.length] = 0x55;
    assert.equal(decode(longer), DECODE_ERR.LENGTH, `op ${m.op} with trailing byte`);
  }
});

test('oversize, empty, non-buffer, invalid UTF-8, bad counts, reserved flags', () => {
  assert.equal(decodeC2S(new Uint8Array(513)), DECODE_ERR.OVERSIZE);
  assert.equal(decodeC2S(new Uint8Array(0)), DECODE_ERR.EMPTY);
  assert.equal(decodeC2S('hello'), DECODE_ERR.INPUT);
  assert.equal(decodeC2S(null), DECODE_ERR.INPUT);
  assert.equal(decodeC2S(Uint8Array.from([C2S.CHAT, 0, 2, 0, 0xc3, 0x28])), DECODE_ERR.UTF8);
  // chat len > 420
  const big = new Uint8Array(4 + 421); big[0] = C2S.CHAT; big[2] = 421 & 255; big[3] = 421 >> 8;
  assert.equal(decodeC2S(big), DECODE_ERR.VALUE);
  // hello with unknown flag bit
  assert.equal(decodeC2S(Uint8Array.from([C2S.HELLO, 1, 0, 0, 0, 0, 0, 2, 0])), DECODE_ERR.VALUE);
  // event with 9 args
  assert.equal(decodeS2C(Uint8Array.from([S2C.EVENT, 1, 0, 9])), DECODE_ERR.VALUE);
  // stats with reserved bits
  assert.equal(decodeS2C(Uint8Array.from([S2C.STATS, 0x80])), DECODE_ERR.VALUE);
  // P2 delta flag is reserved
  const v = codec.encodeSnapshot(w, { tick: 1, flags: 0 }).slice();
  v[5] |= SNAP_FLAG.DELTA_P2;
  assert.equal(decodeS2C(v), DECODE_ERR.UNSUPPORTED);
  // unknown opcodes
  for (const op of [0x00, 0x03, 0x15, 0x7f, 0x80, 0x8b, 0xff]) assert.ok(decode(Uint8Array.from([op, 0, 0, 0])).err);
});

test('chat text is truncated at a code-point boundary to 420 bytes', () => {
  const long = 'đ'.repeat(300);   // 2 bytes each → 600 bytes
  const d = decodeC2S(codec.encodeChat(w, 0, long));
  assert.equal(d.err, undefined);
  assert.equal(d.text, 'đ'.repeat(210));
  const emoji = '😀'.repeat(200);  // 4 bytes each
  const d2 = decodeC2S(codec.encodeChat(w, 0, emoji));
  assert.equal(d2.text, '😀'.repeat(105));
  assert.ok(CHAT.MAX_BYTES === 420);
});

test('fuzz: 200k random buffers + 100k mutated valid messages never throw', () => {
  const r = rng(12345);
  const valid = samples().map((m) => encode(w, m).slice());
  let errs = 0, oks = 0;
  for (let i = 0; i < 200000; i++) {
    const n = (r() * 64) | 0;
    const b = new Uint8Array(n);
    for (let k = 0; k < n; k++) b[k] = (r() * 256) | 0;
    if (n && r() < 0.5) b[0] = valid[(r() * valid.length) | 0][0];   // valid opcode, garbage body
    const d = decode(b);
    if (d.err) errs++; else oks++;
  }
  for (let i = 0; i < 100000; i++) {
    const src = valid[(r() * valid.length) | 0];
    const b = src.slice();
    const flips = 1 + ((r() * 3) | 0);
    for (let k = 0; k < flips; k++) b[(r() * b.length) | 0] = (r() * 256) | 0;
    const cut = r() < 0.3 ? b.subarray(0, (r() * b.length) | 0) : b;
    const d = decode(cut);
    if (d.err) errs++; else oks++;
  }
  assert.ok(errs > 0 && oks > 0);
});

test('random STATE round trip within quantisation error (100k)', () => {
  const r = rng(99);
  const pool = {};
  for (let i = 0; i < 100000; i++) {
    const s = { seq: (r() * 65536) | 0, clientMs: (r() * 65536) | 0, x: (r() * 2 - 1) * 1600, z: (r() * 2 - 1) * 1600,
      y: r() * 60, yaw: (r() * 2 - 1) * Math.PI, vx: (r() * 2 - 1) * 30, vz: (r() * 2 - 1) * 30,
      state: (r() * 256) | 0, corrEpoch: (r() * 256) | 0, vehicleRef: (r() * 65536) | 0 };
    const d = decodeC2S(codec.encodeState(w, s), pool);
    assert.ok(Math.abs(d.x - s.x) <= 0.0251 && Math.abs(d.z - s.z) <= 0.0251);
    assert.ok(Math.abs(d.y - s.y) <= 0.1251);
    let dy = Math.abs(d.yaw - s.yaw); if (dy > Math.PI) dy = 2 * Math.PI - dy;
    assert.ok(dy <= Math.PI / 256 + 1e-9);
    assert.ok(Math.abs(d.vx - s.vx) <= 0.1251 && Math.abs(d.vz - s.vz) <= 0.1251);
    assert.equal(d.state, s.state);
  }
});

test('u32Diff wraps', () => {
  assert.equal(codec.u32Diff(5, 0xfffffffb), 10);
  assert.equal(codec.u32Diff(100, 40), 60);
});

test('BitWriter / BitReader round trip', () => {
  const r = rng(7);
  const vals = [];
  w.reset();
  const bw = new codec.BitWriter(w);
  for (let i = 0; i < 1000; i++) { const n = 1 + ((r() * 16) | 0); const v = (r() * (1 << n)) | 0; vals.push([n, v]); bw.bits(v, n); }
  bw.flush();
  const br = new codec.BitReader(w.copy());
  for (const [n, v] of vals) assert.equal(br.bits(n), v);
});
