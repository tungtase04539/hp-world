// chat/index.js — OWNER: S3. "Free chat, strict control" (SPEC §3.3).
//
// Service contract (FINAL — the gateway (S2) calls exactly this; extra fields / methods are additive):
//   createChat({ db, log, alerts, config, metrics, bus, now?, filterDirs? }) → chat
//   chat.handle(session, channel, text) → Promise<{ ok, deliverText, shadow, reason, code, ref, flagged, support, retryAfterMs }>
//       session      { accountId, netId, displayName, playSeconds, x/z (or pos.{x,z}) } — S2's session object
//       ok           deliver to recipients (SAY: within CHAT.RADIUS m, chosen by the gateway from the AOI grid)
//       deliverText  text to send (normalised, flood-collapsed, masked)
//       shadow       true → deliver ONLY back to the sender (shadow-mute)
//       reason       machine reason ('rate', 'slow_mode', 'duplicate', 'blocked', 'muted', 'banned', 'channel', …)
//       code         CHAT_CODE (js/shared/protocol.js) for EVENT CHAT_REJECTED when !ok
//       ref          msgRef (u32) — put it in S2C CHAT.msgRef; REPORT.chatRef points back to it      [additive]
//       flagged      the line went to the owner's queue                                             [additive]
//       support      self-harm words: also send EVENT SUPPORT_LINE to the sender                    [additive]
//       retryAfterMs for RATE / SLOW_MODE / MUTED (EVENT CHAT_REJECTED args[1])                     [additive]
//   chat.report(reporterSession, targetAccountId, reason, chatRef) → Promise<{ ok, code, reportId? }>   (REPORT_CODE)
//   chat.isMuted(accountId) → boolean (sync, cached)
//   chat.nicknameCheck(name) → { ok, reason }   (textfilter + brands + reserved names)
//   chat.blocks(accountId) → Set<accountId> | null   recipients whose set contains the sender get nothing
//   additive: isBanned, sanctionOf, loadAccount, forget, setBlock, listBlocks, sanction, revokeSanction, recent,
//             context, systemLine, reloadLists, saveList, purge, flush, stats, POLICY
//
// Bus: listens to 'player:join' (preload blocks) / 'player:leave'; emits 'sanction' {accountId, kind, until, seconds,
// reason, source, id, revoked?} (S2: mute → EVENT SANCTION, kick / ban → close the socket) and 'report:new' {report}.
import { analyzeChat, checkNickname, normalize, setLists, getLists, listsVersion } from '../../../js/shared/textfilter.js';
import { CHANNEL, CHAT_CODE, REPORT_CODE, REPORT_REASON } from '../../../js/shared/protocol.js';
import { CHAT } from '../../../js/shared/constants.js';
import { Bucket, levenshtein, dupKey, posOf, isUuid, extraEnv } from './util.js';
import { readFilterDir, DEFAULT_FILTER_DIR, LIST_FILES } from './lists.js';
import { ipKey, isExemptIp } from '../game/ratelimit.js';
import fs from 'node:fs';
import path from 'node:path';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export const POLICY = Object.freeze({
  REPORT_WINDOW_MS: 10 * MIN,      // distinct reporters counted in this window
  REPORT_THRESHOLD: 3,             // → auto-mute
  REPORT_DUP_MS: 10 * MIN,         // same reporter → same target
  REPORT_RATE_MS: 10_000,          // one report / 10 s per reporter (RATE.REPORT)
  // escalation ladder for automatic sanctions; step = number of mutes / shadow-mutes in the last 30 days
  LADDER: Object.freeze([
    Object.freeze({ kind: 'mute', ms: 10 * MIN }),
    Object.freeze({ kind: 'mute', ms: HOUR }),
    Object.freeze({ kind: 'mute', ms: DAY }),
    Object.freeze({ kind: 'shadow', ms: 7 * DAY }),   // repeat offender: keeps typing, nobody sees it
  ]),
  LADDER_LOOKBACK_DAYS: 30,
  STRIKE_WINDOW_MS: 10 * MIN,      // blocked lines in this window …
  STRIKE_LIMIT: 5,                 // … weighing ≥ 5 (hate / sexual / scam = 2) → automatic sanction
  RING: 2000,                      // chat lines kept in memory (admin feed, report context)
  CONTEXT_LINES: CHAT.CONTEXT_LINES,
  CONTEXT_RADIUS_M: 60,
  CONTEXT_WINDOW_MS: 15 * MIN,
  FLAG_COOLDOWN_MS: 10 * MIN,      // one filter-flag report per account per 10 min; later hits are APPENDED to it
  GROOMING_ALERT_HITS: 2,          // personal-info probing hits by one account in the cooldown window → owner alert
  // a player report counts toward the automatic mute only with evidence + a trusted reporter (fixer round 1, SEC-2/SO-5):
  //   evidence  the target said something the reporter could have seen in the last EVIDENCE_MS (the chatRef line, or a
  //             delivered line within EVIDENCE_RADIUS_M of the reporter)
  //   trusted   the reporter's account is ≥ REPORTER_MIN_AGE_MS old with ≥ REPORTER_MIN_PLAY_S of play
  //   distinct  reporters are counted by account AND by public IP (/64 for IPv6)
  // Every report still reaches the owner's queue. Report-driven sanctions never go beyond a 24 h mute (shadow = owner
  // or filter only).
  EVIDENCE_MS: 10 * MIN,
  EVIDENCE_RADIUS_M: 60,
  REPORTER_MIN_AGE_MS: DAY,
  REPORTER_MIN_PLAY_S: 30 * 60,
  RETENTION_DAYS: 30,
  DISMISSED_KEEP_DAYS: 90,         // dismissed reports are deleted after this (resolved ones lose their chat copy at RETENTION_DAYS)
  FLUSH_MS: 1000,
});

const REASON_VI = { 1: 'chửi bới', 2: 'quấy rối', 3: 'gian lận', 4: 'spam', 5: 'tên xấu', 6: 'khác' };

export function createChat({ db, log, alerts, metrics, bus, now = () => Date.now(), filterDirs, retentionDays = POLICY.RETENTION_DAYS } = {}) {
  const dirs = filterDirs || [DEFAULT_FILTER_DIR];
  const ring = [];
  const byRef = new Map();
  let seq = 0;
  let nextRef = 1;
  const pending = [];
  const buckets = new Map();      // accountId → Bucket
  const recentKeys = new Map();   // accountId → [{key, at}]
  const strikes = new Map();      // accountId → [{at, w}]
  const sanc = new Map();         // accountId → {mute, shadow, ban} untilMs (Infinity = permanent)
  const blockCache = new Map();   // accountId → Set
  const lastReport = new Map();   // reporter → at
  const lastFlag = new Map();     // accountId → {at, id (open filter report), probe (personal-info hits), cats}
  let flushing = null;

  const m = metrics ? {
    msgs: metrics.counter('chat_messages_total', 'chat lines handled, by filter action'),
    rej: metrics.counter('chat_rejected_total', 'chat lines rejected, by reason'),
    filterMs: metrics.histogram('chat_filter_ms', 'textfilter time per message (ms)', [0.05, 0.1, 0.25, 0.5, 1, 2, 5]),
    reports: metrics.counter('chat_reports_total', 'reports, by source'),
    sanctions: metrics.counter('chat_sanctions_total', 'sanctions, by kind and source'),
    ring: metrics.gauge('chat_ring_lines', 'chat lines kept in memory', () => ring.length),
  } : null;

  // ---- sanctions cache --------------------------------------------------------------------------------------------
  function remaining(acc, kind, t = now()) {
    const s = sanc.get(acc);
    if (!s || !s[kind]) return 0;
    const left = s[kind] - t;
    return left > 0 ? left : 0;
  }
  async function loadSanctions(acc) {
    if (!db) return;
    const rows = (await db.query(
      `SELECT account_id, kind, until FROM sanctions WHERE revoked_at IS NULL AND kind IN ('mute','shadow','ban')
       AND (until IS NULL OR until > now())${acc ? ' AND account_id = $1' : ''}`, acc ? [acc] : [])).rows;
    if (acc) sanc.delete(acc); else sanc.clear();
    for (const r of rows) {
      const e = sanc.get(r.account_id) || { mute: 0, shadow: 0, ban: 0 };
      const u = r.until ? new Date(r.until).getTime() : Infinity;
      if (u > e[r.kind]) e[r.kind] = u;
      sanc.set(r.account_id, e);
    }
  }

  // ---- chat log (ring + batched DB insert) -------------------------------------------------------------------------
  function record(line) {
    line.seq = ++seq;
    ring.push(line);
    if (line.ref != null) byRef.set(line.ref, line);
    while (ring.length > POLICY.RING) { const old = ring.shift(); if (byRef.get(old.ref) === old) byRef.delete(old.ref); }
    pending.push(line);
    return line;
  }
  function newRef() { const r = nextRef >>> 0 || 1; nextRef = (r + 1) >>> 0 || 1; return r; }
  const COLS = ['ref', 'at', 'account_id', 'net_id', 'name', 'channel', 'text', 'raw', 'action', 'reasons', 'flagged', 'shadow', 'x', 'z'];
  const rowOf = (l) => [l.ref, new Date(l.at), l.accountId || null, l.netId ?? null, l.name || null, l.channel, l.text, l.raw || null, l.action, l.reasons || [], !!l.flagged, !!l.shadow, l.x ?? null, l.z ?? null];
  async function insertRows(rows) {
    const params = [];
    const tuples = rows.map((l) => {
      const r = rowOf(l);
      const base = params.length;
      params.push(...r);
      return '(' + r.map((_, i) => `$${base + i + 1}`).join(',') + ')';
    });
    await db.query(`INSERT INTO chat_log (${COLS.join(',')}) VALUES ${tuples.join(',')}`, params);
  }
  async function flush() {
    if (!db) { pending.length = 0; return; }
    if (flushing) return flushing;
    flushing = (async () => {
      while (pending.length) {
        const rows = pending.splice(0, 400);
        try { await insertRows(rows); } catch (e) {
          // one bad row (e.g. an account deleted meanwhile) must not lose the batch
          let lost = 0;
          for (const r of rows) { try { await insertRows([r]); } catch { lost++; } }
          if (lost) log?.warn('chat_log rows dropped', { lost, err: e.message });
        }
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // ---- context for reports (server-side, never client-supplied) ---------------------------------------------------
  async function lineByRef(ref) {
    if (!ref) return null;
    const l = byRef.get(ref >>> 0);
    if (l) return l;
    if (!db) return null;
    const r = await db.one(`SELECT ref, at, account_id, net_id, name, channel, text, raw, action, reasons, flagged, x, z
      FROM chat_log WHERE ref = $1 AND at > now() - interval '1 day' ORDER BY at DESC LIMIT 1`, [ref >>> 0]);
    return r ? fromRow(r) : null;
  }
  const fromRow = (r) => ({ ref: Number(r.ref), at: new Date(r.at).getTime(), accountId: r.account_id, netId: r.net_id, name: r.name, channel: r.channel,
    text: r.text, raw: r.raw, action: r.action, reasons: r.reasons || [], flagged: r.flagged, x: r.x, z: r.z });

  async function context(targetId, chatRef, reporterId) {
    const anchor = await lineByRef(chatRef);
    const T = anchor ? anchor.at : now();
    const W = POLICY.CONTEXT_WINDOW_MS;
    let lines = ring.filter((l) => Math.abs(l.at - T) <= W);
    if (db && (lines.length < POLICY.CONTEXT_LINES || !ring.length || ring[0].at > T - W)) {
      try {
        const rows = (await db.query(`SELECT ref, at, account_id, net_id, name, channel, text, raw, action, reasons, flagged, x, z FROM chat_log
          WHERE at BETWEEN $1 AND $2 ORDER BY at DESC LIMIT 400`, [new Date(T - W), new Date(T + W)])).rows.map(fromRow);
        const seen = new Set(lines.map((l) => l.ref + ':' + l.at));
        for (const r of rows) if (!seen.has(r.ref + ':' + r.at)) lines.push(r);
      } catch (e) { log?.warn('context query failed', { err: e.message }); }
    }
    let center = anchor && Number.isFinite(anchor.x) ? anchor : null;
    if (!center) {
      for (let i = ring.length - 1; i >= 0; i--) { const l = ring[i]; if (l.accountId === targetId && Number.isFinite(l.x)) { center = l; break; } }
    }
    const R2 = POLICY.CONTEXT_RADIUS_M ** 2;
    const rel = lines.filter((l) => l.accountId === targetId || (reporterId && l.accountId === reporterId) || l.channel === CHANNEL.SYSTEM ||
      (center && Number.isFinite(l.x) && (l.x - center.x) ** 2 + (l.z - center.z) ** 2 <= R2));
    const score = (l) => (l.at <= T ? T - l.at : (l.at - T) * 2);
    rel.sort((a, b) => score(a) - score(b));
    return rel.slice(0, POLICY.CONTEXT_LINES).sort((a, b) => a.at - b.at).map((l) => ({
      ref: l.ref, at: new Date(l.at).toISOString(), name: l.name, accountId: l.accountId, text: l.text,
      raw: l.raw || undefined, action: l.action, reasons: l.reasons?.length ? l.reasons : undefined,
      who: l.accountId === targetId ? 'target' : l.accountId && l.accountId === reporterId ? 'reporter' : undefined,
      mark: anchor && l.ref === anchor.ref && l.at === anchor.at ? true : undefined,
    }));
  }

  // ---- sanctions ----------------------------------------------------------------------------------------------------
  async function sanction({ accountId, kind, ms = null, reason = null, source = 'admin', reportId = null, actor = 'system' }) {
    if (!isUuid(accountId)) throw new Error('bad account id');
    if (!['mute', 'shadow', 'ban', 'kick', 'warn'].includes(kind)) throw new Error('bad kind');
    const timed = kind === 'mute' || kind === 'shadow' || kind === 'ban';
    const until = timed && ms != null ? new Date(now() + ms) : null;
    let id = null;
    if (db) {
      const row = await db.one(`INSERT INTO sanctions (account_id, kind, until, reason, source, report_id, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [accountId, kind, until, reason, source, reportId, actor]);
      id = row.id;
      if (kind === 'ban' && ms == null) await db.query(`UPDATE accounts SET status = 'banned' WHERE id = $1 AND status = 'active'`, [accountId]);
    }
    if (timed) {
      const e = sanc.get(accountId) || { mute: 0, shadow: 0, ban: 0 };
      const u = until ? until.getTime() : Infinity;
      if (u > e[kind]) e[kind] = u;
      sanc.set(accountId, e);
    }
    const untilMs = until ? until.getTime() : timed ? null : 0;
    const seconds = until ? Math.round(ms / 1000) : timed ? 0xffffffff : 0;
    m?.sanctions.inc(1, { kind, source });
    bus?.emit('sanction', { accountId, kind, until: untilMs, seconds, reason, source, id });
    log?.info('sanction', { accountId, kind, seconds, source, id });
    return { id, accountId, kind, until: until ? until.toISOString() : null, seconds };
  }

  async function revokeSanction(id, actor = 'owner') {
    if (!db) return null;
    const row = await db.one(`UPDATE sanctions SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL
      RETURNING account_id, kind, until`, [id, actor]);
    if (!row) return null;
    if (row.kind === 'ban' && !row.until) await db.query(`UPDATE accounts SET status = 'active' WHERE id = $1 AND status = 'banned'`, [row.account_id]);
    await loadSanctions(row.account_id);
    bus?.emit('sanction', { accountId: row.account_id, kind: row.kind, until: 0, seconds: 0, revoked: true, id });
    return { id, accountId: row.account_id, kind: row.kind };
  }

  // automatic sanction on the escalation ladder
  async function autoSanction(accountId, source, reason, reportId = null) {
    let n = 0;
    if (db) {
      n = (await db.one(`SELECT count(*)::int AS n FROM sanctions WHERE account_id = $1 AND kind IN ('mute','shadow')
        AND revoked_at IS NULL AND starts_at > now() - make_interval(days => $2)`, [accountId, POLICY.LADDER_LOOKBACK_DAYS])).n;
    }
    let idx = Math.min(n, POLICY.LADDER.length - 1);
    // reports alone (which a few colluding accounts can file) never escalate to the shadow mute: that step stays with
    // the owner and the filter (SEC-2 / SO-5)
    if (source === 'auto_report') while (idx > 0 && POLICY.LADDER[idx].kind === 'shadow') idx--;
    const step = POLICY.LADDER[idx];
    const s = await sanction({ accountId, kind: step.kind, ms: step.ms, reason, source, reportId, actor: 'system' });
    const label = step.kind === 'shadow' ? 'khoá chat ẩn' : 'khoá chat';
    alerts?.send('automute', `Tự động ${label} ${fmtDur(step.ms)} một người chơi (${reason}). Xem trang quản trị.`).catch(() => {});
    return s;
  }

  function addStrike(acc, w, t) {
    const arr = (strikes.get(acc) || []).filter((s) => t - s.at < POLICY.STRIKE_WINDOW_MS);
    arr.push({ at: t, w });
    strikes.set(acc, arr);
    return arr.reduce((a, s) => a + s.w, 0);
  }

  // filter flag → owner queue (report with source 'filter')
  // Within FLAG_COOLDOWN_MS one account gets ONE open filter report; every later flagged line is appended to it (hit
  // count, reasons, the line itself) instead of being dropped — a grooming escalation (age → address → photo → home
  // alone) shows up in full in the owner's queue (fixer round 1, SO-1). Self-harm always gets its own report + alert.
  const lineJson = (l, who) => ({ ref: l.ref, at: new Date(l.at).toISOString(), name: l.name, accountId: l.accountId, text: l.text,
    raw: l.raw || undefined, action: l.action, reasons: l.reasons?.length ? l.reasons : undefined, who, mark: true });
  async function flagReport(session, line, f) {
    const acc = session.accountId;
    const t = now();
    const probe = f.reasons.includes('personal_info');
    let st = lastFlag.get(acc);
    if (st && t - st.at >= POLICY.FLAG_COOLDOWN_MS) st = null;
    if (!db) return null;
    if (st && st.id && !f.support) {
      st.probe += probe ? 1 : 0;
      for (const r of f.reasons) st.cats.add(r);
      try {
        await db.query(`UPDATE reports SET hits = hits + 1, detail = $2, context = context || $3::jsonb WHERE id = $1`,
          [st.id, [...st.cats].join(','), JSON.stringify([lineJson(line, 'target')])]);
      } catch (e) { log?.warn('flag append failed', { err: e.message }); }
      if (probe && st.probe >= POLICY.GROOMING_ALERT_HITS && !st.alerted) {
        st.alerted = true;
        alerts?.send('grooming', `Một người chơi hỏi thông tin cá nhân nhiều lần liên tiếp (tuổi / nhà / ảnh…) — báo cáo #${st.id}. Hãy xem ngay trang quản trị.`).catch(() => {});
      }
      return st.id;
    }
    const ctx = await context(acc, line.ref, null);
    try {
      const r = await db.one(`INSERT INTO reports (source, target_id, target_name, reason, detail, chat_ref, context, at)
        VALUES ('filter', $1, $2, 0, $3, $4, $5, $6) RETURNING id, at`, [acc, session.displayName || null, f.reasons.join(','), line.ref, JSON.stringify(ctx), new Date(t)]);
      m?.reports.inc(1, { source: 'filter' });
      bus?.emit('report:new', { report: { id: r.id, source: 'filter', targetId: acc, targetName: session.displayName, detail: f.reasons.join(',') } });
      if (!f.support) lastFlag.set(acc, { at: t, id: r.id, probe: probe ? 1 : 0, cats: new Set(f.reasons), alerted: false });
      else if (!st) lastFlag.set(acc, { at: t, id: null, probe: 0, cats: new Set(), alerted: false });
      if (f.support) alerts?.send('selfharm', `Một người chơi vừa nhắc tới chuyện tự hại trong chat (báo cáo #${r.id}). Hãy xem trang quản trị.`).catch(() => {});
      else if (f.reasons.includes('hate')) alerts?.send('flag', `Chat có lời miệt thị / đe doạ bị chặn (báo cáo #${r.id}).`).catch(() => {});
      return r.id;
    } catch (e) { log?.warn('flag report failed', { err: e.message }); return null; }
  }

  // did the target say something (delivered, not shadow) that this reporter could have seen? (SEC-2 / SO-5)
  async function hasEvidence(targetId, chatRef, reporterSession, t) {
    const fresh = (l) => l && l.accountId === targetId && t - l.at <= POLICY.EVIDENCE_MS && l.action !== 'block' && !l.shadow;
    if (chatRef && fresh(await lineByRef(chatRef))) return true;
    const p = posOf(reporterSession);
    if (!p) return false;
    const R2 = POLICY.EVIDENCE_RADIUS_M ** 2;
    for (let i = ring.length - 1; i >= 0; i--) {
      const l = ring[i];
      if (t - l.at > POLICY.EVIDENCE_MS) break;
      if (fresh(l) && Number.isFinite(l.x) && (l.x - p.x) ** 2 + (l.z - p.z) ** 2 <= R2) return true;
    }
    return false;
  }

  // ---- blocks -------------------------------------------------------------------------------------------------------
  async function loadBlocks(acc) {
    if (!db || !isUuid(acc)) return null;
    const rows = (await db.query(`SELECT target_id AS id FROM social_blocks WHERE account_id = $1
      UNION SELECT account_id AS id FROM social_blocks WHERE target_id = $1 AND kind = 'block'`, [acc])).rows;
    const set = new Set(rows.map((r) => r.id));
    blockCache.set(acc, set);
    return set;
  }

  // ---- the service --------------------------------------------------------------------------------------------------
  const reject = (reason, code, retryAfterMs = 0, extra = {}) => {
    m?.rej.inc(1, { reason });
    return { ok: false, deliverText: '', shadow: false, reason, code, ref: 0, flagged: false, support: false, retryAfterMs, ...extra };
  };

  const chat = {
    POLICY,

    async handle(session, channel, text) {
      const acc = session?.accountId;
      if (!acc) return reject('no_account', CHAT_CODE.BLOCKED);
      if (channel !== CHANNEL.SAY) return reject('channel', CHAT_CODE.CHANNEL);
      const t = now();
      const banLeft = remaining(acc, 'ban', t);
      if (banLeft > 0) return reject('banned', CHAT_CODE.MUTED, Math.min(banLeft, 0x7fffffff));
      const muteLeft = remaining(acc, 'mute', t);
      if (muteLeft > 0) return reject('muted', CHAT_CODE.MUTED, Math.min(muteLeft, 0x7fffffff));
      const t0 = performance.now();
      const f = analyzeChat(text);
      m?.filterMs.observe(performance.now() - t0);
      if (f.reasons[0] === 'empty') return reject('empty', CHAT_CODE.EMPTY);
      if (f.reasons[0] === 'too_long') return reject('too_long', CHAT_CODE.TOO_LONG);
      // rate: 1 / 2 s burst 3; slow mode 1 / 5 s for accounts with < 10 min of play
      const slow = (Number(session.playSeconds) || 0) < CHAT.SLOW_MODE_PLAY_S;
      const bk = acc + (slow ? '|s' : '');
      let b = buckets.get(bk);
      if (!b) buckets.set(bk, (b = slow ? new Bucket(CHAT.SLOW_RATE_PER_S, 1, t) : new Bucket(CHAT.RATE_PER_S, CHAT.BURST, t)));
      const wait = b.take(t);
      if (wait) return reject(slow ? 'slow_mode' : 'rate', slow ? CHAT_CODE.SLOW_MODE : CHAT_CODE.RATE, wait);
      // duplicate / near-duplicate within 30 s (Levenshtein ≤ 2 on the normalised text; short lines: exact)
      const key = dupKey(f.text);
      const hist = (recentKeys.get(acc) || []).filter((h) => t - h.at < CHAT.DUP_WINDOW_S * 1000);
      for (const h of hist) {
        const short = Math.max(h.key.length, key.length) < 6;
        if (h.key === key || (!short && levenshtein(h.key, key, CHAT.DUP_LEVENSHTEIN) <= CHAT.DUP_LEVENSHTEIN)) {
          recentKeys.set(acc, hist);
          return reject('duplicate', CHAT_CODE.DUPLICATE);
        }
      }
      hist.push({ key, at: t });
      if (hist.length > 6) hist.shift();
      recentKeys.set(acc, hist);

      const pos = posOf(session);
      const shadow = remaining(acc, 'shadow', t) > 0;
      const line = {
        ref: newRef(), at: t, accountId: acc, netId: session.netId ?? null, name: session.displayName || null, channel,
        text: f.text, raw: f.action === 'mask' ? normalize(text) : null, action: f.action, reasons: f.reasons.filter((r) => r !== 'control'),
        flagged: f.flag, shadow, x: pos?.x, z: pos?.z,
      };
      record(line);
      m?.msgs.inc(1, { action: f.action });
      if (f.action === 'block') {
        // a distressed player who swears ('đm tao muốn chết') still gets the support line and no strike (SO-3)
        const heavy = f.reasons.some((r) => r === 'hate' || r === 'sexual' || r === 'scam');
        const total = f.support ? 0 : addStrike(acc, heavy ? 2 : 1, t);
        if (f.flag) flagReport(session, line, f).catch(() => {});
        if (total >= POLICY.STRIKE_LIMIT && remaining(acc, 'mute', t) === 0) {
          strikes.delete(acc);
          autoSanction(acc, 'auto_filter', 'nhiều tin nhắn bị chặn liên tiếp').catch((e) => log?.warn('auto sanction failed', { err: e.message }));
        }
        return reject('blocked', CHAT_CODE.BLOCKED, 0, { ref: line.ref, flagged: f.flag, support: !!f.support, reasons: f.reasons });
      }
      if (f.flag) flagReport(session, line, f).catch(() => {});
      return { ok: true, deliverText: f.text, shadow, reason: null, code: CHAT_CODE.OK, ref: line.ref, flagged: f.flag, support: f.support, retryAfterMs: 0 };
    },

    async report(reporterSession, targetAccountId, reason, chatRef = 0) {
      const rep = reporterSession?.accountId;
      if (!rep || !isUuid(targetAccountId)) return { ok: false, code: REPORT_CODE.UNKNOWN_TARGET };
      if (targetAccountId === rep) return { ok: false, code: REPORT_CODE.SELF };
      const t = now();
      const last = lastReport.get(rep);
      if (last && t - last < POLICY.REPORT_RATE_MS) return { ok: false, code: REPORT_CODE.RATE };
      lastReport.set(rep, t);
      const rsn = Object.values(REPORT_REASON).includes(reason) ? reason : REPORT_REASON.OTHER;
      if (!db) return { ok: true, code: REPORT_CODE.OK };
      const dup = await db.one(`SELECT id FROM reports WHERE reporter_id = $1 AND target_id = $2 AND at > $3 LIMIT 1`,
        [rep, targetAccountId, new Date(t - POLICY.REPORT_DUP_MS)]);
      if (dup) return { ok: false, code: REPORT_CODE.DUPLICATE };
      const ctx = await context(targetAccountId, chatRef >>> 0, rep);
      let targetName = ctx.find((l) => l.who === 'target')?.name || null;
      if (!targetName) targetName = (await db.one('SELECT display_name FROM characters WHERE account_id = $1', [targetAccountId]))?.display_name || null;
      const evidence = await hasEvidence(targetAccountId, chatRef >>> 0, reporterSession, t);
      const ra = await db.one('SELECT created_at, play_seconds FROM accounts WHERE id = $1', [rep]);
      const play = Math.max(Number(ra?.play_seconds) || 0, Number(reporterSession.playSeconds) || 0);
      const trusted = !!ra && t - new Date(ra.created_at).getTime() >= POLICY.REPORTER_MIN_AGE_MS && play >= POLICY.REPORTER_MIN_PLAY_S;
      const ip = reporterSession.ip && !isExemptIp(reporterSession.ip) ? ipKey(reporterSession.ip) : null;
      let row;
      try {
        row = await db.one(`INSERT INTO reports (source, reporter_id, reporter_name, target_id, target_name, reason, chat_ref, context, at, evidence, counts, reporter_ip)
          VALUES ('player', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, at`,
        [rep, reporterSession.displayName || null, targetAccountId, targetName, rsn, chatRef ? chatRef >>> 0 : null, JSON.stringify(ctx), new Date(t),
          evidence, evidence && trusted, ip]);
      } catch (e) {
        if (/foreign key|violates/i.test(e.message)) return { ok: false, code: REPORT_CODE.UNKNOWN_TARGET };
        throw e;
      }
      m?.reports.inc(1, { source: 'player' });
      bus?.emit('report:new', { report: { id: row.id, source: 'player', reporterId: rep, targetId: targetAccountId, targetName, reason: rsn } });
      alerts?.send('report', `Báo cáo mới #${row.id}: ${reporterSession.displayName || 'người chơi'} báo cáo ${targetName || 'một người chơi'} (${REASON_VI[rsn]}).`).catch(() => {});
      // ≥ 3 distinct trusted reporters with evidence (distinct accounts AND distinct public IPs) in 10 min → automatic mute
      const c = await db.one(`SELECT count(DISTINCT reporter_id)::int AS n, count(DISTINCT COALESCE(reporter_ip, reporter_id::text))::int AS nip
        FROM reports WHERE target_id = $1 AND source = 'player' AND counts AND status <> 'dismissed' AND at > $2`,
      [targetAccountId, new Date(t - POLICY.REPORT_WINDOW_MS)]);
      const n = Math.min(c.n, c.nip);
      if (n >= POLICY.REPORT_THRESHOLD && remaining(targetAccountId, 'mute') === 0 && remaining(targetAccountId, 'shadow') === 0) {
        await autoSanction(targetAccountId, 'auto_report', `${n} người báo cáo trong 10 phút`, row.id);
      }
      return { ok: true, code: REPORT_CODE.OK, reportId: row.id };
    },

    isMuted: (accountId) => remaining(accountId, 'mute') > 0,
    isBanned: (accountId) => remaining(accountId, 'ban') > 0,
    sanctionOf(accountId) {
      const t = now();
      const out = {};
      for (const k of ['mute', 'shadow', 'ban']) { const left = remaining(accountId, k, t); out[k] = left > 0 ? (Number.isFinite(left) ? t + left : null) : 0; }
      return out;
    },
    nicknameCheck: (name) => checkNickname(name),
    blocks: (accountId) => blockCache.get(accountId) || null,
    async loadAccount(accountId) { if (isUuid(accountId)) await loadBlocks(accountId); return chat.blocks(accountId); },
    forget(accountId) { blockCache.delete(accountId); },
    async setBlock(accountId, targetId, on = true, kind = 'block') {
      if (!isUuid(accountId) || !isUuid(targetId) || accountId === targetId || !['mute', 'block'].includes(kind)) return { ok: false };
      if (!db) return { ok: false };
      try {
        if (on) await db.query(`INSERT INTO social_blocks (account_id, target_id, kind) VALUES ($1,$2,$3)
          ON CONFLICT (account_id, target_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`, [accountId, targetId, kind]);
        else await db.query('DELETE FROM social_blocks WHERE account_id = $1 AND target_id = $2', [accountId, targetId]);
      } catch (e) { log?.warn('setBlock failed', { err: e.message }); return { ok: false }; }
      for (const a of [accountId, targetId]) if (blockCache.has(a)) await loadBlocks(a);
      return { ok: true };
    },
    async listBlocks(accountId) {
      if (!db || !isUuid(accountId)) return [];
      return (await db.query(`SELECT b.target_id AS "accountId", b.kind, b.created_at AS "at", c.display_name AS name FROM social_blocks b
        LEFT JOIN characters c ON c.account_id = b.target_id WHERE b.account_id = $1 ORDER BY b.created_at DESC LIMIT 500`, [accountId])).rows;
    },
    sanction,
    revokeSanction,
    autoSanction,
    context,
    // live feed: lines after `since` (seq), newest last
    recent({ since = 0, limit = 200 } = {}) {
      const out = [];
      for (let i = ring.length - 1; i >= 0 && out.length < limit; i--) { if (ring[i].seq <= since) break; out.push(ring[i]); }
      return out.reverse();
    },
    get seq() { return seq; },
    systemLine(text, actor = 'owner') {
      return record({ ref: newRef(), at: now(), accountId: null, netId: null, name: actor === 'owner' ? 'Quản trị' : 'Hệ thống', channel: CHANNEL.SYSTEM,
        text: normalize(text).slice(0, 280), raw: null, action: 'system', reasons: [], flagged: false, shadow: false });
    },
    async reloadLists(actor = 'owner', action = 'reload') {
      const prev = getLists();
      const merged = {}, files = {}, missing = [];
      // later dirs are fallbacks: the first dir that has a list wins (data dir override → built-in lists)
      for (const k of LIST_FILES) {
        for (const d of dirs) {
          const r = readFilterDir(d);
          if (r.lists[k] !== undefined) { merged[k] = r.lists[k]; files[k] = { ...r.files[k], dir: path.basename(path.dirname(d)) + '/' + path.basename(d) }; break; }
        }
        if (merged[k] === undefined) missing.push(k);
      }
      const changes = {};
      for (const k of Object.keys(merged)) {
        const a = new Set(String(prev[k] ?? '').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
        const b = new Set(merged[k].split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
        const added = [...b].filter((x) => !a.has(x)), removed = [...a].filter((x) => !b.has(x));
        if (added.length || removed.length) changes[k] = { added: added.slice(0, 50), removed: removed.slice(0, 50), nAdded: added.length, nRemoved: removed.length };
      }
      let version, ok = true, error = null;
      try { version = setLists(merged); } catch (e) { ok = false; error = e.message; setLists(prev); version = listsVersion(); }
      if (db) {
        try {
          await db.query(`INSERT INTO filter_audit (actor, action, version, files, changes, ok, error) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [actor, action, version, JSON.stringify(files), JSON.stringify(changes), ok, error]);
        } catch (e) { log?.warn('filter_audit insert failed', { err: e.message }); }
      }
      log?.info('filter lists loaded', { version, missing, changed: Object.keys(changes) });
      return { ok, version, files, changes, missing, error };
    },
    // owner edits one list from the admin page: validated, written to the FIRST filter dir (data dir), then reloaded
    async saveList(name, text, actor = 'owner') {
      if (!LIST_FILES.includes(name)) throw new Error('unknown list');
      const body = String(text ?? '').replace(/\r\n/g, '\n');
      if (Buffer.byteLength(body) > 256 * 1024) throw new Error('list too big');
      const prev = getLists();
      try { setLists({ [name]: body }); } finally { setLists(prev); }   // compiles? (throws on a broken list)
      const dir = dirs[0];
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.${name}.txt.tmp`);
      fs.writeFileSync(tmp, body.endsWith('\n') ? body : body + '\n');
      fs.renameSync(tmp, path.join(dir, name + '.txt'));
      return chat.reloadLists(actor, 'reload');
    },
    listsVersion,
    getLists,
    // retention (SPEC §3.3 "chat log 30 days", SEC-6): chat_log rows, AND the chat copies inside reports — a resolved
    // report loses its context lines (bystanders' text, names, account ids) after `days`; dismissed reports are deleted
    // after DISMISSED_KEEP_DAYS. Open reports keep their context until the owner decides.
    async purge(days = retentionDays) {
      if (!db) return 0;
      const r = await db.query('DELETE FROM chat_log WHERE at < now() - make_interval(days => $1)', [days]);
      if (r.rowCount) log?.info('chat_log purged', { rows: r.rowCount, days });
      const c = await db.query(`UPDATE reports SET context = '[]'::jsonb, purged_at = now() WHERE status <> 'open' AND purged_at IS NULL
        AND at < now() - make_interval(days => $1)`, [days]);
      const d = await db.query(`DELETE FROM reports WHERE status = 'dismissed' AND at < now() - make_interval(days => $1)`, [Math.max(days, POLICY.DISMISSED_KEEP_DAYS)]);
      if (c.rowCount || d.rowCount) log?.info('reports purged', { contextCleared: c.rowCount, deleted: d.rowCount, days });
      return r.rowCount || 0;
    },
    flush,
    async init() {
      if (db) {
        const r = await db.one('SELECT ref FROM chat_log ORDER BY id DESC LIMIT 1');
        nextRef = r ? ((Number(r.ref) + 1) >>> 0) || 1 : 1;
        await loadSanctions();
      }
      return chat.reloadLists('system', 'load');
    },
    loadSanctions,
    sweep() {
      const t = now();
      for (const [k, b] of buckets) if (t - b.seen > 10 * MIN) buckets.delete(k);
      for (const [k, h] of recentKeys) if (!h.length || t - h[h.length - 1].at > CHAT.DUP_WINDOW_S * 1000) recentKeys.delete(k);
      for (const [k, s] of strikes) if (!s.length || t - s[s.length - 1].at > POLICY.STRIKE_WINDOW_MS) strikes.delete(k);
      for (const [k, v] of lastReport) if (t - v > POLICY.REPORT_DUP_MS) lastReport.delete(k);
      for (const [k, v] of lastFlag) if (t - v.at > POLICY.FLAG_COOLDOWN_MS) lastFlag.delete(k);
      for (const [k, e] of sanc) if (e.mute <= t && e.shadow <= t && e.ban <= t) sanc.delete(k);
    },
    stats() {
      let active = 0;
      const t = now();
      for (const e of sanc.values()) if (e.mute > t || e.shadow > t || e.ban > t) active++;
      return { ring: ring.length, pending: pending.length, buckets: buckets.size, activeSanctions: active, blocksCached: blockCache.size, listsVersion: listsVersion(), seq };
    },
  };
  return chat;
}

export function fmtDur(ms) {
  if (ms == null || !Number.isFinite(ms)) return 'vĩnh viễn';
  if (ms >= DAY) return `${Math.round(ms / DAY)} ngày`;
  if (ms >= HOUR) return `${Math.round(ms / HOUR)} giờ`;
  return `${Math.max(1, Math.round(ms / MIN))} phút`;
}

export async function register(app) {
  const log = app.log.child({ mod: 'chat' });
  const days = Number(extraEnv(app, 'CHAT_LOG_DAYS')) > 0 ? Number(extraEnv(app, 'CHAT_LOG_DAYS')) : POLICY.RETENTION_DAYS;
  // owner overrides (written by the admin page) live in <dataDir>/filter; the committed lists are the fallback
  const dataFilter = path.join(app.config.dataDir, 'filter');
  const dirs = path.resolve(dataFilter) === path.resolve(DEFAULT_FILTER_DIR) ? [DEFAULT_FILTER_DIR] : [dataFilter, DEFAULT_FILTER_DIR];
  const chat = createChat({
    db: app.db, log, alerts: app.has('alerts') ? app.get('alerts') : null,
    config: app.config, metrics: app.metrics, bus: app.bus, filterDirs: dirs, retentionDays: days,
  });
  await chat.init();
  app.provide('chat', chat);
  app.bus.on('player:join', ({ session } = {}) => { if (session?.accountId) chat.loadAccount(session.accountId).catch((e) => log.warn('loadAccount failed', { err: e.message })); });
  app.bus.on('player:leave', ({ session } = {}) => { if (session?.accountId) chat.forget(session.accountId); });
  app.timers.every(POLICY.FLUSH_MS, 'chat_flush', () => chat.flush());
  app.timers.every(60_000, 'chat_sweep', () => chat.sweep());
  app.timers.every(6 * HOUR, 'chat_purge', () => chat.purge());
  app.timers.after(10_000, () => { chat.purge().catch((e) => log.warn('purge failed', { err: e.message })); });
  app.onStop(() => chat.flush());
}
