// tools/tour.mjs — CHỤP TOUR ĐỊA DANH để XEM BẰNG MẮT trước khi push (Windows, xem tools/qa/launch.mjs).
// Mỗi địa danh trong VÙNG CHƠI (đúng danh sách nhiệm vụ "Nhà thám hiểm" — js/landmarks.js lọc theo PLAY_RADIUS):
// đứng ở một ĐIỂM PANO THẬT (js/panoclear.js — chỗ xe Street View đã đi qua, luôn là mặt phố) cách địa danh 20-150 m,
// ưu tiên phía mặt tiền (LM_FACE) và cự ly ~60 m, nhìn về tâm địa danh (LM_CENTROID / LM). Điểm đứng được chọn
// TRONG TRANG bằng tia THREE.Raycaster từ mắt tới địa danh: tia chạm vật khác trước khi tới địa danh = bị che → bỏ.
// (Bản trước suy điểm đứng từ LM + LM_FACE·khoảng lùi → 6/22 ảnh là bức tường nhà sát camera.)
// Thêm: 1 cảnh giao thông nút Quán hoa, 1 cảnh đêm Nhà hát, 1 vệ tinh trung tâm. In bảng điểm đứng đã chọn.
//   node tools/tour.mjs [--port 8177] [--out <thư mục>] [--quality full] [--wait 1800]
import fs from 'fs';
import path from 'path';
import { openGame, args, defaultOut } from './qa/launch.mjs';
const A = args();
const OUT = A.get('out', defaultOut('tour'));
fs.mkdirSync(OUT, { recursive: true });
const g = await openGame({ port: A.get('port', '8177'), quality: A.get('quality', 'full') });
let stops = [];
if (g.hpReadyMs) {
  await g.pg.waitForTimeout(3000);
  await g.cleanUI();
  // --- chọn điểm đứng (trong trang: cần scene thật để bắn tia) ---
  stops = await g.pg.evaluate(async () => {
    const hp = window.__hp, THREE = hp.THREE;
    const { LANDMARKS } = await import('./js/landmarks.js');
    const { PANO_CAM } = await import('./js/panoclear.js');
    const { LM, LM_FACE } = await import('./js/mapdata.js');
    const { LM_POLY, LM_CENTROID } = await import('./js/landmark_polys.js');
    const R = hp.PLAY_RADIUS - 2;
    const POLY_KEY = { station: 'station_bldg' };
    const rc = new THREE.Raycaster(); rc.camera = hp.camera;
    const targets = hp.scene.children.filter((o) => o.visible && !/^(ground|water|sky|traffic_)/.test(o.name) && !o.isLight && !o.isSprite);
    const out = [];
    for (const lm of LANDMARKS) {
      if (Math.hypot(lm.x, lm.z) > R) continue;
      const pk = POLY_KEY[lm.id] || lm.id;
      const C = LM_CENTROID[pk] || LM[lm.id] || [lm.x, lm.z];
      const poly = LM_POLY[pk];
      const rad = poly ? Math.max(...poly.map(([x, z]) => Math.hypot(x - C[0], z - C[1]))) : 30;   // bán kính địa danh
      const F = LM_FACE[lm.id] || LM_FACE[pk] || null;
      const cands = [];
      const add = (x, z, penalty) => {
        if (Math.hypot(x, z) > R) return;
        const d = Math.hypot(x - C[0], z - C[1]);
        if (d < rad + 8 || d > rad + 150) return;
        const facing = F ? ((x - C[0]) * F[0] + (z - C[1]) * F[1]) / d : 0;
        cands.push({ x, z, d, score: facing * 0.8 - Math.abs(d - rad - 45) / 60 - penalty });
      };
      for (const [x, z] of PANO_CAM) add(x, z, 0);
      // dự phòng (địa danh xa vùng có pano — đình Hàng Kênh, chùa Hàng, đền Tam Kỳ…): vòng 24 hướng × 3 cự ly,
      // chỉ điểm trên cạn, ngoài nhà thật/địa danh — xếp sau điểm pano
      for (let k = 0; k < 24; k++) for (const dd of [22, 40, 65]) {
        const a = (k / 24) * Math.PI * 2, x = C[0] + Math.sin(a) * (rad + dd), z = C[1] + Math.cos(a) * (rad + dd);
        const h = hp.gh(x, z);
        if (h < 1.2 || h > 12 || (hp.footprints && hp.footprints.blocked(x, z))) continue;
        add(x, z, 0.35);
      }
      cands.sort((a, b) => b.score - a.score);
      // Chấm điểm tầm nhìn bằng QUẠT 5 TIA (1 tia giữa tới tâm địa danh + 4 tia ngang ±8°/±16°): tia giữa phải tới
      // được địa danh (chạm vật nằm trong/sát địa danh = chính nó), tia bên không được chạm tường trong nửa cự ly đầu
      // (1 tia giữa thoáng nhưng 2 bên là 2 bức tường sát camera = ảnh vẫn hỏng — lượt tour3 2026-10-04).
      const firstHit = (o, dir, far) => {
        rc.set(o, dir); rc.far = far;
        try { return rc.intersectObjects(targets, true)[0] || null; } catch (e) { return null; }
      };
      let best = null, tested = 0;
      for (const c of cands.slice(0, 60)) {
        const ey = hp.gh(c.x, c.z) + 2.2;
        const ty = hp.gh(C[0], C[1]) + Math.min(8, 2 + rad * 0.15);
        const o = new THREE.Vector3(c.x, ey, c.z), t = new THREE.Vector3(C[0], ty, C[1]);
        const dir = t.clone().sub(o); const len = dir.length(); dir.normalize();
        const hit = firstHit(o, dir, len);
        const clearC = !hit || Math.hypot(hit.point.x - C[0], hit.point.z - C[1]) < rad + 4;
        let side = 0;
        for (const a of [-0.28, -0.14, 0.14, 0.28]) {
          const ca = Math.cos(a), sa = Math.sin(a);
          const sd = new THREE.Vector3(dir.x * ca - dir.z * sa, 0, dir.x * sa + dir.z * ca).normalize();
          const h2 = firstHit(o, sd, Math.min(40, len * 0.5));
          if (!h2) side++;
        }
        tested++;
        const q = (clearC ? 4 : 0) + side + c.score * 0.1;
        if (!best || q > best.q) best = { ...c, q, clear: clearC, side, hit: hit ? (hit.object.name || hit.object.type) : '' };
        if (clearC && side === 4) break;
      }
      if (!best) continue;
      const yaw = Math.atan2(best.x - C[0], best.z - C[1]);   // camera ở phía (sin,cos)·dist so với mục tiêu → nhìn về C
      out.push({ name: lm.id, x: best.x, z: best.z, yaw, pitch: -0.04, dist: 0.1, tod: 0.38, d: Math.round(best.d), clear: best.clear, side: best.side, hit: best.hit || '', tested });
    }
    return out;
  });
  const sq = await g.pg.evaluate(async () => (await import('./js/mapdata.js')).EXTRAS.square);
  const opera = await g.pg.evaluate(async () => (await import('./js/mapdata.js')).LM.opera);
  stops.push({ name: 'traffic_junction', x: -20, z: 162, yaw: 1.2, pitch: 0.09, dist: 9, tod: 0.38 });
  stops.push({ name: 'traffic_square', x: sq[0], z: sq[1] + 30, yaw: 0.6, pitch: 0.32, dist: 34, tod: 0.38 });
  stops.push({ name: 'night_opera', x: opera[0], z: opera[1] + 42, yaw: 0, pitch: 0.22, dist: 26, tod: 0.88 });
  for (const s of stops) {
    await g.pg.evaluate((s) => {
      const hp = window.__hp; hp.aerialOff(); hp.setTime(s.tod); hp.camOcclusion(s.dist > 1);   // góc 3rd-person: cần boom như lúc chơi
      hp.teleport(s.x, s.z, s.yaw, s.pitch, s.dist); hp.player.group.visible = false;
    }, s);
    await g.pg.waitForTimeout(+A.get('wait', '1800'));
    await g.pg.screenshot({ path: path.join(OUT, `tour-${s.name}.png`) });
  }
  await g.pg.evaluate(() => { const hp = window.__hp; hp.setTime(0.4); hp.teleport(-71, 13, 0, 0.3, 12); hp.aerial(-71, 13, 340); });
  await g.pg.waitForTimeout(2500);
  await g.pg.screenshot({ path: path.join(OUT, 'tour-aerial_center.png') });
}
for (const s of stops) if (s.d !== undefined) console.log(`${s.name.padEnd(11)} đứng (${Math.round(s.x)},${Math.round(s.z)}) cách ${s.d} m — tia giữa ${s.clear ? 'thoáng' : 'BỊ CHE bởi ' + s.hit}, tia bên thoáng ${s.side}/4 (thử ${s.tested} điểm)`);
console.log(`${stops.length + 1} ảnh → ${OUT}  (XEM BẰNG MẮT từng ảnh)`);
console.log(g.errors.length ? 'ERRORS:\n' + g.errors.join('\n') : 'NO JS ERRORS');
await g.close();
process.exit(g.errors.length || !g.hpReadyMs ? 1 : 0);
