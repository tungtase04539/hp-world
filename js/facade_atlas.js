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
function laundry(x0, x1, y) {
  hline(y, x0, x1, 0.012, [80, 80, 80], M_KEEP);
  for (let x = x0 + 0.1; x < x1 - 0.3; x += R(0.25, 0.45)) {
    const w = R(0.18, 0.4), h = R(0.3, 0.7);
    rect(x, y - h, x + w, y, [R(60, 240), R(60, 230), R(60, 230)], M_KEEP);
  }
}
// nội thất tối (cửa hàng/lô gia): gradient + sàn gạch
function interior(x0, y0, x1, y1, lit = 0) {
  vgrad(x0, y0, x1, y1, [40 + lit, 37 + lit, 34 + lit], [64 + lit, 58 + lit, 50 + lit], M_KEEP, 5);
  rect(x0, y0, x1, y0 + 0.35, [120, 112, 100], M_KEEP);
  for (let x = x0; x < x1; x += 0.4) vline(x, y0, y0 + 0.35, 0.01, [90, 84, 76], M_KEEP);
}
// kệ hàng + hàng hoá (hộp/thùng/bao nhiều màu nhưng XỈN — không "confetti")
const GOODS = [[180, 60, 50], [200, 160, 60], [60, 110, 160], [230, 220, 200], [90, 140, 80], [160, 120, 90], [210, 120, 60], [120, 90, 140], [235, 235, 230]];
function shelves(x0, y0, x1, y1) {
  for (let y = y0 + 0.4; y < y1 - 0.2; y += 0.42) {
    rect(x0, y, x1, y + 0.04, [110, 100, 90], M_KEEP);
    for (let x = x0 + 0.03; x < x1 - 0.1;) {
      const w = R(0.1, 0.32), h = R(0.15, 0.36), c = GOODS[(rnd() * GOODS.length) | 0], k = R(0.55, 0.9);
      rect(x, y + 0.04, x + w, y + 0.04 + h, [c[0] * k, c[1] * k, c[2] * k], M_KEEP);
      x += w + R(0.0, 0.05);
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
  G_GLASS: SB_FULL, G_GATE: SB_FULL, G_OLD: [0.5, 3.5],
};
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
function blitText(mask, mw, mh, x0, y0, x1, y1, col, m) {
  if (!mask) { hline((y0 + y1) / 2, x0 + (x1 - x0) * 0.15, x1 - (x1 - x0) * 0.15, (y1 - y0) * 0.35, col, m); return; }
  const i0 = PX(x0), i1 = PX(x1), j0 = PY(y0), j1 = PY(y1);
  for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
    const sx = Math.min(mw - 1, (((i - i0) + 0.5) / (i1 - i0) * mw) | 0), sy = Math.min(mh - 1, ((1 - ((j - j0) + 0.5) / (j1 - j0)) * mh) | 0);
    const a = mask[sy * mw + sx] / 255; if (a < 0.35) continue;
    const p = ((OY + j) * SIZE + OX + i) * 4; B[p] = col[0]; B[p + 1] = col[1]; B[p + 2] = col[2]; B[p + 3] = m;
  }
}

// ======================================================================================
// opts.layoutOnly: chỉ đăng ký thứ tự ô (MOD) — không vẽ, không cấp phát (luồng chính dựng shader ngay, còn ảnh atlas
// vẽ trong Worker: js/facade_atlas_worker.js).
export function buildFacadeAtlas(size = 2048, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  _layoutOnly = !!opts.layoutOnly;
  SIZE = size; C = size / ATLAS_N; B = _layoutOnly ? null : new Uint8ClampedArray(size * size * 4);   // Clamped: cộng sáng/bóng không tràn
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
    glass(0, 0, W4, UPH, 1, -1); glass(0, 0.0, W4, 0.6, 3, -1);
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
    for (let k = 0; k < 7; k++) { const x = R(1.5, 2.4), y = R(0.15, 0.9); rect(x, y, x + R(0.3, 0.6), y + R(0.25, 0.5), GOODS[(rnd() * 9) | 0], M_KEEP); }  // thùng hàng giữa lối
    tubeLight(0.3, 3.7, 2.6); shutterBox(0.12, 3.88, 2.8); signBand();
  });
  cell('G_SHOP1', W4, GH, () => {      // shop quần áo: giá treo + ma-nơ-canh
    groundWall(0.15); threshold();
    interior(0.15, 0.14, 3.85, 2.8, 14);
    hline(2.25, 0.3, 3.7, 0.03, [180, 180, 180], M_KEEP);
    for (let x = 0.35; x < 3.6; x += R(0.12, 0.2)) { const c = GOODS[(rnd() * 9) | 0]; rect(x, R(1.2, 1.5), x + 0.1, 2.24, c, M_KEEP); }
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
    for (let y = 0.5; y < 2.5; y += 0.4) { rect(0.2, y, 3.8, y + 0.04, [240, 240, 240], M_KEEP); for (let x = 0.25; x < 3.7; x += R(0.12, 0.3)) rect(x, y + 0.04, x + 0.1, y + R(0.15, 0.3), GOODS[(rnd() * 9) | 0], M_KEEP); }
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
    for (let k = 0; k < 10; k++) { const x = R(0.3, 3.5), y = R(0.15, 1.6); rect(x, y, x + R(0.12, 0.35), y + R(0.15, 0.6), GOODS[(rnd() * 9) | 0], M_KEEP, 0.7); }
    glass(0.15, 0.14, 3.85, 2.8, 0, -1); frame(0.15, 0.14, 3.85, 2.8, [56, 58, 60], 0.08, 3); vline(2.0, 0.14, 2.3, 0.04, [200, 200, 200], M_KEEP);
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
      const r = R(128, 168); rect(x, y, x + 0.2, y + 0.062, [r, r * 0.5, r * 0.38], M_KEEP);
      rect(x + 0.2, y, x + 0.22, y + 0.075, [150, 145, 135], M_KEEP); rect(x, y + 0.062, x + 0.22, y + 0.075, [150, 145, 135], M_KEEP);
    }
  });
  cell('S_ADS', W4, UPH, () => {       // quảng cáo vẽ tay trên tường hồi (đặc sản phố VN) — từ CHUNG, không thương hiệu
    WALL(0.5);
    const t = textMask([{ t: ADS[1], size: 0.34, y: 0.3 }, { t: '0912.345.678', size: 0.3, y: 0.72 }], 512, 128);
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
      const ph = '0225.3' + String(100 + ((wi * 37) % 900)) + '.' + String(100 + ((wi * 71) % 900));
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
  const ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  const data = B ? new Uint8Array(B.buffer) : null;
  B = null; _layoutOnly = false; for (const k in _bases) delete _bases[k];
  return { data, size, mods: MODS.slice(), MOD: { ...MOD }, ms };
}
