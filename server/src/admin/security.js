// admin/security.js — who may talk to the admin port (SPEC §4.2: never reachable through the tunnel).
//
// Layers (all must pass, checked before any route):
//   1. source IP allow-list: loopback only by default; ADMIN_ALLOW_IPS (comma list of IPv4/IPv6 CIDRs) adds e.g. the
//      Docker bridge gateway that carries the host's published-port traffic. The cloudflared container's network must
//      NOT be listed (S5 keeps it on the separate `edge` network).
//   2. Host header must be a loopback name (127.0.0.1 / localhost / [::1], any port) or in ADMIN_ALLOW_HOSTS →
//      defeats DNS rebinding from a web page the owner happens to visit.
//   3. Origin, when present, must be exactly this host (same-origin) → no cross-site requests at all.
//   4. Auth: `Authorization: Bearer <ADMIN_TOKEN>` (scripts) or the login session cookie (page). Token compare is
//      constant-time. Login is rate-limited (5 failures / 15 min / IP, 20 / hour overall → locked 15 min).
//   5. CSRF: cookie sessions must send `x-csrf-token` on every non-GET request (constant-time compare), JSON only.
import crypto from 'node:crypto';
import net from 'node:net';

export const SEC_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'cache-control': 'no-store',
});

export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) { crypto.timingSafeEqual(x, x); return false; }
  return crypto.timingSafeEqual(x, y);
}

// ---- IP allow-list ------------------------------------------------------------------------------------------------
function parseCidr(s) {
  s = String(s).trim();
  if (!s) return null;
  let [addr, bits] = s.split('/');
  addr = addr.replace(/^\[|\]$/g, '');
  const fam = net.isIP(addr);
  if (!fam) return null;
  const max = fam === 4 ? 32 : 128;
  const b = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(b) || b < 0 || b > max) return null;
  return { fam, bytes: ipBytes(addr), bits: b };
}
function ipBytes(ip) {
  if (net.isIPv4(ip)) return Uint8Array.from(ip.split('.').map(Number));
  // expand IPv6 (with optional embedded IPv4)
  let s = ip.toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const b = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + ((b[0] << 8) | b[1]).toString(16) + ':' + ((b[2] << 8) | b[3]).toString(16);
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? new Array(8 - h.length - t.length).fill('0') : [];
  const parts = [...h, ...fill, ...t];
  const out = new Uint8Array(16);
  parts.forEach((p, i) => { const v = parseInt(p || '0', 16); out[i * 2] = v >> 8; out[i * 2 + 1] = v & 255; });
  return out;
}
function inCidr(bytes, c) {
  if (bytes.length !== c.bytes.length) return false;
  let bits = c.bits;
  for (let i = 0; i < bytes.length && bits > 0; i++) {
    const n = Math.min(8, bits);
    const mask = (0xff << (8 - n)) & 0xff;
    if ((bytes[i] & mask) !== (c.bytes[i] & mask)) return false;
    bits -= n;
  }
  return true;
}
export function normalizeIp(ip) {
  let s = String(ip || '').trim().replace(/^\[|\]$/g, '');
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) s = m[1];
  if (net.isIPv6(s)) {
    const b = ipBytes(s);
    // IPv4-mapped in long form
    if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) s = `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  }
  return s;
}
export function createIpAllow(extra = '') {
  const list = ['127.0.0.0/8', '::1/128', ...String(extra || '').split(',')].map(parseCidr).filter(Boolean);
  return (ip) => {
    const s = normalizeIp(ip);
    const fam = net.isIP(s);
    if (!fam) return false;
    const b = ipBytes(s);
    return list.some((c) => c.fam === fam && inCidr(b, c));
  };
}

// ---- Host / Origin ------------------------------------------------------------------------------------------------
export function hostName(host) {
  const h = String(host || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  return h.split(':')[0];
}
export function createHostAllow(extra = '') {
  const names = new Set(['127.0.0.1', 'localhost', '[::1]', ...String(extra || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]);
  return (host) => names.has(hostName(host));
}

// ---- sessions + login rate limit -------------------------------------------------------------------------------------
export function createSessions({ now = () => Date.now(), ttlMs = 12 * 3600_000, idleMs = 2 * 3600_000, max = 20 } = {}) {
  const sessions = new Map();
  const fails = new Map();     // ip → [t]
  let globalFails = [];
  let lockedUntil = 0;
  const FAIL_WINDOW = 15 * 60_000, FAIL_IP = 5, FAIL_GLOBAL = 20, LOCK_MS = 15 * 60_000;

  return {
    // → { ok, retryAfterS? } — call BEFORE comparing the token
    loginAllowed(ip) {
      const t = now();
      if (t < lockedUntil) return { ok: false, retryAfterS: Math.ceil((lockedUntil - t) / 1000) };
      const arr = (fails.get(ip) || []).filter((x) => t - x < FAIL_WINDOW);
      fails.set(ip, arr);
      if (arr.length >= FAIL_IP) return { ok: false, retryAfterS: Math.ceil((arr[0] + FAIL_WINDOW - t) / 1000) };
      return { ok: true };
    },
    loginFailed(ip) {
      const t = now();
      const arr = fails.get(ip) || [];
      arr.push(t);
      fails.set(ip, arr);
      globalFails = globalFails.filter((x) => t - x < 3600_000);
      globalFails.push(t);
      if (globalFails.length >= FAIL_GLOBAL) lockedUntil = t + LOCK_MS;
    },
    create(ip) {
      const t = now();
      if (sessions.size >= max) {
        const oldest = [...sessions.entries()].sort((a, b) => a[1].created - b[1].created)[0];
        sessions.delete(oldest[0]);
      }
      const sid = crypto.randomBytes(32).toString('base64url');
      const csrf = crypto.randomBytes(32).toString('base64url');
      sessions.set(sid, { sid, csrf, ip, created: t, seen: t });
      fails.delete(ip);
      return sessions.get(sid);
    },
    get(sid) {
      if (!sid) return null;
      const s = sessions.get(sid);
      if (!s) return null;
      const t = now();
      if (t - s.created > ttlMs || t - s.seen > idleMs) { sessions.delete(sid); return null; }
      s.seen = t;
      return s;
    },
    destroy(sid) { sessions.delete(sid); },
    get size() { return sessions.size; },
    ttlMs,
  };
}

export function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
