// scratch probe (W3-D, NOT committed): tô đỏ 1 mesh theo tên (depthTest off) rồi chụp từ góc pano → thấy mesh nằm đâu
import { openGame } from './launch.mjs';
const [port, name, X, Z, H, out] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], process.argv[7]];
const g = await openGame({ port: +port, viewport: { width: 1280, height: 634 }, extra: '&date=2024-10-15' });
try {
  await g.pg.waitForTimeout(2500);
  for (const mode of ['normal', 'red']) {
    await g.pg.evaluate(async ([name, X, Z, H, mode]) => {
      const hp = window.__hp;
      if (mode === 'red') hp.scene.traverse((o) => { if (o.name === name) { o.material = new hp.THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }); o.renderOrder = 999; } });
      hp.setTime(0.35); if (hp.camOcclusion) hp.camOcclusion(false); hp.aerialOff && hp.aerialOff(); hp.teleport(X, Z, -H * Math.PI / 180, 0.02, 0.1); hp.player.group.visible = false;
      for (const id of ['titleScreen', 'hud', 'dialogue', 'prompt', 'toast', 'banner', 'touchControls', 'gpuWarn']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
      await new Promise((r) => setTimeout(r, 2500));
    }, [name, X, Z, H, mode]);
    await g.pg.screenshot({ path: `${out}_${mode}.png` });
  }
} finally { await g.close(); }
