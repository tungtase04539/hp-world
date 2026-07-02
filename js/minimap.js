import { WORLD_BOUNDS, groundHeightNoDeck } from './world.js';
import { LANDMARKS } from './landmarks.js';
import { quests } from './quests.js';

// Bản đồ nhỏ: nền vẽ một lần từ địa hình, chấm địa danh + mũi tên người chơi vẽ mỗi khung
const W = 210, H = 165;
let base = null, ctx = null;

function toPx(x, z) {
  return [
    ((x - WORLD_BOUNDS.minX) / (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)) * W,
    ((z - WORLD_BOUNDS.minZ) / (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ)) * H,
  ];
}

export function initMinimap() {
  const cnv = document.getElementById('minimap');
  cnv.width = W; cnv.height = H;
  ctx = cnv.getContext('2d');

  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  const img = octx.createImageData(W, H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = WORLD_BOUNDS.minX + ((px + 0.5) / W) * (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX);
      const z = WORLD_BOUNDS.minZ + ((py + 0.5) / H) * (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ);
      const h = groundHeightNoDeck(x, z);
      let r, g, b;
      if (h < -1.5) { r = 26; g = 82; b = 122; }        // biển sâu
      else if (h < 0.25) { r = 55; g = 124; b = 168; }  // nước nông
      else if (h < 1.1) { r = 224; g = 204; b = 143; }  // cát
      else if (h < 7) { r = 106; g = 168; b = 92; }     // đồng bằng
      else { r = 78, g = 126, b = 74; }                 // đồi núi
      const i = (py * W + px) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 235;
    }
  }
  octx.putImageData(img, 0, 0);
  base = off;
}

export function drawMinimap(px, pz, yaw) {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(base, 0, 0);
  // chấm địa danh: cam = chưa khám phá, xanh = đã khám phá
  for (const lm of LANDMARKS) {
    const [sx, sy] = toPx(lm.x, lm.z);
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fillStyle = quests.discovered.has(lm.id) ? '#5fe08a' : '#ffb84d';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
  // mũi tên người chơi
  const [sx, sy] = toPx(px, pz);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.PI - yaw);
  ctx.beginPath();
  ctx.moveTo(0, -5.5);
  ctx.lineTo(4, 4.5);
  ctx.lineTo(-4, 4.5);
  ctx.closePath();
  ctx.fillStyle = '#ff4438';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}
