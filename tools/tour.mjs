// tools/tour.mjs — CHỤP TOUR ĐỊA DANH để XEM BẰNG MẮT trước khi push (Windows, xem tools/qa/launch.mjs).
// Điểm dừng suy từ mapdata (LM + LM_FACE: đứng phía mặt tiền nhìn vào) — không còn bảng toạ độ 1:10 viết tay;
// chỉ lấy địa danh trong vùng chơi (BUILD_RADIUS − 12). Thêm 1 cảnh giao thông nút giao, 1 cảnh đêm, 1 vệ tinh.
//   node tools/tour.mjs [--port 8177] [--out <thư mục>] [--quality full]
import fs from 'fs';
import path from 'path';
import { openGame, args, defaultOut, mapdata } from './qa/launch.mjs';
const A = args();
const OUT = A.get('out', defaultOut('tour'));
fs.mkdirSync(OUT, { recursive: true });
const { LM, LM_FACE, EXTRAS } = await mapdata();
const PLAY_R = 1600 - 12;
// key → [khoảng lùi mặt tiền tới tâm nhìn, cự ly camera, pitch]
const STOPS = {
  opera: [32, 30, 0.2], quanhoa: [14, 20, 0.2], lechan: [12, 18, 0.2], cathedral: [30, 30, 0.22], postoffice: [28, 28, 0.2],
  museum: [24, 26, 0.2], station: [30, 34, 0.2], market: [60, 40, 0.25], nhnn: [36, 32, 0.2], dennghe: [18, 22, 0.2],
  thptnq: [40, 34, 0.22], ubnd: [30, 34, 0.2], rap78: [24, 26, 0.2], trienlam: [26, 30, 0.2], nhaken: [14, 22, 0.2],
  chuahang: [24, 28, 0.22], dinhhk: [20, 24, 0.22], dentamky: [18, 24, 0.22], lake: [0, 40, 0.3], bridge_hvt: [0, 60, 0.18],
};
const stops = [];
for (const [k, [back, dist, pitch]] of Object.entries(STOPS)) {
  const p = LM[k]; if (!p || Math.hypot(p[0], p[1]) > PLAY_R) continue;
  const f = LM_FACE[k] || [0, 1];
  const tx = p[0] + f[0] * back, tz = p[1] + f[1] * back;
  // camera ở phía mặt tiền nhìn VÀO địa danh: vị trí camera = tâm + (sin yaw, cos yaw)·dist ⇒ yaw = hướng F
  stops.push([k, tx, tz, Math.atan2(f[0], f[1]), pitch, dist, 0.35]);
}
stops.push(['traffic_junction', EXTRAS.square[0] - 14, EXTRAS.square[1] + 113, 1.2, 0.09, 9, 0.35]);
stops.push(['night_opera', LM.opera[0], LM.opera[1] + 42, 0, 0.22, 26, 0.88]);
const g = await openGame({ port: A.get('port', '8177'), quality: A.get('quality', 'full') });
if (g.hpReadyMs) {
  await g.pg.waitForTimeout(3000);
  await g.cleanUI();
  for (const [name, x, z, yaw, pitch, dist, tod] of stops) {
    await g.pg.evaluate(([x, z, yaw, pitch, dist, tod]) => {
      const hp = window.__hp; hp.aerialOff(); hp.setTime(tod); hp.camOcclusion(true);   // như lúc chơi: cần boom né nhà thật
      hp.teleport(x, z, yaw, pitch, dist); hp.player.group.visible = false;
    }, [x, z, yaw, pitch, dist, tod]);
    await g.pg.waitForTimeout(+A.get('wait', '1800'));
    await g.pg.screenshot({ path: path.join(OUT, `tour-${name}.png`) });
  }
  await g.pg.evaluate(() => { window.__hp.setTime(0.4); window.__hp.aerial(-71, 13, 340); });
  await g.pg.waitForTimeout(1500);
  await g.pg.screenshot({ path: path.join(OUT, 'tour-aerial_center.png') });
}
console.log(`${stops.length + 1} ảnh → ${OUT}  (XEM BẰNG MẮT từng ảnh)`);
console.log(g.errors.length ? 'ERRORS:\n' + g.errors.join('\n') : 'NO JS ERRORS');
await g.close();
process.exit(g.errors.length || !g.hpReadyMs ? 1 : 0);
