// Test helpers: start a server on ephemeral ports with in-memory PGlite, a tiny WS client speaking js/shared/codec.js.
import WebSocket from 'ws';
import { startServer } from '../../src/main.js';
import { loadConfig } from '../../src/config.js';
import { nullLogger } from '../../src/log.js';
import { Writer, encodePing, decodeS2C } from '../../../js/shared/codec.js';
import { S2C } from '../../../js/shared/protocol.js';

export function testConfig(over = {}) {
  return loadConfig({
    env: {},
    envFile: null,
    overrides: { NODE_ENV: 'test', PGLITE_DIR: 'memory', LOG_LEVEL: 'silent', GAME_HOST: '127.0.0.1', ADMIN_HOST: '127.0.0.1', ...over },
  });
}

export async function bootTestServer(over = {}, opts = {}) {
  const config = testConfig(over);
  const app = await startServer({ config, log: nullLogger, ports: { game: 0, admin: 0 }, ...opts });
  return { app, config, game: `http://127.0.0.1:${app.ports.game}`, admin: `http://127.0.0.1:${app.ports.admin}`, ws: `ws://127.0.0.1:${app.ports.game}` };
}

export function openWs(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, perMessageDeflate: false });
    ws.binaryType = 'nodebuffer';
    const t = setTimeout(() => { ws.terminate(); reject(new Error('ws open timeout')); }, 5000);
    ws.once('open', () => { clearTimeout(t); resolve(ws); });
    ws.once('unexpected-response', (req, res) => { clearTimeout(t); reject(Object.assign(new Error('upgrade refused'), { status: res.statusCode })); });
    ws.once('error', (e) => { clearTimeout(t); reject(e); });
  });
}

export function nextMessage(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { ws.off('message', on); reject(new Error('message timeout')); }, timeoutMs);
    const on = (data) => { clearTimeout(t); resolve(decodeS2C(data)); };
    ws.once('message', on);
  });
}

export function waitClose(ws, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve({ code: -1 });
    const t = setTimeout(() => reject(new Error('close timeout')), timeoutMs);
    ws.once('close', (code, reason) => { clearTimeout(t); resolve({ code, reason: reason.toString() }); });
  });
}

// N sequential PINGs; returns RTT samples in ms (performance.now based)
export async function pingRtts(ws, n) {
  const w = new Writer(64);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    ws.send(encodePing(w, Math.floor(t0) >>> 0));
    const m = await nextMessage(ws);
    if (m.op !== S2C.PONG) throw new Error('expected PONG, got ' + (m.err || m.op));
    out.push(performance.now() - t0);
  }
  return out;
}

export async function getJson(url, opts = {}) {
  const r = await fetch(url, opts);
  let body = null;
  const text = await r.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: r.headers, body };
}
