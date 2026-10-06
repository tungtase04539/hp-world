// cellfacade.js — W3-C FACADES (Đợt 3 wave 3, AUDIT3 FP-3 "palette guard"): BẢO VỆ BẢNG MÀU cho nhà ô dựng tay GIỮ LẠI.
// Kiểm toán 120 pano: các "khối một màu" (UBND xanh hoàng gia pano_138, khối xanh nguyên chất 147/418, tường xanh than gần
// đen VIB 157 h180, BIDV đỏ 046) đều là MẢNG TƯỜNG/KÍNH LỚN của nhà ô (world.js khối cells) tô màu thương hiệu/kính tối
// đặc trên cả mặt nhà. Dò bằng tia (tools pickprobe W3-C): mesh gộp màu đỉnh 0,02/0,02/0,02 và 0,02/0,11/0,39 (tuyến tính).
// Luật: CHỈ mesh màu đặc (không texture, không màu đỉnh, không trong suốt) có hộp bao thế giới ≥ 3,5 m ngang × 2,5 m cao
// (mảng tường/kính — không đụng biển, cột, viền, chi tiết nhỏ) → HSL (sRGB) kẹp THEO SẮC ĐỘ (sMaxOf): vàng đất/cam (h 15-65°,
// tường ochre đặc trưng HP — pano thật bão hoà ~0,6) ≤ 0,62; đỏ ≤ 0,40; xanh dương/lá/tím (tường màu thương hiệu: UBND xanh
// hoàng gia 138, TPBank tím 354, BaoViet 418) ≤ 0,32; độ sáng 0,30..0,90. (Bản đầu kẹp mọi sắc ≤ 0,40: tường ochre nhạt
// thành be, xanh hoàng gia vẫn còn xanh đậm.)
// Màu thương hiệu/biển vẫn giữ ở chi tiết nhỏ (biển, dải fascia). Material được NHÂN BẢN 1 lần cho mỗi material gốc
// (cache) → freezeStatic vẫn gộp theo material như cũ (+ tối đa vài material). Xác định, không ngẫu nhiên.
const _cache = new Map();
const _hsl = { h: 0, s: 0, l: 0 };
const L_MIN = 0.3, L_MAX = 0.9;
// trần bão hoà theo sắc độ h (0..1): ấm (vàng đất/cam) 0,62 — đỏ 0,40 — lạnh (xanh/tím) 0,32
const sMaxOf = (h) => { const d = h * 360; return d >= 15 && d <= 65 ? 0.62 : (d < 15 || d >= 330) ? 0.4 : 0.32; };

function guarded(q, THREE) {
  if (_cache.has(q)) return _cache.get(q);
  let out = q;
  q.color.getHSL(_hsl, THREE.SRGBColorSpace);
  const s = Math.min(_hsl.s, sMaxOf(_hsl.h)), l = Math.min(L_MAX, Math.max(L_MIN, _hsl.l));
  if (Math.abs(s - _hsl.s) > 0.04 || Math.abs(l - _hsl.l) > 0.04) {
    out = q.clone();
    out.color.setHSL(_hsl.h, s, l, THREE.SRGBColorSpace);
    out.name = (q.name || 'cellmat') + '_pg';
    out.userData = { ...q.userData, paletteGuard: true };
  }
  _cache.set(q, out);
  return out;
}

// ẢNH canvas của nhà ô KHÔNG phải lưới cửa sổ (gộp vào cellAtlas — cellsink atlasKept): mặt tiền gần đen (pano_395 h180)
// hoặc một màu BÃO HOÀ → filter khi gộp. Độ chói/bão hoà lấy từ MÀU NỀN phủ kín mà cellsink ghi lúc vẽ (t.userData.base) —
// KHÔNG đọc ngược ảnh (bản đầu dùng drawImage→getImageData 8×8 cho 434 ảnh canvas GPU: gộp atlas 107 → 451 ms). Lưới cửa sổ
// (t.userData.gridFacade) đã được kẹp màu nền lúc vẽ (paintGridFacade) → bỏ qua. Biển dải dài chỉ đụng khi RẤT tối.
// (Đã thử phủ 'lighten' màu kính lên điểm tối: cửa chớp nâu → tím hồng (pano_157 h0) — bỏ.)
export function cellCanvasFx(t) {
  const img = t && t.image, base = t && t.userData && t.userData.base;
  if (!img || !base || t.userData.gridFacade || img.width < 96 || img.height < 96) return null;
  const c = _rgb(base); if (!c) return null;
  const L = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255, mx = Math.max(c[0], c[1], c[2]), sat = mx > 0 ? (mx - Math.min(c[0], c[1], c[2])) / mx : 0;
  const ar = img.width / img.height;
  if (ar > 2.6 || ar < 1 / 2.6) return L < 0.14 ? { filter: 'brightness(1.7) saturate(0.85)' } : null;   // dải dài RẤT tối (mặt "biển" phủ cả nhà)
  // mặt tiền 1 màu BÃO HOÀ (xanh hoàng gia UBND pano_138, đỏ BIDV 046): giảm bão hoà — màu thương hiệu chỉ hợp ở biển
  const f = L < 0.22 ? 'brightness(1.6) saturate(0.8)' : sat > 0.55 ? 'saturate(0.45) brightness(1.08)' : null;
  return f ? { filter: f } : null;
}

// kept: mục GIỮ LẠI của cell sink ({ o: Object3D, bldg: bool, kind }) — gọi trong commitSink trước khi trả về.
export function guardCellPalette(kept, THREE) {
  const st = { meshes: 0, materials: 0 };
  const box = new THREE.Box3(), sz = new THREE.Vector3();
  const before = _cache.size;
  for (const it of kept) {
    if (!it.o || it.kind === 'tree') continue;   // mọi vật GIỮ LẠI (cả mặt tiền mỏng không đạt ngưỡng "nhà"); lọc kích thước bên dưới
    it.o.updateMatrixWorld(true);
    it.o.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || !m.geometry) return;
      const q = m.material;
      if (!q || Array.isArray(q) || !q.color || q.map || q.vertexColors || q.transparent) return;
      if (!(q.isMeshLambertMaterial || q.isMeshBasicMaterial || q.isMeshPhongMaterial || q.isMeshStandardMaterial)) return;
      if (q.emissive && q.emissive.getHex() !== 0) return;   // material ĐÊM do daynight điều khiển (cửa sổ, đèn, biển): KHÔNG nhân bản
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld); box.getSize(sz);
      if (Math.max(sz.x, sz.z) < 3.5 || sz.y < 2.5) return;
      const g = guarded(q, THREE);
      if (g !== q) { m.material = g; st.meshes++; }
    });
  }
  for (const [q, g] of _cache) if (g !== q) st.materials++;
  st.newCache = _cache.size - before;
  return st;
}

// ---- KÍNH NHÀ Ô (sharedMats.window — world.js) ----
// Mảng kính dựng tay (dải kính băng tầng lmTower, khối "pod"/"crown", kính trệt, cả mặt kính VIB pano_157 h180) là HỘP màu đặc
// không UV → "khối xanh phẳng" (pano_157/386/418/354). Lưới ĐỐ KÍNH theo toạ độ THẾ GIỚI (mesh gộp mất uv, vẫn đúng sau
// freezeStatic): đố đứng mỗi 1,6 m, thanh ngang theo sàn 3,3 m từ đỉnh tầng trệt (y 5,9 = LAND_H 2 + 3,9; dưới y 5,5 không có
// — kính trệt cửa hàng), từng ô kính sáng/tối khác nhau (phản chiếu không đều), mép mờ dần khi lưới nhỏ hơn pixel (xa: không
// lấm tấm). Phản trời: + bức xạ gián tiếp × màu trời theo góc nhìn (Fresnel) — trừ khung. Đêm: daynight điều khiển emissive;
// khung không sáng, ~30% ô kính tối (phòng tắt đèn). Mặt ngang (nóc hộp) giữ màu đặc.
const GLASS_MUL = 1.6, GLASS_FH = 3.3, GLASS_Y0 = 5.9, GLASS_YT = 5.5;
export function applyCellGlass(m) {
  m.extensions = Object.assign({}, m.extensions, { derivatives: true });   // fwidth ở WebGL1
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHpW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{ vec4 hpw = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  hpw = instanceMatrix * hpw;
#endif
  vHpW = (modelMatrix * hpw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHpW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float hpFrame = 0.0, hpPane = 0.5;
{ vec3 wn = inverseTransformDirection(normal, viewMatrix);
  if (abs(wn.y) < 0.6) {
    vec2 hz = normalize(vec2(-wn.z, wn.x));
    vec2 cu = vec2(dot(vHpW.xz, hz) / ${GLASS_MUL.toFixed(2)}, (vHpW.y - ${GLASS_Y0.toFixed(2)}) / ${GLASS_FH.toFixed(2)});
    vec2 fw = max(fwidth(cu), vec2(1e-4));
    vec2 fr = fract(cu), dd = min(fr, 1.0 - fr);
    float lu = 1.0 - smoothstep(0.022, 0.022 + 1.5 * fw.x, dd.x);
    float lv = vHpW.y > ${GLASS_YT.toFixed(2)} ? 1.0 - smoothstep(0.035, 0.035 + 1.5 * fw.y, dd.y) : 0.0;
    float fade = 1.0 - smoothstep(0.08, 0.25, max(fw.x, fw.y));
    hpFrame = max(lu, lv) * fade;
    hpPane = fract(sin(dot(floor(cu), vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb *= mix(1.0, 0.86 + 0.28 * hpPane, fade);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.40, 0.42, 0.44), hpFrame);
  } }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance *= (1.0 - hpFrame) * (hpPane < 0.3 ? 0.25 : 1.0);`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if defined( RE_IndirectDiffuse )
  { float ndv = clamp(abs(dot(geometryNormal, geometryViewDir)), 0.0, 1.0);
    reflectedLight.indirectDiffuse += (1.0 - hpFrame) * (0.8 + 0.4 * hpPane) * vec3(0.50, 0.62, 0.78) * (0.45 + 0.55 * pow(1.0 - ndv, 4.0)) * irradiance * RECIPROCAL_PI; }
#endif`);
  };
  m.customProgramCacheKey = () => 'cellglass_w3c2';
  return m;
}

// ---- MẶT TIỀN VẼ TAY (world.js: ~25 helper xxFacade trong khối ô + facadeTex) ----
// Trước: ô cửa sổ = HÌNH CHỮ NHẬT ĐẶC màu winCss (thường xanh than '#3f5a6b'/'#274a72') trên ảnh 256 px cho cả mặt nhà
// 20-40 m → "lỗ vuông đen"/"cửa sổ nhoè" (pano_161 h180, 391, 409, 510, 060). Hơn 20 bản sao helper giống hệt nhau → sửa ở
// MỘT chỗ: cellsink.materialize chạy hàm vẽ gốc trên ngữ cảnh GHI (gridFacadeSpec); nếu đúng mẫu "nền phủ kín + lưới cửa sổ
// một màu (chữ nhật/vòm)" thì VẼ LẠI ở 2× độ phân giải bằng paintGridFacade (giữ nguyên vị trí/cỡ từng cửa): khung bao sáng
// hơn tường, bóng dưới bệ, vạch sàn mờ; winCss ẤM tối (nâu/vàng đất) → CỬA CHỚP lá sách; còn lại → KÍNH (dải dọc: trên phản
// trời, dưới tối) + đố chữ thập + vệt bóng chéo; winCss SÁNG (khung trắng trên tường đậm) → khung = winCss, kính xám-xanh.
// Không khớp mẫu (có chữ, gradient, nét, ≥2 màu, chạm mép — caro/rào/sọc) → vẽ gốc như cũ. Xác định.
const SKY = [200, 214, 224], DEEP = [30, 42, 51], WHITE = [255, 255, 255], FRAME_D = [70, 74, 78];
function _rgb(css) {
  const c = String(css).trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (m) { const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1]; const v = parseInt(h, 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m && (m[4] === undefined || +m[4] >= 0.999)) return [+m[1], +m[2], +m[3]];
  return null;   // tên màu / trong suốt → không đụng
}
// palette guard màu nền mặt tiền (như guarded(): trần bão hoà theo sắc độ, sáng 0,30..0,90); lMin/lMax để kẹp kính
function _guardRGB(c, sCap = 1, lMin = L_MIN, lMax = L_MAX) {
  const r = c[0] / 255, gg = c[1] / 255, b = c[2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (mx > mn) {
    const d = mx - mn; sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h /= 6;
  }
  const S = Math.min(sat, sMaxOf(h), sCap), Lc = Math.min(lMax, Math.max(lMin, l));
  if (Math.abs(S - sat) < 0.04 && Math.abs(Lc - l) < 0.04) return c;
  const q = Lc < 0.5 ? Lc * (1 + S) : Lc + S - Lc * S, p = 2 * Lc - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const _css = (a) => `rgb(${Math.round(a[0])},${Math.round(a[1])},${Math.round(a[2])})`;
const _mix = (a, b, t) => _css([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
function _look(B, Wc) {
  const lum = (0.2126 * Wc[0] + 0.7152 * Wc[1] + 0.0722 * Wc[2]) / 255;
  const shutter = Wc[0] > Wc[2] + 18 && lum < 0.55, light = lum > 0.62;
  return { shutter, light, frame: light ? _css(Wc) : _mix(B, WHITE, 0.38), mull: light ? _css(Wc) : _mix(FRAME_D, B, 0.35), glassTop: light ? [93, 117, 132] : _guardRGB(Wc, 0.3, 0.12, 0.6) };   // kính: không mang màu tím/xanh đậm của winCss (TPBank 354)
}
function _glass(g, L, x0, y0, ww, wh) {
  const gr = g.createLinearGradient(0, y0, 0, y0 + wh);
  gr.addColorStop(0, _mix(L.glassTop, SKY, L.light ? 0.35 : 0.55));
  gr.addColorStop(0.55, _mix(L.glassTop, SKY, 0.18));
  gr.addColorStop(1, _mix(L.glassTop, DEEP, 0.3));
  g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
  g.fillStyle = 'rgba(255,255,255,0.09)';                                      // vệt phản chiếu chéo
  g.beginPath(); g.moveTo(x0 + ww * 0.15, y0 + wh); g.lineTo(x0 + ww * 0.55, y0); g.lineTo(x0 + ww * 0.75, y0); g.lineTo(x0 + ww * 0.35, y0 + wh); g.closePath(); g.fill();
}
function _win(g, L, winCss, x0, y0, ww, wh) {
  const f = Math.max(0.6, Math.min(ww, wh) * 0.07), lw = Math.max(0.5, ww * 0.045);
  g.fillStyle = L.frame; g.fillRect(x0 - f, y0 - f, ww + 2 * f, wh + 2 * f);   // khung bao
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x0 - f, y0 + wh + f, ww + 2 * f, f);   // bóng dưới bệ cửa
  if (L.shutter) {                                                              // cửa chớp lá sách 2 cánh
    g.fillStyle = winCss; g.fillRect(x0, y0, ww, wh);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    const st = Math.max(1, wh / 14);
    for (let y = y0 + st * 0.5; y < y0 + wh; y += st) g.fillRect(x0, y, ww, Math.max(0.5, wh / 50));
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + ww / 2 - lw / 2, y0, lw, wh);
    return;
  }
  _glass(g, L, x0, y0, ww, wh);
  g.fillStyle = L.mull;                                                         // đố chữ thập
  g.fillRect(x0 + ww / 2 - lw / 2, y0, lw, wh); g.fillRect(x0, y0 + wh * 0.32 - lw / 2, ww, lw);
}
function _trace(g, path) {
  g.beginPath();
  for (const s of path) {
    if (s[0] === 'm') g.moveTo(s[1], s[2]);
    else if (s[0] === 'l') g.lineTo(s[1], s[2]);
    else if (s[0] === 'a') g.arc(s[1], s[2], s[3], s[4], s[5], s[6]);
    else g.closePath();
  }
}
function _bbox(path) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const s of path) { if (s[0] === 'm' || s[0] === 'l') add(s[1], s[2]); else if (s[0] === 'a') { add(s[1] - s[3], s[2] - s[3]); add(s[1] + s[3], s[2] + s[3]); } }
  return [x0, y0, x1 - x0, y1 - y0];
}
// Ghi hàm vẽ gốc trên ngữ cảnh giả. Trả { base, win, rects, paths } nếu là "nền phủ kín + lưới cửa sổ 1 màu", ngược lại null.
export function gridFacadeSpec(draw, W, H) {
  const ops = [];
  let fill = '#000000', bad = false, path = null;
  const ctx = new Proxy({}, {
    get(o, p) {
      if (p === 'fillStyle') return fill;
      if (p === 'canvas') return { width: W, height: H };
      if (p === 'fillRect') return (x, y, w, h) => { ops.push({ t: 'r', c: fill, x, y, w, h }); };
      if (p === 'beginPath') return () => { path = []; };
      if (p === 'moveTo' || p === 'lineTo') return (x, y) => { if (path) path.push([p === 'moveTo' ? 'm' : 'l', x, y]); else bad = true; };
      if (p === 'arc') return (x, y, r, a0, a1, ccw) => { if (path) path.push(['a', x, y, r, a0, a1, !!ccw]); else bad = true; };
      if (p === 'closePath') return () => { if (path) path.push(['z']); };
      if (p === 'fill') return () => { if (path && path.length) ops.push({ t: 'p', c: fill, path }); path = null; };
      bad = true; return () => {};     // chữ, gradient, nét, ảnh, alpha, biến đổi… → không phải lưới cửa sổ thuần
    },
    set(o, p, v) { if (p === 'fillStyle' && typeof v === 'string') fill = v; else bad = true; return true; },
  });
  try { draw(ctx, W, H); } catch (e) { return null; }
  if (bad || ops.length < 3) return null;
  const b = ops[0];
  if (b.t !== 'r' || b.x > 0 || b.y > 0 || b.x + b.w < W || b.y + b.h < H) return null;
  const win = ops[1].c;
  if (win === b.c || !_rgb(b.c) || !_rgb(win)) return null;
  const rects = [], paths = [];
  let area = 0;
  for (let i = 1; i < ops.length; i++) {
    const o = ops[i]; if (o.c !== win) return null;
    if (o.t === 'r') {
      if (o.w <= 0 || o.h <= 0) return null;
      if (o.x < W * 0.03 || o.y < H * 0.03 || o.x + o.w > W * 0.97 || o.y + o.h > H * 0.97) return null;   // chạm mép: caro/rào/sọc
      if (o.w / o.h > 4 || o.h / o.w > 12 || o.h > H * 0.7) return null;
      rects.push(o); area += o.w * o.h;
    } else paths.push(o.path);
  }
  if (rects.length < 2 || area > 0.45 * W * H) return null;
  return { base: b.c, win, rects, paths };
}
export function paintGridFacade(g, W, H, s) {
  const B = _guardRGB(_rgb(s.base)), Wc = _rgb(s.win), L = _look(B, Wc);
  g.fillStyle = _css(B); g.fillRect(0, 0, W, H);
  // vạch sàn mờ giữa các hàng cửa
  const key = (r) => Math.round(r.y * 4) / 4;
  const rows = [...new Set(s.rects.map(key))].sort((a, b) => a - b);
  g.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 1; i < rows.length; i++) {
    const rh = s.rects.find((r) => key(r) === rows[i - 1]).h;
    g.fillRect(0, (rows[i - 1] + rh + rows[i]) / 2 - 0.5, W, Math.max(1, H / 256));
  }
  for (const r of s.rects) _win(g, L, s.win, r.x, r.y, r.w, r.h);
  for (const p of s.paths) {                                                   // cửa vòm / ô quạt: khung = nét, kính cắt theo hình
    const [x0, y0, ww, wh] = _bbox(p);
    g.save(); _trace(g, p); g.strokeStyle = L.frame; g.lineWidth = Math.max(1, ww * 0.12); g.stroke(); g.clip();
    if (L.shutter) { g.fillStyle = s.win; g.fillRect(x0, y0, ww, wh); } else _glass(g, L, x0, y0, ww, wh);
    g.restore();
  }
}
// facadeTex (world.js, ngoài khối ô — không qua cellsink): cùng bố cục cũ (lề 12%, cửa 68×66% ô) + cùng cách vẽ
export function drawFacadeWindows(g, w, h, baseCss, winCss, cols, rows) {
  const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows, rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ x: mx + c * cw + cw * 0.16, y: my + r * ch + ch * 0.16, w: cw * 0.68, h: ch * 0.66 });
  if (!_rgb(baseCss) || !_rgb(winCss)) { g.fillStyle = baseCss; g.fillRect(0, 0, w, h); g.fillStyle = winCss; for (const r of rects) g.fillRect(r.x, r.y, r.w, r.h); return; }
  paintGridFacade(g, w, h, { base: baseCss, win: winCss, rects, paths: [] });
}
