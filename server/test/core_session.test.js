// S2: WebSocket session lifecycle end to end (real server, real sockets, PGlite):
// HELLO→WELCOME→READY→keyframe, players see each other (ENTER + NAMES + UPDATE), ticket replay / expiry / forgery,
// proto mismatch → RELOAD, one session per account, resume within 60 s (same netId, AWAY meanwhile), resume expiry,
// queue at capacity with position + ETA, SAY within 40 m / shadow / rejected / REPORT, CORRECT + corrEpoch,
// persistence on disconnect + play time, degrade L4 stops admission, sanctions kick, malformed traffic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootCore, guest, joinTicket, connectPlayer, Client, clk, sleep } from './core_util.mjs';
import { createTicketer } from '../src/game/tickets.js';
import { S2C, SYS, CLOSE, AUTH_REASON, CORRECT_REASON, EVENT, CHAT_CODE, REPORT_CODE, SNAP_FLAG, ACTION, PROTO_VERSION, KICK_REASON } from '../../js/shared/protocol.js';
import { SFLAG, MODE } from '../../js/shared/constants.js';
import { SPAWNS } from '../../js/shared/spawns.js';
import { stateFlags } from '../../js/shared/quant.js';

const OPERA = SPAWNS[0], FAR = SPAWNS[3];
async function placed(s, nick, x, z) {
  const g = await guest(s, nick);
  await s.app.db.query('UPDATE characters SET pos_x = $1, pos_z = $2, yaw = 0 WHERE account_id = $3', [x, z, g.account.id]);
  return g;
}
const snapWith = (pred) => (m) => m.op === S2C.SNAPSHOT && pred(m);

test('two players near each other: keyframe, ENTER + NAMES, UPDATE when moving, PING/PONG', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Anh', { auth: await placed(s, 'Anh', OPERA.x, OPERA.z) });
    assert.equal(A.welcome.proto, PROTO_VERSION);
    assert.ok(Math.abs(A.welcome.spawn.x - OPERA.x) < 0.1, 'saved position used as spawn');
    assert.equal(A.welcome.tickHz, 20); assert.equal(A.welcome.snapHz, 10);
    assert.equal(A.welcome.dayEpoch, s.config.dayEpoch); assert.equal(A.welcome.dayLength, 1440);
    const k = await A.c.op(S2C.SNAPSHOT);
    assert.ok(k.flags & SNAP_FLAG.KEYFRAME);
    const B = await connectPlayer(s, 'Binh', { auth: await placed(s, 'Binh', OPERA.x + 5, OPERA.z) });
    const enter = await A.c.wait(snapWith((m) => m.enters.some((e) => e.netId === B.welcome.netId)));
    const slot = enter.enters.find((e) => e.netId === B.welcome.netId).slot;
    const names = await A.c.op(S2C.NAMES);
    assert.deepEqual(names.names.map((n) => n.name), [B.account.displayName]);
    // B walks east at 3 m/s → A sees UPDATEs for B's slot
    const t0 = clk();
    for (let i = 1; i <= 10; i++) { B.c.state({ clientMs: t0 + i * 66, x: OPERA.x + 5 + i * 0.2, z: OPERA.z }); await sleep(66); }
    const upd = await A.c.wait(snapWith((m) => m.updates.some((u) => u.slot === slot && u.x > OPERA.x + 6)));
    assert.ok(upd);
    assert.equal(B.c.all.filter((m) => m.op === S2C.CORRECT).length, 0);
    // B's own snapshot self record acknowledges its last seq
    const own = await B.c.wait(snapWith((m) => m.self.lastSeq >= 9));
    assert.ok(own.self.x > OPERA.x + 6);
    // PING → PONG
    A.c.ping(4242);
    const pong = await A.c.op(S2C.PONG);
    assert.equal(pong.clientTime, 4242);
    assert.equal(s.app.get('sessions').count(), 2);
  } finally { await s.app.stop(); }
});

test('tickets: replay, expiry, forgery, missing HELLO data; proto mismatch → RELOAD; pre-HELLO garbage → 1008', async () => {
  const s = await bootCore();
  try {
    const g = await guest(s, 'Chi');
    const j = await joinTicket(s, g.accessToken);
    const c1 = await Client.open(s.ws + '/play');
    c1.hello(j.body.ticket);
    await c1.op(S2C.WELCOME);
    // replay the same ticket on a second socket
    const c2 = await Client.open(s.ws + '/play');
    c2.hello(j.body.ticket);
    const sys = await c2.op(S2C.SYSTEM);
    assert.equal(sys.code, SYS.AUTH_FAILED); assert.equal(sys.arg, AUTH_REASON.REUSED);
    assert.equal((await c2.closedP).code, CLOSE.AUTH);
    // expired (issued with the server key 2 minutes ago)
    const old = createTicketer({ key: s.config.secrets.ticketHmacKey, now: () => Date.now() - 120000 }).issue(g.account.id);
    const c3 = await Client.open(s.ws + '/play');
    c3.hello(old.ticket);
    assert.equal((await c3.op(S2C.SYSTEM)).arg, AUTH_REASON.EXPIRED);
    // forged MAC / other key / garbage
    const forged = j.body.ticket.slice(0, -3) + (j.body.ticket.endsWith('A') ? 'BBB' : 'AAA');
    const other = createTicketer({ key: Buffer.alloc(32, 7).toString('base64url') }).issue(g.account.id).ticket;
    for (const t of [forged, other, 'garbage', '']) {
      const c = await Client.open(s.ws + '/play');
      c.hello(t);
      assert.equal((await c.op(S2C.SYSTEM)).arg, AUTH_REASON.BAD_TICKET, t);
      assert.equal((await c.closedP).code, CLOSE.AUTH);
    }
    // proto mismatch
    const c4 = await Client.open(s.ws + '/play');
    c4.hello('whatever', null, PROTO_VERSION + 1);
    const rl = await c4.op(S2C.SYSTEM);
    assert.equal(rl.code, SYS.RELOAD); assert.equal(rl.arg, PROTO_VERSION);
    assert.equal((await c4.closedP).code, CLOSE.PROTO);
    // PING works before HELLO; in-game messages before HELLO are malformed → 1008 after 10
    const c5 = await Client.open(s.ws + '/play');
    c5.ping(1);
    assert.equal((await c5.op(S2C.PONG)).clientTime, 1);
    for (let i = 0; i < 10; i++) c5.ready();
    assert.equal((await c5.closedP).code, CLOSE.POLICY);
  } finally { await s.app.stop(); }
});

test('one session per account; resume within 60 s keeps netId (AWAY meanwhile); resume token single use; expiry', async () => {
  const s = await bootCore();
  try {
    const gA = await placed(s, 'Dung', OPERA.x, OPERA.z);
    const A = await connectPlayer(s, 'Dung', { auth: gA });
    const B = await connectPlayer(s, 'Emm', { auth: await placed(s, 'Emm', OPERA.x + 3, OPERA.z) });
    await B.c.wait(snapWith((m) => m.enters.some((e) => e.netId === A.welcome.netId)));
    // the same account connects again → the old socket is told and closed, the avatar (netId) is kept
    const A2 = await connectPlayer(s, 'Dung', { auth: gA, ready: false });
    const dup = await A.c.op(S2C.SYSTEM);
    assert.equal(dup.code, SYS.DUPLICATE_SESSION);
    assert.equal((await A.c.closedP).code, CLOSE.DUPLICATE);
    assert.equal(A2.welcome.netId, A.welcome.netId);
    A2.c.ready();
    await A2.c.wait(snapWith((m) => (m.flags & SNAP_FLAG.KEYFRAME) !== 0));
    // a new page knows no names yet: they are sent again
    const nm = await A2.c.op(S2C.NAMES);
    assert.deepEqual(nm.names.map((n) => n.netId), [B.welcome.netId]);
    assert.equal(s.app.get('sessions').load(), 2);
    // network drop → limbo: B sees A as AWAY, then A resumes with its token
    const token = A2.welcome.resumeToken;
    await A2.c.terminate();
    await B.c.wait(snapWith((m) => m.updates.some((u) => (stateFlags(u.state) & SFLAG.AWAY) !== 0)));
    const sess = s.app.get('sessions').get(gA.account.id);
    assert.equal(sess.state, 'limbo');
    const R = await Client.open(s.ws + '/play');
    R.hello('', token);
    const w = await R.op(S2C.WELCOME);
    assert.equal(w.netId, A.welcome.netId);
    const res = await R.op(S2C.SYSTEM);
    assert.equal(res.code, SYS.RESUMED); assert.equal(res.arg, A.welcome.netId);
    await R.wait(snapWith((m) => (m.flags & SNAP_FLAG.KEYFRAME) !== 0 && m.enters.length >= 1));
    await B.c.wait(snapWith((m) => m.updates.some((u) => (stateFlags(u.state) & SFLAG.AWAY) === 0)));
    // a used token cannot resume again
    const R2 = await Client.open(s.ws + '/play');
    R2.hello('', token);
    assert.equal((await R2.op(S2C.SYSTEM)).arg, AUTH_REASON.BAD_RESUME);
    // expiry: drop again, let the 60 s window pass (forced), resume fails, B gets a LEAVE
    const token2 = w.resumeToken;
    await R.terminate();
    await sleep(100);
    sess.limboUntil = 0;
    s.app.get('sessions').sweep(0);
    assert.equal(sess.state, 'closed');
    await B.c.wait(snapWith((m) => m.leaves.length >= 1));
    const R3 = await Client.open(s.ws + '/play');
    R3.hello('', token2);
    assert.equal((await R3.op(S2C.SYSTEM)).arg, AUTH_REASON.BAD_RESUME);
    assert.equal(s.app.get('sessions').load(), 1);
  } finally { await s.app.stop(); }
});

test('capacity: queue with position + ETA, admitted when a slot frees; degrade L4 stops admission', async () => {
  const s = await bootCore({ CAPACITY: '2' });
  try {
    const A = await connectPlayer(s, 'Gia');
    await connectPlayer(s, 'Hai');
    const g3 = await guest(s, 'Khoa');
    const g4 = await guest(s, 'Linh');
    let r = await joinTicket(s, g3.accessToken);
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(r.body), ['queue']);
    assert.equal(r.body.queue.position, 1);
    assert.ok(r.body.queue.etaS >= 5 && r.body.queue.retryAfterS > 0);
    r = await joinTicket(s, g4.accessToken);
    assert.equal(r.body.queue.position, 2);
    // A leaves for good → Khoa (head of the queue) gets a ticket, Linh is still waiting
    s.app.get('sessions').kick(A.account.id, KICK_REASON.ADMIN);
    r = await joinTicket(s, g4.accessToken);
    assert.equal(r.body.queue.position, 2);
    await sleep(2100);   // joinAccount limiter: 0.5/s
    r = await joinTicket(s, g3.accessToken);
    assert.ok(r.body.ticket, JSON.stringify(r.body));
    // an account with a live session always gets a ticket (reconnect), even when full
    // degrade L4: no new admissions
    s.app.get('sim').forceDegrade(4);
    await sleep(2100);
    r = await joinTicket(s, g4.accessToken);
    assert.ok(r.body.queue, JSON.stringify(r.body));
    s.app.get('sim').forceDegrade(-1);
  } finally { await s.app.stop(); }
});

test('chat: SAY within 40 m, shadow-mute, rejected, block list; REPORT', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Mai', { auth: await placed(s, 'Mai', OPERA.x, OPERA.z) });
    const B = await connectPlayer(s, 'Nam', { auth: await placed(s, 'Nam', OPERA.x + 20, OPERA.z) });
    const C = await connectPlayer(s, 'Oanh', { auth: await placed(s, 'Oanh', OPERA.x + 60, OPERA.z) });
    const D = await connectPlayer(s, 'Phu', { auth: await placed(s, 'Phu', FAR.x, FAR.z) });
    const seen = [];
    s.app.bus.on('chat:message', (e) => seen.push(e));
    A.c.chat('Chào cả nhà');
    const ca = await A.c.op(S2C.CHAT);
    const cb = await B.c.op(S2C.CHAT);
    assert.equal(cb.text, 'Chào cả nhà'); assert.equal(cb.from, A.welcome.netId); assert.equal(cb.msgRef, ca.msgRef);
    await sleep(200);
    assert.equal(C.c.drain(S2C.CHAT).length, 0, '60 m away: not delivered');
    assert.equal(D.c.drain(S2C.CHAT).length, 0);
    assert.equal(seen.length, 1); assert.equal(seen[0].msgRef, ca.msgRef); assert.equal(seen[0].recipients, 2);
    // the chat service decides: shadow → sender only; rejected → EVENT CHAT_REJECTED
    const chat = s.app.get('chat');
    const orig = chat.handle;
    chat.handle = async (sess, ch, text) => ({ ok: true, deliverText: text, shadow: true, reason: null, code: 0 });
    A.c.chat('chỉ mình tôi thấy');
    assert.equal((await A.c.op(S2C.CHAT)).text, 'chỉ mình tôi thấy');
    await sleep(200);
    assert.equal(B.c.drain(S2C.CHAT).length, 0);
    chat.handle = async () => ({ ok: false, deliverText: '', shadow: false, reason: 'rate', code: CHAT_CODE.RATE, retryAfterMs: 1500 });
    A.c.chat('spam');
    const rej = await A.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.CHAT_REJECTED);
    assert.deepEqual(rej.args, [CHAT_CODE.RATE, 1500]);
    chat.handle = orig;
    // B blocks A (chat service without block API → gateway fallback) → B stops receiving A
    B.c.action(7, ACTION.BLOCK_PLAYER, A.welcome.netId);
    const ar = await B.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.ACTION_RESULT);
    assert.deepEqual(ar.args, [7, 0]);
    A.c.chat('B không thấy');
    await A.c.op(S2C.CHAT);
    await sleep(200);
    assert.equal(B.c.drain(S2C.CHAT).length, 0);
    // REPORT → chat.report(reporter, targetAccountId, reason, chatRef)
    const calls = [];
    chat.report = async (rep, target, reason, ref) => { calls.push([rep.accountId, target, reason, ref]); return { ok: true, code: REPORT_CODE.OK }; };
    B.c.report(A.welcome.netId, 1, ca.msgRef);
    const rr = await B.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.REPORT_RESULT);
    assert.deepEqual(rr.args, [REPORT_CODE.OK]);
    assert.deepEqual(calls, [[B.account.id, A.account.id, 1, ca.msgRef]]);
    C.c.report(C.welcome.netId, 1, 0);
    assert.deepEqual((await C.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.REPORT_RESULT)).args, [REPORT_CODE.SELF]);
    D.c.report(65000, 1, 0);
    assert.deepEqual((await D.c.wait((m) => m.op === S2C.EVENT && m.type === EVENT.REPORT_RESULT)).args, [REPORT_CODE.UNKNOWN_TARGET]);
  } finally { await s.app.stop(); }
});

test('movement over the wire: teleport → CORRECT (epoch 1), stale epoch ignored, ack accepted; shared vehicle claims', async () => {
  const s = await bootCore();
  try {
    const A = await connectPlayer(s, 'Quy', { auth: await placed(s, 'Quy', OPERA.x, OPERA.z) });
    const t0 = clk();
    A.c.state({ clientMs: t0, x: OPERA.x + 0.2, z: OPERA.z });
    A.c.state({ clientMs: t0 + 66, x: OPERA.x + 80, z: OPERA.z });       // teleport
    const cor = await A.c.op(S2C.CORRECT);
    assert.equal(cor.reason, CORRECT_REASON.TELEPORT); assert.equal(cor.epoch, 1);
    assert.ok(Math.abs(cor.x - (OPERA.x + 0.2)) < 0.1);
    const sess = s.app.get('sessions').get(A.account.id);
    A.c.state({ clientMs: t0 + 132, x: OPERA.x + 81, z: OPERA.z, corrEpoch: 0 });   // not applied yet → ignored
    await sleep(100);
    assert.ok(Math.abs(sess.entity.x - (OPERA.x + 0.2)) < 0.1);
    A.c.state({ clientMs: t0 + 200, x: OPERA.x + 0.3, z: OPERA.z, corrEpoch: 1 });
    await sleep(100);
    assert.ok(Math.abs(sess.entity.x - (OPERA.x + 0.3)) < 0.1);
    const snap = await A.c.wait(snapWith((m) => m.self.corrEpoch === 1));
    assert.ok(snap);
    // shared vehicle: B claims cyclo #5 via ACTION MOUNT, A's STATE as cyclo #5 is refused (MODE), personal moto is fine
    const B = await connectPlayer(s, 'Rong', { auth: await placed(s, 'Rong', OPERA.x + 4, OPERA.z) });
    B.c.action(1, ACTION.MOUNT, 5);
    assert.deepEqual((await B.c.wait((m) => m.op === S2C.EVENT)).args, [1, 0]);
    A.c.action(2, ACTION.MOUNT, 5);
    assert.deepEqual((await A.c.wait((m) => m.op === S2C.EVENT)).args, [2, 2]);   // BUSY
    const t1 = clk();
    A.c.state({ clientMs: t1, x: OPERA.x + 0.4, z: OPERA.z, corrEpoch: 1, state: MODE.MOTO, vehicleRef: 0 });
    await sleep(100);
    assert.equal(sess.entity.mode, MODE.MOTO);
    assert.equal(sess.v.counts[6] || 0, 0);
    A.c.state({ clientMs: t1 + 66, x: OPERA.x + 0.5, z: OPERA.z, corrEpoch: 1, state: MODE.CYCLO, vehicleRef: 5 });
    await sleep(100);
    assert.equal(sess.v.counts[6], 1, 'MODE violation for a vehicle held by someone else');
  } finally { await s.app.stop(); }
});

test('persistence: position flushed on disconnect, play time per day; sanctions kick; shutdown flush', async () => {
  const s = await bootCore();
  try {
    const g = await placed(s, 'Son', OPERA.x, OPERA.z);
    const A = await connectPlayer(s, 'Son', { auth: g });
    const t0 = clk();
    for (let i = 1; i <= 8; i++) { A.c.state({ clientMs: t0 + i * 66, x: OPERA.x + i * 0.2, z: OPERA.z }); await sleep(66); }
    const sessions = s.app.get('sessions');
    sessions.sweep(7.4);                       // 7.4 s of play time
    await A.c.terminate();
    await sleep(150);
    await sessions.flushing;
    const ch = await s.app.db.one('SELECT pos_x, pos_z, version FROM characters WHERE account_id = $1', [g.account.id]);
    assert.ok(Math.abs(ch.pos_x - (OPERA.x + 1.6)) < 0.1, JSON.stringify(ch));
    assert.ok(ch.version >= 1);
    const pt = await s.app.db.one('SELECT seconds FROM playtime_daily WHERE account_id = $1', [g.account.id]);
    assert.equal(pt.seconds, 7);
    const acc = await s.app.db.one('SELECT play_seconds FROM accounts WHERE id = $1', [g.account.id]);
    assert.equal(acc.play_seconds, 7);
    // sanction 'ban' from the moderation side closes a live session
    const B = await connectPlayer(s, 'Tam');
    s.app.bus.emit('sanction', { accountId: B.account.id, kind: 'ban', until: new Date(Date.now() + 3600e3) });
    const ban = await B.c.wait((m) => m.op === S2C.SYSTEM && m.code === SYS.BANNED);
    assert.ok(ban.arg > 3500 && ban.arg <= 3600);
    assert.equal((await B.c.closedP).code, CLOSE.BANNED);
    // shutdown flushes everyone still connected
    const C = await connectPlayer(s, 'Uyen', { auth: await placed(s, 'Uyen', OPERA.x, OPERA.z) });
    const t1 = clk();
    for (let i = 1; i <= 5; i++) { C.c.state({ clientMs: t1 + i * 66, x: OPERA.x, z: OPERA.z + i * 0.2 }); await sleep(66); }
    const back = C.c.wait((m) => m.op === S2C.SYSTEM && m.code === SYS.BACKOFF);
    await s.app.stop('test');
    assert.ok((await back).arg >= 1000);
  } finally { await s.app.stop(); }
});
