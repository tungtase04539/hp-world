// Flood toàn bộ vùng nước từ Bến Bính, kiểm tra tới được các bến không
import { groundHeightNoDeck, WORLD_BOUNDS as W } from '../js/terrain.js';
const STEP = 14;
const GW = Math.ceil((W.maxX - W.minX) / STEP), GH = Math.ceil((W.maxZ - W.minZ) / STEP);
const wet = new Uint8Array(GW * GH);
for (let gz = 0; gz < GH; gz++) for (let gx = 0; gx < GW; gx++) {
  wet[gz * GW + gx] = groundHeightNoDeck(W.minX + (gx + 0.5) * STEP, W.minZ + (gz + 0.5) * STEP) < -0.8 ? 1 : 0;
}
const reach = new Uint8Array(GW * GH);
const cell = (x, z) => Math.floor((z - W.minZ) / STEP) * GW + Math.floor((x - W.minX) / STEP);
const q = [cell(-49, -242)]; // sông Cấm trước Bến Bính (gốc tọa độ mới)
reach[q[0]] = 1;
while (q.length) {
  const id = q.pop();
  const cx = id % GW, cz = (id / GW) | 0;
  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
    const nx = cx + dx, nz = cz + dz;
    if (nx < 0 || nx >= GW || nz < 0 || nz >= GH) continue;
    const nid = nz * GW + nx;
    if (!reach[nid] && wet[nid]) { reach[nid] = 1; q.push(nid); }
  }
}
function checkNear(name, x, z) {
  // ô nước gần nhất trong bán kính 120 có tới được không?
  let best = null, bd = 1e9;
  for (let dx = -120; dx <= 120; dx += STEP) for (let dz = -120; dz <= 120; dz += STEP) {
    const id = cell(x + dx, z + dz);
    if (id < 0 || id >= wet.length || !wet[id]) continue;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = id; }
  }
  console.log(`${name}: ${best === null ? 'KHÔNG CÓ NƯỚC GẦN' : reach[best] ? 'TỚI ĐƯỢC ✓' : '*** TẮC ***'}`);
}
checkNear('Cửa sông Cấm', 900, -150);
checkNear('Bến Nghiêng Đồ Sơn', 1600, 2360);
checkNear('Hòn Dấu', 1735, 2800);
checkNear('Bến Cát Bà', 4600, 1830);
checkNear('Vịnh Lan Hạ', 4850, 1900);

// ảnh debug chỗ nghẽn
import { writePNG } from './debugmask.mjs';
const rgb = Buffer.alloc(GW * GH * 3);
for (let i = 0; i < wet.length; i++) {
  const o = i * 3;
  if (reach[i]) { rgb[o] = 50; rgb[o + 1] = 120; rgb[o + 2] = 220; }
  else if (wet[i]) { rgb[o] = 220; rgb[o + 1] = 60; rgb[o + 2] = 50; }
  else { rgb[o] = 70; rgb[o + 1] = 160; rgb[o + 2] = 80; }
}
writePNG('water_debug.png', GW, GH, rgb);
console.log('đã ghi water_debug.png', GW, 'x', GH);
