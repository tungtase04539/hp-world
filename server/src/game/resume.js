// game/resume.js — OWNER: S2. Resume within 60 s (NET.RESUME_S) with the 16-byte resumeToken from WELCOME (sent in
// HELLO with HELLO_FLAG.RESUME): same netId, same position/state, the AOI restarts with a keyframe. Tokens are random
// 128-bit secrets, single use, rotated on every WELCOME, revoked when the session ends. Backoff guidance: clients are
// told SYSTEM BACKOFF (1-2-4-8 s + 0–1 s jitter, ARCH §6.2) when the server closes them for load or shutdown.
//
// Service 'resume': issue(session) → Uint8Array(16), take(bytes) → session | null, revoke(session), size,
//                   backoffMs(attempt) → ms
import crypto from 'node:crypto';
import { NET } from '../../../js/shared/constants.js';

export function createResume() {
  const map = new Map();   // hex → session
  return {
    issue(session) {
      if (session.resumeHex) map.delete(session.resumeHex);
      const b = new Uint8Array(crypto.randomBytes(NET.RESUME_TOKEN_BYTES));
      session.resumeHex = Buffer.from(b).toString('hex');
      session.resumeToken = b;
      map.set(session.resumeHex, session);
      return b;
    },
    take(bytes) {
      if (!bytes || bytes.length !== NET.RESUME_TOKEN_BYTES) return null;
      const hex = Buffer.from(bytes).toString('hex');
      const s = map.get(hex);
      if (!s) return null;
      map.delete(hex);
      s.resumeHex = null;
      return s;
    },
    revoke(session) { if (session.resumeHex) { map.delete(session.resumeHex); session.resumeHex = null; } },
    get size() { return map.size; },
    backoffMs,
  };
}

// 1-2-4-8 s (+ 0–1 s jitter), attempt = 0, 1, 2, …
export function backoffMs(attempt = 0, rand = Math.random) {
  return Math.min(8000, 1000 * 2 ** Math.max(0, Math.min(3, attempt))) + Math.floor(rand() * 1000);
}

export function register(app) {
  app.provide('resume', createResume());
}
