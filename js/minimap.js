import { groundHeightNoDeck, BUILD_RADIUS } from './world.js';
import { ROADS_DT, BUILDINGS, PARKS, RAIL, STREETS } from './mapdata.js';
import { LANDMARKS } from './landmarks.js';
import { quests } from './quests.js';
import { tx } from './i18n.js';

// ============ MINIMAP KIỂU GOOGLE MAPS ============
// Nền phố (đường trắng/vàng + nhà + nước + công viên) vẽ MỘT LẦN cho dải trung tâm
// (BUILD_RADIUS), mỗi khung chỉ cắt cửa sổ quanh người chơi → "đi tới đâu hiện tới đấy".
const W = 210, H = 165;            // kích thước canvas HUD (px CSS)
const EXT = BUILD_RADIUS + 100;    // nền phủ ±EXT quanh Nhà hát lớn (m)
const PPM = 0.8;                   // px trên mét của bản nền (2720px cho 3400m)
const VIEW_M = 380;                // bề ngang thế giới hiển thị (m) — zoom nhỏ hơn theo yêu cầu

let base = null, ctx = null;

function toBase(x, z) { return [(x + EXT) * PPM, (z + EXT) * PPM]; }

function strokeRoads(octx, roads, classes, width, color) {
  octx.lineCap = 'round'; octx.lineJoin = 'round';
  octx.strokeStyle = color; octx.lineWidth = width * PPM;
  octx.beginPath();
  for (const r of roads) {
    if (!classes.includes(r.c)) continue;
    const p0 = toBase(r.pts[0][0], r.pts[0][1]);
    octx.moveTo(p0[0], p0[1]);
    for (let i = 1; i < r.pts.length; i++) {
      const p = toBase(r.pts[i][0], r.pts[i][1]);
      octx.lineTo(p[0], p[1]);
    }
  }
  octx.stroke();
}

export function initMinimap() {
  const cnv = document.getElementById('minimap');
  // canvas nội bộ 2x + CSS giữ 210×165 → chữ tên đường/công trình NÉT (không vỡ trên màn HiDPI)
  cnv.width = W * 2; cnv.height = H * 2;
  cnv.style.width = W + 'px'; cnv.style.height = H + 'px';
  ctx = cnv.getContext('2d');
  ctx.scale(2, 2);

  const S = Math.round(2 * EXT * PPM);
  const off = document.createElement('canvas');
  off.width = S; off.height = S;
  const o = off.getContext('2d');

  // 1) nền đất be sáng (tông GG)
  o.fillStyle = '#f2efe9'; o.fillRect(0, 0, S, S);

  // 2) nước từ heightfield (lưới 6m — 1 lần lúc init)
  o.fillStyle = '#a6d5fa';
  const step = 6, cell = step * PPM + 0.7;
  for (let z = -EXT; z < EXT; z += step) {
    for (let x = -EXT; x < EXT; x += step) {
      if (groundHeightNoDeck(x + step / 2, z + step / 2) < 0.25) {
        const [bx, bz] = toBase(x, z);
        o.fillRect(bx, bz, cell, cell);
      }
    }
  }

  // 3) công viên / vườn hoa
  o.fillStyle = '#c3ecb2';
  for (const ring of PARKS) {
    o.beginPath();
    const p0 = toBase(ring[0][0], ring[0][1]); o.moveTo(p0[0], p0[1]);
    for (let i = 1; i < ring.length; i++) { const p = toBase(ring[i][0], ring[i][1]); o.lineTo(p[0], p[1]); }
    o.closePath(); o.fill();
  }

  // 4) footprint nhà (chỉ trong bán kính)
  o.fillStyle = '#e8e3da';
  for (const b of BUILDINGS) {
    const [fx, fz] = b.p[0];
    if (fx * fx + fz * fz > EXT * EXT) continue;
    o.beginPath();
    const p0 = toBase(b.p[0][0], b.p[0][1]); o.moveTo(p0[0], p0[1]);
    for (let i = 1; i < b.p.length; i++) { const p = toBase(b.p[i][0], b.p[i][1]); o.lineTo(p[0], p[1]); }
    o.closePath(); o.fill();
  }

  // 5) đường sắt (xám, nét đứt)
  o.setLineDash([6, 4]);
  strokeRoads(o, RAIL.map((r) => ({ c: 'rl', pts: r.pts })), ['rl'], 2.5, '#b9b3ab');
  o.setLineDash([]);

  // 6) đường 2 lớp kiểu GG: viền (casing) rồi ruột; trục lớn VÀNG, phố thường TRẮNG
  strokeRoads(o, ROADS_DT, ['h'], 3.2, '#ddd6cb');
  strokeRoads(o, ROADS_DT, ['h'], 2.0, '#fbfaf6');
  strokeRoads(o, ROADS_DT, ['t', 'r'], 8, '#d9d2c9');
  strokeRoads(o, ROADS_DT, ['p', 's'], 16, '#e8b73e');
  strokeRoads(o, ROADS_DT, ['t', 'r'], 5.5, '#ffffff');
  strokeRoads(o, ROADS_DT, ['p', 's'], 12.5, '#fcd769');

  base = off;
}

export function drawMinimap(px, pz, yaw) {
  if (!ctx) return;
  // nền ngoài rìa thế giới (khi người chơi sát mép)
  ctx.fillStyle = '#eae7e0'; ctx.fillRect(0, 0, W, H);

  // cửa sổ nguồn quanh người chơi (Chrome tự clip nguồn ngoài canvas)
  const sw = VIEW_M * PPM, sh = VIEW_M * (H / W) * PPM;
  const [bx, bz] = toBase(px, pz);
  ctx.drawImage(base, bx - sw / 2, bz - sh / 2, sw, sh, 0, 0, W, H);

  const sc = W / VIEW_M;

  // tên ĐƯỜNG (kiểu GG): chữ xám xoay theo hướng đường, viền trắng cho dễ đọc
  ctx.font = '7.5px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const st of STREETS) {
    const vx = (st.x - px) * sc + W / 2, vy = (st.z - pz) * sc + H / 2;
    if (vx < 10 || vx > W - 10 || vy < 8 || vy > H - 8) continue;
    let a = Math.atan2(st.d[1], st.d[0]);
    if (a > Math.PI / 2) a -= Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    const nm = st.n.replace(/^(Đường|Phố) /, '');
    ctx.save();
    ctx.translate(vx, vy); ctx.rotate(a);
    ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeText(nm, 0, 0);
    ctx.fillStyle = '#8a8175';
    ctx.fillText(nm, 0, 0);
    ctx.restore();
  }

  // chấm + TÊN công trình: cam = chưa khám phá, xanh = đã khám phá (nâu POI kiểu GG)
  for (const lm of LANDMARKS) {
    const vx = (lm.x - px) * sc + W / 2, vy = (lm.z - pz) * sc + H / 2;
    if (vx < -6 || vx > W + 6 || vy < -6 || vy > H + 6) continue;
    ctx.beginPath();
    ctx.arc(vx, vy, 3, 0, Math.PI * 2);
    ctx.fillStyle = quests.discovered.has(lm.id) ? '#3fbf6f' : '#ff8c2e';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    let label = tx(lm.name);
    if (label.length > 22) label = label.slice(0, 21) + '…';
    ctx.font = 'bold 7px system-ui, sans-serif';
    ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeText(label, vx, vy - 7);
    ctx.fillStyle = '#8a5a2a';
    ctx.fillText(label, vx, vy - 7);
  }

  // mũi tên người chơi — LUÔN ở giữa (bản đồ trôi theo chân, bắc cố định như GG)
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI - yaw);
  ctx.beginPath();
  ctx.moveTo(0, -6);
  ctx.lineTo(4.4, 5);
  ctx.lineTo(-4.4, 5);
  ctx.closePath();
  ctx.fillStyle = '#1a73e8';           // xanh GG
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}
