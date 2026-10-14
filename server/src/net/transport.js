// net/transport.js — HTTP + WebSocket server behind ONE interface, backed by uWebSockets.js (preferred) or `ws` +
// node:http (automatic fallback). Feature code never touches uWS/ws directly.
//
//   const t = await createTransport({ kind: 'auto'|'uws'|'ws', log, metrics, limits, trustProxy, name })
//   t.kind                          'uws' | 'ws' (what actually loaded)
//   t.onHttp(fn)                    fn(req, res) — see HttpRequest / HttpResponse below
//   t.route(path, handlers)         WebSocket endpoint; handlers { open(conn), message(conn, bytes, isBinary),
//                                   drain(conn), close(conn, code, reason) }
//   t.guard(fn)                     upgrade guard fn({path, origin, ip, headers}) → null (allow) | {status, reason}
//   await t.listen(host, port)      → actual port (port 0 = ephemeral)
//   await t.close(code?, reason?)   closes listeners and every open socket
//   t.connections                   number of open WebSockets
//
// Conn (one per WebSocket): id, ip, origin, path, openedAt, data (free slot for the owner, e.g. a session),
//   send(bytes) → 1 sent | 0 buffered (backpressure) | 2 dropped (closed or over maxBackpressure → socket closed)
//   cork(fn), bufferedAmount(), close(code, reason) (graceful), terminate() (hard), closed (bool)
//   `bytes` passed to message() is a Uint8Array VIEW valid only during the callback (uWS frees it after) — copy
//   anything you keep. send() copies, so callers may reuse their encode buffer immediately.
//
// HttpRequest: { method (upper), url, path, query (string), headers (lower-case keys), ip, body() → Promise<Buffer> }
//   body() rejects with err.status = 413 above limits.bodyLimit.
// HttpResponse: { send(status, headers, body), aborted (bool), sent (bool), onAborted(fn) }
import http from 'node:http';
import { createRequire } from 'node:module';
import { NET } from '../../../js/shared/constants.js';

const require = createRequire(import.meta.url);

export const DEFAULT_LIMITS = Object.freeze({
  maxPayload: NET.MAX_C2S_BYTES,
  idleTimeout: NET.IDLE_TIMEOUT_S,
  maxBackpressure: NET.MAX_BACKPRESSURE,
  bodyLimit: 16 * 1024,
});

let uwsCache;
// Load uWebSockets.js. The package's ESM wrapper is broken in v20.71.0 (imports a missing index.js), so use require.
export function loadUws() {
  if (uwsCache !== undefined) return uwsCache;
  try {
    const u = require('uWebSockets.js');
    uwsCache = typeof u.App === 'function' ? u : null;
  } catch (e) {
    uwsCache = null;
    loadUws.error = e;
  }
  return uwsCache;
}

const normIp = (ip) => {
  if (!ip) return '';
  let s = String(ip);
  if (s.startsWith('::ffff:')) s = s.slice(7);
  // uWS prints IPv4-mapped IPv6 in full form: 0000:0000:0000:0000:0000:ffff:7f00:0001
  const m = s.match(/^(?:0{1,4}:){5}ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) {
    const a = parseInt(m[1], 16), b = parseInt(m[2], 16);
    s = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return s;
};

export function clientIp(headers, remote, trustProxy) {
  if (trustProxy === 'cloudflare') {
    const cf = headers['cf-connecting-ip'];
    if (cf) return normIp(cf.trim());
  }
  return normIp(remote);
}

const STATUS = http.STATUS_CODES;

export async function createTransport(opts = {}) {
  const kind = opts.kind || 'auto';
  if (kind === 'uws' || kind === 'auto') {
    const u = loadUws();
    if (u) return createUwsTransport(u, opts);
    if (kind === 'uws') throw new Error('transport: uWebSockets.js failed to load: ' + (loadUws.error?.message || 'unknown'));
    opts.log?.warn('uWebSockets.js unavailable, falling back to ws', { err: loadUws.error?.message });
  }
  return createWsTransport(opts);
}

// shared bookkeeping
function base(opts) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
  const routes = new Map();
  const guards = [];
  const conns = new Set();
  let httpHandler = (req, res) => res.send(404, { 'content-type': 'text/plain' }, 'not found');
  let nextId = 1;
  return {
    limits, routes, guards, conns,
    get http() { return httpHandler; },
    setHttp(fn) { httpHandler = fn; },
    nextId: () => nextId++,
    checkGuards(info) {
      if (!routes.has(info.path)) return { status: 404, reason: 'no websocket route' };
      for (const g of guards) {
        let r;
        try { r = g(info); } catch (e) { opts.log?.error('upgrade guard threw', { err: e }); r = { status: 500, reason: 'guard error' }; }
        if (r) return r;
      }
      return null;
    },
    safe(fn, ...args) {
      try { return fn(...args); } catch (e) { opts.log?.error('websocket handler threw', { err: e }); return undefined; }
    },
  };
}

// =====================================================================================================================
// uWebSockets.js
// =====================================================================================================================
function createUwsTransport(uWS, opts) {
  const b = base(opts);
  const { limits } = b;
  const trustProxy = opts.trustProxy || 'none';
  const app = uWS.App();
  let listenSocket = null;
  const decoder = new TextDecoder();

  class UConn {
    constructor(ws, ud) {
      this.ws = ws; this.id = b.nextId(); this.ip = ud.ip; this.origin = ud.origin; this.path = ud.path;
      this.openedAt = Date.now(); this.data = null; this.closed = false; this.handlers = ud.handlers;
    }
    send(bytes) {
      if (this.closed) return 2;
      try { return this.ws.send(bytes, true, false); } catch { return 2; }
    }
    cork(fn) {
      if (this.closed) return;
      try { this.ws.cork(fn); } catch (e) { if (!this.closed) throw e; }
    }
    bufferedAmount() { if (this.closed) return 0; try { return this.ws.getBufferedAmount(); } catch { return 0; } }
    close(code = 1000, reason = '') { if (this.closed) return; try { this.ws.end(code, reason); } catch { /* already closed */ } }
    terminate() { if (this.closed) return; try { this.ws.close(); } catch { /* already closed */ } }
  }

  app.ws('/*', {
    compression: uWS.DISABLED,
    maxPayloadLength: limits.maxPayload,
    idleTimeout: limits.idleTimeout,
    maxBackpressure: limits.maxBackpressure,
    closeOnBackpressureLimit: true,
    sendPingsAutomatically: true,
    upgrade(res, req, context) {
      const path = req.getUrl();
      const headers = {};
      req.forEach((k, v) => { headers[k] = v; });
      const ip = clientIp(headers, decoder.decode(res.getRemoteAddressAsText()), trustProxy);
      const info = { path, origin: headers.origin || '', ip, headers };
      const deny = b.checkGuards(info);
      if (deny) {
        res.cork(() => { res.writeStatus(`${deny.status} ${STATUS[deny.status] || 'Error'}`).end(deny.reason || ''); });
        return;
      }
      res.upgrade({ path, ip, origin: info.origin, handlers: b.routes.get(path), conn: null },
        headers['sec-websocket-key'], headers['sec-websocket-protocol'] || '', headers['sec-websocket-extensions'] || '', context);
    },
    open(ws) {
      const ud = ws.getUserData();
      const conn = new UConn(ws, ud);
      ud.conn = conn;
      b.conns.add(conn);
      if (conn.handlers.open) b.safe(conn.handlers.open, conn);
    },
    message(ws, ab, isBinary) {
      const conn = ws.getUserData().conn;
      if (conn && conn.handlers.message) b.safe(conn.handlers.message, conn, new Uint8Array(ab), isBinary);
    },
    drain(ws) {
      const conn = ws.getUserData().conn;
      if (conn && conn.handlers.drain) b.safe(conn.handlers.drain, conn);
    },
    close(ws, code, msg) {
      const conn = ws.getUserData().conn;
      if (!conn) return;
      conn.closed = true;
      b.conns.delete(conn);
      if (conn.handlers.close) b.safe(conn.handlers.close, conn, code, Buffer.from(msg).toString());
    },
  });

  app.any('/*', (res, req) => {
    const state = { aborted: false, sent: false, onAbort: [] };
    res.onAborted(() => { state.aborted = true; for (const f of state.onAbort) b.safe(f); });
    const headers = {};
    req.forEach((k, v) => { headers[k] = v; });
    const method = req.getCaseSensitiveMethod().toUpperCase();
    const path = req.getUrl();
    const query = req.getQuery() || '';
    const ip = clientIp(headers, decoder.decode(res.getRemoteAddressAsText()), trustProxy);
    // body: must attach onData synchronously
    let bodyP;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') bodyP = Promise.resolve(Buffer.alloc(0));
    else {
      bodyP = new Promise((resolve, reject) => {
        const chunks = []; let size = 0; let over = false;
        res.onData((chunk, isLast) => {
          if (!over) {
            size += chunk.byteLength;
            if (size > limits.bodyLimit) { over = true; const e = new Error('payload too large'); e.status = 413; reject(e); }
            else chunks.push(Buffer.from(chunk.slice(0)));   // copy: uWS reuses the chunk memory
          }
          if (isLast && !over) resolve(Buffer.concat(chunks));
        });
      });
      bodyP.catch(() => {});
    }
    const hreq = { method, url: query ? `${path}?${query}` : path, path, query, headers, ip, body: () => bodyP };
    const hres = {
      get aborted() { return state.aborted; },
      get sent() { return state.sent; },
      onAborted(fn) { state.onAbort.push(fn); },
      send(status, hdrs, body) {
        if (state.aborted || state.sent) return false;
        state.sent = true;
        res.cork(() => {
          res.writeStatus(`${status} ${STATUS[status] || ''}`);
          for (const [k, v] of Object.entries(hdrs || {})) res.writeHeader(k, String(v));
          res.end(body == null ? '' : body);
        });
        return true;
      },
    };
    Promise.resolve().then(() => b.http(hreq, hres)).catch((e) => {
      opts.log?.error('http handler threw', { err: e });
      hres.send(500, { 'content-type': 'application/json' }, '{"error":"internal"}');
    });
  });

  return {
    kind: 'uws',
    onHttp: (fn) => b.setHttp(fn),
    route: (path, handlers) => { b.routes.set(path, handlers); },
    guard: (fn) => { b.guards.push(fn); },
    get connections() { return b.conns.size; },
    listen(host, port) {
      return new Promise((resolve, reject) => {
        app.listen(host, port, (token) => {
          if (!token) return reject(new Error(`transport(uws): cannot listen on ${host}:${port}`));
          listenSocket = token;
          resolve(uWS.us_socket_local_port(token));
        });
      });
    },
    async close(code = 1001, reason = 'shutdown') {
      for (const c of [...b.conns]) c.close(code, reason);
      if (listenSocket) { uWS.us_listen_socket_close(listenSocket); listenSocket = null; }
      await new Promise((r) => setTimeout(r, 20));
      for (const c of [...b.conns]) c.terminate();
      if (typeof app.close === 'function') { try { app.close(); } catch { /* ignore */ } }
    },
  };
}

// =====================================================================================================================
// ws + node:http fallback
// =====================================================================================================================
async function createWsTransport(opts) {
  const { WebSocketServer, WebSocket } = await import('ws');
  const b = base(opts);
  const { limits } = b;
  const trustProxy = opts.trustProxy || 'none';
  const server = http.createServer();
  server.keepAliveTimeout = 5000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayload, perMessageDeflate: false, clientTracking: false });

  class WConn {
    constructor(ws, info, handlers) {
      this.ws = ws; this.id = b.nextId(); this.ip = info.ip; this.origin = info.origin; this.path = info.path;
      this.openedAt = Date.now(); this.data = null; this.closed = false; this.handlers = handlers;
      this.lastSeen = Date.now(); this.pinged = false;
    }
    send(bytes) {
      if (this.closed || this.ws.readyState !== WebSocket.OPEN) return 2;
      if (this.ws.bufferedAmount > limits.maxBackpressure) { this.terminate(); return 2; }
      this.ws.send(Buffer.from(bytes), { binary: true });     // copy (callers reuse their encode buffer)
      if (this.ws.bufferedAmount > 0) { this.wantDrain = true; return 0; }
      return 1;
    }
    cork(fn) { fn(); }
    bufferedAmount() { return this.closed ? 0 : this.ws.bufferedAmount; }
    close(code = 1000, reason = '') { if (!this.closed) { try { this.ws.close(code, reason); } catch { this.terminate(); } } }
    terminate() { if (!this.closed) { try { this.ws.terminate(); } catch { /* ignore */ } } }
  }

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '/';
    const qi = url.indexOf('?');
    const path = qi >= 0 ? url.slice(0, qi) : url;
    const headers = req.headers;
    const ip = clientIp(headers, req.socket.remoteAddress, trustProxy);
    const info = { path, origin: headers.origin || '', ip, headers };
    const deny = b.checkGuards(info);
    if (deny) {
      socket.end(`HTTP/1.1 ${deny.status} ${STATUS[deny.status] || 'Error'}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(deny.reason || '')}\r\n\r\n${deny.reason || ''}`);
      return;
    }
    const handlers = b.routes.get(path);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = new WConn(ws, info, handlers);
      b.conns.add(conn);
      ws.on('message', (data, isBinary) => {
        conn.lastSeen = Date.now(); conn.pinged = false;
        if (handlers.message) {
          const u8 = Array.isArray(data) ? Buffer.concat(data) : data instanceof ArrayBuffer ? new Uint8Array(data) : data;
          b.safe(handlers.message, conn, u8, isBinary);
        }
      });
      ws.on('pong', () => { conn.lastSeen = Date.now(); conn.pinged = false; });
      ws.on('error', () => { /* 'close' follows */ });
      ws.on('close', (code, reason) => {
        if (conn.closed) return;
        conn.closed = true;
        b.conns.delete(conn);
        if (handlers.close) b.safe(handlers.close, conn, code, reason ? reason.toString() : '');
      });
      if (ws._socket && typeof ws._socket.on === 'function') {
        ws._socket.on('drain', () => {
          if (conn.wantDrain && !conn.closed) { conn.wantDrain = false; if (handlers.drain) b.safe(handlers.drain, conn); }
        });
      }
      if (handlers.open) b.safe(handlers.open, conn);
    });
  });

  // idle sweep (uWS idleTimeout semantics: no traffic for idleTimeout s → ping; still nothing → close)
  const sweep = setInterval(() => {
    const now = Date.now(), idleMs = limits.idleTimeout * 1000;
    for (const c of b.conns) {
      const quiet = now - c.lastSeen;
      if (quiet > idleMs * 1.5) c.terminate();
      else if (quiet > idleMs / 2 && !c.pinged) { c.pinged = true; try { c.ws.ping(); } catch { /* ignore */ } }
    }
  }, 1000);
  sweep.unref();

  server.on('request', (req, res) => {
    const url = req.url || '/';
    const qi = url.indexOf('?');
    const path = qi >= 0 ? url.slice(0, qi) : url;
    const query = qi >= 0 ? url.slice(qi + 1) : '';
    const method = (req.method || 'GET').toUpperCase();
    const ip = clientIp(req.headers, req.socket.remoteAddress, trustProxy);
    const state = { aborted: false, sent: false, onAbort: [] };
    res.on('close', () => { if (!state.sent) { state.aborted = true; for (const f of state.onAbort) b.safe(f); } });
    let bodyP = null;
    const body = () => {
      if (bodyP) return bodyP;
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return (bodyP = Promise.resolve(Buffer.alloc(0)));
      bodyP = new Promise((resolve, reject) => {
        const chunks = []; let size = 0; let over = false;
        req.on('data', (c) => {
          if (over) return;   // keep draining so the 413 reaches the client
          size += c.length;
          if (size > limits.bodyLimit) {
            over = true; chunks.length = 0; state.closeAfter = true;
            const e = new Error('payload too large'); e.status = 413; reject(e);
            return;
          }
          chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
      bodyP.catch(() => {});
      return bodyP;
    };
    const hreq = { method, url, path, query, headers: req.headers, ip, body };
    const hres = {
      get aborted() { return state.aborted; },
      get sent() { return state.sent; },
      onAborted(fn) { state.onAbort.push(fn); },
      send(status, hdrs, data) {
        if (state.aborted || state.sent) return false;
        state.sent = true;
        try {
          res.writeHead(status, state.closeAfter ? { ...(hdrs || {}), connection: 'close' } : (hdrs || {}));
          res.end(data == null ? '' : data);
        } catch { /* socket gone */ }
        return true;
      },
    };
    Promise.resolve().then(() => b.http(hreq, hres)).catch((e) => {
      opts.log?.error('http handler threw', { err: e });
      hres.send(500, { 'content-type': 'application/json' }, '{"error":"internal"}');
    });
  });

  return {
    kind: 'ws',
    onHttp: (fn) => b.setHttp(fn),
    route: (path, handlers) => { b.routes.set(path, handlers); },
    guard: (fn) => { b.guards.push(fn); },
    get connections() { return b.conns.size; },
    listen(host, port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolve(server.address().port); });
      });
    },
    async close(code = 1001, reason = 'shutdown') {
      clearInterval(sweep);
      for (const c of [...b.conns]) c.close(code, reason);
      await new Promise((r) => setTimeout(r, 20));
      for (const c of [...b.conns]) c.terminate();
      const closed = new Promise((r) => server.close(() => r()));
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await closed;
    },
  };
}
