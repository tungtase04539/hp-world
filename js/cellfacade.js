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
// tường LẠNH (xanh dương/lá/tím) BÃO HOÀ (s > 0,45 = màu thương hiệu sơn cả mặt nhà) → nâng sáng tối thiểu 0,58: chỉ kẹp bão
// hoà thì xanh hoàng gia/xanh than (l ~0,4) vẫn ra "khối xanh than" ở mặt khuất nắng (pano_138 UBND, 418 BaoViet — đo after6:
// tường render (31,39,51)). Nhà sơn xanh ở HP là xanh NHẠT ngả xám; xanh đậm chỉ ở biển/kính. Nâng sáng mà giữ bão hoà 0,32
// thì ánh trời/tone map lại ra "xanh hoàng gia" (smoke7 138 h90) → tường được nâng còn bão hoà ≤ 0,22.
const COOL_LIFT = 0.58, COOL_SAT = 0.22;
const isCoolBrand = (h, s0) => sMaxOf(h) < 0.33 && s0 > 0.45;
const coolLift = (h, s0, l) => (isCoolBrand(h, s0) ? Math.max(l, COOL_LIFT) : l);
const sCapOf = (h, s0) => (isCoolBrand(h, s0) ? COOL_SAT : sMaxOf(h));

// mảng LỚN xám-xanh/xanh than TỐI, ít bão hoà (0x2c3e50, 0x33475a… — "tháp kính"/"đế kính" dựng tay, pano_230 h0/h90, 395)
// = KÍNH: thành vật liệu kính nhà ô (applyCellGlass: đố theo toạ độ thế giới + phản trời), sáng 0,5 — không còn "khối đen"
const isDarkGlass = (h, s0, l) => { const d = h * 360; return d >= 180 && d <= 250 && s0 >= 0.15 && s0 <= 0.45 && l < 0.38; };
function guarded(q, THREE) {
  if (_cache.has(q)) return _cache.get(q);
  let out = q;
  q.color.getHSL(_hsl, THREE.SRGBColorSpace);
  if (isDarkGlass(_hsl.h, _hsl.s, _hsl.l)) {
    out = applyCellGlass(q.clone());
    out.color.setHSL(_hsl.h, Math.min(_hsl.s, 0.2), 0.5, THREE.SRGBColorSpace);
    // emissive KHÁC đen (cường độ 0): freezeStatic xếp vào lượt 2 (giữ material + onBeforeCompile); lượt 1 bake màu vào màu
    // đỉnh rồi gộp chung material trắng → mất shader kính
    if (out.emissive) { out.emissive.setHex(0xffcc66); out.emissiveIntensity = 0; }
    out.name = (q.name || 'cellmat') + '_glass';
    out.userData = { ...q.userData, paletteGuard: true, cellGlass: true };
    _cache.set(q, out);
    return out;
  }
  const s = Math.min(_hsl.s, sCapOf(_hsl.h, _hsl.s)), l = Math.min(L_MAX, Math.max(L_MIN, coolLift(_hsl.h, _hsl.s, _hsl.l)));
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
  // dải dài RẤT tối (mặt "biển" phủ cả nhà) — trừ BIỂN CÓ CHỮ (t.userData.signTexts, cellsink runDraw): biển đen chữ vàng là
  // thật, sáng ×1,7 thành xám bạc (phản biện W3-C)
  if (ar > 2.6 || ar < 1 / 2.6) return L < 0.14 && !t.userData.signTexts ? { filter: 'brightness(1.7) saturate(0.85)' } : null;
  // mặt tiền 1 màu BÃO HOÀ (xanh hoàng gia UBND pano_138, đỏ BIDV 046): giảm bão hoà — màu thương hiệu chỉ hợp ở biển
  // (sắc LẠNH — lam ≥ đỏ — sáng thêm như coolLift: xanh thương hiệu thành xanh nhạt, không thành xanh than)
  // W4-C: nền XÁM THAN 0,22-0,32 KHÔNG có chữ biển cũng sáng ×1,4 (mặt tiền nhà ô than chì sẫm hơn ảnh thật). LƯU Ý: khối
  // 'NHÀ THUỐC' pano_395 h90/h180 KHÔNG được nâng — texture có signTexts (biển thật) nên quy tắc bỏ qua (phản biện W4-C).
  const f = L < 0.22 ? 'brightness(1.6) saturate(0.8)' : (L < 0.32 && !t.userData.signTexts) ? 'brightness(1.4) saturate(0.85)' : sat > 0.55 ? (c[2] >= c[0] ? 'saturate(0.4) brightness(1.3)' : 'saturate(0.45) brightness(1.08)') : null;
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
  for (const [q, g] of _cache) if (g !== q) { st.materials++; if (g.userData.cellGlass) st.glass = (st.glass || 0) + 1; }
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
    // W4-C (AUDIT4 "khối kính trơn" 157 h180 VIB, 235, 395): tầng trên = DẢI SPANDREL đục dưới mỗi băng kính (đọc ra từng
    // sàn) + kính sáng dần lên đỉnh ô (phản trời); TRỆT (≤ 3,6 m trên mặt phố LAND_H 2) = mặt kính cửa hàng/sảnh: nội thất
    // ẤM sáng, thanh ngang 2,7 m, chân kính tối — thay mảng xanh đặc tới tận đất.
    float yRel = vHpW.y - 2.0;
    if (yRel < 3.6) {
      float tr = 1.0 - smoothstep(0.03, 0.03 + 1.5 * fw.y * ${GLASS_FH.toFixed(2)}, abs(yRel - 2.7));
      vec3 inter = mix(vec3(0.66, 0.60, 0.50), vec3(0.86, 0.84, 0.80), smoothstep(0.4, 2.6, yRel)) * (0.85 + 0.3 * hpPane);
      diffuseColor.rgb = mix(diffuseColor.rgb, inter, 0.62 * fade * step(0.15, yRel));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.17, 0.18), step(yRel, 0.15));
      hpFrame = max(hpFrame, tr * fade);
    } else if (vHpW.y > ${GLASS_YT.toFixed(2)}) {
      float sp = 1.0 - smoothstep(0.18, 0.18 + 1.5 * fw.y, fr.y);
      diffuseColor.rgb *= mix(1.0, 0.82 + 0.3 * fr.y, fade);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.33, 0.36), sp * fade * 0.85);
      hpFrame = max(hpFrame, sp * fade * 0.6);
    }
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
  m.customProgramCacheKey = () => 'cellglass_w4c';
  return m;
}

// ---- MẶT TIỀN VẼ TAY (world.js: ~25 helper xxFacade trong khối ô + facadeTex) ----
// Trước: ô cửa sổ = HÌNH CHỮ NHẬT ĐẶC màu winCss (thường xanh than '#3f5a6b'/'#274a72') trên ảnh 256 px cho cả mặt nhà
// 20-40 m → "lỗ vuông đen"/"cửa sổ nhoè" (pano_161 h180, 391, 409, 510, 060). Hơn 20 bản sao helper giống hệt nhau → sửa ở
// MỘT chỗ: cellsink.materialize chạy hàm vẽ gốc trên ngữ cảnh GHI (gridFacadeSpec); nếu đúng mẫu "nền phủ kín + lưới cửa sổ
// một màu (chữ nhật/vòm)" thì VẼ LẠI cùng cỡ ảnh bằng paintGridFacade (giữ nguyên vị trí/cỡ từng cửa; 2× đã thử — cellAtlas
// gấp đôi trang, gộp 107 → 535 ms — bỏ): khung bao sáng
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
function _guardRGB(c, sCap = 1, lMin = L_MIN, lMax = L_MAX, wall = true) {
  const r = c[0] / 255, gg = c[1] / 255, b = c[2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (mx > mn) {
    const d = mx - mn; sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (gg - b) / d + (gg < b ? 6 : 0) : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h /= 6;
  }
  const S = Math.min(sat, wall ? sCapOf(h, sat) : sMaxOf(h), sCap), Lc = Math.min(lMax, Math.max(lMin, wall ? coolLift(h, sat, l) : l));
  if (Math.abs(S - sat) < 0.04 && Math.abs(Lc - l) < 0.04) return c;
  const q = Lc < 0.5 ? Lc * (1 + S) : Lc + S - Lc * S, p = 2 * Lc - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
const _css = (a) => `rgb(${Math.round(a[0])},${Math.round(a[1])},${Math.round(a[2])})`;
const _mix = (a, b, t) => _css([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
// kính thật: xám-xanh dương/xanh lục nhạt — sắc 165-235° giữ bão hoà ≤0,3; sắc khác (tím TPBank pano_354, đỏ, vàng) ≤0,08
function _glassCap(Wc) {
  const mx = Math.max(Wc[0], Wc[1], Wc[2]), mn = Math.min(Wc[0], Wc[1], Wc[2]); if (mx === mn) return 0.3;
  const d = mx - mn, h = 60 * (mx === Wc[0] ? ((Wc[1] - Wc[2]) / d + 6) % 6 : mx === Wc[1] ? (Wc[2] - Wc[0]) / d + 2 : (Wc[0] - Wc[1]) / d + 4);
  return h >= 165 && h <= 235 ? 0.3 : 0.08;
}
function _look(B, Wc) {
  const lum = (0.2126 * Wc[0] + 0.7152 * Wc[1] + 0.0722 * Wc[2]) / 255;
  const shutter = Wc[0] > Wc[2] + 18 && lum < 0.55, light = lum > 0.62;
  return { shutter, light, frame: light ? _css(Wc) : _mix(B, WHITE, 0.38), mull: light ? _css(Wc) : _mix(FRAME_D, B, 0.35), glassTop: light ? [93, 117, 132] : _guardRGB(Wc, _glassCap(Wc), 0.12, 0.6, false) };   // kính: không mang màu tím/xanh đậm của winCss (TPBank 354)
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
// W4-C: mặt tiền nhà ô "KIỂU CỔ ĐIỂN" (thuộc địa/công thự/biệt thự: có cửa vòm, HOẶC cửa sổ CAO h/w ≥ 1,3 trên nền ấm vàng
// đất/kem hay nền sáng) — AUDIT4 D1/D2 "ornate colonial detail missing", "plain blank boxes" (423 h180, 538, 157 h0, 496 h90:
// khối vàng/trắng chỉ có lưới cửa): thêm TRỤ ÁP giữa các cột cửa + 2 mép, GỜ PHÀO đỉnh (răng cưa + bóng đổ), GỜ TẦNG giữa
// các hàng cửa, CHÂN TƯỜNG đậm, MŨ CỬA (gờ đua + bóng) + BỆ CỬA, CHỚP LÁ SÁCH mở 2 bên cửa khi khe đủ rộng. Cùng vị trí cửa
// cũ, cùng cỡ ảnh, không thêm hình học. Nền hiện đại (lạnh/cửa vuông-ngang) → chỉ gờ sàn sáng + bóng (bê tông đổ sàn).
function _hue(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  if (mx === mn) return { h: 0, s: 0, l: mx };
  const d = mx - mn, l = (mx + mn) / 2, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = 60 * (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4);
  return { h, s, l };
}
const SHUT_CSS = ['rgb(58,96,72)', 'rgb(64,92,104)', 'rgb(98,70,50)', 'rgb(70,104,84)'];
function _clusters(vals, tol) {
  const v = [...vals].sort((a, b) => a - b), out = [];
  for (const x of v) { if (out.length && x - out[out.length - 1][out[out.length - 1].length - 1] <= tol) out[out.length - 1].push(x); else out.push([x]); }
  return out.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
}
function _classicDetail(g, W, H, s, B, L) {
  const hsl = _hue(B), warm = hsl.h >= 18 && hsl.h <= 70 && hsl.s >= 0.12;
  const asp = s.rects.map((r) => r.h / r.w).sort((a, b) => a - b), med = asp[asp.length >> 1];
  const rowsY = _clusters(s.rects.map((r) => r.y), H * 0.02), rowsB = _clusters(s.rects.map((r) => r.y + r.h), H * 0.02);
  // + công thự/biệt thự THẤP (≤ 3 hàng cửa) nền ấm hoặc TRẮNG với cửa vuông-đứng (496 h90 biệt thự trắng, 161 h180)
  const classic = s.paths.length > 0 || (med >= 1.3 && (warm || hsl.l > 0.72)) || (rowsY.length <= 3 && med >= 0.95 && (warm || hsl.l > 0.8));
  const light = _mix(B, WHITE, 0.32), lightS = _mix(B, WHITE, 0.5), u = Math.max(1, H / 256);
  const top = Math.min(...s.rects.map((r) => r.y)), bot = Math.max(...s.rects.map((r) => r.y + r.h));
  if (!classic) {
    // hiện đại: gờ sàn bê tông sáng + bóng dưới giữa các hàng cửa
    for (let i = 1; i < rowsY.length; i++) {
      const y = (rowsB[i - 1] + rowsY[i]) / 2;
      g.fillStyle = light; g.fillRect(0, y - 2 * u, W, 3 * u);
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, y + u, W, 2 * u);
    }
    return null;
  }
  const cols = _clusters(s.rects.map((r) => r.x + r.w / 2), W * 0.02);
  const ww = s.rects.reduce((a, r) => a + r.w, 0) / s.rects.length;
  // chân tường (đá/vữa đậm) + gờ chân
  if (bot < H * 0.93) { g.fillStyle = 'rgba(0,0,0,0.13)'; g.fillRect(0, H - H * 0.045, W, H * 0.045); g.fillStyle = light; g.fillRect(0, H - H * 0.05, W, 2 * u); }
  // trụ áp: giữa các cột cửa + 2 mép
  const gap = cols.length > 1 ? (cols[cols.length - 1] - cols[0]) / (cols.length - 1) - ww : W;
  const pw = Math.max(2 * u, Math.min(gap * 0.32, W * 0.04));
  const pil = (xc) => { g.fillStyle = light; g.fillRect(xc - pw / 2, 0, pw, H); g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(xc + pw / 2, 0, Math.max(1, pw * 0.18), H); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(xc - pw / 2, 0, Math.max(1, pw * 0.12), H); };
  if (gap > ww * 0.45) for (let i = 1; i < cols.length; i++) pil((cols[i - 1] + cols[i]) / 2);
  pil(pw / 2); pil(W - pw / 2);
  // gờ tầng giữa các hàng cửa
  for (let i = 1; i < rowsY.length; i++) {
    const y = (rowsB[i - 1] + rowsY[i]) / 2;
    g.fillStyle = lightS; g.fillRect(0, y - 2.5 * u, W, 4 * u);
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, y + 1.5 * u, W, 2.5 * u);
  }
  // gờ phào đỉnh + răng cưa + bóng đổ (chỉ khi hàng cửa trên cùng không sát đỉnh ảnh)
  if (top > H * 0.07) {
    const ch = Math.min(top * 0.45, H * 0.05);
    g.fillStyle = lightS; g.fillRect(0, 0, W, ch);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, ch * 0.45, W, Math.max(1, ch * 0.08));
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, ch, W, Math.max(1.5 * u, ch * 0.2));
    g.fillStyle = 'rgba(0,0,0,0.15)';
    const dw = Math.max(1.5 * u, ch * 0.22);
    for (let x = dw * 0.5; x < W; x += dw * 2) g.fillRect(x, ch * 0.62, dw, ch * 0.3);
  }
  // chớp lá sách mở 2 bên cửa (nền ấm, cửa kính — không phải cửa chớp đóng), khe giữa các cửa đủ rộng
  const shutter = warm && !L.shutter && gap > ww * 0.75;
  const sc = SHUT_CSS[Math.floor((B[0] * 7 + B[1] * 3 + B[2]) % SHUT_CSS.length)];
  return { shutter, sc, light: lightS, u };
}
function _winDeco(g, d, r) {
  const ext = r.w * 0.16, hh = Math.max(2.5 * d.u, r.h * 0.085), f = Math.max(0.6, Math.min(r.w, r.h) * 0.07);   // f = khung của _win
  if (d.shutter) {
    const sw = r.w * 0.36;
    for (const x of [r.x - sw - r.w * 0.06, r.x + r.w + r.w * 0.06]) {
      g.fillStyle = d.sc; g.fillRect(x, r.y, sw, r.h);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      const st = Math.max(1, r.h / 16);
      for (let y = r.y + st * 0.5; y < r.y + r.h; y += st) g.fillRect(x + sw * 0.08, y, sw * 0.84, Math.max(0.6, st * 0.3));
    }
  }
  // mũ cửa (gờ đua) + bóng + bệ cửa
  const yh = r.y - f - hh * 1.9;                                                   // mũ cửa nằm TRÊN khung (khung che mất bản đầu)
  g.fillStyle = d.light; g.fillRect(r.x - ext, yh, r.w + 2 * ext, hh);
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(r.x - ext, yh, r.w + 2 * ext, Math.max(1, hh * 0.25));
  g.fillStyle = 'rgba(0,0,0,0.24)'; g.fillRect(r.x - ext * 0.8, yh + hh, r.w + 1.6 * ext, hh * 0.55);
  g.fillStyle = d.light; g.fillRect(r.x - ext * 0.5, r.y + r.h + f, r.w + ext, hh * 0.75);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(r.x - ext * 0.3, r.y + r.h + f + hh * 0.75, r.w + ext * 0.6, hh * 0.6);
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
  const deco = _classicDetail(g, W, H, s, B, L);
  if (deco) for (const r of s.rects) _winDeco(g, deco, r);
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
