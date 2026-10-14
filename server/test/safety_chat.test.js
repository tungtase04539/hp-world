// S3 — chat service: rate / slow mode / duplicates / masking / blocking / strikes / mute ladder / shadow / reports with
// server-side context / blocks / purge / msgRef persistence. PGlite (in memory) via the real boot.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestServer } from './helpers/client.mjs';
import { makeAccount, fakeClock, recordingBus, session } from './helpers/safety.mjs';
import { createChat, POLICY } from '../src/chat/index.js';
import { CHANNEL, CHAT_CODE, REPORT_CODE, REPORT_REASON } from '../../js/shared/protocol.js';

let s, db;
before(async () => { s = await bootTestServer({ TRANSPORT: 'ws', ...(process.env.TEST_DB_URL ? { DB_URL: process.env.TEST_DB_URL } : {}) }); db = s.app.db; });
after(async () => { await s.app.stop('test'); });

async function fresh(extra = {}) {
  const now = fakeClock(Date.now());
  const bus = recordingBus();
  const sent = [];
  const alerts = { enabled: true, send: async (k, t) => { sent.push({ k, t }); return true; } };
  const chat = createChat({ db, now, bus, alerts, ...extra });
  await chat.init();
  return { chat, now, bus, sent };
}

test('handle: channel, empty, too long, delivery, flood / caps cleanup, masking keeps the original for the owner', async () => {
  const { chat, now } = await fresh();
  const a = await makeAccount(db, 'An#0001');
  const S = session(a, 'An#0001');
  assert.equal((await chat.handle(S, CHANNEL.SYSTEM, 'xin chào')).code, CHAT_CODE.CHANNEL);
  assert.equal((await chat.handle({}, CHANNEL.SAY, 'xin chào')).ok, false);
  assert.equal((await chat.handle(S, CHANNEL.SAY, '   ')).code, CHAT_CODE.EMPTY);
  assert.equal((await chat.handle(S, CHANNEL.SAY, 'a'.repeat(141))).code, CHAT_CODE.TOO_LONG);
  const ok = await chat.handle(S, CHANNEL.SAY, '  xin   chào  cả nhà  ');
  assert.equal(ok.ok, true); assert.equal(ok.deliverText, 'xin chào cả nhà'); assert.equal(ok.shadow, false);
  assert.ok(ok.ref > 0); assert.equal(ok.code, CHAT_CODE.OK);
  now.advance(3000);
  const fl = await chat.handle(S, CHANNEL.SAY, 'HAAAAAAAAAY QUÁ ĐI MỌI NGƯỜI');
  assert.equal(fl.deliverText, 'haaay quá đi mọi người');
  now.advance(3000);
  const mk = await chat.handle(S, CHANNEL.SAY, 'đẹp vl luôn');
  assert.equal(mk.ok, true); assert.equal(mk.deliverText, 'đẹp *** luôn');
  const line = chat.recent({ since: 0 }).find((l) => l.ref === mk.ref);
  assert.equal(line.action, 'mask'); assert.equal(line.raw, 'đẹp vl luôn');
  await chat.flush();
  const row = await db.one('SELECT text, raw, action FROM chat_log WHERE ref = $1', [mk.ref]);
  assert.deepEqual(row, { text: 'đẹp *** luôn', raw: 'đẹp vl luôn', action: 'mask' });
});

test('rate 1 / 2 s burst 3; slow mode 1 / 5 s for new accounts; exact / near duplicates within 30 s', async () => {
  const { chat, now } = await fresh();
  const a = await makeAccount(db);
  const S = session(a, 'Binh#0002');
  for (const t of ['đi ăn bánh mì không', 'trời hôm nay đẹp quá', 'ai ở quảng trường thế']) assert.equal((await chat.handle(S, CHANNEL.SAY, t)).ok, true);
  const r = await chat.handle(S, CHANNEL.SAY, 'câu thứ tư');
  assert.equal(r.code, CHAT_CODE.RATE); assert.ok(r.retryAfterMs > 1500 && r.retryAfterMs <= 2000, String(r.retryAfterMs));
  now.advance(2000);
  assert.equal((await chat.handle(S, CHANNEL.SAY, 'câu thứ tư')).ok, true);
  // slow mode
  const b = await makeAccount(db);
  const N = session(b, 'Moi#0003', { playSeconds: 120 });
  assert.equal((await chat.handle(N, CHANNEL.SAY, 'chào mọi người')).ok, true);
  const sm = await chat.handle(N, CHANNEL.SAY, 'mình mới vào');
  assert.equal(sm.code, CHAT_CODE.SLOW_MODE); assert.ok(sm.retryAfterMs > 4000 && sm.retryAfterMs <= 5000);
  now.advance(5000);
  assert.equal((await chat.handle(N, CHANNEL.SAY, 'mình mới vào')).ok, true);
  // duplicates (exact, near, case / accents) — and short lines only exact
  const c = await makeAccount(db);
  const D = session(c, 'Dup#0004');
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'ai đi ăn bánh đa cua không')).ok, true);
  now.advance(2500);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'ai đi ăn bánh đa cua không')).code, CHAT_CODE.DUPLICATE);
  now.advance(2500);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'AI DI AN BANH DA CUA KHONG!!')).code, CHAT_CODE.DUPLICATE);
  now.advance(2500);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'ai đi ăn bánh đa cuaa khong')).code, CHAT_CODE.DUPLICATE);   // Levenshtein ≤ 2
  now.advance(2500);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'ok')).ok, true);
  now.advance(2500);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'oke')).ok, true);
  now.advance(31_000);
  assert.equal((await chat.handle(D, CHANNEL.SAY, 'ai đi ăn bánh đa cua không')).ok, true);
});

test('blocked lines: rejected, logged for the owner, strikes → automatic mute (ladder 10 min → 1 h → 24 h → shadow 7 d)', async () => {
  const { chat, now, bus, sent } = await fresh();
  const a = await makeAccount(db, 'Xau#0005');
  const S = session(a, 'Xau#0005');
  const r = await chat.handle(S, CHANNEL.SAY, 'đ.m mày');
  assert.equal(r.ok, false); assert.equal(r.code, CHAT_CODE.BLOCKED); assert.equal(r.reason, 'blocked');
  assert.equal(chat.recent().at(-1).action, 'block');
  // 4 more strong lines (2 s apart) → 5 strikes → mute 10 min
  for (const t of ['lồn', 'cặc', 'địt', 'buồi']) { now.advance(2100); await chat.handle(S, CHANNEL.SAY, t); }
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(chat.isMuted(a), true);
  const ev = bus.of('sanction').at(-1);
  assert.equal(ev.kind, 'mute'); assert.equal(ev.seconds, 600); assert.equal(ev.source, 'auto_filter'); assert.equal(ev.accountId, a);
  assert.ok(sent.some((x) => x.k === 'automute'));
  now.advance(1000);
  const m = await chat.handle(S, CHANNEL.SAY, 'xin lỗi');
  assert.equal(m.code, CHAT_CODE.MUTED); assert.ok(m.retryAfterMs > 590_000 && m.retryAfterMs <= 600_000);
  // ladder: next automatic sanctions escalate
  const s2 = await chat.autoSanction(a, 'auto_filter', 'test');
  assert.equal(s2.kind, 'mute'); assert.equal(s2.seconds, 3600);
  const s3 = await chat.autoSanction(a, 'auto_filter', 'test');
  assert.equal(s3.kind, 'mute'); assert.equal(s3.seconds, 86400);
  // fixer round 1 (SEC-2/SO-5): reports alone never reach the shadow step — a 24 h mute at most
  const r4 = await chat.autoSanction(a, 'auto_report', 'test');
  assert.equal(r4.kind, 'mute'); assert.equal(r4.seconds, 86400);
  const s4 = await chat.autoSanction(a, 'auto_filter', 'test');
  assert.equal(s4.kind, 'shadow'); assert.equal(s4.seconds, 7 * 86400);
  const rows = (await db.query('SELECT kind, source FROM sanctions WHERE account_id = $1 ORDER BY id', [a])).rows;
  assert.deepEqual(rows.map((x) => x.kind), ['mute', 'mute', 'mute', 'mute', 'shadow']);
  assert.equal(POLICY.LADDER.length, 4);
});

test('shadow-mute: the sender sees own lines (shadow=true), nobody else; revoke restores', async () => {
  const { chat, bus } = await fresh();
  const a = await makeAccount(db);
  const S = session(a, 'Bong#0006');
  const sh = await chat.sanction({ accountId: a, kind: 'shadow', ms: 3600_000, reason: 'test' });
  const r = await chat.handle(S, CHANNEL.SAY, 'xin chào mọi người');
  assert.equal(r.ok, true); assert.equal(r.shadow, true);
  assert.equal(chat.recent().at(-1).shadow, true);
  assert.equal(chat.isMuted(a), false);
  assert.ok(chat.sanctionOf(a).shadow > Date.now());
  await chat.revokeSanction(sh.id, 'test');
  assert.equal(chat.sanctionOf(a).shadow, 0);
  assert.equal(bus.of('sanction').at(-1).revoked, true);
  // ban + permanent mute
  await chat.sanction({ accountId: a, kind: 'ban', ms: null });
  assert.equal(chat.isBanned(a), true);
  assert.equal((await db.one('SELECT status FROM accounts WHERE id = $1', [a])).status, 'banned');
  assert.equal(chat.sanctionOf(a).ban, null);   // null = permanent
  assert.equal((await chat.handle(S, CHANNEL.SAY, 'alo')).reason, 'banned');
});

const PHRASES = ['xin chào mọi người', 'đi đâu đấy bạn', 'trời nóng quá đi', 'ăn bánh đa cua chưa', 'nhà hát lớn đẹp ghê', 'chợ sắt đông người', 'mưa to rồi kìa', 'lên xe đi nào', 'cầu này dài thật', 'ra biển chơi không', 'mình đói bụng quá', 'hôm nay vui ghê', 'đợi mình tí nhé', 'chạy nhanh lên nào', 'cái ô tô màu đỏ', 'tối nay có pháo hoa', 'đứng yên ở đó', 'quay lại đây đi', 'chụp ảnh đẹp chưa', 'gió thổi mạnh ghê', 'đường này tắc quá', 'mua kem cho mình', 'nhanh lên muộn rồi', 'ai biết đường ra ga', 'con mèo dễ thương', 'nước biển mát lạnh', 'phố đi bộ đông vui', 'hoa phượng nở rồi', 'bến phà ở đâu nhỉ', 'chúc ngủ ngon nhé'];
test('reports: codes, server-side 20-line context around chatRef, 3 distinct reporters → auto-mute, alerts', async () => {
  const { chat, now, bus, sent } = await fresh();
  const target = await makeAccount(db, 'Phien#0007');
  const reps = [await makeAccount(db, 'R1#0001'), await makeAccount(db, 'R2#0002'), await makeAccount(db, 'R3#0003')];
  const far = await makeAccount(db, 'Xa#0009');
  // trusted reporters (fixer round 1): accounts ≥ 1 day old with ≥ 30 min of play
  await db.query(`UPDATE accounts SET created_at = now() - interval '2 days' WHERE id = ANY($1::uuid[])`, [reps]);
  const T = session(target, 'Phien#0007', { x: 100, z: 100 });
  const F = session(far, 'Xa#0009', { x: 900, z: 900 });
  const R = reps.map((id, i) => session(id, `R${i + 1}#000${i + 1}`, { x: 105, z: 100 }));
  let badRef = 0;
  for (let i = 0; i < 30; i++) {
    now.advance(2100);
    const who = i % 3 === 0 ? T : i % 3 === 1 ? R[0] : F;
    const res = await chat.handle(who, CHANNEL.SAY, PHRASES[i]);
    if (i === 15) badRef = res.ref;
  }
  assert.equal((await chat.report(R[0], target, REPORT_REASON.HARASSMENT, badRef)).code, REPORT_CODE.OK);
  const rep = await db.one(`SELECT * FROM reports WHERE source = 'player' AND target_id = $1 ORDER BY id DESC LIMIT 1`, [target]);
  assert.ok(rep.context.length <= 20 && rep.context.length >= 10, String(rep.context.length));
  assert.ok(rep.context.every((l) => l.accountId !== far), 'far-away player is not in the context');
  assert.ok(rep.context.some((l) => l.mark && l.ref === badRef));
  assert.ok(rep.context.some((l) => l.who === 'target') && rep.context.some((l) => l.who === 'reporter'));
  assert.equal(rep.target_name, 'Phien#0007');
  assert.equal(bus.of('report:new').length, 1);
  assert.ok(sent.some((x) => x.k === 'report'));
  // codes
  assert.equal((await chat.report(R[0], target, 1, 0)).code, REPORT_CODE.RATE);
  now.advance(11_000);
  assert.equal((await chat.report(R[0], target, 1, 0)).code, REPORT_CODE.DUPLICATE);
  assert.equal((await chat.report(R[1], reps[1], 1, 0)).code, REPORT_CODE.SELF);
  assert.equal((await chat.report(R[1], 'nope', 1, 0)).code, REPORT_CODE.UNKNOWN_TARGET);
  now.advance(11_000);
  assert.equal((await chat.report(R[1], '00000000-0000-4000-8000-000000000000', 1, 0)).code, REPORT_CODE.UNKNOWN_TARGET);
  // 2nd and 3rd distinct reporter → automatic mute 10 min
  now.advance(11_000);
  assert.equal((await chat.report(R[2], target, 99 /* unknown reason → OTHER */, 0)).code, REPORT_CODE.OK);
  assert.equal(chat.isMuted(target), false);
  const otherId = await makeAccount(db, 'R4#0004');
  await db.query(`UPDATE accounts SET created_at = now() - interval '2 days' WHERE id = $1`, [otherId]);
  const other = session(otherId, 'R4#0004', { x: 110, z: 95 });   // stood near the target, saw its lines
  assert.equal((await chat.report(other, target, REPORT_REASON.SPAM, 0)).code, REPORT_CODE.OK);
  assert.equal(chat.isMuted(target), true);
  const ev = bus.of('sanction').at(-1);
  assert.equal(ev.source, 'auto_report'); assert.equal(ev.seconds, 600);
  assert.equal((await db.one(`SELECT reason FROM reports WHERE reporter_id = $1`, [reps[2]])).reason, REPORT_REASON.OTHER);
});

test('filter flags: personal-info probing and self-harm are delivered AND queued; self-harm asks for the support line', async () => {
  const { chat, now, sent } = await fresh();
  const a = await makeAccount(db, 'Hoi#0010');
  const S = session(a, 'Hoi#0010');
  const p = await chat.handle(S, CHANNEL.SAY, 'em bao nhiêu tuổi');
  assert.equal(p.ok, true); assert.equal(p.flagged, true); assert.equal(p.support, false);
  now.advance(2100);
  const h = await chat.handle(S, CHANNEL.SAY, 'mình muốn tự tử');
  assert.equal(h.ok, true); assert.equal(h.support, true);
  await new Promise((res) => setTimeout(res, 50));
  const rows = (await db.query(`SELECT source, detail, context FROM reports WHERE target_id = $1 ORDER BY id`, [a])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, 'filter'); assert.match(rows[0].detail, /personal_info/); assert.match(rows[1].detail, /self_harm/);
  assert.ok(rows[1].context.length >= 1);
  assert.ok(sent.some((x) => x.k === 'selfharm'));
  // hate is blocked AND queued
  now.advance(2100);
  const hate = await chat.handle(S, CHANNEL.SAY, 'bọn parky');
  assert.equal(hate.ok, false); assert.equal(hate.flagged, true);
});

test('blocks / mutes between players; nickname check; purge after 30 days; msgRef survives a restart', async () => {
  const { chat } = await fresh();
  const a = await makeAccount(db), b = await makeAccount(db), c = await makeAccount(db);
  assert.equal(chat.blocks(a), null);
  assert.deepEqual(await chat.setBlock(a, b, true, 'block'), { ok: true });
  assert.deepEqual(await chat.setBlock(a, c, true, 'mute'), { ok: true });
  assert.equal((await chat.setBlock(a, a, true)).ok, false);
  await chat.loadAccount(a); await chat.loadAccount(b); await chat.loadAccount(c);
  assert.ok(chat.blocks(a).has(b) && chat.blocks(a).has(c));
  assert.ok(chat.blocks(b).has(a), 'block is two-way');
  assert.ok(!chat.blocks(c).has(a), 'mute is one-way');
  await chat.setBlock(a, b, false);
  assert.ok(!chat.blocks(a).has(b) && !chat.blocks(b).has(a));
  assert.equal((await chat.listBlocks(a)).length, 1);
  chat.forget(a);
  assert.equal(chat.blocks(a), null);

  assert.deepEqual(chat.nicknameCheck('Tùng Hải Phòng'), { ok: true, reason: null });
  assert.equal(chat.nicknameCheck('Admin').reason, 'reserved');

  await db.query(`INSERT INTO chat_log (ref, at, account_id, text, action) VALUES (1, now() - interval '31 days', $1, 'cũ', 'pass'), (2, now() - interval '29 days', $1, 'mới', 'pass')`, [a]);
  const n = await chat.purge(30);
  assert.ok(n >= 1);
  assert.equal((await db.one(`SELECT count(*)::int AS n FROM chat_log WHERE account_id = $1`, [a])).n, 1);

  const S = session(a, 'Ref#0011');
  const r1 = await chat.handle(S, CHANNEL.SAY, 'dòng cuối trước khi khởi động lại');
  await chat.flush();
  const again = createChat({ db });
  await again.init();
  const r2 = await again.handle(session(b, 'Ref#0012'), CHANNEL.SAY, 'dòng đầu sau khi khởi động lại');
  assert.ok(r2.ref > r1.ref, `${r2.ref} > ${r1.ref}`);
});

test('service registered by the real server: chat + alerts, filter lists audited at load', async () => {
  const chat = s.app.get('chat');
  assert.equal(typeof chat.handle, 'function');
  assert.equal(typeof chat.report, 'function');
  assert.equal(s.app.get('alerts').enabled, false);
  const audit = await db.one(`SELECT action, ok, files FROM filter_audit ORDER BY id LIMIT 1`);
  assert.equal(audit.action, 'load'); assert.equal(audit.ok, true);
  assert.ok(audit.files.profanity.lines > 10);
  assert.ok(s.app.has('invites'));
});
