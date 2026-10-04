// props.js — ĐỒ ĐẠC PHỐ (Đợt 3 WP7): xe máy đỗ, ô tô đỗ, cột điện + búi dây, đèn đường, đồ lặt vặt vỉa hè, người đi bộ.
// Thay các khối cũ trong world.js (scooters/cars/utilpoles/ornlamp/vendors/FOOD/cell_dens/night bulbs) — vốn rải theo
// THỨ TỰ ROADS_DT với trần cứng (90% xe máy nằm trên 7 đường đầu), mô hình hộp đồ chơi, ô tô đỗ TRÊN vỉa hè.
//
// NGUYÊN TẮC
//  • Mọi offset ngang lấy từ js/xsection.js (furnitureLine / parkingLine / facadeLine / curbLine / SIDEWALK_TOP).
//  • Mật độ theo BẰNG CHỨNG PANO (js/props_evidence.js, sinh từ audit_enriched.json): pano gần nhất ≤ 60 m quyết định
//    xe máy (0-3), ô tô đỗ (0-2), cột điện/búi dây (0-2), loại đèn, đồ lặt vặt. Không có pano → mặc định theo vùng.
//  • Tất định & ĐỘC LẬP THỨ TỰ: mọi quyết định = băm (hash) theo toạ độ, không có LCG chạy dọc vòng lặp → đổi một đoạn
//    đường không xáo trộn phần còn lại. Ngân sách = lấy mẫu ĐỀU theo hash (không "N đường đầu ăn hết").
//  • Tất cả là InstancedMesh (vài chục draw call cho cả thành phố). Mô hình thủ tục có màu theo ĐỈNH (vertex colour) +
//    mặt nạ sơn `aPaint` (phần thân nhận instanceColor; mũ bảo hiểm/thùng sau/hộp công tơ là PHỤ KIỆN bật/tắt theo
//    hash vị trí trong vertex shader). LOD 2 mức + culling theo khoảng cách & nửa không gian phía trước camera
//    (bộ cull riêng — instcull.js không nén được attribute tuỳ biến).
//  • Dây điện = 1 LineSegments cho cả thành phố, alpha giảm theo khoảng cách + bỏ (discard) xa > uFar (dây thật
//    mảnh dưới 1 px ở xa); ~336k đỉnh đường thẳng — rẻ hơn chia ô (thêm draw call) trên GPU tích hợp.
//  • Người đi bộ: đứng / ngồi ghế nhựa / đi lại — đi lại hoàn toàn trên GPU (uPropTime), không tốn CPU mỗi khung.
//
// API: buildProps(ctx) → { stats, update(cam), meshes, cableMeshes, parkedCars, cullStats } — gọi 1 lần trong buildWorld (SAU khi cây/công trình đã có collider để
//      né), trước freezeStatic. ctx xem chú thích ở buildProps.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_HW, SIDEWALK_W, ROAD_TOP, SIDEWALK_TOP, curbLine, facadeLine, parkingLine, furnitureLine } from './xsection.js';
import { PROPS_EVIDENCE } from './props_evidence.js';
import { LITE } from './device.js';
import { RB_B64 } from './buildings_real.js';
import { decodeRB, makeFootprintGrid } from './buildings_data.js';
import { claimAt } from './claims.js';
import { onCarriage, clearDisc } from './clearance.js';   // Đợt 3 W2-A: lòng đường thật (biết khe đường đôi/nút giao) + 3 m quanh camera pano

// =====================================================================================================================
// 0. TIỆN ÍCH: hash tất định theo toạ độ, màu
// =====================================================================================================================
function hash3(x, z, s) {
  let h = Math.imul((Math.round(x * 8) | 0) ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(((Math.round(z * 8) | 0) + Math.imul(s, 0x27d4eb2f)) | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
const _c = new THREE.Color();
const lin = (hex) => { _c.setHex(hex); return [_c.r, _c.g, _c.b]; };
const pick = (arr, u) => arr[Math.min(arr.length - 1, (u * arr.length) | 0)];
// góc rotation.y để trục LOCAL +Z (headZ) hoặc LOCAL +X (headX) chỉ theo hướng (dx,dz) — quy ước world.js:
// local X → (cosθ, −sinθ), local Z → (sinθ, cosθ)
const headZ = (dx, dz) => Math.atan2(dx, dz);
const headX = (dx, dz) => Math.atan2(-dz, dx);

// =====================================================================================================================
// 1. BỘ DỰNG HÌNH THỦ TỤC: mọi mảnh → non-indexed, có position/normal/color/aPaint (+aLimb cho người)
// =====================================================================================================================
// aPaint: 0 = màu cố định · (0,1] = pha màu instance · 2 = bảng màu A theo hash · 3 = bảng màu B theo hash
//         4 = phụ kiện cổng 1 (màu cố định) · 5 = phụ kiện cổng 1 (bảng A) · 6 = phụ kiện cổng 2 (cố định) · 7 = cổng 2 (bảng A)
function finish(geo, colors, paint = 0, limb = -1) {
  // colors: hex | [hex theo group] (CylinderGeometry: thân, nắp trên, nắp dưới; BoxGeometry: +x −x +y −y +z −z)
  let g = geo;
  const groups = geo.groups && geo.groups.length ? geo.groups.map((q) => [q.start, q.count, q.materialIndex]) : null;
  if (geo.index) { g = geo.toNonIndexed(); geo.dispose(); }
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const one = Array.isArray(colors) ? null : lin(colors);
  if (one) for (let i = 0; i < n; i++) { col[i * 3] = one[0]; col[i * 3 + 1] = one[1]; col[i * 3 + 2] = one[2]; }
  else {
    const cs = colors.map(lin);
    if (groups) for (const [st, cnt, mi] of groups) { const c = cs[Math.min(mi, cs.length - 1)]; for (let i = st; i < st + cnt && i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; } }
    else for (let i = 0; i < n; i++) { col[i * 3] = cs[0][0]; col[i * 3 + 1] = cs[0][1]; col[i * 3 + 2] = cs[0][2]; }
  }
  g.clearGroups();
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPaint', new THREE.BufferAttribute(new Float32Array(n).fill(paint), 1));
  if (limb >= 0) g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  g.setAttribute('aVar', new THREE.BufferAttribute(new Float32Array(n), 1));   // chỉ số biến thể (gộp model — xem variants())
  return g;
}
// hộp tâm (x,y,z), xoay Euler (rx,ry,rz)
function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z); return g;
}
// hộp thuôn (đáy w0×d0, đỉnh w1×d1) — chân/thân người, ống xả, ghế nhựa
function taper(w0, d0, w1, d1, h, x, y0, z) {
  const g = new THREE.BoxGeometry(1, h, 1); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const top = p.getY(i) > 0; p.setX(i, p.getX(i) * (top ? w1 : w0)); p.setZ(i, p.getZ(i) * (top ? d1 : d0)); }
  g.translate(x, y0 + h / 2, z); return g;
}
// trụ; axis 'y' | 'x' | 'z'
function cyl(rt, rb, h, seg, x, y, z, axis = 'y', open = false) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
  if (axis === 'x') g.rotateZ(Math.PI / 2); else if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z); return g;
}
// thanh hộp nối 2 điểm a→b (khung xe, gương, tay đèn)
function beam(a, b, w, h) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1e-3;
  const g = new THREE.BoxGeometry(w, L, h);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
// PROFILE NGANG (mặt bên z-y) đùn theo trục X, rộng w, tâm x0 — dáng xe nhận ra được với vài chục tam giác
function prof(pts, w, x0 = 0) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false, curveSegments: 1, steps: 1 });
  g.rotateY(-Math.PI / 2);            // shape-x → z thế giới, hướng đùn → −x
  g.translate(x0 + w / 2, 0, 0);
  return g;
}
// GỘP NHIỀU MODEL vào 1 hình (aVar = chỉ số model); InstancedMesh chọn model theo iVar từng instance — vertex shader
// thu đỉnh của model khác về 0 (tam giác suy biến). Cột-đèn (6), đồ lặt vặt (6), kính đèn (4), người (2) → MỖI NHÓM
// 1 draw call. Xe máy/ô tô KHÔNG gộp (nhiều instance × đỉnh suy biến của 3-5 model khác — xem 6.8).
function variants(models) {
  models.forEach((g, i) => g.attributes.aVar.array.fill(i));
  const m = mergeGeometries(models, false);
  models.forEach((g) => g.dispose());
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}
function mergeParts(parts) {
  const m = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  m.computeBoundingSphere(); m.computeBoundingBox();
  return m;
}
const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// =====================================================================================================================
// 2. VẬT LIỆU: Lambert + vertex colour + mặt nạ sơn/phụ kiện (+ dáng đi bộ trên GPU), bóng đổ khớp (customDepthMaterial)
// =====================================================================================================================
const PROP_TIME = { value: 0 };
const PROP_HEAD = /* glsl */`
attribute float aPaint;
attribute float aVar;
attribute float iVar;
uniform float uPropTime;
uniform vec3 uPalA[8];
uniform vec3 uPalB[8];
uniform vec2 uGate;
#ifdef PROP_WALK
attribute float aLimb;
attribute vec4 aWalk;
#endif
float propHash(vec2 p, float k) { p = floor(p * 3.0) + k * 17.13; return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec2 propIP() {
#ifdef USE_INSTANCING
  return vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
#else
  return vec2(0.0);
#endif
}
float propGate() {
  if (abs(aVar - iVar) > 0.5) return 0.0;      // không phải model của instance này
  vec2 ip = propIP();
  if (aPaint > 3.5 && aPaint < 5.5) return step(propHash(ip, 3.0), uGate.x);
  if (aPaint > 5.5) return step(propHash(ip, 4.0), uGate.y);
  return 1.0;
}
#ifdef PROP_WALK
// đi qua-lại trên đoạn dài L (m) với tốc độ spd, dừng 'pause' giây ở 2 đầu; chân/tay đánh quanh hông/vai
void propWalk(inout vec3 p, inout vec3 n) {
  float L = aWalk.x, spd = aWalk.y, ph0 = aWalk.z, pau = aWalk.w;
  float walking = 0.0, dirv = 1.0, s = 0.0;
  if (spd > 0.01 && L > 0.5) {
    float tw = L / spd, P = 2.0 * (tw + pau);
    float u = mod(uPropTime + ph0 * P, P);
    if (u < tw) { s = u * spd - 0.5 * L; walking = 1.0; }
    else if (u < tw + pau) { s = 0.5 * L; }
    else if (u < 2.0 * tw + pau) { s = 0.5 * L - (u - tw - pau) * spd; dirv = -1.0; walking = 1.0; }
    else { s = -0.5 * L; dirv = -1.0; }
  }
  float ph = uPropTime * max(spd, 0.6) * 4.6 + ph0 * 6.2831;
  float sw = sin(ph) * walking;
  float ang = 0.0, py = 0.9;
  if (aLimb > 0.5 && aLimb < 1.5) ang = 0.42 * sw;
  else if (aLimb > 1.5 && aLimb < 2.5) ang = -0.42 * sw;
  else if (aLimb > 2.5 && aLimb < 3.5) { ang = -0.36 * sw; py = 1.38; }
  else if (aLimb > 3.5) { ang = 0.36 * sw; py = 1.38; }
  if (ang != 0.0) {
    float c = cos(ang), si = sin(ang);
    vec3 q = p - vec3(0.0, py, 0.0);
    p = vec3(q.x, q.y * c - q.z * si, q.y * si + q.z * c) + vec3(0.0, py, 0.0);
    n = vec3(n.x, n.y * c - n.z * si, n.y * si + n.z * c);
  }
  if (dirv < 0.0) { p.xz = -p.xz; n.xz = -n.xz; }
  p.z += s; p.y += abs(cos(ph)) * 0.03 * walking;
}
#endif
`;
const PROP_COLOR = /* glsl */`
#if defined( USE_COLOR_ALPHA )
  vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
{
  vec2 ip = propIP();
  vec3 tint = vec3(1.0);
#ifdef USE_INSTANCING_COLOR
  tint = instanceColor.xyz;
#endif
  vec3 pa = uPalA[int(propHash(ip, 1.0) * 7.999)];
  vec3 pb = uPalB[int(propHash(ip, 2.0) * 7.999)];
  if (aPaint <= 1.0) vColor.xyz *= mix(vec3(1.0), tint, aPaint);
  else if (aPaint < 2.5) vColor.xyz *= pa;
  else if (aPaint < 3.5) vColor.xyz *= pb;
  else if (aPaint > 4.5 && aPaint < 5.5) vColor.xyz *= pa;
  else if (aPaint > 6.5) vColor.xyz *= pa;
}
`;
const PROP_NORMAL = /* glsl */`
#include <beginnormal_vertex>
#ifdef PROP_WALK
  vec3 propP = vec3(position); propWalk(propP, objectNormal);
#endif
`;
const PROP_BEGIN = /* glsl */`
#include <begin_vertex>
#ifdef PROP_WALK
#ifdef PROP_DEPTH
  vec3 propN = vec3(0.0, 1.0, 0.0); vec3 propP = vec3(position); propWalk(propP, propN);
#endif
  transformed = propP;
#endif
  transformed *= propGate();
`;
function hookUniforms(sh, u) {
  sh.uniforms.uPropTime = PROP_TIME; sh.uniforms.uPalA = u.uPalA; sh.uniforms.uPalB = u.uPalB; sh.uniforms.uGate = u.uGate;
}
// palA/palB: 8 hex; gate: [xác suất phụ kiện cổng 1, cổng 2]
function propMaterial({ palA = [0xffffff], palB = [0xffffff], gate = [1, 1], walk = false, name = '' } = {}) {
  const P = (a) => { const r = []; for (let i = 0; i < 8; i++) r.push(new THREE.Color(a[i % a.length])); return r; };
  const u = { uPalA: { value: P(palA) }, uPalB: { value: P(palB) }, uGate: { value: new THREE.Vector2(gate[0], gate[1]) } };
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.name = 'props_' + name;
  if (walk) m.defines = { PROP_WALK: '' };
  m.onBeforeCompile = (sh) => {
    hookUniforms(sh, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PROP_HEAD)
      .replace('#include <color_vertex>', PROP_COLOR)
      .replace('#include <beginnormal_vertex>', PROP_NORMAL)
      .replace('#include <begin_vertex>', PROP_BEGIN);
  };
  m.customProgramCacheKey = () => 'hp_props_v2' + (walk ? '_walk' : '');
  // bóng đổ: cùng phụ kiện/dáng đi (nếu không, bóng của mũ "đã tắt" hay người đang đi sẽ đứng yên một chỗ)
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  d.defines = walk ? { PROP_WALK: '', PROP_DEPTH: '' } : { PROP_DEPTH: '' };
  d.onBeforeCompile = (sh) => {
    hookUniforms(sh, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + PROP_HEAD)
      .replace('#include <begin_vertex>', PROP_BEGIN);
  };
  d.customProgramCacheKey = () => 'hp_props_depth_v2' + (walk ? '_walk' : '');
  m.userData.depth = d;
  return m;
}

// Dây điện: LineSegments, màu tối, alpha giảm theo khoảng cách (dây 1-2 cm thật < 1 px ở xa → không thành vệt đen)
function cableMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: new THREE.Color(0x1d1d1f) }, opacity: { value: 0.92 }, uFar: { value: 520 } }]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying float vDist;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vDist = -mvPosition.z;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float opacity; uniform float uFar;
      #include <common>
      #include <fog_pars_fragment>
      varying float vDist;
      void main() {
        if (vDist > uFar) discard;
        float a = opacity * clamp(34.0 / max(vDist, 1.0), 0.10, 1.0) * (1.0 - smoothstep(uFar * 0.7, uFar, vDist));
        gl_FragColor = vec4(color, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true, depthWrite: false, fog: true,
  });
}

// =====================================================================================================================
// 3. MÔ HÌNH (local: +Z = mũi/đầu xe, X = ngang, bánh chạm y = 0). Số tam giác ghi ở cuối từng hàm.
// =====================================================================================================================
const C = {
  tyre: 0x19191b, rim: 0x3b3d42, hub: 0x9a9fa5, black: 0x1a1a1c, dark: 0x2e3034, steel: 0x8e9399, chrome: 0xb8bcc0,
  seat: 0x1c1c1e, light: 0xe9eef2, red: 0xa81c1c, amber: 0xd98a1c, plate: 0xe7e6dc, glass: 0x26313b, white: 0xf1f1ec,
};
function bikeWheel(parts, z, r, w) {
  parts.push(finish(cyl(r, r, w, 12, 0, r, z, 'x'), [C.tyre, C.rim, C.rim]));
  parts.push(finish(cyl(r * 0.36, r * 0.36, w + 0.03, 6, 0, r, z, 'x'), C.hub));
}
function bikeCommon(parts, { hbY, hbZ, mirrorY }) {
  parts.push(finish(box(0.68, 0.035, 0.035, 0, hbY, hbZ), C.black));                       // ghi-đông + tay nắm
  for (const s of [-1, 1]) {
    parts.push(finish(beam([s * 0.22, hbY + 0.01, hbZ], [s * 0.28, mirrorY, hbZ + 0.04], 0.018, 0.018), C.black)); // cần gương
    parts.push(finish(box(0.12, 0.075, 0.025, s * 0.29, mirrorY + 0.02, hbZ + 0.045, 0, s * 0.25, 0), C.black)); // mặt gương
  }
}
// (a) XE GA NHỎ phổ thông (bánh 14"): sàn để chân, yếm trước, đuôi tròn — ~480 tam giác
function modelScooter() {
  const P = [];
  bikeWheel(P, 0.63, 0.25, 0.09); bikeWheel(P, -0.6, 0.25, 0.1);
  P.push(finish(box(0.34, 0.06, 0.5, 0, 0.3, 0.1), 0x2a2b2d));                                 // sàn để chân (thảm cao su)
  P.push(finish(prof([[-0.1, 0.27], [-0.3, 0.3], [-0.4, 0.5], [-0.78, 0.55], [-0.93, 0.64], [-0.92, 0.72], [-0.6, 0.79], [-0.14, 0.79], [-0.08, 0.6]], 0.34), 0xffffff, 1)); // thân sau
  P.push(finish(box(0.13, 0.2, 0.5, 0.11, 0.32, -0.4), 0x2d2e31));                              // hộp số/động cơ (bên trái = +X)
  P.push(finish(prof([[0.3, 0.3], [0.44, 0.33], [0.58, 0.74], [0.57, 0.98], [0.47, 1.0], [0.38, 0.8], [0.26, 0.4]], 0.4), 0xffffff, 1)); // yếm trước
  P.push(finish(prof([[0.42, 0.47], [0.55, 0.535], [0.72, 0.535], [0.88, 0.45], [0.86, 0.41], [0.72, 0.495], [0.55, 0.495], [0.44, 0.43]], 0.13), 0xffffff, 1)); // chắn bùn
  P.push(finish(beam([0, 0.25, 0.63], [0, 0.95, 0.53], 0.07, 0.05), C.dark));                   // phuộc
  P.push(finish(box(0.36, 0.13, 0.2, 0, 1.03, 0.5), 0xffffff, 1));                              // ốp đầu
  P.push(finish(box(0.2, 0.07, 0.04, 0, 1.02, 0.61), C.light));                                 // đèn pha
  bikeCommon(P, { hbY: 1.07, hbZ: 0.44, mirrorY: 1.31 });
  P.push(finish(prof([[-0.94, 0.74], [-0.86, 0.83], [-0.45, 0.86], [-0.2, 0.85], [-0.13, 0.79], [-0.92, 0.71]], 0.3), C.seat)); // yên
  P.push(finish(box(0.16, 0.06, 0.04, 0, 0.66, -0.94), C.red));                                 // đèn hậu
  P.push(finish(box(0.32, 0.03, 0.2, 0, 0.82, -0.82), C.steel));                                // tay dắt sau
  P.push(finish(cyl(0.045, 0.05, 0.42, 6, -0.13, 0.3, -0.58, 'z'), C.steel));                   // ống xả (bên phải = −X)
  P.push(finish(box(0.18, 0.12, 0.02, 0, 0.47, -0.9), C.plate));                                // biển số
  // phụ kiện cổng 1: mũ bảo hiểm treo gương phải (màu bảng A)
  P.push(finish(new THREE.SphereGeometry(0.135, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0.3, 1.13, 0.5), 0xffffff, 5));
  return mergeParts(P);
}
// (b) XE SỐ phổ thông (underbone): bánh to mảnh, khung lộ, máy lộ — ~520 tam giác
function modelUnderbone() {
  const P = [];
  bikeWheel(P, 0.64, 0.3, 0.075); bikeWheel(P, -0.62, 0.3, 0.085);
  P.push(finish(prof([[0.28, 0.42], [0.42, 0.45], [0.52, 0.86], [0.47, 0.94], [0.38, 0.88], [0.24, 0.5]], 0.36), 0xffffff, 1)); // ốp chân
  P.push(finish(beam([0, 0.6, 0.42], [0, 0.48, 0.02], 0.1, 0.1), 0xffffff, 1));                // khung
  P.push(finish(box(0.24, 0.24, 0.34, 0, 0.34, 0.06), 0x47494d));                               // lốc máy
  P.push(finish(cyl(0.08, 0.08, 0.2, 6, 0, 0.42, 0.25, 'x'), C.steel));                         // đầu xi-lanh
  P.push(finish(prof([[0.05, 0.5], [-0.25, 0.52], [-0.7, 0.66], [-0.9, 0.74], [-0.88, 0.8], [-0.15, 0.8], [0.08, 0.66]], 0.3), 0xffffff, 1)); // ốp thân sau
  P.push(finish(prof([[-0.92, 0.79], [-0.89, 0.88], [-0.3, 0.91], [0.06, 0.88], [0.1, 0.82], [-0.88, 0.77]], 0.28), C.seat));
  P.push(finish(box(0.24, 0.025, 0.3, 0, 0.84, -0.86), C.steel));                               // baga sau
  P.push(finish(prof([[0.4, 0.58], [0.55, 0.64], [0.74, 0.64], [0.92, 0.52], [0.9, 0.48], [0.74, 0.6], [0.55, 0.6], [0.42, 0.54]], 0.12), 0xffffff, 1));
  for (const s of [-1, 1]) P.push(finish(beam([s * 0.07, 0.3, 0.64], [s * 0.07, 0.92, 0.49], 0.035, 0.035), C.chrome)); // phuộc
  P.push(finish(box(0.3, 0.14, 0.22, 0, 1.0, 0.47), 0xffffff, 1));                              // ốp đèn
  P.push(finish(box(0.16, 0.08, 0.04, 0, 0.98, 0.585), C.light));
  bikeCommon(P, { hbY: 1.05, hbZ: 0.44, mirrorY: 1.29 });
  P.push(finish(box(0.05, 0.1, 0.6, 0.12, 0.36, -0.32), C.dark));                               // hộp xích (trái)
  P.push(finish(cyl(0.05, 0.045, 0.62, 6, -0.14, 0.27, -0.4, 'z'), C.steel));                  // ống xả (phải)
  for (const s of [-1, 1]) P.push(finish(beam([s * 0.13, 0.3, -0.62], [s * 0.13, 0.76, -0.5], 0.04, 0.04), C.dark)); // giảm xóc
  P.push(finish(box(0.14, 0.06, 0.05, 0, 0.76, -0.98), C.red));
  P.push(finish(box(0.18, 0.12, 0.02, 0, 0.58, -0.96), C.plate));
  P.push(finish(new THREE.SphereGeometry(0.135, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(0.3, 1.11, 0.48), 0xffffff, 5));
  return mergeParts(P);
}
// (c) XE GA LỚN: bánh 16", thân dài, sàn phẳng; phụ kiện cổng 2: thùng sau — ~560 tam giác
function modelBigScooter() {
  const P = [];
  bikeWheel(P, 0.68, 0.29, 0.1); bikeWheel(P, -0.64, 0.28, 0.11);
  P.push(finish(box(0.36, 0.07, 0.5, 0, 0.36, 0.12), 0x2a2b2d));
  P.push(finish(prof([[-0.12, 0.33], [-0.32, 0.36], [-0.45, 0.58], [-0.82, 0.62], [-1.0, 0.72], [-0.98, 0.8], [-0.62, 0.86], [-0.14, 0.86], [-0.08, 0.66]], 0.36), 0xffffff, 1));
  P.push(finish(box(0.14, 0.22, 0.52, 0.12, 0.36, -0.42), 0x2d2e31));
  P.push(finish(prof([[0.32, 0.36], [0.48, 0.4], [0.64, 0.8], [0.62, 1.04], [0.5, 1.06], [0.4, 0.86], [0.28, 0.44]], 0.44), 0xffffff, 1));
  P.push(finish(prof([[0.46, 0.55], [0.6, 0.62], [0.78, 0.62], [0.96, 0.52], [0.94, 0.48], [0.78, 0.58], [0.6, 0.58], [0.48, 0.51]], 0.14), 0xffffff, 1));
  P.push(finish(beam([0, 0.29, 0.68], [0, 1.0, 0.58], 0.08, 0.06), C.dark));
  P.push(finish(box(0.4, 0.14, 0.22, 0, 1.1, 0.55), 0xffffff, 1));
  P.push(finish(box(0.26, 0.06, 0.05, 0, 1.08, 0.67), C.light));
  P.push(finish(box(0.3, 0.12, 0.03, 0, 1.22, 0.62, -0.5, 0, 0), C.glass));                   // kính chắn gió nhỏ
  bikeCommon(P, { hbY: 1.12, hbZ: 0.48, mirrorY: 1.36 });
  P.push(finish(prof([[-1.0, 0.81], [-0.9, 0.9], [-0.48, 0.93], [-0.2, 0.92], [-0.13, 0.86], [-0.98, 0.78]], 0.32), C.seat));
  P.push(finish(box(0.2, 0.06, 0.04, 0, 0.74, -1.0), C.red));
  P.push(finish(box(0.34, 0.03, 0.2, 0, 0.9, -0.86), C.steel));
  P.push(finish(cyl(0.05, 0.055, 0.46, 6, -0.14, 0.34, -0.62, 'z'), C.steel));
  P.push(finish(box(0.18, 0.12, 0.02, 0, 0.52, -0.96), C.plate));
  P.push(finish(box(0.42, 0.3, 0.38, 0, 1.1, -0.86), 0x2b2c2f, 6));                            // thùng sau (cổng 2)
  P.push(finish(new THREE.SphereGeometry(0.135, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(-0.31, 1.17, 0.52), 0xffffff, 5));
  return mergeParts(P);
}
// (d) XE CUB đời cũ: rổ trước, yên dài, ốp chân lớn — ~500 tam giác
function modelCub() {
  const P = [];
  bikeWheel(P, 0.64, 0.3, 0.08); bikeWheel(P, -0.62, 0.3, 0.085);
  P.push(finish(prof([[0.26, 0.4], [0.44, 0.44], [0.55, 0.9], [0.48, 0.97], [0.38, 0.92], [0.22, 0.5]], 0.44), 0xefe9dc));  // ốp chân màu kem
  P.push(finish(beam([0, 0.62, 0.42], [0, 0.5, 0.02], 0.12, 0.12), 0xffffff, 1));
  P.push(finish(box(0.24, 0.24, 0.34, 0, 0.34, 0.06), 0x55575b));
  P.push(finish(prof([[0.05, 0.52], [-0.25, 0.54], [-0.7, 0.66], [-0.88, 0.72], [-0.86, 0.8], [-0.15, 0.8], [0.08, 0.68]], 0.32), 0xffffff, 1));
  P.push(finish(prof([[-0.95, 0.79], [-0.92, 0.89], [-0.3, 0.92], [0.04, 0.9], [0.08, 0.83], [-0.9, 0.77]], 0.3), 0x3a2a22));
  P.push(finish(box(0.3, 0.025, 0.34, 0, 0.84, -0.86), C.steel));
  P.push(finish(prof([[0.4, 0.6], [0.55, 0.66], [0.74, 0.66], [0.92, 0.54], [0.9, 0.5], [0.74, 0.62], [0.55, 0.62], [0.42, 0.56]], 0.12), 0xffffff, 1));
  for (const s of [-1, 1]) P.push(finish(beam([s * 0.07, 0.3, 0.64], [s * 0.07, 0.94, 0.5], 0.04, 0.04), C.dark));
  P.push(finish(box(0.34, 0.16, 0.22, 0, 1.02, 0.48), 0xffffff, 1));
  P.push(finish(box(0.16, 0.09, 0.04, 0, 1.0, 0.6), C.light));
  bikeCommon(P, { hbY: 1.07, hbZ: 0.44, mirrorY: 1.3 });
  P.push(finish(box(0.34, 0.22, 0.26, 0, 0.92, 0.7), 0x2b2b2b));                               // rổ trước (lưới sắt)
  P.push(finish(box(0.05, 0.1, 0.6, 0.12, 0.36, -0.32), C.dark));
  P.push(finish(cyl(0.05, 0.045, 0.62, 6, -0.14, 0.27, -0.4, 'z'), C.steel));
  P.push(finish(box(0.14, 0.06, 0.05, 0, 0.76, -0.98), C.red));
  P.push(finish(box(0.18, 0.12, 0.02, 0, 0.58, -0.96), C.plate));
  P.push(finish(new THREE.SphereGeometry(0.135, 7, 4, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(-0.3, 1.13, 0.48), 0xffffff, 5));
  return mergeParts(P);
}
// LOD xa của xe máy: bóng dáng 1 khối + 2 bánh lục giác — ~72 tam giác
function modelBikeFar() {
  const P = [];
  for (const z of [0.63, -0.6]) P.push(finish(cyl(0.27, 0.27, 0.1, 6, 0, 0.27, z, 'x'), C.tyre));
  P.push(finish(prof([[0.85, 0.45], [0.6, 1.02], [0.45, 1.02], [0.35, 0.55], [-0.1, 0.42], [-0.95, 0.62], [-0.95, 0.78], [-0.2, 0.84], [0.1, 0.6], [0.4, 0.4]], 0.36), 0xffffff, 1));
  P.push(finish(box(0.66, 0.05, 0.05, 0, 1.06, 0.44), C.black));
  return mergeParts(P);
}

// ---------- Ô TÔ (song song mép đường) ----------
function carWheels(P, zf, zr, xw, r, w) {
  for (const z of [zf, zr]) for (const s of [-1, 1]) {
    P.push(finish(cyl(r, r, w, 10, s * xw, r, z, 'x'), [C.tyre, 0x1e1e20, 0x1e1e20]));          // lốp (mặt bên đen)
    P.push(finish(cyl(r * 0.64, r * 0.64, w + 0.02, 8, s * xw, r, z, 'x'), [0x8d9297, 0xb3b8bd, 0xb3b8bd])); // mâm bạc
  }
}
function carLights(P, zF, zB, yF, yB, xs) {
  for (const s of [-1, 1]) {
    P.push(finish(box(0.34, 0.1, 0.05, s * xs, yF, zF), C.light));
    P.push(finish(box(0.3, 0.1, 0.05, s * xs, yB, zB), C.red));
  }
  P.push(finish(box(0.5, 0.12, 0.02, 0, yF - 0.17, zF + 0.01), C.plate));
  P.push(finish(box(0.5, 0.12, 0.02, 0, yB - 0.12, zB - 0.01), C.plate));
}
// SEDAN 4.5×1.76×1.45 — ~330 tam giác
function modelSedan() {
  const P = [];
  carWheels(P, 1.35, -1.35, 0.77, 0.31, 0.22);
  P.push(finish(prof([[2.25, 0.32], [2.28, 0.62], [2.1, 0.78], [1.15, 0.86], [-1.4, 0.88], [-2.22, 0.84], [-2.27, 0.55], [-2.22, 0.32], [-1.7, 0.3], [-1.62, 0.55], [-1.08, 0.55], [-1.0, 0.3], [1.0, 0.3], [1.08, 0.55], [1.62, 0.55], [1.7, 0.3]], 1.74), 0xffffff, 1));
  P.push(finish(prof([[1.15, 0.86], [0.42, 1.36], [-0.82, 1.4], [-1.52, 0.9]], 1.5), C.glass));          // nhà kính
  P.push(finish(box(1.52, 0.05, 1.22, 0, 1.4, -0.2), 0xffffff, 1));                                       // nóc
  for (const s of [-1, 1]) {
    P.push(finish(beam([s * 0.74, 0.86, 1.13], [s * 0.74, 1.39, 0.42], 0.07, 0.06), 0xffffff, 1));      // trụ A
    P.push(finish(box(0.06, 0.52, 0.12, s * 0.75, 1.13, -0.18), 0xffffff, 1));                          // trụ B
    P.push(finish(beam([s * 0.74, 0.88, -1.5], [s * 0.74, 1.4, -0.8], 0.07, 0.08), 0xffffff, 1));       // trụ C
    P.push(finish(box(0.08, 0.1, 0.16, s * 0.93, 0.98, 0.98), 0xffffff, 1));                            // gương
  }
  P.push(finish(box(0.8, 0.14, 0.03, 0, 0.58, 2.27), C.dark));                                             // ca-lăng
  carLights(P, 2.25, -2.25, 0.72, 0.76, 0.58);
  return mergeParts(P);
}
// SUV 4.6×1.86×1.72 — ~360 tam giác
function modelSUV() {
  const P = [];
  carWheels(P, 1.42, -1.38, 0.8, 0.36, 0.25);
  P.push(finish(prof([[2.3, 0.4], [2.32, 0.8], [2.15, 0.98], [1.1, 1.04], [-2.0, 1.06], [-2.3, 1.02], [-2.32, 0.5], [-2.25, 0.38], [-1.78, 0.38], [-1.68, 0.66], [-1.08, 0.66], [-0.98, 0.38], [1.02, 0.38], [1.12, 0.66], [1.72, 0.66], [1.82, 0.38]], 1.84), 0xffffff, 1));
  P.push(finish(prof([[1.1, 1.04], [0.45, 1.62], [-1.95, 1.64], [-2.15, 1.06]], 1.6), C.glass));
  P.push(finish(box(1.62, 0.06, 2.3, 0, 1.65, -0.75), 0xffffff, 1));
  for (const s of [-1, 1]) {
    P.push(finish(beam([s * 0.8, 1.04, 1.08], [s * 0.8, 1.63, 0.46], 0.07, 0.07), 0xffffff, 1));
    P.push(finish(box(0.06, 0.6, 0.12, s * 0.81, 1.34, -0.3), 0xffffff, 1));
    P.push(finish(box(0.06, 0.6, 0.18, s * 0.81, 1.34, -1.98), 0xffffff, 1));
    P.push(finish(box(0.05, 0.05, 2.0, s * 0.62, 1.71, -0.75), C.dark));                                 // baga nóc
    P.push(finish(box(0.08, 0.11, 0.17, s * 0.99, 1.16, 1.02), 0xffffff, 1));
  }
  P.push(finish(box(0.95, 0.24, 0.03, 0, 0.74, 2.32), C.dark));
  carLights(P, 2.3, -2.31, 0.9, 0.92, 0.62);
  return mergeParts(P);
}
// HATCHBACK / TAXI 3.9×1.7×1.5 (taxi: hộp đèn TAXI trên nóc) — ~310 tam giác
function modelHatch(taxi = false) {
  const P = [];
  carWheels(P, 1.2, -1.2, 0.74, 0.3, 0.2);
  P.push(finish(prof([[1.95, 0.32], [1.98, 0.64], [1.8, 0.8], [1.0, 0.88], [-1.85, 0.92], [-1.95, 0.86], [-1.96, 0.36], [-1.55, 0.3], [-1.48, 0.53], [-0.92, 0.53], [-0.85, 0.3], [0.85, 0.3], [0.92, 0.53], [1.48, 0.53], [1.55, 0.3]], 1.68), 0xffffff, 1));
  P.push(finish(prof([[1.0, 0.88], [0.35, 1.42], [-1.6, 1.45], [-1.88, 0.92]], 1.46), C.glass));
  P.push(finish(box(1.48, 0.05, 1.9, 0, 1.45, -0.6), 0xffffff, 1));
  for (const s of [-1, 1]) {
    P.push(finish(beam([s * 0.72, 0.88, 0.98], [s * 0.72, 1.43, 0.36], 0.06, 0.06), 0xffffff, 1));
    P.push(finish(box(0.06, 0.52, 0.12, s * 0.73, 1.16, -0.35), 0xffffff, 1));
    P.push(finish(box(0.06, 0.52, 0.2, s * 0.73, 1.17, -1.65), 0xffffff, 1));
    P.push(finish(box(0.08, 0.1, 0.15, s * 0.9, 1.0, 0.86), 0xffffff, 1));
  }
  P.push(finish(box(0.7, 0.14, 0.03, 0, 0.58, 1.97), C.dark));
  carLights(P, 1.95, -1.95, 0.72, 0.8, 0.55);
  if (taxi) P.push(finish(box(0.52, 0.16, 0.2, 0, 1.56, -0.35), [C.white, C.white, 0xf3d24a, C.white, 0x2a5aa8, 0x2a5aa8]));
  return mergeParts(P);
}
// XE TẢI NHỎ thùng bạt (tải 1 tấn) 4.8×1.7×2.2 — thùng bạt màu bảng A — ~300 tam giác
function modelTruck() {
  const P = [];
  carWheels(P, 1.55, -1.25, 0.72, 0.3, 0.2);
  P.push(finish(prof([[2.4, 0.35], [2.42, 1.0], [2.3, 1.75], [1.35, 1.82], [1.32, 0.35]], 1.66), 0xffffff, 1));    // ca-bin
  P.push(finish(box(1.6, 0.55, 0.05, 0, 1.38, 2.4, -0.12, 0, 0), C.glass));                                         // kính lái
  for (const s of [-1, 1]) P.push(finish(box(0.03, 0.45, 0.7, s * 0.84, 1.4, 1.9), C.glass));
  P.push(finish(box(1.7, 0.12, 3.15, 0, 0.62, -0.88), C.dark));                                                     // sàn thùng
  P.push(finish(box(1.72, 1.45, 3.1, 0, 1.42, -0.88), 0xffffff, 2));                                                // bạt
  P.push(finish(box(1.7, 0.22, 0.6, 0, 0.45, 1.85), C.dark));
  for (const s of [-1, 1]) {
    P.push(finish(box(0.3, 0.1, 0.05, s * 0.6, 0.62, 2.43), C.light));
    P.push(finish(box(0.2, 0.1, 0.04, s * 0.7, 0.7, -2.45), C.red));
  }
  P.push(finish(box(0.5, 0.14, 0.02, 0, 0.5, -2.46), C.plate));
  return mergeParts(P);
}
// XE VAN / MINIBUS 16 chỗ 5.2×1.88×2.1 (rất phổ biến: xe hợp đồng, xe khách nhỏ, xe công ty) — ~560 tam giác
function modelVan() {
  const P = [];
  carWheels(P, 1.72, -1.55, 0.82, 0.33, 0.22);
  // thân dưới (tới gờ kính), hốc bánh khoét
  P.push(finish(prof([[2.58, 0.38], [2.63, 0.92], [2.42, 1.14], [-2.56, 1.16], [-2.6, 0.42], [-1.95, 0.36], [-1.9, 0.72], [-1.2, 0.72], [-1.14, 0.36], [1.36, 0.36], [1.42, 0.72], [2.04, 0.72], [2.1, 0.36]], 1.86), 0xffffff, 1));
  // dải kính (kính lái dốc + cửa sổ hông liền)
  P.push(finish(prof([[2.42, 1.14], [1.72, 1.98], [-2.5, 2.0], [-2.56, 1.16]], 1.8), C.glass));
  P.push(finish(box(1.84, 0.12, 4.32, 0, 2.04, -0.36), 0xffffff, 1));                                   // nóc
  for (const s of [-1, 1]) {
    P.push(finish(beam([s * 0.9, 1.14, 2.38], [s * 0.9, 1.99, 1.74], 0.07, 0.07), 0xffffff, 1));          // trụ A
    for (const z of [0.95, -0.7]) P.push(finish(box(0.06, 0.86, 0.14, s * 0.91, 1.57, z), 0xffffff, 1)); // trụ B/C
    P.push(finish(box(0.06, 0.86, 0.22, s * 0.91, 1.57, -2.44), 0xffffff, 1));                          // trụ sau
    P.push(finish(box(0.08, 0.14, 0.2, s * 1.0, 1.32, 2.2), C.black));                                   // gương
    P.push(finish(box(0.02, 0.05, 1.6, s * 0.94, 1.0, -0.2), C.dark));                                   // ray cửa lùa
  }
  P.push(finish(box(0.9, 0.22, 0.03, 0, 0.68, 2.64), C.dark));                                           // ca-lăng
  carLights(P, 2.62, -2.61, 0.84, 0.98, 0.66);
  return mergeParts(P);
}
// LOD xa ô tô: thân + ca-bin (mặt bên kính, nóc sơn) — 24 tam giác
function modelCarFar() {
  const P = [];
  P.push(finish(box(1.74, 0.55, 4.4, 0, 0.58, 0), 0xffffff, 1));
  P.push(finish(box(1.5, 0.5, 2.3, 0, 1.12, -0.2), [C.glass, C.glass, 0xffffff, C.glass, C.glass, C.glass], 0));
  return mergeParts(P);
}

// ---------- CỘT ĐIỆN BÊ TÔNG (local: +X = phía lòng đường, +Z = dọc phố) ----------
const POLE_H = 9.4;
function poleCore(P) {
  P.push(finish(cyl(0.105, 0.175, POLE_H, 8, 0, POLE_H / 2, 0), 0xa29e95, 0.35));                        // thân ly tâm
  P.push(finish(box(1.5, 0.1, 0.1, 0.1, POLE_H - 0.55, 0), C.dark));                                      // xà trung thế (ngang phố)
  for (const x of [-0.5, 0.1, 0.7]) P.push(finish(cyl(0.035, 0.05, 0.16, 5, x, POLE_H - 0.42, 0), 0xd8d6ce)); // sứ cách điện
  P.push(finish(box(1.1, 0.08, 0.08, 0.05, POLE_H - 1.35, 0), C.dark));                                   // xà hạ thế
  P.push(finish(box(0.34, 0.26, 0.34, 0, 6.4, 0), 0x2a2a2c));                                             // cụm kẹp cáp viễn thông
  P.push(finish(box(0.3, 0.18, 0.3, 0, 5.5, 0), 0x323234));
  // phụ kiện cổng 1: CUỘN CÁP dư treo cột (rất đặc trưng phố VN)
  P.push(finish(new THREE.TorusGeometry(0.26, 0.035, 3, 9).scale(1, 1.35, 1).rotateY(Math.PI / 2).rotateZ(0.25).translate(0.18, 5.0, 0), 0x18181a, 4));
  // phụ kiện cổng 2: CỤM HỘP CÔNG TƠ (2×3 hộp xám/kem) phía nhà dân (−X)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++)
    P.push(finish(box(0.14, 0.32, 0.24, -0.24, 2.7 + i * 0.36, -0.13 + j * 0.27), i === 1 && j === 0 ? 0xd9d3c3 : 0xb9bcbc, 6));
}
function modelPole() { const P = []; poleCore(P); return mergeParts(P); }
// cột có cần đèn cao áp (đèn trên cột điện — phố t/r) — đầu đèn sáng là InstancedMesh riêng (lampGlow)
const POLE_LAMP_ARM = { y: 7.7, reach: 1.7 };
function modelPoleLamp() {
  const P = []; poleCore(P);
  P.push(finish(beam([0.1, POLE_LAMP_ARM.y - 0.4, 0], [0.7, POLE_LAMP_ARM.y + 0.15, 0], 0.06, 0.06), 0x8d9297));
  P.push(finish(beam([0.7, POLE_LAMP_ARM.y + 0.15, 0], [POLE_LAMP_ARM.reach, POLE_LAMP_ARM.y + 0.28, 0], 0.055, 0.055), 0x8d9297));
  P.push(finish(box(0.55, 0.12, 0.24, POLE_LAMP_ARM.reach + 0.2, POLE_LAMP_ARM.y + 0.25, 0, 0, 0, -0.08), 0x7f868c));
  return mergeParts(P);
}
// cột kép + giàn máy biến áp treo (3 máy) — ~300 tam giác
function modelTransformer() {
  const P = [];
  for (const z of [-0.95, 0.95]) {
    P.push(finish(cyl(0.11, 0.18, POLE_H, 8, 0, POLE_H / 2, z), 0xa29e95, 0.35));
  }
  P.push(finish(box(0.1, 0.1, 2.6, 0, POLE_H - 0.55, 0), C.dark));
  for (const z of [-0.9, 0, 0.9]) P.push(finish(cyl(0.035, 0.05, 0.16, 5, 0, POLE_H - 0.42, z), 0xd8d6ce));
  P.push(finish(box(1.2, 0.1, 2.3, 0.15, 4.4, 0), 0x55595e));                                            // giàn
  for (const z of [-0.6, 0, 0.6]) {
    P.push(finish(cyl(0.26, 0.26, 0.8, 8, 0.25, 4.85, z), 0x7c857e));                                     // máy biến áp
    P.push(finish(cyl(0.05, 0.06, 0.3, 5, 0.25, 5.4, z), 0xd8d6ce));
  }
  P.push(finish(box(0.5, 0.7, 0.35, -0.3, 2.0, 0), 0xcfcabb));                                           // tủ hạ thế
  P.push(finish(box(0.32, 0.26, 0.34, 0, 6.4, 0.95), 0x2a2a2c));
  return mergeParts(P);
}
// LOD xa cột điện — 24 tam giác
function modelPoleFar() {
  const P = [];
  P.push(finish(cyl(0.11, 0.18, POLE_H, 5, 0, POLE_H / 2, 0, 'y', true), 0xa29e95, 0.35));
  P.push(finish(box(1.5, 0.1, 0.1, 0.1, POLE_H - 0.55, 0), C.dark));
  return mergeParts(P);
}
// LOD xa: cột kép biến áp (2 thân + giàn) — ~40 tam giác
function modelTransformerFar() {
  const P = [];
  for (const z of [-0.95, 0.95]) P.push(finish(cyl(0.11, 0.18, POLE_H, 5, 0, POLE_H / 2, z, 'y', true), 0xa29e95, 0.35));
  P.push(finish(box(1.2, 0.5, 2.3, 0.15, 4.7, 0), 0x6d7570));
  return mergeParts(P);
}
// CỘT ĐÈN CAO ÁP thép mạ kẽm (cần vươn ra lòng đường +X) — ~110 tam giác; đầu sáng tách riêng
const LAMP_H = 9.2, LAMP_REACH = 2.05;
function modelCobra() {
  const P = [];
  P.push(finish(box(0.38, 0.22, 0.38, 0, 0.11, 0), 0x8d8a84));
  P.push(finish(cyl(0.06, 0.115, LAMP_H, 8, 0, LAMP_H / 2, 0), 0xa3a9ad));
  P.push(finish(beam([0, LAMP_H - 0.5, 0], [0.55, LAMP_H + 0.05, 0], 0.07, 0.07), 0xa3a9ad));
  P.push(finish(beam([0.55, LAMP_H + 0.05, 0], [LAMP_REACH - 0.15, LAMP_H + 0.22, 0], 0.06, 0.06), 0xa3a9ad));
  P.push(finish(box(0.66, 0.13, 0.28, LAMP_REACH + 0.12, LAMP_H + 0.2, 0, 0, 0, -0.07), 0x858c92));
  return mergeParts(P);
}
// LOD xa đèn cao áp: thân 5 cạnh hở + cần + chao — ~34 tam giác
function modelCobraFar() {
  const P = [];
  P.push(finish(cyl(0.06, 0.115, LAMP_H, 5, 0, LAMP_H / 2, 0, 'y', true), 0xa3a9ad));
  P.push(finish(beam([0, LAMP_H - 0.3, 0], [LAMP_REACH, LAMP_H + 0.2, 0], 0.07, 0.07), 0xa3a9ad));
  return mergeParts(P);
}
// đầu đèn phát sáng (mặt kính dưới chao) — dùng sharedMats.lampGlow (daynight bật sáng ban đêm)
function modelLampGlass(reachX, y) { return mergeParts([finish(box(0.54, 0.07, 0.24, reachX + 0.12, y + 0.1, 0, 0, 0, -0.07), 0xffffff)]); }
// ĐÈN GANG 3 CẦU kiểu Pháp (chỉ vườn hoa/hồ/quảng trường) — thân (local) + 3 cầu sáng
function modelOrnate() {
  const P = [], H = 3.9;
  P.push(finish(cyl(0.34, 0.42, 0.7, 8, 0, 0.35, 0), 0x2b3a30));
  P.push(finish(cyl(0.1, 0.15, H, 8, 0, 0.7 + H / 2, 0), 0x2b3a30));
  P.push(finish(new THREE.SphereGeometry(0.14, 8, 6).translate(0, 0.7 + H + 0.12, 0), 0x2b3a30));
  const topY = 0.7 + H - 0.1;
  for (const s of [-1, 1]) P.push(finish(cyl(0.05, 0.05, 0.95, 5, 0, topY + 0.05, s * 0.48, 'z'), 0x2b3a30));
  return mergeParts(P);
}
// LOD xa đèn gang: đế + thân — ~26 tam giác
function modelOrnateFar() {
  const P = [];
  P.push(finish(cyl(0.34, 0.42, 0.7, 5, 0, 0.35, 0, 'y', true), 0x2b3a30));
  P.push(finish(cyl(0.1, 0.15, 3.9, 5, 0, 0.7 + 1.95, 0, 'y', true), 0x2b3a30));
  P.push(finish(box(0.08, 0.08, 1.9, 0, 4.55, 0), 0x2b3a30));
  return mergeParts(P);
}
function modelOrnateGlobes() {
  const topY = 0.7 + 3.9 - 0.1, P = [];
  // cầu đèn = khối 20 mặt (nhóm "đèn sáng" gộp biến thể → mỗi instance mang đủ hình của các biến thể: giữ nhỏ)
  P.push(finish(new THREE.IcosahedronGeometry(0.22, 0).translate(0, topY + 0.5, 0), 0xffffff));
  for (const s of [-1, 1]) P.push(finish(new THREE.IcosahedronGeometry(0.2, 0).translate(0, topY + 0.02, s * 0.92), 0xffffff));
  return mergeParts(P);
}

// ---------- ĐỒ LẶT VẶT ----------
// bộ BÀN + 4 GHẾ NHỰA thấp (ghế màu instance, bàn bảng A) — ~130 tam giác
function modelStoolSet() {
  const P = [];
  // bàn nhựa thấp: mặt 0,6 m + 4 chân choãi
  P.push(finish(box(0.62, 0.035, 0.62, 0, 0.43, 0), 0xffffff, 2));
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) P.push(finish(beam([sx * 0.27, 0.42, sz * 0.27], [sx * 0.31, 0, sz * 0.31], 0.045, 0.045), 0xffffff, 2));
  // 4 ghế đẩu nhựa: mặt 0,28 m chìa + thân thuôn (đáy 0,34 → đỉnh 0,22)
  for (const [sx, sz] of [[0.55, 0.05], [-0.53, -0.06], [0.04, 0.58], [-0.05, -0.56]]) {
    P.push(finish(taper(0.34, 0.34, 0.2, 0.2, 0.24, sx, 0, sz), 0xffffff, 0.85));
    P.push(finish(box(0.29, 0.03, 0.29, sx, 0.255, sz), 0xffffff, 1));
  }
  return mergeParts(P);
}
// Ô DÙ bán hàng (tán bát giác, màu instance) — ~44 tam giác
function modelParasol() {
  const P = [];
  P.push(finish(cyl(0.025, 0.03, 2.3, 5, 0, 1.15, 0), 0xd8d8d0));
  P.push(finish(new THREE.ConeGeometry(1.25, 0.42, 8, 1, true).translate(0, 2.3, 0), 0xffffff, 1));
  P.push(finish(new THREE.ConeGeometry(1.25, 0.06, 8, 1, true).rotateX(Math.PI).translate(0, 2.06, 0), 0xffffff, 0.7));
  return mergeParts(P);
}
// XE ĐẨY bán hàng: thùng + tủ kính + 2 bánh + mái che (màu instance) — ~150 tam giác
function modelCart() {
  const P = [];
  P.push(finish(box(0.75, 0.55, 1.2, 0, 0.6, 0), 0xb8b2a2));
  P.push(finish(box(0.7, 0.42, 0.9, 0, 1.08, 0.1), [0x9fb6c0, 0x9fb6c0, 0xdde4e6, 0x9fb6c0, 0x9fb6c0, 0x9fb6c0]));
  for (const s of [-1, 1]) P.push(finish(cyl(0.24, 0.24, 0.07, 10, s * 0.42, 0.24, -0.2, 'x'), C.tyre));
  P.push(finish(box(0.05, 0.05, 0.6, 0, 0.88, -0.85), C.steel));
  for (const [x, z] of [[0.33, 0.55], [-0.33, 0.55], [0.33, -0.55], [-0.33, -0.55]]) P.push(finish(cyl(0.015, 0.015, 1.1, 4, x, 1.6, z), C.steel));
  P.push(finish(box(1.0, 0.06, 1.45, 0, 2.15, 0), 0xffffff, 1));
  return mergeParts(P);
}
// THÙNG RÁC 240 L có nắp (màu instance xanh/cam/vàng) — ~40 tam giác
function modelBin() {
  const P = [];
  P.push(finish(taper(0.52, 0.6, 0.58, 0.72, 0.95, 0, 0, 0), 0xffffff, 1));
  P.push(finish(box(0.62, 0.06, 0.78, 0, 0.98, 0.02), 0xffffff, 0.8));
  for (const s of [-1, 1]) P.push(finish(cyl(0.09, 0.09, 0.06, 8, s * 0.26, 0.09, -0.3, 'x'), C.tyre));
  return mergeParts(P);
}
// TRỤ CỨU HOẢ đỏ — ~50 tam giác
function modelHydrant() {
  const P = [];
  P.push(finish(cyl(0.11, 0.13, 0.75, 8, 0, 0.375, 0), 0xc0261d));
  P.push(finish(new THREE.SphereGeometry(0.12, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.75, 0), 0xc0261d));
  P.push(finish(cyl(0.05, 0.05, 0.36, 6, 0, 0.5, 0, 'x'), 0xd6d0c4));
  return mergeParts(P);
}
// TỦ ĐIỆN / tủ cáp vỉa hè — 12 tam giác
function modelCabinet() { return mergeParts([finish(box(0.85, 1.35, 0.5, 0, 0.675, 0), 0xffffff, 1)]); }
// BIỂN ĐỨNG chữ A (2 mặt, texture atlas chữ chung chung — KHÔNG tên thương hiệu)
const AFRAME_WORDS = [['CÀ PHÊ', 'GIẢI KHÁT'], ['PHỞ BÒ', 'BÚN CÁ'], ['CƠM', 'VĂN PHÒNG'], ['SỬA XE', 'VÁ SĂM'], ['GỘI ĐẦU', 'CẮT TÓC'], ['TRÀ ĐÁ', 'NƯỚC MÍA'], ['BÁNH MÌ', 'XÔI'], ['SIM THẺ', 'PHOTO']];
const AFRAME_BG = ['#c62828', '#1565c0', '#f9a825', '#2e7d32', '#ffffff', '#e65100', '#6a1b9a', '#00838f'];
function aframeTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 384;
  const g = cv.getContext('2d');
  for (let k = 0; k < 8; k++) {
    const x0 = (k % 4) * 128, y0 = ((k / 4) | 0) * 192, bg = AFRAME_BG[k];
    g.fillStyle = '#2a2a2a'; g.fillRect(x0, y0, 128, 192);
    g.fillStyle = bg; g.fillRect(x0 + 6, y0 + 6, 116, 180);
    const fg = bg === '#ffffff' || bg === '#f9a825' ? '#b71c1c' : '#ffffff';
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 25px Arial, sans-serif'; g.fillText(AFRAME_WORDS[k][0], x0 + 64, y0 + 62);
    g.font = 'bold 19px Arial, sans-serif'; g.fillText(AFRAME_WORDS[k][1], x0 + 64, y0 + 112);
    g.fillRect(x0 + 24, y0 + 140, 80, 4);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function modelAFrame() {
  const parts = [];
  for (const s of [-1, 1]) {
    const g = new THREE.PlaneGeometry(0.56, 0.86);
    if (s < 0) g.rotateY(Math.PI);
    g.rotateX(s * -0.2); g.translate(0, 0.42, s * 0.09);
    parts.push(g);
  }
  const m = mergeGeometries(parts); parts.forEach((p) => p.dispose());
  return m;
}

// ---------- NGƯỜI (cao ~1.65 m; aLimb 1/2 chân trái/phải, 3/4 tay trái/phải) ----------
// màu: áo = instance (aPaint 1), quần = bảng A (2), da = bảng B (3), tóc cố định, nón lá = phụ kiện cổng 1
function personParts(P, sit) {
  const LIMB = (g, col, paint, limb) => P.push(finish(g, col, paint, limb));
  if (!sit) {
    for (const [s, limb] of [[1, 1], [-1, 2]]) {
      LIMB(taper(0.13, 0.15, 0.16, 0.17, 0.46, s * 0.1, 0.44, 0), 0xffffff, 2, limb);              // đùi
      LIMB(taper(0.1, 0.12, 0.13, 0.14, 0.42, s * 0.1, 0.04, 0), 0xffffff, 2, limb);               // cẳng
      LIMB(box(0.11, 0.06, 0.24, s * 0.1, 0.03, 0.04), 0x2a2622, 0, limb);                          // giày dép
    }
    LIMB(box(0.33, 0.16, 0.2, 0, 0.94, 0), 0xffffff, 2, 0);                                         // hông
  } else {
    // ngồi ghế nhựa thấp (mặt ghế ~0.27 m): đùi nằm ngang về +Z, cẳng chân dựng
    for (const s of [1, -1]) {
      P.push(finish(box(0.15, 0.15, 0.44, s * 0.1, 0.38, 0.2), 0xffffff, 2, 0));
      P.push(finish(taper(0.11, 0.12, 0.13, 0.14, 0.32, s * 0.11, 0.02, 0.42), 0xffffff, 2, 0));
      P.push(finish(box(0.11, 0.06, 0.22, s * 0.11, 0.03, 0.47), 0x2a2622, 0, 0));
    }
    P.push(finish(box(0.33, 0.16, 0.24, 0, 0.36, 0), 0xffffff, 2, 0));
  }
  const y0 = sit ? 0.44 : 1.0, lean = sit ? 0.12 : 0;
  // thân trên (thuôn: hông 0.32 → vai 0.4)
  const torso = taper(0.31, 0.2, 0.4, 0.22, 0.52, 0, y0, 0); if (lean) { torso.translate(0, -y0, 0); torso.rotateX(lean); torso.translate(0, y0, 0); }
  P.push(finish(torso, 0xffffff, 1, 0));
  const sy = y0 + 0.48, hz = lean * 0.5;
  for (const [s, limb] of [[1, 3], [-1, 4]]) {
    if (!sit) {
      LIMB(taper(0.09, 0.1, 0.1, 0.11, 0.3, s * 0.245, sy - 0.32, 0), 0xffffff, 1, limb);          // cánh tay (áo)
      LIMB(taper(0.07, 0.08, 0.085, 0.09, 0.27, s * 0.25, sy - 0.6, 0), 0xffffff, 3, limb);        // cẳng tay (da)
    } else {
      P.push(finish(beam([s * 0.24, sy - 0.05, hz], [s * 0.2, sy - 0.32, 0.22], 0.1, 0.1), 0xffffff, 1, 0));
      P.push(finish(beam([s * 0.2, sy - 0.32, 0.22], [s * 0.14, sy - 0.44, 0.42], 0.08, 0.08), 0xffffff, 3, 0));
    }
  }
  P.push(finish(box(0.09, 0.08, 0.09, 0, sy + 0.06, hz), 0xffffff, 3, 0));                         // cổ
  P.push(finish(new THREE.SphereGeometry(0.105, 8, 6).scale(0.92, 1.08, 1).translate(0, sy + 0.2, hz), 0xffffff, 3, 0)); // đầu
  P.push(finish(new THREE.SphereGeometry(0.112, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, sy + 0.215, hz - 0.012), 0x161412, 0, 0)); // tóc
  P.push(finish(new THREE.ConeGeometry(0.25, 0.17, 10, 1, true).translate(0, sy + 0.36, hz), 0xd8c48a, 4, 0)); // nón lá (cổng 1)
}
function modelPerson(sit) { const P = []; personParts(P, sit); return mergeParts(P); }

// =====================================================================================================================
// 4. CHỈ MỤC KHÔNG GIAN: đoạn đường, bằng chứng pano, vật cản nhỏ
// =====================================================================================================================
function makeRoadIndex(ROADS_DT, HW, SW) {
  const CELL = 32, map = new Map();
  const segs = [];   // [ax,az,bx,bz,hw,sw,ri,si]
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const r = ROADS_DT[ri], hw = HW[r.c] ?? 1.5, sw = SW[r.c] ?? 0;
    for (let si = 0; si < r.pts.length - 1; si++) {
      const [ax, az] = r.pts[si], [bx, bz] = r.pts[si + 1];
      const id = segs.length; segs.push([ax, az, bx, bz, hw, sw, ri, si]);
      const m = hw + sw + 4;
      for (let i = Math.floor((Math.min(ax, bx) - m) / CELL); i <= Math.floor((Math.max(ax, bx) + m) / CELL); i++)
        for (let j = Math.floor((Math.min(az, bz) - m) / CELL); j <= Math.floor((Math.max(az, bz) + m) / CELL); j++) {
          const k = key(i, j); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(id);
        }
    }
  }
  const segD = (px, pz, s) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
    let t = l2 ? ((px - s[0]) * dx + (pz - s[1]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (s[0] + dx * t), pz - (s[1] + dz * t));
  };
  // true nếu (x,z) nằm trong LÒNG/VỈA HÈ của đường KHÁC (miệng giao lộ, ngõ) hoặc trong lòng chính đường ri ở đoạn
  // khác (góc trong khúc cua). extra: lề thêm quanh đường khác (ô tô đỗ cần cách góc phố xa hơn).
  function blocked(x, z, ri, si, extra = 0.6, sameRoad = true) {
    const a = map.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!a) return false;
    for (const id of a) {
      const s = segs[id];
      if (s[6] === ri) {
        if (s[7] === si || !sameRoad) continue;
        if (segD(x, z, s) < s[4] + 0.25) return true;
      } else if (segD(x, z, s) < s[4] + s[5] + extra) return true;
    }
    return false;
  }
  // khoảng cách tới lòng đường gần nhất (mép nhựa); âm = đang ở trong lòng
  function carriageGap(x, z) {
    const a = map.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!a) return 99;
    let best = 99;
    for (const id of a) { const s = segs[id]; const d = segD(x, z, s) - s[4]; if (d < best) best = d; }
    return best;
  }
  return { blocked, carriageGap, segs };
}
// MẶT ĐI ĐƯỢC của bộ dựng đường CŨ (world.js layRoad, dot3 trước WP6 roadnet) — để prop đứng ĐÚNG mặt đang vẽ, không
// lơ lửng (phản biện WP7: hằng LAND_H+SIDEWALK_TOP = +0,25 m nổi +0,07 trên vỉa p/s/t và +0,24 trên phố r):
//   lòng nhựa: hộp 0,14 m tâm h+0,04 → đỉnh h+0,11 (= ROAD_TOP) · vạch giữa h+0,155 (bỏ qua, prop không đứng trên vạch)
//   vỉa hè: CHỈ phố p/s/t, hộp 0,24 m tâm h+0,06 → đỉnh h+0,18, phủ [hw, hw + 0,28·w] (KHÔNG theo SIDEWALK_W — WP1 đã
//   nới SIDEWALK_W nhưng layRoad vẫn vẽ 0,28·w) · phố r/w/h không vỉa → lưới nền local h+0,012
//   h = max(groundHeightNoDeck, LAND_H) như layRoad. Mặt cao nhất thắng (vỉa đè lên lòng ở miệng giao lộ = mặt đang vẽ).
// Khi WP6 (js/roadnet.js) đã gộp: world.js truyền LAND_H + roadNet.surfaceAt thay cho hàm này (xem lời gọi buildProps).
export function layRoadSurfaceY(ROADS_DT, groundHeightNoDeck, LAND_H) {
  const W = { p: 13, s: 10, t: 8, r: 5.5, w: 3.5, h: 3 };   // = ROAD_W của world.js (bề rộng hộp lòng layRoad)
  const CELL = 32, map = new Map(), segs = [];
  const key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  for (const r of ROADS_DT) {
    const w = W[r.c] ?? 5.5, hw = w / 2, sw = (r.c === 'p' || r.c === 's' || r.c === 't') ? w * 0.28 : 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
      const id = segs.length; segs.push([ax, az, bx, bz, hw, sw]);
      const m = hw + sw + 1;
      for (let a = Math.floor((Math.min(ax, bx) - m) / CELL); a <= Math.floor((Math.max(ax, bx) + m) / CELL); a++)
        for (let b = Math.floor((Math.min(az, bz) - m) / CELL); b <= Math.floor((Math.max(az, bz) + m) / CELL); b++) {
          const k = key(a, b); let l = map.get(k); if (!l) map.set(k, (l = [])); l.push(id);
        }
    }
  }
  return (x, z) => {
    const h = Math.max(groundHeightNoDeck(x, z), LAND_H);
    const l = map.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let top = 0.012;
    if (l) for (const id of l) {
      const s = segs[id];
      const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
      let t = l2 ? ((x - s[0]) * dx + (z - s[1]) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (s[0] + dx * t), z - (s[1] + dz * t));
      if (d <= s[4]) { if (top < 0.11) top = 0.11; } else if (d <= s[4] + s[5]) { top = 0.18; break; }
    }
    return h + top;
  };
}
function makeEvidence() {
  const CELL = 60, map = new Map(), key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  for (const r of PROPS_EVIDENCE) { const k = key(Math.floor(r[0] / CELL), Math.floor(r[1] / CELL)); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(r); }
  return (x, z, R = 60) => {
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL); let best = null, bd = R * R;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const a = map.get(key(i, j)); if (!a) continue;
      for (const r of a) { const d = (r[0] - x) ** 2 + (r[1] - z) ** 2; if (d < bd) { bd = d; best = r; } }
    }
    return best;
  };
}
function makeCircleGrid(cell = 8) {
  const map = new Map(), key = (i, j) => (i + 8192) * 16384 + (j + 8192);
  return {
    add(x, z, r) {
      for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
        for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
          const k = key(i, j); let a = map.get(k); if (!a) map.set(k, (a = [])); a.push(x, z, r);
        }
    },
    hit(x, z, pad = 0) {
      const a = map.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (!a) return false;
      for (let i = 0; i < a.length; i += 3) { const r = a[i + 2] + pad; if ((a[i] - x) ** 2 + (a[i + 1] - z) ** 2 < r * r) return true; }
      return false;
    },
  };
}

// =====================================================================================================================
// 5. BỘ CULL RIÊNG: vành khuyên [rMin, rMax] quanh camera + bỏ instance SAU LƯNG camera (xa > 30 m), nén MỌI attribute
//    instanced (ma trận, màu, aWalk…). Nhịp 0,3 s theo đồng hồ thật; camera xoay > 25° hoặc dời > 20 m → cập nhật ngay.
// =====================================================================================================================
const CULL = [];
function cullRegister(mesh, rMin, rMax, keepBehind = 30) {
  mesh.userData.noCull = true;            // instcull.js bỏ qua (nó chỉ nén instanceMatrix/instanceColor)
  const n = mesh.count;
  const attrs = [{ a: mesh.instanceMatrix, size: 16 }];
  if (mesh.instanceColor) attrs.push({ a: mesh.instanceColor, size: 3 });
  for (const k in mesh.geometry.attributes) { const a = mesh.geometry.attributes[k]; if (a.isInstancedBufferAttribute) attrs.push({ a, size: a.itemSize }); }
  for (const t of attrs) t.src = new Float32Array(t.a.array);
  const px = new Float32Array(n), pz = new Float32Array(n), src = attrs[0].src;
  // bán kính bao của model sau scale lớn nhất (vũng sáng scale 12) + tâm cầu lệch gốc → cầu bao rẻ cho cullUpdate
  let sMax = 1, yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * 16; px[i] = src[o + 12]; pz[i] = src[o + 14];
    const y = src[o + 13]; if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    const s2 = Math.max(src[o] ** 2 + src[o + 1] ** 2 + src[o + 2] ** 2, src[o + 4] ** 2 + src[o + 5] ** 2 + src[o + 6] ** 2, src[o + 8] ** 2 + src[o + 9] ** 2 + src[o + 10] ** 2);
    if (s2 > sMax * sMax) sMax = Math.sqrt(s2);
  }
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const gs = mesh.geometry.boundingSphere, gR = sMax * (gs.center.length() + gs.radius);
  CULL.push({ mesh, attrs, px, pz, n, r0: rMin * rMin, r1: rMax * rMax, kb: keepBehind * keepBehind, last: -1, idx: new Int32Array(n).fill(-1), hidden: false, gR, yC: (yMin + yMax) / 2, yH: (yMax - yMin) / 2 });
}
const _fw = new THREE.Vector3();
let _cullAt = -1e9, _cx = 1e9, _cz = 1e9, _fx = 0, _fz = 1;
function cullUpdate(camera, force = false) {
  const now = performance.now();
  camera.getWorldDirection(_fw);
  let fl = Math.hypot(_fw.x, _fw.z); const fx = fl > 1e-3 ? _fw.x / fl : _fx, fz = fl > 1e-3 ? _fw.z / fl : _fz;
  const cx = camera.position.x, cz = camera.position.z;
  const turned = fx * _fx + fz * _fz < 0.9, moved = (cx - _cx) ** 2 + (cz - _cz) ** 2 > 400;
  // nhìn từ trên cao (aerial / camera chúc xuống) → không bỏ nửa sau
  const topDown = camera.isOrthographicCamera || _fw.y < -0.8;
  if (!force && !turned && !moved && now - _cullAt < 300) return false;
  _cullAt = now; _cx = cx; _cz = cz; _fx = fx; _fz = fz;
  for (const t of CULL) {
    const { mesh, attrs, px, pz, n, r0, r1, kb, idx } = t;
    let k = 0, lo = -1, hi = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - cx, dz = pz[i] - cz, d2 = dx * dx + dz * dz;
      if (d2 > r1 || d2 < r0) continue;
      // sau lưng camera (góc > ~100°) và đủ xa → bỏ (camera xoay nhanh → cập nhật ngay ở khung kế)
      if (!topDown && d2 > kb && dx * fx + dz * fz < -0.18 * Math.sqrt(d2)) continue;
      const X = px[i], Z = pz[i];
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
      if (idx[k] !== i) {
        idx[k] = i; if (lo < 0) lo = k; hi = k + 1;
        // chép thủ công (subarray() cấp phát 1 view/instance/attribute → hàng chục nghìn object rác mỗi lượt)
        for (let a = 0; a < attrs.length; a++) {
          const at = attrs[a], s = at.size, dst = at.a.array, src = at.src;
          for (let j = 0, o = k * s, p = i * s; j < s; j++) dst[o + j] = src[p + j];
        }
      }
      k++;
    }
    if (lo >= 0 || k !== t.last) {
      mesh.count = k; t.last = k;
      // chỉ tải lên GPU đoạn ô [lo, hi) vừa đổi (phản biện: needsUpdate trơn tải lại TOÀN bộ ~1 MB của 15,9k xe xa mỗi
      // lần cull đổi). Ô ngoài đoạn giữ nguyên dữ liệu đã tải; chỉ giảm count thì không cần tải gì.
      if (lo >= 0) for (const at of attrs) { at.a.clearUpdateRanges(); at.a.addUpdateRange(lo * at.size, (hi - lo) * at.size); at.a.needsUpdate = true; }
      if (k > 0) {
        // cầu bao: tâm hộp toạ độ instance đã giữ, bán kính = xa nhất từ tâm (O(k) phép cộng/so sánh, không sqrt
        // từng instance) + bán kính model×scale — thay computeBoundingSphere (O(k) phép nhân ma trận + hợp cầu)
        if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
        const bs = mesh.boundingSphere, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        let r2 = 0;
        for (let j = 0; j < k; j++) { const q = idx[j], dx = px[q] - mx, dz = pz[q] - mz, d2 = dx * dx + dz * dz; if (d2 > r2) r2 = d2; }
        bs.center.set(mx, t.yC, mz);
        bs.radius = Math.sqrt(r2 + t.yH * t.yH) + t.gR;
        if (t.hidden) { t.hidden = false; mesh.visible = true; }
      }
      else if (!t.hidden) { t.hidden = true; mesh.visible = false; }
    }
  }
  return true;
}

// =====================================================================================================================
// 6. buildProps
// =====================================================================================================================
// ctx: {
//   scene, LAND_H, ROADS_DT, groundHeightNoDeck, isWater, lakeSD,
//   sharedMats            — lampGlow (daynight điều khiển emissiveIntensity = đêm·1,6)
//   addCollider(x,z,r), colliders (mảng {x,z,r} đã có: cây/cột/… r ≤ 1 m dùng làm vật cản cho xe máy/cột)
//   updaters              — đẩy hàm (dt,time) cập nhật uPropTime
//   featuredClear         — FEATURED_CLEAR [[x,z,r],…] (lưới hoá 1 lần)
//   avoid(x,z)            — vùng cấm cứng (clearedZone, inSuperblock, …)
//   openSpace(x,z)        — không gian mở (công viên/quảng trường/kè): KHÔNG xe máy/đồ quán, VẪN cột điện/đèn/ô tô
//   gardens, square, lakeSD — vùng đèn gang cổ điển
//   footprints            — tuỳ chọn {D, grid} (buildings_data.decodeRB + makeFootprintGrid, đã đánh D.dead) để né nhà THẬT
//   nearPanoCam(x,z,r)    — né điểm camera pano
//   reserved              — [[x,z,r],…] cột đã có (băng rôn) để xe máy né
//   keepClear             — [[x,z,r],…] giữ trống đồ vỉa hè + ô tô (điểm hồi sinh)
//   surfaceY(x,z)         — tuỳ chọn: cao độ TUYỆT ĐỐI mặt đang vẽ (vỉa hè/nền/lòng) để chân prop chạm đất; thiếu →
//                           hằng LAND_H + SIDEWALK_TOP (đúng với vỉa hè WP6 roadnet). dot3 cũ: layRoadSurfaceY(...)
// }
export function buildProps(ctx) {
  const T0 = performance.now();
  const { scene, LAND_H, ROADS_DT, groundHeightNoDeck, isWater, lakeSD } = ctx;
  const R_MAX = ctx.radius || 1600;
  const BUDGET = {
    bikes: LITE ? 5000 : 16000, cars: LITE ? 1400 : 3600, peds: LITE ? 450 : 1100,
  };
  const stats = { cells: 0, valid: 0 };
  const rej = { far: 0, junction: 0, notFlat: 0, featured: 0, building: 0, lake: 0 };
  stats.reject = rej;
  const roadIdx = makeRoadIndex(ROADS_DT, ROAD_HW, SIDEWALK_W);
  const evAt = makeEvidence();
  // FEATURED_CLEAR → lưới (1.687 vòng tròn quét tuyến tính từng là điểm nóng). Vòng FC là vùng cấm NHÀ infill (bán kính
  // = khối nhà + lề rộng, phủ cả vỉa hè trước mặt) → với đồ vỉa hè chỉ lấy LÕI 60% bán kính (đo: dùng nguyên vòng
  // loại 7.749/48k ô mặt phố — cả dãy vỉa hè trước công trình dựng tay mất xe máy).
  const fcGrid = makeCircleGrid(16);
  for (const f of ctx.featuredClear || []) fcGrid.add(f[0], f[1], f[2] * 0.6);
  // vùng giữ chỗ (claims.js: địa danh/khuôn viên/ô dựng tay giữ lại — WP2/WP3 đăng ký) → không đặt đồ vỉa hè bên trong
  const CLAIM_KINDS = ['landmark', 'civic', 'cell', 'plaza', 'park', 'water'];
  // vật cản nhỏ đã có (thân cây, cột, trụ …) — để cột điện/xe máy không đè lên
  const obst = makeCircleGrid(8);
  for (const c of ctx.colliders || []) if (c.r <= 1.0) obst.add(c.x, c.z, c.r);
  for (const r of ctx.reserved || []) obst.add(r[0], r[1], r[2]);
  // footprint nhà THẬT (RB01): ưu tiên bản WP2 truyền vào (đã đánh D.dead theo claims); không có → tự giải mã (~12 ms)
  let fp = ctx.footprints || null;
  if (!fp && ctx.useRealFootprints !== false) { const D = decodeRB(RB_B64); fp = { D, grid: makeFootprintGrid(D) }; }
  const inBuilding = fp ? (x, z) => fp.grid.at(x, z) >= 0 : () => false;
  const flat = (x, z) => Math.abs(groundHeightNoDeck(x, z) - LAND_H) < 0.35 && !isWater(x, z);
  const panoNear = ctx.nearPanoCam || (() => false);
  const openSpace = ctx.openSpace || (() => false);
  const avoid = ctx.avoid || (() => false);
  // vùng giữ trống cho đồ vỉa hè + ô tô (điểm hồi sinh người chơi: khung hình đầu tiên không bị xe đỗ che) — [[x,z,r],…]
  const keepClear = ctx.keepClear || [];
  const clearAt = (x, z) => { for (const c of keepClear) if ((x - c[0]) ** 2 + (z - c[1]) ** 2 < c[2] * c[2]) return true; return false; };
  const yWalk = LAND_H + SIDEWALK_TOP, yRoad = LAND_H + ROAD_TOP;
  // cao độ chân prop vỉa hè: theo MẶT ĐANG VẼ (ctx.surfaceY) — gán it.y cho từng instance (cột: ngay sau 6.2 vì dây điện
  // neo theo đỉnh cột; còn lại: lượt cuối trước 6.8). Ô tô giữ yRoad (lòng nhựa); phố r: nghiêng theo mặt phía lề.
  const surfY = typeof ctx.surfaceY === 'function' ? ctx.surfaceY : null;
  const yAt = surfY ? (x, z) => surfY(x, z) : () => yWalk;
  const groundAll = (lists) => { for (const L of lists) for (const it of L) if (typeof it.y !== 'number') it.y = yAt(it.x, it.z); };

  // ---------------------------------------------------------------------------------------------------------------
  // 6.1 LẤY MẪU MẶT PHỐ: mỗi (đường, đoạn, bên) → các Ô 3 m dọc vỉa hè, có cờ hợp lệ + mức bằng chứng
  // ---------------------------------------------------------------------------------------------------------------
  const CELL = 3;
  const sides = [];   // {ri, si, c, side, ax, az, ux, uz, nx, nz, L, n, ok:Uint8Array, occ:Uint8Array, ev:[]}
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const r = ROADS_DT[ri];
    if (r.c !== 'p' && r.c !== 's' && r.c !== 't' && r.c !== 'r') continue;
    const pk = parkingLine(r.c);
    for (let si = 0; si < r.pts.length - 1; si++) {
      const [ax, az] = r.pts[si], [bx, bz] = r.pts[si + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 4) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (Math.hypot(mx, mz) - L / 2 > R_MAX) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      const n = Math.floor(L / CELL);
      for (const side of [1, -1]) {
        // pháp tuyến hướng RA vỉa hè bên này: side·(uz, −ux)
        const nx = side * uz, nz = -side * ux;
        // rj[k]: lý do loại ô (QA qua window.__hpProps.sides): 1 xa · 2 giao lộ · 3 dốc/nước · 4 công trình/claim · 5 nhà thật · 6 kè hồ
        const S = { ri, si, c: r.c, side, ax, az, ux, uz, nx, nz, L, n, ok: new Uint8Array(n), occ: new Uint8Array(n), rj: new Uint8Array(n), ev: new Array(n) };
        const off = (L - n * CELL) / 2;
        for (let k = 0; k < n; k++) {
          const s = off + (k + 0.5) * CELL;
          const x = ax + ux * s + nx * pk, z = az + uz * s + nz * pk;
          stats.cells++;
          if (x * x + z * z > R_MAX * R_MAX) { rej.far++; S.rj[k] = 1; continue; }
          if (roadIdx.blocked(x, z, ri, si) || onCarriage(x, z)) { rej.junction++; S.rj[k] = 2; continue; }   // W2-A: + nhựa khe đường đôi/nút giao
          if (!flat(x, z)) { rej.notFlat++; S.rj[k] = 3; continue; }
          if (fcGrid.hit(x, z) || avoid(x, z) || clearAt(x, z) || claimAt(x, z, CLAIM_KINDS)) { rej.featured++; S.rj[k] = 4; continue; }
          if (inBuilding(x, z)) { rej.building++; S.rj[k] = 5; continue; }
          if (lakeSD(x, z) < 14) { rej.lake++; S.rj[k] = 6; continue; }   // kè hồ Tam Bạc có đồ riêng (lan can/ghế/đèn đôi)
          S.ok[k] = 1; stats.valid++;
          S.ev[k] = evAt(x, z);
        }
        S.off = off;
        sides.push(S);
      }
    }
  }
  const cellPos = (S, k, lat, along = 0) => {
    const s = S.off + (k + 0.5) * CELL + along;
    return [S.ax + S.ux * s + S.nx * lat, S.az + S.uz * s + S.nz * lat];
  };
  // mức mặc định khi không có pano gần: lõi phố cổ dày hơn ngoại vi
  const defLevel = (x, z) => { const r = Math.hypot(x, z); return r < 700 ? 2 : r < 1150 ? 1 : 1; };
  const OCC_POLE = 1, OCC_SHOP = 2, OCC_BIKE = 4, OCC_PED = 8, OCC_CAR = 16;

  // ---------------------------------------------------------------------------------------------------------------
  // 6.2 CỘT ĐIỆN + ĐÈN: tuyến cột điện 1 bên/đường (bên theo hash), đèn cao áp bên kia (p/s) — dây theo từng nhịp
  // ---------------------------------------------------------------------------------------------------------------
  const poleI = [], poleLampI = [], trafoI = [], cobraI = [], glassI = [], ornI = [], cabI = [], flagI = [];
  const spans = [];   // [poleA, poleB, tangle, side-info]
  const ornateZone = (x, z, e) => {
    if (ctx.square && Math.hypot(x - ctx.square[0], z - ctx.square[1]) < 95) return true;
    for (const g of ctx.gardens || []) if (Math.abs(x - g.x) < g.w / 2 + 22 && Math.abs(z - g.z) < g.d / 2 + 22) return true;
    if (lakeSD(x, z) < 34) return true;
    return !!(e && e[5] === 2);
  };
  // gom đoạn theo đường để đi liên tục dọc tuyến (khoảng cách cột tính theo chiều dài cung)
  const byRoad = new Map();
  for (const S of sides) { const k = S.ri * 2 + (S.side > 0 ? 1 : 0); let a = byRoad.get(k); if (!a) byRoad.set(k, (a = [])); a.push(S); }
  for (const a of byRoad.values()) a.sort((p, q) => p.si - q.si);
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const r = ROADS_DT[ri]; if (r.c !== 'p' && r.c !== 's' && r.c !== 't' && r.c !== 'r') continue;
    const p0 = r.pts[0];
    const hs = hash3(p0[0], p0[1], 11);
    const powerSide = hs < 0.5 ? 1 : -1;
    const fl = furnitureLine(r.c);
    // ---- tuyến cột điện ----
    {
      const list = byRoad.get(ri * 2 + (powerSide > 0 ? 1 : 0)) || [];
      let acc = 6 + hash3(p0[0], p0[1], 12) * 20, prev = null, prevSeg = -9;
      for (const S of list) {
        if (S.si !== prevSeg + 1) prev = null;
        prevSeg = S.si;
        for (; acc < S.L; acc += 31 + hash3(S.ax + acc, S.az, 13) * 9) {
          const k = Math.min(S.n - 1, Math.max(0, Math.floor((acc - S.off) / CELL)));
          let x = S.ax + S.ux * acc + S.nx * fl, z = S.az + S.uz * acc + S.nz * fl;
          let ok = S.n > 0 && x * x + z * z < R_MAX * R_MAX && !roadIdx.blocked(x, z, ri, S.si, 0.3) && flat(x, z) && !panoNear(x, z, 3) && !avoid(x, z) && !inBuilding(x, z);
          if (ok && obst.hit(x, z, 0.35)) {           // né thân cây/trụ có sẵn: dịch dọc ±1,5 m
            ok = false;
            for (const dd of [1.5, -1.5, 3, -3]) { const x2 = x + S.ux * dd, z2 = z + S.uz * dd; if (!obst.hit(x2, z2, 0.35)) { x = x2; z = z2; ok = true; break; } }
          }
          if (ok && !clearDisc(x, z, 0.3)) ok = false;   // W2-A: chân cột trên nhựa (khe đường đôi/nút giao) hoặc < 3,3 m camera pano
          const e = ok ? evAt(x, z) : null;
          if (ok && e && e[4] === 0) ok = false;                         // pano nói không có cột điện
          if (ok && !e && r.c === 'p' && hash3(x, z, 14) < 0.5) ok = false; // đại lộ: phần lớn đã hạ ngầm
          if (!ok) { prev = null; continue; }
          const heading = headX(-S.nx, -S.nz);           // local +X → lòng đường (= −n)
          const tangle = e ? e[4] : (Math.hypot(x, z) < 900 ? 2 : 1);
          const hT = hash3(x, z, 15);
          let kind = 0;
          if (hT < 0.07 || (e && (e[6] & 16) && hT < 0.16)) kind = 2;      // trạm biến áp treo
          else if ((r.c === 't' || r.c === 'r') && hash3(x, z, 16) < 0.5) kind = 1;   // đèn trên cột điện
          const P = { x, z, heading, kind, tangle, S, c: r.c };
          (kind === 2 ? trafoI : kind === 1 ? poleLampI : poleI).push(P);
          if (kind === 1) glassI.push({ x, z, heading, rx: -S.nx, rz: -S.nz, reach: POLE_LAMP_ARM.reach });
          ctx.addCollider(x, z, kind === 2 ? 0.45 : 0.22);
          obst.add(x, z, kind === 2 ? 1.2 : 0.3);
          if (kind === 2 && hash3(x, z, 17) < 0.5) {
            const cx2 = x - S.nx * 0.9 + S.ux * 1.6, cz2 = z - S.nz * 0.9 + S.uz * 1.6;
            if (!inBuilding(cx2, cz2)) { cabI.push({ x: cx2, z: cz2, heading, col: 0xcfcab9 }); obst.add(cx2, cz2, 0.6); }
          }
          if (prev && Math.hypot(prev.x - x, prev.z - z) < 52) spans.push([prev, P]);
          prev = P;
          if (S.n) S.occ[k] |= OCC_POLE;
        }
        acc -= S.L;
      }
    }
    // ---- đèn cao áp thép (p/s/t), đèn gang ở vùng vườn hoa/hồ/quảng trường ----
    if (r.c === 'p' || r.c === 's' || r.c === 't') {
      const lampSides = r.c === 'p' ? [1, -1] : [-powerSide];
      for (const side of lampSides) {
        const list = byRoad.get(ri * 2 + (side > 0 ? 1 : 0)) || [];
        let acc = 10 + hash3(p0[0], p0[1], 21 + side) * 22 + (side < 0 && r.c === 'p' ? 17 : 0);
        for (const S of list) {
          const step = r.c === 't' ? 36 : 33;
          for (; acc < S.L; acc += step) {
            const x0 = S.ax + S.ux * acc, z0 = S.az + S.uz * acc;
            let x = x0 + S.nx * fl, z = z0 + S.nz * fl;
            if (x * x + z * z > R_MAX * R_MAX) continue;
            if (roadIdx.blocked(x, z, ri, S.si, 0.3) || !flat(x, z) || panoNear(x, z, 3) || avoid(x, z) || inBuilding(x, z)) continue;
            if (lakeSD(x, z) < 22) continue;          // kè hồ: đèn đôi riêng của promenade
            const e = evAt(x, z);
            const orn = ornateZone(x, z, e);
            if (!orn && e && !(e[5] & 1) && r.c === 't' && hash3(x, z, 22) < 0.5) continue; // phố t không thấy đèn → thưa
            if (obst.hit(x, z, 0.4)) {
              let moved = false;
              for (const dd of [1.6, -1.6, 3.2, -3.2]) { const x2 = x + S.ux * dd, z2 = z + S.uz * dd; if (!obst.hit(x2, z2, 0.4)) { x = x2; z = z2; moved = true; break; } }
              if (!moved) continue;
            }
            if (!clearDisc(x, z, 0.3)) continue;          // W2-A: đèn trên nhựa (khe đường đôi/nút giao) hoặc sát camera pano
            const heading = headX(-S.nx, -S.nz);
            if (orn) {
              ornI.push({ x, z, heading: headZ(S.ux, S.uz) });
              ctx.addCollider(x, z, 0.35); obst.add(x, z, 0.5);
            } else {
              cobraI.push({ x, z, heading, rx: -S.nx, rz: -S.nz, c: r.c });
              glassI.push({ x, z, heading, rx: -S.nx, rz: -S.nz, reach: LAMP_REACH });
              ctx.addCollider(x, z, 0.2); obst.add(x, z, 0.32);
              // cờ đỏ sao vàng treo cột đèn các đại lộ (thay cột cờ rời cũ đứng giữa vỉa hè)
              if (r.c === 'p' && Math.hypot(x, z) < 1300) flagI.push({ x, z, heading: headX(S.ux, S.uz) });
            }
            const k = Math.floor((acc - S.off) / CELL); if (k >= 0 && k < S.n) S.occ[k] |= OCC_POLE;
          }
          acc -= S.L;
        }
      }
    }
  }
  // cột băng rôn / vật cản có sẵn: đánh dấu ô
  const markObstCells = () => {
    for (const S of sides) for (let k = 0; k < S.n; k++) {
      if (!S.ok[k]) continue;
      const [x, z] = cellPos(S, k, parkingLine(S.c));
      if (obst.hit(x, z, 0.3)) S.occ[k] |= OCC_POLE;
    }
  };
  markObstCells();
  // chân cột/đèn/tủ/cờ/kính đèn theo mặt đang vẽ (dây điện bên dưới neo vào đỉnh cột → phải gán TRƯỚC 6.3)
  groundAll([poleI, poleLampI, trafoI, cobraI, ornI, glassI, cabI, flagI]);
  const tPoles = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.3 DÂY ĐIỆN: mỗi nhịp 6-30 sợi võng ngẫu nhiên + dây vào nhà 2 bên + cuộn rối gần cột; 1 LineSegments
  // ---------------------------------------------------------------------------------------------------------------
  // bộ đệm đỉnh tăng dần (Float32Array) — mảng JS 1 triệu số từng tốn ~80 ms + GC
  let cableBuf = new Float32Array(1 << 18), cableN = 0;
  const cableArr = { push(...v) { if (cableN + v.length > cableBuf.length) { const nb = new Float32Array(cableBuf.length * 2); nb.set(cableBuf); cableBuf = nb; } for (let i = 0; i < v.length; i++) cableBuf[cableN++] = v[i]; } };
  const pushLine = (arr, ax, ay, az, bx, by, bz, sag, wob, seed, nSeg) => {
    let px = ax, py = ay, pz = az;
    const ox = (hash3(ax + seed, az, 31) - 0.5) * wob, oz = (hash3(ax, az + seed, 32) - 0.5) * wob;
    for (let i = 1; i <= nSeg; i++) {
      const t = i / nSeg, sgy = 4 * t * (1 - t);
      const x = ax + (bx - ax) * t + ox * sgy, y = ay + (by - ay) * t - sag * sgy, z = az + (bz - az) * t + oz * sgy;
      arr.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
    }
  };
  let nCables = 0;
  for (const [A, B] of spans) {
    const arr = cableArr;
    const hs = hash3(A.x, A.z, 33);
    const yA = A.y, yB = B.y;
    // ngang tuyến (xà nằm ngang, vuông góc tuyến): xà dọc theo local Z của cột = dọc phố → sứ ở ±0.72 dọc phố
    // → 3 dây trung thế đi song song, lệch ngang = trục pháp tuyến
    const nxA = -A.S.nx, nzA = -A.S.nz;
    for (const lat of [-0.5, 0.1, 0.7]) {
      const a = [A.x + nxA * lat, yA + POLE_H - 0.35, A.z + nzA * lat], b = [B.x + nxA * lat, yB + POLE_H - 0.35, B.z + nzA * lat];
      pushLine(arr, a[0], a[1], a[2], b[0], b[1], b[2], 0.35 + hs * 0.25, 0, lat, 6); nCables++;
    }
    // bó dây viễn thông/hạ thế: số sợi theo mức rối
    const tg = Math.max(A.tangle, B.tangle);
    const nB = tg >= 2 ? 12 + ((hs * 19) | 0) : tg === 1 ? 6 + ((hs * 7) | 0) : 4 + ((hs * 4) | 0);
    for (let i = 0; i < nB; i++) {
      const u1 = hash3(A.x + i, A.z, 34), u2 = hash3(B.x, B.z + i, 35), u3 = hash3(A.x + i, B.z, 36);
      const ya = yA + 5.5 + u1 * 1.6, yb = yB + 5.5 + u2 * 1.6;
      const la = (u2 - 0.5) * 0.45, lb = (u1 - 0.5) * 0.45;
      const sag = 0.3 + u3 * u3 * (tg >= 2 ? 1.9 : 1.1);
      pushLine(arr, A.x + nxA * la, ya, A.z + nzA * la, B.x + nxA * lb, yb, B.z + nzA * lb, sag, tg >= 2 ? 0.45 : 0.2, i, 8); nCables++;
    }
  }
  // dây vào nhà (2 bên phố) + cuộn rối quanh cột
  for (const P of [...poleI, ...poleLampI, ...trafoI]) {
    const arr = cableArr;
    const S = P.S, nxA = -S.nx, nzA = -S.nz, y0 = P.y;
    const nDrop = P.tangle >= 2 ? 4 + ((hash3(P.x, P.z, 41) * 5) | 0) : 1 + ((hash3(P.x, P.z, 41) * 3) | 0);
    const fl = facadeLine(P.c), fl0 = furnitureLine(P.c);
    for (let i = 0; i < nDrop; i++) {
      const u1 = hash3(P.x + i, P.z, 42), u2 = hash3(P.x, P.z + i, 43), u3 = hash3(P.x + i, P.z + i, 44);
      const along = (u1 - 0.5) * 22;
      const cross = u2 < 0.35;   // sang nhà bên kia phố
      const lat = cross ? -(fl + fl0) : (fl - fl0) - 0.1;   // từ cột → mặt tiền (theo −n là lòng đường)
      const tx = P.x + S.ux * along - nxA * lat, tz = P.z + S.uz * along - nzA * lat;
      const ty = y0 + (cross ? 5.0 : 3.8) + u3 * 1.6;
      pushLine(arr, P.x, y0 + 6.2 + u3 * 0.8, P.z, tx, ty, tz, 0.15 + u3 * 0.4, 0.1, i, 6); nCables++;
    }
    if (P.tangle >= 2) {   // búi dây thõng quanh cột (vòng hở) — đặc trưng ảnh pano
      const nL = 2 + ((hash3(P.x, P.z, 45) * 3) | 0);
      for (let i = 0; i < nL; i++) {
        const ang0 = hash3(P.x + i, P.z, 46) * 6.28, rr = 0.25 + hash3(P.x, P.z + i, 47) * 0.35, yc = y0 + 5.2 + i * 0.35;
        let pxx = P.x + Math.cos(ang0) * rr, pyy = yc, pzz = P.z + Math.sin(ang0) * rr;
        for (let j = 1; j <= 8; j++) {
          const a = ang0 + j / 8 * 5.6, x = P.x + Math.cos(a) * rr, z = P.z + Math.sin(a) * rr, y = yc - Math.sin(j / 8 * Math.PI) * 0.5;
          arr.push(pxx, pyy, pzz, x, y, z); pxx = x; pyy = y; pzz = z;
        }
      }
    }
  }
  // 1 draw call cho cả thành phố: GPU xử lý ~0,3 M đỉnh đường thẳng (rẻ), shader bỏ đoạn xa > uFar (dây < 0,1 px)
  const cableMat = cableMaterial();
  cableMat.uniforms.uFar.value = LITE ? 280 : 520;
  const cableMeshes = [];
  if (cableN) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cableBuf.slice(0, cableN), 3));
    g.computeBoundingSphere();
    const ls = new THREE.LineSegments(g, cableMat);
    ls.name = 'props_cables';
    ls.renderOrder = 2; ls.frustumCulled = false;
    // không nhận raycast: LineSegments phủ cả thành phố + ngưỡng 1 m mặc định từng chặn MỌI __hp.pick (phản biện WP7)
    ls.raycast = () => {};
    scene.add(ls); cableMeshes.push(ls);
  }
  const cableVerts = cableN / 3; cableBuf = null;
  const tCables = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.4 QUÁN VỈA HÈ / XE ĐẨY / BIỂN ĐỨNG / THÙNG RÁC / TRỤ CỨU HOẢ (neo mặt tiền, trước xe máy để xe máy né)
  // ---------------------------------------------------------------------------------------------------------------
  const stoolI = [], paraI = [], cartI = [], aframeI = [], binI = [], hydI = [], sitI = [], standI = [], walkI = [];
  const FOOD = [[95.9, 40.2], [185, 94.5], [33.7, -229.6], [40.5, -340.6], [355.9, -243], [-429.1, 73.9], [461.4, 20.8], [-459.1, 255.3], [591.5, 50.1], [-325.2, 513.1], [-143.5, 601.5], [347.3, 513.3], [-49, -627.1], [650.3, -5.6], [-405, 528.9], [-357.2, -619.9], [-298.5, -704.8], [-400.7, -688.1], [-245.3, -766], [-783.2, 185.2], [724.5, -395.6], [-47.8, 842.8], [-825, -274.3], [-935, -96.6], [656.4, 779.3], [929.7, -442.6], [-50.2, -1080.8], [-427, 943], [-450, 940]];
  // 1) cụm quán đã biết (FOOD, từ pano): ô hợp lệ gần nhất trong 30 m
  for (const [fx, fz] of FOOD) {
    let best = null, bd = 30 * 30;
    for (const S of sides) {
      const mx = S.ax + S.ux * S.L / 2, mz = S.az + S.uz * S.L / 2;
      if (Math.abs(mx - fx) > S.L / 2 + 40 || Math.abs(mz - fz) > S.L / 2 + 40) continue;
      for (let k = 0; k < S.n; k++) {
        if (!S.ok[k]) continue;
        const [x, z] = cellPos(S, k, parkingLine(S.c));
        const d = (x - fx) ** 2 + (z - fz) ** 2; if (d < bd) { bd = d; best = [S, k]; }
      }
    }
    if (best) placeFood(best[0], best[1], 3 + ((hash3(fx, fz, 51) * 3) | 0));
  }
  function placeFood(S, k, nSet) {
    const sw = SIDEWALK_W[S.c], fl = facadeLine(S.c);
    const lat0 = fl - Math.min(1.1, sw * 0.35);
    for (let j = 0; j < nSet; j++) {
      const kk = k + (j % 2 ? 1 : -1) * Math.ceil(j / 2);
      if (kk < 0 || kk >= S.n || !S.ok[kk] || (S.occ[kk] & (OCC_POLE | OCC_SHOP))) continue;
      const u = hash3(S.ax + kk, S.az + j, 52);
      const lat = Math.max(curbLine(S.c) + 0.55, lat0 - u * Math.max(0, sw - 1.6));
      const [x, z] = cellPos(S, kk, lat, (u - 0.5) * 1.4);
      if (inBuilding(x, z) || obst.hit(x, z, 0.55) || !clearDisc(x, z, 1.1)) continue;   // W2-A: bộ bàn ghế + khách ~1,1 m
      const rot = hash3(x, z, 53) * 6.28;
      stoolI.push({ x, z, heading: rot });
      S.occ[kk] |= OCC_SHOP;
      // khách ngồi 1-3 người quanh bàn
      const nSit = 1 + ((hash3(x, z, 54) * 2.6) | 0);
      const seats = [[0.52, 0.05], [-0.5, -0.06], [0.04, 0.55], [-0.05, -0.53]];
      for (let q = 0; q < nSit; q++) {
        const [sx, sz] = seats[(q + ((u * 4) | 0)) % 4];
        const cs = Math.cos(rot), sn = Math.sin(rot);
        const wx = x + sx * cs + sz * sn, wz = z - sx * sn + sz * cs;
        // quay mặt vào bàn
        sitI.push({ x: wx, z: wz, heading: headZ(x - wx, z - wz), yo: -0.03 });
      }
      if ((j === 0 || hash3(x, z, 55) < 0.35) && clearDisc(x + S.ux * 0.4, z + S.uz * 0.4, 1.3)) paraI.push({ x: x + S.ux * 0.4, z: z + S.uz * 0.4, heading: rot });
    }
    // 1 xe đẩy cạnh cụm quán (40%)
    if (hash3(S.ax, S.az + k, 56) < 0.4) {
      const kk = Math.min(S.n - 1, k + 2);
      if (S.ok[kk] && !(S.occ[kk] & OCC_POLE)) {
        const [x, z] = cellPos(S, kk, parkingLine(S.c));
        if (!inBuilding(x, z) && !obst.hit(x, z, 0.7) && clearDisc(x, z, 0.9)) { cartI.push({ x, z, heading: Math.atan2(S.ux, S.uz) }); S.occ[kk] |= OCC_SHOP; obst.add(x, z, 0.8); ctx.addCollider(x, z, 0.6); }
      }
    }
  }
  // 2) theo bằng chứng pano + ngẫu nhiên thưa
  for (const S of sides) {
    for (let k = 0; k < S.n; k++) {
      if (!S.ok[k] || S.occ[k]) continue;
      const e = S.ev[k];
      const [x, z] = cellPos(S, k, parkingLine(S.c));
      const cl = e ? e[6] : 0;
      const h1 = hash3(x, z, 61), h2 = hash3(x, z, 62), h3 = hash3(x, z, 63);
      const open = openSpace(x, z);
      // quán vỉa hè (ghế nhựa): ~1 cụm/60-80 m nơi pano thấy ghế nhựa; ~1/400 m nơi không có pano (lõi)
      const pFood = (cl & 1) ? 0.045 : e ? 0.006 : (Math.hypot(x, z) < 900 ? 0.008 : 0.003);
      if (!open && h1 < pFood) { placeFood(S, k, 2 + ((h2 * 4) | 0)); continue; }
      // xe đẩy hàng rong
      const pCart = (cl & 2) ? 0.03 : 0.004;
      if (!open && h2 < pCart && !obst.hit(x, z, 0.7) && clearDisc(x, z, 0.9)) { cartI.push({ x, z, heading: Math.atan2(S.ux, S.uz) + (h3 < 0.5 ? 0 : Math.PI) }); S.occ[k] |= OCC_SHOP; obst.add(x, z, 0.8); ctx.addCollider(x, z, 0.6); if (h3 < 0.7) standI.push({ x: x + S.ux * 0.9, z: z + S.uz * 0.9, heading: Math.atan2(-S.nx, -S.nz) }); continue; }
      // biển đứng chữ A trước cửa hàng
      const pA = (cl & 8) ? 0.06 : 0.012;
      if (!open && h3 < pA) {
        const lat = facadeLine(S.c) - 0.45;
        const [ax2, az2] = cellPos(S, k, lat, (h1 - 0.5) * 2);
        if (!inBuilding(ax2, az2) && !obst.hit(ax2, az2, 0.4) && clearDisc(ax2, az2, 0.4)) { aframeI.push({ x: ax2, z: az2, heading: Math.atan2(-S.nx, -S.nz) + (h2 - 0.5) * 0.5, cell: (hash3(ax2, az2, 64) * 8) | 0 }); S.occ[k] |= OCC_SHOP; }
        continue;
      }
    }
  }
  // thùng rác + trụ cứu hoả: dọc p/s/t theo chiều dài (mỗi ~90 m / ~160 m), sát dải cột
  for (const S of sides) {
    if (S.c === 'r') continue;
    for (let k = 0; k < S.n; k++) {
      if (!S.ok[k] || S.occ[k] & (OCC_SHOP | OCC_POLE)) continue;
      const [x, z] = cellPos(S, k, furnitureLine(S.c) + 0.15);
      const e = S.ev[k], cl = e ? e[6] : 0;
      const hb = hash3(x, z, 71);
      if (!clearDisc(x, z, 0.5)) continue;   // W2-A: thùng rác/trụ cứu hoả/tủ điện không trên nhựa, ≥ 3,5 m camera pano
      if (hb < ((cl & 4) ? 0.06 : 0.03)) {
        if (obst.hit(x, z, 0.45)) continue;
        binI.push({ x, z, heading: Math.atan2(-S.nx, -S.nz), col: pick([0x2f7d3e, 0x2f7d3e, 0xe07a1f, 0xe8c12c, 0x2b6cb3], hash3(x, z, 72)) });
        ctx.addCollider(x, z, 0.35); obst.add(x, z, 0.45); S.occ[k] |= OCC_SHOP;
      } else if (hb > 1 - ((cl & 32) ? 0.03 : 0.006)) {
        if (obst.hit(x, z, 0.3)) continue;
        hydI.push({ x, z, heading: 0 }); obst.add(x, z, 0.3); S.occ[k] |= OCC_SHOP;
      } else if (hb > 0.5 && hb < 0.5 + ((cl & 16) ? 0.02 : 0.004)) {
        const [x2, z2] = cellPos(S, k, facadeLine(S.c) - 0.35);
        if (inBuilding(x2, z2) || obst.hit(x2, z2, 0.5) || !clearDisc(x2, z2, 0.5)) continue;
        cabI.push({ x: x2, z: z2, heading: Math.atan2(-S.nx, -S.nz), col: pick([0xbfc3c4, 0xd6d0bf, 0x9aa69c], hash3(x2, z2, 73)) });
        obst.add(x2, z2, 0.55); ctx.addCollider(x2, z2, 0.45); S.occ[k] |= OCC_SHOP;
      }
    }
  }
  const tShops = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.5 XE MÁY ĐỖ: hàng 2-25 chiếc vuông góc/xiên 70-90° tại parkingLine, mật độ theo bằng chứng; ngân sách lấy mẫu đều
  // ---------------------------------------------------------------------------------------------------------------
  const bikeRows = [];   // {S, k0, k1(exclusive), mode}
  // tham số theo mức: [tỉ lệ khởi hàng mỗi ô trống, số ô tối thiểu, tối đa của 1 hàng]
  const LEVEL = [[0.012, 1, 2], [0.05, 1, 2], [0.12, 2, 5], [0.24, 3, 9]];
  for (const S of sides) {
    let k = 0;
    while (k < S.n) {
      if (!S.ok[k] || (S.occ[k] & OCC_SHOP)) { k++; continue; }
      const [x, z] = cellPos(S, k, parkingLine(S.c));
      const e = S.ev[k];
      let lv = e ? e[2] : defLevel(x, z);
      if (lv > 0 && openSpace(x, z)) lv = 0;
      if (S.c === 'p' && lv > 2) lv = 2;
      const [pStart, nMin, nMax] = LEVEL[lv];
      if (hash3(x, z, 81) >= pStart) { k++; continue; }
      const want = nMin + ((hash3(x, z, 82) * (nMax - nMin + 1)) | 0);
      let k1 = k;
      while (k1 < S.n && k1 - k < want && S.ok[k1] && !(S.occ[k1] & OCC_SHOP)) k1++;
      if (k1 > k) { bikeRows.push({ S, k0: k, k1, x, z }); for (let q = k; q < k1; q++) S.occ[q] |= OCC_BIKE; }
      k = k1 + 1;
    }
  }
  // đếm chiếc dự kiến (~ ô×CELL/0.72) → lấy mẫu đều theo hash hàng nếu vượt ngân sách
  let estBikes = 0; for (const R of bikeRows) estBikes += (R.k1 - R.k0) * CELL / 0.72;
  const keepRow = Math.min(1, BUDGET.bikes / Math.max(1, estBikes * 0.8));   // đo: số xe thật ≈ 0,8 × ước lượng (khe/vật cản)
  const bikeI = [[], [], [], []];
  const BIKE_MIX = [0.42, 0.72, 0.88, 1.0];   // xe số 42% · ga nhỏ 30% · ga lớn 16% · cub 12%
  const BIKE_ORDER = [1, 0, 2, 3];            // chỉ số model theo BIKE_MIX: underbone, scooter, big, cub
  const BIKE_COLS = [0x1d1e21, 0x1d1e21, 0xd9d8d3, 0xe9e7e1, 0x8d1f1c, 0xb12a22, 0x6e7378, 0xa5a9ad, 0x24396b, 0x3b5f94, 0x5b3a2a, 0xd4c3a3, 0xe6b3b8, 0x2f4a3a];
  let nBikes = 0;
  for (const R of bikeRows) {
    const { S } = R;
    if (hash3(R.x, R.z, 83) > keepRow) { for (let q = R.k0; q < R.k1; q++) S.occ[q] &= ~OCC_BIKE; continue; }
    // vỉa ≤ 2 m (phố r: 1,5 m nhánh này / 2,0 m sau WP1) → xe xiên 55-70° sát bó vỉa, không vuông góc chạm mặt tiền
    const narrow = SIDEWALK_W[S.c] <= 2.0;
    const baseAng = narrow ? 0.95 + hash3(R.x, R.z, 84) * 0.25 : 1.22 + hash3(R.x, R.z, 84) * 0.35;   // rad so với trục phố
    const noseIn = hash3(R.x, R.z, 85) < 0.78;                 // phần lớn mũi vào nhà
    const lat = narrow ? curbLine(S.c) + 0.78 : parkingLine(S.c);
    const spacing = 0.66 + hash3(R.x, R.z, 86) * 0.12;
    const t0 = S.off + R.k0 * CELL + 0.35, t1 = S.off + R.k1 * CELL - 0.35;
    // hàng thật không thẳng tắp nhưng xe KỀ NHAU không xuyên nhau (phản biện: cách 0,66-0,78 m mà lệch ±8° độc lập →
    // đầu/đuôi xe kề đè lên nhau): lệch so với xe TRƯỚC giới hạn ±0,1 rad; xe đỗ xiên hẳn (±25°) được chừa thêm 0,3 m
    // trước và sau nó.
    let prevA = null, padNext = 0;
    for (let t = t0; t <= t1; t += spacing + padNext + (hash3(R.x + t, R.z, 87) < 0.08 ? 0.5 : 0)) {
      padNext = 0;
      const ha = hash3(S.ax + S.ux * t, S.az + S.uz * t, 89);
      const skew = ha > 0.94 ? 0.42 : ha < 0.06 ? -0.42 : 0;
      if (skew && prevA !== null) { t += 0.3; padNext = 0.3; if (t > t1) break; }
      const x = S.ax + S.ux * t + S.nx * lat, z = S.az + S.uz * t + S.nz * lat;
      const hb = hash3(x, z, 88);
      if (hb < 0.06) { prevA = null; continue; }                // khe trống ngẫu nhiên giữa hàng
      // góc lệch từng xe: phần lớn ±8°, ~12% xe đỗ xiên hẳn (±25°)
      let a = baseAng + (hash3(x, z, 89) - 0.5) * 0.28;
      if (prevA !== null && !skew) a = Math.min(prevA + 0.1, Math.max(prevA - 0.1, a));
      a += skew;
      // hướng mũi: thành phần dọc phố (cos a) + thành phần ra mặt tiền (sin a)·(noseIn?+1:−1)
      const dirAlong = Math.cos(a), dirOut = Math.sin(a) * (noseIn ? 1 : -1);
      const fx = S.ux * dirAlong + S.nx * dirOut, fz = S.uz * dirAlong + S.nz * dirOut;
      // mũi/đuôi không được vào nhà thật hoặc chạm vật cản
      const nxp = x + fx * 0.9, nzp = z + fz * 0.9, txp = x - fx * 0.9, tzp = z - fz * 0.9;
      if (inBuilding(nxp, nzp) || inBuilding(txp, tzp)) { prevA = null; continue; }
      if (obst.hit(x, z, 0.32) || obst.hit(nxp, nzp, 0.22) || obst.hit(txp, tzp, 0.22)) { prevA = null; continue; }
      if (roadIdx.carriageGap(narrow ? x : txp, narrow ? z : tzp) < (narrow ? -0.15 : -0.05)) { prevA = null; continue; }
      // W2-A: xe (dài ~1,8 m) không chạm nhựa khe đường đôi/nút giao, mép xe ≥ 3 m camera pano
      if (!clearDisc(x, z, 0.95) || onCarriage(nxp, nzp) || onCarriage(txp, tzp)) { prevA = null; continue; }
      prevA = skew ? null : a;   // sau xe xiên hẳn: xe kế tự do (đã chừa padNext)
      const mu = hash3(x, z, 90);
      const mi = BIKE_ORDER[BIKE_MIX.findIndex((t) => mu < t)];
      const lean = hash3(x, z, 91) < 0.62 ? -0.11 - hash3(x, z, 92) * 0.05 : 0;   // chân chống nghiêng
      bikeI[mi].push({ x, z, heading: headZ(fx, fz), lean, col: pick(BIKE_COLS, hash3(x, z, 93)) });
      nBikes++;
    }
  }
  const tBikes = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.6 Ô TÔ ĐỖ: song song mép đường TRONG LÒNG (curbLine − 0,95 m); phố r: 2 bánh trên vỉa (nghiêng nhẹ)
  // ---------------------------------------------------------------------------------------------------------------
  const carI = [[], [], [], [], [], []];   // sedan, suv, hatch, taxi, truck, van
  const CAR_COLS = [0xeeeeec, 0xeeeeec, 0xe4e4e1, 0x16171a, 0x16171a, 0xb4b8bc, 0x8e9398, 0x6c7176, 0x9a1d1d, 0x24406e, 0x6b5a48, 0xcfc4ae];
  const TAXI_COLS = [0xf4f4f0, 0x2f8f4e, 0x3aa35a, 0xe9e9e4, 0x2c5aa0];   // trắng · xanh lá · xanh dương-trắng (taxi HP)
  const CAR_LEN = [4.5, 4.6, 3.9, 3.9, 4.8, 5.25];
  // lượt 1: gom ỨNG VIÊN (mọi kiểm tra) · lượt 2: lấy mẫu ĐỀU theo hash nếu vượt ngân sách (không "N đường đầu ăn hết")
  const carCand = [];
  for (const S of sides) {
    const e0 = S.ev[(S.n / 2) | 0];
    const mx = S.ax + S.ux * S.L / 2, mz = S.az + S.uz * S.L / 2;
    const lvl = e0 ? e0[3] : (Math.hypot(mx, mz) < 900 ? 1 : 0);
    // mức 0 CÓ pano (ảnh không thấy ô tô đỗ): 0,1 từng cho 68% pano "không ô tô" vẫn có xe ≤ 30 m (đo khớp bằng
    // chứng) → 0,04; mức 0 do KHÔNG có pano (ngoại vi > 900 m) giữ 0,1
    let fill = S.c === 'r' ? [0.0, 0.1, 0.3][lvl] : [e0 ? 0.04 : 0.1, 0.42, 0.78][lvl];
    if (S.c === 'p') fill *= 0.7;
    if (fill <= 0) continue;
    const roll = S.c === 'r';
    const lat = roll ? curbLine(S.c) - 0.05 : curbLine(S.c) - 0.95;
    let s = 2 + hash3(S.ax, S.az + S.side, 101) * 6;
    while (s < S.L - 3) {
      const x0 = S.ax + S.ux * s, z0 = S.az + S.uz * s;
      const hc = hash3(x0, z0, 102);
      const mu = hash3(x0, z0, 103);
      // sedan 32% · SUV 22% · hatch 18% · van/minibus 11% · taxi 8% · tải nhỏ 9%
      const mi = mu < 0.32 ? 0 : mu < 0.54 ? 1 : mu < 0.72 ? 2 : mu < 0.83 ? 5 : mu < 0.91 ? 3 : 4;
      const len = CAR_LEN[mi];
      if (hc > fill) { s += len + 2 + hash3(x0, z0, 104) * 9; continue; }
      const sc = s + len / 2;
      if (sc > S.L - len / 2 - 1) break;
      const x = S.ax + S.ux * sc + S.nx * lat, z = S.az + S.uz * sc + S.nz * lat;
      // camera pano nằm giữa lòng đường: ô tô đỗ có ĐẦU XE sát camera che gần nửa khung hình mà ảnh thật ở đó trống
      // (đo: van 5,25 m trước pano_102 — tâm 8,5 m nhưng đầu xe ~6 m, ảnh thật không có xe) → kiểm tra viên nang (tâm
      // + 2 đầu xe) quanh 551 điểm chụp: 6,5 m (van/tải 8 m); pano ghi "ô tô đỗ dày/hai bên" (car 2) thì xe đỗ sát
      // camera là ĐÚNG ảnh thật → chỉ 4/5 m. (Vòng tròn 7,5/9 m quanh TÂM cho mọi pano từng bớt 16% ô tô — quá tay.)
      // Phản biện: pano "ô tô dày" vẫn để van+taxi đỗ 3-5 m trước camera (pano_024 kín khung, ảnh thật xe ở xa hơn) →
      // pano "dày": TÂM xe ≥ 7,5 m (van/tải 8,5 m), 2 đầu xe ≥ 5,5/6,5 m (thay 4/5 m chỉ xét viên nang; 7 m vẫn để
      // SUV tâm 7,3 m chiếm 1/4 khung pano_024). Không "dày": đầu xe ≥ 6,5/8 m (tâm tự ≥ ~8 m vì xe song song lề).
      const ec = evAt(x, z), dense = !!(ec && ec[3] >= 2);
      const rp = mi >= 4 ? (dense ? 6.5 : 8) : (dense ? 5.5 : 6.5), rc = mi >= 4 ? (dense ? 8.5 : 8) : (dense ? 7.5 : 6.5), hx = S.ux * len / 2, hz = S.uz * len / 2;
      let ok = x * x + z * z < R_MAX * R_MAX && flat(x, z) && !avoid(x, z) && !clearAt(x, z) && lakeSD(x, z) > 18
        && !panoNear(x, z, rc) && !panoNear(x + hx, z + hz, rp) && !panoNear(x - hx, z - hz, rp);
      if (ok) for (const dd of [-len / 2 - 0.5, 0, len / 2 + 0.5]) { if (roadIdx.blocked(x + S.ux * dd, z + S.uz * dd, S.ri, S.si, 4.5, false)) { ok = false; break; } }
      if (ok && obst.hit(x, z, 0.9)) ok = false;
      // phố r: 2 bánh trên vỉa → không đè hàng xe máy / quán / xe đẩy đã đặt trên các ô vỉa hè dọc thân xe
      let k0 = 0, k1 = -1;
      if (ok && roll) {
        if (inBuilding(x + S.nx * 1.0, z + S.nz * 1.0)) ok = false;
        k0 = Math.max(0, Math.floor((s - 0.3 - S.off) / CELL)); k1 = Math.min(S.n - 1, Math.floor((s + len + 0.3 - S.off) / CELL));
        for (let q = k0; ok && q <= k1; q++) if (S.occ[q] & (OCC_BIKE | OCC_SHOP)) ok = false;
      }
      if (ok) carCand.push({ S, x, z, mi, len, roll, k0, k1 });
      s += len + 0.7 + hash3(x0, z0, 107) * 1.6;
    }
  }
  const keepCar = Math.min(1, BUDGET.cars / Math.max(1, carCand.length));
  let nCars = 0;
  for (const C of carCand) {
    const { S, x, z, mi, len, roll } = C;
    if (keepCar < 1 && hash3(x, z, 108) >= keepCar) continue;
    // giao thông bên PHẢI: bên side>0 (pháp tuyến (uz,−ux)) là bên TRÁI khi nhìn theo u → xe đỗ đó quay ngược u
    const dirSign = S.side > 0 ? -1 : 1;
    const heading = headZ(S.ux * dirSign, S.uz * dirSign) + (hash3(x, z, 105) - 0.5) * 0.04;
    // nâng phía vỉa hè: local +X = (cosθ, −sinθ); nếu nó chỉ ra vỉa (n) → quay dương quanh trục dọc
    const lxDotN = Math.cos(heading) * S.nx - Math.sin(heading) * S.nz;
    const col = mi === 3 ? pick(TAXI_COLS, hash3(x, z, 106)) : mi === 4 ? pick([0xf0f0ec, 0xf0f0ec, 0x2c5aa0, 0xd8d4c8], hash3(x, z, 106))
      : mi === 5 ? pick([0xf2f2ef, 0xf2f2ef, 0xe6e6e2, 0xb9bdc1, 0x9aa0a6, 0x1f3f73], hash3(x, z, 106)) : pick(CAR_COLS, hash3(x, z, 106));
    // phố r: bánh phía lề đứng trên MẶT ĐANG VẼ ở đó (vỉa +0,14 so với lòng → nghiêng lên ~0,09 rad như cũ; dot3 cũ
    // phố r không vỉa → nền thấp hơn lòng ~0,1 m → nghiêng xuống mép lòng). Vệt bánh ~1,55 m.
    let rl = 0, yo = 0;
    if (roll) {
      const dy = Math.max(-0.12, Math.min(0.16, surfY ? yAt(x + S.nx * 0.78, z + S.nz * 0.78) - yRoad : SIDEWALK_TOP - ROAD_TOP));
      rl = (lxDotN > 0 ? 1 : -1) * Math.atan2(dy, 1.55); yo = dy * 0.46;
    }
    carI[mi].push({ x, z, heading, roll: rl, yo, col, len });
    for (const dd of [-len * 0.28, len * 0.28]) ctx.addCollider(x + S.ux * dd, z + S.uz * dd, 0.85);
    obst.add(x, z, len / 2);
    if (roll) for (let q = C.k0; q <= C.k1; q++) S.occ[q] |= OCC_CAR;   // người đi bộ phố r không xuyên xe
    nCars++;
  }
  const tCars = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.7 NGƯỜI: đứng cạnh hàng xe/cửa hàng, đi qua-lại trên khoảng vỉa hè trống (GPU), ngồi ghế nhựa (ở 6.4)
  // ---------------------------------------------------------------------------------------------------------------
  for (const S of sides) {
    let k = 0;
    while (k < S.n) {
      if (!S.ok[k] || S.occ[k] & (OCC_BIKE | OCC_SHOP | OCC_CAR)) { k++; continue; }
      let k1 = k; while (k1 < S.n && S.ok[k1] && !(S.occ[k1] & (OCC_BIKE | OCC_SHOP | OCC_CAR))) k1++;
      const runL = (k1 - k) * CELL;
      const [x, z] = cellPos(S, k, parkingLine(S.c));
      const r0 = Math.hypot(x, z);
      const dens = r0 < 700 ? 1 / 34 : r0 < 1150 ? 1 / 60 : 1 / 110;
      if (runL >= 6 && hash3(x, z, 111) < runL * dens && !openSpace(x, z)) {
        const L = Math.min(runL - 2, 8 + hash3(x, z, 112) * 18);
        const sMid = (k + (k1 - k) / 2) * CELL;
        const lat = SIDEWALK_W[S.c] >= 2.2 ? parkingLine(S.c) + (hash3(x, z, 113) - 0.5) * 0.6 : curbLine(S.c) + SIDEWALK_W[S.c] * 0.55;
        const [wx, wz] = cellPos(S, 0, lat, sMid - 0.5 * CELL);
        walkI.push({ x: wx, z: wz, heading: Math.atan2(S.ux, S.uz), walk: [L, 1.05 + hash3(wx, wz, 114) * 0.45, hash3(wx, wz, 115), 1 + hash3(wx, wz, 116) * 4] });
        for (let q = k; q < k1; q++) S.occ[q] |= OCC_PED;
      }
      k = k1 + 1;
    }
  }
  // người đứng: đầu hàng xe máy (chủ xe/trông xe) ~14%
  for (const R of bikeRows) {
    const S = R.S; if (!(S.occ[R.k0] & OCC_BIKE)) continue;
    if (hash3(R.x, R.z, 121) > 0.14) continue;
    const kk = R.k1 < S.n ? R.k1 : R.k0 - 1; if (kk < 0 || !S.ok[kk] || S.occ[kk] & (OCC_SHOP | OCC_POLE | OCC_CAR)) continue;
    const [x, z] = cellPos(S, kk, parkingLine(S.c) + 0.3, (hash3(R.x, R.z, 122) - 0.5));
    if (inBuilding(x, z) || obst.hit(x, z, 0.3)) continue;
    standI.push({ x, z, heading: Math.atan2(-S.nx, -S.nz) + (hash3(x, z, 123) - 0.5) * 2.4 });
  }
  // ngân sách người: lấy mẫu đều
  const nPedAll = walkI.length + standI.length + sitI.length;
  if (nPedAll > BUDGET.peds) {
    const keep = BUDGET.peds / nPedAll;
    for (const arr of [walkI, standI, sitI]) { let w = 0; for (const p of arr) if (hash3(p.x, p.z, 124) < keep) arr[w++] = p; arr.length = w; }
  }
  // chân mọi đồ vỉa hè còn lại theo mặt đang vẽ (ô tô: yRoad riêng; dây đèn trang trí: y nền riêng)
  groundAll([...bikeI, stoolI, paraI, cartI, aframeI, binI, hydI, cabI, walkI, standI, sitI]);
  const tPeds = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.8 DỰNG InstancedMesh + đăng ký cull
  // ---------------------------------------------------------------------------------------------------------------
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), V = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1), SC = new THREE.Vector3(), COL = new THREE.Color();
  const QR = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1);
  const meshes = [];
  let drawGroups = 0;
  // list: item {x,z,heading,lean?,roll?,y?,yo?,sc?, v (biến thể), col?}
  function inst(name, geo, material, list, { y = yWalk, cast = true, rMin = 0, rMax = 900, keepBehind = 30, color = null, extra = null } = {}) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, material, list.length);
    const iv = new Float32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      E.set(0, it.heading || 0, it.lean || 0, 'YXZ');      // lean = nghiêng quanh trục dọc xe (chân chống)
      Q.setFromEuler(E);
      if (it.roll) Q.multiply(QR.setFromAxisAngle(ZAX, it.roll));   // ô tô 2 bánh trên vỉa
      const yy = (typeof it.y === 'number' ? it.y : y) + (it.yo || 0);
      V.set(it.x, yy, it.z);
      M.compose(V, Q, it.sc ? SC.set(it.sc[0], it.sc[1], it.sc[2]) : S1);
      m.setMatrixAt(i, M);
      iv[i] = it.v || 0;
      if (color) { COL.setHex(color(it, i)); m.setColorAt(i, COL); }
    }
    // geometry RIÊNG mỗi InstancedMesh (attribute instanced gắn vào geometry) — clone rẻ (dùng chung buffer đỉnh)
    if (geo.attributes.iVar) { const g2 = new THREE.BufferGeometry(); for (const k in geo.attributes) if (k !== 'iVar') g2.setAttribute(k, geo.attributes[k]); g2.boundingSphere = geo.boundingSphere; m.geometry = g2; }
    m.geometry.setAttribute('iVar', new THREE.InstancedBufferAttribute(iv, 1));
    if (extra) extra(m, list);
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.name = name; m.castShadow = cast; m.receiveShadow = true;
    m.userData.propCast = cast;
    if (material.userData.depth) m.customDepthMaterial = material.userData.depth;
    scene.add(m); meshes.push(m); drawGroups++;
    cullRegister(m, rMin, rMax, keepBehind);
    return m;
  }
  const tag = (list, v) => { for (const it of list) it.v = v; return list; };
  // gần: model chi tiết ~500 tam giác (≤ 80 m — xe 1,1 m cao ở 80 m chỉ còn ~10 px); xa: bóng dáng 72 tam giác
  const NEAR_BIKE = LITE ? 55 : 80, FAR_BIKE = LITE ? 260 : 420;
  const matBike = propMaterial({ name: 'bike', palA: [0x1c1c1e, 0xd8d6cf, 0xb3261e, 0x2c4f8a, 0xe2c23a, 0x9aa0a6, 0xd27aa0, 0x2d6b3d], gate: [0.38, 0.33] });
  const matCar = propMaterial({ name: 'car', palA: [0x2b5aa4, 0x3a7a46, 0x8a8f86, 0xe9e7e0, 0x2b5aa4, 0x5a7f9a, 0xbfb59b, 0x3a7a46] });
  const matPole = propMaterial({ name: 'pole', gate: [0.55, 0.45] });
  const matClut = propMaterial({ name: 'clutter', palA: [0xd8322a, 0x2a62c4, 0x2f9a4c, 0xe8e2d4, 0xd8322a, 0xf0b52c, 0x2a62c4, 0xe8e2d4] });
  const PANTS = [0x23262c, 0x2f3540, 0x1f2a3a, 0x4a4238, 0x5b6470, 0x2b2b2e, 0x6b5f50, 0x3c4a5c];
  const SKIN = [0xe2b48a, 0xd9a476, 0xc99063, 0xedc39b, 0xd6a07a, 0xc48a5c, 0xe8bc94, 0xdcaa80];
  const matPed = propMaterial({ name: 'ped', palA: PANTS, palB: SKIN, gate: [0.16, 0], walk: true });
  const SHIRT = [0xe9e6df, 0xe9e6df, 0x3a6ea5, 0xb5473a, 0x4a7a52, 0x6a6f76, 0xd8b24a, 0xc86a92, 0x2f3540, 0xf2f2f0, 0x8a5a3c, 0x5c8fbf, 0xd96b2b];
  // vật liệu kính đèn/bóng đèn của RIÊNG props (cùng program với propMaterial) — cường độ chép từ sharedMats.lampGlow mỗi khung
  const glow = ctx.sharedMats && ctx.sharedMats.lampGlow;
  const matGlow = propMaterial({ name: 'glow' });
  matGlow.color.setHex(0xfff2c8); matGlow.emissive.setHex(0xffd890); matGlow.emissiveIntensity = 0;

  // xe máy: 4 model gần — MỖI MODEL 1 InstancedMesh (gộp biến thể sẽ bắt GPU xử lý cả 4 bộ đỉnh cho mỗi xe:
  // đo +0,27 M tam giác suy biến ở cam_spawn; tách = +3 draw call cùng program, rẻ hơn) + LOD xa chung
  const bikeTris = [modelScooter(), modelUnderbone(), modelBigScooter(), modelCub()].map((g) => [g, triCount(g)]);
  const allBikes = bikeI.flat();
  const bikeColor = (it) => it.col;
  ['scooter', 'underbone', 'bigscooter', 'cub'].forEach((nm, i) => inst('props_bike_' + nm, bikeTris[i][0], matBike, bikeI[i], { rMax: NEAR_BIKE, keepBehind: 25, color: bikeColor }));
  inst('props_bikes_far', modelBikeFar(), matBike, allBikes.map((b) => ({ ...b, v: 0 })), { rMin: NEAR_BIKE, rMax: FAR_BIKE, cast: false, color: bikeColor });
  // ô tô: 5 model gần + LOD xa
  const NEAR_CAR = LITE ? 90 : 130, FAR_CAR = LITE ? 420 : 750;
  const carModels = [modelSedan(), modelSUV(), modelHatch(false), modelHatch(true), modelTruck(), modelVan()];
  const carTris = carModels.map(triCount);
  const allCars = carI.flat();
  ['sedan', 'suv', 'hatch', 'taxi', 'truck', 'van'].forEach((nm, i) => inst('props_car_' + nm, carModels[i], matCar, carI[i], { y: yRoad, rMax: NEAR_CAR, color: (it) => it.col }));
  inst('props_cars_far', modelCarFar(), matCar, allCars.map((c) => ({ ...c, v: 0 })), { y: yRoad, rMin: NEAR_CAR, rMax: FAR_CAR, cast: false, color: (it) => it.col });
  // CỘT & ĐÈN (gần: 6 biến thể / xa: 5 biến thể)
  const NEAR_POLE = LITE ? 140 : 200, FAR_POLE = LITE ? 600 : 1100;
  const poleTint = (it) => { if (it.col) return it.col; const v = 0.86 + hash3(it.x, it.z, 131) * 0.2; COL.setRGB(v, v, v * 0.98); return COL.getHex(); };
  const posts = [], bulbs = [];
  if (ctx.stringLights) {   // dây đèn trang trí quảng trường → đầu đông hồ (thay ~150 mesh lẻ cũ)
    const [p0, p1] = ctx.stringLights;
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const dx = (p1[0] - p0[0]) / L, dz = (p1[1] - p0[1]) / L;
    let prev = null;
    for (let s = 0; s <= L; s += 16) {
      const px = p0[0] + dx * s, pz = p0[1] + dz * s;
      if (isWater(px, pz)) continue;
      const y = groundHeightNoDeck(px, pz);
      if (Math.abs(y - LAND_H) > 1) { prev = null; continue; }
      posts.push({ x: px, z: pz, heading: 0, y, col: 0xffffff });
      if (prev) for (let k = 1; k < 7; k++) {
        const t = k / 7, sag = Math.sin(t * Math.PI) * 0.55;
        bulbs.push({ x: prev[0] + (px - prev[0]) * t, z: prev[1] + (pz - prev[1]) * t, heading: 0, y: y + 3.55 - sag });
      }
      prev = [px, pz];
    }
  }
  for (const L of cobraI) L.col = 0xffffff;
  for (const L of ornI) L.col = 0xffffff;
  const furnNear = [tag(poleI, 0), tag(poleLampI, 1), tag(trafoI, 2), tag(cobraI, 3), tag(ornI, 4), tag(posts, 5)].flat();
  const postGeo = () => mergeParts([finish(cyl(0.07, 0.09, 3.6, 6, 0, 1.8, 0), 0x5a5f66)]);
  inst('props_furniture', variants([modelPole(), modelPoleLamp(), modelTransformer(), modelCobra(), modelOrnate(), postGeo()]), matPole, furnNear, { rMax: NEAR_POLE, color: poleTint });
  const farVar = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 3 };
  const furnFar = furnNear.filter((it) => it.v <= 4).map((it) => ({ ...it, v: farVar[it.v] }));
  inst('props_furniture_far', variants([modelPoleFar(), modelTransformerFar(), modelCobraFar(), modelOrnateFar()]), matPole, furnFar, { rMin: NEAR_POLE, rMax: FAR_POLE, cast: false, color: poleTint });
  // KÍNH ĐÈN / CẦU ĐÈN / BÓNG ĐÈN DÂY (1 draw call, không đổ bóng)
  const glowList = [
    ...glassI.filter((g) => g.reach === LAMP_REACH).map((g) => ({ ...g, v: 0 })),
    ...glassI.filter((g) => g.reach !== LAMP_REACH).map((g) => ({ ...g, v: 1 })),
    ...ornI.map((o) => ({ x: o.x, z: o.z, y: o.y, heading: o.heading, v: 2 })),
    ...bulbs.map((b) => ({ ...b, v: 3 })),
  ];
  const bulbGeo = () => mergeParts([finish(new THREE.IcosahedronGeometry(0.07, 0), 0xffffff)]);
  inst('props_lamp_glow', variants([modelLampGlass(LAMP_REACH, LAMP_H + 0.01), modelLampGlass(POLE_LAMP_ARM.reach + 0.08, POLE_LAMP_ARM.y + 0.07), modelOrnateGlobes(), bulbGeo()]), matGlow, glowList, { rMax: FAR_POLE, cast: false });
  // ĐỒ LẶT VẶT (1 draw call): ghế nhựa, ô dù, xe đẩy, thùng rác, trụ cứu hoả, tủ điện
  const NEAR_CL = LITE ? 140 : 260;
  for (const it of stoolI) it.col = pick([0xd8322a, 0xd8322a, 0x2a62c4, 0x2a62c4, 0x2f9a4c, 0xe8e2d4], hash3(it.x, it.z, 141));
  for (const it of paraI) it.col = pick([0xd8322a, 0x2a62c4, 0xe8a42c, 0x2f9a4c, 0xe8e2d4, 0xc0392b], hash3(it.x, it.z, 142));
  for (const it of cartI) it.col = pick([0x2a62c4, 0xd8322a, 0xe8e2d4, 0x2f9a4c, 0xe8a42c], hash3(it.x, it.z, 143));
  for (const it of hydI) it.col = 0xffffff;
  const clutter = [tag(stoolI, 0), tag(paraI, 1), tag(cartI, 2), tag(binI, 3), tag(hydI, 4), tag(cabI, 5)].flat();
  inst('props_clutter', variants([modelStoolSet(), modelParasol(), modelCart(), modelBin(), modelHydrant(), modelCabinet()]), matClut, clutter, { rMax: NEAR_CL, color: (it) => it.col });
  if (aframeI.length) {
    const aTex = aframeTexture();
    const aMat = new THREE.MeshLambertMaterial({ map: aTex, side: THREE.DoubleSide });
    aMat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vMapUv * vec2(0.25, 0.5) + vec2(mod(aCell, 4.0) * 0.25, (1.0 - floor(aCell / 4.0)) * 0.5);\n#endif');
    };
    aMat.customProgramCacheKey = () => 'hp_props_aframe_v1';
    inst('props_aframes', modelAFrame(), aMat, aframeI, { rMax: NEAR_CL * 0.7, extra: (m, list) => {
      const a = new Float32Array(list.length); list.forEach((it, i) => { a[i] = it.cell; });
      m.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(a, 1));
    } });
  }
  // cờ treo cột đèn đại lộ
  if (flagI.length) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 86;
    const g = cv.getContext('2d');
    g.fillStyle = '#da251d'; g.fillRect(0, 0, 128, 86);
    g.fillStyle = '#ffdd00'; g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 11.7 : 28; const xx = 64 + Math.cos(a) * rr, yy = 43 + Math.sin(a) * rr; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
    g.closePath(); g.fill();
    const ft = new THREE.CanvasTexture(cv); ft.colorSpace = THREE.SRGBColorSpace;
    const fg = new THREE.PlaneGeometry(1.2, 0.8); fg.translate(0.62, 0, 0);
    inst('props_flags', fg, new THREE.MeshLambertMaterial({ map: ft, side: THREE.DoubleSide }), flagI.map((f) => ({ ...f, y: f.y + 6.1 })), { rMax: FAR_POLE * 0.6, cast: false });
  }
  // NGƯỜI: đứng/đi (biến thể 0) + ngồi (biến thể 1) — 1 draw call
  const NEAR_PED = LITE ? 140 : 240;
  const pedTris = triCount(modelPerson(false));
  const people = [
    ...walkI.map((p) => ({ ...p, v: 0 })),
    ...standI.map((p) => ({ ...p, v: 0, walk: [0, 0, hash3(p.x, p.z, 151), 0] })),
    ...sitI.map((p) => ({ ...p, v: 1, walk: [0, 0, 0, 0] })),
  ];
  inst('props_people', variants([modelPerson(false), modelPerson(true)]), matPed, people, { rMax: NEAR_PED, keepBehind: 40, color: (it) => pick(SHIRT, hash3(it.x, it.z, 152)), extra: (m, list) => {
    const a = new Float32Array(list.length * 4); list.forEach((it, i) => a.set(it.walk, i * 4));
    m.geometry.setAttribute('aWalk', new THREE.InstancedBufferAttribute(a, 4));
  } });
  // vũng sáng đèn đêm (cộng sáng, chỉ hiện khi đêm). Phản biện: quad đặt ở lòng +0,03 nằm DƯỚI vỉa hè (+0,18/+0,25)
  // và dưới vạch kẻ → vũng bị bó vỉa cắt thẳng, vạch tối giữa vũng; opacity 0,42 + lõi phẳng → "đĩa sơn" vàng sáng hơn
  // mặt tiền. Nay: quad ở yWalk+0,02 (trên MỌI mặt lát: lòng, vạch, vỉa dot3/WP6) → một vũng mềm phủ cả lòng + mép vỉa;
  // falloff ~ (1+(r/0,55)²)^-1,5 (dạng cos³ của đèn chiếu xuống) tắt mượt về 0 ở mép; opacity đỉnh 0,2 (update()) —
  // năng lượng ~43% bản cũ (0,38/0,17 = 23%: vũng tầm trung ở night_022 gần như biến mất).
  let pools = null;
  if (glow && (cobraI.length || poleLampI.length)) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    for (let i = 0; i <= 10; i++) { const t = i / 10; const a = Math.pow(1 + (t / 0.55) ** 2, -1.5) * (1 - t * t * t * t); gr.addColorStop(t, `rgba(255,255,255,${a.toFixed(3)})`); }
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const pt = new THREE.CanvasTexture(cv);
    const pm = new THREE.MeshBasicMaterial({ map: pt, color: 0xffc78a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: true });
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    const list = [], yP = yWalk + 0.02;
    for (const L of cobraI) list.push({ x: L.x + L.rx * (LAMP_REACH + 0.25), z: L.z + L.rz * (LAMP_REACH + 0.25), heading: L.heading, y: yP, sc: [12, 1, 10] });
    for (const L of poleLampI) { const rx = -L.S.nx, rz = -L.S.nz; list.push({ x: L.x + rx * (POLE_LAMP_ARM.reach + 0.25), z: L.z + rz * (POLE_LAMP_ARM.reach + 0.25), heading: L.heading, y: yP, sc: [10, 1, 8.5] }); }
    pools = inst('props_lamp_pools', pg, pm, list, { rMax: 600, cast: false });
    if (pools) { pools.receiveShadow = false; pools.renderOrder = 3; pools.visible = false; pools.userData.poolMat = pm; }
  }
  const tInst = performance.now();

  // ---------------------------------------------------------------------------------------------------------------
  // 6.9 CẬP NHẬT MỖI KHUNG: cull theo camera (scene.onBeforeRender), dây điện theo ô, vũng sáng đêm, thời gian người đi
  // ---------------------------------------------------------------------------------------------------------------
  const update = (camera) => {
    // freezeStatic gán castShadow cho MỌI mesh không trong suốt → trả lại ý định của ta (LOD xa/kính/cờ không đổ bóng).
    // Gán MỖI khung (20 phép gán): freezeStatic có thể chạy SAU khung đầu (khởi động bất đồng bộ / làm nóng shader).
    for (const m of meshes) m.castShadow = m.userData.propCast;
    cullUpdate(camera);
    const gI = glow ? glow.emissiveIntensity / 1.6 : 0;      // daynight: lampGlow = đêm·1,6
    matGlow.emissiveIntensity = gI * 1.9;
    if (camera.isOrthographicCamera) cableMat.uniforms.uFar.value = 4000;   // ảnh vệ tinh (aerial): không cắt theo khoảng cách
    else cableMat.uniforms.uFar.value = LITE ? 280 : 520;
    if (pools) {
      const on = gI > 0.03;
      pools.visible = on && pools.count > 0;
      pools.userData.poolMat.opacity = Math.min(1, gI) * 0.2;
    }
  };
  if (ctx.updaters) ctx.updaters.push((dt, time) => { PROP_TIME.value = time; });
  // móc vào scene.onBeforeRender (gọi 1 lần/lượt render với camera CHÍNH — không gọi trong pass bóng)
  const prevHook = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, camera, rt) {
    if (prevHook) prevHook.call(this, renderer, sc, camera, rt);
    if (camera && camera.isCamera) update(camera);
  };

  const T1 = performance.now();
  let tris = 0; for (const m of meshes) tris += triCount(m.geometry) * m.count;
  Object.assign(stats, {
    ms: Math.round(T1 - T0),
    msBreak: { sample: Math.round(tPoles - T0), cables: Math.round(tCables - tPoles), shops: Math.round(tShops - tCables), bikes: Math.round(tBikes - tShops), cars: Math.round(tCars - tBikes), peds: Math.round(tPeds - tCars), inst: Math.round(tInst - tPeds) },
    bikes: nBikes, bikeRows: bikeRows.length, bikeKeep: +keepRow.toFixed(3), cars: nCars, carCand: carCand.length, carKeep: +keepCar.toFixed(3),
    poles: poleI.length + poleLampI.length, trafos: trafoI.length, spans: spans.length, cables: nCables, cableVerts,
    lampsCobra: cobraI.length, lampsOrnate: ornI.length, lampsOnPole: poleLampI.length, flags: flagI.length,
    stools: stoolI.length, parasols: paraI.length, carts: cartI.length, aframes: aframeI.length, bins: binI.length, hydrants: hydI.length, cabinets: cabI.length,
    walkers: walkI.length, standing: standI.length, sitting: sitI.length,
    instancedMeshes: drawGroups, trisAllInstances: Math.round(tris),
    modelTris: { scooter: bikeTris[0][1], underbone: bikeTris[1][1], big: bikeTris[2][1], cub: bikeTris[3][1], sedan: carTris[0], suv: carTris[1], hatch: carTris[2], truck: carTris[4], van: carTris[5], ped: pedTris },
  });
  console.log('[props]', JSON.stringify(stats));
  // móc gỡ lỗi/QA (không dùng trong game): window.__hpProps.sides / .cull()
  if (typeof window !== 'undefined') window.__hpProps = { stats, sides, cull: () => CULL.map((t) => [t.mesh.name, t.mesh.count, t.n]), bikeRows, lists: { stoolI, cartI, aframeI, walkI, standI, sitI, cars: carI.flat(), bikes: bikeI.flat(), cobraI, ornI, poleI, poleLampI, trafoI, binI } };
  // parkedCars: ô tô đỗ {x,z,heading,len,…} (tâm ở curbLine − 0,95; phố r: curbLine − 0,05) — cho WP8 giao thông né
  // làn đỗ (xe chạy cách bó vỉa ≥ 1,9 m nơi có xe đỗ) mà không phải đọc lại collider
  return { stats, update, meshes, cableMeshes, parkedCars: allCars, cullStats: () => CULL.map((t) => [t.mesh.name, t.mesh.count, t.n]) };
}
