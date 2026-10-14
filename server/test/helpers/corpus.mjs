// Chat filter corpus evaluation (server/test/fixtures/chat_ok.txt + chat_bad.txt). Used by safety_filter.test.js and
// runnable by hand: `node server/test/helpers/corpus.mjs` prints precision / recall and every miss.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeChat } from '../../../js/shared/textfilter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, '..', 'fixtures');

const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

export function readCorpus() {
  const lines = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'));
  const ok = lines('chat_ok.txt').map((l) => unescape(l.trim()));
  const bad = lines('chat_bad.txt').map((l) => {
    const tab = l.indexOf('\t');
    return { expect: l.slice(0, tab).trim(), text: unescape(l.slice(tab + 1)) };
  });
  return { ok, bad };
}

// caught = the outcome required by the line's tag
export function caught(expect, r) {
  if (expect === 'block') return r.action === 'block';
  if (expect === 'mask') return r.action === 'mask' || r.action === 'block';
  if (expect === 'flag') return r.flag || r.action === 'block';
  return false;
}

export function evaluate() {
  const { ok, bad } = readCorpus();
  const okFails = [];
  for (const t of ok) {
    const r = analyzeChat(t);
    if (r.action !== 'pass') okFails.push({ text: t, action: r.action, reasons: r.reasons, hits: r.hits.map((h) => h.term) });
  }
  const badMisses = [];
  let tp = 0;
  const byExpect = {};
  for (const b of bad) {
    const r = analyzeChat(b.text);
    const c = caught(b.expect, r);
    byExpect[b.expect] = byExpect[b.expect] || { n: 0, caught: 0 };
    byExpect[b.expect].n++;
    if (c) { tp++; byExpect[b.expect].caught++; } else badMisses.push({ expect: b.expect, text: b.text, action: r.action, reasons: r.reasons });
  }
  // precision over the whole corpus: of everything the filter acted on, how much was really bad
  const fp = okFails.length;
  const actedOnBad = bad.filter((b) => analyzeChat(b.text).action !== 'pass').length;
  return {
    okTotal: ok.length, okPass: ok.length - fp, okPassRate: (ok.length - fp) / ok.length,
    badTotal: bad.length, badCaught: tp, recall: tp / bad.length,
    precision: actedOnBad / (actedOnBad + fp), byExpect, okFails, badMisses,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const r = evaluate();
  console.log(`ok lines: ${r.okPass}/${r.okTotal} pass (${(r.okPassRate * 100).toFixed(2)} %)`);
  console.log(`bad lines: ${r.badCaught}/${r.badTotal} caught (recall ${(r.recall * 100).toFixed(2)} %), precision ${(r.precision * 100).toFixed(2)} %`);
  for (const [k, v] of Object.entries(r.byExpect)) console.log(`  ${k}: ${v.caught}/${v.n}`);
  for (const f of r.okFails) console.log('FALSE POSITIVE', JSON.stringify(f.text), f.action, f.reasons.join(','), f.hits.join(' | '));
  for (const m of r.badMisses) console.log('MISS', m.expect, JSON.stringify(m.text), '→', m.action, m.reasons.join(','));
}
