// landuse.js — MẶT ĐẤT THEO SỬ DỤNG ĐẤT (Đợt 3 wave 2 W2-D): hết "khoảng đất be trống".
// Dữ liệu: js/landuse_data.js (sinh bởi tools/gen_landuse.mjs) = raster LỚP 2048² × 2 m quanh gốc (±2048 m), nén deflate.
// Lúc chạy (WORKER, không chặn luồng chính): giải nén → tô footprint nhà ĐANG SỐNG (world.rbData, đã trừ D.dead) thành lớp
// BLD → khoảng cách tới tường gần nhất (chamfer 2 lượt) → texture RG8 (R = lớp, G = khoảng cách ×8 m, trần 31,9 m).
// Shader (onBeforeCompile trên MeshLambertMaterial vertexColors của ground_local / lake_ground / hosen_ground): 4 mẫu
// NEAREST quanh điểm + nội suy song tuyến có nhiễu (biên lớp tự nhiên, không bậc thang 2 m) → màu từng lớp từ các mẫu chi
// tiết thủ tục (DataArrayTexture 3 lớp sinh trong worker: bê tông tấm/gạch lát/gạch đỏ/đất | cỏ/nhựa/vết ố/vết nứt | nhiễu
// vĩ mô) theo TOẠ ĐỘ THẾ GIỚI. Lớp URB (nền phố) đổi theo khoảng cách: sát tường bê tông ố → sân bê tông → bãi trống
// (đất + cỏ dại + mảng bê tông). Lớp NAT/nước/bờ: giữ màu đỉnh vertexHC (cát, đáy, đồi...).
// Không có texture (WebGL1, chưa xong worker, trình duyệt thiếu DecompressionStream) → màu đỉnh như cũ (uLuOn = 0).
// HỢP ĐỒNG LỚP: chỉ số trong LU_META.classes (tools/gen_landuse.mjs) = các hằng C_* trong GLSL dưới đây.
import { LU_META, LU_CLS } from './landuse_data.js';

export const LU = LU_META.classes;
export const LU_GRID = { n: LU_META.n, res: LU_META.res, x0: LU_META.x0, z0: LU_META.z0 };

// ======================= phần THUẦN JS (chạy trong worker + node) =======================
// bỏ lọc "Up" (byte + byte hàng trên)
export function luUnfilter(a, n) { for (let i = n; i < a.length; i++) a[i] = (a[i] + a[i - n]) & 255; return a; }

// cls (Uint8Array n² ĐÃ bỏ lọc) + footprint sống → Uint8Array RG (n²·2). Sửa cls tại chỗ (tô BLD).
// fp = { x, z: Float32Array (m), vStart: Uint32Array, dead: Uint8Array|null, nB }
export function luCompose(cls, fp, grid) {
  const { n, res, x0, z0 } = grid, BLD = 15, POOL = 13;
  // (1) tô footprint sống (even-odd, tâm điểm ảnh) — nhà nằm trên bể bơi OSM (bể có mái) không đè
  if (fp && fp.nB) {
    const xs = new Float64Array(64);
    for (let b = 0; b < fp.nB; b++) {
      if (fp.dead && fp.dead[b]) continue;
      const s = fp.vStart[b], e = fp.vStart[b + 1];
      if (e - s < 3) continue;
      let zmin = 1e9, zmax = -1e9;
      for (let v = s; v < e; v++) { const z = fp.z[v]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
      const j0 = Math.max(0, Math.ceil((zmin - z0) / res - 0.5)), j1 = Math.min(n - 1, Math.floor((zmax - z0) / res - 0.5));
      for (let j = j0; j <= j1; j++) {
        const zc = z0 + (j + 0.5) * res;
        let k = 0;
        for (let a = s, p = e - 1; a < e; p = a++) {
          const za = fp.z[a], zb = fp.z[p];
          if ((za > zc) !== (zb > zc) && k < 64) xs[k++] = fp.x[a] + (zc - za) * (fp.x[p] - fp.x[a]) / (zb - za);
        }
        if (k < 2) continue;
        // sắp xếp chèn (k nhỏ)
        for (let a = 1; a < k; a++) { const v = xs[a]; let q = a - 1; while (q >= 0 && xs[q] > v) { xs[q + 1] = xs[q]; q--; } xs[q + 1] = v; }
        for (let q = 0; q + 1 < k; q += 2) {
          const i0 = Math.max(0, Math.ceil((xs[q] - x0) / res - 0.5)), i1 = Math.min(n - 1, Math.floor((xs[q + 1] - x0) / res - 0.5));
          const row = j * n;
          for (let i = i0; i <= i1; i++) if (cls[row + i] !== POOL) cls[row + i] = BLD;
        }
      }
    }
  }
  // (2) khoảng cách tới BLD: chamfer 3×3 (1, √2) hai lượt, đơn vị điểm ảnh ×10 (Uint16, trần 6000)
  const N2 = n * n, d = new Uint16Array(N2), CAP = 6000, A = 10, B = 14;
  for (let i = 0; i < N2; i++) d[i] = cls[i] === BLD ? 0 : CAP;
  for (let j = 0; j < n; j++) {
    const r = j * n;
    for (let i = 0; i < n; i++) {
      const o = r + i; let v = d[o];
      if (v === 0) continue;
      if (i > 0 && d[o - 1] + A < v) v = d[o - 1] + A;
      if (j > 0) {
        if (d[o - n] + A < v) v = d[o - n] + A;
        if (i > 0 && d[o - n - 1] + B < v) v = d[o - n - 1] + B;
        if (i < n - 1 && d[o - n + 1] + B < v) v = d[o - n + 1] + B;
      }
      d[o] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    const r = j * n;
    for (let i = n - 1; i >= 0; i--) {
      const o = r + i; let v = d[o];
      if (v === 0) continue;
      if (i < n - 1 && d[o + 1] + A < v) v = d[o + 1] + A;
      if (j < n - 1) {
        if (d[o + n] + A < v) v = d[o + n] + A;
        if (i < n - 1 && d[o + n + 1] + B < v) v = d[o + n + 1] + B;
        if (i > 0 && d[o + n - 1] + B < v) v = d[o + n - 1] + B;
      }
      d[o] = v;
    }
  }
  // (3) MẬT ĐỘ NHÀ: tỉ lệ điểm ảnh BLD trong ô vuông ±R (≈ ±40 m) — ảnh tích phân (Float64: tổng tới 4,2 triệu) → 0..15.
  //     Phân biệt "khoảng trống giữa phố dày" (sân lát/bãi xe) với "đất trống ven đô" (đất + cỏ dại).
  const RD = Math.max(1, Math.round(40 / res)), I = new Float64Array((n + 1) * (n + 1)), n1 = n + 1;
  for (let j = 0; j < n; j++) {
    let row = 0;
    for (let i = 0; i < n; i++) { row += cls[j * n + i] === BLD ? 1 : 0; I[(j + 1) * n1 + i + 1] = I[j * n1 + i + 1] + row; }
  }
  // (4) đóng gói RG8: R = lớp | mật độ<<4, G = khoảng cách (m) ×8 — khoảng cách đo từ TÂM điểm ảnh nhà → trừ nửa ô (mép tường)
  const out = new Uint8Array(N2 * 2), k8 = (res / A) * 8, half = res * 0.5 * 8;
  for (let i = 0; i < N2; i++) {
    const x = i % n, y = (i - x) / n;
    const xa = Math.max(0, x - RD), xb = Math.min(n, x + RD + 1), ya = Math.max(0, y - RD), yb = Math.min(n, y + RD + 1);
    const cnt = I[yb * n1 + xb] - I[ya * n1 + xb] - I[yb * n1 + xa] + I[ya * n1 + xa];
    const dens = Math.min(15, Math.round(cnt / ((xb - xa) * (yb - ya)) * 15 / 0.6));   // 60 % phủ nhà = bão hoà
    out[i * 2] = cls[i] | (dens << 4);
    const g = d[i] === 0 ? 0 : d[i] * k8 - half;
    out[i * 2 + 1] = g <= 0 ? 0 : g >= 255 ? 255 : g + 0.5;
  }
  return out;
}

// ---------- texture chi tiết thủ tục (tileable, 3 lớp RGBA, giá trị = "mẫu" 0..1, KHÔNG phải màu) ----------
// lớp 0 (4 m/ô): R bê tông tấm 2 m (mạch, rỗ, nứt) | G gạch lát đá 0,5 m | B gạch đỏ 0,25×0,125 | A đất nện (sỏi, cục)
// lớp 1 (4 m/ô): R cỏ (lá + khóm) | G nhựa/sỏi | B vết ố/loang (dầu, ẩm) | A vết nứt + rác vụn
// lớp 2 (vĩ mô, lặp): R,G,B,A = 4 nhiễu fbm độc lập tần số khác nhau (trộn mảng, đổi tông)
export function luGenDetail(S) {
  const P = S * S * 4, data = new Uint8Array(P * 3);
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const vnoise = (period) => {
    const G = new Float32Array(period * period); for (let i = 0; i < G.length; i++) G[i] = rnd();
    const out = new Float32Array(S * S), sc = period / S;
    for (let y = 0; y < S; y++) {
      const fy = y * sc, ay = Math.floor(fy), ty0 = fy - ay, ty = ty0 * ty0 * (3 - 2 * ty0), y0 = (ay % period) * period, y1 = ((ay + 1) % period) * period;
      for (let x = 0; x < S; x++) {
        const fx = x * sc, ax = Math.floor(fx), tx0 = fx - ax, tx = tx0 * tx0 * (3 - 2 * tx0), x0 = ax % period, x1 = (ax + 1) % period;
        const a = G[y0 + x0], b = G[y0 + x1], c = G[y1 + x0], d = G[y1 + x1];
        out[y * S + x] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      }
    }
    return out;
  };
  const fbm = (periods, weights) => {
    const out = new Float32Array(S * S); let ws = 0;
    periods.forEach((p, i) => { const nn = vnoise(p); ws += weights[i]; for (let k = 0; k < out.length; k++) out[k] += nn[k] * weights[i]; });
    for (let k = 0; k < out.length; k++) out[k] /= ws;
    return out;
  };
  const wrap = (v) => ((v % S) + S) % S;
  const dot = (F, cx, cy, r, fn) => {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 > r2) continue;
      const o = wrap(y) * S + wrap(x); F[o] = fn(F[o], 1 - d2 / r2);
    }
  };
  const crack = (F, x, y, len, w, depth) => {
    let a = rnd() * Math.PI * 2;
    for (let i = 0; i < len; i++) {
      a += (rnd() - 0.5) * 0.8; x += Math.cos(a) * 1.1; y += Math.sin(a) * 1.1;
      dot(F, x, y, w, (v, k) => v * (1 - depth * Math.min(1, k * 1.8)));
      if (rnd() < 0.03) crack(F, x, y, len * 0.3 | 0, w * 0.7, depth);
    }
  };
  const px = S / 512;
  const put = (layer, ch, F) => { const off = layer * P + ch; for (let i = 0; i < S * S; i++) { const v = F[i] * 255; data[off + i * 4] = v < 0 ? 0 : v > 255 ? 255 : v + 0.5; } };

  // ---- lớp 0 ----
  { // R: bê tông tấm 2 m (4 m/ô = 2×2 tấm)
    const n1 = fbm([8, 16, 32, 64], [1, 0.7, 0.5, 0.35]), n2 = fbm([4], [1]);
    const F = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) F[i] = 0.62 + (n1[i] - 0.5) * 0.32 + (rnd() - 0.5) * 0.07;
    const slab = S / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {   // tông mỗi tấm hơi khác + mạch
      const tx = Math.floor(x / slab), ty = Math.floor(y / slab), h = Math.sin(tx * 12.99 + ty * 78.23 + 3.1) * 43758.5; const tone = (h - Math.floor(h) - 0.5) * 0.1;
      const ex = Math.min(x % slab, slab - (x % slab)), ey = Math.min(y % slab, slab - (y % slab)), e = Math.min(ex, ey);
      const o = y * S + x;
      F[o] += tone + (n2[o] - 0.5) * 0.08;
      if (e < 1.5 * px) F[o] *= 0.45; else if (e < 3 * px) F[o] *= 0.85;
    }
    for (let i = 0; i < (S * S / 300 | 0); i++) dot(F, rnd() * S, rnd() * S, (0.5 + rnd() * 1.2) * px, (v, k) => v - 0.18 * k);   // rỗ
    for (let i = 0; i < 7; i++) crack(F, rnd() * S, rnd() * S, (60 + rnd() * 180) * px | 0, 0.8 * px, 0.45);
    put(0, 0, F);
  }
  { // G: gạch đá lát 0,5 m (8×8 viên / 4 m), tông từng viên + vân + mạch
    const n1 = fbm([16, 64], [1, 0.5]), F = new Float32Array(S * S), t = S / 8;
    const tone = []; for (let i = 0; i < 64; i++) tone.push((rnd() - 0.5) * 0.16 + (rnd() < 0.08 ? -0.12 : 0));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const tx = Math.floor(x / t), ty = Math.floor(y / t), fx = (x % t) / t, fy = (y % t) / t, e = Math.min(fx, fy, 1 - fx, 1 - fy);
      const o = y * S + x;
      let v = 0.66 + tone[ty * 8 + tx] + (n1[o] - 0.5) * 0.12 + (rnd() - 0.5) * 0.08;
      if (e < 0.025) v *= 0.5; else if (e < 0.06) v *= 0.9;
      F[o] = v;
    }
    put(0, 1, F);
  }
  { // B: gạch đỏ xếp so le 0,25 × 0,125 m (16 × 32 viên / 4 m)
    const n1 = fbm([32], [1]), F = new Float32Array(S * S), bw = S / 16, bh = S / 32;
    for (let y = 0; y < S; y++) {
      const r = Math.floor(y / bh), off = (r % 2) * bw * 0.5;
      for (let x = 0; x < S; x++) {
        const xx = (x + off) % S, c = Math.floor(xx / bw), fx = (xx % bw) / bw, fy = (y % bh) / bh;
        const h = Math.sin(c * 91.7 + r * 47.3) * 43758.5, tone = (h - Math.floor(h) - 0.5) * 0.22;
        const e = Math.min(fx * 2, (1 - fx) * 2, fy, 1 - fy);
        const o = y * S + x;
        let v = 0.62 + tone + (n1[o] - 0.5) * 0.1 + (rnd() - 0.5) * 0.08;
        if (e < 0.07) v *= 0.55;
        F[o] = v;
      }
    }
    put(0, 2, F);
  }
  { // A: đất nện: loang + sỏi sáng + cục tối
    const n1 = fbm([4, 8, 16, 32, 64], [1, 0.8, 0.6, 0.45, 0.3]), F = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) F[i] = 0.55 + (n1[i] - 0.5) * 0.45 + (rnd() - 0.5) * 0.1;
    for (let i = 0; i < (S * S / 140 | 0); i++) { const add = rnd() < 0.6 ? 0.22 : -0.2; dot(F, rnd() * S, rnd() * S, (0.6 + rnd() * 1.8) * px, (v, k) => v + add * Math.min(1, k * 2)); }
    put(0, 3, F);
  }
  // ---- lớp 1 ----
  { // R: cỏ — lá dọc ngắn + khóm
    const n1 = fbm([8, 32, 128], [1, 0.6, 0.5]), F = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) F[i] = 0.5 + (n1[i] - 0.5) * 0.5;
    for (let i = 0; i < (S * S / 18 | 0); i++) {
      const x = rnd() * S, y = rnd() * S, l = (2 + rnd() * 5) * px, a = rnd() * Math.PI, b = rnd() < 0.5 ? 0.25 : -0.22;
      for (let s = 0; s < l; s++) { const o = wrap(Math.round(y + Math.sin(a) * s)) * S + wrap(Math.round(x + Math.cos(a) * s)); F[o] = Math.min(1, Math.max(0, F[o] + b * 0.6)); }
    }
    put(1, 0, F);
  }
  { // G: nhựa / sỏi (bãi đỗ xe): cốt liệu mịn + đá lộ
    const n1 = fbm([16, 48], [1, 0.6]), F = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) F[i] = 0.55 + (n1[i] - 0.5) * 0.18 + (rnd() - 0.5) * 0.2;
    for (let i = 0; i < (S * S / 90 | 0); i++) { const add = rnd() < 0.6 ? 0.25 : -0.25; dot(F, rnd() * S, rnd() * S, (0.5 + rnd() * 1.1) * px, (v, k) => v + add * Math.min(1, k * 2)); }
    put(1, 1, F);
  }
  { // B: vết ố / loang (1 = sạch, nhỏ hơn = ố): cụm dầu, mảng ẩm
    const F = new Float32Array(S * S).fill(1);
    for (let i = 0; i < 26; i++) {
      const cx = rnd() * S, cy = rnd() * S, nn = 3 + (rnd() * 6 | 0), sp = (8 + rnd() * 30) * px, dk = 0.12 + rnd() * 0.22;
      for (let j = 0; j < nn; j++) dot(F, cx + (rnd() - 0.5) * sp, cy + (rnd() - 0.5) * sp, (4 + rnd() * 18) * px, (v, k) => v * (1 - dk * Math.min(1, k * 1.5)));
    }
    put(1, 2, F);
  }
  { // A: vết nứt + rác vụn (1 = sạch)
    const F = new Float32Array(S * S).fill(1);
    for (let i = 0; i < 9; i++) crack(F, rnd() * S, rnd() * S, (50 + rnd() * 160) * px | 0, 0.7 * px, 0.6);
    for (let i = 0; i < 60; i++) { const b = rnd() < 0.5 ? 1.35 : 0.6; dot(F, rnd() * S, rnd() * S, (1 + rnd() * 2.5) * px, (v, k) => v * (1 + (b - 1) * Math.min(1, k * 2))); }
    for (let i = 0; i < S * S; i++) F[i] *= 0.74;   // 0.74 = sạch (chừa đầu > 1 cho rác sáng)
    put(1, 3, F);
  }
  // ---- lớp 2: nhiễu vĩ mô ----
  put(2, 0, fbm([2, 4, 8], [1, 0.6, 0.35]));
  put(2, 1, fbm([3, 6, 12], [1, 0.7, 0.4]));
  put(2, 2, fbm([4, 8, 16, 32], [1, 0.6, 0.4, 0.3]));
  put(2, 3, fbm([6, 12, 24], [1, 0.6, 0.4]));
  return data;
}

// ======================= worker =======================
function workerSrc() {
  return [luUnfilter, luCompose, luGenDetail].map((f) => 'const ' + f.name + ' = ' + f.toString() + ';').join('\n') + `
onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.kind === 'detail') { const d = luGenDetail(m.S); postMessage({ kind: 'detail', data: d }, [d.buffer]); return; }
    const bin = atob(m.b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const ab = await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    const t0 = performance.now();
    const cls = luUnfilter(new Uint8Array(ab), m.grid.n);
    const rg = luCompose(cls, m.fp, m.grid);
    postMessage({ kind: 'map', data: rg, ms: performance.now() - t0 }, [rg.buffer]);
  } catch (err) { postMessage({ kind: 'error', msg: String(err && err.message || err) }); }
};`;
}

// ======================= shader =======================
const PARS = /* glsl */`
uniform sampler2D tLuMap;
uniform highp sampler2DArray tLuDet;
uniform float uLuOn;
uniform vec4 uLuGrid;   // x0, z0, res, n
varying vec3 vLuW;
const float C_NAT = 0.0, C_URB = 1.0, C_IND = 2.0, C_PLAZA = 3.0, C_TEMPLE = 4.0, C_CAMPUS = 5.0, C_PARK = 6.0, C_DIRT = 7.0,
  C_GRASS = 8.0, C_ROUGH = 9.0, C_TURF = 10.0, C_COURT = 11.0, C_TRACK = 12.0, C_POOL = 13.0, C_MARKET = 14.0, C_BLD = 15.0;
vec3 luS2L(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
// màu 1 lớp (tuyến tính). d0 = mẫu lớp 0 (bê tông, gạch lát, gạch đỏ, đất), d1 = lớp 1 (cỏ, nhựa, ố, nứt), m = vĩ mô, md = vĩ mô vừa
vec3 luClass(float c, float dist, float dens, vec2 w, vec4 d0, vec4 d1, vec4 m, vec4 md, vec3 vcol) {
  float stain = d1.b, crk = d1.a / 0.74;
  if (c < 0.5) return vcol;
  if (c < 1.5 || c > 14.5) {
    // NỀN PHỐ (+ trong nhà): bê tông tấm xám; sát tường (≤1,5 m) ố ẩm + rêu; sân ≥3 m đôi chỗ lát gạch block.
    // BÃI TRỐNG (đất nện + mảng cỏ dại + mảng bê tông sót) CHỈ ở nơi THƯA nhà (mật độ ±40 m < ~25 %) và xa tường —
    // khoảng trống giữa phố dày ngoài đời là sân lát / bãi xe, không phải đất hoang (ảnh vệ tinh: xám tối).
    vec3 conc = luS2L(vec3(146.0, 143.0, 137.0)) * (0.55 + 0.75 * d0.r) * mix(0.8, 1.08, m.g) * mix(0.72, 1.0, stain) * min(crk, 1.15);
    conc *= mix(vec3(1.0), vec3(1.04, 1.0, 0.93), smoothstep(0.5, 0.8, md.b));   // mảng bụi đất ngả vàng
    float grime = 1.0 - smoothstep(0.2, 1.6, dist);
    conc *= mix(1.0, 0.7, grime);
    conc = mix(conc, conc * vec3(0.9, 0.95, 0.85), grime * md.a);               // rêu chân tường
    float yard = smoothstep(2.5, 5.0, dist);
    vec3 tiles = luS2L(vec3(156.0, 152.0, 144.0)) * (0.62 + 0.6 * d0.g) * mix(0.9, 1.04, m.g);
    conc = mix(conc, tiles, yard * smoothstep(0.62, 0.7, m.b * 0.7 + md.r * 0.45));
    float vac = smoothstep(6.0, 14.0, dist + (md.r - 0.5) * 8.0) * (1.0 - smoothstep(0.12, 0.35, dens + (m.a - 0.5) * 0.15));
    if (vac < 0.01) return conc;
    vec3 dirt = luS2L(vec3(146.0, 126.0, 100.0)) * (0.6 + 0.7 * d0.a) * mix(0.85, 1.1, m.b);
    vec3 weed = luS2L(vec3(90.0, 104.0, 58.0)) * (0.55 + 0.9 * d1.r) * mix(0.8, 1.15, md.g);
    float wv = smoothstep(0.46, 0.6, md.g * 0.75 + m.a * 0.45 + smoothstep(14.0, 30.0, dist) * 0.2);
    vec3 lot = mix(dirt, weed, wv);
    lot = mix(lot, conc * 0.95, smoothstep(0.58, 0.7, md.b * 0.8 + m.r * 0.4));   // mảng bê tông/sân cũ còn sót
    return mix(conc, lot, vac);
  }
  if (c < 2.5) {   // CÔNG NGHIỆP / CẢNG: bê tông tấm lớn bạc + ố dầu + gỉ
    vec3 b = luS2L(vec3(146.0, 144.0, 138.0)) * (0.55 + 0.7 * d0.r) * mix(0.85, 1.08, m.r) * mix(0.62, 1.0, stain) * min(crk, 1.1);
    return mix(b, b * vec3(1.1, 0.92, 0.78), smoothstep(0.6, 0.8, md.a) * 0.5);
  }
  if (c < 3.5) {   // QUẢNG TRƯỜNG: đá lát xám sáng
    return luS2L(vec3(170.0, 168.0, 162.0)) * (0.62 + 0.6 * d0.g) * mix(0.9, 1.04, m.g) * mix(0.88, 1.0, stain);
  }
  if (c < 4.5) {   // SÂN CHÙA/ĐỀN: gạch đỏ Bát Tràng + rêu
    vec3 b = luS2L(vec3(150.0, 84.0, 62.0)) * (0.6 + 0.65 * d0.b) * mix(0.85, 1.05, m.g);
    return mix(b, b * vec3(0.8, 0.88, 0.75), smoothstep(0.55, 0.8, md.a) * 0.6);
  }
  if (c < 5.5) {   // SÂN TRƯỜNG / CƠ QUAN: bê tông sáng + gạch block
    vec3 a = luS2L(vec3(160.0, 157.0, 148.0)) * (0.6 + 0.7 * d0.r) * mix(0.88, 1.06, m.g) * mix(0.85, 1.0, stain) * min(crk, 1.1);
    vec3 t = luS2L(vec3(165.0, 160.0, 150.0)) * (0.62 + 0.6 * d0.g);
    return mix(a, t, smoothstep(0.45, 0.6, md.b));
  }
  if (c < 6.5) {   // BÃI ĐỖ XE: nhựa sẫm + ố dầu
    return luS2L(vec3(96.0, 96.0, 98.0)) * (0.65 + 0.6 * d1.g) * mix(0.9, 1.08, m.r) * mix(0.7, 1.0, stain) * min(crk, 1.1);
  }
  if (c < 7.5) {   // ĐẤT NỆN / CÔNG TRƯỜNG
    vec3 b = luS2L(vec3(152.0, 130.0, 102.0)) * (0.6 + 0.7 * d0.a) * mix(0.82, 1.1, m.b);
    vec3 wd = luS2L(vec3(102.0, 110.0, 66.0)) * (0.6 + 0.8 * d1.r);
    return mix(b, wd, smoothstep(0.62, 0.78, md.g * 0.8 + m.a * 0.3) * 0.7);
  }
  if (c < 8.5) {   // CỎ công viên: xanh ngả vàng, mảng mòn đất
    vec3 g = luS2L(vec3(92.0, 118.0, 58.0)) * (0.6 + 0.8 * d1.r) * mix(0.82, 1.12, m.g) * mix(vec3(1.0), vec3(1.08, 1.02, 0.85), md.b);
    vec3 worn = luS2L(vec3(132.0, 118.0, 90.0)) * (0.6 + 0.7 * d0.a);
    return mix(g, worn, smoothstep(0.66, 0.82, md.r * 0.8 + m.a * 0.3) * 0.75);
  }
  if (c < 9.5) {   // CỎ DẠI / BỤI / RUỘNG
    vec3 g = luS2L(vec3(86.0, 100.0, 56.0)) * (0.55 + 0.9 * d1.r) * mix(0.75, 1.15, md.g);
    vec3 b = luS2L(vec3(128.0, 112.0, 86.0)) * (0.6 + 0.7 * d0.a);
    return mix(g, b, smoothstep(0.55, 0.75, md.r * 0.7 + m.b * 0.4) * 0.6);
  }
  if (c < 10.5) {  // SÂN BÓNG CỎ NHÂN TẠO: sọc cắt 5 m
    float st = step(0.5, fract((w.x + w.y) * 0.1));
    return luS2L(vec3(64.0, 122.0, 66.0)) * mix(0.9, 1.06, st) * (0.85 + 0.3 * d1.r);
  }
  if (c < 11.5) {  // SÂN TENNIS / BÓNG RỔ: sơn acrylic xanh lá
    return luS2L(vec3(66.0, 116.0, 92.0)) * (0.9 + 0.2 * d1.g) * mix(0.92, 1.03, m.g);
  }
  if (c < 12.5) {  // ĐƯỜNG CHẠY cao su đỏ
    return luS2L(vec3(168.0, 74.0, 58.0)) * (0.88 + 0.24 * d1.g);
  }
  if (c < 13.5) {  // BỂ BƠI: gạch men xanh
    return luS2L(vec3(70.0, 160.0, 196.0)) * (0.7 + 0.45 * d0.g);
  }
  // CHỢ: bê tông bẩn ẩm
  vec3 b = luS2L(vec3(128.0, 122.0, 112.0)) * (0.55 + 0.7 * d0.r) * mix(0.6, 1.0, stain) * min(crk, 1.2);
  return b * mix(0.85, 1.05, m.r);
}
`;
const MAIN = /* glsl */`
  {
    vec3 vcol = diffuseColor.rgb;
    vec2 w = vLuW.xz;
    float dry = smoothstep(1.25, 1.75, vLuW.y) * uLuOn;
    vec2 g = (w - uLuGrid.xy) / uLuGrid.z - 0.5;
    if (dry > 0.0 && g.x > 0.0 && g.y > 0.0 && g.x < uLuGrid.w - 1.0 && g.y < uLuGrid.w - 1.0) {
      vec4 d0 = texture(tLuDet, vec3(w * 0.25, 0.0));
      vec4 d1 = texture(tLuDet, vec3(w * 0.25 + vec2(0.31, 0.57), 1.0));
      vec4 m = texture(tLuDet, vec3(w * (1.0 / 96.0), 2.0));
      vec4 md = texture(tLuDet, vec3(w * (1.0 / 23.0) + vec2(0.43, 0.19), 2.0));
      vec2 b = floor(g), f = g - b;
      float inv = 1.0 / uLuGrid.w;
      vec2 t = (b + 0.5) * inv;
      vec4 s00 = texture(tLuMap, t), s10 = texture(tLuMap, t + vec2(inv, 0.0)), s01 = texture(tLuMap, t + vec2(0.0, inv)), s11 = texture(tLuMap, t + vec2(inv));
      float r00 = floor(s00.r * 255.0 + 0.5), r10 = floor(s10.r * 255.0 + 0.5), r01 = floor(s01.r * 255.0 + 0.5), r11 = floor(s11.r * 255.0 + 0.5);
      float c00 = mod(r00, 16.0), c10 = mod(r10, 16.0), c01 = mod(r01, 16.0), c11 = mod(r11, 16.0);
      float dens = mix(mix(floor(r00 / 16.0), floor(r10 / 16.0), f.x), mix(floor(r01 / 16.0), floor(r11 / 16.0), f.x), f.y) * (1.0 / 15.0);
      // khoảng cách: song tuyến THẬT (trường trơn)
      float dist = mix(mix(s00.g, s10.g, f.x), mix(s01.g, s11.g, f.x), f.y) * (255.0 / 8.0);
      vec3 col;
      if (c00 == c10 && c00 == c01 && c00 == c11) {
        col = luClass(c00, dist, dens, w, d0, d1, m, md, vcol);
      } else {
        // biên lớp: trọng số song tuyến + nhiễu (~1 m) rồi làm sắc → mép tự nhiên, không bậc thang ô 2 m
        vec2 fn = clamp(f + (vec2(md.a, d0.a) - 0.5) * 0.55 + (vec2(d1.r, d1.g) - 0.5) * 0.25, 0.0, 1.0);
        fn = smoothstep(0.32, 0.68, fn);
        float w00 = (1.0 - fn.x) * (1.0 - fn.y), w10 = fn.x * (1.0 - fn.y), w01 = (1.0 - fn.x) * fn.y, w11 = fn.x * fn.y;
        vec3 ka = luClass(c00, dist, dens, w, d0, d1, m, md, vcol);
        vec3 kb = c10 == c00 ? ka : luClass(c10, dist, dens, w, d0, d1, m, md, vcol);
        vec3 kc = c01 == c00 ? ka : (c01 == c10 ? kb : luClass(c01, dist, dens, w, d0, d1, m, md, vcol));
        vec3 kd = c11 == c00 ? ka : (c11 == c10 ? kb : (c11 == c01 ? kc : luClass(c11, dist, dens, w, d0, d1, m, md, vcol)));
        col = ka * w00 + kb * w10 + kc * w01 + kd * w11;
      }
      diffuseColor.rgb = mix(vcol, col, dry);
    }
  }
`;

// WebGL1 (không RG8 / sampler2DArray): giữ màu đỉnh — material vẫn hợp lệ.
function patch(sh, renderer, uni) {
  if (renderer && renderer.capabilities && renderer.capabilities.isWebGL2 === false) return false;
  Object.assign(sh.uniforms, uni);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vLuW;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLuW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + MAIN);
  return true;
}

// makeGroundSystem(THREE, {lite, anisotropy}) → { material(opts), start(fp) , uniforms, stats }
//   material({polygonOffset:[f,u]}) — MeshLambertMaterial vertexColors, cùng chương trình shader (customProgramCacheKey)
//   start(fp) — chạy worker dựng raster (gọi 1 lần khi world.rbData sẵn sàng; fp = null → không có nhà thường)
export function makeGroundSystem(THREE, opt = {}) {
  const n = LU_GRID.n, S = opt.lite ? 256 : 512;
  const stats = { detailMs: 0, mapMs: 0, mapWorkerMs: 0, ready: false, error: null };
  // splat RG8 NEAREST (R = lớp | mật độ<<4, G = khoảng cách ×8; nội suy làm trong shader) — cấp phát đúng kích thước NGAY (cập nhật sau = texSubImage, không đổi kích thước)
  const mapTex = new THREE.DataTexture(new Uint8Array(n * n * 2), n, n, THREE.RGFormat, THREE.UnsignedByteType);
  mapTex.magFilter = mapTex.minFilter = THREE.NearestFilter; mapTex.generateMipmaps = false;
  mapTex.wrapS = mapTex.wrapT = THREE.ClampToEdgeWrapping; mapTex.colorSpace = THREE.NoColorSpace; mapTex.unpackAlignment = 2;
  mapTex.needsUpdate = true;
  // chi tiết: placeholder xám giữa (0,5) cùng kích thước → worker thay
  const det = new Uint8Array(S * S * 4 * 3).fill(128);
  for (let i = 0; i < S * S; i++) { det[S * S * 4 + i * 4 + 2] = 255; det[S * S * 4 + i * 4 + 3] = 189; }   // ố = sạch, nứt = sạch
  const detTex = new THREE.DataArrayTexture(det, S, S, 3);
  detTex.format = THREE.RGBAFormat; detTex.type = THREE.UnsignedByteType; detTex.colorSpace = THREE.NoColorSpace;
  detTex.wrapS = detTex.wrapT = THREE.RepeatWrapping;
  detTex.magFilter = THREE.LinearFilter; detTex.minFilter = THREE.LinearMipmapLinearFilter; detTex.generateMipmaps = true;
  detTex.anisotropy = opt.anisotropy || 8;
  detTex.needsUpdate = true;
  const uniforms = {
    tLuMap: { value: mapTex }, tLuDet: { value: detTex }, uLuOn: { value: 0 },
    uLuGrid: { value: new THREE.Vector4(LU_GRID.x0, LU_GRID.z0, LU_GRID.res, n) },
  };
  const key = 'landuse-v2' + (opt.lite ? '-lite' : '');
  function material(mo = {}) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (mo.polygonOffset) { m.polygonOffset = true; m.polygonOffsetFactor = mo.polygonOffset[0]; m.polygonOffsetUnits = mo.polygonOffset[1]; }
    m.onBeforeCompile = (sh, renderer) => { m.userData.webgl1 = !patch(sh, renderer, uniforms); };
    m.customProgramCacheKey = () => key;
    m.name = 'landuse_ground';
    return m;
  }
  let worker = null, pending = 0;
  const done = () => { if (--pending <= 0 && worker) { worker.terminate(); worker = null; } };
  function getWorker() {
    if (worker) return worker;
    const url = URL.createObjectURL(new Blob([workerSrc()], { type: 'text/javascript' }));
    worker = new Worker(url); URL.revokeObjectURL(url);
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'detail') { detTex.image.data = m.data; detTex.needsUpdate = true; stats.detailMs = performance.now() - tDet; }
      else if (m.kind === 'map') {
        mapTex.image.data = m.data; mapTex.needsUpdate = true; uniforms.uLuOn.value = 1;
        stats.mapMs = performance.now() - tMap; stats.mapWorkerMs = m.ms; stats.ready = true;
      } else if (m.kind === 'error') stats.error = m.msg;
      done();
    };
    worker.onerror = (e) => { e.preventDefault && e.preventDefault(); stats.error = 'worker'; pending = 0; worker.terminate(); worker = null; };
    return worker;
  }
  const canWork = typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof DecompressionStream !== 'undefined';
  let tDet = performance.now(), tMap = 0;
  if (canWork) { try { pending++; getWorker().postMessage({ kind: 'detail', S }); } catch (e) { stats.error = String(e); } }
  else stats.error = 'no Worker/DecompressionStream';
  let started = false;
  function start(fp) {
    if (started || !canWork) return; started = true;
    tMap = performance.now();
    // sao chép (không chuyển quyền): D vẫn được các hệ khác dùng
    const f = fp ? { x: fp.x.slice(), z: fp.z.slice(), vStart: fp.vStart.slice(), dead: fp.dead ? fp.dead.slice() : null, nB: fp.nB } : null;
    try {
      pending++;
      getWorker().postMessage({ kind: 'map', b64: LU_CLS, grid: LU_GRID, fp: f }, f ? [f.x.buffer, f.z.buffer, f.vStart.buffer] : []);
    } catch (e) { stats.error = String(e); }
  }
  return { material, start, uniforms, stats, mapTex, detTex };
}
