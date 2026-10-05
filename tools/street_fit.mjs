// tools/street_fit.mjs — Đợt 3 W3-A: MẶT CẮT PHỐ THẬT + TIM ĐƯỜNG KHỚP VẾT XE STREET VIEW (dùng bởi tools/process_osm.mjs)
//
// Vì sao (AUDIT3 FP-1, kiểm 120 pano): (1) bề rộng lòng chỉ theo CẤP OSM (xsection ROAD_W p13/s10/t8/r5,5) → mặt tiền phố
// r ở 4,75 m, t 7 m từ tim trong khi tường nhà thật (Overture) đứng 6-9 m; process_buildings KÉO nhà thật ra facadeLine
// hẹp + lấp khe bằng nhà SINH ngay trên lòng phố thật → camera pano kẹt sát tường (CAMNEAR, 44 pano, điểm TB 3,19);
// (2) tim OSM lệch vết xe Google 3-9 m (30/120 pano ≥ 3 m, điểm TB 3,07; 16 pano camera NGOÀI bó vỉa).
//
// Ba bước (tất định, không ngẫu nhiên):
//  A. measureWalls(): mỗi way p/s/t/r lấy trạm mỗi 5 m (bỏ trạm ≤ 14 m quanh way khác = miệng phố/nút, bỏ trạm nằm TRONG
//     nhà), bắn tia vuông góc 2 bên tới cạnh footprint Overture đầu tiên (≤ 30 m; cùng phép dịch nguồn MS/GG như
//     process_buildings). W = tổng 2 tia ở trạm có CẢ 2 bên. W25 = phân vị 25% (khe/sân lùi chỉ làm W LỚN hơn → phân vị
//     thấp ≈ bức tường phố liền).
//  B. chooseWidths(): bề rộng lòng w + vỉa hè sw MỖI WAY. Ưu tiên: (1) ghi đè theo pano (WIDTH_OVERRIDES, chữ audit);
//     (2) tag OSM width; (3) Overture W25 (way đủ trạm, không phải nửa đường đôi): sw = clamp(max(SW_c, 0,2·W)), w = W − 2sw
//     kẹp theo cấp; (4) gộp theo TÊN phố (cùng cấp) khi way ít trạm; (5) mặc định cấp (w = 0 → xsection dùng ROAD_W[c]).
//  C. fitToPanos(): MỎ NEO = hình chiếu mỗi camera pano lên way p/s/t/r gần nhất (≤ 14 m, không phải cầu, không nằm
//     trong lòng+1,5 m của way khác = vùng nút). Dịch cần D = dấu(v)·max(0, |v| − a), a = max(0,75, hw − 1,25) — camera
//     chỉ cần nằm TRONG lòng (xe Google đi làn phải: lệch tim ≈ w/4 là đúng thật, KHÔNG kéo tim trùng camera). Trường
//     dịch 2D làm trơn: mỗi mỏ neo ràng buộc THÀNH PHẦN PHÁP TUYẾN (d·n_i = D_i), trọng số nhân K(dọc/45 m)·K(ngang/12 m),
//     K(t) = (1−t²)²; d = (Σw·nnᵀ + λI)⁻¹ Σw·D·n, mờ dần khi Σw < 0,5 → (i) mỏ neo D = 0 GIỮ phố, (ii) nút giao 2 phố
//     vuông góc: phố này dịch, phố kia TRƯỢT dọc chính nó (không gãy), (iii) mọi đỉnh ROADS_DT (kể cả ngõ h, phố nối)
//     dời CÙNG trường → đầu mút chung/chữ T vẫn dính nhau. Đoạn dài được chèn đỉnh mỗi 8 m nơi trường ≠ 0 rồi DP 0,2 m.
//     Dời tối đa 12 m. Log từng way (tên, dịch lớn nhất/TB) ra console + `fitlog`.
import fs from 'fs';
import { ROAD_W, SIDEWALK_W } from '../js/xsection.js';
import { pointInPoly, bbox, Grid } from './bgeom.mjs';

const LON0 = 106.68182, LAT0 = 20.85750;
const UX = 111320 * Math.cos((LAT0 * Math.PI) / 180), UZ = 110574;
// PHẢI khớp tools/process_buildings.mjs (dịch footprint theo nguồn)
const SHIFT = { 'Microsoft ML Buildings': [-1, -1], 'Google Open Buildings': [-1, -2.5], OpenStreetMap: [0, 0] };
const STREET = { p: 1, s: 1, t: 1, r: 1 };
// kẹp bề rộng lòng theo cấp khi suy từ Overture (m)
// (trần s 14 = Tô Hiệu/Trần Phú đo pano; phần tường Overture xa hơn trần → vỉa hè/sân trước rộng hơn, không phải lòng)
export const W_BOUNDS = { p: [10, 20], s: [7, 14], t: [6, 12], r: [4.5, 9] };
// GHI ĐÈ theo bằng chứng pano (AUDIT3 FP-1 §2c + ảnh thật): tên phố (regex) [+ cấp] → lòng w (m) [+ vỉa sw]. Phố ĐÔI
// (2 way một chiều song song) ghi đè là bề rộng MỖI chiều.
export const WIDTH_OVERRIDES = [
  { re: /Bến Bính/, w: 14, why: 'pano_079/382/441: lòng ~14 m (game 8-10)' },
  { re: /Trần Phú/, c: 'st', two: true, w: 14, why: 'pano_040/041/230: ~14 m' },
  { re: /Tô Hiệu/, two: true, w: 14, why: 'pano_170/175/368: ~14 m' },
  { re: /Lý Tự Trọng/, w: 12, why: 'pano_524/525: ~12 m' },
  { re: /Minh Khai/, w: 10.5, why: 'pano_265-273/510: ~10,5 m' },
  { re: /Dư Hàng/, w: 6.5, why: 'pano_184/189: chợ, ~6,5 m' },
  { re: /Hạ Lý/, w: 6, why: 'pano_102-115/445: phố chợ 5-6 m' },
  { re: /Chu Văn An/, w: 6.5, why: 'pano_486-488: ~6-7 m (audit 5,5)' },
  { re: /^Phố Tam Bạc$/, c: 'r', w: 4.5, why: 'pano_519/336: ngõ ven sông ~4,5 m' },
];

function parseCSVLine(L) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < L.length; i++) {
    const ch = L[i];
    if (q) { if (ch === '"') { if (L[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}

// Footprint Overture (vòng ngoài, đã dịch nguồn) trong bán kính rMax → { n, inside(x,z), ray(x,z,dx,dz,max) }
export function loadOverture(csvPath, rMax = 2100) {
  if (!fs.existsSync(csvPath)) return null;
  const csv = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/);
  const H = parseCSVLine(csv[0]); const C_WKT = H.indexOf('wkt'), C_SRC = H.indexOf('src');
  const P = [];
  for (let i = 1; i < csv.length; i++) {
    if (!csv[i]) continue;
    const F = parseCSVLine(csv[i]); const m = /\(\(([^()]*)\)/.exec(F[C_WKT] || ''); if (!m) continue;
    const sh = SHIFT[F[C_SRC]] || [0, 0];
    const r = m[1].split(',').map((s) => s.trim().split(/\s+/).map(Number)).map(([lo, la]) => [(lo - LON0) * UX + sh[0], -(la - LAT0) * UZ + sh[1]]);
    r.pop(); if (r.length < 3 || Math.hypot(r[0][0], r[0][1]) > rMax) continue;
    P.push(r);
  }
  const pg = new Grid(16); P.forEach((p, i) => pg.insert(i, bbox(p)));
  const E = [];
  for (const p of P) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; E.push(a[0], a[1], b[0], b[1]); }
  const eg = new Grid(8);
  for (let i = 0; i < E.length / 4; i++) eg.insert(i, [Math.min(E[4 * i], E[4 * i + 2]), Math.min(E[4 * i + 1], E[4 * i + 3]), Math.max(E[4 * i], E[4 * i + 2]), Math.max(E[4 * i + 1], E[4 * i + 3])]);
  const inside = (x, z) => { let h = false; pg.query([x, z, x, z], (i) => { if (!h && pointInPoly(P[i], x, z)) h = true; }); return h; };
  // tia (x,z)+(dx,dz)·t: t của cạnh footprint đầu tiên cắt tia, hoặc null
  const ray = (x, z, dx, dz, max) => {
    const ex = x + dx * max, ez = z + dz * max; let best = max + 1;
    eg.query([Math.min(x, ex), Math.min(z, ez), Math.max(x, ex), Math.max(z, ez)], (i) => {
      const ax = E[4 * i], az = E[4 * i + 1], sx = E[4 * i + 2] - ax, sz = E[4 * i + 3] - az, den = dx * sz - dz * sx;
      if (Math.abs(den) < 1e-9) return;
      const t = ((ax - x) * sz - (az - z) * sx) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) best = t;
    });
    return best <= max ? best : null;
  };
  return { n: P.length, inside, ray };
}

const sdist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-12;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
};
const quant = (a, f) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
function segIndex(roads, cls) {
  const segs = [];
  roads.forEach((r, ri) => { if (cls && !cls.includes(r.c)) return; for (let i = 0; i + 1 < r.pts.length; i++) segs.push([ri, i, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]]); });
  const g = new Grid(32);
  segs.forEach((s, i) => g.insert(i, [Math.min(s[2], s[4]), Math.min(s[3], s[5]), Math.max(s[2], s[4]), Math.max(s[3], s[5])]));
  // khoảng cách tới way KHÁC ri gần nhất (≤ d), hoặc Infinity
  const nearOther = (ri, x, z, d) => { let m = Infinity; g.query([x - d, z - d, x + d, z + d], (i) => { const s = segs[i]; if (s[0] === ri) return; const q = sdist(x, z, s[2], s[3], s[4], s[5]); if (q < m) m = q; }); return m; };
  return { segs, g, nearOther };
}

// A. tường nhà Overture 2 bên mỗi way p/s/t/r
export function measureWalls(roads, ov, { step = 5, maxRay = 30, rMax = 2000 } = {}) {
  const idx = segIndex(roads, null);
  return roads.map((r, ri) => {
    if (!STREET[r.c] || !ov) return null;
    if (!r.pts.some(([x, z]) => Math.hypot(x, z) < rMax)) return null;
    const W = [], st = []; let nSt = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      for (let s = step / 2; s < L; s += step) {
        const x = ax + ux * s, z = az + uz * s; nSt++;
        if (idx.nearOther(ri, x, z, 14) < 14 || ov.inside(x, z)) continue;
        const dl = ov.ray(x, z, nx, nz, maxRay), dr = ov.ray(x, z, -nx, -nz, maxRay);
        if (dl != null && dr != null) { W.push(dl + dr); st.push({ x, z, ux, uz, nx, nz, W: dl + dr, m: (dl - dr) / 2 }); }
      }
    }
    return { nSt, n: W.length, W25: quant(W, 0.25), W50: quant(W, 0.5), st };
  });
}

// đường ĐÔI: way một chiều có way một chiều khác (p/s/t/r, cùng tên nếu cả 2 có tên) SONG SONG ngược chiều 6-24 m ở giữa way
export function dualPartner(roads, ri) {
  const r = roads[ri]; if (r.tags?.oneway !== 'yes') return null;
  const L = r.pts.reduce((s, p, i, a) => s + (i ? Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0);
  let acc = 0, mid = null;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], l = Math.hypot(bx - ax, bz - az);
    if (acc + l >= L / 2) { const t = (L / 2 - acc) / (l || 1); mid = [ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / (l || 1), (bz - az) / (l || 1)]; break; }
    acc += l;
  }
  if (!mid) return null;
  let best = null;
  roads.forEach((o, oi) => {
    if (oi === ri || !STREET[o.c] || o.tags?.oneway !== 'yes') return;
    if (r.name && o.name && r.name !== o.name) return;   // 2 phố một chiều KHÁC tên song song ≠ đường đôi
    for (let i = 0; i + 1 < o.pts.length; i++) {
      const [ax, az] = o.pts[i], [bx, bz] = o.pts[i + 1], l = Math.hypot(bx - ax, bz - az); if (l < 1) continue;
      const d = sdist(mid[0], mid[1], ax, az, bx, bz); if (d < 6 || d > 24) continue;
      const cos = ((bx - ax) * mid[2] + (bz - az) * mid[3]) / l;
      if (cos > -0.94) continue;   // ngược chiều, song song ±20°
      if (!best || d < best.d) best = { oi, d };
    }
  });
  return best;
}

// B. bề rộng lòng/vỉa từng way → [{w, sw, src}] (w = 0: mặc định cấp)
export function chooseWidths(roads, walls) {
  const out = roads.map(() => ({ w: 0, sw: -1, src: 'class' }));
  const fromW = (c, W) => {
    const [lo, hi] = W_BOUNDS[c]; const sw0 = SIDEWALK_W[c];
    let sw = Math.min(sw0 + 2.5, Math.max(sw0, 0.2 * W));
    let w = W - 2 * sw;
    if (w > hi) { w = hi; sw = Math.min(sw0 + 4, (W - w) / 2); }
    if (w < lo) { w = lo; sw = Math.max(1.0, Math.min(sw0, (W - w) / 2)); }
    return { w: Math.round(w * 10) / 10, sw: Math.round(sw * 10) / 10 };
  };
  // gộp theo tên + cấp: trạm của mọi way cùng tên (W25 có trọng số số trạm ~ lấy phân vị trên tập ghép xấp xỉ bằng trung vị W25)
  const byName = new Map();
  roads.forEach((r, ri) => {
    const m = walls[ri]; if (!m || !r.name || m.n < 3) return;
    const k = r.c + '|' + r.name; const a = byName.get(k) || []; a.push(m); byName.set(k, a);
  });
  const nameW = (r) => {
    const a = byName.get(r.c + '|' + r.name); if (!a) return null;
    const n = a.reduce((s, m) => s + m.n, 0); if (n < 10) return null;
    const ws = []; for (const m of a) for (let k = 0; k < m.n; k += 4) ws.push(m.W25);   // trọng số ~ số trạm
    return quant(ws, 0.5);
  };
  roads.forEach((r, ri) => {
    if (!STREET[r.c]) return;
    const o = out[ri];
    const dual = dualPartner(roads, ri);
    const ov = WIDTH_OVERRIDES.find((q) => q.re.test(r.name || '') && (!q.c || q.c.includes(r.c)));
    if (ov) {
      // phố đôi: ghi đè 'two' = TỔNG bề rộng 2 chiều → mỗi chiều w/2 (tối thiểu 6); không 'two' → mỗi way w
      const w = dual && ov.two ? Math.max(6, ov.w / 2) : ov.w;
      const m = walls[ri];
      let sw = -1;
      if (m && m.n >= 6 && !dual) sw = Math.round(Math.max(1.0, Math.min(SIDEWALK_W[r.c] + 3, (m.W25 - w) / 2)) * 10) / 10;
      Object.assign(o, { w, sw, src: 'pano' + (dual ? '-dual' : '') });
      return;
    }
    const tw = parseFloat(r.tags?.width);
    if (tw >= 3 && tw <= 30) { Object.assign(o, { w: Math.max(tw, W_BOUNDS[r.c][0]), src: 'osm-width' }); return; }   // xe Google đi qua → ≥ sàn cấp
    if (dual) { o.src = 'dual'; return; }   // nửa đường đôi: tia Overture đo cả 2 chiều → giữ mặc định cấp
    const m = walls[ri];
    if (m && m.n >= 6 && m.n >= 0.12 * m.nSt) { Object.assign(o, fromW(r.c, m.W25), { src: 'overture' }); return; }
    const nw = nameW(r);
    if (nw) { Object.assign(o, fromW(r.c, nw), { src: 'overture-name' }); return; }
  });
  return out;
}

// B2. KẸP sau khớp tim: lòng không được nuốt nhà thật — (i) nửa lòng ≤ phân vị 10% khoảng tường gần nhất (min 2 bên) đo
// trên tim ĐÃ dịch (lòng trùm footprint Overture ở > 10% trạm = quá rộng/lệch), (ii) lòng + vỉa không vào đa giác địa danh
// LM_POLY (Bưu điện: lòng rộng mới từng trùm 56 m² nhà thật). Không bao giờ hẹp hơn mặc định cấp.
export function capWidths(roads, widths, walls, polys = [], panos = []) {
  const stat = { wall: 0, lm: 0 };
  // camera pano ĐANG trong lòng way (theo bề rộng trước kẹp) → lòng phải còn chứa nó (|d| + 0,9 m nửa thân xe): pano là
  // bằng chứng mạnh hơn tường Overture (phố dài: vài đoạn tường sát tim kéo phân vị xuống — Phan Đình Phùng 12 → 8 m
  // từng đẩy 6 camera ra ngoài bó vỉa)
  const need = new Float32Array(roads.length);
  const idx = segIndex(roads, 'pstr');
  for (const [px, pz] of panos) {
    let best = null;
    idx.g.query([px - 14, pz - 14, px + 14, pz + 14], (i) => { const s = idx.segs[i]; const d = sdist(px, pz, s[2], s[3], s[4], s[5]); if (!best || d < best.d) best = { d, ri: s[0] }; });
    if (!best) continue;
    const o = widths[best.ri], hwNow = (o.w > 0 ? o.w : ROAD_W[roads[best.ri].c] ?? 5.5) / 2;
    if (best.d < hwNow) need[best.ri] = Math.max(need[best.ri], Math.min(hwNow, best.d + 0.9));
  }
  roads.forEach((r, ri) => {
    const o = widths[ri]; if (!STREET[r.c] || !(o.w > 0)) return;
    const hw0 = (ROAD_W[r.c] ?? 5.5) / 2;
    let hw = o.w / 2, sw = o.sw >= 0 ? o.sw : SIDEWALK_W[r.c];
    const m = walls[ri];
    if (m && m.st && m.st.length >= 6) {
      const near = m.st.map((q) => Math.min(q.W / 2 + q.m, q.W / 2 - q.m));
      const q10 = quant(near, 0.1);
      if (q10 != null && hw > q10 - 0.3) { const h = Math.max(hw0, need[ri], q10 - 0.3); if (h < hw) { sw += hw - h; hw = h; stat.wall++; } }
    }
    let dmin = Infinity;
    let rx0 = 1e9, rz0 = 1e9, rx1 = -1e9, rz1 = -1e9; for (const [x, z] of r.pts) { rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); rz0 = Math.min(rz0, z); rz1 = Math.max(rz1, z); }
    const pad = hw + sw + 2;
    for (const P of polys) {
      const pb = bbox(P); if (pb[0] > rx1 + pad || pb[2] < rx0 - pad || pb[1] > rz1 + pad || pb[3] < rz0 - pad) continue;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        for (const [x, z] of P) dmin = Math.min(dmin, sdist(x, z, ax, az, bx, bz));
        // cạnh đa giác cắt qua tim: lấy mẫu cạnh 1 m
        for (let k = 0; k < P.length; k++) {
          const [px, pz] = P[k], [qx, qz] = P[(k + 1) % P.length], L = Math.hypot(qx - px, qz - pz);
          for (let t = 0.5; t < L; t += 1) dmin = Math.min(dmin, sdist(px + ((qx - px) * t) / L, pz + ((qz - pz) * t) / L, ax, az, bx, bz));
        }
      }
    }
    if (dmin < hw + sw) {
      const h = Math.max(hw0, Math.min(hw, dmin - 0.3)), s = Math.max(Math.min(sw, SIDEWALK_W[r.c]), dmin - h);
      if (h < hw || s < sw) { hw = h; sw = Math.max(1, Math.min(sw, s)); stat.lm++; }
    }
    o.w = Math.round(hw * 20) / 10; if (o.sw >= 0 || sw !== SIDEWALK_W[r.c]) o.sw = Math.round(sw * 10) / 10;
  });
  return stat;
}

// C. trường dịch tim theo vết xe pano
export function fitToPanos(roads, panos, widths, walls, { Ra = 45, Rb = 12, maxShift = 12, wallCap = 3, log = null } = {}) {
  const hwOf = (ri) => (widths[ri].w > 0 ? widths[ri].w : ROAD_W[roads[ri].c] ?? 5.5) / 2;
  const isDual = roads.map((r, ri) => (STREET[r.c] ? !!dualPartner(roads, ri) : false));
  // tim giữa 2 bức tường Overture quanh điểm (x,z) của way ri (lệch so với tim hiện tại, + = pháp tuyến trái), hoặc null.
  // Chỉ trạm có W ≤ 1,25·W25 của way (bức tường phố liền, không phải khe/sân lùi), ≥ 3 trạm trong ±rad m. Đường đôi: null
  // (tia đo qua chiều kia). Đo kiểm 237 pano: vector TB (tim tường − camera) = (0,17; 0,11) m, trung vị |.| 1,6 m (= lệch làn)
  // → tường Overture và vết xe Google KHỚP nhau, tim OSM mới là cái lệch.
  const midAt = (ri, x, z, rad = 15) => {
    const m = walls[ri]; if (!m || !m.st || isDual[ri] || !m.W25) return null;
    const a = [];
    for (const q of m.st) if (q.W <= 1.25 * m.W25 && Math.hypot(q.x - x, q.z - z) <= rad) a.push(q.m);
    // ≥ 4 trạm và nhất quán (khoảng tứ phân vị ≤ 2,5 m) — 3 trạm lệch nhau (sân lùi 1 bên) từng kéo tim 7 m (pano_362)
    if (a.length < 4 || quant(a, 0.75) - quant(a, 0.25) > 2.5) return null;
    return quant(a, 0.5);
  };
  const idx = segIndex(roads, 'pstr');
  const all = segIndex(roads, null); idx.gAll = all.g; idx.segsAll = all.segs;
  const anchors = [], cands = [];
  const skipped = { far: 0, junction: 0, bridge: 0 };
  for (const [px, pz, pid] of panos) {
    let best = null;
    idx.g.query([px - 14, pz - 14, px + 14, pz + 14], (i) => {
      const [ri, k, ax, az, bx, bz] = idx.segs[i];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 1) return;
      const t = ((px - ax) * dx + (pz - az) * dz) / L2; if (t < -0.02 || t > 1.02) return;
      const Ls = Math.sqrt(L2), v = ((px - ax) * -dz + (pz - az) * dx) / Ls;
      if (Math.abs(v) <= 14 && (!best || Math.abs(v) < Math.abs(best.v))) best = { ri, k, v, x: ax + dx * t, z: az + dz * t, ux: dx / Ls, uz: dz / Ls };
    });
    if (!best) { skipped.far++; continue; }
    // ngõ h / phố đi bộ w SONG SONG (±37°) GẦN HƠN phố p/s/t/r → camera đứng trong ngõ đó (pano_115: ngõ song song Hạ Lý
    // cách 10,5 m) → bỏ hẳn. Ngõ CẮT ngang (miệng ngõ cạnh camera, Chu Văn An pano_486/488) không tính.
    let alley = false;
    idx.gAll.query([px - 14, pz - 14, px + 14, pz + 14], (i) => {
      const s = idx.segsAll[i]; if (alley || STREET[roads[s[0]].c]) return;
      const L = Math.hypot(s[4] - s[2], s[5] - s[3]); if (L < 1) return;
      if (Math.abs(((s[4] - s[2]) * best.ux + (s[5] - s[3]) * best.uz) / L) < 0.8) return;
      if (sdist(px, pz, s[2], s[3], s[4], s[5]) < Math.abs(best.v) - 0.5) alley = true;
    });
    if (alley) { skipped.alley = (skipped.alley || 0) + 1; continue; }
    const hw = hwOf(best.ri), a = Math.max(0.75, hw - 1.25);
    // đích: tim giữa 2 tường Overture (nếu tin được), kẹp sao cho camera vẫn TRONG lòng (|v − D| ≤ a); không có → dời ít nhất
    // dời TỐI THIỂU để camera vào lòng; tim tường chỉ được kéo thêm ≤ 3 m quanh đó (nhiễu tường 1 bên/sân lùi)
    const D0 = Math.max(best.v - a, Math.min(best.v + a, 0));
    const mid = midAt(best.ri, best.x, best.z);
    const tgt = mid == null ? D0 : Math.max(D0 - wallCap, Math.min(D0 + wallCap, mid));
    const C = { pid, ...best, nx: -best.uz, nz: best.ux, a, mid, D: Math.max(best.v - a, Math.min(best.v + a, tgt)) };
    cands.push(C);
    const r = roads[best.ri];
    if (r.tags?.bridge || +(r.tags?.layer || 0) >= 1 || /^Cầu /.test(r.name || '')) { skipped.bridge++; continue; }   // cầu/dốc cầu: W3-F (mặt cầu nâng)
    // camera trong lòng (+1,5 m) của way p/s/t/r KHÁC = vùng nút giao → không ràng buộc (vẫn là "phiếu" nhất quán bên dưới)
    let inJn = false;
    idx.g.query([px - 16, pz - 16, px + 16, pz + 16], (i) => {
      const s = idx.segs[i]; if (inJn || s[0] === best.ri) return;
      if (sdist(px, pz, s[2], s[3], s[4], s[5]) < hwOf(s[0]) + 1.5) inJn = true;
    });
    if (inJn) { skipped.junction++; continue; }
    anchors.push(C);
  }
  // NHẤT QUÁN dọc way (phiếu = mọi camera chiếu lên CÙNG way trong 90 m, kể cả camera vùng nút): mỏ neo đòi dời |D| > 1,5
  // bị bỏ nếu phiếu NGƯỢC dấu (|v| > 1) nhiều hơn phiếu cùng dấu (|v| > 0,6|v_A|) → camera ở làn/ngõ khác hoặc toạ độ lỗi.
  // Mỏ neo đơn lẻ (không phiếu nào) chỉ tin tới 6 m. Mỏ neo D = 0 (camera đã trong lòng) chỉ GIỮ phố nhẹ (trọng số 0,5).
  for (const A of anchors) {
    A.wt = A.D === 0 && A.mid == null ? 0.5 : 1;
    if (Math.abs(A.D) <= 1.5 || Math.abs(A.v) <= hwOf(A.ri) + 1) continue;   // chỉ nghi camera NGOÀI lòng (+1 m)
    let pro = 0, con = 0;
    for (const B of cands) {
      if (B === A || B.ri !== A.ri || Math.hypot(B.x - A.x, B.z - A.z) > 90) continue;
      if (Math.sign(B.v) === Math.sign(A.v) && Math.abs(B.v) > 0.6 * Math.abs(A.v)) pro++;
      else if (Math.sign(B.v) !== Math.sign(A.v) && Math.abs(B.v) > 1) con++;
    }
    if (con > pro) A.drop = 'contradicted';
    else if (!pro && !con && Math.abs(A.D) > 6) A.drop = 'isolated>6';
  }
  // MỎ NEO TƯỜNG (không có pano): mỗi 10 m dọc way p/s/t/r (không phải đường đôi) nơi tim tường Overture tin được, cách
  // mỏ neo pano cùng way > 30 m: D = tim tường kẹp ±wallCap m, trọng số 0,6 → mặt tiền 2 bên đối xứng như thật.
  let nWall = 0;
  roads.forEach((r, ri) => {
    const m = walls[ri]; if (!STREET[r.c] || !m || !m.st || isDual[ri] || r.tags?.bridge || /^Cầu /.test(r.name || '')) return;
    for (let j = 0; j < m.st.length; j += 2) {
      const q = m.st[j];
      if (anchors.some((A) => A.ri === ri && !A.wall && Math.hypot(A.x - q.x, A.z - q.z) < 30)) continue;
      const mid = midAt(ri, q.x, q.z, 12); if (mid == null) continue;
      anchors.push({ pid: 'wall', wall: true, ri, x: q.x, z: q.z, ux: q.ux, uz: q.uz, nx: q.nx, nz: q.nz, v: 0, a: 0, mid, wt: 0.6,
        D: Math.max(-wallCap, Math.min(wallCap, mid)) });
      nWall++;
    }
  });
  skipped.wallAnchors = nWall;
  for (let i = anchors.length - 1; i >= 0; i--) if (anchors[i].drop) { skipped[anchors[i].drop] = (skipped[anchors[i].drop] || 0) + 1; (skipped.list ||= []).push(anchors[i].pid + ':' + anchors[i].ri + ':' + anchors[i].D.toFixed(1)); anchors.splice(i, 1); }
  const ag = new Grid(48); anchors.forEach((A, i) => ag.insert(i, [A.x - Ra, A.z - Ra, A.x + Ra, A.z + Ra]));
  const K = (t) => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));
  // Tikhonov λ = 0,2·vết(M): ràng buộc gần SONG SONG mà mâu thuẫn (2 phố lệch 20° muốn dời ngược nhau) không được khuếch
  // đại theo phương yếu; nhân (vết+λ)/vết để 1 ràng buộc đơn lẻ vẫn ra đúng D; kẹp |d| ≤ max|D| các mỏ neo góp phần.
  const field = (x, z) => {
    let m00 = 0, m01 = 0, m11 = 0, b0 = 0, b1 = 0, sw = 0, dmax = 0;
    ag.query([x, z, x, z], (i) => {
      const A = anchors[i], dx = x - A.x, dz = z - A.z;
      const w = A.wt * K(Math.abs(dx * A.ux + dz * A.uz) / Ra) * K(Math.abs(dx * A.nx + dz * A.nz) / Rb); if (w <= 0) return;
      m00 += w * A.nx * A.nx; m01 += w * A.nx * A.nz; m11 += w * A.nz * A.nz; b0 += w * A.D * A.nx; b1 += w * A.D * A.nz; sw += w;
      if (Math.abs(A.D) > dmax) dmax = Math.abs(A.D);
    });
    if (!dmax) return [0, 0];
    const tr = m00 + m11, lambda = 0.2 * tr + 1e-6;
    const a00 = m00 + lambda, a11 = m11 + lambda, det = a00 * a11 - m01 * m01;
    const g = ((tr + lambda) / tr) * Math.min(1, sw / 0.5);
    let dx = ((a11 * b0 - m01 * b1) / det) * g, dz = ((a00 * b1 - m01 * b0) / det) * g;
    const L = Math.hypot(dx, dz), cap = Math.min(maxShift, dmax);
    if (L > cap) { dx *= cap / L; dz *= cap / L; }
    return [dx, dz];
  };
  // Douglas-Peucker nhẹ để bỏ đỉnh chèn thừa (giữ 2 đầu)
  const dp = (pts, tol) => {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = sdist(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]); if (d > md) { md = d; mi = i; } }
      if (md > tol) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  const r1 = (v) => Math.round(v * 10) / 10;
  const perWay = [];
  roads.forEach((r, ri) => {
    const P = r.pts; const out = [];
    let maxD = 0, sumD = 0, nD = 0, moved = false;
    for (let i = 0; i < P.length; i++) {
      const [x, z] = P[i];
      const d = field(x, z); out.push([x + d[0], z + d[1], d]);
      if (i + 1 < P.length) {
        const [bx, bz] = P[i + 1], L = Math.hypot(bx - x, bz - z), n = Math.floor(L / 8);
        // chèn đỉnh mỗi 8 m CHỈ khi trường khác 0 trên đoạn (đoạn thẳng không ảnh hưởng giữ nguyên 2 đỉnh)
        const mids = [];
        let nonzero = false;
        for (let k = 1; k <= n; k++) { const t = k / (n + 1), qx = x + (bx - x) * t, qz = z + (bz - z) * t; const dq = field(qx, qz); mids.push([qx + dq[0], qz + dq[1], dq]); if (dq[0] || dq[1]) nonzero = true; }
        if (nonzero) out.push(...mids);
      }
    }
    for (const q of out) { const L = Math.hypot(q[2][0], q[2][1]); if (L > 0.05) { moved = true; maxD = Math.max(maxD, L); sumD += L; nD++; } }
    if (!moved) return;
    let pts = out.map((q) => [r1(q[0]), r1(q[1])]);
    pts = dp(pts, 0.2);
    r.pts = pts;
    perWay.push({ ri, c: r.c, name: r.name || '', maxD: +maxD.toFixed(2), meanD: +(sumD / nD).toFixed(2) });
  });
  perWay.sort((a, b) => b.maxD - a.maxD);
  const res = { anchors: anchors.filter((A) => !A.wall).length, wallAnchors: nWall, skipped, active: anchors.filter((A) => !A.wall && A.D !== 0).length, moved: perWay.length, perWay,
    anchorList: anchors.filter((A) => !A.wall).map((A) => ({ pid: A.pid, ri: A.ri, name: roads[A.ri].name || '', c: roads[A.ri].c, v: +A.v.toFixed(2), a: +A.a.toFixed(2), mid: A.mid == null ? null : +A.mid.toFixed(2), D: +A.D.toFixed(2) })) };
  if (log) fs.writeFileSync(log, JSON.stringify(res, null, 1));
  return res;
}
