// measure.mjs — codec message sizes + local PING RTT over the real server process (both transports).
// Usage: node server/scripts/measure.mjs [--port 9100] [--n 2000] [--out file.json]
// Starts `node src/main.js` as a child (in-memory PGlite, given ports), sends N sequential PINGs from this process
// with js/shared/codec.js, reports p50/p95/p99/max RTT (ms), then stops the child.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as codec from '../../js/shared/codec.js';
import { C2S, S2C, SNAP_FLAG } from '../../js/shared/protocol.js';
import { MODE } from '../../js/shared/constants.js';
import { packState } from '../../js/shared/quant.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', 9100));
const N = Number(arg('n', 2000));
const OUT = arg('out', '');
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- codec sizes ----
const w = new codec.Writer();
const tok = new Uint8Array(16);
const sizes = {};
const put = (name, bytes) => { sizes[name] = bytes.length; };
put('C2S HELLO (43-char ticket)', codec.encodeHello(w, { ticket: 'x'.repeat(43) }));
put('C2S HELLO resume (no ticket)', codec.encodeHello(w, { ticket: '', resumeToken: tok }));
put('C2S READY', codec.encodeReady(w));
put('C2S STATE', codec.encodeState(w, { seq: 1, clientMs: 1, x: 1, z: 1, y: 2, yaw: 0, vx: 0, vz: 0, state: packState(MODE.WALK, 0), corrEpoch: 0 }));
put('C2S ACTION', codec.encodeAction(w, 1, 1, 1, 1));
put('C2S CHAT (40 chars VN)', codec.encodeChat(w, 0, 'Xin chào cả nhà, tối nay đi ăn bánh đa cua'));
put('C2S PING', codec.encodePing(w, 1));
put('C2S REPORT', codec.encodeReport(w, 1, 1, 1));
put('S2C WELCOME', codec.encodeWelcome(w, { netId: 1, serverTime: 1, tickHz: 20, snapHz: 10, dayEpoch: 1, dayLength: 1440, resumeToken: tok }));
const snap = (nE, nU, nL = 0) => {
  const sb = new codec.SnapshotBuilder(w);
  sb.begin(1, SNAP_FLAG.KEYFRAME, 1, 1, 1, 0, 0);
  for (let i = 0; i < nL; i++) sb.leave(i);
  sb.enters();
  for (let i = 0; i < nE; i++) sb.enter(i, i, 1, 1, 1, 1, 1, 1, null);
  sb.updates();
  for (let i = 0; i < nU; i++) sb.update(i, 1, 1, 1, 1, 1, 1);
  return sb.end();
};
put('S2C SNAPSHOT empty', snap(0, 0));
put('S2C SNAPSHOT 19 updates (avg 1k CCU)', snap(0, 19));
put('S2C SNAPSHOT 40 updates', snap(0, 40));
put('S2C SNAPSHOT 96 updates (cap)', snap(0, 96));
put('S2C SNAPSHOT keyframe 96 enters', snap(96, 0));
put('S2C NAMES 1 (Nick#1234)', codec.encodeNames(w, [{ netId: 1, name: 'Hải Phòng#1234', badge: 0 }]));
put('S2C EVENT 2 args', codec.encodeEvent(w, 1, [1, 2]));
put('S2C STATS all + money 150000', codec.encodeStats(w, { mask: 63, v: [1, 2, 3, 4, 5], r: [0, 0, 0, 0, 0], money: 150000 }));
put('S2C CHAT (40 chars VN)', codec.encodeChatS(w, 1, 0, 1, 'Xin chào cả nhà, tối nay đi ăn bánh đa cua'));
put('S2C SYSTEM', codec.encodeSystem(w, 1, 1));
put('S2C PONG', codec.encodePong(w, 1, 1));
put('S2C CORRECT', codec.encodeCorrect(w, 0, 0, 0, 0, 0, 0));
put('S2C WORLD 4 entries', codec.encodeWorld(w, { dayEpoch: 1, dayLength: 1440, weather: [{}, {}, {}, {}] }));
// bandwidth at 10 Hz incl. ~68 B WS+TLS+TCP/IP overhead per message (ARCH §6.5)
const bw = (bytes) => Math.round(((bytes + 68) * 10) / 102.4) / 10;
const bandwidth = { 'KB/s @19 entities': bw(sizes['S2C SNAPSHOT 19 updates (avg 1k CCU)']), 'KB/s @40': bw(sizes['S2C SNAPSHOT 40 updates']), 'KB/s @96': bw(sizes['S2C SNAPSHOT 96 updates (cap)']) };

// ---- RTT ----
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
async function rtt(kind) {
  const child = spawn(process.execPath, ['src/main.js'], {
    cwd: serverDir,
    env: { ...process.env, TRANSPORT: kind, GAME_PORT: String(PORT), ADMIN_PORT: String(PORT + 1), PGLITE_DIR: 'memory', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const health = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/play`, { perMessageDeflate: false });
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    const cw = new codec.Writer(64);
    const out = [];
    let resolveMsg;
    ws.on('message', (d) => resolveMsg(d));
    for (let i = 0; i < N + 100; i++) {
      const t0 = performance.now();
      const p = new Promise((r) => { resolveMsg = r; });
      ws.send(codec.encodePing(cw, Math.floor(t0) >>> 0));
      const m = codec.decodeS2C(await p);
      if (m.op !== S2C.PONG) throw new Error('no PONG');
      if (i >= 100) out.push(performance.now() - t0);     // 100 warm-up pings
    }
    ws.close();
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return { transport: health.transport, n: out.length, p50: r3(pct(out, 0.5)), p95: r3(pct(out, 0.95)), p99: r3(pct(out, 0.99)), max: r3(Math.max(...out)) };
  } finally {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

const result = { sizes, bandwidth, rtt: { uws: await rtt('uws'), ws: await rtt('ws') }, node: process.version, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() };
console.log(JSON.stringify(result, null, 2));
if (OUT) { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(result, null, 2)); }
void C2S;
