// landuse.js — MẶT ĐẤT THEO SỬ DỤNG ĐẤT (Đợt 3 wave 2 W2-D): hết "khoảng đất be trống".
// Dữ liệu: js/landuse_data.js (sinh bởi tools/gen_landuse.mjs) = raster LỚP 2048² × 2 m quanh gốc (±2048 m), nén deflate.
// Lúc chạy (WORKER, không chặn luồng chính): giải nén → tô claim 'plaza'/'park' + bao nhà ô giữ + footprint nhà ĐANG SỐNG
// (world.rbData, đã trừ D.dead) thành lớp BLD → khoảng cách tới tường gần nhất (chamfer 2 lượt) + mật độ nhà ±40 m →
// texture RG8 (R = lớp | mật độ<<4, G = khoảng cách ×8 m, trần 31,9 m) + texture ĐỘ PHỦ thô R8 256² (16 m, tỉ lệ nhà ±96 m:
// 0 = ngoài vải phố → "phố xa" xám trung tính thay vì bãi cỏ dại).
// Shader (onBeforeCompile trên MeshLambertMaterial vertexColors của ground_local / ground_lake / ground_hosen): 4 texelFetch
// quanh điểm → trọng số song tuyến có nhiễu → lớp THẮNG (argmax; biên lớp = đường đồng mức trơn của chỉ thị song tuyến,
// không bậc thang 2 m) → gọi luClass MỘT lần (bản đầu gọi tới 4 lần → +1,2 s biên dịch HLSL lúc khởi động, phản biện).
// Màu lớp từ mẫu chi tiết thủ tục (DataArrayTexture 3 lớp sinh trong worker) theo TOẠ ĐỘ THẾ GIỚI; mặt nạ mảng lớn (bãi
// trống, cỏ dại, bụi, mảng lát) lấy từ M = trộn 2 mẫu vĩ mô 96 m + 151 m xoay 37° (không lặp thấy được); mẫu 23 m chỉ cho
// chi tiết mịn. Lớp URB đổi theo khoảng cách/mật độ/độ phủ: sát tường bê tông ố → sân bê tông → bãi trống (đất + cỏ dại)
// → "phố xa" (màu đỉnh khử bão hoà + loang). 170 m cuối trước ±LOCAL_HALF hoà dần về màu đỉnh (= tấm thô bên ngoài, không
// có đường nối). Lớp NAT/nước/bờ: giữ màu đỉnh vertexHC (cát, đáy, đồi...).
// Không có texture (WebGL1, chưa xong worker, trình duyệt thiếu DecompressionStream) → màu đỉnh như cũ (uLuOn = 0).
// HỢP ĐỒNG LỚP: chỉ số trong LU_META.classes (tools/gen_landuse.mjs) = các hằng C_* trong GLSL dưới đây.
import { LU_META, LU_CLS } from './landuse_data.js';
import { claimsAll } from './claims.js';

export const LU = LU_META.classes;
export const LU_GRID = { n: LU_META.n, res: LU_META.res, x0: LU_META.x0, z0: LU_META.z0 };

// ======================= phần THUẦN JS (chạy trong worker + node) =======================
// bỏ lọc "Up" (byte + byte hàng trên)
export function luUnfilter(a, n) { for (let i = n; i < a.length; i++) a[i] = (a[i] + a[i - n]) & 255; return a; }

// cls (Uint8Array n² ĐÃ bỏ lọc) + footprint sống → { rg: Uint8Array n²·2 (R = lớp | mật độ<<4, G = khoảng cách ×8),
// cov: Uint8Array (n/8)² (độ phủ nhà ±96 m, 255 = ≥10 %) }. Sửa cls tại chỗ (tô BLD).
// fp = { x, z: Float32Array (m), vStart: Uint32Array, dead: Uint8Array|null, nB }
// extra = { plaza: [[[x,z],...],...], park: [...], bld: [...] } — đa giác chạy lúc chạy: claim 'plaza'/'park' (vùng mở mà
// WP2 đã giết nhà thật: quảng trường, hành lang, kè, công viên) đổi nền phố URB → đá lát / cỏ; 'bld' (bao lồi nhà ô tay
// GIỮ — world.cellKept) tính là NHÀ cho khoảng cách/mật độ.
export function luCompose(cls, fp, grid, extra = null) {
  const { n, res, x0, z0 } = grid, BLD = 15, POOL = 13, URB = 1;
  const fillPoly = (P, val, onlyFrom) => {
    let zmin = 1e9, zmax = -1e9;
    for (const p of P) { if (p[1] < zmin) zmin = p[1]; if (p[1] > zmax) zmax = p[1]; }
    const j0 = Math.max(0, Math.ceil((zmin - z0) / res - 0.5)), j1 = Math.min(n - 1, Math.floor((zmax - z0) / res - 0.5));
    const xs = [];
    for (let j = j0; j <= j1; j++) {
      const zc = z0 + (j + 0.5) * res; xs.length = 0;
      for (let a = 0, b = P.length - 1; a < P.length; b = a++) {
        const za = P[a][1], zb = P[b][1];
        if ((za > zc) !== (zb > zc)) xs.push(P[a][0] + (zc - za) * (P[b][0] - P[a][0]) / (zb - za));
      }
      xs.sort((p, q) => p - q);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((xs[q] - x0) / res - 0.5)), i1 = Math.min(n - 1, Math.floor((xs[q + 1] - x0) / res - 0.5));
        for (let i = i0; i <= i1; i++) { const o = j * n + i; if (onlyFrom < 0 || cls[o] === onlyFrom) cls[o] = val; }
      }
    }
  };
  if (extra) {
    for (const P of extra.park || []) fillPoly(P, 8, URB);
    for (const P of extra.plaza || []) fillPoly(P, 3, URB);
    for (const P of extra.bld || []) fillPoly(P, BLD, -1);
  }
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
  // (3) MẬT ĐỘ NHÀ: tỉ lệ điểm ảnh BLD trong ô vuông ±R (≈ ±40 m) — ảnh tích phân → 0..15.
  //     Phân biệt "khoảng trống giữa phố dày" (sân lát/bãi xe) với "đất trống ven đô" (đất + cỏ dại).
  //     Int32 (tổng ≤ n² = 4,2 triệu): 16,8 MB tạm thay vì 33,6 MB Float64.
  const RD = Math.max(1, Math.round(40 / res)), I = new Int32Array((n + 1) * (n + 1)), n1 = n + 1;
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
  // (5) ĐỘ PHỦ THÔ: ô 8×8 điểm ảnh (16 m), tỉ lệ BLD trong ±48 điểm ảnh (±96 m), bão hoà ở 10 % → R8 (shader lọc tuyến tính).
  //     ≈ 0 = không có nhà trong ~200 m (vành ngoài BUILD_RADIUS, lỗ lớn thiếu dữ liệu nhà) → shader vẽ "phố xa".
  const NC = n >> 3, RC = 48, cov = new Uint8Array(NC * NC);
  for (let cj = 0; cj < NC; cj++) for (let ci = 0; ci < NC; ci++) {
    const x = ci * 8 + 4, y = cj * 8 + 4;
    const xa = Math.max(0, x - RC), xb = Math.min(n, x + RC), ya = Math.max(0, y - RC), yb = Math.min(n, y + RC);
    const cnt = I[yb * n1 + xb] - I[ya * n1 + xb] - I[yb * n1 + xa] + I[ya * n1 + xa];
    cov[cj * NC + ci] = Math.min(255, Math.round(cnt / ((xb - xa) * (yb - ya)) / 0.1 * 255));
  }
  return { rg: out, cov };
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
  { // R: bê tông đổ tại chỗ (4 m/ô): mạch cắt CHỈ ở mép ô, mờ + đứt quãng (lưới đều 2 m trông như gạch lát — ảnh thử
    //    cam_yard2), mảng vá chữ nhật lệch tông, rỗ, nứt
    const n1 = fbm([8, 16, 32, 64], [1, 0.7, 0.5, 0.35]), n2 = fbm([4], [1]), nj = fbm([16], [1]);
    const F = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) F[i] = 0.62 + (n1[i] - 0.5) * 0.3 + (n2[i] - 0.5) * 0.1 + (rnd() - 0.5) * 0.07;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const e = Math.min(x, y, S - 1 - x, S - 1 - y), o = y * S + x;
      if (e < 1.2 * px && nj[o] > 0.42) F[o] *= 0.62 + 0.25 * (1 - (nj[o] - 0.42) / 0.58);
    }
    for (let i = 0; i < 5; i++) {   // mảng vá / đổ lại
      const w = (60 + rnd() * 140) * px, h = (40 + rnd() * 110) * px, x0 = rnd() * S, y0 = rnd() * S, k = 1 + (rnd() - 0.45) * 0.16;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = wrap(Math.round(y0 + y)) * S + wrap(Math.round(x0 + x)), edge = Math.min(x, y, w - 1 - x, h - 1 - y) < 1.2 * px;
        F[o] *= edge ? 0.8 : k;
      }
    }
    for (let i = 0; i < (S * S / 300 | 0); i++) dot(F, rnd() * S, rnd() * S, (0.5 + rnd() * 1.2) * px, (v, k) => v - 0.16 * k);   // rỗ
    for (let i = 0; i < 9; i++) crack(F, rnd() * S, rnd() * S, (60 + rnd() * 200) * px | 0, 0.75 * px, 0.4);
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
  { // B: vết ố / loang (1 = sạch, nhỏ hơn = ố): cụm dầu, mảng ẩm — mép RÁCH theo nhiễu (bản đầu: chấm tròn đậm = "chấm bi")
    const F = new Float32Array(S * S).fill(0), nz = fbm([16, 32, 64], [1, 0.7, 0.5]);
    for (let i = 0; i < 22; i++) {
      const cx = rnd() * S, cy = rnd() * S, nn = 3 + (rnd() * 6 | 0), sp = (10 + rnd() * 40) * px, dk = 0.1 + rnd() * 0.16;
      for (let j = 0; j < nn; j++) dot(F, cx + (rnd() - 0.5) * sp, cy + (rnd() - 0.5) * sp, (6 + rnd() * 22) * px, (v, k) => Math.max(v, dk * Math.min(1, k * 1.3)));
    }
    for (let i = 0; i < S * S; i++) F[i] = 1 - F[i] * Math.min(1, Math.max(0, (nz[i] - 0.3) * 2.5));
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
    const r = luCompose(cls, m.fp, m.grid, m.extra);
    postMessage({ kind: 'map', data: r.rg, cov: r.cov, ms: performance.now() - t0 }, [r.rg.buffer, r.cov.buffer]);
  } catch (err) { postMessage({ kind: 'error', msg: String(err && err.message || err) }); }
};`;
}

// ======================= shader =======================
const PARS = /* glsl */`
uniform highp sampler2D tLuMap;      // highp: giải mã byte lớp/mật độ (lowp trên GPU di động làm lệch floor(r·255))
uniform highp sampler2DArray tLuDet;
uniform highp sampler2D tLuCov;
uniform float uLuOn;
uniform float uLuEdge;   // LOCAL_HALF: 170 m cuối hoà về màu đỉnh (tấm thô bên ngoài cùng màu đỉnh → không đường nối)
uniform vec4 uLuGrid;    // x0, z0, res, n
varying vec3 vLuW;
const float C_NAT = 0.0, C_URB = 1.0, C_IND = 2.0, C_PLAZA = 3.0, C_TEMPLE = 4.0, C_CAMPUS = 5.0, C_PARKING = 6.0, C_DIRT = 7.0,
  C_GRASS = 8.0, C_ROUGH = 9.0, C_TURF = 10.0, C_COURT = 11.0, C_TRACK = 12.0, C_POOL = 13.0, C_MARKET = 14.0, C_BLD = 15.0;
vec3 luS2L(vec3 c) { return pow(c / 255.0, vec3(2.2)); }
float luH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// màu 1 lớp (tuyến tính). d0 = mẫu lớp 0 (bê tông, gạch lát, gạch đỏ, đất), d1 = lớp 1 (cỏ, nhựa, ố, nứt),
// M = mặt nạ mảng LỚN không lặp (96 m + 151 m xoay), md = vĩ mô vừa 23 m (CHỈ chi tiết mịn — dùng làm mặt nạ mảng thì lặp
// thành lưới "chữ V" 23 m nhìn từ trên cao, phản biện), cov = độ phủ nhà thô (0 = ngoài vải phố).
vec3 luClass(float c, float dist, float dens, float cov, vec2 w, vec4 d0, vec4 d1, vec4 M, vec4 md, vec3 vcol) {
  float stain = d1.b, crk = d1.a / 0.74;
  if (c < 0.5) return vcol;
  if (c < 1.5 || c > 14.5) {
    // NỀN PHỐ (+ trong nhà): bê tông tấm xám; sát tường (≤1,5 m) ố ẩm + rêu; sân ≥3 m đôi chỗ lát gạch block.
    // BÃI TRỐNG (đất nện + mảng cỏ dại + mảng bê tông sót) CHỈ ở nơi THƯA nhà (mật độ ±40 m < ~25 %) và xa tường;
    // KHÔNG nhà trong ~200 m (cov ≈ 0: vành ngoài BUILD_RADIUS, lỗ thiếu dữ liệu) → "phố xa": màu đỉnh khử bão hoà + loang.
    vec3 conc = luS2L(vec3(134.0, 132.0, 127.0)) * (0.55 + 0.75 * d0.r) * mix(0.8, 1.08, M.g) * mix(0.72, 1.0, stain) * min(crk, 1.15);
    conc *= mix(vec3(1.0), vec3(1.04, 1.0, 0.93), smoothstep(0.5, 0.8, M.b * 0.8 + md.b * 0.2));   // mảng bụi đất ngả vàng
    float grime = 1.0 - smoothstep(0.2, 1.6, dist);
    conc *= mix(1.0, 0.7, grime);
    conc = mix(conc, conc * vec3(0.9, 0.95, 0.85), grime * md.a);               // rêu chân tường
    float yard = smoothstep(2.5, 5.0, dist);
    vec3 tiles = luS2L(vec3(146.0, 142.0, 135.0)) * (0.62 + 0.6 * d0.g) * mix(0.9, 1.04, M.g);
    conc = mix(conc, tiles, yard * smoothstep(0.672, 0.684, M.b * 0.8 + md.r * 0.25));   // mép mảng lát SẮC (ranh đổ/lát thật)
    float far = (1.0 - smoothstep(0.05, 0.4, cov + (M.r - 0.5) * 0.2)) * smoothstep(4.0, 12.0, dist);
    float vac = smoothstep(6.0, 14.0, dist + (M.r - 0.5) * 8.0) * (1.0 - smoothstep(0.12, 0.35, dens + (M.a - 0.5) * 0.15));
    if (vac < 0.01 && far < 0.01) return conc;
    vec3 dirt = luS2L(vec3(140.0, 124.0, 100.0)) * (0.6 + 0.7 * d0.a) * mix(0.85, 1.1, M.b);
    vec3 weed = luS2L(vec3(100.0, 108.0, 66.0)) * (0.6 + 0.8 * d1.r) * mix(0.85, 1.1, M.g);
    // mảng cỏ dại: nhiễu LỚN không lặp quyết định CHỖ, hạt mịn (md 23 m + lá cỏ 4 m) làm mép RÁCH; dải chuyển hẹp (mép
    // mềm 20-50 m nhìn từ cao như vết mờ/sương)
    float wv = smoothstep(0.47, 0.55, M.a * 0.9 + (md.g - 0.5) * 0.16 + (d1.r - 0.5) * 0.2 + smoothstep(14.0, 30.0, dist) * 0.08);
    vec3 lot = mix(dirt, weed, wv);
    lot = mix(lot, conc * 0.95, smoothstep(0.63, 0.67, M.b * 0.75 + M.r * 0.35 + (d0.a - 0.5) * 0.1));   // mảng bê tông/sân cũ còn sót
    // PHỐ XA: trung bình ≈ màu đỉnh khử bão hoà (tấm thô ngoài ±LOCAL_HALF cùng màu đỉnh → hoà mép không lộ).
    // "Ô đất" = lưới xoay 23° ô 26×17 m nắn cong mạnh theo M (mép sắc, KHÔNG viền — viền sẫm đọc thành "đá lát khổng lồ")
    // — mỗi ô 1 tông/1 loại nhẹ (đất bụi, xám, ít cỏ) theo hash, tương phản thấp → mặt bằng ven đô mờ xa; bản loang mềm
    // tương phản cao trước đó trông như sương mù.
    vec3 fb = mix(vcol, vec3(dot(vcol, vec3(0.2126, 0.7152, 0.0722))), 0.45);
    vec2 q = vec2(0.92 * w.x - 0.39 * w.y, 0.39 * w.x + 0.92 * w.y) * vec2(1.0 / 26.0, 1.0 / 17.0) + (vec2(M.r, M.b) - 0.5) * 1.6;
    vec2 qc = floor(q);
    float h1 = luH(qc), h2 = luH(qc + 17.31);
    vec3 fg = fb * (0.7 + 0.5 * d0.r) * mix(0.92, 1.06, h1) * mix(0.9, 1.05, M.g) * mix(0.86, 1.0, stain);
    fg *= h2 < 0.3 ? vec3(1.04, 0.99, 0.92) : (h2 < 0.4 ? vec3(0.94, 1.0, 0.86) : (h2 < 0.6 ? vec3(0.97, 0.98, 1.0) : vec3(1.0)));
    fg = mix(fg, fg * vec3(0.9, 1.0, 0.78), smoothstep(0.64, 0.7, M.a + (d1.r - 0.5) * 0.15) * 0.4);   // cỏ thưa loang qua nhiều ô
    return mix(mix(conc, lot, vac), fg, far);
  }
  if (c < 2.5) {   // CÔNG NGHIỆP / CẢNG: bê tông tấm lớn bạc + ố dầu + gỉ
    vec3 b = luS2L(vec3(136.0, 134.0, 129.0)) * (0.55 + 0.7 * d0.r) * mix(0.85, 1.08, M.r) * mix(0.62, 1.0, stain) * min(crk, 1.1);
    return mix(b, b * vec3(1.1, 0.92, 0.78), smoothstep(0.6, 0.8, M.a * 0.8 + md.a * 0.2) * 0.5);
  }
  if (c < 3.5) {   // QUẢNG TRƯỜNG: đá lát xám sáng
    return luS2L(vec3(160.0, 158.0, 152.0)) * (0.62 + 0.6 * d0.g) * mix(0.9, 1.04, M.g) * mix(0.88, 1.0, stain);
  }
  if (c < 4.5) {   // SÂN CHÙA/ĐỀN: gạch Bát Tràng CŨ — khử bão hoà, sẫm, mốc/rêu (bản đầu: thảm đỏ cam rực 150,84,62);
    //               ~1/5 mảng lát đá xám (vá/lối đi). Chùa Hàng: viền đá do gen_landuse tô (PLAZA), lõi gạch.
    vec3 br = luS2L(vec3(128.0, 94.0, 78.0)) * (0.62 + 0.6 * d0.b) * mix(0.84, 1.05, M.g) * mix(0.86, 1.0, stain);
    br = mix(br, br * vec3(0.82, 0.86, 0.86), smoothstep(0.45, 0.75, M.a * 0.6 + md.a * 0.4) * 0.6);
    br = mix(br, br * vec3(0.84, 0.93, 0.76), smoothstep(0.58, 0.78, M.r) * 0.45);
    vec3 st = luS2L(vec3(150.0, 147.0, 140.0)) * (0.62 + 0.6 * d0.g) * mix(0.86, 1.04, M.g) * mix(0.85, 1.0, stain);
    return mix(br, st, smoothstep(0.6, 0.62, M.b + (md.r - 0.5) * 0.12));
  }
  if (c < 5.5) {   // SÂN TRƯỜNG / CƠ QUAN: bê tông sáng + gạch block
    vec3 a = luS2L(vec3(148.0, 145.0, 138.0)) * (0.6 + 0.7 * d0.r) * mix(0.88, 1.06, M.g) * mix(0.85, 1.0, stain) * min(crk, 1.1);
    vec3 t = luS2L(vec3(152.0, 148.0, 140.0)) * (0.62 + 0.6 * d0.g);
    return mix(a, t, smoothstep(0.45, 0.6, M.b * 0.8 + md.b * 0.2));
  }
  if (c < 6.5) {   // BÃI ĐỖ XE: nhựa sẫm + ố dầu
    return luS2L(vec3(96.0, 96.0, 98.0)) * (0.65 + 0.6 * d1.g) * mix(0.9, 1.08, M.r) * mix(0.7, 1.0, stain) * min(crk, 1.1);
  }
  if (c < 7.5) {   // ĐẤT NỆN / CÔNG TRƯỜNG — công trường OSM cũ nay đã kín nhà (mật độ cao) → sân bê tông như nền phố
    vec3 b = luS2L(vec3(152.0, 130.0, 102.0)) * (0.6 + 0.7 * d0.a) * mix(0.82, 1.1, M.b);
    vec3 wd = luS2L(vec3(102.0, 110.0, 66.0)) * (0.6 + 0.8 * d1.r);
    b = mix(b, wd, smoothstep(0.6, 0.76, M.a * 0.9 + md.g * 0.1) * 0.7);
    vec3 cc = luS2L(vec3(134.0, 132.0, 127.0)) * (0.55 + 0.75 * d0.r) * mix(0.8, 1.08, M.g) * mix(0.72, 1.0, stain) * mix(0.7, 1.0, smoothstep(0.2, 1.6, dist));
    return mix(b, cc, smoothstep(0.18, 0.4, dens + (M.r - 0.5) * 0.15));
  }
  if (c < 8.5) {   // CỎ công viên: xanh ngả vàng, mảng mòn đất
    vec3 g = luS2L(vec3(92.0, 118.0, 58.0)) * (0.6 + 0.8 * d1.r) * mix(0.82, 1.12, M.g) * mix(vec3(1.0), vec3(1.08, 1.02, 0.85), M.b);
    vec3 worn = luS2L(vec3(132.0, 118.0, 90.0)) * (0.6 + 0.7 * d0.a);
    return mix(g, worn, smoothstep(0.64, 0.8, M.r * 0.85 + md.r * 0.25) * 0.75);
  }
  if (c < 9.5) {   // CỎ DẠI / BỤI / RUỘNG
    vec3 g = luS2L(vec3(86.0, 100.0, 56.0)) * (0.55 + 0.9 * d1.r) * mix(0.75, 1.15, M.g * 0.8 + md.g * 0.2);
    vec3 b = luS2L(vec3(128.0, 112.0, 86.0)) * (0.6 + 0.7 * d0.a);
    return mix(g, b, smoothstep(0.55, 0.75, M.r * 0.85 + md.r * 0.25) * 0.6);
  }
  if (c < 10.5) {  // SÂN BÓNG CỎ NHÂN TẠO: sọc cắt 5 m
    float st = step(0.5, fract((w.x + w.y) * 0.1));
    return luS2L(vec3(64.0, 122.0, 66.0)) * mix(0.9, 1.06, st) * (0.85 + 0.3 * d1.r);
  }
  if (c < 11.5) {  // SÂN TENNIS / BÓNG RỔ: sơn acrylic xanh lá
    return luS2L(vec3(66.0, 116.0, 92.0)) * (0.9 + 0.2 * d1.g) * mix(0.92, 1.03, M.g);
  }
  if (c < 12.5) {  // ĐƯỜNG CHẠY cao su đỏ
    return luS2L(vec3(168.0, 74.0, 58.0)) * (0.88 + 0.24 * d1.g);
  }
  if (c < 13.5) {  // BỂ BƠI: gạch men xanh
    return luS2L(vec3(70.0, 160.0, 196.0)) * (0.7 + 0.45 * d0.g);
  }
  // CHỢ: bê tông bẩn ẩm
  vec3 b = luS2L(vec3(128.0, 122.0, 112.0)) * (0.55 + 0.7 * d0.r) * mix(0.6, 1.0, stain) * min(crk, 1.2);
  return b * mix(0.85, 1.05, M.r);
}
`;
const MAIN = /* glsl */`
  {
    vec3 vcol = diffuseColor.rgb;
    vec2 w = vLuW.xz;
    // mẫu chi tiết lấy NGOÀI mọi nhánh (đạo hàm ngầm của texture() chỉ xác định trong luồng điều khiển đồng nhất)
    vec4 d0 = texture(tLuDet, vec3(w * 0.25, 0.0));
    vec4 m = texture(tLuDet, vec3(w * (1.0 / 96.0), 2.0));
#ifdef LU_LITE
    // LITE (TIER ≤ 1): 2 mẫu chi tiết + 1 texelFetch raster gần nhất (biên lớp bậc 2 m, đủ cho máy yếu)
    vec4 d1 = vec4(0.5, 0.5, 1.0, 0.74), md = m.gbar, M = m;
#else
    vec4 d1 = texture(tLuDet, vec3(w * 0.25 + vec2(0.31, 0.57), 1.0));
    vec4 md = texture(tLuDet, vec3(w * (1.0 / 23.0) + vec2(0.43, 0.19), 2.0));
    // mẫu vĩ mô thứ 2: chu kỳ 151 m, xoay 36,87° (3-4-5) → M = trộn 2 mẫu → không thấy lặp ở mọi tầm nhìn
    vec4 m2 = texture(tLuDet, vec3(vec2(0.8 * w.x - 0.6 * w.y, 0.6 * w.x + 0.8 * w.y) * (1.0 / 151.0) + vec2(0.37, 0.71), 2.0));
    vec4 M = (m + m2.gbar - 1.0) * 0.7071 + 0.5;
#endif
    float dry = smoothstep(1.25, 1.75, vLuW.y) * uLuOn * (1.0 - smoothstep(uLuEdge - 170.0, uLuEdge - 15.0, max(abs(w.x), abs(w.y))));
    vec2 g = (w - uLuGrid.xy) / uLuGrid.z - 0.5;
    if (dry > 0.0 && g.x >= 0.0 && g.y >= 0.0 && g.x < uLuGrid.w - 1.0 && g.y < uLuGrid.w - 1.0) {
      float cov = textureLod(tLuCov, (g + 0.5) / uLuGrid.w, 0.0).r;
#ifdef LU_LITE
      vec4 s = texelFetch(tLuMap, ivec2(g + 0.5), 0);
      float r0 = floor(s.r * 255.0 + 0.5);
      vec3 col = luClass(mod(r0, 16.0), s.g * (255.0 / 8.0), floor(r0 / 16.0) * (1.0 / 15.0), cov, w, d0, d1, M, md, vcol);
#else
      vec2 b = floor(g), f = g - b;
      ivec2 ib = ivec2(b);
      vec4 s00 = texelFetch(tLuMap, ib, 0), s10 = texelFetch(tLuMap, ib + ivec2(1, 0), 0);
      vec4 s01 = texelFetch(tLuMap, ib + ivec2(0, 1), 0), s11 = texelFetch(tLuMap, ib + ivec2(1, 1), 0);
      vec4 r4 = floor(vec4(s00.r, s10.r, s01.r, s11.r) * 255.0 + 0.5);
      vec4 cs = mod(r4, 16.0), ds = floor(r4 / 16.0);
      // khoảng cách + mật độ: song tuyến THẬT (trường trơn, không lệch nhiễu → vệt ố chân tường đúng chỗ)
      float dist = mix(mix(s00.g, s10.g, f.x), mix(s01.g, s11.g, f.x), f.y) * (255.0 / 8.0);
      float dens = mix(mix(ds.x, ds.y, f.x), mix(ds.z, ds.w, f.x), f.y) * (1.0 / 15.0);
      // LỚP: trọng số song tuyến (lệch nhiễu ≤ 0,45 ô: gợn ~11 m + hạt mịn) → lớp có TỔNG trọng số lớn nhất. Đồng mức 0,5
      // của chỉ thị song tuyến là đường TRƠN (bậc thang ô 2 m thành cạnh xiên thẳng), nhiễu làm mép ráp tự nhiên; lệch
      // < 0,5 ô nên lối 1 điểm ảnh vẫn liền. CHỈ 1 lần gọi luClass (biên dịch HLSL/fxc ~ số lần nội tuyến).
      vec2 fn = clamp(f + clamp((vec2(md.r, md.a) - 0.5) * 1.6 + (vec2(d0.a, d1.r) - 0.5) * 0.7, -0.45, 0.45), 0.0, 1.0);
      vec4 wt = vec4((1.0 - fn.x) * (1.0 - fn.y), fn.x * (1.0 - fn.y), (1.0 - fn.x) * fn.y, fn.x * fn.y);
      float c = cs.x, best = dot(wt, vec4(equal(cs, cs.xxxx)));
      float sb = dot(wt, vec4(equal(cs, cs.yyyy)));
      if (sb > best) { best = sb; c = cs.y; }
      sb = dot(wt, vec4(equal(cs, cs.zzzz)));
      if (sb > best) { best = sb; c = cs.z; }
      sb = dot(wt, vec4(equal(cs, cs.wwww)));
      if (sb > best) { c = cs.w; }
      vec3 col = luClass(c, dist, dens, cov, w, d0, d1, M, md, vcol);
#endif
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

// makeGroundSystem(THREE, {lite, anisotropy, edge}) → { material(opts), start(fp, {cellKept}), uniforms, stats, mapTex, detTex, covTex }
//   edge = LOCAL_HALF (m): 170 m cuối trước |x| hoặc |z| = edge hoà về màu đỉnh (mặc định: không hoà)
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
  const detPlaceholder = () => {
    const det = new Uint8Array(S * S * 4 * 3).fill(128);
    for (let i = 0; i < S * S; i++) { det[S * S * 4 + i * 4 + 2] = 255; det[S * S * 4 + i * 4 + 3] = 189; }   // ố = sạch, nứt = sạch
    return det;
  };
  const detTex = new THREE.DataArrayTexture(detPlaceholder(), S, S, 3);
  detTex.format = THREE.RGBAFormat; detTex.type = THREE.UnsignedByteType; detTex.colorSpace = THREE.NoColorSpace;
  detTex.wrapS = detTex.wrapT = THREE.RepeatWrapping;
  detTex.magFilter = THREE.LinearFilter; detTex.minFilter = THREE.LinearMipmapLinearFilter; detTex.generateMipmaps = true;
  detTex.anisotropy = opt.anisotropy || 8;
  detTex.needsUpdate = true;
  // độ phủ nhà thô (n/8)² R8 LỌC TUYẾN TÍNH (16 m/điểm ảnh) — placeholder 255 = "trong phố" (không vẽ phố xa)
  const NC = n >> 3, covFill = () => new Uint8Array(NC * NC).fill(255);
  const covTex = new THREE.DataTexture(covFill(), NC, NC, THREE.RedFormat, THREE.UnsignedByteType);
  covTex.magFilter = covTex.minFilter = THREE.LinearFilter; covTex.generateMipmaps = false;
  covTex.wrapS = covTex.wrapT = THREE.ClampToEdgeWrapping; covTex.colorSpace = THREE.NoColorSpace; covTex.unpackAlignment = 1;
  covTex.needsUpdate = true;
  const uniforms = {
    tLuMap: { value: mapTex }, tLuDet: { value: detTex }, tLuCov: { value: covTex }, uLuOn: { value: 0 },
    uLuEdge: { value: opt.edge || 1e6 },
    uLuGrid: { value: new THREE.Vector4(LU_GRID.x0, LU_GRID.z0, LU_GRID.res, n) },
  };
  const key = 'landuse-v4' + (opt.lite ? '-lite' : '');
  function material(mo = {}) {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (opt.lite) m.defines = { LU_LITE: '' };
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
        if (m.cov) { covTex.image.data = m.cov; covTex.needsUpdate = true; }
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
  // GIẢI PHÓNG bản CPU của 3 texture sau khi upload (−11 MB heap: 8 MB raster + 3 MB chi tiết + 64 KB độ phủ; gc() ép 391 → 379 MB).
  // Mất/khôi phục ngữ cảnh WebGL: three upload lại mọi texture từ image.data ở lần dùng kế → 'webglcontextrestored'
  // (chạy SAU listener của three, TRƯỚC khung kế) đặt lại placeholder + tắt uLuOn rồi cho worker dựng lại (~0,3 s).
  // ?lufree=0 giữ bản CPU (công cụ đọc raster: mapTex.image.data).
  const RELEASE = opt.release !== false && !(typeof location !== 'undefined' && /[?&]lufree=0/.test(location.search));
  if (RELEASE) {
    const free = (t) => { t.image.data = null; };
    mapTex.onUpdate = free; detTex.onUpdate = free; covTex.onUpdate = free;
    const cv = typeof document !== 'undefined' && document.getElementById ? document.getElementById('scene') : null;
    if (cv) cv.addEventListener('webglcontextrestored', () => {
      uniforms.uLuOn.value = 0;
      mapTex.image.data = new Uint8Array(n * n * 2); mapTex.needsUpdate = true;
      covTex.image.data = covFill(); covTex.needsUpdate = true;
      detTex.image.data = detPlaceholder(); detTex.needsUpdate = true;
      if (canWork) { tDet = performance.now(); pending++; getWorker().postMessage({ kind: 'detail', S }); }
      if (started) { started = false; start(lastFp); }   // lastExtra giữ nguyên
    }, false);
  }
  let started = false, lastFp = null;
  // claim → đa giác (tròn 24 cạnh, hộp xoay theo quy ước world.js)
  const claimPolys = (kind) => {
    const out = [];
    for (const c of claimsAll()) {
      if (c.kind !== kind) continue;
      if (c.type === 'poly') out.push(c.pts.map((p) => [p[0], p[1]]));
      else if (c.type === 'circle') { const P = []; for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; P.push([c.cx + Math.cos(a) * c.r, c.cz + Math.sin(a) * c.r]); } out.push(P); }
      else { const cs = Math.cos(c.rot), sn = Math.sin(c.rot), P = [];
        for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) P.push([c.cx + u * c.hx * cs + v * c.hz * sn, c.cz - u * c.hx * sn + v * c.hz * cs]);
        out.push(P); }
    }
    return out;
  };
  let lastExtra = null;
  function start(fp, ex = {}) {
    if (started || !canWork) return; started = true; lastFp = fp;
    tMap = performance.now();
    if (!lastExtra) {
      lastExtra = { plaza: claimPolys('plaza'), park: claimPolys('park'), bld: (ex.cellKept || []).filter((k) => k.hull && k.hull.length >= 3).map((k) => k.hull) };
      stats.extra = { plaza: lastExtra.plaza.length, park: lastExtra.park.length, bld: lastExtra.bld.length };
    }
    // sao chép (không chuyển quyền): D vẫn được các hệ khác dùng
    const f = fp ? { x: fp.x.slice(), z: fp.z.slice(), vStart: fp.vStart.slice(), dead: fp.dead ? fp.dead.slice() : null, nB: fp.nB } : null;
    try {
      pending++;
      getWorker().postMessage({ kind: 'map', b64: LU_CLS, grid: LU_GRID, fp: f, extra: lastExtra }, f ? [f.x.buffer, f.z.buffer, f.vStart.buffer] : []);
    } catch (e) { stats.error = String(e); }
  }
  return { material, start, uniforms, stats, mapTex, detTex, covTex };
}
