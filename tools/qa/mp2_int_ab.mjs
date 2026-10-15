// tools/qa/mp2_int_ab.mjs — A/B CÙNG PHIÊN chế độ MỘT MÌNH (không máy chủ): bản base (vd. dot3 phục vụ ở --base) với bản
// tích hợp MP-2 (--port). Mỗi lượt chạy tools/qa/shoot.mjs --perf trên views_std (24 góc, giao thông bật = chi phí thật),
// XEN KẼ thứ tự base/after giữa các lượt; shoot.mjs giữ khoá GPU (1 Chrome mỗi lúc).
//   node tools/qa/mp2_int_ab.mjs --base 8814 --port 8813 --rounds 3 --out C:/Users/Admin/hp-world-work/mp2/int/ab
//   [--uncapped 1] (mặc định: Chrome --disable-gpu-vsync --disable-frame-rate-limit → fps không kẹp 60) [--quality full]
// Ra: <out>/<side>_r<k>/_result.json + ảnh, <out>/ab.json (trung vị hpReady/startReady, trung vị từng góc calls/tris/fps).
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { args } from './launch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = args();
const BASE = +A.get('base', 8814), PORT = +A.get('port', 8813), ROUNDS = +A.get('rounds', 3);
const OUT = path.resolve(A.get('out', 'C:/Users/Admin/hp-world-work/mp2/int/ab'));
const Q = A.get('quality', 'full');
const UNCAPPED = A.get('uncapped', '1') !== '0';
fs.mkdirSync(OUT, { recursive: true });
const run = (port, out) => new Promise((res) => {
  const a = [path.join(HERE, 'shoot.mjs'), '--port', String(port), '--out', out, '--views', path.join(HERE, 'views_std.json'), '--perf', '--quality', Q];
  if (UNCAPPED) a.push('--args', '--disable-gpu-vsync --disable-frame-rate-limit');
  const p = spawn(process.execPath, a, { stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '';
  p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d));
  p.on('exit', (c) => res({ code: c, out: o }));
});
const med = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const runs = { base: [], after: [] };
for (let r = 0; r < ROUNDS; r++) {
  const order = r % 2 === 0 ? [['base', BASE], ['after', PORT]] : [['after', PORT], ['base', BASE]];
  for (const [side, port] of order) {
    const out = path.join(OUT, `${side}_r${r}`);
    fs.mkdirSync(out, { recursive: true });
    const t = Date.now();
    const x = await run(port, out);
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(out, '_result.json'), 'utf8')); } catch { /* lỗi */ }
    console.log(`[ab] lượt ${r} ${side} :${port} mã ${x.code} ${((Date.now() - t) / 1000).toFixed(0)} s hpReady ${j && j.hpReadyMs} startReady ${j && j.startReadyMs} lỗi ${j ? j.errors.length : '?'}`);
    if (!j) fs.writeFileSync(path.join(out, 'stdout.txt'), x.out);
    runs[side].push(j);
  }
}
const sum = {};
for (const side of ['base', 'after']) {
  const R = runs[side].filter(Boolean);
  const views = {};
  for (const j of R) for (const s of j.shots) {
    if (!s.perf) continue;
    (views[s.id] = views[s.id] || { fps: [], calls: [], tris: [], p95: [] });
    views[s.id].fps.push(s.perf.fps); views[s.id].calls.push(s.perf.calls); views[s.id].tris.push(s.perf.tris); views[s.id].p95.push(s.perf.p95);
  }
  const vm = {};
  for (const [id, v] of Object.entries(views)) vm[id] = { fps: med(v.fps), calls: med(v.calls), tris: med(v.tris), p95: med(v.p95) };
  sum[side] = {
    n: R.length, tier: R[0] && R[0].tier, gpu: R[0] && R[0].gpu,
    hpReadyMs: R.map((j) => j.hpReadyMs), startReadyMs: R.map((j) => j.startReadyMs),
    hpReadyMed: med(R.map((j) => j.hpReadyMs)), startReadyMed: med(R.map((j) => j.startReadyMs)),
    errors: R.flatMap((j) => j.errors), heapMB: R.map((j) => j.heapMB),
    fpsMedAllViews: med(Object.values(vm).map((v) => v.fps)), callsMedAllViews: med(Object.values(vm).map((v) => v.calls)), trisMedAllViews: med(Object.values(vm).map((v) => v.tris)),
    views: vm,
  };
}
const delta = {};
for (const id of Object.keys(sum.base.views || {})) {
  const b = sum.base.views[id], a = sum.after.views[id];
  if (a) delta[id] = { fps: +(a.fps - b.fps).toFixed(1), calls: a.calls - b.calls, tris: a.tris - b.tris };
}
const res = { when: new Date().toISOString(), base: BASE, after: PORT, rounds: ROUNDS, quality: Q, uncapped: UNCAPPED, sum, delta,
  startReadyDeltaMs: sum.after.startReadyMed - sum.base.startReadyMed, hpReadyDeltaMs: sum.after.hpReadyMed - sum.base.hpReadyMed };
fs.writeFileSync(path.join(OUT, 'ab.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ startReady: [sum.base.startReadyMed, sum.after.startReadyMed], hpReady: [sum.base.hpReadyMed, sum.after.hpReadyMed],
  fps: [sum.base.fpsMedAllViews, sum.after.fpsMedAllViews], calls: [sum.base.callsMedAllViews, sum.after.callsMedAllViews], tris: [sum.base.trisMedAllViews, sum.after.trisMedAllViews],
  errors: [sum.base.errors.length, sum.after.errors.length] }));
