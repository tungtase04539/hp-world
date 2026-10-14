// chat/lists.js — load the owner-editable filter word lists (server/data/filter/*.txt) and push them into
// js/shared/textfilter.js with setLists(). Also used by server/scripts/filter_sync.mjs (embeds the same lists into the
// browser copy of textfilter.js) and by the safety tests.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const LIST_FILES = ['profanity', 'mild', 'sexual', 'hate', 'scam', 'probe', 'selfharm', 'allow', 'ambiguous', 'reserved'];
export const DEFAULT_FILTER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'filter');

// → { lists: {key: text}, files: {key: {bytes, lines, sha256}}, missing: [key] }
export function readFilterDir(dir = DEFAULT_FILTER_DIR) {
  const lists = {}, files = {}, missing = [];
  for (const k of LIST_FILES) {
    const p = path.join(dir, k + '.txt');
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { missing.push(k); continue; }
    text = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
    lists[k] = text;
    const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
    files[k] = { bytes: Buffer.byteLength(text), lines, sha256: crypto.createHash('sha256').update(text).digest('hex').slice(0, 16) };
  }
  return { lists, files, missing };
}

// the JS source block embedded in js/shared/textfilter.js between the BEGIN/END markers
export function renderDefaultListsBlock(lists) {
  const body = LIST_FILES.filter((k) => lists[k] !== undefined).map((k) => `  ${k}: ${JSON.stringify(lists[k])},`).join('\n');
  return `const DEFAULT_LISTS = {\n${body}\n};`;
}
