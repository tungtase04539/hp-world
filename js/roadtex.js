// roadtex.js — VẬT LIỆU MẶT ĐƯỜNG (Đợt 3 WP6): 1 DataArrayTexture thủ tục (9 lớp) + 1 MeshPhongMaterial có shader
// vạch kẻ cho TOÀN BỘ mạng đường (roadnet.js): nhựa, bê tông ngõ, 4 kiểu vỉa hè (theo SIDEWALK_BY_ROAD), bó vỉa, nắp
// cống/song chắn rác, lớp "macro" (vết nứt, vá, dầu). Tất cả 1 draw call / ô / loại mesh.
//
// HỢP ĐỒNG ĐỈNH (roadnet.js): position, normal, uv, aSurf=(lớp, mã vạch kẻ MK|seed<<13, hw, d cách bó vỉa), aZeb=(u đầu, u cuối)
// - Lớp 0 nhựa: màu lấy theo TOẠ ĐỘ THẾ GIỚI (dải ↔ đa giác nút giao liền mạch), vạch kẻ theo (u dọc, v ngang) của dải.
// - Vỉa hè: (u, d) của dải hoặc thế giới (cờ WUV) → ô gạch chạy dọc bó vỉa; d < 0,24 m = viên bó vỉa.
// - Vì sao Phong chứ không Lambert: freezeStatic (world.js) chỉ GỘP MeshLambertMaterial — gộp lượt 1 xoá uv + đổi material
//   → mất shader. Phong không bị gộp, ánh sáng khuếch tán y hệt Lambert (specular rất nhỏ = ánh nhựa đường).
// - Texture sRGB → mẫu trả về TUYẾN TÍNH. Sinh tất định (seed cố định) — A/B so ảnh được.
// - DataArrayTexture (KHÔNG canvas) → không premultiply alpha; mipmap do GPU sinh.

const L_ASPHALT = 0, L_CONCRETE = 1, L_GACH = 2, L_CARO = 3, L_TERRA = 4, L_CONSAU = 5, L_CURB = 6, L_DECAL = 7, L_MACRO = 8;
export const ROAD_LAYERS = 9;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// nhiễu giá trị LẶP (tileable) độ phân giải S, lưới period×period
function vnoise(S, period, rnd) {
  const G = new Float32Array(period * period); for (let i = 0; i < G.length; i++) G[i] = rnd();
  const out = new Float32Array(S * S), sc = period / S;
  const i0 = new Int32Array(S), i1 = new Int32Array(S), tt = new Float32Array(S);
  for (let x = 0; x < S; x++) { const f = x * sc, a = Math.floor(f); i0[x] = a % period; i1[x] = (a + 1) % period; const t = f - a; tt[x] = t * t * (3 - 2 * t); }
  for (let y = 0; y < S; y++) {
    const ry0 = i0[y] * period, ry1 = i1[y] * period, ty = tt[y];
    for (let x = 0; x < S; x++) {
      const a = G[ry0 + i0[x]], b = G[ry0 + i1[x]], c = G[ry1 + i0[x]], d = G[ry1 + i1[x]], tx = tt[x];
      out[y * S + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}
function fbm(S, periods, weights, rnd) {
  const out = new Float32Array(S * S); let wsum = 0;
  periods.forEach((p, i) => { const n = vnoise(S, p, rnd), w = weights[i]; wsum += w; for (let k = 0; k < out.length; k++) out[k] += n[k] * w; });
  for (let k = 0; k < out.length; k++) out[k] /= wsum;
  return out;
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// vẽ chấm tròn mềm (cộng/nhân) có lặp biên
function blot(L, S, cx, cy, r, fn) {
  const r2 = r * r, x0 = Math.floor(cx - r), x1 = Math.ceil(cx + r), y0 = Math.floor(cy - r), y1 = Math.ceil(cy + r);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d2 = (x - cx) ** 2 + (y - cy) ** 2; if (d2 > r2) continue;
    const xx = ((x % S) + S) % S, yy = ((y % S) + S) % S;
    fn((yy * S + xx) * 4, 1 - d2 / r2);
  }
}
// đường nứt: bước ngẫu nhiên, bề rộng w px, nhân màu f
function crack(L, S, rnd, x, y, len, w, f, branch = 0.04) {
  let a = rnd() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (rnd() - 0.5) * 0.7;
    x += Math.cos(a) * 1.2; y += Math.sin(a) * 1.2;
    blot(L, S, x, y, w, (o, k) => { const m = 1 - (1 - f) * Math.min(1, k * 1.6); L[o] *= m; L[o + 1] *= m; L[o + 2] *= m; });
    if (rnd() < branch) crack(L, S, rnd, x, y, len * 0.35 | 0, w * 0.7, f, 0);
  }
}
// lớp gạch lưới N×N (vỉa hè)
function tiles(L, S, N, rnd, pick, grout, bevel = 0.1) {
  const s = S / N, n = fbm(S, [8, 32], [1, 0.6], rnd);
  const col = [];
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) col.push(pick(tx, ty, rnd));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const tx = Math.floor(x / s), ty = Math.floor(y / s), c = col[ty * N + tx];
    const fx = (x % s) / s, fy = (y % s) / s;
    const e = Math.min(fx, fy, 1 - fx, 1 - fy);
    const o = (y * S + x) * 4, nn = (n[y * S + x] - 0.5) * 26 + (rnd() - 0.5) * 16;
    let k = 1;
    if (e < 0.022) k = grout;                                  // mạch vữa
    else if (e < 0.022 + bevel * 0.35) k = 0.9 + 0.1 * (e - 0.022) / (bevel * 0.35);   // mép vát hơi tối
    if (fx < 0.05 && e >= 0.022) k *= 1.04;                    // cạnh hắt sáng
    L[o] = (c[0] + nn) * k; L[o + 1] = (c[1] + nn) * k; L[o + 2] = (c[2] + nn) * k;
  }
}

function genLayers(S) {
  const P = S * S * 4, data = new Uint8Array(P * ROAD_LAYERS);
  const F = new Float32Array(P);   // lớp tạm dạng float
  const put = (layer, alpha) => { const off = layer * P; for (let i = 0; i < S * S; i++) { data[off + i * 4] = clamp255(F[i * 4]); data[off + i * 4 + 1] = clamp255(F[i * 4 + 1]); data[off + i * 4 + 2] = clamp255(F[i * 4 + 2]); data[off + i * 4 + 3] = alpha ? clamp255(alpha[i] * 255) : 255; } };
  const px = S / 512;   // đơn vị bề rộng nét theo 512 px

  // ---- 0: NHỰA ĐƯỜNG (4 m/ô): cốt liệu mịn + đá lộ + loang trung bình; alpha = nhiễu tần thấp (mài mòn sơn, tint) ----
  {
    const rnd = mulberry(11);
    const mid = fbm(S, [6, 12, 24, 48], [1, 0.8, 0.6, 0.4], rnd), lo = fbm(S, [2, 4], [1, 0.6], rnd);
    for (let i = 0; i < S * S; i++) {
      // nhựa cũ bạc màu nắng, xám ẤM (pano đo: R>G>B ~(142,137,127) / (116,113,105)); bản đầu g,g+1,g+2 ngả lạnh + ánh
      // trời xanh → mặt đường xanh xám (85,90,90) trên ảnh game
      const g = 152 + (mid[i] - 0.5) * 24 + (rnd() - 0.5) * 24;
      F[i * 4] = g + 4; F[i * 4 + 1] = g + 1; F[i * 4 + 2] = g - 4;
    }
    const nStone = (S * S / 110) | 0;
    for (let i = 0; i < nStone; i++) {   // đá dăm lộ mặt: sáng (xám/ngà) và hố tối
      const r = (0.6 + rnd() * 1.4) * px, x = rnd() * S, y = rnd() * S, t = rnd();
      const add = t < 0.62 ? 18 + rnd() * 34 : -(20 + rnd() * 26), warm = t < 0.62 && rnd() < 0.35 ? 6 : 0;
      blot(F, S, x, y, r, (o, k) => { const a = add * Math.min(1, k * 2); F[o] += a + warm; F[o + 1] += a + warm * 0.5; F[o + 2] += a; });
    }
    put(L_ASPHALT, lo);
  }
  // ---- 1: BÊ TÔNG NGÕ (4 m/ô): xám be, mạch tấm ở 2 mép ô (3 m thật nhờ scale shader), rỗ + nứt ----
  {
    const rnd = mulberry(23);
    const mid = fbm(S, [4, 8, 16, 64], [1, 0.8, 0.5, 0.3], rnd);
    for (let i = 0; i < S * S; i++) {
      const g = 166 + (mid[i] - 0.5) * 34 + (rnd() - 0.5) * 12;
      F[i * 4] = g + 4; F[i * 4 + 1] = g + 1; F[i * 4 + 2] = g - 6;
    }
    for (let i = 0; i < (S * S / 260 | 0); i++) blot(F, S, rnd() * S, rnd() * S, (0.5 + rnd()) * px, (o, k) => { F[o] -= 30 * k; F[o + 1] -= 30 * k; F[o + 2] -= 30 * k; });
    for (let i = 0; i < 5; i++) crack(F, S, rnd, rnd() * S, rnd() * S, (60 + rnd() * 160) * px | 0, 0.9 * px, 0.6);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {   // mạch co giãn ở mép ô
      const e = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (e < 2 * px) { const o = (y * S + x) * 4; F[o] *= 0.55; F[o + 1] *= 0.55; F[o + 2] *= 0.55; }
    }
    put(L_CONCRETE);
  }
  // ---- 2: GẠCH XÁM (1,6 m/ô = 4×4 viên 40 cm, mặt có gân) ----
  {
    const rnd = mulberry(37);
    tiles(F, S, 4, rnd, (tx, ty, r) => { const l = (r() - 0.5) * 22; return [178 + l, 175 + l, 167 + l]; }, 0.62);
    const s = S / 4;   // gân nổi 4×4 trên mỗi viên (gạch block vỉa hè HP)
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = (x % s) / s, fy = (y % s) / s;
      const gx = (fx * 4) % 1, gy = (fy * 4) % 1;
      if (Math.min(fx, fy, 1 - fx, 1 - fy) < 0.05) continue;
      const o = (y * S + x) * 4;
      if (gx > 0.25 && gx < 0.75 && gy > 0.25 && gy < 0.75) { const k = gy < 0.35 || gx < 0.35 ? 1.05 : gy > 0.65 || gx > 0.65 ? 0.93 : 1.0; F[o] *= k; F[o + 1] *= k; F[o + 2] *= k; }
    }
    for (let i = 0; i < 14; i++) blot(F, S, rnd() * S, rnd() * S, (8 + rnd() * 30) * px, (o, k) => { const m = 1 - 0.12 * k; F[o] *= m; F[o + 1] *= m; F[o + 2] *= m * 0.98; });
    put(L_GACH);
  }
  // ---- 3: CARO ĐỎ-XÁM (kè hồ Tam Bạc, quảng trường — pano_004: đỏ đất nung trầm chủ đạo, điểm xám) ----
  {
    const rnd = mulberry(41);
    tiles(F, S, 4, rnd, (tx, ty, r) => {
      const h = Math.sin(tx * 12.9898 + ty * 78.233) * 43758.5453, v = h - Math.floor(h), l = (r() - 0.5) * 18;
      return v < 0.72 ? [158 + l, 82 + l * 0.6, 58 + l * 0.5] : v < 0.88 ? [142 + l, 70 + l * 0.6, 50 + l * 0.5] : [160 + l, 152 + l, 138 + l];
    }, 0.6);
    for (let i = 0; i < 10; i++) blot(F, S, rnd() * S, rnd() * S, (10 + rnd() * 28) * px, (o, k) => { const m = 1 - 0.14 * k; F[o] *= m; F[o + 1] *= m; F[o + 2] *= m; });
    put(L_CARO);
  }
  // ---- 4: GẠCH ĐỎ ĐẤT NUNG ----
  {
    const rnd = mulberry(53);
    tiles(F, S, 4, rnd, (tx, ty, r) => { const l = (r() - 0.5) * 30; return [172 + l, 88 + l * 0.6, 56 + l * 0.4]; }, 0.62);
    put(L_TERRA);
  }
  // ---- 5: GẠCH CON SÂU / tự chèn (hàng so le đỏ + xám), 1,2 m/ô ----
  {
    const rnd = mulberry(67);
    const rows = 6, bw = S / 3, bh = S / rows, n = fbm(S, [16, 48], [1, 0.5], rnd);
    const col = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < 4; c++) { const l = (rnd() - 0.5) * 20; col.push(rnd() < 0.55 ? [168 + l, 86 + l * 0.6, 56 + l * 0.4] : [150 + l, 145 + l, 134 + l]); }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const r = Math.floor(y / bh), off = (r % 2) * bw * 0.5, xx = (x + off) % S, c = Math.floor(xx / bw);
      const fx = (xx % bw) / bw, fy = (y % bh) / bh;
      // răng cưa nhẹ ở cạnh dài (con sâu)
      const zig = Math.abs(((fx * 6) % 1) - 0.5) * 0.12;
      const e = Math.min(fx * 3, (1 - fx) * 3, fy - zig, 1 - fy - zig);
      const cc = col[(r * 4 + c) % col.length], o = (y * S + x) * 4, nn = (n[y * S + x] - 0.5) * 22 + (rnd() - 0.5) * 14;
      const k = e < 0.06 ? 0.58 : e < 0.1 ? 0.9 : 1;
      F[o] = (cc[0] + nn) * k; F[o + 1] = (cc[1] + nn) * k; F[o + 2] = (cc[2] + nn) * k;
    }
    put(L_CONSAU);
  }
  // ---- 6: BÓ VỈA bê tông (2 m dọc × 0,5 m: mạch nối mỗi 1 m, mép dưới ố bẩn) ----
  {
    const rnd = mulberry(79);
    const mid = fbm(S, [8, 16, 32], [1, 0.7, 0.4], rnd);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, o = i * 4;
      let g = 192 + (mid[i] - 0.5) * 26 + (rnd() - 0.5) * 12;
      const fy = y / S;
      g *= 1 - 0.22 * Math.max(0, (fy - 0.55) / 0.45) ** 1.5;          // ố bẩn phía dưới (mặt đứng) / sát lòng
      const jx = Math.min(x % (S / 2), S / 2 - (x % (S / 2)));
      if (jx < 1.5 * px) g *= 0.6;                                     // mạch nối viên 1 m
      F[o] = g + 2; F[o + 1] = g + 1; F[o + 2] = g - 3;
    }
    for (let i = 0; i < 40; i++) blot(F, S, rnd() * S, rnd() * S, (1 + rnd() * 3) * px, (o, k) => { F[o] -= 34 * k; F[o + 1] -= 34 * k; F[o + 2] -= 34 * k; });
    put(L_CURB);
  }
  // ---- 7: DECAL: nửa trái nắp cống gang tròn, nửa phải song chắn rác ----
  {
    const rnd = mulberry(97), h = S / 2;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const o = (y * S + x) * 4;
      let r = 0, g = 0, b = 0, a = 0;
      if (x < h) {
        const cx = h / 2, cy = S / 2, d = Math.hypot(x - cx, y - cy) / (h / 2);
        if (d < 0.98) {
          let v = 74 + (rnd() - 0.5) * 14;
          if (d > 0.86) v = 108;                                  // vành thép mòn sáng
          else if (Math.abs(d - 0.62) < 0.035 || Math.abs(d - 0.36) < 0.035) v = 56;   // gân vòng
          else if (((x >> 3) + (y >> 3)) % 2 === 0 && d < 0.6) v += 14;               // gân ô trám chống trượt
          r = v; g = v - 1; b = v - 2; a = 1;
        }
      } else {
        const fx = (x - h) / h, fy = y / S;
        if (fy > 0.3 && fy < 0.7 && fx > 0.04 && fx < 0.96) {
          const fr = fx < 0.1 || fx > 0.9 || fy < 0.34 || fy > 0.66;
          const slot = !fr && ((fx * 12) % 1) < 0.55;
          const v = fr ? 96 : slot ? 22 : 78;
          r = v; g = v; b = v - 2; a = 1;
        }
      }
      F[o] = r; F[o + 1] = g; F[o + 2] = b; F[o + 3] = a;
    }
    const off = L_DECAL * P;
    for (let i = 0; i < S * S; i++) { data[off + i * 4] = clamp255(F[i * 4]); data[off + i * 4 + 1] = clamp255(F[i * 4 + 1]); data[off + i * 4 + 2] = clamp255(F[i * 4 + 2]); data[off + i * 4 + 3] = F[i * 4 + 3] ? 255 : 0; }
  }
  // ---- 8: MACRO (32 m/ô, nhân màu: 200 = ×1): nứt dài, vá, dầu, bụi; alpha = nhiễu loang lớn ----
  {
    const rnd = mulberry(131);
    const lo = fbm(S, [3, 6, 12], [1, 0.6, 0.4], rnd);
    for (let i = 0; i < S * S; i++) { const v = 200 + (lo[i] - 0.5) * 18; F[i * 4] = v; F[i * 4 + 1] = v; F[i * 4 + 2] = v; }
    for (let i = 0; i < 6; i++) crack(F, S, rnd, rnd() * S, rnd() * S, (40 + rnd() * 120) * px | 0, 0.5 * px, 0.7, 0.06);   // nứt mảnh
    for (let i = 0; i < 4; i++) {    // nứt mạng nhện (nứt da cá sấu) cụm nhỏ
      const cx = rnd() * S, cy = rnd() * S;
      for (let j = 0; j < 6; j++) crack(F, S, rnd, cx + (rnd() - 0.5) * 30 * px, cy + (rnd() - 0.5) * 30 * px, (10 + rnd() * 18) * px | 0, 0.42 * px, 0.75, 0);
    }
    // vết dầu: CỤM giọt nhỏ loang mềm (xe đỗ/dừng nhỏ giọt) — vệt tròn to 0,2-0,75 m tối 22% trông như ổ gà (ảnh pano_007/055)
    for (let i = 0; i < 12; i++) {
      const cx = rnd() * S, cy = rnd() * S, n = 5 + (rnd() * 5 | 0), sp = (4 + rnd() * 8) * px, dk = 0.08 + rnd() * 0.08;
      for (let j = 0; j < n; j++) blot(F, S, cx + (rnd() - 0.5) * sp, cy + (rnd() - 0.5) * sp * 2.2, (0.8 + rnd() * 2.6) * px, (o, k) => { const m = 1 - dk * k; F[o] *= m; F[o + 1] *= m; F[o + 2] *= m; });
    }
    for (let i = 0; i < 10; i++) blot(F, S, rnd() * S, rnd() * S, (10 + rnd() * 24) * px, (o, k) => { const m = 1 + 0.07 * k; F[o] *= m; F[o + 1] *= m * 0.99; F[o + 2] *= m * 0.96; });   // bụi cát
    put(L_MACRO, lo);
  }
  return data;
}

// ============ shader ============
const PARS = /* glsl */`
uniform highp sampler2DArray tRoad;
flat varying ivec2 vCode;   // (lớp, mã vạch kẻ|seed<<13) — FLAT: số nguyên tới ~2,1 triệu, nội suy float có thể lệch 1 → nhiễu bit
varying vec2 vSurf;         // (hw, d cách bó vỉa)
varying vec2 vZeb;
varying vec2 vRUv;
varying vec3 vWP;
float rnSpec = 1.0;
float rnHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// vạch liền bề rộng w tâm c theo toạ độ x (AA theo đạo hàm)
float rnLine(float x, float c, float w, float aa) { return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(x - c)); }
// vạch đứt: dài len, chu kỳ per theo u
float rnDash(float u, float per, float len, float aa) { float m = mod(u, per); return smoothstep(-aa, aa, m) * (1.0 - smoothstep(len - aa, len + aa, m)); }
`;
const MAIN = /* glsl */`
  {
    int Ly = vCode.x;
    int P = vCode.y;
    int MKb = P & 8191;
    float seed = float(P >> 13);
    float hw = vSurf.x, dcurb = vSurf.y;
    vec2 wxz = vWP.xz;
    vec2 gW = vec2(length(vec2(dFdx(wxz.x), dFdy(wxz.x))), length(vec2(dFdx(wxz.y), dFdy(wxz.y))));
    vec2 dWx = dFdx(wxz), dWy = dFdy(wxz), dUx = dFdx(vRUv), dUy = dFdy(vRUv);
    float aaU = max(fwidth(vRUv.x), 1e-4), aaV = max(fwidth(vRUv.y), 1e-4);
    vec4 mac = textureGrad(tRoad, vec3(wxz / 32.0, 8.0), dWx / 32.0, dWy / 32.0);
    vec3 macro = mac.rgb * (255.0 / 200.0);
    vec3 col;
    rnSpec = 0.25;
    bool face = (MKb & 512) != 0;
    if (face) {
      // mặt đứng: bó vỉa / mép lưng / nắp — bê tông, u dọc (2 m/ô), v = cao
      col = textureGrad(tRoad, vec3(vRUv.x * 0.5, 1.0 - vRUv.y * 2.0, 6.0), dUx * vec2(0.5, 2.0), dUy * vec2(0.5, 2.0)).rgb;
      if ((MKb & 1024) != 0) col *= 0.82;
      if ((MKb & 2048) != 0) col *= fract(vRUv.x * 1.0) < 0.5 ? vec3(1.2, 0.13, 0.09) : vec3(1.45);   // sơn đỏ-trắng (cầu)
      rnSpec = 0.1;
    } else if (Ly == 0) {
      // ---- NHỰA ----
      vec3 a = textureGrad(tRoad, vec3(wxz * 0.25, 0.0), dWx * 0.25, dWy * 0.25).rgb;
#ifdef RN_LITE
      col = a * macro * mix(0.9, 1.08, mac.a);   // LITE (TIER ≤1): bỏ mẫu nhựa tầng 2 (tỉ lệ 16 m) — bớt 1 lần đọc texture
#else
      vec3 b = textureGrad(tRoad, vec3(wxz * 0.0617 + vec2(0.37, 0.71), 0.0), dWx * 0.0617, dWy * 0.0617).rgb;
      col = mix(a, b, 0.4) * macro * mix(0.9, 1.08, mac.a);
#endif
      bool ribbon = (MKb & 128) == 0;
      if (ribbon) {
        float u = vRUv.x, v = vRUv.y, av = abs(v);
        // vá ổ gà/sửa đường: ô 13 m dọc × nửa lòng
        float cu = floor(u / 13.0), side = v < 0.0 ? 0.0 : 1.0;
        float h1 = rnHash(vec2(cu + seed * 7.13, side + 3.1));
        if (h1 < 0.2) {
          float h2 = rnHash(vec2(cu, side + 9.7)), h3 = rnHash(vec2(cu + 4.2, side));
          float pu0 = cu * 13.0 + 1.0 + h2 * 6.0, pu1 = pu0 + 1.5 + h3 * 4.5;
          float pv0 = hw * (0.08 + 0.4 * h3), pv1 = pv0 + hw * (0.25 + 0.35 * h2);
          float inP = step(pu0, u) * step(u, pu1) * step(pv0, av) * step(av, pv1);
          float edge = inP * (1.0 - step(0.06, min(min(u - pu0, pu1 - u), min(av - pv0, pv1 - av))));
          // vá nhựa mới (sẫm, 70%) hoặc rãnh cáp vá bê tông (sáng hơn, ngả be — 1/4 số miếng)
          vec3 tone = h1 < 0.05 ? vec3(1.07, 1.05, 0.99) : vec3(0.7 + 0.14 * h2);
          col = mix(col, col * tone, inP);
          col *= 1.0 - 0.2 * edge;
        }
        // vệt bánh xe (bóng hơn, sẫm nhẹ) + rãnh biên bám bụi
        float lane = hw * 0.5;
        float wt = exp(-pow((av - lane + 0.85) / 0.35, 2.0)) + exp(-pow((av - lane - 0.85) / 0.35, 2.0));
        col *= 1.0 - 0.05 * wt; rnSpec += 0.25 * wt;
        float gut = smoothstep(hw - 0.9, hw - 0.1, av);
        col = mix(col, col * vec3(0.92, 0.88, 0.82), gut * 0.6);
        if ((MKb & 256) != 0) col *= 1.0 - 0.1 * smoothstep(hw - 0.45, hw - 0.05, av);   // rãnh biên sẫm (nước + bụi)
        // nắp hố ga giữa làn (ô 40 m) + song chắn rác sát bó vỉa (ô 23 m)
        float cm = floor(u / 40.0), hm = rnHash(vec2(cm + seed * 3.7, 17.0));
        if (hm < 0.55 && hw > 2.0) {
          vec2 c = vec2(cm * 40.0 + 6.0 + 28.0 * rnHash(vec2(cm, 5.0)), (rnHash(vec2(cm, 8.0)) < 0.5 ? -1.0 : 1.0) * lane);
          vec2 q = (vec2(u, v) - c) / 0.72 + 0.5;
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
            vec4 dm = textureGrad(tRoad, vec3(q.x * 0.5, q.y, 7.0), dUx * 0.69, dUy * 0.69);
            col = mix(col, dm.rgb, dm.a); rnSpec = mix(rnSpec, 0.5, dm.a);
          }
        }
        float cg = floor(u / 23.0), hg = rnHash(vec2(cg + seed, 29.0));
        if (hg < 0.6 && hw > 2.0) {
          float gu = cg * 23.0 + 4.0 + 15.0 * rnHash(vec2(cg, 31.0));
          float sgn = rnHash(vec2(cg, 37.0)) < 0.5 ? -1.0 : 1.0;
          vec2 q = vec2((u - gu) / 1.0 + 0.5, (v * sgn - (hw - 0.3)) / 1.0 + 0.5);
          if (q.x > 0.0 && q.x < 1.0 && q.y > 0.3 && q.y < 0.7) {
            vec4 dm = textureGrad(tRoad, vec3(0.5 + q.x * 0.5, q.y, 7.0), dUx * vec2(0.5, 1.0), dUy * vec2(0.5, 1.0));
            col = mix(col, dm.rgb, dm.a);
          }
        }
        // ---- VẠCH KẺ ----
        float ds = u - vZeb.x, de = vZeb.y - u;
        bool z0 = (MKb & 2048) != 0, z1 = (MKb & 4096) != 0;
        float lim0 = z0 ? 5.6 : 1.2, lim1 = z1 ? 5.6 : 1.2;
        float lineOn = step(lim0, ds) * step(lim1, de);
        float paintW = 0.0, paintY = 0.0;
        if ((MKb & 2) != 0) paintY = max(paintY, max(rnLine(v, -0.11, 0.12, aaV), rnLine(v, 0.11, 0.12, aaV)));
        if ((MKb & 1) != 0) paintY = max(paintY, rnLine(v, 0.0, 0.15, aaV) * rnDash(u, 8.0, 3.0, aaU));
        if ((MKb & 16) != 0) paintW = max(paintW, rnLine(v, 0.0, 0.13, aaV) * rnDash(u, 9.0, 3.0, aaU));
        if ((MKb & 8) != 0) paintW = max(paintW, max(rnLine(v, -lane, 0.12, aaV), rnLine(v, lane, 0.12, aaV)) * rnDash(u + 2.0, 9.0, 3.0, aaU));
        if ((MKb & 4) != 0) paintW = max(paintW, max(rnLine(v, -(hw - 0.5), 0.15, aaV), rnLine(v, hw - 0.5, 0.15, aaV)));
        paintW *= lineOn; paintY *= lineOn;
        // zebra 3 m (sọc 0,5 m song song tim) + vạch dừng 0,4 m nửa phải làn tới
        float zb = 0.0;
        if (z0 && ds > 0.8 && ds < 3.8) zb = 1.0;
        if (z1 && de > 0.8 && de < 3.8) zb = 1.0;
        if (zb > 0.0) { float m = abs(fract((v + 0.25) / 1.0) - 0.5); paintW = max(paintW, (1.0 - smoothstep(0.24 - aaV, 0.24 + aaV, m)) * step(av, hw - 0.45)); }
        if ((MKb & 32) != 0 && ds > 4.5 && ds < 4.9 && v < -0.1 && av < hw - 0.4) paintW = 1.0;
        if ((MKb & 64) != 0 && de > 4.5 && de < 4.9 && v > 0.1 && av < hw - 0.4) paintW = 1.0;
        // sơn mòn theo nhiễu (alpha macro + hạt)
#ifdef RN_LITE
        float wear = smoothstep(0.08, 0.55, mac.a * 1.2);
#else
        float wear = smoothstep(0.08, 0.55, textureGrad(tRoad, vec3(wxz * 0.9, 0.0), dWx * 0.9, dWy * 0.9).a * 0.6 + mac.a * 0.6);
#endif
        float pw = paintW * (0.55 + 0.45 * wear), py = paintY * (0.5 + 0.5 * wear);
        col = mix(col, vec3(0.80, 0.80, 0.77), pw);
        col = mix(col, vec3(0.78, 0.48, 0.035), py);
        rnSpec = mix(rnSpec, 0.6, max(pw, py));
      }
    } else if (Ly == 1) {
      // ---- BÊ TÔNG NGÕ ----
      vec2 t = (MKb & 128) != 0 ? wxz / 3.0 : vRUv / 3.0;
      vec2 gx = (MKb & 128) != 0 ? dWx / 3.0 : dUx / 3.0, gy = (MKb & 128) != 0 ? dWy / 3.0 : dUy / 3.0;
      col = textureGrad(tRoad, vec3(t, 1.0), gx, gy).rgb * macro * mix(0.9, 1.06, mac.a);
      rnSpec = 0.12;
    } else {
      // ---- VỈA HÈ (2..5): ô gạch theo dải (u dọc, d ngang) hoặc thế giới; viên bó vỉa khi d < 0,24 m ----
      bool w = (MKb & 128) != 0;
      float tsz = Ly == 5 ? 1.2 : 1.6;
      vec2 t = (w ? wxz : vRUv) / tsz;
      vec2 gx = (w ? dWx : dUx) / tsz, gy = (w ? dWy : dUy) / tsz;
      col = textureGrad(tRoad, vec3(t, float(Ly)), gx, gy).rgb;
      col *= mix(0.86, 1.05, mac.a) * mix(vec3(1.0), macro, 0.5);
      if (dcurb < 0.24) {
        float cu = w ? (wxz.x + wxz.y) : vRUv.x;
        col = textureGrad(tRoad, vec3(cu * 0.5, dcurb * 2.0, 6.0), (w ? dWx.xx : dUx.xx) * 0.5, (w ? dWy.xx : dUy.xx) * 0.5).rgb;
        col *= 1.0 - 0.1 * smoothstep(0.2, 0.24, dcurb);
        if ((MKb & 2048) != 0) col *= fract(vRUv.x * 1.0) < 0.5 ? vec3(1.2, 0.13, 0.09) : vec3(1.45);
      }
      rnSpec = 0.08;
    }
    diffuseColor.rgb *= col;
  }
`;

// makeRoadMaterial(THREE, {size, anisotropy, lite}) → MeshPhongMaterial dùng chung cho mọi ô 'roads_*' / 'sidewalk_*'
// Màu tạm mỗi lớp (trước khi Worker sinh xong texture ~100 ms — buildWorld còn chạy nhiều giây nên thực tế không thấy)
const PLACEHOLDER = [[156, 153, 148, 128], [166, 162, 152, 255], [176, 172, 164, 255], [152, 84, 60, 255], [170, 88, 56, 255],
  [160, 116, 92, 255], [190, 188, 180, 255], [0, 0, 0, 0], [200, 200, 200, 128]];
// Sinh texture TRONG WORKER (Blob từ chính mã các hàm ở trên) → không tốn ~100 ms main thread lúc tải; lỗi → sinh đồng bộ.
function genInWorker(S, done) {
  const fns = [mulberry, vnoise, fbm, blot, crack, tiles, genLayers].map((f) => f.toString()).join('\n');
  const src = 'const L_ASPHALT=0,L_CONCRETE=1,L_GACH=2,L_CARO=3,L_TERRA=4,L_CONSAU=5,L_CURB=6,L_DECAL=7,L_MACRO=8,ROAD_LAYERS=' + ROAD_LAYERS + ';\n' +
    'const clamp255=(v)=>(v<0?0:v>255?255:v|0);\n' + fns + '\nonmessage=(e)=>{const d=genLayers(e.data);postMessage(d,[d.buffer]);};';
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  const w = new Worker(url);
  w.onmessage = (e) => { done(e.data); w.terminate(); URL.revokeObjectURL(url); };
  w.onerror = (e) => { e.preventDefault && e.preventDefault(); w.terminate(); URL.revokeObjectURL(url); done(genLayers(S)); };
  w.postMessage(S);
}

export function makeRoadMaterial(THREE, opt = {}) {
  const S = opt.size || 512;
  const t0 = performance.now();
  let data = new Uint8Array(S * S * 4 * ROAD_LAYERS);
  for (let l = 0; l < ROAD_LAYERS; l++) { const c = PLACEHOLDER[l]; new Uint32Array(data.buffer, l * S * S * 4, S * S).fill((c[0] | (c[1] << 8) | (c[2] << 16) | (c[3] << 24)) >>> 0); }   // little-endian RGBA
  let viaWorker = false;
  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && opt.worker !== false) {
    try {
      genInWorker(S, (d) => { tex.image.data = d; tex.needsUpdate = true; mat.userData.texReadyMs = performance.now() - t0; });
      viaWorker = true;
    } catch (e) { viaWorker = false; }
  }
  if (!viaWorker) data = genLayers(S);
  const tex = new THREE.DataArrayTexture(data, S, S, ROAD_LAYERS);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = opt.anisotropy || 8;
  tex.needsUpdate = true;
  const genMs = performance.now() - t0;
  const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x262626, shininess: 18 });
  mat.name = 'roadnet';
  if (opt.lite) mat.defines = { RN_LITE: '' };   // TIER ≤1: shader nhẹ hơn (2 lần đọc texture ít hơn mỗi điểm ảnh nhựa)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tRoad = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aSurf;\nattribute vec2 aZeb;\nflat varying ivec2 vCode;\nvarying vec2 vSurf;\nvarying vec2 vZeb;\nvarying vec2 vRUv;\nvarying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCode = ivec2(int(aSurf.x + 0.5), int(aSurf.y + 0.5)); vSurf = aSurf.zw; vZeb = aZeb; vRUv = uv; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <map_fragment>', MAIN)
      .replace('#include <specularmap_fragment>', '#include <specularmap_fragment>\nspecularStrength = rnSpec;');
  };
  mat.customProgramCacheKey = () => (opt.lite ? 'roadnet-v2-lite' : 'roadnet-v2');
  mat.userData.genMs = genMs;   // thời gian main thread (worker: chỉ dựng placeholder)
  mat.userData.viaWorker = viaWorker;
  mat.userData.tex = tex;
  return mat;
}
