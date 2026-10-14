// chat/util.js — small helpers for the chat service: token bucket, bounded Levenshtein, matching key, positions.

// Token bucket: `rate` tokens / s, capacity `burst`. take(now) → 0 when allowed, else ms until the next token.
export class Bucket {
  constructor(rate, burst, now) { this.rate = rate; this.burst = burst; this.tokens = burst; this.t = now; this.seen = now; }
  take(now) {
    this.seen = now;
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens >= 1) { this.tokens -= 1; return 0; }
    return Math.ceil(((1 - this.tokens) / this.rate) * 1000);
  }
}

// Levenshtein distance with early exit: returns max + 1 as soon as the distance must exceed `max`.
export function levenshtein(a, b, max = 2) {
  if (a === b) return 0;
  const n = a.length, m = b.length;
  if (Math.abs(n - m) > max) return max + 1;
  let prev = new Array(m + 1), cur = new Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}

// key for duplicate detection: lower-case, no diacritics, letters/digits only, single spaces, runs collapsed
export function dupKey(text) {
  return String(text).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(.)\1{2,}/gu, '$1$1').trim();
}

// position of an S2 session object, whatever shape it uses (x/z, pos.{x,z}, state.{x,z}, p[0]/p[2])
export function posOf(s) {
  if (!s) return null;
  const cand = [s, s.pos, s.state, s.position, s.player];
  for (const c of cand) {
    if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) return { x: c.x, z: c.z };
  }
  if (Array.isArray(s.p) && Number.isFinite(s.p[0])) return { x: s.p[0], z: s.p[2] ?? s.p[1] };
  return null;
}

export const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
