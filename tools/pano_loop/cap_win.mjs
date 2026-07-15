// Chụp pano trong game — công thức KNOWLEDGE §8b (viewport 956x474, camYaw=-H·π/180, pitch 0.02, dist 0.1)
// usage: node cap.mjs <list.json> <outdir>   ; list = [{id, X, Z, headings:[0,90,...]}]
import { chromium } from 'playwright-core';
import fs from 'fs';
const LIST = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });
const br = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const pg = await br.newPage({ viewport: { width: 956, height: 474 } });
const errors = [];
pg.on('pageerror', (e) => errors.push(e.message));
await pg.goto('http://127.0.0.1:8177/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
for (let i = 0; i < 120; i++) {
  const ok = await pg.evaluate(() => { const sb = document.getElementById('startBtn'); if (sb) { sb.click(); return true; } return false; }).catch(() => false);
  if (ok) break;
  await pg.waitForTimeout(1000);
}
for (let i = 0; i < 180; i++) {
  const ok = await pg.evaluate(() => !!(window.__hp && window.__hp.teleport)).catch(() => false);
  if (ok) break;
  await pg.waitForTimeout(1000);
}
await pg.waitForTimeout(12000); // GLB local, preload nhanh
await pg.evaluate(() => {
  for (const id of ['titleScreen', 'hud', 'dialogue', 'prompt', 'toast', 'banner', 'touchControls']) {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  }
  // ẩn cánh phượng: petals.update tự bật visible=true mỗi khung → phải ép count=0
  window.__hp.scene.traverse((o) => { if (o.isInstancedMesh && o.count === 170 && !o.frustumCulled) o.count = 0; });
  window.__hp.setTime(0.35);
  window.__hp.player.group.visible = false;
});
let first = true;
for (const p of LIST) {
  for (const h of p.headings || [0, 90, 180, 270]) {
    const f = `${OUT}/${p.id}_h${String(h).padStart(3, '0')}.png`;
    if (fs.existsSync(f)) continue;
    const yaw = -h * Math.PI / 180;
    // đặt lại GIỜ trước mỗi teleport: 1 ngày game = 300s, chụp lô dài làm đồng hồ trôi
    // sang hoàng hôn/đêm → giám khảo chấm lệch (pano_032 từng bị trời cam cả 2 bản)
    await pg.evaluate(([x, z, yaw]) => { window.__hp.setTime(0.35); window.__hp.teleport(x, z, yaw, 0.02, 0.1); }, [p.X, p.Z, yaw]);
    await pg.waitForTimeout(first ? 3000 : 900);
    first = false;
    await pg.screenshot({ path: f });
  }
  console.log('done', p.id);
}
console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO JS ERRORS');
await br.close();
