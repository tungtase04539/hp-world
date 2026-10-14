#!/usr/bin/env node
// server/bots/run.mjs — headless-bot load test for the Hải Phòng 3D game server (SPEC §3.4, ARCH §17).
//
//   node server/bots/run.mjs --scenario <smoke|ramp|hotspot|stress|reconnect|abuse|netem-lite>
//        --url http://127.0.0.1:9100 [--ws ws://127.0.0.1:9100/play] [--admin http://127.0.0.1:9101]
//        [--n N] [--dur S] [--out DIR] [--mode auto|full|ping] [--invite CODE] [--creds FILE]
//        [--workers K | --per-worker 200] [--proc fork|thread] [--seed 1] [--origin URL] [--netem-frac 0.3]
//        [--ramp S] [--drop-at S] [--drop-per-min R] [--scrape-ms 2000] [--capacity 1200] [--strict] [--quiet]
//
// GPU safety (SPEC §1.5): every run with > 300 bots or longer than 60 s must go through the GPU lock:
//   node tools/qa/gpulock.mjs run -- node server/bots/run.mjs ...      (this script warns when it is not under it)
// Output: <out>/report.json, <out>/report.md, <out>/timeseries.json (+ creds file when --creds is given).
import { fork } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, SCENARIOS } from './scenarios.mjs';
import { scrape, pick, cpuSnapshot, cpuBusyPct } from './lib/metrics.mjs';
import { mergeFinals, buildReport, renderMd } from './lib/report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const nx = argv[i + 1];
    if (nx === undefined || nx.startsWith('--')) o[k] = true; else { o[k] = nx; i++; }
  }
  return o;
}

async function detectMode(httpUrl) {
  try {
    const r = await fetch(httpUrl + '/v1/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
    if (r.status === 501 || r.status === 404) return 'ping';
    return 'full';
  } catch (e) {
    throw new Error(`server not reachable at ${httpUrl}: ${e.cause?.code || e.message}`);
  }
}

export async function runScenario(opts) {
  const o = { ...opts };
  const scenario = o.scenario || 'smoke';
  if (!SCENARIOS[scenario]) throw new Error(`unknown scenario ${scenario}; known: ${Object.keys(SCENARIOS).join(', ')}`);
  const httpUrl = String(o.url || 'http://127.0.0.1:9100').replace(/\/$/, '');
  const wsUrl = o.ws || httpUrl.replace(/^http/, 'ws') + '/play';
  const adminUrl = (o.admin || (() => { const u = new URL(httpUrl); u.port = String(+u.port + 1); return u.origin; })()).replace(/\/$/, '');
  const mode = !o.mode || o.mode === 'auto' ? await detectMode(httpUrl) : o.mode;
  const seed = +(o.seed ?? 1) >>> 0;
  const proc = o.proc === 'thread' ? 'thread' : 'fork';
  const log = o.quiet ? () => {} : (...a) => console.log(...a);
  const plan = buildPlan(scenario, {
    n: o.n != null ? +o.n : undefined, durS: o.dur != null ? +o.dur : undefined, mode,
    rampS: o.ramp != null ? +o.ramp : undefined, dropAtS: o.dropAt != null ? +o.dropAt : undefined,
    dropPerMin: o.dropPerMin != null ? +o.dropPerMin : undefined, netemFrac: o.netemFrac != null ? +o.netemFrac : undefined,
  });
  const sc = SCENARIOS[scenario];
  const steadyFromS = o.steadyFrom != null ? +o.steadyFrom : (o.ramp != null ? +o.ramp : sc.rampS) ?? Math.min(30, plan.durS * 0.3);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.resolve(o.out || path.join(process.cwd(), 'bot-out', `${scenario}-${stamp}`));
  fs.mkdirSync(out, { recursive: true });
  const underLock = !!process.env.HPWORLD_GPU_LOCK || !!o.gpuLock;
  if ((plan.n > 300 || plan.durS > 60) && !underLock) log(`[bots] CẢNH BÁO: ${plan.n} bot / ${plan.durS} s — SPEC §1.5 yêu cầu chạy dưới GPU lock (node tools/qa/gpulock.mjs run -- ...)`);

  // credentials cache (refresh tokens rotate on every use → written back at the end)
  let creds = {};
  if (o.creds && fs.existsSync(o.creds)) { try { creds = JSON.parse(fs.readFileSync(o.creds, 'utf8')); } catch { creds = {}; } }
  const runTag = o.deviceTag || 'hpbot';
  for (const s of plan.specs) {
    Object.assign(s, {
      mode, httpUrl, wsUrl, invite: o.invite || process.env.HPMP_BOT_INVITE || null, origin: o.origin || null, tier: 2,
      deviceId: `${runTag}-${s.idx}`, creds: creds[s.idx] || null,
    });
  }

  // workers
  const cores = os.availableParallelism();
  const perWorker = +(o.perWorker || 200);
  const nW = Math.max(1, Math.min(+(o.workers || Math.ceil(plan.n / perWorker)), Math.max(1, cores - 2), plan.n));
  const slices = Array.from({ length: nW }, () => []);
  plan.specs.forEach((s, i) => slices[i % nW].push(s));
  const workers = [];
  const latest = new Map();
  let accum = {};
  const finals = [];
  let finalsResolve;
  const finalsDone = new Promise((r) => { finalsResolve = r; });
  const onMsg = (m) => {
    if (m.type === 'tick') {
      latest.set(m.workerId, m);
      for (const k in m.d) accum[k] = (accum[k] || 0) + m.d[k];
    } else if (m.type === 'final') {
      finals.push(m);
      if (finals.length === workers.length) finalsResolve();
    } else if (m.type === 'ready') workers[m.workerId].ready = true;
  };
  const workerFile = path.join(HERE, 'worker.mjs');
  for (let w = 0; w < nW; w++) {
    const cfg = { workerId: w, seed, bots: slices[w], tickMs: +(o.tickMs || 20) };
    if (proc === 'fork') {
      const cp = fork(workerFile, [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], execArgv: [] });
      cp.on('message', onMsg);
      cp.on('exit', (code) => { if (code && !workers[w].finalSeen) log(`[bots] worker ${w} exited ${code}`); });
      workers.push({ id: w, send: (m) => { try { cp.send(m); } catch { /* gone */ } }, kill: () => { try { cp.kill(); } catch { /* ignore */ } }, ready: false });
      cp.send({ type: 'init', cfg });
    } else {
      const wt = new Worker(workerFile);
      wt.on('message', onMsg);
      wt.on('error', (e) => log(`[bots] worker ${w} error ${e.message}`));
      workers.push({ id: w, send: (m) => wt.postMessage(m), kill: () => wt.terminate(), ready: false });
      wt.postMessage({ type: 'init', cfg });
    }
  }
  const tReady = Date.now();
  while (!workers.every((w) => w.ready) && Date.now() - tReady < 30000) await new Promise((r) => setTimeout(r, 50));

  const meta = {
    scenario, startedAt: new Date().toISOString(), durS: plan.durS, n: plan.n, mode, url: httpUrl, wsUrl, adminUrl, seed,
    proc, workers: nW, cores, node: process.version, cpuModel: os.cpus()[0]?.model, totalMemGB: +(os.totalmem() / 2 ** 30).toFixed(1),
    scrapeMs: +(o.scrapeMs || 2000), steadyFromS, gpuLock: underLock, out,
  };
  log(`[bots] ${scenario}: ${plan.n} bot, ${plan.durS} s, mode=${mode}, ${nW} ${proc} worker(s) → ${httpUrl} · out ${out}`);

  // timeline
  const t0 = Date.now();
  const timers = [];
  for (const ev of plan.events) timers.push(setTimeout(() => { log(`[bots] t=${Math.round((Date.now() - t0) / 1000)}s event ${ev.kind}`); for (const w of workers) w.send({ type: 'event', ev }); }, ev.at));

  // scrape loop
  const ts = [];
  let lastCpu = cpuSnapshot(), lastScrapeT = Date.now(), lastLog = 0;
  const parentCpu0 = process.cpuUsage();
  const doScrape = async () => {
    const s = await scrape(adminUrl, httpUrl, o.adminToken);
    const now = Date.now();
    const cpu = cpuSnapshot();
    const dtS = (now - lastScrapeT) / 1000;
    let live = 0, waiting = 0, connecting = 0, cpuMs = 0, rss = 0, elu = 0;
    for (const m of latest.values()) { live += m.live; waiting += m.waiting; connecting += m.connecting; cpuMs += m.cpuMs; rss += m.rss; elu += m.elu; }
    if (proc === 'thread') rss = process.memoryUsage().rss;
    const entry = {
      t: now - t0, ok: s.ok, err: s.err, health: s.health, machineCpu: cpuBusyPct(lastCpu, cpu),
      server: s.m ? pick(s.m) : null,
      bots: {
        live, waiting, connecting, cpuPct: cpuMs / 10, rssMB: rss / 1048576, elu: latest.size ? elu / latest.size : NaN,
        rxBps: (accum.rxBytes || 0) / dtS, txBps: (accum.txBytes || 0) / dtS, msgsInPs: (accum.msgsIn || 0) / dtS,
        corrects: accum.corrects || 0, decodeErrors: accum.decodeErrors || 0, connectOk: accum.connectOk || 0, connectFail: accum.connectFail || 0,
      },
    };
    accum = {};
    lastCpu = cpu; lastScrapeT = now;
    ts.push(entry);
    if (now - lastLog >= 10000) {
      lastLog = now;
      const sv = entry.server || {};
      log(`[bots] t=${Math.round(entry.t / 1000)}s live=${live} wait=${waiting} conn=${connecting} rx=${(entry.bots.rxBps / 1024).toFixed(0)}KB/s botsCPU=${entry.bots.cpuPct.toFixed(0)}% botsRSS=${entry.bots.rssMB.toFixed(0)}MB | srv tick p99=${fmtN(sv.tickP99)} el p99=${fmtN(sv.elP99)} cpu=${fmtN(sv.cpu)}% rss=${fmtN(sv.rss / 1048576)}MB machine=${fmtN(entry.machineCpu)}%${s.ok ? '' : ' metrics:' + s.err}`);
    }
  };
  const scrapeTimer = setInterval(() => { doScrape().catch(() => {}); }, meta.scrapeMs);
  await doScrape();
  await new Promise((r) => setTimeout(r, plan.durS * 1000));
  clearInterval(scrapeTimer);
  for (const t of timers) clearTimeout(t);
  await doScrape();
  for (const w of workers) w.send({ type: 'finish' });
  await Promise.race([finalsDone, new Promise((r) => setTimeout(r, 20000))]);
  for (const w of workers) { w.finalSeen = true; setTimeout(() => w.kill(), 1500); }
  const pc = process.cpuUsage(parentCpu0);
  meta.parentCpuPct = +(((pc.user + pc.system) / 1000 / (plan.durS * 1000)) * 100).toFixed(2);
  meta.finalsReceived = finals.length;

  const merged = mergeFinals(finals);
  const rep = buildReport({ meta, plan, merged, ts, workers });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(rep, null, 1));
  fs.writeFileSync(path.join(out, 'timeseries.json'), JSON.stringify(ts));
  fs.writeFileSync(path.join(out, 'report.md'), renderMd(rep));
  if (o.creds) {
    for (const c of merged.creds) creds[c.idx] = { refreshToken: c.refreshToken, deviceId: c.deviceId, account: c.account, displayName: c.displayName };
    fs.mkdirSync(path.dirname(path.resolve(o.creds)), { recursive: true });
    fs.writeFileSync(o.creds, JSON.stringify(creds));
  }
  const fails = rep.acceptance.filter((a) => a.result === 'FAIL');
  log(`[bots] done: ${rep.acceptance.map((a) => `${a.result === 'PASS' ? 'OK' : a.result} ${a.name}`).join(' | ')}`);
  log(`[bots] report: ${path.join(out, 'report.md')}`);
  return { report: rep, out, fails };
}

function fmtN(v) { return Number.isFinite(v) ? v.toFixed(1) : '—'; }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || o.h) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n'));
    console.log('scenarios: ' + Object.entries(SCENARIOS).map(([k, v]) => `\n  ${k} (${v.n} bot, ${v.durS} s): ${v.desc}`).join(''));
    process.exit(0);
  }
  runScenario(o).then(({ fails }) => process.exit(o.strict && fails.length ? 1 : 0), (e) => { console.error('[bots] ' + (e.stack || e.message)); process.exit(2); });
}
