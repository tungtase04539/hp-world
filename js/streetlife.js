// streetlife.js — ĐỜI SỐNG PHỐ (Đợt 3 wave 3 W3-E, AUDIT3 FP-5): CHỢ DÂN SINH, hàng hoá tràn hè theo loại cửa hàng, cờ
// treo nhà, băng rôn căng ngang phố, cổng chào. Gọi TỪ js/props.js (buildProps) — dùng chung lưới ô vỉa hè 3 m (`sides`),
// bằng chứng pano (props_evidence.js cột 7-9), vật liệu/bộ dựng hình của props (truyền qua `G`) → không tạo program mới.
//
// Ảnh pano thật tháng 10/2024 (446/450/460/124/184/180/492…): phố chợ = RỪNG Ô DÙ lớn 2,5-3 m nhiều màu (đỏ-trắng-xanh
// từng múi), bạt xanh/cam căng từ mặt tiền ra mép đường, mẹt/rổ rau quả, sọt nhựa, thùng xốp, bàn sạp phủ bạt, giá treo
// quần áo, người bán NGỒI GHẾ ĐẨU THẤP; hàng tràn cả ~1-1,5 m mép lòng đường. Game dot3: phố sạch trơn, chỉ có xe máy.
//
// NGUỒN KÍCH HOẠT (tất định, theo toạ độ):
//   • pano ≤ 45 m có market 1-3 (gen_props_evidence: chợ dân sinh/sạp/ô dù chợ/hàng rong…) — xa > 30 m bớt 1 mức
//   • đa giác chợ OSM (PROPS_MARKETS): trong/≤ 12 m → 3, ≤ 40 m → 2, ≤ 80 m → 1; pano ≤ 30 m KHÔNG nhắc chợ/ô/bạt/hàng
//     → trần 1 (bằng chứng âm thắng); claim ô dựng tay tên `cho_*` (Chợ Tam Bạc, Chợ Con…) → 3
//   • phố p (đại lộ) trần 1.
// KHOẢNG TRỐNG: tâm vật ≥ 2,5 m + bán kính vật tới camera pano (spec FP-5); không trong nhà thật/lòng đường KHÁC (miệng
// giao lộ); hàng lấn lòng đường CHÍNH chỉ ở mức 3, dải 1,1 m sát bó vỉa, cách nút giao ≥ 4 m — xuất `stallsRoad` để giao
// thông (traffic.js) lách như xe đỗ.
import * as THREE from 'three';

// ---------------------------------------------------------------------------------------------------------------------
// MÔ HÌNH (local: +Z = hướng ra LÒNG ĐƯỜNG, X = dọc phố, y = 0 mặt vỉa). G = bộ dựng hình của props.js.
// aPaint: 0 cố định · (0,1] pha màu instance · 2 bảng A (hàng hoá) · 3 bảng B (múi ô/bạt thứ 2)
// ---------------------------------------------------------------------------------------------------------------------
function tri(list) {   // [[ax,ay,az],[bx..],[cx..]]… → BufferGeometry phẳng (pháp tuyến mặt)
  const p = new Float32Array(list.length * 9);
  list.forEach((t, i) => { for (let k = 0; k < 3; k++) { p[i * 9 + k * 3] = t[k][0]; p[i * 9 + k * 3 + 1] = t[k][1]; p[i * 9 + k * 3 + 2] = t[k][2]; } });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.computeVertexNormals();
  return g;
}
const dome = (r, h, x, y, z, seg = 6) => new THREE.SphereGeometry(r, seg, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, h / r, 1).translate(x, y, z);

// Ô DÙ CHỢ tròn 8 múi (múi chẵn = màu instance, lẻ = bảng B) + mặt dưới tối + diềm 14 cm — ~60 tam giác
function modelUmbrella(G, R = 1.45, yRim = 1.95, yTop = 2.32, nSeg = 8) {
  const P = [];
  const rim = (i, y) => { const a = (i / nSeg) * Math.PI * 2 + Math.PI / nSeg; return [Math.cos(a) * R, y, Math.sin(a) * R]; };
  const top = [[], []], und = [], val = [[], []];
  for (let i = 0; i < nSeg; i++) {
    const A = [0, yTop, 0], p0 = rim(i, yRim), p1 = rim(i + 1, yRim);
    top[i & 1].push([A, p1, p0]);
    und.push([[0, yTop - 0.04, 0], [p0[0], yRim - 0.02, p0[2]], [p1[0], yRim - 0.02, p1[2]]]);
    const b0 = rim(i, yRim - 0.14), b1 = rim(i + 1, yRim - 0.14);
    val[i & 1].push([p0, b1, b0], [p0, p1, b1], [p0, b0, b1], [p0, b1, p1]);
  }
  P.push(G.finish(tri(top[0]), 0xffffff, 1), G.finish(tri(top[1]), 0xffffff, 3));
  P.push(G.finish(tri(val[0]), 0xf0f0f0, 1), G.finish(tri(val[1]), 0xf0f0f0, 3));
  P.push(G.finish(tri(und), 0xb0b0b0, 0.6));
  P.push(G.finish(G.cyl(0.02, 0.026, yTop, 5, 0, yTop / 2, 0), 0x7d8084));
  return G.mergeParts(P);
}
// Ô DÙ VUÔNG 4 múi (quán cà phê/sạp) — ~30 tam giác
function modelUmbrellaSq(G) {
  const h = 1.15, y = 2.15, yT = 2.5, P = [];
  const c = [[-h, y, -h], [h, y, -h], [h, y, h], [-h, y, h]], A = [0, yT, 0];
  const t0 = [], t1 = [], u = [];
  for (let i = 0; i < 4; i++) { const p0 = c[i], p1 = c[(i + 1) % 4]; (i & 1 ? t1 : t0).push([A, p1, p0]); u.push([[0, yT - 0.04, 0], p0, p1]); }
  P.push(G.finish(tri(t0), 0xffffff, 1), G.finish(tri(t1), 0xffffff, 3), G.finish(tri(u), 0xa8a8a8, 0.6));
  P.push(G.finish(G.cyl(0.025, 0.03, yT, 5, 0, yT / 2, 0), 0xd0d0c8));
  return G.mergeParts(P);
}
// BẠT CĂNG từ mặt tiền (z = 0, cao 2,6 m) ra mép đường (z = 1 — instance scale z = độ vươn thật 2,2-3,4 m), võng nhẹ,
// diềm trước, 2 cọc trước; rộng 3 m (scale x) — ~30 tam giác
function modelTarp(G) {
  const P = [], W = 1.5, yB = 2.62, yF = 2.05, ym = (yB + yF) / 2 - 0.07;
  const q = (a, b, c, d) => [[a, b, c], [a, c, d]];
  const r0 = [-W, yB, 0], r1 = [W, yB, 0], m0 = [-W, ym, 0.5], m1 = [W, ym, 0.5], f0 = [-W, yF, 1], f1 = [W, yF, 1];
  // mặt trên: pháp tuyến hướng lên (thứ tự ngược chiều kim đồng hồ nhìn từ trên)
  P.push(G.finish(tri([...q(r0, m0, m1, r1), ...q(m0, f0, f1, m1)]), 0xffffff, 1));
  P.push(G.finish(tri([...q(r0, r1, m1, m0), ...q(m0, m1, f1, f0)].map((t) => t.map((p) => [p[0], p[1] - 0.015, p[2]]))), 0x9a9a9a, 0.75));
  const d0 = [-W, yF - 0.2, 1], d1 = [W, yF - 0.2, 1];
  P.push(G.finish(tri([...q(f0, d0, d1, f1), ...q(f0, f1, d1, d0)]), 0xe8e8e8, 1));
  for (const s of [-1, 1]) P.push(G.finish(G.box(0.03, yF, 0.012, s * (W - 0.05), yF / 2, 0.985), 0x8c8f92));
  return G.mergeParts(P);
}
// BÀN SẠP phủ bạt + 6 đống hàng — ~110 tam giác
function modelStall(G) {
  const P = [];
  P.push(G.finish(G.box(1.25, 0.05, 0.78, 0, 0.72, 0), 0x8a6d4a));
  for (const [x, z] of [[0.58, 0.34], [-0.58, 0.34], [0.58, -0.34], [-0.58, -0.34]]) P.push(G.finish(G.box(0.04, 0.7, 0.04, x, 0.35, z), 0x5a5550));
  P.push(G.finish(G.box(1.27, 0.42, 0.02, 0, 0.53, 0.4), 0xffffff, 1));     // vạt bạt phủ trước bàn (màu instance)
  const cols = [0x55783a, 0x9a4a32, 0xb8823a, 0x6f7f3a, 0xc8b070];
  for (let i = 0; i < 6; i++) {
    const x = -0.45 + (i % 3) * 0.45, z = i < 3 ? -0.17 : 0.18;
    P.push(G.finish(dome(0.2, 0.13, x, 0.745, z), i === 4 ? 0xffffff : cols[i % 5], i === 4 ? 2 : 0));
  }
  return G.mergeParts(P);
}
// MẸT/RỔ: 3 mẹt tre trên mặt đất + đống rau quả + 1 rổ cao — ~80 tam giác
function modelBaskets(G) {
  const P = [], wick = 0x9b7b4b, cols = [0x58783c, 0xffffff, 0xa8683a];
  [[-0.62, 0.05], [0.05, -0.08], [0.68, 0.1]].forEach(([x, z], i) => {
    P.push(G.finish(G.cyl(0.34, 0.31, 0.09, 9, x, 0.045, z), wick));
    P.push(G.finish(dome(0.27, 0.12, x, 0.09, z), cols[i], i === 1 ? 2 : 0));
  });
  P.push(G.finish(G.cyl(0.21, 0.17, 0.34, 8, 0.1, 0.17, 0.45), 0x8a6a3e));
  P.push(G.finish(dome(0.19, 0.1, 0.1, 0.34, 0.45), 0xffffff, 2));
  return G.mergeParts(P);
}
// SỌT NHỰA chồng + thùng xốp — ~60 tam giác
function modelCrates(G) {
  const P = [];
  P.push(G.finish(G.box(0.56, 0.3, 0.4, -0.32, 0.15, 0), 0xa8362e));
  P.push(G.finish(G.box(0.56, 0.3, 0.4, -0.32, 0.46, 0.02), 0x30598e));
  P.push(G.finish(dome(0.22, 0.09, -0.32, 0.61, 0.02), 0xffffff, 2));
  P.push(G.finish(G.box(0.56, 0.3, 0.4, 0.3, 0.15, 0.05), 0xb89a3a));
  P.push(G.finish(dome(0.22, 0.09, 0.3, 0.3, 0.05), 0xffffff, 2));
  P.push(G.finish(G.box(0.62, 0.34, 0.42, 0.32, 0.17, -0.5), 0xefefea));                     // thùng xốp
  P.push(G.finish(G.box(0.64, 0.04, 0.44, 0.32, 0.36, -0.5), 0xe4e4de));
  return G.mergeParts(P);
}
// BẠT TRẢI ĐẤT + 3 đống hàng (người bán ngồi bệt) — ~50 tam giác
function modelHeap(G) {
  const P = [];
  P.push(G.finish(G.box(1.7, 0.02, 1.2, 0, 0.01, 0), 0xffffff, 1));
  P.push(G.finish(dome(0.36, 0.2, -0.45, 0.02, -0.15, 7), 0xffffff, 2));
  P.push(G.finish(dome(0.3, 0.16, 0.25, 0.02, 0.2, 7), 0x5c7a3c));
  P.push(G.finish(dome(0.26, 0.15, 0.5, 0.02, -0.3, 7), 0x9a6a3a));
  return G.mergeParts(P);
}
// BAO TẢI/GẠO chồng — ~50 tam giác
function modelSacks(G) {
  const P = [], cs = [0xd8cfb4, 0xeeeae0, 0xd0c4a2, 0xe8e2d0];
  [[-0.3, 0, 0], [0.3, 0.02, 0], [0, 0.3, 0.02], [0.05, 0.6, 0.0]].forEach(([x, y, z], i) => {
    P.push(G.finish(G.box(0.48, 0.3, 0.34, x, y + 0.15, z, 0, (i - 1.5) * 0.12, 0), cs[i]));
    P.push(G.finish(dome(0.2, 0.06, x, y + 0.3, z), cs[i]));
  });
  return G.mergeParts(P);
}
// GHẾ ĐẨU NHỰA thấp (người bán ngồi) — 14 tam giác
function modelStool(G) {
  return G.mergeParts([G.finish(G.taper(0.32, 0.32, 0.22, 0.22, 0.26, 0, 0, 0), 0xffffff, 0.9), G.finish(G.box(0.27, 0.025, 0.27, 0, 0.27, 0), 0xffffff, 1)]);
}
// GIÁ TREO QUẦN ÁO 1,6 m + 7 áo — ~110 tam giác
function modelRack(G) {
  const P = [];
  for (const s of [-1, 1]) { P.push(G.finish(G.box(0.03, 1.78, 0.03, s * 0.8, 0.89, 0), 0x9a9da2)); P.push(G.finish(G.box(0.04, 0.03, 0.5, s * 0.8, 0.02, 0), 0x6a6d72)); }
  P.push(G.finish(G.box(1.64, 0.03, 0.03, 0, 1.76, 0), 0x9a9da2));
  const cs = [0x1e2a4a, 0xe8e6e0, 0xb8323a, 0x222326, 0xd88aa0, 0xc8b89a, 0x5a6a7a];
  for (let i = 0; i < 7; i++) P.push(G.finish(G.box(0.4, 0.82 - (i % 3) * 0.1, 0.035, -0.66 + i * 0.22, 1.32 - (i % 3) * 0.05, 0.02 * (i % 2), 0, 0.5 + (i % 2) * 0.3, 0), cs[i], i === 3 ? 2 : 0));
  return G.mergeParts(P);
}
// XÔ HOA TƯƠI (4 xô + bó hoa) — ~80 tam giác
function modelFlowers(G) {
  const P = [], fc = [0xd02a3a, 0xf0c020, 0xf4f0ea, 0xe86a9a];
  for (let i = 0; i < 4; i++) {
    const x = -0.5 + i * 0.33, z = (i % 2) * 0.12;
    P.push(G.finish(G.cyl(0.15, 0.12, 0.34, 7, x, 0.17, z), 0x2d4a3a));
    P.push(G.finish(new THREE.IcosahedronGeometry(0.18, 0).scale(1, 0.8, 1).translate(x, 0.5, z), fc[i], i === 2 ? 2 : 0));
    P.push(G.finish(new THREE.IcosahedronGeometry(0.12, 0).translate(x + 0.06, 0.4, z - 0.05), 0x3f7a32));
  }
  return G.mergeParts(P);
}
// CHẬU CÂY CẢNH (chậu đất nung/sứ + bụi) — ~50 tam giác
function modelPot(G) {
  const P = [];
  P.push(G.finish(G.taper(0.42, 0.42, 0.5, 0.5, 0.4, 0, 0, 0), 0xffffff, 3));
  P.push(G.finish(new THREE.IcosahedronGeometry(0.42, 0).scale(1, 1.15, 1).translate(0, 0.78, 0), 0x3f7a32));
  P.push(G.finish(new THREE.IcosahedronGeometry(0.26, 0).translate(0.15, 1.12, -0.05), 0x4c8a3a));
  return G.mergeParts(P);
}
// NỘI THẤT GỖ bày hè: tủ + bàn + 2 ghế — ~72 tam giác
function modelFurniture(G) {
  const P = [];
  P.push(G.finish(G.box(1.0, 1.8, 0.46, -0.7, 0.9, -0.15), 0x6b4128));
  P.push(G.finish(G.box(0.9, 0.04, 0.02, -0.7, 0.95, 0.09), 0x3d2516));
  P.push(G.finish(G.box(1.15, 0.05, 0.7, 0.55, 0.76, 0.1), 0x7a4a2a));
  for (const [x, z] of [[0.05, -0.18], [1.05, -0.18], [0.05, 0.38], [1.05, 0.38]]) P.push(G.finish(G.box(0.05, 0.74, 0.05, x, 0.37, z), 0x5a3520));
  P.push(G.finish(G.box(0.44, 0.04, 0.44, 0.55, 0.45, 0.72), 0x7a4a2a));
  P.push(G.finish(G.box(0.44, 0.5, 0.04, 0.55, 0.72, 0.92), 0x7a4a2a));
  return G.mergeParts(P);
}
// BÀN THỜ sơn son thếp vàng + két sắt — ~40 tam giác
function modelAltar(G) {
  const P = [];
  P.push(G.finish(G.box(1.15, 0.95, 0.55, -0.35, 0.475, 0), 0x8a1a12));
  P.push(G.finish(G.box(1.2, 0.06, 0.6, -0.35, 0.98, 0), 0xc9a23a));
  P.push(G.finish(G.box(0.5, 0.3, 0.3, -0.35, 1.16, -0.08), 0x9a2016));
  P.push(G.finish(G.box(0.55, 0.75, 0.55, 0.65, 0.375, 0.05), 0x3a3d40));               // két sắt
  P.push(G.finish(G.box(0.08, 0.08, 0.02, 0.65, 0.45, 0.33), 0xb8b8b0));
  return G.mergeParts(P);
}
// ĐỒ CHƠI: kệ hộp màu + đống thú bông — ~60 tam giác
function modelToys(G) {
  const P = [], cs = [0xe8382a, 0x2a7ad8, 0xf0c81e, 0x3aa84a, 0xe86ab8, 0xf08a1e];
  P.push(G.finish(G.box(1.3, 0.05, 0.5, 0, 0.6, 0), 0x9a9da2));
  for (let i = 0; i < 6; i++) P.push(G.finish(G.box(0.36, 0.3 + (i % 3) * 0.08, 0.3, -0.45 + (i % 3) * 0.45, i < 3 ? 0.78 + (i % 3) * 0.04 : 0.17, i < 3 ? 0 : 0.05), cs[i]));
  P.push(G.finish(dome(0.38, 0.32, 0.3, 0.62, 0.05, 7), 0xf4a8c8));
  return G.mergeParts(P);
}
// HÀNG HOÁ chồng (thùng carton + kiện bọc nilon) — ~40 tam giác
function modelGoods(G) {
  const P = [];
  P.push(G.finish(G.box(0.6, 0.45, 0.45, -0.3, 0.225, 0), 0xb08a5a));
  P.push(G.finish(G.box(0.5, 0.4, 0.4, -0.28, 0.65, 0.02, 0, 0.2, 0), 0xa47e50));
  P.push(G.finish(G.box(0.55, 0.5, 0.5, 0.35, 0.25, 0.05), 0x9ab8c8));
  P.push(G.finish(G.box(0.4, 0.3, 0.35, 0.32, 0.65, 0.05), 0xffffff, 2));
  return G.mergeParts(P);
}
// Ô TÔ PHỦ BẠT (bạt bạc/xanh ôm thân, local +Z = mũi) — ~70 tam giác
export function modelCoveredCar(G) {
  const P = [];
  P.push(G.finish(G.box(1.8, 0.75, 4.5, 0, 0.55, 0), 0xffffff, 1));
  const cab = G.box(1.6, 0.55, 2.3, 0, 1.2, -0.25); const p = cab.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 1.3) { p.setX(i, p.getX(i) * 0.82); p.setZ(i, p.getZ(i) * 0.8 - 0.1); }
  cab.computeVertexNormals();
  P.push(G.finish(cab, 0xffffff, 1));
  P.push(G.finish(G.box(1.84, 0.2, 4.56, 0, 0.22, 0), 0xffffff, 0.8));
  for (const [x, z] of [[0.8, 1.4], [-0.8, 1.4], [0.8, -1.4], [-0.8, -1.4]]) P.push(G.finish(G.cyl(0.3, 0.3, 0.2, 8, x, 0.3, z, 'x'), 0x19191b));
  return G.mergeParts(P);
}
// XE KHÁCH 29-45 chỗ (local +Z = mũi): thân, dải kính, kính lái, 6 bánh, sọc sơn (màu instance) — ~120 tam giác
export function modelCoach(G) {
  const P = [], L = 11.4;
  P.push(G.finish(G.box(2.48, 2.55, L, 0, 1.75, 0), 0xf2f2ef));
  P.push(G.finish(G.box(2.5, 0.9, L - 1.4, 0, 2.25, -0.3), 0x26313b));                       // dải kính hông
  P.push(G.finish(G.box(2.3, 1.15, 0.06, 0, 2.15, L / 2 + 0.01, -0.12, 0, 0), 0x2a3640));     // kính lái
  P.push(G.finish(G.box(2.52, 0.32, L - 0.6, 0, 1.35, 0), 0xffffff, 1));                       // sọc sơn hãng (màu instance)
  P.push(G.finish(G.box(2.46, 0.5, L - 0.2, 0, 0.62, 0), 0x6a6f74));                            // gầm/khoang hành lý
  for (const z of [3.6, -2.6, -3.9]) for (const s of [-1, 1]) P.push(G.finish(G.cyl(0.5, 0.5, 0.3, 10, s * 1.08, 0.5, z, 'x'), 0x19191b));
  P.push(G.finish(G.box(2.2, 0.25, 0.05, 0, 0.75, L / 2 + 0.02), 0xd8d8d0));                    // cản trước
  return G.mergeParts(P);
}
// TRẠM BIẾN ÁP KIỐT (hộp tôn sơn xám/kem có lá sách, đế bê tông) — ~40 tam giác; dùng trong nhóm cột-đèn của props
export function modelKiosk(G) {
  const P = [];
  P.push(G.finish(G.box(2.0, 0.2, 1.3, 0, 0.1, 0), 0x9a968c));
  P.push(G.finish(G.box(1.85, 1.9, 1.15, 0, 1.15, 0), 0xc9c6bb, 0.35));
  P.push(G.finish(G.box(1.95, 0.08, 1.25, 0, 2.14, 0), 0x8a8e90));
  for (const x of [-0.45, 0.45]) P.push(G.finish(G.box(0.7, 0.5, 0.02, x, 1.55, 0.585), 0x7d8286));   // lá sách
  P.push(G.finish(G.box(0.18, 0.18, 0.02, 0.6, 0.85, 0.585), 0xe0c020));                             // biển cảnh báo
  return G.mergeParts(P);
}
// ĐÈN GANG 2 cầu (ven hồ) / 5 cầu (quảng trường Nhà hát) — thân + cầu sáng (cầu sáng = nhóm kính đèn của props)
export function modelOrnate2(G) {
  const P = [], H = 3.6;
  P.push(G.finish(G.cyl(0.3, 0.38, 0.6, 8, 0, 0.3, 0), 0x2b3a30));
  P.push(G.finish(G.cyl(0.09, 0.13, H, 8, 0, 0.6 + H / 2, 0), 0x2b3a30));
  P.push(G.finish(G.cyl(0.04, 0.04, 1.1, 5, 0, 0.6 + H - 0.05, 0, 'z'), 0x2b3a30));
  for (const s of [-1, 1]) P.push(G.finish(G.cyl(0.03, 0.03, 0.3, 5, 0, 0.6 + H + 0.12, s * 0.55), 0x2b3a30));
  return G.mergeParts(P);
}
export function modelOrnate2Globes(G) {
  const y = 0.6 + 3.6 + 0.42, P = [];
  for (const s of [-1, 1]) P.push(G.finish(new THREE.IcosahedronGeometry(0.21, 0).translate(0, y, s * 0.55), 0xffffff));
  return G.mergeParts(P);
}
export function modelOrnate5(G) {
  const P = [], H = 4.3;
  P.push(G.finish(G.cyl(0.4, 0.5, 0.8, 8, 0, 0.4, 0), 0x22302a));
  P.push(G.finish(G.cyl(0.11, 0.17, H, 8, 0, 0.8 + H / 2, 0), 0x22302a));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; P.push(G.finish(G.beam([0, 0.8 + H - 0.4, 0], [Math.cos(a) * 0.62, 0.8 + H - 0.05, Math.sin(a) * 0.62], 0.05, 0.05), 0x22302a)); }
  return G.mergeParts(P);
}
export function modelOrnate5Globes(G) {
  const y = 0.8 + 4.3, P = [];
  P.push(G.finish(new THREE.IcosahedronGeometry(0.24, 0).translate(0, y + 0.42, 0), 0xffffff));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; P.push(G.finish(new THREE.IcosahedronGeometry(0.19, 0).translate(Math.cos(a) * 0.62, y + 0.2, Math.sin(a) * 0.62), 0xffffff)); }
  return G.mergeParts(P);
}
// CỔNG CHÀO khu dân cư (2 trụ + dầm; chữ = tấm băng rôn riêng) — local X = ngang ngõ (scale x = bề rộng/4), +Z ra phố
function modelGate(G) {
  const P = [];
  for (const s of [-1, 1]) {
    P.push(G.finish(G.box(0.42, 4.7, 0.42, s * 2.15, 2.35, 0), 0xe8dcc0));
    P.push(G.finish(G.box(0.55, 0.3, 0.55, s * 2.15, 0.15, 0), 0xb8ae98));
  }
  P.push(G.finish(G.box(4.8, 1.0, 0.3, 0, 4.4, 0), 0xc0281e));
  P.push(G.finish(G.box(5.0, 0.12, 0.6, 0, 4.98, 0), 0x8a3a24));
  return G.mergeParts(P);
}

// atlas chữ băng rôn (đỏ chữ vàng — khẩu hiệu CHUNG, không thương hiệu): 4 ô ngang 1024×64 mỗi ô
const BANNER_TXT = ['NHIỆT LIỆT CHÀO MỪNG NGÀY GIẢI PHÓNG HẢI PHÒNG', 'AN TOÀN GIAO THÔNG LÀ HẠNH PHÚC CỦA MỌI NHÀ',
  'XÂY DỰNG NẾP SỐNG VĂN MINH ĐÔ THỊ', 'KHU DÂN CƯ VĂN HOÁ'];
function bannerTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256;
  const g = cv.getContext('2d');
  for (let k = 0; k < 4; k++) {
    const y0 = k * 64;
    g.fillStyle = '#c4231c'; g.fillRect(0, y0, 1024, 64);
    g.fillStyle = '#ffd83a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 40; g.font = `bold ${fs}px Arial, sans-serif`;
    while (g.measureText(BANNER_TXT[k]).width > 980 && fs > 18) { fs -= 2; g.font = `bold ${fs}px Arial, sans-serif`; }
    g.fillText(BANNER_TXT[k], 512, y0 + 33);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// cờ treo nhà: cán 1,5 m chếch lên từ tường + lá cờ 1,05×0,7 (cột trái canvas xám = cán)
function houseFlagTexture() {
  const cv = document.createElement('canvas'); cv.width = 132; cv.height = 86;
  const g = cv.getContext('2d');
  g.fillStyle = '#4a4a48'; g.fillRect(0, 0, 4, 86);
  g.fillStyle = '#da251d'; g.fillRect(4, 0, 128, 86);
  g.fillStyle = '#ffdd00'; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? 11.7 : 28; const xx = 68 + Math.cos(a) * rr, yy = 43 + Math.sin(a) * rr; i ? g.lineTo(xx, yy) : g.moveTo(xx, yy); }
  g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function houseFlagGeometry() {
  // local +X = ra khỏi tường; cán từ (0,0,0) tới (1.35, 0.78, 0) (chếch ~30°), lá cờ treo dưới nửa ngoài của cán
  const parts = [];
  const f = new THREE.PlaneGeometry(1.05, 0.7); f.translate(0.85, 0.32, 0);
  const uv = f.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, 0.04 + uv.getX(i) * 0.96);
  parts.push(f);
  const st = new THREE.BoxGeometry(1.5, 0.03, 0.03); st.translate(0.75, 0, 0); st.rotateZ(Math.atan2(0.78, 1.35));
  const su = st.attributes.uv; for (let i = 0; i < su.count; i++) { su.setX(i, 0.01); su.setY(i, 0.5); }
  parts.push(st);
  // lá cờ treo DƯỚI cán: mép trên lá (y 0,67) trượt theo độ chếch của cán (y = 0,578·x) → lá hình bình hành treo dọc cán
  const fp = f.attributes.position; for (let i = 0; i < fp.count; i++) fp.setY(i, fp.getY(i) + fp.getX(i) * 0.578 - 0.67);
  return parts;
}

// ---------------------------------------------------------------------------------------------------------------------
// HÌNH HỌC TIỆN ÍCH
// ---------------------------------------------------------------------------------------------------------------------
function polyDist(poly, x, z) {   // khoảng cách tới đa giác (0 nếu bên trong)
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi, dz = zj - zi, l2 = dx * dx + dz * dz;
    let t = l2 ? ((x - xi) * dx + (z - zi) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (xi + dx * t), z - (zi + dz * t)); if (d < best) best = d;
  }
  return inside ? 0 : best;
}

// phân loại chữ biển hiệu thật (SHOP_SIGNS — đọc từ pano) → loại hàng tràn hè (chỉ dùng để CHỌN đồ, chữ không hiển thị)
const SIGN_CAT = [
  ['cafe', /CÀ PHÊ|CAFE|CAFÉ|COFFEE|TRÀ SỮA|TRÀ CHANH|GIẢI KHÁT|NƯỚC MÍA|SINH TỐ|TRÀ ĐÁ|\bBIA\b|BIA HƠI|KEM\b/],
  ['food', /PHỞ|BÚN|CƠM|BÁNH (MÌ|CUỐN|ĐA|XÈO|CANH|BAO)|MIẾN|CHÁO|LẨU|NƯỚNG|ỐC\b|NEM|XÔI|QUÁN|\bGÀ\b|VỊT|NGAN|HẢI SẢN|CHÈ\b|CƠM BÌNH DÂN/],
  ['furn', /NỘI THẤT|ĐỒ GỖ|ĐỒ THỜ|THỜ CÚNG|KÉT SẮT|SOFA|GIƯỜNG|BÀN GHẾ|TỦ BẾP|ĐỒ THỜ CÚNG/],
  ['bike', /XE MÁY|XE ĐIỆN|XE ĐẠP|PHỤ TÙNG|SỬA XE|HONDA|YAMAHA|SUZUKI|PIAGGIO|VESPA|\bSYM\b|VINFAST|XE TAY GA/],
  ['toys', /ĐỒ CHƠI|THÚ BÔNG|LƯU NIỆM|QUÀ TẶNG/],
  ['fruit', /HOA QUẢ|TRÁI CÂY|RAU|THỰC PHẨM|GẠO|TẠP HO[ÁA]|HẢI SẢN TƯƠI|ĐỒ KHÔ/],
  ['flower', /HOA TƯƠI|ĐIỆN HOA|SHOP HOA|HOA CƯỚI|CƯỚI HỎI|HOA LỤA/],
  ['cloth', /THỜI TRANG|QUẦN ÁO|GIÀY|DÉP|TÚI XÁCH|ĐỒ LÓT|CHĂN GA|VẢI|ÁO DÀI|MAY ĐO|SHOP\b|ĐỒ BẦU|ĐỒ TRẺ EM/],
  ['hard', /ĐIỆN MÁY|ĐIỆN NƯỚC|ĐIỀU HÒA|ĐIỀU HOÀ|SẮT|INOX|NHỰA|GẠCH|SƠN\b|VẬT LIỆU|THIẾT BỊ|KIM KHÍ|ĐIỆN TỬ|BẾP|SỨ VỆ SINH|ĐỒ GIA DỤNG|BAO BÌ/],
  ['plant', /CÂY CẢNH|HOA LAN|CÂY GIỐNG|BONSAI|SINH VẬT CẢNH/],
];
export const signCategory = (t) => { const s = String(t || '').toUpperCase(); for (const [k, rx] of SIGN_CAT) if (rx.test(s)) return k; return null; };

// ---------------------------------------------------------------------------------------------------------------------
// ĐẶT ĐỒ — gọi trong buildProps sau 6.4 (quán/xe đẩy/biển A/thùng rác) và TRƯỚC 6.5 (xe máy) → xe máy/ô tô/người né.
// P = { sides, CELL, cellPos, hash3, evAt, inBuilding, obst, flat, roadIdx, nearPano, onCarriage, openSpace, claimAt,
//       XS(c) → {hw, sw, curb, park, furn, fac}, OCC, placeFood, lists:{stoolI, paraI, sitI, standI, bikeDisplay},
//       addCollider, R_MAX, SHOP_SIGNS, MARKETS, LITE, stats }
// ---------------------------------------------------------------------------------------------------------------------
// (1) PHÂN LOẠI ô (gọi NGAY sau lấy mẫu 6.1, trước mọi đồ hè): S.mk[k] mức chợ 0-3, S.fore[k] = sân trước công trình
//     tôn giáo/công sở/cổng/địa danh (không xe máy/chợ/quán/đồ hè — pano_276 chùa, 524 cổng Hải Thành)
export function marketLevels(P) {
  const { sides, cellPos, XS } = P;
  const st = P.st, T0 = performance.now();
  // ---- mức chợ từng ô ----
  const mk = P.MARKETS.map((m) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of m.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { poly: m.poly, bb: [x0 - 80, z0 - 80, x1 + 80, z1 + 80] }; });
  const isForecourtName = (n) => /chua|den_|_den|dinh_|nhatho|nha_tho|mieu|pagoda|temple|church|ubnd|congso|cong_so|truso|tru_so|haiquan|benhvien|bv_|truong|school|mamnon|cong_|gate|quanuy|cong_an|congan|toaan|vien_/i.test(n || '');
  const isMarketName = (n) => /(^|_)cho(_|$)/i.test(n || '');
  for (const S of sides) {
    const X = XS(S.c);
    S.mk = new Uint8Array(S.n); S.fore = new Uint8Array(S.n);
    for (let k = 0; k < S.n; k++) {
      const [x, z] = cellPos(S, k, X.park);
      // sân trước công trình tôn giáo/công sở/cổng (ô dựng tay hoặc địa danh ngay sau mặt tiền) → không xe máy/chợ/đồ hè
      const [bx, bz] = cellPos(S, k, X.fac + 2.5);
      const cb = P.claimAt(bx, bz, ['cell', 'landmark', 'civic']);
      let mClaim = !!(cb && isMarketName(cb.name));
      if (cb && !mClaim && (cb.kind !== 'cell' || isForecourtName(cb.name))) { S.fore[k] = 1; st.forecourt++; }
      if (!mClaim) { const [cx2, cz2] = cellPos(S, k, X.fac + 8); const c2 = P.claimAt(cx2, cz2, ['cell']); mClaim = !!(c2 && isMarketName(c2.name)); }
      if (!S.ok[k]) continue;
      let lv = 0;
      const e = S.ev[k];
      if (e && e[7]) { const d = Math.hypot(e[0] - x, e[1] - z); if (d <= 45) lv = Math.max(0, e[7] - (d > 30 ? 1 : 0)); }
      let lo = 0;
      for (const m of mk) {
        if (x < m.bb[0] || x > m.bb[2] || z < m.bb[1] || z > m.bb[3]) continue;
        const d = polyDist(m.poly, x, z); lo = Math.max(lo, d <= 12 ? 3 : d <= 40 ? 2 : d <= 80 ? 1 : 0);
      }
      if (lo > 1 && e && e[7] === 0 && !(e[8] & 7) && Math.hypot(e[0] - x, e[1] - z) < 30) lo = 1;   // pano gần không thấy chợ
      lv = Math.max(lv, lo);
      if (mClaim) lv = 3;   // ngay trước ô dựng tay tên cho_* (Chợ Tam Bạc, Chợ Con…)
      if (S.c === 'p' && lv > 1) lv = 1;
      if (S.fore[k]) lv = 0;
      S.mk[k] = lv; st.mkCells[lv]++;
    }
  }
  st.msLevels = Math.round(performance.now() - T0);
}
export function newStreetLifeStats() {
  return { mkCells: [0, 0, 0, 0], units: 0, umbrellas: 0, tarps: 0, ground: 0, roadStrip: 0, vendors: 0, customers: 0,
    signSpill: {}, evSpill: 0, plants: 0, flagsHouse: 0, banners: 0, gates: 0, forecourt: 0 };
}
// (2) ĐẶT ĐỒ — sau 6.4 (quán/xe đẩy/biển A/thùng rác), TRƯỚC 6.5 (xe máy) → xe máy/ô tô/người né
export function placeStreetLife(P) {
  const { sides, CELL, cellPos, hash3, inBuilding, obst, flat, roadIdx, nearPano, onCarriage, XS, OCC } = P;
  const T0 = performance.now();
  const st = P.st;
  const overI = [];    // ô dù tròn (v0) / ô vuông (v1) / bạt (v2)
  const groundI = [];  // sạp (0) mẹt (1) sọt (2) bạt đất (3) bao tải (4) ghế đẩu (5)
  const spillI = [];   // giá áo (0) hoa (1) chậu cây (2) nội thất (3) bàn thờ+két (4) đồ chơi (5) hàng chồng (6)
  const stallsRoad = []; // hàng lấn lòng đường (cho traffic.js lách) {x,z,heading,len,hw}
  const flagsHouse = [], banners = [], gates = [], posts = [];
  // màu ô dù chợ (ảnh pano: đỏ, xanh dương, xanh lá, cam, tím, hồng, trắng chấm…) / bạt (xanh dương chiếm đa số)
  const UMB = [0xc8282a, 0xd83a2e, 0x1f5fb0, 0x2c8a4a, 0xe07a1e, 0x7a4aa0, 0xe86a9a, 0xf0f0ea, 0x2a9ac8, 0xd8c020];
  const TARP = [0x2f6db5, 0x2f6db5, 0x3a7cc8, 0x2a5a9a, 0xd9692a, 0x3f8f4a, 0xd8d8d0, 0xb83a2a];
  const GTARP = [0x2f6db5, 0x2f6db5, 0xb83a2a, 0x3f8f4a, 0x8a8a88];
  const STOOL = [0xd8322a, 0xd8322a, 0x2a62c4, 0x2a62c4, 0x2f9a4c, 0xe8e2d4];
  const pick = (a, u) => a[Math.min(a.length - 1, (u * a.length) | 0)];
  // ---- kiểm tra 1 vật: (x,z) tâm, r bán kính, road = được phép ở dải lòng đường sát bó vỉa của CHÍNH phố này ----
  const okAt = (S, x, z, r, road = false) => {
    if (nearPano(x, z, 2.5 + r)) return false;
    if (!flat(x, z) || inBuilding(x, z)) return false;
    if (road) { if (roadIdx.blocked(x, z, S.ri, S.si, 4)) return false; }
    else if (onCarriage(x, z)) return false;
    return true;
  };
  const headRoad = (S) => Math.atan2(-S.nx, -S.nz);   // local +Z → lòng đường
  // ---- CHỢ: đi dọc từng bên phố theo bước ô sạp ----
  for (const S of sides) {
    if (!S.mk) continue;
    const X = XS(S.c), H = headRoad(S);
    const sw = X.sw, hw = X.hw;
    let t = S.off + 0.4;
    const tEnd = S.off + S.n * CELL - 0.4;
    while (t < tEnd) {
      const k = Math.min(S.n - 1, Math.max(0, Math.floor((t - S.off) / CELL)));
      const lv = S.mk[k];
      if (!lv || !S.ok[k]) { t += 1.5; continue; }
      const u0 = hash3(S.ax + S.ux * t, S.az + S.uz * t, 301);
      const step = lv === 3 ? 2.3 + u0 * 0.9 : lv === 2 ? 2.8 + u0 * 1.6 : 3;
      const pOcc = lv === 3 ? 0.9 : lv === 2 ? 0.55 : 0.1;
      if (hash3(S.ax + t, S.az - t, 302) > pOcc) { t += step; continue; }
      const blk = Math.floor(t / 9);
      const theme = hash3(S.ax + blk * 9, S.az + S.side, 303) < (lv === 1 ? 0.75 : 0.58) ? 'umb' : 'tarp';
      const P2 =(lat, dt = 0) => { const s = t + dt; return [S.ax + S.ux * s + S.nx * lat, S.az + S.uz * s + S.nz * lat]; };
      let placed = 0;
      // (1) che phía trên
      const hu = hash3(S.ax + t * 1.7, S.az, 304);
      if (theme === 'umb' && hu < (lv === 1 ? 0.9 : 0.85)) {
        const lat = sw >= 2.6 ? hw + 0.35 + hu * 0.6 : hw + Math.max(0.3, sw * 0.4);
        const [x, z] = P2(lat, -0.75);   // cán ô lệch 0,75 m dọc phố so với sạp (cán cắm cạnh sạp, tán che cả sạp)
        const sc = 0.85 + hash3(x, z, 305) * 0.3;
        if (okAt(S, x, z, 1.3 * sc) && !obst.hit(x, z, 0.9)) {
          overI.push({ x, z, heading: hash3(x, z, 306) * 6.28, v: hash3(x, z, 307) < 0.15 ? 1 : 0, col: pick(UMB, hash3(x, z, 308)), sc: [sc, 0.92 + hash3(x, z, 309) * 0.16, sc] });
          obst.add(x, z, 0.05); st.umbrellas++; placed++;
          // phố chợ dày: ô thứ 2 chồng mép (rừng ô) trên dải lòng đường
          if (lv === 3 && hash3(x, z, 310) < 0.35) {
            const [x2, z2] = P2(hw - 0.45, 1.2);
            if (okAt(S, x2, z2, 1.3, true) && !obst.hit(x2, z2, 0.9)) { overI.push({ x: x2, z: z2, heading: hash3(x2, z2, 306) * 6.28, v: 0, col: pick(UMB, hash3(x2, z2, 308)), sc: [sc, 1.05, sc] }); obst.add(x2, z2, 0.05); st.umbrellas++; }
          }
        }
      } else if (theme === 'tarp' && lv >= 2) {
        const depth = sw + 0.35 + hash3(S.ax, t, 311) * 0.5, wid = 2.6 + hash3(t, S.az, 312) * 0.8;
        const [xb, zb] = P2(X.fac - 0.05);
        const [xm, zm] = P2(X.fac - depth * 0.5);
        const [xf, zf] = P2(X.fac - depth + 0.05);
        if (!nearPano(xm, zm, 2.5 + wid * 0.5) && !nearPano(xf, zf, 2.5 + 0.4) && flat(xm, zm) && !inBuilding(xm, zm) && !inBuilding(xf, zf)
          && !obst.hit(xf + S.ux * 1.4, zf + S.uz * 1.4, 0.35) && !obst.hit(xf - S.ux * 1.4, zf - S.uz * 1.4, 0.35) && !onCarriage(xm, zm)) {
          overI.push({ x: xb, z: zb, heading: H, v: 2, col: pick(TARP, hash3(xb, zb, 313)), sc: [wid / 3, 1, depth] });
          st.tarps++; placed++;
        }
      }
      // (2) hàng dưới đất trên vỉa hè
      const sp = S.ev[k] ? S.ev[k][8] : 0;
      const gu = hash3(S.ax - t, S.az + t, 315);
      let gv = gu < 0.3 ? 0 : gu < 0.55 ? 1 : gu < 0.72 ? 3 : gu < 0.86 ? 2 : 4;
      if ((sp & 128) && gu < 0.5) gv = gu < 0.25 ? 1 : 0;   // rau quả → mẹt/sạp
      const latG = sw >= 2.6 ? hw + 0.7 + hash3(t, S.side, 316) * (sw - 1.9) : hw + Math.max(0.45, sw * 0.42);
      {
        const [x, z] = P2(latG, 0.25 + (gu - 0.5) * 0.4);
        if (okAt(S, x, z, 0.75) && !obst.hit(x, z, 0.55)) {
          const tcol = gv === 0 ? pick(GTARP, hash3(x, z, 317)) : gv === 3 ? pick(GTARP, hash3(x, z, 318)) : 0xffffff;
          groundI.push({ x, z, heading: H + (hash3(x, z, 319) - 0.5) * 0.3, v: gv, col: tcol });
          obst.add(x, z, 0.6); P.addCollider(x, z, 0.5); st.ground++; placed++;
          // người bán ngồi ghế đẩu phía mặt tiền, quay ra đường
          if (hash3(x, z, 320) < (lv >= 2 ? 0.62 : 0.45)) {
            const vl = Math.min(X.fac - 0.35, latG + 0.8);
            const [vx, vz] = P2(vl, 0.9);
            if (okAt(S, vx, vz, 0.3) && !obst.hit(vx, vz, 0.05)) {
              groundI.push({ x: vx, z: vz, heading: H, v: 5, col: pick(STOOL, hash3(vx, vz, 321)) });
              P.lists.sitI.push({ x: vx, z: vz, heading: H + (hash3(vx, vz, 322) - 0.5) * 0.6, yo: -0.03, vendor: 1 });
              obst.add(vx, vz, 0.3); st.vendors++;
            }
          }
          // khách đứng trước sạp (phía lòng đường)
          if (hash3(x, z, 323) < (lv === 3 ? 0.3 : 0.15)) {
            const [cx, cz] = P2(Math.max(hw - (lv === 3 ? 0.5 : -0.25), latG - 0.85), -0.3);
            if (okAt(S, cx, cz, 0.3, lv === 3) && !obst.hit(cx, cz, 0.3)) { P.lists.standI.push({ x: cx, z: cz, heading: H + Math.PI + (hash3(cx, cz, 324) - 0.5) * 1.2 }); st.customers++; }
          }
        }
      }
      // (3) mức 3: hàng lấn dải 1,1 m lòng đường sát bó vỉa
      if (lv === 3 && hash3(t, S.az * 1.3, 325) < 0.55) {
        const [x, z] = P2(hw - 0.55, 0.9);
        const rv = hash3(x, z, 326) < 0.45 ? 3 : hash3(x, z, 327) < 0.6 ? 1 : 2;
        if (okAt(S, x, z, 0.75, true) && !obst.hit(x, z, 0.55)) {
          groundI.push({ x, z, heading: H + Math.PI / 2 + (hash3(x, z, 328) - 0.5) * 0.4, v: rv, col: pick(GTARP, hash3(x, z, 329)), road: 1 });
          obst.add(x, z, 0.6); st.roadStrip++;
          stallsRoad.push({ x, z, heading: Math.atan2(S.ux, S.uz), len: 2.2, hw: 0.6, kind: 'stall' });
        }
      }
      // ô chợ: OCC.MKT (không OCC.SHOP) — xe máy vẫn được đỗ xen kẽ khe giữa các sạp (ảnh 446/184: xe máy đỗ lẫn trong chợ;
      // hàng/ghế đã vào `obst` nên xe né), người đi bộ (6.7) thì tránh
      if (placed) { S.occ[k] |= OCC.MKT; st.units++; }
      t += step;
    }
  }
  st.msMarket = Math.round(performance.now() - T0);
  // ---- HÀNG TRÀN HÈ theo biển hiệu thật (SHOP_SIGNS) ----
  // lưới ô mặt tiền: điểm facade của từng ô → tra nhanh ô gần nhất với vị trí biển
  const FG = new Map(), fk = (x, z) => Math.floor(x / 8) * 100003 + Math.floor(z / 8);
  for (const S of sides) { const X = XS(S.c); for (let k = 0; k < S.n; k++) { if (!S.ok[k] || S.fore[k]) continue; const [x, z] = cellPos(S, k, X.fac); const key = fk(x, z); let a = FG.get(key); if (!a) FG.set(key, (a = [])); a.push(S, k, x, z); } }
  const nearestCell = (x, z, R = 7) => {
    let best = null, bd = R * R;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = FG.get((Math.floor(x / 8) + i) * 100003 + Math.floor(z / 8) + j); if (!a) continue;
      for (let q = 0; q < a.length; q += 4) { const d = (a[q + 2] - x) ** 2 + (a[q + 3] - z) ** 2; if (d < bd) { bd = d; best = [a[q], a[q + 1]]; } }
    }
    return best;
  };
  const SPILL = { cloth: [0], flower: [1], plant: [2], furn: [3, 3, 4], toys: [5], hard: [6], fruit: [-1] };
  const putSpill = (S, k, cat, n, seed) => {
    const X = XS(S.c), H = headRoad(S);
    let c = 0;
    for (let j = 0; j < n * 2 && c < n; j++) {
      const kk = k + (j % 2 ? 1 : -1) * Math.ceil(j / 2);
      if (kk < 0 || kk >= S.n || !S.ok[kk] || S.fore[kk] || (S.occ[kk] & (OCC.SHOP | OCC.POLE | OCC.MKT))) continue;
      const u = hash3(S.ax + kk * 3.1, S.az + seed, 331);
      const lat = X.fac - 0.55 - (X.sw >= 3 && u < 0.35 ? 0.9 : 0);
      const [x, z] = cellPos(S, kk, lat, (u - 0.5) * 1.2);
      if (!okAt(S, x, z, 0.7) || obst.hit(x, z, 0.5)) continue;
      if (cat === 'fruit') groundI.push({ x, z, heading: H, v: u < 0.5 ? 2 : 1, col: 0xffffff });
      else { const vs = SPILL[cat]; spillI.push({ x, z, heading: H + (u - 0.5) * 0.2, v: vs[(u * vs.length) | 0], col: pick([0xa8552e, 0xa8552e, 0xe8e4dc, 0x6a6e70], hash3(x, z, 332)) }); }
      obst.add(x, z, 0.6); if (cat !== 'plant') P.addCollider(x, z, 0.45);
      S.occ[kk] |= OCC.SHOP; c++;
    }
    return c;
  };
  const displayBikes = (S, k) => {   // cửa hàng xe máy: 1-2 hàng xe mới mũi ra đường, sát mặt tiền
    const X = XS(S.c), H = headRoad(S);
    const rows = X.sw >= 3 ? 2 : 1;
    let c = 0;
    for (let r = 0; r < rows; r++) {
      const lat = X.fac - 0.95 - r * 1.05;
      for (let a = -2.6; a <= 2.6; a += 0.74) {
        const [x, z] = cellPos(S, k, lat, a);
        if (!okAt(S, x, z, 0.5) || obst.hit(x, z, 0.3) || inBuilding(x - S.nx * 0.95, z - S.nz * 0.95)) continue;
        P.lists.bikeDisplay.push({ x, z, heading: H + (hash3(x, z, 341) - 0.5) * 0.08 });
        obst.add(x, z, 0.3); c++;
      }
    }
    for (let kk = k - 1; kk <= k + 1; kk++) if (kk >= 0 && kk < S.n) S.occ[kk] |= OCC.SHOP;
    return c;
  };
  const doneSign = new Set();
  for (const sg of P.SHOP_SIGNS || []) {
    const cat = signCategory(sg[3]); if (!cat) continue;
    const key = Math.round(sg[0]) + ',' + Math.round(sg[1]) + ',' + cat; if (doneSign.has(key)) continue; doneSign.add(key);
    const c = nearestCell(sg[0], sg[1], 7); if (!c) continue;
    const [S, k] = c;
    if (S.mk && S.mk[k] >= 2) continue;   // chợ đã phủ
    const h = hash3(sg[0], sg[1], 351);
    let n = 0;
    if (cat === 'cafe') { if (!(S.occ[k] & (OCC.SHOP | OCC.MKT))) { P.placeFood(S, k, 2 + ((h * 2) | 0), true); n = 1; } }
    else if (cat === 'food') { if (!(S.occ[k] & (OCC.SHOP | OCC.MKT)) && h < 0.6) { P.placeFood(S, k, 1 + ((h * 3) | 0), false); n = 1; } }
    else if (cat === 'bike') n = h < 0.75 ? displayBikes(S, k) : 0;
    else if (cat === 'furn') n = putSpill(S, k, 'furn', 2 + ((h * 2) | 0), 1);
    else if (cat === 'toys') n = putSpill(S, k, 'toys', 2, 2);
    else if (cat === 'fruit') n = h < 0.7 ? putSpill(S, k, 'fruit', 1 + ((h * 2) | 0), 3) : 0;
    else if (cat === 'flower') n = putSpill(S, k, 'flower', 2, 4);
    else if (cat === 'cloth') n = h < 0.45 ? putSpill(S, k, 'cloth', 1 + ((h * 3) | 0), 5) : 0;
    else if (cat === 'hard') n = h < 0.5 ? putSpill(S, k, 'hard', 1 + ((h * 3) | 0), 6) : 0;
    else if (cat === 'plant') n = putSpill(S, k, 'plant', 3, 7);
    if (n) st.signSpill[cat] = (st.signSpill[cat] || 0) + 1;
  }
  // ---- hàng tràn hè theo BẰNG CHỨNG pano (không có biển khớp): ô ≤ 25 m quanh pano ----
  const EVC = [[64, 'toys'], [32, 'furn'], [256, 'cloth'], [128, 'fruit'], [1024, 'flower'], [512, 'plant'], [4, 'hard']];
  for (const S of sides) {
    for (let k = 0; k < S.n; k++) {
      if (!S.ok[k] || S.fore[k] || (S.occ[k] & (OCC.SHOP | OCC.MKT))) continue;
      const e = S.ev[k]; if (!e || !e[8]) continue;
      const X = XS(S.c); const [x, z] = cellPos(S, k, X.park);
      if (Math.hypot(e[0] - x, e[1] - z) > 25) continue;
      for (const [bit, cat] of EVC) {
        if (!(e[8] & bit)) continue;
        if (hash3(x, z, 360 + bit) > (cat === 'plant' ? 0.22 : 0.16)) continue;
        if (putSpill(S, k, cat, cat === 'plant' ? 2 : 1, 8 + bit)) st.evSpill++;
        break;
      }
      if ((e[8] & 16) && !(S.occ[k] & (OCC.SHOP | OCC.MKT)) && hash3(x, z, 377) < 0.08) { if (displayBikes(S, k)) st.evSpill++; }
    }
  }
  // ---- chậu cây trước nhà (rất phổ biến; nền thưa, KHÔNG ở đại lộ p) ----
  for (const S of sides) {
    if (S.c === 'p') continue;
    for (let k = 0; k < S.n; k++) {
      if (!S.ok[k] || S.fore[k] || (S.occ[k] & (OCC.SHOP | OCC.POLE | OCC.MKT))) continue;
      const X = XS(S.c); const [x, z] = cellPos(S, k, X.fac - 0.5);
      const r0 = Math.hypot(x, z);
      if (hash3(x, z, 381) > (r0 < 1300 ? 0.03 : 0.012)) continue;
      if (!okAt(S, x, z, 0.5) || obst.hit(x, z, 0.5)) continue;
      spillI.push({ x, z, heading: hash3(x, z, 382) * 6.28, v: 2, col: pick([0xa8552e, 0xa8552e, 0xe8e4dc, 0x6a6e70], hash3(x, z, 383)) });
      obst.add(x, z, 0.5); S.occ[k] |= OCC.SHOP; st.plants++;
    }
  }
  st.msSpill = Math.round(performance.now() - T0);
  // ---- CỜ TREO NHÀ (pano nhắc cờ đỏ sao vàng: 22% ô ≤ 40 m; nền phố cũ 2,5%) ----
  for (const S of sides) {
    if (S.c === 'p') continue;
    const X = XS(S.c);
    for (let k = 0; k < S.n; k++) {
      if (!S.ok[k] || S.fore[k]) continue;
      const da = (hash3(S.ax + k, S.az, 391) - 0.5) * 1.6;
      const [x0, z0] = cellPos(S, k, X.fac, da);
      const e = S.ev[k]; const near = e && (e[9] & 1) && Math.hypot(e[0] - x0, e[1] - z0) < 40;
      if (hash3(x0, z0, 392) > (near ? 0.22 : Math.hypot(x0, z0) < 1100 ? 0.025 : 0.008)) continue;
      // chân cán cắm vào MẶT TIỀN THẬT: dò từ facadeLine − 0,5 m tới + 2,5 m điểm đầu tiên trong nhà (không cắm vào khoảng trống)
      let dF = null;
      for (let d = -0.5; d <= 2.5; d += 0.25) { const [qx, qz] = cellPos(S, k, X.fac + d, da); if (inBuilding(qx, qz)) { dF = d; break; } }
      if (dF === null) continue;
      const [x, z] = cellPos(S, k, X.fac + dF - 0.04, da);
      if (nearPano(x, z, 3.5)) continue;
      flagsHouse.push({ x, z, heading: Math.atan2(S.nz, -S.nx) /* local +X → −n (ra đường) */, yo: 3.5 + hash3(x, z, 393) * 1.3 });
      st.flagsHouse++;
    }
  }
  // ---- BĂNG RÔN căng ngang phố + CỔNG CHÀO (pano nhắc) ----
  const evRows = P.evidence || [];
  for (const e of evRows) {
    if (!(e[9] & 6)) continue;
    if (Math.hypot(e[0], e[1]) > P.R_MAX) continue;
    // đoạn phố gần camera nhất (cả 2 bên cùng ri/si)
    let best = null, bd = 12 * 12;
    for (const S of sides) {
      const dx = e[0] - S.ax, dz = e[1] - S.az, t = dx * S.ux + dz * S.uz;
      if (t < 0 || t > S.L) continue;
      const lat = dx * S.nx + dz * S.nz; if (lat * lat < bd) { bd = lat * lat; best = { S, t }; }
    }
    if (!best) continue;
    const { S, t } = best; const X = XS(S.c);
    if (e[9] & 2) {
      for (const dt of [16, -16, 24, -24]) {
        const s = t + dt; if (s < 2 || s > S.L - 2) continue;
        const cx = S.ax + S.ux * s, cz = S.az + S.uz * s;
        if (roadIdx.blocked(cx, cz, S.ri, S.si, 2, false)) continue;
        const half = X.furn - 0.1;
        const ends = [[cx + S.nx * X.furn, cz + S.nz * X.furn], [cx - S.nx * X.furn, cz - S.nz * X.furn]];
        if (ends.some(([px, pz]) => inBuilding(px, pz) || onCarriage(px, pz) || obst.hit(px, pz, 0.3))) continue;
        banners.push({ x: cx, z: cz, heading: Math.atan2(S.nz, -S.nx), cell: (hash3(cx, cz, 401) * 3) | 0, sc: [half * 2, 1, 1], yo: 5.2 });
        for (const [px, pz] of ends) { posts.push({ x: px, z: pz, heading: 0, sc: [1, 1.6, 1] }); obst.add(px, pz, 0.3); P.addCollider(px, pz, 0.12); }
        st.banners++; break;
      }
    }
    if (e[9] & 4) {
      // cổng chào: đặt ngang phố ở ~18 m (không trùng băng rôn), trụ ở mép vỉa hè 2 bên
      for (const dt of [-18, 18, -26, 26]) {
        const s = t + dt; if (s < 3 || s > S.L - 3) continue;
        const cx = S.ax + S.ux * s, cz = S.az + S.uz * s;
        if (roadIdx.blocked(cx, cz, S.ri, S.si, 3, false) || nearPano(cx, cz, 10)) continue;
        const half = X.hw + 0.5;
        const p1 = [cx + S.nx * half, cz + S.nz * half], p2 = [cx - S.nx * half, cz - S.nz * half];
        if (inBuilding(p1[0], p1[1]) || inBuilding(p2[0], p2[1]) || !flat(p1[0], p1[1]) || !flat(p2[0], p2[1])) continue;
        gates.push({ x: cx, z: cz, heading: Math.atan2(S.ux, S.uz), sc: [half / 2.15, 1, 1], w: half * 2, ux: S.ux, uz: S.uz });
        P.addCollider(p1[0], p1[1], 0.35); P.addCollider(p2[0], p2[1], 0.35);
        st.gates++; break;
      }
    }
  }
  st.ms = Math.round(performance.now() - T0);
  return { overI, groundI, spillI, stallsRoad, flagsHouse, banners, gates, posts, stats: st };
}

// ---------------------------------------------------------------------------------------------------------------------
// DỰNG InstancedMesh (gọi trong 6.8 của props với `inst` + vật liệu props)
// ---------------------------------------------------------------------------------------------------------------------
export function buildStreetLifeMeshes(B, L) {
  const { G, inst, LITE } = B;
  const matMkt = G.propMaterial({ name: 'market',
    palA: [0x4f8a2b, 0xc2361f, 0xe08a1e, 0xe8c43a, 0x7a4a2a, 0x9fbf3a, 0x6b2a5a, 0xd9d2c0],
    palB: [0xf2f2ee, 0x1f5fb0, 0xf2f2ee, 0xc8282a, 0x2c8a4a, 0xf0f0ea, 0x2a4f9a, 0xe0c020] });
  const NEAR_OVER = LITE ? 160 : 300, NEAR_GROUND = LITE ? 90 : 150;
  const out = [];
  if (L.overI.length) out.push(inst('props_market_over', G.variants([modelUmbrella(G), modelUmbrellaSq(G), modelTarp(G)]), matMkt, L.overI, { rMax: NEAR_OVER, keepBehind: 30, color: (it) => it.col }));
  if (L.groundI.length) out.push(inst('props_market_ground', G.variants([modelStall(G), modelBaskets(G), modelCrates(G), modelHeap(G), modelSacks(G), modelStool(G)]), matMkt, L.groundI, { rMax: NEAR_GROUND, keepBehind: 25, color: (it) => it.col }));
  if (L.spillI.length) out.push(inst('props_spill', G.variants([modelRack(G), modelFlowers(G), modelPot(G), modelFurniture(G), modelAltar(G), modelToys(G), modelGoods(G)]), matMkt, L.spillI, { rMax: NEAR_GROUND, keepBehind: 25, color: (it) => it.col }));
  if (L.flagsHouse.length) {
    const tex = houseFlagTexture();
    const geo = G.mergeGeometriesRaw(houseFlagGeometry());
    out.push(inst('props_flags_house', geo, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), L.flagsHouse.map((f) => ({ ...f, y: (f.y || 0) + f.yo, yo: 0 })), { rMax: LITE ? 160 : 260, cast: false }));
  }
  if (L.banners.length || L.gates.length) {
    const tex = bannerTexture();
    const bm = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    bm.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = vec2(vMapUv.x, (3.0 - aCell + vMapUv.y) * 0.25);\n#endif');
    };
    bm.customProgramCacheKey = () => 'hp_props_banner_v1';
    const bg = new THREE.PlaneGeometry(1, 0.9);   // scale x = bề rộng phố
    // cổng chào: tấm chữ 2 mặt, nhô 0,17 m trước/sau dầm (dầm dày 0,3 m — tấm ở tâm sẽ bị dầm che)
    const list = [...L.banners.map((b) => ({ x: b.x, z: b.z, heading: b.heading, y: b.y, yo: b.yo, cell: b.cell, sc: b.sc })),
      ...L.gates.flatMap((g) => [1, -1].map((s) => ({ x: g.x + g.ux * 0.17 * s, z: g.z + g.uz * 0.17 * s, heading: g.heading, y: g.y, yo: 4.4, cell: 3, sc: [g.w - 0.9, 1, 1] })))];
    out.push(inst('props_banners', bg, bm, list, { rMax: LITE ? 200 : 380, cast: false, extra: (m, l) => {
      const a = new Float32Array(l.length); l.forEach((it, i) => { a[i] = it.cell; });
      m.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(a, 1));
    } }));
    if (L.gates.length) out.push(inst('props_gates', modelGate(G), matMkt, L.gates, { rMax: LITE ? 200 : 380, color: () => 0xffffff }));
  }
  return out;
}
