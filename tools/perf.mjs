// tools/perf.mjs — ĐO HIỆU NĂNG ở các góc chuẩn (Windows, Chrome hệ thống GPU thật — tools/qa/launch.mjs).
// In: tier + GPU (BẮT BUỘC ghi kèm mọi số đo — CLAUDE.md), hpReadyMs, startReadyMs (nút Bắt đầu mở), từng bước
// khởi động (__hp.bootProfile), heap; mỗi góc: fps/p50/p95 khung, draw call + tam giác (gồm shadow pass), ms CPU
// luồng chính/khung (rAF → macrotask kế tiếp), ms cập nhật giao thông.
// Số headless dao động tới ±2× khi máy bận (agent khác chạy song song) — chỉ so A/B TRONG CÙNG phiên đo.
//   node tools/perf.mjs [--port 8177] [--quality full|lite|auto] [--json out.json]
import fs from 'fs';
import { openGame, args } from './qa/launch.mjs';
const A = args();
const VIEWS = [
  ['cam_spawn', 0, 60, 0, 0.12, 12], ['street_s482', -165, 482, 0, 0.07, 7], ['junction_quanhoa', -20, 162, 1.2, 0.09, 9],
  ['high_center', -150, 150, 0.6, 0.55, 160], ['lake', -500, 230, 2.4, 0.45, 120],
];
const g = await openGame({ port: A.get('port', '8177'), quality: A.get('quality', 'full') });
const res = { tier: g.tier, gpu: g.gpu, hpReadyMs: g.hpReadyMs, startReadyMs: g.startReadyMs, views: {} };
if (g.hpReadyMs) {
  await g.pg.waitForTimeout(+A.get('settle', '8000'));
  await g.cleanUI();
  res.boot = await g.pg.evaluate(() => window.__hp.bootProfile);
  for (const [id, x, z, yaw, pitch, dist] of VIEWS) {
    res.views[id] = await g.pg.evaluate(async ([x, z, yaw, pitch, dist]) => {
      const hp = window.__hp, r = hp.renderer;
      hp.camOcclusion(false); hp.teleport(x, z, yaw, pitch, dist);
      await new Promise((s) => setTimeout(s, 2500));
      const ts = []; let last = performance.now();
      for (let i = 0; i < 90; i++) { await new Promise((s) => requestAnimationFrame(s)); const n = performance.now(); ts.push(n - last); last = n; }
      ts.sort((a, b) => a - b);
      // CPU luồng chính/khung: từ mốc bắt đầu khung (timestamp rAF) tới macrotask kế tiếp
      const mc = new MessageChannel(); let done = null; mc.port1.onmessage = () => done && done();
      const cpu = [];
      for (let i = 0; i < 40; i++) {
        const t0 = await new Promise((s) => requestAnimationFrame((t) => s(t)));
        await new Promise((s) => { done = s; mc.port2.postMessage(0); });
        cpu.push(performance.now() - t0);
      }
      cpu.sort((a, b) => a - b);
      r.info.autoReset = false; r.info.reset();
      await new Promise((s) => requestAnimationFrame(s));
      const calls = r.info.render.calls, tris = r.info.render.triangles;
      r.info.autoReset = true;
      return {
        fps: +(1000 / (ts.reduce((a, b) => a + b, 0) / ts.length)).toFixed(1), p50: +ts[45].toFixed(1), p95: +ts[85].toFixed(1),
        cpuMs: +cpu[20].toFixed(1), calls, tris, trafficMs: hp.traffic.stats().ms,
      };
    }, [x, z, yaw, pitch, dist]);
  }
  res.heapMB = await g.pg.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null));
}
res.errors = g.errors;
console.log(JSON.stringify(res, null, 1));
if (A.get('json')) fs.writeFileSync(A.get('json'), JSON.stringify(res, null, 1));
await g.close();
process.exit(g.errors.length || !g.hpReadyMs ? 1 : 0);
