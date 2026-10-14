// game/ratelimit.js — OWNER: S2. Token buckets (ARCH §13.3, js/shared/constants.js RATE).
// Primary limits are per CONNECTION / ACCOUNT / DEVICE. Per-IP limits are deliberately lenient: Vietnamese 4G CGNAT
// puts thousands of players behind one IPv4. Loopback and private addresses are exempt from per-IP limits (local
// bots, the Docker host path); real players arrive through the Cloudflare tunnel with CF-Connecting-IP (public IPs).
// IPv6 addresses are grouped by /64.
//
// Service 'ratelimit':
//   bucket(rate, burst, now?) → TokenBucket {take(now, n = 1) → bool, retryAfterMs(now, n = 1)}
//   keyed({rate, burst, max}) → {take(key, now?, n?) → bool, retryAfterS(key, now?), size, sweep(now?)}
//   ipKey(ip) → string, isExemptIp(ip) → bool
//   http.<name>  ready-made keyed limiters used by api/auth.js and api/join.js (see LIMITS)
//   checkHttp(name, key) → null | {retryAfterS}   (for router opts.rateLimit / handlers)

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

export function ipKey(ip) {
  const s = String(ip || '');
  if (s.includes(':')) {
    const parts = s.split(':');
    // expand '::' roughly: keep the first 4 hextets as the /64
    const head = s.split('::')[0].split(':').filter(Boolean);
    const full = head.length >= 4 ? head.slice(0, 4) : parts.slice(0, 4);
    return full.join(':').toLowerCase() + '::/64';
  }
  return s;
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
  recoverGlobal: [300 / H, 100],  // … for the whole server (brute-force ceiling)
  joinAccount: [0.5, 10],         // /v1/join per account (queue polling ≥ 2 s apart)
  joinIp: [50, 300],              // /v1/join per IP
  wsNewIp: [20, 300],             // new WebSocket connections per IP
  helloAccount: [1, 10],          // HELLO attempts per account (reconnect storms)
});

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
      const k = ip ? ipKey(key) : key;
      if (l.take(k, now)) return null;
      return { retryAfterS: Math.max(1, l.retryAfterS(k, now)) };
    },
  };
  app.provide('ratelimit', svc);
  app.bus.on('start', () => {
    app.timers.every(60000, 'ratelimit_sweep', () => { const now = Date.now(); for (const l of Object.values(http)) l.sweep(now); });
  });
}
