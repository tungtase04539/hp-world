// herokit.js — Đợt 3 W5-A HERO-KIT: CÔNG TRÌNH ĐẶC TRƯNG (không phải nhà ống) dựng theo BẰNG CHỨNG ẢNH PANO THẬT.
// Dữ liệu: js/herokit_data.js (SINH bởi tools/gen_herokit.mjs: ghi chú + kiểu quan sát fp_json → chương trình từng nhà).
// citygen.js gọi: heroAt(cx, cz) (khớp tâm diện tích footprint ≤ 0,6 m) → chỉ số HERO; renderStyles/fpBuild của citygen
// chọn KIỂU DỰNG + bộ trệt + màu theo chương trình; buildHero(ctx) dựng KHỐI 3D đặc trưng vào CÙNG bộ đệm phố (1 material,
// 0 draw call thêm): M = ô CHÍNH (hình bóng thấy từ xa: hàng cột, mái chùa, mái che, cổng), DT = ô CHI TIẾT (đố kính, gờ tầng,
// song rào, cột bơm — chỉ trong DET_R, TIER ≤ 1 không có).
//
// HỢP ĐỒNG: mọi hình = quad kind 5 (ô atlas ở aFac.z), uv theo mét/4 cho ô tường (lặp mỗi 4 m) — giống chi tiết citygen.
// Tất định (hash theo hạt giống nhà). Khoảng LÙI tới vỉa hè (ctx.gap) quyết định đồ ĐỨNG trước mặt tiền (cột, trụ mái che,
// rào, cổng): không có chỗ → bản áp tường / không dựng — không bao giờ lấn vỉa hè/lòng đường.
import { HERO } from './herokit_data.js';
import { MOD } from './facade_atlas.js';
import { GROUND_H, FLOOR_H, heightOf } from './buildings_data.js';

// chương trình (khớp HERO_PROG của tools/gen_herokit.mjs)
export const HP = { NONE: 0, PAGODA: 1, PETROL: 2, MARKET: 3, SCHOOL: 4, BANK: 5, HOTEL: 6, STORE: 7, OFFICE: 8, COLONNADE: 9 };
export const HF = { TILE: 1, FENCE: 2, CANOPY: 4, STAIRS: 8, ARCH: 16, CURVED: 32, COLUMNS: 64, ELEC: 128, FASHION: 256, PHONE: 512 };

// ---------- tra cứu theo tâm footprint ----------
const HG = 4;
let _hg = null;
function hgrid() {
  if (_hg) return _hg;
  _hg = new Map();
  for (let i = 0; i < HERO.length; i++) {
    const k = Math.floor(HERO[i][0] / 10 / HG) * 65536 + Math.floor(HERO[i][1] / 10 / HG);
    let l = _hg.get(k); if (!l) _hg.set(k, (l = [])); l.push(i);
  }
  return _hg;
}
export function heroAt(cx, cz) {
  const G = hgrid(), gx = Math.floor(cx / HG), gz = Math.floor(cz / HG);
  let best = 0.36, bi = -1;
  for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
    const l = G.get(i * 65536 + j); if (!l) continue;
    for (const q of l) { const d = (HERO[q][0] / 10 - cx) ** 2 + (HERO[q][1] / 10 - cz) ** 2; if (d < best) { best = d; bi = q; } }
  }
  return bi;
}
// mọi công trình hero có tâm trong bán kính r quanh (x,z)
export function heroesNear(x, z, r) {
  const G = hgrid(), out = [], k = Math.ceil(r / HG);
  for (let i = Math.floor(x / HG) - k; i <= Math.floor(x / HG) + k; i++) for (let j = Math.floor(z / HG) - k; j <= Math.floor(z / HG) + k; j++) {
    const l = G.get(i * 65536 + j); if (!l) continue;
    for (const q of l) if ((HERO[q][0] / 10 - x) ** 2 + (HERO[q][1] / 10 - z) ** 2 <= r * r) out.push(q);
  }
  return out;
}
// HỌ chương trình (khớp tên nhà ô dựng tay ↔ chương trình ảnh): thương mại hiện đại (ngân hàng/khách sạn/showroom/văn phòng)
// coi là cùng họ — ảnh thường tả "sảnh kính cột đá" cho cả ngân hàng lẫn văn phòng (pano_157 VIB)
export const heroFamily = (p) => (p === HP.BANK || p === HP.HOTEL || p === HP.STORE || p === HP.OFFICE ? 100 : p);
// chương trình suy từ TÊN nhà ô dựng tay (world.js cells) — 0 = tên không nói
const NAME_PROG = [
  [HP.PETROL, /xang|petrol|gasstation/],
  [HP.PAGODA, /chua|(^|_)den(_|$)|(^|_)dinh(_|$)|pagoda/],
  [HP.MARKET, /(^|_)cho(_|$)|market/],
  [HP.BANK, /vib|scb|tpbank|bidv|agribank|vietin|vietcom|abbank|baoviet|nganhang|techcom|mbbank|(^|_)acb|shb|hdbank|sacom|vpbank|seabank|lienviet|eximbank|bank/],
  [HP.HOTEL, /khachsan|hotel|(^|_)ks(_|$)|legend|pullman|hilton|melia|avani|mercure/],
  [HP.SCHOOL, /truong|mamnon|school|thpt|thcs|tieuhoc|daihoc|ubnd|congso|chicuc|thue|uyban|toaan|congan|benhvien|(^|_)bv(_|$)/],
  [HP.STORE, /showroom|dienmay|sieuthi|(^|_)mall|store/],
  [HP.OFFICE, /caooc|toakinh|office|vanphong/],
];
export function heroProgOfName(name) { const n = String(name || '').toLowerCase(); for (const [p, re] of NAME_PROG) if (re.test(n)) return p; return 0; }
// nhà b của bộ giải mã RB (D: vStart/x/z) → chỉ số HERO (tâm diện tích CÙNG công thức với tools/gen_herokit.mjs) + diện tích
export function heroOfPoly(D, b) {
  const s = D.vStart[b], n = D.vStart[b + 1] - s;
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, xa = D.x[s + i], za = D.z[s + i], xb = D.x[s + j], zb = D.z[s + j], c = xa * zb - xb * za;
    a += c; cx += (xa + xb) * c; cz += (za + zb) * c;
  }
  if (Math.abs(a) < 1e-6) return { hi: -1, area: 0 };
  return { hi: heroAt(cx / (3 * a), cz / (3 * a)), area: Math.abs(a) / 2 };
}
export const heroProg = (i) => (i >= 0 ? HERO[i][2] : 0);
export const heroWall = (i) => (i >= 0 ? HERO[i][3] : -1);
export const heroAccent = (i) => (i >= 0 ? HERO[i][4] : -1);
export const heroFlags = (i) => (i >= 0 ? HERO[i][5] : 0);
export const heroFocus = (i) => (i >= 0 && HERO[i].length > 7 ? [HERO[i][6] / 10, HERO[i][7] / 10] : null);
export const heroCount = () => HERO.length;
// DÃY NGÂN HÀNG liền kề (354: 3 lô 74-92 m² cùng một chi nhánh) → chữ 'NGÂN HÀNG' chỉ ở lô GIỮA dãy (tổng khoảng cách tới các
// lô ngân hàng ≤ 25 m nhỏ nhất); các lô kia chỉ dải trơn màu nhấn (không 3 chữ liền nhau)
let _lead = null;
export function bankLead(i) {
  if (!_lead) {
    _lead = new Set();
    const B = []; for (let k = 0; k < HERO.length; k++) if (HERO[k][2] === HP.BANK) B.push(k);
    const d = (a, b) => Math.hypot(HERO[a][0] - HERO[b][0], HERO[a][1] - HERO[b][1]) / 10;
    const nb = (a) => B.filter((b) => b !== a && d(a, b) <= 25);
    const cen = (a) => nb(a).reduce((t, b) => t + d(a, b), 0);
    for (const a of B) { const ca = cen(a); if (nb(a).every((b) => ca < cen(b) - 1e-6 || (Math.abs(ca - cen(b)) <= 1e-6 && a < b))) _lead.add(a); }
  }
  return _lead.has(i);
}
// phản biện W5-A: nhà chợ (hội trường mái tôn ≤ 2 tầng) / cây xăng (ki-ốt 1 tầng) chỉ ÉP tầng + kiểu SHED + mái khi footprint
// THẬT thấp (D.floors ≤ 3 / ≤ 2). Cao hơn = sạp chợ/mái che TRƯỚC nhà nhiều tầng → giữ chiều cao, kiểu, mái; herokit chỉ thêm
// mái hiên/mái che (pano_006 b4401: nhà 8 tầng từng bị ép thành lán 2 tầng; footprints.topAt/trees vẫn dùng D.floors)
// Số tầng có BẰNG CHỨNG (cờ RB PANO 16 / EDIT 128) hoặc ≥ 5 mới tính; số tầng MẶC ĐỊNH của footprint MS/Google (pano_418 b14830
// cây xăng: MS, 3 T không nguồn — ảnh tả trạm xăng 1 tầng) thì ép theo ảnh và citygen GHI LẠI D.floors (rbdata dùng chung).
export const heroTall = (p, floors, flags = 255) => ((p === HP.MARKET && floors > 3) || (p === HP.PETROL && floors > 2)) && ((flags & (16 | 128)) !== 0 || floors >= 5);

// ---------- màu ----------
// sRGB 0xRRGGBB → mảng u8 TUYẾN TÍNH như WALL_LIN của citygen (thuộc tính màu đỉnh là tuyến tính)
export function linRGB(hex) {
  const f = (c) => { const s = c / 255; return Math.round(255 * (s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4))); };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}
export const hexLum = (hex) => (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255;
// nâng độ sáng TỐI THIỂU (màu đo trên ảnh gồm bóng râm — W4-A: < 0,55 thành khối đen) giữ sắc độ
export function liftHex(hex, minL = 0.55) {
  const l = hexLum(hex); if (l >= minL || l <= 0) return hex;
  const k = minL / l, c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => Math.min(255, Math.round(v * k)));
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
const WHITE = [255, 255, 255];
const STONE = linRGB(0xd9d2c4), GRANITE = linRGB(0xb8b2aa), DARK = linRGB(0x3a3c40), STEEL = linRGB(0x8c9096), GLASSC = linRGB(0xe6eef2);
const TILE_RED = linRGB(0x9a4a32), TILE_PAGODA = linRGB(0x7c4630), YELLOW_P = linRGB(0xe0b048);
const lighten = (c, t) => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];
function hh(a, b) { let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; }

// ---------- hình học cơ bản (kind 5, ô atlas) ----------
const K_DET = 5;
// quad theo PHÁP TUYẾN mong muốn (tự đảo thứ tự đỉnh) — giống quadN của citygen
function qN(G, p, nx, ny, nz, uv, col, s8, cell, w = 0) {
  const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  if (cx * nx + cy * ny + cz * nz < 0) {
    p = [p[0], p[1], p[2], p[9], p[10], p[11], p[6], p[7], p[8], p[3], p[4], p[5]];
    uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
  }
  G.quad(p, nx, ny, nz, uv, col, s8, K_DET, cell, w);
  return 2;
}
// tam giác (pháp tuyến cho trước, tự đảo chiều)
function triN(G, a, b, c, nx, ny, nz, uv, col, s8, cell) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const flip = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz < 0;
  const i0 = G.v(a[0], a[1], a[2], nx, ny, nz, uv[0], uv[1], col, s8, K_DET, cell, 0);
  G.v(b[0], b[1], b[2], nx, ny, nz, uv[2], uv[3], col, s8, K_DET, cell, 0);
  G.v(c[0], c[1], c[2], nx, ny, nz, uv[4], uv[5], col, s8, K_DET, cell, 0);
  if (flip) G.t(i0, i0 + 2, i0 + 1); else G.t(i0, i0 + 1, i0 + 2);
  return 1;
}
// HỘP theo trục cạnh: tâm (cx,cz), trục dọc e=(ex,ez) nửa dài a, trục ngang n=(nx,nz) nửa sâu c, y yb..yt.
// faces: bit 1 trước(+n) 2 sau(−n) 4 trái(−e) 8 phải(+e) 16 nóc 32 đáy. uv mét/4 (cellF cho mặt trước, cell cho còn lại).
function box(G, cx, cz, ex, ez, nx, nz, a, c, yb, yt, col, s8, cell, faces = 63, cellF = -1, uvF = null) {
  const P = (sa, sc) => [cx + ex * a * sa + nx * c * sc, cz + ez * a * sa + nz * c * sc];
  const [x00, z00] = P(-1, -1), [x10, z10] = P(1, -1), [x11, z11] = P(1, 1), [x01, z01] = P(-1, 1);
  const W = (2 * a) / 4, Dd = (2 * c) / 4, Hh = (yt - yb) / 4; let t = 0;
  if (faces & 1) t += qN(G, [x01, yb, z01, x11, yb, z11, x11, yt, z11, x01, yt, z01], nx, 0, nz, uvF || [0, 0, W, 0, W, Hh, 0, Hh], col, s8, cellF >= 0 ? cellF : cell);
  if (faces & 2) t += qN(G, [x00, yb, z00, x10, yb, z10, x10, yt, z10, x00, yt, z00], -nx, 0, -nz, [0, 0, W, 0, W, Hh, 0, Hh], col, s8, cell);
  if (faces & 4) t += qN(G, [x00, yb, z00, x01, yb, z01, x01, yt, z01, x00, yt, z00], -ex, 0, -ez, [0, 0, Dd, 0, Dd, Hh, 0, Hh], col, s8, cell);
  if (faces & 8) t += qN(G, [x10, yb, z10, x11, yb, z11, x11, yt, z11, x10, yt, z10], ex, 0, ez, [0, 0, Dd, 0, Dd, Hh, 0, Hh], col, s8, cell);
  if (faces & 16) t += qN(G, [x00, yt, z00, x10, yt, z10, x11, yt, z11, x01, yt, z01], 0, 1, 0, [0, 0, W, 0, W, Dd, 0, Dd], col, s8, cell);
  if (faces & 32) t += qN(G, [x00, yb, z00, x10, yb, z10, x11, yb, z11, x01, yb, z01], 0, -1, 0, [0, 0, W, 0, W, Dd, 0, Dd], col, s8, cell);
  return t;
}
// CỘT TRÒN lăng trụ k cạnh (không nắp: nắp nằm dưới dầm/bệ), uv quanh thân 0..1 (ô H_FLUTE 1×4 m)
function column(G, x, z, r, yb, yt, k, col, s8, cell) {
  const base = G.n, vT = (yt - yb) / 4;
  for (let i = 0; i <= k; i++) {
    const a = (i / k) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    G.v(x + c * r, yb, z + s * r, c, 0, s, i / k, 0, col, s8, K_DET, cell, 0);
    G.v(x + c * r, yt, z + s * r, c, 0, s, i / k, vT, col, s8, K_DET, cell, 0);
  }
  for (let i = 0; i < k; i++) { const a = base + i * 2; G.t(a, a + 1, a + 3); G.t(a, a + 3, a + 2); }
  return k * 2;
}
// mái HIÊN DỐC trên 1 cạnh (dải nghiêng từ tường ra ngoài): a→b dọc cạnh, out nhô ra, yIn → yOut
function slopeStrip(G, ax, az, bx, bz, nx, nz, out, yIn, yOut, col, s8, cell, ext = 0) {
  const L = Math.hypot(bx - ax, bz - az), ex = (bx - ax) / L, ez = (bz - az) / L;
  const p0x = ax - ex * ext, p0z = az - ez * ext, p1x = bx + ex * ext, p1z = bz + ez * ext;
  const q0x = p0x + nx * out, q0z = p0z + nz * out, q1x = p1x + nx * out, q1z = p1z + nz * out;
  const sl = Math.hypot(out, yIn - yOut), ny = out / sl, nh = (yIn - yOut) / sl, W = (L + 2 * ext) / 4, Dd = sl / 4;
  qN(G, [p0x, yIn, p0z, p1x, yIn, p1z, q1x, yOut, q1z, q0x, yOut, q0z], nx * nh, ny, nz * nh, [0, Dd, W, Dd, W, 0, 0, 0], col, s8, cell);
  qN(G, [p0x, yIn - 0.04, p0z, p1x, yIn - 0.04, p1z, q1x, yOut - 0.04, q1z, q0x, yOut - 0.04, q0z], -nx * nh, -ny, -nz * nh, [0, Dd, W, Dd, W, 0, 0, 0], col, s8, cell);
  return 4;
}
// MÁI 4 DỐC trên khung chữ nhật (tâm c, trục r dài/p ngắn, nửa dài hl, nửa rộng hw) từ yE (diềm) tới yR (nóc);
// lift > 0: GÓC MÁI CONG VỂNH (đao) — 4 tam giác nhỏ dựng ở mút 4 góc. Trả số tam giác.
function hipRoof(G, cx, cz, rx, rz, px, pz, hl, hw, yE, yR, col, s8, cell, lift = 0) {
  const P = (a, c) => [cx + rx * a + px * c, cz + rz * a + pz * c];
  const inset = Math.min(hl - 0.05, hw * 0.95);
  const c00 = P(-hl, -hw), c10 = P(hl, -hw), c11 = P(hl, hw), c01 = P(-hl, hw), r0 = P(-hl + inset, 0), r1 = P(hl - inset, 0);
  const sec = Math.hypot(hw, yR - yE) / 4;
  const face = (pts, nx, nz) => {
    // pháp tuyến xấp xỉ: ngang theo (nx,nz) nghiêng lên
    const k = (yR - yE) / Math.max(hw, 0.1), l = Math.hypot(k, 1);
    const n = [nx * k / l, 1 / l, nz * k / l];
    if (pts.length === 4) qN(G, [pts[0][0], pts[0][2], pts[0][1], pts[1][0], pts[1][2], pts[1][1], pts[2][0], pts[2][2], pts[2][1], pts[3][0], pts[3][2], pts[3][1]], n[0], n[1], n[2],
      [0, 0, (2 * hl) / 4, 0, (2 * hl) / 4, sec, 0, sec], col, s8, cell);
    else triN(G, [pts[0][0], pts[0][2], pts[0][1]], [pts[1][0], pts[1][2], pts[1][1]], [pts[2][0], pts[2][2], pts[2][1]], n[0], n[1], n[2], [0, 0, (2 * hw) / 4, 0, hw / 4, sec], col, s8, cell);
  };
  face([[c00[0], c00[1], yE], [c10[0], c10[1], yE], [r1[0], r1[1], yR], [r0[0], r0[1], yR]], -px, -pz);
  face([[c11[0], c11[1], yE], [c01[0], c01[1], yE], [r0[0], r0[1], yR], [r1[0], r1[1], yR]], px, pz);
  face([[c10[0], c10[1], yE], [c11[0], c11[1], yE], [r1[0], r1[1], yR]], rx, rz);
  face([[c01[0], c01[1], yE], [c00[0], c00[1], yE], [r0[0], r0[1], yR]], -rx, -rz);
  let t = 6;
  if (lift > 0) {   // ĐAO góc: tam giác đứng dọc đường chéo góc, mũi vểnh lên lift
    for (const [cc, sa, sc] of [[c00, -1, -1], [c10, 1, -1], [c11, 1, 1], [c01, -1, 1]]) {
      const dx = rx * sa + px * sc, dz = rz * sa + pz * sc, dl = Math.hypot(dx, dz), ux = dx / dl, uz = dz / dl;
      const tipx = cc[0] + ux * 0.9, tipz = cc[1] + uz * 0.9, inx = cc[0] - ux * 1.4, inz = cc[1] - uz * 1.4;
      const nx2 = -uz, nz2 = ux;
      triN(G, [inx, yE + 0.25, inz], [cc[0], yE - 0.05, cc[1]], [tipx, yE + lift, tipz], nx2, 0, nz2, [0, 0, 0.3, 0, 0.4, 0.3], col, s8, cell);
      triN(G, [inx, yE + 0.25, inz], [cc[0], yE - 0.05, cc[1]], [tipx, yE + lift, tipz], -nx2, 0, -nz2, [0, 0, 0.3, 0, 0.4, 0.3], col, s8, cell);
      t += 2;
    }
  }
  return t;
}
// đầu hồi TAM GIÁC (trán tường) dựng đứng trên dầm: chân a→b ở yb, đỉnh cao h; nhô ra mặt trước depth (2 mái dốc ngắn)
function pediment(G, ax, az, bx, bz, nx, nz, yb, h, depth, col, colRoof, s8, cell, cellRoof) {
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az);
  const fx = nx * depth, fz = nz * depth;
  let t = triN(G, [ax + fx, yb, az + fz], [bx + fx, yb, bz + fz], [mx + fx, yb + h, mz + fz], nx, 0, nz, [0, 0, L / 4, 0, L / 8, h / 4], col, s8, cell);
  // 2 mái dốc từ trán về tường
  const ex = (bx - ax) / L, ez = (bz - az) / L, s = Math.hypot(L / 2, h), ny = (L / 2) / s, nh = h / s;
  t += qN(G, [ax + fx, yb, az + fz, ax, yb, az, mx, yb + h, mz, mx + fx, yb + h, mz + fz], -ex * nh, ny, -ez * nh, [0, 0, depth / 4, 0, depth / 4, s / 4, 0, s / 4], colRoof, s8, cellRoof);
  t += qN(G, [bx + fx, yb, bz + fz, bx, yb, bz, mx, yb + h, mz, mx + fx, yb + h, mz + fz], ex * nh, ny, ez * nh, [0, 0, depth / 4, 0, depth / 4, s / 4, 0, s / 4], colRoof, s8, cellRoof);
  return t;
}
// biển chữ H_SIGN (dải k: 0 NGÂN HÀNG, 1 KHÁCH SẠN, 2 SIÊU THỊ ĐIỆN MÁY, 3 XĂNG DẦU) — quad đứng trước mặt (a→b, pháp tuyến n)
function signFace(G, ax, az, bx, bz, nx, nz, yb, yt, k, s8, c8) {
  const v0 = k / 4 + 0.004, v1 = (k + 1) / 4 - 0.004;
  return qN(G, [ax, yb, az, bx, yb, bz, bx, yt, bz, ax, yt, az], nx, 0, nz, [0.004, v0, 0.996, v0, 0.996, v1, 0.004, v1], WHITE, s8, MOD.H_SIGN, c8);
}

// ======================================================================================
// buildHero(c): c = { prog, flags, M, DT, X, Z, n, y0, H, fl, fronts:[[ax,az,bx,bz,nx,nz,L,rc]…], wcol (tuyến tính),
//   acc (tuyến tính | null), s8, seed, st (thống kê citygen), gap(x,z,nx,nz) → mét tới mép sau vỉa hè (Infinity nếu không có
//   đường phía trước ≤ 40 m), free(x,z) → true nếu không có nhà KHÁC ở đó, obb:{ux,uz,vx,vz,u0,u1,v0,v1}, rs, hotelCanopy }
// Trả { tris, detTris, skipRoof, skipRoofClutter }.
// ======================================================================================
export function buildHero(c) {
  const { prog, M, DT, s8, st } = c;
  const out = { tris: 0, detTris: 0 };
  if (!prog) return out;
  let fr = c.fronts.slice().sort((p, q) => q[6] - p[6]);   // cạnh mặt phố dài nhất trước
  // ĐIỂM TIÊU (ảnh thấy đoạn nào của nhà): cạnh gần điểm tiêu nhất lên đầu + vị trí sảnh dọc cạnh (c.at)
  c.at = null;
  const minL = { [HP.COLONNADE]: 10, [HP.HOTEL]: 8, [HP.SCHOOL]: 8, [HP.PAGODA]: 8, [HP.OFFICE]: 6, [HP.BANK]: 5 }[prog] || 3;
  if (c.focus) {
    const [fx, fz] = c.focus; let bd = 1e9, bi = 0, bs = 0;
    fr.forEach((E, i) => {
      const L = E[6], ex = (E[2] - E[0]) / L, ez = (E[3] - E[1]) / L;
      let t = (fx - E[0]) * ex + (fz - E[1]) * ez; t = Math.max(0, Math.min(L, t));
      const d = Math.hypot(E[0] + ex * t - fx, E[1] + ez * t - fz) - Math.min(L, 30) * 0.15 + (L < minL ? 10 : 0);   // ưu tiên cạnh đủ dài cho sảnh/hàng cột/cổng
      if (d < bd) { bd = d; bi = i; bs = t; }
    });
    if (bd < 25) { fr = [fr[bi], ...fr.filter((_, i) => i !== bi)]; c.at = bs; }
  }
  // ĐOẠN mặt tiền của chương trình: khối gộp dài (ngân hàng trong dãy 60 m) → chỉ đoạn W quanh điểm tiêu
  const sub = (E, W) => {
    if (!E || E[6] <= W) return E;
    const L = E[6];
    const ctr = c.at != null && E === fr[0] ? c.at : L / 2, s0 = Math.max(0, Math.min(L - W, ctr - W / 2));
    const [ax, az] = edgeP(E, s0), [bx, bz] = edgeP(E, s0 + W);
    return [ax, az, bx, bz, E[4], E[5], W, E[7]];
  };
  const SUBW = { [HP.OFFICE]: 30, [HP.BANK]: 22, [HP.HOTEL]: 30, [HP.STORE]: 16, [HP.COLONNADE]: 32, [HP.PETROL]: 14 };
  if (SUBW[prog] && fr.length) fr = [sub(fr[0], SUBW[prog]), ...fr.slice(1).filter((E) => E[6] <= SUBW[prog] * 1.2)];
  if (prog === HP.SCHOOL || prog === HP.PAGODA) c.gateAt = c.at;
  const F0 = fr[0];
  const y0 = c.y0, H = c.H, top = y0 + H;
  const add = (G, t) => { if (G === M) out.tris += t; else out.detTris += t; };
  switch (prog) {
    case HP.OFFICE: heroOffice(c, fr, add); break;
    case HP.BANK: heroBank(c, fr, add); break;
    case HP.HOTEL: heroHotel(c, fr, add); break;
    case HP.STORE: heroStore(c, fr, add); break;
    case HP.COLONNADE: heroColonnade(c, fr, add); break;
    case HP.SCHOOL: heroCivic(c, fr, add); break;
    case HP.MARKET: heroMarket(c, fr, add); break;
    case HP.PAGODA: heroPagoda(c, fr, add); break;
    case HP.PETROL: heroPetrol(c, fr, add); break;
  }
  st.hero = (st.hero || 0) + 1;
  st['hero_' + prog] = (st['hero_' + prog] || 0) + 1;
  void F0; void top;
  return out;
}
// SỔ BIỂN CHỮ herokit (c.signs: mảng [x, z, khoá] dùng chung cả lượt dựng, citygen tạo) — chữ chung theo ngành
// không lặp trong bán kính r (phản biện W5-A: 'THỜI TRANG NỮ' cùng số ĐT trên ≥ 3 nhà một khung hình 166/161/377)
function signNear(c, x, z, key, r) { const L = c.signs; if (!L) return false; for (const q of L) if (q[2] === key && (q[0] - x) ** 2 + (q[1] - z) ** 2 < r * r) return true; return false; }
function signReg(c, x, z, key) { if (c.signs) c.signs.push([x, z, key]); }
// điểm trong đa giác footprint (X,Z,n)
function inPoly(X, Z, n, x, z) {
  let ins = false;
  for (let i = 0, j = n - 1; i < n; j = i++) if ((Z[i] > z) !== (Z[j] > z) && x < ((X[j] - X[i]) * (z - Z[i])) / (Z[j] - Z[i]) + X[i]) ins = !ins;
  return ins;
}
// tiện ích cạnh: điểm dọc cạnh + khoảng lùi
const edgeP = (E, s) => { const L = E[6]; return [E[0] + ((E[2] - E[0]) / L) * s, E[1] + ((E[3] - E[1]) / L) * s]; };
function gapOf(c, E) {   // khoảng lùi tới mép sau vỉa hè: min của 3 điểm dọc cạnh
  let g = Infinity;
  for (const t of [0.25, 0.5, 0.75]) { const [x, z] = edgeP(E, E[6] * t); g = Math.min(g, c.gap(x, z, E[4], E[5])); }
  return g;
}

// ---------- VĂN PHÒNG KÍNH: đố đứng 3D, gờ spandrel, chân đá, mái che sảnh kính + bậc ----------
function heroOffice(c, fr, add) {
  const { M, DT, s8, y0, H, fl } = c;
  const frame = lighten(c.wcol, 0.45);
  fr.slice(0, 3).forEach((E, idx) => {
    const [ax, az, bx, bz, nx, nz, L] = E; if (L < 4) return;
    const ex = (bx - ax) / L, ez = (bz - az) / L;
    // chân đá granit (ô chính) 0..0,55 m nhô 0,08
    add(M, box(M, (ax + bx) / 2 + nx * 0.04, (az + bz) / 2 + nz * 0.04, ex, ez, nx, nz, L / 2, 0.06, y0 - 0.2, y0 + 0.55, GRANITE, s8, MOD.D_PLAIN, 1 | 16));
    if (DT && fl >= 2) {
      // đố đứng: mỗi ~1,4 m từ trên trệt tới đỉnh tường (nhôm sáng), 3 mặt
      const nF = Math.max(2, Math.round(L / 1.4)), sp = L / nF, yb = y0 + GROUND_H, yt = y0 + H + 0.2;
      for (let k = 0; k <= nF; k++) {
        const s = Math.min(L - 0.08, Math.max(0.08, k * sp)), [px, pz] = edgeP(E, s);
        add(DT, box(DT, px + nx * 0.16, pz + nz * 0.16, ex, ez, nx, nz, 0.06, 0.16, yb, yt, frame, s8, MOD.D_PLAIN, 1 | 4 | 8));
      }
      // gờ spandrel mỗi sàn (nhô 0,22, cao 0,32)
      for (let k = 1; k < fl; k++) {
        const y = y0 + heightOf(k);
        add(DT, box(DT, (ax + bx) / 2 + nx * 0.11, (az + bz) / 2 + nz * 0.11, ex, ez, nx, nz, L / 2, 0.11, y - 0.2, y + 0.12, frame, s8, MOD.D_PLAIN, 1 | 16 | 32));
      }
    }
    if (idx === 0) {
      // mái che sảnh kính giữa cạnh dài nhất: sâu ≤ 2,8 m (≤ khoảng lùi + 1,5: được đua qua vỉa hè như thật), rộng ≤ 9 m
      const g = gapOf(c, E), D = Math.max(1.2, Math.min(2.8, g + 1.5)), W = Math.min(9, L * 0.5), sm = L / 2;
      const [mx, mz] = edgeP(E, sm), yC = y0 + 3.55;
      add(M, box(M, mx + nx * D / 2, mz + nz * D / 2, ex, ez, nx, nz, W / 2, D / 2, yC, yC + 0.28, STEEL, s8, MOD.D_SIGNF, 1 | 4 | 8 | 32));
      add(M, qN(M, [mx - ex * W / 2, yC + 0.29, mz - ez * W / 2, mx + ex * W / 2, yC + 0.29, mz + ez * W / 2, mx + ex * W / 2 + nx * D, yC + 0.29, mz + ez * W / 2 + nz * D, mx - ex * W / 2 + nx * D, yC + 0.29, mz - ez * W / 2 + nz * D], 0, 1, 0, [0, 0, W / 4, 0, W / 4, D / 4, 0, D / 4], GLASSC, s8, MOD.U_CURT2));
      // bậc tam cấp (cờ ảnh hoặc 50%) nếu có chỗ lùi ≥ 1,2 m
      if (g >= 1.2 && ((c.flags & HF.STAIRS) || hh(c.seed, 701) < 0.5)) {
        for (let k = 0; k < 3; k++) add(M, box(M, mx + nx * (0.2 + (2 - k) * 0.33), mz + nz * (0.2 + (2 - k) * 0.33), ex, ez, nx, nz, W / 2 - 0.4 - k * 0.15, 0.2 + (2 - k) * 0.33, y0 - 0.1, y0 + 0.16 * (k + 1), GRANITE, s8, MOD.D_PLAIN, 1 | 4 | 8 | 16));
      }
    }
  });
}

// ---------- NGÂN HÀNG: dải biển LIỀN màu thật (chữ NGÂN HÀNG), 2 cột đá 2 tầng + dầm, mái che màu nhấn, bậc ----------
function heroBank(c, fr, add) {
  const { M, DT, s8, y0, H, fl } = c;
  const E = fr[0]; if (!E) return;
  const [ax, az, bx, bz, nx, nz, L] = E; if (L < 3) return;
  const ex = (bx - ax) / L, ez = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // dải biển 3D nhô 0,35 m ngay trên trệt — MỘT dải liền cả mặt (161 "một băng xanh liên tục", 354 tím)
  const yb = y0 + GROUND_H - 0.15, yt = yb + (fl >= 3 ? 1.25 : 1.0), P = 0.35;
  add(M, box(M, mx + nx * P / 2, mz + nz * P / 2, ex, ez, nx, nz, L / 2 - 0.05, P / 2, yb, yt, DARK, s8, MOD.D_SIGNF, 4 | 8 | 16 | 32));
  // mặt trước: chữ NGÂN HÀNG MỘT LẦN (tấm ≤ 8 m quanh điểm tiêu ảnh), phần còn lại = diềm TRƠN màu nhấn thật. Phản biện W5-A
  // pano_354 h180: 'NGÂN HÀNG' lặp 3 lần dọc dải (mỗi 8 m + mỗi nhà của dãy 3 lô ngân hàng liền kề) — giờ ≤ 1 chữ / 30 m
  let sc = L / 2;
  if (c.focus) { const [fx, fz] = c.focus; sc = Math.max(0, Math.min(L, (fx - ax) * ex + (fz - az) * ez)); }
  const sW = Math.min(8, L - 0.1), s0 = Math.max(0.05, Math.min(L - 0.05 - sW, sc - sW / 2)), [scx, scz] = edgeP(E, s0 + sW / 2);
  const lettered = (c.hi == null || bankLead(c.hi)) && !signNear(c, scx, scz, 'bank', 12);
  const plain = (a, b) => {
    if (b - a < 0.05) return;
    const [p0x, p0z] = edgeP(E, a), [p1x, p1z] = edgeP(E, b), W = (b - a) / 4, Hh = (yt - yb) / 4;
    add(M, qN(M, [p0x + nx * P, yb, p0z + nz * P, p1x + nx * P, yb, p1z + nz * P, p1x + nx * P, yt, p1z + nz * P, p0x + nx * P, yt, p0z + nz * P], nx, 0, nz, [0, 0, W, 0, W, Hh, 0, Hh], c.acc || DARK, s8, MOD.D_PLAIN));
  };
  if (lettered) {
    signReg(c, scx, scz, 'bank');
    const [p0x, p0z] = edgeP(E, s0), [p1x, p1z] = edgeP(E, s0 + sW);
    add(M, signFace(M, p0x + nx * P, p0z + nz * P, p1x + nx * P, p1z + nz * P, nx, nz, yb, yt, 0, s8, 30));
    plain(0.02, s0); plain(s0 + sW, L - 0.02);
  } else plain(0.02, L - 0.02);
  // 2 cột đá vuông sảnh (cao 2 tầng) + dầm đỡ — chỉ khi đủ chỗ lùi; không thì trụ áp tường
  if (L >= 6 && fl >= 2) {
    const g = gapOf(c, E), out = g >= 2.2 ? 1.6 : 0.35, yc = y0 + Math.min(H - 0.3, GROUND_H + FLOOR_H) + 0.1;
    const half = Math.min(3.2, L * 0.3);
    for (const sg of [-1, 1]) {
      const cx = mx + ex * half * sg + nx * out, cz = mz + ez * half * sg + nz * out;
      add(M, box(M, cx, cz, ex, ez, nx, nz, 0.36, 0.36, y0 - 0.1, yc, STONE, s8, MOD.H_FLUTE, 1 | 4 | 8 | 2));
    }
    if (out > 1) add(M, box(M, mx + nx * out / 2 + nx * 0.2, mz + nz * out / 2 + nz * 0.2, ex, ez, nx, nz, half + 0.45, out / 2 + 0.25, yc, yc + 0.6, STONE, s8, MOD.D_PLAIN, 63 ^ 2));
  }
  // mái che màu nhấn trên cửa (ảnh "mái che xanh")
  if (c.flags & HF.CANOPY) {
    const W = Math.min(7, L * 0.5), D = 1.6, yC = y0 + 3.3;
    add(M, box(M, mx + nx * D / 2, mz + nz * D / 2, ex, ez, nx, nz, W / 2, D / 2, yC, yC + 0.25, c.acc || DARK, s8, MOD.D_PLAIN, 63));
  }
  if (DT && gapOf(c, E) >= 1) for (let k = 0; k < 2; k++) add(DT, box(DT, mx + nx * (0.2 + (1 - k) * 0.35), mz + nz * (0.2 + (1 - k) * 0.35), ex, ez, nx, nz, 2.2 - k * 0.2, 0.2 + (1 - k) * 0.35, y0 - 0.1, y0 + 0.15 * (k + 1), GRANITE, s8, MOD.D_PLAIN, 1 | 4 | 8 | 16));
}

// ---------- KHÁCH SẠN: mái sảnh porte-cochère + trụ, gờ khối đế (2 tầng), biển chữ trên mái ----------
function heroHotel(c, fr, add) {
  const { M, DT, s8, y0, H, fl } = c;
  const E = fr[0]; if (!E) return;
  const [ax, az, bx, bz, nx, nz, L] = E;
  const ex = (bx - ax) / L, ez = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const light = lighten(c.wcol, 0.3);
  // SỬA HỒI QUY W5: khách sạn MINI (nhà ống < 250 m², citygen hlx) — mặt tiền giữ nhà ống theo vân tay; chỉ BIỂN DỌC
  if (c.mini) { if (fl >= 2 && L >= 2.5) hotelBlade(c, E, ex, ez, nx, nz, L, add, true); return; }
  // gờ khối đế (đọc ra "podium + tháp"): mọi mặt phố, ở đỉnh tầng 2, nhô 0,6
  if (fl >= 5) for (const F of fr.slice(0, 3)) {
    const [fax, faz, fbx, fbz, fnx, fnz, fL] = F; if (fL < 4) continue;
    const fex = (fbx - fax) / fL, fez = (fbz - faz) / fL, y = y0 + heightOf(2);
    add(M, box(M, (fax + fbx) / 2 + fnx * 0.3, (faz + fbz) / 2 + fnz * 0.3, fex, fez, fnx, fnz, fL / 2, 0.3, y - 0.45, y + 0.15, light, s8, MOD.D_CORN, 1 | 16 | 32 | 4 | 8));
  }
  // mái sảnh xe (porte-cochère): W4-C hotelCanopy đã dựng cho RS.HOTEL (fL ≥ 10, ≥ 4 T) — ở đây chỉ thêm TRỤ dưới mép ngoài;
  // nhà khách sạn kiểu khác (tân cổ điển 042/354) thì dựng mái sảnh + 4 cột tròn
  const g = gapOf(c, E);
  if (L >= 8) {
    const D = Math.max(2, Math.min(5.5, g + 2)), W = Math.min(c.hotelCanopy ? 20 : 12, L * 0.55), yC = y0 + 4.4;
    if (!c.hotelCanopy) {
      add(M, box(M, mx + nx * D / 2, mz + nz * D / 2, ex, ez, nx, nz, W / 2, D / 2, yC, yC + 0.4, light, s8, MOD.D_CORN, 1 | 4 | 8 | 16));
      add(M, qN(M, [mx - ex * W / 2, yC, mz - ez * W / 2, mx + ex * W / 2, yC, mz + ez * W / 2, mx + ex * W / 2 + nx * D, yC, mz + ez * W / 2 + nz * D, mx - ex * W / 2 + nx * D, yC, mz - ez * W / 2 + nz * D], 0, -1, 0, [0, 0, W / 4, 0, W / 4, D / 4, 0, D / 4], [232, 232, 228], s8, MOD.D_PLAIN));
    }
    if (g >= 3.5 && !c.hotelCanopy) {   // W5-fix: mái sảnh W4-C (hotelCanopy) giữ CÔNG-XON như dot3 — khoảng lùi đo theo xsection không thấy quảng trường lát (230 h180 trụ giữa hè, cả khi kẹp g − 0,4). Trụ chỉ khi mép mái che vẫn trên phần sân trước (không cắm giữa vỉa hè)
      // SỬA HỒI QUY W5 (230 h180: trụ vuông giữa vỉa hè tiền cảnh): mái sâu D = g + 2 ⇒ trụ ở D − 0,5 = g + 1,5 m — LẤN 1,5 m
      // vào vỉa hè. Trụ đặt tối đa g − 0,4 (trên sân trước), mái che đua phần còn lại qua vỉa hè như thật.
      const Dp = Math.min(c.hotelCanopy ? Math.min(5.5, D) : D, g + 0.1);
      for (const sg of [-1, 1]) {
        const cx = mx + ex * (W / 2 - 0.6) * sg + nx * (Dp - 0.5), cz = mz + ez * (W / 2 - 0.6) * sg + nz * (Dp - 0.5);
        add(M, column(M, cx, cz, 0.28, y0 - 0.1, y0 + 4.4, 8, STONE, s8, MOD.H_FLUTE));
      }
    }
  }
  // khách sạn MINI (ống, < 4 tầng hoặc mặt hẹp): BIỂN DỌC "KHÁCH SẠN" (ô BLADE0 dải 0) vuông góc mặt tiền, tầng 1-3
  if ((fl < 4 || L < 6) && fl >= 2 && L >= 2.5 && L <= 12) hotelBlade(c, E, ex, ez, nx, nz, L, add, false);
  // biển chữ KHÁCH SẠN trên đỉnh mặt phố (tấm đứng 1,4 m trên lan can mái) — tháp ≥ 6 tầng
  if (fl >= 6 && L >= 6) {
    const W = Math.min(10, L * 0.6), [p0x, p0z] = edgeP(E, (L - W) / 2), [p1x, p1z] = edgeP(E, (L + W) / 2), yb = y0 + H + 1.0, yt = yb + 1.4;
    add(M, signFace(M, p0x - nx * 0.6, p0z - nz * 0.6, p1x - nx * 0.6, p1z - nz * 0.6, nx, nz, yb, yt, 1, s8, 150));
    add(M, box(M, (p0x + p1x) / 2 - nx * 0.7, (p0z + p1z) / 2 - nz * 0.7, ex, ez, nx, nz, W / 2, 0.08, yb, yt, DARK, s8, MOD.D_SIGNF, 2 | 4 | 8 | 16));
    for (const t of [0.2, 0.8]) { const [qx, qz] = edgeP(E, (L - W) / 2 + W * t); add(M, box(M, qx - nx * 0.7, qz - nz * 0.7, ex, ez, nx, nz, 0.06, 0.06, y0 + H, yb, DARK, s8, MOD.D_SIGNF, 1 | 4 | 8)); }
  }
  void DT;
}
// biển DỌC 'KHÁCH SẠN' (ô BLADE0 dải 0) vuông góc mặt tiền, tầng 1-3; dedup = khách sạn mini liền kề (313: 3 lô cùng quan sát) chỉ 1 biển / 20 m
function hotelBlade(c, E, ex, ez, nx, nz, L, add, dedup) {
  const { M, s8, y0, H, fl } = c;
  {
    if (dedup) { const [qx, qz] = edgeP(E, Math.min(L - 0.3, 0.6)); if (signNear(c, qx, qz, 'hotelblade', 20)) return; signReg(c, qx, qz, 'hotelblade'); }
    const sx = Math.min(L - 0.3, 0.6), [bx0, bz0] = edgeP(E, sx), yb = y0 + GROUND_H + 0.3, ytB = Math.min(y0 + H - 0.2, yb + Math.min(4.2, (fl - 1) * FLOOR_H));
    if (ytB - yb > 1.5) {
      const D0 = 0.12, D1 = 0.12 + Math.min(1.1, (ytB - yb) / 3.4), P = (o2, t2) => [bx0 + ex * t2 + nx * o2, bz0 + ez * t2 + nz * o2];
      const [ia, iz] = P(D0, 0.06), [oa, oz] = P(D1, 0.06), [jb, jz] = P(D0, -0.06), [ob, obz] = P(D1, -0.06);
      add(M, qN(M, [oa, yb, oz, ia, yb, iz, ia, ytB, iz, oa, ytB, oz], ex, 0, ez, [0, 0, 0.248, 0, 0.248, 1, 0, 1], WHITE, s8, MOD.BLADE0, 30));
      add(M, qN(M, [jb, yb, jz, ob, yb, obz, ob, ytB, obz, jb, ytB, jz], -ex, 0, -ez, [0, 0, 0.248, 0, 0.248, 1, 0, 1], WHITE, s8, MOD.BLADE0, 30));
      add(M, qN(M, [ob, yb, obz, oa, yb, oz, oa, ytB, oz, ob, ytB, obz], nx, 0, nz, [0, 0, 0.05, 0, 0.05, 1, 0, 1], DARK, s8, MOD.D_SIGNF));
    }
  }
}

// ---------- SIÊU THỊ / SHOWROOM / CỬA HÀNG THỜI TRANG: tấm ỐP biển lớn phủ tầng trên + dải chữ, trệt kính (bộ FG) ----------
function heroStore(c, fr, add) {
  const { M, s8, y0, H, fl } = c;
  const E = fr[0]; if (!E || fl < 2) return;
  const [ax, az, bx, bz, nx, nz, L] = E; if (L < 3) return;
  const ex = (bx - ax) / L, ez = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
  // màu ốp: màu TƯỜNG quan sát (siêu thị 414 vàng; showroom xám; thời trang đen) — không nâng sáng (ốp đen là thật).
  // Phản biện W5-A (166: cả nhà thành khối đen): ốp CHỈ dải tầng 1 trên trệt kính (ảnh: diềm tối trên showroom kính), không phủ 3 tầng
  const clad = c.cladCol || c.wcol, P = 0.32;
  // ốp TỐI (< 0,25) = chỉ DIỀM biển 1,9 m trên trệt kính (166 r1 sửa: cả tầng 1 đen vẫn đọc ra khối đen)
  const yb = y0 + GROUND_H + 0.05, yt = y0 + Math.min(H + 0.6, GROUND_H + (c.cladDark ? 1.95 : FLOOR_H + 0.4));
  if (yt - yb < 1.2) return;
  const W = Math.min(L - 0.3, 24);
  // SỬA HỒI QUY W5 (088 h0 / 166 h90-h180): ốp TỐI không chữ = "tấm đen trống" (đọc ra thiếu texture) → ốp tối CHỈ làm nền cho
  // chữ ngành; chữ ngành chỉ trên nhà ≥ 3 tầng (166 h0: nhà 2 tầng → tấm chữ nằm trên mép mái = "biển quảng cáo trên nóc")
  const kind0 = c.flags & HF.ELEC ? 1 : c.flags & HF.FASHION ? 2 : c.flags & HF.PHONE ? 3 : 0;
  const lettered = kind0 && fl >= 3 && !signNear(c, mx, mz, 'store' + kind0, 40);
  if (!lettered && c.cladDark) return;
  add(M, box(M, mx + nx * P / 2, mz + nz * P / 2, ex, ez, nx, nz, W / 2, P / 2, yb, yt, clad, s8, MOD.D_PLAIN, 63 ^ 2));
  // dải chữ lớn (nền = màu biển THẬT qua aFp khi có — chế độ 2) — chữ CHUNG theo NGÀNH ảnh tả: điện máy → H_SIGN 'SIÊU THỊ ĐIỆN
  // MÁY'; thời trang → PANEL 'THỜI TRANG NỮ / HÀNG MỚI VỀ'; điện thoại → PANEL 'ĐIỆN THOẠI - LAPTOP'; còn lại (showroom ô tô,
  // nội thất…) chỉ tấm ốp trơn (r3: 'SIÊU THỊ ĐIỆN MÁY' trên shop thời trang 377/161 là sai). PANEL CẮT bỏ dòng số điện thoại
  // (v từ 0,54 m của dải 2 m) và mỗi loại chữ ≤ 1 lần / 40 m (phản biện: cùng tấm cùng số ĐT lặp trên 3 nhà liền)
  const kind = kind0;
  if (lettered) {
    signReg(c, mx, mz, 'store' + kind);
    const sH = Math.min(kind === 1 ? 1.6 : 1.9, (yt - yb) * (kind === 1 ? 0.45 : 0.62)), sW = Math.min(W - 0.6, kind === 1 ? 12 : sH * 2.77), [p0x, p0z] = edgeP(E, (L - sW) / 2), [p1x, p1z] = edgeP(E, (L + sW) / 2);
    const q0x = p0x + nx * (P + 0.02), q0z = p0z + nz * (P + 0.02), q1x = p1x + nx * (P + 0.02), q1z = p1z + nz * (P + 0.02), y1 = yb + Math.max(0.15, (yt - yb - sH) / 2);
    if (kind === 1) add(M, signFace(M, q0x, q0z, q1x, q1z, nx, nz, y1, y1 + sH, 2, s8, 80));
    else {
      const pi = kind === 2 ? 3 : 0, v0 = (pi & 1) * 0.5 + 0.135, v1 = (pi & 1) * 0.5 + 0.496;   // PANEL_W[3] / PANEL_W[0] (facade_atlas.js), bỏ dòng ĐT
      add(M, qN(M, [q0x, y1, q0z, q1x, y1, q1z, q1x, y1 + sH, q1z, q0x, y1 + sH, q0z], nx, 0, nz, [0.004, v0, 0.996, v0, 0.996, v1, 0.004, v1], WHITE, s8, MOD.PANEL0 + (pi >> 1), 120));
    }
  }
}

// ---------- HÀNG CỘT TÂN CỔ ĐIỂN: cột tròn khổ lớn 2-3 tầng, bệ, dầm, trán tam giác ----------
function heroColonnade(c, fr, add) {
  const { M, s8, y0, H, fl } = c;
  const E = fr[0]; if (!E) return;
  const [ax, az, bx, bz, nx, nz, L] = E; if (L < 7 || fl < 2) return;
  const ex = (bx - ax) / L, ez = (bz - az) / L;
  const white = lighten(c.wcol, 0.55), g = gapOf(c, E);
  const out = g >= 3 ? 2.0 : g >= 1.4 ? g - 0.4 : 0.55;   // không đủ chỗ → nửa cột áp tường
  const Wc = Math.min(L - 1, 30), s0 = (L - Wc) / 2, nC = Math.max(4, Math.min(10, Math.round(Wc / 3.4) + 1)), sp = Wc / (nC - 1);
  const yTop = y0 + Math.min(H - 0.2, GROUND_H + FLOOR_H * (fl >= 4 ? 2 : 1)), r = out > 1 ? 0.42 : 0.3;
  // bệ (bậc) dưới hàng cột
  const [cm0x, cm0z] = edgeP(E, s0 + Wc / 2);
  add(M, box(M, cm0x + nx * (out + 0.6) / 2, cm0z + nz * (out + 0.6) / 2, ex, ez, nx, nz, Wc / 2 + 0.6, (out + 0.6) / 2, y0 - 0.2, y0 + 0.45, STONE, s8, MOD.D_PLAIN, 1 | 4 | 8 | 16));
  for (let k = 0; k < nC; k++) {
    const [px, pz] = edgeP(E, s0 + k * sp), cx = px + nx * out, cz = pz + nz * out;
    add(M, column(M, cx, cz, r, y0 + 0.45, yTop - 0.35, 10, white, s8, MOD.H_FLUTE));
    add(M, box(M, cx, cz, ex, ez, nx, nz, r + 0.16, r + 0.16, yTop - 0.35, yTop, white, s8, MOD.D_CORN, 1 | 2 | 4 | 8));   // đầu cột
    add(M, box(M, cx, cz, ex, ez, nx, nz, r + 0.12, r + 0.12, y0 + 0.45, y0 + 0.75, white, s8, MOD.D_PLAIN, 1 | 4 | 8 | 16));   // chân cột
  }
  // dầm (entablature) phủ từ tường ra ngoài hàng cột
  const dD = out + 0.55;
  add(M, box(M, cm0x + nx * dD / 2, cm0z + nz * dD / 2, ex, ez, nx, nz, Wc / 2 + 0.4, dD / 2, yTop, yTop + 0.95, white, s8, MOD.D_CORN, 1 | 4 | 8 | 16 | 32));
  // trán tam giác giữa (nhà ≤ 5 tầng, dầm dưới đỉnh tường đủ cao)
  if (fl <= 5 && out > 1) {
    const Wp = Math.min(Wc * 0.55, 14), [p0x, p0z] = edgeP(E, s0 + Wc / 2 - Wp / 2), [p1x, p1z] = edgeP(E, s0 + Wc / 2 + Wp / 2);
    add(M, pediment(M, p0x, p0z, p1x, p1z, nx, nz, yTop + 0.95, Math.min(2.6, Wp * 0.2), dD, white, TILE_RED, s8, MOD.D_PLAIN, MOD.R_TILE));
  }
}

// ---------- TRƯỜNG / CÔNG SỞ thuộc địa: RÀO + CỔNG (trụ cổng, mái ngói cổng), cột cờ ----------
function heroCivic(c, fr, add) {
  const { M, DT, s8, y0 } = c;
  const E = fr[0]; if (!E) return;
  if (!(c.flags & HF.FENCE) && hh(c.seed, 711) > 0.6) return;
  fenceAndGate(c, E, add, { gateRoof: !!(c.flags & HF.TILE), pillar: lighten(c.wcol, 0.2), flag: hh(c.seed, 713) < 0.5 });
  void M; void DT; void s8; void y0;
}
function fenceAndGate(c, E, add, o) {
  const { M, DT, s8, y0 } = c;
  const [ax, az, bx, bz, nx, nz, L] = E;
  const g = gapOf(c, E); if (!(g >= 2.5 && g <= 30)) return false;
  const off = g - 0.35, ex = (bx - ax) / L, ez = (bz - az) / L;
  const s0 = -1.5, s1 = L + 1.5, gateW = 4.2, gc = Math.max(gateW / 2 + 1, Math.min(L - gateW / 2 - 1, c.gateAt != null ? c.gateAt : L / 2));
  const P = (s) => [ax + ex * s + nx * off, az + ez * s + nz * off];
  // đoạn rào: tách quanh cổng; bỏ đoạn có nhà khác (kiểm 0,5 m một)
  const segs = [[s0, gc - gateW / 2], [gc + gateW / 2, s1]];
  for (const [a, b] of segs) {
    let ss = a;
    const flush = (e) => {
      if (e - ss < 1.2) { ss = e; return; }
      const [p0x, p0z] = P(ss), [p1x, p1z] = P(e), mx = (p0x + p1x) / 2, mz = (p0z + p1z) / 2, hl = (e - ss) / 2;
      add(M, box(M, mx, mz, ex, ez, nx, nz, hl, 0.12, y0 - 0.1, y0 + 0.55, o.pillar, s8, MOD.D_PLAIN, 1 | 2 | 16));   // chân tường rào
      const nP = Math.max(1, Math.round((e - ss) / 3));
      for (let k = 0; k <= nP; k++) { const [qx, qz] = P(ss + ((e - ss) * k) / nP); add(M, box(M, qx, qz, ex, ez, nx, nz, 0.2, 0.2, y0 - 0.1, y0 + 1.9, o.pillar, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16)); }
      if (DT) {   // song sắt sơn tối: thanh ngang + song đứng 0,3 m (1 mặt nhìn ra phố — sau lưng là sân, không ai nhìn)
        add(DT, box(DT, mx, mz, ex, ez, nx, nz, hl, 0.03, y0 + 1.62, y0 + 1.7, DARK, s8, MOD.D_SIGNF, 1 | 2 | 16));
        const nB = Math.floor((e - ss) / 0.3);
        for (let k = 1; k < nB; k++) {
          const [qx, qz] = P(ss + k * 0.3);
          add(DT, qN(DT, [qx - ex * 0.02 + nx * 0.03, y0 + 0.55, qz - ez * 0.02 + nz * 0.03, qx + ex * 0.02 + nx * 0.03, y0 + 0.55, qz + ez * 0.02 + nz * 0.03, qx + ex * 0.02 + nx * 0.03, y0 + 1.66, qz + ez * 0.02 + nz * 0.03, qx - ex * 0.02 + nx * 0.03, y0 + 1.66, qz - ez * 0.02 + nz * 0.03], nx, 0, nz, [0, 0, 0.05, 0, 0.05, 0.28, 0, 0.28], DARK, s8, MOD.D_SIGNF));
          add(DT, qN(DT, [qx + ex * 0.02 - nx * 0.01, y0 + 0.55, qz + ez * 0.02 - nz * 0.01, qx - ex * 0.02 - nx * 0.01, y0 + 0.55, qz - ez * 0.02 - nz * 0.01, qx - ex * 0.02 - nx * 0.01, y0 + 1.66, qz - ez * 0.02 - nz * 0.01, qx + ex * 0.02 - nx * 0.01, y0 + 1.66, qz + ez * 0.02 - nz * 0.01], -nx, 0, -nz, [0, 0, 0.05, 0, 0.05, 0.28, 0, 0.28], DARK, s8, MOD.D_SIGNF));
        }
      }
      ss = e;
    };
    // dò chướng ngại: điểm rào nằm trong nhà khác → cắt
    let s = a;
    for (; s <= b; s += 0.5) { const [qx, qz] = P(s); if (!c.free(qx, qz)) { flush(s - 0.25); ss = s + 0.5; } }
    flush(b);
  }
  // CỔNG: 2 trụ lớn + (mái ngói cổng | dầm), cánh cổng sắt khép hờ (tấm tối)
  const [gx, gz] = P(gc);
  for (const sg of [-1, 1]) add(M, box(M, gx + ex * (gateW / 2 + 0.3) * sg, gz + ez * (gateW / 2 + 0.3) * sg, ex, ez, nx, nz, 0.4, 0.4, y0 - 0.1, y0 + 2.9, o.pillar, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
  if (o.gateRoof) add(M, hipRoof(M, gx, gz, ex, ez, nx, nz, gateW / 2 + 1.1, 1.1, y0 + 2.95, y0 + 4.0, TILE_RED, s8, MOD.R_TILE, 0.25));
  else add(M, box(M, gx, gz, ex, ez, nx, nz, gateW / 2 + 0.7, 0.35, y0 + 2.9, y0 + 3.4, o.pillar, s8, MOD.D_CORN, 1 | 2 | 4 | 8 | 16 | 32));
  if (DT) for (const sg of [-1, 1]) add(DT, box(DT, gx + ex * (gateW / 4) * sg, gz + ez * (gateW / 4) * sg + 0, ex, ez, nx, nz, gateW / 4 - 0.05, 0.03, y0 + 0.05, y0 + 1.9, DARK, s8, MOD.D_RAIL, 1 | 2));
  // cột cờ cạnh cổng (công sở)
  if (o.flag) {
    const [fx, fz] = P(gc + gateW / 2 + 2.2);
    if (c.free(fx, fz)) {
      add(M, column(M, fx, fz, 0.06, y0, y0 + 11, 5, STEEL, s8, MOD.D_PLAIN));
      add(M, qN(M, [fx, y0 + 9.4, fz, fx + ex * 2.2, y0 + 9.4, fz + ez * 2.2, fx + ex * 2.2, y0 + 10.9, fz + ez * 2.2, fx, y0 + 10.9, fz], nx, 0, nz, [0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1], linRGB(0xc8141c), s8, MOD.D_PLAIN));
      add(M, qN(M, [fx, y0 + 9.4, fz, fx + ex * 2.2, y0 + 9.4, fz + ez * 2.2, fx + ex * 2.2, y0 + 10.9, fz + ez * 2.2, fx, y0 + 10.9, fz], -nx, 0, -nz, [0, 0, 0.1, 0, 0.1, 0.1, 0, 0.1], linRGB(0xc8141c), s8, MOD.D_PLAIN));
    }
  }
  return true;
}

// ---------- NHÀ CHỢ: mái tôn (citygen GABLE_TON), mái hiên tôn LIỀN cả mặt, dải bảng quảng cáo trên diềm ----------
function heroMarket(c, fr, add) {
  const { M, s8, y0, H } = c;
  const blue = linRGB(0x3a6fb4);
  fr.slice(0, 2).forEach((E, idx) => {
    const [ax, az, bx, bz, nx, nz, L] = E; if (L < 3) return;
    const g = gapOf(c, E), out = Math.max(1.2, Math.min(2.6, g + 1.2));
    add(M, slopeStrip(M, ax, az, bx, bz, nx, nz, out, y0 + 3.0, y0 + 2.55, blue, s8, MOD.D_AWN2));
    if (idx === 0 && L >= 4 && c.fl <= 2) {   // bảng quảng cáo khổ lớn trên diềm mái (1-3 tấm) — chỉ hội trường thấp (không treo lưng chừng nhà cao)
      const ex = (bx - ax) / L, ez = (bz - az) / L, nB = Math.max(1, Math.min(3, Math.floor(L / 7))), bw = Math.min(6.5, L / nB - 0.6);
      for (let k = 0; k < nB; k++) {
        const sm = (L * (k + 0.5)) / nB, [px, pz] = edgeP(E, sm), yb = y0 + Math.max(3.4, H - 0.4), yt = yb + 2.2;
        const si = (hh(c.seed + k, 721) * 4) | 0, v0 = (si & 1) * 0.5 + 0.004, v1 = v0 + 0.492, cell = MOD.BILL0 + (si >> 1);
        add(M, qN(M, [px - ex * bw / 2 + nx * 0.12, yb, pz - ez * bw / 2 + nz * 0.12, px + ex * bw / 2 + nx * 0.12, yb, pz + ez * bw / 2 + nz * 0.12, px + ex * bw / 2 + nx * 0.12, yt, pz + ez * bw / 2 + nz * 0.12, px - ex * bw / 2 + nx * 0.12, yt, pz - ez * bw / 2 + nz * 0.12], nx, 0, nz, [0.004, v0, 0.996, v0, 0.996, v1, 0.004, v1], WHITE, s8, cell, (hh(c.seed + k, 723) * 255) | 0));
        add(M, box(M, px, pz, ex, ez, nx, nz, bw / 2, 0.06, yb, yt, DARK, s8, MOD.D_SIGNF, 2 | 4 | 8 | 16));
      }
    }
  });
}

// ---------- CHÙA: mái NHIỀU TẦNG (diềm hiên dốc quanh thân + tầng mái 4 dốc đao cong), bờ nóc, cổng tam quan ----------
function heroPagoda(c, fr, add) {
  const { M, s8, y0, H } = c;
  const o = c.obb; if (!o) return;
  const Lu = o.u1 - o.u0, Lv = o.v1 - o.v0, uc = (o.u0 + o.u1) / 2, vc = (o.v0 + o.v1) / 2;
  let rx = o.ux, rz = o.uz, px = o.vx, pz = o.vz, hl = Lu / 2, hw = Lv / 2;
  if (Lv > Lu) { rx = o.vx; rz = o.vz; px = -o.ux; pz = -o.uz; hl = Lv / 2; hw = Lu / 2; }
  const cx = o.ux * uc + o.vx * vc, cz = o.uz * uc + o.vz * vc;
  const top = y0 + H;
  if (hw < 2 || hl < 2.5) return;
  // tầng mái DƯỚI: diềm hiên dốc quanh thân (4 dải), đua 1,5 m
  const ov = 1.5;
  const cor = (a, b) => [cx + rx * a + px * b, cz + rz * a + pz * b];
  const ring = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
  for (let k = 0; k < 4; k++) {
    const [a0, b0] = ring[k], [a1, b1] = ring[(k + 1) % 4], A = cor(a0, b0), B = cor(a1, b1);
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]), ex = (B[0] - A[0]) / L, ez = (B[1] - A[1]) / L;
    let nx = -ez, nz = ex;
    if (nx * ((A[0] + B[0]) / 2 - cx) + nz * ((A[1] + B[1]) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
    add(M, slopeStrip(M, A[0], A[1], B[0], B[1], nx, nz, ov, top + 0.9, top - 0.15, TILE_PAGODA, s8, MOD.R_TILE, ov));
  }
  // thân tầng trên (lùi 1,2 m), cao 1,8 m, màu tường
  const hl2 = hl - 1.2, hw2 = hw - 1.2;
  if (hw2 > 0.8 && hl2 > 1) {
    add(M, box(M, cx, cz, rx, rz, px, pz, hl2, hw2, top + 0.6, top + 2.4, c.wcol, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8));
    // tầng mái TRÊN 4 dốc + đao cong ở 4 góc
    add(M, hipRoof(M, cx, cz, rx, rz, px, pz, hl2 + 1.3, hw2 + 1.3, top + 2.3, top + 2.3 + Math.min(3.2, (hw2 + 1.3) * 0.75), TILE_PAGODA, s8, MOD.R_TILE, 0.9));
    // bờ nóc + 2 đầu đao nóc
    const yR = top + 2.3 + Math.min(3.2, (hw2 + 1.3) * 0.75), inset = Math.min(hl2 + 1.25, (hw2 + 1.3) * 0.95), rl = hl2 + 1.3 - inset;
    if (rl > 0.3) {
      add(M, box(M, cx, cz, rx, rz, px, pz, rl + 0.2, 0.15, yR - 0.05, yR + 0.35, TILE_PAGODA, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
      for (const sg of [-1, 1]) add(M, box(M, cx + rx * (rl + 0.25) * sg, cz + rz * (rl + 0.25) * sg, rx, rz, px, pz, 0.18, 0.15, yR, yR + 0.9, YELLOW_P, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
    }
  }
  // CỔNG TAM QUAN ở mặt phố (nếu có khoảng lùi): 4 trụ, mái giữa cao + 2 mái bên thấp, đao cong
  const E = fr[0];
  if (E) {
    const [ax, az, bx, bz, nx, nz, L] = E;
    const g = gapOf(c, E);
    if (g >= 3 && g <= 40) {
      const ex = (bx - ax) / L, ez = (bz - az) / L, off = g - 0.8, [mx0, mz0] = edgeP(E, Math.max(4, Math.min(L - 4, c.gateAt != null ? c.gateAt : L / 2))), gx = mx0 + nx * off, gz = mz0 + nz * off;
      if (c.free(gx, gz)) {
        for (const s of [-3.4, -1.5, 1.5, 3.4]) add(M, box(M, gx + ex * s, gz + ez * s, ex, ez, nx, nz, 0.3, 0.3, y0 - 0.1, y0 + (Math.abs(s) < 2 ? 4.0 : 3.2), YELLOW_P, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8));
        add(M, hipRoof(M, gx, gz, ex, ez, nx, nz, 2.1, 1.0, y0 + 4.0, y0 + 5.1, TILE_PAGODA, s8, MOD.R_TILE, 0.45));
        for (const sg of [-1, 1]) add(M, hipRoof(M, gx + ex * 2.45 * sg, gz + ez * 2.45 * sg, ex, ez, nx, nz, 1.2, 0.8, y0 + 3.2, y0 + 3.9, TILE_PAGODA, s8, MOD.R_TILE, 0.3));
      }
    }
  }
}

// ---------- CÂY XĂNG: mái che phẳng trên 4-6 trụ, diềm 2 màu (trắng + màu nhấn), cột bơm, biển XĂNG DẦU ----------
function heroPetrol(c, fr, add) {
  const { M, DT, s8, y0 } = c;
  const E = fr[0]; if (!E) return;
  const [ax, az, bx, bz, nx, nz, L] = E;
  const ex = (bx - ax) / L, ez = (bz - az) / L, g = gapOf(c, E);
  const acc = c.acc || linRGB(0x2a4a9a), white = linRGB(0xeeeeea);
  // mái che: TRƯỚC kiốt về phía phố nếu có sân (≥ 7 m), không thì CHỤP lên footprint (footprint chính là mái che)
  const W = Math.max(10, Math.min(18, L + 6));
  let D, cxm, czm;
  const [mx, mz] = edgeP(E, L / 2);
  if (g < 7 && c.fl > 1) return;   // nhà nhiều tầng (heroTall) không có sân trước: mái che chụp lên footprint sẽ cắt ngang tường
  // chỗ đứng hợp lệ cho trụ/cột bơm: không trong nhà khác (free) và không trong chính ki-ốt (phản biện: cột bơm lọt vào ki-ốt)
  const ok = (x, z) => c.free(x, z) && !inPoly(c.X, c.Z, c.n, x, z);
  if (g >= 7) { D = Math.min(10, g - 1); cxm = mx + nx * (D / 2 + 0.3); czm = mz + nz * (D / 2 + 0.3); }
  else { const o = c.obb; D = Math.max(7, Math.min(10, o ? Math.min(o.u1 - o.u0, o.v1 - o.v0) + 3 : 8)); cxm = mx - nx * (D / 2 - Math.max(0, g) - 0.3); czm = mz - nz * (D / 2 - Math.max(0, g) - 0.3); }
  const yC = y0 + 5.2;
  add(M, box(M, cxm, czm, ex, ez, nx, nz, W / 2, D / 2, yC, yC + 0.35, white, s8, MOD.D_PLAIN, 16 | 32));
  add(M, box(M, cxm, czm, ex, ez, nx, nz, W / 2 + 0.05, D / 2 + 0.05, yC + 0.35, yC + 0.85, white, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
  add(M, box(M, cxm, czm, ex, ez, nx, nz, W / 2 + 0.06, D / 2 + 0.06, yC - 0.1, yC + 0.35, acc, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8));
  // chữ XĂNG DẦU trên diềm mặt phố
  const sw = Math.min(6, W * 0.5), fx = cxm + nx * (D / 2 + 0.07), fz = czm + nz * (D / 2 + 0.07);
  add(M, signFace(M, fx - ex * sw / 2, fz - ez * sw / 2, fx + ex * sw / 2, fz + ez * sw / 2, nx, nz, yC + 0.37, yC + 0.83, 3, s8, 30));
  // trụ (sọc 2 màu: thân trắng + chân màu nhấn)
  for (const sa of [-1, 1]) for (const sc of [-1, 1]) {
    const qx = cxm + ex * (W / 2 - 1.6) * sa + nx * (D / 2 - 1.2) * sc, qz = czm + ez * (W / 2 - 1.6) * sa + nz * (D / 2 - 1.2) * sc;
    if (!c.free(qx, qz)) continue;
    add(M, box(M, qx, qz, ex, ez, nx, nz, 0.22, 0.22, y0 - 0.1, yC, white, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8));
    add(M, box(M, qx, qz, ex, ez, nx, nz, 0.24, 0.24, y0 - 0.1, y0 + 1.1, acc, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
  }
  // đảo bơm + 2 cột bơm mỗi đảo
  const G = DT || M;
  for (const s of [-1, 1]) {
    const ix = cxm + ex * (W / 4) * s, iz = czm + ez * (W / 4) * s;
    if (!ok(ix, iz) || !ok(ix + nx * 1.6, iz + nz * 1.6) || !ok(ix - nx * 1.6, iz - nz * 1.6)) continue;
    add(G, box(G, ix, iz, ex, ez, nx, nz, 0.6, 2.2, y0 - 0.05, y0 + 0.18, GRANITE, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
    for (const t of [-1, 1]) {
      const qx = ix + nx * 1.1 * t, qz = iz + nz * 1.1 * t;
      add(G, box(G, qx, qz, ex, ez, nx, nz, 0.42, 0.3, y0 + 0.18, y0 + 1.75, white, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
      add(G, box(G, qx, qz, ex, ez, nx, nz, 0.44, 0.32, y0 + 1.75, y0 + 2.1, acc, s8, MOD.D_PLAIN, 1 | 2 | 4 | 8 | 16));
    }
  }
}
