// game/tickets.js — OWNER: S2. Join tickets (ARCH §6.2): POST /v1/join issues one, the client sends it as the FIRST
// WebSocket message (HELLO), never in the URL. HMAC-SHA256 (config.secrets.ticketHmacKey), TTL 60 s, single use.
//
// Format (ASCII, 62 chars): "v1." + base64url(payload 29 B) + "." + base64url(HMAC-SHA256(key, "v1." + b64payload)[0..16])
//   payload = accountId (uuid, 16 B) | exp (u32 BE, unix seconds) | nonce (8 random bytes) | tier (u8)
// Single use: verify() checks MAC + expiry; consume(nonce) records the nonce until it expires (replay → REUSED).
import crypto from 'node:crypto';
import { AUTH_REASON } from '../../../js/shared/protocol.js';
import { NET } from '../../../js/shared/constants.js';

const uuidToBytes = (u) => Buffer.from(String(u).replace(/-/g, ''), 'hex');
const bytesToUuid = (b) => {
  const h = Buffer.from(b).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export function createTicketer({ key, ttlS = NET.TICKET_TTL_S, now = () => Date.now() }) {
  const k = Buffer.from(String(key || ''), 'base64url');
  if (k.length < 16) throw new Error('tickets: ticket HMAC key must be ≥ 16 bytes');
  const used = new Map();   // nonce hex → exp ms
  const mac = (s) => crypto.createHmac('sha256', k).update(s).digest().subarray(0, 16);

  return {
    ttlS,
    issue(accountId, tier = 0) {
      const p = Buffer.alloc(29);
      const id = uuidToBytes(accountId);
      if (id.length !== 16) throw new Error('tickets: bad account id');
      id.copy(p, 0);
      const exp = Math.floor(now() / 1000) + ttlS;
      p.writeUInt32BE(exp >>> 0, 16);
      const nonce = crypto.randomBytes(8);
      nonce.copy(p, 20);
      p[28] = tier & 255;
      const head = 'v1.' + p.toString('base64url');
      return { ticket: head + '.' + mac(head).toString('base64url'), nonce: nonce.toString('hex'), exp: exp * 1000 };
    },
    // → {ok, reason, accountId, tier, nonce, exp}
    verify(ticket) {
      const s = typeof ticket === 'string' ? ticket : '';
      const parts = s.split('.');
      if (parts.length !== 3 || parts[0] !== 'v1' || s.length > NET.MAX_TICKET_BYTES) return { ok: false, reason: AUTH_REASON.BAD_TICKET };
      let p, m;
      try { p = Buffer.from(parts[1], 'base64url'); m = Buffer.from(parts[2], 'base64url'); } catch { return { ok: false, reason: AUTH_REASON.BAD_TICKET }; }
      if (p.length !== 29 || m.length !== 16) return { ok: false, reason: AUTH_REASON.BAD_TICKET };
      const want = mac('v1.' + parts[1]);
      if (!crypto.timingSafeEqual(want, m)) return { ok: false, reason: AUTH_REASON.BAD_TICKET };
      const exp = p.readUInt32BE(16) * 1000;
      const nonce = p.subarray(20, 28).toString('hex');
      const out = { ok: true, reason: 0, accountId: bytesToUuid(p.subarray(0, 16)), exp, nonce, tier: p[28] };
      if (exp <= now()) return { ...out, ok: false, reason: AUTH_REASON.EXPIRED };
      if (used.has(nonce)) return { ...out, ok: false, reason: AUTH_REASON.REUSED };
      return out;
    },
    // mark a verified ticket as used; false if it was already used
    consume(nonce, exp) {
      if (used.has(nonce)) return false;
      used.set(nonce, exp);
      return true;
    },
    sweep(t = now()) { for (const [n, e] of used) if (e <= t) used.delete(n); },
    get usedCount() { return used.size; },
  };
}
