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
//    làm hệ số đêm (kính sáng ngẫu nhiên theo ô, cửa hàng + biển hiệu sáng). KHÔNG sửa daynight.js. Shader THAY chunk
//    emissivemap_fragment → phải tự nhân HP_UNLIT_K (post.js WP5: phần tự phát hiển thị theo màn hình, không theo phơi sáng
//    thích nghi — thiếu là cửa sổ/biển cháy trắng lúc đêm khi phơi sáng ×4).
//  * Va chạm: lưới ô 16 m trên bbox nhà (nới 2 m) → fabricCollide(p,r) đẩy điểm ra khỏi đa giác (cạnh gần nhất).
//  * Xác định: mọi ngẫu nhiên = hash(seed nhà) — A/B chụp ảnh so được.
import * as THREE from 'three';
import { rbData, rbGrid } from './rbdata.js';
import {
  EDGE, STYLE, ROOF, WALL_PALETTE, ROOF_PALETTE, GROUND_H, FLOOR_H, PARAPET_H, heightOf,
  refreshPartyEdges, INFO, FP_ENUMS,
} from './buildings_data.js';
import { claimAt, claimOverlapFrac } from './claims.js';
import { buildFacadeAtlas, MOD, ATLAS_N, ATLAS_ROWS, SIGN_CELLS, SIGN_EXT, SIGN_Y, PANEL_CELLS, BLADE_CELLS, BILL_CELLS } from './facade_atlas.js';
import { FEF, FEZ, FE_OBS, FE_PANO } from './facade_evidence.js';
import { TIER } from './device.js';
import { ROADS_DT } from './mapdata.js';
import { ROAD_HW, roadHW, sidewalkW, SIDEWALK_TOP } from './xsection.js';   // W3-A: lòng/vỉa RIÊNG từng phố (roadGrid)
import { PANO_CAM } from './panoclear.js';

// Ô CHÍNH 450 m (tường + mái + đồ mái; ~57 ô cho R1750): đo cùng phiên 300/450/600 m — 450 giảm MỘT NỬA draw call của
// phố (pano_007 58→26, cam_spawn 38→21, kể cả lượt bóng) mà tam giác vẽ chỉ +0,01-0,05 M; 600 không lợi thêm.
// Ô CHI TIẾT 300 m (ban công, mái hiên, hộp biển, điều hoà, cột) — nhỏ hơn để LOD theo DET_R mịn.
export const FAB_TILE = 450;
export const DET_TILE = 300;
const LITE_FAB = TIER <= 1;
const DET_R = LITE_FAB ? 220 : 380;        // bán kính hiện ban công/mái hiên quanh camera (m)
const DET_RMAX = 1650;
// W5-B: ô NEAR 'fab_near_<tx>_<tz>' (200 m) — đồ nhỏ mặt phố (hàng bày tràn hè, cây cảnh/đồ phơi ban công, ống thoát nước):
// chỉ hiện trong NEAR_R quanh camera (+ mép ô), KHÔNG đổ bóng (vật nhỏ sát tường — bóng không đáng 1 lượt vẽ bóng/ô); TIER≤1 không có.
export const NEAR_TILE = 200;
const NEAR_R = 120;                     // chỉ dựng chi tiết cho nhà có tâm trong r ≤ 1650 m (nhà ngoài ctx.maxR đã bị bỏ)
// giải phóng mảng CPU của buffer phố sau upload GPU (dựng lại khi khôi phục ngữ cảnh) — xem cuối buildRealFabric.
// ?fabfree=0 tắt (đo heap A/B, hoặc khi cần raycast/đọc mảng các mesh fab_* để chẩn đoán).
const RELEASE_CPU = (() => { try { return new URLSearchParams(location.search).get('fabfree') !== '0'; } catch (e) { return true; } })();

// ---------- dữ liệu (giải mã 1 lần, dùng chung: citygen, minimap, cell sink WP3...) ----------
let _D = null;
export function fabricData() { if (!_D) _D = rbData(); return _D; }   // = js/rbdata.js (1 lần giải mã cho cả trang)

// ---------- hash xác định ----------
function hh(a, b) { let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); h ^= h >>> 13; return (h >>> 0) / 4294967296; }

const lin = (hex) => { const c = new THREE.Color().setHex(hex); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };
const WALL_LIN = WALL_PALETTE.map(lin);
const ROOF_LIN = ROOF_PALETTE.map(lin);
// mái hiên (W3-C, AUDIT3 SHOPFRONT): pano HP = TÔN SÓNG xanh dương là chủ đạo, bạt xanh/xanh-trắng, ít đỏ/cam; trước: bạt sọc
// đỏ/vàng/lá đều nhau + sâu 1,5 m. TÔN (ô D_AWN2, nhuộm) / BẠT (ô D_AWN sọc, nhuộm).
const AWN_TIN = [0x2f62a8, 0x3a6fb4, 0x2a5596, 0x4580c4, 0x2f62a8, 0x4f8a5c, 0x8e3b2c, 0x9aa0a6, 0x3a6fb4].map(lin);
const AWN_TARP = [0x2f6db5, 0x1f5fa0, 0x2f6db5, 0xd9832a, 0x3f8a5c, 0xb24a3e, 0x4a7fc0].map(lin);
// W4-A: mái hiên theo vân tay (chỉ số FP_ENUMS.awning): null = không có; [tôn?, màu tuyến tính]
// W5-B: 'tarp_other' (308 quan sát: be/cam/lục/nâu đỏ/xám…) — trước cố định xám 0x8f8d84 → cả phố mái hiên xám đục
const AWN_OTHER = [0xc9a46a, 0xd9832a, 0x3f8a5c, 0x9a3a32, 0x8f8d84, 0x3f78b8, 0xb8b2a2].map((h) => lin(h));
const AWN_FP = [null, [true, lin(0x2f62a8)], [true, lin(0x8e3b2c)], [false, lin(0x2f6db5)], [false, lin(0x4a7fc0)], [false, lin(0xb24a3e)], [false, lin(0x8f8d84)], [true, lin(0xa7a49b)]];
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
// WebGL1 (GLSL ES 1.0 không có mảng const khởi tạo): mảng → HÀM chuỗi if; mã thân shader viết NAME[i] được đổi
// thành NAME(i) bằng gl1Idx() (chỉ số không chứa '[' lồng nhau).
function glslFloatFn(name, names) {
  const v = names.map((n) => { if (!(n in MOD)) throw new Error('citygen: thiếu mô-đun atlas ' + n); return MOD[n].toFixed(1); });
  let s = `float ${name}(int i){`;
  for (let k = 0; k < v.length - 1; k++) s += `if(i==${k})return ${v[k]};`;
  return s + `return ${v[v.length - 1]};}`;
}
function glslVec3Fn(name, hexes) {
  const v = hexes.map((h) => { const c = new THREE.Color().setHex(h); return `vec3(${c.r.toFixed(4)},${c.g.toFixed(4)},${c.b.toFixed(4)})`; });
  let s = `vec3 ${name}(int i){`;
  for (let k = 0; k < v.length - 1; k++) s += `if(i==${k})return ${v[k]};`;
  return s + `return ${v[v.length - 1]};}`;
}
// W5-B: độ sáng nội thất BAN NGÀY theo mô-đun trệt (mặt kính sáng rõ, cửa hàng mở sáng nhẹ, còn lại 0)
const DAYLIT_GLASS = ['G_GLASS', 'G_SHOW', 'G_STORE0', 'G_STORE1', 'G_STORE2', 'G_SHOP3', 'G_ELEC', 'G_LOBBY'];
const DAYLIT_OPEN = ['G_SHOP0', 'G_SHOP1', 'G_SHOP2', 'G_OPEN0', 'G_OPEN1', 'G_OPEN2', 'G_FOOD', 'G_HARD', 'G_MOTO', 'G_HOME2'];
function dayLitGlsl() {
  const t = (names) => names.filter((k) => MOD[k] !== undefined).map((k) => `abs(m - ${MOD[k]}.0) < 0.5`).join(' || ') || 'false';
  return `float dayLitOf(float m){ if (${t(DAYLIT_GLASS)}) return 0.16; if (${t(DAYLIT_OPEN)}) return 0.07; return 0.0; }`;
}
const GL1_ARR = /\b(U\d+|G\d+|FG\d+|FU\d+|GH|SD|BK|PT|XP|SIGNC|WALLP)\[([^[\]]*)\]/g;
const gl1Idx = (src) => src.replace(GL1_ARR, '$1($2)');
// KIỂU DỰNG (render style) = 4 bit thấp aFac.z của tường. 0..6 = STYLE dữ liệu (TUBE 0, OLD 1, KTT 2, GLASS 3, VILLA 4,
// SHED 5, CIVIC 6); 7.. thêm ở W3-C, quyết định LÚC CHẠY trong renderStyles() từ bằng chứng pano (js/facade_evidence.js) +
// vùng + luật sửa dữ liệu (kho tôn ≥3 tầng, lô kính hẹp, tháp ≥9 tầng). Bit 4-5 = TUỔI (lớp phong hoá 0..3), bit 6 = nhà
// nhiều BIỂN BẢNG LỚN (phố buôn bán), bit 7 dự trữ.
const RS = { COL: 7, NEO: 8, CONS: 9, MODERN: 10, TOWER: 11, TEN: 12, HOTEL: 13 };
// W4-C: 13 = KHÁCH SẠN / tháp văn phòng khung đá + kính (U_HOTEL, sảnh kính G_LOBBY, không bay "nhà ở", mái hiên kính 3D);
// 14, 15 còn trống (aFac.z 4 bit).
const NRS = 14;
// Bộ mô-đun theo KIỂU DỰNG. Lặp tên = tăng trọng số.
const SETS = {
  U0: ['U_SLIDE0', 'U_SLIDE0', 'U_SLIDE1', 'U_BALC0', 'U_BALC1', 'U_BALC0', 'U_CAGE', 'U_TILE', 'U_AC', 'U_AC', 'U_LOG'],
  U1: ['U_SHUT0', 'U_SHUT0', 'U_SHUT1', 'U_ARCH', 'U_BALU', 'U_CAGE', 'U_SLIDE1', 'U_VINE'],
  U2: ['U_KTT0', 'U_KTT0', 'U_KTT1', 'U_CAGE', 'U_LOG', 'U_TEN'],
  U3: ['U_CURT2', 'U_CURT2', 'U_CURT0', 'U_CURT1', 'U_CURT3', 'U_RIB'],        // W3-C: kính PHẢN TRỜI sáng (trước: CURT0 tối)
  U4: ['U_VILLA2', 'U_VILLA', 'U_VILLA2', 'U_SHUT0', 'U_ARCH', 'U_BALU', 'U_COL2'],   // W4-C: + biệt thự cửa vòm/ban công con tiện
  U5: ['U_SHED'],
  U6: ['U_CIVIC', 'U_CIVIC', 'U_RIB'],
  U7: ['U_COL0', 'U_COL2', 'U_COL1', 'U_COL2', 'U_COL1', 'U_SHUT0', 'U_ARCH', 'U_BALU', 'U_VINE'],   // thuộc địa Pháp (W4-C: + U_COL2 trán cong/chớp mở)
  U8: ['U_NEO', 'U_NEO', 'U_NEO', 'U_COL0'],                                               // tân cổ điển trắng
  U9: ['U_CONS', 'U_CONS', 'U_NET'],                                                       // đang xây
  U10: ['U_ACP', 'U_ACP', 'U_CURT2', 'U_SLIDE0', 'U_TOWER', 'U_ACP'],                       // nhà phố hiện đại (alu/kính)
  U11: ['U_TOWER', 'U_TOWER', 'U_TOWER', 'U_RIB', 'U_CURT2', 'U_SLIDE0'],                   // cao tầng hiện đại
  U12: ['U_TEN', 'U_TEN', 'U_KTT0', 'U_KTT1', 'U_CAGE', 'U_LOG'],                           // tập thể xuống cấp
  U13: ['U_HOTEL', 'U_HOTEL', 'U_HOTEL', 'U_CURT2'],                                          // W4-C khách sạn/văn phòng khung đá
  // (phản biện WP2: mặt phố liền lặp 1 kiểu kệ hàng cả dãy → sửa xe/điện thoại/điện nước). W3-C: ÍT cửa cuốn (pano ban ngày
  // phần lớn MỞ cửa), thêm quán mở / quần áo / đồ gỗ / quán ăn / showroom.
  G0: ['G_SHOP0', 'G_SHOP1', 'G_SHOP2', 'G_SHOP3', 'G_MOTO', 'G_ELEC', 'G_HARD', 'G_OPEN0', 'G_OPEN1', 'G_OPEN2', 'G_FOOD', 'G_SHOW', 'G_SHUT0', 'G_GLASS', 'G_GATE', 'G_OPEN0', 'G_STORE0', 'G_STORE2'],
  G1: ['G_OLD', 'G_OLD', 'G_SHOP0', 'G_OPEN0', 'G_SHUT1', 'G_GATE', 'G_SHOP2', 'G_HOME2', 'G_HARD', 'G_ELEC', 'G_OPEN2', 'G_FOOD'],   // W5-B: bớt cửa cuốn ĐÓNG (G_SHUT0 → quán mở, G_HOME0 → nhà mở cửa)
  G2: ['G_SHOP0', 'G_SHUT0', 'G_GATE', 'G_HOME2', 'G_SHOP2', 'G_HOME1', 'G_MOTO', 'G_HARD', 'G_OPEN0'],
  G3: ['G_SHOW', 'G_GLASS', 'G_STORE1', 'G_STORE0'],
  G4: ['G_VILLA', 'G_VILLA', 'G_HOME0', 'G_CIVIC'],
  G5: ['G_WARE'],
  G6: ['G_CIVIC', 'G_CIVIC', 'G_GLASS'],
  G7: ['G_OLD', 'G_OLD', 'G_OLD', 'G_COL', 'G_OPEN0', 'G_OPEN2', 'G_SHOP1', 'G_SHUT1'],   // phố Pháp vẫn là phố buôn bán: cửa vòm gỗ đóng ÍT
  G8: ['G_NEO', 'G_NEO', 'G_NEO', 'G_COL'],
  G9: ['G_HOARD'],
  G10: ['G_SHOW', 'G_STORE0', 'G_STORE1', 'G_STORE2', 'G_ELEC', 'G_GLASS', 'G_OPEN1', 'G_STORE0'],   // W4-C: mặt KÍNH cửa hàng/ngân hàng/phòng khám
  G11: ['G_SHOW', 'G_STORE1', 'G_CIVIC', 'G_STORE0'],
  G12: ['G_HOME0', 'G_HOME1', 'G_SHUT1', 'G_OPEN0', 'G_GATE', 'G_HOME2'],
  G13: ['G_LOBBY'],   // sảnh kính liền (pano_359: biển cửa hàng trên sảnh khách sạn là sai)
  GH: ['G_HOME0', 'G_HOME2', 'G_HOME1', 'G_HOME2', 'G_SHUT0', 'G_GATE', 'G_HOME1'],   // W5-B: ngõ ban ngày phần lớn MỞ cửa (G_HOME2)   // mặt ngõ/phố nhỏ: nhà ở
  // tường hông/sau/chung LỘ (W3-C "không tường trống"): thêm tường hồi ố, xi măng thô có cửa sổ nhỏ + điều hoà, quảng cáo sơn
  SD: ['S_PLAIN0', 'S_EXP0', 'S_PLAIN0', 'S_PLAIN2', 'S_PLAIN1', 'S_WIN', 'S_WIN', 'S_BRICK', 'S_BACK', 'S_EXP1', 'S_EXP0'],
  BK: ['S_BACK', 'S_BACK', 'S_WIN', 'S_PLAIN0', 'S_PLAIN2', 'U_AC', 'U_LOG', 'U_SLIDE1', 'S_EXP1'],
  PT: ['S_EXP0', 'S_EXP0', 'S_EXP1', 'S_PLAIN1', 'S_PLAIN2', 'S_ADS', 'S_EXP2', 'S_BRICK', 'S_WIN'],
  // tường hông/sau LỘ ra phố (exposedSide, rc = 1 trên cạnh không phải mặt phố): cửa sổ nhỏ thưa + điều hoà + ố, ít trơn,
  // hiếm quảng cáo sơn — KHÔNG bao giờ "trơn cả mặt" (nhà ống HP: tường hồi có ô thoáng/cửa sổ nhỏ/cục nóng)
  XP: ['S_EXP1', 'S_EXP1', 'S_WIN', 'S_WIN', 'S_BACK', 'U_AC', 'S_EXP0', 'S_EXP0', 'S_PLAIN2', 'S_EXP2'],
  // W4-A VÂN TAY: bộ mô-đun THEO QUAN SÁT THẬT của từng nhà (D.fp, mục RBF1) — FGk tầng trệt (fpGround), FUk tầng trên
  // (fpUpper). aFp.w = FG (4 bit) | FU << 4; 0 = theo thống kê như cũ.
  FG1: ['G_SHOP0', 'G_SHOP1', 'G_SHOP2', 'G_SHOP3', 'G_MOTO', 'G_ELEC', 'G_HARD', 'G_OPEN0', 'G_OPEN1', 'G_OPEN2'],   // cửa hàng mở
  FG2: ['G_OLD', 'G_OPEN0', 'G_SHOP1', 'G_OPEN2', 'G_OLD', 'G_COL'],                                                 // cửa hàng mở, phố cũ/Pháp
  FG3: ['G_SHUT0', 'G_SHUT1', 'G_SHUT0'],                                                                             // cửa cuốn
  FG4: ['G_GLASS', 'G_SHOW', 'G_SHOW', 'G_SHOP3'],                                                                     // cửa kính/showroom
  FG5: ['G_GATE', 'G_HOME1', 'G_HOME0'],                                                                               // cửa xếp/cổng sắt
  FG6: ['G_HOME0', 'G_HOME1', 'G_HOME2'],                                                                              // nhà ở
  FG7: ['G_CIVIC'],                                                                                                    // tường/cửa sổ song sắt
  FG8: ['G_NEO'],                                                                                                      // tường — tân cổ điển
  FG9: ['G_COL'],                                                                                                      // tường — Pháp
  FG10: ['G_OPEN0', 'G_OPEN2', 'G_FOOD', 'G_SHOP0', 'G_OPEN1'],                                                        // chợ/sạp
  FG11: ['G_FOOD', 'G_SHOP2', 'G_OPEN2', 'G_FOOD'],                                                                    // quán ăn/cà phê
  FU1: ['U_SLIDE0', 'U_SLIDE0', 'U_SLIDE1', 'U_TILE', 'U_AC'],          // nhôm kính
  FU2: ['U_BALC0', 'U_BALC1', 'U_SLIDE0', 'U_BALC0'],                   // nhôm kính + ban công sắt
  FU3: ['U_BALC1', 'U_LOG', 'U_SLIDE0', 'U_BALC1'],                     // nhôm kính + ban công bê tông
  FU4: ['U_CAGE', 'U_CAGE', 'U_SLIDE1', 'U_KTT0'],                      // chuồng cọp
  FU5: ['U_SHUT0', 'U_SHUT0', 'U_SHUT1', 'U_COL0'],                     // cửa chớp gỗ
  FU6: ['U_ARCH', 'U_COL1', 'U_ARCH', 'U_BALU'],                        // cửa vòm
  FU7: ['U_CAGE', 'U_SLIDE1', 'U_KTT0', 'U_CAGE'],                      // song sắt
  FU8: ['U_CURT2', 'U_ACP', 'U_CURT3', 'U_CURT2'],                      // vách kính
  FU9: ['U_AC', 'U_SLIDE1', 'U_KTT0', 'U_AC', 'U_TILE'],                // cửa sổ nhỏ
};
const N_FG = 11, N_FU = 9;
// ---------- W4-A VÂN TAY MẶT TIỀN: D.fp (mục RBF1 của buildings_real.js) → kiểu dựng/tuổi/biển/bộ mô-đun/màu TỪNG NHÀ ----------
// Nhà không có vân tay (D.fpE[b] < 0) giữ nguyên hành vi thống kê cũ. 255 = trường không rõ.
const FP_NONE = [0, 0, 0, 0];
const FPV = {
  st: Object.fromEntries(FP_ENUMS.style.map((v, i) => [v, i])), bal: Object.fromEntries(FP_ENUMS.balcony.map((v, i) => [v, i])),
  win: Object.fromEntries(FP_ENUMS.windows.map((v, i) => [v, i])), gnd: Object.fromEntries(FP_ENUMS.ground.map((v, i) => [v, i])),
  size: Object.fromEntries(FP_ENUMS.size.map((v, i) => [v, i])), awn: Object.fromEntries(FP_ENUMS.awning.map((v, i) => [v, i])),
};
// kiểu dựng theo kiểu quan sát (−1 = giữ kiểu thống kê: đền chùa/chợ/khác)
function fpRenderStyle(D, e, fl, fL, area) {
  const s = D.fp.style[e], w = D.fp.windows[e], ag = D.fp.age[e];
  if (s === FPV.st.tube) return w === FPV.win.glass_curtain && ag === 0 ? RS.MODERN : STYLE.TUBE;
  if (s === FPV.st.tube_old) return STYLE.OLD;
  if (s === FPV.st.colonial) return RS.COL;
  if (s === FPV.st.neoclassical) return RS.NEO;
  if (s === FPV.st.villa) return STYLE.VILLA;
  if (s === FPV.st.apartment) return ag >= 2 && ag <= 3 ? RS.TEN : STYLE.KTT;
  if (s === FPV.st.glass_office) return fl <= 6 && fL <= 12 && area < 450 ? RS.MODERN : STYLE.GLASS;
  // tích hợp W4 (A × C): 'hotel_tower' trên khối LỚN (≥ 4 T, ≥ 600 m²) → RS.HOTEL (khung đá + sảnh kính W4-C); nhà nghỉ
  // ống hẹp (53 nhà vân tay 'hotel_tower', 46 < 300 m², 31 ≤ 3 T) giữ TOWER/GLASS như W4-A
  if (s === FPV.st.hotel_tower) return fl >= 4 && area >= 600 ? RS.HOTEL : fl >= 7 ? RS.TOWER : STYLE.GLASS;
  if (s === FPV.st.shed) return fl <= 2 ? STYLE.SHED : -1;   // sửa hồi quy W4 (pano_519 h90): lán tạm sát nhà 3 tầng ≠ kho 3 tầng (process_buildings cũng bỏ vân tay đó)
  if (s === FPV.st.civic) return STYLE.CIVIC;
  if (s === FPV.st.construction) return fl <= 8 ? RS.CONS : -1;
  return -1;
}
// biển BẢNG LỚN nhiều tầng (chế độ 3): 'multi', hoặc 'banner' phủ ≥ 2 tầng — banner 1 tầng = biển màu thật thường (phản biện
// r1: pano_078 h90 biệt thự cổng sắt / 175 h0 mặt tiền ngân hàng nhận bảng 2 tầng + sọc giả)
const fpPanel = (D, e) => D.fp.size[e] === FPV.size.multi || (D.fp.size[e] === FPV.size.banner && D.fp.span[e] >= 2 && D.fp.span[e] !== 255);
// sửa hồi quy W4 (pano_046/161/515): bảng lớn TỪNG BAY (mỗi bay 1 ô PANEL chữ cửa hàng ngẫu nhiên, tầng 1-2) là kiểu phố NHÀ ỐNG
// buôn bán (464/023 — nhiều hộ, mỗi hộ 1 biển). Toà ngân hàng/văn phòng/thương mại/thuộc địa/công sở quan sát "multi/banner" =
// MỘT dải biển của MỘT chủ (BIDV 046, ngân hàng 161 "trắng sọc xanh", toà thương mại 515) → ra chồng "NHÀ NGHỈ/NHA KHOA/CẦM ĐỒ".
// Chỉ chế độ 3 khi ảnh nói nhà ống (tube/tube_old) VÀ kiểu dựng là nhà ống (TUBE/OLD/MODERN); còn lại = chế độ 2 (dải biển trệt màu thật)
const fpPanelOK = (D, e, rs) => fpPanel(D, e) && (D.fp.style[e] === FPV.st.tube || D.fp.style[e] === FPV.st.tube_old)
  && (rs === STYLE.TUBE || rs === STYLE.OLD || rs === RS.MODERN);
const FG_TXT = [[255, 255, 255], [30, 30, 30], [190, 30, 30], [240, 190, 40]];   // màu chữ lượng tử 2 bit (khớp fpFg shader)
// 4 byte aFp + thông tin chi tiết 3D cho nhà b (kiểu dựng rs đã chốt). Trả null nếu không có vân tay.
function fpBuild(D, b, rs) {
  const e = D.fpE ? D.fpE[b] : -1; if (e < 0) return null;
  const F = D.fp, size = F.size[e], gnd = F.ground[e], win = F.windows[e], bal = F.balcony[e];
  const known = (r, g, bl) => !(r === 255 && g === 255 && bl === 255);
  const wallK = known(F.wallR[e], F.wallG[e], F.wallB[e]), bgK = known(F.bgR[e], F.bgG[e], F.bgB[e]);
  let mode = 4;                                                                  // biển không rõ → thống kê
  if (size === FPV.size.none) mode = 1;
  else if (size !== 255 && bgK) mode = fpPanelOK(D, e, rs) ? 3 : 2;
  const bg565 = bgK ? ((F.bgR[e] >> 3) << 11) | ((F.bgG[e] >> 2) << 5) | (F.bgB[e] >> 3) : 0;
  let fg = 0, bd = 1e9;
  for (let k = 0; k < 4; k++) { const c = FG_TXT[k], d = (c[0] - F.fgR[e]) ** 2 + (c[1] - F.fgG[e]) ** 2 + (c[2] - F.fgB[e]) ** 2; if (d < bd) { bd = d; fg = k; } }
  const span = F.span[e] === 255 ? 1 : F.span[e];
  const oldish = rs === STYLE.OLD || rs === RS.COL;
  let gs = 0;
  // rc 3 (USE_HOME / khuôn viên có tường) trên CIVIC/GLASS/SHED = trệt KHÔNG biển (G_CIVIC/G_WARE) — bộ FG không được đè
  // (lớp lỗi pano_224/225: biển quán sau tường mỏ neo). gs = 0 ⇒ JS + GL2 + GL1 cùng về luật cũ (khớp bit)
  const useI = D.info ? (D.info[b] >> INFO.USE_SHIFT) & 3 : -1, pkI = D.info ? (D.info[b] >> INFO.PK_SHIFT) & 3 : 0;
  const noSignRc3 = NOSIGN_ST(rs) && (useI === INFO.USE_HOME || (pkI && useI !== INFO.USE_SHOP));
  if (rs !== RS.CONS && rs !== RS.HOTEL && !noSignRc3) {   // tích hợp W4: khách sạn giữ sảnh G_LOBBY (FIXED_G), không bộ FG
    if (gnd === FPV.gnd.shop_open) gs = oldish ? 2 : 1;
    else if (gnd === FPV.gnd.shutter) gs = 3;
    else if (gnd === FPV.gnd.glass_store) gs = 4;
    else if (gnd === FPV.gnd.gate) gs = 5;
    else if (gnd === FPV.gnd.home) gs = 6;
    else if (gnd === FPV.gnd.wall) gs = rs === RS.NEO ? 8 : rs === RS.COL ? 9 : 7;
    else if (gnd === FPV.gnd.market) gs = (rs === STYLE.GLASS || rs === RS.TOWER || rs === STYLE.CIVIC || rs === RS.NEO) ? 4 : 10;   // sửa hồi quy W4 (515 h270): toà văn phòng/thương mại "market" = sảnh kính, không sạp chợ
    else if (gnd === FPV.gnd.restaurant) gs = 11;
  }
  let us = 0;
  if (rs === STYLE.TUBE || rs === STYLE.OLD || rs === RS.MODERN || rs === STYLE.KTT || rs === RS.TEN) {
    if (bal === FPV.bal.cage) us = 4;
    else if (win === FPV.win.aluminum) us = bal === FPV.bal.iron || bal === FPV.bal.mixed ? 2 : bal === FPV.bal.concrete ? 3 : bal === FPV.bal.glass ? 8 : 1;
    else if (win === FPV.win.wood_shutter) us = 5;
    else if (win === FPV.win.arched) us = 6;
    else if (win === FPV.win.grille) us = 7;
    else if (win === FPV.win.glass_curtain) us = 8;
    else if (win === FPV.win.small) us = 9;
  } else if (rs === STYLE.VILLA && bal === FPV.bal.none && (win === FPV.win.aluminum || win === FPV.win.small || win === FPV.win.grille)) {
    // sửa hồi quy W4 (pano_533 h180): ảnh nói "villa" KHÔNG ban công, cửa nhôm/nhỏ/song sắt (43 nhà) — bộ tầng trên VILLA thống kê
    // (ban công vòm + lan can con tiện) dựng thành khối thuộc địa 3 tầng; theo cửa sổ thật: nhôm kính / cửa sổ nhỏ / song sắt
    us = win === FPV.win.aluminum ? 1 : win === FPV.win.small ? 9 : 7;
  }
  const bytes = [bg565 & 255, bg565 >> 8, mode | (fg << 3) | ((span >= 2 ? 1 : 0) << 5) | ((wallK ? 1 : 0) << 6), gs | (us << 4)];
  const wall = wallK ? lin((F.wallR[e] << 16) | (F.wallG[e] << 8) | F.wallB[e]) : null;
  return { e, bytes, wall, mode, gs, size, span, bal, awn: F.awning[e] };
}
const FIXED_G = (st) => st === 5 || st === RS.CONS || st === RS.HOTEL;   // kho / đang xây: 1 mô-đun trệt cố định, không có bay "nhà ở"
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
// W3-A r3: rc 3 (INFO USE_HOME) trên công sở/kính/kho (CIVIC 6, GLASS 3, SHED 5) = khối trong KHUÔN VIÊN có tường rào (dữ liệu
// chỉ ghi USE_HOME cho các kiểu này với nhà cbIn sau tường mỏ neo Hải quân — process_buildings) → trệt KHÔNG biển: G_CIVIC
// (song sắt + chân đá) / G_WARE, thay vì bộ nhà ở GH (G_SHUT0/G_GATE/G_SHUT1 có dải biển — pano_224/225 h270 hiện "BÁNH MÌ",
// "SỬA XE MÁY" ngay sau tường). JS + GL2 + GL1 cùng luật (khớp bit với hộp biển 3D).
const NOSIGN_ST = (st) => st === 6 || st === 3 || st === 5 || st === RS.HOTEL;   // W4-C: + khách sạn
// W4-C: kiểu KHÔNG có bay "nhà ở" (đang xây, khách sạn: sảnh/kính liền) — JS, GL2, GL1 cùng luật
const NOHOME_ST = (st) => st === RS.CONS || st === RS.HOTEL;
function groundModule(s8, bay, wide, rc, st, fg = 0) {
  const gk = wide ? ihash(s8 * 977 + bay, 101) : s8;
  const g1 = ihash(gk, bay * 2 + 1), g2 = ihash(gk, bay * 2 + 2);
  if (fg > 0) { const set = SETS['FG' + fg]; return set[pidx(g1, set.length)]; }   // W4-A: tầng trệt theo vân tay (cùng g1 với shader)
  // W3-C: đang xây (RS.CONS) không có bay nhà ở; W3-A r3: rc 3 trên CIVIC/GLASS/SHED → trệt không biển
  if (!NOHOME_ST(st) && (g2 >>> 8) < HOME_THR[Math.min(3, rc)]) return rc >= 3 && NOSIGN_ST(st) ? (st === 5 ? 'G_WARE' : 'G_CIVIC') : SETS.GH[pidx(g1, SETS.GH.length)];
  const set = SETS['G' + Math.min(NRS - 1, st)];
  return FIXED_G(st) ? set[0] : set[pidx(g1, set.length)];
}
// WebGL1 (GLSL ES 1.0 không có uint/phép bit): BẢNG TRA tính sẵn bằng CHÍNH ihash JS — texel (s8 0..255, bay 0..127 +
// 128·wide) = g1>>>8 (24 bit ở RGB) + hạng "nhà ở" ở A (c = ngưỡng HOME_THR nhỏ nhất mà g2>>>8 lọt dưới; nhà ở ⇔
// min(3,rc) ≥ c) → mô-đun trệt của nhánh GL1 khớp groundModule() (trừ bay ≥ 128 quấn vòng — mặt tiền > 500 m — và
// sai số làm tròn float ~1e-6 ở pidx). 256² RGBA8 = 256 KB, ~3 ms, CHỈ dựng khi renderer là WebGL1.
let _gmodTex = null;
function gmodTexture() {
  if (_gmodTex) return _gmodTex;
  const S = 256, d = new Uint8Array(S * S * 4);
  for (let w = 0; w < 2; w++) for (let bay = 0; bay < 128; bay++) for (let s8 = 0; s8 < 256; s8++) {
    const gk = w ? ihash(s8 * 977 + bay, 101) : s8;
    const g1 = ihash(gk, bay * 2 + 1) >>> 8, g2 = ihash(gk, bay * 2 + 2) >>> 8;
    const o = ((bay + 128 * w) * S + s8) * 4;
    d[o] = g1 >>> 16; d[o + 1] = (g1 >>> 8) & 255; d[o + 2] = g1 & 255;
    d[o + 3] = g2 < HOME_THR[0] ? 0 : g2 < HOME_THR[1] ? 1 : g2 < HOME_THR[2] ? 2 : 3;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace;
  t.name = 'fabric_gmod_gl1'; t.needsUpdate = true;
  return (_gmodTex = t);
}
// Atlas vẽ trong WORKER (facade_atlas_worker.js): luồng chính chỉ đăng ký thứ tự ô (MOD → shader). W3-C: material dùng
// texture CHỜ nhỏ 4×4 xám; ảnh atlas về (~0,1-0,3 s, thường trước khung hình đầu) thì tạo DataTexture ĐÚNG kích thước và
// THAY material.map (cùng "có map" → không đổi program). Sau upload GPU bản CPU (24 MB ở 2048×3072) được thả (onUpdate);
// mất ngữ cảnh WebGL → map về texture chờ, khôi phục → vẽ lại atlas. Worker lỗi/không hỗ trợ → vẽ đồng bộ.
// WebGL1: atlas NPOT (2048×3072) không mip được ở GL1 → tắt mip, lọc tuyến tính (cờ m.userData.webgl1 do onBeforeCompile đặt).
let _atlasTex = null, _phTex = null, _atlasGen = 0;
function atlasTexture(data, size, hgt, gl1) {
  const tex = new THREE.DataTexture(data, size, hgt, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = !gl1;
  tex.minFilter = gl1 ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = LITE_FAB ? 4 : 8;
  tex.name = 'fabric_atlas';
  tex.onUpdate = () => { tex.image.data = null; };   // thả bản CPU sau upload (khôi phục ngữ cảnh: vẽ lại, xem startAtlas)
  tex.needsUpdate = true;
  return tex;
}
function startAtlas(size, m) {
  const gen = ++_atlasGen, hgt = (size / ATLAS_N) * ATLAS_ROWS;
  const done = (data, ms, how) => {
    if (gen !== _atlasGen) return;
    const old = _atlasTex;
    _atlasTex = atlasTexture(data, size, hgt, !!m.userData.webgl1);
    m.map = _atlasTex;
    if (old) old.dispose();
    _atlas = { size, height: hgt, ms, mods: Object.keys(MOD), how };
    console.log('[citygen] atlas ' + size + '×' + hgt + ' vẽ ' + Math.round(ms) + ' ms (' + how + ')');
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
// chuỗi hàm chọn mô-đun theo kiểu dựng: st 0 = mặc định; tập 1 phần tử (kho, đang xây) luôn [0]
function pickChain(name, pre, arg, idx) {
  let s = `float ${name}(int st, ${arg}){\n`;
  for (let k = 1; k < NRS; k++) { const set = pre + k; s += `  if (st == ${k}) return ${set}[${SETS[set].length === 1 ? '0' : idx(set)}];\n`; }
  return s + `  return ${pre}0[${idx(pre + '0')}];\n}`;
}
// W4-A: chuỗi chọn bộ vân tay FG1..FGn / FU1..FUn (k ≥ 1; k ngoài khoảng → bộ cuối)
function pickChainFP(name, pre, arg, idx, n) {
  let s = `float ${name}(int k, ${arg}){\n`;
  for (let k = 1; k < n; k++) { const set = pre + k; s += `  if (k == ${k}) return ${set}[${SETS[set].length === 1 ? '0' : idx(set)}];\n`; }
  const last = pre + n;
  return s + `  return ${last}[${SETS[last].length === 1 ? '0' : idx(last)}];\n}`;
}
function makeMaterial() {
  const size = LITE_FAB ? 1024 : 2048, CPX = size / ATLAS_N, HGT = CPX * ATLAS_ROWS;
  buildFacadeAtlas(size, { layoutOnly: true });     // chỉ số ô cho shader (đồng bộ, ~0 ms)
  _phTex = new THREE.DataTexture(new Uint8Array(16 * 4).fill(222), 4, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
  _phTex.colorSpace = THREE.SRGBColorSpace; _phTex.minFilter = _phTex.magFilter = THREE.LinearFilter; _phTex.generateMipmaps = false;
  _phTex.name = 'fabric_atlas_wait'; _phTex.needsUpdate = true;
  const m = new THREE.MeshLambertMaterial({ map: _phTex, vertexColors: true, emissive: 0xffffff, emissiveIntensity: 0 });
  m.name = 'fabric_mat';
  startAtlas(size, m);
  // mất/khôi phục ngữ cảnh WebGL: bản CPU atlas đã thả → về texture chờ, rồi vẽ lại
  const cv = typeof document !== 'undefined' && document.getElementById ? document.getElementById('scene') : null;
  if (cv) {
    cv.addEventListener('webglcontextlost', () => { m.map = _phTex; if (_atlasTex) { _atlasTex.dispose(); _atlasTex = null; } }, false);
    cv.addEventListener('webglcontextrestored', () => { _phTex.needsUpdate = true; startAtlas(size, m); }, false);
  }
  // W3-C: vết lấy mẫu → inset ĐỘNG trong ô (nửa vết + 1 texel, tối thiểu 3 px): mip cao/anisotropic không còn lấy lẫn màu ô
  // bên cạnh (vệt màu dọc mép bay ở xa — một nguồn "RAINBOW"); trần mip giữ như cũ (~ô còn 11 px).
  const MGP = Math.pow(2, Math.log2(CPX) - 3.5).toFixed(4);
  const setsGlsl = Object.entries(SETS).map(([k, v]) => glslFloatArr(k, v)).join('\n');
  const n = (k) => SETS[k].length + '.0';
  const ni = (k) => SETS[k].length + 'u';
  const setsGlsl1 = Object.entries(SETS).map(([k, v]) => glslFloatFn(k, v)).join('\n');
  // HASH NGUYÊN (uint) cho mô-đun TẦNG TRỆT: JS (groundModule) tính RA ĐÚNG Y HỆT → biết bay nào có biển để dựng hộp biển
  // 3D (hash float GPU/JS lệch nhau do float32/FMA; số nguyên thì không).
  const GL2_GROUND = `uint ihash(uint a, uint b){ uint h = (a * 0x9E3779B1u) ^ ((b + 0x7F4A7C15u) * 0x85EBCA6Bu); h ^= h >> 15u; h *= 0xC2B2AE35u; h ^= h >> 13u; return h; }
int pidx(uint h, uint n){ return int(((h >> 8u) * n) >> 24u); }
${pickChain('pickGi', 'G', 'uint h', (s) => `pidx(h, ${ni(s)})`)}
${pickChainFP('pickFGi', 'FG', 'uint h', (s) => `pidx(h, ${ni(s)})`, N_FG)}`;
  const GL2_GROUND_MAIN = `        uint sI = uint(vFac.x + 0.5), bI = uint(max(bay, 0.0));
        uint gk = wide > 0.5 ? ihash(sI * 977u + bI, 101u) : sI;
        uint g1 = ihash(gk, bI * 2u + 1u), g2 = ihash(gk, bI * 2u + 2u);
        uint thr = rc > 2.5 ? ${HOME_THR[3]}u : rc > 1.5 ? ${HOME_THR[2]}u : (rc > 0.5 ? ${HOME_THR[1]}u : ${HOME_THR[0]}u);
        bool home = st != ${RS.CONS} && st != ${RS.HOTEL} && (g2 >> 8u) < thr;
        m = home ? (rc > 2.5 && (st == 6 || st == 3 || st == 5) ? (st == 5 ? ${MOD.G_WARE}.0 : ${MOD.G_CIVIC}.0) : GH[pidx(g1, ${ni('GH')})]) : pickGi(st, g1);
        if (fpG > 0.5) m = pickFGi(int(fpG + 0.5), g1);`;
  // GL1: u1 = (g1>>>8)/2^24 từ bảng tra (RGB 24 bit, NEAREST), pidx(g1,n) = int(u1·n)
  const GL1_GROUND = `uniform sampler2D uGMod;
${pickChain('pickGi', 'G', 'float u', (s) => `int(u * ${n(s)})`)}
${pickChainFP('pickFGi', 'FG', 'float u', (s) => `int(u * ${n(s)})`, N_FG)}`;
  const GL1_GROUND_MAIN = `        vec4 gm = texture2D(uGMod, (vec2(vFac.x, mod(max(bay, 0.0), 128.0) + 128.0 * wide) + 0.5) / 256.0);
        vec3 gb = floor(gm.rgb * 255.0 + 0.5);
        float u1 = (gb.r * 65536.0 + gb.g * 256.0 + gb.b) / 16777216.0;
        float rcI = rc > 2.5 ? 3.0 : rc > 1.5 ? 2.0 : (rc > 0.5 ? 1.0 : 0.0);
        bool home = st != ${RS.CONS} && st != ${RS.HOTEL} && rcI >= floor(gm.a * 255.0 + 0.5);
        m = home ? (rcI > 2.5 && (st == 6 || st == 3 || st == 5) ? (st == 5 ? ${MOD.G_WARE}.0 : ${MOD.G_CIVIC}.0) : GH[int(u1 * ${n('GH')})]) : pickGi(st, u1);
        if (fpG > 0.5) m = pickFGi(int(fpG + 0.5), u1);`;
  // WebGL1 (three r160 tự lùi về WebGL1 khi máy không có WebGL2 — vd GPU/driver bị chặn WebGL2): GLSL ES 1.0 không có
  // uint/phép bit, textureGrad, mảng const. Nhánh GL1 cùng thuật toán: mảng → hàm if (gl1Idx), hash nguyên → bảng tra
  // gmodTexture(), textureGrad → texture2DGradEXT (GL_EXT_shader_texture_lod; thiếu thì texture2D — viền mô-đun hơi lộ),
  // dFdx → GL_OES_standard_derivatives. Hai cờ dưới chỉ có tác dụng ở WebGL1 (three bỏ qua ở WebGL2, không đổi khoá program).
  m.extensions = { derivatives: true, shaderTextureLOD: true };
  m.onBeforeCompile = (sh, renderer) => {
    const gl1 = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2 === false);
    const X = gl1 ? gl1Idx : (s) => s;
    if (gl1) {
      sh.uniforms.uGMod = { value: gmodTexture() }; m.userData.webgl1 = true;
      if (_atlasTex && _atlasTex.generateMipmaps) { _atlasTex.generateMipmaps = false; _atlasTex.minFilter = THREE.LinearFilter; }   // NPOT ở GL1
    }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nattribute vec4 aFp;\nvarying vec4 vFac;\nvarying vec4 vFp;\nvarying vec2 vFUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFac = aFac; vFp = aFp; vFUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', X(`#include <common>
varying vec4 vFac; varying vec4 vFp; varying vec2 vFUv;
${gl1 ? setsGlsl1 : setsGlsl}
${gl1 ? glslVec3Fn('SIGNC', SIGN_HEX) : glslVec3Arr('SIGNC', SIGN_HEX)}
${gl1 ? glslVec3Fn('WALLP', WALL_PALETTE) : glslVec3Arr('WALLP', WALL_PALETTE)}
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnz(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
${pickChain('pickU', 'U', 'float r', (s) => `int(r * ${n(s)})`)}
${pickChainFP('pickFU', 'FU', 'float r', (s) => `int(r * ${n(s)})`, N_FU)}
${gl1 ? GL1_GROUND : GL2_GROUND}
float hat(float a, float c, float w){ return max(0.0, 1.0 - abs(a - c) / w); }
${dayLitGlsl()}`))
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
vec4 fabSample(float m, vec2 f, vec2 gx, vec2 gy){
  vec2 N2 = vec2(${ATLAS_N}.0, ${ATLAS_ROWS}.0);
  vec2 cell = vec2(mod(m, N2.x), floor(m / N2.x));
  vec2 gxp = gx * ${CPX}.0, gyp = gy * ${CPX}.0;                 // vết lấy mẫu theo texel ô
  float lg = max(length(gxp), length(gyp));
  if (lg > ${MGP}) { float k = ${MGP} / lg; gxp *= k; gyp *= k; lg = ${MGP}; }
  float ins = max(3.0, 0.5 * lg + 1.0) / ${CPX}.0;               // inset động: không lấn sang ô kề
  vec2 auv = (cell + clamp(f, vec2(ins), vec2(1.0 - ins))) / N2;
  vec2 gxa = gxp / vec2(${size}.0, ${HGT}.0), gya = gyp / vec2(${size}.0, ${HGT}.0);
${gl1 ? `#ifdef GL_EXT_shader_texture_lod
  return texture2DGradEXT(map, auv, gxa, gya);
#else
  return texture2D(map, auv);
#endif` : '  return textureGrad(map, auv, gxa, gya);'}
}`)
      .replace('#include <map_fragment>', X(`
vec3 fabGlow = vec3(0.0);
vec3 fabRefl = vec3(0.0);
vec3 fabDay = vec3(0.0);
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
  // W3-C: aFac.z tường = kiểu dựng (4 bit) | tuổi (2 bit) | nhà nhiều biển lớn (1 bit) | cạnh có ban công 3D (1 bit)
  float zHi = floor(vFac.z / 16.0);
  int st = int(vFac.z - zHi * 16.0 + 0.5);
  float age = mod(zHi, 4.0), bigSign = mod(floor(zHi / 4.0), 2.0), hasBalc = step(7.5, zHi);
  // W4-A VÂN TAY (aFp): x,y = màu nền biển RGB565 (sRGB) | z = chế độ biển (3 bit: 0 không vân tay, 1 KHÔNG biển, 2 biển màu
  // thật, 3 biển BẢNG LỚN tầng 1(-2), 4 vân tay nhưng biển không rõ) + màu chữ (2 bit) + phủ tầng 2 (1 bit) + biết màu tường (1 bit)
  // | w = bộ trệt FG (4 bit) + bộ tầng trên FU (4 bit)
  float fpMode = mod(vFp.z, 8.0), fpFgI = mod(floor(vFp.z / 8.0), 4.0), fpSpan2 = mod(floor(vFp.z / 32.0), 2.0), fpWallK = floor(vFp.z / 64.0);
  float fpG = mod(vFp.w, 16.0), fpU = floor(vFp.w / 16.0);
  vec3 fpBg = pow(vec3(floor(vFp.y / 8.0) / 31.0, (mod(vFp.y, 8.0) * 8.0 + floor(vFp.x / 32.0)) / 63.0, mod(vFp.x, 32.0) / 31.0), vec3(2.2));
  vec3 fpFg = fpFgI < 0.5 ? vec3(1.0) : fpFgI < 1.5 ? vec3(0.015) : fpFgI < 2.5 ? vec3(0.62, 0.02, 0.02) : vec3(0.95, 0.62, 0.03);
  bool fpSign = fpMode > 1.5 && fpMode < 3.5;
  vec2 q = vFUv;
  vec2 f; float m; vec2 dq = vec2(1.0);
  vec3 tint = vColor;
  float isG = 0.0, signSeed = 0.0, litP = 0.58, hh = 0.0, fu = 0.0, cellKey = 0.0, roofVar = 1.0, pnl = 0.0, wallTop = 0.0, glassK = 0.0;
  if (kind <= 3) {
    float floors = max(vFac.w, 1.0);
    hh = max(q.y, 0.0);
    float Htop = ${GROUND_H.toFixed(2)} + (floors - 1.0) * ${FLOOR_H.toFixed(2)};
    wallTop = Htop + (pitched > 0.5 ? 0.0 : ${PARAPET_H.toFixed(2)});
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
      if (h21(vec2(bs, 5.5)) > 0.25 && fpWallK < 0.5) tint = WALLP[int(h21(vec2(bs, 9.1)) * 23.99)];   // W4-A: màu thật thì giữ
    }
    float pIdx = 0.0;
    if (st == ${RS.HOTEL}) tint = mix(tint, vec3(0.80, 0.75, 0.64), 0.75);   // W4-C: khách sạn = ốp ĐÁ kem (không theo bảng màu nhà ống)
    if (fl >= floors - 0.01) {
      if (pitched > 0.5) m = SD[0];
      else if (st == 4 || st == 7 || st == 8) m = h21(vec2(bs * 7.1, 3.3)) < 0.75 ? ${MOD.P_COL}.0 : ${MOD.P_BALU}.0;   // W4-C: lan can mái gờ phào + con tiện
      else m = (st == 1 && h21(vec2(bs * 7.1, 3.3)) < 0.5) ? ${MOD.P_BALU}.0 : ${MOD.P_PLAIN}.0;
    } else if (kind == 1) {
      if (fl < 0.5) {
${gl1 ? GL1_GROUND_MAIN : GL2_GROUND_MAIN}
        isG = 1.0; signSeed = h21(vec2(bs * 17.3 + bay * 3.1, 2.9)); litP = home ? 0.45 : 0.25;
      }
      else {
        float mainR = h21(vec2(bs * 13.1, 1.0)), altR = h21(vec2(bs * 7.3, 2.0));
        float r = h21(vec2(bs * 3.7 + fl * 1.31, bay * 0.71 + 0.3)) < 0.8 ? mainR : altR;
        m = fpU > 0.5 ? pickFU(int(fpU + 0.5), r) : pickU(st, r);
        // W3-C: BIỂN BẢNG LỚN phủ tầng 1 (đôi khi cả tầng 2) — phố chính p/s/t, nhà buôn bán (pano Tô Hiệu, Cầu Đất, Lạch Tray)
        // W4-A: nhà có vân tay → CHỈ khi ảnh thật có biển bảng lớn (chế độ 3: mọi bay tầng 1, tầng 2 nếu phủ 2 tầng); không thống kê
        bool fpPan = fpMode > 2.5 && fpMode < 3.5;
        if (fpPan ? (hasBalc < 0.5 && (fl < 1.5 || (fl < 2.5 && fpSpan2 > 0.5)))
                  : ((fpMode < 0.5 || fpMode > 3.5) && rc < 0.5 && fl < 2.5 && hasBalc < 0.5 && (st <= 1 || st == 3 || st == 7 || st == 10))) {
          float pr = h21(vec2(bs * 5.7 + bay * 1.3, 8.8)), pP = bigSign > 0.5 ? 0.4 : 0.1;
          if (fpPan || (pr < pP && (fl < 1.5 || pr < pP * 0.35))) {
            pnl = 1.0; pIdx = floor(h21(vec2(bs * 3.3 + bay * 0.7 + fl, 9.4)) * ${(PANEL_CELLS * 2 - 0.01).toFixed(2)});
            m = ${MOD.PANEL0}.0 + floor(pIdx / 2.0);
            signSeed = h21(vec2(bs * 11.1 + bay * 2.3 + fl, 4.4)); litP = 0.35;
          }
        }
      }
    } else if (kind == 3) m = PT[int(h21(vec2(seed * 5.3 + bay * 0.21, floor(fl * 0.5) + 0.4)) * ${n('PT')})];
    else if (big > 0.5 && fl > 0.5 && st != 5) {   // tháp/chung cư/biệt thự/công sở: mọi mặt có cửa sổ (mô-đun chính 80%)
      float mainR = h21(vec2(seed * 13.1, 1.0)), altR = h21(vec2(seed * 7.3, 2.0));
      float r = h21(vec2(seed * 3.7 + fl * 1.31, bay * 0.71 + 0.3)) < 0.8 ? mainR : altR;
      m = (h21(vec2(seed * 2.9 + bay * 0.61, float(kind) + 0.5)) < 0.12) ? SD[0] : (fpU > 0.5 ? pickFU(int(fpU + 0.5), r) : pickU(st, r));   // ~12% bay trơn (lõi thang)
    }
    else if (big > 0.5 && rc > 0.5 && (st == 3 || st == 11 || st == ${RS.HOTEL})) { m = ${MOD.G_LOBBY}.0; litP = 0.12; }   // W4-C: trệt hông LỘ của tháp kính/khách sạn = sảnh kính (pano_230: tường xi măng ố); đêm sáng như sảnh trước (phản biện: hông tối)
    else if (rc > 0.5 && st != 5) m = XP[int(h21(vec2(seed * 17.9 + bay * 0.37, fl * 0.61 + 0.3)) * ${n('XP')})];   // W3-C: tường hông/sau LỘ ra phố
    else if (kind == 2) m = BK[int(h21(vec2(seed * 9.7 + bay * 0.53, fl * 0.77 + 0.2)) * ${n('BK')})];
    else {
      float r = h21(vec2(seed * 31.3 + bay * 0.5, fl * 0.13 + 0.1));
      m = (h21(vec2(seed, 9.0)) < 0.45) ? SD[0] : SD[int(r * ${n('SD')})];
      if (st == 5) m = ${MOD.U_SHED}.0;
    }
    f = vec2(fu, fv);
    if (pnl > 0.5) { f = vec2(fu, (mod(pIdx, 2.0) + fv) * 0.5); dq.y *= 0.5; }
    cellKey = bay * 7.0 + fl * 13.0;
    fabAO = mix(0.62, 1.0, smoothstep(0.0, 1.7, hh));
    glassK = (st == 3 || st == 10 || st == 11 || st == ${RS.HOTEL}) ? 1.0 : 0.4;
  } else {
    m = vFac.z; f = fract(q);
    if (kind == 5) { fabAO = 0.92; signSeed = vFac.w / 255.0; }
    if (kind == 4) roofVar = mix(0.78, 1.14, h21(vec2(seed * 7.7, 3.1)));   // mỗi mái 1 độ sáng (vệ tinh: mảng loang)
  }
  vec2 gx = dFdx(q) * dq, gy = dFdy(q) * dq;
  vec4 tx = fabSample(m, f, gx, gy);
  float a = tx.a;
  float wW = clamp((a - 0.80) / 0.12, 0.0, 1.0);
  float gW = hat(a, 0.75, 0.125), kW = hat(a, 0.5, 0.125), sW = hat(a, 0.25, 0.125), tW = clamp((0.125 - a) / 0.125, 0.0, 1.0);
  vec3 signCol = SIGNC[int(signSeed * 9.99)];
  vec3 textCol = dot(signCol, vec3(0.3, 0.55, 0.15)) > 0.42 ? vec3(0.45, 0.03, 0.02) : (signSeed > 0.6 ? vec3(1.0, 0.86, 0.2) : vec3(1.0));
  if (fpSign) { signCol = fpBg; textCol = fpFg; }                 // W4-A: màu biển THẬT của nhà này
  // W5-B BIỂN PHAI: biển thật HP là tấm bạt/alu PHAI nắng — trần bão hoà 0,74 (tuyến tính), kéo về xám ấm theo tuổi nhà, trần
  // độ sáng 0,82 (biển trắng không loá), chữ trắng ngà. Áp cho dải biển trệt, bảng lớn, biển dọc (cùng signCol).
  { float ageS = kind <= 3 ? age : 1.5;
    float sl = dot(signCol, vec3(0.2126, 0.7152, 0.0722));
    float smx = max(signCol.r, max(signCol.g, signCol.b)), smn = min(signCol.r, min(signCol.g, signCol.b));
    signCol = mix(vec3(sl), signCol, min(1.0, 0.64 / max((smx - smn) / max(smx, 1e-3), 1e-3)));
    signCol = min(mix(signCol, vec3(sl) * vec3(1.04, 1.0, 0.92), 0.08 + 0.06 * ageS), vec3(0.78));
    textCol = min(textCol, vec3(0.9, 0.88, 0.82)); }
  if (isG > 0.5 && fpMode > 0.5 && fpMode < 1.5) { wW += sW + tW; sW = 0.0; tW = 0.0; }   // W4-A: ảnh thật KHÔNG biển → dải biển = tường
  if (isG > 0.5 && sW + tW > 0.02) {           // dải biển hiệu: phủ chữ từ SIGN_CELLS×4 dải (ô SIGN0..)
    float fvS = clamp((hh - 2.95) / 0.9, 0.0, 0.999);
    float si = floor(signSeed * ${(SIGN_CELLS * 4 - 0.01).toFixed(2)});
    float sm = ${MOD.SIGN0}.0 + floor(si / 4.0);
    // W3-C: dải biển HẸP (G_OLD 0,5-3,5 m) → kéo chữ vừa dải (trước: lấy giữa 75% chữ → "ƠM VĂN PHÒN")
    bool narrowS = abs(m - ${MOD.G_OLD}.0) < 0.5;
    float su = narrowS ? clamp((fu * 4.0 - 0.5) / 3.0, 0.0, 1.0) : fu;
    vec2 sk = vec2(narrowS ? 1.3333 : 1.0, ${(GROUND_H / 3.6).toFixed(4)});      // dv(dải) = dh/0,9/4 ; gy.y đang là dh/GROUND_H
    vec4 t2 = fabSample(sm, vec2(su, (mod(si, 4.0) + fvS) / 4.0), gx * sk, gy * sk);
    float a2 = t2.a;
    float sW2 = hat(a2, 0.25, 0.125), tW2 = clamp((0.125 - a2) / 0.125, 0.0, 1.0), kW2 = hat(a2, 0.5, 0.125);
    vec3 sc = (sW2 * t2.rgb * signCol * 1.15 + tW2 * textCol + kW2 * t2.rgb) / max(sW2 + tW2 + kW2, 1e-3);
    float ss = sW + tW;
    tx.rgb = mix(tx.rgb, sc, ss); sW = 0.0; tW = 0.0; kW += ss;
    // ĐÊM: biển tự sáng nhưng TRẦN độ chói (W2-F): nền trắng/vàng nhạt × 0,45 từng loá qua bloom, chữ không đọc được;
    // nay độ chói phát sáng ≤ 0,45 × 0,24 — nền đậm (đỏ/xanh/lục, chói < 0,24) giữ nguyên, nền sáng giảm tới ~4×.
    float sLum = dot(sc, vec3(0.2126, 0.7152, 0.0722));
    fabGlow += sc * (0.45 * ss) * min(1.0, 0.24 / max(sLum, 1e-3));
  }
  // W3-C PALETTE GUARD: màu tường không quá bão hoà (cam/đỏ gạch/xanh nguyên chất phủ cả mặt nhà) — kéo về xám cùng độ sáng
  float tl = dot(tint, vec3(0.2126, 0.7152, 0.0722));
  float tmx = max(tint.r, max(tint.g, tint.b)), tmn = min(tint.r, min(tint.g, tint.b));
  float tsat = (tmx - tmn) / max(tmx, 1e-3);
  tint = mix(vec3(tl), tint, min(1.0, (kind <= 3 ? 0.58 - 0.05 * age : 0.62) / max(tsat, 1e-3)));   // W5-B: tường cũ bạc màu hơn
  // W3-C LỚP PHONG HOÁ (tuổi 0..3 theo vùng/kiểu/bằng chứng pano): vệt ố chảy dọc từ đỉnh tường, mảng ẩm loang, bẩn/rêu chân
  // tường, bạc màu. Toạ độ tường (m): x = bay·4 + lệch theo nhà, y = độ cao local. Chỉ tường (kind ≤ 3).
  float weather = 1.0, dirt = 1.0, peel = 0.0;
  vec3 peelC = vec3(0.0);
  if (kind <= 3) {
    float ag = age / 3.0, wx = q.x * 4.0 + seed * 97.0;
    float streak = smoothstep(0.6, 0.82, vnz(vec2(wx * 2.1, hh * 0.07 + seed * 13.0)));
    streak *= 0.35 + 0.65 * smoothstep(wallTop - 9.0, wallTop, hh);
    float blot = smoothstep(0.6, 0.85, vnz(vec2(wx * 0.33, hh * 0.27) + seed * 5.1));
    float base = 1.0 - smoothstep(0.0, 0.9 + 0.7 * ag, hh);
    // W5-B LỚP PHONG HOÁ v2 (tuổi vân tay old/very_old + vùng): (a) vệt ĐEN chảy từ MÉP SÀN mỗi tầng (nước mưa tràn sàn ban
    // công/ô văng — nét đặc trưng nhà ống HP), đậm sát mép, nhạt dần 0,5-1,4 m, theo cột nhiễu; (b) MẢNG VỮA BONG lộ xi măng
    // xám + viền tối (tuổi ≥ 2); (c) phai màu sơn về xám ấm mạnh hơn; vệt ố/mảng ẩm cũ đậm hơn ~40%.
    float tF = (hh - ${GROUND_H.toFixed(2)}) / ${FLOOR_H.toFixed(2)};
    float dSl = (1.0 - fract(tF)) * ${FLOOR_H.toFixed(2)};
    float drip = (tF > 0.0 && hh < wallTop - 0.2)
      ? exp(-dSl / (0.45 + 0.95 * vnz(vec2(wx * 1.7, 3.1 + seed * 5.0)))) * smoothstep(0.32, 0.72, vnz(vec2(wx * 3.3, floor(tF) * 1.7 + seed * 7.0))) : 0.0;
    float pn = vnz(vec2(wx * 0.55, hh * 0.75) + seed * 3.7) * 0.78 + vnz(vec2(wx * 3.1, hh * 3.3)) * 0.22;
    float pth = 0.84 - 0.13 * ag;
    float rim = 0.0;
    if (ag > 0.4) { peel = smoothstep(pth, pth + 0.012, pn); rim = smoothstep(pth - 0.035, pth, pn) * (1.0 - peel); }
    peelC = vec3(0.47, 0.45, 0.41) * (0.8 + 0.4 * vnz(vec2(wx * 5.0, hh * 5.0)));
    weather = 1.0 - ag * (0.42 * streak + 0.28 * blot) - (0.07 + 0.2 * ag) * base - (0.07 + 0.25 * ag) * drip - 0.3 * rim;
    dirt = 1.0 - (0.05 + 0.12 * ag) * base;
    tint = mix(tint, vec3(dot(tint, vec3(0.2126, 0.7152, 0.0722))) * vec3(1.0, 0.98, 0.9), (0.04 + 0.22 * blot) * ag + 0.05 + 0.14 * ag);
  }
  float sum = max(wW + gW + kW + sW + tW, 1e-3);
  vec3 col = (wW * tx.rgb * mix(tint * 1.25, peelC, peel) * weather + gW * tx.rgb + kW * tx.rgb * mix(1.0, weather, 0.4) + sW * tx.rgb * signCol * 1.15 + tW * textCol) / sum;
  col *= dirt;
  diffuseColor.rgb *= col * roofVar;
  // W3-C: KÍNH PHẢN CHIẾU TRỜI (cộng vào ánh sáng gián tiếp sau khi tính đèn — xem lights_fragment_end): mặt khuất nắng
  // không còn "ô đen"; kiểu kính/hiện đại phản mạnh hơn cửa sổ thường.
  fabRefl = vec3(0.50, 0.62, 0.78) * glassK * (gW / sum);
  // ĐÊM: kính sáng ngẫu nhiên theo ô cửa; cửa hàng trệt sáng gần hết
  // ánh đèn nhân với chính texture (rèm/nội thất/hàng hoá vẫn đọc được, không thành ô trắng loá)
  float lit = step(litP, h21(vec2(seed * 31.7 + cellKey, 4.1)));
  vec3 warm = vec3(1.0, 0.76, 0.46);
  // nhà ở VN: ~nửa số phòng sáng đèn tuýp/LED TRẮNG LẠNH, nửa đèn vàng ấm (W2-F; trước: mọi cửa sổ cùng màu cam)
  vec3 roomC = h21(vec2(seed * 13.3 + cellKey, 7.7)) < 0.5 ? vec3(0.80, 0.88, 1.0) : warm;
  fabGlow += (gW / sum) * lit * roomC * (0.18 + tx.rgb * 1.1) + isG * (kW / sum) * lit * (tx.rgb * 0.9 + warm * 0.06);
  // W5-B: trệt KÍNH (showroom/cửa hàng/ngân hàng/sảnh) + cửa hàng MỞ sáng đèn trong CẢ BAN NGÀY (đèn tuýp/LED — pano: nội thất
  // cửa hàng không tối đen như hang) — cộng phát sáng không phụ thuộc đêm, chỉ phần nội thất/kính (kW, gW) của tầng trệt
  if (isG > 0.5) fabDay = tx.rgb * ((kW + gW) / sum) * dayLitOf(m);
  // W5-B: BẠT mái hiên xuyên sáng (mặt dưới bạt nắng chiếu = màu bạt rực nhẹ, không phải mảng tối)
  if (kind == 5 && (abs(m - ${MOD.D_AWN}.0) < 0.5 || abs(m - ${MOD.D_AWN3}.0) < 0.5)) fabDay = col * 0.22;
  // biển bảng lớn / biển dọc (kind 5) sáng đèn đêm, trần độ chói như dải biển
  if ((pnl > 0.5 && lit > 0.5) || kind == 5) {
    float ss2 = (sW + tW) / sum, cLum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    fabGlow += col * (0.4 * ss2) * min(1.0, 0.24 / max(cLum, 1e-3));
  }
}`))
      .replace('#include <color_fragment>', '')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fabGlow * emissive.r + fabDay;\n#ifdef HP_UNLIT_K\ntotalEmissiveRadiance *= HP_UNLIT_K;\n#endif')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
#if defined( RE_IndirectDiffuse )
  { float ndv = clamp(abs(dot(geometryNormal, geometryViewDir)), 0.0, 1.0);
    reflectedLight.indirectDiffuse += fabRefl * (0.35 + 0.65 * pow(1.0 - ndv, 4.0)) * irradiance * RECIPROCAL_PI; }
#endif`)
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= fabAO; reflectedLight.directDiffuse *= mix(1.0, fabAO, 0.35);');
  };
  m.customProgramCacheKey = () => 'fabric_v5b_' + size;
  _mat = m;
  return m;
}
export function fabricMaterial() { return _mat || makeMaterial(); }
// W3-C: chẩn đoán — kiểu dựng (aFac.z tường: kiểu | tuổi<<4 | biển lớn<<6) + cờ bằng chứng FEF của nhà b
let _rsz = null, _evb = null;
export function fabricFacadeOf(b) {
  if (!_rsz) return null;
  const D = _D, e = D && D.fpE ? D.fpE[b] : -1, fp = e >= 0 ? Object.fromEntries(Object.keys(D.fp).filter((k) => k !== 'n' && k !== 'idx').map((k) => [k, D.fp[k][e]])) : null;
  return { z: _rsz[b], rs: _rsz[b] & 15, age: (_rsz[b] >> 4) & 3, panel: (_rsz[b] >> 6) & 1, ev: _evb[b], fp };   // W4-A: + vân tay
}
export function fabricAtlasInfo() { return _atlas ? { size: _atlas.size, height: _atlas.height, ms: Math.round(_atlas.ms), cells: _atlas.mods.length, how: _atlas.how } : null; }

// ---------- bộ đệm hình học tăng dần (typed array) ----------
class GBuf {
  constructor(cap = 8192) {
    this.n = 0; this.ni = 0; this.cap = cap; this.icap = cap * 2;
    this.P = new Float32Array(cap * 3); this.Nn = new Int8Array(cap * 3); this.U = new Float32Array(cap * 2);
    this.Cc = new Uint8Array(cap * 3); this.F = new Uint8Array(cap * 4); this.I = new Uint32Array(this.icap);
    this.FP = new Uint8Array(cap * 4); this.fpv = FP_NONE;   // W4-A: aFp của nhà ĐANG dựng (đặt 1 lần/nhà, mọi đỉnh nhận)
  }
  growV() {
    const c = this.cap * 2, g = (A, k) => { const B = new A.constructor(c * k); B.set(A); return B; };
    this.P = g(this.P, 3); this.Nn = g(this.Nn, 3); this.U = g(this.U, 2); this.Cc = g(this.Cc, 3); this.F = g(this.F, 4); this.FP = g(this.FP, 4); this.cap = c;
  }
  v(x, y, z, nx, ny, nz, u, w, col, f0, f1, f2, f3) {
    if (this.n >= this.cap) this.growV();
    const i = this.n, i3 = i * 3, i2 = i * 2, i4 = i * 4;
    this.P[i3] = x; this.P[i3 + 1] = y; this.P[i3 + 2] = z;
    this.Nn[i3] = Math.round(nx * 127); this.Nn[i3 + 1] = Math.round(ny * 127); this.Nn[i3 + 2] = Math.round(nz * 127);
    this.U[i2] = u; this.U[i2 + 1] = w;
    this.Cc[i3] = col[0]; this.Cc[i3 + 1] = col[1]; this.Cc[i3 + 2] = col[2];
    this.F[i4] = f0; this.F[i4 + 1] = f1; this.F[i4 + 2] = f2; this.F[i4 + 3] = f3;
    const fv = this.fpv; this.FP[i4] = fv[0]; this.FP[i4 + 1] = fv[1]; this.FP[i4 + 2] = fv[2]; this.FP[i4 + 3] = fv[3];
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
    g.setAttribute('aFp', new THREE.BufferAttribute(this.FP.slice(0, this.n * 4), 4, false));
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

// ---------- W4-C: quad theo PHÁP TUYẾN mong muốn (tự đảo thứ tự đỉnh nếu ngược chiều — khỏi nhầm CCW) ----------
function quadN(G, p, nx, ny, nz, uv, col, s8, cell) {
  const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2], bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  if (cx * nx + cy * ny + cz * nz < 0) {
    p = [p[0], p[1], p[2], p[9], p[10], p[11], p[6], p[7], p[8], p[3], p[4], p[5]];
    uv = [uv[0], uv[1], uv[6], uv[7], uv[4], uv[5], uv[2], uv[3]];
  }
  G.quad(p, nx, ny, nz, uv, col, s8, 5, cell, 0);
}
// ---------- W5-B STREETFRONT: hộp chi tiết áp tường (hàng bày, chậu cây ban công) ----------
// (ax,az) điểm trên mép tường, e = hướng dọc cạnh, n = pháp tuyến ra phố; hộp dọc s0..s1, nhô o0..o1, cao yb..yt.
// uvF/uvT = [u0,v0,u1,v1] trong ô (vùng con D_MISC; uvT null = không mặt trên); sides: bit 1 má −e, bit 2 má +e (dải hẹp đầu
// uvF). Mặt sau/đáy bỏ (áp tường/chôn hè). n = (−e.z, e.x) (pháp tuyến ra ngoài của cạnh tường citygen) ⇒ thứ tự đỉnh dưới đây
// ĐÃ đúng CCW nhìn từ phía pháp tuyến (kiểm bằng tích có hướng) — gọi thẳng G.quad, không qua quadN (đỡ ~40k lần cấp mảng).
function boxN(G, ax, az, ex, ez, nx, nz, s0, s1, o0, o1, yb, yt, uvF, uvT, col, s8, cell, sides = 3) {
  const Ax = ax + ex * s0 + nx * o1, Az = az + ez * s0 + nz * o1, Bx = ax + ex * s1 + nx * o1, Bz = az + ez * s1 + nz * o1;
  const Cx = ax + ex * s0 + nx * o0, Cz = az + ez * s0 + nz * o0, Dx = ax + ex * s1 + nx * o0, Dz = az + ez * s1 + nz * o0;
  const u0 = uvF[0], v0 = uvF[1], u1 = uvF[2], v1 = uvF[3], us = u0 + Math.min(u1 - u0, (o1 - o0) / 4);
  let t = 2;
  G.quad([Ax, yb, Az, Bx, yb, Bz, Bx, yt, Bz, Ax, yt, Az], nx, 0, nz, [u0, v0, u1, v0, u1, v1, u0, v1], col, s8, 5, cell, 0);
  if (uvT) { G.quad([Ax, yt, Az, Bx, yt, Bz, Dx, yt, Dz, Cx, yt, Cz], 0, 1, 0, [uvT[0], uvT[1], uvT[2], uvT[1], uvT[2], uvT[3], uvT[0], uvT[3]], col, s8, 5, cell, 0); t += 2; }
  if (sides & 1) { G.quad([Cx, yb, Cz, Ax, yb, Az, Ax, yt, Az, Cx, yt, Cz], -ex, 0, -ez, [u0, v0, us, v0, us, v1, u0, v1], col, s8, 5, cell, 0); t += 2; }
  if (sides & 2) { G.quad([Bx, yb, Bz, Dx, yb, Dz, Dx, yt, Dz, Bx, yt, Bz], ex, 0, ez, [u0, v0, us, v0, us, v1, u0, v1], col, s8, 5, cell, 0); t += 2; }
  return t;
}
// W5-B: CÂY CẢNH ban công — mặt trước là đa giác 6 đỉnh dáng TÁN (vai tròn, đỉnh lệch) thay hộp vuông (đọc ra "khối hộp xanh"),
// 2 má thấp tới vai; vùng con tán lá D_MISC [0,.5]×[.5,1]. 8 tam giác. Thứ tự đỉnh như boxN (CCW nhìn từ n).
function blobN(G, ax, az, ex, ez, nx, nz, s0, s1, o0, o1, yb, h, u0, col, s8, cell) {
  const w = s1 - s0, base = G.n;
  const pts = [[s0, 0], [s1, 0], [s1 + 0.05 * w, 0.55], [s1 - 0.18 * w, 1], [s0 + 0.32 * w, 0.92], [s0 - 0.05 * w, 0.5]];
  for (const [sa, f] of pts) {
    const y = yb + f * h;
    G.v(ax + ex * sa + nx * o1, y, az + ez * sa + nz * o1, nx, 0, nz, u0 + (sa - s0 + 0.05 * w) / 4, 0.504 + Math.min(0.49, (f * h) / 4), col, s8, 5, cell, 0);
  }
  for (let k = 1; k < 5; k++) G.t(base, base + k, base + k + 1);
  const yS = yb + 0.5 * h, uS = u0 + (o1 - o0) / 4, vS = 0.504 + (0.5 * h) / 4;
  const Ax = ax + ex * s0 + nx * o1, Az = az + ez * s0 + nz * o1, Bx = ax + ex * s1 + nx * o1, Bz = az + ez * s1 + nz * o1;
  const Cx = ax + ex * s0 + nx * o0, Cz = az + ez * s0 + nz * o0, Dx = ax + ex * s1 + nx * o0, Dz = az + ez * s1 + nz * o0;
  G.quad([Cx, yb, Cz, Ax, yb, Az, Ax, yS, Az, Cx, yS, Cz], -ex, 0, -ez, [u0, 0.504, uS, 0.504, uS, vS, u0, vS], col, s8, 5, cell, 0);
  G.quad([Bx, yb, Bz, Dx, yb, Dz, Dx, yS, Dz, Bx, yS, Bz], ex, 0, ez, [u0, 0.504, uS, 0.504, uS, vS, u0, vS], col, s8, 5, cell, 0);
  return 8;
}
// mô-đun trệt là CỬA HÀNG MỞ (hàng bày tràn ra hè trước cửa)
const OPEN_G = new Set(['G_SHOP0', 'G_SHOP1', 'G_SHOP2', 'G_OPEN0', 'G_OPEN1', 'G_OPEN2', 'G_FOOD', 'G_HARD', 'G_MOTO']);
const lighten = (c, t) => [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)];
// hộp đua dọc cạnh tường a→b (s0..s1 m dọc cạnh, nhô P, y yb..yt): mặt trước + đáy (+ đỉnh) + 2 đầu. Trả số tam giác.
function ledge(G, ax, az, ex, ez, nx, nz, s0, s1, P, yb, yt, col, s8, cellF, vF, top, ends) {
  const p0x = ax + ex * s0, p0z = az + ez * s0, p1x = ax + ex * s1, p1z = az + ez * s1;
  const q0x = p0x + nx * P, q0z = p0z + nz * P, q1x = p1x + nx * P, q1z = p1z + nz * P, w = (s1 - s0) / 4, d = P / 4, h = (yt - yb) / 4;
  quadN(G, [q0x, yb, q0z, q1x, yb, q1z, q1x, yt, q1z, q0x, yt, q0z], nx, 0, nz, [s0 / 4, vF[0], s1 / 4, vF[0], s1 / 4, vF[1], s0 / 4, vF[1]], col, s8, cellF);
  quadN(G, [p0x, yb, p0z, p1x, yb, p1z, q1x, yb, q1z, q0x, yb, q0z], 0, -1, 0, [0, 0, w, 0, w, d, 0, d], col, s8, MOD.D_PLAIN);
  let t = 4;
  if (top) { quadN(G, [p0x, yt, p0z, p1x, yt, p1z, q1x, yt, q1z, q0x, yt, q0z], 0, 1, 0, [0, 0, w, 0, w, d, 0, d], col, s8, MOD.D_PLAIN); t += 2; }
  if (ends) {
    quadN(G, [p0x, yb, p0z, q0x, yb, q0z, q0x, yt, q0z, p0x, yt, p0z], -ex, 0, -ez, [0, 0, d, 0, d, h, 0, h], col, s8, MOD.D_PLAIN);
    quadN(G, [p1x, yb, p1z, q1x, yb, q1z, q1x, yt, q1z, p1x, yt, p1z], ex, 0, ez, [0, 0, d, 0, d, h, 0, h], col, s8, MOD.D_PLAIN);
    t += 4;
  }
  return t;
}
// W4-C BỘ CHI TIẾT THUỘC ĐỊA / TÂN CỔ ĐIỂN / BIỆT THỰ trên MẶT PHỐ (AUDIT4 D1 "ornate colonial detail missing" 051/161/423/
// 496/506/538): GỜ PHÀO MÁI nhô 0,36 m (ô CHÍNH M — bóng đổ + bóng viền mái thấy từ xa, 10 tam giác), GỜ TẦNG nhô 0,13 m mỗi
// sàn (ô gần DT, 4 tam giác/tầng), TRỤ ÁP nhô 0,11 m ở MỌI ranh bay từ tầng 1 (trệt thuộc địa là cửa hàng) — khớp trụ vẽ ở 2
// mép bay của U_COL*/U_NEO/U_VILLA* (6 tam giác/trụ). Màu = màu tường sáng hơn 35% (gờ vữa trắng ngà).
function classicKit(M, DT, ax, az, bx, bz, dx, dz, L, nx, nz, nb, y0, H, fl, rt, wcol, s8, st) {
  const ex = dx / L, ez = dz / L, lc = lighten(wcol, 0.35);
  const yTop = y0 + H + 0.06;
  st.tris += ledge(M, ax, az, ex, ez, nx, nz, 0, L, 0.36, yTop - 0.42, yTop, lc, s8, MOD.D_CORN, [0, 1], true, true);
  st.corn = (st.corn || 0) + 1;
  if (!DT || fl < 2) return;
  for (let k = 1; k < fl; k++) {
    const y = y0 + heightOf(k);
    st.detTris += ledge(DT, ax, az, ex, ez, nx, nz, 0, L, 0.13, y - 0.06, y + 0.16, lc, s8, MOD.D_CORN, [0.42, 1], false, false);
  }
  if (nb > 16) return;
  const bw = L / nb, yb = y0 + GROUND_H - 0.1, yt = yTop - 0.42;
  if (yt - yb < 1) return;
  for (let k = 0; k <= nb; k++) {
    const c = k * bw, s0 = Math.max(0, c - 0.26), s1 = Math.min(L, c + 0.26);
    st.detTris += pilaster3(DT, ax, az, ex, ez, nx, nz, s0, s1, 0.11, yb, yt, lc, s8);
    st.pil = (st.pil || 0) + 1;
  }
}
function pilaster3(G, ax, az, ex, ez, nx, nz, s0, s1, P, yb, yt, col, s8) {
  const p0x = ax + ex * s0, p0z = az + ez * s0, p1x = ax + ex * s1, p1z = az + ez * s1;
  const q0x = p0x + nx * P, q0z = p0z + nz * P, q1x = p1x + nx * P, q1z = p1z + nz * P, w = (s1 - s0) / 4, h = (yt - yb) / 4, d = P / 4;
  quadN(G, [q0x, yb, q0z, q1x, yb, q1z, q1x, yt, q1z, q0x, yt, q0z], nx, 0, nz, [0, 0, w, 0, w, h, 0, h], col, s8, MOD.D_PLAIN);
  quadN(G, [p0x, yb, p0z, q0x, yb, q0z, q0x, yt, q0z, p0x, yt, p0z], -ex, 0, -ez, [0, 0, d, 0, d, h, 0, h], col, s8, MOD.D_PLAIN);
  quadN(G, [p1x, yb, p1z, q1x, yb, q1z, q1x, yt, q1z, p1x, yt, p1z], ex, 0, ez, [0, 0, d, 0, d, h, 0, h], col, s8, MOD.D_PLAIN);
  return 6;
}
// W4-C MÁI SẢNH KÍNH khách sạn (porte-cochère): tấm 5,5 m × ≤20 m ở +4,4..4,75 m giữa mặt phố dài nhất — mặt trên kính sẫm
// (D_SIGNF), trần dưới sáng, diềm nhôm tối 3 phía. 10 tam giác.
const CANOPY_SOFFIT = [232, 232, 228];
function hotelCanopy(G, ax, az, bx, bz, fL, nx, nz, y0, s8, st) {
  const ex = (bx - ax) / fL, ez = (bz - az) / fL, W = Math.min(20, fL * 0.55), s0 = (fL - W) / 2;
  st.detTris += ledge(G, ax, az, ex, ez, nx, nz, s0, s0 + W, 5.5, y0 + 4.4, y0 + 4.75, WHITE, s8, MOD.D_SIGNF, [0, 1], false, true);
  // trần sáng (đè lên mặt đáy D_PLAIN tối của ledge? không — ledge đáy dùng màu WHITE × D_PLAIN = sáng) + mặt trên kính sẫm
  const p0x = ax + ex * s0, p0z = az + ez * s0, p1x = p0x + ex * W, p1z = p0z + ez * W, D = 5.5, yt = y0 + 4.75;
  quadN(G, [p0x, yt, p0z, p1x, yt, p1z, p1x + nx * D, yt, p1z + nz * D, p0x + nx * D, yt, p0z + nz * D], 0, 1, 0, [0, 0, W / 4, 0, W / 4, D / 4, 0, D / 4], CANOPY_SOFFIT, s8, MOD.U_CURT2);
  st.detTris += 2; st.canopyH = (st.canopyH || 0) + 1;
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
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], hw = r.c in ROAD_HW ? roadHW(r) : 2.75, pad = hw + 16;   // W3-A: lòng riêng phố
    // seg[6] = vỉa hè (W3-C exposedSide) — RIÊNG từng phố như lòng (tích hợp W3)
    const seg = [ax, az, bx, bz, hw, r.c === 'h' ? 2 : (r.c === 'r' || r.c === 'w') ? 1 : 0, r.c in ROAD_HW ? sidewalkW(r) : 0];
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
// W3-C (AUDIT3 FP-3 #1 "không tường trống nhìn từ phố"): cạnh HÔNG/SAU không được nâng thành mặt phố (faceRoad: nhìn THẲNG
// ra lòng đường) nhưng vẫn LỘ ra phố — đầu gần phố cách mép hành lang đường (lòng + vỉa hè) ≤ 3 m và trước mặt tường trống
// (không có nhà kề sát) → shader dùng bộ mô-đun TƯỜNG HÔNG LỘ (cửa sổ nhỏ thưa, điều hoà, vệt ố, đôi khi quảng cáo sơn) thay
// vì 45% "trơn cả mặt" (pano_340 h270, 372 h0, 175 h270, 198 h0: tường hông dọc phố trống trơn). Cần lưới va chạm (fabricAt).
function exposedSide(ax, az, bx, bz, nx, nz, b) {
  const l = roadGrid().get(Math.floor((ax + bx) / 2 / RG) * 65536 + Math.floor((az + bz) / 2 / RG)); if (!l) return false;
  // đầu mút gần phố ≤ 3 m ngoài hành lang: mút cách trung điểm ≤ L/2 → lọc bằng trung điểm trước (1 phép/đoạn), rồi mới tính mút
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, h2 = Math.hypot(bx - ax, bz - az) / 2;
  let near = false;
  for (const sg of l) {
    const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L2 = dx * dx + dz * dz || 1e-9, lim = sg[4] + sg[6] + 3;
    let u = ((mx - sg[0]) * dx + (mz - sg[1]) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const ex = mx - sg[0] - dx * u, ez = mz - sg[1] - dz * u;
    if (ex * ex + ez * ez > (lim + h2) * (lim + h2)) continue;
    for (let k = 0; k < 2 && !near; k++) {
      const px = k ? bx : ax, pz = k ? bz : az;
      let v = ((px - sg[0]) * dx + (pz - sg[1]) * dz) / L2; v = v < 0 ? 0 : v > 1 ? 1 : v;
      const qx = px - sg[0] - dx * v, qz = pz - sg[1] - dz * v;
      if (qx * qx + qz * qz <= lim * lim) near = true;
    }
    if (near) break;
  }
  if (!near) return false;
  let free = 0;
  for (const t of [0.2, 0.5, 0.8]) {
    const o = fabricAt(ax + (bx - ax) * t + nx * 1.2, az + (bz - az) * t + nz * 1.2);
    if (o < 0 || o === b) free++;
  }
  return free >= 2;
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
          for (const c of cands) if (fabricAt(c[1], c[2]) < 0) { ox = c[1]; oz = c[2]; break; }
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
  // KẸT (dữ liệu v1 dày đặc): lô KÍN mọi cạnh giáp nhà khác, hoặc KHE/hõm đa giác lõm hẹp hơn 2r (đẩy khỏi tường này lại
  // lọt vào tường kia) → sau 2 lượt vẫn trong nhà. Xoắn ốc (bước 0,5 m tới 8 m rồi 1 m, ≤ 60 m: khối kho cảng liền nhau) tìm điểm ngoài mọi nhà và cách tường ~r.
  // Hiếm (đo: ~0,6% tâm nhà v1 thử), chỉ chạy khi kẹt.
  if (moved && fabricAt(p.x, p.z) >= 0) {
    const rr = r * 0.95, clear = (x, z) => fabricAt(x, z) < 0 && fabricAt(x + rr, z) < 0 && fabricAt(x - rr, z) < 0 && fabricAt(x, z + rr) < 0 && fabricAt(x, z - rr) < 0;
    for (let rad = 0.5; rad <= 60; rad += rad < 8 ? 0.5 : 1) {
      const na = Math.max(8, Math.round(rad * 8)), a0 = rad * 1.7;
      let hit = false;
      for (let a = 0; a < na; a++) {
        const ang = a0 + (a / na) * Math.PI * 2, x = p.x + Math.cos(ang) * rad, z = p.z + Math.sin(ang) * rad;
        if (clear(x, z)) { p.x = x; p.z = z; hit = true; break; }
      }
      if (hit) break;
    }
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

// ---------- W3-C: KIỂU DỰNG + TUỔI + "nhiều biển lớn" theo BẰNG CHỨNG pano (js/facade_evidence.js) + VÙNG + sửa dữ liệu ----------
// (AUDIT3 §4.3 "defaults only add": kiểu mặt tiền nay đi theo quan sát thật của 551 pano; mặc định chỉ là xác suất theo vùng.)
// Gọi SAU buildCollision (cần fabricAt). Trả { rsz: aFac.z tường mỗi nhà, ev: cờ FEF bằng chứng trực tiếp, stats }.
// Xác định: chỉ hash(seed nhà) — A/B ảnh so được.
function renderStyles(D, CX, CZ) {
  const nB = D.nB, rsz = new Uint8Array(nB), ev = new Uint16Array(nB);
  const sts = { obs: 0, evHit: 0, rs: new Array(NRS).fill(0), age: [0, 0, 0, 0], panel: 0, nosignKeep: 0 };
  // 1) tia nhìn từ camera pano theo hướng quan sát (h−8°, h, h+8°; 2-45 m) → nhà ĐẦU TIÊN chạm mang cờ quan sát.
  //    hướng pano: 0° = bắc = −z, 90° = đông = +x
  for (let o = 0; o < FE_OBS.length; o += 5) {
    const f = FE_OBS[o + 3]; if (!f) continue;
    const px = FE_OBS[o] / 10, pz = FE_OBS[o + 1] / 10, h = FE_OBS[o + 2];
    sts.obs++;
    for (const dh of [-8, 0, 8]) {
      const a = ((h + dh) * Math.PI) / 180, dx = Math.sin(a), dz = -Math.cos(a);
      for (let d = 2; d <= 45; d += 1) { const b = fabricAt(px + dx * d, pz + dz * d); if (b >= 0) { if (!ev[b]) sts.evHit++; ev[b] |= f; break; } }
    }
  }
  // 2) vùng + tuổi của pano gần nhất (≤ 90 m), lưới 64 m
  const PGZ = 64, pg = new Map();
  for (let i = 0; i < FE_PANO.length; i += 4) {
    const k = Math.floor(FE_PANO[i] / 10 / PGZ) * 65536 + Math.floor(FE_PANO[i + 1] / 10 / PGZ);
    let l = pg.get(k); if (!l) pg.set(k, (l = [])); l.push(i);
  }
  const zoneAt = (x, z) => {
    let best = 90 * 90, bi = -1; const gx = Math.floor(x / PGZ), gz = Math.floor(z / PGZ);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) {
      const l = pg.get(i * 65536 + j); if (!l) continue;
      for (const q of l) { const d = (FE_PANO[q] / 10 - x) ** 2 + (FE_PANO[q + 1] / 10 - z) ** 2; if (d < best) { best = d; bi = q; } }
    }
    return bi;
  };
  for (let b = 0; b < nB; b++) {
    if (D.dead[b]) continue;
    const s = D.vStart[b], n = D.vStart[b + 1] - s;
    let A = 0, fL = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0, ax = D.x[s + i], az = D.z[s + i], bx = D.x[s + j], bz = D.z[s + j];
      A += ax * bz - bx * az;
      if (D.edge[s + i] === EDGE.FRONT) { const L = Math.hypot(bx - ax, bz - az); if (L > fL) fL = L; }
    }
    const area = Math.abs(A) / 2, sty = Math.min(6, D.style[b]), fl = Math.max(1, D.floors[b]), seed = D.seed[b];
    const e = ev[b], zi = zoneAt(CX[b], CZ[b]), zf = zi >= 0 ? FE_PANO[zi + 2] : 0, zAge = zi >= 0 ? FE_PANO[zi + 3] : 1;
    const r1 = hh(seed, 301), r2 = hh(seed, 303), r3 = hh(seed, 305);
    let rs = sty;
    // (a) sửa dữ liệu: kho tôn ≥3 tầng (pano_230: khách sạn 25 tầng ra tường tôn), tháp ≥9 tầng, lô kính hẹp (pano_395/386)
    if (sty === STYLE.SHED && fl >= 3) rs = fl >= 9 ? RS.TOWER : area >= 2500 ? STYLE.GLASS : STYLE.CIVIC;
    else if (fl >= 9 && (sty === STYLE.TUBE || sty === STYLE.OLD)) rs = r1 < 0.65 ? RS.TOWER : STYLE.GLASS;
    else if (fl >= 9 && sty === STYLE.GLASS && r1 < 0.4) rs = RS.TOWER;
    else if (sty === STYLE.GLASS && fl <= 6 && fL <= 10.5 && area < 450) rs = RS.MODERN;
    // (b) bằng chứng trực tiếp (quan sát pano chạm đúng nhà này) thắng
    if (e) {
      // ĐANG XÂY chỉ cho nhà ≤ 8 tầng mà mô tả KHÔNG kèm kính/tân cổ điển/cao tầng: quan sát "thi công/giàn giáo" gần tháp
      // thường là rào/công trình dưới chân — phủ lưới + gạch cả tháp 15-20 tầng là sai rất lộ (nhóm đối chứng pano_285/304 h180)
      // W4-C: KHÁCH SẠN/tháp văn phòng = quan sát "cao tầng" + "kính" (hoặc + "tân cổ điển" = đế đá) trên khối LỚN — trước
      // luật NEO/GLASS: pano_359 sảnh khách sạn kính (cao tầng+kính+tân cổ điển, dữ liệu 6 tầng) ra mặt tân cổ điển be;
      // pano_230 tháp kính (cao tầng+kính) ra khối xám ố
      if ((e & FEF.TOWER) && (e & (FEF.GLASS | FEF.NEO | FEF.SHOW)) && area >= 1200 && sty !== STYLE.KTT) rs = RS.HOTEL;
      else if ((e & FEF.CONS) && fl <= 8 && !(e & (FEF.GLASS | FEF.NEO | FEF.TOWER))) rs = RS.CONS;
      else if ((e & FEF.TEN) && fl >= 3 && fl <= 8) rs = RS.TEN;
      else if ((e & FEF.NEO) && fl <= 6 && (area >= 250 || sty === STYLE.CIVIC || sty === STYLE.VILLA)) rs = RS.NEO;
      else if ((e & FEF.COL) && fl <= 5 && sty !== STYLE.SHED) rs = RS.COL;
      else if ((e & (FEF.GLASS | FEF.SHOW)) && rs !== RS.TOWER) rs = fl <= 6 && fL <= 12 && area < 450 ? RS.MODERN : STYLE.GLASS;
      else if ((e & FEF.TOWER) && fl >= 7 && rs !== STYLE.GLASS) rs = RS.TOWER;
    } else {
      // (c) vùng (pano gần nhất): XÁC SUẤT, không phải mặc định cứng
      if (zf & FEZ.COLQ) {
        if ((sty === STYLE.OLD || sty === STYLE.VILLA) && fl <= 5 && r2 < 0.6) rs = RS.COL;
        else if (sty === STYLE.CIVIC && fl <= 6 && r2 < 0.5) rs = RS.NEO;
        else if (sty === STYLE.TUBE && fl <= 3 && r2 < 0.12) rs = RS.COL;
      } else if (sty === STYLE.OLD && fl <= 4 && r2 < 0.1) rs = RS.COL;
      if (sty === STYLE.KTT && r3 < ((zf & FEZ.OLDQ) ? 0.6 : 0.3)) rs = RS.TEN;
      if (rs === STYLE.TUBE && (zf & FEZ.COMM) && !(zf & FEZ.OLDQ) && r3 < 0.16) rs = RS.MODERN;
      // ĐANG XÂY ngẫu nhiên (pano: 70/1.920 quan sát ~3,6% đang xây) CHỈ ở nơi KHÔNG có pano nào ≤ 90 m (zi < 0): trong vùng
      // phủ pano, mô tả không nhắc thi công = BẰNG CHỨNG ÂM → không phủ lưới (phản biện W3-C: 259/312 nhà CONS là roll ngẫu
      // nhiên, ~50 cái cách camera pano thật ≤ 40 m, vd pano_141 khung chuẩn, 414 đối chứng — AUDIT3 §4.3 "mặc định chỉ thêm")
      if (zi < 0 && (rs === STYLE.TUBE || rs === STYLE.OLD) && fl <= 5 && hh(seed, 307) < 0.008) rs = RS.CONS;
    }
    // W4-A: VÂN TAY (quan sát thật của CHÍNH nhà này trong ảnh pano) thắng mọi luật trên
    // W4-A r2 (phản biện): ĐANG XÂY từ bằng chứng trực tiếp (FEF.CONS: mô tả pano nhắc thi công/giàn giáo/rào tôn) GIỮ
    // nguyên — trích xuất vân tay thấy "nhà ống" sau rào (pano_106 h90: rào "ĐANG THI CÔNG" thành nhà cửa cuốn ban công)
    const fe = D.fpE ? D.fpE[b] : -1, consEv = rs === RS.CONS && (e & FEF.CONS), hotelEv = rs === RS.HOTEL;
    if (fe >= 0) { const r = fpRenderStyle(D, fe, fl, fL, area); if (r >= 0) { rs = r; sts.fpRs = (sts.fpRs || 0) + 1; } }
    if (consEv && rs !== RS.CONS) { rs = RS.CONS; sts.fpConsKeep = (sts.fpConsKeep || 0) + 1; }
    // tích hợp W4 (A × C): KHÁCH SẠN từ bằng chứng FEF (W4-C, pano_359/230) giữ nguyên khi vân tay chỉ nói kính/tháp/tân cổ
    // điển/công sở — nếu không pano_359 lại ra mặt tân cổ điển be (hồi quy wave 3 mà W4-C vừa sửa)
    if (hotelEv && rs !== RS.HOTEL && (rs === STYLE.GLASS || rs === RS.TOWER || rs === RS.MODERN || rs === RS.NEO || rs === STYLE.CIVIC)) { rs = RS.HOTEL; sts.fpHotelKeep = (sts.fpHotelKeep || 0) + 1; }
    // tích hợp W3 (W3-A × W3-C): dữ liệu CIVIC/GLASS/SHED + USE_HOME (khối khuôn viên Hải quân cbIn — W3-A r3; ô 'home' của W3-B)
    // phải GIỮ kiểu dựng thuộc NOSIGN_ST, nếu không groundModule/shader mất luật "rc 3 → trệt không biển" (CIVIC→NEO,
    // GLASS→MODERN/TOWER ở (a)-(c) ⇒ lại hiện "BÁNH MÌ"/"SỬA XE MÁY" sau tường mỏ neo pano_224/225 h270)
    if (NOSIGN_ST(sty) && !NOSIGN_ST(rs) && D.info && ((D.info[b] >> INFO.USE_SHIFT) & 3) === INFO.USE_HOME) { rs = (rs === RS.TOWER || rs === RS.MODERN) ? STYLE.GLASS : STYLE.CIVIC; sts.nosignKeep++; }
    // (d) tuổi (lớp phong hoá shader): theo kiểu + vùng + bằng chứng cũ/mới + biến thiên theo hạt giống
    let age = (rs === RS.TEN || rs === STYLE.OLD || rs === RS.COL || rs === STYLE.KTT) ? 2
      : (rs === STYLE.GLASS || rs === RS.MODERN || rs === RS.TOWER || rs === RS.HOTEL) ? 0 : 1;
    age += zAge - 1;
    if (e & FEF.OLD) age += 1;
    if (e & FEF.NEW) age -= 1;
    const r4 = hh(seed, 309); if (r4 < 0.2) age += 1; else if (r4 < 0.32) age -= 1;
    if (rs === RS.CONS) age = 1;
    if (fe >= 0 && D.fp.age[fe] <= 3 && rs !== RS.CONS) age = D.fp.age[fe];   // W4-A: tuổi/phong hoá theo ảnh thật (đang xây giữ 1)
    if (rs === RS.HOTEL) age = Math.min(age, 1);   // W4-C: khách sạn/văn phòng được bảo trì — không ố nặng
    age = Math.max(0, Math.min(3, age));
    let panel = (e & FEF.BIGSIGN) || ((zf & FEZ.COMM) && hh(seed, 311) < 0.3) ? 1 : 0;
    if (fe >= 0 && D.fp.size[fe] !== 255) panel = fpPanelOK(D, fe, rs) ? 1 : 0;
    rsz[b] = rs | (age << 4) | (panel << 6);
    sts.rs[rs]++; sts.age[age]++; sts.panel += panel;
  }
  return { rsz, ev, stats: sts };
}

// ======================================================================================
// buildRealFabric(scene, ctx) — ctx: { groundHeightNoDeck(x,z), landH, reject(cx,cz) → true = bỏ nhà (vùng mở/hàm
// zone của world.js), maxR (bỏ nhà có tâm ngoài bán kính này — world.js truyền BUILD_RADIUS: ngoài vùng chơi không có
// đường/vỉa → nhà đứng trên cỏ trống), facadeMats (mảng để daynight điều khiển đêm), log }
// Trả { stats, meshes, detMeshes, collide: fabricCollide, at: fabricAt, hit, frontEdges, material, grid }.
// grid = rbGrid() (js/rbdata.js, lưới chung; near/at lọc nhà dead LÚC TRA nên đúng cả sau khi chốt D.dead) — world.js đặt world.rbData /
// world.rbGrid = D / grid để WP4 cây, WP7 props, WP8 camera dùng CHUNG (không giải mã lại, tôn trọng nhà đã bị gỡ).
export function buildRealFabric(scene, ctx) {
  const T0 = performance.now();
  const D = fabricData();
  const gh = ctx.groundHeightNoDeck, LAND_H = ctx.landH ?? 2;
  const tDecode = performance.now() - T0;
  // ---------- 1) LOẠI NHÀ dưới vùng giữ chỗ (claims) + zone hàm của world.js ----------
  const st = { total: D.nB, deadPre: 0, deadFar: 0, deadClaim: 0, deadZone: 0, deadWater: 0, deadPano: 0, built: 0, walls: 0, roofs: 0, tris: 0, detTris: 0, balc: 0, awn: 0, signBox: 0, signBay: 0, tanks: 0, tums: 0, canopy: 0, ac: 0, promoted: 0, exposed: 0, tWall: 0, tRoof: 0, tPar: 0 };
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
  const grid = rbGrid();   // lưới chung (lọc D.dead lúc tra) — không dựng lại sau khi giết nhà
  { const killed = []; for (let b = 0; b < D.nB; b++) if (D.dead[b]) killed.push(b);
    const r = refreshPartyEdges(D, grid, killed); st.partyDemoted = r.demoted; st.partyLowered = r.lowered; }
  buildCollision(D);   // lưới va chạm ngay sau khi chốt D.dead — faceRoad (bên dưới) cần fabricAt
  const tRs0 = performance.now();
  const RV = renderStyles(D, CX, CZ), RSZ = RV.rsz, EVB = RV.ev;   // W3-C: kiểu dựng/tuổi/biển lớn từng nhà
  _rsz = RSZ; _evb = EVB;
  st.facade = { obs: RV.stats.obs, evHit: RV.stats.evHit, rs: RV.stats.rs.join(','), age: RV.stats.age.join(','), panel: RV.stats.panel, ms: Math.round(performance.now() - tRs0) };
  const tClaims = performance.now() - T0 - tDecode;
  const mat = fabricMaterial();
  if (ctx.facadeMats) ctx.facadeMats.push(mat);
  const tAtlas = performance.now() - T0 - tDecode - tClaims;

  // ---------- 2) DỰNG theo ô ----------
  // gen() = toàn bộ hình học (XÁC ĐỊNH từ D + D.dead đã chốt) → gọi lại được khi khôi phục ngữ cảnh WebGL (bản CPU của
  // buffer đã bị giải phóng sau upload, xem RELEASE_CPU bên dưới). (thân hàm giữ thụt lề cũ cho diff gọn)
  const frontEdges = [];   // [x0,z0,x1,z1,nx,nz,yBase,b] — biển hiệu thật (SHOP_SIGNS) neo vào đây
  const gen = (st, frontEdges) => {
  const tiles = new Map(), dtiles = new Map(), ntiles = new Map();
  const tileOf = (cx, cz) => {
    const tx = Math.floor(cx / FAB_TILE), tz = Math.floor(cz / FAB_TILE), k = tx * 4096 + tz;
    let t = tiles.get(k); if (!t) tiles.set(k, (t = { tx, tz, buf: new GBuf(16384) })); return t.buf;
  };
  const detOf = (cx, cz) => {
    if (LITE_FAB) return null;
    const tx = Math.floor(cx / DET_TILE), tz = Math.floor(cz / DET_TILE), k = tx * 4096 + tz;
    let t = dtiles.get(k); if (!t) dtiles.set(k, (t = { tx, tz, buf: new GBuf(4096) })); return t.buf;
  };
  const nearOf = (cx, cz) => {   // W5-B (gọi khi đã có DT ⇒ không LITE)
    const tx = Math.floor(cx / NEAR_TILE), tz = Math.floor(cz / NEAR_TILE), k = tx * 4096 + tz;
    let t = ntiles.get(k); if (!t) ntiles.set(k, (t = { tx, tz, buf: new GBuf(4096) })); return t.buf;
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
    let wcol = WALL_LIN[D.wall[b] % WALL_LIN.length]; const rcol = ROOF_LIN[roofC];
    let y0 = 1e9; for (let i = 0; i < n; i++) { const g = gh(X[i], Z[i]); if (g < y0) y0 = g; }
    if (!(y0 > LAND_H - 1.2)) y0 = LAND_H;     // (chân tường chôn 0,3 m dưới y0 — ys = −0,3 bên dưới: không hở khe trên dốc nhẹ)
    // chi tiết gần chỉ cho nhà trong vùng chơi (+50 m): ngoài đó người chơi không bao giờ tới gần (ngân sách tam giác)
    const M = tileOf(CX[b], CZ[b]), DT = CX[b] * CX[b] + CZ[b] * CZ[b] < DET_RMAX * DET_RMAX ? detOf(CX[b], CZ[b]) : null;
    const NT = DT ? nearOf(CX[b], CZ[b]) : null;   // W5-B
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
    // W4-C: BIỆT THỰ (kiểu dựng) mái bằng gần chữ nhật → mái NGÓI 4 dốc (biệt thự Pháp HP: ngói đỏ — vệ tinh + pano)
    if ((RSZ[b] & 15) === STYLE.VILLA && (rt === ROOF.FLAT_PARAPET || rt === ROOF.FLAT) && rectness >= 0.85 && n <= 6 && areaPoly < 700 && fl <= 3 && hh(seed, 91) < 0.7) rt = ROOF.HIP_TILE;
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
    // W3-C: kiểu DỰNG (renderStyles: bằng chứng pano + vùng + sửa dữ liệu — thay luật cũ "≥9 tầng nhà ống → 60% KTT/40% kính")
    // styF = aFac.z tường (kiểu | tuổi<<4 | biển lớn<<6); rs = kiểu dựng; ev = cờ bằng chứng trực tiếp
    const styF = RSZ[b], rs = styF & 15, ev = EVB[b];
    // W4-A: vân tay → aFp mọi đỉnh của nhà này (M/DT dùng chung giữa các nhà: đặt lại MỖI nhà), màu tường thật
    const FPB = fpBuild(D, b, rs), fpG = FPB ? FPB.gs : 0, fpMode = FPB ? FPB.mode : 0;
    M.fpv = FPB ? FPB.bytes : FP_NONE; if (DT) DT.fpv = M.fpv; if (NT) NT.fpv = M.fpv;
    if (FPB && FPB.wall) wcol = FPB.wall;
    if (FPB) st.fp = (st.fp || 0) + 1;
    const bigFlag = (fl >= 5 || (areaPoly >= 600 && fl >= 3) || sty === STYLE.KTT || sty === STYLE.GLASS || sty === STYLE.CIVIC || sty === STYLE.VILLA
      || rs === RS.NEO || rs === RS.CONS || rs === RS.TOWER || rs === RS.TEN || rs === RS.HOTEL) ? 8 : 0;
    const tubeLike = rs === STYLE.TUBE || rs === STYLE.OLD || rs === RS.COL || rs === RS.MODERN;
    const detOK = !(rs === STYLE.GLASS || rs === STYLE.SHED || rs === RS.CONS || rs === RS.NEO || rs === RS.TOWER || rs === RS.HOTEL);
    // W4-C BỘ CHI TIẾT THUỘC ĐỊA / TÂN CỔ ĐIỂN / BIỆT THỰ: gờ phào mái (ô chính, thấy từ xa) + gờ tầng + trụ áp (ô gần)
    const classic = rs === RS.COL || rs === RS.NEO || rs === STYLE.VILLA;
    // ---- TƯỜNG ----
    let hasFront = false, fnx = 0, fnz = 0, fL = 0;   // pháp tuyến cạnh mặt phố DÀI nhất (hướng tum thang / mái tôn che)
    let fAx = 0, fAz = 0, fBx = 0, fBz = 0, fRc = 9;   // W3-C: đầu mút + cấp đường của cạnh đó (biển quảng cáo trên mái)
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
      const wideF = kind === EDGE.FRONT && rcP < 0 && nb >= 3 && fl <= 5 && tubeLike ? 16 : 0;
      // cạnh không phải mặt phố: rc = 1 ⇔ tường hông/sau/chung LỘ ra phố (exposedSide → shader bộ XP; W3-C)
      let rc = rcP >= 0 ? rcP : kind === EDGE.FRONT ? frontClass((ax + bx) / 2, (az + bz) / 2, nx, nz)
        : ((kind === EDGE.SIDE || kind === EDGE.BACK) && L >= 1.5 && rs !== STYLE.SHED && exposedSide(ax, az, bx, bz, nx, nz, b)) ? 1 : 0;
      if (kind !== EDGE.FRONT && rc) st.exposed++;
      if (hasInfo && kind === EDGE.FRONT && rcP < 0 && !wideF) { const use = (D.info[b] >> INFO.USE_SHIFT) & 3; if (use === INFO.USE_HOME) rc = 3; else if (use === INFO.USE_SHOP) rc = 0; }
      // W3-A r3: khối khuôn viên (CIVIC/GLASS/SHED + USE_HOME — chỉ nhà cbIn) → rc 3 cả trên cạnh được NÂNG/dãy gộp → trệt không biển
      // (tích hợp W3: styF của W3-C mang cả tuổi/biển lớn ở bit 4-6 → so KIỂU DỰNG rs = styF & 15, cùng `st` shader)
      if (hasInfo && kind === EDGE.FRONT && NOSIGN_ST(rs) && ((D.info[b] >> INFO.USE_SHIFT) & 3) === INFO.USE_HOME) rc = 3;
      // W3-B: nhà có KIỂU Ô theo pano (INFO bit 6-7: khuôn viên/chợ/nhà ở) mà không bán hàng → cả cạnh hông NÂNG thành mặt phố
      // và mặt dãy gộp cũng không mở cửa hàng (trước: lấy theo cấp phố → biệt thự/nhà ở mọc dải biển ở cạnh hông)
      if (hasInfo && kind === EDGE.FRONT && (rcP >= 0 || wideF) && ((D.info[b] >> INFO.PK_SHIFT) & 3) && ((D.info[b] >> INFO.USE_SHIFT) & 3) !== INFO.USE_SHOP) rc = 3;
      const kb = kind | bigFlag | wideF | pitchFlag | (rc << 6);
      // W3-C: cạnh có BAN CÔNG 3D (quyết định ở đây, dựng bên dưới) → bit 7 aFac.z: shader không đặt biển bảng lớn tầng 1-2
      // (biển phẳng trên tường bị ban công 3D che, pano_092)
      const balcP = rs === STYLE.TUBE ? 0.62 : (rs === STYLE.OLD || rs === RS.COL) ? 0.5 : rs === STYLE.VILLA ? 0.45 : (rs === STYLE.KTT || rs === RS.TEN) ? 0.3 : rs === RS.MODERN ? 0.2 : 0.15;
      // W4-A: ban công theo ảnh thật (không có → không dựng; có → gần như mọi mặt phố của nhà)
      const fpBalK = FPB && FPB.bal !== 255 ? FPB.bal : -1;
      const hasBalc = kind === EDGE.FRONT && !!DT && L >= 2.8 && L <= 18 && detOK && fl >= 2 && (fpBalK >= 0 ? fpBalK !== FPV.bal.none && hh(seed, 11 + i) < 0.92 : hh(seed, 11 + i) < balcP);
      const zE = styF | (hasBalc ? 128 : 0);
      const ta = Y[i], tb = Y[j];
      const a0 = M.v(ax, y0 + ys, az, nx, 0, nz, 0, ys, wcol, s8, kb, zE, fl);
      M.v(bx, y0 + ys, bz, nx, 0, nz, nb, ys, wcol, s8, kb, zE, fl);
      M.v(bx, y0 + tb, bz, nx, 0, nz, nb, tb, wcol, s8, kb, zE, fl);
      if (rt === ROOF.GABLE_TON && TD[i] * TD[j] < 0) {   // cạnh cắt đường nóc → đỉnh hồi
        const tt = TD[i] / (TD[i] - TD[j]);
        M.v(ax + dx * tt, y0 + H + rise, az + dz * tt, nx, 0, nz, nb * tt, H + rise, wcol, s8, kb, zE, fl);
        M.v(ax, y0 + ta, az, nx, 0, nz, 0, ta, wcol, s8, kb, zE, fl);
        M.t(a0, a0 + 1, a0 + 2); M.t(a0, a0 + 2, a0 + 3); M.t(a0, a0 + 3, a0 + 4);
        st.tris += 3; st.tWall += 3;
      } else {
        M.v(ax, y0 + ta, az, nx, 0, nz, 0, ta, wcol, s8, kb, zE, fl);
        M.t(a0, a0 + 1, a0 + 2); M.t(a0, a0 + 2, a0 + 3);
        st.tris += 2; st.tWall += 2;
      }
      st.walls++;
      if (kind === EDGE.FRONT) {
        if (L > fL) { fL = L; fnx = nx; fnz = nz; fAx = ax; fAz = az; fBx = bx; fBz = bz; fRc = rc; }
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
            DT.quad([q0x, yb, q0z, q1x, yb, q1z, q1x, yt, q1z, q0x, yt, q0z], nx, 0, nz, [fa, SIGN_Y[0], fb, SIGN_Y[0], fb, SIGN_Y[1], fa, SIGN_Y[1]], wcol, s8, kbBox, zE, fl);
            DT.quad([p0x, yb, p0z, q0x, yb, q0z, q0x, yt, q0z, p0x, yt, p0z], -ex, 0, -ez, [0, 0, d4, 0, d4, h1, 0, h1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
            DT.quad([q1x, yb, q1z, p1x, yb, p1z, p1x, yt, p1z, q1x, yt, q1z], ex, 0, ez, [0, 0, d4, 0, d4, h1, 0, h1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
            st.detTris += 6; st.signBox++;
            runA = -1;
          };
          for (let k = 0; k < nb; k++) {
            const ext = fpMode === 1 ? null : SIGN_EXT[groundModule(s8, k, wideF > 0, rc, rs, fpG)];   // W4-A: ảnh thật không biển → không hộp
            if (!ext) { if (runA >= 0) emit(); continue; }
            const fa = k + ext[0] / 4, fb = k + ext[1] / 4;
            if (runA >= 0 && (runB < k - 0.1 / 4 || ext[0] > 0.1)) emit();   // không liền mép → đóng hộp cũ
            if (runA < 0) runA = fa;
            runB = fb; st.signBay++;
          }
          if (runA >= 0) emit();
          // ---- W3-C: BIỂN DỌC (blade) vuông góc mặt tiền, tầng 1-2, mép trái bay — phố chính p/s/t buôn bán ----
          //      2 mặt lớn (chữ xếp dọc, ô BLADE0..) + mặt trước khung tối = 6 tam giác; màu nền theo hạt giống (aFac.w)
          // W4-A: vân tay biết cỡ biển → biển dọc CHỈ khi ảnh thật có biển dọc (bay đầu luôn có, bay khác 40%)
          const fpVert = FPB && FPB.size !== 255 ? (FPB.size === FPV.size.vertical ? 1 : 0) : -1;
          if (fpVert >= 0 ? fpVert === 1 && fl >= 2 && L >= 2.5 : rc === 0 && fl >= 2 && L >= 3 && (tubeLike || rs === RS.TEN)) {
            const pB = fpVert === 1 ? 0.4 : (ev & FEF.BIGSIGN) || (styF & 64) ? 0.14 : 0.045, bw = L / nb, ex = dx / L, ez = dz / L;
            const yb = y0 + GROUND_H + 0.35, ytB = Math.min(y0 + H - 0.35, yb + (fl >= 3 ? 2.5 : 2.0)), TW = 0.06, D0 = 0.1, D1 = 0.1 + (ytB - yb) / 4;
            if (ytB - yb > 1.2) for (let k = 0; k < nb; k++) {
              if (!(fpVert === 1 && k === 0) && hh(seed * 7 + k, 401) >= pB) continue;
              const sc = k * bw + 0.3, si = (hh(seed + k, 403) * BLADE_CELLS * 4) | 0, cellB = MOD.BLADE0 + (si >> 2), u0 = (si & 3) / 4, u1 = u0 + 0.248;
              const c8 = (hh(seed + k, 405) * 255) | 0;
              const bx0 = ax + ex * sc, bz0 = az + ez * sc;
              const P = (along, out) => [bx0 + ex * along + nx * out, bz0 + ez * along + nz * out];
              const [ia, iz] = P(TW, D0), [oa, oz] = P(TW, D1), [jb, jz] = P(-TW, D0), [ob, obz] = P(-TW, D1);
              // mặt +e: phải = về phía tường → BL ngoài, BR trong
              DT.quad([oa, yb, oz, ia, yb, iz, ia, ytB, iz, oa, ytB, oz], ex, 0, ez, [u0, 0, u1, 0, u1, 1, u0, 1], WHITE, s8, K_DET, cellB, c8);
              // mặt −e: phải = ra ngoài → BL trong, BR ngoài
              DT.quad([jb, yb, jz, ob, yb, obz, ob, ytB, obz, jb, ytB, jz], -ex, 0, -ez, [u0, 0, u1, 0, u1, 1, u0, 1], WHITE, s8, K_DET, cellB, c8);
              DT.quad([ob, yb, obz, oa, yb, oz, oa, ytB, oz, ob, ytB, obz], nx, 0, nz, [0, 0, 0.05, 0, 0.05, 1, 0, 1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
              st.detTris += 6; st.blade = (st.blade || 0) + 1;
            }
          }
          // ---- W5-B HÀNG BÀY TRÀN RA HÈ (ô NEAR): bay trệt là cửa hàng MỞ (groundModule khớp bit với shader) → 1 khối hàng
          //      (thùng/bao/rổ/két) sát tường một bên cửa, chừa lối vào giữa; vân tay "cửa hàng mở/chợ/quán ăn" → dày hơn ----
          if (NT && rc <= 2) {
            const bw = L / nb, ex = dx / L, ez = dz / L, pG = (fpG === 1 || fpG === 2 || fpG === 10 || fpG === 11) ? 0.8 : 0.5;
            for (let k = 0; k < nb; k++) {
              if (!OPEN_G.has(groundModule(s8, k, wideF > 0, rc, rs, fpG)) || hh(seed * 3 + k, 711) >= pG) continue;
              const w = Math.min(bw - 1.3, 0.8 + hh(seed + k, 713) * 1.0); if (w < 0.6) continue;
              const left = hh(seed + k, 715) < 0.5, s0 = k * bw + (left ? 0.18 : bw - 0.18 - w);
              const dep = 0.45 + hh(seed + k, 717) * 0.4, ht = 0.5 + hh(seed + k, 719) * 0.6, yb = y0 - 0.05, yt = y0 + SIDEWALK_TOP + ht;
              const uF = hh(seed + k, 721) * (0.5 - w / 4), uT = 0.5 + hh(seed + k, 723) * (0.5 - w / 4);
              st.nearTris = (st.nearTris || 0) + boxN(NT, ax, az, ex, ez, nx, nz, s0, s0 + w, 0.02, 0.02 + dep, yb, yt,
                [uF, 0.004, uF + w / 4, Math.min(0.496, (yt - yb) / 4)], [uT, 0.004, uT + w / 4, Math.min(0.496, dep / 4)], WHITE, s8, MOD.D_MISC);
              st.goods = (st.goods || 0) + 1;
            }
          }
          // ---- W5-B ỐNG THOÁT NƯỚC MÁI (ô NEAR): ống nhựa xám dọc mép mặt tiền nhà ống, chân → đỉnh lan can mái ----
          if (NT && tubeLike && fl >= 2 && L >= 3 && hh(seed, 731 + i) < ((styF >> 4) & 3) * 0.12 + 0.3) {
            const ex = dx / L, ez = dz / L, sP = hh(seed, 733) < 0.5 ? 0.14 : L - 0.24, ytP = y0 + topH - 0.1;
            st.nearTris = (st.nearTris || 0) + boxN(NT, ax, az, ex, ez, nx, nz, sP, sP + 0.1, 0.03, 0.13, y0 - 0.05, ytP, [0.76, 0.504, 0.99, 0.996], null, WHITE, s8, MOD.D_MISC, sP < 1 ? 2 : 1);
            st.pipes = (st.pipes || 0) + 1;
          }
        }
        // ---- CỤC NÓNG ĐIỀU HOÀ 3D (ô gần): treo CAO trên tường mỗi tầng trên (đáy +2,58 m, đỉnh +3,12 m — dưới mép
        //      sàn ban công tầng trên +3,18 m → không cắt ban công/lan can), lồi 0,3 m; ~14% bay nhà ống, 21% KTT ----
        if (classic && cover === 0 && L >= 3 && !pitched) classicKit(M, DT, ax, az, bx, bz, dx, dz, L, nx, nz, nb, y0, H, fl, rt, wcol, s8, st);
        if (DT && cover === 0 && fl >= 2 && L >= 2.4 && !(rs === STYLE.GLASS || rs === STYLE.SHED || rs === RS.CONS || rs === RS.NEO || rs === RS.MODERN || rs === RS.HOTEL)) {
          const pAC = (rs === STYLE.KTT || rs === RS.TEN) ? 0.26 : (rs === STYLE.TUBE || rs === STYLE.OLD || rs === RS.COL || rs === RS.TOWER) ? 0.18 : 0.07;   // W5-B: 0,21/0,14 → 0,26/0,18 (pano: cục nóng dày đặc)   // (v1: ×0,7 — ngân sách)
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
        if (DT && L >= 2.8 && L <= 18 && detOK) {
          if (hasBalc) {
            const inset = 0.2, depth = rs === STYLE.OLD || rs === STYLE.VILLA || rs === RS.COL ? 0.75 : 0.95;
            const sx0 = ax + (dx / L) * inset, sz0 = az + (dz / L) * inset, sx1 = bx - (dx / L) * inset, sz1 = bz - (dz / L) * inset;
            const wl = L - 2 * inset;
            const railCell = fpBalK >= 0 && fpBalK !== FPV.bal.mixed ? (fpBalK === FPV.bal.iron || fpBalK === FPV.bal.cage ? MOD.D_RAIL : MOD.D_BALW)
              : (rs === STYLE.OLD || rs === RS.COL || hh(seed, 23) < 0.45) ? MOD.D_RAIL : MOD.D_BALW;   // W4-A: lan can sắt/bê tông-kính theo ảnh
            const topSkip = hh(seed, 29) < 0.5 ? 1 : 0;   // tầng trên cùng hay là sân thượng lùi → bỏ
            // W5-B: "CHUỒNG CỌP" 3D — lồng sắt nhô 0,6 m ôm cả tầng (vân tay 'cage'; thống kê: tập thể 35%, nhà ống 7%)
            const cage = fpBalK === FPV.bal.cage || (fpBalK < 0 && ((rs === STYLE.KTT || rs === RS.TEN) ? hh(seed, 25) < 0.35 : tubeLike && hh(seed, 25) < 0.07));
            for (let k = 1; k < fl - (fl > 2 ? topSkip : 0); k++) {
              const ys0 = y0 + heightOf(k) - 0.12, yt = ys0 + 0.15;   // sàn tầng k (tầng trên thứ k)
              if (cage) {
                const dC = 0.6, yCt = ys0 + FLOOR_H - 0.1, hC = yCt - ys0, ex = dx / L, ez = dz / L;
                const gx0 = sx0 + nx * dC, gz0 = sz0 + nz * dC, gx1 = sx1 + nx * dC, gz1 = sz1 + nz * dC;
                quadN(DT, [gx0, ys0, gz0, gx1, ys0, gz1, gx1, yCt, gz1, gx0, yCt, gz0], nx, 0, nz, [0, 0, wl / 4, 0, wl / 4, hC / 3.3, 0, hC / 3.3], wcol, s8, MOD.D_CAGE);
                quadN(DT, [sx0, ys0, sz0, gx0, ys0, gz0, gx0, yCt, gz0, sx0, yCt, sz0], -ex, 0, -ez, [0, 0, dC / 4, 0, dC / 4, hC / 3.3, 0, hC / 3.3], wcol, s8, MOD.D_CAGE);
                quadN(DT, [gx1, ys0, gz1, sx1, ys0, sz1, sx1, yCt, sz1, gx1, yCt, gz1], ex, 0, ez, [0, 0, dC / 4, 0, dC / 4, hC / 3.3, 0, hC / 3.3], wcol, s8, MOD.D_CAGE);
                quadN(DT, [sx0, ys0, sz0, sx1, ys0, sz1, gx1, ys0, gz1, gx0, ys0, gz0], 0, -1, 0, [0, 0, wl / 4, 0, wl / 4, dC / 4, 0, dC / 4], GREY, s8, C_PLAIN);
                const tc = TON_LIN[(hh(seed, 27) * TON_LIN.length) | 0], sl = Math.hypot(dC + 0.08, 0.14);
                quadN(DT, [sx0, yCt + 0.14, sz0, sx1, yCt + 0.14, sz1, gx1 + nx * 0.08, yCt, gz1 + nz * 0.08, gx0 + nx * 0.08, yCt, gz0 + nz * 0.08], nx * 0.14 / sl, (dC + 0.08) / sl, nz * 0.14 / sl, [0, 0, wl / 4, 0, wl / 4, dC / 4, 0, dC / 4], tc, s8, MOD.R_TON);
                st.detTris += 10; st.cage = (st.cage || 0) + 1;
                continue;
              }
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
              // ---- W5-B ban công CÓ NGƯỜI Ở (ô NEAR): chậu cây cao quá lan can, giỏ cây treo ngoài lan can, đồ phơi sau lan can ----
              if (NT) {
                const nPl = hh(seed * 5 + k, 741) < 0.42 ? (hh(seed + k, 742) < 0.35 ? 2 : 1) : 0;
                for (let q = 0; q < nPl; q++) {
                  const w = 0.45 + hh(seed + k * 3 + q, 744) * 0.3, a0 = inset + hh(seed + k * 5 + q, 746) * Math.max(0, wl - w), hP = 1.3 + hh(seed + q, 748 + k) * 0.55;
                  const u0 = 0.004 + hh(seed + q, 750 + k) * (0.49 - w * 1.1 / 4);
                  st.nearTris = (st.nearTris || 0) + blobN(NT, ax, az, ex, ez, nx, nz, a0, a0 + w, depth - 0.48, depth - 0.1, ys0, hP, u0, WHITE, s8, MOD.D_MISC);
                  st.plants = (st.plants || 0) + 1;
                }
                if (hh(seed * 7 + k, 752) < 0.22) {   // giỏ/chậu cây treo NGOÀI lan can (rủ xuống)
                  const w = 0.6 + hh(seed + k, 754) * 0.6, a0 = inset + hh(seed + k, 756) * Math.max(0, wl - w), yH = yt + rh, u0 = hh(seed + k, 758) * (0.5 - w / 4);
                  const p0x = ax + ex * a0 + nx * (depth + 0.05), p0z = az + ez * a0 + nz * (depth + 0.05), p1x = p0x + ex * w, p1z = p0z + ez * w;
                  NT.quad([p0x, yH - 0.55, p0z, p1x, yH - 0.55, p1z, p1x, yH + 0.15, p1z, p0x, yH + 0.15, p0z], nx, 0, nz, [u0, 0.7, u0 + w / 4, 0.7, u0 + w / 4, 0.875, u0, 0.875], WHITE, s8, K_DET, MOD.D_MISC, 0);
                  st.nearTris = (st.nearTris || 0) + 2;
                }
                if (hh(seed * 11 + k, 760) < 0.3) {   // đồ phơi treo sau lan can (thấy nửa trên qua lan can)
                  const w = 0.75 + hh(seed + k, 762) * 0.22, a0 = inset + hh(seed + k, 764) * Math.max(0, wl - w), od = depth - 0.3, hL = 1.3;
                  const p0x = ax + ex * a0 + nx * od, p0z = az + ez * a0 + nz * od, p1x = p0x + ex * w, p1z = p0z + ez * w;
                  NT.quad([p0x, ys0 + 0.95, p0z, p1x, ys0 + 0.95, p1z, p1x, ys0 + 0.95 + hL, p1z, p0x, ys0 + 0.95 + hL, p0z], nx, 0, nz, [0.504, 0.996 - hL / 4, 0.504 + w / 4, 0.996 - hL / 4, 0.504 + w / 4, 0.996, 0.504, 0.996], WHITE, s8, K_DET, MOD.D_MISC, 0);
                  st.nearTris = (st.nearTris || 0) + 2; st.laundry = (st.laundry || 0) + 1;
                }
              }
              // W3-C: BIỂN BẢNG LỚN treo MẶT TRƯỚC ban công tầng 1-2 (phố chính buôn bán — Tô Hiệu, Cầu Đất: biển phủ cả lan
              // can + nửa cửa) — cạnh có ban công thì shader không vẽ biển phẳng trên tường (bị ban công che). 1 quad/bay.
              if (k <= 2 && (fpMode === 3 || rc === 0) && tubeLike) {
                // W4-A: biển bảng lớn theo ảnh thật (chế độ 3: tầng 1 gần như mọi bay, tầng 2 nếu phủ 2 tầng); vân tay biết biển khác → không
                const bwP = L / nb, pPan = fpMode === 3 ? (k === 1 ? 0.9 : FPB.span >= 2 ? 0.75 : 0) : fpMode === 1 || fpMode === 2 ? 0
                  : (styF & 64) ? (k === 1 ? 0.45 : 0.15) : (k === 1 ? 0.1 : 0.03);
                for (let q = 0; q < nb; q++) {
                  if (hh(seed * 13 + q, 600 + k) >= pPan) continue;
                  const a0 = Math.max(inset, q * bwP + 0.06), a1 = Math.min(L - inset, (q + 1) * bwP - 0.06); if (a1 - a0 < 1.5) continue;
                  const od = depth + 0.05, p0x = ax + ex * a0 + nx * od, p0z = az + ez * a0 + nz * od, p1x = ax + ex * a1 + nx * od, p1z = az + ez * a1 + nz * od;
                  const ybP = ys0 + 0.3, ytP = ybP + Math.min(2.7, (a1 - a0) * 0.55);
                  const pi = (hh(seed + q * 7, 611 + k) * PANEL_CELLS * 2) | 0, v0 = (pi & 1) * 0.5 + 0.004, v1 = v0 + 0.492, c8 = (hh(seed + q, 613 + k) * 255) | 0;
                  DT.quad([p0x, ybP, p0z, p1x, ybP, p1z, p1x, ytP, p1z, p0x, ytP, p0z], nx, 0, nz, [0.004, v0, 0.996, v0, 0.996, v1, 0.004, v1], WHITE, s8, K_DET, MOD.PANEL0 + (pi >> 1), c8);
                  st.detTris += 2; st.panel3d = (st.panel3d || 0) + 1;
                }
              }
            }
          }
          // ---- MÁI HIÊN (W3-C): TÔN sóng xanh dương chủ đạo (ô D_AWN2) hoặc BẠT (ô D_AWN sọc), sâu 1,4-2,2 m; bằng chứng pano
          //      "mái hiên/bạt/tôn" ép có + chọn vật liệu. Tôn: dốc thoải, không diềm; bạt: diềm rủ 0,3 m.
          // W4-A: mái hiên theo ảnh thật (không có → không; có → luôn, vật liệu + màu theo quan sát)
          const fpAw = FPB && FPB.awn !== 255 ? AWN_FP[FPB.awn] : undefined;
          const pAwn = fpAw !== undefined ? (fpAw ? 1 : 0) : (ev & FEF.AWN) ? 0.75 : (rs === STYLE.TUBE || rs === STYLE.OLD || rs === STYLE.KTT) ? 0.35 : rs === RS.TEN ? 0.3 : rs === RS.COL ? 0.25 : rs === RS.MODERN ? 0.12 : 0;
          if (hh(seed, 41 + i) < pAwn) {
            const tin = fpAw ? fpAw[0] : (ev & FEF.TIN) ? true : (ev & FEF.TARP) ? false : hh(seed, 45) < 0.55;
            const ac = fpAw ? (FPB.awn === FPV.awn.tarp_other ? AWN_OTHER[(hh(seed, 44) * AWN_OTHER.length) | 0] : fpAw[1]) : tin ? AWN_TIN[(hh(seed, 43) * AWN_TIN.length) | 0] : AWN_TARP[(hh(seed, 43) * AWN_TARP.length) | 0];
            const out = tin ? 1.5 + hh(seed, 47) * 0.7 : 1.4 + hh(seed, 47) * 0.5, yT = y0 + (tin ? 2.95 : 2.88), yF = tin ? yT - 0.22 * out : y0 + 2.4, inset = 0.15;
            // W5-B: bạt SỌC chỉ khi vân tay 'tarp_stripe' (thống kê 50%); bạt xanh/đỏ/khác = bạt TRƠN võng (D_AWN3)
            const stripe = !tin && (fpAw ? FPB.awn === FPV.awn.tarp_stripe : hh(seed, 49) < 0.5);
            const cellA = tin ? MOD.D_AWN2 : stripe ? MOD.D_AWN : MOD.D_AWN3;
            const sx0 = ax + (dx / L) * inset, sz0 = az + (dz / L) * inset, sx1 = bx - (dx / L) * inset, sz1 = bz - (dz / L) * inset;
            const fx0 = sx0 + nx * out, fz0 = sz0 + nz * out, fx1 = sx1 + nx * out, fz1 = sz1 + nz * out;
            const sl = Math.hypot(out, yT - yF), ny = out / sl, nh = (yT - yF) / sl, wl = L - 2 * inset;
            DT.quad([sx1, yT, sz1, sx0, yT, sz0, fx0, yF, fz0, fx1, yF, fz1], nx * nh, ny, nz * nh, [0, 1, wl / 4, 1, wl / 4, 0, 0, 0], ac, s8, K_DET, cellA, 0);
            DT.quad([sx0, yT - 0.02, sz0, sx1, yT - 0.02, sz1, fx1, yF - 0.02, fz1, fx0, yF - 0.02, fz0], -nx * nh, -ny, -nz * nh, [0, 1, wl / 4, 1, wl / 4, 0, 0, 0], ac, s8, K_DET, cellA, 0);
            if (!tin) {
              DT.quad([fx0, yF - 0.3, fz0, fx1, yF - 0.3, fz1, fx1, yF, fz1, fx0, yF, fz0], nx, 0, nz, [0, 0, wl / 4, 0, wl / 4, 0.19, 0, 0.19], ac, s8, K_DET, cellA, 0);
              // W5-B: MÁ BẠT 2 đầu (bạt kéo thật có má tam giác/thang) — đọc ra khối 3D khi nhìn dọc phố
              const ex = dx / L, ez = dz / L, uo = out / 4;
              quadN(DT, [sx0, yT - 0.3, sz0, fx0, yF - 0.3, fz0, fx0, yF, fz0, sx0, yT, sz0], -ex, 0, -ez, [0, 0, uo, 0, uo, 0.19, 0, 0.19], ac, s8, cellA);
              quadN(DT, [sx1, yT - 0.3, sz1, fx1, yF - 0.3, fz1, fx1, yF, fz1, sx1, yT, sz1], ex, 0, ez, [0, 0, uo, 0, uo, 0.19, 0, 0.19], ac, s8, cellA);
              st.detTris += 6;
            }
            st.detTris += 4; st.awn++;
          }
        }
      }
    }
    // ---- W4-C: MÁI SẢNH KÍNH khách sạn (porte-cochère, pano_359): tấm đua 5,5 m trên sảnh, giữa mặt phố dài nhất ----
    if (rs === RS.HOTEL && DT && hasFront && fL >= 10 && fl >= 4) hotelCanopy(DT, fAx, fAz, fBx, fBz, fL, fnx, fnz, y0, s8, st);
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
    if (rt === ROOF.FLAT_PARAPET && areaPoly < 900 && sty !== STYLE.GLASS && sty !== STYLE.SHED && rs !== RS.CONS) {
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
    // ---- W3-C: BIỂN QUẢNG CÁO TRÊN MÁI (ô chính — thấy từ xa): nhà 3-9 tầng mái bằng, mặt phố chính dài ≥ 6 m; khung tấm
    //      quay ra phố, lùi 1,2 m sau tường, chân 2 cột thép; nội dung = ô BILL (từ chung, không thương hiệu). ~12 tam giác ----
    // W4-A: vân tay biết cỡ biển → biển trên mái CHỈ khi ảnh thật có (khi đó luôn dựng, nới điều kiện cấp phố/bề rộng)
    const fpRoofS = FPB && FPB.size !== 255 ? (FPB.size === FPV.size.roof ? 1 : 0) : -1;
    if (rs !== RS.HOTEL && fpRoofS >= 0 ? fpRoofS === 1 && hasFront && fL >= 4 && fl >= 2 && fl <= 12 && (rt === ROOF.FLAT_PARAPET || rt === ROOF.FLAT)
      : hasFront && fRc === 0 && fL >= 6 && fl >= 3 && fl <= 9 && (rt === ROOF.FLAT_PARAPET || rt === ROOF.FLAT)
      && rs !== RS.CONS && rs !== RS.NEO && rs !== RS.COL && rs !== RS.HOTEL
      && hh(seed, 501) < (((ev & FEF.BIGSIGN) || (styF & 64) ? 0.1 : 0.022) + (D.info && (D.info[b] & INFO.CORNER) ? 0.12 : 0))) {   // nhà GÓC phố (ngã tư pano_327): +12%
      const ex = (fBx - fAx) / fL, ez = (fBz - fAz) / fL, Wb = Math.min(fL * 0.8, 10), Hb = Math.min(3.6, Wb * 0.4);
      const mx = (fAx + fBx) / 2 - fnx * 1.2, mz = (fAz + fBz) / 2 - fnz * 1.2;
      const yRf = y0 + (rt === ROOF.FLAT ? H + 0.25 : H), yb = y0 + H + PARAPET_H + 0.8, yt = yb + Hb;
      const lx = mx - ex * Wb / 2, lz = mz - ez * Wb / 2, rx2 = mx + ex * Wb / 2, rz2 = mz + ez * Wb / 2;
      const si = (hh(seed, 503) * BILL_CELLS * 2) | 0, cellBl = MOD.BILL0 + (si >> 1), v0 = (si & 1) * 0.5 + 0.004, v1 = v0 + 0.492;
      M.quad([lx, yb, lz, rx2, yb, rz2, rx2, yt, rz2, lx, yt, lz], fnx, 0, fnz, [0.004, v0, 0.996, v0, 0.996, v1, 0.004, v1], WHITE, s8, K_DET, cellBl, (hh(seed, 505) * 255) | 0);   // màu nền biển theo hạt giống (như blade/panel)
      const bo = 0.12, blx = lx - fnx * bo, blz = lz - fnz * bo, brx = rx2 - fnx * bo, brz = rz2 - fnz * bo;
      M.quad([brx, yb, brz, blx, yb, blz, blx, yt, blz, brx, yt, brz], -fnx, 0, -fnz, [0, 0, 0.05, 0, 0.05, 1, 0, 1], WHITE, s8, K_DET, MOD.D_SIGNF, 0);
      for (const t of [0.22, 0.78]) steelPost(M, lx + (rx2 - lx) * t - fnx * 0.06, lz + (rz2 - lz) * t - fnz * 0.06, yRf, yb, 0.09, fnx, fnz, s8);
      st.tris += 12; st.bill = (st.bill || 0) + 1;
    }
    st.built++;
  }
  return { tiles, dtiles, ntiles };
  };
  const { tiles, dtiles, ntiles } = gen(st, frontEdges);
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
  const nearMeshes = [];   // W5-B
  let triNear = 0;
  for (const [key, t] of ntiles) {
    const gn = t.buf.geometry();
    if (gn) {
      const m = new THREE.Mesh(gn, mat); m.name = `fab_near_${t.tx}_${t.tz}`; m.userData.fabKey = key;
      m.castShadow = false; m.receiveShadow = true; m.userData.noMerge = true; m.matrixAutoUpdate = false;
      m.userData.fabTile = [(t.tx + 0.5) * NEAR_TILE, (t.tz + 0.5) * NEAR_TILE];
      m.visible = false;
      scene.add(m); nearMeshes.push(m); triNear += gn.index.count / 3;
    }
  }
  // GIẢI PHÓNG BẢN CPU của mọi buffer phố SAU KHI upload GPU (onUpload → array = null): ~30 B/đỉnh + chỉ số. Mất/khôi phục
  // ngữ cảnh WebGL (three dựng lại mọi buffer từ .array) → 'webglcontextrestored' trên canvas #scene: chạy lại gen() (xác
  // định, ~0,5-1 s) và thay geometry từng ô TRƯỚC khung hình kế. Ô det chưa từng hiện thì chưa upload → còn giữ mảng.
  // BẪY: sau khi giải phóng, KHÔNG được computeBounding*/đọc .array các mesh 'fab_*' (bbox/sphere tính sẵn; raycast = no-op).
  if (RELEASE_CPU) {
    const freeArr = function () { this.array = null; };
    const release = (g) => { for (const k in g.attributes) g.attributes[k].onUpload(freeArr); if (g.index) g.index.onUpload(freeArr); };
    const noRay = () => {};   // raycast (vd __hp.pick) đọc .array → bỏ qua mesh phố thay vì ném lỗi
    for (const m of meshes) { release(m.geometry); m.raycast = noRay; }
    for (const m of detMeshes) { release(m.geometry); m.raycast = noRay; }
    for (const m of nearMeshes) { release(m.geometry); m.raycast = noRay; }
    const cv = typeof document !== 'undefined' && document.getElementById ? document.getElementById('scene') : null;
    if (cv) cv.addEventListener('webglcontextrestored', () => {
      const t1 = performance.now();
      const r = gen({ tris: 0, detTris: 0, tWall: 0, tRoof: 0, tPar: 0, built: 0, walls: 0, roofs: 0 }, []);
      for (const [list, map] of [[meshes, r.tiles], [detMeshes, r.dtiles], [nearMeshes, r.ntiles]]) for (const m of list) {
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
    const RN2 = NEAR_R * NEAR_R;
    for (const m of nearMeshes) {
      const [tx, tz] = m.userData.fabTile, h = NEAR_TILE / 2;
      const dx = Math.max(0, Math.abs(cx - tx) - h), dz = Math.max(0, Math.abs(cz - tz) - h);
      m.visible = dx * dx + dz * dz + cy * cy < RN2;
    }
  };
  const tAll = performance.now() - T0;
  Object.assign(st, { tiles: meshes.length, detTiles: detMeshes.length, nearTiles: nearMeshes.length, triMain, triDet, triNear, calls, ms: Math.round(tAll), msDecode: Math.round(tDecode), msClaims: Math.round(tClaims), msAtlas: Math.round(tAtlas), msGeo: Math.round(tGeo), atlas: fabricAtlasInfo() });
  if (ctx.log !== false) console.log('[citygen]', JSON.stringify(st));
  return { stats: st, meshes, detMeshes, nearMeshes, collide: fabricCollide, at: fabricAt, hit: fabricHit, frontEdges, material: mat, grid };
}
