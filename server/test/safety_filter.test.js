// S3 — Vietnamese chat filter (js/shared/textfilter.js): corpus precision / recall, speed, detectors, nicknames, lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluate, readCorpus } from './helpers/corpus.mjs';
import { analyzeChat, filterChat, checkNickname, normalize, setLists, getLists, listsVersion, FILTER_VERSION } from '../../js/shared/textfilter.js';
import { readFilterDir, LIST_FILES, DEFAULT_FILTER_DIR } from '../src/chat/lists.js';
import { syncedSource } from '../scripts/filter_sync.mjs';

test('corpus: ≥ 99 % of ordinary lines pass, ≥ 95 % of abusive / evasive lines caught', (t) => {
  const r = evaluate();
  t.diagnostic(`ok ${r.okPass}/${r.okTotal} pass (${(r.okPassRate * 100).toFixed(2)} %), bad ${r.badCaught}/${r.badTotal} caught ` +
    `(recall ${(r.recall * 100).toFixed(2)} %), precision ${(r.precision * 100).toFixed(2)} %`);
  for (const [k, v] of Object.entries(r.byExpect)) t.diagnostic(`  ${k}: ${v.caught}/${v.n}`);
  for (const f of r.okFails) t.diagnostic(`FALSE POSITIVE ${JSON.stringify(f.text)} → ${f.action} ${f.reasons}`);
  for (const m of r.badMisses) t.diagnostic(`MISS (${m.expect}) ${JSON.stringify(m.text)} → ${m.action}`);
  assert.ok(r.okTotal >= 300, 'chat_ok.txt needs ≥ 300 lines');
  assert.ok(r.badTotal >= 200, 'chat_bad.txt needs ≥ 200 lines');
  assert.ok(r.okPassRate >= 0.99, `ok pass rate ${r.okPassRate}`);
  assert.ok(r.recall >= 0.95, `recall ${r.recall}`);
});

test('speed: < 1 ms per message (p99), deterministic', () => {
  const { ok, bad } = readCorpus();
  const all = [...ok, ...bad.map((b) => b.text)];
  for (const s of all) analyzeChat(s);   // warm-up
  const times = [];
  for (let rep = 0; rep < 5; rep++) {
    for (const s of all) {
      const t0 = performance.now();
      analyzeChat(s);
      times.push(performance.now() - t0);
    }
  }
  // worst case: 140 chars of evasive junk
  const junk = 'đ.m c ặ c l0n d1t m3 m4y vcl zalo 09 12 34 56 78 abc chấm com @x_y '.repeat(3).slice(0, 140);
  for (let i = 0; i < 200; i++) { const t0 = performance.now(); analyzeChat(junk); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  assert.ok(p99 < 1, `p99 ${p99.toFixed(3)} ms`);
  assert.ok(mean < 0.3, `mean ${mean.toFixed(3)} ms`);
  for (const s of all.slice(0, 100)) assert.deepEqual(analyzeChat(s), analyzeChat(s));
});

test('filterChat keeps the foundation API shape; analyzeChat adds flag / support / hits', () => {
  const r = filterChat('xin chào');
  assert.deepEqual(Object.keys(r).sort(), ['action', 'ok', 'reasons', 'text']);
  assert.equal(typeof FILTER_VERSION, 'number');
  const a = analyzeChat('tao muốn chết');
  assert.equal(a.action, 'flag'); assert.equal(a.ok, true); assert.equal(a.flag, true); assert.equal(a.support, true);
  assert.ok(a.reasons.includes('self_harm'));
  const s = analyzeChat('bạn bao nhiêu tuổi');
  assert.equal(s.action, 'flag'); assert.equal(s.support, false);
  assert.ok(Array.isArray(a.hits) && a.hits[0].reason === 'self_harm');
});

test('display cleanup: invisible chars, char-flood, caps-flood, masking', () => {
  assert.equal(normalize('a​​b  \n c\u0000d'), 'ab c d');
  assert.equal(normalize('Hà'), 'Hà');
  const f = filterChat('haaaaaaaaay quá!!!!!!!');
  assert.equal(f.text, 'haaay quá!!!'); assert.equal(f.action, 'pass');
  const c = filterChat('ĐI ĐÂU THẾ MỌI NGƯỜI ƠI');
  assert.equal(c.text, 'đi đâu thế mọi người ơi');
  assert.ok(c.reasons.includes('caps'));
  assert.equal(filterChat('OK HP').text, 'OK HP');   // short acronyms stay
  const m = filterChat('đẹp vl luôn');
  assert.equal(m.action, 'mask'); assert.equal(m.text, 'đẹp *** luôn');
  const m2 = filterChat('đéo biết');
  assert.equal(m2.action, 'mask'); assert.ok(!m2.text.includes('đéo'));
  assert.equal(filterChat('').reasons[0], 'empty');
  assert.equal(filterChat('a'.repeat(141)).reasons[0], 'too_long');
  assert.equal(filterChat('á'.repeat(140)).ok, true);   // 140 code points after NFC
});

test('detectors: urls, phones, handles', () => {
  const blocked = (s, reason) => {
    const r = analyzeChat(s);
    assert.equal(r.action, 'block', s);
    if (reason) assert.ok(r.reasons.includes(reason), `${s} → ${r.reasons}`);
  };
  for (const s of ['abc.com', 'vào abc . vn', 'web chấm com', 'abc (.) net', 'https://x.y', 'www.abc', 'a b c . c o m', 'bit.ly/x', 'mail a@b.vn']) blocked(s, 'url');
  for (const s of ['0912345678', '0912 345 678', '+84 912 345 678', '09.12.34.56.78', 'không chín một hai ba bốn năm sáu bảy tám', 'o9i2 345 678']) blocked(s, 'phone');
  for (const s of ['@ten_toi', 'zalo 12345', 'add zalo nhé', 'fb: ten.toi', 'ib mess mình', 'follow tiktok mình']) blocked(s, 'handle');
  // not phones / urls / handles
  for (const s of ['giá 125.000.000 đồng', 'từ 19:00 đến 22:00 ngày 15/10/2026', 'không không không không không không không không không',
    'ăn cơm. cơm ngon', 'đi ăn. com ngon', 'xem tiktok vui ghê', 'mình không có fb', '1.000.000 đồng', 'lúc 9h30 nhé', 'email ở đâu nhỉ']) {
    assert.equal(analyzeChat(s).action, 'pass', s);
  }
});

test('accent awareness: same bare letters, different words', () => {
  const pass = ['các bạn ơi', 'buổi sáng', 'con lợn', 'lớn rồi', 'đi chơi', 'đeo kính', 'ngủ ngon', 'điểm mười', 'phố cổ', 'đồ cho em', 'dụ dỗ', 'đít bé'];
  for (const s of pass) assert.equal(analyzeChat(s).action, 'pass', s);
  const block = ['cặc', 'buồi', 'lồn', 'đĩ', 'địt', 'đụ', 'mày ăn cac à', 'kặc', 'c4c', 'c.a.c', 'c a c', 'c*c', 'c​ac'];
  for (const s of block) assert.equal(analyzeChat(s).action, 'block', s);
  assert.equal(analyzeChat('đéo').action, 'mask');
  assert.equal(analyzeChat('deo').action, 'pass');           // bare "deo" alone: could be "đeo"
  assert.equal(analyzeChat('deo biet').action, 'mask');      // phrase context
});

test('nicknames: length, chars, reserved, brands, profanity, contact', () => {
  const n = checkNickname;
  assert.deepEqual(n('Tùng Hải Phòng'), { ok: true, reason: null });
  for (const ok of ['Linh', 'Đức Anh', 'Hai_Phong_99', 'Bí Đỏ', 'Nguyễn Văn A', 'Hải.Phòng', 'Gmail Fan', 'Devil99', 'Cáo Tô']) assert.equal(n(ok).ok, true, ok);
  assert.equal(n('ab').reason, 'length');
  assert.equal(n('x'.repeat(17)).reason, 'length');
  for (const s of ['bad<script>', 'Аdmin' /* Cyrillic А */, '__abc', 'ab__cd', '1234', 'ab.']) assert.equal(n(s).ok, false, s);
  for (const s of ['Admin', 'admin123', '4dm1n', 'GM_Tung', 'Mod 1', 'Quản Trị', 'quan_tri', 'He thong 1', 'TheAdmin99', 'Hệ Thống', 'Chủ Server']) assert.equal(n(s).reason, 'reserved', s);
  assert.equal(n('VIETTEL').reason, 'brand');
  for (const s of ['Cac To', 'L0n Me', 'ditmemay', 'Dit Me', 'Do Cho Ma', 'Lồn', 'vcl123']) assert.equal(n(s).reason, 'profanity', s);
  assert.equal(n('Zalo 0912345').ok, false);
  assert.equal(n('hp0912345678').ok, false);
});

test('lists: embedded defaults equal server/data/filter/*.txt; setLists reload changes behaviour and version', () => {
  const { lists, missing } = readFilterDir();
  assert.deepEqual(missing, []);
  for (const k of LIST_FILES) assert.ok(lists[k].length > 0, k);
  const src = fs.readFileSync(path.resolve(DEFAULT_FILTER_DIR, '..', '..', '..', 'js', 'shared', 'textfilter.js'), 'utf8');
  assert.equal(syncedSource(src, lists), src, 'run: node server/scripts/filter_sync.mjs');
  const before = getLists();
  const v0 = listsVersion();
  assert.equal(analyzeChat('bánh tráng trộn').action, 'pass');
  try {
    const v1 = setLists({ mild: before.mild + '\nbánh tráng\n' });
    assert.notEqual(v1, v0);
    assert.equal(analyzeChat('bánh tráng trộn').action, 'mask');
    setLists({ reserved: ['admin', 'bot ma'] });
    assert.equal(checkNickname('Bot Ma').reason, 'reserved');
  } finally {
    setLists(before);
  }
  assert.equal(listsVersion(), v0);
  assert.equal(analyzeChat('bánh tráng trộn').action, 'pass');
});
