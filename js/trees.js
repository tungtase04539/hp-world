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
//   • Gió: lắc tán bằng onBeforeCompile (rẻ). Mùa hoa theo LỊCH trong game (W2-B: bloomShare — mặc định 4/10 ~17%
//     phượng còn hoa muộn; rộ tháng 5-7; ?date= / world.trees.setDate).
//   • W2-B: KÍCH THƯỚC THẬT theo loài (SPX: cao / mép dưới tán / bán kính) → biến hình TỪNG CÂY trong shader (aShape:
//     nâng tán, co tán ngang, ép nửa tán phía tường / nghiêng nhẹ) trên kit chung; tán cách mặt tiền ≥ 1,5 m (facadeFit:
//     TÁN LỆCH, thân thẳng); tán thoáng (chùm đầu cành); cắt cụt / tỉa trơ theo pano; hero GLB chỉ quanh Nhà hát, ngoài
//     khung pano thật (heroSpotOk), ≤ 3 cây GLB cùng lúc; kit XA có sy/nâng/co tán riêng (khớp ranh LOD).
//
// Hợp đồng dùng (world.js):
//   plant(kind, x, z, o)          — xếp hàng 1 cây (toạ độ thế giới). kind: 'xacu'|'bang'|'phuong'|'sau'|'banglang'|
//                                   'cau'|'catcut'|'da'|'non' hoặc 'shade' (cây bóng mát: loài theo pano/vùng) |
//                                   'street' (mọi loài theo pano/vùng) | 'park'. o: {h, r, wash, pit, hero, yaw,
//                                   variant, sz, full, median} (xem plant(); o.bloom BỎ từ W2-B — hoa theo lịch).
//                                   KHÔNG tự thêm collider (người gọi giữ addCollider như cũ); buildTrees dời/bỏ cây
//                                   lọt lòng đường / nhà thật / trùng gốc và dời/tách collider ở đúng (x,z) đó.
//   plantLocal(parent, lx, lz, kind, o) — cây trong Group (toạ độ local của parent, giải ở buildTrees; parent bị gỡ
//                                   khỏi scene trước đó → cây bị bỏ).
//   plantStreetTrees(ctx)          — trồng THEO DỮ LIỆU dọc phố p/s/t (+ r nơi pano nói có cây) tại xsection.treePitLine.
//   plantPlazaYoung(ctx)           — hàng cây non chống cọc trên quảng trường lát đá (claim ctx.claim | hộp ctx.box) — W2-B.
//   buildTrees(scene, ctx)         — dựng atlas + kit + InstancedMesh, móc scene.onBeforeRender (LOD + gió). Trả handle.
// Mọi vị trí/hash TẤT ĐỊNH (không Math.random) để A/B ảnh so được.
import * as THREE from 'three';
import { TIER } from './device.js';
import { PANO_VEG, PANO_VEG_STRIDE } from './treemap.js';
import { PANO_CAM } from './panoclear.js';
import { ROAD_HW, treePitLine, SIDEWALK_TOP } from './xsection.js';
export { treePitLine };   // world.js dùng qua veg.treePitLine (khỏi thêm import xsection vào world.js — tránh xung đột gộp)
import { LM_POLY, LM_CENTROID } from './landmark_polys.js';
import { claimAt, claimsAll } from './claims.js';
import { rbData, rbGrid } from './rbdata.js';   // footprint thật giải mã 1 lần cho cả trang (W2-F)
import { heightOf, PARAPET_H } from './buildings_data.js';
import { onCarriage } from './clearance.js';   // Đợt 3 W2-A: lòng đường thật (roadNet.surfaceAt, biết khe đường đôi)

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
  // crown: đỉnh đang thêm thuộc TÁN (cành + lá + hoa + rễ phụ) hay THÂN — shader W2-B co tán theo chiều ngang chỉ với
  // đỉnh tán (aHt + 2), thân giữ nguyên bề dày
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.k = []; this.s = []; this.i = []; this.cr = []; this.nv = 0; this.crown = false; }
  v(x, y, z, nx, ny, nz, u, v, cr, cg, cb, kind, sway) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(cr, cg, cb); this.k.push(kind); this.s.push(sway); this.cr.push(this.crown ? 1 : 0);
    return this.nv++;
  }
  t(a, b, c) { this.i.push(a, b, c); }
  // fork: cao chạc cành chính (kit) — aHt = 0 dưới gốc quét vôi (≤ WASH_TOP) → 1 ở chạc trở lên: phần THÂN giữa 2 mức
  // được kéo giãn khi nâng tán (aShape.x), gốc vôi giữ nguyên ~1,2 m; +2 cho đỉnh thuộc tán (xem crown)
  build(fork = Infinity) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.k, 1));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.s, 1));
    const ht = new Float32Array(this.nv), span = Math.max(0.5, fork - WASH_TOP);
    // đỉnh TÁN = 3 (nâng/dời TRỌN khối, kể cả thẻ lá thấp hơn chạc); đỉnh THÂN = dốc 0..1 theo cao
    for (let i = 0; i < this.nv; i++) ht[i] = !Number.isFinite(fork) ? 0 : this.cr[i] ? 3 : clamp((this.p[i * 3 + 1] - WASH_TOP) / span, 0, 1);
    g.setAttribute('aHt', new THREE.Float32BufferAttribute(ht, 1));
    g.setIndex(this.nv > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
const WASH_TOP = 1.3;    // trên mức gốc quét vôi (WASH_H 1,25) — đoạn thân kéo giãn khi nâng tán bắt đầu từ đây
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
// W2-B (tán THOÁNG): bớt ~30% thẻ lá, thẻ nhỏ hơn ~10%, ¾ số thẻ dồn thành CHÙM ở đầu cành (khe trời giữa các chùm như
// ảnh pano 10/2024) thay vì phủ đều vỏ ellipsoid; thêm cành phụ (sub) để chùm rải khắp tán. cardsFar = số thẻ kit XA
// (giữ như cũ — từ trên cao/vệ tinh tán vẫn thành khối).
const KIT_DEFS = [
  { sp: SP.XACU, form: 'round', H: 14, trunkH: 4.8, r0: 0.4, r1: 0.27, lean: 0.015, limbs: 5, limbAng: [0.28, 0.6], limbLen: 5.2, sub: 3, cy: 9.9, rx: 4.6, ry: 4.1, cards: 76, cardsFar: 21, cardS: [1.5, 2.35], cells: [CELL.XACU_A, CELL.XACU_B], bark: [0.95, 0.93, 0.9], up: 0.15 },
  { sp: SP.XACU, form: 'round', H: 12.5, trunkH: 3.9, r0: 0.44, r1: 0.3, lean: 0.035, limbs: 5, limbAng: [0.55, 0.95], limbLen: 5.8, sub: 3, cy: 8.7, rx: 5.7, ry: 3.4, cards: 78, cardsFar: 21, cardS: [1.5, 2.35], cells: [CELL.XACU_A, CELL.XACU_B], bark: [0.93, 0.9, 0.86], up: 0.3 },
  { sp: SP.BANG, form: 'tier', H: 10.5, r0: 0.3, tiers: [[3.6, 5.2], [5.6, 4.9], [7.5, 3.9], [9.1, 2.3]], branches: 5, cards: 94, cardsFar: 28, cardS: [1.8, 2.6], cells: [CELL.BANG_A, CELL.BANG_B], bark: [0.8, 0.76, 0.72] },
  { sp: SP.BANG, form: 'tier', H: 11, r0: 0.34, tiers: [[3.2, 6.2], [5.5, 5.7], [7.8, 4.3], [9.6, 2.2]], branches: 6, cards: 98, cardsFar: 29, cardS: [1.9, 2.7], cells: [CELL.BANG_A, CELL.BANG_B], bark: [0.8, 0.76, 0.72] },
  { sp: SP.PHUONG, form: 'umbrella', H: 9.8, trunkH: 3.0, r0: 0.38, r1: 0.29, lean: 0.03, limbs: 5, limbAng: [0.85, 1.15], limbLen: 5.3, sub: 3, cy: 7.4, rx: 5.9, ry: 2.3, cards: 68, cardsFar: 18, cardS: [1.7, 2.5], cells: [CELL.PH_A, CELL.PH_B], flowerCell: CELL.PH_FLOWER, flowers: 40, bark: [1.0, 0.98, 0.96], up: 0.65 },
  { sp: SP.PHUONG, form: 'umbrella', H: 10.6, trunkH: 3.7, r0: 0.4, r1: 0.3, lean: 0.1, limbs: 4, limbAng: [0.65, 1.05], limbLen: 5.6, sub: 4, cy: 8.2, rx: 5.3, ry: 2.7, cards: 66, cardsFar: 18, cardS: [1.7, 2.5], cells: [CELL.PH_A, CELL.PH_B], flowerCell: CELL.PH_FLOWER, flowers: 36, bark: [1.0, 0.98, 0.96], up: 0.6 },
  { sp: SP.SAU, form: 'round', H: 12, trunkH: 3.6, r0: 0.36, r1: 0.25, lean: 0.02, limbs: 5, limbAng: [0.4, 0.8], limbLen: 4.4, sub: 3, cy: 8.2, rx: 4.7, ry: 3.9, cards: 78, cardsFar: 21, cardS: [1.45, 2.25], cells: [CELL.SAU], bark: [0.86, 0.82, 0.78], up: 0.2 },
  { sp: SP.BANGLANG, form: 'round', H: 9, trunkH: 2.9, r0: 0.26, r1: 0.18, lean: 0.02, limbs: 4, limbAng: [0.35, 0.75], limbLen: 3.2, sub: 2, cy: 6.3, rx: 3.5, ry: 3.0, cards: 58, cardsFar: 15, cardS: [1.3, 1.9], cells: [CELL.BL_LEAF], flowerCell: CELL.BL_FLOWER, flowers: 28, bark: [1.0, 0.96, 0.92], up: 0.2 },
  { sp: SP.CAU, form: 'palm', H: 13.5, trunkH: 11.2, r0: 0.3, r1: 0.22, shaft: 1.7, fronds: 15, frondL: 4.6, frondW: 1.5 },
  { sp: SP.CATCUT, form: 'pollard', H: 7, trunkH: 4.0, r0: 0.37, r1: 0.29, lean: 0.03, stubs: 4, stubLen: [1.1, 2.3], shoots: 3, cardS: [0.8, 1.3], cells: [CELL.SHOOT], bark: [0.9, 0.87, 0.83] },
  { sp: SP.CATCUT, form: 'pollard', H: 8, trunkH: 4.5, r0: 0.34, r1: 0.27, lean: 0.06, stubs: 5, stubLen: [1.4, 2.7], shoots: 8, cardS: [0.9, 1.6], cells: [CELL.SHOOT, CELL.SHOOT, CELL.XACU_A], bark: [0.9, 0.87, 0.83] },
  { sp: SP.DA, form: 'round', H: 15, trunkH: 3.6, r0: 1.0, r1: 0.62, lean: 0, limbs: 7, limbAng: [0.85, 1.25], limbLen: 7.6, sub: 3, cy: 10.2, rx: 9.0, ry: 4.6, cards: 130, cardsFar: 32, cardS: [2.1, 3.0], cells: [CELL.DA], bark: [0.82, 0.8, 0.76], up: 0.35, stems: 4, roots: 18 },
  { sp: SP.NON, form: 'round', H: 4.6, trunkH: 2.2, r0: 0.075, r1: 0.05, lean: 0.01, limbs: 4, limbAng: [0.4, 0.7], limbLen: 1.1, sub: 0, cy: 3.4, rx: 1.3, ry: 1.15, cards: 18, cardsFar: 14, cardS: [0.8, 1.2], cells: [CELL.XACU_A, CELL.SAU], bark: [0.9, 0.86, 0.8], up: 0.2, stakes: true },
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
    G.crown = false;
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
    G.crown = true;
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
    G.crown = true;
    // W2-B: kit gần ¾ số thẻ thành CHÙM chặt quanh đầu cành (trước 58%, toả rộng hơn) → giữa các chùm lộ trời/cành
    const tipF = far ? 0.58 : 0.76, tipS = far ? 1.0 : 0.72;
    for (let i = 0; i < n; i++) {
      let px, py, pz;
      if (!topOnly && tips.length && i < n * tipF) {
        const tp = tips[i % tips.length], sp = (1.0 + 0.4 * (rx / 5)) * tipS;
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
    if (d.roots && !far) for (let q = 0; q < d.roots; q++) {      // rễ phụ buông (đa/si) — KHÔNG thuộc tán: chân rễ chạm đất
      G.crown = false;
      const a = r() * 6.28, rr = 2 + r() * (d.rx - 3), x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr, yt = d.cy - d.ry * (0.55 + r() * 0.3);
      tube(G, [[x, yt, z, 0.05 + r() * 0.05], [x + (r() - 0.5) * 0.3, yt * 0.5, z + (r() - 0.5) * 0.3, 0.05 + r() * 0.06], [x, -0.2, z, 0.06 + r() * 0.08]], 4, rectBark, 0, woodAO, woodSway);
    }
    if (d.stakes && !far) for (let q = 0; q < 3; q++) {            // cọc chống (cây non)
      G.crown = false;
      const a = q / 3 * 6.28 + 0.5;
      tube(G, [[Math.cos(a) * 0.62, -0.3, Math.sin(a) * 0.62, 0.035], [Math.cos(a) * 0.1, 1.55, Math.sin(a) * 0.1, 0.03]], 4, rectBark, 0, () => [1.55, 1.38, 1.1], () => 0);
    }
    // kit XA: ~19% số thẻ cũ (cardsFar), thẻ ×1,9 (nhìn từ trên cao/vệ tinh tán vẫn thành khối liền, không lấm tấm)
    const n = Math.round(far ? Math.max(14, d.cardsFar || d.cards * 0.19) : d.cards * CARD_Q);
    const sMul = far ? 1.9 : 1;
    // kit XA: thẻ ngửa lên nhiều hơn (nhìn từ trên/xa tán vẫn kín — ảnh vệ tinh), gần: theo loài
    crownCards(cx, d.cy, cz, d.rx, d.ry, tips, n, d.cardS[0] * sMul, d.cardS[1] * sMul, d.cells, (d.up || 0.2) + (far ? 0.55 : 0));
    // hoa: kit XA trên mặt vòm (nhìn từ cao); kit GẦN thành chùm ở ĐẦU CÀNH khắp tán (W2-B — trước chỉ mặt trên vòm nên
    // đứng dưới đường nhìn lên gần như không thấy hoa, tháng 6 trông như tháng 10)
    if (d.flowers) crownCards(cx, d.cy, cz, d.rx * 0.97, d.ry, far ? [] : tips, far ? 8 : Math.round(d.flowers * 1.8 * CARD_Q), (far ? 2.4 : 1.4), (far ? 3.2 : 2.3), d.cells, 0.55, 3, far);
  } else if (d.form === 'tier') {
    // BÀNG: thân thẳng tới ngọn, các TẦNG cành gần nằm ngang, lá dồn đầu cành thành tầng phẳng (dáng chùa)
    trunk(d.r0, d.r0 * 0.3, H * 0.94);
    G.crown = true;
    let wsum = 0; for (const [, R] of d.tiers) wsum += R * R;
    const nCards = far ? Math.max(22, d.cardsFar || d.cards * 0.21) : d.cards * CARD_Q, sMul = far ? 1.8 : 1;
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
        // W2-B: chùm lá bàng chặt hơn quanh đầu cành (80%, toả 1,0 m) → tầng lá thành các "đĩa" rời, lộ trời giữa tầng
        if (i < n * (far ? 0.7 : 0.8)) { const tp = tips[i % tips.length], sp = far ? 1.3 : 1.0; px = tp[0] + (r() + r() - 1) * sp; py = tp[1] + 0.1 + r() * 0.6; pz = tp[2] + (r() + r() - 1) * sp; }
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
      if (i < nC - 3 || far) { G.crown = true; const tp = tips[i % tips.length]; px = tp[0] + (r() - 0.5) * 1.1; py = tp[1] + 0.25 + r() * 0.6; pz = tp[2] + (r() - 0.5) * 1.1; }
      else { G.crown = false; const a = r() * 6.28, y = d.trunkH * (0.45 + r() * 0.4); px = lx * y + Math.cos(a) * (d.r0 + 0.25); py = y; pz = lz * y + Math.sin(a) * (d.r0 + 0.25); }   // chồi bám thân: không co theo tán
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
  const fork = d.form === 'palm' ? Infinity : d.form === 'tier' ? d.tiers[0][0] - 0.3 : d.form === 'pollard' ? d.trunkH - 0.7 : tH;
  const geo = G.build(fork);
  // số đo kit (đơn vị kit) cho phép biến hình từng cây (buildTrees): base = mép dưới TÁN (phân vị 8% cao độ đỉnh thẻ lá),
  // top = ngọn, fork = chạc
  // rad = bán kính tán THẤY ĐƯỢC (phân vị 85% khoảng cách ngang đỉnh lá tới trục thân)
  const ly = [], lr = []; let top = 0;
  for (let i = 0; i < G.nv; i++) { const y = G.p[i * 3 + 1]; if (y > top) top = y; if (G.k[i] >= 2 && G.k[i] < 3) { ly.push(y); lr.push(Math.hypot(G.p[i * 3], G.p[i * 3 + 2])); } }
  ly.sort((a, b) => a - b); lr.sort((a, b) => a - b);
  const base = ly.length ? ly[Math.floor(ly.length * 0.08)] : tH, rad = lr.length ? lr[Math.floor(lr.length * 0.85)] : kitR(d);
  return { geo, def: d, R: kitR(d), tris: G.i.length / 3, base, top, fork, rad };
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
// kind: tên loài | 'shade' | 'street' | 'park'. o: {h (cao m), r (bán kính tán m), bloom (BỎ từ W2-B: hoa theo LỊCH), wash (0/1), pit (0 không,
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
// (o.median).
const PANO_CLEAR = 4.5;
// HERO GLB (W2-B): chỉ là "tủ kính" quanh Nhà hát (≤ HERO_SHOW_R) — "thành phố hoa phượng đỏ" — và mỗi lúc chỉ vẽ
// HERO_MAX cây GLB gần camera nhất trong HERO_R (trước: 57 hero cả dải trung tâm, ≤ 8 cùng lúc → 1,19 M tam giác)
const OPERA = LM_CENTROID.opera, HERO_SHOW_R = 120, HERO_MAX = 3;
let _PG = null;
function nearPano(x, z, r) {
  if (!_PG) { _PG = new Map(); for (const [px, pz] of PANO_CAM) { const k = Math.floor(px / 8) * 100003 + Math.floor(pz / 8); let a = _PG.get(k); if (!a) _PG.set(k, (a = [])); a.push(px, pz); } }
  const ci = Math.floor(x / 8), cj = Math.floor(z / 8);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const a = _PG.get(i * 100003 + j); if (!a) continue; for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r * r) return true; }
  return false;
}
// ---- CHỖ ĐẶT HERO GLB (tủ kính phượng đỏ quanh Nhà hát, luôn nở) — không được chắn khung pano thật. Review W2-B:
// pano_055_h000 (std) có 3 vòm đỏ 25-49 m GIỮA khung che lối vào Nhà hát (pano thật 10/2024: xanh, cây tỉa/cây non).
// Pano thật chụp 8 hướng (h000..h315) ⇒ "nón ±45° của hướng chụp" = mọi hướng ⇒ luật: (1) cách MỌI camera pano
// ≥ HERO_PANO_MIN (vòm 6-7 m ở ≥ 45 m chỉ ~1/6 khung, không còn "chiếm giữa khung"; 50 m thì vùng ≤ 120 m quanh
// Nhà hát gần như chỉ còn dải z < −70 — pano dày đặc); (2) ngoài NÊM NHÌN tới đa giác Nhà hát (+ bán kính tán) từ mọi camera
// pano ≤ HERO_VIEW_R quanh Nhà hát + camera spawn (0, 72) — không che mặt Nhà hát từ chỗ có ảnh thật (pano xa hơn:
// Nhà hát nhỏ, nêm từ mọi phía phủ kín cả vùng). Thay HERO_PANO_CLEAR 12 m cũ (nearPano chỉ dò ±1 ô 8 m — r 12 m sót).
const HERO_PANO_MIN = 45, HERO_CROWN_R = 7, HERO_VIEW_R = 160;
let _HV = null;
function heroSpotOk(x, z) {
  if (!_HV) {
    const OP = LM_POLY.opera; _HV = [];
    const views = PANO_CAM.map(([px, pz]) => [px, pz, true]).filter(([px, pz]) => Math.hypot(px - OPERA[0], pz - OPERA[1]) < HERO_VIEW_R);
    views.push([0, 72, false]);
    for (const [px, pz, pano] of views) {
      const dir = Math.atan2(OPERA[0] - px, OPERA[1] - pz);
      let a0 = 1e9, a1 = -1e9, dn = 1e9;
      for (const [vx, vz] of OP) {
        let a = Math.atan2(vx - px, vz - pz) - dir; a = Math.atan2(Math.sin(a), Math.cos(a));
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); dn = Math.min(dn, Math.hypot(vx - px, vz - pz));
      }
      _HV.push({ x: px, z: pz, pano, dir, a0, a1, dn });
    }
  }
  for (const [px, pz] of PANO_CAM) if ((px - x) ** 2 + (pz - z) ** 2 < HERO_PANO_MIN * HERO_PANO_MIN) return false;
  for (const v of _HV) {
    const dx = x - v.x, dz = z - v.z, d = Math.hypot(dx, dz);
    if (d > v.dn + HERO_CROWN_R || d < 1) continue;            // sau lưng mặt Nhà hát gần nhất → không che
    let a = Math.atan2(dx, dz) - v.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
    const hw = Math.atan2(HERO_CROWN_R, d);
    if (a + hw > v.a0 && a - hw < v.a1) return false;
  }
  return true;
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
  let w, pollard, young = 0.04, dens = 2, wash = 0.55, pano = false, cauRaw = 0, near = false, thin = 0, polLvl = 0, zoneCut;
  // zoneCut (W2-B): tỉ lệ cây TỈA TRƠ (thân cao, tán nhỏ thưa) nơi không có pano ≤ 60 m — dải trung tâm/ven hồ/Hoàng
  // Diệu bị tỉa nặng sau bão Yagi (pano_001/007/055: "cắt tỉa trơ cành", "tán thưa")
  if (_ctx.hdTreeBelt && _ctx.hdTreeBelt(x, z)) { w = [1, 0.3, 0, 0.1, 0, 0, 0, 0]; pollard = 0.6; zoneCut = 0.55; }
  else if (_ctx.lakeSD && _ctx.lakeSD(x, z) < 45) { w = [0.42, 0.3, 0.12, 0.1, 0.04, 0, 0, 0.02]; pollard = 0.18; zoneCut = 0.5; }
  else if (distPolyline(x, z, CENTRAL) < 110) { w = [0.3, 0.14, 0.42, 0.05, 0.05, 0.04, 0, 0]; pollard = 0.15; zoneCut = 0.5; }
  else { w = [0.36, 0.26, 0.2, 0.09, 0.05, 0.02, 0, 0]; pollard = 0.12; zoneCut = 0.15; }
  const pi = panoVeg(x, z);
  if (pi >= 0) {
    const V = PANO_VEG, o = pi + 2;
    const wp = [V[o], V[o + 1], V[o + 2], V[o + 3], V[o + 4], V[o + 5] * 0.7, 0, V[o + 6] * 0.3];
    const sp = wp.reduce((a, b) => a + b, 0), sz = w.reduce((a, b) => a + b, 0);
    near = true; cauRaw = V[o + 5];
    if (sp > 0) { w = w.map((v, i) => 0.3 * v / sz + 0.7 * wp[i] / sp); pano = true; }
    // W2-B: "một số/vài cây" (3) → 18%, (5) → 40%, "hàng cây/nhiều cây cắt" (7) → 62% (trước 31/49/66%)
    pollard = V[o + 7] ? -0.15 + V[o + 7] * 0.11 : pollard * 0.6;
    polLvl = V[o + 7];
    young = V[o + 8] ? V[o + 8] / 10 * 0.6 : 0.03;
    dens = V[o + 9];
    if (V[o + 10]) wash = 0.9;
    thin = V[o + 12] || (V[o + 7] >= 5 ? 1 : 0);   // tán thưa / trụi lá — hoặc vùng cắt cụt nặng (cây còn lại cũng xơ xác)
  }
  return { w, pollard, young, dens, wash, pano, cauRaw, near, thin, polLvl, zoneCut };
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
let _fp = null, _fpD = null;
function footprints(ctx) {
  if (ctx.fpGrid) return ctx.fpGrid;
  if (!_fp) { _fpD = rbData(); _fp = rbGrid(); }   // W2-F: giải mã 1 lần dùng chung (rbdata.js)
  return _fp;
}
// dữ liệu đỉnh footprint đi cùng lưới (ctx.fpData = world.rbData, D.dead đã đánh) — cần cho khoảng cách tới mặt tiền
let _fpWarn = false;
function footprintData(ctx) {
  if (ctx.fpGrid) {
    if (!ctx.fpData && !_fpWarn) { _fpWarn = true; console.warn('[trees] fpGrid không kèm fpData → TẮT khoảng cách mặt tiền (facadeFit)'); }
    return ctx.fpData || null;
  }
  footprints(ctx);
  return _fpD;
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
    if (blockedByRoad(x, z, ri, si) || onCarriage(x, z)) return rej('road');   // W2-A: + nhựa khe đường đôi/nút giao (roadNet)
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
            const q = Q.length;   // (hoa: theo LỊCH ở buildTrees — hạng hash so với tỉ lệ nở của ngày)
            plant(SP_NAME[sp], tx, tz, { pit: c === 'r' ? 0 : 1, wash: hxz(tx, tz, 22) < V.wash ? 1 : 0, sz });
            ctx.addCollider && ctx.addCollider(tx, tz, sp === SP.CAU ? 0.45 : 0.55);
            st.planted++;
            // hero GLB: chỉ "tủ kính" quanh Nhà hát (W2-B — trước cả dải trung tâm ≤ 160 m)
            if (sp === SP.PHUONG && (c === 'p' || c === 's') && Math.hypot(tx - OPERA[0], tz - OPERA[1]) < HERO_SHOW_R && !(ctx.hdTreeBelt && ctx.hdTreeBelt(tx, tz)) && heroSpotOk(tx, tz)) heroCand.push(q);
          }
          acc += step;
        }
        acc -= L;
      }
    }
  }
  // HERO (GLB phượng Meshy) cho dải trung tâm: chọn đều theo hash (KHÔNG "N cây đầu tiên theo thứ tự ROADS_DT")
  heroCand.sort((a, b) => hxz(Q[a].x, Q[a].z, 31) - hxz(Q[b].x, Q[b].z, 31));
  const nHero = Math.min(heroCand.length, ctx.heroMax ?? 8);
  for (let h = 0; h < nHero; h++) { const e = Q[heroCand[h]]; e.o.hero = hxz(e.x, e.z, 33) < 0.4 ? 0 : hxz(e.x, e.z, 33) < 0.72 ? 1 : 2; }
  st.heroes = nHero; st.ms = +(performance.now() - t0).toFixed(1);
  console.log('[trees] trồng dọc phố:', JSON.stringify(st));
  return st;
}

// ---- CÂY NON CHỐNG CỌC TRÊN QUẢNG TRƯỜNG LÁT ĐÁ (W2-B) — pano_541 "hàng cây non mới trồng có cọc chống gỗ hình chóp trải
// khắp quảng trường", pano_055/056 (cây chống kiềng cọc), pano_249 ("cây mới trồng có khung chống 3 chân"): quảng trường
// Nhà hát phía nam (Trần Phú) trồng lại sau bão Yagi. Lưới hàng song song trục hộp claim `box` {cx,cz,ux,uz,hu,hw} nhịp
// `step` m, giữ ~72% theo hash; né lòng đường (+1,5 m), nhà thật, địa danh (LM_POLY + 3 m, kể cả quảng trường Nhà hát),
// collider (chậu bonsai/đài phun/cột đèn), gốc khác < 5 m, camera pano 4,5 m, ctx.keepClear (trục nhìn spawn → Nhà hát).
// ctx.claim = tên claim hộp (vd 'road9_tay') → hộp lấy THẲNG từ claims (W2-D/E sửa claim thì hàng cây đi theo);
// ctx.box = hộp cho sẵn (dự phòng / trang QA)
export function plantPlazaYoung(ctx) {
  const { ROADS_DT, groundHeightNoDeck, isWater } = ctx;
  let box = ctx.box;
  if (ctx.claim) {
    const c = claimsAll().find((q) => q.name === ctx.claim && q.type === 'box');
    // claims.js: local X → (cosθ, −sinθ), local Z → (sinθ, cosθ) = (−uz, ux) — đúng trục w của hộp dưới đây
    if (c) box = { cx: c.cx, cz: c.cz, ux: Math.cos(c.rot), uz: -Math.sin(c.rot), hu: c.hx, hw: c.hz };
    else console.warn('[trees] plantPlazaYoung: không thấy claim', ctx.claim);
  }
  if (!box) return 0;
  const LAND = ctx.landH ?? 2, step = ctx.step || 8.5, RI = roadIndex(ROADS_DT, ctx.R || 1600), fp = footprints(ctx);
  const inLMpad = (x, z, pad) => {
    for (const P of Object.values(LM_POLY)) {
      let c = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
      if (c) return true;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (RI.segD(x, z, { ax: P[j][0], az: P[j][1], bx: P[i][0], bz: P[i][1] }) < pad) return true;
    }
    return false;
  };
  const cols = (ctx.colliders || []).filter((c) => Math.abs(c.x - box.cx) < box.hu + box.hw + 20 && Math.abs(c.z - box.cz) < box.hu + box.hw + 20);
  const wx = -box.uz, wz = box.ux;
  let n = 0;
  for (let a = -box.hu + step / 2; a < box.hu; a += step) for (let b = -box.hw + step / 2; b < box.hw; b += step) {
    const x = box.cx + box.ux * a + wx * b, z = box.cz + box.uz * a + wz * b;
    if (hxz(x, z, 71) > 0.72) continue;
    if (Math.abs(groundHeightNoDeck(x, z) - LAND) > 0.35 || isWater(x, z)) continue;
    if (RI.nearRoad(x, z, 1.5) || fp.at(x, z) >= 0 || inLMpad(x, z, 3)) continue;
    if (nearPano(x, z, PANO_CLEAR) || trunkNear(x, z, 5) || (ctx.keepClear && ctx.keepClear(x, z))) continue;
    if (cols.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + 1.0) ** 2)) continue;
    plant('non', x, z, { pit: 0, wash: 0 });
    ctx.addCollider && ctx.addCollider(x, z, 0.3);
    n++;
  }
  console.log('[trees] cây non quảng trường:', n);
  return n;
}

// =====================================================================================================
// 5) DỰNG: atlas + kit + InstancedMesh + LOD/gió (móc scene.onBeforeRender)
// =====================================================================================================
// uBloom = (tỉ lệ phượng đang nở, tỉ lệ bằng lăng đang nở) theo LỊCH trong game (bloomShare) — cây nở khi hạng hoa
// riêng (aInst.x, hash 0..1; bằng lăng +2; −1 = luôn nở: cây đôi của hero GLB) < tỉ lệ; càng sâu dưới ngưỡng càng nhiều chùm hoa
const U = { uTime: { value: 0 }, uBloom: { value: new THREE.Vector2(1, 1) }, uWind: { value: 1 }, uAtlasPx: { value: ATLAS_S * 4 } };
const VERT_DECL = 'attribute float aKind;\nattribute float aSway;\nattribute float aHt;\nattribute vec4 aInst;\nattribute vec4 aShape;\nuniform float uTime;\nuniform vec2 uBloom;\nuniform float uWind;\n';
const VERT_BEGIN = `vec3 transformed = vec3( position );
#ifdef USE_INSTANCING
  // W2-B BIẾN HÌNH TỪNG CÂY (aShape, đơn vị kit): x = NÂNG tán (thân từ gốc vôi → chạc giãn ra, tán dời lên nguyên khối),
  // |y| = co/giãn tán NGANG quanh trục thân (chỉ đỉnh tán: aHt ≥ 2). zw theo DẤU của y:
  //   y > 0 → zw = NGHIÊNG tự nhiên nhẹ (dời tán ≤ ~6°, thân thẳng từ trên gốc vôi tới chạc)
  //   y < 0 → TÁN LỆCH (né mặt tiền): zw = hướng ra lòng đường × tỉ lệ ÉP s — nửa tán phía TƯỜNG co về trục thân
  //           (×(1−s) theo pháp tuyến tường), nửa phía đường giữ nguyên; THÂN THẲNG ĐỨNG (cây sát nhà bị tỉa phía nhà)
  float hpCr = step( 1.5, aHt ), hpH = aHt - 2.0 * hpCr, hpSq = step( aShape.y, 0.0 );
  transformed.xz *= mix( 1.0, abs( aShape.y ), hpCr );
  float hpSL = length( aShape.zw );
  vec2 hpN = aShape.zw / max( hpSL, 1e-5 );
  transformed.xz += hpN * ( max( - dot( transformed.xz, hpN ), 0.0 ) * hpSL * hpSq * hpCr );
  transformed.xz += aShape.zw * ( hpH * ( 1.0 - hpSq ) );
  transformed.y += aShape.x * hpH;
  // hoa theo MÙA: cây chưa tới lượt nở / trái mùa → thu thẻ hoa về 1 điểm (tam giác suy biến, không raster); cây đang
  // nở giữ phần thẻ hoa ∝ độ sâu dưới ngưỡng (đầu/cuối mùa lác đác vài chùm, giữa mùa đỏ rực)
  if ( aKind > 2.5 ) {
    float hpR = aInst.x, hpS = uBloom.x;
    if ( hpR > 1.5 ) { hpR -= 2.0; hpS = uBloom.y; }
    if ( hpR < -0.5 && hpS <= 0.05 ) hpR = 1.0;     // cây đôi hero (luôn nở) — trừ khi tắt hẳn mùa hoa (setSeason(0))
    if ( fract( aKind ) * 2.5 >= clamp( ( hpS - hpR ) * 8.0, 0.0, 1.0 ) ) transformed = vec3( 0.0, -3.0, 0.0 );
  }
  // ĐỘ KÍN TÁN từng cây (aInst.w 0..1): thẻ lá/hoa có số ngẫu nhiên riêng (phần lẻ aKind × 2,5) lớn hơn → bỏ
  // ⇒ cùng 1 kit mà cây thưa/cây dày khác nhau, lộ trời + cành như ảnh thật (pano 10/2024 sau bão Yagi)
  // (thẻ HOA không theo độ kín tán — độ rộ do lịch quyết; cây tỉa trơ vẫn nở trên phần cành còn lại)
  if ( aKind > 1.5 && aKind < 2.5 && fract( aKind ) * 2.5 > aInst.w ) transformed = vec3( 0.0, -3.0, 0.0 );
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

// =====================================================================================================
// 4b) LỊCH TRONG GAME → MÙA HOA (W2-B). Phượng HP: nụ cuối tháng 4, rực tháng 5-6, tàn dần tháng 7, lác đác tháng 8.
//     Bằng lăng: tím rộ tháng 6. Ngoài mùa vẫn ~17% phượng còn vài chùm hoa muộn ("thành phố hoa phượng đỏ" — pano
//     10/2024 gần như toàn xanh). Ngày mặc định 4/10 = ngày của mô hình mặt trời (daynight.js "đầu tháng 10") và của
//     ảnh pano. Ghi đè: ?date=2026-05-25 | ?date=05-25 | ?month=6 (giữa tháng). Ngày tự sang khi đồng hồ game qua 0h.
// =====================================================================================================
const DEFAULT_DOY = 277;      // 4/10
const MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const doyOf = (m, d) => { let s = 0; for (let i = 0; i < m - 1; i++) s += MDAYS[i]; return s + d; };
const mdOf = (doy) => { let m = 0, d = ((Math.round(doy) - 1) % 365 + 365) % 365 + 1; while (d > MDAYS[m]) { d -= MDAYS[m]; m++; } return [m + 1, d]; };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
// tỉ lệ cây ĐANG NỞ theo ngày trong năm: [phượng, bằng lăng]
export function bloomShare(doy) {
  const ph = 0.17 + 0.63 * sstep(118, 142, doy) * (1 - sstep(186, 224, doy));
  const bl = 0.12 + 0.66 * sstep(130, 154, doy) * (1 - sstep(190, 218, doy));
  return [ph, bl];
}
function parseDateParam() {
  try {
    const q = new URLSearchParams(location.search), v = q.get('date'), mo = q.get('month');
    if (v) { const p = v.split('-').map(Number), m = p.length >= 3 ? p[1] : p[0], d = p.length >= 3 ? p[2] : p[1]; if (m >= 1 && m <= 12) return doyOf(m, clamp(d || 15, 1, MDAYS[m - 1])); }
    if (mo) { const m = Math.round(+mo); if (m >= 1 && m <= 12) return doyOf(m, 15); }
  } catch (e) { /* node / không có location */ }
  return DEFAULT_DOY;
}

// ---- KÍCH THƯỚC THẬT theo loài (m): cây đường phố trung tâm HP, hiệu chỉnh theo pano 10/2024 (pano_001/036/055/085/
// 007): [cao min, cao max, mép tán dưới min, max, bán kính tán min, max]. Mép dưới tán = chiều cao THÂN TRỐNG đã tỉa
// chừa lối đi + xe tải (cây lớn 5-7,5 m, phượng 4,2-5,6 m, bàng tầng dưới 3,8-5 m); trước W2-B cây phố t/r co ĐỀU
// cả cây nên tán phượng xuống 2,6-3 m, che kín mặt tiền + nửa khung pano (pano_071/085/141).
const SPX = [
  [12, 21, 5.0, 7.5, 3.8, 6.8],      // xà cừ
  [9, 13.5, 3.8, 5.0, 3.4, 5.4],     // bàng
  [8, 12, 4.2, 5.6, 3.6, 5.8],       // phượng
  [12, 19, 5.0, 7.0, 3.4, 5.4],      // sấu
  [7, 10.5, 3.2, 4.2, 2.4, 3.6],     // bằng lăng
  [10, 16, 0, 0, 0, 0],              // cau vua (chỉ co theo cao)
  [6, 9.5, 3.6, 5.2, 1.6, 2.8],      // cắt cụt (mép tán = chạc cụt + chồi)
  [13, 18, 4.0, 5.5, 7.0, 10.0],     // đa/si
  [4.0, 6.5, 2.2, 3.0, 1.1, 1.9],    // cây non chống cọc (pano_541: 5-7 m, tán từ ~2,5 m)
];
const FACADE_CLEAR = 1.5;   // tán cách mặt tiền ≥ 1,5 m (ép nửa tán phía tường — tán lệch ra lòng đường, không đủ thì thu nhỏ)
const SQ_MAX = 0.72;        // ép tối đa nửa tán phía tường còn 28% bán kính
// nghiêng TỰ NHIÊN tối đa (độ) của thân trên đoạn gốc vôi → chạc (cây đứng tự do; cây sát nhà/cây non/cắt cụt: 0)
const LEAN_NAT_DEG = 5.5;
// facadeFit: 16 điểm mép tán (dây cung/2 ≤ 0,2R ≤ 1,36 m < 1,45 m → cạnh tường cắt qua mép tán luôn bị bắt), bảng cos/sin dựng 1 lần
const FIT_N = 16, FIT_C = new Float64Array(FIT_N), FIT_S = new Float64Array(FIT_N);
for (let q = 0; q < FIT_N; q++) { FIT_C[q] = Math.cos(q * 2 * Math.PI / FIT_N); FIT_S[q] = Math.sin(q * 2 * Math.PI / FIT_N); }
// LM_POLY làm "tường" cao (địa danh) — bbox để lọc nhanh. BỎ các đa giác KHUÔN VIÊN/quảng trường (tường rào/hè trống,
// tán cây vươn qua rào là đúng thật): square, trường học, chùa Hàng, Việt Tiệp
const LM_OPEN = new Set(['square', 'thptnq', 'thcsnq', 'thcstp', 'chuahang', 'viettiep']);
const LMW = Object.entries(LM_POLY).filter(([k]) => !LM_OPEN.has(k)).map(([, P]) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { P, x0, z0, x1, z1 }; });
// tán (tâm gốc x,z, mép dưới B m, bán kính R m) vướng mặt tiền nào cao hơn mép tán? → {sq (0..SQ_MAX tỉ lệ ép nửa tán
// phía tường), nx, nz (pháp tuyến tường → lòng đường), R (m), d (m, gốc → tường gần nhất)}.
// Chỉ tường cao ≥ mép tán − 0,3 m (tán xoè trên mái nhà 1 tầng là bình thường). Gốc nằm TRONG nhà/địa danh → bỏ qua.
function facadeFit(x, z, B, R, fp, D, CB) {
  const out = { sq: 0, nx: 0, nz: 0, R, d: 1e9 };
  if (!fp || !D) return out;
  const S = R + FACADE_CLEAR + 0.5, E = [];
  let best = 1e9, nx = 0, nz = 0;
  const edge = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qz = az + t * dz, d = Math.hypot(x - qx, z - qz);
    if (d > S) return;
    E.push(ax, az, bx, bz, d);
    if (d < best && d > 1e-3) { best = d; nx = (x - qx) / d; nz = (z - qz) / d; }
  };
  let inside = false;
  fp.near(x, z, S, (b) => {
    if (inside) return;
    if (heightOf(D.floors[b]) + PARAPET_H < B - 0.3) return;
    if (fp.inside(b, x, z)) { inside = true; return; }
    for (let v = D.vStart[b], e = D.vStart[b + 1], w = e - 1; v < e; w = v++) edge(D.x[w], D.z[w], D.x[v], D.z[v]);
  });
  // nhà ô dựng tay GIỮ LẠI (cell sink, claim 'cell' hộp nhỏ < 1500 m² = 1 công trình, không phải khuôn viên): tường
  // cao không rõ → coi là cao; gốc trong hộp → bỏ qua hộp (cây trong sân)
  if (CB && !inside) {
    const a = CB.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32));
    if (a) for (const c of a) {
      if (x < c.x0 - S || x > c.x1 + S || z < c.z0 - S || z > c.z1 + S) continue;
      const dx = x - c.cx, dz = z - c.cz, lx = dx * c.cs - dz * c.sn, lz = dx * c.sn + dz * c.cs;
      if (Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz) continue;
      const P = c.P;
      for (let i = 0, j = 3; i < 4; j = i++) edge(P[j][0], P[j][1], P[i][0], P[i][1]);
    }
  }
  for (const L of LMW) {
    if (inside || x < L.x0 - S || x > L.x1 + S || z < L.z0 - S || z > L.z1 + S) continue;
    const P = L.P; let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
    if (c) { inside = true; break; }
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) edge(P[j][0], P[j][1], P[i][0], P[i][1]);
  }
  out.d = best;
  if (inside || best >= R + FACADE_CLEAR) return out;
  // TÁN LỆCH (review W2-B: dời tán ≤ 1,6 m trên đoạn thân gốc vôi→chạc 1,4-3,3 m = thân gãy 20-55°, pano thật thân gần
  // thẳng đứng): THÂN GIỮ THẲNG, nửa tán phía tường bị ÉP về trục thân theo pháp tuyến mặt tiền gần nhất — (1−s)·R ≤
  // khoảng trống (best − 1,5 m), s ≤ SQ_MAX (cây sát nhà ở HP bị tỉa phẳng phía nhà, tán vươn ra lòng đường). Không đủ
  // (thân quá sát tường) → thu R. Rồi kiểm MỌI tường trong tầm (góc phố/nhà thứ 2) với hình tán đã ép → thu dần R.
  const room = best - FACADE_CLEAR, Rmin = Math.max(1.2, R * 0.42), tx = -nz, tz = nx;
  let Rf = R, s = 1 - room / R;
  if (s > SQ_MAX) { s = SQ_MAX; Rf = Math.max(Rmin, Math.min(R, room / (1 - SQ_MAX))); }
  if (s < 0) s = 0;
  // hình tán ép: điểm (a theo pháp tuyến n — dương = phía đường, b theo tiếp tuyến); a < 0 bị nhân (1−s); FIT_N điểm mép
  const clearOK = (Rc, sc) => {
    const k = 1 - sc;
    for (let q = 0; q < FIT_N; q++) {
      const ca = FIT_C[q], a = ca < 0 ? ca * k : ca, b = FIT_S[q];
      const px = x + (nx * a + tx * b) * Rc, pz = z + (nz * a + tz * b) * Rc;
      for (let e = 0; e < E.length; e += 5) {
        if (E[e + 4] - Rc >= FACADE_CLEAR) continue;     // cạnh xa hơn R + 1,5 m tính từ gốc: không điểm mép nào chạm
        const ax = E[e], az = E[e + 1], dx = E[e + 2] - ax, dz = E[e + 3] - az, L2 = dx * dx + dz * dz || 1;
        let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        if ((px - ax - t * dx) ** 2 + (pz - az - t * dz) ** 2 < (FACADE_CLEAR - 0.05) ** 2) return false;
      }
    }
    // cạnh tường nằm GỌN trong tán (nhà nhỏ/ki-ốt): điểm gần thân nhất của cạnh lọt trong hình tán
    for (let e = 0; e < E.length; e += 5) {
      if (E[e + 4] >= Rc) continue;
      const ax = E[e], az = E[e + 1], dx = E[e + 2] - ax, dz = E[e + 3] - az, L2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * dx - x, qz = az + t * dz - z;
      let a = qx * nx + qz * nz; const b = qx * tx + qz * tz;
      if (a < 0) a /= Math.max(k, 0.05);
      if (a * a + b * b < Rc * Rc) return false;
    }
    return true;
  };
  for (let it = 0; it < 12 && !clearOK(Rf, s); it++) {
    if (Rf <= Rmin + 1e-3) break;
    Rf = Math.max(Rmin, Rf * 0.88);
    s = Math.min(SQ_MAX, Math.max(0, 1 - room / Rf));
  }
  out.sq = s; out.nx = nx; out.nz = nz; out.R = Rf;
  return out;
}

let _built = null;
// ctx: { groundHeight, R, lakeSD, hdTreeBelt, colliders?, fpGrid?, fpData? }
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
          if (!roadHit(nx, nz) && !onCarriage(nx, nz) && (e.parent || fpG.at(nx, nz) < 0) && !nearPano(nx, nz, PANO_CLEAR) && !smallColNear(nx, nz, e.parent ? null : colAt(x, z))) {
            if (!e.parent) { movedCols = colAt(x, z); for (const c of movedCols) { c.x = nx; c.z = nz; } }
            x = nx; z = nz; y = undefined; fix.moved++;
          } else drop = 'road';
        } else drop = 'road';
      }
      if (!drop && onCarriage(x, z)) drop = 'road';   // W2-A: gốc trên nhựa khe đường đôi/đa giác nút giao (roadHit chỉ biết dải tim ROADS_DT)
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
    const o = e.o;
    // hero GLB (showcase, luôn nở đỏ) chỉ trong HERO_SHOW_R quanh Nhà hát + không chắn khung pano (heroSpotOk) — còn lại: phượng thủ
    // tục nở theo LỊCH như mọi cây (W2-B: trước 57 hero rải cả dải trung tâm + vườn hoa → "vòm đỏ" khắp nơi tháng 10)
    const heroOk = sp === SP.PHUONG && o.hero !== undefined && o.hero >= 0 && Math.hypot(x - OPERA[0], z - OPERA[1]) < HERO_SHOW_R && heroSpotOk(x, z);
    // CẮT CỤT / TỈA TRƠ theo bằng chứng pano (bão Yagi 9/2024 → pano 10/2024): loài đặt đích danh bởi helper cũ
    // (phượng allée, xà cừ vườn hoa…) cũng bị cắt khi pano ≤ 60 m nói "cắt cụt/trụi" — trước chỉ cây 'shade/street/park'
    if (!heroOk && V.near && V.polLvl > 0 && sp !== SP.CAU && sp !== SP.DA && sp !== SP.NON && sp !== SP.CATCUT && hxz(x, z, 5) < V.pollard * 0.85) sp = SP.CATCUT;
    const kits = SP_KITS[sp];
    const kit = kits[o.variant !== undefined ? o.variant % kits.length : (hxz(x, z, 41) * kits.length) | 0];
    // ---- KÍCH THƯỚC THẬT (m): cao H, mép dưới tán B, bán kính tán R — phân bố lệch về cây nhỏ/vừa (u^1,25) cho đa dạng;
    // cấp phố (o.sz) thu cao + tán nhưng KHÔNG hạ mép tán dưới mức tỉa tối thiểu của loài; h/r của helper cũ nặng 50%
    const T = SPX[sp], u = hxz(x, z, 42), s = u ** 1.25, szf = o.sz || 1;
    let H = lerp(T[0], T[1], s) * szf;
    let B = Math.max(lerp(T[2], T[3], clamp(0.55 * s + 0.45 * hxz(x, z, 48), 0, 1)) * (0.92 + 0.08 * szf), T[2] * 0.95);
    let Rr = lerp(T[4], T[5], clamp(0.65 * s + 0.35 * hxz(x, z, 49), 0, 1)) * (0.75 + 0.25 * szf);
    if (o.h) H = clamp(lerp(H, o.h, 0.5), T[0] * 0.8, T[1] * 1.12);
    if (o.r) Rr = clamp(lerp(Rr, o.r, 0.5), T[4] * 0.8, T[5] * 1.1);
    // TỈA TRƠ (cut-back): thân cao, tán nhỏ thưa — dạng phổ biến nhất trên pano 10/2024 (pano_007/055/036)
    const cutP = sp === SP.CAU || sp === SP.DA || sp === SP.NON || sp === SP.CATCUT || heroOk ? 0
      : V.polLvl > 0 ? 0.1 + V.polLvl * 0.065 : V.thin ? 0.7 : V.near ? 0.1 : V.zoneCut;
    const cut = hxz(x, z, 57) < cutP ? 1 : 0;
    if (cut) { Rr *= 0.55 + 0.2 * hxz(x, z, 58); B += 0.5; }
    if (sp !== SP.CAU) B = Math.min(B, H - (sp === SP.CATCUT || sp === SP.NON ? 1.6 : 2.6));   // độ sâu tán tối thiểu
    const wash = o.wash !== undefined ? (o.wash ? 1 : 0) : (sp === SP.CAU || sp === SP.DA ? 0 : hxz(x, z, 22) < V.wash ? 1 : 0);
    // độ kín tán (shader bỏ bớt thẻ lá) — W2-B thưa hơn: thường 0,62-0,95; pano "tán thưa/trụi" & tỉa trơ 0,38-0,62
    const hf = hxz(x, z, 47);
    const full = o.full ?? (sp === SP.CAU || sp === SP.CATCUT || sp === SP.NON ? 1 : sp === SP.DA ? 0.82 + 0.15 * hf
      : V.thin || cut ? 0.34 + 0.22 * hf : sp === SP.BANG ? 0.66 + 0.26 * hf : 0.58 + 0.34 * hf);
    // HẠNG HOA (0..1): cây nở khi hạng < tỉ lệ nở của ngày (uBloom); bằng lăng +2; −1 = luôn nở (cây đôi của hero GLB)
    const rank = heroOk ? -1 : sp === SP.BANGLANG ? 2 + hxz(x, z, 21) : sp === SP.PHUONG ? hxz(x, z, 21) : 3;
    recs.push({ x, y, z, sp, kit, sy: 1, sxz: 1, yaw: o.yaw ?? hxz(x, z, 44) * Math.PI * 2, lx: (hxz(x, z, 45) - 0.5) * 0.07, lz: (hxz(x, z, 46) - 0.5) * 0.07,
      rank, wash, pit: o.pit || 0, hero: heroOk ? o.hero : -1, full, H, B, Rr, cut, lift: 0, cs: 1, ox: 0, oz: 0 });
  }
  const N = recs.length, recsMs = performance.now() - t0;
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
  const tK = performance.now();
  const usedK = new Set(recs.map((r) => r.kit)), usedS = new Set(recs.map((r) => r.sp));
  const nearKits = [], farKits = [];
  KIT_DEFS.forEach((d, i) => { nearKits[i] = usedK.has(i) ? genKit(d, false, 1000 + i * 17) : null; });
  // kit XA mỗi loài lấy dáng biến thể 0
  for (let s = 0; s < SP_N; s++) farKits[s] = usedS.has(s) ? genKit(KIT_DEFS[SP_KITS[s][0]], true, 5000 + s * 13) : null;
  const kitMs = performance.now() - tK;
  // ---- KÍCH THƯỚC THẬT → biến hình kit (W2-B). Mỗi cây: tán né mặt tiền (facadeFit) rồi quy về đơn vị kit:
  //   sy = (H − B)/(top − base) (co dọc theo ĐỘ SÂU TÁN), lift = B/sy − base (nâng tán: thân trống dài ra, gốc vôi giữ),
  //   sxz = bề dày thân ∝ sy, cs = R/(rad·sxz) (co tán ngang quanh trục); sát tường: ép nửa tán phía tường (sq, hướng
  //   snx/snz → zx/zz kit), đứng tự do: nghiêng nhẹ (ox,oz ≤ 5,5°). Cùng số đo cho kit XA (syF/liftF/csF).
  const fpD = ctx.facade === false ? null : footprintData(ctx);   // facade:false = trang QA kit (tools/qa/trees.html)
  const fit = { squeezed: 0, shrunk: 0, maxSq: 0, ms: 0 };
  const tF = performance.now();
  // hộp claim 'cell' nhỏ (nhà ô dựng tay giữ lại) → lưới 32 m cho facadeFit
  const CB = new Map();
  for (const c of claimsAll()) {
    if (c.kind !== 'cell' || c.type !== 'box' || c.hx * c.hz * 4 > 1500) continue;
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot), P = [];
    // local X → (cosθ, −sinθ), local Z → (sinθ, cosθ) (claims.js)
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push([c.cx + a * c.hx * cs + b * c.hz * sn, c.cz - a * c.hx * sn + b * c.hz * cs]);
    const e = { cx: c.cx, cz: c.cz, hx: c.hx, hz: c.hz, cs, sn, P, x0: c.bb[0], z0: c.bb[1], x1: c.bb[2], z1: c.bb[3] };
    for (let i = Math.floor((e.x0 - 12) / 32); i <= Math.floor((e.x1 + 12) / 32); i++) for (let j = Math.floor((e.z0 - 12) / 32); j <= Math.floor((e.z1 + 12) / 32); j++) {
      const k = i * 100003 + j; let a = CB.get(k); if (!a) CB.set(k, (a = [])); a.push(e);
    }
  }
  const LEAN_T = Math.tan(LEAN_NAT_DEG * Math.PI / 180);
  for (const r of recs) {
    const k = nearKits[r.kit], kf = farKits[r.sp], cau = r.sp === SP.CAU;
    r.sq = 0; r.snx = 0; r.snz = 0; r.zx = 0; r.zz = 0;
    if (cau) {
      r.sy = clamp(r.H / k.top, 0.45, 1.3); r.sxz = r.sy * (0.92 + hxz(r.x, r.z, 43) * 0.12);
      r.syF = clamp(r.H / kf.top, 0.45, 1.3); r.liftF = 0; r.csF = 1;
      continue;
    }
    let R = r.Rr;
    if (fpD) {
      const f = facadeFit(r.x, r.z, r.B, R, fpG, fpD, CB);
      if (f.sq > 0.005) { r.sq = f.sq; r.snx = f.nx; r.snz = f.nz; fit.squeezed++; fit.maxSq = Math.max(fit.maxSq, f.sq); }
      if (f.R < R - 0.05) fit.shrunk++;
      R = f.R; r.fd = f.d;
    }
    r.sy = clamp((r.H - r.B) / Math.max(0.5, k.top - k.base), 0.4, 2.4);
    r.lift = clamp(r.B / r.sy - k.base, -(k.fork - WASH_TOP) * 0.6, 14);
    // bề dày thân theo CHIỀU CAO cây so với kit (không theo độ sâu tán — cây cắt cụt tán nông từng ra thân 1 m)
    r.sxz = clamp((r.H / k.def.H) ** 0.8 * (0.88 + hxz(r.x, r.z, 43) * 0.22), 0.45, 1.5);
    r.cs = clamp(R / (k.rad * r.sxz), 0.35, 1.9);
    // kit XA (variant 0 của loài, > NEAR_R): sy/nâng/co tán RIÊNG theo số đo kit xa → mép dưới/ngọn/bán kính tán khớp
    // kit gần ở ranh LOD (trước: dùng aShape của kit gần → mép tán nhảy −1..+1,7 m khi đổi LOD). Khớp mép/ngọn THỰC của
    // kit gần (kể cả khi kẹp sy/nâng — cắt cụt biến thể 1 không hạ tán dưới chạc được), không phải B/H mong muốn
    const Bn = (k.base + r.lift) * r.sy, Tn = (k.top + r.lift) * r.sy;
    // (kit xa xà cừ/cắt cụt: tán NÔNG hơn kit gần → cần hạ tán sâu dưới chạc; ở > 180 m thân bị nén 90% không thấy được;
    // vẫn chạm sàn → chọn sy khớp TÂM tán, chia đều sai số mép dưới/ngọn)
    const lminF = -(kf.fork - WASH_TOP) * 0.9;
    r.syF = clamp((Tn - Bn) / Math.max(0.5, kf.top - kf.base), 0.4, 2.4);
    r.liftF = Bn / r.syF - kf.base;
    if (r.liftF < lminF) { r.liftF = lminF; r.syF = clamp((Bn + Tn) / 2 / Math.max(0.5, (kf.base + kf.top) / 2 + lminF), 0.4, 2.4); }
    r.liftF = Math.min(r.liftF, 14);
    r.csF = clamp(R / (kf.rad * r.sxz), 0.35, 1.9);
    // nghiêng TỰ NHIÊN (cây phố HP ít khi thẳng tuyệt đối — pano_007/085) chỉ cây ĐỨNG TỰ DO (không tường trong tầm),
    // không cây non chống cọc / cắt cụt; dời tán ≤ tan(5,5°) × đoạn thân gốc vôi → chạc (shader dồn nghiêng vào đoạn
    // này) — review W2-B: 0,15-0,8 m trên đoạn 1,4-3,3 m từng ra thân gãy 9-17°, cộng dời né tường tới 55°
    let ox = 0, oz = 0;
    if (!r.sq && r.sp !== SP.NON && r.sp !== SP.CATCUT && (r.fd === undefined || r.fd > R + FACADE_CLEAR + 1) && Number.isFinite(k.fork)) {
      const seg = Math.max(0, (Math.min(k.fork, kf.fork) + Math.min(r.lift, r.liftF) - WASH_TOP) * Math.min(r.sy, r.syF));
      const a = hxz(r.x, r.z, 59) * 6.283, m = Math.min((0.15 + 0.65 * hxz(r.x, r.z, 60)) * Math.min(1, r.B / 5), LEAN_T * seg);
      ox = Math.cos(a) * m; oz = Math.sin(a) * m;
    }
    // thế giới → kit (nghịch đảo xoay yaw; nghiêng lx/lz nhỏ bỏ qua): dời tán chia sxz; hướng ép tán chỉ xoay
    const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
    r.ox = (ox * c - oz * s) / r.sxz; r.oz = (ox * s + oz * c) / r.sxz;
    if (r.sq) { r.zx = (r.snx * c - r.snz * s) * r.sq; r.zz = (r.snx * s + r.snz * c) * r.sq; } else { r.zx = r.ox; r.zz = r.oz; }
    r.Rf = R; r.wox = ox; r.woz = oz;
  }
  fit.ms = +(performance.now() - tF).toFixed(1); fit.maxSq = +fit.maxSq.toFixed(2);
  // ---- ma trận + màu + thuộc tính từng cây ----
  // M/SHP: kit GẦN; MF/SHPF: kit XA (sy + nâng/co tán riêng theo số đo kit xa). SHP.y < 0 = cờ TÁN LỆCH (xem VERT_BEGIN)
  const M = new Float32Array(N * 16), COL = new Float32Array(N * 3), INST = new Float32Array(N * 4), SHP = new Float32Array(N * 4);
  const MF = new Float32Array(N * 16), SHPF = new Float32Array(N * 4);
  const px = new Float32Array(N), pz = new Float32Array(N);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const SP_TINT = [[1, 1, 1], [1.04, 1.03, 0.95], [1.0, 1.03, 0.95], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [0.95, 0.97, 0.95], [1.03, 1.03, 1]];
  const setM = (i, r) => {
    _e.set(r.lx, r.yaw, r.lz); _q.setFromEuler(_e); _s.set(r.sxz, r.sy, r.sxz); _p.set(r.x, r.y, r.z);
    _m.compose(_p, _q, _s); _m.toArray(M, i * 16);
    _s.set(r.sxz, r.syF, r.sxz); _m.compose(_p, _q, _s); _m.toArray(MF, i * 16);
    const sg = r.sq > 0 ? -1 : 1;
    SHP[i * 4] = r.lift; SHP[i * 4 + 1] = sg * r.cs; SHP[i * 4 + 2] = r.zx; SHP[i * 4 + 3] = r.zz;
    SHPF[i * 4] = r.liftF; SHPF[i * 4 + 1] = sg * r.csF; SHPF[i * 4 + 2] = r.zx; SHPF[i * 4 + 3] = r.zz;
  };
  recs.forEach((r, i) => {
    setM(i, r);
    px[i] = r.x; pz[i] = r.z;
    const b = 0.86 + hxz(r.x, r.z, 51) * 0.24, tt = SP_TINT[r.sp];
    let cr = tt[0] * b * (1 + (hxz(r.x, r.z, 52) - 0.5) * 0.14), cg = tt[1] * b, cb = tt[2] * b * (1 + (hxz(r.x, r.z, 53) - 0.5) * 0.2);
    if (r.sp === SP.BANG && hxz(r.x, r.z, 54) < 0.18) { cr *= 1.25; cg *= 1.05; cb *= 0.7; }   // bàng ngả vàng
    COL[i * 3] = cr; COL[i * 3 + 1] = cg; COL[i * 3 + 2] = cb;
    INST[i * 4] = r.rank; INST[i * 4 + 1] = r.wash; INST[i * 4 + 2] = hxz(r.x, r.z, 55) * 6.283; INST[i * 4 + 3] = r.full;
  });
  // ---- nhóm InstancedMesh ----
  const groups = [];
  const mkGroup = (kitObj, cap, name, cast, S) => {
    const geo = kitObj.geo.clone();
    const aInst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aInst.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aInst', aInst);
    const aShape = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4); aShape.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aShape', aShape);
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.customDepthMaterial = depthMat;
    mesh.count = 0; mesh.name = name; mesh.castShadow = cast; mesh.receiveShadow = true;
    mesh.userData.noCull = true;           // instcull KHÔNG quản (LOD riêng bên dưới)
    mesh.userData.noMerge = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), -1);
    scene.add(mesh);
    const g = { mesh, cap, idx: new Int32Array(cap).fill(-1), k: 0, dirty: false, aInst, aShape, S, cast, tris: kitObj.tris };
    groups.push(g); return g;
  };
  const nearCount = new Array(KIT_DEFS.length).fill(0), farCount = new Array(SP_N).fill(0);
  for (const r of recs) { nearCount[r.kit]++; farCount[r.sp]++; }
  const nearG = KIT_DEFS.map((d, i) => (nearCount[i] ? mkGroup(nearKits[i], nearCount[i], 'trees_' + SP_NAME[d.sp] + i, true, SHP) : null));
  const farG = Array.from({ length: SP_N }, (_, s) => (farCount[s] ? mkGroup(farKits[s], farCount[s], 'trees_far_' + SP_NAME[s], false, SHPF) : null));
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
    const pg = G.build(); pg.deleteAttribute('uv'); pg.deleteAttribute('aKind'); pg.deleteAttribute('aSway'); pg.deleteAttribute('aHt');
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
      if (!g.pit && !g.hero) { g.mesh.instanceColor.array.set(COL.subarray(i * 3, i * 3 + 3), k * 3); g.aInst.array.set(INST.subarray(i * 4, i * 4 + 4), k * 4); g.aShape.array.set(g.S.subarray(i * 4, i * 4 + 4), k * 4); }
    }
    g.k++;
  };
  const finish = (g, rad) => {
    if (g.k !== g.mesh.count) g.dirty = true;
    if (g.dirty) {
      g.mesh.count = g.k; g.mesh.instanceMatrix.needsUpdate = true;
      if (!g.pit && !g.hero) { g.mesh.instanceColor.needsUpdate = true; g.aInst.needsUpdate = true; g.aShape.needsUpdate = true; }
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
  // W2-B: chỉ HERO_MAX cây GLB GẦN NHẤT trong HERO_R (cây đang là hero được ưu tiên 8 m — chống nhấp nháy khi 2 cây
  // cách gần bằng nhau); còn lại vẽ phượng thủ tục cùng chỗ (cây đôi, luôn nở như GLB)
  const heroIdx = []; recs.forEach((r, i) => { if (r.hero >= 0) heroIdx.push(i); });
  const heroPick = new Uint8Array(N), _hc = [];
  // NÓN NHÌN cho kit XA: chỉ giữ cây xa trong góc ngang ±(nửa FOV ngang + 31°) quanh hướng nhìn (cây xa không đổ bóng
  // nên sau lưng camera là vô ích; trước: ~5k cây xa vẽ cả vòng 360° ≈ 0,6 M tam giác mỗi khung). cone = cos(giới hạn),
  // < −1 = tắt (camera trực giao / nhìn dốc xuống — mặt đất sau lưng lọt khung). Gán lại khi hướng đổi > 10°.
  let coneCos = -2, coneFx = 0, coneFz = 1;
  const assign = (cx, cz) => {
    for (const g of groups) g.k = 0;
    if (pitG) pitG.k = 0;
    heroNear.length = 0;
    const n2 = NEAR_R * NEAR_R, n2h = (NEAR_R + 12) ** 2, f2 = FAR_R * FAR_R, h2 = HERO_R * HERO_R, h2h = (HERO_R + 10) ** 2, p2 = Math.min(NEAR_R, 90) ** 2;
    _hc.length = 0;
    if (U.uBloom.value.x > 0.05) for (const i of heroIdx) {      // mùa hoa tắt hẳn (setSeason(0)) → không hero
      heroPick[i] = 0;
      if (!heroReady[heroOf[i]]) continue;
      const d2 = (px[i] - cx) ** 2 + (pz[i] - cz) ** 2, cur = state[i] === 3;
      if (d2 < (cur ? h2h : h2)) _hc.push({ i, d: Math.sqrt(d2) - (cur ? 8 : 0) });
    }
    else for (const i of heroIdx) heroPick[i] = 0;
    if (_hc.length > HERO_MAX) _hc.sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(HERO_MAX, _hc.length); k++) heroPick[_hc[k].i] = 1;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cx, dz = pz[i] - cz, d2 = dx * dx + dz * dz, prev = state[i];
      if (heroPick[i]) { state[i] = 3; heroNear.push(i); }
      else if (d2 < (prev === 1 || prev === 3 ? n2h : n2)) { state[i] = 1; write(nearG[kitOf[i]], i, M); }
      else if (d2 < f2 && (coneCos < -1 || dx * coneFx + dz * coneFz >= coneCos * Math.sqrt(d2))) { state[i] = 2; write(farG[spOf[i]], i, MF); }
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
      lastT = now; lastX = cx; lastZ = cz; lastYaw = yaw; lastCone = cone; coneCos = cone; assign(cx, cz); calendarTick();
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
    for (const i of L) {
      const r = recs[i], k = nearKits[r.kit], kf = farKits[r.sp];
      // cao hero như cũ (HERO_BASE_H × 0.82..1.32), cây thủ tục thay thế (cây ĐÔI) cùng cao + cùng độ xoè tán (aspect
      // GLB), không nâng/dời tán (GLB không biến hình được)
      const h = HB[v] * (0.82 + hxz(r.x, r.z, 61) * 0.5);
      _e.set(0, r.yaw, 0); _q.setFromEuler(_e); _s.setScalar(h); _p.set(r.x, r.y, r.z);
      _m.compose(_p, _q, _s).multiply(B); _m.toArray(HM, i * 16);
      heroBox[i * 2] = Math.max(h * aspect * 0.6, h * 0.6); heroBox[i * 2 + 1] = h;
      r.sy = h / k.top; r.sxz = r.sy * 0.95; r.lift = 0; r.ox = r.oz = 0; r.sq = 0; r.zx = r.zz = 0;
      r.cs = clamp((h * aspect * 0.5) / (k.rad * r.sxz), 0.5, 1.6);
      r.syF = h / kf.top; r.liftF = 0; r.csF = clamp((h * aspect * 0.5) / (kf.rad * r.sxz), 0.5, 1.6);
      setM(i, r);
      for (const g of [nearG[kitOf[i]], farG[spOf[i]]]) if (g) g.idx.fill(-1);   // ép ghi lại hàng ma trận
    }
    heroReady[v] = true; lastT = -1e9;
  };
  // ---- tra cây phượng ĐANG NỞ gần nhất (cánh hoa rơi — petals.js) ----
  // (W2-B: theo LỊCH — cây nở khi hạng < tỉ lệ ngày; độ rộ = như shader (tỉ lệ − hạng)·8 → cánh rơi thưa/dày theo)
  const BG = new Map();
  recs.forEach((r, i) => { if (r.sp === SP.PHUONG && r.rank < 0.85) { const k = Math.floor(r.x / 32) * 100003 + Math.floor(r.z / 32); let a = BG.get(k); if (!a) BG.set(k, (a = [])); a.push(i); } });
  const _bn = { x: 0, z: 0, d: 0, h: 0, y: 0, s: 0 };
  const bloomNear = (x, z, rMax = 45) => {
    const share = U.uBloom.value.x;
    let best = -1, bd = rMax * rMax; const ci = Math.floor(x / 32), cj = Math.floor(z / 32), rc = Math.ceil(rMax / 32);
    for (let i = ci - rc; i <= ci + rc; i++) for (let j = cj - rc; j <= cj + rc; j++) {
      const a = BG.get(i * 100003 + j); if (!a) continue;
      for (const t of a) { if ((share - recs[t].rank) * 8 < 0.2 || (recs[t].rank < 0 && share <= 0.05)) continue; const d = (px[t] - x) ** 2 + (pz[t] - z) ** 2; if (d < bd) { bd = d; best = t; } }
    }
    if (best < 0) return null;
    const r = recs[best];
    _bn.x = px[best]; _bn.z = pz[best]; _bn.d = Math.sqrt(bd); _bn.y = r.y; _bn.s = clamp((share - r.rank) * 8, 0, 1);
    _bn.h = heroOf[best] >= 0 && heroBox[best * 2 + 1] ? heroBox[best * 2 + 1] : (nearKits[r.kit].top + r.lift) * r.sy;
    return _bn;
  };
  const bySp = {}; for (const r of recs) bySp[SP_NAME[r.sp]] = (bySp[SP_NAME[r.sp]] || 0) + 1;
  const info = {
    trees: N, fix, fit, cut: recs.reduce((a, r) => a + r.cut, 0), bySpecies: bySp, heroes: heroList.map((l) => l.length), pits: pitIdx.length,
    kitTris: nearKits.map((k, i) => k && [SP_NAME[KIT_DEFS[i].sp] + i, k.tris]).filter(Boolean),
    farTris: farKits.map((k, s) => k && [SP_NAME[s], k.tris]).filter(Boolean),
    atlasMs: +atlasMs.toFixed(1), recsMs: +recsMs.toFixed(1), kitMs: +kitMs.toFixed(1), buildMs: +(performance.now() - t0).toFixed(1), drawGroups: groups.length + (pitG ? 1 : 0),
  };
  console.log('[trees] dựng:', JSON.stringify(info));
  const stats = () => {
    let near = 0, far = 0, hero = 0, tris = 0, calls = 0;
    for (const g of groups) { if (!g.mesh.count) continue; calls++; tris += g.mesh.count * g.tris; if (g.cast) near += g.mesh.count; else far += g.mesh.count; }
    for (const g of heroG) if (g && g.mesh.count) { calls++; hero += g.mesh.count; tris += g.mesh.count * (g.mesh.geometry.index ? g.mesh.geometry.index.count / 3 : g.mesh.geometry.attributes.position.count / 3); }
    if (pitG && pitG.mesh.count) { calls++; tris += pitG.mesh.count * pitG.tris; }
    return Object.assign({}, info, { near, far, hero, visTris: Math.round(tris), calls });
  };
  // LỊCH: setDate(tháng, ngày) → tỉ lệ nở theo bloomShare; setSeason(s) = ghi đè tỉ lệ (0..1, cả 2 loài; null = về lịch)
  let doy = parseDateParam(), seasonOverride = null;
  const applySeason = () => {
    const [a, b] = seasonOverride != null ? [seasonOverride, seasonOverride] : bloomShare(doy);
    U.uBloom.value.set(a, b); lastT = -1e9;
  };
  applySeason();
  const setSeason = (b) => { seasonOverride = b == null ? null : clamp(+b, 0, 1); applySeason(); };
  const setDate = (m, d = 15) => { doy = doyOf(clamp(Math.round(m), 1, 12), clamp(Math.round(d), 1, 31)); seasonOverride = null; applySeason(); };
  const getDate = () => { const [m, d] = mdOf(doy); return { month: m, day: d, doy, share: [+U.uBloom.value.x.toFixed(3), +U.uBloom.value.y.toFixed(3)] }; };
  // ngày tự sang khi đồng hồ game qua 0h (đọc dayNight của main.js qua __hp — không có thì đứng ở ngày mặc định)
  let lastDayT = -1;
  const calendarTick = () => {
    const dn = globalThis.__hp && globalThis.__hp.dayNight; if (!dn) return;
    const t = dn.t;
    if (lastDayT > 0.85 && t < 0.15) { doy = doy % 365 + 1; if (seasonOverride == null) applySeason(); }
    lastDayT = t;
  };
  _built = { setHeroModel, bloomNear, stats, setSeason, setDate, getDate, uniforms: U, recs };
  // lưới gốc dựng lại theo vị trí CUỐI (sau dời/bỏ) → hệ chạy sau buildTrees (đạo cụ WP7…) vẫn tra được trunkNear
  Q.length = 0; _trunkGrid.clear(); for (const r of recs) addTrunk(r.x, r.z);
  return _built;
}
export const treeSystem = () => _built;
