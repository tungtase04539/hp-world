// server/bots/worker.mjs — runs a slice of the bots in its own event loop (child process via fork, or worker thread).
// Parent → worker: {type:'init', cfg} then {type:'event', ev} / {type:'finish'}.
// Worker → parent: {type:'ready'}, {type:'tick', ...per-second deltas + CPU/RSS/ELU}, {type:'final', ...}.
import { isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { Bot } from './lib/bot.mjs';
import { installAbuse } from './lib/abuse.mjs';
import { buildRoadGraph } from './lib/roadgraph.mjs';
import { LogHist, LinHist, rng } from './lib/stats.mjs';

const port = !isMainThread && parentPort
  ? { post: (m) => parentPort.postMessage(m), on: (fn) => parentPort.on('message', fn), kind: 'thread' }
  : { post: (m, cb) => (process.send ? process.send(m, cb) : cb && cb()), on: (fn) => process.on('message', fn), kind: 'fork' };

const COUNTERS = ['connectOk', 'connectFail', 'authGuest', 'authRefresh', 'queued', 'resumeAttempt', 'resumeOk', 'resumeFail',
  'rxBytes', 'txBytes', 'msgsIn', 'msgsOut', 'snaps', 'keyframes', 'decodeErrors', 'corrects', 'chatSent', 'chatRecv',
  'chatRejected', 'names', 'capViolations', 'snapOverBudget', 'badSlot', 'drops', 'textFrames'];

function makeW() {
  const W = {
    c: Object.fromEntries(COUNTERS.map((k) => [k, 0])),
    rtt: new LogHist(), rttNetem: new LogHist(), connectMs: new LogHist(), authMs: new LogHist(), joinMs: new LogHist(), httpMs: new LogHist(),
    resumeMs: new LogHist(), resumeHsMs: new LogHist(), queuePos: new LinHist(100000), snapBytes: new LinHist(8192), snapRecords: new LinHist(512),
    opsIn: {}, http: {}, closes: {}, system: {}, correctReasons: {}, chatRejected: {}, decodeErr: {}, errors: {},
    bump(map, k, n = 1) { map[k] = (map[k] || 0) + n; },
    err(k) { this.errors[k] = (this.errors[k] || 0) + 1; },
  };
  return W;
}

let bots = [], W = null, ctx = null, cfg = null, timer = null, secTimer = null, t0 = 0, last = null, lastCpu = null, lastElu = null;
const pending = [];   // [startAt, spec] not yet started

function cpuNow() {
  if (port.kind === 'thread' && typeof process.threadCpuUsage === 'function') return process.threadCpuUsage();
  return process.cpuUsage();
}

function init(c) {
  cfg = c;
  W = makeW();
  const graph = buildRoadGraph();
  ctx = { W, graph, pool: {}, rand: rng(c.seed ^ (c.workerId * 0x9e3779b1)) };
  t0 = performance.now();
  for (const spec of c.bots) pending.push(spec);
  pending.sort((a, b) => a.startAt - b.startAt);
  last = { ...W.c }; lastCpu = cpuNow(); lastElu = performance.eventLoopUtilization();
  timer = setInterval(loop, c.tickMs || 20);
  secTimer = setInterval(second, 1000);
  port.post({ type: 'ready', workerId: c.workerId, graphNodes: graph.nodes, graphMs: graph.buildMs, baseRss: process.memoryUsage().rss });
}

function loop() {
  const now = performance.now();
  const el = now - t0;
  while (pending.length && pending[0].startAt <= el) {
    const spec = pending.shift();
    const b = new Bot(spec, ctx);
    if (spec.abuse) installAbuse(b, spec.abuse);
    if (spec.recordChat) b.recv = [];
    bots.push(b);
    b.start();
  }
  for (let i = 0; i < bots.length; i++) {
    const b = bots[i];
    if (b.s.stopAt && el >= b.s.stopAt && !b.stopped) b.stop();
    try { b.tick(now); } catch (e) { W.err('tick:' + (e.message || e)); }
  }
}

function second() {
  let live = 0, waiting = 0, connecting = 0;
  for (const b of bots) {
    b.second();
    if (b.state === 'live') live++;
    else if (b.state === 'wait') waiting++;
    else if (b.state !== 'done' && b.state !== 'idle') connecting++;
  }
  const d = {};
  for (const k of COUNTERS) { d[k] = W.c[k] - last[k]; }
  last = { ...W.c };
  const cpu = cpuNow(), elu = performance.eventLoopUtilization(lastElu);
  const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000;
  lastCpu = cpu; lastElu = performance.eventLoopUtilization();
  const mem = process.memoryUsage();
  port.post({
    type: 'tick', workerId: cfg.workerId, t: Math.round(performance.now() - t0), live, waiting, connecting,
    started: bots.length, d, cpuMs, elu: elu.utilization, rss: mem.rss, heap: mem.heapUsed,
  });
}

function onEvent(ev) {
  if (ev.kind === 'dropAll') {
    // every live bot loses its connection now and comes back after U(minMs, maxMs)
    for (const b of bots) if (b.state === 'live') b.drop(ev.minMs + ctx.rand() * (ev.maxMs - ev.minMs));
  } else if (ev.kind === 'stopAll') for (const b of bots) b.stop();
}

async function finish() {
  clearInterval(timer);
  for (const b of bots) if (!b.stopped) b.stop();
  pending.length = 0;
  await new Promise((r) => setTimeout(r, 600));
  clearInterval(secTimer);
  const histo = (h) => h.toJSON();
  port.post({
    type: 'final', workerId: cfg.workerId,
    c: W.c, opsIn: W.opsIn, http: W.http, closes: W.closes, system: W.system, correctReasons: W.correctReasons,
    chatRejected: W.chatRejected, decodeErr: W.decodeErr, errors: W.errors,
    hist: { rtt: histo(W.rtt), rttNetem: histo(W.rttNetem), connectMs: histo(W.connectMs), authMs: histo(W.authMs), joinMs: histo(W.joinMs), httpMs: histo(W.httpMs), resumeMs: histo(W.resumeMs), resumeHsMs: histo(W.resumeHsMs), queuePos: histo(W.queuePos), snapBytes: histo(W.snapBytes), snapRecords: histo(W.snapRecords) },
    records: bots.map((b) => b.r),
    recv: bots.filter((b) => b.recv && b.recv.length).map((b) => ({ idx: b.s.idx, netId: b.r.netId, recv: b.recv })),
    creds: bots.filter((b) => b.creds && b.creds.refreshToken).map((b) => ({ idx: b.s.idx, ...b.creds })),
  }, () => { if (port.kind === 'fork') setTimeout(() => process.exit(0), 50); });
  // exit only after the (large) final IPC message is flushed: exiting on a fixed 300 ms timer lost a whole worker's
  // results under load (integration 15/10/2026: reconnect run merged 800 of 1,000 bots). Safety net: 15 s.
  if (port.kind === 'fork') setTimeout(() => process.exit(0), 15000).unref();
}

port.on((m) => {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'init') init(m.cfg);
  else if (m.type === 'event') onEvent(m.ev);
  else if (m.type === 'finish') finish();
});
if (port.kind === 'fork') process.on('disconnect', () => process.exit(0));
