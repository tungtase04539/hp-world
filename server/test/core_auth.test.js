// S2: accounts — guest + invite codes + Nick#1234 + EdDSA access JWT + refresh rotation / reuse detection + recovery
// code + rate limits; POST /v1/join basics (proto, auth, banned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SignJWT, decodeProtectedHeader } from 'jose';
import { bootCore, post, deviceId, guest, joinTicket } from './core_util.mjs';
import { createInviteBatch, normalizeCode, AUTH } from '../src/api/auth.js';
import { PROTO_VERSION } from '../../js/shared/protocol.js';

test('invites: required, single/multi use, expiry, normalisation', async () => {
  const s = await bootCore({ INVITE_REQUIRED: 'true' });
  try {
    const db = s.app.db;
    let r = await post(s, '/v1/auth/guest', { nickname: 'Hoa', deviceId: deviceId() });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'invite_required');
    r = await post(s, '/v1/auth/guest', { nickname: 'Hoa', deviceId: deviceId(), inviteCode: 'NOPE-NOPE' });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'invite_invalid');
    const [one] = await createInviteBatch(db, { count: 1, uses: 2, batch: 'test' });
    assert.match(one, /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/);
    // lower case + spaces still match
    r = await post(s, '/v1/auth/guest', { nickname: 'Hoa', deviceId: deviceId(), inviteCode: ' ' + one.toLowerCase().replace('-', ' ') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    r = await post(s, '/v1/auth/guest', { nickname: 'Lan', deviceId: deviceId(), inviteCode: one });
    assert.equal(r.status, 200);
    r = await post(s, '/v1/auth/guest', { nickname: 'Mai', deviceId: deviceId(), inviteCode: one });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'invite_invalid');
    const left = await db.one('SELECT uses_left, uses_total FROM invites');
    assert.equal(left.uses_left, 0); assert.equal(left.uses_total, 2);
    const acc = await db.query('SELECT invite_id FROM accounts');
    assert.equal(acc.rows.length, 2);
    // expired
    const [old] = await createInviteBatch(db, { count: 1, expiresAt: new Date(Date.now() - 1000) });
    r = await post(s, '/v1/auth/guest', { nickname: 'Cuc', deviceId: deviceId(), inviteCode: old });
    assert.equal(r.status, 403);
    // only hashes stored
    const rows = await db.query('SELECT code_hash FROM invites');
    for (const row of rows.rows) assert.equal(row.code_hash.length, 32);
    assert.equal(normalizeCode('ab-cd 12'), 'ABCD12');
  } finally { await s.app.stop(); }
});

test('guest: Nick#1234, validation, EdDSA access token, secrets never in responses', async () => {
  const s = await bootCore();
  try {
    const a = await guest(s, 'Tùng');
    assert.match(a.account.displayName, /^Tùng#\d{4}$/);
    assert.equal(a.account.nickname, 'Tùng');
    assert.match(a.recoveryCode, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    assert.match(a.refreshToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(a.accessExpiresIn, 900);
    const b = await guest(s, 'tùng');
    assert.notEqual(a.account.displayName.split('#')[1], b.account.displayName.split('#')[1]);
    // JWT header + verification
    const h = decodeProtectedHeader(a.accessToken);
    assert.equal(h.alg, 'EdDSA'); assert.equal(h.kid, s.config.secrets.jwtKid);
    const auth = s.app.get('auth');
    const claims = await auth.verifyAccess(a.accessToken);
    assert.equal(claims.sub, a.account.id); assert.equal(claims.dn, a.account.displayName);
    assert.ok(claims.exp - claims.iat === AUTH.ACCESS_S);
    // tamper a byte in the MIDDLE of the signature (fixer round 2: replacing the last two base64url chars with 'AA' was a
    // no-op ~1/256 of the time — the final char carries 4 padding bits — and the test failed at random)
    const tok = a.accessToken, mid = tok.lastIndexOf('.') + 20;
    assert.equal(await auth.verifyAccess(tok.slice(0, mid) + (tok[mid] === 'A' ? 'B' : 'A') + tok.slice(mid + 1)), null);
    // another key → rejected; expired → rejected
    const other = crypto.generateKeyPairSync('ed25519').privateKey;
    const forged = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: s.config.secrets.jwtKid }).setSubject(a.account.id)
      .setIssuer('hp-world').setAudience('hp-world-play').setExpirationTime('5m').sign(other);
    assert.equal(await auth.verifyAccess(forged), null);
    const key = crypto.createPrivateKey({ key: Buffer.from(s.config.secrets.jwtPrivateKey, 'base64'), format: 'der', type: 'pkcs8' });
    const expired = await new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: s.config.secrets.jwtKid }).setSubject(a.account.id)
      .setIssuer('hp-world').setAudience('hp-world-play').setIssuedAt(Math.floor(Date.now() / 1000) - 3600).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
    assert.equal(await auth.verifyAccess(expired), null);
    // validation
    for (const [body, code] of [
      [{ nickname: 'ab', deviceId: deviceId() }, 'nickname_invalid'],
      [{ nickname: 'Admin', deviceId: deviceId() }, 'nickname_invalid'],
      [{ nickname: 'x'.repeat(30), deviceId: deviceId() }, 'nickname_invalid'],
      [{ nickname: 'Hoa', deviceId: 'short' }, 'device_invalid'],
      [{ nickname: 'Hoa', deviceId: 'has spaces in it' }, 'device_invalid'],
      [{ nickname: 42, deviceId: deviceId() }, 'bad_request'],
    ]) {
      const r = await post(s, '/v1/auth/guest', body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.body.error, code, JSON.stringify(r.body));
    }
    // no secret ever appears in a response
    const all = JSON.stringify([a, b]);
    for (const v of Object.values(s.config.secrets)) if (v && v.length > 8) assert.ok(!all.includes(v));
    // stored: only hashes of refresh token / recovery code
    const rt = await s.app.db.one('SELECT token_hash FROM refresh_tokens WHERE account_id = $1', [a.account.id]);
    assert.equal(rt.token_hash.length, 32);
    assert.ok(!JSON.stringify(rt).includes(a.refreshToken));
  } finally { await s.app.stop(); }
});

test('refresh: rotation, race window, reuse revokes everything; banned', async () => {
  const s = await bootCore();
  try {
    const a = await guest(s, 'Minh');
    const r1 = await post(s, '/v1/auth/refresh', { refreshToken: a.refreshToken });
    assert.equal(r1.status, 200);
    assert.notEqual(r1.body.refreshToken, a.refreshToken);
    assert.equal(r1.body.account.id, a.account.id);
    // immediate re-use of the rotated token = double submit → 409, nothing revoked
    const race = await post(s, '/v1/auth/refresh', { refreshToken: a.refreshToken });
    assert.equal(race.status, 409); assert.equal(race.body.error, 'refresh_race');
    const r2 = await post(s, '/v1/auth/refresh', { refreshToken: r1.body.refreshToken });
    assert.equal(r2.status, 200);
    // later re-use of an old token = theft signal → every token of the account revoked
    await s.app.db.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes' WHERE revoked_at IS NOT NULL`);
    const reuse = await post(s, '/v1/auth/refresh', { refreshToken: a.refreshToken });
    assert.equal(reuse.status, 401); assert.equal(reuse.body.error, 'refresh_reused');
    const after = await post(s, '/v1/auth/refresh', { refreshToken: r2.body.refreshToken });
    assert.equal(after.status, 401);
    assert.equal((await post(s, '/v1/auth/refresh', { refreshToken: 'x'.repeat(43) })).status, 401);
    assert.equal((await post(s, '/v1/auth/refresh', {})).status, 400);
    // banned account
    const b = await guest(s, 'Bao');
    await s.app.db.query(`UPDATE accounts SET status = 'banned' WHERE id = $1`, [b.account.id]);
    const rb = await post(s, '/v1/auth/refresh', { refreshToken: b.refreshToken });
    assert.equal(rb.status, 403); assert.equal(rb.body.error, 'banned');
    const jb = await joinTicket(s, b.accessToken);
    assert.equal(jb.status, 403);
  } finally { await s.app.stop(); }
});

test('recovery code: any formatting works, wrong code refused, same account; rate limits per device', async () => {
  const s = await bootCore();
  try {
    const a = await guest(s, 'Phuong');
    const dev = deviceId();
    const r = await post(s, '/v1/auth/recover', { code: a.recoveryCode.toLowerCase().replace(/-/g, ' '), deviceId: dev });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.account.id, a.account.id);
    assert.equal(r.body.account.displayName, a.account.displayName);
    assert.ok(r.body.accessToken && r.body.refreshToken);
    const bad = await post(s, '/v1/auth/recover', { code: 'AAAA-BBBB-CCCC', deviceId: deviceId() });
    assert.equal(bad.status, 401); assert.equal(bad.body.error, 'recovery_invalid');
    // per device: 5 attempts, then 429
    const d2 = deviceId();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await post(s, '/v1/auth/recover', { code: 'ZZZZ-ZZZZ-ZZZZ', deviceId: d2 })).status);
    assert.deepEqual(codes, [401, 401, 401, 401, 401, 429, 429]);
    // guest creation per device: 5 per hour
    const d3 = deviceId();
    const g = [];
    for (let i = 0; i < 6; i++) g.push((await post(s, '/v1/auth/guest', { nickname: 'Khach' + i, deviceId: d3 })).status);
    assert.deepEqual(g, [200, 200, 200, 200, 200, 429]);
    const lim = await post(s, '/v1/auth/guest', { nickname: 'KhachX', deviceId: d3 });
    assert.ok(lim.body.retryAfterS > 0);
  } finally { await s.app.stop(); }
});

test('join: proto mismatch, bad token, ticket shape, spawn hint', async () => {
  const s = await bootCore();
  try {
    const a = await guest(s, 'Quang');
    let r = await joinTicket(s, a.accessToken, { proto: PROTO_VERSION + 1 });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'proto_mismatch'); assert.equal(r.body.serverProto, PROTO_VERSION);
    r = await joinTicket(s, 'nope');
    assert.equal(r.status, 401);
    r = await joinTicket(s, a.accessToken);
    assert.equal(r.status, 200);
    assert.match(r.body.ticket, /^v1\.[A-Za-z0-9_-]{39}\.[A-Za-z0-9_-]{22}$/);
    assert.equal(r.body.ticketExpiresIn, 60);
    assert.equal(r.body.wsUrl, s.config.publicWsUrl);
    assert.ok(Number.isFinite(r.body.spawnHint.x) && Number.isFinite(r.body.spawnHint.z));
    assert.ok(!r.body.wsUrl.includes(r.body.ticket));
  } finally { await s.app.stop(); }
});
