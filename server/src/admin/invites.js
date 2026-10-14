// admin/invites.js — invite codes for the closed test. Only sha256(normalised code) is stored (table invites, 001_base).
// Code format: 10 chars from an unambiguous alphabet (no I, L, O, 0, 1), shown as XXXXX-XXXXX. Normalisation (also
// for what the player types): NFKC, upper-case, keep A–Z / 0–9 only (dashes / spaces dropped). S2's
// POST /v1/auth/guest must hash with hashInviteCode() — also provided as service 'invites' =
// { normalize, hash, generate, createBatch, listBatches }.
import crypto from 'node:crypto';

export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no I, L, O, 0, 1
export const INVITE_LEN = 10;

export function normalizeInviteCode(code) {
  return String(code ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
export function hashInviteCode(code) {
  return crypto.createHash('sha256').update(normalizeInviteCode(code), 'utf8').digest();
}
export function generateInviteCode() {
  const bytes = crypto.randomBytes(INVITE_LEN * 2);
  let s = '';
  // rejection sampling: no modulo bias
  for (let i = 0; i < bytes.length && s.length < INVITE_LEN; i++) {
    const v = bytes[i];
    if (v < 256 - (256 % INVITE_ALPHABET.length)) s += INVITE_ALPHABET[v % INVITE_ALPHABET.length];
  }
  while (s.length < INVITE_LEN) s += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  return s.slice(0, 5) + '-' + s.slice(5);
}

// → { batch, codes: [plain codes, shown ONCE], expiresAt }
export async function createInviteBatch(db, { count = 10, uses = 1, days = 30, note = null, batch = null, actor = 'owner' } = {}) {
  count = Math.max(1, Math.min(500, Math.floor(Number(count) || 0)));
  uses = Math.max(1, Math.min(1000, Math.floor(Number(uses) || 1)));
  days = days == null || days === '' || Number(days) <= 0 ? null : Math.min(3650, Number(days));
  batch = String(batch || `lo-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(2).toString('hex')}`).slice(0, 64);
  note = note == null ? null : String(note).slice(0, 200);
  const expiresAt = days ? new Date(Date.now() + days * 86400_000) : null;
  const codes = [];
  await db.tx(async (q) => {
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = generateInviteCode();
        const r = await q.query(`INSERT INTO invites (code_hash, batch, uses_left, uses_total, expires_at, created_by, note)
          VALUES ($1,$2,$3,$3,$4,$5,$6) ON CONFLICT (code_hash) DO NOTHING RETURNING id`, [hashInviteCode(code), batch, uses, expiresAt, actor, note]);
        if (r.rows.length) { codes.push(code); break; }
      }
    }
  });
  return { batch, codes, uses, expiresAt: expiresAt ? expiresAt.toISOString() : null };
}

export async function listInviteBatches(db) {
  return (await db.query(`SELECT batch, count(*)::int AS codes, sum(uses_total)::int AS uses_total, sum(uses_left)::int AS uses_left,
    min(created_at) AS created_at, max(expires_at) AS expires_at, max(note) AS note,
    sum(CASE WHEN expires_at IS NOT NULL AND expires_at < now() THEN 1 ELSE 0 END)::int AS expired
    FROM invites GROUP BY batch ORDER BY min(created_at) DESC LIMIT 200`)).rows;
}
