// tools/qa/mp_converge.mjs — BOT TRUNG THỰC KHÔNG BAO GIỜ BỊ CORRECT (riders fixer 15/10/2026), không Chrome.
// Máy chủ THẬT chế độ test (HPMP_TEST=1, cổng riêng) + N bot S4 TRONG tiến trình (đúng cách tools/qa/mp2_int_e2e.mjs chạy:
// một vòng setInterval 20 ms tick mọi bot với cùng `now`) đi xe máy dồn về một điểm xuất hiện rồi đi bộ quanh đó;
// --pauseEveryS: chèn chỗ khựng vòng sự kiện 120–280 ms GIỮA vòng tick (mô phỏng GC / IPC Playwright của e2e);
// --restartAtS: tắt máy chủ rồi bật lại (bot vào PHIÊN MỚI — điểm máy chủ = vị trí đã lưu ≤ 30 s trước).
// ĐẠT khi 0 CORRECT ở mọi bot và 0 dòng "correct" trong log máy chủ. Tự giữ khoá GPU (chạy > 60 s — KNOWLEDGE §8).
//   node tools/qa/mp_converge.mjs --game 9310 --bots 96 --dur 240 --pauseEveryS 2 --restartAtS 170 --out <dir>
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { args } from './launch.mjs';
import { acquireGpu } from './gpulock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const A = args();
const GAME = +A.get('game', 9310), N = +A.get('bots', 96), DUR = +A.get('dur', 240) * 1000;
const PAUSE_EVERY = +A.get('pauseEveryS', 0) * 1000, RESTART = +A.get('restartAtS', 0) * 1000;
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2b/converge'));
const DATA = path.join(OUT, 'data');
fs.mkdirSync(DATA, { recursive: true });
const HTTP = `http://127.0.0.1:${GAME}`, ADMIN = `http://127.0.0.1:${GAME + 1}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = performance.now();
const ts = () => +((performance.now() - T0) / 1000).toFixed(2);
const u = (p) => pathToFileURL(path.join(ROOT, p)).href;

let srv = null;
function startServer(tag) {
  const log = fs.openSync(path.join(OUT, `server_${tag}.log`), 'a');
  srv = spawn(process.execPath, ['src/main.js'], { cwd: path.join(ROOT, 'server'), stdio: ['ignore', log, log],
    env: { ...process.env, HPMP_TEST: '1', GAME_PORT: String(GAME), ADMIN_PORT: String(GAME + 1), PGLITE_DIR: path.join(DATA, 'pglite'), DATA_DIR: DATA, LOG_LEVEL: 'info' } });
}
async function waitHealth() { for (let i = 0; i < 150; i++) { try { const r = await fetch(HTTP + '/healthz'); if (r.ok) return; } catch { /* chưa lên */ } await sleep(300); } throw new Error('máy chủ không lên'); }
const killServer = () => new Promise((res) => { if (!srv || srv.exitCode != null) return res(); srv.once('exit', res); srv.kill(); });
const tok = () => fs.readFileSync(path.join(ROOT, 'server', '.env'), 'utf8').match(/^ADMIN_TOKEN=(.+)$/m)[1].trim();

const release = await acquireGpu(`mp_converge ${N} bot :${GAME}`);
const result = { startedAt: new Date().toISOString(), n: N, durS: DUR / 1000, pauseEveryS: PAUSE_EVERY / 1000, restartAtS: RESTART / 1000, events: [] };
let bots = [], timer = null, watch = null;
try {
  startServer('a'); await waitHealth();
  const inv = await (await fetch(ADMIN + '/admin/api/invites', { method: 'POST', headers: { authorization: 'Bearer ' + tok(), 'content-type': 'application/json' },
    body: JSON.stringify({ count: 1, uses: N + 10, days: 1, note: 'mp_converge' }) })).json();
  const invite = inv.codes[0];
  const { Bot } = await import(u('server/bots/lib/bot.mjs'));
  const { buildRoadGraph } = await import(u('server/bots/lib/roadgraph.mjs'));
  const { LogHist, LinHist, rng } = await import(u('server/bots/lib/stats.mjs'));
  const { SPAWNS } = await import(u('js/shared/spawns.js'));
  const W = { c: new Proxy({}, { get: (o, k) => o[k] || 0, set: (o, k, v) => { o[k] = v; return true; } }),
    rtt: new LogHist(), rttNetem: new LogHist(), connectMs: new LogHist(), authMs: new LogHist(), joinMs: new LogHist(), httpMs: new LogHist(),
    resumeMs: new LogHist(), resumeHsMs: new LogHist(), queuePos: new LinHist(100000), snapBytes: new LinHist(8192), snapRecords: new LinHist(512),
    opsIn: {}, http: {}, closes: {}, system: {}, correctReasons: {}, chatRejected: {}, decodeErr: {}, errors: {},
    bump(map, k, v = 1) { map[k] = (map[k] || 0) + v; }, err(k) { this.errors[k] = (this.errors[k] || 0) + 1; } };
  const ctx = { W, graph: buildRoadGraph(), pool: {}, rand: rng(7) };
  const target = { x: SPAWNS[0].x, z: SPAWNS[0].z };
  let nextPause = PAUSE_EVERY ? performance.now() + PAUSE_EVERY : Infinity, pauses = 0, k = 0;
  timer = setInterval(() => {
    const now = performance.now();
    const doPause = now >= nextPause;
    if (doPause) { nextPause = now + PAUSE_EVERY; pauses++; }
    bots.forEach((b, i) => {
      if (doPause && i === bots.length >> 1) { const until = performance.now() + 120 + (k++ % 5) * 40; while (performance.now() < until) { /* khựng */ } }
      try { b.tick(now); } catch { W.err('tick'); }
    });
  }, 20);
  for (let i = 0; i < N; i++) {
    const dev = `mpconv-${i}-${Date.now() % 100000}`;
    const g = await (await fetch(HTTP + '/v1/auth/guest', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: 'Người lái ' + i, inviteCode: invite, deviceId: dev }) })).json();
    const b = new Bot({ idx: i, behavior: 'plaza', target: { x: target.x + (Math.random() - 0.5) * 6, z: target.z + (Math.random() - 0.5) * 6, r: i % 4 === 3 ? 26 : 13 },
      travelMode: 4, chat: false, dropPerMin: 0, mode: 'full', httpUrl: HTTP, wsUrl: HTTP.replace('http', 'ws') + '/play', invite, origin: null, tier: 2, deviceId: dev,
      creds: g.refreshToken ? { refreshToken: g.refreshToken } : null }, ctx);
    bots.push(b); b.start(); await sleep(40);
  }
  const seen = new Map();
  watch = setInterval(() => {
    for (const b of bots) {
      const c = b.r.corrects;
      if (c !== (seen.get(b) || 0)) {
        seen.set(b, c);
        const e = { t: ts(), bot: b.s.idx, netId: b.r.netId, corrects: c, reasons: { ...b.r.correctReasons }, mode: b.mode, v: +b.v.toFixed(2), plaza: !!b.plaza };
        result.events.push(e); console.log(JSON.stringify(e));
      }
    }
  }, 25);
  const tStart = performance.now();
  let restarted = false;
  while (performance.now() - tStart < DUR) {
    await sleep(1000);
    if (RESTART && !restarted && performance.now() - tStart > RESTART) {
      restarted = true;
      const plaza = bots.filter((b) => b.plaza).length;
      console.log(`[${ts()}s] tắt máy chủ (${plaza}/${N} bot đang đi bộ quanh điểm hẹn)`); result.events.push({ t: ts(), restart: true, plaza });
      await killServer(); await sleep(4000); startServer('b'); await waitHealth();
    }
  }
  clearInterval(watch);
  const lines = ['a', 'b'].flatMap((t) => { try { return fs.readFileSync(path.join(OUT, `server_${t}.log`), 'utf8').split('\n').filter((l) => l.includes('"msg":"correct"')); } catch { return []; } });
  result.sum = { live: bots.filter((b) => b.state === 'live').length, inPlaza: bots.filter((b) => b.plaza).length, corrects: bots.reduce((s, b) => s + b.r.corrects, 0),
    reasons: W.correctReasons, serverCorrectLines: lines.length, pauses, resumeOk: W.c.resumeOk, connects: W.c.connectOk, errors: W.errors };
  result.pass = result.sum.corrects === 0 && lines.length === 0 && result.sum.live === N;
} catch (e) {
  result.error = String(e && e.stack || e);
} finally {
  clearInterval(timer); clearInterval(watch);
  for (const b of bots) { try { b.stop(); } catch { /* ignore */ } }
  await sleep(800);
  await killServer();
  release();
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'converge.json'), JSON.stringify(result, null, 2));
  console.log('KẾT QUẢ', JSON.stringify(result.sum || result.error), result.pass ? 'ĐẠT' : 'TRƯỢT');
  process.exit(result.pass ? 0 : 1);
}
