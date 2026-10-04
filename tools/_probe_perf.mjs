// scratch probe (not committed): same-page A/B traffic on/off
import { openGame } from './qa/launch.mjs';
const port = +(process.argv[2] || 8308);
const g = await openGame({ port, quality: 'full' });
const pg = g.pg;
await pg.waitForTimeout(8000);
await g.cleanUI();
const VIEWS = [['cam_spawn', 0, 60, 0, 0.12, 12], ['pano_007_h090', -599.3, 194.2, -Math.PI / 2, 0.02, 0.1], ['junction', -20, 162, 1.2, 0.09, 9], ['cam_high_center', -150, 150, 0.6, 0.55, 160]];
const out = { tier: g.tier, gpu: g.gpu, hpReadyMs: g.hpReadyMs, views: {} };
for (const [id, x, z, yaw, pitch, dist] of VIEWS) {
  out.views[id] = await pg.evaluate(async ([x, z, yaw, pitch, dist]) => {
    const hp = window.__hp, r = hp.renderer;
    if (hp.camOcclusion) hp.camOcclusion(false);
    hp.setTime(0.35);
    hp.teleport(x, z, yaw, pitch, dist); hp.player.group.visible = false;
    await new Promise((s) => setTimeout(s, 2500));
    const raf = () => new Promise((s) => requestAnimationFrame(s));
    async function meas() {
      const ts = []; let last = performance.now();
      for (let i = 0; i < 60; i++) { await raf(); const n = performance.now(); ts.push(n - last); last = n; }
      ts.sort((a, b) => a - b);
      const mc = new MessageChannel(); let done = null; mc.port1.onmessage = () => done && done();
      const cpu = [];
      for (let i = 0; i < 30; i++) {
        const t0 = await new Promise((s) => requestAnimationFrame((t) => s(t)));
        await new Promise((s) => { done = s; mc.port2.postMessage(0); });
        cpu.push(performance.now() - t0);
      }
      cpu.sort((a, b) => a - b);
      r.info.autoReset = false; r.info.reset(); await raf();
      const calls = r.info.render.calls, tris = r.info.render.triangles; r.info.autoReset = true;
      return { p50: +ts[30].toFixed(1), mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1), cpu50: +cpu[15].toFixed(1), calls, tris };
    }
    const res = { on: [], off: [] };
    for (let k = 0; k < 2; k++) {
      hp.traffic.setEnabled(true); await new Promise((s) => setTimeout(s, 600)); res.on.push(await meas());
      hp.traffic.setEnabled(false); await new Promise((s) => setTimeout(s, 600)); res.off.push(await meas());
    }
    hp.traffic.setEnabled(true);
    res.trafficMs = hp.traffic.stats().ms; res.stats = hp.traffic.stats();
    res.q = { pr: r.getPixelRatio(), bloom: hp.bloomPass && hp.bloomPass.enabled, fogFar: hp.scene.fog.far, shadow: hp.dayNight.sun.castShadow };
    return res;
  }, [x, z, yaw, pitch, dist]);
  console.log(id, JSON.stringify(out.views[id]));
}
out.heapMB = await pg.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1e6));
console.log(JSON.stringify({ tier: out.tier, gpu: out.gpu, hpReadyMs: out.hpReadyMs, heapMB: out.heapMB, errors: g.errors.slice(0, 5) }));
await g.close();
