// riverbank.js — BỜ KÈ SÔNG (Đợt 3 W3-F, AUDIT3 FP-6 "embankment kit"): sông Tam Bạc / Cấm / Đào Hạ Lý trong thành phố.
//
// Ảnh thật (pano_203/221/198/290/294): tim phố ven sông → lòng → bó vỉa → DẢI DẠO lát ca-rô đỏ-xám ~4,5-5 m (cây non chống
// cọc, đèn gang 2 bóng) → LAN CAN gang xanh hoa văn trên gờ bê tông thấp (pano_221: gờ sơn sọc đỏ-trắng) → TƯỜNG KÈ đứng
// → mặt nước đục nâu-ô liu thấp hơn ~2 m; hoa giấy (bougainvillea) rủ trên lan can. Game cũ: nước PHẲNG với vỉa hè (lưới
// nền 13,3 m vẽ bờ thành dốc thoải ~5 m, mép nước "răng cưa" theo ô), không lan can, không đèn, cây cổ thụ cả 2 bên phố.
//
// Gồm 2 phần:
//  (1) snapBankGrid(geo, …): NẮN lưới nền local (13,3 m) quanh mép polygon SÔNG: đỉnh trong ±0,72 ô quanh mép → kéo đúng
//      VỀ MÉP (cao độ đất), đỉnh nước kế tiếp → DÌM −60 m ⇒ bờ dựng đứng, mép nước bám polygon (hết dốc thoải "nước sát vỉa
//      hè"). Kênh hẹp (< ~20 m) giữ nguyên (nắn sẽ lấp kênh).
//  (2) buildRiverbanks(scene, deps): lấy mẫu mép polygon sông 2 m/điểm → tường kè + gờ đỉnh kè (mọi bờ trong R) ; bờ có
//      PHỐ chạy dọc (≤ khoảng kè W3-F + 5 m, song song) = "dải dạo": mặt lát ca-rô từ gờ kè tới mép vỉa hè, lan can gang
//      (tấm hoa văn alphaTest 1 quad/2 m + tay vịn + trụ), đèn gang 2 bóng mỗi 16 m, khóm hoa giấy, collider chặn rơi xuống
//      sông; trả về vị trí CÂY NON chống cọc (world.js trồng bằng trees.js plant('non')) + keep(x,z) = vùng phố ven sông
//      KHÔNG trồng cây đường phố cổ thụ (cả phía nhà — ảnh pano_203 h90/h180 phía nhà không có cây).
//      Dải bờ tự phát ('strip', Tam Bạc đoạn bắc) + BÃI BỒI cửa Tam Bạc (mapdata BEACHES): trả thêm CÂY LỚN (bankTrees) — hàng
//      cây trong dải giữa lan can và kè (ảnh 336/337/520) + lùm cây rải trên bãi (ảnh vệ tinh tile 7, pano_331/384 h270).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as MD from './mapdata.js';
import { claimPoly } from './claims.js';

const isRiverName = (n) => /^Sông/.test(n || '');
// bãi bồi (đất do process_osm §6b3b tách khỏi polygon sông) — import * : mapdata cũ không có export này vẫn chạy
const BEACHES = MD.BEACHES || [];
function inPoly(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
}
const beachAt = (x, z) => BEACHES.some((B) => inPoly(x, z, B));

// ---------------------------------------------------------------------------------------------------------------
// (1) nắn lưới nền theo mép sông. geo: BufferGeometry lưới local (position y đã tính). waterSD(x,z): âm = trong nước.
// skip(x,z): vùng không đụng (hộp lưới mịn hồ). nx: số đỉnh/hàng (lọc thô), rMax: chỉ trong vùng polygon (R_POLY).
// Trả về số đỉnh đã nắn.
export function snapBankGrid(geo, { step, waterSD, isRiverAt, skip, landY, recolor, nx, rMax = Infinity }) {
  const pos = geo.attributes.position, B = 0.72 * step, H = 0.5;
  const wsnap = new Map();   // đỉnh NƯỚC đã kéo về mép: i → [x, z, sd gốc] (để hoàn tác nếu tạo tam giác đất phủ nước)
  let n = 0;
  // lọc thô (nx = số đỉnh/hàng của lưới đều): chỉ đỉnh cách ≤ 4 ô một chỗ đổi khô/ướt THEO CAO ĐỘ ĐỈNH (y < 1 = ướt) mới cần
  // waterSD (vùng xử lý: −B − 1,5 ô … +B ⇒ ≤ 2,3 ô từ mép) — bỏ ~85 % lần gọi waterSD trên lưới 301² (~40 ms bước 'ground')
  let near = null;
  if (nx && pos.count % nx === 0) {
    const nz = pos.count / nx, wet = new Uint8Array(pos.count), t = new Uint8Array(pos.count), R = 4;
    for (let i = 0; i < pos.count; i++) wet[i] = pos.getY(i) < 1.0 ? 1 : 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, w = wet[k];
      if ((i + 1 < nx && wet[k + 1] !== w) || (j + 1 < nz && wet[k + nx] !== w)) { t[k] = 1; if (i + 1 < nx) t[k + 1] = 1; if (j + 1 < nz) t[k + nx] = 1; }
    }
    const h = new Uint8Array(pos.count); near = new Uint8Array(pos.count);   // giãn R ô (Chebyshev): hàng rồi cột
    for (let j = 0; j < nz; j++) { let last = -1e9; for (let i = 0; i < nx; i++) { if (t[j * nx + i]) last = i; if (i - last <= R) h[j * nx + i] = 1; }
      last = 1e9; for (let i = nx - 1; i >= 0; i--) { if (t[j * nx + i]) last = i; if (last - i <= R) h[j * nx + i] = 1; } }
    for (let i = 0; i < nx; i++) { let last = -1e9; for (let j = 0; j < nz; j++) { if (h[j * nx + i]) last = j; if (j - last <= R) near[j * nx + i] = 1; }
      last = 1e9; for (let j = nz - 1; j >= 0; j--) { if (h[j * nx + i]) last = j; if (last - j <= R) near[j * nx + i] = 1; } }
  }
  for (let i = 0; i < pos.count; i++) {
    if (near && !near[i]) continue;
    const x = pos.getX(i), z = pos.getZ(i);
    if (x * x + z * z > rMax * rMax) continue;   // ngoài R_POLY nước theo POLYLINE (terrain) — polygon không quyết định bờ
    if (skip && skip(x, z)) continue;
    const sd = waterSD(x, z);
    if (sd >= B || sd < -B - step * 1.5) continue;
    if (isRiverAt && !isRiverAt(x, z)) continue;
    // gradient (hướng ra ĐẤT) bằng sai phân trung tâm
    let gx = waterSD(x + H, z) - waterSD(x - H, z), gz = waterSD(x, z + H) - waterSD(x, z - H);
    const gl = Math.hypot(gx, gz); if (gl < 1e-4) continue;
    gx /= gl; gz /= gl;
    const ex = x - gx * sd, ez = z - gz * sd;           // điểm trên mép
    // mép THẬT phải có đất ngay sau nó: cạnh CHUNG giữa 2 polygon sông (Tam Bạc 2 mảnh nối ở z≈−566) cũng có |sd| nhỏ
    // → nắn đỉnh nước về đó thành "gờ đất" giữa lòng sông (vệt nêm trắng/cỏ pano_221 h270)
    if (waterSD(ex + gx * 1.5, ez + gz * 1.5) < 0.3) continue;
    // kênh hẹp: phía nước bên kia mép phải còn nước ≥ B + 8 m — không thì bỏ (nắn sẽ lấp lòng kênh)
    if (waterSD(ex - gx * (B + 8), ez - gz * (B + 8)) > -2) continue;
    // dải ±B quanh mép → kéo VỀ MÉP ở cao độ đất; đỉnh nước kế tiếp GIỮ chỗ nhưng dìm SÂU (−60): tam giác bờ dốc gần đứng,
    // phần nhô trên mặt nước ≤ 2/62 cạnh ô (≤ 0,6 m — sau tường kè). (Kéo cả đỉnh nước về "chân kè 3 m" như lưới mịn hồ
    // 5 m sinh tam giác dài dọc bờ nhô lên mặt nước thành NÊM — ô 13,3 m quá thưa cho cách đó.)
    if (sd >= -B) { if (sd < 0) wsnap.set(i, [x, z, sd]); pos.setXYZ(i, ex, landY, ez); if (recolor) recolor(i, ex + gx * 1.5, ez + gz * 1.5); }
    else pos.setY(i, -60);
    n++;
  }
  // tam giác cả 3 đỉnh ở cao độ đất mà TÂM nằm trong nước (góc bờ lõm/bậc polygon — pano_221 h270): trả đỉnh nước sâu nhất
  // về chỗ cũ + dìm sâu
  const idx = geo.index ? geo.index.array : null;
  if (idx && wsnap.size) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if (pos.getY(a) < landY - 0.01 || pos.getY(b) < landY - 0.01 || pos.getY(c) < landY - 0.01) continue;
      if (!wsnap.has(a) && !wsnap.has(b) && !wsnap.has(c)) continue;
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3, cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      if (waterSD(cx, cz) > -1.2) continue;
      let w = -1, ws = 0;
      for (const v of [a, b, c]) { const s = wsnap.get(v); if (s && s[2] < ws) { ws = s[2]; w = v; } }
      if (w < 0) continue;
      const [ox, oz] = wsnap.get(w); pos.setXYZ(w, ox, -60, oz); wsnap.delete(w);
    }
  }
  if (n) { pos.needsUpdate = true; if (geo.attributes.color) geo.attributes.color.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------
function Buf() { return { p: [], n: [], c: [], u: [], idx: [] }; }
function quad(B, a, b, c, d, nrm, cols, uv) {   // a,b,c,d ngược chiều kim đồng hồ nhìn từ phía pháp tuyến
  const o = B.p.length / 3;
  for (const v of [a, b, c, d]) B.p.push(v[0], v[1], v[2]);
  for (let i = 0; i < 4; i++) { B.n.push(nrm[0], nrm[1], nrm[2]); const cc = Array.isArray(cols[0]) ? cols[i] : cols; B.c.push(cc[0], cc[1], cc[2]); }
  if (uv) for (const t of uv) B.u.push(t[0], t[1]); else for (let i = 0; i < 4; i++) B.u.push(0, 0);
  B.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
function toGeo(B) {
  if (!B.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
  g.setIndex(B.idx);
  // nhả mảng JS nguồn (đã chép sang typed array): closure trả về (keep/promSide…) giữ NGỮ CẢNH hàm dựng — mảng Buf
  // nằm trong ngữ cảnh đó (hàm con dùng chung) ⇒ không nhả thì ~30 MB heap sống suốt phiên (heap sau gc so với dot3: +54 → +27 MB)
  B.p = B.n = B.c = B.u = B.idx = [];
  return g;
}
// hộp quay quanh y (đủ 5 mặt, không đáy)
function box(B, cx, cy, cz, sx, sy, sz, rotY, col) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const P = (lx, ly, lz) => [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
  const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  quad(B, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), col);
  quad(B, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, 0, -1), col);
  quad(B, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0, 0), col);
  quad(B, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), col);
  quad(B, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, 1, 0), col);
}
function cyl(B, cx, cz, y0, y1, r0, r1, n, col) {
  for (let k = 0; k < n; k++) {
    const a1 = (k / n) * Math.PI * 2, a2 = ((k + 1) / n) * Math.PI * 2, am = (a1 + a2) / 2;
    const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
    quad(B, [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c2 * r1, y1, cz + s2 * r1], [cx + c2 * r0, y0, cz + s2 * r0],
      [Math.cos(am), 0, Math.sin(am)], col);
  }
}
const rgb = (hex, f = 1) => { const c = new THREE.Color(hex); return [c.r * f, c.g * f, c.b * f]; };
const hash = (x, z, s) => { const v = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); };

// texture ca-rô dải dạo ven sông: ô 0,4 m đỏ gạch NHẠT xen xám (pano_203: ca-rô đỏ-xám đều, đã bạc màu) — 1 texture 2×2 ô
function caroTexture() {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const H = S / 2;
  const cols = [[138, 100, 90], [126, 123, 117], [126, 123, 117], [138, 100, 90]];   // đỏ-xám bạc màu, tương phản thấp
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const [r, gg, b] = cols[j * 2 + i], k = 0.94 + rnd() * 0.1;
    g.fillStyle = `rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`; g.fillRect(i * H, j * H, H, H);
  }
  for (let i = 0; i < 380; i++) { const v = rnd() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},0.06)`; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  g.strokeStyle = 'rgba(60,50,45,0.35)'; g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, H, H); g.strokeRect(H + 0.5, H + 0.5, H - 1, H - 1); g.strokeRect(H + 0.5, 0.5, H - 1, H); g.strokeRect(0.5, H + 0.5, H, H - 1);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// tấm lan can gang hoa văn (alpha): khung + song đứng + vòng tròn + chùm hoa văn — 1 ô = 2 m × 0,85 m
function railTexture() {
  const W = 256, H = 112, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#2c4a3a'; g.fillStyle = '#2c4a3a';
  g.lineWidth = 6; g.strokeRect(3, 3, W - 6, H - 6);                       // khung
  g.lineWidth = 3;
  for (let x = 16; x < W; x += 16) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, H - 8); g.stroke(); }   // song đứng
  g.lineWidth = 3;
  for (let x = 32; x < W; x += 64) {                                          // vòng tròn + chữ S hoa văn
    g.beginPath(); g.arc(x, H / 2, 20, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.arc(x + 32, H * 0.32, 9, Math.PI * 0.2, Math.PI * 1.6); g.stroke();
    g.beginPath(); g.arc(x + 32, H * 0.68, 9, Math.PI * 1.2, Math.PI * 2.6); g.stroke();
  }
  g.fillRect(0, H * 0.5 - 2, W, 4);                                           // thanh ngang giữa
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// tấm lan can dải bờ tự phát (Tam Bạc đoạn bắc): sắt sẫm CHUỖI VÒNG TRÒN lồng nhau (Ø ~0,45 m, tâm cách 0,25 m) giữa thanh
// trên/dưới — ảnh pano_519 h180, 331 h270 (khối ô B2 "phố thuyền" cũng vẽ kiểu này) — 1 ô = 2 m × 0,7 m
function ringTexture() {
  const W = 256, H = 112, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = '#2b2e2c'; g.fillStyle = '#2b2e2c';
  g.fillRect(0, 2, W, 7); g.fillRect(0, H - 8, W, 6);                        // thanh trên / dưới
  g.fillRect(0, 0, 6, H);                                                     // trụ sắt đầu ô
  g.lineWidth = 3.2;
  for (let x = 0; x <= W + 32; x += 32) { g.beginPath(); g.arc(x, H / 2, 34, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// deps: { WATER, waterSD, roads (ROADS_DT mặt đất), hw(c), sw(c), roadSurfaceAt, LAND_H, R, lampGlow (material đèn), addCollider,
//         panoCams, keClear(c) (khoảng kè W3-F: hw + vỉa hè + 2,5), deckAt(x,z) (có mặt cầu nâng phủ — không lan can/đèn dưới cầu) }
export function buildRiverbanks(scene, deps) {
  const t0 = performance.now();
  const { WATER, waterSD, LAND_H = 2, R = 1650 } = deps;
  // bãi bồi → claim 'rough' (landuse tô CỎ DẠI/đất cát thay màu đỉnh xám "bãi trống"; không chặn cây/prop — chỉ citygen)
  BEACHES.forEach((B, i) => claimPoly(B, 'rough', 'beach_' + i));
  const TOP = LAND_H + 0.25;                    // mặt dải dạo = mặt vỉa hè (xsection SIDEWALK_TOP)
  const stats = { samples: 0, promM: 0, wildM: 0, lamps: 0, saplings: 0, bloom: 0, colliders: 0 };
  // ---- lưới đoạn phố mặt đất (p/s/t/r) ----
  const segs = [];
  deps.roads.forEach((r, ri) => {
    if (!['p', 's', 't', 'r'].includes(r.c) || r.pts.length < 2) return;
    for (let i = 0; i < r.pts.length - 1; i++) segs.push({ ax: r.pts[i][0], az: r.pts[i][1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1], c: r.c, ri });
  });
  const GC = 24, G = new Map(), gk = (i, j) => (i + 4096) * 8192 + (j + 4096);
  segs.forEach((s, si) => {
    for (let i = Math.floor((Math.min(s.ax, s.bx) - 20) / GC); i <= Math.floor((Math.max(s.ax, s.bx) + 20) / GC); i++)
      for (let j = Math.floor((Math.min(s.az, s.bz) - 20) / GC); j <= Math.floor((Math.max(s.az, s.bz) + 20) / GC); j++) {
        const k = gk(i, j); let a = G.get(k); if (!a) G.set(k, a = []); a.push(si);
      }
  });
  // ---- lấy mẫu mép sông 2 m ----
  const S = [];
  for (const W of WATER) {
    if (!isRiverName(W.n)) continue;
    const P = W.pts;
    for (let e = 0; e < P.length; e++) {
      const a = P[e], b = P[(e + 1) % P.length];
      if (Math.hypot(a[0], a[1]) > R + 60 && Math.hypot(b[0], b[1]) > R + 60) continue;
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.2) continue;
      const tx = dx / L, tz = dz / L, n = Math.max(1, Math.round(L / 2));
      for (let k = 0; k < n; k++) {
        const x = a[0] + dx * (k + 0.5) / n, z = a[1] + dz * (k + 0.5) / n;
        if (Math.hypot(x, z) > R) continue;
        let nx = -tz, nz = tx;                               // pháp tuyến về phía ĐẤT
        const s1 = waterSD(x + nx * 2.5, z + nz * 2.5), s2 = waterSD(x - nx * 2.5, z - nz * 2.5);
        if (s1 < 0 && s2 < 0) continue;                      // cạnh trong (2 polygon sông kề nhau)
        if (s1 < s2) { nx = -nx; nz = -nz; }
        if (Math.min(s1, s2) > 0) continue;                  // không phải mép nước thật
        S.push({ x, z, tx, tz, nx, nz, L: L / n, poly: W, e });
      }
    }
  }
  stats.samples = S.length;
  // ---- phân loại: dải dạo (phố chạy dọc bờ) / bờ thường ----
  for (const s of S) {
    s.beach = BEACHES.length > 0 && beachAt(s.x + s.nx * 3, s.z + s.nz * 3);   // bờ bãi bồi (phía đất là bãi)
    // ứng viên: ô của mẫu (lưới đăng ký đoạn phố ±20 m); bờ bãi: cả các ô ±3 (72 m)
    let a = G.get(gk(Math.floor(s.x / GC), Math.floor(s.z / GC)));
    if (s.beach) {
      const u = new Set(), ci = Math.floor(s.x / GC), cj = Math.floor(s.z / GC);
      for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) { const b = G.get(gk(i, j)); if (b) for (const v of b) u.add(v); }
      a = u.size ? [...u] : null;
    }
    s.road = null;
    if (a) {
      let best = null, bd = Infinity;
      for (const si of a) {
        const r = segs[si], dx = r.bx - r.ax, dz = r.bz - r.az, l = Math.hypot(dx, dz); if (l < 0.5) continue;
        const ux = dx / l, uz = dz / l;
        if (Math.abs(ux * s.tx + uz * s.tz) < 0.72) continue;
        const t = (s.x - r.ax) * ux + (s.z - r.az) * uz; if (t < -2 || t > l + 2) continue;
        const px = r.ax + ux * Math.max(0, Math.min(l, t)), pz = r.az + uz * Math.max(0, Math.min(l, t));
        const d = Math.hypot(s.x - px, s.z - pz);
        if ((px - s.x) * s.nx + (pz - s.z) * s.nz < 0.5 * d) continue;      // phố phải ở phía ĐẤT
        // ≤ +5: dải dạo; xa hơn: dải bờ "tự phát" (xem dưới). Bờ bãi bồi cách phố tới ~65 m (pano_331/332): +75
        const lim = deps.keClear(r.c) + (s.beach ? 75 : 25);
        if (d > lim) continue;
        if (d < bd) { bd = d; best = { si, d, c: r.c, px, pz, ux, uz }; }
      }
      s.road = best;
    }
    // dưới mặt cầu phẳng / phố đâm ra sông: có mặt đường NGAY mép nước → không lan can/đèn (tường kè vẫn có)
    s.bridge = deps.roadSurfaceAt ? deps.roadSurfaceAt(s.x + s.nx * 0.8, s.z + s.nz * 0.8) > 0 : false;
    // dưới mặt cầu NÂNG (Lạc Long +2 m: roadnet bỏ dải mặt đất → roadSurfaceAt = 0) cũng không lan can/đèn/cây non
    if (!s.bridge && deps.deckAt && deps.deckAt(s.x + s.nx * 0.8, s.z + s.nz * 0.8)) s.bridge = true;
  }
  // làm mượt phân loại: đoạn "dải dạo" ngắn < 6 m giữa bờ thường → bỏ; khe < 6 m giữa 2 đoạn dải dạo → lấp
  for (let i = 1; i < S.length - 1; i++) if (!S[i].road && S[i - 1].road && S[i + 1].road && S[i - 1].poly === S[i + 1].poly) S[i].road = S[i - 1].road;

  const wall = Buf(), cap = Buf(), pave = Buf(), plinth = Buf(), iron = Buf(), panel = Buf(), lamp = Buf(), bloom = Buf();
  const shackB = Buf(), boatB = Buf(), ringPanel = Buf(), sand = Buf();
  stats.stripM = 0; stats.stripN = 0; stats.shacks = 0; stats.boats = 0; stats.beachM = 0;
  const shacks = [], bankTrees = [], treeGrid = new Map();
  const C_TOP = rgb(0xbdb6a6), C_MID = rgb(0x968e7c), C_LOW = rgb(0x5d5a48), C_CAP = rgb(0xc9c3b4);
  const C_SAND = rgb(0x9d8f72), C_WET = rgb(0x5f5848);
  const C_IRON = rgb(0x2c4a3a), C_LAMP = rgb(0x1f2a26);
  // keepSegs: si → [t0, t1] quãng (m dọc đoạn phố) CÓ dải dạo — keep/promSide chỉ tác dụng trong quãng đó (+6 m): 1 đoạn
  // ROADS_DT dài (Phố Tam Bạc 221 → 335, 190 m) vừa có dải dạo (đầu nam) vừa là dải bờ tự phát (đoạn bắc) — áp cả đoạn từng
  // xoá hàng cổ thụ + xe máy đỗ phía sông ở pano_336/337/520 (12 → 4 cây, 30 → 13 xe trong 22 m)
  const saplings = [], keepSegs = new Map(), lampGlobes = [];
  let lampAcc = 7, saplAcc = 4, bloomAcc = 11;
  const WF = -0.7;                        // mặt tường kè: 0,7 m về phía nước tính từ mép polygon
  for (let i = 0; i < S.length; i++) {
    const s = S[i], h = s.L / 2;
    const ax = s.x - s.tx * h, az = s.z - s.tz * h, bx = s.x + s.tx * h, bz = s.z + s.tz * h;
    const off = (x, z, d) => [x + s.nx * d, z + s.nz * d];
    // tường kè (mặt hướng ra nước = −n)
    const [w1x, w1z] = off(ax, az, WF), [w2x, w2z] = off(bx, bz, WF);
    const ny = [-s.nx, 0, -s.nz];
    // thứ tự để pháp tuyến hình học = −n: (a,top) → (a,bot) → (b,bot) → (b,top) khi (b−a) = t; kiểm dấu
    const cr = s.tx * (-s.nz) - s.tz * (-s.nx);
    // màu dọc tường: đỉnh sáng, vệt rêu/ố sát mặt nước
    const quadV = (yT, yB, cT, cB) => {
      const a = [w1x, yT, w1z], b = [w1x, yB, w1z], c = [w2x, yB, w2z], d = [w2x, yT, w2z];
      if (cr > 0) quad(wall, a, b, c, d, ny, [cT, cB, cB, cT]); else quad(wall, d, c, b, a, ny, [cT, cB, cB, cT]);
    };
    if (s.beach) {
      // bờ BÃI BỒI: dốc cát tự nhiên (không kè) từ mép đất xuống dưới mặt nước 4,5 m ra lòng — che vách đứng của lưới nền nắn
      const [o1x, o1z] = off(ax, az, -4.5), [o2x, o2z] = off(bx, bz, -4.5), yT = LAND_H + 0.01;
      const up = (s.tx * s.nz - s.tz * s.nx) < 0, N = [-s.nx * 0.5, 0.86, -s.nz * 0.5];
      const V = [[o1x, -0.7, o1z], [o2x, -0.7, o2z], [bx, yT, bz], [ax, yT, az]], Cc = [C_WET, C_WET, C_SAND, C_SAND];
      if (up) quad(sand, V[0], V[1], V[2], V[3], N, Cc); else quad(sand, V[3], V[2], V[1], V[0], N, [Cc[3], Cc[2], Cc[1], Cc[0]]);
      stats.beachM += s.L;
    } else quadV(TOP, 0.9, C_TOP, C_MID), quadV(0.9, -1.4, C_MID, C_LOW);
    // gờ đỉnh kè: từ mặt tường tới +0,45 m trong đất (đỉnh +0,02)
    if (!s.beach) {
      const [c1x, c1z] = off(ax, az, WF - 0.05), [c2x, c2z] = off(bx, bz, WF - 0.05), [c3x, c3z] = off(bx, bz, 0.45), [c4x, c4z] = off(ax, az, 0.45);
      const y = TOP + 0.02;
      // mặt trên: (a_out → b_out → b_in → a_in) — pháp tuyến lên khi (b−a)×(in−out) có y > 0
      const up = (s.tx * s.nz - s.tz * s.nx) < 0;
      if (up) quad(cap, [c1x, y, c1z], [c2x, y, c2z], [c3x, y, c3z], [c4x, y, c4z], [0, 1, 0], C_CAP);
      else quad(cap, [c4x, y, c4z], [c3x, y, c3z], [c2x, y, c2z], [c1x, y, c1z], [0, 1, 0], C_CAP);
    }
    // phân loại bờ: 'prom' = dải dạo sát phố (bờ cách mép vỉa hè ≤ 7 m — Tam Bạc đoạn cong/tây, pano_198-212, 290-299);
    // 'strip' = phố chạy dọc nhưng bờ cách xa > 7 m (Tam Bạc đoạn bắc Lạc Long → cửa Cấm, pano_519/336/331): lan can cũ
    // ở MÉP VỈA HÈ, giữa lan can và kè là dải bờ tự phát (lán tôn, bạt) dưới hàng cây cổ thụ — cây đường phố GIỮ.
    const gapW = s.road ? s.road.d - deps.hw(s.road.c) - deps.sw(s.road.c) : 0;
    // Tam Bạc đoạn BẮC (bắc Lạc Long → cửa Cấm, z < −600): luôn 'strip' — ảnh 519/336/331: hàng cổ thụ + lan can sắt cũ
    // + dải lán/bạt bên bờ, KHÔNG dải dạo ca-rô (dù bờ gần phố)
    const north = (/Tam Bạc/.test(s.poly.n) && s.z < -600 && s.x < -250) || s.beach;
    // bờ xa phố (> 7 m) NGOÀI đoạn bắc Tam Bạc (bờ Cấm cạnh nút HVT, pano_349 h270: bãi bê tông + lan can thấp, không lán) → chỉ kè
    const mode = !s.road || s.bridge ? 'wild' : north ? 'strip' : gapW > 7 ? 'wild' : 'prom';
    // thuyền gỗ neo dọc bờ sông Tam Bạc đoạn bắc (ảnh vệ tinh tile 7: thuyền đậu dày 2 bờ; pano_519 h180)
    if (mode !== 'prom' && north && hash(s.x, s.z, 61) < 0.2) boat(s);
    if (mode === 'strip') {
      stats.stripM += s.L;
      stripRail(s);
      const sh = hash(s.x, s.z, 71) < (s.beach ? 0.22 : 0.14) && gapW > 4 ? shack(s, gapW) : null;
      // cây lớn trong dải giữa kè và lan can (ảnh 336/337/520/331 h180-h270: tán rợp ngay sau lan can che kín mặt sông):
      // hàng 1 trong 6 m sát lan can; dải rộng ≥ 8 m thêm hàng thưa phía kè (bãi bồi: lùm rải riêng bên dưới)
      if (gapW > 3.6) {
        const lo = sh ? sh.d + 1.2 : 1.6, hi = gapW - 2.0;
        if (hi > lo && hash(s.x, s.z, 111) < 0.2) { const d = hi - Math.min(6, hi - lo) * hash(s.x, s.z, 114); bankTree(s.x + s.nx * d, s.z + s.nz * d, hash(s.x, s.z, 115)); }
        if (!s.beach && hi - lo >= 8 && hash(s.x, s.z, 112) < 0.1) { const d = lo + (hi - 6 - lo) * hash(s.x, s.z, 113); bankTree(s.x + s.nx * d, s.z + s.nz * d, hash(s.x, s.z, 116)); }
      }
      continue;
    }
    if (mode === 'wild') { stats.wildM += s.L; continue; }
    stats.promM += s.L;
    {
      const r = segs[s.road.si], t = (s.road.px - r.ax) * s.road.ux + (s.road.pz - r.az) * s.road.uz, k = keepSegs.get(s.road.si);
      if (k) { if (t < k[0]) k[0] = t; if (t > k[1]) k[1] = t; } else keepSegs.set(s.road.si, [t, t]);
    }
    // mặt lát dải dạo: ca-rô LIỀN từ gờ kè (+0,45) tới sát bó vỉa (d − hw − 0,15) — phủ luôn vỉa hè phố phía sông
    // (ảnh pano_203: cả dải giữa bó vỉa và lan can là ca-rô đỏ-xám), cao hơn mặt vỉa hè roadnet 1,2 cm
    const outer = s.road.d - deps.hw(s.road.c) - 0.15;
    if (outer > 0.8) {
      const ow = Math.min(outer, 16);
      const p1 = off(ax, az, 0.45), p2 = off(bx, bz, 0.45), p3 = off(bx, bz, ow), p4 = off(ax, az, ow);
      const y = TOP + 0.012, U = (p) => [p[0] / 0.8, p[1] / 0.8];
      const up = (s.tx * s.nz - s.tz * s.nx) < 0;
      const V = [[p1[0], y, p1[1]], [p2[0], y, p2[1]], [p3[0], y, p3[1]], [p4[0], y, p4[1]]];
      const UV = [U(p1), U(p2), U(p3), U(p4)];
      if (up) quad(pave, V[0], V[1], V[2], V[3], [0, 1, 0], [1, 1, 1], UV);
      else quad(pave, V[3], V[2], V[1], V[0], [0, 1, 0], [1, 1, 1], [UV[3], UV[2], UV[1], UV[0]]);
    }
    // gờ lan can (bê tông thấp) + tấm hoa văn + tay vịn + trụ
    {
      const rl = 0.0, y0 = TOP + 0.02;
      const [r1x, r1z] = off(ax, az, rl), [r2x, r2z] = off(bx, bz, rl);
      const ang = Math.atan2(s.tx, s.tz);
      // gờ: phố s/p (pano_221 Phố Tam Bạc bắc) sơn sọc đỏ-trắng ~1 m; phố t/r (pano_203) xám
      const striped = s.road.c !== 'r' && s.road.c !== 't';
      for (const hh of [-0.25, 0.25]) {
        const mx = s.x + s.tx * hh * s.L, mz = s.z + s.tz * hh * s.L;
        box(plinth, mx, y0 + 0.17, mz, 0.34, 0.34, s.L / 2 + 0.01, ang, striped && hh > 0 ? rgb(0xb33a2e) : rgb(0xd8d4ca));
      }
      // tấm hoa văn (2 mặt cùng 1 quad: material DoubleSide)
      const yb = y0 + 0.36, yt = y0 + 1.12;
      quad(panel, [r1x, yb, r1z], [r2x, yb, r2z], [r2x, yt, r2z], [r1x, yt, r1z], [s.nx, 0, s.nz], [1, 1, 1], [[0, 0], [s.L / 2, 0], [s.L / 2, 1], [0, 1]]);
      box(iron, (r1x + r2x) / 2, yt + 0.04, (r1z + r2z) / 2, 0.09, 0.08, s.L + 0.02, ang, C_IRON);
      if ((i % 2) === 0) box(iron, r1x, y0 + 0.75, r1z, 0.1, 0.8, 0.1, ang, C_IRON);
      if ((i % 2) === 0 && deps.addCollider) { const [qx, qz] = off(s.x, s.z, -0.9); deps.addCollider(qx, qz, 1.0); stats.colliders++; }
    }
    // đèn gang 2 bóng mỗi ~16 m, 0,8 m trong lan can
    lampAcc += s.L;
    if (lampAcc >= 16) {
      lampAcc = 0;
      const [lx, lz] = off(s.x, s.z, 0.85);
      const y0 = TOP;
      cyl(lamp, lx, lz, y0, y0 + 0.5, 0.2, 0.16, 8, C_LAMP);
      cyl(lamp, lx, lz, y0 + 0.5, y0 + 3.9, 0.075, 0.06, 6, C_LAMP);
      const ang = Math.atan2(s.tx, s.tz);
      box(lamp, lx, y0 + 3.75, lz, 0.06, 0.06, 1.3, ang, C_LAMP);
      for (const sg of [-0.62, 0.62]) {
        const gx = lx + s.tx * sg, gz = lz + s.tz * sg;
        cyl(lamp, gx, gz, y0 + 3.62, y0 + 3.78, 0.05, 0.05, 6, C_LAMP);
        lampGlobes.push([gx, y0 + 3.94, gz]);
      }
      stats.lamps++;
    }
    // cây non chống cọc mỗi ~9 m (1,7 m trong lan can), so le không đè đèn
    saplAcc += s.L;
    if (saplAcc >= 9) {
      saplAcc = 0;
      const [px, pz] = off(s.x, s.z, 1.7);
      if (lampAcc > 2 && lampAcc < 14 && !(deps.panoCams || []).some((p) => (p[0] - px) ** 2 + (p[1] - pz) ** 2 < 16)) { saplings.push([px, pz]); stats.saplings++; }
    }
    // khóm hoa giấy (bougainvillea) ôm lan can ~mỗi 24-40 m: gò lá xanh + chùm hoa tím hồng, cao giữa thấp 2 đầu,
    // rủ ra phía nước (ảnh pano_203 h0/h270)
    bloomAcc += s.L;
    if (bloomAcc >= 30 && hash(s.x, s.z, 3) < 0.45) {
      bloomAcc = 0;
      // khối LIỀN từ gờ lên (không "nấm hồng" lơ lửng): mật độ dày ở dưới, đỉnh vòm giữa; tán rủ ra phía nước (v < 0)
      const n = 26 + Math.floor(hash(s.x, s.z, 5) * 10), span = 1.3 + hash(s.x, s.z, 6) * 1.1;
      for (let k = 0; k < n; k++) {
        const uu = hash(s.x, s.z, 10 + k) * 2 - 1, u = uu * span;
        const v = -0.6 + hash(s.x, s.z, 20 + k) * 0.95;
        const hmax = 0.9 + 0.7 * (1 - uu * uu), q = hash(s.x, s.z, 30 + k);
        const bx2 = s.x + s.tx * u + s.nx * v, bz2 = s.z + s.tz * u + s.nz * v, by = TOP + 0.15 + q * q * hmax;
        const r = 0.24 + hash(s.x, s.z, 40 + k) * 0.22;
        const hc = hash(s.x, s.z, 50 + k);
        const col = hc < 0.5 ? rgb(hc < 0.25 ? 0x3a6229 : 0x4b7a35) : rgb(hc < 0.78 ? 0xb52f72 : 0xcf4a8a);
        blob(bloom, bx2, by, bz2, r, col);
      }
      box(bloom, s.x + s.nx * 0.45, TOP + 0.5, s.z + s.nz * 0.45, 0.1, 1.0, 0.1, 0, rgb(0x5a4632));
      stats.bloom++;
    }
  }
  // lùm cây trên BÃI BỒI (ảnh vệ tinh tile 7: lùm cây lớn dày giữa bãi, thưa sát mép nước): lưới 7 m xê dịch, mật độ theo
  // ô 22 m (lùm), cách mép nước ≥ 3,5 m
  for (const B of BEACHES) {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [x, z] of B) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let gx = x0; gx <= x1; gx += 7) for (let gz = z0; gz <= z1; gz += 7) {
      const px = gx + (hash(gx, gz, 121) - 0.5) * 5, pz = gz + (hash(gx, gz, 122) - 0.5) * 5;
      if (!inPoly(px, pz, B) || waterSD(px, pz) < 3.5) continue;
      const c = hash(Math.floor(px / 22), Math.floor(pz / 22), 131);
      if (hash(px, pz, 132) < 0.1 + 0.55 * c * c) bankTree(px, pz, hash(px, pz, 133));
    }
  }
  stats.bankTrees = bankTrees.length;
  // lan can dải bờ tự phát: song sắt sẫm thấp trên gờ, chạy THEO PHỐ ở mép vỉa hè (+0,5 m)
  function stripRail(s) {
    const r = s.road, dl = Math.hypot(s.x - r.px, s.z - r.pz) || 1, wx = (s.x - r.px) / dl, wz = (s.z - r.pz) / dl;
    const off = deps.hw(r.c) + deps.sw(r.c) + 0.5, cx = r.px + wx * off, cz = r.pz + wz * off, ang = Math.atan2(r.ux, r.uz);
    const y0 = TOP - 0.2;
    box(plinth, cx, y0 + 0.2, cz, 0.3, 0.4, s.L + 0.05, ang, rgb(0xb9b3a5));
    const ex = r.ux * (s.L / 2 + 0.02), ez = r.uz * (s.L / 2 + 0.02), yb = y0 + 0.4, yt = y0 + 1.1;
    quad(ringPanel, [cx - ex, yb, cz - ez], [cx + ex, yb, cz + ez], [cx + ex, yt, cz + ez], [cx - ex, yt, cz - ez], [wx, 0, wz], [1, 1, 1], [[0, 0], [s.L / 2, 0], [s.L / 2, 1], [0, 1]]);
    box(iron, cx, yt + 0.03, cz, 0.07, 0.06, s.L + 0.05, ang, rgb(0x2a2f2b));
    const k = stats.stripN++;
    // trụ bê tông mỗi ~6 m; chậu cây cảnh dọc chân lan can phía vỉa hè (ảnh 519 h180: chậu xi măng + cây bụi)
    if (k % 3 === 0) box(plinth, cx, y0 + 0.62, cz, 0.3, 1.24, 0.3, ang, rgb(0xa9a497));
    if (hash(s.x, s.z, 81) < 0.3) {
      const px = cx - wx * 0.45, pz = cz - wz * 0.45;
      cyl(plinth, px, pz, y0 + 0.2, y0 + 0.62, 0.22, 0.28, 8, rgb(0x8b877c));
      for (let q = 0; q < 5; q++) blob(bloom, px + (hash(s.x, s.z, 82 + q) - 0.5) * 0.5, y0 + 0.78 + hash(s.x, s.z, 87 + q) * 0.45, pz + (hash(s.x, s.z, 92 + q) - 0.5) * 0.5,
        0.2 + hash(s.x, s.z, 97 + q) * 0.15, rgb(hash(s.x, s.z, 102 + q) < 0.5 ? 0x3d6a2c : 0x507f36));
    }
    if (deps.addCollider && (k % 2) === 0) deps.addCollider(cx + wx * 0.8, cz + wz * 0.8, 0.9);
  }
  // lán tôn/bạt tự phát giữa lan can và kè (ảnh pano_519 h180: mái tôn xanh, bạt cam/xanh, thấp ~2,4 m)
  function shack(s, gapW) {
    // thấp (1,9-2,4 m), mái tôn/bạt MÀU (xanh dương, cam, gỉ) nhô 0,6 m về phía phố + diềm bạt rủ — nhìn từ phố thấy MÁI và
    // BẠT sặc sỡ (ảnh 519 h180), không phải bức tường xám
    // bờ bãi bồi (bờ cách phố tới 65 m): lán dựng SÁT SAU LAN CAN theo hướng phố (ảnh 331/332 h270: dãy nhà tôn thấp dưới
    // tán cây ngay sau hàng rào), không ở mép nước xa
    const dep = Math.min(gapW - 1.2, 3.6), wid = 2.6 + hash(s.x, s.z, 72) * 2.2, h = 1.9 + hash(s.x, s.z, 73) * 0.5;
    let cx = s.x + s.nx * (0.3 + dep / 2), cz = s.z + s.nz * (0.3 + dep / 2), ang = Math.atan2(s.tx, s.tz), nx = s.nx, nz = s.nz;
    if (s.beach) {
      const r = s.road, dl = Math.hypot(s.x - r.px, s.z - r.pz) || 1, wx = (s.x - r.px) / dl, wz = (s.z - r.pz) / dl;
      const o = deps.hw(r.c) + deps.sw(r.c) + 0.5 + 1.1 + dep / 2;
      cx = r.px + wx * o; cz = r.pz + wz * o; ang = Math.atan2(r.ux, r.uz); nx = -wx; nz = -wz;
    }
    const gy = TOP - 0.25;
    const wallC = [rgb(0xb3ad9f), rgb(0x9aa6ad), rgb(0xbcae90)][Math.floor(hash(s.x, s.z, 74) * 3)];
    box(shackB, cx, gy + h / 2, cz, dep, h, wid, ang, wallC);
    const roofC = [rgb(0x3b78c4), rgb(0xd9772b), rgb(0x9c5a3c), rgb(0x2f8fd0)][Math.floor(hash(s.x, s.z, 75) * 4)];
    const rx = cx + nx * 0.3, rz = cz + nz * 0.3;
    box(shackB, rx, gy + h + 0.08, rz, dep + 1.2, 0.12, wid + 0.5, ang, roofC);
    // diềm bạt rủ phía phố
    const fx = cx + nx * (dep / 2 + 0.85), fz = cz + nz * (dep / 2 + 0.85);
    box(shackB, fx, gy + h - 0.3, fz, 0.05, 0.65, wid + 0.4, ang, hash(s.x, s.z, 77) < 0.5 ? rgb(0x2f7fc1) : rgb(0xe08a3a));
    stats.shacks++;
    shacks.push([cx, cz, Math.max(dep, wid) / 2 + 1.0]);
    return { d: 0.3 + dep + 0.6 };
  }
  // cây lớn bờ sông (world.js trồng plant('shade')): cách lán, camera pano, cây khác ≥ 4,5 m
  function bankTree(x, z, q) {
    for (const [hx, hz, hr] of shacks) if ((x - hx) ** 2 + (z - hz) ** 2 < hr * hr) return;
    if ((deps.panoCams || []).some((p) => (p[0] - x) ** 2 + (p[1] - z) ** 2 < 25)) return;
    const k = Math.floor(x / 5) * 100003 + Math.floor(z / 5);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = treeGrid.get(k + i * 100003 + j); if (a) for (const [tx, tz] of a) if ((tx - x) ** 2 + (tz - z) ** 2 < 20) return; }
    let a = treeGrid.get(k); if (!a) treeGrid.set(k, a = []); a.push([x, z]);
    bankTrees.push([x, z, 8.5 + q * 4.5, 3.2 + q * 2.2]);
  }
  // thuyền gỗ neo sát kè (thân thon 2 đầu + mui bạt)
  function boat(s) {
    const L = 6.5 + hash(s.x, s.z, 62) * 3, Wd = 1.7 + hash(s.x, s.z, 63) * 0.5, off = 1.8 + Wd / 2 + hash(s.x, s.z, 64) * 1.2;
    const cx = s.x - s.nx * off, cz = s.z - s.nz * off, ang = Math.atan2(s.tx, s.tz) + (hash(s.x, s.z, 65) - 0.5) * 0.12;
    const hull = rgb(hash(s.x, s.z, 66) < 0.5 ? 0x4a3a2c : 0x3d5560);
    box(boatB, cx, 0.25, cz, Wd, 0.75, L * 0.7, ang, hull);
    for (const sg of [-1, 1]) box(boatB, cx + s.tx * sg * L * 0.4, 0.35, cz + s.tz * sg * L * 0.4, Wd * 0.55, 0.6, L * 0.18, ang, hull);
    if (hash(s.x, s.z, 67) < 0.7) box(boatB, cx, 1.05, cz, Wd * 0.9, 0.85, L * 0.32, ang, rgb(hash(s.x, s.z, 68) < 0.5 ? 0x2f6aa8 : 0x6b6a5c));
    stats.boats++;
  }
  function blob(B, x, y, z, r, col) {   // khối lá/hoa: bát diện dẹt 8 mặt
    const P = [[x + r, y, z], [x, y, z + r], [x - r, y, z], [x, y, z - r]], T = [x, y + r * 0.7, z], D = [x, y - r * 0.6, z];
    for (let k = 0; k < 4; k++) {
      const a = P[k], b = P[(k + 1) % 4];
      triP(B, b, a, T, col); triP(B, a, b, D, col);   // ngược chiều kim đồng hồ nhìn từ NGOÀI
    }
  }
  function triP(B, a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
    const o = B.p.length / 3;
    for (const v of [a, b, c]) { B.p.push(v[0], v[1], v[2]); B.n.push(nx / l, ny / l, nz / l); B.c.push(col[0], col[1], col[2]); B.u.push(0, 0); }
    B.idx.push(o, o + 1, o + 2);
  }
  // ---- ráp mesh ----
  const add = (B, mat, name, cast = true) => {
    const g = toGeo(B); if (!g) return null;
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = cast; m.receiveShadow = true;
    scene.add(m); return m;
  };
  const vc = () => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  add(wall, vc(), 'riverbank_wall');
  add(cap, vc(), 'riverbank_cap');
  add(plinth, vc(), 'riverbank_plinth');
  add(iron, vc(), 'riverbank_iron');
  add(lamp, vc(), 'riverbank_lamps');
  add(bloom, vc(), 'riverbank_bloom');
  add(shackB, vc(), 'riverbank_shacks');
  add(sand, vc(), 'riverbank_beach', false);
  const bm = add(boatB, vc(), 'riverbank_boats'); if (bm) bm.castShadow = true;
  add(pave, new THREE.MeshLambertMaterial({ map: caroTexture() }), 'riverbank_promenade');
  // tấm hoa văn: alphaTest, 2 mặt; KHÔNG transparent (gộp được) — bóng: customDepth không cần (tắt cast)
  const pm = add(panel, new THREE.MeshLambertMaterial({ map: railTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), 'riverbank_railpanel', false);
  if (pm) pm.userData.noMerge = true;
  const rp = add(ringPanel, new THREE.MeshLambertMaterial({ map: ringTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), 'riverbank_ringpanel', false);
  if (rp) rp.userData.noMerge = true;
  // bóng đèn (material phát sáng dùng chung của thành phố → sáng về đêm theo daynight)
  if (lampGlobes.length && deps.lampGlow) {
    const gs = lampGlobes.map(([x, y, z]) => { const g = new THREE.SphereGeometry(0.17, 8, 6); g.translate(x, y, z); return g; });
    const m = new THREE.Mesh(mergeGeometries(gs), deps.lampGlow); gs.forEach((g) => g.dispose());
    m.name = 'riverbank_globes'; scene.add(m);
  }
  // vùng KHÔNG trồng cây đường phố (phố ven sông có dải dạo: cả 2 phía)
  // quãng có dải dạo của đoạn si chứa hình chiếu (x,z)? (tham số t 0..1 của đoạn; null = không)
  const inKeep = (si, x, z) => {
    const k = keepSegs.get(si); if (!k) return null;
    const r = segs[si], dx = r.bx - r.ax, dz = r.bz - r.az, l2 = dx * dx + dz * dz; if (!l2) return null;
    const l = Math.sqrt(l2), tm = ((x - r.ax) * dx + (z - r.az) * dz) / l;
    if (tm < k[0] - 6 || tm > k[1] + 6) return null;
    const t = tm / l; if (t < -0.05 || t > 1.05) return null;
    return Math.max(0, Math.min(1, t));
  };
  const keep = keepSegs.size ? (x, z) => {
    const a = G.get(gk(Math.floor(x / GC), Math.floor(z / GC))); if (!a) return false;
    for (const si of a) {
      const t = inKeep(si, x, z); if (t === null) continue;
      const r = segs[si], dx = r.bx - r.ax, dz = r.bz - r.az;
      if (Math.hypot(x - r.ax - dx * t, z - r.az - dz * t) < deps.hw(r.c) + deps.sw(r.c) + 1.5) return true;
    }
    return false;
  } : () => false;
  // promSide(x,z): điểm thuộc hành lang phố có dải dạo VÀ ở PHÍA SÔNG của tim phố (gần nước hơn tim) — đồ vỉa hè props.js
  // (quán cóc, xe máy đỗ, cột) không đặt lên dải dạo ca-rô (ảnh pano_203: dải dạo trống, chỉ cây non + đèn)
  const promSide = keepSegs.size ? (x, z) => {
    const a = G.get(gk(Math.floor(x / GC), Math.floor(z / GC))); if (!a) return false;
    for (const si of a) {
      const t = inKeep(si, x, z); if (t === null) continue;
      const r = segs[si], dx = r.bx - r.ax, dz = r.bz - r.az;
      const px = r.ax + dx * t, pz = r.az + dz * t;
      if (Math.hypot(x - px, z - pz) > deps.hw(r.c) + deps.sw(r.c) + 1.5) continue;
      if (waterSD(x, z) < waterSD(px, pz) - 0.5) return true;
    }
    return false;
  } : () => false;
  S.length = 0;   // mẫu bờ không còn dùng (closure keep/promSide giữ ngữ cảnh hàm)
  stats.promM = Math.round(stats.promM); stats.wildM = Math.round(stats.wildM); stats.stripM = Math.round(stats.stripM);
  stats.ms = Math.round(performance.now() - t0);
  return { stats, saplings, bankTrees, keep, promSide };   // (không trả mesh — xem bridges.js)
}
