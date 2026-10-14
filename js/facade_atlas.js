// facade_atlas.js — ATLAS MẶT TIỀN / MÁI / CHI TIẾT nhà phố Việt Nam, vẽ THỦ TỤC bằng rasterizer phần mềm
// (ghi thẳng vào Uint8Array RGBA — KHÔNG qua canvas: canvas premultiply alpha làm hỏng RGB ở pixel mặt nạ 0, và
// getImageData 2048² tốn 30-40 ms/lần). Chỉ chữ biển hiệu dùng canvas NHỎ (vài chục KB) rồi chép độ sáng vào atlas.
// Không import three → chạy được trong node (tools xem trước atlas; node không có canvas thì bỏ chữ).
//
// Lưới N×N ô (N=8). Mỗi ô = 1 MÔ-ĐUN: 1 "bay" (4 m ngang) × 1 tầng (cao tầng: 3,3 m tầng trên / 3,9 m tầng trệt /
// 0,9 m lan can mái), hoặc 4×4 m mặt mái / chi tiết, hoặc 4 dải biển hiệu 4×1 m. Gốc toạ độ ô ở DƯỚI-trái (hàng 0
// của DataTexture = v 0, không lật) → y mét tính từ SÀN tầng lên.
// KÊNH ALPHA = MẶT NẠ (shader citygen.js đọc): 255 = TƯỜNG SƠN (nhân màu nhà), 191 = KÍNH (sáng đèn ban đêm),
// 128 = GIỮ MÀU GỐC, 64 = NỀN BIỂN HIỆU (nhân màu biển theo hạt giống), 0 = CHỮ BIỂN (màu tương phản).
// Thứ tự 255>191>128>64>0 có chủ ý: biên tường↔giữ-màu (khung, song sắt — phổ biến nhất) khi mipmap trộn chỉ đi qua
// vùng "kính", KHÔNG đi qua vùng biển/chữ → mép cửa sổ ở xa không bị nhuộm màu biển hiệu.
export const ATLAS_N = 8;
// W3-C: atlas CAO hơn rộng — 8 cột × 12 hàng ô (2048×3072 / LITE 1024×1536; WebGL2 mip NPOT ổn, WebGL1 citygen tự tắt mip).
// Ô vẫn 256 px (128 LITE) → mọi ô cũ giữ nguyên độ phân giải; 96 chỗ (63 cũ + ô mới W3-C).
export const ATLAS_ROWS = 14;   // W4-C: 12 → 14 (95 ô cũ + 10 ô W4-C = 105; còn 7 chỗ) — 2048×3584 / LITE 1024×1792
export const M_WALL = 255, M_GLASS = 191, M_KEEP = 128, M_SIGN = 64, M_TEXT = 0;
export const MOD = {};          // tên mô-đun → chỉ số ô (ổn định theo thứ tự vẽ bên dưới)
export const MODS = [];

// ---------- RNG / nhiễu xác định (KHÔNG Math.random — A/B chụp ảnh phải so được) ----------
function hash3(i, j, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
let _rs = 1;
const rnd = () => { _rs = (Math.imul(_rs, 1103515245) + 12345) & 0x7fffffff; return _rs / 0x7fffffff; };
const R = (a, b) => a + (b - a) * rnd();
// value noise 2D trên lưới 256² (bilinear + smoothstep)
const LAT = new Float32Array(256 * 256);
{ let s = 1234567; for (let i = 0; i < LAT.length; i++) { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; LAT[i] = s / 0x7fffffff; } }
function vn(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const x0 = xi & 255, y0 = yi & 255, x1 = (xi + 1) & 255, y1 = (yi + 1) & 255;
  const a = LAT[y0 * 256 + x0], b = LAT[y0 * 256 + x1], c = LAT[y1 * 256 + x0], d = LAT[y1 * 256 + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// ---------- trạng thái rasterizer ----------
let B = null, SIZE = 0, C = 0, OX = 0, OY = 0, SX = 1, SY = 1, CW = 4;
const clampI = (v) => (v < 0 ? 0 : v > C ? C : v);
const PX = (xm) => clampI(Math.round(xm * SX));
const PY = (ym) => clampI(Math.round(ym * SY));
let _layoutOnly = false;
function cell(name, wM, hM, fn) {
  const idx = MODS.length; MOD[name] = idx; MODS.push(name);
  if (_layoutOnly) return;
  OX = (idx % ATLAS_N) * C; OY = Math.floor(idx / ATLAS_N) * C;
  CW = wM; SX = C / wM; SY = C / hM;
  _rs = 7919 * (idx + 1);
  fn();
}
// tô chữ nhật (mét, y từ sàn lên). m<0: giữ mặt nạ. op<1: trộn màu.
function rect(x0, y0, x1, y1, col, m, op = 1) {
  const i0 = PX(Math.min(x0, x1)), i1 = PX(Math.max(x0, x1)), j0 = PY(Math.min(y0, y1)), j1 = PY(Math.max(y0, y1));
  const r = col[0], g = col[1], b = col[2];
  for (let j = j0; j < j1; j++) {
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      if (op >= 1) { B[p] = r; B[p + 1] = g; B[p + 2] = b; }
      else { B[p] += (r - B[p]) * op; B[p + 1] += (g - B[p + 1]) * op; B[p + 2] += (b - B[p + 2]) * op; }
      if (m >= 0) B[p + 3] = m;
    }
  }
}
// nhân độ sáng (bóng đổ / vết bẩn) — giữ mặt nạ
function shade(x0, y0, x1, y1, k) {
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1);
  for (let j = j0; j < j1; j++) {
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) { B[p] *= k; B[p + 1] *= k; B[p + 2] *= k; }
  }
}
// gradient dọc (top → bottom), có nhiễu nhẹ
function vgrad(x0, y0, x1, y1, top, bot, m, noise = 0) {
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1), hh = Math.max(1, j1 - j0);
  for (let j = j0; j < j1; j++) {
    const t = (j - j0) / hh;   // 0 = đáy, 1 = đỉnh
    const r = bot[0] + (top[0] - bot[0]) * t, g = bot[1] + (top[1] - bot[1]) * t, b = bot[2] + (top[2] - bot[2]) * t;
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const n = noise ? (hash3(OX + i, OY + j, 77) - 0.5) * noise : 0;
      B[p] = r + n; B[p + 1] = g + n; B[p + 2] = b + n; if (m >= 0) B[p + 3] = m;
    }
  }
}
// hình chữ nhật đỉnh VÒM (cửa vòm kiểu Pháp) — fill theo từng pixel
function archFill(x0, y0, x1, y1, col, m, op = 1) {
  const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2, ry = Math.min(rx * 0.9, (y1 - y0) * 0.45), ys = y1 - ry;
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1);
  for (let j = j0; j < j1; j++) {
    const ym = (j + 0.5) / SY;
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const xm = (i + 0.5) / SX;
      if (ym > ys) { const dx = (xm - cx) / rx, dy = (ym - ys) / ry; if (dx * dx + dy * dy > 1) continue; }
      if (op >= 1) { B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; }
      else { B[p] += (col[0] - B[p]) * op; B[p + 1] += (col[1] - B[p + 1]) * op; B[p + 2] += (col[2] - B[p + 2]) * op; }
      if (m >= 0) B[p + 3] = m;
    }
  }
}
// đĩa tròn (quạt cục nóng điều hoà, bồn hoa)
function disc(cx, cy, r, col, m) {
  const i0 = PX(cx - r), i1 = PX(cx + r), j0 = PY(cy - r), j1 = PY(cy + r);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const dx = (i + 0.5) / SX - cx, dy = (j + 0.5) / SY - cy; if (dx * dx + dy * dy > r * r) continue;
    const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; if (m >= 0) B[p + 3] = m;
  }
}
const vline = (x, y0, y1, w, col, m) => rect(x - w / 2, y0, x + w / 2, y1, col, m);
const hline = (y, x0, x1, w, col, m) => rect(x0, y - w / 2, x1, y + w / 2, col, m);

// ---------- NỀN TƯỜNG: 3 biến thể tính 1 lần rồi chép (nhanh: ~3×C² phép nhiễu thay vì ~40×C²) ----------
// grime: 0 sạch (nhà mới) .. 1 rất cũ (nhà Pháp/KTT: ố mưa, rêu, mảng vữa bong)
const _bases = {};
function wallBase(key, base, grime, mask = M_WALL, warm = 0) {
  let t = _bases[key];
  if (!t) {
    t = new Uint8ClampedArray(C * C * 4);   // Clamped: nhiễu/ố cộng trừ không bị quấn vòng 0↔255
    const s = C / 256;   // nhiễu theo MÉT (ô 4 m), không theo pixel → giống nhau ở mọi độ phân giải
    for (let j = 0; j < C; j++) for (let i = 0; i < C; i++) {
      const x = i / s, y = j / s;
      let v = base + (hash3(i, j, 3) - 0.5) * 6                      // hạt vữa
        + (vn(x / 9, y / 9) - 0.5) * 6 + (vn(x / 40 + 9, y / 40) - 0.5) * 9;   // loang sơn (nhẹ — tránh "rằn ri")
      // vệt ố mưa CHẢY DỌC (đặc trưng tường nhiệt đới): theo cột, nhiễu dọc kéo dài, mạnh dần lên đỉnh tường
      const st = vn(x / 4 + 31, y / 90 + 3.7) * vn(x / 19 + 5, 1.3);
      v -= grime * Math.max(0, st - 0.22) * 85 * (0.25 + 0.75 * (j / C));
      const blot = vn(x / 22 + 50, y / 60 + 20);                         // mảng ẩm loang dài theo chiều dọc
      v -= grime * Math.max(0, blot - 0.66) * 70;
      const p = (j * C + i) * 4;
      t[p] = v + warm; t[p + 1] = v + warm * 0.4; t[p + 2] = v - 3 - grime * 6; t[p + 3] = mask;
    }
    // mảng vữa bong (lộ gạch/xi măng) cho tường rất cũ — GIỮ màu (không nhuộm)
    if (grime > 0.6) {
      for (let k = 0; k < 3; k++) {
        const cx = hash3(k, 1, 91) * C, cy = hash3(k, 2, 91) * C * 0.8, rx = (8 + hash3(k, 3, 91) * 18) * s, ry = (5 + hash3(k, 4, 91) * 10) * s;
        for (let j = Math.max(0, cy - ry) | 0; j < Math.min(C, cy + ry); j++) for (let i = Math.max(0, cx - rx) | 0; i < Math.min(C, cx + rx); i++) {
          const dx = (i - cx) / rx, dy = (j - cy) / ry, d = dx * dx + dy * dy + (vn(i / (4 * s), j / (4 * s)) - 0.5) * 0.8;
          if (d > 1) continue;
          const p = (j * C + i) * 4, g = 150 + (hash3(i, j, 5) - 0.5) * 30;
          t[p] = g; t[p + 1] = g * 0.97; t[p + 2] = g * 0.92; t[p + 3] = M_KEEP;
        }
      }
    }
    _bases[key] = t;
  }
  for (let j = 0; j < C; j++) B.set(t.subarray(j * C * 4, (j + 1) * C * 4), ((OY + j) * SIZE + OX) * 4);
}
const WALL = (g = 0.15) => wallBase('w' + (g > 0.6 ? 2 : g > 0.3 ? 1 : 0), 226, g > 0.6 ? 0.9 : g > 0.3 ? 0.45 : 0.12);
// vết ố chảy dưới bậu cửa sổ (mưa nhiệt đới) — chỉ làm tối pixel tường
function sillStreaks(x0, x1, ySill, k = 0.18) {
  const i0 = PX(x0), i1 = PX(x1), j1 = PY(ySill), j0 = PY(Math.max(0, ySill - 1.6));
  for (let i = i0; i < i1; i++) {
    const st = vn(i / (SX * 0.12) + OX, 7.7); if (st < 0.45) continue;
    for (let j = j0; j < j1; j++) {
      const p = ((OY + j) * SIZE + OX + i) * 4; if (B[p + 3] !== M_WALL) continue;
      const f = 1 - k * (st - 0.45) * 2 * ((j - j0) / Math.max(1, j1 - j0));
      B[p] *= f; B[p + 1] *= f; B[p + 2] *= f;
    }
  }
}
// W3-C: vệt ố MỀM chảy dọc — đậm ở đỉnh, nhạt dần xuống, mặt cắt ngang hình chuông + nhiễu (thay shade() chữ nhật cạnh
// cứng: tường hồi từng ra "vạch sọc" như mã vạch, pano_175 h270)
function softStreak(xc, w, yTop, len, k) {
  const i0 = PX(xc - w), i1 = PX(xc + w), j0 = PY(Math.max(0, yTop - len)), j1 = PY(yTop);
  for (let j = j0; j < j1; j++) {
    const ym = (j + 0.5) / SY, fy = Math.max(0, 1 - (yTop - ym) / len);
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const xm = (i + 0.5) / SX, dx = (xm - xc) / w;
      const f = 1 - k * Math.exp(-dx * dx * 3) * (0.7 + 0.3 * vn(xm * 18 + OX * 0.1, ym * 2.5)) * Math.pow(fy, 0.6);
      B[p] *= f; B[p + 1] *= f; B[p + 2] *= f;
    }
  }
}
// gờ sàn bê tông (dải đầu tầng) + bóng dưới gờ — giữ nhuộm màu tường
function slab(y = 0, h = 0.2) {
  rect(0, y, CW, y + h, [236, 234, 228], M_WALL);
  shade(0, Math.max(0, y - 0.07), CW, y, 0.72);
  rect(0, y + h - 0.03, CW, y + h, [250, 248, 244], M_WALL);
}
// ---------- kính: phản chiếu trời (sáng trên, tối dưới) + vệt chéo + rèm ----------
const GLASS_T = [
  [[176, 196, 210], [92, 108, 120]],    // kính trong phản trời
  [[120, 150, 158], [50, 70, 76]],      // kính xanh lục (rất phổ biến nhà ống)
  [[150, 140, 120], [62, 54, 46]],      // kính trà
  [[110, 130, 160], [40, 52, 72]],      // kính xanh dương sẫm
];
function glass(x0, y0, x1, y1, tone = 0, curtain = -1) {
  const t = GLASS_T[tone % GLASS_T.length];
  vgrad(x0, y0, x1, y1, t[0], t[1], M_GLASS, 6);
  // rèm cửa nửa kéo (hồng/kem/xanh) — đọc ra "có người ở"
  if (curtain >= 0) {
    const cc = [[214, 190, 170], [200, 160, 160], [170, 186, 196], [220, 214, 196]][curtain % 4];
    const w = (x1 - x0) * R(0.25, 0.45);
    rect(x0, y0, x0 + w, y1, cc, M_GLASS, 0.75);
    if (rnd() < 0.5) rect(x1 - w * 0.7, y0, x1, y1, cc, M_GLASS, 0.75);
  }
  // vệt phản chiếu chéo
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1), w = i1 - i0;
  for (let j = j0; j < j1; j++) {
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const d = ((i - i0) + (j - j0) * 0.7) / Math.max(1, w);
      if (d > 0.15 && d < 0.35) { B[p] += 18; B[p + 1] += 18; B[p + 2] += 18; }
    }
  }
}
// W3-C: kính PHẢN TRỜI (vách kính văn phòng/khách sạn): gradient sáng trên → sẫm dưới + mây loang mềm (nhiễu thấp tần)
// — thay "khối kính đen" (G3 cũ: gradient tối, mask kính → shader không nhuộm, mặt khuất nắng ra gần đen).
function skyGlass(x0, y0, x1, y1, top, bot, cl = 0.5) {
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1), hh = Math.max(1, j1 - j0);
  for (let j = j0; j < j1; j++) {
    const t = (j - j0) / hh;
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const xm = (i + 0.5) / SX, ym = (j + 0.5) / SY;
      const n = Math.max(0, vn(xm * 1.3 + OX * 0.013, ym * 1.9 + OY * 0.007) - 0.42) * cl * 110 + (hash3(OX + i, OY + j, 41) - 0.5) * 4;
      B[p] = bot[0] + (top[0] - bot[0]) * t + n; B[p + 1] = bot[1] + (top[1] - bot[1]) * t + n; B[p + 2] = bot[2] + (top[2] - bot[2]) * t + n * 0.92;
      B[p + 3] = M_GLASS;
    }
  }
}
// W3-C: lớp KÍNH TRONG phủ lên nội thất đã vẽ (thấy hàng bên trong + 1 lớp phản chiếu mỏng + vệt chéo) — G_GLASS cũ phủ
// glass() kín → che mất hàng, thành mảng tối.
function glaze(x0, y0, x1, y1, op = 0.3) {
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1), w = Math.max(1, i1 - i0), hh = Math.max(1, j1 - j0);
  for (let j = j0; j < j1; j++) {
    const t = (j - j0) / hh, sr = 118 + 70 * t, sg = 132 + 70 * t, sb = 146 + 66 * t;
    let p = ((OY + j) * SIZE + OX + i0) * 4;
    for (let i = i0; i < i1; i++, p += 4) {
      const d = ((i - i0) + (j - j0) * 0.7) / w, st = d > 0.18 && d < 0.34 ? 0.12 : 0;
      const o = op + st;
      B[p] += (sr - B[p]) * o; B[p + 1] += (sg - B[p + 1]) * o; B[p + 2] += (sb - B[p + 2]) * o; B[p + 3] = M_GLASS;
    }
  }
}
// khung nhôm/gỗ + đố
function frame(x0, y0, x1, y1, col, t = 0.06, mx = 2, my = 1) {
  rect(x0, y0, x1, y0 + t, col, M_KEEP); rect(x0, y1 - t, x1, y1, col, M_KEEP);
  rect(x0, y0, x0 + t, y1, col, M_KEEP); rect(x1 - t, y0, x1, y1, col, M_KEEP);
  for (let k = 1; k < mx; k++) vline(x0 + ((x1 - x0) * k) / mx, y0, y1, t * 0.8, col, M_KEEP);
  for (let k = 1; k < my; k++) hline(y0 + ((y1 - y0) * k) / my, x0, x1, t * 0.8, col, M_KEEP);
}
// bậu cửa + bóng ô văng
function sill(x0, x1, y) { rect(x0 - 0.08, y - 0.08, x1 + 0.08, y, [240, 238, 232], M_WALL); shade(x0 - 0.08, y - 0.14, x1 + 0.08, y - 0.08, 0.7); }
function hood(x0, x1, y) { rect(x0 - 0.15, y, x1 + 0.15, y + 0.12, [242, 240, 235], M_WALL); shade(x0 - 0.1, y - 0.25, x1 + 0.1, y, 0.78); }
// hõm cửa: bóng trong mép trên + trái
function reveal(x0, y0, x1, y1, d = 0.12) { shade(x0, y1 - d, x1, y1, 0.62); shade(x0, y0, x0 + d * 0.6, y1, 0.75); }
// HOA SẮT (song cửa sổ): thanh đứng + ngang + hoạ tiết thoi/vòng
function grille(x0, y0, x1, y1, col, pat = 0) {
  const n = Math.max(3, Math.round((x1 - x0) / 0.13));
  for (let k = 0; k <= n; k++) vline(x0 + ((x1 - x0) * k) / n, y0, y1, 0.022, col, M_KEEP);
  hline(y0 + 0.03, x0, x1, 0.04, col, M_KEEP); hline(y1 - 0.03, x0, x1, 0.04, col, M_KEEP);
  if (pat === 1) {     // thoi chéo
    const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1), cs = 0.26;
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      const xm = (i + 0.5) / SX - x0, ym = (j + 0.5) / SY - y0;
      const a = Math.abs(((xm + ym) / cs) % 1 - 0.5), b = Math.abs(((xm - ym + 100) / cs) % 1 - 0.5);
      if (a < 0.06 || b < 0.06) { const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; B[p + 3] = M_KEEP; }
    }
  } else if (pat === 2) {   // vòng tròn (hoa sắt kiểu cũ)
    for (let yy = y0 + 0.25; yy < y1 - 0.1; yy += 0.5) for (let xx = x0 + 0.22; xx < x1 - 0.1; xx += 0.44) {
      const i0 = PX(xx - 0.16), i1 = PX(xx + 0.16), j0 = PY(yy - 0.16), j1 = PY(yy + 0.16);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const dx = (i + 0.5) / SX - xx, dy = (j + 0.5) / SY - yy, d = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs(d - 0.13) < 0.018) { const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; B[p + 3] = M_KEEP; }
      }
    }
  } else { hline((y0 + y1) / 2, x0, x1, 0.025, col, M_KEEP); }
}
// lan can sắt (ban công Juliet / lô gia)
function railing(x0, x1, y0, h, col, style = 0) {
  hline(y0 + h, x0, x1, 0.06, col, M_KEEP); hline(y0 + 0.08, x0, x1, 0.04, col, M_KEEP);
  if (style === 1) { for (let y = y0 + 0.2; y < y0 + h - 0.05; y += 0.18) hline(y, x0, x1, 0.025, col, M_KEEP); }   // inox ngang
  else { const n = Math.round((x1 - x0) / 0.12); for (let k = 0; k <= n; k++) vline(x0 + ((x1 - x0) * k) / n, y0 + 0.08, y0 + h, 0.02, col, M_KEEP); }
}
// cục nóng điều hoà
function acUnit(x, y, w = 0.82, h = 0.56) {
  rect(x, y, x + w, y + h, [228, 228, 224], M_KEEP);
  shade(x, y - 0.06, x + w, y, 0.65);
  for (let k = 0; k < 7; k++) hline(y + 0.08 + k * 0.06, x + 0.06, x + w * 0.55, 0.018, [150, 150, 148], M_KEEP);
  disc(x + w * 0.76, y + h / 2, h * 0.32, [120, 122, 124], M_KEEP); disc(x + w * 0.76, y + h / 2, h * 0.08, [210, 210, 206], M_KEEP);
  vline(x + 0.1, y - 0.6, y, 0.04, [235, 235, 230], M_KEEP);   // ống đồng bọc trắng
}
// chậu cây ban công / dây phơi đồ
function plants(x0, x1, y) {
  for (let k = 0; k < 10; k++) {
    const x = R(x0, x1), r = R(0.08, 0.2);
    disc(x, y + R(0.05, 0.5), r, [R(40, 75), R(90, 140), R(40, 65)], M_KEEP);
  }
  for (let x = x0 + 0.2; x < x1 - 0.2; x += R(0.5, 0.9)) rect(x, y, x + 0.3, y + 0.25, [150, 80, 50], M_KEEP);
}
// W3-C (RAINBOW): quần áo phơi màu NGẪU NHIÊN bão hoà (R(60,240) mỗi kênh) ra dải hồng/tím/xanh chói ở tầng trên khi nhìn
// xa → bảng màu quần áo THẬT (xanh than, trắng ngà, đen, kaki, nâu đỏ, jean, hồng phai, ô liu), xỉn, thưa hơn.
const CLOTHES = [[52, 58, 72], [196, 194, 186], [38, 38, 40], [150, 138, 112], [116, 64, 58], [84, 104, 128], [176, 150, 146], [104, 112, 92], [210, 206, 196], [70, 74, 84]];
function laundry(x0, x1, y) {
  hline(y, x0, x1, 0.012, [80, 80, 80], M_KEEP);
  for (let x = x0 + 0.15; x < x1 - 0.3; x += R(0.4, 0.7)) {
    const w = R(0.16, 0.34), h = R(0.28, 0.6), c = CLOTHES[(rnd() * CLOTHES.length) | 0], k = R(0.78, 1.0);
    rect(x, y - h, x + w, y, [c[0] * k, c[1] * k, c[2] * k], M_KEEP);
  }
}
// nội thất tối (cửa hàng/lô gia): gradient + sàn gạch
function interior(x0, y0, x1, y1, lit = 0) {
  vgrad(x0, y0, x1, y1, [40 + lit, 37 + lit, 34 + lit], [64 + lit, 58 + lit, 50 + lit], M_KEEP, 5);
  rect(x0, y0, x1, y0 + 0.35, [120, 112, 100], M_KEEP);
  for (let x = x0; x < x1; x += 0.4) vline(x, y0, y0 + 0.35, 0.01, [90, 84, 76], M_KEEP);
}
// kệ hàng + hàng hoá (hộp/thùng/bao nhiều màu nhưng XỈN — không "confetti")
// W3-C: hàng hoá XỈN hơn + nhiều thùng các-tông/bao bì trung tính (trước: 9 màu bão hoà → "giá sách cầu vồng" mọi cửa hàng)
const GOODS = [[160, 72, 60], [190, 158, 84], [70, 104, 140], [222, 214, 196], [96, 128, 86], [168, 132, 96], [186, 120, 74], [176, 150, 116], [214, 212, 206], [150, 120, 88], [120, 116, 108]];
// W3-C: hàng hoá KHỐI (hộp/thùng/bao to nhỏ, chồng, có chỗ trống) thay hàng que mảnh đều nhau ("giá sách cầu vồng")
function shelves(x0, y0, x1, y1) {
  for (let y = y0 + 0.4; y < y1 - 0.2; y += 0.42) {
    rect(x0, y, x1, y + 0.04, [110, 100, 90], M_KEEP);
    for (let x = x0 + 0.03; x < x1 - 0.12;) {
      if (rnd() < 0.12) { x += R(0.1, 0.3); continue; }
      const w = Math.min(x1 - 0.03 - x, R(0.16, 0.46)), h = R(0.12, 0.34), c = GOODS[(rnd() * GOODS.length) | 0], k = R(0.6, 0.92);
      rect(x, y + 0.04, x + w, y + 0.04 + h, [c[0] * k, c[1] * k, c[2] * k], M_KEEP);
      hline(y + 0.04 + h, x, x + w, 0.012, [c[0] * k * 0.7, c[1] * k * 0.7, c[2] * k * 0.7], M_KEEP);
      if (h < 0.22 && rnd() < 0.5) { const c2 = GOODS[(rnd() * GOODS.length) | 0]; rect(x + 0.02, y + 0.05 + h, x + w * R(0.5, 0.9), y + 0.05 + h + R(0.08, 0.14), [c2[0] * k, c2[1] * k, c2[2] * k], M_KEEP); }
      x += w + R(0.01, 0.06);
    }
  }
}
// đèn tuýp trần cửa hàng (sáng cả ngày)
function tubeLight(x0, x1, y) { hline(y, x0, x1, 0.05, [250, 252, 248], M_KEEP); }
// dải biển hiệu tầng trệt 2,95-3,85 m (shader phủ chữ từ dải SIGN theo hạt giống)
// SIGN_Y/SIGN_EXT = HỢP ĐỒNG với citygen.js (hộp biển 3D ở ô gần dựng đúng vùng này): mô-đun nào gọi signBand thì
// PHẢI có trong SIGN_EXT với đúng [x0, x1] (m trong bay 4 m) — đổi ở đây thì đổi cả lời gọi trong mô-đun.
export const SIGN_Y = [2.95, 3.85];
const SB_FULL = [0.05, 3.95];
export const SIGN_EXT = {
  G_SHOP0: SB_FULL, G_SHOP1: SB_FULL, G_SHOP2: SB_FULL, G_SHOP3: SB_FULL, G_SHUT0: SB_FULL, G_SHUT1: SB_FULL,
  G_GLASS: SB_FULL, G_GATE: SB_FULL, G_OLD: [0.5, 3.5], G_MOTO: SB_FULL, G_ELEC: SB_FULL, G_HARD: SB_FULL,
  // W3-C: trệt mở theo loại hàng + showroom (cùng dải biển đầy bay)
  G_SHOW: SB_FULL, G_OPEN0: SB_FULL, G_OPEN1: SB_FULL, G_OPEN2: SB_FULL, G_FOOD: SB_FULL,
  // W4-C: mặt kính cửa hàng/ngân hàng/phòng khám (bộ G10 nhà phố hiện đại) — cùng dải biển đầy bay
  G_STORE0: SB_FULL, G_STORE1: SB_FULL, G_STORE2: SB_FULL,
};
// W3-C: biển bảng lớn nhiều tầng (PANEL0.. 2 dải 4×2 m/ô), biển dọc (BLADE0.. 4 dải 1×4 m/ô), biển trên mái (BILL0.. 2 dải/ô)
export const PANEL_CELLS = 5, BLADE_CELLS = 2, BILL_CELLS = 2;   // vòng 2: PANEL 3 → 5 ô (10 mẫu — phản biện: 6 mẫu lặp lộ ở 253/386)
function signBand(x0 = SB_FULL[0], x1 = SB_FULL[1]) {
  rect(x0, SIGN_Y[0], x1, SIGN_Y[1], [236, 236, 236], M_SIGN);
  rect(x0, SIGN_Y[0], x1, SIGN_Y[0] + 0.05, [70, 70, 72], M_KEEP); rect(x0, SIGN_Y[1] - 0.05, x1, SIGN_Y[1], [70, 70, 72], M_KEEP);
  shade(x0, SIGN_Y[0] - 0.13, x1, SIGN_Y[0], 0.6);
}
// hộp cuốn cửa (cửa cuốn đã kéo lên)
function shutterBox(x0, x1, y) { rect(x0, y, x1, y + 0.16, [150, 152, 154], M_KEEP); hline(y, x0, x1, 0.02, [90, 90, 90], M_KEEP); }
// CỬA CUỐN kim loại
function rollerShutter(x0, y0, x1, y1, col) {
  vgrad(x0, y0, x1, y1, col, [col[0] * 0.86, col[1] * 0.86, col[2] * 0.86], M_KEEP, 4);
  for (let y = y0 + 0.04; y < y1; y += 0.075) { hline(y, x0, x1, 0.016, [col[0] * 0.65, col[1] * 0.65, col[2] * 0.65], M_KEEP); hline(y + 0.02, x0, x1, 0.01, [Math.min(255, col[0] * 1.15), Math.min(255, col[1] * 1.15), Math.min(255, col[2] * 1.15)], M_KEEP); }
  // bẩn chân cửa + khoá
  shade(x0, y0, x1, y0 + 0.4, 0.85);
  rect((x0 + x1) / 2 - 0.08, y0 + 0.05, (x0 + x1) / 2 + 0.08, y0 + 0.14, [60, 60, 60], M_KEEP);
}
// bậc thềm đá + bóng chân tường
function threshold(x0 = 0, x1 = CW) { rect(x0, 0, x1, 0.14, [176, 170, 160], M_KEEP); hline(0.14, x0, x1, 0.02, [215, 210, 200], M_KEEP); }

// ---------- CHỮ (canvas nhỏ → độ sáng) ----------
const WORDS = ['CÀ PHÊ', 'TẠP HOÁ', 'PHỞ BÒ', 'SỬA XE MÁY', 'NHÀ THUỐC', 'THỜI TRANG', 'ĐIỆN THOẠI', 'BÁNH MÌ',
  'VÀNG BẠC', 'NỘI THẤT', 'IN ẤN QUẢNG CÁO', 'KÍNH MẮT', 'CƠM VĂN PHÒNG', 'ĐIỆN NƯỚC', 'BIA HƠI', 'GIÀY DÉP',
  'BÁNH ĐA CUA', 'NHÀ NGHỈ', 'HẢI SẢN', 'ĐIỆN MÁY'];
export const SIGN_CELLS = 5;   // 5 ô × 4 dải = 20 biển (shader: si = floor(hash·20))
const ADS = ['KHOAN CẮT BÊ TÔNG', 'HÚT BỂ PHỐT', 'CHO THUÊ NHÀ', 'SỬA KHOÁ', 'THÔNG CỐNG'];
function textMask(lines, w, h) {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const L of lines) { g.font = `bold ${Math.round(L.size * h)}px Arial, "Segoe UI", sans-serif`; g.fillText(L.t, w / 2, L.y * h, w * 0.94); }
  const d = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4];
  return out;   // hàng 0 = TRÊN
}
// chép mặt nạ chữ vào vùng (mét): chữ = màu col + mặt nạ m
function blitText(mask, mw, mh, x0, y0, x1, y1, col, m, op = 1) {
  if (!mask) { hline((y0 + y1) / 2, x0 + (x1 - x0) * 0.15, x1 - (x1 - x0) * 0.15, (y1 - y0) * 0.35, col, m); return; }
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const sx = Math.min(mw - 1, (((i - i0) + 0.5) / (i1 - i0) * mw) | 0), sy = Math.min(mh - 1, ((1 - ((j - j0) + 0.5) / (j1 - j0)) * mh) | 0);
    const a = mask[sy * mw + sx] / 255; if (a < 0.35) continue;
    const p = ((OY + j) * SIZE + OX + i) * 4;
    if (op >= 1) { B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; }
    else { B[p] += (col[0] - B[p]) * op; B[p + 1] += (col[1] - B[p + 1]) * op; B[p + 2] += (col[2] - B[p + 2]) * op; }   // sơn phai (W3-C)
    if (m >= 0) B[p + 3] = m;
  }
}

// ======================================================================================
// opts.layoutOnly: chỉ đăng ký thứ tự ô (MOD) — không vẽ, không cấp phát (luồng chính dựng shader ngay, còn ảnh atlas
// vẽ trong Worker: js/facade_atlas_worker.js).
export function buildFacadeAtlas(size = 2048, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  _layoutOnly = !!opts.layoutOnly;
  SIZE = size; C = size / ATLAS_N; const HGT = C * ATLAS_ROWS;   // ảnh size × HGT (hàng = SIZE px)
  B = _layoutOnly ? null : new Uint8ClampedArray(size * HGT * 4);   // Clamped: cộng sáng/bóng không tràn
  for (const k in _bases) delete _bases[k];
  MODS.length = 0; for (const k in MOD) delete MOD[k];
  const UPH = 3.3, GH = 3.9, W4 = 4;
  const FR_WHITE = [236, 236, 232], FR_SILVER = [178, 184, 188], FR_BROWN = [96, 68, 48], FR_GREEN = [58, 96, 72];
  const IRON_D = [40, 40, 40], IRON_W = [228, 228, 224];

  // =================== TẦNG TRÊN — NHÀ ỐNG HIỆN ĐẠI ===================
  cell('U_SLIDE0', W4, UPH, () => {     // cửa sổ nhôm kính lùa khung trắng + hoa sắt trắng + ô văng
    WALL(0.1); slab();
    reveal(0.45, 0.95, 3.55, 2.45); glass(0.5, 0.95, 3.5, 2.45, 0, 0); frame(0.5, 0.95, 3.5, 2.45, FR_WHITE, 0.06, 4);
    grille(0.45, 0.95, 3.55, 2.45, IRON_W, 1); sill(0.5, 3.5, 0.95); hood(0.5, 3.5, 2.55); sillStreaks(0.5, 3.5, 0.87);
  });
  cell('U_SLIDE1', W4, UPH, () => {     // 2 cửa sổ khung nâu + song sắt đen, cục nóng giữa
    WALL(0.2); slab();
    for (const x0 of [0.35, 2.35]) { reveal(x0, 1.0, x0 + 1.3, 2.4); glass(x0, 1.0, x0 + 1.3, 2.4, 1, 1); frame(x0, 1.0, x0 + 1.3, 2.4, FR_BROWN, 0.06, 2); grille(x0, 1.0, x0 + 1.3, 2.4, IRON_D, 0); sill(x0, x0 + 1.3, 1.0); sillStreaks(x0, x0 + 1.3, 0.92); }
    acUnit(1.62, 1.4, 0.7, 0.48);
  });
  cell('U_BALC0', W4, UPH, () => {     // cửa đi kính ra ban công + lan can sắt kiểu Juliet + chậu cây
    WALL(0.1); slab();
    interior(0.6, 0.2, 3.4, 2.6); reveal(0.6, 0.2, 3.4, 2.6);
    glass(0.65, 0.25, 3.35, 2.55, 0, 2); frame(0.6, 0.2, 3.4, 2.6, FR_WHITE, 0.07, 4, 1);
    railing(0.3, 3.7, 0.2, 1.0, [232, 232, 228], 0); plants(0.4, 3.6, 0.22); hood(0.6, 3.4, 2.7);
  });
  cell('U_BALC1', W4, UPH, () => {     // cửa gỗ nâu + lan can inox ngang + phơi đồ
    WALL(0.2); slab();
    interior(0.5, 0.2, 3.5, 2.55); glass(0.55, 0.25, 3.45, 2.5, 2, 0); frame(0.5, 0.2, 3.5, 2.55, FR_BROWN, 0.08, 4, 1);
    laundry(0.3, 3.7, 2.35); railing(0.2, 3.8, 0.2, 1.05, [200, 204, 208], 1);
  });
  cell('U_CAGE', W4, UPH, () => {      // "chuồng cọp": khung sắt lồng cả tầng (rất đặc trưng phố HP)
    WALL(0.35); slab();
    interior(0.25, 0.2, 3.75, 3.0, 8); glass(0.6, 0.9, 2.4, 2.4, 1, 3); frame(0.6, 0.9, 2.4, 2.4, FR_SILVER, 0.05, 2);
    plants(0.3, 3.7, 0.25); laundry(0.3, 3.7, 2.7);
    const col = [52, 58, 56];
    for (let x = 0.25; x <= 3.76; x += 0.11) vline(x, 0.2, 3.0, 0.022, col, M_KEEP);
    for (let y = 0.2; y <= 3.01; y += 0.5) hline(y, 0.25, 3.75, 0.035, col, M_KEEP);
    rect(0.2, 2.95, 3.8, 3.05, col, M_KEEP);
  });
  cell('U_TILE', W4, UPH, () => {      // ốp gạch men (không nhuộm) + cửa sổ khung bạc
    vgrad(0, 0, W4, UPH, [222, 214, 206], [212, 204, 196], M_KEEP, 6);
    for (let y = 0; y < UPH; y += 0.2) hline(y, 0, W4, 0.012, [170, 162, 154], M_KEEP);
    for (let x = 0; x < W4; x += 0.2) vline(x, 0, UPH, 0.012, [170, 162, 154], M_KEEP);
    slab(); reveal(0.6, 0.9, 3.4, 2.5); glass(0.6, 0.9, 3.4, 2.5, 3, 0); frame(0.6, 0.9, 3.4, 2.5, FR_SILVER, 0.07, 3); sill(0.6, 3.4, 0.9);
  });
  cell('U_AC', W4, UPH, () => {        // cửa sổ nhỏ + cục nóng điều hoà + ống
    WALL(0.2); slab();
    reveal(0.4, 1.05, 2.1, 2.4); glass(0.4, 1.05, 2.1, 2.4, 1, 1); frame(0.4, 1.05, 2.1, 2.4, FR_WHITE, 0.06, 2); grille(0.4, 1.05, 2.1, 2.4, IRON_D, 2); sill(0.4, 2.1, 1.05);
    acUnit(2.55, 1.25); sillStreaks(0.4, 3.4, 1.0);
  });
  cell('U_LOG', W4, UPH, () => {       // lô gia lõm: tối sâu + lan can + đồ phơi
    WALL(0.25); slab();
    interior(0.2, 0.2, 3.8, 2.85, -6); shade(0.2, 2.5, 3.8, 2.85, 0.6);
    glass(1.0, 0.25, 3.0, 2.5, 2, 0); frame(1.0, 0.25, 3.0, 2.5, FR_BROWN, 0.06, 2);
    laundry(0.3, 3.7, 2.6); railing(0.2, 3.8, 0.2, 1.05, [70, 74, 78], 0);
  });
  // =================== TẦNG TRÊN — PHỐ CŨ / THỜI PHÁP ===================
  cell('U_SHUT0', W4, UPH, () => {     // 2 cửa sổ cao + cửa chớp gỗ xanh lá, phào vữa
    WALL(0.7); slab();
    for (const x0 of [0.5, 2.3]) {
      rect(x0 - 0.12, 0.55, x0 + 1.32, 2.85, [244, 242, 236], M_WALL);   // khung vữa nổi
      shade(x0 + 1.32, 0.55, x0 + 1.4, 2.85, 0.75);
      glass(x0, 0.65, x0 + 1.2, 2.7, 2, -1);
      for (const [sx, sw] of [[x0, 0.55], [x0 + 0.65, 0.55]]) {   // 2 cánh chớp đóng hờ
        rect(sx, 0.65, sx + sw, 2.7, FR_GREEN, M_KEEP);
        for (let y = 0.7; y < 2.65; y += 0.075) hline(y, sx + 0.04, sx + sw - 0.04, 0.025, [38, 66, 50], M_KEEP);
      }
      sill(x0, x0 + 1.2, 0.65); sillStreaks(x0, x0 + 1.2, 0.55, 0.3);
    }
  });
  cell('U_SHUT1', W4, UPH, () => {     // cửa đi kiểu Pháp, 1 cánh chớp mở (lộ tối), sơn bạc
    WALL(0.75); slab();
    rect(0.75, 0.15, 3.25, 2.95, [244, 242, 236], M_WALL); shade(3.25, 0.15, 3.32, 2.95, 0.75);
    interior(0.9, 0.2, 3.1, 2.75, -5);
    const col = [88, 104, 112];
    rect(0.9, 0.2, 1.95, 2.75, col, M_KEEP); for (let y = 0.25; y < 2.7; y += 0.075) hline(y, 0.94, 1.91, 0.025, [60, 72, 80], M_KEEP);
    glass(2.05, 1.0, 3.05, 2.7, 2, -1); frame(1.95, 0.2, 3.1, 2.75, [70, 60, 50], 0.07, 1, 2);
    railing(0.8, 3.2, 0.2, 0.95, IRON_D, 0);
  });
  cell('U_ARCH', W4, UPH, () => {      // 2 cửa vòm + đá đỉnh vòm
    WALL(0.65); slab();
    for (const x0 of [0.5, 2.3]) {
      archFill(x0 - 0.12, 0.5, x0 + 1.32, 2.85, [246, 244, 238], M_WALL);
      archFill(x0, 0.6, x0 + 1.2, 2.75, [46, 44, 42], M_KEEP);
      archFill(x0 + 0.06, 0.66, x0 + 1.14, 2.69, [84, 92, 96], M_GLASS);   // ô kính vòm phía trên
      glass(x0 + 0.06, 0.66, x0 + 1.14, 2.1, 2, -1);
      vline(x0 + 0.6, 0.66, 2.69, 0.05, [70, 60, 50], M_KEEP); hline(2.1, x0 + 0.06, x0 + 1.14, 0.05, [70, 60, 50], M_KEEP);
      rect(x0 + 0.5, 2.7, x0 + 0.7, 2.98, [250, 248, 242], M_WALL);   // đá đỉnh vòm
      sill(x0, x0 + 1.2, 0.6); sillStreaks(x0, x0 + 1.2, 0.5, 0.3);
    }
  });
  cell('U_BALU', W4, UPH, () => {      // ban công lan can con tiện (balustrade) + cửa đi
    WALL(0.6); slab();
    interior(0.8, 0.2, 3.2, 2.7); glass(0.85, 0.95, 3.15, 2.65, 2, 2); frame(0.8, 0.2, 3.2, 2.7, [92, 74, 58], 0.08, 2, 2);
    rect(0.1, 0.2, 3.9, 0.32, [240, 238, 232], M_WALL); rect(0.1, 1.0, 3.9, 1.12, [246, 244, 238], M_WALL);
    for (let x = 0.2; x < 3.85; x += 0.22) {
      rect(x, 0.32, x + 0.11, 1.0, [236, 234, 228], M_WALL); shade(x + 0.11, 0.32, x + 0.14, 1.0, 0.7);
    }
    shade(0.1, 0.32, 3.9, 0.38, 0.75);
  });
  // =================== KHU TẬP THỂ ===================
  cell('U_KTT0', W4, UPH, () => {      // 2 cửa sổ song sắt + lồng cơi nới, ố nặng
    WALL(0.9); slab(0, 0.16);
    for (const x0 of [0.3, 2.4]) { reveal(x0, 0.9, x0 + 1.3, 2.3); glass(x0, 0.9, x0 + 1.3, 2.3, 2, 1); frame(x0, 0.9, x0 + 1.3, 2.3, [120, 100, 80], 0.06, 2); grille(x0, 0.9, x0 + 1.3, 2.3, IRON_D, 0); sillStreaks(x0, x0 + 1.3, 0.85, 0.35); }
    laundry(0.2, 3.8, 2.75);
  });
  cell('U_KTT1', W4, UPH, () => {      // lô gia bịt lưới B40 + điều hoà + cửa sổ
    WALL(0.85); slab(0, 0.16);
    interior(0.2, 0.2, 2.6, 2.8, 4); glass(0.5, 0.9, 2.3, 2.4, 1, 0); laundry(0.25, 2.55, 2.6);
    for (let x = 0.2; x < 2.62; x += 0.09) vline(x, 0.2, 2.8, 0.015, [70, 74, 72], M_KEEP);
    for (let y = 0.2; y < 2.82; y += 0.09) hline(y, 0.2, 2.6, 0.015, [70, 74, 72], M_KEEP);
    acUnit(2.9, 1.2, 0.8, 0.55);
  });
  // =================== VĂN PHÒNG / KHÁCH SẠN KÍNH ===================
  cell('U_CURT0', W4, UPH, () => {     // vách kính xanh lục + đố nhôm
    skyGlass(0, 0.6, W4, UPH, [172, 200, 198], [92, 120, 122], 0.55); vgrad(0, 0, W4, 0.6, [96, 118, 120], [80, 100, 104], M_KEEP, 3);   // W3-C: kính xanh lục PHẢN TRỜI (trước: gradient tối)
    for (const x of [0, 1.33, 2.66, 4]) vline(x, 0, UPH, 0.08, [180, 186, 190], M_KEEP);
    hline(0.6, 0, W4, 0.07, [180, 186, 190], M_KEEP); hline(0.04, 0, W4, 0.08, [150, 156, 160], M_KEEP);
  });
  cell('U_CURT1', W4, UPH, () => {     // kính bạc + dải spandrel
    glass(0, 0.9, W4, UPH, 0, -1); rect(0, 0, W4, 0.9, [196, 200, 204], M_KEEP);
    for (const x of [0, 2, 4]) vline(x, 0, UPH, 0.08, [120, 126, 132], M_KEEP); hline(0.9, 0, W4, 0.06, [120, 126, 132], M_KEEP);
  });
  cell('U_RIB', W4, UPH, () => {       // băng cửa sổ ngang (công sở hiện đại)
    WALL(0.2); slab(0, 0.3);
    glass(0, 1.0, W4, 2.55, 0, 1); for (const x of [0, 1, 2, 3, 4]) vline(x, 1.0, 2.55, 0.06, FR_SILVER, M_KEEP);
    hline(1.0, 0, W4, 0.06, FR_SILVER, M_KEEP); hline(2.55, 0, W4, 0.06, FR_SILVER, M_KEEP); shade(0, 2.55, W4, 2.65, 0.75);
  });
  // =================== BIỆT THỰ / CÔNG SỞ ===================
  cell('U_VILLA', W4, UPH, () => {     // cửa sổ cao chớp lật + phào + diềm tam giác
    WALL(0.4); slab();
    rect(1.05, 0.6, 2.95, 2.75, [246, 244, 238], M_WALL); shade(2.95, 0.6, 3.02, 2.75, 0.75);
    glass(1.2, 0.7, 2.8, 2.6, 0, 3); frame(1.2, 0.7, 2.8, 2.6, FR_WHITE, 0.07, 2, 3);
    for (const sx of [0.62, 2.82]) { rect(sx, 0.7, sx + 0.56, 2.6, FR_GREEN, M_KEEP); for (let y = 0.75; y < 2.55; y += 0.075) hline(y, sx + 0.04, sx + 0.52, 0.025, [38, 66, 50], M_KEEP); }
    rect(0.95, 2.8, 3.05, 2.95, [248, 246, 240], M_WALL); shade(0.95, 2.72, 3.05, 2.8, 0.7);
    sill(1.2, 2.8, 0.7);
  });
  cell('U_CIVIC', W4, UPH, () => {     // công sở/trường: 2 cửa sổ đều + trụ áp tường
    WALL(0.35); slab(0, 0.25);
    for (const x0 of [0.45, 2.25]) { reveal(x0, 0.85, x0 + 1.3, 2.6); glass(x0, 0.85, x0 + 1.3, 2.6, 1, 1); frame(x0, 0.85, x0 + 1.3, 2.6, FR_WHITE, 0.06, 2, 2); sill(x0, x0 + 1.3, 0.85); }
    rect(0, 0, 0.18, UPH, [244, 242, 236], M_WALL); shade(0.18, 0, 0.24, UPH, 0.8);
  });
  cell('U_SHED', W4, UPH, () => {      // tôn sóng vách kho (nhuộm màu)
    vgrad(0, 0, W4, UPH, [222, 222, 220], [200, 200, 198], M_WALL, 4);
    for (let x = 0; x < W4; x += 0.2) { vline(x, 0, UPH, 0.05, [170, 170, 168], M_WALL); vline(x + 0.08, 0, UPH, 0.03, [240, 240, 238], M_WALL); }
    for (let k = 0; k < 6; k++) { const x = R(0, W4); rect(x, 0, x + R(0.1, 0.4), R(0.4, 2.5), [150, 110, 80], M_KEEP, 0.35); }
  });

  // =================== TẦNG TRỆT (mặt phố) — 0-2,8 m cửa, 2,95-3,85 m BIỂN HIỆU ===================
  const groundWall = (g) => { WALL(g); };
  cell('G_SHOP0', W4, GH, () => {      // tạp hoá/cửa hàng mở: kệ hàng hai bên + đèn tuýp
    groundWall(0.2); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 6); shelves(0.2, 0.14, 1.4, 2.7); shelves(2.6, 0.14, 3.8, 2.7);
    for (let k = 0; k < 7; k++) { const x = R(1.5, 2.4), y = R(0.15, 0.9); rect(x, y, x + R(0.3, 0.6), y + R(0.25, 0.5), GOODS[(rnd() * GOODS.length) | 0], M_KEEP); }  // thùng hàng giữa lối
    tubeLight(0.3, 3.7, 2.6); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_SHOP1', W4, GH, () => {      // shop quần áo: giá treo + ma-nơ-canh
    groundWall(0.15); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 14);
    hline(2.25, 0.3, 3.7, 0.03, [180, 180, 180], M_KEEP);
    for (let x = 0.35; x < 3.6; x += R(0.12, 0.2)) { const c = GOODS[(rnd() * GOODS.length) | 0]; rect(x, R(1.2, 1.5), x + 0.1, 2.24, c, M_KEEP); }
    for (const x of [0.8, 3.0]) { rect(x - 0.12, 0.14, x + 0.12, 1.75, [210, 200, 190], M_KEEP); disc(x, 1.85, 0.12, [215, 205, 195], M_KEEP); }
    tubeLight(0.3, 3.7, 2.65); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_SHOP2', W4, GH, () => {      // quán ăn/cà phê: bàn + ghế nhựa đỏ/xanh + bảng thực đơn
    groundWall(0.25); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 10);
    rect(0.3, 1.4, 1.5, 2.3, [235, 230, 210], M_KEEP); for (let y = 1.55; y < 2.2; y += 0.14) hline(y, 0.4, 1.4, 0.04, [160, 60, 40], M_KEEP);
    for (const x of [0.5, 1.5, 2.5, 3.3]) { const c = rnd() < 0.6 ? [196, 40, 36] : [40, 90, 170]; rect(x, 0.14, x + 0.32, 0.45, c, M_KEEP); }
    rect(1.8, 0.14, 2.9, 0.75, [150, 120, 90], M_KEEP); rect(1.75, 0.72, 2.95, 0.78, [190, 170, 140], M_KEEP);
    tubeLight(0.3, 3.7, 2.62); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_SHOP3', W4, GH, () => {      // nhà thuốc/minimart: nội thất sáng, kệ trắng, cửa kính 1 phần
    groundWall(0.1); threshold();
    vgrad(0.15, 0.14, 3.85, 2.8, [210, 214, 212], [176, 178, 174], M_KEEP, 4);
    for (let y = 0.5; y < 2.5; y += 0.4) { rect(0.2, y, 3.8, y + 0.04, [240, 240, 240], M_KEEP); for (let x = 0.25; x < 3.7; x += R(0.12, 0.3)) rect(x, y + 0.04, x + 0.1, y + R(0.15, 0.3), GOODS[(rnd() * GOODS.length) | 0], M_KEEP); }
    glass(2.4, 0.14, 3.85, 2.7, 0, -1); frame(2.4, 0.14, 3.85, 2.7, FR_SILVER, 0.06, 2);
    tubeLight(0.3, 3.7, 2.65); signBand();
  });
  cell('G_SHUT0', W4, GH, () => {      // cửa cuốn bạc đóng
    groundWall(0.25); threshold();
    rollerShutter(0.12, 0.14, 3.88, 2.8, [190, 194, 198]); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_SHUT1', W4, GH, () => {      // cửa cuốn sơn xanh, hé chân (lộ tối)
    groundWall(0.35); threshold();
    rollerShutter(0.12, 0.6, 3.88, 2.8, [96, 138, 128]); interior(0.12, 0.14, 3.88, 0.6, -10); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_GLASS', W4, GH, () => {      // mặt kính cửa hàng hiện đại
    groundWall(0.1); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 30);
    for (let k = 0; k < 10; k++) { const x = R(0.3, 3.5), y = R(0.15, 1.6); rect(x, y, x + R(0.12, 0.35), y + R(0.15, 0.6), GOODS[(rnd() * GOODS.length) | 0], M_KEEP, 0.7); }
    glaze(0.15, 0.14, 3.85, 2.8, 0.3); frame(0.15, 0.14, 3.85, 2.8, [56, 58, 60], 0.08, 3); vline(2.0, 0.14, 2.3, 0.04, [200, 200, 200], M_KEEP);   // W3-C: kính TRONG (thấy hàng)
    signBand();
  });
  cell('G_GATE', W4, GH, () => {       // cửa xếp sắt kéo một nửa
    groundWall(0.3); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 4); shelves(2.0, 0.14, 3.8, 2.6);
    const col = [78, 84, 82];
    for (let x = 0.15; x < 1.95; x += 0.12) vline(x, 0.14, 2.75, 0.03, col, M_KEEP);
    for (let y = 0.3; y < 2.7; y += 0.42) for (let x = 0.15; x < 1.9; x += 0.24) {
      const i0 = PX(x), i1 = PX(x + 0.24), j0 = PY(y), j1 = PY(y + 0.42);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const u = ((i + 0.5) / SX - x) / 0.24, v = ((j + 0.5) / SY - y) / 0.42;
        if (Math.abs(Math.abs(u - 0.5) * 2 - v) < 0.07) { const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; B[p + 3] = M_KEEP; }
      }
    }
    shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_HOME0', W4, GH, () => {      // nhà ở: cửa sắt kính 4 cánh (xanh rêu/nâu) — KHÔNG biển
    groundWall(0.2); threshold();
    reveal(0.3, 0.14, 3.7, 2.9); interior(0.3, 0.14, 3.7, 2.9);
    const col = rnd() < 0.5 ? [64, 84, 70] : [92, 64, 46];
    for (let k = 0; k < 4; k++) {
      const x0 = 0.3 + k * 0.85; rect(x0, 0.14, x0 + 0.85, 2.9, col, M_KEEP);
      glass(x0 + 0.12, 1.3, x0 + 0.73, 2.75, 2, -1); grille(x0 + 0.12, 1.3, x0 + 0.73, 2.75, [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7], 0);
      for (let y = 0.3; y < 1.2; y += 0.2) hline(y, x0 + 0.1, x0 + 0.75, 0.03, [col[0] * 0.75, col[1] * 0.75, col[2] * 0.75], M_KEEP);
      vline(x0, 0.14, 2.9, 0.03, [30, 30, 30], M_KEEP);
    }
    hood(0.3, 3.7, 3.0); rect(1.6, 3.35, 2.4, 3.6, [60, 60, 60], M_KEEP);   // biển số nhà nhỏ
  });
  cell('G_HOME1', W4, GH, () => {      // nhà ở: cửa lùa sắt hé — thấy xe máy để trong nhà
    groundWall(0.3); threshold();
    reveal(0.2, 0.14, 3.8, 2.85); interior(0.2, 0.14, 3.8, 2.85, -4);
    disc(1.6, 0.35, 0.22, [30, 30, 30], M_KEEP); disc(2.5, 0.35, 0.22, [30, 30, 30], M_KEEP);
    rect(1.55, 0.45, 2.6, 0.95, [150, 30, 30], M_KEEP); rect(1.9, 0.9, 2.3, 1.2, [40, 40, 40], M_KEEP);
    const col = [150, 156, 160];
    rect(2.75, 0.14, 3.8, 2.85, col, M_KEEP); for (let y = 0.3; y < 2.8; y += 0.3) hline(y, 2.78, 3.77, 0.03, [110, 114, 118], M_KEEP);
    hood(0.2, 3.8, 2.95);
  });
  cell('G_OLD', W4, GH, () => {        // phố cũ: cửa gỗ pa-nô cao + ô thoáng vòm, ố nặng, bảng nhỏ
    WALL(0.85); threshold();
    archFill(0.4, 0.14, 3.6, 2.92, [240, 238, 232], M_WALL);
    archFill(0.55, 0.14, 3.45, 2.8, [52, 48, 44], M_KEEP);
    archFill(0.6, 2.25, 3.4, 2.75, [84, 92, 96], M_GLASS); glass(0.6, 2.25, 3.4, 2.45, 2, -1);
    for (let k = 0; k < 4; k++) {
      const x0 = 0.6 + k * 0.7, col = [72, 100, 78];
      rect(x0 + 0.02, 0.14, x0 + 0.68, 2.2, col, M_KEEP);
      rect(x0 + 0.1, 0.3, x0 + 0.6, 1.0, [60, 86, 66], M_KEEP); rect(x0 + 0.1, 1.2, x0 + 0.6, 2.05, [60, 86, 66], M_KEEP);
    }
    signBand(...SIGN_EXT.G_OLD);
  });
  cell('G_WARE', W4, GH, () => {       // kho: cửa lùa tôn lớn
    vgrad(0, 0, W4, GH, [220, 220, 218], [198, 198, 196], M_WALL, 4);
    rect(0.2, 0.1, 3.8, 3.3, [168, 172, 174], M_KEEP);
    for (let x = 0.2; x < 3.8; x += 0.18) vline(x, 0.1, 3.3, 0.04, [130, 134, 136], M_KEEP);
    shade(0.2, 0.1, 3.8, 0.6, 0.8); rect(0.1, 3.3, 3.9, 3.45, [120, 124, 126], M_KEEP);
  });
  cell('G_CIVIC', W4, GH, () => {      // công sở trệt: cửa sổ song sắt + chân tường ốp đá
    WALL(0.3); rect(0, 0, W4, 0.6, [170, 166, 158], M_KEEP); hline(0.6, 0, W4, 0.04, [220, 216, 208], M_KEEP);
    for (const x0 of [0.45, 2.25]) { reveal(x0, 0.9, x0 + 1.3, 2.9); glass(x0, 0.9, x0 + 1.3, 2.9, 1, 1); frame(x0, 0.9, x0 + 1.3, 2.9, FR_WHITE, 0.06, 2, 2); grille(x0, 0.9, x0 + 1.3, 2.9, IRON_W, 0); }
    rect(0, 3.55, W4, 3.9, [244, 242, 236], M_WALL);
  });

  // =================== TƯỜNG HÔNG / SAU / TƯỜNG CHUNG LỘ RA ===================
  cell('S_PLAIN0', W4, UPH, () => { WALL(0.3); shade(0, 3.15, W4, 3.2, 0.92); });
  cell('S_PLAIN1', W4, UPH, () => {    // vữa xi măng thô XÁM (không sơn) — vạch bay, vệt ố
    wallBase('cem', 168, 0.7, M_KEEP);
    for (let y = 0.4; y < UPH; y += R(0.55, 1.1)) shade(0, y, W4, y + 0.02, 0.9);
  });
  cell('S_PLAIN2', W4, UPH, () => { WALL(0.9); });
  cell('S_WIN', W4, UPH, () => {
    WALL(0.4);
    reveal(1.5, 1.3, 2.5, 2.3); glass(1.5, 1.3, 2.5, 2.3, 2, 1); frame(1.5, 1.3, 2.5, 2.3, FR_WHITE, 0.05, 2); grille(1.5, 1.3, 2.5, 2.3, IRON_D, 0);
    sill(1.5, 2.5, 1.3); sillStreaks(1.5, 2.5, 1.25, 0.3);
    vline(3.6, 0, UPH, 0.09, [90, 90, 92], M_KEEP);   // ống thoát nước mưa
  });
  cell('S_BRICK', W4, UPH, () => {
    WALL(0.5);
    const bx = R(0.4, 1.4), by = R(0.3, 1.2), bw = R(1.4, 2.2), bh = R(0.9, 1.5);
    for (let y = by; y < by + bh; y += 0.075) for (let x = bx + ((Math.round(y / 0.075) % 2) * 0.11); x < bx + bw; x += 0.22) {
      const r = R(112, 150); rect(x, y, x + 0.2, y + 0.062, [r, r * 0.6, r * 0.48], M_KEEP);   // W3-C: gạch nung XỈN (cam chói → nâu đỏ cũ)
      rect(x + 0.2, y, x + 0.22, y + 0.075, [150, 145, 135], M_KEEP); rect(x, y + 0.062, x + 0.22, y + 0.075, [150, 145, 135], M_KEEP);
    }
  });
  cell('S_ADS', W4, UPH, () => {       // quảng cáo vẽ tay trên tường hồi (đặc sản phố VN) — từ CHUNG, không thương hiệu
    WALL(0.5);
    const t = textMask([{ t: ADS[1], size: 0.34, y: 0.3 }, { t: '0000.345.678', size: 0.3, y: 0.72 }], 512, 128);
    blitText(t, 512, 128, 0.15, 1.2, 3.85, 2.3, [178, 34, 30], M_KEEP);
  });
  cell('S_BACK', W4, UPH, () => {      // mặt sau: cửa sổ nhỏ + cục nóng + ống
    WALL(0.5);
    reveal(0.5, 1.2, 1.6, 2.3); glass(0.5, 1.2, 1.6, 2.3, 1, 0); frame(0.5, 1.2, 1.6, 2.3, FR_SILVER, 0.05, 2); grille(0.5, 1.2, 1.6, 2.3, IRON_D, 2);
    acUnit(2.4, 1.3, 0.72, 0.5); vline(3.5, 0, UPH, 0.08, [150, 150, 150], M_KEEP); sillStreaks(0.5, 1.6, 1.15, 0.3);
  });
  // =================== LAN CAN MÁI (0,9 m) ===================
  cell('P_PLAIN', W4, 0.9, () => {
    WALL(0.4); rect(0, 0.78, W4, 0.9, [238, 236, 230], M_WALL); shade(0, 0.7, W4, 0.78, 0.7);
    for (let i = 0; i < 3; i++) { const x = R(0, W4); shade(x, 0.0, x + R(0.1, 0.4), 0.7, 0.85); }
  });
  cell('P_BALU', W4, 0.9, () => {
    WALL(0.6); rect(0, 0, W4, 0.14, [236, 234, 228], M_WALL); rect(0, 0.76, W4, 0.9, [244, 242, 236], M_WALL); shade(0, 0.7, W4, 0.76, 0.7);
    for (let x = 0.12; x < 3.95; x += 0.25) { rect(x, 0.14, x + 0.12, 0.7, [238, 236, 230], M_WALL); shade(x + 0.12, 0.14, x + 0.25, 0.7, 0.62); }
  });
  // =================== MÁI (4×4 m) ===================
  cell('R_CONC', 4, 4, () => {         // sàn mái bê tông: ố, nứt, vệt nước đọng (nhuộm màu mái)
    // nền TỐI hơn tường (vệ tinh HP: mái bê tông phơi mưa nắng xám sẫm loang mốc đen, không xám sáng như tường sơn)
    // Ô LẶP mỗi 4 m trên mọi mái → vết loang phải MỀM (vệt đậm/vạch nứt lặp lại thành "lưới caro" khi nhìn từ trên cao);
    // độ biến thiên giữa các mái lấy từ hạt giống nhà trong shader (roofVar), không từ texture.
    wallBase('roofc', 180, 0.4);
    for (let k = 0; k < 4; k++) { const x = R(0, 4), y = R(0, 4); shade(x, y, x + R(0.6, 1.8), y + R(0.5, 1.4), R(0.9, 0.95)); }
  });
  cell('R_TERR', 4, 4, () => {         // gạch lá nem 30 cm ĐỎ NUNG (sân thượng nhà ống — mảng đỏ chủ đạo trên vệ tinh HP)
    vgrad(0, 0, 4, 4, [176, 96, 70], [168, 90, 66], M_KEEP, 10);   // GIỮ màu (không nhuộm xám theo màu mái bê tông)
    for (let y = 0; y < 4; y += 0.3) for (let x = 0; x < 4; x += 0.3) { const k = 0.82 + hash3(x * 10 | 0, y * 10 | 0, 9) * 0.3; shade(x, y, x + 0.29, y + 0.29, k); }
    for (let y = 0; y < 4; y += 0.3) hline(y, 0, 4, 0.025, [150, 132, 118], M_KEEP);
    for (let x = 0; x < 4; x += 0.3) vline(x, 0, 4, 0.025, [150, 132, 118], M_KEEP);
    for (let k = 0; k < 6; k++) { const x = R(0, 4), y = R(0, 4); shade(x, y, x + R(0.3, 1.4), y + R(0.3, 1.2), R(0.7, 0.88)); }   // rêu/ố nước
  });
  cell('R_TON', 4, 4, () => {          // tôn sóng (sóng chạy dọc v = dọc dốc mái) + gỉ
    for (let i = 0; i < C; i++) {
      const xm = (i + 0.5) / SX, w = 0.5 + 0.5 * Math.cos((xm / 0.2) * Math.PI * 2);
      const base = 180 + w * 50;
      for (let j = 0; j < C; j++) { const p = ((OY + j) * SIZE + OX + i) * 4, n = (hash3(i, j, 11) - 0.5) * 6; B[p] = base + n; B[p + 1] = base + n; B[p + 2] = base + n; B[p + 3] = M_WALL; }
    }
    // vệt gỉ chảy dọc sóng: CHỈ làm tối (giữ mặt nạ tường → vẫn nhuộm màu tôn). Bản cũ tô M_KEEP nâu → trên tôn xanh
    // thành vạch trắng hồng lạ mắt.
    for (let k = 0; k < 10; k++) { const x = R(0, 4); shade(x, R(0, 2), x + R(0.05, 0.25), R(2, 4), R(0.7, 0.85)); }
    for (let y = 0.95; y < 4; y += 1.0) hline(y, 0, 4, 0.03, [120, 120, 120], M_WALL);   // mối nối tấm
  });
  cell('R_TILE', 4, 4, () => {         // ngói đất nung (hàng ngói ngang, sóng nhỏ)
    for (let j = 0; j < C; j++) {
      const ym = (j + 0.5) / SY, row = Math.floor(ym / 0.3), fy = (ym / 0.3) % 1;
      for (let i = 0; i < C; i++) {
        const xm = (i + 0.5) / SX + (row % 2) * 0.1, fx = (xm / 0.2) % 1;
        const v = 175 + 55 * Math.sin(fx * Math.PI) * (0.6 + 0.4 * fy) - (fy < 0.12 ? 60 : 0) + (hash3(row, Math.floor(xm / 0.2), 4) - 0.5) * 30;
        const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = v; B[p + 1] = v; B[p + 2] = v; B[p + 3] = M_WALL;
      }
    }
    for (let k = 0; k < 5; k++) { const x = R(0, 4), y = R(0, 4); shade(x, y, x + R(0.4, 1.4), y + R(0.3, 1.0), 0.8); }
  });
  // =================== CHI TIẾT ===================
  cell('D_PLAIN', 4, 4, () => { wallBase('dpl', 222, 0.35); });
  cell('D_BALW', 4, 1.1, () => {       // tường lan can ban công xây (nhuộm màu nhà) + gờ đỉnh
    WALL(0.35); rect(0, 0.98, 4, 1.1, [244, 242, 236], M_WALL); shade(0, 0.9, 4, 0.98, 0.72); shade(0, 0, 4, 0.08, 0.8);
    for (let x = 0.3; x < 3.8; x += 1.2) rect(x, 0.3, x + 0.8, 0.7, [236, 234, 228], M_WALL);   // ô trang trí
  });
  cell('D_RAIL', 4, 1.1, () => {       // lan can sắt sơn (song đứng) — sau lưng là sàn ban công + chân cửa (nền vữa sáng)
    wallBase('rail', 214, 0.35, M_WALL);   // nền = tường lùi phía sau (nhuộm màu nhà, tối hơn chút)
    shade(0, 0, 4, 1.1, 0.78);
    rect(0.9, 0, 3.1, 1.1, [92, 84, 74], M_KEEP); glass(1.0, 0.25, 3.0, 1.1, 2, -1);   // chân cửa đi phía sau
    for (let k = 0; k < 3; k++) { const x = R(0.2, 3.4); rect(x, 0, x + 0.3, 0.28, [150, 80, 50], M_KEEP); disc(x + 0.15, 0.45, 0.2, [R(40, 70), R(95, 135), R(40, 60)], M_KEEP); }
    const col = rnd() < 0.5 ? [44, 46, 48] : [226, 228, 228];
    railing(0, 4, 0, 1.0, col, 0); hline(1.03, 0, 4, 0.07, col, M_KEEP);
  });
  cell('D_AWN', 4, 1.6, () => {        // mái hiên bạt sọc (nhuộm màu bạt) — sọc dọc dốc
    for (let i = 0; i < C; i++) {
      const xm = (i + 0.5) / SX, s = Math.floor(xm / 0.25) % 2;
      for (let j = 0; j < C; j++) { const p = ((OY + j) * SIZE + OX + i) * 4, n = (hash3(i, j, 13) - 0.5) * 8 + 220 - (j / C) * 30; B[p] = n + (s ? 18 : 0); B[p + 1] = n + (s ? 18 : 0); B[p + 2] = n + (s ? 18 : 0); B[p + 3] = s ? M_KEEP : M_WALL; }
    }
    for (let k = 0; k < 4; k++) { const x = R(0, 4); shade(x, 0, x + R(0.2, 0.8), 1.6, 0.86); }
  });
  cell('D_TANK', 4, 4, () => {         // inox xước (bồn nước) — sọc ngang sáng tối
    for (let j = 0; j < C; j++) {
      const ym = (j + 0.5) / SY, v = 175 + 55 * Math.sin((ym / 4) * Math.PI) + (hash3(0, j, 17) - 0.5) * 20;
      for (let i = 0; i < C; i++) { const p = ((OY + j) * SIZE + OX + i) * 4; const n = (hash3(i, j, 19) - 0.5) * 8; B[p] = v + n; B[p + 1] = v + n + 2; B[p + 2] = v + n + 5; B[p + 3] = M_KEEP; }
    }
    for (const y of [0.6, 3.4]) hline(y, 0, 4, 0.08, [140, 144, 148], M_KEEP);
  });
  cell('D_SOLAR', 4, 4, () => {        // máy nước nóng mặt trời: ống thuỷ tinh đen-xanh + khung trắng
    rect(0, 0, 4, 4, [210, 212, 214], M_KEEP);
    for (let x = 0.1; x < 3.9; x += 0.16) { rect(x, 0.3, x + 0.12, 3.7, [40, 52, 70], M_KEEP); vline(x + 0.03, 0.3, 3.7, 0.02, [120, 140, 170], M_KEEP); }
    rect(0, 3.6, 4, 4, [228, 228, 226], M_KEEP);
  });
  cell('D_DOOR', 4, 3.0, () => {       // mặt tum thang: cửa sắt + ô thoáng (nhuộm màu tường)
    WALL(0.6); rect(1.3, 0, 2.7, 2.2, [70, 86, 80], M_KEEP); for (let y = 0.2; y < 2.1; y += 0.3) hline(y, 1.4, 2.6, 0.03, [50, 64, 58], M_KEEP);
    rect(1.3, 2.45, 2.7, 2.75, [60, 60, 60], M_KEEP); for (let x = 1.35; x < 2.7; x += 0.12) vline(x, 2.45, 2.75, 0.03, [200, 200, 200], M_KEEP);
  });
  cell('D_SIGNF', 4, 1, () => {        // mặt bên/đáy biển hiệu hộp — khung tôn sơn tối
    vgrad(0, 0, 4, 1, [90, 92, 96], [60, 62, 66], M_KEEP, 4);
  });

  // =================== DẢI BIỂN HIỆU (4 dải 4×1 m mỗi ô, 16 biến thể) ===================
  // Nền = M_SIGN (shader nhuộm màu biển theo hạt giống nhà/bay), chữ = M_TEXT (shader tô màu tương phản),
  // viền = giữ màu. Chữ lớn + dòng nhỏ (SĐT/địa chỉ chung chung) — KHÔNG tên thương hiệu thật.
  for (let s = 0; s < SIGN_CELLS; s++) cell('SIGN' + s, 4, 4, () => {
    for (let k = 0; k < 4; k++) {
      const y0 = k * 1.0, wi = s * 4 + k, word = WORDS[wi % WORDS.length];
      vgrad(0, y0, 4, y0 + 1, [246, 246, 246], [212, 212, 212], M_SIGN, 4);
      rect(0, y0, 4, y0 + 0.05, [56, 56, 58], M_KEEP); rect(0, y0 + 0.95, 4, y0 + 1, [56, 56, 58], M_KEEP);
      rect(0, y0, 0.05, y0 + 1, [56, 56, 58], M_KEEP); rect(3.95, y0, 4, y0 + 1, [56, 56, 58], M_KEEP);
      // SĐT GIẢ RÕ RÀNG: đầu '0000.' không phải mã vùng/mạng VN nào → không thể trùng thuê bao thật (từng dùng '0225.3xxx' = định dạng máy bàn HP thật)
      const ph = '0000.' + String(100 + ((wi * 37) % 900)) + '.' + String(100 + ((wi * 71) % 900));
      const t = textMask([{ t: word, size: 0.52, y: 0.4 }, { t: 'ĐT: ' + ph, size: 0.2, y: 0.84 }], 512, 128);
      blitText(t, 512, 128, 0.12, y0 + 0.08, 3.88, y0 + 0.92, [255, 255, 255], M_TEXT);
    }
  });
  // mặt trước CỤC NÓNG ĐIỀU HOÀ 3D (citygen dựng hộp 0,82×0,56×0,3 m trên mặt phố ở ô gần) — ô = đúng 1 mặt máy.
  // Đặt SAU các ô biển (SIGN0.. phải liên tiếp) → chỉ số các ô cũ không đổi.
  cell('D_AC', 0.82, 0.56, () => {
    vgrad(0, 0, 0.82, 0.56, [232, 232, 228], [204, 204, 200], M_KEEP, 4);
    rect(0, 0, 0.82, 0.02, [150, 150, 146], M_KEEP); rect(0, 0.54, 0.82, 0.56, [246, 246, 242], M_KEEP);
    for (let k = 0; k < 7; k++) hline(0.08 + k * 0.06, 0.06, 0.42, 0.018, [150, 150, 148], M_KEEP);
    disc(0.62, 0.28, 0.19, [96, 98, 100], M_KEEP); disc(0.62, 0.28, 0.17, [70, 72, 74], M_KEEP);
    for (let k = -2; k <= 2; k++) hline(0.28 + k * 0.06, 0.46, 0.78, 0.012, [150, 152, 154], M_KEEP);   // lưới quạt
    disc(0.62, 0.28, 0.045, [210, 210, 206], M_KEEP);
  });
  // =================== THÊM BIẾN THỂ TẦNG TRỆT (sau D_AC → chỉ số ô cũ giữ nguyên) ===================
  // Phản biện WP2: khi WP1 v1 nối mặt phố liền, cùng 1 nội thất "kệ hàng nhiều màu" lặp cả dãy → thêm 3 kiểu cửa hàng
  // rất HP: sửa xe máy, điện thoại/điện máy, điện nước/vật liệu. Đều có dải biển (SIGN_EXT).
  cell('G_MOTO', W4, GH, () => {       // sửa xe máy: nền tối dầu mỡ, lốp treo tường, xe đang sửa, máy nén khí đỏ
    groundWall(0.45); threshold();
    interior(0.15, 0.14, 3.85, 2.8, -8);
    rect(0.15, 0.14, 3.85, 0.5, [70, 66, 60], M_KEEP); for (let k = 0; k < 6; k++) { const x = R(0.3, 3.4); shade(x, 0.14, x + R(0.2, 0.5), 0.45, 0.7); }
    for (let k = 0; k < 5; k++) { const x = 0.45 + k * 0.42, y = R(1.9, 2.3); disc(x, y, 0.2, [22, 22, 24], M_KEEP); disc(x, y, 0.1, [58, 54, 50], M_KEEP); }   // lốp treo
    rect(2.6, 1.6, 3.7, 2.5, [92, 86, 78], M_KEEP); for (let k = 0; k < 9; k++) { const x = R(2.65, 3.6), y = R(1.65, 2.4); rect(x, y, x + 0.05, y + R(0.12, 0.25), [170, 170, 172], M_KEEP); }   // bảng đồ nghề
    disc(1.1, 0.42, 0.26, [26, 26, 28], M_KEEP); disc(2.2, 0.42, 0.26, [26, 26, 28], M_KEEP); disc(1.1, 0.42, 0.1, [150, 150, 150], M_KEEP); disc(2.2, 0.42, 0.1, [150, 150, 150], M_KEEP);
    rect(1.15, 0.55, 2.15, 0.95, [40, 70, 140], M_KEEP); rect(1.5, 0.95, 1.95, 1.18, [30, 30, 32], M_KEEP); rect(2.0, 0.9, 2.12, 1.3, [60, 60, 62], M_KEEP);   // xe máy
    rect(3.2, 0.14, 3.75, 0.62, [176, 40, 34], M_KEEP); disc(3.47, 0.75, 0.13, [176, 40, 34], M_KEEP);   // máy nén khí
    tubeLight(0.4, 2.4, 2.62); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_ELEC', W4, GH, () => {       // điện thoại/điện máy: nội thất trắng sáng, tủ kính trưng bày, tranh quảng cáo chung
    groundWall(0.1); threshold();
    vgrad(0.15, 0.14, 3.85, 2.8, [226, 228, 230], [190, 192, 194], M_KEEP, 3);
    for (const [x0, x1] of [[0.25, 1.05], [2.95, 3.75]]) { rect(x0, 1.3, x1, 2.45, [R(40, 200), R(80, 160), R(120, 220)], M_KEEP); rect(x0 + 0.08, 1.38, x1 - 0.08, 1.75, [245, 245, 245], M_KEEP); }   // tranh
    for (let y = 1.5; y < 2.4; y += 0.3) { rect(1.2, y, 2.8, y + 0.03, [250, 250, 250], M_KEEP); for (let x = 1.25; x < 2.75; x += 0.16) rect(x, y + 0.03, x + 0.09, y + 0.2, [30 + R(0, 40), 32, 36], M_KEEP); }   // kệ máy
    rect(0.3, 0.14, 3.7, 1.0, [150, 156, 162], M_KEEP); glass(0.35, 0.45, 3.65, 0.95, 0, -1); frame(0.3, 0.4, 3.7, 1.0, FR_SILVER, 0.04, 3);   // tủ kính
    for (let x = 0.5; x < 3.5; x += 0.3) rect(x, 0.5, x + 0.12, 0.62, [24, 26, 30], M_KEEP);
    tubeLight(0.3, 3.7, 2.68); tubeLight(0.3, 3.7, 2.55); signBand();
  });
  cell('G_HARD', W4, GH, () => {       // điện nước/vật liệu: cuộn dây, ống nhựa dựng, xô chậu, bao tải chất cửa
    groundWall(0.35); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 2);
    for (let x = 0.25; x < 1.3; x += 0.09) vline(x, 0.14, R(2.1, 2.6), 0.06, rnd() < 0.6 ? [228, 228, 222] : [120, 128, 134], M_KEEP);   // ống nhựa dựng
    for (let k = 0; k < 6; k++) { const x = R(1.5, 3.6), y = R(1.6, 2.5), c = [[200, 100, 40], [40, 80, 160], [30, 30, 30], [190, 40, 36]][(rnd() * 4) | 0]; disc(x, y, 0.17, c, M_KEEP); disc(x, y, 0.07, [50, 46, 42], M_KEEP); }   // cuộn dây treo
    for (let k = 0; k < 5; k++) { const x = R(1.4, 3.4), c = [[60, 110, 170], [200, 60, 50], [70, 140, 80], [220, 180, 60]][(rnd() * 4) | 0]; rect(x, 0.14, x + R(0.3, 0.45), R(0.45, 0.75), c, M_KEEP); }   // xô/chậu
    rect(0.2, 0.14, 1.3, 0.5, [196, 186, 160], M_KEEP); hline(0.32, 0.2, 1.3, 0.02, [160, 150, 128], M_KEEP);   // bao tải
    tubeLight(0.3, 3.7, 2.62); shutterBox(0.12, 3.88, 2.8); signBand();
  });

  // ======================================================================================
  // W3-C FACADES (Đợt 3 wave 3, AUDIT3 FP-3 + FP-8): TỪ VỰNG MẶT TIỀN MỚI — đặt SAU G_HARD → chỉ số mọi ô cũ GIỮ NGUYÊN.
  // Thuộc địa Pháp / tân cổ điển, tập thể xuống cấp, đang xây (khung + lưới + rào tôn), kính phản trời / kính sẫm khung trắng,
  // ốp alu, cao tầng hiện đại, cây leo, trệt MỞ theo loại hàng (cà phê, quần áo, đồ gỗ, quán ăn, showroom), tường hồi lộ
  // (ố/xi măng thô/quảng cáo sơn), mái hiên TÔN, biển bảng lớn nhiều tầng, biển dọc, biển quảng cáo trên mái. Từ CHUNG, 0 thương hiệu.
  // ======================================================================================
  const OCH_L = [246, 240, 226];   // gờ/phào/khung vữa sáng (nhuộm màu nhà)
  const pilaster = (x0, x1, y0 = 0, y1 = UPH) => { rect(x0, y0, x1, y1, OCH_L, M_WALL); shade(x1, y0, Math.min(CW, x1 + 0.06), y1, 0.74); shade(x0, y0, x0 + 0.03, y1, 0.9); };
  const louvre = (x0, y0, x1, y1, col) => {
    const d = [col[0] * 0.66, col[1] * 0.66, col[2] * 0.66];
    rect(x0, y0, x1, y1, col, M_KEEP);
    for (let y = y0 + 0.06; y < y1 - 0.04; y += 0.07) hline(y, x0 + 0.04, x1 - 0.04, 0.022, d, M_KEEP);
    rect(x0, y0, x1, y0 + 0.04, d, M_KEEP); rect(x0, y1 - 0.04, x1, y1, d, M_KEEP); vline(x0 + 0.02, y0, y1, 0.04, d, M_KEEP); vline(x1 - 0.02, y0, y1, 0.04, d, M_KEEP);
  };
  const SHUT_C = [[58, 96, 72], [64, 92, 104], [98, 70, 50], [70, 104, 84], [52, 84, 66]];
  const column = (xc, w, y0, y1) => {     // cột tròn: thân sáng + rãnh soi + bóng khối tròn
    vgrad(xc - w / 2, y0, xc + w / 2, y1, [246, 244, 238], [236, 234, 228], M_WALL, 3);
    shade(xc + w * 0.18, y0, xc + w / 2, y1, 0.8); shade(xc - w / 2, y0, xc - w * 0.36, y1, 0.9);
    for (let k = -2; k <= 2; k++) vline(xc + k * w * 0.16, y0 + 0.12, y1 - 0.12, 0.012, [204, 200, 192], M_WALL);
    rect(xc - w / 2 - 0.06, y1 - 0.16, xc + w / 2 + 0.06, y1, [248, 246, 240], M_WALL); rect(xc - w / 2 - 0.06, y0, xc + w / 2 + 0.06, y0 + 0.14, [240, 238, 232], M_WALL);
  };
  // ---- thuộc địa Pháp (Điện Biên Phủ, Hoàng Văn Thụ, Minh Khai, Lý Tự Trọng, Tam Bạc...) ----
  cell('U_COL0', W4, UPH, () => {      // trụ áp tường + gờ đầu tầng + cửa sổ CAO khung vữa, 2 cánh chớp lật mở nửa, lan can sắt Juliet
    WALL(0.75); slab(0, 0.16);
    pilaster(0, 0.3); pilaster(3.7, 4.0);
    rect(0, 2.98, W4, UPH, OCH_L, M_WALL); shade(0, 2.9, W4, 2.98, 0.66); hline(3.14, 0, W4, 0.03, [214, 208, 196], M_WALL);
    rect(1.16, 0.32, 2.84, 2.82, OCH_L, M_WALL); shade(2.84, 0.32, 2.91, 2.82, 0.72);
    interior(1.3, 0.42, 2.7, 2.66, -6); glass(1.62, 0.95, 2.38, 2.6, 2, -1); frame(1.3, 0.42, 2.7, 2.66, [86, 70, 56], 0.06, 2, 2);
    const sc = SHUT_C[(rnd() * SHUT_C.length) | 0];
    louvre(1.3, 0.42, 1.64, 2.66, sc); louvre(2.36, 0.42, 2.7, 2.66, sc);
    rect(1.88, 2.66, 2.12, 2.88, [250, 246, 236], M_WALL);   // đá đỉnh
    railing(1.24, 2.76, 0.42, 0.78, IRON_D, 0);
    sill(1.3, 2.7, 0.42); sillStreaks(1.24, 2.76, 0.34, 0.35);
  });
  cell('U_COL1', W4, UPH, () => {      // cửa đi VÒM + ô kính quạt + ban công sắt hoa văn trên bậu đá
    WALL(0.7); slab(0, 0.16);
    pilaster(0, 0.26); pilaster(3.74, 4.0);
    rect(0, 3.02, W4, UPH, OCH_L, M_WALL); shade(0, 2.95, W4, 3.02, 0.66);
    archFill(1.0, 0.2, 3.0, 2.94, OCH_L, M_WALL);
    archFill(1.12, 0.22, 2.88, 2.84, [40, 38, 36], M_KEEP);
    archFill(1.18, 2.0, 2.82, 2.78, [100, 112, 116], M_GLASS);
    const sc = SHUT_C[(rnd() * SHUT_C.length) | 0];
    louvre(1.16, 0.22, 1.98, 1.98, sc); glass(2.02, 0.3, 2.84, 1.95, 2, -1); frame(2.0, 0.22, 2.86, 1.98, sc, 0.07, 1, 3);
    hline(1.99, 1.12, 2.88, 0.06, [80, 66, 52], M_KEEP);
    rect(0.72, 0.12, 3.28, 0.28, [238, 234, 224], M_WALL); shade(0.72, 0.04, 3.28, 0.12, 0.6);
    grille(0.78, 0.28, 3.22, 1.18, IRON_D, 2); hline(1.2, 0.76, 3.24, 0.06, IRON_D, M_KEEP);
  });
  cell('U_NEO', W4, UPH, () => {       // tân cổ điển TRẮNG (công sở/ngân hàng khu Pháp): cột ở 2 mép bay (ghép = 1 cột) + cửa sổ trán tam giác
    WALL(0.4); slab(0, 0.2);
    column(0.0, 0.62, 0.2, 2.95); column(4.0, 0.62, 0.2, 2.95);
    rect(0, 2.95, W4, UPH, [248, 246, 240], M_WALL); shade(0, 2.88, W4, 2.95, 0.62); hline(3.1, 0, W4, 0.03, [206, 202, 194], M_WALL);
    rect(1.15, 0.45, 2.85, 2.4, [248, 246, 240], M_WALL); shade(2.85, 0.45, 2.92, 2.4, 0.72);
    reveal(1.28, 0.55, 2.72, 2.3); glass(1.28, 0.55, 2.72, 2.3, 0, 3); frame(1.28, 0.55, 2.72, 2.3, FR_WHITE, 0.06, 2, 3);
    for (let j = 0; j < 12; j++) { const t = j / 12, y = 2.44 + t * 0.4, hw = 0.95 * (1 - t); rect(2 - hw, y, 2 + hw, y + 0.04, [250, 248, 242], M_WALL); }
    shade(1.05, 2.4, 2.95, 2.44, 0.7);
    sill(1.28, 2.72, 0.55); sillStreaks(1.28, 2.72, 0.47, 0.2);
  });
  // ---- tập thể xuống cấp, đang xây ----
  cell('U_TEN', W4, UPH, () => {       // tập thể cũ: lồng sắt cơi nới gỉ, mảng tôn vá, đồ phơi xỉn, chậu cây, ố đen
    WALL(0.95); slab(0, 0.16);
    interior(0.3, 0.25, 3.7, 2.9, -4);
    glass(0.7, 1.0, 2.0, 2.4, 2, 1); frame(0.7, 1.0, 2.0, 2.4, [96, 84, 70], 0.05, 2);
    rect(2.3, 0.25, 3.7, 1.7, [118, 128, 132], M_KEEP); for (let x = 2.32; x < 3.68; x += 0.12) vline(x, 0.25, 1.7, 0.04, [92, 100, 104], M_KEEP);
    laundry(0.35, 3.65, 2.75); plants(0.35, 2.2, 0.28);
    const col = [74, 62, 54];
    for (let x = 0.3; x <= 3.71; x += 0.12) vline(x, 0.25, 2.95, 0.022, col, M_KEEP);
    for (let y = 0.25; y <= 2.96; y += 0.55) hline(y, 0.3, 3.7, 0.04, col, M_KEEP);
    for (let k = 0; k < 6; k++) softStreak(R(0.1, 3.9), R(0.04, 0.12), R(1.6, 2.9), R(0.8, 2.2), R(0.2, 0.36));   // vệt gỉ/ố chảy
  });
  cell('U_CONS', W4, UPH, () => {      // ĐANG XÂY: khung bê tông thô, tường gạch xây dở, lưới che xanh một phần, ống giàn giáo
    wallBase('cem', 168, 0.7, M_KEEP);
    interior(0.32, 0.34, 3.68, 2.95, -14);
    const by = R(0.7, 1.4);
    for (let y = 0.34; y < 0.34 + by; y += 0.075) for (let x = 0.32 + ((Math.round(y / 0.075) % 2) * 0.11); x < 3.68; x += 0.22) {
      const r = R(118, 152); rect(x, y, Math.min(3.68, x + 0.2), y + 0.062, [r, r * 0.58, r * 0.46], M_KEEP);
    }
    shade(0.32, 2.75, 3.68, 2.95, 0.6);
    rect(2.2, 0, W4, UPH, [46, 112, 68], M_KEEP, 0.78); for (let y = 0; y < UPH; y += 0.16) hline(y, 2.2, W4, 0.012, [30, 80, 48], M_KEEP);
    for (const x of [0.15, 3.85]) vline(x, 0, UPH, 0.05, [120, 124, 130], M_KEEP);
    hline(1.65, 0, W4, 0.05, [120, 124, 130], M_KEEP); hline(0.05, 0, W4, 0.05, [120, 124, 130], M_KEEP);
  });
  cell('U_NET', W4, UPH, () => {       // ĐANG XÂY: phủ kín lưới che (xanh lá/ đen) — thấy lờ mờ khung + giàn giáo phía sau
    wallBase('cem', 168, 0.7, M_KEEP); interior(0.3, 0.3, 3.7, 2.95, -10);
    vgrad(0, 0, W4, UPH, [52, 116, 74], [40, 96, 60], M_KEEP, 6);
    for (let y = 0; y < UPH; y += 0.14) hline(y, 0, W4, 0.012, [30, 76, 46], M_KEEP);
    for (let x = 0; x < W4; x += 0.14) vline(x, 0, UPH, 0.012, [34, 84, 50], M_KEEP);
    for (const x of [0.6, 2.6]) shade(x, 0, x + 0.08, UPH, 0.7);
    shade(0, 0.0, W4, 0.25, 0.75); shade(0, 1.6, W4, 1.68, 0.8);
  });
  // ---- kính/hiện đại ----
  cell('U_CURT2', W4, UPH, () => {     // vách kính PHẢN TRỜI sáng + đố nhôm sáng + dải spandrel (hết "khối kính đen")
    for (let p = 0; p < 3; p++) { const x0 = (p * 4) / 3, k = R(0.9, 1.06); skyGlass(x0, 0.85, x0 + 4 / 3, UPH, [200 * k, 216 * k, 228 * k], [120 * k, 142 * k, 160 * k], 0.6); }
    vgrad(0, 0, W4, 0.85, [108, 122, 136], [88, 100, 114], M_KEEP, 3);
    for (const x of [0, 4 / 3, 8 / 3, 4]) vline(x, 0, UPH, 0.07, [206, 210, 214], M_KEEP);
    hline(0.85, 0, W4, 0.06, [206, 210, 214], M_KEEP); hline(0.03, 0, W4, 0.06, [176, 180, 184], M_KEEP); hline(2.3, 0, W4, 0.035, [196, 200, 204], M_KEEP);
  });
  cell('U_CURT3', W4, UPH, () => {     // kính sẫm + khung TRẮNG dày (ngân hàng/showroom) — luôn thấy lưới khung
    skyGlass(0, 0, W4, UPH, [122, 138, 150], [56, 66, 76], 0.45);
    for (const x of [0, 1, 2, 3, 4]) vline(x, 0, UPH, 0.11, [232, 232, 228], M_KEEP);
    for (const y of [0.05, 1.15, 3.25]) hline(y, 0, W4, 0.1, [232, 232, 228], M_KEEP);
    shade(0, 3.12, W4, 3.2, 0.7);
  });
  cell('U_ACP', W4, UPH, () => {       // ỐP ALU nhà phố cải tạo: tấm phẳng (nhuộm màu nhà) + mạch ghép + băng kính ngang
    vgrad(0, 0, W4, UPH, [240, 240, 238], [228, 228, 226], M_WALL, 2);
    for (const x of [0, 1.0, 2.0, 3.0, 4.0]) vline(x, 0, UPH, 0.025, [172, 174, 176], M_WALL);
    for (const y of [0.02, 0.85, 2.45, 3.28]) hline(y, 0, W4, 0.025, [172, 174, 176], M_WALL);
    skyGlass(0.08, 0.92, 3.92, 2.38, [178, 198, 210], [94, 112, 126], 0.45); frame(0.08, 0.92, 3.92, 2.38, [60, 62, 64], 0.05, 4, 1);
    shade(0.08, 2.32, 3.92, 2.38, 0.7);
  });
  cell('U_TOWER', W4, UPH, () => {     // cao tầng hiện đại: cửa kính lớn + lan can KÍNH + gờ sàn dày + cục nóng
    WALL(0.12); slab(0, 0.28);
    skyGlass(0.35, 0.3, 3.0, 2.86, [188, 206, 218], [98, 116, 130], 0.5); frame(0.35, 0.3, 3.0, 2.86, [70, 72, 74], 0.05, 3, 1);
    vgrad(0.2, 0.3, 3.2, 1.3, [184, 206, 210], [156, 180, 188], M_GLASS, 3); hline(1.3, 0.2, 3.2, 0.05, [206, 210, 212], M_KEEP);
    acUnit(3.28, 0.34, 0.6, 0.42);
  });
  cell('U_VINE', W4, UPH, () => {      // tường cũ phủ CÂY LEO quanh cửa sổ (+ vài chấm hoa giấy)
    WALL(0.7); slab();
    reveal(1.2, 0.95, 2.8, 2.45); glass(1.2, 0.95, 2.8, 2.45, 2, 1); frame(1.2, 0.95, 2.8, 2.45, FR_BROWN, 0.06, 2);
    // khối lá DÀY theo cụm (mỗi cụm ~60-90 lá nhỏ 3-8 cm, sắc độ lệch nhau) — tránh "chấm bi" đều
    const clump = (cx, cy, rad, n) => {
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * rad, g = R(0.62, 1.2), y = R(0.85, 1.1);
        disc(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 1.3, R(0.03, 0.08), [42 * g, 84 * g * y, 40 * g], M_KEEP);
      }
    };
    for (let k = 0; k < 9; k++) clump(R(0, 1.25), R(0, UPH), R(0.3, 0.6), 90);
    for (let k = 0; k < 6; k++) clump(R(2.75, 4), R(0, UPH), R(0.25, 0.55), 80);
    for (let k = 0; k < 5; k++) clump(R(0.8, 3.2), R(2.6, UPH), R(0.2, 0.4), 60);
    for (let k = 0; k < 14; k++) disc(R(0, 1.3), R(0.2, UPH), R(0.03, 0.05), [184, 70, 120], M_KEEP);
  });
  // ---- trệt ----
  cell('G_COL', W4, GH, () => {        // trệt thuộc địa: chân tường kẻ mạch đá, cửa VÒM cao 2 cánh gỗ pa-nô + ô quạt (không biển)
    WALL(0.8); threshold();
    for (let y = 0.5; y < GH; y += 0.42) { hline(y, 0, W4, 0.035, [200, 194, 182], M_WALL); shade(0, y - 0.05, W4, y - 0.017, 0.86); }
    archFill(0.62, 0.14, 3.38, 3.45, OCH_L, M_WALL);
    archFill(0.75, 0.14, 3.25, 3.35, [44, 40, 36], M_KEEP);
    archFill(0.8, 2.56, 3.2, 3.3, [96, 106, 112], M_GLASS);
    const sc = SHUT_C[(rnd() * SHUT_C.length) | 0], d = [sc[0] * 0.78, sc[1] * 0.78, sc[2] * 0.78];
    for (const [x0, x1] of [[0.8, 1.98], [2.02, 3.2]]) { rect(x0, 0.14, x1, 2.5, sc, M_KEEP); rect(x0 + 0.12, 0.35, x1 - 0.12, 1.15, d, M_KEEP); rect(x0 + 0.12, 1.35, x1 - 0.12, 2.35, d, M_KEEP); }
    hline(2.53, 0.75, 3.25, 0.06, [70, 58, 46], M_KEEP);
    rect(1.88, 3.3, 2.12, 3.56, [250, 246, 236], M_WALL);
    shade(0, 0, W4, 0.5, 0.84);
  });
  cell('G_NEO', W4, GH, () => {        // trệt tân cổ điển: bậc đá + cột tròn mép bay + cửa kính cao khung tối
    WALL(0.4); rect(0, 0, W4, 0.42, [196, 192, 184], M_KEEP); hline(0.21, 0, W4, 0.02, [160, 156, 150], M_KEEP); hline(0.42, 0, W4, 0.03, [222, 218, 210], M_KEEP);
    interior(0.55, 0.42, 3.45, 3.3, 10); glaze(0.6, 0.45, 3.4, 3.25, 0.4); frame(0.55, 0.42, 3.45, 3.3, [52, 50, 48], 0.07, 3, 2);
    column(0.0, 0.7, 0.42, 3.55); column(4.0, 0.7, 0.42, 3.55);
    rect(0, 3.55, W4, GH, [248, 246, 240], M_WALL); shade(0, 3.48, W4, 3.55, 0.6);
  });
  cell('G_HOARD', W4, GH, () => {      // rào TÔN công trường (xanh dương) + chữ sơn chung + khoang tầng trệt tối phía trên
    vgrad(0, 0, W4, 2.6, [72, 110, 168], [54, 88, 142], M_KEEP, 4);
    for (let x = 0; x < W4; x += 0.2) { vline(x, 0, 2.6, 0.05, [42, 72, 120], M_KEEP); vline(x + 0.08, 0, 2.6, 0.03, [98, 134, 188], M_KEEP); }
    rect(0, 2.6, W4, 2.68, [200, 200, 200], M_KEEP);
    interior(0, 2.68, W4, GH, -16);
    for (const x of [0.2, 3.8]) vline(x, 2.68, GH, 0.28, [150, 150, 146], M_KEEP);
    const t = textMask([{ t: 'ĐANG THI CÔNG', size: 0.46, y: 0.5 }], 512, 96);
    blitText(t, 512, 96, 0.3, 1.3, 3.7, 2.05, [236, 236, 232], M_KEEP);
    for (let k = 0; k < 5; k++) softStreak(R(0.1, 3.9), R(0.06, 0.2), R(0.6, 2.4), R(0.4, 1.6), R(0.12, 0.25));
  });
  cell('G_SHOW', W4, GH, () => {       // SHOWROOM kính trong: nội thất SÁNG, sàn bóng, hàng trên bục, đèn âm trần, khung đen mảnh
    groundWall(0.1); threshold();
    vgrad(0.1, 0.14, 3.9, 2.85, [236, 234, 230], [200, 198, 194], M_KEEP, 3);
    rect(0.1, 0.14, 3.9, 0.5, [214, 210, 204], M_KEEP);
    for (let k = 0; k < 3; k++) { const x = 0.45 + k * 1.15, c = GOODS[(rnd() * GOODS.length) | 0]; rect(x, 0.5, x + 0.72, 0.62, [242, 242, 240], M_KEEP); rect(x + 0.06, 0.62, x + 0.66, R(1.0, 1.5), c, M_KEEP); }
    for (let x = 0.4; x < 3.7; x += 0.6) disc(x, 2.7, 0.06, [255, 252, 240], M_KEEP);
    glaze(0.1, 0.14, 3.9, 2.85, 0.24); frame(0.1, 0.14, 3.9, 2.85, [38, 38, 40], 0.05, 2);
    signBand();
  });
  cell('G_OPEN0', W4, GH, () => {      // quán CÀ PHÊ/ĂN mở (không cửa cuốn): ghế nhựa thấp, bàn inox, tủ mát, bảng thực đơn, đèn ấm
    groundWall(0.3); threshold();
    vgrad(0.12, 0.14, 3.88, 2.85, [96, 84, 68], [132, 116, 96], M_KEEP, 5);
    rect(0.12, 0.14, 3.88, 0.42, [152, 142, 128], M_KEEP);
    rect(2.95, 0.14, 3.72, 2.15, [196, 200, 204], M_KEEP); rect(3.02, 0.3, 3.65, 2.05, [214, 226, 230], M_KEEP);
    for (let y = 0.45; y < 2.0; y += 0.38) { hline(y, 3.02, 3.65, 0.03, [170, 176, 180], M_KEEP); for (let x = 3.06; x < 3.6; x += 0.1) rect(x, y + 0.02, x + 0.06, y + 0.24, [120, 96, 70], M_KEEP); }
    rect(0.35, 1.5, 1.6, 2.35, [42, 46, 42], M_KEEP); for (let y = 1.65; y < 2.25; y += 0.12) hline(y, 0.45, R(1.0, 1.5), 0.025, [220, 220, 210], M_KEEP);
    for (const x of [0.5, 1.6]) { rect(x, 0.62, x + 0.75, 0.68, [196, 198, 200], M_KEEP); vline(x + 0.37, 0.14, 0.62, 0.05, [150, 152, 154], M_KEEP); }
    for (const x of [0.35, 0.95, 1.45, 2.1, 2.55]) { const c = rnd() < 0.6 ? [176, 44, 40] : [44, 92, 160]; rect(x, 0.14, x + 0.26, 0.4, c, M_KEEP); }
    for (const x of [0.9, 2.2]) disc(x, 2.62, 0.09, [255, 214, 150], M_KEEP);
    shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_OPEN1', W4, GH, () => {      // shop QUẦN ÁO/VẢI mở: giá treo đồ xỉn 2 tầng, cuộn vải trên kệ, ma-nơ-canh
    groundWall(0.2); threshold();
    interior(0.12, 0.14, 3.88, 2.85, 18);
    for (const yy of [1.45, 2.5]) { hline(yy, 0.25, 2.6, 0.03, [170, 170, 170], M_KEEP); for (let x = 0.3; x < 2.55; x += R(0.1, 0.17)) { const c = CLOTHES[(rnd() * CLOTHES.length) | 0], k = R(0.8, 1.1); rect(x, yy - R(0.6, 0.85), x + 0.09, yy, [c[0] * k, c[1] * k, c[2] * k], M_KEEP); } }
    for (let y = 0.4; y < 2.5; y += 0.42) { rect(2.75, y, 3.8, y + 0.03, [120, 104, 86], M_KEEP); for (let x = 2.78; x < 3.75; x += 0.16) { const c = GOODS[(rnd() * GOODS.length) | 0]; rect(x, y + 0.03, x + 0.14, y + 0.3, c, M_KEEP); } }
    rect(2.95, 0.14, 3.15, 1.5, [214, 204, 194], M_KEEP); disc(3.05, 1.6, 0.1, [214, 204, 194], M_KEEP);
    tubeLight(0.3, 3.7, 2.7); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_OPEN2', W4, GH, () => {      // ĐỒ GỖ/nội thất/đồ thờ: tủ gỗ nâu đỏ, bàn ghế, tủ thờ viền vàng, đèn
    groundWall(0.25); threshold();
    interior(0.12, 0.14, 3.88, 2.85, 6);
    rect(0.25, 0.14, 1.45, 2.3, [106, 52, 36], M_KEEP); rect(0.32, 0.25, 0.83, 2.2, [124, 64, 44], M_KEEP); rect(0.87, 0.25, 1.38, 2.2, [124, 64, 44], M_KEEP); hline(2.3, 0.22, 1.48, 0.06, [190, 150, 70], M_KEEP);
    rect(1.65, 0.14, 2.65, 0.75, [118, 60, 40], M_KEEP); rect(1.6, 0.75, 2.7, 0.82, [140, 74, 50], M_KEEP);
    for (const x of [1.7, 2.45]) { rect(x, 0.14, x + 0.2, 1.05, [96, 48, 32], M_KEEP); }
    rect(2.85, 0.14, 3.75, 1.8, [128, 40, 32], M_KEEP); hline(1.8, 2.82, 3.78, 0.05, [196, 156, 72], M_KEEP); rect(3.0, 1.0, 3.6, 1.6, [150, 54, 40], M_KEEP);
    tubeLight(0.3, 3.7, 2.66); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_FOOD', W4, GH, () => {       // quán ĂN mặt tiền: quầy inox + nồi to, tủ kính đồ ăn, bàn ghế phía trong, đèn
    groundWall(0.3); threshold();
    vgrad(0.12, 0.14, 3.88, 2.85, [104, 92, 76], [136, 122, 104], M_KEEP, 5);
    rect(0.2, 0.14, 1.9, 1.0, [184, 188, 192], M_KEEP); hline(1.0, 0.18, 1.92, 0.05, [210, 214, 218], M_KEEP);
    rect(0.35, 1.05, 0.9, 1.5, [160, 164, 168], M_KEEP); rect(1.05, 1.05, 1.7, 1.42, [150, 154, 158], M_KEEP); shade(0.35, 1.05, 1.7, 1.2, 0.8);
    rect(0.25, 1.55, 1.85, 2.1, [210, 220, 222], M_KEEP); for (let x = 0.35; x < 1.75; x += 0.3) rect(x, 1.62, x + 0.2, 1.8, [200, 150, 90], M_KEEP);
    for (const x of [2.2, 3.0]) { rect(x, 0.62, x + 0.6, 0.68, [170, 120, 80], M_KEEP); }
    for (const x of [2.1, 2.55, 2.95, 3.45]) rect(x, 0.14, x + 0.24, 0.4, rnd() < 0.5 ? [176, 44, 40] : [44, 92, 160], M_KEEP);
    tubeLight(0.3, 3.7, 2.66); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  // ---- tường hồi/hông LỘ ra phố (W3-C "không tường trống") ----
  cell('S_EXP0', W4, UPH, () => {      // tường hồi phơi mưa: ố đen chảy dọc, rêu chân, mảng ẩm, 2 lỗ thông gió song sắt
    WALL(0.95);
    for (let k = 0; k < 9; k++) softStreak(R(0.1, 3.9), R(0.05, 0.22), UPH, R(0.8, 3.1), R(0.16, 0.34));
    softStreak(2.0, 3.0, 0.5, 0.5, 0.12);
    for (const x of [0.7, 2.9]) if (rnd() < 0.7) { const y = R(1.6, 2.3); rect(x, y, x + 0.42, y + 0.32, [40, 38, 36], M_KEEP); for (let k = 1; k < 5; k++) vline(x + k * 0.084, y, y + 0.32, 0.02, [150, 146, 140], M_KEEP); }
  });
  cell('S_EXP1', W4, UPH, () => {      // XI MĂNG THÔ (không sơn): cửa sổ nhỏ song sắt, cục nóng, ống thoát nước, vệt gỉ
    wallBase('cem', 168, 0.7, M_KEEP);
    for (let y = 0.5; y < UPH; y += R(0.6, 1.1)) shade(0, y, W4, y + 0.02, 0.9);
    reveal(0.6, 1.3, 1.5, 2.25); glass(0.6, 1.3, 1.5, 2.25, 2, 0); frame(0.6, 1.3, 1.5, 2.25, [110, 104, 96], 0.05, 2); grille(0.6, 1.3, 1.5, 2.25, IRON_D, 0);
    acUnit(2.2, 1.2, 0.72, 0.5); vline(3.55, 0, UPH, 0.08, [140, 140, 138], M_KEEP);
    shade(3.48, 0, 3.75, 1.6, 0.8); shade(2.3, 0.2, 2.42, 1.2, 0.78);
  });
  cell('S_EXP2', W4, UPH, () => {      // QUẢNG CÁO SƠN PHAI trên tường hồi (từ CHUNG + SĐT 0000) — nét đặc trưng phố VN
    WALL(0.6);
    const t = textMask([{ t: ADS[0], size: 0.4, y: 0.32 }, { t: 'LH: 0000.226.688', size: 0.28, y: 0.76 }], 512, 128);
    blitText(t, 512, 128, 0.1, 1.0, 3.9, 2.4, [40, 70, 150], M_KEEP, 0.78);
    for (let k = 0; k < 5; k++) softStreak(R(0.1, 3.9), R(0.06, 0.2), UPH, R(0.8, 2.6), R(0.12, 0.26));
  });
  // ---- mái hiên TÔN (HP: tôn xanh dương chủ đạo; nhuộm màu tôn ở citygen) ----
  cell('D_AWN2', 4, 1.6, () => {
    for (let i = 0; i < C; i++) {
      const xm = (i + 0.5) / SX, w = 0.5 + 0.5 * Math.cos((xm / 0.19) * Math.PI * 2), base = 176 + w * 54;
      for (let j = 0; j < C; j++) { const p = ((OY + j) * SIZE + OX + i) * 4, n = (hash3(i, j, 23) - 0.5) * 6; B[p] = base + n; B[p + 1] = base + n; B[p + 2] = base + n; B[p + 3] = M_WALL; }
    }
    for (let k = 0; k < 8; k++) { const x = R(0, 4); shade(x, 0, x + R(0.05, 0.2), R(0.4, 1.4), R(0.72, 0.86)); }
    shade(0, 0, 4, 0.06, 0.6);
  });
  // ---- BIỂN BẢNG LỚN phủ tầng 1-2 (phố thương mại p/s): 3 ô × 2 dải 4×2 m. Nền M_SIGN (nhuộm màu biển), chữ M_TEXT ----
  const PANEL_W = [['ĐIỆN THOẠI - LAPTOP', 'MUA BÁN - SỬA CHỮA'], ['NỘI THẤT GỖ', 'TỦ BẾP - GIƯỜNG - SOFA'], ['NHA KHOA', 'NIỀNG RĂNG - TRỒNG RĂNG'],
    ['THỜI TRANG NỮ', 'HÀNG MỚI VỀ'], ['VÀNG BẠC ĐÁ QUÝ', 'MUA BÁN - TRAO ĐỔI'], ['TRUNG TÂM NGOẠI NGỮ', 'TUYỂN SINH CÁC LỚP'],
    ['ĐIỆN LẠNH', 'ĐIỀU HÒA - TỦ LẠNH - MÁY GIẶT'], ['CẦM ĐỒ', 'XE MÁY - Ô TÔ - ĐIỆN THOẠI'], ['PHÒNG KHÁM ĐA KHOA', 'KHÁM BỆNH - XÉT NGHIỆM'],
    ['NHÀ NGHỈ', 'NGHỈ GIỜ - NGHỈ ĐÊM']];
  for (let s = 0; s < PANEL_CELLS; s++) cell('PANEL' + s, 4, 4, () => {
    for (let k = 0; k < 2; k++) {
      const y0 = k * 2.0, w = PANEL_W[s * 2 + k], wi = 40 + s * 2 + k;
      vgrad(0, y0, 4, y0 + 2, [246, 246, 246], [208, 208, 208], M_SIGN, 4);
      rect(0, y0, 4, y0 + 0.06, [58, 58, 60], M_KEEP); rect(0, y0 + 1.94, 4, y0 + 2, [58, 58, 60], M_KEEP);
      rect(0, y0, 0.05, y0 + 2, [58, 58, 60], M_KEEP); rect(3.95, y0, 4, y0 + 2, [58, 58, 60], M_KEEP);
      const ph = '0000.' + String(100 + ((wi * 37) % 900)) + '.' + String(100 + ((wi * 71) % 900));
      const t = textMask([{ t: w[0], size: 0.34, y: 0.32 }, { t: w[1], size: 0.17, y: 0.64 }, { t: 'ĐT: ' + ph, size: 0.13, y: 0.85 }], 512, 256);
      blitText(t, 512, 256, 0.1, y0 + 0.1, 3.9, y0 + 1.9, [255, 255, 255], M_TEXT);
    }
  });
  // ---- BIỂN DỌC (blade, vuông góc mặt tiền): 2 ô × 4 dải đứng 1×4 m, chữ XẾP DỌC từng ký tự ----
  const BLADE_W = ['KHÁCH SẠN', 'NHÀ NGHỈ', 'CẦM ĐỒ', 'KARAOKE', 'NHA KHOA', 'CÀ PHÊ', 'THUỐC TÂY', 'SPA'];
  for (let s = 0; s < BLADE_CELLS; s++) cell('BLADE' + s, 4, 4, () => {
    for (let k = 0; k < 4; k++) {
      const x0 = k, L = [...BLADE_W[s * 4 + k].replace(/ /g, '')];
      vgrad(x0, 0, x0 + 1, 4, [246, 246, 246], [210, 210, 210], M_SIGN, 4);
      rect(x0, 0, x0 + 0.05, 4, [58, 58, 60], M_KEEP); rect(x0 + 0.95, 0, x0 + 1, 4, [58, 58, 60], M_KEEP);
      rect(x0, 0, x0 + 1, 0.05, [58, 58, 60], M_KEEP); rect(x0, 3.95, x0 + 1, 4, [58, 58, 60], M_KEEP);
      const sz = Math.min(0.105, 0.86 / L.length);
      const t = textMask(L.map((ch, i) => ({ t: ch, size: sz, y: 0.07 + ((i + 0.5) * 0.86) / L.length })), 128, 512);
      blitText(t, 128, 512, x0 + 0.06, 0.06, x0 + 0.94, 3.94, [255, 255, 255], M_TEXT);
    }
  });
  // ---- BIỂN QUẢNG CÁO TRÊN MÁI: 2 ô × 2 dải 4×2 m, ảnh tự vẽ GIỮ MÀU (không nhuộm), từ chung ----
  const BILL = [
    { bg: [[44, 112, 182], [22, 72, 142]], tc: [255, 255, 255], l: ['SƠN CHỐNG THẤM', 'BỀN ĐẸP MỌI THỜI TIẾT'], icon: 0 },
    { bg: [[248, 204, 46], [232, 172, 22]], tc: [34, 34, 38], l: ['CHO THUÊ QUẢNG CÁO', 'LH: 0000.888.999'], icon: -1 },
    { bg: [[200, 40, 36], [150, 22, 22]], tc: [255, 240, 200], l: ['ĐIỆN MÁY GIÁ TỐT', 'TRẢ GÓP 0%'], icon: 1 },
    { bg: [[30, 120, 80], [16, 84, 56]], tc: [255, 255, 255], l: ['CĂN HỘ VEN SÔNG', 'NHẬN NHÀ NGAY'], icon: 2 },
  ];
  for (let s = 0; s < 2; s++) cell('BILL' + s, 4, 4, () => {
    for (let k = 0; k < 2; k++) {
      const y0 = k * 2.0, A = BILL[s * 2 + k];
      vgrad(0, y0, 4, y0 + 2, A.bg[0], A.bg[1], M_KEEP, 5);
      const tx1 = A.icon >= 0 ? 2.75 : 3.9;
      if (A.icon === 0) { rect(2.95, y0 + 0.3, 3.65, y0 + 1.25, [236, 236, 232], M_KEEP); rect(2.95, y0 + 1.1, 3.65, y0 + 1.25, [200, 44, 40], M_KEEP); disc(3.3, y0 + 1.5, 0.28, [250, 220, 60], M_KEEP); }
      else if (A.icon === 1) { rect(2.9, y0 + 0.3, 3.7, y0 + 1.6, [230, 232, 236], M_KEEP); rect(2.98, y0 + 0.9, 3.62, y0 + 1.52, [60, 70, 84], M_KEEP); disc(3.3, y0 + 0.6, 0.18, [120, 124, 130], M_KEEP); }
      else if (A.icon === 2) { for (let q = 0; q < 3; q++) { const x = 2.85 + q * 0.32, h = 0.8 + q * 0.35; rect(x, y0 + 0.25, x + 0.26, y0 + 0.25 + h, [214, 222, 228], M_KEEP); for (let yy = y0 + 0.35; yy < y0 + 0.2 + h; yy += 0.14) hline(yy, x + 0.04, x + 0.22, 0.04, [90, 120, 150], M_KEEP); } }
      const t = textMask([{ t: A.l[0], size: 0.32, y: 0.36 }, { t: A.l[1], size: 0.2, y: 0.72 }], 512, 256);
      blitText(t, 512, 256, 0.12, y0 + 0.12, tx1, y0 + 1.88, A.tc, M_KEEP);
      rect(0, y0, 4, y0 + 0.05, [230, 230, 230], M_KEEP); rect(0, y0 + 1.95, 4, y0 + 2, [230, 230, 230], M_KEEP);
    }
  });
  // ======================================================================================
  // W4-C FACADE KIT (Đợt 3 wave 4): khách sạn/văn phòng cao tầng (khung đá + kính), sảnh kính, mặt KÍNH cửa hàng/ngân hàng/
  // phòng khám, thuộc địa/biệt thự CHI TIẾT hơn (trán cửa, lan can con tiện, chớp lật MỞ, trệt đá kẻ mạch), lan can mái
  // có GỜ PHÀO + con tiện, dải PHÀO (texture cho gờ 3D citygen). Đặt SAU BILL → chỉ số ô cũ giữ nguyên. 10 ô (còn 1 chỗ trống).
  // ======================================================================================
  const STONE = [232, 226, 212], STONE_D = [196, 190, 176], GRANITE = [128, 126, 124], ALU_D = [36, 38, 42];
  cell('U_HOTEL', W4, UPH, () => {     // khách sạn/tháp văn phòng: TRỤ ĐÁ kem 2 mép bay (ghép = trụ 0,9 m) + kính cao trọn tầng + dải spandrel đá
    rect(0, 0, W4, UPH, STONE, M_WALL);
    for (const [a, b] of [[0, 0.45], [3.55, 4]]) { rect(a, 0, b, UPH, [240, 236, 224], M_WALL); }
    shade(0.45, 0.75, 0.53, UPH, 0.7); shade(3.47, 0.75, 3.55, UPH, 0.86);              // má trụ (lõm kính)
    rect(0.45, 0, 3.55, 0.75, STONE_D, M_WALL); hline(0.38, 0.45, 3.55, 0.025, [170, 164, 150], M_WALL); shade(0.45, 0.68, 3.55, 0.75, 0.75);
    skyGlass(0.53, 0.75, 3.47, UPH - 0.04, [196, 214, 226], [92, 112, 128], 0.55);
    vline(2.0, 0.75, UPH, 0.06, ALU_D, M_KEEP); hline(0.78, 0.53, 3.47, 0.05, ALU_D, M_KEEP); hline(UPH - 0.05, 0.53, 3.47, 0.06, ALU_D, M_KEEP);
    hline(1.05, 0.53, 3.47, 0.035, [210, 214, 216], M_KEEP);                             // tay vịn kính an toàn
    vgrad(0.53, 0.78, 3.47, 1.05, [176, 196, 204], [150, 172, 182], M_GLASS, 2);
    for (const x of [0.2, 3.8]) vline(x, 0, UPH, 0.02, [214, 208, 194], M_WALL);       // mạch đá dọc
  });
  cell('G_LOBBY', W4, GH, () => {      // SẢNH khách sạn/văn phòng: cột đá vuông 2 mép, vách kính cao, cửa kính giữa, nội thất ẤM sáng, không biển
    rect(0, 0, W4, GH, STONE, M_WALL);
    rect(0, 0, W4, 0.12, [176, 172, 164], M_KEEP);
    vgrad(0.5, 0.12, 3.5, 3.45, [214, 196, 160], [168, 150, 118], M_KEEP, 4);          // sảnh: đèn ấm, trần sáng
    for (let x = 0.8; x < 3.3; x += 0.8) disc(x, 3.25, 0.07, [255, 246, 214], M_KEEP);
    rect(0.6, 0.12, 3.4, 0.5, [150, 132, 104], M_KEEP); rect(1.1, 0.5, 1.6, 1.9, [118, 96, 70], M_KEEP); rect(2.5, 0.5, 2.95, 1.6, [96, 84, 70], M_KEEP);   // quầy, cây, ghế
    glaze(0.5, 0.12, 3.5, 3.45, 0.26);
    frame(0.5, 0.12, 3.5, 3.45, ALU_D, 0.06, 3, 1); hline(2.6, 0.5, 3.5, 0.05, ALU_D, M_KEEP);
    rect(1.55, 0.12, 2.45, 2.6, [70, 66, 58], M_KEEP, 0.25); vline(2.0, 0.12, 2.6, 0.03, [200, 200, 196], M_KEEP);   // cửa kính 2 cánh
    for (const [a, b] of [[0, 0.5], [3.5, 4]]) { rect(a, 0.12, b, GH, [242, 238, 228], M_WALL); }
    shade(0.5, 0.12, 0.56, 3.45, 0.72); shade(3.44, 0.12, 3.5, 3.45, 0.85);
    rect(0, 3.45, W4, GH, [240, 236, 226], M_WALL); shade(0.5, 3.38, 3.5, 3.45, 0.6);
  });
  const storeFront = (lit) => {        // nền chung mặt kính cửa hàng: trong SÁNG (đèn LED trắng), sàn bóng, khung nhôm đen mảnh
    threshold();
    vgrad(0.2, 0.14, 3.8, 2.8, [228, 226, 220], [168, 164, 158], M_KEEP, 4);   // trong sáng nhưng có chiều sâu (trắng phẳng = "mảng trống")
    rect(0.2, 0.14, 3.8, 0.42, [150, 144, 136], M_KEEP); shade(0.2, 2.5, 3.8, 2.8, 0.82);
    for (let x = 0.45; x < 3.7; x += 0.55) rect(x, 2.62, x + 0.3, 2.66, [255, 255, 250], M_KEEP);   // đèn âm trần
    return lit;
  };
  cell('G_STORE0', W4, GH, () => {     // shop thời trang/điện máy mặt KÍNH trọn bay: kệ trưng bày sáng, ma-nơ-canh, khung đen mảnh
    groundWall(0.08); storeFront();
    for (let k = 0; k < 3; k++) { const x = 0.5 + k * 1.1, c = GOODS[(rnd() * GOODS.length) | 0]; rect(x, 0.42, x + 0.18, R(1.5, 1.8), [60, 60, 64], M_KEEP); disc(x + 0.09, 1.9, 0.12, [200, 186, 170], M_KEEP); rect(x - 0.08, 0.9, x + 0.26, 1.6, c, M_KEEP); }
    rect(3.0, 0.42, 3.75, 1.9, [236, 236, 234], M_KEEP); for (let y = 0.6; y < 1.9; y += 0.32) rect(3.05, y, 3.7, y + 0.18, GOODS[(rnd() * GOODS.length) | 0], M_KEEP, 0.8);
    glaze(0.15, 0.14, 3.85, 2.85, 0.18); frame(0.15, 0.14, 3.85, 2.85, ALU_D, 0.045, 2, 1); hline(2.45, 0.15, 3.85, 0.035, ALU_D, M_KEEP);
    signBand();
  });
  cell('G_STORE1', W4, GH, () => {     // NGÂN HÀNG / PHÒNG KHÁM: trụ ốp đá granite 2 mép, vách kính + quầy, cửa kính tay nắm dài
    rect(0, 0, W4, GH, [150, 148, 144], M_KEEP);
    for (const [a, b] of [[0, 0.55], [3.45, 4]]) { vgrad(a, 0, b, 2.95, [152, 150, 146], GRANITE, M_KEEP, 5); for (let y = 0.6; y < 2.9; y += 0.6) hline(y, a, b, 0.012, [96, 94, 92], M_KEEP); }
    vgrad(0.55, 0.1, 3.45, 2.85, [236, 238, 240], [200, 204, 208], M_KEEP, 3);
    rect(0.75, 0.1, 2.3, 1.05, [196, 186, 168], M_KEEP); rect(0.75, 1.05, 2.3, 1.12, [236, 232, 224], M_KEEP);   // quầy giao dịch
    for (const x of [0.95, 1.5, 2.05]) disc(x, 1.42, 0.1, [60, 58, 56], M_KEEP);
    rect(0.75, 1.9, 2.3, 2.5, [26, 74, 140], M_KEEP, 0.85);                                // màn hình/bảng tỉ giá
    glaze(0.55, 0.1, 3.45, 2.85, 0.22); frame(0.55, 0.1, 3.45, 2.85, [180, 184, 188], 0.05, 2, 1);
    vline(2.95, 0.6, 1.6, 0.04, [220, 222, 224], M_KEEP);                                  // tay nắm cửa
    shade(0.55, 0.1, 0.62, 2.85, 0.75);
    signBand();
  });
  cell('G_STORE2', W4, GH, () => {     // shop ĐIỆN THOẠI/kính mắt: vách kính dán poster, tủ kính sáng, trần trắng
    groundWall(0.08); storeFront();
    for (let k = 0; k < 2; k++) { const x = 0.4 + k * 1.7; rect(x, 0.42, x + 1.2, 1.15, [240, 240, 240], M_KEEP); rect(x + 0.05, 0.95, x + 1.15, 1.12, [170, 196, 214], M_KEEP); for (let q = 0; q < 5; q++) rect(x + 0.1 + q * 0.21, 0.98, x + 0.22 + q * 0.21, 1.1, [40, 40, 44], M_KEEP); }
    glaze(0.15, 0.14, 3.85, 2.85, 0.16);
    const pc = [[28, 92, 168], [196, 40, 44], [240, 176, 30], [34, 120, 80]];
    for (const [x, w] of [[0.3, 0.9], [2.7, 0.95]]) { const c = pc[(rnd() * pc.length) | 0]; rect(x, 1.35, x + w, 2.35, c, M_KEEP); rect(x + 0.12, 1.5, x + w - 0.12, 1.95, [236, 236, 234], M_KEEP); hline(2.15, x + 0.1, x + w - 0.1, 0.08, [255, 255, 255], M_KEEP); }
    frame(0.15, 0.14, 3.85, 2.85, [210, 212, 214], 0.05, 3, 1);
    signBand();
  });
  cell('U_COL2', W4, UPH, () => {      // thuộc địa CHI TIẾT: trụ áp kẻ mạch, cửa CAO trán cong + công-xon, ô lan can con tiện dưới cửa, chớp lật MỞ 2 bên
    WALL(0.7); slab(0, 0.16);
    pilaster(0, 0.32); pilaster(3.68, 4.0);
    for (const [a, b] of [[0, 0.32], [3.68, 4]]) for (let y = 0.5; y < 2.9; y += 0.42) shade(a, y, b, y + 0.025, 0.86);   // mạch đá giả trên trụ
    rect(0, 2.98, W4, UPH, OCH_L, M_WALL); shade(0, 2.9, W4, 2.98, 0.62);
    // ô lan can con tiện dưới cửa
    rect(1.0, 0.22, 3.0, 0.3, [244, 240, 230], M_WALL); rect(1.0, 0.9, 3.0, 0.98, [246, 242, 232], M_WALL);
    for (let x = 1.08; x < 2.95; x += 0.17) { rect(x, 0.3, x + 0.09, 0.9, [238, 234, 224], M_WALL); shade(x + 0.09, 0.3, x + 0.15, 0.9, 0.66); }
    // cửa cao khung vữa
    rect(1.2, 0.98, 2.8, 2.6, OCH_L, M_WALL); shade(2.8, 0.98, 2.87, 2.6, 0.72);
    interior(1.32, 1.0, 2.68, 2.5, -8); glass(1.36, 1.05, 2.64, 2.48, 2, -1); frame(1.32, 1.0, 2.68, 2.5, [92, 74, 58], 0.05, 2, 3);
    // trán cong (vòng cung dẹt) + công-xon
    for (let j = 0; j < 10; j++) { const t = j / 10, y = 2.62 + t * 0.26, hw = 0.92 * Math.sqrt(Math.max(0, 1 - t * t)); rect(2 - hw, y, 2 + hw, y + 0.035, [250, 246, 236], M_WALL); }
    shade(1.08, 2.56, 2.92, 2.62, 0.62);
    for (const x of [1.12, 2.78]) { rect(x, 2.3, x + 0.1, 2.62, [244, 240, 230], M_WALL); shade(x + 0.1, 2.3, x + 0.14, 2.62, 0.7); }
    // chớp lật mở áp tường 2 bên
    const sc = SHUT_C[(rnd() * SHUT_C.length) | 0];
    louvre(0.5, 1.0, 1.12, 2.5, sc); louvre(2.88, 1.0, 3.5, 2.5, sc);
    shade(1.12, 1.0, 1.18, 2.5, 0.75);
    sillStreaks(1.0, 3.0, 0.2, 0.3);
  });
  cell('U_VILLA2', W4, UPH, () => {    // biệt thự: cửa đi VÒM + ban công con tiện nhô + trụ áp + chớp mở
    WALL(0.45); slab(0, 0.16);
    pilaster(0, 0.26); pilaster(3.74, 4.0);
    archFill(1.05, 0.25, 2.95, 2.95, OCH_L, M_WALL);
    archFill(1.17, 0.27, 2.83, 2.85, [44, 40, 36], M_KEEP);
    archFill(1.22, 0.3, 2.78, 2.8, [90, 104, 112], M_GLASS); glass(1.22, 0.3, 2.78, 2.05, 0, 1);
    vline(2.0, 0.3, 2.8, 0.05, FR_WHITE, M_KEEP); hline(2.06, 1.2, 2.8, 0.05, FR_WHITE, M_KEEP);
    rect(1.88, 2.8, 2.12, 3.02, [250, 246, 236], M_WALL);
    const sc = SHUT_C[(rnd() * SHUT_C.length) | 0];
    louvre(0.42, 0.3, 1.02, 2.3, sc); louvre(2.98, 0.3, 3.58, 2.3, sc);
    // lan can con tiện (ban công) trước cửa
    rect(0.3, 0.12, 3.7, 0.24, [244, 240, 230], M_WALL); rect(0.3, 0.94, 3.7, 1.05, [248, 244, 234], M_WALL); shade(0.3, 0.88, 3.7, 0.94, 0.75);
    for (let x = 0.38; x < 3.62; x += 0.19) { rect(x, 0.24, x + 0.1, 0.94, [240, 236, 226], M_WALL); shade(x + 0.1, 0.24, x + 0.17, 0.94, 0.64); }
    plants(0.5, 1.0, 0.25);
  });
  cell('G_VILLA', W4, GH, () => {      // trệt biệt thự/công thự: chân đá KẺ MẠCH ngang, 2 cửa sổ vòm có chớp, bậc thềm (không biển)
    WALL(0.5); threshold();
    for (let y = 0.45; y < 3.4; y += 0.38) { hline(y, 0, W4, 0.03, [206, 198, 184], M_WALL); shade(0, y - 0.05, W4, y - 0.015, 0.88); }
    rect(0, 0, W4, 0.45, [190, 184, 172], M_KEEP); hline(0.45, 0, W4, 0.05, [226, 220, 208], M_KEEP);
    for (const x0 of [0.45, 2.35]) {
      archFill(x0 - 0.1, 0.8, x0 + 1.3, 3.15, OCH_L, M_WALL);
      archFill(x0, 0.9, x0 + 1.2, 3.05, [46, 42, 38], M_KEEP);
      archFill(x0 + 0.05, 0.95, x0 + 1.15, 3.0, [96, 108, 114], M_GLASS); glass(x0 + 0.05, 0.95, x0 + 1.15, 2.4, 2, 2);
      const sc = SHUT_C[(rnd() * SHUT_C.length) | 0];
      louvre(x0 + 0.05, 0.95, x0 + 0.58, 2.4, sc);
      grille(x0 + 0.62, 0.95, x0 + 1.15, 2.4, IRON_D, 2);
      sill(x0, x0 + 1.2, 0.9); rect(x0 + 0.5, 2.98, x0 + 0.7, 3.2, [250, 246, 236], M_WALL);
    }
    rect(0, 3.55, W4, GH, OCH_L, M_WALL); shade(0, 3.48, W4, 3.55, 0.6);
  });
  cell('P_COL', W4, 0.9, () => {       // lan can mái thuộc địa/tân cổ điển: GỜ PHÀO đáy (răng cưa) + con tiện + mũ lan can
    WALL(0.6);
    rect(0, 0, W4, 0.2, [246, 242, 232], M_WALL); shade(0, 0, W4, 0.04, 0.6);
    for (let x = 0.04; x < 4; x += 0.16) { rect(x, 0.04, x + 0.08, 0.1, [214, 208, 196], M_WALL); }      // răng cưa
    rect(0, 0.74, W4, 0.9, [248, 244, 236], M_WALL); shade(0, 0.7, W4, 0.74, 0.66);
    for (let x = 0.1; x < 3.95; x += 0.2) { rect(x, 0.2, x + 0.1, 0.7, [240, 236, 226], M_WALL); shade(x + 0.1, 0.2, x + 0.18, 0.7, 0.6); }
    for (const x of [0, 3.84]) rect(x, 0.2, x + 0.16, 0.74, [246, 242, 232], M_WALL);   // trụ lan can 2 mép bay
  });
  cell('D_CORN', 4, 1, () => {         // DẢI PHÀO (mặt gờ 3D citygen): 3 lớp gờ + răng cưa + bóng dưới — nhuộm màu tường
    WALL(0.5);
    rect(0, 0.72, 4, 1, [250, 246, 238], M_WALL); shade(0, 0.66, 4, 0.72, 0.7);
    rect(0, 0.42, 4, 0.62, [244, 240, 230], M_WALL); shade(0, 0.36, 4, 0.42, 0.72);
    for (let x = 0.03; x < 4; x += 0.14) { rect(x, 0.22, x + 0.07, 0.36, [240, 236, 226], M_WALL); shade(x + 0.07, 0.22, x + 0.12, 0.36, 0.62); }
    shade(0, 0, 4, 0.2, 0.8);
  });
  const ms =typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  const data = B ? new Uint8Array(B.buffer) : null;
  B = null; _layoutOnly = false; for (const k in _bases) delete _bases[k];
  if (MODS.length > ATLAS_N * ATLAS_ROWS) throw new Error('facade_atlas: ' + MODS.length + ' ô > ' + ATLAS_N * ATLAS_ROWS);
  return { data, size, height: HGT, mods: MODS.slice(), MOD: { ...MOD }, ms };
}
