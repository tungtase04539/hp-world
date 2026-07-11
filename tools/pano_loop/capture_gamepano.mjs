// Chụp pano trong game đúng tọa độ + 4 heading (0/90/180/270) như bộ pano thật
// usage: node capture_gamepano.mjs <startIdx> <endIdx(exclusive)>
import { chromium } from 'playwright';
import fs from 'fs';
const SP = '/tmp/claude-0/-home-user-hp-world/c2e34905-ff51-516d-bf34-6f2f3d70ade9/scratchpad';
const LIST = JSON.parse(fs.readFileSync(SP + '/capture_list.json', 'utf8'));
const [S, E] = [parseInt(process.argv[2] || '0'), Math.min(parseInt(process.argv[3] || '9999'), LIST.length)];
const HEADINGS = [0, 90, 180, 270];
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox','--enable-unsafe-swiftshader','--use-gl=swiftshader'] });
const pg = await br.newPage({ viewport: { width: 956, height: 474 } });
await pg.goto('http://localhost:8099/index.html', { waitUntil: 'domcontentloaded' });
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
await pg.waitForTimeout(20000);   // đợi thêm GLB trung tâm preload
await pg.evaluate(() => {
  for (const id of ['titleScreen', 'hud']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
  for (const id2 of ['dialogue','prompt','toast']) { const el2 = document.getElementById(id2); if (el2) el2.style.display = 'none'; }
  if (window.__hp.scene) window.__hp.scene.traverse((o) => { if (o.isInstancedMesh && o.count === 200 && !o.frustumCulled) o.visible = false; });
  if (window.__hp.setTime) window.__hp.setTime(0.35);          // giữa trưa như pano
  if (window.__hp.player) window.__hp.player.group.visible = false;   // ẩn nhân vật khỏi khung
});
for (let i = S; i < E; i++) {
  const p = LIST[i];
  if (HEADINGS.every((h) => fs.existsSync(`${SP}/gamepano2/${p.id}_h${String(h).padStart(3, '0')}.png`))) { console.log(`skip ${i + 1} ${p.id}`); continue; }
  for (const h of HEADINGS) {
    const yaw = -h * Math.PI / 180;
    await pg.evaluate(([x, z, yaw]) => window.__hp.teleport(x, z, yaw, 0.02, 0.1), [p.X, p.Z, yaw]);
    await pg.waitForTimeout(i === S && h === 0 ? 3000 : 900);
    await pg.screenshot({ path: `${SP}/gamepano2/${p.id}_h${String(h).padStart(3, '0')}.png` });
  }
  console.log(`done ${i + 1}/${E} ${p.id}`);
}
await br.close();
