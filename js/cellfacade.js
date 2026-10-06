// cellfacade.js — W3-C FACADES (Đợt 3 wave 3, AUDIT3 FP-3 "palette guard"): BẢO VỆ BẢNG MÀU cho nhà ô dựng tay GIỮ LẠI.
// Kiểm toán 120 pano: các "khối một màu" (UBND xanh hoàng gia pano_138, khối xanh nguyên chất 147/418, tường xanh than gần
// đen VIB 157 h180, BIDV đỏ 046) đều là MẢNG TƯỜNG/KÍNH LỚN của nhà ô (world.js khối cells) tô màu thương hiệu/kính tối
// đặc trên cả mặt nhà. Dò bằng tia (tools pickprobe W3-C): mesh gộp màu đỉnh 0,02/0,02/0,02 và 0,02/0,11/0,39 (tuyến tính).
// Luật: CHỈ mesh màu đặc (không texture, không màu đỉnh, không trong suốt) có hộp bao thế giới ≥ 3,5 m ngang × 2,5 m cao
// (mảng tường/kính — không đụng biển, cột, viền, chi tiết nhỏ) → HSL (sRGB) kẹp: bão hoà ≤ 0,40, độ sáng 0,30..0,90.
// Màu thương hiệu/biển vẫn giữ ở chi tiết nhỏ (biển, dải fascia). Material được NHÂN BẢN 1 lần cho mỗi material gốc
// (cache) → freezeStatic vẫn gộp theo material như cũ (+ tối đa vài material). Xác định, không ngẫu nhiên.
const _cache = new Map();
const _hsl = { h: 0, s: 0, l: 0 };
const S_MAX = 0.4, L_MIN = 0.3, L_MAX = 0.9;

function guarded(q, THREE) {
  if (_cache.has(q)) return _cache.get(q);
  let out = q;
  q.color.getHSL(_hsl, THREE.SRGBColorSpace);
  const s = Math.min(_hsl.s, S_MAX), l = Math.min(L_MAX, Math.max(L_MIN, _hsl.l));
  if (Math.abs(s - _hsl.s) > 0.04 || Math.abs(l - _hsl.l) > 0.04) {
    out = q.clone();
    out.color.setHSL(_hsl.h, s, l, THREE.SRGBColorSpace);
    out.name = (q.name || 'cellmat') + '_pg';
    out.userData = { ...q.userData, paletteGuard: true };
  }
  _cache.set(q, out);
  return out;
}

// ẢNH MẶT TIỀN canvas của nhà ô (gộp vào cellAtlas — cellsink atlasKept): "ô vuông đen" cửa sổ (pano_391/409/510/161/060)
// và mặt tiền gần đen (pano_395 h180) → (a) ảnh mặt tiền (gần vuông, ≥96 px) TỐI (độ chói TB < 0,22) vẽ với filter sáng
// hơn; (b) ảnh mặt tiền 1 màu BÃO HOÀ (TB bão hoà > 0,55) giảm bão hoà. Biển dải dài (tỉ lệ > 2,6) chỉ đụng khi RẤT tối,
// ảnh nhỏ: không đụng. (Đã thử phủ 'lighten' màu kính lên điểm tối: nâu → tím hồng, bỏ.)
let _probe = null;
function meanLum(img) {
  try {
    if (!_probe) { _probe = document.createElement('canvas'); _probe.width = _probe.height = 8; }
    const g = _probe.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, 8, 8); g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data; let s = 0, sat = 0;
    for (let i = 0; i < d.length; i += 4) {
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); sat += mx > 0 ? (mx - mn) / mx : 0;
    }
    _lastSat = sat / 64;
    return s / 64 / 255;
  } catch (e) { _lastSat = 0; return 1; }
}
let _lastSat = 0;
export function cellCanvasFx(img) {
  if (!img || !img.width || img.width < 96 || img.height < 96) return null;
  const ar = img.width / img.height, L = meanLum(img);
  if (ar > 2.6 || ar < 1 / 2.6) return L < 0.14 ? { filter: 'brightness(1.7) saturate(0.85)', dark: true } : null;   // dải dài RẤT tối (mặt "biển" phủ cả nhà, pano_395)
  // mặt tiền 1 màu BÃO HOÀ (xanh hoàng gia UBND pano_138, đỏ BIDV 046): giảm bão hoà — màu thương hiệu chỉ hợp ở biển
  const f = L < 0.22 ? 'brightness(1.6) saturate(0.8)' : _lastSat > 0.55 ? 'saturate(0.45) brightness(1.08)' : 'none';
  // (thử 'lighten' nâng điểm tối lên kính xám-xanh: cửa chớp nâu → tím hồng (pano_157 h0) — BỎ; chỉ giữ filter. Cửa sổ
  // ĐEN của mặt tiền vẽ tay nay sửa TẠI NGUỒN: drawFacadeWindows bên dưới.)
  return f === 'none' ? null : { filter: f, dark: L < 0.22, sat: +_lastSat.toFixed(2) };
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

// ---- MẶT TIỀN VẼ TAY (world.js lmFacade / facadeTex) ----
// Trước: ô cửa sổ = HÌNH CHỮ NHẬT ĐẶC màu winCss (thường xanh than '#3f5a6b'/'#274a72') trên ảnh 256 px cho cả mặt nhà
// 20-40 m → "lỗ vuông đen"/"cửa sổ nhoè" (pano_161 h180, 391, 409, 510, 060). Nay: khung bao sáng hơn tường, gờ bệ cửa đổ bóng,
// vạch sàn mờ; winCss ẤM (nâu/vàng đất, tối) → CỬA CHỚP gỗ lá sách; còn lại → KÍNH: dải màu dọc (trên phản trời sáng, dưới
// tối) + đố chữ thập + vệt bóng chéo; winCss SÁNG (khung trắng trên tường đậm) → khung = winCss, kính xám-xanh. Xác định.
const _rgb = (css) => { const v = parseInt(String(css).replace('#', '').slice(0, 6), 16) || 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const _mix = (a, b, t) => `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
const SKY = [200, 214, 224], DEEP = [30, 42, 51], WHITE = [255, 255, 255], FRAME_D = [70, 74, 78];
export function drawFacadeWindows(g, w, h, baseCss, winCss, cols, rows) {
  g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
  const B = _rgb(baseCss), W = _rgb(winCss);
  const lum = (0.2126 * W[0] + 0.7152 * W[1] + 0.0722 * W[2]) / 255;
  const shutter = W[0] > W[2] + 18 && lum < 0.55, lightWin = lum > 0.62;
  const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
  g.fillStyle = 'rgba(0,0,0,0.07)';                                          // vạch sàn (gờ bê tông đổ bóng mờ)
  for (let r = 1; r < rows; r++) g.fillRect(0, my + r * ch - 1, w, Math.max(2, h / 256));
  const frame = lightWin ? winCss : _mix(B, WHITE, 0.38);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x0 = mx + c * cw + cw * 0.16, y0 = my + r * ch + ch * 0.16, ww = cw * 0.68, wh = ch * 0.66;
    const f = Math.max(1, ww * 0.07), lw = Math.max(1, ww * 0.045);
    g.fillStyle = frame; g.fillRect(x0 - f, y0 - f, ww + 2 * f, wh + 2 * f);   // khung bao
    g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x0 - f, y0 + wh + f, ww + 2 * f, Math.max(1, f));   // bóng dưới bệ cửa
    if (shutter) {                                                                // cửa chớp lá sách 2 cánh
      g.fillStyle = winCss; g.fillRect(x0, y0, ww, wh);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = y0 + 2; y < y0 + wh; y += Math.max(2, wh / 14)) g.fillRect(x0, y, ww, Math.max(1, wh / 50));
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x0 + ww / 2 - lw / 2, y0, lw, wh);
    } else {
      const glassTop = lightWin ? [93, 117, 132] : W;
      const gr = g.createLinearGradient(0, y0, 0, y0 + wh);
      gr.addColorStop(0, _mix(glassTop, SKY, lightWin ? 0.35 : 0.55));
      gr.addColorStop(0.55, _mix(glassTop, SKY, 0.18));
      gr.addColorStop(1, _mix(glassTop, DEEP, 0.3));
      g.fillStyle = gr; g.fillRect(x0, y0, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.09)';                                    // vệt phản chiếu chéo
      g.beginPath(); g.moveTo(x0 + ww * 0.15, y0 + wh); g.lineTo(x0 + ww * 0.55, y0); g.lineTo(x0 + ww * 0.75, y0); g.lineTo(x0 + ww * 0.35, y0 + wh); g.closePath(); g.fill();
      g.fillStyle = lightWin ? winCss : _mix(FRAME_D, B, 0.35);                  // đố chữ thập
      g.fillRect(x0 + ww / 2 - lw / 2, y0, lw, wh); g.fillRect(x0, y0 + wh * 0.32 - lw / 2, ww, lw);
    }
  }
}
