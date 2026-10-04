// trees.js — HỆ CÂY ĐƯỜNG PHỐ INSTANCED (Đợt 3 WP4 "Thành phố thật").
//
// Thay 5 đường ống cây cũ (bake icosahedron xanh lè + ~12 helper cây cầu trong khối cells + cell_tree + cây phượng
// hero 85-101k tam giác luôn bật) bằng MỘT hệ thống:
//   • 9 LOÀI thật của phố Hải Phòng (đếm từ mô tả 551 pano: xà cừ 194, bàng 127, phượng 96, cắt cụt ~100, cau vua…):
//     xà cừ, bàng (tán tầng), phượng vĩ (tán dù, lá lông chim, hoa đỏ theo MÙA), sấu, bằng lăng (hoa tím), cau vua,
//     cây CẮT CỤT (sau bão Yagi 9/2024 — rất phổ biến trên pano 10/2024), đa/si, cây non chống cọc.
//   • Mỗi loài 1-2 KIT hình học: thân + cành chính côn (ống cong), GỐC QUÉT VÔI ~1,2 m (bật/tắt theo instance),
//     tán = 20-160 THẺ LÁ alpha-test dùng chung 1 ATLAS lá vẽ thủ tục (canvas, không ảnh ngoài), pháp tuyến "vòm tán"
//     + AO theo độ sâu trong tán ⇒ khối tán mềm, thấy cành và trời xuyên qua như ảnh thật.
//   • InstancedMesh: kit GẦN (≤ NEAR_R) đổ bóng lốm đốm (customDepthMaterial alpha-test), kit XA ít thẻ (≤ FAR_R),
//     cây phượng HERO GLB (Meshy, file KHÔNG đổi) chỉ hiện trong HERO_R — xa hơn là phượng thủ tục cùng chỗ.
//     LOD tự quản (không qua instcull: userData.noCull) — nén tập instance theo khoảng cách camera mỗi ~0,25 s.
//   • Gió: lắc tán bằng onBeforeCompile (rẻ). Mùa hoa: uniform uBloom (mặc định hè: ~35% phượng + bằng lăng nở).
//
// Hợp đồng dùng (world.js):
//   plant(kind, x, z, o)          — xếp hàng 1 cây (toạ độ thế giới). kind: 'xacu'|'bang'|'phuong'|'sau'|'banglang'|
//                                   'cau'|'catcut'|'da'|'non' hoặc 'shade' (cây bóng mát: loài theo pano/vùng) |
//                                   'street' (mọi loài theo pano/vùng) | 'park'. o: {h, r, bloom, wash, pit, hero, yaw,
//                                   variant, sz, full, median} (xem plant()).
//                                   KHÔNG tự thêm collider (người gọi giữ addCollider như cũ); buildTrees dời/bỏ cây
//                                   lọt lòng đường / nhà thật / trùng gốc và dời/tách collider ở đúng (x,z) đó.
//   plantLocal(parent, lx, lz, kind, o) — cây trong Group (toạ độ local của parent, giải ở buildTrees; parent bị gỡ
//                                   khỏi scene trước đó → cây bị bỏ).
//   plantStreetTrees(ctx)          — trồng THEO DỮ LIỆU dọc phố p/s/t (+ r nơi pano nói có cây) tại xsection.treePitLine.
//   buildTrees(scene, ctx)         — dựng atlas + kit + InstancedMesh, móc scene.onBeforeRender (LOD + gió). Trả handle.
// Mọi vị trí/hash TẤT ĐỊNH (không Math.random) để A/B ảnh so được.
import * as THREE from 'three';
import { TIER } from './device.js';
import { PANO_VEG, PANO_VEG_STRIDE } from './treemap.js';
import { PANO_CAM } from './panoclear.js';
import { ROAD_HW, treePitLine, SIDEWALK_TOP } from './xsection.js';
export { treePitLine };   // world.js dùng qua veg.treePitLine (khỏi thêm import xsection vào world.js — tránh xung đột gộp)
import { LM_POLY } from './landmark_polys.js';
import { claimAt } from './claims.js';
import { RB_B64 } from './buildings_real.js';
import { decodeRB, makeFootprintGrid } from './buildings_data.js';

export const SP = { XACU: 0, BANG: 1, PHUONG: 2, SAU: 3, BANGLANG: 4, CAU: 5, CATCUT: 6, DA: 7, NON: 8 };
const SP_N = 9;
const SP_NAME = ['xacu', 'bang', 'phuong', 'sau', 'banglang', 'cau', 'catcut', 'da', 'non'];
const KIND_OF = Object.fromEntries(SP_NAME.map((n, i) => [n, i]));

// Tầm LOD theo TIER (KHÔNG theo cảm ứng). Cây hero GLB 85-101k tam giác: chỉ trong HERO_R.
const LOW = TIER <= 1;
const NEAR_R = LOW ? 110 : 180;
const FAR_R = LOW ? 520 : 1000;
const HERO_R = 150;
const CARD_Q = LOW ? 0.62 : 1;          // tỉ lệ số thẻ lá kit gần
const ATLAS_S = TIER >= 2 ? 512 : 256;  // cỡ 1 ô atlas (4×4 ô)
// TIER ≥ 2 có MSAA (composer samples 4): alpha-to-coverage + làm sắc alpha (Golus) → mép lá mịn thay vì răng cưa
// alpha-test; TIER ≤ 1 (không MSAA) giữ alpha-test 0,5.
const A2C = TIER >= 2;

// ---------- hash / RNG tất định ----------
function rng(seed) {
  let a = seed | 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hash3(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 0x2545F491);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hxz = (x, z, salt) => hash3(Math.round(x * 8), Math.round(z * 8), salt);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// =====================================================================================================
// 1) ATLAS LÁ THỦ TỤC (canvas 4×4 ô). Lưu PREMULTIPLIED (premultiplyAlpha=true, NoColorSpace) rồi shader chia lại alpha
//    và tự giải sRGB → lọc song tuyến + mipmap ĐÚNG ở mép lá (không viền đen như CanvasTexture mặc định).
// =====================================================================================================
const CELL = { XACU_A: 0, XACU_B: 1, SAU: 2, DA: 3, BANG_A: 4, BANG_B: 5, BL_LEAF: 6, SHOOT: 7, PH_A: 8, PH_B: 9, PH_FLOWER: 10, BL_FLOWER: 11, BARK: 12, WASH: 13, PALM: 14, FROND: 15 };
// ô i → toạ độ uv (flipY: hàng canvas 0 = v cao)
function cellRect(i, padPx = 0) {
  const W = 4, col = i % W, row = (i / W) | 0, p = padPx / (ATLAS_S * 4);
  return { u0: col / W + p, u1: (col + 1) / W - p, v0: 1 - (row + 1) / W + p, v1: 1 - row / W - p };
}
function subRect(r, fu0, fv0, fu1, fv1) {   // phần con của ô (theo tỉ lệ u, v trong ô)
  return { u0: lerp(r.u0, r.u1, fu0), u1: lerp(r.u0, r.u1, fu1), v0: lerp(r.v0, r.v1, fv0), v1: lerp(r.v0, r.v1, fv1) };
}

function buildAtlasCanvas() {
  const S = ATLAS_S, W = S * 4, k = S / 512;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = W;
  const g = cv.getContext('2d');
  const xy = (i) => [(i % 4) * S, ((i / 4) | 0) * S];
  const begin = (i, pad) => { const [x, y] = xy(i); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.beginPath(); g.rect(x + pad, y + pad, S - 2 * pad, S - 2 * pad); g.clip(); return [x, y]; };
  const end = () => { g.restore(); g.setTransform(1, 0, 0, 1, 0, 0); };
  const stampAt = (st, x, y, ang, sc) => { const c = Math.cos(ang) * sc, s = Math.sin(ang) * sc; g.setTransform(c, s, -s, c, x, y); g.drawImage(st, 0, -st.height / 2); };
  const mk = (w, h, draw) => { const c = document.createElement('canvas'); c.width = Math.max(2, Math.ceil(w)); c.height = Math.max(2, Math.ceil(h)); draw(c.getContext('2d'), c.width, c.height); return c; };
  // phiến lá (gốc ở trái-giữa, mũi ở phải)
  const leafPath = (c, L, Wd, shape) => {
    c.beginPath(); c.moveTo(0, 0);
    if (shape === 'obo') { c.bezierCurveTo(L * 0.28, -Wd * 0.32, L * 0.82, -Wd * 0.78, L, -Wd * 0.05); c.bezierCurveTo(L * 0.86, Wd * 0.7, L * 0.28, Wd * 0.34, 0, 0); }
    else if (shape === 'narrow') { c.bezierCurveTo(L * 0.3, -Wd * 0.55, L * 0.75, -Wd * 0.35, L, 0); c.bezierCurveTo(L * 0.75, Wd * 0.35, L * 0.3, Wd * 0.55, 0, 0); }
    else { c.bezierCurveTo(L * 0.22, -Wd * 0.64, L * 0.72, -Wd * 0.56, L, 0); c.bezierCurveTo(L * 0.72, Wd * 0.56, L * 0.22, Wd * 0.64, 0, 0); }
    c.closePath();
  };
  const leafStamp = (L, Wd, shape, c1, c2, vein) => mk(L + 2, Wd + 2, (c, w, h) => {
    c.translate(1, h / 2);
    const gr = c.createLinearGradient(0, -Wd / 2, 0, Wd / 2); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
    leafPath(c, L, Wd, shape); c.fillStyle = gr; c.fill();
    if (vein) { c.strokeStyle = vein; c.lineWidth = Math.max(0.6, Wd * 0.06); c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.9, 0); c.stroke(); }
  });
  const twig = (x, y, ang, len, w, col, bend = 0.2) => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round';
    const mx = x + Math.cos(ang + bend) * len * 0.5, my = y + Math.sin(ang + bend) * len * 0.5;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  };
  // lá kép lông chim 1 lần (xà cừ, sấu): cuống chính + n cặp lá chét
  const compound = (r, x, y, ang, L, pairs, sts, rach) => {
    twig(x, y, ang, L, 1.3 * k, rach, (r() - 0.5) * 0.3);
    for (let p = 0; p < pairs; p++) {
      const t = 0.28 + 0.72 * (p + 0.5) / pairs, px = x + Math.cos(ang) * L * t, py = y + Math.sin(ang) * L * t;
      for (const s of [-1, 1]) stampAt(sts[(r() * sts.length) | 0], px, py, ang + s * (0.95 + r() * 0.35), 0.8 + r() * 0.4);
    }
  };
  const scatterPts = (r, cx, cy, R, n, fn) => { for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R; fn(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, a, rr / R); } };

  // ---- xà cừ (lá chét nhỏ bầu dục, xanh thẫm bóng) ----
  const xcSt = [['#6a9844', '#3a5c2a'], ['#5a8a3b', '#34522a'], ['#78a44e', '#44682f'], ['#507e3e', '#2f4d26'], ['#86ae5a', '#4a7033']]
    .map(([a, b]) => leafStamp(27 * k, 11 * k, 'ell', a, b, null));
  for (const [ci, seed] of [[CELL.XACU_A, 11], [CELL.XACU_B, 12]]) {
    const r = rng(seed), [x0, y0] = begin(ci, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    for (let t = 0; t < 9; t++) twig(cx + (r() - 0.5) * S * 0.2, cy + (r() - 0.5) * S * 0.2, r() * 6.28, S * (0.22 + r() * 0.18), 2.2 * k, '#4a3f30');
    scatterPts(r, cx, cy, S * 0.4, 52, (x, y, a) => compound(r, x, y, a + (r() - 0.5) * 1.5, (55 + r() * 45) * k, 4, xcSt, '#4c5b2e'));
    end();
  }
  // ---- sấu (lá chét thuôn dài hơn, xanh vừa) ----
  const sauSt = [['#7eaa52', '#46703a'], ['#70a04a', '#3f6731'], ['#8cb65e', '#4b7536']].map(([a, b]) => leafStamp(36 * k, 12 * k, 'narrow', a, b, null));
  { const r = rng(21), [x0, y0] = begin(CELL.SAU, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    for (let t = 0; t < 8; t++) twig(cx + (r() - 0.5) * S * 0.2, cy + (r() - 0.5) * S * 0.2, r() * 6.28, S * (0.2 + r() * 0.2), 2 * k, '#4d4232');
    scatterPts(r, cx, cy, S * 0.4, 44, (x, y, a) => compound(r, x, y, a + (r() - 0.5) * 1.4, (70 + r() * 40) * k, 5, sauSt, '#5a6634'));
    end(); }
  // ---- đa/si (lá đơn bầu dục dày, xanh thẫm) ----
  const daSt = [['#5c8a40', '#2c4a25'], ['#527e3c', '#284322'], ['#699650', '#33542a']].map(([a, b]) => leafStamp(32 * k, 16 * k, 'ell', a, b, '#6f8f52'));
  { const r = rng(31), [x0, y0] = begin(CELL.DA, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    for (let t = 0; t < 10; t++) twig(cx, cy, r() * 6.28, S * (0.25 + r() * 0.15), 2.4 * k, '#4b4134');
    scatterPts(r, cx, cy, S * 0.42, 330, (x, y, a) => stampAt(daSt[(r() * 3) | 0], x, y, a + (r() - 0.5) * 2.2, 0.75 + r() * 0.45));
    end(); }
  // ---- bàng (lá to hình trứng ngược, mọc thành CHÙM HOA THỊ đầu cành; ít lá vàng/đỏ) ----
  const bangCols = [['#83ad4c', '#43692a'], ['#76a344', '#3b6126'], ['#91b85a', '#4d7430'], ['#6a983c', '#355a22'], ['#c2b14a', '#7d7a2c'], ['#b8643a', '#7a3a22']];
  const bangSt = bangCols.map(([a, b]) => leafStamp(64 * k, 33 * k, 'obo', a, b, '#a9c27a'));
  for (const [ci, seed] of [[CELL.BANG_A, 41], [CELL.BANG_B, 42]]) {
    const r = rng(seed), [x0, y0] = begin(ci, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    const ros = [];
    scatterPts(r, cx, cy, S * 0.36, 22, (x, y) => ros.push([x, y]));
    for (const [rx, ry] of ros) twig(cx, cy, Math.atan2(ry - cy, rx - cx), Math.hypot(rx - cx, ry - cy), 2.6 * k, '#55473a', 0.1);
    for (const [rx, ry] of ros) {
      const n = 7 + ((r() * 3) | 0), a0 = r() * 6.28;
      for (let j = 0; j < n; j++) {
        const q = r(), st = bangSt[q < 0.05 ? 5 : q < 0.13 ? 4 : (r() * 4) | 0];
        stampAt(st, rx, ry, a0 + (j / n) * 6.28 + (r() - 0.5) * 0.4, 0.75 + r() * 0.35);
      }
    }
    end();
  }
  // ---- bằng lăng: lá ----
  const blSt = [['#78a24e', '#3a5e2a'], ['#6a9646', '#325624']].map(([a, b]) => leafStamp(62 * k, 26 * k, 'ell', a, b, '#9db878'));
  { const r = rng(51), [x0, y0] = begin(CELL.BL_LEAF, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    for (let t = 0; t < 8; t++) twig(cx, cy, r() * 6.28, S * (0.22 + r() * 0.15), 2.2 * k, '#5a4b3a');
    scatterPts(r, cx, cy, S * 0.41, 125, (x, y, a) => stampAt(blSt[(r() * 2) | 0], x, y, a + (r() - 0.5) * 1.8, 0.75 + r() * 0.4));
    end(); }
  // ---- chồi non (cây cắt cụt đâm chồi / cây non): cành mảnh + lá non xanh nõn, thưa ----
  const shSt = [['#a6cf63', '#5f8f34'], ['#93c252', '#527f2c'], ['#b4d872', '#6a9a3a']].map(([a, b]) => leafStamp(26 * k, 13 * k, 'ell', a, b, null));
  { const r = rng(61), [x0, y0] = begin(CELL.SHOOT, 5 * k);
    for (let t = 0; t < 8; t++) {
      const bx = x0 + S * (0.25 + r() * 0.5), by = y0 + S * (0.62 + r() * 0.22);
      for (let s = 0; s < 4 + ((r() * 2) | 0); s++) {
        const a = -Math.PI / 2 + (r() - 0.5) * 1.5, L = (60 + r() * 80) * k;
        twig(bx, by, a, L, 1.5 * k, '#6c7b3c', (r() - 0.5) * 0.4);
        for (let q = 0.25; q < 1; q += 0.16) stampAt(shSt[(r() * 3) | 0], bx + Math.cos(a) * L * q, by + Math.sin(a) * L * q, a + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.5), 0.7 + r() * 0.5);
      }
    }
    end(); }
  // ---- phượng: lá kép LÔNG CHIM 2 LẦN (mịn như lông vũ, xanh nõn chuối) ----
  const pinna = (c1, c2) => mk(46 * k, 12 * k, (c, w, h) => {
    c.translate(0, h / 2); c.strokeStyle = c2; c.lineWidth = Math.max(0.6, 0.9 * k); c.beginPath(); c.moveTo(0, 0); c.lineTo(w - 1, 0); c.stroke();
    c.fillStyle = c1;
    for (let i = 1; i < 13; i++) { const x = i * (w - 2) / 13; for (const s of [-1, 1]) { c.beginPath(); c.ellipse(x, s * 2.6 * k, 2.6 * k, 1.25 * k, s * 1.15, 0, Math.PI * 2); c.fill(); } }
  });
  const phPin = [['#93c255', '#62903a'], ['#82b648', '#567f30'], ['#a3cb63', '#6f9a3f'], ['#78a640', '#4b7429']].map(([a, b]) => pinna(a, b));
  const frondPh = (r, x, y, ang, L) => {
    twig(x, y, ang, L, 1.2 * k, '#6f8a3e', (r() - 0.5) * 0.25);
    const np = 10 + ((r() * 3) | 0);
    for (let p = 0; p < np; p++) {
      const t = 0.12 + 0.88 * p / np, px = x + Math.cos(ang) * L * t, py = y + Math.sin(ang) * L * t, sc = 0.95 - 0.35 * t;
      for (const s of [-1, 1]) stampAt(phPin[(r() * 4) | 0], px, py, ang + s * (1.15 + (r() - 0.5) * 0.3), sc * (0.85 + r() * 0.3));
    }
  };
  for (const [ci, seed, n] of [[CELL.PH_A, 71, 27], [CELL.PH_B, 72, 23]]) {
    const r = rng(seed), [x0, y0] = begin(ci, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    const hubs = []; scatterPts(r, cx, cy, S * 0.14, 4, (x, y) => hubs.push([x, y]));
    for (const [hx, hy] of hubs) twig(cx, cy, Math.atan2(hy - cy, hx - cx), Math.hypot(hx - cx, hy - cy) + 1, 2.4 * k, '#4f4538');
    for (let f = 0; f < n; f++) { const [hx, hy] = hubs[f % hubs.length]; const a = r() * 6.28; frondPh(r, hx, hy, a, (130 + r() * 80) * k); }
    end();
  }
  // ---- hoa phượng: chùm hoa đỏ cam (5 cánh, 1 cánh cờ vàng kem) trên nền lá ----
  const flower = (c1, c2) => mk(24 * k, 24 * k, (c, w, h) => {
    c.translate(w / 2, h / 2);
    for (let p = 0; p < 5; p++) {
      const a = p / 5 * Math.PI * 2;
      c.fillStyle = p === 0 ? '#f6dc8e' : (p % 2 ? c1 : c2);
      c.beginPath(); c.ellipse(Math.cos(a) * 5.2 * k, Math.sin(a) * 5.2 * k, 5.2 * k, 3.6 * k, a, 0, Math.PI * 2); c.fill();
      if (p === 0) { c.fillStyle = '#c8321a'; c.beginPath(); c.ellipse(Math.cos(a) * 5 * k, Math.sin(a) * 5 * k, 1.5 * k, 1 * k, a, 0, Math.PI * 2); c.fill(); }
    }
    c.fillStyle = '#7a1a0c'; c.beginPath(); c.arc(0, 0, 1.6 * k, 0, Math.PI * 2); c.fill();
  });
  const fls = [['#ff5a1f', '#f03c16'], ['#ee3d17', '#d82a12'], ['#ff7426', '#f04c1a'], ['#e52f15', '#ff5a22']].map(([a, b]) => flower(a, b));
  { const r = rng(81), [x0, y0] = begin(CELL.PH_FLOWER, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    for (let f = 0; f < 12; f++) frondPh(r, cx + (r() - 0.5) * S * 0.2, cy + (r() - 0.5) * S * 0.2, r() * 6.28, (120 + r() * 70) * k);
    scatterPts(r, cx, cy, S * 0.36, 20, (x, y) => { for (let q = 0; q < 14; q++) { const a = r() * 6.28, rr = r() * 30 * k; stampAt(fls[(r() * 4) | 0], x + Math.cos(a) * rr, y + Math.sin(a) * rr, r() * 6.28, 0.8 + r() * 0.4); } });
    end(); }
  // ---- hoa bằng lăng: chuỳ hoa tím dựng đứng ----
  const blF = ['#a173d8', '#8b5cc6', '#b58be3', '#7d4fb8'].map((c1) => mk(12 * k, 12 * k, (c, w, h) => {
    c.translate(w / 2, h / 2); c.fillStyle = c1;
    for (let p = 0; p < 4; p++) { const a = p / 4 * Math.PI * 2 + 0.4; c.beginPath(); c.ellipse(Math.cos(a) * 2.6 * k, Math.sin(a) * 2.6 * k, 2.8 * k, 2.2 * k, a, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#f2e27a'; c.beginPath(); c.arc(0, 0, 1 * k, 0, Math.PI * 2); c.fill();
  }));
  { const r = rng(91), [x0, y0] = begin(CELL.BL_FLOWER, 5 * k), cx = x0 + S / 2, cy = y0 + S / 2;
    scatterPts(r, cx, cy, S * 0.4, 40, (x, y, a) => stampAt(blSt[(r() * 2) | 0], x, y, a + (r() - 0.5) * 1.8, 0.7 + r() * 0.4));
    for (let p = 0; p < 9; p++) {
      const bx = cx + (r() - 0.5) * S * 0.6, by = cy + (r() - 0.2) * S * 0.45, ph = (90 + r() * 50) * k, pw = (40 + r() * 16) * k;
      for (let q = 0; q < 46; q++) { const t = r(), wv = (1 - t) * pw * (r() - 0.5); stampAt(blF[(r() * 4) | 0], bx + wv, by - t * ph, r() * 6.28, 0.8 + r() * 0.4); }
    }
    end(); }
  // ---- vỏ cây (xám nâu, rãnh dọc, đốm địa y) — ô ĐỤC ----
  const bark = (x0, y0, r, base) => {
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = base; g.fillRect(x0, y0, S, S);
    for (let i = 0; i < 520; i++) {
      const dark = r() < 0.6; g.globalAlpha = 0.1 + r() * 0.24; g.fillStyle = dark ? '#5a5248' : '#b9b0a0';
      g.fillRect(x0 + r() * S, y0 + r() * S, (1 + r() * 3.5) * k, (14 + r() * 90) * k);
    }
    for (let i = 0; i < 70; i++) { g.globalAlpha = 0.18 + r() * 0.3; g.fillStyle = r() < 0.5 ? '#a8aa92' : '#7f8a6a'; g.beginPath(); g.ellipse(x0 + r() * S, y0 + r() * S, (3 + r() * 9) * k, (2 + r() * 6) * k, r() * 3, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  };
  // nền vỏ nâu xám (đo pano_007/055: thân nắng ~#82705c, thân bóng ~#4f4237); trước #aba190 lên game thành xám bê tông
  { const [x0, y0] = xy(CELL.BARK); bark(x0, y0, rng(101), '#8f7f6a'); }
  // ---- gốc QUÉT VÔI: nửa dưới trắng vôi (mép trên nham nhở), trên là vỏ ----
  { const [x0, y0] = xy(CELL.WASH), r = rng(102); bark(x0, y0, r, '#8f7f6a');
    g.fillStyle = '#e7e5dc'; g.beginPath(); g.moveTo(x0, y0 + S);
    for (let x = 0; x <= S; x += 8 * k) g.lineTo(x0 + x, y0 + S * (0.2 + 0.035 * Math.sin(x * 0.05 / k) + 0.03 * (r() - 0.5)));
    g.lineTo(x0 + S, y0 + S); g.closePath(); g.fill();
    for (let i = 0; i < 260; i++) { g.globalAlpha = 0.08 + r() * 0.14; g.fillStyle = r() < 0.7 ? '#8d887c' : '#ffffff'; g.fillRect(x0 + r() * S, y0 + S * (0.26 + r() * 0.74), (1 + r() * 3) * k, (4 + r() * 30) * k); }
    g.globalAlpha = 1; }
  // ---- thân cau vua (xám trắng, vòng đốt) + phần trên = bẹ xanh (crownshaft) ----
  { const [x0, y0] = xy(CELL.PALM), r = rng(111);
    g.fillStyle = '#bcb7ab'; g.fillRect(x0, y0 + S * 0.22, S, S * 0.78);
    for (let y = S * 0.22; y < S; y += S / 26) { g.globalAlpha = 0.55; g.fillStyle = '#948f84'; g.fillRect(x0, y0 + y + (r() - 0.5) * 3 * k, S, 2.2 * k); }
    for (let i = 0; i < 160; i++) { g.globalAlpha = 0.1 + r() * 0.16; g.fillStyle = r() < 0.5 ? '#7d786e' : '#e1ddd2'; g.fillRect(x0 + r() * S, y0 + S * 0.22 + r() * S * 0.78, (1 + r() * 2) * k, (8 + r() * 40) * k); }
    g.globalAlpha = 1;
    const gr = g.createLinearGradient(x0, 0, x0 + S, 0); gr.addColorStop(0, '#4f7d3c'); gr.addColorStop(0.5, '#6c9a4c'); gr.addColorStop(1, '#4f7d3c');
    g.fillStyle = gr; g.fillRect(x0, y0, S, S * 0.2);
    for (let i = 0; i < 60; i++) { g.globalAlpha = 0.15; g.fillStyle = '#9ec07a'; g.fillRect(x0 + r() * S, y0 + r() * S * 0.2, 2 * k, (6 + r() * 30) * k); }
    g.globalAlpha = 1; }
  // ---- tàu lá cau (2 tàu / ô, mỗi tàu nằm ngang trong 1 dải nửa ô) ----
  { const [x0, y0] = begin(CELL.FROND, 3 * k), r = rng(121);
    const pin = [['#5f9236', '#3f6a24'], ['#548730', '#365e1f'], ['#6c9e3e', '#46722a']].map(([a, b]) => leafStamp(110 * k, 7 * k, 'narrow', a, b, null));
    for (const band of [0, 1]) {
      const yc = y0 + S * (band ? 0.75 : 0.25);
      twig(x0 + S * 0.02, yc, 0, S * 0.96, 3 * k, '#a3a16a', 0.02);
      for (let i = 0; i < 52; i++) {
        const t = 0.04 + 0.94 * i / 52, px = x0 + S * (0.02 + 0.96 * t);
        const len = (1 - 0.55 * t) * (0.95 + r() * 0.15);
        for (const s of [-1, 1]) stampAt(pin[(r() * 3) | 0], px, yc, s * (0.75 + r() * 0.25) - 0.05, len);
      }
    }
    end(); }
  g.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

// =====================================================================================================
// 2) KIT HÌNH HỌC (thân/cành ống côn + thẻ lá). Thuộc tính: position, normal (vòm tán cho lá), uv (atlas),
//    color (AO × màu vỏ), aKind (0 gỗ, 1 gỗ-gốc-vôi, 2 lá, 3 hoa), aSway (độ lắc theo gió).
// =====================================================================================================
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.k = []; this.s = []; this.i = []; this.nv = 0; }
  v(x, y, z, nx, ny, nz, u, v, cr, cg, cb, kind, sway) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(cr, cg, cb); this.k.push(kind); this.s.push(sway);
    return this.nv++;
  }
  t(a, b, c) { this.i.push(a, b, c); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    g.setIndex(this.nv > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _P = new THREE.Vector3(), _U = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
// ống côn theo polyline pts=[[x,y,z,r],...]; uv quấn hết bề ngang ô, v trải theo chiều dài; col(y)→[r,g,b]; sway(x,y,z)
function tube(G, pts, sides, rect, kind, col, sway, cap) {
  const n = pts.length, Ls = [0];
  for (let i = 1; i < n; i++) Ls.push(Ls[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const Lt = Ls[n - 1] || 1, base = G.nv;
  const prevN = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    _T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    if (i === 0) { _N.crossVectors(_T, Math.abs(_T.y) < 0.95 ? _U : _X).normalize(); }
    else { _N.copy(prevN).addScaledVector(_T, -prevN.dot(_T)); if (_N.lengthSq() < 1e-8) _N.crossVectors(_T, _X); _N.normalize(); }
    prevN.copy(_N); _B.crossVectors(_T, _N);
    const [x, y, z, r] = pts[i], cc = col(y), v = lerp(rect.v0, rect.v1, Ls[i] / Lt);
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
      const dx = _N.x * cs + _B.x * sn, dy = _N.y * cs + _B.y * sn, dz = _N.z * cs + _B.z * sn;
      const px = x + dx * r, py = y + dy * r, pz = z + dz * r;
      G.v(px, py, pz, dx, dy, dz, lerp(rect.u0, rect.u1, j / sides), v, cc[0], cc[1], cc[2], kind, sway(px, py, pz));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < sides; j++) {
    const a = base + i * (sides + 1) + j, b = a + 1, c = a + sides + 2, d = a + sides + 1;
    G.t(a, b, c); G.t(a, c, d);
  }
  if (cap) {   // mặt cắt (cây cắt cụt): quạt tròn màu gỗ sáng
    const [x, y, z] = pts[n - 1], last = base + (n - 1) * (sides + 1);
    const cu = (rect.u0 + rect.u1) / 2, cvv = (rect.v0 + rect.v1) / 2;
    const ctr = G.v(x + _T.x * 0.03, y + _T.y * 0.03, z + _T.z * 0.03, _T.x, _T.y, _T.z, cu, cvv, cap[0], cap[1], cap[2], kind, sway(x, y, z));
    for (let j = 0; j < sides; j++) {
      const a = last + j, b = last + j + 1;
      const ia = G.v(G.p[a * 3], G.p[a * 3 + 1], G.p[a * 3 + 2], _T.x, _T.y, _T.z, cu + (G.uv[a * 2] - cu) * 0.3, cvv + 0.01, cap[0], cap[1], cap[2], kind, G.s[a]);
      const ib = G.v(G.p[b * 3], G.p[b * 3 + 1], G.p[b * 3 + 2], _T.x, _T.y, _T.z, cu + (G.uv[b * 2] - cu) * 0.3, cvv - 0.01, cap[0], cap[1], cap[2], kind, G.s[b]);
      G.t(ctr, ia, ib);
    }
  }
}
// thẻ lá vuông cạnh `size` tâm p, pháp tuyến hình học n, pháp tuyến CHIẾU SÁNG nl, xoay trong mặt phẳng `rot`
function card(G, px, py, pz, nx, ny, nz, size, rect, rot, kind, ao, nl, sway, aspect = 1) {
  _N.set(nx, ny, nz).normalize();
  _T.crossVectors(_N, Math.abs(_N.y) < 0.9 ? _U : _X).normalize();
  _T.applyAxisAngle(_N, rot); _B.crossVectors(_N, _T);
  const hw = size * 0.5 * aspect, hh = size * 0.5, base = G.nv;
  const cs = [[-1, -1, rect.u0, rect.v0], [1, -1, rect.u1, rect.v0], [1, 1, rect.u1, rect.v1], [-1, 1, rect.u0, rect.v1]];
  // phần LẺ của kind (0..0,4) = số ngẫu nhiên RIÊNG của thẻ → shader bỏ thẻ khi số đó > độ kín tán của instance (aInst.w)
  const kr = kind >= 2 ? kind + 0.4 * (Math.abs(Math.sin(px * 12.9898 + py * 78.233 + pz * 37.719) * 43758.5453) % 1) : kind;
  for (const [a, b, u, v] of cs) {
    G.v(px + _T.x * hw * a + _B.x * hh * b, py + _T.y * hw * a + _B.y * hh * b, pz + _T.z * hw * a + _B.z * hh * b,
      nl[0], nl[1], nl[2], u, v, ao, ao, ao, kr, sway);
  }
  G.t(base, base + 1, base + 2); G.t(base, base + 2, base + 3);
}
const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

// Bảng KIT (kích thước danh nghĩa — instance co giãn theo chiều cao/bán kính tán thực).
// form: round (xà cừ/sấu/bằng lăng/đa/non) | umbrella (phượng) | tier (bàng) | pollard (cắt cụt) | palm (cau vua)
const KIT_DEFS = [
  { sp: SP.XACU, form: 'round', H: 14, trunkH: 4.8, r0: 0.4, r1: 0.27, lean: 0.015, limbs: 5, limbAng: [0.28, 0.6], limbLen: 5.2, sub: 2, cy: 9.9, rx: 4.6, ry: 4.1, cards: 108, cardS: [1.7, 2.6], cells: [CELL.XACU_A, CELL.XACU_B], bark: [0.95, 0.93, 0.9], up: 0.15 },
  { sp: SP.XACU, form: 'round', H: 12.5, trunkH: 3.9, r0: 0.44, r1: 0.3, lean: 0.035, limbs: 5, limbAng: [0.55, 0.95], limbLen: 5.8, sub: 2, cy: 8.7, rx: 5.7, ry: 3.4, cards: 112, cardS: [1.7, 2.6], cells: [CELL.XACU_A, CELL.XACU_B], bark: [0.93, 0.9, 0.86], up: 0.3 },
  { sp: SP.BANG, form: 'tier', H: 10.5, r0: 0.3, tiers: [[3.6, 5.2], [5.6, 4.9], [7.5, 3.9], [9.1, 2.3]], branches: 5, cards: 132, cardS: [2.0, 2.9], cells: [CELL.BANG_A, CELL.BANG_B], bark: [0.8, 0.76, 0.72] },
  { sp: SP.BANG, form: 'tier', H: 11, r0: 0.34, tiers: [[3.2, 6.2], [5.5, 5.7], [7.8, 4.3], [9.6, 2.2]], branches: 6, cards: 140, cardS: [2.1, 3.0], cells: [CELL.BANG_A, CELL.BANG_B], bark: [0.8, 0.76, 0.72] },
  { sp: SP.PHUONG, form: 'umbrella', H: 9.8, trunkH: 3.0, r0: 0.38, r1: 0.29, lean: 0.03, limbs: 5, limbAng: [0.85, 1.15], limbLen: 5.3, sub: 3, cy: 7.4, rx: 5.9, ry: 2.3, cards: 96, cardS: [1.9, 2.8], cells: [CELL.PH_A, CELL.PH_B], flowerCell: CELL.PH_FLOWER, flowers: 44, bark: [1.0, 0.98, 0.96], up: 0.65 },
  { sp: SP.PHUONG, form: 'umbrella', H: 10.6, trunkH: 3.7, r0: 0.4, r1: 0.3, lean: 0.1, limbs: 4, limbAng: [0.65, 1.05], limbLen: 5.6, sub: 3, cy: 8.2, rx: 5.3, ry: 2.7, cards: 92, cardS: [1.9, 2.8], cells: [CELL.PH_A, CELL.PH_B], flowerCell: CELL.PH_FLOWER, flowers: 40, bark: [1.0, 0.98, 0.96], up: 0.6 },
  { sp: SP.SAU, form: 'round', H: 12, trunkH: 3.6, r0: 0.36, r1: 0.25, lean: 0.02, limbs: 5, limbAng: [0.4, 0.8], limbLen: 4.4, sub: 2, cy: 8.2, rx: 4.7, ry: 3.9, cards: 112, cardS: [1.6, 2.5], cells: [CELL.SAU], bark: [0.86, 0.82, 0.78], up: 0.2 },
  { sp: SP.BANGLANG, form: 'round', H: 9, trunkH: 2.9, r0: 0.26, r1: 0.18, lean: 0.02, limbs: 4, limbAng: [0.35, 0.75], limbLen: 3.2, sub: 2, cy: 6.3, rx: 3.5, ry: 3.0, cards: 80, cardS: [1.4, 2.1], cells: [CELL.BL_LEAF], flowerCell: CELL.BL_FLOWER, flowers: 30, bark: [1.0, 0.96, 0.92], up: 0.2 },
  { sp: SP.CAU, form: 'palm', H: 13.5, trunkH: 11.2, r0: 0.3, r1: 0.22, shaft: 1.7, fronds: 15, frondL: 4.6, frondW: 1.5 },
  { sp: SP.CATCUT, form: 'pollard', H: 7, trunkH: 4.0, r0: 0.44, r1: 0.34, lean: 0.03, stubs: 4, stubLen: [1.1, 2.3], shoots: 3, cardS: [0.8, 1.3], cells: [CELL.SHOOT], bark: [0.9, 0.87, 0.83] },
  { sp: SP.CATCUT, form: 'pollard', H: 8, trunkH: 4.5, r0: 0.4, r1: 0.31, lean: 0.06, stubs: 5, stubLen: [1.4, 2.7], shoots: 8, cardS: [0.9, 1.6], cells: [CELL.SHOOT, CELL.SHOOT, CELL.XACU_A], bark: [0.9, 0.87, 0.83] },
  { sp: SP.DA, form: 'round', H: 15, trunkH: 3.6, r0: 1.0, r1: 0.62, lean: 0, limbs: 7, limbAng: [0.85, 1.25], limbLen: 7.6, sub: 2, cy: 10.2, rx: 9.0, ry: 4.6, cards: 170, cardS: [2.3, 3.3], cells: [CELL.DA], bark: [0.82, 0.8, 0.76], up: 0.35, stems: 4, roots: 18 },
  { sp: SP.NON, form: 'round', H: 4.6, trunkH: 2.2, r0: 0.075, r1: 0.05, lean: 0.01, limbs: 4, limbAng: [0.4, 0.7], limbLen: 1.1, sub: 0, cy: 3.4, rx: 1.3, ry: 1.15, cards: 22, cardS: [0.8, 1.2], cells: [CELL.XACU_A, CELL.SAU], bark: [0.9, 0.86, 0.8], up: 0.2, stakes: true },
];
const SP_KITS = Array.from({ length: SP_N }, () => []);
KIT_DEFS.forEach((d, i) => SP_KITS[d.sp].push(i));
// bán kính tán danh nghĩa (để khớp tham số r của các helper cũ)
const kitR = (d) => d.form === 'tier' ? d.tiers[0][1] : d.form === 'palm' ? d.frondL * 0.8 : d.form === 'pollard' ? d.stubLen[1] + 0.8 : d.rx;

function genKit(d, far, seed) {
  const G = new Geo(), r = rng(seed);
  const WASH_H = 1.25;
  const rectBark = cellRect(CELL.BARK, 2), rectWash = cellRect(CELL.WASH, 2);
  const barkC = d.bark || [0.9, 0.88, 0.85];
  const H = d.H, tH = d.trunkH || H * 0.5;
  const woodAO = (y) => { const t = clamp((y - tH * 0.85) / Math.max(1, H - tH * 0.85), 0, 1); const a = (y < 0.6 ? 0.86 + 0.24 * y : 1.0) * (1 - 0.22 * t); return [barkC[0] * a, barkC[1] * a, barkC[2] * a]; };
  const woodSway = (x, y, z) => clamp((y - tH * 0.7) / Math.max(1, H - tH * 0.7), 0, 1) ** 1.5 * 0.55 + clamp(Math.hypot(x, z) / 8, 0, 0.3);
  const lean = d.lean || 0, lx = lean, lz = lean * 0.35;
  const sidesT = far ? 5 : (d.r0 > 0.6 ? 10 : 8), sidesL = far ? 4 : 6, sidesS = 4;
  // ---- thân: đoạn gốc quét vôi (kind 1) + thân trên (kind 0) ----
  const trunk = (r0, r1, top, ox = 0, oz = 0) => {
    const at = (y) => [ox + lx * Math.max(0, y), oz + lz * Math.max(0, y)];
    const [a0x, a0z] = at(-0.4), [a1x, a1z] = at(0.15), [a2x, a2z] = at(WASH_H);
    tube(G, [[a0x, -0.4, a0z, r0 * 1.32], [a1x, 0.15, a1z, r0 * 1.12], [a2x, WASH_H, a2z, r0]], sidesT, rectWash, 1, woodAO, woodSway);
    const pts = [[a2x, WASH_H, a2z, r0]];
    const nseg = far ? 1 : 3;
    for (let s = 1; s <= nseg; s++) { const y = lerp(WASH_H, top, s / nseg), [x, z] = at(y); pts.push([x + (far ? 0 : (r() - 0.5) * 0.06), y, z + (far ? 0 : (r() - 0.5) * 0.06), lerp(r0, r1, s / nseg)]); }
    tube(G, pts, sidesT, rectBark, 0, woodAO, woodSway);
    return at(top);
  };
  // ---- cành cong (ngóc dần lên), trả về điểm đầu/giữa/cuối ----
  const limb = (sx, sy, sz, az, th, len, rA, rB, sides, bendUp, segs = 3) => {
    const pts = []; let x = sx, y = sy, z = sz, t = th;
    for (let s = 0; s <= segs; s++) {
      pts.push([x, y, z, lerp(rA, rB, s / segs)]);
      const st = len / segs; x += Math.sin(t) * Math.cos(az) * st; y += Math.cos(t) * st; z += Math.sin(t) * Math.sin(az) * st;
      t = Math.max(0.05, t - bendUp);
    }
    tube(G, pts, sides, rectBark, 0, woodAO, woodSway);
    return pts;
  };
  const leafCell = (cells) => cellRect(cells[(r() * cells.length) | 0], 3);
  // thẻ lá quanh tâm tán ellipsoid c=(cx,cy,cz),(rx,ry); tips = điểm hút (đầu cành)
  const crownCards = (cx, cy, cz, rx, ry, tips, n, sMin, sMax, cells, upBias, kind = 2, topOnly = false) => {
    for (let i = 0; i < n; i++) {
      let px, py, pz;
      if (!topOnly && tips.length && i < n * 0.58) {
        const tp = tips[i % tips.length], sp = 1.0 + 0.4 * (rx / 5);
        px = tp[0] + (r() + r() - 1) * sp; py = tp[1] + (r() + r() - 1) * sp * 0.6 + 0.3; pz = tp[2] + (r() + r() - 1) * sp;
      } else {
        const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        let dy = topOnly ? Math.abs(u) * 0.8 + 0.2 : u;
        const f = topOnly ? 0.8 + r() * 0.24 : 0.62 + r() * 0.4;
        px = cx + s * Math.cos(a) * rx * f; py = cy + dy * ry * f; pz = cz + s * Math.sin(a) * rx * f;
      }
      // giữ trong vỏ ellipsoid ×1.08
      let ex = (px - cx) / rx, ey = (py - cy) / ry, ez = (pz - cz) / rx, e = Math.hypot(ex, ey, ez);
      if (e > 1.08) { const k = 1.08 / e; px = cx + (px - cx) * k; py = cy + (py - cy) * k; pz = cz + (pz - cz) * k; ex *= k; ey *= k; ez *= k; e = 1.08; }
      const [gx, gy, gz] = norm3(ex / rx, ey / ry, ez / rx);
      const [nx, ny, nz] = norm3(gx * 0.6 + (r() - 0.5) * 1.4, gy * 0.6 + (r() - 0.5) * 1.4 + upBias, gz * 0.6 + (r() - 0.5) * 1.4);
      const nl = norm3(gx * 0.7 + nx * 0.12, gy * 0.7 + ny * 0.12 + 0.45, gz * 0.7 + nz * 0.12);
      const hF = clamp((py - (cy - ry)) / (2 * ry), 0, 1);
      // kit XA không có bóng tự đổ trong tán (castShadow tắt) → tối bớt 12% cho khớp độ sáng trung bình kit gần (đỡ "bật" ở ranh 180 m)
      const ao = kind === 3 ? 1.0 : clamp(0.56 + 0.3 * Math.min(e, 1) + 0.2 * hF + (r() - 0.5) * 0.1, 0.5, 1.08) * (far ? 0.88 : 1);
      const sw = clamp(0.35 + 0.65 * (py - tH) / Math.max(1, H - tH), 0.25, 1) * (0.55 + 0.45 * Math.min(e, 1));
      card(G, px, py, pz, nx, ny, nz, lerp(sMin, sMax, r()) * (0.85 + 0.25 * Math.min(e, 1)), kind === 3 ? cellRect(d.flowerCell, 3) : leafCell(cells), r() * 6.283, kind, ao, nl, sw);
    }
  };

  if (d.form === 'round' || d.form === 'umbrella') {
    const top = trunk(d.r0, d.r1, tH);
    const cx = lx * d.cy * 0.85, cz = lz * d.cy * 0.85, tips = [];
    if (d.stems && !far) for (let s = 0; s < d.stems; s++) { const a = s / d.stems * 6.28 + 0.4; trunk(d.r0 * 0.45, d.r1 * 0.4, tH * 0.85, Math.cos(a) * d.r0 * 0.9, Math.sin(a) * d.r0 * 0.9); }
    const nL = far ? Math.min(3, d.limbs) : d.limbs;
    for (let l = 0; l < nL; l++) {
      const az = (l / nL) * Math.PI * 2 + r() * 0.7, th = lerp(d.limbAng[0], d.limbAng[1], r());
      const len = d.limbLen * (0.82 + r() * 0.35), sy = tH - (l % 2) * 0.5 * (tH / 4);
      const bend = d.form === 'umbrella' ? 0.22 : 0.12;
      const P = limb(top[0], sy, top[1], az, th, len, d.r1 * 0.68, Math.max(0.03, d.r1 * 0.12), far ? sidesS : sidesL, bend, far ? 2 : 3);
      const e = P[P.length - 1]; tips.push(e);
      if (!far) {
        tips.push(P[2]);
        for (let s = 0; s < d.sub; s++) {
          const b = P[1 + (s % 2)], az2 = az + (s % 2 ? 1 : -1) * (0.55 + r() * 0.4), th2 = Math.min(1.4, th + 0.1 + r() * 0.25);
          const Q = limb(b[0], b[1], b[2], az2, th2, len * (0.34 + r() * 0.16), b[3] * 0.55, 0.035, sidesS, bend, 2);
          tips.push(Q[Q.length - 1]);
        }
      }
    }
    if (d.roots && !far) for (let q = 0; q < d.roots; q++) {      // rễ phụ buông (đa/si)
      const a = r() * 6.28, rr = 2 + r() * (d.rx - 3), x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, yt = d.cy - d.ry * (0.55 + r() * 0.3);
      tube(G, [[x, yt, z, 0.05 + r() * 0.05], [x + (r() - 0.5) * 0.3, yt * 0.5, z + (r() - 0.5) * 0.3, 0.05 + r() * 0.06], [x, -0.2, z, 0.06 + r() * 0.08]], 4, rectBark, 0, woodAO, woodSway);
    }
    if (d.stakes && !far) for (let q = 0; q < 3; q++) {            // cọc chống (cây non)
      const a = q / 3 * 6.28 + 0.5;
      tube(G, [[Math.cos(a) * 0.62, -0.3, Math.sin(a) * 0.62, 0.035], [Math.cos(a) * 0.1, 1.55, Math.sin(a) * 0.1, 0.03]], 4, rectBark, 0, () => [1.55, 1.38, 1.1], () => 0);
    }
    // kit XA: ~19% số thẻ, thẻ ×1,9 (nhìn từ trên cao/vệ tinh tán vẫn thành khối liền, không lấm tấm)
    const n = Math.round(far ? Math.max(14, d.cards * 0.19) : d.cards * CARD_Q);
    const sMul = far ? 1.9 : 1;
    // kit XA: thẻ ngửa lên nhiều hơn (nhìn từ trên/xa tán vẫn kín — ảnh vệ tinh), gần: theo loài
    crownCards(cx, d.cy, cz, d.rx, d.ry, tips, n, d.cardS[0] * sMul, d.cardS[1] * sMul, d.cells, (d.up || 0.2) + (far ? 0.55 : 0));
    if (d.flowers) crownCards(cx, d.cy, cz, d.rx * 0.97, d.ry, [], far ? 6 : Math.round(d.flowers * CARD_Q), (far ? 2.4 : 1.2), (far ? 3.2 : 2.0), d.cells, 0.55, 3, true);
  } else if (d.form === 'tier') {
    // BÀNG: thân thẳng tới ngọn, các TẦNG cành gần nằm ngang, lá dồn đầu cành thành tầng phẳng (dáng chùa)
    trunk(d.r0, d.r0 * 0.3, H * 0.94);
    let wsum = 0; for (const [, R] of d.tiers) wsum += R * R;
    const nCards = far ? Math.max(22, d.cards * 0.21) : d.cards * CARD_Q, sMul = far ? 1.8 : 1;
    d.tiers.forEach(([ty, R], ti) => {
      const nb = far ? 4 : d.branches + (ti === d.tiers.length - 1 ? -2 : 0), az0 = r() * 6.28, tips = [];
      for (let b = 0; b < nb; b++) {
        const az = az0 + b / nb * 6.28 + (r() - 0.5) * 0.4, len = R * (0.85 + r() * 0.2);
        const P = limb(lx * ty, ty, lz * ty, az, 1.38 + r() * 0.12, len, d.r0 * 0.38 * (R / d.tiers[0][1]) + 0.03, 0.03, far ? sidesS : sidesL, 0.09, far ? 1 : 3);
        tips.push(P[P.length - 1]); if (!far) tips.push(P[2]);
      }
      const n = Math.round(nCards * R * R / wsum);
      for (let i = 0; i < n; i++) {
        let px, py, pz;
        if (i < n * 0.7) { const tp = tips[i % tips.length]; px = tp[0] + (r() + r() - 1) * 1.3; py = tp[1] + 0.1 + r() * 0.6; pz = tp[2] + (r() + r() - 1) * 1.3; }
        else { const a = r() * 6.28, rr = Math.sqrt(0.08 + r() * 0.92) * R; px = lx * ty + Math.cos(a) * rr; py = ty + 0.2 + r() * 0.55; pz = lz * ty + Math.sin(a) * rr; }
        const rr = Math.hypot(px - lx * ty, pz - lz * ty) / R;
        const [nx, ny, nz] = norm3((r() - 0.5) * (far ? 1.6 : 0.9), far ? 1.0 : 1.7, (r() - 0.5) * (far ? 1.6 : 0.9));
        const nl = norm3((px - lx * ty) / R * 0.55, 1.0, (pz - lz * ty) / R * 0.55);
        const ao = clamp(0.5 + 0.35 * rr + 0.25 * (ti / Math.max(1, d.tiers.length - 1)) + (r() - 0.5) * 0.1, 0.4, 1.06) * (far ? 0.88 : 1);
        const sw = clamp(0.3 + 0.7 * (py / H), 0.2, 1) * (0.5 + 0.5 * rr);
        card(G, px, py, pz, nx, ny, nz, lerp(d.cardS[0], d.cardS[1], r()) * sMul, leafCell(d.cells), r() * 6.283, 2, ao, nl, sw);
      }
    });
  } else if (d.form === 'pollard') {
    // CÂY CẮT CỤT: thân to, 3-5 cành cụt ngóc lên (mặt cắt sáng), chồi non túm ở đầu cụt + vài chồi dọc thân
    const top = trunk(d.r0, d.r1, d.trunkH);
    const tips = [];
    const nS = far ? 3 : d.stubs;
    for (let s = 0; s < nS; s++) {
      const az = s / nS * 6.28 + r() * 0.8, th = 0.22 + r() * 0.55, len = lerp(d.stubLen[0], d.stubLen[1], r());
      const P = limb(top[0], d.trunkH - r() * 0.7, top[1], az, th, len, d.r1 * 0.7, d.r1 * 0.5, far ? sidesS : sidesL, 0.05, far ? 1 : 2);
      const e = P[P.length - 1];
      if (!far) {     // mặt cắt
        const [x, y, z, rr] = e; const dx = Math.sin(th) * Math.cos(az), dy = Math.cos(th), dz = Math.sin(th) * Math.sin(az);
        tube(G, [[x - dx * 0.05, y - dy * 0.05, z - dz * 0.05, rr], [x, y, z, rr * 0.98]], sidesL, rectBark, 0, woodAO, woodSway, [1.55, 1.36, 1.05]);
        if (r() < 0.7) { const Q = limb(x - dx * 0.2, y - dy * 0.2, z - dz * 0.2, az + (r() - 0.5) * 1.2, 0.3 + r() * 0.4, 0.8 + r() * 0.9, 0.04, 0.015, 3, 0.1, 2); tips.push(Q[Q.length - 1]); }
      }
      tips.push(e);
    }
    const nC = far ? 8 : Math.round((d.shoots * nS + 3) * CARD_Q + 2);
    for (let i = 0; i < nC; i++) {
      let px, py, pz;
      if (i < nC - 3 || far) { const tp = tips[i % tips.length]; px = tp[0] + (r() - 0.5) * 1.1; py = tp[1] + 0.25 + r() * 0.6; pz = tp[2] + (r() - 0.5) * 1.1; }
      else { const a = r() * 6.28, y = d.trunkH * (0.45 + r() * 0.4); px = lx * y + Math.cos(a) * (d.r0 + 0.25); py = y; pz = lz * y + Math.sin(a) * (d.r0 + 0.25); }
      const [nx, ny, nz] = norm3((r() - 0.5) * 2, 0.6 + r(), (r() - 0.5) * 2);
      const nl = norm3(px * 0.4, 1, pz * 0.4);
      card(G, px, py, pz, nx, ny, nz, lerp(d.cardS[0], d.cardS[1], r()) * (far ? 1.6 : 1), leafCell(d.cells), r() * 6.283, 2, clamp(0.75 + r() * 0.3, 0.6, 1.05), nl, clamp(0.4 + 0.6 * py / d.H, 0.3, 1));
    }
  } else if (d.form === 'palm') {
    // CAU VUA: thân xám trắng hơi phình, bẹ xanh, 15 tàu lá cong rủ (mặt cắt chữ V)
    const pr = cellRect(CELL.PALM, 2), trunkR = subRect(pr, 0, 0, 1, 0.76), shaftR = subRect(pr, 0, 0.8, 1, 1);
    const tH2 = d.trunkH, n = far ? 2 : 7, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, y = -0.3 + t * (tH2 + 0.3); pts.push([lean * y, y, 0, lerp(d.r0, d.r1, t) + Math.sin(Math.min(1, t * 1.3) * Math.PI) * 0.06]); }
    const palmC = () => [1, 1, 1], palmSw = (x, y) => clamp((y - 3) / tH2, 0, 1) ** 2 * 0.35;
    tube(G, pts, far ? 5 : 9, trunkR, 0, palmC, palmSw);
    const t0 = pts[n];
    tube(G, [[t0[0], tH2, 0, d.r1 * 1.08], [t0[0], tH2 + d.shaft * 0.55, 0, d.r1 * 1.16], [t0[0], tH2 + d.shaft, 0, d.r1 * 0.8]], far ? 5 : 9, shaftR, 0, palmC, palmSw);
    const fr = cellRect(CELL.FROND, 2), bands = [subRect(fr, 0, 0.5, 1, 1), subRect(fr, 0, 0, 1, 0.5)];
    const nF = far ? 8 : d.fronds, segs = far ? 3 : 6;
    for (let f = 0; f < nF; f++) {
      const az = f / nF * 6.28 + r() * 0.35, e0 = 1.25 - (f % 3) * 0.55 - r() * 0.3, L = d.frondL * (0.85 + r() * 0.25), Wd = d.frondW * (0.85 + r() * 0.3);
      const band = bands[f % 2], old = e0 < 0.3;
      let x = t0[0], y = tH2 + d.shaft * 0.85, z = 0, el = e0;
      const sx = -Math.sin(az), sz = Math.cos(az);
      const cc = old ? [1.12, 1.0, 0.68] : [1, 1, 1];
      const rows = [];
      for (let s = 0; s <= segs; s++) {
        const t = s / segs, w = Wd * (0.25 + 0.75 * Math.sin(Math.min(1, t * 1.1 + 0.08) * Math.PI)) * 0.5, dip = w * 0.45;
        const hx = Math.cos(el) * Math.cos(az), hz = Math.cos(el) * Math.sin(az);
        const nl = norm3(hx * 0.5, 1, hz * 0.5), sw = 0.25 + 0.75 * t;
        const u = lerp(band.u0, band.u1, t);
        rows.push([G.v(x + sx * w, y - dip, z + sz * w, nl[0], nl[1], nl[2], u, band.v1, cc[0], cc[1], cc[2], 2, sw),
          G.v(x, y, z, nl[0], nl[1], nl[2], u, (band.v0 + band.v1) / 2, cc[0], cc[1], cc[2], 2, sw),
          G.v(x - sx * w, y - dip, z - sz * w, nl[0], nl[1], nl[2], u, band.v0, cc[0], cc[1], cc[2], 2, sw)]);
        const st = L / segs; x += Math.cos(el) * Math.cos(az) * st; y += Math.sin(el) * st; z += Math.cos(el) * Math.sin(az) * st;
        el -= 0.32 + 0.18 * t;
      }
      for (let s = 0; s < segs; s++) {
        const a = rows[s], b = rows[s + 1];
        G.t(a[0], a[1], b[1]); G.t(a[0], b[1], b[0]); G.t(a[1], a[2], b[2]); G.t(a[1], b[2], b[1]);
      }
    }
  }
  const geo = G.build();
  return { geo, def: d, R: kitR(d), tris: G.i.length / 3 };
}

// =====================================================================================================
// 3) HÀNG ĐỢI TRỒNG + CHỌN LOÀI theo pano / vùng
// =====================================================================================================
const Q = [];                          // cây đã xếp hàng
const _trunkGrid = new Map();          // ô 4 m → [x,z] (chống trồng chồng)
const tkey = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);
function addTrunk(x, z) { const k = tkey(x, z); let a = _trunkGrid.get(k); if (!a) _trunkGrid.set(k, (a = [])); a.push(x, z); }
export function trunkNear(x, z, r) {
  const r2 = r * r, i0 = Math.floor((x - r) / 4), i1 = Math.floor((x + r) / 4), j0 = Math.floor((z - r) / 4), j1 = Math.floor((z + r) / 4);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const a = _trunkGrid.get(i * 100003 + j); if (!a) continue;
    for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r2) return true;
  }
  return false;
}
// kind: tên loài | 'shade' | 'street' | 'park'. o: {h (cao m), r (bán kính tán m), bloom (0/1), wash (0/1), pit (0 không,
// 1 ô vuông), hero (biến thể GLB 0..2), yaw, variant (chỉ số kit trong loài), sz (hệ số cỡ theo cấp phố), full (độ kín tán 0..1),
// median (1 = cây dải phân cách, miễn kiểm lòng đường)}
export function plant(kind, x, z, o = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  Q.push({ kind, x, z, o });
  addTrunk(x, z);
  return true;
}
export function plantLocal(parent, lx, lz, kind, o = {}) { Q.push({ kind, parent, lx, lz, o }); return true; }

// ---- camera 551 pano (js/panoclear.js): không trồng/dời cây trong r m quanh điểm chụp (lưới 8 m, dựng 1 lần) ----
// PANO_CLEAR 4,5 m: camera pano thật đứng trên LÒNG ĐƯỜNG (xe chụp đi giữa làn) → quanh nó không có gốc cây; trước 3 m
// thì 68 camera có cây < 4 m, tán bàng/xà cừ che kín nửa trên khung (pano_019/008). Áp cho MỌI cây trừ dải phân cách
// (o.median). HERO_PANO_CLEAR 12 m: tán GLB phượng xoè 6-7 m — hero 9,7 m trước pano_001_h090 che ~35% khung.
const PANO_CLEAR = 4.5, HERO_PANO_CLEAR = 12;
let _PG = null;
function nearPano(x, z, r) {
  if (!_PG) { _PG = new Map(); for (const [px, pz] of PANO_CAM) { const k = Math.floor(px / 8) * 100003 + Math.floor(pz / 8); let a = _PG.get(k); if (!a) _PG.set(k, (a = [])); a.push(px, pz); } }
  const ci = Math.floor(x / 8), cj = Math.floor(z / 8);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = _PG.get(i * 100003 + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r * r) return true; }
  return false;
}
// ---- tra pano gần nhất (≤ 60 m) ----
const VG = new Map(), VCELL = 60;
for (let i = 0; i < PANO_VEG.length; i += PANO_VEG_STRIDE) {
  const x = PANO_VEG[i] / 10, z = PANO_VEG[i + 1] / 10, k = Math.floor(x / VCELL) * 100003 + Math.floor(z / VCELL);
  let a = VG.get(k); if (!a) VG.set(k, (a = [])); a.push(i);
}
function panoVeg(x, z, rMax = 60) {
  let best = -1, bd = rMax * rMax;
  const ci = Math.floor(x / VCELL), cj = Math.floor(z / VCELL);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const a = VG.get(i * 100003 + j); if (!a) continue;
    for (const o of a) { const d = (PANO_VEG[o] / 10 - x) ** 2 + (PANO_VEG[o + 1] / 10 - z) ** 2; if (d < bd) { bd = d; best = o; } }
  }
  return best;    // chỉ số trong PANO_VEG hoặc −1
}
// dải vườn hoa trung tâm (hồ Tam Bạc → Nhà hát → THĐ/QT → Tố Hữu): phượng là chủ đạo
const CENTRAL = [[-600, 230], [-400, 195], [-127, 142], [0, 60], [132, 70], [312, -25], [482, -155], [637, -335], [709, -669]];
function distPolyline(x, z, P) {
  let b = 1e9;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < b) b = d;
  }
  return b;
}
let _ctx = {};     // hàm vùng (lakeSD, hdTreeBelt) — đặt ở plantStreetTrees/buildTrees
// trọng số loài [xacu, bang, phuong, sau, banglang, cau, -, da]; + tỉ lệ cắt cụt / cây non / mật độ / quét vôi
function vegAt(x, z) {
  let w, pollard, young = 0.04, dens = 2, wash = 0.55, pano = false, cauRaw = 0, near = false, thin = 0;
  if (_ctx.hdTreeBelt && _ctx.hdTreeBelt(x, z)) { w = [1, 0.3, 0, 0.1, 0, 0, 0, 0]; pollard = 0.6; }
  else if (_ctx.lakeSD && _ctx.lakeSD(x, z) < 45) { w = [0.42, 0.3, 0.12, 0.1, 0.04, 0, 0, 0.02]; pollard = 0.18; }
  else if (distPolyline(x, z, CENTRAL) < 110) { w = [0.3, 0.14, 0.42, 0.05, 0.05, 0.04, 0, 0]; pollard = 0.15; }
  else { w = [0.36, 0.26, 0.2, 0.09, 0.05, 0.02, 0, 0]; pollard = 0.12; }
  const pi = panoVeg(x, z);
  if (pi >= 0) {
    const V = PANO_VEG, o = pi + 2;
    const wp = [V[o], V[o + 1], V[o + 2], V[o + 3], V[o + 4], V[o + 5] * 0.7, 0, V[o + 6] * 0.3];
    const sp = wp.reduce((a, b) => a + b, 0), sz = w.reduce((a, b) => a + b, 0);
    near = true; cauRaw = V[o + 5];
    if (sp > 0) { w = w.map((v, i) => 0.3 * v / sz + 0.7 * wp[i] / sp); pano = true; }
    pollard = V[o + 7] ? 0.06 + V[o + 7] / 10 * 0.85 : pollard * 0.6;
    young = V[o + 8] ? V[o + 8] / 10 * 0.6 : 0.03;
    dens = V[o + 9];
    if (V[o + 10]) wash = 0.9;
    thin = V[o + 12] || (V[o + 7] >= 5 ? 1 : 0);   // tán thưa / trụi lá — hoặc vùng cắt cụt nặng (cây còn lại cũng xơ xác)
  }
  return { w, pollard, young, dens, wash, pano, cauRaw, near, thin };
}
function pickW(w, h) {
  let s = 0; for (const v of w) s += v;
  let t = h * s;
  for (let i = 0; i < w.length; i++) { t -= w[i]; if (t <= 0 && w[i] > 0) return i; }
  for (let i = w.length - 1; i >= 0; i--) if (w[i] > 0) return i;
  return 0;
}
// loài cụ thể cho 1 cây: mode 'street' (hè phố: cau chỉ khi pano nói rõ "hàng cau") | 'park' (công viên/vườn hoa:
// cau theo pano) | 'shade' (cây bóng mát — không phượng/cau/bằng lăng)
function resolveSpecies(x, z, mode) {
  const V = vegAt(x, z);
  const w = V.w.slice(); w[6] = 0;
  if (mode === 'shade') { w[2] = 0; w[4] = 0; w[5] = 0; w[7] = 0; if (!(w[0] + w[1] + w[3] > 0)) { w[0] = 0.5; w[1] = 0.35; w[3] = 0.15; } }
  else if (mode === 'park') { w[7] = 0; if (V.cauRaw >= 3) w[5] = Math.max(w[5], 0.15); }
  else { w[7] = 0; if (V.cauRaw < 7) w[5] = 0; }   // cau dọc phố chỉ khi pano nói rõ; đa chỉ trồng đích danh
  let sp = pickW(w, hxz(x, z, 3));
  const hp = hxz(x, z, 5), hy = hxz(x, z, 6);
  if (sp !== SP.CAU && hp < V.pollard) sp = SP.CATCUT;
  else if (sp !== SP.CAU && hy < V.young) sp = SP.NON;
  return { sp, V };
}

// =====================================================================================================
// 4) TRỒNG THEO DỮ LIỆU dọc phố (thay vòng 46 m cũ + cây xà cừ 2 bên đại lộ cap 170)
// =====================================================================================================
const MARGIN = { p: 1.3, s: 1.2, t: 1.0, r: 0.9, w: 0.5, h: 0.7 };
let _fp = null;
function footprints(ctx) {
  if (ctx.fpGrid) return ctx.fpGrid;
  if (!_fp) _fp = makeFootprintGrid(decodeRB(RB_B64));
  return _fp;
}
// ---- lưới đoạn đường dùng chung (mọi cấp, kể cả ngõ h): ô 16 m, mỗi đoạn chèn vào mọi ô trong bbox + (nửa lòng + 3 m) ----
let _ri = null;
export function roadIndex(ROADS_DT, R = 1600) {
  if (_ri && _ri.src === ROADS_DT) return _ri;
  const SC = 16, sg = new Map(), segs = [];
  ROADS_DT.forEach((rd, ri) => {
    for (let i = 0; i + 1 < rd.pts.length; i++) {
      const [ax, az] = rd.pts[i], [bx, bz] = rd.pts[i + 1];
      if (Math.min(Math.hypot(ax, az), Math.hypot(bx, bz)) > R + 80) continue;
      const hw = ROAD_HW[rd.c] ?? 2.75, s = { ax, az, bx, bz, ri, si: i, hw, c: rd.c, m: MARGIN[rd.c] ?? 0.8 };
      const pad = hw + 3, id = segs.length; segs.push(s);
      for (let gi = Math.floor((Math.min(ax, bx) - pad) / SC); gi <= Math.floor((Math.max(ax, bx) + pad) / SC); gi++)
        for (let gj = Math.floor((Math.min(az, bz) - pad) / SC); gj <= Math.floor((Math.max(az, bz) + pad) / SC); gj++) {
          const k = gi * 100003 + gj; let a = sg.get(k); if (!a) sg.set(k, (a = [])); a.push(id);
        }
    }
  });
  const segD = (x, z, s) => { const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1; let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; return Math.hypot(x - s.ax - t * dx, z - s.az - t * dz); };
  // điểm nằm trong lòng đường (nửa lòng + extra ≤ 3 m) của bất kỳ đoạn nào (bỏ qua các cấp trong `skip`, vd 'wh')
  const nearRoad = (x, z, extra = 0, skip = '') => {
    const a = sg.get(Math.floor(x / SC) * 100003 + Math.floor(z / SC)); if (!a) return false;
    for (const id of a) { const s = segs[id]; if (skip.includes(s.c)) continue; if (segD(x, z, s) < s.hw + extra) return true; }
    return false;
  };
  _ri = { src: ROADS_DT, SC, sg, segs, segD, nearRoad };
  return _ri;
}
// ctx: { ROADS_DT, groundHeightNoDeck, isWater, addCollider, colliders, lakeSD, hdTreeBelt, R, landH, fpGrid?, keepClear? }
//   fpGrid: lưới footprint dùng chung (makeFootprintGrid — nhà `D.dead` bị bỏ qua); thiếu thì tự giải RB_B64.
//   keepClear(x,z) → true = cấm trồng (hành lang nhìn địa danh, vd trục spawn → Nhà hát).
export function plantStreetTrees(ctx) {
  const t0 = performance.now();
  _ctx = ctx;
  const { ROADS_DT, groundHeightNoDeck, isWater } = ctx;
  const R = ctx.R || 1600, LAND = ctx.landH ?? 2;
  const RI = roadIndex(ROADS_DT, R), { segs, sg, SC, segD } = RI;
  // trong lòng (hoặc mép) đường KHÁC / đoạn khác của chính đường này → loại
  const blockedByRoad = (x, z, ri, si) => {
    const a = sg.get(Math.floor(x / SC) * 100003 + Math.floor(z / SC)); if (!a) return false;
    for (const id of a) {
      const s = segs[id];
      // chính đường này: đoạn đang đi cho khoảng cách = treePitLine > nửa lòng + 0,25 nên kiểm MỌI đoạn được
      // (bắt cả chỗ khúc cua gắt — điểm phía trong cua lọt vào lòng đoạn kế bên)
      if (s.ri === ri) { if (s.si !== si && segD(x, z, s) < s.hw + 0.25) return true; continue; }
      if (segD(x, z, s) < s.hw + s.m) return true;
    }
    return false;
  };
  // --- nút giao: đỉnh chung ≥ 2 đường + đầu/cuối đường ---
  const seen = new Map();
  ROADS_DT.forEach((rd, ri) => { for (const [x, z] of rd.pts) { const k = Math.round(x) + ',' + Math.round(z); let s = seen.get(k); if (!s) seen.set(k, (s = new Set())); s.add(ri); } });
  const NG = new Map(), NC = 16;
  const addNode = (x, z) => { const k = Math.floor(x / NC) * 100003 + Math.floor(z / NC); let a = NG.get(k); if (!a) NG.set(k, (a = [])); a.push(x, z); };
  for (const [k, s] of seen) if (s.size >= 2) { const [x, z] = k.split(',').map(Number); addNode(x, z); }
  for (const rd of ROADS_DT) { const a = rd.pts[0], b = rd.pts[rd.pts.length - 1]; addNode(a[0], a[1]); addNode(b[0], b[1]); }
  const nearNode = (x, z, r) => {
    const r2 = r * r, ci = Math.floor(x / NC), cj = Math.floor(z / NC);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = NG.get(i * 100003 + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r2) return true; }
    return false;
  };
  // --- camera pano (giữ 3 m — nearPano dùng chung), địa danh (LM_POLY + 2,5 m), collider nhỏ (cột/đèn/biển…) ---
  const LMB = Object.values(LM_POLY).map((P) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { P, x0, z0, x1, z1 }; });
  const inLM = (x, z, pad) => {
    for (const b of LMB) {
      if (x < b.x0 - pad || x > b.x1 + pad || z < b.z0 - pad || z > b.z1 + pad) continue;
      let c = false; const P = b.P;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
      if (c) return true;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const s = { ax: P[j][0], az: P[j][1], bx: P[i][0], bz: P[i][1] }; if (segD(x, z, s) < pad) return true; }
    }
    return false;
  };
  const CG = new Map();
  for (const c of (ctx.colliders || [])) { if (c.r > 1.2) continue; const k = Math.floor(c.x / 8) * 100003 + Math.floor(c.z / 8); let a = CG.get(k); if (!a) CG.set(k, (a = [])); a.push(c); }
  const nearProp = (x, z) => { const ci = Math.floor(x / 8), cj = Math.floor(z / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = CG.get(i * 100003 + j); if (!a) continue; for (const c of a) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 0.55) ** 2) return true; } return false; };
  const fp = footprints(ctx);
  const BLOCK = ['landmark', 'civic', 'cell'];   // KHÔNG 'plaza': claim quảng trường chặn NHÀ, không chặn hàng cây bó vỉa quanh nó
  const st = { cand: 0, planted: 0, rej: {} };
  const rej = (k) => { st.rej[k] = (st.rej[k] || 0) + 1; return false; };
  const ok = (x, z, ri, si, c) => {
    if (x * x + z * z > R * R) return rej('radius');
    if (nearPano(x, z, PANO_CLEAR)) return rej('pano');
    if (trunkNear(x, z, 4.2)) return rej('spacing');
    if (Math.abs(groundHeightNoDeck(x, z) - LAND) > 0.35 || isWater(x, z)) return rej('ground');
    if (blockedByRoad(x, z, ri, si)) return rej('road');
    if (nearNode(x, z, (ROAD_HW[c] ?? 2.75) + 4.5)) return rej('junction');
    if (fp.at(x, z) >= 0) return rej('building');
    if (inLM(x, z, 2.5)) return rej('landmark');
    if (ctx.keepClear && ctx.keepClear(x, z)) return rej('keep');
    if (claimAt(x, z, BLOCK)) return rej('claim');
    if (nearProp(x, z)) return rej('prop');
    return true;
  };
  const heroCand = [];
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const rd = ROADS_DT[ri], c = rd.c;
    if (c !== 'p' && c !== 's' && c !== 't' && c !== 'r') continue;
    // nhịp hố cây ~9-10 m (pano: hàng cây phố HP cách nhau 8-12 m); cây phố nhỏ thấp/hẹp tán hơn đại lộ
    const off = treePitLine(c), base = c === 'r' ? 11 : c === 't' ? 9.4 : 9.0, sz = c === 'p' ? 1 : c === 's' ? 0.94 : c === 't' ? 0.86 : 0.8;
    for (const side of [-1, 1]) {
      let acc = 3 + hash3(ri, side + 5, 17) * base;      // lệch pha từng bên
      for (let i = 0; i + 1 < rd.pts.length; i++) {
        const [x1, z1] = rd.pts[i], [x2, z2] = rd.pts[i + 1], L = Math.hypot(x2 - x1, z2 - z1);
        if (L < 0.5) continue;
        if (Math.min(Math.hypot(x1, z1), Math.hypot(x2, z2)) > R + 20) { acc = 3; continue; }
        const ux = (x2 - x1) / L, uz = (z2 - z1) / L, px = -uz * side, pz = ux * side;
        while (acc < L) {
          const tx = x1 + ux * acc + px * off, tz = z1 + uz * acc + pz * off;
          st.cand++;
          const V = vegAt(tx, tz);
          const hj = hxz(tx, tz, 11);
          let step = base * (0.88 + hj * 0.3);
          // mật độ theo pano: 0 không cây (bỏ), 1 thưa (×2,3), 3 rợp (×0,92). Phố r: chỉ trồng nơi pano nói có cây.
          if (V.dens === 0) { acc += step; rej('pano-none'); continue; }
          if (V.dens === 1) step *= 2.3; else if (V.dens === 3) step *= 0.9;
          if (c === 'r' && (!V.near || V.dens < 2 || hxz(tx, tz, 12) < 0.3)) { acc += step; rej('r-nodata'); continue; }
          if (ok(tx, tz, ri, i, c)) {
            const { sp } = resolveSpecies(tx, tz, 'street');
            const bloom = (sp === SP.PHUONG || sp === SP.BANGLANG) && hxz(tx, tz, 21) < 0.35 ? 1 : 0;
            const q = Q.length;
            plant(SP_NAME[sp], tx, tz, { bloom, pit: c === 'r' ? 0 : 1, wash: hxz(tx, tz, 22) < V.wash ? 1 : 0, sz });
            ctx.addCollider && ctx.addCollider(tx, tz, sp === SP.CAU ? 0.45 : 0.55);
            st.planted++;
            if (sp === SP.PHUONG && bloom && (c === 'p' || c === 's') && distPolyline(tx, tz, CENTRAL) < 160 && !(ctx.hdTreeBelt && ctx.hdTreeBelt(tx, tz)) && !nearPano(tx, tz, HERO_PANO_CLEAR)) heroCand.push(q);
          }
          acc += step;
        }
        acc -= L;
      }
    }
  }
  // HERO (GLB phượng Meshy) cho dải trung tâm: chọn đều theo hash (KHÔNG "N cây đầu tiên theo thứ tự ROADS_DT")
  heroCand.sort((a, b) => hxz(Q[a].x, Q[a].z, 31) - hxz(Q[b].x, Q[b].z, 31));
  const nHero = Math.min(heroCand.length, ctx.heroMax ?? 46);
  for (let h = 0; h < nHero; h++) { const e = Q[heroCand[h]]; e.o.hero = hxz(e.x, e.z, 33) < 0.4 ? 0 : hxz(e.x, e.z, 33) < 0.72 ? 1 : 2; }
  st.heroes = nHero; st.ms = +(performance.now() - t0).toFixed(1);
  console.log('[trees] trồng dọc phố:', JSON.stringify(st));
  return st;
}

// =====================================================================================================
// 5) DỰNG: atlas + kit + InstancedMesh + LOD/gió (móc scene.onBeforeRender)
// =====================================================================================================
const U = { uTime: { value: 0 }, uBloom: { value: 1 }, uWind: { value: 1 }, uAtlasPx: { value: ATLAS_S * 4 } };
const VERT_DECL = 'attribute float aKind;\nattribute float aSway;\nattribute vec4 aInst;\nuniform float uTime;\nuniform float uBloom;\nuniform float uWind;\n';
const VERT_BEGIN = `vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
  // hoa: cây không nở / trái mùa → thu thẻ hoa về 1 điểm (tam giác suy biến, không raster)
  if ( aKind > 2.5 && aInst.x * uBloom < 0.5 ) transformed = vec3( 0.0, -3.0, 0.0 );
  // ĐỘ KÍN TÁN từng cây (aInst.w 0..1): thẻ lá/hoa có số ngẫu nhiên riêng (phần lẻ aKind × 2,5) lớn hơn → bỏ
  // ⇒ cùng 1 kit mà cây thưa/cây dày khác nhau, lộ trời + cành như ảnh thật (pano 10/2024 sau bão Yagi)
  if ( aKind > 1.5 && fract( aKind ) * 2.5 > aInst.w ) transformed = vec3( 0.0, -3.0, 0.0 );
  float hpSw = aSway * uWind, hpPh = aInst.z;
  transformed.x += hpSw * ( 0.2 * sin( uTime * 0.83 + hpPh ) + 0.07 * sin( uTime * 2.1 + hpPh * 2.3 ) );
  transformed.z += hpSw * ( 0.16 * cos( uTime * 0.67 + hpPh * 1.3 ) );
  if ( aKind > 1.5 ) transformed += hpSw * 0.045 * sin( uTime * 5.3 + dot( position, vec3( 2.1, 1.3, 1.7 ) ) + hpPh );
#endif`;
// map: chia alpha (premultiplied) + giải sRGB thủ công + bù độ phủ alpha theo mức mip (lá xa không "tan")
const FRAG_MAP = `#ifdef USE_MAP
  vec4 hpTex = texture2D( map, vMapUv );
  hpTex.rgb /= max( hpTex.a, 0.004 );
  hpTex.rgb = pow( hpTex.rgb, vec3( 2.2 ) );
  vec2 hpD = vMapUv * uAtlasPx;
  float hpLod = 0.5 * log2( max( max( dot( dFdx( hpD ), dFdx( hpD ) ), dot( dFdy( hpD ), dFdy( hpD ) ) ), 1e-8 ) );
  hpTex.a *= 1.0 + max( hpLod, 0.0 ) * 0.28;
#ifdef HP_COLOR
  // thẻ lá gần như NGHIÊNG HẲN về phía camera → mờ dần (không thành vạch sẫm cắt ngang trời). Pháp tuyến hình học
  // của mặt từ đạo hàm vị trí (thuộc tính normal là pháp tuyến "vòm tán" để chiếu sáng, không dùng được ở đây)
  if ( vHpLeaf > 0.5 ) {
    vec3 hpFn = normalize( cross( dFdx( vViewPosition ), dFdy( vViewPosition ) ) );
    hpTex.a *= smoothstep( 0.05, 0.22, abs( dot( hpFn, normalize( vViewPosition ) ) ) );
  }
#endif
#ifdef HP_SHARP
  hpTex.a = clamp( ( hpTex.a - 0.5 ) / max( fwidth( hpTex.a ), 0.0001 ) + 0.5, 0.0, 1.0 );
#endif
  diffuseColor *= hpTex;
#endif`;
// lá TRONG MỜ: ánh sáng xuyên lá từ phía sau (trời + nắng theo pháp tuyến ngược) — tán không đen kịt ở mặt khuất,
// lá ngược sáng sáng lên như ảnh thật. Theo cường độ đèn hiện tại → đêm tự tắt.
const FRAG_TRANSL = `#include <lights_fragment_end>
if ( vHpLeaf > 0.5 ) {
  vec3 hpTr = vec3( 0.0 );
  #if NUM_HEMI_LIGHTS > 0
    hpTr += getHemisphereLightIrradiance( hemisphereLights[ 0 ], - normal ) * 0.5;
  #endif
  #if NUM_DIR_LIGHTS > 0
    hpTr += directionalLights[ 0 ].color * max( dot( - normal, directionalLights[ 0 ].direction ), 0.0 );
  #endif
  reflectedLight.indirectDiffuse += hpTr * BRDF_Lambert( diffuseColor.rgb ) * 0.32;
}`;
function patchShader(sh, depth) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_DECL + (depth ? '' : 'varying float vHpLeaf;\n'))
    .replace('#include <begin_vertex>', VERT_BEGIN + (depth ? '' : '\nvHpLeaf = step( 1.5, aKind );'))
    // gốc quét vôi: instance không vôi → dời uv sang ô vỏ (ngay bên trái trong atlas)
    .replace('#include <uv_vertex>', '#include <uv_vertex>\n#if defined( USE_MAP ) && defined( USE_INSTANCING )\n  if ( aKind > 0.5 && aKind < 1.5 && aInst.y < 0.5 ) vMapUv.x -= 0.25;\n#endif');
  if (!depth) {
    // màu instance (sắc lá) CHỈ nhuộm lá/hoa, không nhuộm thân
    sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>',
      '#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )\n  vColor = vec3( 1.0 );\n#endif\n#ifdef USE_COLOR\n  vColor *= color;\n#endif\n#ifdef USE_INSTANCING_COLOR\n  vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, step( 1.5, aKind ) );\n#endif');
    // 2 mặt nhưng KHÔNG lật pháp tuyến mặt sau: pháp tuyến "vòm tán" đã hướng ra ngoài
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_end>', FRAG_TRANSL)
      .replace('#include <common>', '#include <common>\nvarying float vHpLeaf;');
  }
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uAtlasPx;\n' + (A2C ? '#define HP_SHARP\n' : '') + (depth ? '' : '#define HP_COLOR\n')).replace('#include <map_fragment>', FRAG_MAP);
}

let _built = null;
// ctx: { groundHeight, R, lakeSD, hdTreeBelt, colliders?, fpGrid? }
export function buildTrees(scene, ctx = {}) {
  const t0 = performance.now();
  if (ctx.lakeSD || ctx.hdTreeBelt) _ctx = Object.assign({}, _ctx, ctx);
  const R = (ctx.R || 1600) + 120;
  // ---- giải hàng đợi → bản ghi cây ----
  scene.updateMatrixWorld(true);
  const inScene = (o) => { for (let p = o; p; p = p.parent) if (p === scene) return true; return false; };
  const recs = [];
  const _v = new THREE.Vector3();
  // ---- KIỂM VỊ TRÍ cây xếp hàng từ các helper cũ (cells/công viên/hồ…): toạ độ của chúng có từ thời lòng đường/nhà
  // vẽ tay — đo 2026-10-04: 118 cây đứng TRONG LÒNG ĐƯỜNG (hàng 4,5 m tính từ tim phố 's' hw 5; cau giữa tim…),
  // 125 cây TRONG footprint nhà thật (buildings_real), 60 cặp gốc < 3 m. Xử lý: cây trong lòng p/s/t/r cách tim
  // ≥ 0,5 m → DỜI ra hố cây xsection.treePitLine cùng phía (nếu chỗ mới sạch: không lòng đường/nhà/≤ 3 m camera pano);
  // còn lại (giữa tim / trong ngõ h / phố đi bộ w / trong nhà thật /
  // trùng gốc < 1,8 m) → BỎ. Collider gốc do helper thêm ở đúng (x,z) cũ: dời theo hoặc tách khỏi bản đồ (x=1e7 —
  // cùng object nằm trong chỉ mục lưới colIdx của world.js nên không cần xây lại). o.median = cây dải phân cách
  // (đứng trên dải bê tông vẽ đè lên lòng đường) → miễn kiểm lòng đường.
  const fpG = footprints(ctx), RI = _ri;
  const CI = new Map();
  const ckey = (x, z) => Math.round(x * 100) * 4194304 + Math.round(z * 100);   // khoá số (cm) — |z·100| < 2^21
  for (const c of (ctx.colliders || [])) if (c.r <= 2.2) { const k = ckey(c.x, c.z); let a = CI.get(k); if (!a) CI.set(k, (a = [])); a.push(c); }
  const colAt = (x, z) => CI.get(ckey(x, z)) || [];
  // collider nhỏ (cột/đèn/đạo cụ WP7/gốc cây khác, r ≤ 1,2) — chỗ DỜI tới không được đè lên (như nearProp ở plantStreetTrees)
  const SG = new Map();
  for (const c of (ctx.colliders || [])) if (c.r <= 1.2) { const k = Math.floor(c.x / 8) * 100003 + Math.floor(c.z / 8); let a = SG.get(k); if (!a) SG.set(k, (a = [])); a.push(c); }
  const smallColNear = (x, z, own) => { const ci = Math.floor(x / 8), cj = Math.floor(z / 8); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = SG.get(i * 100003 + j); if (!a) continue; for (const c of a) if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 0.55) ** 2 && !(own && own.includes(c))) return true; } return false; };   // own: collider của chính cây
  const fix = { moved: 0, road: 0, fp: 0, dup: 0, pano: 0 };
  const DG = new Map(), dkey = (x, z) => Math.floor(x / 4) * 100003 + Math.floor(z / 4);
  const dupNear = (x, z, r) => { const ci = Math.floor(x / 4), cj = Math.floor(z / 4); for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = DG.get(i * 100003 + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r * r) return true; } return false; };
  // đoạn đường mà điểm lọt vào lòng (cách tim < nửa lòng − 0,3) — null nếu không
  const roadHit = (x, z) => {
    if (!RI) return null;
    const a = RI.sg.get(Math.floor(x / RI.SC) * 100003 + Math.floor(z / RI.SC)); if (!a) return null;
    let best = null, bd = 1e9;
    for (const id of a) { const s = RI.segs[id], d = RI.segD(x, z, s); if (d < s.hw - 0.3 && d - s.hw < bd) { bd = d - s.hw; best = s; } }
    return best;
  };
  for (const e of Q) {
    let x = e.x, z = e.z, y;
    if (e.parent) {
      if (!inScene(e.parent)) continue;          // nhóm đã bị gỡ (cell sink) → bỏ cây trong đó
      _v.set(e.lx, 0, e.lz).applyMatrix4(e.parent.matrixWorld); x = _v.x; z = _v.z; y = _v.y;
    }
    if (x * x + z * z > R * R) continue;
    if (!e.o.median) {
      let drop = null, movedCols = null;
      const s = roadHit(x, z);
      if (s) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - s.ax) * dx + (z - s.az) * dz) / L2, 0, 1), qx = s.ax + t * dx, qz = s.az + t * dz, d = Math.hypot(x - qx, z - qz);
        if ('psrt'.includes(s.c) && d >= 0.5) {
          const off = treePitLine(s.c), nx = qx + (x - qx) / d * off, nz = qz + (z - qz) / d * off;
          if (!roadHit(nx, nz) && (e.parent || fpG.at(nx, nz) < 0) && !nearPano(nx, nz, PANO_CLEAR) && !smallColNear(nx, nz, e.parent ? null : colAt(x, z))) {
            if (!e.parent) { movedCols = colAt(x, z); for (const c of movedCols) { c.x = nx; c.z = nz; } }
            x = nx; z = nz; y = undefined; fix.moved++;
          } else drop = 'road';
        } else drop = 'road';
      }
      if (!drop && !e.parent && fpG.at(x, z) >= 0) drop = 'fp';
      if (!drop && nearPano(x, z, PANO_CLEAR)) drop = 'pano';   // cây cell/hồ/OSM/vườn chưa qua lọc camera
      if (!drop && dupNear(x, z, 1.8)) drop = 'dup';
      if (drop) {
        fix[drop]++;
        if (!e.parent) { const c = (movedCols || colAt(e.x, e.z)).pop(); if (c) { c.x = 1e7; c.z = 1e7; } }   // 1 collider / cây bỏ (kể cả vừa dời)
        continue;
      }
    }
    { const k = dkey(x, z); let a = DG.get(k); if (!a) DG.set(k, (a = [])); a.push(x, z); }
    const gy = ctx.groundHeight ? ctx.groundHeight(x, z) : 2;
    if (y === undefined || Math.abs(y - gy) > 1.5) y = gy;
    let sp, V = null;
    if (e.kind === 'shade' || e.kind === 'street' || e.kind === 'park') ({ sp, V } = resolveSpecies(x, z, e.kind));
    else sp = KIND_OF[e.kind] ?? SP.XACU;
    if (!V) V = vegAt(x, z);
    const o = e.o, kits = SP_KITS[sp];
    const kit = kits[o.variant !== undefined ? o.variant % kits.length : (hxz(x, z, 41) * kits.length) | 0], d = KIT_DEFS[kit];
    // cỡ: h (cao mục tiêu) / r (bán kính tán) từ helper cũ; mặc định ngẫu nhiên ±
    const hs = 0.8 + hxz(x, z, 42) * 0.45;
    let sy = (o.h ? o.h / d.H : hs * (sp === SP.DA ? 1 : sp === SP.CAU ? 0.95 : 0.92)) * (o.sz || 1);
    // trần cỡ theo loài: helper cũ truyền h của "cây to" nhưng pano/vùng có thể biến nó thành cây non/cắt cụt/cau
    // (cây non 4,6 m × 2,2 = thân 0,3 m + cọc chống 4 m — đã gặp ở pano_141)
    const SC = sp === SP.NON ? [0.7, 1.15] : sp === SP.CATCUT ? [0.75, 1.4] : sp === SP.CAU ? [0.45, 1.3] : [0.45, 2.0];
    sy = clamp(sy, SC[0], SC[1]);
    let sxz = o.r ? o.r / kitR(d) : sy * (0.9 + hxz(x, z, 43) * 0.22);
    sxz = clamp(sxz, sy * 0.7, sy * 1.45);
    const bloom = o.bloom !== undefined ? (o.bloom ? 1 : 0) : ((sp === SP.PHUONG || sp === SP.BANGLANG) && hxz(x, z, 21) < 0.35 ? 1 : 0);
    const wash = o.wash !== undefined ? (o.wash ? 1 : 0) : (sp === SP.CAU || sp === SP.DA ? 0 : hxz(x, z, 22) < V.wash ? 1 : 0);
    // độ kín tán (shader bỏ bớt thẻ lá): đa số 0,66-1; nơi pano tả "tán thưa/trụi lá/cắt trụi" 0,42-0,72
    const hf = hxz(x, z, 47);
    const full = o.full ?? (sp === SP.CAU || sp === SP.CATCUT || sp === SP.NON ? 1 : sp === SP.DA ? 0.85 + 0.15 * hf
      : V.thin ? 0.42 + 0.3 * hf : sp === SP.BANG ? 0.75 + 0.25 * hf : 0.66 + 0.34 * hf);
    // hero GLB (luôn nở đỏ) chỉ khi cách camera pano ≥ 12 m — gần hơn: phượng thủ tục, nở theo hash như cây thường
    // (cây hero vườn hoa từ heroTree truyền bloom:1 chỉ để khớp GLB đỏ)
    const hero = sp === SP.PHUONG && o.hero !== undefined && o.hero >= 0 && !nearPano(x, z, HERO_PANO_CLEAR) ? o.hero : -1;
    const bloomF = hero >= 0 ? 1 : o.hero !== undefined && o.hero >= 0 ? (hxz(x, z, 21) < 0.35 ? 1 : 0) : bloom;
    recs.push({ x, y, z, sp, kit, sy, sxz, yaw: o.yaw ?? hxz(x, z, 44) * Math.PI * 2, lx: (hxz(x, z, 45) - 0.5) * 0.07, lz: (hxz(x, z, 46) - 0.5) * 0.07,
      bloom: bloomF, wash, pit: o.pit || 0, hero, full });
  }
  const N = recs.length;
  // ---- atlas + vật liệu (1 material cho MỌI cây gần/xa) ----
  const tA = performance.now();
  const atlas = new THREE.CanvasTexture(buildAtlasCanvas());
  atlas.colorSpace = THREE.NoColorSpace; atlas.premultiplyAlpha = true; atlas.anisotropy = TIER >= 2 ? 8 : 4;
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter; atlas.generateMipmaps = true;
  const atlasMs = performance.now() - tA;
  // alphaTest nhỏ khi A2C: alpha đã làm sắc (dốc ~1 px quanh 0,5) nên ngưỡng gần như không đổi hình — kể cả lượt bóng
  // (WebGLShadowMap chép alphaTest của material chính sang customDepthMaterial)
  const mat = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: A2C ? 0.04 : 0.5, side: THREE.DoubleSide, alphaToCoverage: A2C });
  mat.onBeforeCompile = (sh) => patchShader(sh, false);
  mat.customProgramCacheKey = () => 'hpveg1';
  // WebGL1 (r160 tự lùi khi không có WebGL2): dFdx/fwidth trong FRAG_MAP cần GL_OES_standard_derivatives — three chỉ
  // chèn #extension khi material.extensions.derivatives (WebGL2 bỏ qua cờ này). Thiếu → 2 lỗi biên dịch, mất hết cây.
  mat.extensions = { derivatives: true };
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5, side: THREE.DoubleSide });
  depthMat.onBeforeCompile = (sh) => patchShader(sh, true);
  depthMat.customProgramCacheKey = () => 'hpveg1d';
  depthMat.extensions = { derivatives: true };
  // ---- kit (chỉ loại đang dùng) ----
  const usedK = new Set(recs.map((r) => r.kit)), usedS = new Set(recs.map((r) => r.sp));
  const nearKits = [], farKits = [];
  KIT_DEFS.forEach((d, i) => { nearKits[i] = usedK.has(i) ? genKit(d, false, 1000 + i * 17) : null; });
  // kit XA mỗi loài lấy dáng biến thể 0
  for (let s = 0; s < SP_N; s++) farKits[s] = usedS.has(s) ? genKit(KIT_DEFS[SP_KITS[s][0]], true, 5000 + s * 13) : null;
  // ---- ma trận + màu + thuộc tính từng cây ----
  const M = new Float32Array(N * 16), COL = new Float32Array(N * 3), INST = new Float32Array(N * 4);
  const px = new Float32Array(N), pz = new Float32Array(N);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const SP_TINT = [[1, 1, 1], [1.04, 1.03, 0.95], [1.0, 1.03, 0.95], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [0.95, 0.97, 0.95], [1.03, 1.03, 1]];
  const setM = (i, r) => {
    _e.set(r.lx, r.yaw, r.lz); _q.setFromEuler(_e); _s.set(r.sxz, r.sy, r.sxz); _p.set(r.x, r.y, r.z);
    _m.compose(_p, _q, _s); _m.toArray(M, i * 16);
  };
  recs.forEach((r, i) => {
    setM(i, r);
    px[i] = r.x; pz[i] = r.z;
    const b = 0.86 + hxz(r.x, r.z, 51) * 0.24, tt = SP_TINT[r.sp];
    let cr = tt[0] * b * (1 + (hxz(r.x, r.z, 52) - 0.5) * 0.14), cg = tt[1] * b, cb = tt[2] * b * (1 + (hxz(r.x, r.z, 53) - 0.5) * 0.2);
    if (r.sp === SP.BANG && hxz(r.x, r.z, 54) < 0.18) { cr *= 1.25; cg *= 1.05; cb *= 0.7; }   // bàng ngả vàng
    COL[i * 3] = cr; COL[i * 3 + 1] = cg; COL[i * 3 + 2] = cb;
    INST[i * 4] = r.bloom; INST[i * 4 + 1] = r.wash; INST[i * 4 + 2] = hxz(r.x, r.z, 55) * 6.283; INST[i * 4 + 3] = r.full;
  });
  // ---- nhóm InstancedMesh ----
  const groups = [];
  const mkGroup = (kitObj, cap, name, cast) => {
    const geo = kitObj.geo.clone();
    const aInst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aInst.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', aInst);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = depthMat;
    mesh.count = 0; mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.userData.noCull = true;           // instcull KHÔNG quản (LOD riêng bên dưới)
    mesh.userData.noMerge = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    scene.add(mesh);
    const g = { mesh, cap, idx: new Int32Array(cap).fill(-1), k: 0, dirty: false, aInst, cast, tris: kitObj.tris };
    groups.push(g); return g;
  };
  const nearCount = new Array(KIT_DEFS.length).fill(0), farCount = new Array(SP_N).fill(0);
  for (const r of recs) { nearCount[r.kit]++; farCount[r.sp]++; }
  const nearG = KIT_DEFS.map((d, i) => (nearCount[i] ? mkGroup(nearKits[i], nearCount[i], 'trees_' + SP_NAME[d.sp] + i, true) : null));
  const farG = Array.from({ length: SP_N }, (_, s) => (farCount[s] ? mkGroup(farKits[s], farCount[s], 'trees_far_' + SP_NAME[s], false) : null));
  const kitOf = new Uint8Array(N), spOf = new Uint8Array(N), heroOf = new Int8Array(N);
  recs.forEach((r, i) => { kitOf[i] = r.kit; spOf[i] = r.sp; heroOf[i] = r.hero; });
  // ---- ô gốc cây (bó vỉa bê tông + đất) dọc vỉa hè: 1 InstancedMesh, chỉ hiện trong tầm gần ----
  const pitIdx = []; recs.forEach((r, i) => { if (r.pit) pitIdx.push(i); });
  let pitG = null;
  const PM = new Float32Array(N * 16);
  if (pitIdx.length) {
    const G = new Geo(), top = SIDEWALK_TOP + 0.04, soil = SIDEWALK_TOP - 0.015, o = 0.62, w = 0.11;
    const box = (x0, x1, z0, z1, y0, y1, c) => {
      const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
      for (const [a, b, cc, dd, n] of [[0, 1, 2, 3, [0, 0, -1]], [5, 4, 7, 6, [0, 0, 1]], [4, 0, 3, 7, [-1, 0, 0]], [1, 5, 6, 2, [1, 0, 0]], [3, 2, 6, 7, [0, 1, 0]]]) {
        const base = G.nv; for (const q of [a, b, cc, dd]) G.v(P[q][0], P[q][1], P[q][2], n[0], n[1], n[2], 0, 0, c[0], c[1], c[2], 0, 0);
        G.t(base, base + 1, base + 2); G.t(base, base + 2, base + 3);
      }
    };
    const cc = [0.74, 0.72, 0.68];
    box(-o, o, -o, -o + w, -0.05, top, cc); box(-o, o, o - w, o, -0.05, top, cc); box(-o, -o + w, -o + w, o - w, -0.05, top, cc); box(o - w, o, -o + w, o - w, -0.05, top, cc);
    { const base = G.nv, s = o - w, c = [0.3, 0.24, 0.19]; for (const [x, z] of [[-s, -s], [s, -s], [s, s], [-s, s]]) G.v(x, soil, z, 0, 1, 0, 0, 0, c[0], c[1], c[2], 0, 0); G.t(base, base + 2, base + 1); G.t(base, base + 3, base + 2); }
    const pg = G.build(); pg.deleteAttribute('uv'); pg.deleteAttribute('aKind'); pg.deleteAttribute('aSway');
    const pmesh = new THREE.InstancedMesh(pg, new THREE.MeshLambertMaterial({ vertexColors: true }), pitIdx.length);
    pmesh.count = 0; pmesh.name = 'tree_pits'; pmesh.castShadow = false; pmesh.receiveShadow = true;
    pmesh.userData.noCull = true; pmesh.userData.noMerge = true; pmesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    scene.add(pmesh);
    for (const i of pitIdx) { const r = recs[i]; _e.set(0, r.yaw, 0); _q.setFromEuler(_e); _s.set(1, 1, 1); _p.set(r.x, r.y, r.z); _m.compose(_p, _q, _s); _m.toArray(PM, i * 16); }
    pitG = { mesh: pmesh, cap: pitIdx.length, idx: new Int32Array(pitIdx.length).fill(-1), k: 0, dirty: false, pit: true, tris: pg.index.count / 3 };
  }
  const pitOf = new Uint8Array(N); for (const i of pitIdx) pitOf[i] = 1;
  // ---- HERO (GLB phượng): nạp ngoài (world.js loadHeroTrees) → setHeroModel ----
  const heroG = [null, null, null], heroReady = [false, false, false];
  const heroList = [[], [], []];               // chỉ số cây theo biến thể
  recs.forEach((r, i) => { if (r.hero >= 0) heroList[r.hero].push(i); });
  const HM = new Float32Array(N * 16);
  const heroBox = new Float32Array(N * 2);     // [bán kính bao, cao]
  // ---- LOD ----
  const state = new Uint8Array(N);             // 0 ẩn, 1 gần, 2 xa, 3 hero
  const write = (g, i, src16) => {
    const k = g.k;
    if (g.idx[k] !== i) {
      g.idx[k] = i; g.dirty = true;
      g.mesh.instanceMatrix.array.set(src16.subarray(i * 16, i * 16 + 16), k * 16);
      if (!g.pit && !g.hero) { g.mesh.instanceColor.array.set(COL.subarray(i * 3, i * 3 + 3), k * 3); g.aInst.array.set(INST.subarray(i * 4, i * 4 + 4), k * 4); }
    }
    g.k++;
  };
  const finish = (g, rad) => {
    if (g.k !== g.mesh.count) g.dirty = true;
    if (g.dirty) {
      g.mesh.count = g.k; g.mesh.instanceMatrix.needsUpdate = true;
      if (!g.pit && !g.hero) { g.mesh.instanceColor.needsUpdate = true; g.aInst.needsUpdate = true; }
      // cầu bao từ tâm instance + bán kính tán tối đa (rẻ hơn computeBoundingSphere duyệt ma trận)
      const bs = g.mesh.boundingSphere; bs.makeEmpty();
      if (g.k) {
        let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9; const a = g.mesh.instanceMatrix.array;
        for (let k = 0; k < g.k; k++) { const x = a[k * 16 + 12], y = a[k * 16 + 13], z = a[k * 16 + 14]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        bs.center.set((x0 + x1) / 2, (y0 + y1) / 2 + rad * 0.5, (z0 + z1) / 2);
        bs.radius = Math.hypot(x1 - x0, z1 - z0, y1 - y0) / 2 + rad;
      }
      g.mesh.visible = g.k > 0;
      g.dirty = false;
    }
  };
  let lastX = 1e9, lastZ = 1e9, lastT = -1e9, lastYaw = 1e9, lastCone = 0;
  const heroNear = [];                          // ứng viên hero trong tầm (lọc frustum mỗi khung)
  // NÓN NHÌN cho kit XA: chỉ giữ cây xa trong góc ngang ±(nửa FOV ngang + 31°) quanh hướng nhìn (cây xa không đổ bóng
  // nên sau lưng camera là vô ích; trước: ~5k cây xa vẽ cả vòng 360° ≈ 0,6 M tam giác mỗi khung). cone = cos(giới hạn),
  // < −1 = tắt (camera trực giao / nhìn dốc xuống — mặt đất sau lưng lọt khung). Gán lại khi hướng đổi > 10°.
  let coneCos = -2, coneFx = 0, coneFz = 1;
  const assign = (cx, cz) => {
    for (const g of groups) g.k = 0;
    if (pitG) pitG.k = 0;
    heroNear.length = 0;
    const n2 = NEAR_R * NEAR_R, n2h = (NEAR_R + 12) ** 2, f2 = FAR_R * FAR_R, h2 = HERO_R * HERO_R, h2h = (HERO_R + 10) ** 2, p2 = Math.min(NEAR_R, 90) ** 2;
    const bloomOn = U.uBloom.value >= 0.5;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cx, dz = pz[i] - cz, d2 = dx * dx + dz * dz, prev = state[i];
      const hv = heroOf[i];
      if (hv >= 0 && heroReady[hv] && bloomOn && d2 < (prev === 3 ? h2h : h2)) { state[i] = 3; heroNear.push(i); }
      else if (d2 < (prev === 1 || prev === 3 ? n2h : n2)) { state[i] = 1; write(nearG[kitOf[i]], i, M); }
      else if (d2 < f2 && (coneCos < -1 || dx * coneFx + dz * coneFz >= coneCos * Math.sqrt(d2))) { state[i] = 2; write(farG[spOf[i]], i, M); }
      else state[i] = 0;
      if (pitG && pitOf[i] && d2 < p2) write(pitG, i, PM);
    }
    for (let k = 0; k < nearG.length; k++) if (nearG[k]) finish(nearG[k], 12 * 1.5);
    for (let s = 0; s < SP_N; s++) if (farG[s]) finish(farG[s], 14 * 1.5);
    if (pitG) finish(pitG, 1);
  };
  const _frus = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sph = new THREE.Sphere(), _dir = new THREE.Vector3();
  const heroCull = (cam) => {
    if (!heroNear.length && !heroG.some((g) => g && g.mesh.count)) return;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _frus.setFromProjectionMatrix(_pm);
    for (const g of heroG) if (g) g.k = 0;
    const cxp = cam.position.x, czp = cam.position.z;
    for (const i of heroNear) {
      const g = heroG[heroOf[i]]; if (!g) continue;
      const rad = heroBox[i * 2], h = heroBox[i * 2 + 1];
      _sph.center.set(px[i], M[i * 16 + 13] + h * 0.5, pz[i]); _sph.radius = rad;
      // trong 30 m luôn giữ (bóng đổ vào khung hình từ cây ngay sau lưng/cạnh camera)
      if ((px[i] - cxp) ** 2 + (pz[i] - czp) ** 2 > 900 && !_frus.intersectsSphere(_sph)) continue;
      write(g, i, HM);
    }
    for (const g of heroG) if (g) finish(g, 16);
  };
  let flagsFixed = false;
  const prevOBR = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, cam, rt) {
    prevOBR.call(this, renderer, sc, cam, rt);
    // quấn chu kỳ 200π s: mọi tần số gió trong VERT_BEGIN là bội 0,01 rad/s → nối liền, không mất độ chính xác float sau nhiều giờ
    U.uTime.value = (performance.now() * 0.001) % (200 * Math.PI);
    if (!flagsFixed && scene.matrixWorldAutoUpdate === false) {   // sau freezeStatic (nó đặt cast/receive cho MỌI mesh)
      flagsFixed = true;
      for (const g of groups) { g.mesh.castShadow = g.cast; g.mesh.receiveShadow = true; }
      if (pitG) pitG.mesh.castShadow = false;
    }
    const cx = cam.position.x, cz = cam.position.z, now = performance.now();
    let cone = -2, yaw = 0;
    if (cam.isPerspectiveCamera) {
      cam.getWorldDirection(_dir);
      const hz = Math.hypot(_dir.x, _dir.z), vh = cam.fov * Math.PI / 360;
      if (hz > 1e-3 && Math.asin(clamp(-_dir.y, -1, 1)) + vh < 1.2) {
        coneFx = _dir.x / hz; coneFz = _dir.z / hz; yaw = Math.atan2(coneFx, coneFz);
        const lim = Math.atan(Math.tan(vh) * cam.aspect) + 0.55;
        cone = lim >= Math.PI ? -2 : Math.cos(lim);
      }
    }
    let dYaw = Math.abs(yaw - lastYaw); if (dYaw > Math.PI) dYaw = 2 * Math.PI - dYaw;
    if (now - lastT > 250 || (cx - lastX) ** 2 + (cz - lastZ) ** 2 > 64 || (cone > -1) !== (lastCone > -1) || (cone > -1 && dYaw > 0.17)) {
      lastT = now; lastX = cx; lastZ = cz; lastYaw = yaw; lastCone = cone; coneCos = cone; assign(cx, cz);
    }
    heroCull(cam);
  };
  // ---- hero GLB: gọi khi GLB nạp xong. geometry/material dùng nguyên (file KHÔNG đổi); B = chuẩn hoá về gốc, cao 1 ----
  const setHeroModel = (v, geometry, material, B, aspect) => {
    const L = heroList[v]; if (!L.length || heroG[v]) return;
    const mesh = new THREE.InstancedMesh(geometry, material, L.length);
    mesh.count = 0; mesh.name = 'hero_trees'; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.noCull = true; mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    scene.add(mesh);
    heroG[v] = { mesh, cap: L.length, idx: new Int32Array(L.length).fill(-1), k: 0, dirty: false, hero: true };
    const HB = [8.6, 10.8, 8.8];
    const d = KIT_DEFS[SP_KITS[SP.PHUONG][0]];
    for (const i of L) {
      const r = recs[i];
      // cao hero như cũ (HERO_BASE_H × 0.82..1.32), cây thủ tục thay thế cùng cao + cùng độ xoè tán (aspect GLB)
      const h = HB[v] * (0.82 + hxz(r.x, r.z, 61) * 0.5);
      _e.set(0, r.yaw, 0); _q.setFromEuler(_e); _s.setScalar(h); _p.set(r.x, r.y, r.z);
      _m.compose(_p, _q, _s).multiply(B); _m.toArray(HM, i * 16);
      heroBox[i * 2] = Math.max(h * aspect * 0.6, h * 0.6); heroBox[i * 2 + 1] = h;
      r.sy = h / d.H; r.sxz = clamp((h * aspect * 0.5) / kitR(KIT_DEFS[r.kit]), r.sy * 0.7, r.sy * 1.45);
      setM(i, r);
      for (const g of [nearG[kitOf[i]], farG[spOf[i]]]) if (g) g.idx.fill(-1);   // ép ghi lại hàng ma trận
    }
    heroReady[v] = true; lastT = -1e9;
  };
  // ---- tra cây phượng ĐANG NỞ gần nhất (cánh hoa rơi — petals.js) ----
  const BG = new Map();
  recs.forEach((r, i) => { if (r.sp === SP.PHUONG && r.bloom) { const k = Math.floor(r.x / 32) * 100003 + Math.floor(r.z / 32); let a = BG.get(k); if (!a) BG.set(k, (a = [])); a.push(i); } });
  const _bn = { x: 0, z: 0, d: 0, h: 0 };
  const bloomNear = (x, z, rMax = 45) => {
    if (U.uBloom.value < 0.5) return null;
    let best = -1, bd = rMax * rMax; const ci = Math.floor(x / 32), cj = Math.floor(z / 32), rc = Math.ceil(rMax / 32);
    for (let i = ci - rc; i <= ci + rc; i++) for (let j = cj - rc; j <= cj + rc; j++) {
      const a = BG.get(i * 100003 + j); if (!a) continue;
      for (const t of a) { const d = (px[t] - x) ** 2 + (pz[t] - z) ** 2; if (d < bd) { bd = d; best = t; } }
    }
    if (best < 0) return null;
    _bn.x = px[best]; _bn.z = pz[best]; _bn.d = Math.sqrt(bd); _bn.h = recs[best].sy * 9.8; _bn.y = recs[best].y;
    return _bn;
  };
  const bySp = {}; for (const r of recs) bySp[SP_NAME[r.sp]] = (bySp[SP_NAME[r.sp]] || 0) + 1;
  const info = {
    trees: N, fix, bySpecies: bySp, heroes: heroList.map((l) => l.length), pits: pitIdx.length,
    kitTris: nearKits.map((k, i) => k && [SP_NAME[KIT_DEFS[i].sp] + i, k.tris]).filter(Boolean),
    farTris: farKits.map((k, s) => k && [SP_NAME[s], k.tris]).filter(Boolean),
    atlasMs: +atlasMs.toFixed(1), buildMs: +(performance.now() - t0).toFixed(1), drawGroups: groups.length + (pitG ? 1 : 0),
  };
  console.log('[trees] dựng:', JSON.stringify(info));
  const stats = () => {
    let near = 0, far = 0, hero = 0, tris = 0, calls = 0;
    for (const g of groups) { if (!g.mesh.count) continue; calls++; tris += g.mesh.count * g.tris; if (g.cast) near += g.mesh.count; else far += g.mesh.count; }
    for (const g of heroG) if (g && g.mesh.count) { calls++; hero += g.mesh.count; tris += g.mesh.count * (g.mesh.geometry.index ? g.mesh.geometry.index.count / 3 : g.mesh.geometry.attributes.position.count / 3); }
    if (pitG && pitG.mesh.count) { calls++; tris += pitG.mesh.count * pitG.tris; }
    return Object.assign({}, info, { near, far, hero, visTris: Math.round(tris), calls });
  };
  const setSeason = (b) => { U.uBloom.value = b; lastT = -1e9; };
  _built = { setHeroModel, bloomNear, stats, setSeason, uniforms: U, recs };
  // lưới gốc dựng lại theo vị trí CUỐI (sau dời/bỏ) → hệ chạy sau buildTrees (đạo cụ WP7…) vẫn tra được trunkNear
  Q.length = 0; _trunkGrid.clear(); for (const r of recs) addTrunk(r.x, r.z);
  return _built;
}
export const treeSystem = () => _built;
