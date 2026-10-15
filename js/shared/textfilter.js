// js/shared/textfilter.js — Vietnamese chat / nickname filter (S3). Same code on client, server and bots. Pure ESM,
// no DOM, no three. Deterministic, < 1 ms per message (measured in server/test/safety_filter.test.js).
//
// PUBLIC API (final, server/CONTRACT.md §4):
//   filterChat(text, opts?) → { ok, text, action, reasons }
//     ok       true when the message may be delivered (action 'pass' | 'mask' | 'flag')
//     text     normalised display text (NFC, invisible chars removed, whitespace collapsed, char-flood collapsed,
//              caps-flood lowered) and, for 'mask', with the offending words replaced by '*'
//     action   'pass' | 'mask' | 'block' | 'flag'   ('flag' = deliver, but queue for the owner)
//     reasons  machine codes: empty, too_long, control, url, phone, handle, profanity, profanity_mild, sexual, hate,
//              scam, personal_info, self_harm, mixed_script, evasion, flag (= also queue for the owner when action is
//              'mask'), caps, flood
//     opts     { maxChars?: number (default CHAT.MAX_CHARS) }
//   analyzeChat(text, opts?) → filterChat's fields + { flag, support, hits: [{reason, term}] }   (server uses this)
//   checkNickname(name) → { ok, reason }   reason: null | length | chars | reserved | brand | profanity | contact
//   normalize(text) → NFC + invisible chars removed + controls → space + collapsed whitespace + trim
//   setLists({ profanity, mild, sexual, hate, scam, probe, selfharm, allow, ambiguous, reserved })  each value: an
//     array of lines or one text blob in the server/data/filter/*.txt syntax. Missing keys keep their current list.
//   getLists() → current raw lists; listsVersion() → short hash of the active lists; FILTER_VERSION (rules version).
//
// HOW IT MATCHES (details + list syntax: docs/multiplayer/SERVER.md §3 and server/data/filter/README.txt)
//   1. Display text: normalize → collapse runs of ≥ 4 identical chars to 3 → lower-case when ≥ 70 % of ≥ 8 letters are
//      capitals. Spans of masked words refer to this text.
//   2. Tokens: every code point is folded (NFKC per char: full-width / math letters → ASCII; lower-case; Cyrillic /
//      Greek look-alikes → Latin). Inside a word, separators (. - _ * ' etc.) are dropped ("đ.m", "d-i-t"), leet chars
//      become letters ("l0n", "đ!t", "c@c"), and runs of single letters are joined ("đ m", "c ặ c"). Each token keeps
//      base (no diacritics, canonical spelling j→i y→i k→c z→d ph→f), its quality marks (ă â ê ô ơ ư đ) and its
//      tone marks, and an `evasive` bit (any trick above was used).
//   3. Patterns: a pattern token written WITHOUT diacritics matches any accents ("dm", "vcl"). A pattern token WITH
//      diacritics ("cặc") matches the same accents exactly; a token with explicitly different accents ("các") never
//      matches. A token without accents ("cac") is ambiguous when the bare form is also an innocent word (ambiguous.txt):
//      then it matches only inside a multi-word pattern, when the token is evasive, or when the rest of the message is
//      typed with accents (≥ 50 % of words) and the bare form itself is not an innocent word. Repeated letters are
//      ignored ("điiiit"), but a doubled pattern letter needs ≥ 2 ("cc"). allow.txt phrases cancel any hit inside them.
//   4. Detectors in code: URLs / domains (also "chấm com", "(.)", spaced letters), e-mail, phone / account numbers
//      (VN formats, separators, digits written as words "không chín một …"), social handles ("@name", platform name +
//      id or contact verb).
import { CHAT, NICK } from './constants.js';
import { isBrand, brandWatchHit } from '../brands.js';

export const FILTER_VERSION = 1;

// ---- character classes ----------------------------------------------------------------------------------------------
// removed entirely (zero-width, joiners, bidi controls, BOM, soft hyphen, Hangul fillers, tag chars, CGJ, Mongolian VS)
const ZW_RE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0e\ufeff\uffa0]|\udb40[\udc00-\udc7f]/g;
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const ZW_INSIDE = /[\p{L}\p{N}][­͏​-‏⁠-⁤﻿]+[.\-_*]?[­͏​-‏⁠-⁤﻿]*[\p{L}\p{N}]/u;
const HAS_HIDDEN =/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]|\udb40[\udc00-\udc7f]/;

export function normalize(text) {
  return String(text ?? '').normalize('NFC').replace(ZW_RE, '').replace(CTRL_RE, ' ').replace(/\s+/g, ' ').trim();
}

// Cyrillic / Greek / Latin-extended look-alikes → Latin (lower-case input)
const CONFUSE = {
  'а': 'a', 'б': 'b', 'в': 'b', 'г': 'r', 'д': 'd', 'е': 'e', 'ё': 'e', 'з': '3', 'и': 'u', 'й': 'u', 'к': 'k', 'л': 'n',
  'м': 'm', 'н': 'h', 'о': 'o', 'п': 'n', 'р': 'p', 'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ц': 'u', 'ш': 'w', 'щ': 'w',
  'ь': 'b', 'ъ': 'b', 'і': 'i', 'ї': 'i', 'ј': 'j', 'ѕ': 's', 'ԁ': 'd', 'һ': 'h', 'ӏ': 'l', 'ԛ': 'q', 'ԝ': 'w', 'ү': 'y',
  'α': 'a', 'β': 'b', 'γ': 'y', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'n', 'θ': 'o', 'ι': 'i', 'κ': 'k', 'μ': 'u', 'ν': 'v',
  'ο': 'o', 'π': 'n', 'ρ': 'p', 'σ': 'o', 'ς': 's', 'τ': 't', 'υ': 'u', 'χ': 'x', 'ω': 'w',
  'ı': 'i', 'ł': 'l', 'ø': 'o', 'ɑ': 'a', 'ɩ': 'i', 'ɡ': 'g', 'ʟ': 'l', 'ɴ': 'n', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe',
};
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i', '€': 'e', '¡': 'i' };
const JOINER = new Set(['.', ',', '-', '_', '*', "'", '"', '`', '~', '^', '+', '=', '/', '\\', ':', ';', '#', '(', ')', '[', ']', '{', '}', '<', '>', '·', '•', '…', '’', '‘', '“', '”', '-', '–', '—', '%', '&', '?']);
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const ASCII_LETTER = /[a-z]/;

// per-code-point fold: NFKC (full-width / math letters), lower-case, look-alikes → Latin. Returns {s, conf}
const foldCache = new Map();
function fold(ch) {
  let r = foldCache.get(ch);
  if (r) return r;
  let s = ch.normalize('NFKC').toLowerCase();
  let conf = false;
  if (s.length && CONFUSE[s] !== undefined) { s = CONFUSE[s]; conf = true; }
  else if (s !== ch.toLowerCase() && ch.charCodeAt(0) > 0x7f) conf = /[a-z0-9]/.test(s);   // full-width / styled letters
  r = { s, conf };
  if (foldCache.size < 4096) foldCache.set(ch, r);
  return r;
}

// tone marks (5) and quality marks of Vietnamese after NFD
const TONE = { '\u0300': 'f', '\u0301': 's', '\u0303': 'x', '\u0309': 'r', '\u0323': 'j' };
const QUAL = new Set(['\u0302', '\u0306', '\u031b']);

const collapse1 = (s) => s.replace(/(.)\1+/gu, '$1');
// canonical spelling for matching (applied identically to patterns and messages). Not ck→ch: 'dick' vs 'dịch'.
function canon(s) {
  return s.replace(/ph/g, 'f').replace(/j/g, 'i').replace(/y/g, 'i').replace(/k(?=[aeiouăâêôơư])/g, 'c').replace(/z/g, 'd');
}
// non-standard Vietnamese spelling = evidence of deliberate respelling (k before a/o/u, j, z, f, w)
const NONSTD = /k(?=[aăâoôơuư])|[jzfw]/;

// analyse one word (lower-case NFC, Latin letters + marks) → {acc, base, key, qual, qkey, tones, hasTone, hasQual, nonstd}
function analyzeWord(acc) {
  const d = acc.normalize('NFD');
  let base = '', qual = '', tones = '';
  for (const ch of d) {
    const t = TONE[ch];
    if (t) { tones += t; continue; }
    if (QUAL.has(ch)) { qual += ch; continue; }
    if (ch === 'đ') { base += 'd'; qual += 'đ'; continue; }
    if (MARK.test(ch)) continue;
    base += ch; qual += ch;
  }
  qual = qual.normalize('NFC');
  const hasQual = qual !== base;
  const nonstd = NONSTD.test(base);
  const cb = canon(base);
  const cq = canon(qual);
  return { acc, base: cb, key: collapse1(cb), qual: cq, qkey: collapse1(cq), tones: collapse1(tones), hasTone: tones.length > 0, hasQual, nonstd };
}

// run-length aware equality: same letters, and every run in the token is at least as long as in the pattern
function rleCover(tok, pat) {
  let i = 0, j = 0;
  while (i < tok.length && j < pat.length) {
    if (tok[i] !== pat[j]) return false;
    const c = tok[i];
    let a = 0, b = 0;
    while (i < tok.length && tok[i] === c) { i++; a++; }
    while (j < pat.length && pat[j] === c) { j++; b++; }
    if (a < b) return false;
  }
  return i === tok.length && j === pat.length;
}

// ---- display cleanup ------------------------------------------------------------------------------------------------
function cleanDisplay(t, reasons) {
  let s = t.replace(/(.)\1{3,}/gu, '$1$1$1');
  if (s !== t) reasons.push('flood');
  let up = 0, letters = 0;
  for (const ch of s) {
    if (!LETTER.test(ch)) continue;
    letters++;
    if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) up++;
  }
  if (letters >= 8 && up / letters >= 0.7) { s = s.toLowerCase(); reasons.push('caps'); }
  return s;
}

// ---- tokenizer ------------------------------------------------------------------------------------------------------
// tokens: { ...analyzeWord, start, end (UTF-16 indices into the display text), evasive, star, conf, single, word }
// word=false for tokens without letters (numbers / symbols); they still break phrase adjacency.
function tokenize(display) {
  const raw = [];
  let cur = null;
  const flush = () => { if (cur) { raw.push(cur); cur = null; } };
  for (let i = 0; i < display.length;) {
    const cp = display.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const n = ch.length;
    if (/\s/.test(ch)) { flush(); i += n; continue; }
    const f = fold(ch);
    const s = f.s;
    let cls;
    if (!s) { i += n; continue; }
    const c0 = s[0];
    if (LETTER.test(c0) || MARK.test(c0)) cls = 'L';
    else if (c0 >= '0' && c0 <= '9') cls = 'D';
    else if (LEET[c0] !== undefined) cls = 'S';
    else if (JOINER.has(c0)) cls = 'P';
    else cls = 'X';   // emoji, CJK punctuation, … → boundary
    if (cls === 'X') { flush(); i += n; continue; }
    if (!cur) cur = { units: [], start: i, end: i };
    cur.units.push({ s, cls, conf: f.conf, at: i, len: n });
    cur.end = i + n;
    i += n;
  }
  flush();
  const toks = [];
  for (const r of raw) {
    const u = r.units;
    // trim leading / trailing non-letters that are not leet (punctuation around a word)
    let a = 0, b = u.length;
    const isWordish = (x, k) => x.cls === 'L' || x.cls === 'D' || (x.cls === 'S' && hasLetterNear(u, k));
    while (a < b && !isWordish(u[a], a)) a++;
    while (b > a && !isWordish(u[b - 1], b - 1)) b--;
    if (a >= b) continue;
    const hasLetter = u.slice(a, b).some((x) => x.cls === 'L');
    let acc = '', evasive = false, conf = false, star = false;
    for (let k = a; k < b; k++) {
      const x = u[k];
      if (x.conf) conf = true;
      if (x.cls === 'L') acc += x.s;
      else if (x.cls === 'D') {
        if (hasLetter && LEET[x.s] !== undefined) { acc += LEET[x.s]; evasive = true; } else acc += x.s;
      } else if (x.cls === 'S') {
        if (hasLetter) { acc += LEET[x.s]; evasive = true; }
      } else if (x.cls === 'P') {
        if (x.s === '*' && hasLetter) { acc += '*'; star = true; evasive = true; } else if (hasLetter) evasive = true;
      }
    }
    if (!acc) continue;
    const start = u[a].at, end = u[b - 1].at + u[b - 1].len;
    const word = hasLetter;
    acc = acc.normalize('NFC');
    toks.push({ acc, start, end, evasive: evasive || conf, conf, star, word, letters: [...acc.replace(/\*/g, '')].length });
  }
  // join runs of single-letter tokens ("đ m", "c ặ c", "d i t m e"). The unjoined stream is kept too (out.split):
  // patterns that spell a one-letter pronoun ("nhà e ở đâu", "m ở quận nào") are matched against it as well
  // (fixer round 1, SO-6c: "e ở" used to be joined into one token "eở" and never matched).
  const out = [];
  let joinedAny = false;
  for (let i = 0; i < toks.length;) {
    if (toks[i].word && toks[i].letters === 1 && !toks[i].star) {
      let j = i;
      while (j + 1 < toks.length && toks[j + 1].word && toks[j + 1].letters === 1 && !toks[j + 1].star) j++;
      if (j > i) {
        let acc = '';
        for (let k = i; k <= j; k++) acc += toks[k].acc;
        out.push({ acc: acc.normalize('NFC'), start: toks[i].start, end: toks[j].end, evasive: true, conf: toks.slice(i, j + 1).some((t) => t.conf), star: false, word: true, joined: true });
        joinedAny = true;
        i = j + 1;
        continue;
      }
    }
    out.push(toks[i]);
    i++;
  }
  const fin = (arr) => {
    for (const t of arr) {
      if (t.base !== undefined) continue;
      t.raw = t.acc;   // keeps '*' for starMatch
      Object.assign(t, analyzeWord(t.acc.replace(/\*/g, '')));
      t.trick = !!t.evasive;   // leet / separators / look-alikes / spaced letters (not just a non-standard spelling)
      if (t.nonstd) t.evasive = true;
      t.marked = t.hasTone || t.hasQual;
    }
    return arr;
  };
  fin(out);
  out.split = joinedAny ? fin(toks.map((t) => ({ ...t }))) : null;
  return out;
}
function hasLetterNear(u, k) {
  return (k > 0 && (u[k - 1].cls === 'L' || u[k - 1].cls === 'D')) || (k + 1 < u.length && (u[k + 1].cls === 'L' || u[k + 1].cls === 'D'));
}

// ---- pattern compilation --------------------------------------------------------------------------------------------
// line syntax: tokens separated by spaces; a/b alternatives; _ = any one word; ~ = up to 2 words; leading * on a
// one-word ASCII pattern = also match inside longer unaccented words; optional "| action" (pass, mask, block, flag,
// blockflag) at the end. '#' starts a comment.
const CATS = {
  profanity: { action: 'block', reason: 'profanity' },
  mild: { action: 'mask', reason: 'profanity_mild' },
  sexual: { action: 'block', reason: 'sexual' },
  hate: { action: 'blockflag', reason: 'hate' },
  scam: { action: 'blockflag', reason: 'scam' },
  probe: { action: 'flag', reason: 'personal_info' },
  selfharm: { action: 'flag', reason: 'self_harm' },
};
const ACTIONS = new Set(['pass', 'mask', 'block', 'flag', 'blockflag']);

function patToken(w) {
  if (w === '_') return { any: 1, min: 1, max: 1 };
  if (w === '~') return { any: 1, min: 0, max: 2 };
  const alts = w.split('/').filter(Boolean).map((a) => {
    const strict = a.startsWith('=') && a.length > 1;   // '=ngu': exactly these accents (no tone mark)
    const acc = (strict ? a.slice(1) : a).toLowerCase().normalize('NFC');
    const r = analyzeWord(acc);
    r.marked = strict || r.hasTone || r.hasQual;
    return r;
  });
  return { alts };
}

function parseLines(src) {
  const lines = Array.isArray(src) ? src : String(src || '').split(/\r?\n/);
  const out = [];
  for (let raw of lines) {
    raw = String(raw);
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash);
    raw = raw.trim();
    if (raw) out.push(raw);
  }
  return out;
}

function compileList(cat, src, ambiguousKeys, strongKeys) {
  const def = CATS[cat];
  const pats = [];
  for (const line of parseLines(src)) {
    let body = line, action = def.action;
    const bar = line.lastIndexOf('|');
    if (bar > 0) {
      const a = line.slice(bar + 1).trim().toLowerCase();
      if (ACTIONS.has(a)) { action = a; body = line.slice(0, bar).trim(); }
    }
    let infix = false;
    if (body.startsWith('*') && !/\s/.test(body)) { infix = true; body = body.slice(1); }
    const words = body.normalize('NFC').split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const toks = words.map(patToken);
    if (toks[0].any) continue;   // a pattern may not start with a wildcard
    for (const t of toks) if (t.alts) for (const a of t.alts) { a.ambiguous = ambiguousKeys.has(a.key); a.strong = strongKeys.has(a.key); }
    const minLen = toks.reduce((n, t) => n + (t.any ? t.min : 1), 0);
    pats.push({ cat, reason: def.reason, action, toks, plen: minLen, infix: infix && toks.length === 1 ? toks[0].alts.map((a) => a.key) : null, term: body });
  }
  return pats;
}

// ---- default lists (generated from server/data/filter/*.txt by server/scripts/filter_sync.mjs — do not edit here) ---
// BEGIN DEFAULT LISTS
const DEFAULT_LISTS = {
  profanity: "# profanity.txt — từ tục nặng → CHẶN. Cú pháp: README.txt\n# --- từ đơn (có dấu: bản không dấu chỉ bị bắt khi có ngữ cảnh / viết lách)\nđịt\nđụ\nlồn\ncặc\nbuồi\nđĩ\nloz\nlìn\n# --- chữ tắt / teencode\ndm\nđmm\ndmm\ndcm\ndkm\ndcmm\ndmml\ncmm\ndmvl\n*ditme\n*ditmie\n*ditmia\n*ditmay\n*ditcon\n*ditbo\n*ditcu\n*dumama\n*dumame\n*dumemay\n*dumay\n*duma\n*dume\n*lonme\n*concac\n*cailon\n*vcl\n*vkl\n*dmm\n*dcm\n*dkm\n*cmm\n*dmvl\n*clgt\n# --- cụm\nđịt mẹ/má/bố/cha/mày/con/cụ/mợ/ông/bà/tổ/nhau\nđụ mẹ/má/mé/mày/nhau\nđờ mờ\nđê mờ\nmẹ mày/mầy\ncon mẹ mày/mầy\nmả mẹ/cha/bố\ntiên sư bố/cha/mày/nhà\nsư bố/cha mày\ntổ cha/sư mày\năn/bú/mút/liếm/sục cặc/buồi/lồn/cứt\nđầu/mặt/óc cặc/buồi/lồn\ncái lồn/cặc/buồi\nnhư lồn/cặc/buồi\ncon lồn/cặc/đĩ\nthằng/con/đồ lol\nđồ/con đĩ/điếm/phò/cave\ncon hoang\nmẹ cha mày\ncút mẹ/cha\nmày là chó\nmày là súc vật\nđồ súc vật\nsúc sinh\nđồ chó đẻ\nđéo/đếch/éo mẹ\nfuck\nfck\nfuk\n*fuck\nmotherfucker\nshit\nbitch\n*bitch\nasshole\ndick\ncunt\npussy\n# --- bổ sung vòng sửa 1 (kiểm thử lách lọc 15/10/2026)\nđù mạ\nđờ cờ mờ\nđê em em\nđê mê mày\nvler\nvờ lờ\ncak\nlừn\nđầu bùi\nbùi to\nfvck\nphắc diu\nphắc kiu\nbiatch\n",
  mild: "# mild.txt — chửi nhẹ → CHE bằng *** (tin vẫn gửi). Cú pháp: README.txt\n# \"=ngu\" = đúng chữ \"ngu\" không dấu thanh (không bắt \"ngủ\").\nđéo\nđéo biết/hiểu/cần/thèm/quan/có/phải/sợ/muốn/chơi/được/thích/care/nói/nghe/ai\nđếch\nđếu\ncứt\nvl\nvcl\nvkl\nvcđ\ncc\ncl\nclm\nclgt\ncmn\ndmcs\nvãi lồn/cứt/đái\nđù má/mé/me\nmẹ kiếp\ncon mẹ nó\nbố mày/mầy\nbố láo\ncha mày\nđồ chó\nthằng chó\nchó má\nđồ chó má\nóc chó\nóc lợn/bò\nnão chó/lợn/tàn\nđồ/thằng/con =ngu\n=ngu như bò/chó/lợn/heo\nmày/mầy =ngu\n=ngu vãi/vl/vcl/thế/thật\nđồ/thằng/con đần\nđồ/thằng/con khốn\nkhốn nạn\ncâm mồm/miệng\nim mồm\ncút đi\ncút xéo\nmất dạy\nvô học\nđồ rác rưởi\nđồ rác\nthiểu năng\nđồ điên\nthằng điên\nđồ thần kinh\nđồ dở hơi\nnhư lol\nstfu\nwtf\ndamn\n",
  sexual: "# sexual.txt — nội dung tình dục → CHẶN. Cú pháp: README.txt\nsex\nsếch\n*sex\nxxx\njav\nporn\n*porn\nporno\nhentai\nnude\nnudes\nhorny\nboobs\nblowjob\nphim sex/heo/nóng/khiêu\nphim người lớn\nphim cấp ba\nclip/ảnh/hình nóng/nude/sex/khỏa/khoả/lộ\nkhỏa/khoả thân\nlộ hàng\nshow hàng\nchịch\nxoạc nhau\nnện nhau\nlàm tình\nquan hệ tình dục\nquan hệ với anh/em/tao/tớ/mình\ntình dục\ndâm\ndâm dục\ndâm đãng\ndâm ô\nhiếp\nhiếp dâm\nthủ dâm\nthẩm du\nnứng\nnứng quá/vãi/thế/lắm/rồi/vl\nsục cu/cặc/buồi/lồn\nbú cu/vú/lồn/chim/cặc\nvú\nvếu\nbím\ntrym\ndương vật\nâm đạo\nâm vật\ntinh trùng\nxuất tinh\ncương cứng\nlỗ nhị\nhột le\ngái gọi\ngái bán dâm\nbán dâm\nmua dâm\nđi khách\ngạ tình\ngạ gẫm\nkích dục\nđồi trụy\nđồi truỵ\nsờ mó\nsờ ngực/vú/mông/đùi\ncởi đồ/quần/áo ~ cho anh/tao/tớ/mình/a xem\nngủ với anh/tao/tớ/mình/a\nlên giường với\ncho anh/tao/tớ sờ\n# --- bổ sung vòng sửa 1\nseggs\nxếch\nchịt nhau\nchịt em/anh/tao/mày\nảnh/hình nút\nxoạc\nthổi kèn\nnứn\nnứn quá/vãi/thế/lắm\n",
  hate: "# hate.txt — miệt thị vùng miền / dân tộc / giới / khuyết tật, đe doạ → CHẶN + hàng chờ. Cú pháp: README.txt\nparky\n*parky\nbắc kỳ/kì chó/rau/mọi\nbọn/lũ/thằng/con/đồ bắc/nam kỳ/kì\nnam kỳ/kì lúa/chó\nbọn/lũ/đồ/thằng 3/ba que\nba que xỏ lá\nbò đỏ\nđu càng\nkhựa\ntàu khựa\nchệt\nthằng/bọn/lũ ba tàu\nbọn/lũ/đồ/thằng mọi\nmọi rợ\nmọi đen\nbọn/lũ/đồ/thằng mán\nmường mán\nđồ/thằng/con người rừng\nnigga\nnigger\n*nigg\npê đê\nbê đê\nxăng pha nhớt\nthằng/đồ bóng\nđồ đồng bóng\nái nam ái nữ\nthằng/đồ què/mù/câm/điếc/tật\nđồ tật nguyền\nđồ/thằng/con tự kỷ/kỉ\nđồ/thằng/con thiểu năng\n# đe doạ\ngiết mày/mầy/m\ngiết chết mày/mầy\nđâm/chém/đập/đánh chết mày/mầy/m\ntao đánh/đâm/chém/đập mày/mầy/m\nđốt nhà mày/mầy\ntìm/biết nhà mày/mầy\nxử mày/mầy\ncho mày/mầy chết\nmày/mầy/m chết đi\nđi chết đi\nchết mẹ mày đi\nđặt bom\n# --- bổ sung vòng sửa 1\nbk chó\nba sọc\ngay lọ\nđồ/thằng/con/bọn ô môi\ndân _ toàn trộm/cướp/lừa/đảo\ndân _ _ toàn trộm/cướp/lừa/đảo\nmày/m toi rồi\n",
  scam: "# scam.txt — lừa đảo, mua bán tài khoản / tiền, cờ bạc → CHẶN + hàng chờ. Cú pháp: README.txt\n# (link, số điện thoại, số tài khoản dài, nick mạng xã hội đã bị chặn bằng mã)\nnạp thẻ/card/tiền/kc/xu/vàng\nnạp kim cương\nthẻ cào\nmua/bán/đổi thẻ cào/card\nkim cương miễn phí\nfree kim cương/kc/xu/vàng/tiền\nhack kc/tiền/xu/vàng/acc/nick\nhack kim cương\nhack tài khoản\ntool hack\nphần mềm hack\nbán/mua/đổi/thuê/mượn/share/trao acc/nick/tk/hack\nbán/mua/đổi/thuê/mượn/share tài khoản\ncho mượn acc/nick/tk\ncho mượn tài khoản\nacc vip\nchuyển khoản\nck trước\nck cho mình/tao/em/anh/tớ/t/m\nstk\nsố tài khoản\nsố tk\ncho/xin/gửi/đưa stk\nví điện tử\nchuyển/gửi/bắn tiền cho/qua | flag\nchuyển cho mình/tao/tớ/em/anh ~ tiền/nghìn/k/triệu/củ | flag\nđặt cọc\ncọc trước\nthanh toán trước\notp\nmã otp\nmã xác nhận\nmã xác thực\ncho/gửi/đưa/xin ~ pass/mk\ncho/gửi/đưa/xin ~ mật khẩu\nmật khẩu của bạn/cậu/em/anh/mày\ncho/gửi/đưa/xin ~ mã khôi phục\nmã khôi phục của bạn/cậu/em/anh/mày\nđăng nhập hộ/giúp\nbán/mua mã mời\ntrúng thưởng\nquà miễn phí\nlink nhận quà\nkiếm tiền online\nviệc nhẹ lương cao\nlàm việc tại nhà\nđầu tư sinh lời\nlãi suất\nvay tiền\ncho vay\nvay nóng\ntín dụng đen\ntài xỉu\ncá độ\nnhà cái\ncasino\ncờ bạc\nđánh bạc\nlô đề\nsoi cầu\nbao lô\nnổ hũ\nđổi thưởng\ncày thuê\ncày hộ\nbán vàng\nbán đồ game\ngiao dịch ngoài\nuy tín 100\ngiá rẻ uy tín\n# --- bổ sung vòng sửa 1 (số tiền giữa cụm: \"nạp 50k thẻ\")\nnạp ~ thẻ/card/kc/xu/vàng\nnạp ~ nhận\nfree ~ kc/xu/vàng\nfree ~ kim cương\nkim cương ~ free\nkim cương ~ miễn phí\nnhận kim cương\nnhận ~ kc free\nck ~ cho mình/tao/em/anh/tớ/t/m\nbank ~ cho mình/tao/em/anh/tớ\nbán/mua/đổi/thuê ních\nních vip\nđầu tư coin/crypto\nđầu tư tiền ảo\nkiếm ~ mỗi ngày tại nhà\nkiếm tiền ~ mỗi ngày\nmình/tao/tớ/em/anh/tôi là admin/gm/mod/qtv\nmình/tao/tớ/em/anh/tôi là quản trị\n",
  probe: "# probe.txt — dò hỏi thông tin riêng (tuổi, nhà, trường, ảnh, gặp ngoài) → VẪN GỬI + hàng chờ. Cú pháp: README.txt\nbao nhiêu tuổi\nmấy/nhiêu/bn/bnh tuổi\ntuổi con gì\nsinh năm bao/bn/mấy/nào\nhọc lớp mấy/nào/bn\nlớp mấy\nhọc trường nào/gì/đâu\nnhà ở đâu\nnhà bạn/em/cậu/mày/anh/chị/cháu/ông/bà/con/c/e/b/a/m/cô/chú ở đâu\nnhà ở chỗ/khu/phố/quận/phường nào\nsống ở đâu\nbạn/em/cậu/mày/c/e/b/anh/chị/m ở quận/phường/xã/ngõ/hẻm nào\nđịa chỉ nhà\nđịa chỉ của\nnhà số mấy\ngửi/xin/cho/send ~ ảnh/hình/pic/selfie\nảnh thật của\nxem ảnh thật\nmặt thật của\nchụp ảnh gửi\ngọi video\nvideo call\ncall video\ngặp ngoài\ngặp mặt ngoài đời\nhẹn gặp ngoài\ngặp nhau ngoài đời\nngoài đời gặp\nđi chơi riêng\nra ngoài gặp\nsố điện thoại\nsđt\nsdt\nxin số\ncho xin số\ntên thật là/của/bạn/em\ntên đầy đủ\nbố mẹ đi vắng\nở nhà một mình\nở một mình à/không/ko/hả\ncó ai ở nhà\ncó người yêu chưa\n# --- bổ sung vòng sửa 1 (dụ dỗ trẻ em)\ntrường ~ tên gì\nbố mẹ ~ có nhà không/ko/k\nở nhà 1 mình\nxem mặt em/e/bạn/cậu/con/cháu\nbật cam\nmở cam\nđừng nói với bố/mẹ\nđừng kể với bố/mẹ\nbí mật của ~ đứa mình\nbí mật giữa ~ mình\nxoá/xóa tin nhắn này\ncó ny chưa\nđi đường nào về\nđang mặc gì\nmặc gì đấy/thế/vậy\nanh/chú qua đón em/cháu\nra công viên gặp anh/chú\n",
  selfharm: "# selfharm.txt — tự hại → VẪN GỬI + hàng chờ + gửi người chơi lời nhắn đường dây hỗ trợ. Cú pháp: README.txt\ntự tử\ntự sát\ntự vẫn\ntự hại\ntự làm hại\ntao/tôi/mình/em/tớ/anh/t/m/e/chị/cháu muốn chết\nmuốn chết cho xong\nmuốn chết quá\nkhông/ko/k/chẳng/chả muốn sống\nkhông/ko/chẳng thiết sống\nchán sống\nsống làm gì\nsống để làm gì\ncắt/rạch/cứa tay\ncắt/rạch/cứa cổ tay\nnhảy lầu\nnhảy cầu tự tử\nnhảy sông\nuống thuốc ngủ/chuột/sâu\ntreo cổ\nkết thúc cuộc đời\nkết liễu\nmuốn biến mất\nkhông ai cần mình/tôi/em/tớ\nchết cho xong\nchết quách\nchết đi cho rồi\nkill myself\nkms\nsuicide\n# --- bổ sung vòng sửa 1 (một từ chen giữa: \"tớ chỉ muốn chết thôi\")\ntao/tôi/mình/em/tớ/anh/t/m/e/chị/cháu chỉ/thật/thực/rất/cũng/vẫn/đang/luôn muốn chết\ntao/tôi/mình/em/tớ/anh/t/m/e/chị/cháu thật/thực sự muốn chết\nmình/tôi/tao/em/tớ sẽ nhảy cầu/lầu/sông\nmuốn kết thúc tất cả\nlý/lí do để sống\nbiến mất là xong\n",
  allow: "# allow.txt — cụm từ vô hại hay bị bắt nhầm. Một mẫu bị bắt nằm GỌN trong cụm dưới đây thì được bỏ qua.\n# Viết CÓ DẤU (để bản có dấu tục như \"cặc\" không lọt qua); chữ không dấu ở đây chỉ khớp chữ không dấu.\nquả/hạt/bánh/sữa/dầu/bột/cây óc chó\ncon các bạn/em/anh/chị/cô/chú/bác/ông/bà/cháu/thành/người/nhà/con/cậu/bố/mẹ/cụ/vị\ncái lon/lớn/lợn bia/nước/sữa/này/kia/đó/ấy/của/to/nhỏ/rỗng/đất/con/nhất/hơn/lắm/quá\ncái buổi\nnhư các/buổi\nhẹn gặp lại\ncon lợn/lon\nđầu/cuối/mỗi/một/hai/ba buổi\nmất/đầu/mặt các\năn các món/loại/thứ/kiểu/đồ/bữa/quán/nơi/hàng/bạn/em/anh/chị\nbú các ngón\ncòn/con/đỗ/đó/độ điểm\ncòn/con phở/phố/phó\nmà mẹ/cha/bố/má/mày\nđồ cấm/cầm\ntrứng cút\nvú sữa\nvú em\nbím tóc\ntết/thắt bím\nsục sạo\nxoạc chân\nchim cu\ndâm bụt\nđi khách sạn/hàng\nđổ rác\nđồ điện\ncòn điện/diện/điền/diễn\nđỡ đần\nốc lớn/bò/lợn/to/nhỏ\nbộ máy\nđổ bóng\n# --- bổ sung vòng sửa 1 (bắt nhầm lời trẻ em kể chuyện / câu thường)\nức hiếp\nhiếp đáp\nbắt nạt và ức hiếp\nvú nuôi\nbà vú\nđồ bóng đá/chuyền/rổ/bàn/ném\nmẹ/bố/má mày gọi/bảo/đến/đón/về/tìm/kêu/dặn\n",
  ambiguous: "# ambiguous.txt — từ VÔ HẠI (viết có dấu) mà bỏ dấu thì trùng một từ tục. Bộ lọc dùng danh sách này để không bắt\n# nhầm chữ không dấu: \"cac\" có thể là \"các\", \"lon\" là \"lon/lớn/lợn\", \"buoi\" là \"buổi\"…\n# Dấu ! ở cuối = từ RẤT hay gặp: bản không dấu không bao giờ bị bắt, kể cả trong cụm (vd \"do cho\" = \"đồ cho\").\ncác, cạc\nlon, lớn, lợn, lộn, lởn\nbuổi\ndu, dù, dư, dữ, dự, dụ, đu, đủ, đú\nđeo, dẻo, đèo, đẽo, dẹo\nđi!, dì, dí, dị, dĩ, đì\nđiểm, diễm, điềm\nphố, phở, phó, phổ, pho, phô\ncho!, chợ, chớ, chỗ, chờ, chở, chõ\nngủ, ngụ, ngừ, ngũ, ngự\ndân, đàn, đan, dán, dần, dặn, đạn, đán, đản\ndài, dại, đại, đài, dai, dãi\nvũ, vụ, vu\ncụt, cút\nnung, nũng, nựng\nđám, dám, đâm, đầm, đậm, dăm, dặm, đảm, đạm, đam, dạm\nbim, bìm\nsức, sực, súc\nhiệp\nchích\nnên, nến, nền, nén\nđều, đểu\nquê, quế, quẻ, que\nmọi\nkhua, khứa\nchết, chét\nmà, má, ma, mạ, mã\nkhôn\nđiện, diện, điền, diễn\nốc, óc, ọc\ntan, tán, tạn\ncầm, cấm, cám, cam, căm\nmũ, mụ, mủ, mu\nmới!, mời, mỗi, môi, mồi, mối, moi\nmặn!, mạn, màn, mãn, mận, mần, man, mắn\nanh!, ánh, ảnh\n",
  reserved: "# reserved.txt — tên nhân vật cấm dùng (giả danh quản trị / hệ thống). So khớp bỏ dấu, bỏ ký tự ngăn cách,\n# số thay chữ (4dm1n = admin). Từ ≥ 5 chữ cái: cấm cả khi nằm trong tên (\"TheAdmin99\"); từ ngắn: cấm khi đứng riêng\n# hoặc đứng đầu tên (\"GM Tùng\", \"Mod1\").\nadmin\nadministrator\nadm\ngm\nmod\nmoderator\nquản trị\nquản trị viên\nqtv\nban quản trị\nbqt\nhệ thống\nchủ server\nchủ sv\nserver\nsystem\nstaff\nsupport\nhỗ trợ\nowner\ndev\ndeveloper\nnhà phát triển\nofficial\nchính thức\ncskh\nchăm sóc khách hàng\nbot\nnpc\nthông báo\ncông an\ncảnh sát\npolice\n",
};
// END DEFAULT LISTS

const LIST_KEYS = ['profanity', 'mild', 'sexual', 'hate', 'scam', 'probe', 'selfharm', 'allow', 'ambiguous', 'reserved'];
let RAW = {};
let C = null;   // compiled

function compileAll() {
  const ambiguousKeys = new Set();
  const strongKeys = new Set();
  const innocent = new Set();
  for (const w of parseLines(RAW.ambiguous)) {
    for (let part of w.split(/[\s,]+/).filter(Boolean)) {
      const strong = part.endsWith('!');
      if (strong) part = part.slice(0, -1);
      if (!part) continue;
      const a = analyzeWord(part.toLowerCase().normalize('NFC'));
      ambiguousKeys.add(a.key);
      if (strong) strongKeys.add(a.key);
      innocent.add(a.qkey + '|' + a.tones);
    }
  }
  const pats = [];
  for (const cat of Object.keys(CATS)) pats.push(...compileList(cat, RAW[cat], ambiguousKeys, strongKeys));
  const index = new Map();
  const infix = [];
  for (const p of pats) {
    if (p.infix) infix.push(p);
    for (const a of p.toks[0].alts) {
      let arr = index.get(a.key);
      if (!arr) index.set(a.key, (arr = []));
      if (!arr.includes(p)) arr.push(p);
    }
  }
  const allow = [];
  const allowIndex = new Map();
  for (const line of parseLines(RAW.allow)) {
    const toks = line.normalize('NFC').split(/\s+/).filter(Boolean).map(patToken);
    if (!toks.length || toks[0].any) continue;
    for (const t of toks) if (t.alts) for (const a of t.alts) { a.ambiguous = ambiguousKeys.has(a.key); a.strong = false; }
    const p = { toks, allow: true, plen: Math.max(2, toks.filter((t) => !t.any).length) };
    allow.push(p);
    for (const a of toks[0].alts) {
      let arr = allowIndex.get(a.key);
      if (!arr) allowIndex.set(a.key, (arr = []));
      arr.push(p);
    }
  }
  const reserved = parseLines(RAW.reserved).map((r) => nickKey(r));
  C = { pats, index, infix, allow, allowIndex, ambiguousKeys, innocent, reserved, version: hashLists() };
}

function hashLists() {
  let h = 2166136261 >>> 0;
  for (const k of LIST_KEYS) {
    const s = k + '\u0000' + (Array.isArray(RAW[k]) ? RAW[k].join('\n') : String(RAW[k] ?? '')) + '\u0001';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  }
  return FILTER_VERSION + '.' + h.toString(36);
}

export function setLists(next = {}) {
  for (const k of Object.keys(next)) if (next[k] !== undefined) RAW[k] = next[k];
  compileAll();
  return C.version;
}
export function getLists() { return { ...RAW }; }
export function listsVersion() { return C.version; }

// ---- token / pattern matching ---------------------------------------------------------------------------------------
// ctx: { accented: message typed with accents, allow: matching the allow-list }; plen = words in the pattern
function tokMatch(tok, a, plen, ctx) {
  if (!tok.word && !/^\d+$/.test(a.base)) return false;   // numbers match only numeric pattern words ('3 que')
  if (tok.star) return false;   // handled separately
  if (!rleCover(tok.base, a.base)) return false;
  if (!a.marked) return ctx.allow ? !tok.marked : true;      // allow-list: a bare word matches only bare words
  if (tok.hasTone && collapse1(tok.tones) !== a.tones) return false;
  if (tok.hasQual && tok.qkey !== a.qkey) return false;
  // "dịt" (tone kept, đ → d): an evasion of "địt" unless the toned bare word is itself innocent ("dĩ", "cút")
  // (fixer round 1, SO-6a: this used to refuse every toned token missing a quality mark)
  if (tok.hasTone && !tok.hasQual && a.hasQual && (C.innocent.has(tok.qkey + '|' + collapse1(tok.tones)) || C.ambiguousKeys.has(tok.key))) return false;
  const fully = tok.hasTone === a.hasTone && tok.hasQual === a.hasQual;
  if (fully) return true;
  if (tok.evasive) return true;
  if (!a.ambiguous) return true;
  // underspecified token (accents missing) whose bare form is also an innocent word:
  //  - very common words (ambiguous.txt "!") only inside patterns of ≥ 3 words
  //  - message typed with accents: a bare form that is not itself a word ("cac", "buoi") is an evasion
  //  - otherwise only inside a phrase (≥ 2 words); allow.txt removes the innocent phrases
  if (a.strong && plen < 3) return false;
  if (ctx.accented && !C.innocent.has(tok.qkey + '|' + collapse1(tok.tones))) return true;
  return plen > 1;
}

function starMatch(tok, a) {
  // "c*c", "l*n", "đ*o": try every vowel for each '*'
  if (!tok.star) return false;
  const pat = a.base;
  const s = canon(stripAll(tok.raw));
  if (s.length < 2 || s.replace(/\*/g, '').length < 1) return false;
  const re = new RegExp('^' + s.split('*').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[aeiouo]{1,3}') + '$');
  return re.test(pat) || re.test(collapse1(pat));
}
function stripAll(s) { return s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd'); }

// try pattern p at token i; returns end index (exclusive) or -1
function matchAt(toks, i, p, ctx, k = 0) {
  if (k === p.toks.length) return i;
  const pt = p.toks[k];
  if (pt.any) {
    for (let n = pt.min; n <= pt.max; n++) {
      if (i + n > toks.length) break;
      let okSpan = true;
      // wildcards span words and plain amounts ("nạp 50k thẻ", "free 1000 kc"; SO-6d), never other symbols
      for (let q = i; q < i + n; q++) if (!toks[q].word && !/^\d/.test(toks[q].acc)) { okSpan = false; break; }
      if (!okSpan) break;
      const r = matchAt(toks, i + n, p, ctx, k + 1);
      if (r >= 0) return r;
    }
    return -1;
  }
  if (i >= toks.length) return -1;
  const t = toks[i];
  for (const a of pt.alts) {
    if (tokMatch(t, a, p.plen, ctx) || (p.toks.length === 1 && starMatch(t, a))) {
      const r = matchAt(toks, i + 1, p, ctx, k + 1);
      if (r >= 0) return r;
    }
  }
  return -1;
}

function findHits(toks, ctx) {
  const hits = [];
  const n = toks.length;
  for (let i = 0; i < n; i++) {
    const t = toks[i];
    const cand = C.index.get(t.key);
    if (cand) {
      for (const p of cand) {
        const end = matchAt(toks, i, p, ctx);
        if (end > i) hits.push({ p, i, j: end });
      }
    }
    if (t.star) {
      for (const p of C.pats) {
        if (p.toks.length !== 1) continue;
        if (p.toks[0].alts.some((a) => starMatch(t, a))) hits.push({ p, i, j: i + 1 });
      }
    }
    // infix: long unaccented words containing a strong ASCII pattern ("ditmemay", "vclll")
    if ((!t.hasTone || t.joined) && t.key.length >= 3) {   // joined spaced letters keep their tones ("đ ị t m ẹ", SO-6b)
      for (const p of C.infix) {
        if (p.infix.some((k) => k.length >= 3 && t.key.length > k.length && t.key.includes(k))) hits.push({ p, i, j: i + 1 });
      }
    }
  }
  if (!hits.length) return hits;
  // allow-list: a hit fully inside an allowed phrase is cancelled
  const allowed = [];
  for (let i = 0; i < n; i++) {
    const cand = C.allowIndex.get(toks[i].key);
    if (!cand) continue;
    for (const p of cand) {
      const end = matchAt(toks, i, p, { accented: ctx.accented, allow: true });
      if (end > i) allowed.push([i, end]);
    }
  }
  if (!allowed.length) return hits;
  return hits.filter((h) => !allowed.some(([a, b]) => a <= h.i && h.j <= b));
}

// ---- detectors ------------------------------------------------------------------------------------------------------
const TLD_ALL = 'com|net|org|vn|io|xyz|info|top|site|online|club|link|ly|gg|tk|biz|app|shop|store|live|tv|cc|ru|cn|asia|edu|gov|pro|fun|vip|win|bet|cfd|sbs|icu|one|click|bio|lol|ws|to|tw';
const TLD_STRICT = 'org|vn|io|xyz|info|site|online|club|ly|gg|tk|biz|app|cc|ru|cn|asia|edu|gov|cfd|sbs|icu|click|bio|ws';
const LABEL = '[a-z0-9][a-z0-9-]{0,62}';
const URL_RES = [
  /(?:https?|ftp)\s*:\s*\/\s*\//,
  /(^|[^a-z0-9])www\s*\./,
  new RegExp(`(^|[^a-z0-9@._-])${LABEL}\\.(?:${TLD_ALL})(?![a-z0-9])`),
  new RegExp(`(^|[^a-z0-9@._-])[a-z0-9][a-z0-9-]{1,62}(?:\\s+\\.\\s*|\\s*\\.\\s+)(?:${TLD_STRICT})(?![a-z0-9])`),
  new RegExp(`(^|[^a-z0-9@._-])[a-z0-9][a-z0-9-]{1,62}(?:\\s+\\.\\s*|\\s*\\.\\s+)(?:com|net)(?=\\s*(?:$|/|\\.\\s*vn))`),
  new RegExp(`(^|[^a-z0-9])[a-z0-9][a-z0-9-]{1,62}\\s+(?:ch[aấâầ]m|dot|\\.)\\s+(?:${TLD_ALL})(?![a-z0-9])`),
  /(^|[^a-z0-9])t\s*\.\s*me\s*\//,
  /(^|[^a-z0-9])(?:bit\s*ly|tinyurl|shorturl|cutt\s*ly)(?![a-z])/,
];
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/;
const HANDLE_RE = /(^|[\s(:,;!?])@[a-z0-9_.]{2,}/;

// flat form for URL / handle detection: per-char fold (keeps Vietnamese letters + punctuation), bracketed dots → '.',
// runs of single alnum chars joined ("c o m" → "com")
function flatForUrl(display) {
  let s = '';
  for (const ch of display) s += fold(ch).s;
  s = s.replace(/[(\[{]\s*(?:\.|dot|ch[aấâ]m)\s*[)\]}]/g, '.').replace(/[。．｡]/g, '.');
  const parts = s.split(' ');
  const out = [];
  for (let i = 0; i < parts.length;) {
    if (/^[a-z0-9]$/.test(parts[i])) {
      let j = i, w = '';
      while (j < parts.length && /^[a-z0-9]$/.test(parts[j])) { w += parts[j]; j++; }
      out.push(w); i = j;
    } else { out.push(parts[i]); i++; }
  }
  return out.join(' ');
}

// digits written as words: Vietnamese (no diacritics) and English (fixer round 1, SO-2)
const NUMWORD = { khong: '0', linh: '0', le: '0', mot: '1', mo: '1', hai: '2', ba: '3', bon: '4', tu: '4', nam: '5', lam: '5', sau: '6', bay: '7', tam: '8', chin: '9',
  zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
// look-alikes inside a token that holds a digit ("l2", "o9l2З4S6789"): o → 0, i l | → 1, z → 2, s → 5, b → 6, g q → 9
const DIGIT_LIKE = { o: '0', i: '1', l: '1', '|': '1', z: '2', s: '5', b: '6', g: '9', q: '9' };
const NUMWORD_RE = new RegExp('^(?:' + Object.keys(NUMWORD).sort((a, b) => b.length - a.length).join('|') + ')');
// a letter run made only of number words ("khong", "ninetwo") → its digits, else null
function numwordRun(w) {
  let out = '';
  for (let r = w; r.length;) {
    const m = r.match(NUMWORD_RE);
    if (!m) return null;
    out += NUMWORD[m[0]]; r = r.slice(m[0].length);
  }
  return out;
}
// the message with number words / look-alikes turned into digits (for phone and cross-line digit checks)
function digitize(display) {
  let s = '';
  for (const ch of display) s += fold(ch).s;
  s = stripAll(s);
  s = s.split(' ').map((w) => {
    if (/\d/.test(w)) {
      // a token holding a digit: look-alikes are digits ("o9i2", "09 l2"), glued number words too ("khong9mot2")
      if (/^[\d.\-|oilzsbgq]+$/.test(w)) return w.replace(/[oilzsbgq|]/g, (c) => DIGIT_LIKE[c]);
      if (/^[a-z\d]+$/.test(w)) {
        const parts = w.match(/\d+|[a-z]+/g);
        let out = '';
        for (const p of parts) { if (/^\d/.test(p)) out += p; else { const d = numwordRun(p); if (d === null) return w; out += d; } }
        return out;
      }
      return w;
    }
    const k = w.replace(/[^a-z]/g, '');
    if (k && /^[a-z.,-]*$/.test(w)) { const d = NUMWORD[k] ?? (k.length >= 6 ? numwordRun(k) : null); if (d != null) return d; }
    return w;
  }).join(' ');
  s = s.replace(/(?<=\d[\s.\-_,]{0,3})[oO](?=[\s.\-_,]{0,3}\d)/g, '0');
  return s.replace(/(\d)[\s.\-_,()*+]+(?=\d)/g, '$1');
}
// digits of a digit-heavy line (≥ 3 digits, digits ≥ half of its letters+digits), else '' — the chat service keeps a
// short per-account buffer of these to catch a phone number split over several messages ("09123" + "45678")
export function phoneDigits(display) {
  const s = digitize(display);
  const d = (s.match(/\d/g) || []).length;
  const l = (s.match(/\p{L}/gu) || []).length;
  return d >= 3 && d >= l ? s.replace(/\D/g, '') : '';
}
export function isPhoneDigits(d) {
  const m = String(d).match(/(?:84|0)\d{8,10}/);
  return !!m && new Set(m[0]).size >= 3;
}
function detectPhone(display) {
  const s = digitize(display);
  const m = s.match(/\+?\d{9,}/g);
  if (!m) return false;
  for (let d of m) {
    d = d.replace('+', '');
    if (new Set(d).size < 3) continue;
    const phoneLike = d.startsWith('0') || d.startsWith('84');
    if (!phoneLike && /000$/.test(d)) continue;   // money: 125.000.000
    return true;
  }
  return false;
}

const PLATFORMS = ['zalo', 'zl', 'dalo', 'fb', 'facebook', 'face', 'phây', 'fây', 'fbook', 'tele', 'telegram', 'tlg', 'ig', 'insta',
  'instagram', 'tiktok', 'messenger', 'mess', 'snap', 'snapchat', 'discord', 'twitter', 'wechat', 'viber', 'skype', 'kakao',
  'gmail', 'email', 'mail', 'youtube', 'ytb', 'kik', 'whatsapp', 'signal', 'line'];
const PLATFORM_PAIRS = [['za', 'lo'], ['tik', 'tok'], ['tóp', 'tóp'], ['top', 'top'], ['phây', 'búc'], ['face', 'book'], ['in', 'sta'], ['dis', 'cord'], ['tê', 'lê'], ['te', 'le']];
const CONTACT = ['kb', 'ket', 'add', 'addfr', 'ib', 'inbox', 'nhắn', 'nhan', 'nt', 'liên', 'lien', 'lh', 'follow', 'fl', 'flw', 'xin',
  'gửi', 'gui', 'id', 'nick', 'nik', 'acc', 'tìm', 'tim', 'sdt', 'sđt', 'link', 'qua', 'là', 'kết', 'sub', 'đăng', 'dang', 'theo', 'vô', 'vào', 'tên', 'nhóm', 'kênh'];
let PLAT_KEYS = null, CONTACT_KEYS = null;
function initKeys() {
  PLAT_KEYS = new Set(PLATFORMS.map((w) => analyzeWord(w).key));
  CONTACT_KEYS = new Set(CONTACT.map((w) => analyzeWord(w).key));
}
function detectHandle(toks, flat, display) {
  if (HANDLE_RE.test(flat)) return true;
  if (!PLAT_KEYS) initKeys();
  for (let i = 0; i < toks.length; i++) {
    let plat = PLAT_KEYS.has(toks[i].key) && toks[i].word;
    let span = 1;
    if (!plat && i + 1 < toks.length) {
      for (const [a, b] of PLATFORM_PAIRS) {
        if (toks[i].key === analyzeWord(a).key && toks[i + 1].key === analyzeWord(b).key) { plat = true; span = 2; break; }
      }
    }
    if (!plat) continue;
    // a disguised platform name ("za.lo", "z@lo", "ph4y") is a contact share by itself (SO-6)
    if (span === 1 && toks[i].trick && toks[i].key !== 'line') return true;
    // "line" is an English word: needs a contact verb or an id
    for (let k = Math.max(0, i - 3); k < Math.min(toks.length, i + span + 3); k++) {
      if (k >= i && k < i + span) continue;
      const t = toks[k];
      if (CONTACT_KEYS.has(t.key)) return true;
      const orig = display.slice(t.start, t.end);
      if (/\d/.test(orig) && /[a-z]/i.test(orig) && orig.length >= 4) return true;   // id like abc123
      if (/^\d{5,}$/.test(orig)) return true;
      if (/[a-z0-9][_.][a-z0-9]/i.test(orig) && !/^\d+[.,]\d+$/.test(orig)) return true;
    }
    // "zalo:" / "fb:" followed by anything
    const after = display.slice(toks[i + span - 1].end, toks[i + span - 1].end + 2);
    if (/^\s*:/.test(after) && i + span < toks.length) return true;
  }
  return false;
}

// ---- main entry -----------------------------------------------------------------------------------------------------
const SEV = { pass: 0, flag: 1, mask: 2, block: 3 };

export function analyzeChat(text, opts = {}) {
  if (!C) setLists(DEFAULT_LISTS);
  const maxChars = opts.maxChars ?? CHAT.MAX_CHARS;
  const raw = String(text ?? '');
  const t = normalize(raw);
  const reasons = [];
  const res = (ok, txt, action, extra = {}) => ({ ok, text: txt, action, reasons, flag: false, support: false, hits: [], ...extra });
  if (!t) { reasons.push('empty'); return res(false, '', 'block'); }
  if ([...t].length > maxChars) { reasons.push('too_long'); return res(false, t, 'block'); }
  if (HAS_HIDDEN.test(raw)) reasons.push('control');
  const display = cleanDisplay(t, reasons);
  const toks = tokenize(display);
  // nicknames: every word is chosen on purpose; an invisible char INSIDE a word ("c​ac") is an evasion too
  if (opts.deliberate || ZW_INSIDE.test(raw.normalize('NFC'))) for (const tk of toks) tk.evasive = true;
  // message typed with accents? (≥ 50 % of words of ≥ 2 letters carry marks)
  let words = 0, marked = 0;
  for (const tk of toks) if (tk.word && tk.base.length >= 2) { words++; if (tk.marked) marked++; }
  const ctx = { accented: words > 0 && marked >= 1 && marked / words >= 0.5 };
  const hits = [];
  const add = (reason, action, term, i = -1, j = -1) => hits.push({ reason, action, term, i, j });

  const flat = flatForUrl(display);
  if (URL_RES.some((re) => re.test(flat)) || EMAIL_RE.test(flat)) add('url', 'block', 'url');
  if (detectPhone(display)) add('phone', 'block', 'phone');
  if (detectHandle(toks, flat, display)) add('handle', 'block', 'handle');
  for (const h of findHits(toks, ctx)) add(h.p.reason, h.p.action, h.p.term, h.i, h.j);
  if (toks.split) for (const h of findHits(toks.split, ctx)) hits.push({ reason: h.p.reason, action: h.p.action, term: h.p.term, i: h.i, j: h.j, toks: toks.split });
  if (toks.some((tk) => tk.conf && tk.word)) reasons.push('mixed_script');

  let action = 'pass', flag = false, support = false;
  const maskSpans = [];
  for (const h of hits) {
    let a = h.action;
    if (a === 'pass') continue;
    if (a === 'blockflag') { a = 'block'; flag = true; }
    if (a === 'flag') flag = true;
    if (h.reason === 'self_harm') support = true;
    if (SEV[a] > SEV[action]) action = a;
    const T = h.toks || toks;
    if (a === 'mask' && h.i >= 0) maskSpans.push([T[h.i].start, T[h.j - 1].end]);
    if (!reasons.includes(h.reason)) reasons.push(h.reason);
    if (T[h.i]?.evasive && !reasons.includes('evasion')) reasons.push('evasion');
  }
  let out = display;
  if (action === 'mask') {
    maskSpans.sort((x, y) => y[0] - x[0]);
    for (const [a, b] of maskSpans) {
      const n = Math.min(8, Math.max(3, [...out.slice(a, b)].length));
      out = out.slice(0, a) + '*'.repeat(n) + out.slice(b);
    }
  }
  if (action === 'pass' && flag) action = 'flag';
  if (flag && action !== 'flag') reasons.push('flag');
  const ok = action !== 'block';
  return res(ok, ok ? out : display, action, { flag, support, hits: hits.map((h) => ({ reason: h.reason, term: h.term })), digits: phoneDigits(display) });
}

export function filterChat(text, opts = {}) {
  const r = analyzeChat(text, opts);
  return { ok: r.ok, text: r.text, action: r.action, reasons: r.reasons };
}

// ---- nicknames ------------------------------------------------------------------------------------------------------
const NICK_LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };
function nickKey(s) {
  let out = '';
  for (const ch of String(s).normalize('NFC')) {
    const f = fold(ch).s;
    out += NICK_LEET[f] ?? f;
  }
  return stripAll(out).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function checkNickname(name) {
  if (!C) setLists(DEFAULT_LISTS);
  const t = normalize(name);
  const len = [...t].length;
  if (len < NICK.MIN || len > NICK.MAX) return { ok: false, reason: 'length' };
  // Latin letters only (Vietnamese included) — no look-alike scripts, no symbols
  if (!/^[\p{Script=Latin}\p{M}0-9 _.\-]+$/u.test(t)) return { ok: false, reason: 'chars' };
  if (/^[ _.\-]|[ _.\-]$|[ _.\-]{2,}/.test(t)) return { ok: false, reason: 'chars' };
  // at most 2 combining marks on one letter (Vietnamese needs ≤ 2 even fully decomposed: ệ = e + ̂ + ̣). "Zalgo" stacks
  // spill out of the chat line and the 👥 list (fixer round 1 MP-2b); a mark with no letter before it is refused too
  if (/\p{M}{3,}/u.test(t) || /^\p{M}|[ _.\-0-9]\p{M}/u.test(t)) return { ok: false, reason: 'chars' };
  if ((t.match(/\p{L}/gu) || []).length < 2) return { ok: false, reason: 'chars' };
  const k = nickKey(t);
  const flatK = k.replace(/ /g, '');
  // the same without leet (digits stay digits): "BQT01", "Mod1" — a short reserved word glued to digits (fixer round 1)
  let plain = '';
  for (const ch of t) plain += fold(ch).s;
  plain = stripAll(plain).toLowerCase().replace(/[^a-z0-9]+/g, '');
  for (const r of C.reserved) {
    if (!r) continue;
    const rf = r.replace(/ /g, '');
    if (k === r || flatK === rf) return { ok: false, reason: 'reserved' };
    if (rf.length >= 5 && flatK.includes(rf)) return { ok: false, reason: 'reserved' };
    if (k.startsWith(r + ' ') || new RegExp('^' + rf + '\\d').test(flatK) || new RegExp('^' + rf + '\\d').test(plain)) return { ok: false, reason: 'reserved' };
  }
  // a platform name glued to digits is a contact handle ("Zalo09123")
  if (!PLAT_KEYS) initKeys();
  const pm = plain.match(/^([a-z]+)(\d{3,})/) || plain.match(/([a-z]+)(\d{3,})$/);
  if (pm && PLAT_KEYS.has(analyzeWord(pm[1]).key)) return { ok: false, reason: 'contact' };
  if (isBrand(t) || isBrand(t.toUpperCase()) || brandWatchHit(t)) return { ok: false, reason: 'brand' };
  if (/\d{7,}/.test(t.replace(/[ _.\-]/g, ''))) return { ok: false, reason: 'contact' };
  const f = analyzeChat(t, { maxChars: 64 });
  if (f.reasons.some((r) => r === 'url' || r === 'phone' || r === 'handle')) return { ok: false, reason: 'contact' };
  if (f.action !== 'pass') return { ok: false, reason: 'profanity' };
  // words chosen on purpose: "Cac To", "L0n Me" (ambiguous bare words count) and the name glued ("ditmemay")
  const spaced = t.replace(/[_.\-]+/g, ' ');
  if (analyzeChat(spaced, { maxChars: 64, deliberate: true }).action !== 'pass') return { ok: false, reason: 'profanity' };
  const joined = t.replace(/[ _.\-]+/g, '');
  if (analyzeChat(joined, { maxChars: 64, deliberate: true }).action !== 'pass') return { ok: false, reason: 'profanity' };
  return { ok: true, reason: null };
}

setLists(DEFAULT_LISTS);
