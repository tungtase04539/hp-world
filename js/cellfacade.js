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
// hơn; (b) sau khi vẽ, phủ 'lighten' một màu kính xám-xanh (78,90,102): pixel tối hơn (lỗ cửa sổ đen, khe) thành KÍNH
// tối phản trời, pixel sáng (tường sơn) giữ nguyên. Biển dải dài (tỉ lệ > 2,6) và ảnh nhỏ: không đụng.
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
  if (ar > 2.6 || ar < 1 / 2.6) return L < 0.14 ? { filter: 'brightness(1.7) saturate(0.85)', lift: null, dark: true } : null;   // dải dài RẤT tối (mặt "biển" phủ cả nhà, pano_395)
  // mặt tiền 1 màu BÃO HOÀ (xanh hoàng gia UBND pano_138, đỏ BIDV 046): giảm bão hoà — màu thương hiệu chỉ hợp ở biển
  const f = L < 0.22 ? 'brightness(1.6) saturate(0.8)' : _lastSat > 0.55 ? 'saturate(0.45) brightness(1.08)' : 'none';
  return { filter: f, lift: 'rgb(78,90,102)', dark: L < 0.22, sat: +_lastSat.toFixed(2) };
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
