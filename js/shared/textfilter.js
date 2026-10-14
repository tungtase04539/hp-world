// js/shared/textfilter.js — Vietnamese chat / nickname filter. Same code on client and server. Pure ESM.
//
// STATUS: FOUNDATION STUB. The API below is FINAL (S3 replaces the implementation, keeps the signatures):
//
//   filterChat(text, opts?) → { ok, text, action, reasons }
//     ok       boolean   true when the message may be delivered (action 'pass' | 'mask' | 'flag')
//     text     string    normalised (NFC, trimmed, collapsed whitespace) and, for 'mask', masked text to deliver
//     action   'pass' | 'mask' | 'block' | 'flag'   ('flag' = deliver, but queue for the owner)
//     reasons  string[]  machine codes, e.g. 'empty', 'too_long', 'control', 'url', 'phone', 'profanity', 'self_harm'
//     opts     { maxChars?: number (default CHAT.MAX_CHARS) }
//
//   checkNickname(name) → { ok, reason }      reason: null | 'length' | 'chars' | 'reserved' | 'brand' | 'profanity'
//
//   normalize(text) → string                   NFC + strip zero-width/control + collapse whitespace + trim
//   FILTER_VERSION                             bumped by S3 whenever lists/rules change (client/server can compare)
//
// Word lists (S3): server/data/filter/*.txt, loaded by the server and pushed with setLists(); the client uses the
// built-in defaults. setLists() is optional for callers.
import { CHAT, NICK } from './constants.js';
import { isBrand } from '../brands.js';

export const FILTER_VERSION = 0;

// zero-width, bidi controls, BOM, C0/C1 controls except none (newlines are collapsed to spaces)
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/g;

const HAS_INVISIBLE = new RegExp(INVISIBLE.source);

export function normalize(text) {
  return String(text ?? '').normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

const RESERVED = ['admin', 'administrator', 'gm', 'mod', 'moderator', 'quan tri', 'quản trị', 'he thong', 'hệ thống',
  'chu server', 'chủ server', 'system', 'server', 'staff'];

let lists = { reserved: RESERVED };

// S3: replace word lists at runtime (server reload without restart). Unknown keys are kept for the S3 implementation.
export function setLists(next) { lists = { ...lists, ...next }; }

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

export function filterChat(text, opts = {}) {
  const maxChars = opts.maxChars ?? CHAT.MAX_CHARS;
  const raw = String(text ?? '');
  const t = normalize(raw);
  const reasons = [];
  if (!t) return { ok: false, text: '', action: 'block', reasons: ['empty'] };
  if ([...t].length > maxChars) return { ok: false, text: t, action: 'block', reasons: ['too_long'] };
  if (HAS_INVISIBLE.test(raw)) reasons.push('control');
  return { ok: true, text: t, action: 'pass', reasons };
}

export function checkNickname(name) {
  const t = normalize(name);
  const len = [...t].length;
  if (len < NICK.MIN || len > NICK.MAX) return { ok: false, reason: 'length' };
  // letters (any script incl. Vietnamese), digits, space, _ . -
  if (!/^[\p{L}\p{M}\p{N} _.\-]+$/u.test(t)) return { ok: false, reason: 'chars' };
  const s = strip(t).replace(/[\s_.\-]+/g, ' ').trim();
  for (const r of lists.reserved || []) {
    const rr = strip(r);
    if (s === rr || s.startsWith(rr + ' ') || s.replace(/ /g, '') === rr.replace(/ /g, '')) return { ok: false, reason: 'reserved' };
  }
  if (isBrand(t) || isBrand(t.toUpperCase())) return { ok: false, reason: 'brand' };
  return { ok: true, reason: null };
}
