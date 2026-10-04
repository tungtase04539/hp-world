// citygen.js — DỰNG PHỐ TỪ FOOTPRINT THẬT (js/buildings_real.js, RB01) — Đợt 3 WP2 "FABRIC".
// Thay 4 bộ sinh nhà giả (OSM BUILDINGS đùn khối, house(), shophouse_infill, block_infill — world.js) khi FABRIC='real'.
//
// HỢP ĐỒNG (đọc trước khi sửa):
//  * MỖI CẠNH TƯỜNG = 1 QUAD (2 tam giác; cạnh cắt nóc mái hồi = 3). Chi tiết mặt tiền (cửa, kính, biển hiệu, ban công
//    vẽ, điều hoà...) nằm trong ATLAS (js/facade_atlas.js) và được CHỌN THEO TỪNG FRAGMENT trong shader: tầng = từ độ cao
//    local (tầng trệt GROUND_H 3,9 m, tầng trên FLOOR_H 3,3 m, lan can mái PARAPET_H 0,9 m), bay = uv.x (mét dọc cạnh /
//    ~4 m), mô-đun = hash(hạt giống nhà, bay, tầng) trong bộ theo KIỂU nhà (STYLE). → ô chính cả phố ~0,75 M tam giác.
//  * 1 MATERIAL DUY NHẤT cho toàn bộ phố (tường + mái + lan can + đồ trên mái + ban công/mái hiên) → 1 draw call/ô.
//    Ô FAB_TILE (450 m): 'fab_main_<tx>,<tz>' (luôn hiện; đuôi _x,z → nearCull main.js chỉnh được) và ô DET_TILE (300 m) 'fab_det_<tx>_<tz>' (ban công,
//    mái hiên, hộp biển 3D, cục nóng điều hoà, cột mái tôn; ~0,7 M tam giác tổng nhưng chỉ hiện trong DET_R quanh camera —
//    tên CỐ Ý không khớp regex _x,z để nearCull
//    không giành quyền visible; TIER≤1 không có ô det).
//    Mọi mesh mang userData.noMerge=true → freezeStatic BỎ QUA (thuộc tính aFac không sống sót qua mergeGeometries/split).
//  * Thuộc tính đỉnh: position f32×3 | normal i8n×3 | uv f32×2 | color u8n×3 (màu tường/mái TUYẾN TÍNH) |
//    aFac u8×4 = (seed 0-255, kind|cờ, style hoặc ô atlas, số tầng). kind (3 bit): 0 hông, 1 mặt phố, 2 sau, 3 tường
//    chung lộ, 4 mặt mái (ô atlas ở aFac.z), 5 chi tiết (ô atlas ở aFac.z), 6 mặt trước HỘP BIỂN 3D (vẽ y hệt kind 1).
//    Cờ: +8 nhà LỚN/CAO/độc lập (tường hông + sau cũng có cửa sổ đều), +16 mặt phố DÀI (≥3 bay, ≤5 tầng: dãy nhà ống bị
//    gộp → mỗi bay 1 nhà: màu/mô-đun riêng), +32 mái dốc (vùng trên đỉnh tường = tường hồi trơn, không phải lan can),
//    +64·rc (0 phố chính p/s/t: cửa hàng; 1 phố r/w: nửa nhà ở; 2 ngõ h: ~85% nhà ở, không biển; 3 nhà ở hẳn) — dữ liệu
//    WP1 v1 có công năng trệt từng nhà (INFO: USE_SHOP → rc 0, USE_HOME → rc 3), v0 (info=0) thì theo cấp đường gần nhất.
//    uv tường: x = bay (0..nb), y = ĐỘ CAO LOCAL (m, tính từ chân nhà). uv mái/chi tiết: đơn vị ô atlas (shader lấy fract).
//  * Mô-đun TẦNG TRỆT chọn bằng HASH NGUYÊN (uint, ihash/pidx) — groundModule() trong JS ra ĐÚNG từng bit như GPU (đã
//    kiểm 8192 mẫu trên Radeon 890M/ANGLE) → citygen biết bay nào có dải biển (SIGN_EXT của facade_atlas.js) và dựng hộp
//    biển 3D đúng chỗ. ĐỪNG đổi phần chọn mô-đun trệt trong shader mà không đổi groundModule() (và ngược lại).
//  * Ban đêm: material nằm trong world.facadeMats → daynight.js đặt emissiveIntensity = glow·0,95; shader dùng emissive.r
//    làm hệ số đêm (kính sáng ngẫu nhiên theo ô, cửa hàng + biển hiệu sáng). KHÔNG sửa daynight.js.
//  * Va chạm: lưới ô 16 m trên bbox nhà (nới 2 m) → fabricCollide(p,r) đẩy điểm ra khỏi đa giác (cạnh gần nhất).
//  * Xác định: mọi ngẫu nhiên = hash(seed nhà) — A/B chụp ảnh so được.
import * as THREE from 'three';
import { RB_B64 } from './buildings_real.js';
import {
  decodeRB, EDGE, STYLE, ROOF, WALL_PALETTE, ROOF_PALETTE, GROUND_H, FLOOR_H, PARAPET_H, heightOf,
  makeFootprintGrid, refreshPartyEdges, INFO,
} from './buildings_data.js';
import { claimAt, claimOverlapFrac } from './claims.js';
import { buildFacadeAtlas, MOD, ATLAS_N, SIGN_CELLS, SIGN_EXT, SIGN_Y } from './facade_atlas.js';
import { TIER } from './device.js';
import { ROADS_DT } from './mapdata.js';
import { ROAD_HW } from './xsection.js';
import { PANO_CAM } from './panoclear.js';

// Ô CHÍNH 450 m (tường + mái + đồ mái; ~57 ô cho R1750): đo cùng phiên 300/450/600 m — 450 giảm MỘT NỬA draw call của
// phố (pano_007 58→26, cam_spawn 38→21, kể cả lượt bóng) mà tam giác vẽ chỉ +0,01-0,05 M; 600 không lợi thêm.
// Ô CHI TIẾT 300 m (ban công, mái hiên, hộp biển, điều hoà, cột) — nhỏ hơn để LOD theo DET_R mịn.
export const FAB_TILE = 450;
export const DET_TILE = 300;
const LITE_FAB = TIER <= 1;
const DET_R = LITE_FAB ? 220 : 380;        // bán kính hiện ban công/mái hiên quanh camera (m)
const DET_RMAX = 1650;
// giải phóng mảng CPU của buffer phố sau upload GPU (dựng lại khi khôi phục ngữ cảnh) — xem cuối buildRealFabric.
// ?fabfree=0 tắt (đo heap A/B, hoặc khi cần raycast/đọc mảng các mesh fab_* để chẩn đoán).
const RELEASE_CPU = (() => { try { return new URLSearchParams(location.search).get('fabfree') !== '0'; } catch (e) { return true; } })();                     // chỉ dựng chi tiết cho nhà có tâm trong r ≤ 1650 m (BUILD_RADIUS 1600 + 50)

// ---------- dữ liệu (giải mã 1 lần, dùng chung: citygen, minimap, cell sink WP3...) ----------
let _D = null;
export function fabricData() { if (!_D) _D = decodeRB(RB_B64); return _D; }

// ---------- hash xác định ----------
function hh(a, b) { let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; }

const lin = (hex) => { const c = new THREE.Color().setHex(hex); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
const WALL_LIN = WALL_PALETTE.map(lin);
const ROOF_LIN = ROOF_PALETTE.map(lin);
const AWN_LIN = [0x3f6ea8, 0xb24a3e, 0x4f8a5c, 0xd9a03a, 0xe4ddcd, 0x2f8a8a, 0xc0392b, 0x1f4e8c].map(lin);
// tôn mái che sân thượng — vệ tinh HP: ĐỎ GỈ/nâu đỏ chủ đạo (~70%), xanh dương ~12%, xám/trắng ~12%, xanh lá ít
const TON_LIN = [0x9b4a32, 0x8e3b2c, 0xa5533e, 0x7d3a2a, 0xb0603f, 0x9b4a32, 0x6e3a2e, 0xa5533e, 0x46617f, 0x3d4f66, 0x9b9890, 0xc4c2bc, 0x4f6b55].map(lin);
const WHITE = [255, 255, 255], GREY = lin(0xd8d6d0);

// ---------- ATLAS + MATERIAL ----------
let _atlas = null, _mat = null;
const SIGN_HEX = [0xc62828, 0x1c56a0, 0x1f7a3c, 0xf2c12e, 0xe0712c, 0xf4f4f0, 0x1a2a5a, 0x7b2d7d, 0x167e7a, 0xd81b60];
function glslVec3Arr(name, hexes) {
  const v = hexes.map((h) => { const c = new THREE.Color().setHex(h); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; });
  return `const vec3 ${name}[${v.length}] = vec3[${v.length}](${v.join(',')});`;
}
function glslFloatArr(name, names) {
  const v = names.map((n) => { if (!(n in MOD)) throw new Error('citygen: thiếu mô-đun atlas ' + n); return MOD[n].toFixed(1); });
  return `const float ${name}[${v.length}] = float[${v.length}](${v.join(',')});`;
}
// Bộ mô-đun theo KIỂU (STYLE): TUBE 0, OLD 1, KTT 2, GLASS 3, VILLA 4, SHED 5, CIVIC 6. Lặp tên = tăng trọng số.
const SETS = {
  U0: ['U_SLIDE0', 'U_SLIDE0', 'U_SLIDE1', 'U_BALC0', 'U_BALC1', 'U_BALC0', 'U_CAGE', 'U_TILE', 'U_AC', 'U_AC', 'U_LOG'],
  U1: ['U_SHUT0', 'U_SHUT0', 'U_SHUT1', 'U_ARCH', 'U_BALU', 'U_CAGE', 'U_SLIDE1'],
  U2: ['U_KTT0', 'U_KTT0', 'U_KTT1', 'U_CAGE', 'U_LOG'],
  U3: ['U_CURT0', 'U_CURT1', 'U_RIB'],
  U4: ['U_VILLA', 'U_VILLA', 'U_SHUT0', 'U_ARCH', 'U_BALU'],
  U5: ['U_SHED'],
  U6: ['U_CIVIC', 'U_CIVIC', 'U_RIB'],
  // (phản biện: mặt phố liền của WP1 v1 lặp 1 kiểu kệ hàng cả dãy → thêm sửa xe/điện thoại/điện nước, bớt lặp SHOP0)
  G0: ['G_SHOP0', 'G_SHOP1', 'G_SHOP2', 'G_SHOP3', 'G_MOTO', 'G_ELEC', 'G_HARD', 'G_SHUT0', 'G_SHUT0', 'G_SHUT1', 'G_GLASS', 'G_GATE', 'G_HOME0', 'G_HOME1', 'G_SHOP2', 'G_MOTO'],
  G1: ['G_OLD', 'G_OLD', 'G_SHOP0', 'G_SHUT0', 'G_SHUT1', 'G_GATE', 'G_SHOP2', 'G_HOME0', 'G_HARD', 'G_ELEC'],
  G2: ['G_SHOP0', 'G_SHUT0', 'G_GATE', 'G_HOME0', 'G_SHOP2', 'G_HOME1', 'G_MOTO', 'G_HARD'],
  G3: ['G_GLASS', 'G_GLASS', 'G_SHOP3'],
  G4: ['G_HOME0', 'G_CIVIC'],
  G5: ['G_WARE'],
  G6: ['G_CIVIC', 'G_CIVIC', 'G_GLASS'],
  GH: ['G_HOME0', 'G_HOME0', 'G_HOME1', 'G_HOME1', 'G_SHUT0', 'G_GATE', 'G_SHUT1'],   // mặt ngõ/phố nhỏ: nhà ở
  SD: ['S_PLAIN0', 'S_PLAIN0', 'S_PLAIN0', 'S_PLAIN2', 'S_PLAIN1', 'S_WIN', 'S_WIN', 'S_BRICK', 'S_BACK'],
  BK: ['S_BACK', 'S_BACK', 'S_WIN', 'S_PLAIN0', 'S_PLAIN2', 'U_AC', 'U_LOG', 'U_SLIDE1'],
  PT: ['S_PLAIN1', 'S_PLAIN1', 'S_PLAIN0', 'S_PLAIN2', 'S_ADS', 'S_BRICK'],
};
// ---- MÔ-ĐUN TẦNG TRỆT theo HASH NGUYÊN — bản JS khớp TỪNG BIT với shader (ihash/pidx/pickGi trong makeMaterial) ----
// Dùng để biết bay nào là cửa hàng CÓ dải biển (SIGN_EXT) → dựng hộp biển 3D đúng chỗ shader vẽ biển.
// tỉ lệ "nhà ở" theo mã rc: 0 phố chính p/s/t, 1 phố nhỏ r/w, 2 ngõ h, 3 = WP1 v1 ghi công năng trệt NHÀ Ở (INFO USE_HOME: 100%)
const HOME_THR = [0.08, 0.45, 0.85, 1.0].map((p) => Math.round(p * 16777216));
function ihash(a, b) {
  let h = Math.imul(a, 0x9E3779B1) ^ Math.imul((b + 0x7F4A7C15) | 0, 0x85EBCA6B);
  h ^= h >>> 15; h = Math.imul(h, 0xC2B2AE35); h ^= h >>> 13;
  return h >>> 0;
}
const pidx = (h, n) => Math.floor(((h >>> 8) * n) / 16777216);
function groundModule(s8, bay, wide, rc, st) {
  const gk = wide ? ihash(s8 * 977 + bay, 101) : s8;
  const g1 = ihash(gk, bay * 2 + 1), g2 = ihash(gk, bay * 2 + 2);
  if ((g2 >>> 8) < HOME_THR[Math.min(3, rc)]) return SETS.GH[pidx(g1, SETS.GH.length)];
  const set = SETS['G' + Math.min(6, st)];
  return st === 5 ? set[0] : set[pidx(g1, set.length)];
}
// Atlas vẽ trong WORKER (facade_atlas_worker.js): luồng chính chỉ đăng ký thứ tự ô (MOD → shader) + cấp phát texture
// đúng kích thước tô xám tường trơn; ảnh thật về sau ~0,1-0,2 s (thường TRƯỚC khung hình đầu vì buildWorld còn chạy
// tiếp vài giây) → gán data cùng kích thước + needsUpdate (texStorage2D bất biến: KHÔNG được đổi kích thước).
// Worker lỗi/không hỗ trợ module worker → vẽ đồng bộ (fallback).
function startAtlas(size, tex) {
  const done = (data, ms, how) => {
    tex.image.data = data; tex.needsUpdate = true;
    _atlas = { size, ms, mods: Object.keys(MOD), how };
    console.log('[citygen] atlas ' + size + '² vẽ ' + Math.round(ms) + ' ms (' + how + ')');
  };
  const sync = () => { const A = buildFacadeAtlas(size); done(A.data, A.ms, 'sync'); };
  if (typeof Worker === 'undefined') { sync(); return; }
  try {
    const t0 = performance.now();
    const w = new Worker(new URL('./facade_atlas_worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      w.terminate();
      if (e.data && e.data.data && e.data.size === size) done(e.data.data, e.data.ms, 'worker ' + Math.round(performance.now() - t0) + 'ms');
      else sync();
    };
    w.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); w.terminate(); sync(); };
    w.postMessage({ size });
  } catch (e) { sync(); }
}
function makeMaterial() {
  const size = LITE_FAB ? 1024 : 2048;
  buildFacadeAtlas(size, { layoutOnly: true });     // chỉ số ô cho shader (đồng bộ, ~0 ms)
  const ph = new Uint8Array(size * size * 4);
  new Uint32Array(ph.buffer).fill(0xffdee2e2);      // RGBA (226,226,222,255) little-endian: tường trơn chờ atlas
  const tex = new THREE.DataTexture(ph, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = LITE_FAB ? 4 : 8; tex.needsUpdate = true;
  tex.name = 'fabric_atlas';
  startAtlas(size, tex);
  const m = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 });
  m.name = 'fabric_mat';
  const N = ATLAS_N, CPX = size / N;
  const pad = (3 / CPX).toFixed(5);
  const maxG = (Math.pow(2, Math.log2(CPX) - 3.5) / size).toFixed(6);   // trần mip ~ (ô còn 11 px): chống loang màu ô kề nhau
  const setsGlsl = Object.entries(SETS).map(([k, v]) => glslFloatArr(k, v)).join('\n');
  const n = (k) => SETS[k].length + '.0';
  const ni = (k) => SETS[k].length + 'u';
  m.onBeforeCompile = (sh, renderer) => {
    // WebGL1 (three r160 còn tự lùi về WebGL1 khi máy không có WebGL2): shader atlas cần GLSL ES 3.0 (uint, textureGrad,
    // mảng const) → KHÔNG tiêm; nhà vẽ trơn theo màu đỉnh (màu tường/mái), không phát sáng đêm — thà xấu còn hơn hỏng cả phố.
    if (renderer && renderer.capabilities && renderer.capabilities.isWebGL2 === false) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '').replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vec3(0.0);');
      return;
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nvarying vec4 vFac;\nvarying vec2 vFUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vFUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec4 vFac; varying vec2 vFUv;
${setsGlsl}
${glslVec3Arr('SIGNC', SIGN_HEX)}
${glslVec3Arr('WALLP', WALL_PALETTE)}
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float pickU(int st, float r){
  if (st == 1) return U1[int(r * ${n('U1')})]; if (st == 2) return U2[int(r * ${n('U2')})]; if (st == 3) return U3[int(r * ${n('U3')})];
  if (st == 4) return U4[int(r * ${n('U4')})]; if (st == 5) return U5[0]; if (st == 6) return U6[int(r * ${n('U6')})];
  return U0[int(r * ${n('U0')})];
}
// HASH NGUYÊN (uint) cho mô-đun TẦNG TRỆT: JS (groundModule) tính RA ĐÚNG Y HỆT → biết bay nào có biển để dựng hộp biển
// 3D (hash float GPU/JS lệch nhau do float32/FMA; số nguyên thì không).
uint ihash(uint a, uint b){ uint h = (a * 0x9E3779B1u) ^ ((b + 0x7F4A7C15u) * 0x85EBCA6Bu); h ^= h >> 15u; h *= 0xC2B2AE35u; h ^= h >> 13u; return h; }
int pidx(uint h, uint n){ return int(((h >> 8u) * n) >> 24u); }
float pickGi(int st, uint h){
  if (st == 1) return G1[pidx(h, ${ni('G1')})]; if (st == 2) return G2[pidx(h, ${ni('G2')})]; if (st == 3) return G3[pidx(h, ${ni('G3')})];
  if (st == 4) return G4[pidx(h, ${ni('G4')})]; if (st == 5) return G5[0]; if (st == 6) return G6[pidx(h, ${ni('G6')})];
  return G0[pidx(h, ${ni('G0')})];
}
float hat(float a, float c, float w){ return max(0.0, 1.0 - abs(a - c) / w); }`)
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
vec4 fabSample(float m, vec2 f, vec2 gx, vec2 gy){
  float N = ${N}.0, pad = ${pad};
  vec2 cell = vec2(mod(m, N), floor(m / N));
  vec2 auv = (cell + pad + f * (1.0 - 2.0 * pad)) / N;
  float sc = (1.0 - 2.0 * pad) / N;
  gx *= sc; gy *= sc;
  float lg = max(length(gx), length(gy)), mg = ${maxG};
  if (lg > mg) { gx *= mg / lg; gy *= mg / lg; }
  return textureGrad(map, auv, gx, gy);
}`)
      .replace('#include <map_fragment>', `
vec3 fabGlow = vec3(0.0);
float fabAO = 1.0;
{
  float seed = vFac.x / 255.0;
  float kf = vFac.y;
  float rc = floor(kf / 64.0); kf -= rc * 64.0;      // cấp đường trước mặt: 0 phố chính, 1 phố nhỏ, 2 ngõ
  float pitched = step(31.5, kf); kf -= pitched * 32.0;
  float wide = step(15.5, kf); kf -= wide * 16.0;
  float big = step(7.5, kf); kf -= big * 8.0;        // nhà LỚN/CAO/độc lập: tường hông + sau cũng có cửa sổ đều
  int kind = int(kf + 0.5);
  if (kind == 6) kind = 1;                            // mặt trước HỘP BIỂN 3D (ô gần) = vẽ y hệt mặt phố phía sau nó
  int st = int(vFac.z + 0.5);
  vec2 q = vFUv;
  vec2 f; float m; vec2 dq = vec2(1.0);
  vec3 tint = vColor;
  float isG = 0.0, signSeed = 0.0, litP = 0.58, hh = 0.0, fu = 0.0, cellKey = 0.0, roofVar = 1.0;
  if (kind <= 3) {
    float floors = max(vFac.w, 1.0);
    hh = max(q.y, 0.0);
    float Htop = ${GROUND_H.toFixed(2)} + (floors - 1.0) * ${FLOOR_H.toFixed(2)};
    float fl, fv, shh;
    if (hh < ${GROUND_H.toFixed(2)}) { fl = 0.0; fv = hh / ${GROUND_H.toFixed(2)}; shh = ${GROUND_H.toFixed(2)}; }
    else if (hh < Htop) { float t = (hh - ${GROUND_H.toFixed(2)}) / ${FLOOR_H.toFixed(2)}; fl = 1.0 + floor(t); fv = fract(t); shh = ${FLOOR_H.toFixed(2)}; }
    else if (pitched > 0.5) { fl = floors; fv = fract((hh - Htop) / ${FLOOR_H.toFixed(2)}); shh = ${FLOOR_H.toFixed(2)}; }
    else { fl = floors; fv = min((hh - Htop) / ${PARAPET_H.toFixed(2)}, 0.999); shh = ${PARAPET_H.toFixed(2)}; }
    float bay = floor(q.x); fu = fract(q.x);
    dq = vec2(1.0, 1.0 / shh);
    float bs = seed;
    if (wide > 0.5 && kind == 1) {               // dãy nhà ống gộp: mỗi bay = 1 nhà (màu + mô-đun riêng)
      bs = h21(vec2(seed * 13.7 + bay * 1.37, 0.71));
      if (h21(vec2(bs, 5.5)) > 0.25) tint = WALLP[int(h21(vec2(bs, 9.1)) * 23.99)];
    }
    if (fl >= floors - 0.01) {
      if (pitched > 0.5) m = SD[0];
      else m = ((st == 1 || st == 4) && h21(vec2(bs * 7.1, 3.3)) < 0.5) ? ${MOD.P_BALU}.0 : ${MOD.P_PLAIN}.0;
    } else if (kind == 1) {
      if (fl < 0.5) {
        uint sI = uint(vFac.x + 0.5), bI = uint(max(bay, 0.0));
        uint gk = wide > 0.5 ? ihash(sI * 977u + bI, 101u) : sI;
        uint g1 = ihash(gk, bI * 2u + 1u), g2 = ihash(gk, bI * 2u + 2u);
        uint thr = rc > 2.5 ? ${HOME_THR[3]}u : rc > 1.5 ? ${HOME_THR[2]}u : (rc > 0.5 ? ${HOME_THR[1]}u : ${HOME_THR[0]}u);
        bool home = (g2 >> 8u) < thr;
        m = home ? GH[pidx(g1, ${ni('GH')})] : pickGi(st, g1);
        isG = 1.0; signSeed = h21(vec2(bs * 17.3 + bay * 3.1, 2.9)); litP = home ? 0.45 : 0.25;
      }
      else {
        float mainR = h21(vec2(bs * 13.1, 1.0)), altR = h21(vec2(bs * 7.3, 2.0));
        float r = h21(vec2(bs * 3.7 + fl * 1.31, bay * 0.71 + 0.3)) < 0.8 ? mainR : altR;
        m = pickU(st, r);
      }
    } else if (kind == 3) m = PT[int(h21(vec2(seed * 5.3 + bay * 0.21, floor(fl * 0.5) + 0.4)) * ${n('PT')})];
    else if (big > 0.5 && fl > 0.5 && st != 5) {   // tháp/chung cư/biệt thự/công sở: mọi mặt có cửa sổ (mô-đun chính 80%)
      float mainR = h21(vec2(seed * 13.1, 1.0)), altR = h21(vec2(seed * 7.3, 2.0));
      float r = h21(vec2(seed * 3.7 + fl * 1.31, bay * 0.71 + 0.3)) < 0.8 ? mainR : altR;
      m = (h21(vec2(seed * 2.9 + bay * 0.61, float(kind) + 0.5)) < 0.12) ? SD[0] : pickU(st, r);   // ~12% bay trơn (lõi thang)
    }
    else if (kind == 2) m = BK[int(h21(vec2(seed * 9.7 + bay * 0.53, fl * 0.77 + 0.2)) * ${n('BK')})];
    else {
      float r = h21(vec2(seed * 31.3 + bay * 0.5, fl * 0.13 + 0.1));
      m = (h21(vec2(seed, 9.0)) < 0.45) ? SD[0] : SD[int(r * ${n('SD')})];
      if (st == 5) m = ${MOD.U_SHED}.0;
    }
    f = vec2(fu, fv);
    cellKey = bay * 7.0 + fl * 13.0;
    fabAO = mix(0.62, 1.0, smoothstep(0.0, 1.7, hh));
  } else {
    m = vFac.z; f = fract(q);
    if (kind == 5) fabAO = 0.92;
    if (kind == 4) roofVar = mix(0.78, 1.14, h21(vec2(seed * 7.7, 3.1)));   // mỗi mái 1 độ sáng (vệ tinh: mảng loang)
  }
  vec2 gx = dFdx(q) * dq, gy = dFdy(q) * dq;
  vec4 tx = fabSample(m, f, gx, gy);
  float a = tx.a;
  float wW = clamp((a - 0.80) / 0.12, 0.0, 1.0);
  float gW = hat(a, 0.75, 0.125), kW = hat(a, 0.5, 0.125), sW = hat(a, 0.25, 0.125), tW = clamp((0.125 - a) / 0.125, 0.0, 1.0);
  vec3 signCol = SIGNC[int(signSeed * 9.99)];
  vec3 textCol = dot(signCol, vec3(0.3, 0.55, 0.15)) > 0.42 ? vec3(0.45, 0.03, 0.02) : (signSeed > 0.6 ? vec3(1.0, 0.86, 0.2) : vec3(1.0));
  if (isG > 0.5 && sW + tW > 0.02) {           // dải biển hiệu: phủ chữ từ SIGN_CELLS×4 dải (ô SIGN0..)
    float fvS = clamp((hh - 2.95) / 0.9, 0.0, 0.999);
    float si = floor(signSeed * ${(SIGN_CELLS * 4 - 0.01).toFixed(2)});
    float sm = ${MOD.SIGN0}.0 + floor(si / 4.0);
    vec2 sk = vec2(1.0, ${(GROUND_H / 3.6).toFixed(4)});      // dv(dải) = dh/0,9/4 ; gy.y đang là dh/GROUND_H
    vec4 t2 = fabSample(sm, vec2(fu, (mod(si, 4.0) + fvS) / 4.0), gx * sk, gy * sk);
    float a2 = t2.a;
    float sW2 = hat(a2, 0.25, 0.125), tW2 = clamp((0.125 - a2) / 0.125, 0.0, 1.0), kW2 = hat(a2, 0.5, 0.125);
    vec3 sc = (sW2 * t2.rgb * signCol * 1.15 + tW2 * textCol + kW2 * t2.rgb) / max(sW2 + tW2 + kW2, 1e-3);
    float ss = sW + tW;
    tx.rgb = mix(tx.rgb, sc, ss); sW = 0.0; tW = 0.0; kW += ss;
    fabGlow += sc * 0.45 * ss;
  }
  float sum = max(wW + gW + kW + sW + tW, 1e-3);
  vec3 col = (wW * tx.rgb * tint * 1.25 + (gW + kW) * tx.rgb + sW * tx.rgb * signCol * 1.15 + tW * textCol) / sum;
  diffuseColor.rgb *= col * roofVar;
  // ĐÊM: kính sáng ngẫu nhiên theo ô cửa; cửa hàng trệt sáng gần hết
  // ánh đèn nhân với chính texture (rèm/nội thất/hàng hoá vẫn đọc được, không thành ô trắng loá)
  float lit = step(litP, h21(vec2(seed * 31.7 + cellKey, 4.1)));
  vec3 warm = vec3(1.0, 0.76, 0.46);
  fabGlow += (gW / sum) * lit * warm * (0.18 + tx.rgb * 1.1) + isG * (kW / sum) * lit * (tx.rgb * 0.9 + warm * 0.06);
}`)
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fabGlow * emissive.r;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= fabAO; reflectedLight.directDiffuse *= mix(1.0, fabAO, 0.35);');
  };
  m.customProgramCacheKey = () => 'fabric_v1_' + size;
  _mat = m;
  return m;
}
export function fabricMaterial() { return _mat || makeMaterial(); }
export function fabricAtlasInfo() { return _atlas ? { size: _atlas.size, ms: Math.round(_atlas.ms), cells: _atlas.mods.length, how: _atlas.how } : null; }

// ---------- bộ đệm hình học tăng dần (typed array) ----------
class GBuf {
  constructor(cap = 8192) {
    this.n = 0; this.ni = 0; this.cap = cap; this.icap = cap * 2;
    this.P = new Float32Array(cap * 3); this.Nn = new Int8Array(cap * 3); this.U = new Float32Array(cap * 2);
    this.Cc = new Uint8Array(cap * 3); this.F = new Uint8Array(cap * 4); this.I = new Uint32Array(this.icap);
  }
  growV() {
    const c = this.cap * 2, g = (A, k) => { const B = new A.constructor(c * k); B.set(A); return B; };
    this.P = g(this.P, 3); this.Nn = g(this.Nn, 3); this.U = g(this.U, 2); this.Cc = g(this.Cc, 3); this.F = g(this.F, 4); this.cap = c;
  }
  v(x, y, z, nx, ny, nz, u, w, col, f0, f1, f2, f3) {
    if (this.n >= this.cap) this.growV();
    const i = this.n, i3 = i * 3, i2 = i * 2, i4 = i * 4;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z;
    this.Nn[i3] = Math.round(nx * 127); this.Nn[i3 + 1] = Math.round(ny * 127); this.Nn[i3 + 2] = Math.round(nz * 127);
    this.U[i2] = u; this.U[i2 + 1] = w;
    this.Cc[i3] = col[0]; this.Cc[i3 + 1] = col[1]; this.Cc[i3 + 2] = col[2];
    this.F[i4] = f0; this.F[i4 + 1] = f1; this.F[i4 + 2] = f2; this.F[i4 + 3] = f3;
    return this.n++;
  }
  t(a, b, c) {
    if (this.ni + 3 > this.icap) { const B = new Uint32Array(this.icap * 2); B.set(this.I); this.I = B; this.icap *= 2; }
    this.I[this.ni++] = a; this.I[this.ni++] = b; this.I[this.ni++] = c;
  }
  // quad phẳng 4 đỉnh (thứ tự CCW nhìn từ phía pháp tuyến)
  quad(p, nx, ny, nz, uv, col, f0, f1, f2, f3) {
    const a = this.v(p[0], p[1], p[2], nx, ny, nz, uv[0], uv[1], col, f0, f1, f2, f3);
    this.v(p[3], p[4], p[5], nx, ny, nz, uv[2], uv[3], col, f0, f1, f2, f3);
    this.v(p[6], p[7], p[8], nx, ny, nz, uv[4], uv[5], col, f0, f1, f2, f3);
    this.v(p[9], p[10], p[11], nx, ny, nz, uv[6], uv[7], col, f0, f1, f2, f3);
    this.t(a, a + 1, a + 2); this.t(a, a + 2, a + 3);
  }
  geometry() {
    if (!this.n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.Nn.slice(0, this.n * 3), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.slice(0, this.n * 2), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.Cc.slice(0, this.n * 3), 3, true));
    g.setAttribute('aFac', new THREE.BufferAttribute(this.F.slice(0, this.n * 4), 4, false));
    const idx = this.n < 65536 ? Uint16Array.from(this.I.subarray(0, this.ni)) : this.I.slice(0, this.ni);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

// cột THÉP GÓC (chữ L, 2 cánh — đúng loại thép V hàn cột mái tôn; 4 tam giác thay vì lăng trụ 3 mặt 6 tam giác): mũi L ở
// (x,z)+o·r, 2 cánh xoay ±45° quanh hướng VÀO (−o), mặt ngoài nhìn ra phía o (phố) — từ trong mái không ai thấy.
function steelPost(G, x, z, yB, yT, r, ox, oz, s8) {
  const tx = x + ox * r, tz = z + oz * r, ix = -ox * Math.SQRT1_2, iz = -oz * Math.SQRT1_2, w = r * 2;
  for (const sg of [1, -1]) {
    const ex = tx + (ix - sg * iz) * w, ez = tz + (iz + sg * ix) * w;   // đầu cánh (hướng vào xoay ±45°)
    let ax = tx, az = tz, bx = ex, bz = ez;
    if (-(bz - az) * ox + (bx - ax) * oz < 0) { ax = ex; az = ez; bx = tx; bz = tz; }   // pháp tuyến (−dz,dx) của A→B phải hướng ra o
    const nx = -(bz - az), nz = bx - ax, l = Math.hypot(nx, nz) || 1;
    G.quad([ax, yB, az, bx, yB, bz, bx, yT, bz, ax, yT, az], nx / l, 0, nz / l, [0, 0, 0.05, 0, 0.05, 1, 0, 1], WHITE, s8, 5, MOD.D_SIGNF, 0);
  }
}

// ---------- hình học 2D ----------
function pip(X, Z, n, px, pz) {
  let c = false;
  for (let i = 0, j = n - 1; i < n; j = i++) if ((Z[i] > pz) !== (Z[j] > pz) && px < ((X[j] - X[i]) * (pz - Z[i])) / (Z[j] - Z[i]) + X[i]) c = !c;
  return c;
}
function isConvex(X, Z, n) {
  let sg = 0;
  for (let i = 0; i < n; i++) {
    const a = i, b = (i + 1) % n, c = (i + 2) % n;
    const cr = (X[b] - X[a]) * (Z[c] - Z[b]) - (Z[b] - Z[a]) * (X[c] - X[b]);
    if (Math.abs(cr) < 1e-6) continue;
    const s = cr > 0 ? 1 : -1; if (!sg) sg = s; else if (s !== sg) return false;
  }
  return true;
}
const _v2 = [];
function triangulate(X, Z, n) {   // → mảng chỉ số tam giác (đa giác lồi: quạt; còn lại: earcut của three)
  if (n === 3) return [0, 1, 2];
  if (isConvex(X, Z, n)) { const o = []; for (let i = 1; i < n - 1; i++) o.push(0, i, i + 1); return o; }
  while (_v2.length < n) _v2.push(new THREE.Vector2());
  const ct = []; for (let i = 0; i < n; i++) ct.push(_v2[i].set(X[i], Z[i]));
  const tr = THREE.ShapeUtils.triangulateShape(ct, []);
  const o = []; for (const t of tr) o.push(t[0], t[1], t[2]);
  return o;
}
// cắt đa giác bởi nửa mặt phẳng s·(d) ≥ 0, d = (x−ox)·vx + (z−oz)·vz  (Sutherland–Hodgman)
function clipHalf(X, Z, n, ox, oz, vx, vz, sgn) {
  const OX = [], OZ = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const di = sgn * ((X[i] - ox) * vx + (Z[i] - oz) * vz), dj = sgn * ((X[j] - ox) * vx + (Z[j] - oz) * vz);
    if (di >= 0) { OX.push(X[i]); OZ.push(Z[i]); }
    if ((di >= 0) !== (dj >= 0)) { const t = di / (di - dj); OX.push(X[i] + (X[j] - X[i]) * t); OZ.push(Z[i] + (Z[j] - Z[i]) * t); }
  }
  return [OX, OZ];
}

// ---------- cấp đường TRƯỚC mặt tiền: phố chính p/s/t → cửa hàng; phố nhỏ r/w → nửa ở nửa buôn; ngõ h → nhà ở ----------
const RG = 32;
let _rgrid = null;
function roadGrid() {
  if (_rgrid) return _rgrid;
  _rgrid = new Map();
  for (const r of ROADS_DT) for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], hw = ROAD_HW[r.c] ?? 2.75, pad = hw + 16;
    const seg = [ax, az, bx, bz, hw, r.c === 'h' ? 2 : (r.c === 'r' || r.c === 'w') ? 1 : 0];
    for (let gi = Math.floor((Math.min(ax, bx) - pad) / RG); gi <= Math.floor((Math.max(ax, bx) + pad) / RG); gi++)
      for (let gj = Math.floor((Math.min(az, bz) - pad) / RG); gj <= Math.floor((Math.max(az, bz) + pad) / RG); gj++) {
        const k = gi * 65536 + gj; let l = _rgrid.get(k); if (!l) _rgrid.set(k, (l = [])); l.push(seg);
      }
  }
  return _rgrid;
}
function frontClass(mx, mz, nx, nz) {
  const px = mx + nx * 5, pz = mz + nz * 5, l = roadGrid().get(Math.floor(px / RG) * 65536 + Math.floor(pz / RG));
  if (!l) return 0;
  let best = 1e9, cls = 0;
  for (const s of l) {
    const dx = s[2] - s[0], dz = s[3] - s[1], L2 = dx * dx + dz * dz || 1e-9;
    let t = ((px - s[0]) * dx + (pz - s[1]) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - s[0] - dx * t, pz - s[1] - dz * t) - s[4];
    if (d < best) { best = d; cls = s[5]; }
  }
  return cls;
}
// Cạnh SIDE/BACK của nhà LÙI khỏi phố (dữ liệu chỉ gắn FRONT khi lòng đường cách ≤ ~6,5 m sau mặt tiền chuẩn) mà nhìn thẳng
// ra một lòng đường trong 26 m KHÔNG bị nhà khác che → coi là MẶT PHỐ (cửa hàng/cửa nhà + cửa sổ thay vì tường hông trơn:
// pano_085 Lạch Tray — dãy nhà lùi 10-20 m quay tường trống ra phố). Trả cấp đường (0/1/2) hoặc −1. Cần lưới va chạm (fabricAt).
function faceRoad(ax, az, bx, bz, nx, nz, b) {
  const G = roadGrid();
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  const l = G.get(Math.floor((mx + nx * 13) / RG) * 65536 + Math.floor((mz + nz * 13) / RG)); if (!l) return -1;
  // lọc nhanh: phải có đoạn đường PHÍA TRƯỚC cạnh (tích vô hướng với pháp tuyến > 0) và trong ~27 m
  let any = false;
  for (const sg of l) {
    const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1e-9;
    let u = ((mx - sg[0]) * dx + (mz - sg[1]) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const cx = sg[0] + dx * u - mx, cz = sg[1] + dz * u - mz;
    if (cx * nx + cz * nz > 0 && cx * cx + cz * cz < (27 + sg[4]) ** 2 + 400) { any = true; break; }
  }
  if (!any) return -1;
  for (const t of [0.5, 0.25, 0.75]) {
    const px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
    let hitD = -1, cls = 0;
    for (let d = 1; d <= 26 && hitD < 0; d += 1.5) {
      const qx = px + nx * d, qz = pz + nz * d;
      for (const sg of l) {
        const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1e-9;
        let u = ((qx - sg[0]) * dx + (qz - sg[1]) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
        if ((qx - sg[0] - dx * u) ** 2 + (qz - sg[1] - dz * u) ** 2 < sg[4] * sg[4]) { hitD = d; cls = sg[5]; break; }
      }
    }
    if (hitD < 0) continue;
    let blocked = false;
    for (let d = 0.6; d < hitD - 0.4 && !blocked; d += 1.2) { const o = fabricAt(px + nx * d, pz + nz * d); if (o >= 0 && o !== b) blocked = true; }
    if (!blocked) return cls;
  }
  return -1;
}

// ---------- va chạm ----------
const CG = 16;
let _cgrid = null, _cbb = null;
const ckey = (i, j) => (i + 32768) * 65536 + (j + 32768);
function buildCollision(D) {
  _cgrid = new Map(); _cbb = new Float32Array(D.nB * 4);
  for (let b = 0; b < D.nB; b++) {
    if (D.dead[b]) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) { const x = D.x[v], z = D.z[v]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    _cbb[b * 4] = x0; _cbb[b * 4 + 1] = z0; _cbb[b * 4 + 2] = x1; _cbb[b * 4 + 3] = z1;
    for (let i = Math.floor((x0 - 2) / CG); i <= Math.floor((x1 + 2) / CG); i++)
      for (let j = Math.floor((z0 - 2) / CG); j <= Math.floor((z1 + 2) / CG); j++) {
        const k = ckey(i, j); let a = _cgrid.get(k); if (!a) _cgrid.set(k, (a = [])); a.push(b);
      }
  }
}
// đẩy điểm p {x,z} ra ngoài mọi footprint (bán kính r). 2 lượt (góc nhà, khe giữa 2 nhà).
export function fabricCollide(p, r = 0.45) {
  if (!_cgrid) return false;
  const D = _D; let moved = false;
  for (let pass = 0; pass < 2; pass++) {
    const list = _cgrid.get(ckey(Math.floor(p.x / CG), Math.floor(p.z / CG))); if (!list) return moved;
    let any = false;
    for (let li = 0; li < list.length; li++) {
      const b = list[li], o = b * 4;
      if (p.x < _cbb[o] - r || p.x > _cbb[o + 2] + r || p.z < _cbb[o + 1] - r || p.z > _cbb[o + 3] + r) continue;
      const s = D.vStart[b], e = D.vStart[b + 1];
      let inside = false, best = 1e9, qx = 0, qz = 0, nx = 0, nz = 0;
      for (let v = s, w = e - 1; v < e; w = v++) {
        const ax = D.x[w], az = D.z[w], bx = D.x[v], bz = D.z[v];
        if ((az > p.z) !== (bz > p.z) && p.x < ((bx - ax) * (p.z - az)) / (bz - az) + ax) inside = !inside;
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + dx * t, cz = az + dz * t, d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
        if (d2 < best) { best = d2; qx = cx; qz = cz; const L = Math.sqrt(L2); nx = -dz / L; nz = dx / L; }
      }
      // cạnh w→v của mảng gốc là (p_{i-1} → p_i): pháp tuyến ngoài (−dz, dx)/L theo quy ước RB01
      if (inside) {
        // ra theo cạnh gần nhất KHÔNG dẫn sang nhà kề (tường chung): thử mọi cạnh theo khoảng cách tăng dần
        let ox = qx + nx * (r + 0.02), oz = qz + nz * (r + 0.02);
        if (fabricAt(ox, oz) >= 0) {
          const cands = [];
          for (let v = s, w = e - 1; v < e; w = v++) {
            const ax = D.x[w], az = D.z[w], dx = D.x[v] - ax, dz = D.z[v] - az, L2 = dx * dx + dz * dz || 1e-9, L = Math.sqrt(L2);
            let t = ((p.x - ax) * dx + (p.z - az) * dz) / L2; t = t < 0.02 ? 0.02 : t > 0.98 ? 0.98 : t;
            const cx = ax + dx * t, cz = az + dz * t;
            cands.push([(p.x - cx) ** 2 + (p.z - cz) ** 2, cx - (dz / L) * (r + 0.02), cz + (dx / L) * (r + 0.02)]);
          }
          cands.sort((a1, b1) => a1[0] - b1[0]);
          let found = false;
          for (const c of cands) if (fabricAt(c[1], c[2]) < 0) { ox = c[1]; oz = c[2]; found = true; break; }
          // lô KÍN (mọi cạnh giáp nhà khác — dữ liệu v1 dày đặc): xoắn ốc tìm điểm trống gần nhất (hiếm, chỉ khi kẹt)
          for (let rad = 1; !found && rad <= 40; rad += 1) {
            const na = Math.max(8, Math.round(rad * 2.5));
            for (let a = 0; a < na; a++) {
              const ang = (a / na) * Math.PI * 2, x = p.x + Math.cos(ang) * rad, z = p.z + Math.sin(ang) * rad;
              if (fabricAt(x, z) < 0) { ox = x; oz = z; found = true; break; }
            }
          }
        }
        p.x = ox; p.z = oz; moved = any = true;
      }
      else if (best < r * r) {
        const d = Math.sqrt(best) || 1e-6;
        p.x = qx + ((p.x - qx) / d) * r; p.z = qz + ((p.z - qz) / d) * r; moved = any = true;
      }
    }
    if (!any) break;
  }
  return moved;
}
// điểm nằm TRONG hoặc cách footprint < r? (chỉ nhà thật — không tính collider tròn)
export function fabricHit(x, z, r = 0.5) { return fabricCollide({ x, z }, r); }
// chỉ số nhà chứa điểm (−1 nếu không) — dùng cho kiểm tra vị trí đặt
export function fabricAt(x, z) {
  if (!_cgrid) return -1;
  const list = _cgrid.get(ckey(Math.floor(x / CG), Math.floor(z / CG))); if (!list) return -1;
  const D = _D;
  for (const b of list) {
    const o = b * 4; if (x < _cbb[o] || x > _cbb[o + 2] || z < _cbb[o + 1] || z > _cbb[o + 3]) continue;
    let c = false; const s = D.vStart[b], e = D.vStart[b + 1];
    for (let v = s, w = e - 1; v < e; w = v++) if ((D.z[v] > z) !== (D.z[w] > z) && x < ((D.x[w] - D.x[v]) * (z - D.z[v])) / (D.z[w] - D.z[v]) + D.x[v]) c = !c;
    if (c) return b;
  }
  return -1;
}

// ======================================================================================
// buildRealFabric(scene, ctx) — ctx: { groundHeightNoDeck(x,z), landH, reject(cx,cz) → true = bỏ nhà (vùng mở/hàm
// zone của world.js), maxR (bỏ nhà có tâm ngoài bán kính này — world.js truyền BUILD_RADIUS: ngoài vùng chơi không có
// đường/vỉa → nhà đứng trên cỏ trống), facadeMats (mảng để daynight điều khiển đêm), log }
// Trả { stats, meshes, detMeshes, collide: fabricCollide, at: fabricAt, hit, frontEdges, material, grid }.
// grid = makeFootprintGrid(fabricData()) dựng SAU khi chốt D.dead (near/at bỏ nhà dead) — world.js đặt world.rbData /
// world.rbGrid = D / grid để WP4 cây, WP7 props, WP8 camera dùng CHUNG (không giải mã lại, tôn trọng nhà đã bị gỡ).
export function buildRealFabric(scene, ctx) {
  const T0 = performance.now();
  const D = fabricData();
  const gh = ctx.groundHeightNoDeck, LAND_H = ctx.landH ?? 2;
  const tDecode = performance.now() - T0;
  // ---------- 1) LOẠI NHÀ dưới vùng giữ chỗ (claims) + zone hàm của world.js ----------
  const st = { total: D.nB, deadPre: 0, deadFar: 0, deadClaim: 0, deadZone: 0, deadWater: 0, deadPano: 0, built: 0, walls: 0, roofs: 0, tris: 0, detTris: 0, balc: 0, awn: 0, signBox: 0, signBay: 0, tanks: 0, tums: 0, canopy: 0, ac: 0, promoted: 0, tWall: 0, tRoof: 0, tPar: 0 };
  const CX = new Float32Array(D.nB), CZ = new Float32Array(D.nB);
  const pts = [];
  // điểm camera pano THẬT (xe Street View chạy trên LÒNG ĐƯỜNG): footprint nào chứa/sát (<0,5 m) điểm này là lệch đăng ký
  // hoặc đè đường → bỏ (WP1 v1 sẽ cắt đĩa 3 m quanh các điểm này offline; đây là lưới an toàn cho dữ liệu bất kỳ).
  const PG = 16, panoG = new Map();
  for (const [x, z] of PANO_CAM) { const k = ckey(Math.floor(x / PG), Math.floor(z / PG)); let l = panoG.get(k); if (!l) panoG.set(k, (l = [])); l.push(x, z); }
  const panoHit = (s, n, x0, z0, x1, z1) => {
    for (let i = Math.floor((x0 - 0.5) / PG); i <= Math.floor((x1 + 0.5) / PG); i++)
      for (let j = Math.floor((z0 - 0.5) / PG); j <= Math.floor((z1 + 0.5) / PG); j++) {
        const l = panoG.get(ckey(i, j)); if (!l) continue;
        for (let q = 0; q < l.length; q += 2) {
          const px = l[q], pz = l[q + 1];
          if (px < x0 - 0.5 || px > x1 + 0.5 || pz < z0 - 0.5 || pz > z1 + 0.5) continue;
          let c = false, d2 = 1e9;
          for (let v = 0, w = n - 1; v < n; w = v++) {
            const ax = D.x[s + w], az = D.z[s + w], bx = D.x[s + v], bz = D.z[s + v];
            if ((bz > pz) !== (az > pz) && px < ((ax - bx) * (pz - bz)) / (az - bz) + bx) c = !c;
            const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
            let t = ((px - ax) * dx + (pz - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
            const e2 = (px - ax - dx * t) ** 2 + (pz - az - dz * t) ** 2; if (e2 < d2) d2 = e2;
          }
          if (c || d2 < 0.25) return true;
        }
      }
    return false;
  };
  const maxR2 = ctx.maxR ? ctx.maxR * ctx.maxR : 0;
  for (let b = 0; b < D.nB; b++) {
    const s = D.vStart[b], e = D.vStart[b + 1], n = e - s;
    // tâm diện tích + bbox
    let A = 0, cx = 0, cz = 0, x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, xa = D.x[s + i], za = D.z[s + i], xb = D.x[s + j], zb = D.z[s + j], c = xa * zb - xb * za; A += c; cx += (xa + xb) * c; cz += (za + zb) * c;
      if (xa < x0) x0 = xa; if (xa > x1) x1 = xa; if (za < z0) z0 = za; if (za > z1) z1 = za;
    }
    if (Math.abs(A) < 1e-6) { cx = D.x[s]; cz = D.z[s]; } else { cx /= 3 * A; cz /= 3 * A; }
    CX[b] = cx; CZ[b] = cz;
    if (D.dead[b]) { st.deadPre++; continue; }
    if (maxR2 && cx * cx + cz * cz > maxR2) { D.dead[b] = 1; st.deadFar++; continue; }
    if (ctx.reject && ctx.reject(cx, cz)) { D.dead[b] = 1; st.deadZone++; continue; }
    if (panoHit(s, n, x0, z0, x1, z1)) { D.dead[b] = 1; st.deadPano++; continue; }
    if (claimAt(cx, cz)) { D.dead[b] = 1; st.deadClaim++; continue; }
    pts.length = n; for (let i = 0; i < n; i++) pts[i] = [D.x[s + i], D.z[s + i]];
    if (claimOverlapFrac(pts) > 0.2) { D.dead[b] = 1; st.deadClaim++; continue; }
    if (gh(cx, cz) < LAND_H - 1.2) { D.dead[b] = 1; st.deadWater++; continue; }
  }
  // TƯỜNG CHUNG sau khi giết nhà (hợp đồng WP1 v1, js/buildings_data.js): cạnh PARTY của nhà SỐNG mà láng giềng che đã
  // bị giết → hạ thành BACK/SIDE (dựng cả chân tường) — không thì nhà kề nhà bị giết thiếu chân tường = lỗ nhìn xuyên.
  // Rà quanh MỌI nhà dead (kể cả nhà WP3/ai khác giết trước khi gọi buildRealFabric).
  const grid = makeFootprintGrid(D);
  { const killed = []; for (let b = 0; b < D.nB; b++) if (D.dead[b]) killed.push(b);
    const r = refreshPartyEdges(D, grid, killed); st.partyDemoted = r.demoted; st.partyLowered = r.lowered; }
  buildCollision(D);   // lưới va chạm ngay sau khi chốt D.dead — faceRoad (bên dưới) cần fabricAt
  const tClaims = performance.now() - T0 - tDecode;
  const mat = fabricMaterial();
  if (ctx.facadeMats) ctx.facadeMats.push(mat);
  const tAtlas = performance.now() - T0 - tDecode - tClaims;

  // ---------- 2) DỰNG theo ô ----------
  // gen() = toàn bộ hình học (XÁC ĐỊNH từ D + D.dead đã chốt) → gọi lại được khi khôi phục ngữ cảnh WebGL (bản CPU của
  // buffer đã bị giải phóng sau upload, xem RELEASE_CPU bên dưới). (thân hàm giữ thụt lề cũ cho diff gọn)
  const frontEdges = [];   // [x0,z0,x1,z1,nx,nz,yBase,b] — biển hiệu thật (SHOP_SIGNS) neo vào đây
  const gen = (st, frontEdges) => {
  const tiles = new Map(), dtiles = new Map();
  const tileOf = (cx, cz) => {
    const tx = Math.floor(cx / FAB_TILE), tz = Math.floor(cz / FAB_TILE), k = tx * 4096 + tz;
    let t = tiles.get(k); if (!t) tiles.set(k, (t = { tx, tz, buf: new GBuf(16384) })); return t.buf;
  };
  const detOf = (cx, cz) => {
    if (LITE_FAB) return null;
    const tx = Math.floor(cx / DET_TILE), tz = Math.floor(cz / DET_TILE), k = tx * 4096 + tz;
    let t = dtiles.get(k); if (!t) dtiles.set(k, (t = { tx, tz, buf: new GBuf(4096) })); return t.buf;
  };
  const X = new Float64Array(256), Z = new Float64Array(256), Y = new Float64Array(256), TD = new Float64Array(256);
  const K_ROOF = 4, K_DET = 5;
  // dữ liệu WP1 v1 mang công năng tầng trệt từng nhà (INFO bit 4-5); v0 toàn 0 → bỏ qua
  let hasInfo = false; if (D.info) for (let b = 0; b < D.nB && !hasInfo; b++) if (D.info[b]) hasInfo = true;
  const C_CONC = MOD.R_CONC, C_TERR = MOD.R_TERR, C_TON = MOD.R_TON, C_TILE = MOD.R_TILE, C_PLAIN = MOD.D_PLAIN;

  for (let b = 0; b < D.nB; b++) {
    if (D.dead[b]) continue;
    const s = D.vStart[b], n = Math.min(255, D.vStart[b + 1] - s);
    if (n < 3) continue;
    for (let i = 0; i < n; i++) { X[i] = D.x[s + i]; Z[i] = D.z[s + i]; }
    const fl = Math.max(1, D.floors[b]), H = heightOf(fl);
    const sty = Math.min(6, D.style[b]), roofT = D.roof[b] & 15, roofC = (D.roof[b] >> 4) % ROOF_LIN.length;
    const seed = D.seed[b], s8 = seed & 255;
    const wcol = WALL_LIN[D.wall[b] % WALL_LIN.length], rcol = ROOF_LIN[roofC];
    let y0 = 1e9; for (let i = 0; i < n; i++) { const g = gh(X[i], Z[i]); if (g < y0) y0 = g; }
    if (!(y0 > LAND_H - 1.2)) y0 = LAND_H;     // (chân tường chôn 0,3 m dưới y0 — ys = −0,3 bên dưới: không hở khe trên dốc nhẹ)
    // chi tiết gần chỉ cho nhà trong vùng chơi (+50 m): ngoài đó người chơi không bao giờ tới gần (ngân sách tam giác)
    const M = tileOf(CX[b], CZ[b]), DT = CX[b] * CX[b] + CZ[b] * CZ[b] < DET_RMAX * DET_RMAX ? detOf(CX[b], CZ[b]) : null;
    // khung OBB theo cạnh dài nhất
    let best = 0, ux = 1, uz = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, L = Math.hypot(X[j] - X[i], Z[j] - Z[i]); if (L > best) { best = L; ux = (X[j] - X[i]) / L; uz = (Z[j] - Z[i]) / L; } }
    const vx = -uz, vz = ux;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (let i = 0; i < n; i++) { const u = X[i] * ux + Z[i] * uz, v = X[i] * vx + Z[i] * vz; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const Lu = u1 - u0, Lv = v1 - v0, uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
    // trục nóc mái = cạnh DÀI của OBB
    let rx = ux, rz = uz, px = vx, pz = vz, hw = Lv / 2, Lr = Lu, pc = vc;
    if (Lv > Lu) { rx = vx; rz = vz; px = -ux; pz = -uz; hw = Lu / 2; Lr = Lv; pc = -uc; }
    const areaPoly = (() => { let a = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n; a += X[i] * Z[j] - X[j] * Z[i]; } return Math.abs(a / 2); })();
    const rectness = areaPoly / Math.max(1e-6, Lu * Lv);
    let rt = roofT;
    if (rt === ROOF.HIP_TILE && (rectness < 0.85 || n > 6)) rt = ROOF.GABLE_TON;
    if ((rt === ROOF.GABLE_TON || rt === ROOF.SHED_TON) && (hw < 1.2 || hw > 22)) rt = ROOF.FLAT;
    const pitched = rt === ROOF.GABLE_TON || rt === ROOF.SHED_TON;
    // độ cao đỉnh tường (tương đối chân nhà y0)
    let rise = 0, dmin = 1e9, dmax = -1e9;
    for (let i = 0; i < n; i++) { const d = X[i] * px + Z[i] * pz - pc; TD[i] = d; if (d < dmin) dmin = d; if (d > dmax) dmax = d; }
    if (rt === ROOF.GABLE_TON) rise = Math.min(3.2, Math.max(0.9, hw * 0.36));
    else if (rt === ROOF.SHED_TON) rise = Math.min(2.2, Math.max(0.6, (dmax - dmin) * 0.18));
    else if (rt === ROOF.HIP_TILE) rise = Math.min(4.5, Math.max(1.2, hw * 0.58));
    const topH = rt === ROOF.FLAT_PARAPET ? H + PARAPET_H : rt === ROOF.FLAT ? H + 0.25 : H;
    const topAt = (d) => rt === ROOF.GABLE_TON ? H + rise * Math.max(0, 1 - Math.abs(d) / Math.max(hw, 1e-3))
      : rt === ROOF.SHED_TON ? H + rise * (d - dmin) / Math.max(1e-3, dmax - dmin) : topH;
    for (let i = 0; i < n; i++) Y[i] = topAt(TD[i]);
    const pitchFlag = pitched ? 32 : 0;
    // NHÀ LỚN/CAO/độc lập (tháp ≥5 tầng, chung cư, biệt thự, công sở, khối ≥600 m² từ 3 tầng): tường hông + sau cũng có cửa sổ đều (cờ +8);
    // nhà ống nhỏ giữ tường hông trơn (thực tế: tường chung/tường lửa trơn, ít ô thoáng). Nhà ≥9 tầng mà dữ liệu ghi
    // "nhà ống/phố cũ" → mô-đun CHUNG CƯ (KTT) hoặc VĂN PHÒNG KÍNH (GLASS) theo hạt giống — tháp 20 tầng mang mô-đun
    // nhà ống trông giả.
    const bigFlag = (fl >= 5 || (areaPoly >= 600 && fl >= 3) || sty === STYLE.KTT || sty === STYLE.GLASS || sty === STYLE.CIVIC || sty === STYLE.VILLA) ? 8 : 0;
    const styF = fl >= 9 && (sty === STYLE.TUBE || sty === STYLE.OLD) ? (hh(seed, 5) < 0.6 ? STYLE.KTT : STYLE.GLASS) : sty;
    // ---- TƯỜNG ----
    let hasFront = false, fnx = 0, fnz = 0, fL = 0;   // pháp tuyến cạnh mặt phố DÀI nhất (hướng tum thang / mái tôn che)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = X[i], az = Z[i], bx = X[j], bz = Z[j];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 0.05) continue;
      const nx = -dz / L, nz = dx / L;
      let kind = D.edge[s + i]; if (kind > 3) kind = 0;
      if (kind === EDGE.FRONT && L < 2.2) kind = EDGE.SIDE;
      const cover = D.edgeCover[s + i];
      let rcP = -1;   // ≥0: cạnh hông/sau được NÂNG thành mặt phố (faceRoad)
      if ((kind === EDGE.SIDE || kind === EDGE.BACK) && cover === 0 && L >= 3 && sty !== STYLE.SHED) {
        rcP = faceRoad(ax, az, bx, bz, nx, nz, b);
        if (rcP >= 0) { kind = EDGE.FRONT; st.promoted++; }
      }
      let ys = -0.3;
      if (cover > 0) { if (cover >= fl && !pitched) continue; ys = heightOf(Math.min(cover, fl)) - 0.15; }
      const bayW = kind === EDGE.FRONT ? 4.2 : 4.0, nb = Math.max(1, Math.round(L / bayW));
      // dãy nhà ống gộp (mỗi bay 1 nhà) — KHÔNG áp cho cạnh được nâng (đó là hông của MỘT nhà)
      const wideF = kind === EDGE.FRONT && rcP < 0 && nb >= 3 && fl <= 5 && (styF === STYLE.TUBE || styF === STYLE.OLD) ? 16 : 0;
      let rc = rcP >= 0 ? rcP : kind === EDGE.FRONT ? frontClass((ax + bx) / 2, (az + bz) / 2, nx, nz) : 0;
      if (hasInfo && kind === EDGE.FRONT && rcP < 0 && !wideF) { const use = (D.info[b] >> INFO.USE_SHIFT) & 3; if (use === INFO.USE_HOME) rc = 3; else if (use === INFO.USE_SHOP) rc = 0; }
      const kb = kind | bigFlag | wideF | pitchFlag | (rc << 6);
      const ta = Y[i], tb = Y[j];
      const a0 = M.v(ax, y0 + ys, az, nx, 0, nz, 0, ys, wcol, s8, kb, styF, fl);
      M.v(bx, y0 + ys, bz, nx, 0, nz, nb, ys, wcol, s8, kb, styF, fl);
      M.v(bx, y0 + tb, bz, nx, 0, nz, nb, tb, wcol, s8, kb, styF, fl);
      if (rt === ROOF.GABLE_TON && TD[i] * TD[j] < 0) {   // cạnh cắt đường nóc → đỉnh hồi
        const tt = TD[i] / (TD[i] - TD[j]);
        M.v(ax + dx * tt, y0 + H + rise, az + dz * tt, nx, 0, nz, nb * tt, H + rise, wcol, s8, kb, styF, fl);
        M.v(ax, y0 + ta, az, nx, 0, nz, 0, ta, wcol, s8, kb, styF, fl);
        M.t(a0, a0 + 1, a0 + 2); M.t(a0, a0 + 2, a0 + 3); M.t(a0, a0 + 3, a0 + 4);
        st.tris += 3; st.tWall += 3;
      } else {
        M.v(ax, y0 + ta, az, nx, 0, nz, 0, ta, wcol, s8, kb, styF, fl);
        M.t(a0, a0 + 1, a0 + 2); M.t(a0, a0 + 2, a0 + 3);
        st.tris += 2; st.tWall += 2;
      }
      st.walls++;
      if (kind === EDGE.FRONT) {
        if (L > fL) { fL = L; fnx = nx; fnz = nz; }
        hasFront = true;
        frontEdges.push([ax, az, bx, bz, nx, nz, y0, b]);
        // ---- HỘP BIỂN HIỆU 3D (ô gần): đúng các bay mà shader vẽ dải biển (groundModule khớp bit với GPU) ----
        // Mặt trước = kind 6 → shader vẽ Y HỆT mặt phố phía sau (chữ/màu biển/đèn đêm) nhưng lồi ra 0,22 m; 2 mặt đầu
        // = khung tôn tối D_SIGNF. Xa hơn DET_R: biển phẳng trong atlas (cùng hình) — không "nhảy" khi đổi LOD.
        // NGÂN SÁCH (dữ liệu WP1 v1 ~29 k biển): các bay LIỀN NHAU cùng có dải biển kín bay (ext tới mép) GỘP thành 1 hộp
        // (mặt trước 1 quad kéo qua nhiều bay — shader tự chia bay theo uv.x; khe 2,5 cm giữa 2 biển hiện là viền tường);
        // không mặt TRÊN (ở 3,85 m) và không mặt ĐÁY (dải 0,22 m ở 2,95 m: từ mắt 1,6 m chỉ thấy ≤ 2-3 px, khe hở lộ chính
        // dải biển cùng màu vẽ trên tường phía sau) → 6 tam giác / hộp gộp (trước: 8 / bay).
        if (DT && cover === 0) {
          const bw = L / nb, ex = dx / L, ez = dz / L, BD = 0.22, yb = y0 + SIGN_Y[0], yt = y0 + SIGN_Y[1], h1 = SIGN_Y[1] - SIGN_Y[0];
          const kbBox = 6 | bigFlag | wideF | pitchFlag | (rc << 6);
          let runA = -1, runB = -1;
          const emit = () => {
            const fa = runA, fb = runB, sA = fa * bw, sB = fb * bw;
            const p0x = ax + ex * sA, p0z = az + ez * sA, p1x = ax + ex * sB, p1z = az + ez * sB;
            const q0x = p0x + nx * BD, q0z = p0z + nz * BD, q1x = p1x + nx * BD, q1z = p1z + nz * BD, d4 = BD / 4;
            DT.quad([q0x, yb, q0z, q1x, yb, q1z, q1x, yt, q1z, q0x, yt, q0z], nx, 0, nz, [fa, SIGN_Y[0], fb, SIGN_Y[0], fb, SIGN_Y[1], fa, SIGN_Y[1]], wcol, s8, kbBox, styF, fl);
            DT.quad([p0x, yb, p0z, q0x, yb, q0z, q0x, yt, q0z, p0x, yt, p0z], -ex, 0, -ez, [0, 0, d4, 0, d4, h1, 0, h1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
            DT.quad([q1x, yb, q1z, p1x, yb, p1z, p1x, yt, p1z, q1x, yt, q1z], ex, 0, ez, [0, 0, d4, 0, d4, h1, 0, h1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
            st.detTris += 6; st.signBox++;
            runA = -1;
          };
          for (let k = 0; k < nb; k++) {
            const ext = SIGN_EXT[groundModule(s8, k, wideF > 0, rc, styF)];
            if (!ext) { if (runA >= 0) emit(); continue; }
            const fa = k + ext[0] / 4, fb = k + ext[1] / 4;
            if (runA >= 0 && (runB < k - 0.1 / 4 || ext[0] > 0.1)) emit();   // không liền mép → đóng hộp cũ
            if (runA < 0) runA = fa;
            runB = fb; st.signBay++;
          }
          if (runA >= 0) emit();
        }
        // ---- CỤC NÓNG ĐIỀU HOÀ 3D (ô gần): treo CAO trên tường mỗi tầng trên (đáy +2,58 m, đỉnh +3,12 m — dưới mép
        //      sàn ban công tầng trên +3,18 m → không cắt ban công/lan can), lồi 0,3 m; ~14% bay nhà ống, 21% KTT ----
        if (DT && cover === 0 && fl >= 2 && L >= 2.4 && sty !== STYLE.GLASS && sty !== STYLE.SHED) {
          const pAC = sty === STYLE.KTT ? 0.21 : (sty === STYLE.TUBE || sty === STYLE.OLD) ? 0.14 : 0.07;   // (v1: ×0,7 — ngân sách)
          const bw = L / nb, ex = dx / L, ez = dz / L, AW = 0.82, AH = 0.54, AD = 0.3;
          for (let k = 1; k < fl; k++) for (let q = 0; q < nb; q++) {
            if (hh(seed * 31 + k, 97 + q) >= pAC) continue;
            const sA = q * bw + 0.12 + hh(seed + q, 131 + k) * Math.max(0, bw - AW - 0.24), sB = sA + AW;
            const yb = y0 + heightOf(k) + 2.58, yt = yb + AH;
            const p0x = ax + ex * sA, p0z = az + ez * sA, p1x = ax + ex * sB, p1z = az + ez * sB;
            const q0x = p0x + nx * AD, q0z = p0z + nz * AD, q1x = p1x + nx * AD, q1z = p1z + nz * AD;
            const SU = [0, 0, 0.05, 0, 0.05, 1, 0, 1];   // mặt bên/trên/dưới: dải vỏ máy trơn ở mép trái ô D_AC
            DT.quad([q0x, yb, q0z, q1x, yb, q1z, q1x, yt, q1z, q0x, yt, q0z], nx, 0, nz, [0, 0, 1, 0, 1, 1, 0, 1], WHITE, s8, K_DET, MOD.D_AC, 0);
            DT.quad([p0x, yb, p0z, p1x, yb, p1z, q1x, yb, q1z, q0x, yb, q0z], 0, -1, 0, SU, WHITE, s8, K_DET, MOD.D_AC, 0);
            DT.quad([p0x, yb, p0z, q0x, yb, q0z, q0x, yt, q0z, p0x, yt, p0z], -ex, 0, -ez, SU, WHITE, s8, K_DET, MOD.D_AC, 0);
            DT.quad([q1x, yb, q1z, p1x, yb, p1z, p1x, yt, p1z, q1x, yt, q1z], ex, 0, ez, SU, WHITE, s8, K_DET, MOD.D_AC, 0);
            st.detTris += 8; st.ac++;   // không mặt trên (ngân sách)
          }
        }
        // ---- CHI TIẾT MẶT PHỐ (ô gần): ban công + mái hiên ----
        if (DT && L >= 2.8 && L <= 18 && sty !== STYLE.GLASS && sty !== STYLE.SHED) {
          const r1 = hh(seed, 11 + i);
          const balcP = sty === STYLE.TUBE ? 0.62 : sty === STYLE.OLD ? 0.5 : sty === STYLE.VILLA ? 0.45 : sty === STYLE.KTT ? 0.3 : 0.15;
          if (fl >= 2 && r1 < balcP) {
            const inset = 0.2, depth = sty === STYLE.OLD || sty === STYLE.VILLA ? 0.75 : 0.95;
            const sx0 = ax + (dx / L) * inset, sz0 = az + (dz / L) * inset, sx1 = bx - (dx / L) * inset, sz1 = bz - (dz / L) * inset;
            const wl = L - 2 * inset;
            const railCell = (sty === STYLE.OLD || hh(seed, 23) < 0.45) ? MOD.D_RAIL : MOD.D_BALW;
            const topSkip = hh(seed, 29) < 0.5 ? 1 : 0;   // tầng trên cùng hay là sân thượng lùi → bỏ
            for (let k = 1; k < fl - (fl > 2 ? topSkip : 0); k++) {
              const ys0 = y0 + heightOf(k) - 0.12, yt = ys0 + 0.15;   // sàn tầng k (tầng trên thứ k)
              const fx0 = sx0 + nx * depth, fz0 = sz0 + nz * depth, fx1 = sx1 + nx * depth, fz1 = sz1 + nz * depth;
              const cP = C_PLAIN;
              // mặt đáy, lan can ngoài, 2 đầu. KHÔNG mặt trên: lan can 1,2 m che kín sàn sâu ≤0,95 m với mọi góc nhìn dốc
              // < ~52° (mắt phố nhìn từ dưới lên càng không thấy); KHÔNG mặt trong lan can (chỉ thấy từ trong nhà) — ngân sách v1
              DT.quad([sx0, ys0, sz0, sx1, ys0, sz1, fx1, ys0, fz1, fx0, ys0, fz0], 0, -1, 0, [0, 0, wl / 4, 0, wl / 4, depth / 4, 0, depth / 4], GREY, s8, K_DET, cP, 0);
              const rh = 1.05;
              DT.quad([fx0, ys0, fz0, fx1, ys0, fz1, fx1, yt + rh, fz1, fx0, yt + rh, fz0], nx, 0, nz, [0, 0, wl / 4, 0, wl / 4, 1, 0, 1], wcol, s8, K_DET, railCell, 0);
              // (mặt TRONG lan can bỏ: chỉ thấy được từ phía trong nhà/trên mái — ngân sách tam giác dữ liệu v1)
              const ex = dx / L, ez = dz / L;
              DT.quad([sx0, ys0, sz0, fx0, ys0, fz0, fx0, yt + rh, fz0, sx0, yt + rh, sz0], -ex, 0, -ez, [0, 0, depth / 4, 0, depth / 4, 1, 0, 1], wcol, s8, K_DET, railCell, 0);
              DT.quad([fx1, ys0, fz1, sx1, ys0, sz1, sx1, yt + rh, sz1, fx1, yt + rh, fz1], ex, 0, ez, [0, 0, depth / 4, 0, depth / 4, 1, 0, 1], wcol, s8, K_DET, railCell, 0);
              st.detTris += 8; st.balc++;
            }
          }
          if ((sty === STYLE.TUBE || sty === STYLE.OLD || sty === STYLE.KTT) && hh(seed, 41 + i) < 0.35) {   // mái hiên bạt sọc
            const ac = AWN_LIN[(hh(seed, 43) * AWN_LIN.length) | 0];
            const out = 1.5, yT = y0 + 2.88, yF = y0 + 2.4, inset = 0.15;
            const sx0 = ax + (dx / L) * inset, sz0 = az + (dz / L) * inset, sx1 = bx - (dx / L) * inset, sz1 = bz - (dz / L) * inset;
            const fx0 = sx0 + nx * out, fz0 = sz0 + nz * out, fx1 = sx1 + nx * out, fz1 = sz1 + nz * out;
            const sl = Math.hypot(out, yT - yF), ny = out / sl, nh = (yT - yF) / sl, wl = L - 2 * inset;
            DT.quad([sx1, yT, sz1, sx0, yT, sz0, fx0, yF, fz0, fx1, yF, fz1], nx * nh, ny, nz * nh, [0, 1, wl / 4, 1, wl / 4, 0, 0, 0], ac, s8, K_DET, MOD.D_AWN, 0);
            DT.quad([sx0, yT - 0.02, sz0, sx1, yT - 0.02, sz1, fx1, yF - 0.02, fz1, fx0, yF - 0.02, fz0], -nx * nh, -ny, -nz * nh, [0, 1, wl / 4, 1, wl / 4, 0, 0, 0], ac, s8, K_DET, MOD.D_AWN, 0);
            DT.quad([fx0, yF - 0.3, fz0, fx1, yF - 0.3, fz1, fx1, yF, fz1, fx0, yF, fz0], nx, 0, nz, [0, 0, wl / 4, 0, wl / 4, 0.19, 0, 0.19], ac, s8, K_DET, MOD.D_AWN, 0);
            st.detTris += 6; st.awn++;
          }
        }
      }
    }
    // ---- MÁI ----
    const roofY = y0 + (rt === ROOF.FLAT ? H + 0.25 : H);
    if (rt === ROOF.FLAT_PARAPET || rt === ROOF.FLAT) {
      // sàn mái: gạch lá nem đỏ (giữ màu) ~50% nhà ống / bê tông xám (nhuộm màu mái) — nhà lớn hầu hết bê tông
      const cell = hh(seed, 3) < (areaPoly < 300 ? 0.45 : 0.15) ? C_TERR : C_CONC;
      const tri = triangulate(X, Z, n), base = M.n;
      for (let i = 0; i < n; i++) M.v(X[i], roofY, Z[i], 0, 1, 0, (X[i] * ux + Z[i] * uz) / 4, (X[i] * vx + Z[i] * vz) / 4, rcol, s8, K_ROOF, cell, 0);
      for (let k = 0; k < tri.length; k += 3) {
        const a = tri[k], bb = tri[k + 1], c = tri[k + 2];
        const ny = (Z[bb] - Z[a]) * (X[c] - X[a]) - (X[bb] - X[a]) * (Z[c] - Z[a]);
        if (ny >= 0) M.t(base + a, base + bb, base + c); else M.t(base + a, base + c, base + bb);
      }
      st.tris += tri.length / 3; st.tRoof += tri.length / 3;
      if (rt === ROOF.FLAT_PARAPET) {     // mặt TRONG lan can (nhìn từ trên/xiên thấy gờ mái)
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n, L = Math.hypot(X[j] - X[i], Z[j] - Z[i]); if (L < 0.3) continue;
          if (D.edgeCover[s + i] >= fl) continue;
          const nx = (Z[j] - Z[i]) / L, nz = -(X[j] - X[i]) / L;   // hướng VÀO trong
          const ya = roofY, yt2 = y0 + H + PARAPET_H;
          M.quad([X[j], ya, Z[j], X[i], ya, Z[i], X[i], yt2, Z[i], X[j], yt2, Z[j]], nx, 0, nz, [0, 0, L / 4, 0, L / 4, PARAPET_H / 4, 0, PARAPET_H / 4], wcol, s8, K_DET, C_PLAIN, 0);
          st.tris += 2; st.tPar += 2;
        }
      }
    } else if (rt === ROOF.GABLE_TON || rt === ROOF.SHED_TON) {
      const cell = C_TON, ox = px * pc, oz = pz * pc;   // điểm trên đường nóc (d=0)
      const kSlope = rt === ROOF.GABLE_TON ? rise / Math.max(hw, 1e-3) : rise / Math.max(1e-3, dmax - dmin);
      const sec = Math.sqrt(1 + kSlope * kSlope);
      const halves = rt === ROOF.GABLE_TON ? [1, -1] : [0];
      for (const sg of halves) {
        let HX, HZ, hn;
        if (sg) { [HX, HZ] = clipHalf(X, Z, n, ox, oz, px, pz, sg); hn = HX.length; } else { HX = Array.from(X.subarray(0, n)); HZ = Array.from(Z.subarray(0, n)); hn = n; }
        if (hn < 3) continue;
        // pháp tuyến mặt phẳng mái: y = H + rise(1 − sg·d/hw) (hồi) | H + k(d − dmin) (mái đơn)
        let nnx, nnz; if (sg) { nnx = px * sg * kSlope; nnz = pz * sg * kSlope; } else { nnx = -px * kSlope; nnz = -pz * kSlope; }
        const nl = Math.hypot(nnx, 1, nnz);
        const HXa = new Float64Array(HX), HZa = new Float64Array(HZ);
        const tri = triangulate(HXa, HZa, hn), base = M.n;
        for (let i = 0; i < hn; i++) {
          const d = HX[i] * px + HZ[i] * pz - pc, yy = y0 + topAt(d);
          M.v(HX[i], yy, HZ[i], nnx / nl, 1 / nl, nnz / nl, (HX[i] * rx + HZ[i] * rz) / 4, Math.abs(d) * sec / 4, rcol, s8, K_ROOF, cell, 0);
        }
        for (let k = 0; k < tri.length; k += 3) {
          const a = tri[k], bb = tri[k + 1], c = tri[k + 2];
          const ny = (HZ[bb] - HZ[a]) * (HX[c] - HX[a]) - (HX[bb] - HX[a]) * (HZ[c] - HZ[a]);
          if (ny >= 0) M.t(base + a, base + bb, base + c); else M.t(base + a, base + c, base + bb);
        }
        st.tris += tri.length / 3; st.tRoof += tri.length / 3;
      }
    } else if (rt === ROOF.HIP_TILE) {     // mái ngói 4 dốc trên OBB (nhà gần chữ nhật) + đua mái 0,35 m
      const o = 0.35, hwx = hw + o, hl = Lr / 2 + o, inset = Math.min(hl - 0.1, hw * 0.9);
      // tâm OBB theo khung (u,v) → thế giới
      const cxw = ux * uc + vx * vc, czw = uz * uc + vz * vc;
      const yE = y0 + H - o * (rise / Math.max(hw, 1e-3)), yR = y0 + H + rise;
      const P = (a, c) => [cxw + rx * a + px * c, czw + rz * a + pz * c];
      const c00 = P(-hl, -hwx), c10 = P(hl, -hwx), c11 = P(hl, hwx), c01 = P(-hl, hwx), r0 = P(-hl + inset, 0), r1 = P(hl - inset, 0);
      const k1 = rise / Math.max(hw, 1e-3), sec = Math.sqrt(1 + k1 * k1);
      const face = (pa, cell) => {   // pa: [[x,z,y],...] đa giác phẳng → quạt, pháp tuyến theo tích có hướng
        const base = M.n;
        const ax = pa[1][0] - pa[0][0], ay = pa[1][2] - pa[0][2], az = pa[1][1] - pa[0][1];
        const bx2 = pa[2][0] - pa[0][0], by2 = pa[2][2] - pa[0][2], bz2 = pa[2][1] - pa[0][1];
        let nx = ay * bz2 - az * by2, ny = az * bx2 - ax * bz2, nz = ax * by2 - ay * bx2; const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l; const flip = ny < 0;
        for (const q of pa) M.v(q[0], q[2], q[1], flip ? -nx : nx, flip ? -ny : ny, flip ? -nz : nz, (q[0] * rx + q[1] * rz) / 4, ((q[0] - cxw) * px + (q[1] - czw) * pz) * sec / 4, rcol, s8, K_ROOF, cell, 0);
        for (let k = 1; k < pa.length - 1; k++) { if (flip) M.t(base, base + k + 1, base + k); else M.t(base, base + k, base + k + 1); }
        st.tris += pa.length - 2; st.tRoof += pa.length - 2;
      };
      face([[c00[0], c00[1], yE], [c10[0], c10[1], yE], [r1[0], r1[1], yR], [r0[0], r0[1], yR]], C_TILE);
      face([[c11[0], c11[1], yE], [c01[0], c01[1], yE], [r0[0], r0[1], yR], [r1[0], r1[1], yR]], C_TILE);
      face([[c10[0], c10[1], yE], [c11[0], c11[1], yE], [r1[0], r1[1], yR]], C_TILE);
      face([[c01[0], c01[1], yE], [c00[0], c00[1], yE], [r0[0], r0[1], yR]], C_TILE);
    }
    st.roofs++;
    // ---- ĐỒ TRÊN MÁI BẰNG (nhà ống): tum thang, bồn inox, mái tôn che sân thượng, máy nước nóng ----
    if (rt === ROOF.FLAT_PARAPET && areaPoly < 900 && sty !== STYLE.GLASS && sty !== STYLE.SHED) {
      const inside = (a, c) => { const x = ux * a + vx * c, z = uz * a + vz * c; return pip(X, Z, n, x, z); };
      const W = (a, c) => [ux * a + vx * c, uz * a + vz * c];
      // hướng "sau" dọc trục u: ngược mặt phố
      const fu = hasFront ? fnx * ux + fnz * uz : 0, fv = hasFront ? fnx * vx + fnz * vz : 1;
      const alongU = Math.abs(fu) >= Math.abs(fv);
      const backSign = alongU ? (fu > 0 ? -1 : 1) : (fv > 0 ? -1 : 1);
      const yRoof = y0 + H;
      let tum = null;
      if (fl >= 3 && Lu >= 6 && Lv >= 3.2 && hh(seed, 51) < 0.45) {   // tum thang ~45%
        const tw = Math.min(3.0, (alongU ? Lv : Lu) * 0.8), td = Math.min(3.4, (alongU ? Lu : Lv) * 0.4), th = 2.7;
        const a = alongU ? (backSign > 0 ? u1 - td / 2 - 0.3 : u0 + td / 2 + 0.3) : uc;
        const c = alongU ? vc : (backSign > 0 ? v1 - td / 2 - 0.3 : v0 + td / 2 + 0.3);
        const ha = alongU ? td / 2 : tw / 2, hc = alongU ? tw / 2 : td / 2;
        if (inside(a - ha, c - hc) && inside(a + ha, c - hc) && inside(a + ha, c + hc) && inside(a - ha, c + hc)) {
          tum = [a, c, ha, hc, th];
          const cs = [W(a - ha, c - hc), W(a + ha, c - hc), W(a + ha, c + hc), W(a - ha, c + hc)];
          const yt3 = yRoof + th;
          for (let k = 0; k < 4; k++) {
            const A2 = cs[k], B2 = cs[(k + 1) % 4], L = Math.hypot(B2[0] - A2[0], B2[1] - A2[1]);
            let nx = -(B2[1] - A2[1]) / L, nz = (B2[0] - A2[0]) / L;
            // cs theo chiều (u,v) CCW-trong-hệ-u,v; hệ (u,v)=(u, u⊥) có thể lật → kiểm hướng ra ngoài
            const mx = (A2[0] + B2[0]) / 2 - W(a, c)[0], mz = (A2[1] + B2[1]) / 2 - W(a, c)[1];
            let pA = A2, pB = B2; if (nx * mx + nz * mz < 0) { pA = B2; pB = A2; nx = -nx; nz = -nz; }
            const facesFront = hasFront && (nx * fnx + nz * fnz) > 0.7;
            M.quad([pA[0], yRoof, pA[1], pB[0], yRoof, pB[1], pB[0], yt3, pB[1], pA[0], yt3, pA[1]], nx, 0, nz,
              facesFront ? [0, 0, 1, 0, 1, 1, 0, 1] : [0, 0, L / 4, 0, L / 4, th / 4, 0, th / 4], wcol, s8, K_DET, facesFront ? MOD.D_DOOR : C_PLAIN, 0);
          }
          const tb = M.n;
          for (const q of cs) M.v(q[0], yt3, q[1], 0, 1, 0, q[0] / 4, q[1] / 4, rcol, s8, K_ROOF, C_CONC, 0);
          const ny = (cs[1][1] - cs[0][1]) * (cs[2][0] - cs[0][0]) - (cs[1][0] - cs[0][0]) * (cs[2][1] - cs[0][1]);
          if (ny >= 0) { M.t(tb, tb + 1, tb + 2); M.t(tb, tb + 2, tb + 3); } else { M.t(tb, tb + 2, tb + 1); M.t(tb, tb + 3, tb + 2); }
          st.tris += 10; st.tums++;
        }
      }
      // bồn nước inox (lăng trụ 5 cạnh đứng: 13 tam giác — 6 cạnh 16 tam giác là món trang trí đắt nhất phố với dữ liệu v1;
      // nhìn từ trên/xiên không phân biệt) — trên nóc tum nếu có (rất phổ biến), không thì 1 góc mái
      if ((sty === STYLE.TUBE || sty === STYLE.OLD || sty === STYLE.KTT) && hh(seed, 61) < 0.7) {
        let a, c, yB;
        if (tum) { a = tum[0]; c = tum[1]; yB = yRoof + tum[4]; }
        else { a = uc + (hh(seed, 63) - 0.5) * Math.max(0, Lu - 2.2); c = vc + (hh(seed, 65) - 0.5) * Math.max(0, Lv - 2.2); yB = yRoof; }
        if (inside(a, c)) {
          const [tx, tz] = W(a, c), rr = 0.57, th = 1.25, base = M.n, NS = 5, a0 = hh(seed, 67) * 1.2566;
          for (let k = 0; k <= NS; k++) {
            const ang = a0 + (k / NS) * Math.PI * 2, cxk = Math.cos(ang), szk = Math.sin(ang);
            M.v(tx + cxk * rr, yB, tz + szk * rr, cxk, 0, szk, k / NS, 0, WHITE, s8, K_DET, MOD.D_TANK, 0);
            M.v(tx + cxk * rr, yB + th, tz + szk * rr, cxk, 0, szk, k / NS, 1, WHITE, s8, K_DET, MOD.D_TANK, 0);
          }
          for (let k = 0; k < NS; k++) { const i0 = base + k * 2; M.t(i0, i0 + 1, i0 + 3); M.t(i0, i0 + 3, i0 + 2); }
          const cb = M.n;
          for (let k = 0; k < NS; k++) { const ang = a0 + (k / NS) * Math.PI * 2; M.v(tx + Math.cos(ang) * rr, yB + th, tz + Math.sin(ang) * rr, 0, 1, 0, 0.5 + Math.cos(ang) * 0.1, 0.5, WHITE, s8, K_DET, MOD.D_TANK, 0); }
          for (let k = 1; k < NS - 1; k++) M.t(cb, cb + k + 1, cb + k);
          st.tris += 13; st.tanks++;
        }
      }
      // mái tôn che sân thượng (vệ tinh HP: mảng tôn đỏ gỉ/xanh phủ phần lớn mái nhà ống)
      if (hh(seed, 71) < (areaPoly < 300 ? 0.7 : 0.4) && Lu >= 4 && Lv >= 3) {
        const along = alongU ? Lu : Lv, frac = 0.55 + hh(seed, 73) * 0.4;
        const maxLen = tum ? along - 2 * (alongU ? tum[2] : tum[3]) - 1.1 : along - 0.8;   // không đâm vào tum thang
        const len = Math.min(maxLen, Math.max(2.5, along * frac));
        const startA = alongU ? (backSign > 0 ? u0 + 0.4 : u1 - 0.4 - len) : uc;
        const startC = alongU ? vc : (backSign > 0 ? v0 + 0.4 : v1 - 0.4 - len);
        const halfW = ((alongU ? Lv : Lu) - 0.6) / 2;
        let cs;
        if (alongU) cs = [[startA, vc - halfW], [startA + len, vc - halfW], [startA + len, vc + halfW], [startA, vc + halfW]];
        else cs = [[uc - halfW, startC], [uc + halfW, startC], [uc + halfW, startC + len], [uc - halfW, startC + len]];
        if (len >= 2 && cs.every(([a, c]) => inside(a, c))) {
          const col = TON_LIN[(hh(seed, 75) * TON_LIN.length) | 0];
          const yLo = yRoof + PARAPET_H + 1.6, yHi = yLo + 0.6;
          const w = cs.map(([a, c]) => W(a, c));
          // dốc nhẹ theo trục dài (cao phía tum)
          const yv = alongU ? [backSign > 0 ? yLo : yHi, backSign > 0 ? yHi : yLo] : [yLo, yLo];
          const ys = alongU ? [yv[0], yv[1], yv[1], yv[0]] : [backSign > 0 ? yLo : yHi, backSign > 0 ? yLo : yHi, backSign > 0 ? yHi : yLo, backSign > 0 ? yHi : yLo];
          const base = M.n;
          for (let k = 0; k < 4; k++) M.v(w[k][0], ys[k], w[k][1], 0, 1, 0, (alongU ? cs[k][1] : cs[k][0]) / 4, (alongU ? cs[k][0] : cs[k][1]) / 4, col, s8, K_ROOF, C_TON, 0);
          for (let k = 0; k < 4; k++) M.v(w[k][0], ys[k] - 0.03, w[k][1], 0, -1, 0, (alongU ? cs[k][1] : cs[k][0]) / 4, (alongU ? cs[k][0] : cs[k][1]) / 4, col, s8, K_ROOF, C_TON, 0);
          const ny = (w[1][1] - w[0][1]) * (w[2][0] - w[0][0]) - (w[1][0] - w[0][0]) * (w[2][1] - w[0][1]);
          if (ny >= 0) { M.t(base, base + 1, base + 2); M.t(base, base + 2, base + 3); M.t(base + 4, base + 6, base + 5); M.t(base + 4, base + 7, base + 6); }
          else { M.t(base, base + 2, base + 1); M.t(base, base + 3, base + 2); M.t(base + 4, base + 5, base + 6); M.t(base + 4, base + 6, base + 7); }
          st.tris += 4; st.canopy++;
          if (DT) {   // 2 cột thép đỡ ở 2 góc PHÍA PHỐ (ô gần) — không có thì nhìn từ phố mái tôn "bay lơ lửng"; mép sau tựa tum/tường sau
            const ccx = (w[0][0] + w[2][0]) / 2, ccz = (w[0][1] + w[2][1]) / 2;
            const fk = alongU ? (backSign > 0 ? [0, 3] : [1, 2]) : (backSign > 0 ? [0, 1] : [2, 3]);
            for (const k of fk) {
              const ddx = ccx - w[k][0], ddz = ccz - w[k][1], dl = Math.hypot(ddx, ddz) || 1;
              steelPost(DT, w[k][0] + (ddx / dl) * 0.2, w[k][1] + (ddz / dl) * 0.2, yRoof, ys[k] - 0.03, 0.06, -ddx / dl, -ddz / dl, s8);
            }
            st.detTris += 8;
          }
        }
      }
      // máy nước nóng năng lượng mặt trời (nghiêng về NAM = +z)
      if (hh(seed, 81) < 0.1 && Lu >= 4) {
        const a = uc + (hh(seed, 83) - 0.5) * Math.max(0, Lu - 2.5), c = vc + (hh(seed, 85) - 0.5) * Math.max(0, Lv - 2.5);
        if (inside(a - 1, c - 1) && inside(a + 1, c + 1) && inside(a - 1, c + 1) && inside(a + 1, c - 1)) {
          const [sx, sz] = W(a, c), yB = y0 + H + 0.3, base = M.n, hwp = 1.0, d = 0.65, hgt = 0.75;
          const qq = [[sx - hwp, yB, sz + d], [sx + hwp, yB, sz + d], [sx + hwp, yB + hgt, sz - d], [sx - hwp, yB + hgt, sz - d]];
          const nl = Math.hypot(2 * d, hgt);
          for (let k = 0; k < 4; k++) M.v(qq[k][0], qq[k][1], qq[k][2], 0, (2 * d) / nl, hgt / nl, [0, 1, 1, 0][k], [0, 0, 1, 1][k], WHITE, s8, K_DET, MOD.D_SOLAR, 0);
          M.t(base, base + 1, base + 2); M.t(base, base + 2, base + 3);
          st.tris += 2;
        }
      }
    }
    st.built++;
  }
  return { tiles, dtiles };
  };
  const { tiles, dtiles } = gen(st, frontEdges);
  const tGeo = performance.now() - T0 - tDecode - tClaims - tAtlas;

  // ---------- 3) MESH theo ô ----------
  const meshes = [], detMeshes = [];
  let calls = 0, triMain = 0, triDet = 0;
  for (const [key, t] of tiles) {
    const g = t.buf.geometry();
    if (g) {
      const m = new THREE.Mesh(g, mat); m.name = `fab_main_${t.tx},${t.tz}`; m.userData.fabKey = key;
      m.castShadow = true; m.receiveShadow = true; m.userData.noMerge = true; m.matrixAutoUpdate = false;
      scene.add(m); meshes.push(m); calls++; triMain += g.index.count / 3;
    }
  }
  for (const [key, t] of dtiles) {
    const gd = t.buf.geometry();
    if (gd) {
      const m = new THREE.Mesh(gd, mat); m.name = `fab_det_${t.tx}_${t.tz}`; m.userData.fabKey = key;
      m.castShadow = true; m.receiveShadow = true; m.userData.noMerge = true; m.matrixAutoUpdate = false;
      m.userData.fabTile = [(t.tx + 0.5) * DET_TILE, (t.tz + 0.5) * DET_TILE];
      m.visible = false;
      scene.add(m); detMeshes.push(m); triDet += gd.index.count / 3;
    }
  }
  // GIẢI PHÓNG BẢN CPU của mọi buffer phố SAU KHI upload GPU (onUpload → array = null): ~30 B/đỉnh + chỉ số. Mất/khôi phục
  // ngữ cảnh WebGL (three dựng lại mọi buffer từ .array) → 'webglcontextrestored' trên canvas #scene: chạy lại gen() (xác
  // định, ~0,5-1 s) và thay geometry từng ô TRƯỚC khung hình kế. Ô det chưa từng hiện thì chưa upload → còn giữ mảng.
  // BẪY: sau khi giải phóng, KHÔNG được raycast/computeBounding*/đọc .array các mesh 'fab_*' (bbox/sphere tính sẵn).
  if (RELEASE_CPU) {
    const freeArr = function () { this.array = null; };
    const release = (g) => { for (const k in g.attributes) g.attributes[k].onUpload(freeArr); if (g.index) g.index.onUpload(freeArr); };
    for (const m of meshes) release(m.geometry);
    for (const m of detMeshes) release(m.geometry);
    const cv = typeof document !== 'undefined' && document.getElementById ? document.getElementById('scene') : null;
    if (cv) cv.addEventListener('webglcontextrestored', () => {
      const t1 = performance.now();
      const r = gen({ tris: 0, detTris: 0, tWall: 0, tRoof: 0, tPar: 0, built: 0, walls: 0, roofs: 0 }, []);
      for (const [list, map] of [[meshes, r.tiles], [detMeshes, r.dtiles]]) for (const m of list) {
        const t = map.get(m.userData.fabKey), g = t && t.buf.geometry(); if (!g) continue;
        m.geometry.dispose(); m.geometry = g; release(g);
      }
      console.log('[citygen] khôi phục ngữ cảnh WebGL: dựng lại hình học phố ' + Math.round(performance.now() - t1) + ' ms');
    }, false);
  }
  // LOD chi tiết: hiện ô 'det' khi camera trong DET_R tới MÉP ô (nhịp 0,25 s đồng hồ thật; aerial cao 1200 m → ẩn hết)
  let _detAt = -1e9;
  const prevBR = scene.onBeforeRender;
  scene.onBeforeRender = function (renderer, sc, cam, rt) {
    if (prevBR) prevBR.call(this, renderer, sc, cam, rt);
    const now = performance.now(); if (now - _detAt < 250 || !cam) return; _detAt = now;
    const cx = cam.position.x, cz = cam.position.z, cy = cam.position.y, R2 = DET_R * DET_R;
    for (const m of detMeshes) {
      const [tx, tz] = m.userData.fabTile, h = DET_TILE / 2;
      const dx = Math.max(0, Math.abs(cx - tx) - h), dz = Math.max(0, Math.abs(cz - tz) - h);
      m.visible = dx * dx + dz * dz + cy * cy * 0.25 < R2;
    }
  };
  const tAll = performance.now() - T0;
  Object.assign(st, { tiles: meshes.length, detTiles: detMeshes.length, triMain, triDet, calls, ms: Math.round(tAll), msDecode: Math.round(tDecode), msClaims: Math.round(tClaims), msAtlas: Math.round(tAtlas), msGeo: Math.round(tGeo), atlas: fabricAtlasInfo() });
  if (ctx.log !== false) console.log('[citygen]', JSON.stringify(st));
  return { stats: st, meshes, detMeshes, collide: fabricCollide, at: fabricAt, hit: fabricHit, frontEdges, material: mat, grid };
}
