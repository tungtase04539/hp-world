// server/bots/lib/report.mjs — merge worker results + server scrapes into report.json, evaluate acceptance (SPEC §3.4),
// render report.md (Vietnamese headings, numbers first).
import { LogHist, LinHist, summarize, quantile } from './stats.mjs';
import { CORRECT_REASON, SYS, OP_NAMES, CHAT_CODE } from '../../../js/shared/protocol.js';
import { AOI } from '../../../js/shared/constants.js';
import { ABUSE } from './phrases.mjs';

const nameOf = (obj, v) => Object.keys(obj).find((k) => obj[k] === +v) || String(v);
const r1 = (v, d = 1) => (Number.isFinite(v) ? +v.toFixed(d) : null);

export function mergeFinals(finals) {
  const c = {}, maps = {}, hist = {};
  const MAPS = ['opsIn', 'http', 'closes', 'system', 'correctReasons', 'chatRejected', 'decodeErr', 'errors'];
  for (const k of MAPS) maps[k] = {};
  const records = [], recv = [], creds = [];
  for (const f of finals) {
    for (const k in f.c) c[k] = (c[k] || 0) + f.c[k];
    for (const k of MAPS) for (const kk in f[k] || {}) maps[k][kk] = (maps[k][kk] || 0) + f[k][kk];
    for (const k in f.hist) {
      const j = f.hist[k];
      if (!hist[k]) hist[k] = j.k === 'lin' ? new LinHist(j.maxV) : new LogHist(j.min, j.res, j.nb);
      hist[k].merge(j);
    }
    records.push(...f.records); recv.push(...(f.recv || [])); creds.push(...(f.creds || []));
  }
  records.sort((a, b) => a.idx - b.idx);
  return { c, maps, hist, records, recv, creds };
}

function seriesStats(ts, key, from = 0, to = Infinity) {
  const v = ts.filter((e) => e.t >= from && e.t <= to && e.server).map((e) => e.server[key]).filter(Number.isFinite);
  return { n: v.length, p50: r1(quantile(v, 0.5), 2), p95: r1(quantile(v, 0.95), 2), max: r1(v.length ? Math.max(...v) : NaN, 2), last: r1(v[v.length - 1], 2) };
}
function botSeriesStats(ts, key, from = 0, to = Infinity) {
  const v = ts.filter((e) => e.t >= from && e.t <= to && e.bots).map((e) => e.bots[key]).filter(Number.isFinite);
  return { n: v.length, p50: r1(quantile(v, 0.5), 2), p95: r1(quantile(v, 0.95), 2), max: r1(v.length ? Math.max(...v) : NaN, 2), mean: r1(v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN, 2) };
}

export function buildReport({ meta, plan, merged, ts, workers, raw }) {
  const { c, maps, hist, records } = merged;
  const durMs = meta.durS * 1000;
  const steadyFrom = (meta.steadyFromS ?? 0) * 1000;
  const honest = records.filter((r) => !r.abuse);
  const everLive = honest.filter((r) => r.connects > 0).length;
  const honestReasons = {};
  for (const r of honest) for (const k in r.correctReasons) honestReasons[k] = (honestReasons[k] || 0) + r.correctReasons[k];

  // bandwidth per client
  const avgBps = honest.filter((r) => r.connectedMs >= 5000).map((r) => r.rxBytes / (r.connectedMs / 1000));
  const peak = honest.map((r) => r.peak5sBps).filter((v) => v > 0);
  // honest corrections
  const longEnough = honest.filter((r) => r.connectedMs >= 30000);
  const corrPerMin = longEnough.map((r) => r.corrects / (r.connectedMs / 60000));
  const totCorr = honest.reduce((s, r) => s + r.corrects, 0), totMin = honest.reduce((s, r) => s + r.connectedMs, 0) / 60000;
  const netemBots = honest.filter((r) => r.netem && r.connectedMs >= 30000);

  const server = {
    tickP50: seriesStats(ts, 'tickP50', steadyFrom), tickP99: seriesStats(ts, 'tickP99', steadyFrom),
    tickP99All: seriesStats(ts, 'tickP99'), tickLateP99: seriesStats(ts, 'tickLateP99', steadyFrom),
    snapP99: seriesStats(ts, 'snapP99', steadyFrom), snapMetric: ts.find((e) => e.server?.snapName)?.server.snapName || null,
    eventLoopP99: seriesStats(ts, 'elP99', steadyFrom), eventLoopMax: seriesStats(ts, 'elMax', steadyFrom),
    cpuPct: seriesStats(ts, 'cpu', steadyFrom), rssMB: seriesStats(ts.map((e) => (e.server ? { ...e, server: { ...e.server, rssMB: e.server.rss / 1048576 } } : e)), 'rssMB'),
    ccu: seriesStats(ts, 'ccu'), ccuMetric: ts.find((e) => e.server?.ccuName)?.server.ccuName || null,
    degradeLevels: [], scrapesOk: ts.filter((e) => e.ok).length, scrapes: ts.length,
    healthAtEnd: ts.length ? ts[ts.length - 1].health : null,
    serverDecodeErrors: (() => { const v = ts.map((e) => e.server?.decodeErrorsServer).filter(Number.isFinite); return v.length ? v[v.length - 1] - v[0] : null; })(),
  };
  let lastLvl = null;
  for (const e of ts) {
    const l = e.server?.degrade;
    if (Number.isFinite(l) && l !== lastLvl) { server.degradeLevels.push({ t: Math.round(e.t / 1000), level: l }); lastLvl = l; }
  }
  const machineCpu = ts.map((e) => e.machineCpu).filter(Number.isFinite);
  const bots = {
    live: botSeriesStats(ts, 'live'), cpuPct: botSeriesStats(ts, 'cpuPct', steadyFrom), rssMB: botSeriesStats(ts, 'rssMB'),
    elu: botSeriesStats(ts, 'elu', steadyFrom), workers: workers.length, proc: meta.proc,
  };
  const liveSteady = botSeriesStats(ts, 'live', steadyFrom).p50 || bots.live.max || 0;
  bots.per100 = {
    cpuPctOneCore: liveSteady ? r1((bots.cpuPct.mean / liveSteady) * 100, 2) : null,
    rssMB: meta.n ? r1((bots.rssMB.max / meta.n) * 100, 1) : null,
    rssMBMarginal: meta.botsBaseRssMB != null && meta.n ? r1(((bots.rssMB.max - meta.botsBaseRssMB) / meta.n) * 100, 1) : null,
    baseRssMBPerWorker: meta.botsBaseRssMB != null ? r1(meta.botsBaseRssMB / Math.max(1, workers.length), 1) : null,
  };
  const cpuSplit = {
    machineBusyPct: { mean: r1(machineCpu.length ? machineCpu.reduce((s, v) => s + v, 0) / machineCpu.length : NaN), max: r1(machineCpu.length ? Math.max(...machineCpu) : NaN) },
    cores: meta.cores,
    serverPctOneCore: server.cpuPct.p50, botsPctOneCore: bots.cpuPct.mean,
  };

  const resume = {
    attempts: c.resumeAttempt || 0, ok: c.resumeOk || 0, fail: c.resumeFail || 0,
    rate: c.resumeAttempt ? r1((c.resumeOk / c.resumeAttempt) * 100, 2) : null,
    ms: hist.resumeMs?.summary(0) || null, handshakeMs: hist.resumeHsMs?.summary(1) || null,
    botsNetIdChanged: records.filter((r) => r.netIds.length > 1).length,
  };

  // abuse
  let abuse = null;
  const ab = records.filter((r) => r.abuse);
  if (ab.length) {
    abuse = { classes: {}, chatBypass: null };
    for (const r of ab) {
      const a = r.abuse;
      const k = a.cls;
      const e = abuse.classes[k] || (abuse.classes[k] = { n: 0, started: 0, detected: 0, within1s: 0, lat: [], via: {}, skipped: 0 });
      e.n++;
      if (a.extra?.skipped) { e.skipped++; continue; }
      if (a.t0) e.started++;
      if (a.detected) { e.detected++; e.lat.push(a.latencyMs); e.via[a.via] = (e.via[a.via] || 0) + 1; if (a.latencyMs <= (k === 'no_hello' ? 11000 : 1000)) e.within1s++; }
    }
    for (const k in abuse.classes) {
      const e = abuse.classes[k];
      e.rate = e.started ? r1((e.detected / e.started) * 100, 1) : null;
      e.withinLimitRate = e.started ? r1((e.within1s / e.started) * 100, 1) : null;
      e.latencyMs = summarize(e.lat, 1); delete e.lat;
    }
    // chat bypass: what did the observers receive from the abusers?
    const byp = ab.filter((r) => r.abuse.cls === 'chat_bypass');
    if (byp.length) {
      const abuserIds = new Set(byp.map((r) => r.netId).filter((v) => v >= 0));
      const raw = new Set(ABUSE);
      let leaked = 0, masked = 0, recvFromAbusers = 0;
      const leakSamples = [];
      for (const o of merged.recv) for (const [from, text] of o.recv) {
        if (!abuserIds.has(from)) continue;
        recvFromAbusers++;
        if (raw.has(text)) { leaked++; if (leakSamples.length < 10) leakSamples.push(text); } else masked++;
      }
      const sent = byp.reduce((s, r) => s + (r.abuse.extra?.lines?.length || 0), 0);
      const rejected = byp.reduce((s, r) => s + (r.abuse.extra?.rejected || 0), 0);
      // the sender's own echo is what everyone within 40 m received (independent of whether an observer stood nearby)
      const echoVerbatim = byp.reduce((s, r) => s + (r.abuse.extra?.echoVerbatim || 0), 0);
      const echoMasked = byp.reduce((s, r) => s + (r.abuse.extra?.echoMasked || 0), 0);
      for (const r of byp) for (const t of r.abuse.extra?.leakLines || []) if (leakSamples.length < 10 && !leakSamples.includes(t)) leakSamples.push(t);
      abuse.chatBypass = { abusers: byp.length, linesSent: sent, rejected, rejectedPct: sent ? r1((rejected / sent) * 100, 1) : null, observerReceived: recvFromAbusers,
        leakedVerbatim: leaked + echoVerbatim, deliveredMasked: masked + echoMasked, leakObserved: leaked, echoVerbatim, echoMasked, leakSamples, observers: merged.recv.length };
    }
  }

  const rep = {
    meta,
    scenario: { name: plan.name, desc: plan.desc, n: plan.n, durS: plan.durS, events: plan.events },
    connect: {
      bots: records.length, honestBots: honest.length, everLive, everLivePct: r1((everLive / Math.max(1, honest.length)) * 100, 1),
      connectOk: c.connectOk, connectFail: c.connectFail, queued: c.queued, authGuest: c.authGuest, authRefresh: c.authRefresh,
      connectMs: hist.connectMs?.summary(1), authMs: hist.authMs?.summary(1), joinMs: hist.joinMs?.summary(1), queuePos: hist.queuePos?.summary(),
      closes: maps.closes, system: Object.fromEntries(Object.entries(maps.system).map(([k, v]) => [nameOf(SYS, k), v])), http: maps.http, errors: maps.errors,
    },
    traffic: {
      rxBytes: c.rxBytes, txBytes: c.txBytes, msgsIn: c.msgsIn, msgsOut: c.msgsOut,
      opsIn: Object.fromEntries(Object.entries(maps.opsIn).map(([k, v]) => [OP_NAMES[k] || k, v])),
      perClientAvgBps: summarize(avgBps, 0), perClientPeak5sBps: summarize(peak, 0),
      clientsOver12KBps: peak.filter((v) => v > 12 * 1024).length,
    },
    snapshots: {
      count: c.snaps, keyframes: c.keyframes, bytes: hist.snapBytes?.summary(), records: hist.snapRecords?.summary(),
      overBudget: c.snapOverBudget, capViolations: c.capViolations, maxRecordsAnyBot: Math.max(0, ...records.map((r) => r.maxRecords)),
      maxVisibleAnyBot: Math.max(0, ...records.map((r) => r.maxVisible)), badSlot: c.badSlot, names: c.names,
    },
    decode: { errors: c.decodeErrors, kinds: maps.decodeErr, textFrames: c.textFrames, serverSide: server.serverDecodeErrors },
    rtt: hist.rtt?.summary(2), rttNetem: hist.rttNetem?.n ? hist.rttNetem.summary(2) : null,
    corrections: {
      honestTotal: totCorr, honestPerBotPerMin: r1(totMin ? totCorr / totMin / Math.max(1, 1) : NaN, 3),
      perBotPerMin: summarize(corrPerMin, 3), botsOver2PerMin: corrPerMin.filter((v) => v >= 2).length,
      reasons: Object.fromEntries(Object.entries(honestReasons).map(([k, v]) => [nameOf(CORRECT_REASON, k), v])),
      reasonsAll: Object.fromEntries(Object.entries(maps.correctReasons).map(([k, v]) => [nameOf(CORRECT_REASON, k), v])),
      netemBots: netemBots.length, netemPerBotPerMin: summarize(netemBots.map((r) => r.corrects / (r.connectedMs / 60000)), 3),
    },
    chat: { sent: c.chatSent, recv: c.chatRecv, rejected: c.chatRejected, rejectedCodes: Object.fromEntries(Object.entries(maps.chatRejected).map(([k, v]) => [nameOf(CHAT_CODE, k), v])), honestRejected: honest.reduce((s, r) => s + r.chatRejected, 0) },
    resume, server, bots, cpuSplit, abuse,
  };
  rep.serverCounters = {};
  if (raw?.first && raw?.last) for (const k of Object.keys(raw.last)) if (/_total({|$)/.test(k)) { const d = raw.last[k] - (raw.first[k] || 0); if (d) rep.serverCounters[k] = d; }
  rep.acceptance = accept(rep, meta);
  return rep;
}

// ---- acceptance (SPEC §3.4) -----------------------------------------------------------------------------------------
function chk(name, value, op, limit, unit = '') {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return { name, value: null, limit: `${op} ${limit}${unit}`, result: 'n/a' };
  const ok = op === '<' ? value < limit : op === '<=' ? value <= limit : op === '>=' ? value >= limit : op === '==' ? value === limit : false;
  return { name, value, limit: `${op} ${limit}${unit}`, result: ok ? 'PASS' : 'FAIL' };
}
export function accept(rep, meta) {
  const s = rep.scenario.name, out = [];
  const full = meta.mode === 'full';
  out.push(chk('lỗi giải mã phía bot', rep.decode.errors, '==', 0));
  out.push(chk('bot vào được (%)', rep.connect.everLivePct, '>=', s === 'stress' ? 0 : 99, ' %'));
  if (['smoke', 'ramp', 'netem-lite', 'hotspot'].includes(s)) {
    out.push(chk('CORRECT bot trung thực / phút / bot (tổng)', rep.corrections.honestPerBotPerMin, '<', 2));
    out.push(chk('bot trung thực ≥ 2 CORRECT/phút', rep.corrections.botsOver2PerMin, '==', 0));
  }
  if (s === 'ramp' || s === 'smoke') {
    out.push(chk('tick p99 (max, pha ổn định)', rep.server.tickP99.max, '<', 25, ' ms'));
    out.push(chk('snapshot p95 (B)', rep.snapshots.bytes?.p95 ?? null, '<', 1100, ' B'));
    out.push(chk('RSS máy chủ max', rep.server.rssMB.max, '<', 1536, ' MB'));
    out.push(chk('lắp snapshot p99 (max)', rep.server.snapP99.max, '<', 25, ' ms'));
    out.push(chk('event-loop p99 (max)', rep.server.eventLoopP99.max, '<', 20, ' ms'));
  }
  if (s === 'hotspot') {
    out.push(chk('bản ghi/snapshot max (trần 96)', rep.snapshots.count ? rep.snapshots.maxRecordsAnyBot : null, '<=', AOI.CAP));
    out.push(chk('client > 12 KB/s (đỉnh 5 s)', rep.snapshots.count ? rep.traffic.clientsOver12KBps : null, '==', 0));
    out.push(chk('tick p99 (max)', rep.server.tickP99.max, '<', 40, ' ms'));
  }
  if (s === 'stress') {
    const lv = rep.server.degradeLevels.map((d) => d.level);
    let ordered = lv.length ? true : null;
    for (let i = 1; i < lv.length; i++) if (lv[i] > lv[i - 1] + 1) ordered = false;
    out.push({ name: 'thang suy giảm đúng thứ tự', value: lv.length ? lv.join('→') : null, limit: 'tăng từng bậc', result: ordered == null ? 'n/a' : ordered ? 'PASS' : 'FAIL' });
    out.push({ name: 'không sập (health cuối)', value: rep.server.healthAtEnd?.ok ?? null, limit: 'ok', result: rep.server.healthAtEnd?.ok ? 'PASS' : 'FAIL' });
    out.push(full ? chk('hàng đợi hoạt động (lượt xếp hàng)', rep.connect.queued, '>=', 1) : { name: 'hàng đợi hoạt động', value: null, limit: '≥ 1', result: 'n/a' });
  }
  if (s === 'reconnect') {
    out.push(full ? chk('resume giữ đúng netId (%)', rep.resume.rate, '>=', 100, ' %') : { name: 'resume giữ đúng netId', value: null, limit: '100 %', result: 'n/a' });
  }
  if (s === 'abuse' && rep.abuse) {
    for (const [k, e] of Object.entries(rep.abuse.classes)) {
      if (k === 'speed_hack') out.push(chk('speed-hack phát hiện (%)', e.rate, '>=', 99, ' %'));
      out.push(chk(`${k}: chặn/đóng trong ${k === 'no_hello' ? '11 s' : '1 s'} (%)`, e.withinLimitRate, '>=', 100, ' %'));
    }
    if (rep.abuse.chatBypass) out.push(chk('chat lách lọc lọt nguyên văn tới người khác', rep.abuse.chatBypass.leakedVerbatim, '==', 0));
  }
  return out;
}

// ---- markdown ---------------------------------------------------------------------------------------------------------
const fmt = (v, d = 1) => (v == null || (typeof v === 'number' && !Number.isFinite(v)) ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : v.toFixed(d)) : String(v));
const sm = (o, unit = '', d = 1) => (o && o.n ? `p50 ${fmt(o.p50, d)}${unit} · p95 ${fmt(o.p95, d)}${unit} · p99 ${fmt(o.p99 ?? o.max, d)}${unit} · max ${fmt(o.max, d)}${unit} (n ${fmt(o.n)})` : '—');
const ss = (o, unit = '', d = 2) => (o && o.n ? `p50 ${fmt(o.p50, d)}${unit} · p95 ${fmt(o.p95, d)}${unit} · max ${fmt(o.max, d)}${unit}` : '—');

export function renderMd(r) {
  const L = [];
  const m = r.meta;
  L.push(`# Báo cáo load test — kịch bản \`${r.scenario.name}\``, '');
  L.push(`${r.scenario.desc}`, '');
  L.push(`- Thời điểm: ${m.startedAt} · thời lượng ${m.durS} s · ${r.scenario.n} bot · chế độ kết nối **${m.mode}**${m.mode === 'ping' ? ' (máy chủ nền móng: /v1/auth trả 501 → chỉ HELLO→SYSTEM NOT_IMPLEMENTED + STATE/PING/CHAT, không có WELCOME/snapshot)' : ''}`);
  L.push(`- Máy chủ: ${m.url} (WS ${m.wsUrl}, metrics ${m.adminUrl}) · transport ${r.server.healthAtEnd?.transport ?? '—'}`);
  L.push(`- Bot: ${r.bots.workers} ${m.proc === 'fork' ? 'tiến trình con' : 'worker thread'} · máy ${m.cores} luồng CPU · Node ${m.node} · seed ${m.seed}${m.gpuLock ? ' · chạy dưới GPU lock' : ''}`);
  L.push('');
  L.push('## Tiêu chí đạt', '', '| Tiêu chí | Giá trị | Ngưỡng | Kết quả |', '|---|---|---|---|');
  for (const a of r.acceptance) L.push(`| ${a.name} | ${fmt(a.value, 2)} | ${a.limit} | ${a.result} |`);
  L.push('');
  L.push('## Máy chủ (từ /metrics, pha ổn định)', '');
  L.push(`| Chỉ số | Giá trị |`, '|---|---|');
  L.push(`| tick sim p99 (cửa sổ trượt, qua các lần đọc) | ${ss(r.server.tickP99, ' ms')} |`);
  L.push(`| tick sim p50 | ${ss(r.server.tickP50, ' ms')} |`);
  L.push(`| lắp snapshot p99 (\`${r.server.snapMetric || 'chưa có metric'}\`) | ${ss(r.server.snapP99, ' ms')} |`);
  L.push(`| event-loop p99 / max | ${ss(r.server.eventLoopP99, ' ms')} / ${ss(r.server.eventLoopMax, ' ms')} |`);
  L.push(`| CPU tiến trình máy chủ (% 1 lõi) | ${ss(r.server.cpuPct, ' %', 1)} |`);
  L.push(`| RSS máy chủ | ${ss(r.server.rssMB, ' MB', 0)} |`);
  L.push(`| CCU (\`${r.server.ccuMetric || '—'}\`) | ${ss(r.server.ccu, '', 0)} |`);
  L.push(`| thang suy giảm | ${r.server.degradeLevels.length ? r.server.degradeLevels.map((d) => `L${d.level}@${d.t}s`).join(' → ') : '— (chưa có hp_degrade_level)'} |`);
  L.push(`| lần đọc metrics OK | ${r.server.scrapesOk}/${r.server.scrapes} |`);
  L.push('');
  const sc = Object.entries(r.serverCounters || {});
  if (sc.length) {
    L.push('Bộ đếm máy chủ tăng trong lần chạy (`*_total`, lần đọc cuối − đầu): ' + sc.slice(0, 40).map(([k, v]) => `\`${k.replace(/^hp_/, '')}\` ${fmt(v)}`).join(' · '), '');
  }
  L.push('## Chia CPU / RAM (máy chủ và bot chạy chung máy)', '');
  L.push('| | Giá trị |', '|---|---|');
  L.push(`| CPU cả máy bận (tất cả ${r.cpuSplit.cores} luồng) | TB ${fmt(r.cpuSplit.machineBusyPct.mean)} % · max ${fmt(r.cpuSplit.machineBusyPct.max)} % |`);
  L.push(`| tiến trình máy chủ (% của 1 lõi, p50) | ${fmt(r.cpuSplit.serverPctOneCore)} % |`);
  L.push(`| toàn bộ bot (% của 1 lõi, TB) | ${fmt(r.cpuSplit.botsPctOneCore)} % |`);
  L.push(`| bot: CPU mỗi 100 bot đang sống | ${fmt(r.bots.per100.cpuPctOneCore, 2)} % của 1 lõi |`);
  L.push(`| bot: RSS tổng (max) · chia đều mỗi 100 bot | ${fmt(r.bots.rssMB.max, 0)} MB · ${fmt(r.bots.per100.rssMB, 1)} MB |`);
  L.push(`| bot: RSS nền mỗi tiến trình (trước khi có bot) · RSS biên mỗi 100 bot | ${fmt(r.bots.per100.baseRssMBPerWorker, 1)} MB · ${fmt(r.bots.per100.rssMBMarginal, 1)} MB |`);
  L.push(`| bot: event-loop utilisation (TB) | ${fmt(r.bots.elu.mean, 3)} |`);
  L.push(`| bot sống (max / p50) | ${fmt(r.bots.live.max, 0)} / ${fmt(r.bots.live.p50, 0)} |`);
  L.push('');
  L.push('## Phía bot', '');
  L.push('| Chỉ số | Giá trị |', '|---|---|');
  L.push(`| bot trung thực từng vào được | ${r.connect.everLive}/${r.connect.honestBots} (${fmt(r.connect.everLivePct)} %) |`);
  L.push(`| kết nối OK / lỗi / xếp hàng | ${fmt(r.connect.connectOk)} / ${fmt(r.connect.connectFail)} / ${fmt(r.connect.queued)} |`);
  L.push(`| thời gian mở WS | ${sm(r.connect.connectMs, ' ms')} |`);
  if (r.connect.authMs?.n) L.push(`| auth / join HTTP | ${sm(r.connect.authMs, ' ms')} / ${sm(r.connect.joinMs, ' ms')} |`);
  L.push(`| RTT PING→PONG${r.rttNetem ? ' (bot không netem)' : ''} | ${sm(r.rtt, ' ms', 2)} |`);
  if (r.rttNetem) L.push(`| RTT PING→PONG (bot netem) | ${sm(r.rttNetem, ' ms', 2)} |`);
  L.push(`| băng thông xuống mỗi client (TB) | ${sm(r.traffic.perClientAvgBps, ' B/s', 0)} |`);
  L.push(`| băng thông xuống mỗi client (đỉnh 5 s) | ${sm(r.traffic.perClientPeak5sBps, ' B/s', 0)} · > 12 KB/s: ${r.traffic.clientsOver12KBps} |`);
  L.push(`| snapshot | ${fmt(r.snapshots.count)} (keyframe ${fmt(r.snapshots.keyframes)}) · cỡ ${sm(r.snapshots.bytes, ' B', 0)} |`);
  L.push(`| bản ghi / snapshot | ${sm(r.snapshots.records, '', 0)} · vượt trần ${r.snapshots.capViolations} · > 1.100 B: ${r.snapshots.overBudget} · slot lạ ${r.snapshots.badSlot} |`);
  L.push(`| lỗi giải mã (bot / máy chủ) | ${fmt(r.decode.errors)} / ${fmt(r.decode.serverSide)} ${Object.keys(r.decode.kinds).length ? JSON.stringify(r.decode.kinds) : ''} |`);
  L.push(`| CORRECT bot trung thực | ${fmt(r.corrections.honestTotal)} = ${fmt(r.corrections.honestPerBotPerMin, 3)} /bot/phút · ${JSON.stringify(r.corrections.reasons)} |`);
  if (r.corrections.netemBots) L.push(`| CORRECT bot netem | ${sm(r.corrections.netemPerBotPerMin, '/phút', 3)} (${r.corrections.netemBots} bot) |`);
  L.push(`| chat gửi / nhận / bị từ chối (bot trung thực) | ${fmt(r.chat.sent)} / ${fmt(r.chat.recv)} / ${fmt(r.chat.honestRejected)} ${JSON.stringify(r.chat.rejectedCodes)} |`);
  L.push(`| tin vào theo opcode | ${Object.entries(r.traffic.opsIn).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')} |`);
  L.push(`| SYSTEM nhận | ${JSON.stringify(r.connect.system)} |`);
  L.push(`| mã đóng WS | ${JSON.stringify(r.connect.closes)} |`);
  if (Object.keys(r.connect.errors).length) L.push(`| lỗi | ${JSON.stringify(r.connect.errors).slice(0, 400)} |`);
  if (Object.keys(r.connect.http).length) L.push(`| HTTP | ${JSON.stringify(r.connect.http)} |`);
  L.push(`| resume | thử ${r.resume.attempts} · đúng netId ${r.resume.ok} · hỏng ${r.resume.fail}${r.resume.rate != null ? ` (${r.resume.rate} %)` : ''} · từ lúc rớt: ${sm(r.resume.ms, ' ms', 0)} · bắt tay resume: ${sm(r.resume.handshakeMs, ' ms', 1)} |`);
  L.push('');
  if (r.abuse) {
    L.push('## Lạm dụng', '', '| Lớp | n | bắt đầu | phát hiện | % | trong hạn | độ trễ | qua tín hiệu |', '|---|---|---|---|---|---|---|---|');
    for (const [k, e] of Object.entries(r.abuse.classes)) {
      L.push(`| ${k} | ${e.n} | ${e.started} | ${e.detected} | ${fmt(e.rate)} | ${fmt(e.withinLimitRate)} % | ${e.latencyMs.n ? `p50 ${fmt(e.latencyMs.p50)} · max ${fmt(e.latencyMs.max)} ms` : '—'} | ${JSON.stringify(e.via)}${e.skipped ? ` (bỏ ${e.skipped})` : ''} |`);
    }
    const cb = r.abuse.chatBypass;
    if (cb) L.push('', `Lách lọc chat: ${cb.abusers} bot gửi ${cb.linesSent} dòng · bị từ chối ${cb.rejected} (${fmt(cb.rejectedPct)} %) · ${cb.observers} bot quan sát nhận ${cb.observerReceived} tin từ kẻ lách; tin vọng lại người gửi (= điều người trong 40 m nhận): nguyên văn ${cb.echoVerbatim ?? 0}, đã che ${cb.echoMasked ?? 0} · **lọt nguyên văn tổng ${cb.leakedVerbatim}**${cb.leakSamples?.length ? " (" + cb.leakSamples.map((x) => JSON.stringify(x)).join(", ") + ")" : ""}, đã che tổng ${cb.deliveredMasked}.`);
    L.push('');
  }
  L.push('## Ghi chú', '');
  L.push('- Số máy chủ là cửa sổ trượt 2.048 mẫu của `server/src/metrics.js` (tick 20 Hz → ~100 s), đọc mỗi ' + (m.scrapeMs / 1000) + ' s; "max" = lần đọc tệ nhất trong pha ổn định (từ giây ' + Math.round(m.steadyFromS ?? 0) + ').');
  L.push('- CPU "% của 1 lõi": 100 % = một luồng CPU bận hoàn toàn. Bot và máy chủ chạy chung máy → con số máy chủ là cận trên của máy riêng.');
  L.push('- Băng thông = byte payload WebSocket nhận được (chưa tính ~68 B overhead WS+TLS+TCP/IP mỗi tin).');
  return L.join('\n') + '\n';
}
