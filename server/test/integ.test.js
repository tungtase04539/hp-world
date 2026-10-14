// integ.test.js — INTEGRATOR (15/10/2026): the seams between S2 (game), S3 (chat / admin) and S5 (netprobe) over the
// real sockets: admin-made invite codes open /v1/auth/guest, admin sanctions reach the live session (mute / warn /
// kick / ban → EVENT SANCTION / close 4009 / close 4003 + refused join), owner broadcast + restart notice reach the
// players, self-harm words trigger EVENT SUPPORT_LINE, the admin map shows the real session position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootCore, guest, joinTicket, connectPlayer, post, deviceId, sleep } from './core_util.mjs';
import { rawRequest } from './helpers/safety.mjs';
import { S2C, SYS, CLOSE, EVENT, CHANNEL, SANCTION_KIND, KICK_REASON } from '../../js/shared/protocol.js';
import { SPAWNS } from '../../js/shared/spawns.js';

const OPERA = SPAWNS[0];
const admin = (s, method, p, body) => rawRequest(s.admin + p, {
  method, body, headers: { authorization: 'Bearer ' + s.config.secrets.adminToken, 'content-type': 'application/json' },
});
async function placed(s, nick, x = OPERA.x, z = OPERA.z) {
  const g = await guest(s, nick);
  await s.app.db.query('UPDATE characters SET pos_x = $1, pos_z = $2, yaw = 0 WHERE account_id = $3', [x, z, g.account.id]);
  return g;
}

test('invite codes from the admin page open POST /v1/auth/guest (same hash); single-use codes run out', async () => {
  const s = await bootCore({ INVITE_REQUIRED: 'true' });
  try {
    const r = await admin(s, 'POST', '/admin/api/invites', { count: 2, uses: 1, days: 7, note: 'integ' });
    assert.equal(r.status, 200, r.text);
    const [c1, c2] = r.json.codes;
    assert.match(c1, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    const no = await post(s, '/v1/auth/guest', { nickname: 'Khong', deviceId: deviceId() });
    assert.equal(no.status, 403); assert.equal(no.body.error, 'invite_required');
    // typed lower-case, without the dash: still the same code after normalisation
    const ok = await post(s, '/v1/auth/guest', { nickname: 'Coma', deviceId: deviceId(), inviteCode: c1.toLowerCase().replace('-', ' ') });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const again = await post(s, '/v1/auth/guest', { nickname: 'Lanhai', deviceId: deviceId(), inviteCode: c1 });
    assert.equal(again.status, 403); assert.equal(again.body.error, 'invite_invalid');
    assert.equal((await post(s, '/v1/auth/guest', { nickname: 'Laba', deviceId: deviceId(), inviteCode: c2 })).status, 200);
    const left = await s.app.db.one('SELECT sum(uses_left)::int AS n FROM invites');
    assert.equal(left.n, 0);
  } finally { await s.app.stop(); }
});

test('admin sanctions reach the live session: mute/warn → EVENT SANCTION, kick → 4009, ban → 4003 + join refused', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Phat', { auth: await placed(s, 'Phat') });
    await A.c.op(S2C.SNAPSHOT);
    const id = A.account.id;
    assert.equal((await admin(s, 'POST', `/admin/api/players/${id}/sanction`, { action: 'mute10m' })).status, 200);
    const mu = await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.SANCTION);
    assert.equal(mu.args[0], SANCTION_KIND.MUTE); assert.ok(mu.args[1] >= 590 && mu.args[1] <= 600, String(mu.args));
    // muted: chat refused with MUTED
    s.app.get('sessions').get(id).playSeconds = 3600;
    A.c.chat('xin chào');
    const rej = await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.CHAT_REJECTED);
    assert.equal(rej.args[0], 6);
    assert.equal((await admin(s, 'POST', `/admin/api/players/${id}/sanction`, { action: 'warn' })).status, 200);
    const wa = await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.SANCTION);
    assert.deepEqual(wa.args, [SANCTION_KIND.WARN, 0]);
    // shadow mute is never revealed
    assert.equal((await admin(s, 'POST', `/admin/api/players/${id}/sanction`, { action: 'shadow' })).status, 200);
    await sleep(150);
    assert.equal(A.c.drain(S2C.EVENT).filter((m) => m.type === EVENT.SANCTION).length, 0);
    // kick → SYSTEM KICK(ADMIN) + 4009; the account can come back
    assert.equal((await admin(s, 'POST', `/admin/api/players/${id}/sanction`, { action: 'kick' })).status, 200);
    const k = await A.c.wait((m) => m.op === S2C.SYSTEM && m.code === SYS.KICK);
    assert.equal(k.arg, KICK_REASON.ADMIN);
    assert.equal((await A.c.closedP).code, CLOSE.KICKED);
    const B = await connectPlayer(s, 'x', { auth: A.tokens });
    await B.c.op(S2C.SNAPSHOT);
    // ban 1 day → SYSTEM BANNED(seconds) + 4003, then /v1/join is refused (timed bans live in sanctions only)
    assert.equal((await admin(s, 'POST', `/admin/api/players/${id}/sanction`, { action: 'ban', days: 1 })).status, 200);
    const b = await B.c.wait((m) => m.op === S2C.SYSTEM && m.code === SYS.BANNED);
    assert.ok(b.arg > 86000 && b.arg <= 86400, String(b.arg));
    assert.equal((await B.c.closedP).code, CLOSE.BANNED);
    const j = await joinTicket(s, A.tokens.accessToken);
    assert.equal(j.status, 403); assert.equal(j.body.error, 'banned');
    assert.equal(s.app.get('sessions').get(id), null);
  } finally { await s.app.stop(); }
});

test('a join ticket keeps its capacity slot until the session exists (no overshoot during the HELLO player load)', async () => {
  const s = await bootCore({ CAPACITY: '1' });
  try {
    const a = await guest(s, 'Mot'), b = await guest(s, 'Hai');
    const ja = await joinTicket(s, a.accessToken);
    assert.ok(ja.body.ticket);
    assert.ok((await joinTicket(s, b.accessToken)).body.queue, 'cap 1, one ticket out → queued');
    // slow down the HELLO's player load; while it is in flight, B must still be queued
    const db = s.app.db, one = db.one.bind(db);
    let release;
    const gate = new Promise((r) => { release = r; });
    db.one = async (sql, params) => { if (/c\.appearance, c\.pos_x/.test(sql)) await gate; return one(sql, params); };   // persist.loadPlayer only
    const { Client } = await import('./core_util.mjs');
    const c = await Client.open(s.ws + '/play');
    c.hello(ja.body.ticket);
    await sleep(150);
    const jb = await joinTicket(s, b.accessToken);
    assert.ok(jb.body.queue, 'B is still queued while A\'s HELLO loads: ' + JSON.stringify(jb.body));
    release(); db.one = one;
    await c.op(S2C.WELCOME);
    assert.equal(s.app.get('queue').stats().reserved, 0);
    c.close();
  } finally { await s.app.stop(); }
});

test('owner broadcast / restart notice reach players; self-harm words → SUPPORT_LINE; admin map shows the real position', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Gio', { auth: await placed(s, 'Gio', OPERA.x + 3, OPERA.z - 2) });
    await A.c.op(S2C.SNAPSHOT);
    const live = await admin(s, 'GET', '/admin/api/live?since=0');
    const me = live.json.players.find((p) => p.accountId === A.account.id);
    assert.ok(me && Math.abs(me.x - (OPERA.x + 3)) < 0.2 && Math.abs(me.z - (OPERA.z - 2)) < 0.2 && me.netId === A.welcome.netId, JSON.stringify(live.json.players));
    assert.equal(live.json.stats.ccu, 1);
    const br = await admin(s, 'POST', '/admin/api/broadcast', { text: 'Tối nay có pháo hoa ở Nhà hát!' });
    assert.equal(br.status, 200);
    const c = await A.c.wait((m) => m.op === S2C.CHAT && m.channel === CHANNEL.SYSTEM);
    assert.equal(c.text, 'Tối nay có pháo hoa ở Nhà hát!'); assert.equal(c.from, 0); assert.equal(c.msgRef, br.json.ref);
    assert.equal((await admin(s, 'POST', '/admin/api/restart', { seconds: 120 })).status, 200);
    const rs = await A.c.wait((m) => m.op === S2C.SYSTEM && m.code === SYS.RESTART_IN);
    assert.equal(rs.arg, 120);
    s.app.get('sessions').get(A.account.id).playSeconds = 3600;
    A.c.chat('dạo này mình hay nghĩ tới chuyện tự tử');
    const own = await A.c.op(S2C.CHAT);
    assert.ok(own.msgRef > 0);
    const sup = await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.SUPPORT_LINE);
    assert.ok(sup);
    // the filter queued it for the owner (report source 'filter'), with the server-side context
    await sleep(200);
    const rep = await s.app.db.one(`SELECT source, chat_ref, context FROM reports WHERE target_id = $1`, [A.account.id]);
    assert.equal(rep.source, 'filter'); assert.equal(Number(rep.chat_ref), own.msgRef);
  } finally { await s.app.stop(); }
});
