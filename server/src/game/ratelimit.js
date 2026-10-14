// game/ratelimit.js — OWNER: S2. Token buckets (ARCH §13.3, js/shared/constants.js RATE).
// Primary limits are per CONNECTION / ACCOUNT / DEVICE. Per-IP limits are deliberately lenient: Vietnamese 4G CGNAT
// puts thousands of players behind one IPv4. Loopback and private addresses are exempt from per-IP limits (local
// bots, the Docker host path); real players arrive through the Cloudflare tunnel with CF-Connecting-IP (public IPs).
// IPv6 addresses are grouped by /64 (/48 for the recovery limiter and the pre-auth socket pool — SEC-4/SEC-7).
//
// Service 'ratelimit':
//   bucket(rate, burst, now?) → TokenBucket {take(now, n = 1) → bool, retryAfterMs(now, n = 1)}
//   keyed({rate, burst, max}) → {take(key, now?, n?) → bool, retryAfterS(key, now?), size, sweep(now?)}
//   ipKey(ip) → string, isExemptIp(ip) → bool
//   http.<name>  ready-made keyed limiters used by api/auth.js and api/join.js (see LIMITS)
//   checkHttp(name, key) → null | {retryAfterS}   (for router opts.rateLimit / handlers)

import net from 'node:net';

export class TokenBucket {
  constructor(rate, burst, now = performance.now()) { this.rate = rate; this.burst = burst; this.tokens = burst; this.last = now; }
  _refill(now) {
    const dt = now - this.last;
    if (dt > 0) { this.tokens = Math.min(this.burst, this.tokens + (dt * this.rate) / 1000); this.last = now; }
  }
  take(now = performance.now(), n = 1) {
    this._refill(now);
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
  retryAfterMs(now = performance.now(), n = 1) {
    this._refill(now);
    return this.tokens >= n ? 0 : Math.ceil(((n - this.tokens) * 1000) / this.rate);
  }
}

// Keyed limiter with bounded memory (oldest key evicted when full; full buckets swept).
export function createKeyedLimiter({ rate, burst, max = 100000 }) {
  const map = new Map();   // key → {tokens, last}
  const refill = (b, now) => {
    const dt = now - b.last;
    if (dt > 0) { b.tokens = Math.min(burst, b.tokens + (dt * rate) / 1000); b.last = now; }
  };
  return {
    rate, burst,
    take(key, now = Date.now(), n = 1) {
      let b = map.get(key);
      if (!b) {
        if (map.size >= max) map.delete(map.keys().next().value);
        b = { tokens: burst, last: now };
        map.set(key, b);
      } else refill(b, now);
      if (b.tokens >= n) { b.tokens -= n; return true; }
      return false;
    },
    retryAfterS(key, now = Date.now(), n = 1) {
      const b = map.get(key);
      if (!b) return 0;
      refill(b, now);
      return b.tokens >= n ? 0 : Math.ceil((n - b.tokens) / rate);
    },
    sweep(now = Date.now()) {
      for (const [k, b] of map) { refill(b, now); if (b.tokens >= burst) map.delete(k); }
    },
    get size() { return map.size; },
  };
}

// Full IPv6 expansion ('2001:db8::1' → 8 hextets; IPv4-mapped '::ffff:1.2.3.4' → the IPv4 address). Returns null when
// the string is not an IPv6 address. (Fixer round 1, SEC-7: the old split on '::' mis-grouped compressed addresses —
// '2001:db8::1' and '2001:db8::2' got different /64 keys.)
export function expandIPv6(ip) {
  let s = String(ip || '').toLowerCase();
  const pct = s.indexOf('%'); if (pct >= 0) s = s.slice(0, pct);          // zone id
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (!net.isIPv6(s)) return null;
  let tail = [];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    tail = [((p[0] << 8) | p[1]).toString(16), ((p[2] << 8) | p[3]).toString(16)];
    s = s.slice(0, -v4[1].length).replace(/:$/, '') || ':';
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [a, b] = s.split('::');
  const head = a ? a.split(':').filter(Boolean) : [];
  const rest = b !== undefined ? (b ? b.split(':').filter(Boolean) : []) : null;
  const want = 8 - tail.length;
  let groups;
  if (rest === null) groups = head;
  else groups = [...head, ...new Array(Math.max(0, want - head.length - rest.length)).fill('0'), ...rest];
  groups = [...groups, ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16) & 0xffff);
}

// Rate-limit key for an address: IPv4 as is; IPv4-mapped IPv6 → the IPv4; IPv6 grouped by a prefix (default /64 —
// one subscriber; /48 for the global-cap pools, where one host with a free /48 must not get 65k keys).
export function ipKey(ip, bits = 64) {
  const s = String(ip || '');
  if (!s.includes(':')) return s;
  const g = expandIPv6(s);
  if (!g) return s.toLowerCase();
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  }
  const n = Math.max(16, Math.min(128, bits | 0));
  const out = [];
  for (let i = 0; i < 8; i++) {
    const keep = Math.max(0, Math.min(16, n - i * 16));
    if (keep <= 0) break;
    out.push((keep === 16 ? g[i] : g[i] & (0xffff << (16 - keep)) & 0xffff).toString(16));
  }
  return out.join(':') + '::/' + n;
}

export function isExemptIp(ip) {
  const s = String(ip || '').toLowerCase();
  if (!s || s === '::1' || s === 'localhost') return true;
  if (s.includes(':')) return s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe80');
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((v) => !(v >= 0 && v <= 255))) return false;
  return p[0] === 127 || p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168);
}

const H = 3600;
// name → [rate per second, burst]
export const LIMITS = Object.freeze({
  guestDevice: [5 / H, 5],        // new guest accounts per device
  guestIp: [30 / H, 30],          // … per IP (lenient; CGNAT)
  refreshIp: [10, 200],           // refresh calls per IP
  refreshToken: [1, 5],           // per refresh-token hash (hammering one token)
  recoverIp: [20 / H, 10],        // recovery attempts per IP
  recoverDevice: [5 / H, 5],      // … per device
  recoverGlobal: [300 / H, 100],  // … whole server: ALERT ONLY (never refuses — SEC-4; codes are 59-bit + peppered)
  joinAccount: [0.5, 10],         // /v1/join per account (queue polling ≥ 2 s apart)
  joinIp: [50, 300],              // /v1/join per IP
  wsNewIp: [20, 300],             // new WebSocket connections per IP
  helloAccount: [1, 10],          // HELLO attempts per account (reconnect storms)
});

// IPv6 prefix per limiter (default 64)
export const LIMIT_IP_BITS = Object.freeze({ recoverIp: 48, guestIp: 48 });

export function register(app) {
  const http = {};
  for (const [name, [rate, burst]] of Object.entries(LIMITS)) http[name] = createKeyedLimiter({ rate, burst });
  const svc = {
    bucket: (rate, burst, now) => new TokenBucket(rate, burst, now),
    keyed: createKeyedLimiter,
    ipKey, isExemptIp,
    http,
    // key may be an IP (exempt addresses always pass) or any string
    checkHttp(name, key, { ip = false, now = Date.now() } = {}) {
      if (ip && isExemptIp(key)) return null;
      const l = http[name];
      const k = ip ? ipKey(key, LIMIT_IP_BITS[name] || 64) : key;
      if (l.take(k, now)) return null;
      return { retryAfterS: Math.max(1, l.retryAfterS(k, now)) };
    },
  };
  app.provide('ratelimit', svc);
  app.bus.on('start', () => {
    app.timers.every(60000, 'ratelimit_sweep', () => { const now = Date.now(); for (const l of Object.values(http)) l.sweep(now); });
  });
}
