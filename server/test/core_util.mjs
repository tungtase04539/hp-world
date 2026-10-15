// core_util.mjs — S2 test helpers: guest accounts, join tickets and a tiny protocol client over the real WebSocket.
import WebSocket from 'ws';
import crypto from 'node:crypto';
import { bootTestServer, getJson } from './helpers/client.mjs';
import { createDb } from '../src/db/db.js';
import { Writer, encodeHello, encodeReady, encodeState, encodeChat, encodePing, encodeReport, encodeAction, decodeS2C } from '../../js/shared/codec.js';
import { S2C, PROTO_VERSION } from '../../js/shared/protocol.js';

// TEST_DB_URL set (node test/core_pg.mjs) → the same tests run on Docker Postgres 17 with a fresh schema per boot
export async function bootCore(over = {}) {
  const url = process.env.TEST_DB_URL;
  if (url) {
    const db = await createDb({ driver: 'pg', url, poolMax: 2 });
    try { await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); } finally { await db.close(); }
    return bootTestServer({ INVITE_REQUIRED: 'false', DB_URL: url, DB_DRIVER: 'pg', ...over });
  }
  return bootTestServer({ INVITE_REQUIRED: 'false', ...over });
}

export const deviceId = () => 'dev_' + crypto.randomBytes(8).toString('hex');

export async function post(s, path, body, headers = {}) {
  return getJson(s.game + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
}

export async function guest(s, nickname = 'Khach', extra = {}) {
  const r = await post(s, '/v1/auth/guest', { nickname, deviceId: deviceId(), ...extra });
  if (r.status !== 200) throw new Error(`guest ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}

export async function joinTicket(s, accessToken, extra = {}) {
  const r = await post(s, '/v1/join', { accessToken, proto: PROTO_VERSION, tier: 2, ...extra });
  return r;
}

export class Client {
  constructor(ws) {
    this.ws = ws; this.w = new Writer(1024); this.q = []; this.waiters = []; this.closed = null; this.seq = 0;
    this.all = [];
    ws.on('message', (data) => {
      const m = decodeS2C(data);
      m._len = data.length;
      this.all.push(m);
      for (let i = 0; i < this.waiters.length; i++) {
        const wt = this.waiters[i];
        if (wt.pred(m)) { this.waiters.splice(i, 1); clearTimeout(wt.t); wt.resolve(m); return; }
      }
      this.q.push(m);
    });
    this.closedP = new Promise((res) => ws.on('close', (code, reason) => { this.closed = { code, reason: reason.toString() }; res(this.closed); }));
  }
  static open(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers, perMessageDeflate: false });
      ws.binaryType = 'nodebuffer';
      const c = new Client(ws);
      ws.once('open', () => resolve(c));
      ws.once('unexpected-response', (req, res) => reject(Object.assign(new Error('upgrade refused'), { status: res.statusCode })));
      ws.once('error', reject);
    });
  }
  // next message matching pred (from the backlog first)
  wait(pred = () => true, ms = 3000) {
    const i = this.q.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.q.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const wt = { pred, resolve, t: setTimeout(() => { this.waiters.splice(this.waiters.indexOf(wt), 1); reject(new Error('wait timeout')); }, ms) };
      this.waiters.push(wt);
    });
  }
  op(op, ms) { return this.wait((m) => m.op === op, ms); }
  drain(op) { const out = this.q.filter((m) => op === undefined || m.op === op); this.q = this.q.filter((m) => !(op === undefined || m.op === op)); return out; }
  send(bytes) { this.ws.send(bytes); }
  hello(ticket, resumeToken = null, proto = PROTO_VERSION) { this.send(encodeHello(this.w, { ticket, resumeToken, proto, tier: 2 })); }
  ready() { this.send(encodeReady(this.w)); }
  state(st) { this.send(encodeState(this.w, { seq: this.seq++ & 0xffff, corrEpoch: 0, vx: 0, vz: 0, y: 2, yaw: 0, state: 0, vehicleRef: 0, ...st })); }
  chat(text, channel = 0) { this.send(encodeChat(this.w, channel, text)); }
  ping(t) { this.send(encodePing(this.w, t)); }
  report(netId, reason = 1, chatRef = 0) { this.send(encodeReport(this.w, netId, reason, chatRef)); }
  action(reqId, type, target = 0, arg = 0) { this.send(encodeAction(this.w, reqId, type, target, arg)); }
  close() { try { this.ws.close(); } catch { /* ignore */ } return this.closedP; }
  terminate() { try { this.ws.terminate(); } catch { /* ignore */ } return this.closedP; }
}

// guest → join → WS → HELLO → WELCOME (+ WORLD) → READY. Returns {c, welcome, account, tokens}
export async function connectPlayer(s, nickname = 'Khach', { ready = true, auth = null } = {}) {
  const tokens = auth || await guest(s, nickname);
  const j = await joinTicket(s, tokens.accessToken);
  if (j.status !== 200 || !j.body.ticket) throw new Error('join failed ' + JSON.stringify(j.body));
  const c = await Client.open(s.ws + '/play');
  c.hello(j.body.ticket);
  const welcome = await c.op(S2C.WELCOME);
  await c.op(S2C.WORLD);
  if (ready) c.ready();
  return { c, welcome, account: tokens.account, tokens, join: j.body };
}

// client clock in ms (u16 on the wire)
export const clk = () => Math.floor(performance.now());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
