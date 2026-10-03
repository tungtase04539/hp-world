// xsection.js — MẶT CẮT NGANG PHỐ: nguồn DUY NHẤT cho mọi lớp bám mép đường (lòng, bó vỉa, vỉa hè, hố cây,
// dải đỗ xe máy, mặt tiền nhà). Trước đây mỗi hệ tự chép ROAD_W và tự chọn offset → cây/mái hiên ở hw+3.4 nằm SAU
// mặt tiền (hw+2.3), ô tô đỗ trên vỉa hè... (bản đồ dự án 2026-10-04 mục 30). Đơn vị mét, tính từ TIM đường.
// Không import three → dùng được trong node (tools/process_buildings.mjs) lẫn trình duyệt.
//
//   tim ─── lòng (ROAD_HW) ──┤bó vỉa├── vỉa hè (SIDEWALK_W) ──┤ mặt tiền (facadeLine)
//                            curbLine          treePit / parking / furniture nằm TRONG vỉa hè

// Bề rộng lòng đường đầy đủ theo cấp OSM (giữ đúng ROAD_W cũ của world.js — mọi offset cũ suy từ đây)
export const ROAD_W = { p: 13, s: 10, t: 8, r: 5.5, w: 3.5, h: 3 };
export const ROAD_HW = Object.fromEntries(Object.entries(ROAD_W).map(([k, v]) => [k, v / 2]));
// Bề rộng vỉa hè MỖI BÊN. p/s/t = 0.28·w như bộ dựng đường cũ (layRoad) để không lệch khi chưa đổi road builder;
// r = 1.5 m (phố dân sinh HP: vỉa hẹp 1-2 m theo pano), w (phố đi bộ) và h (ngõ) không có vỉa.
export const SIDEWALK_W = { p: 3.64, s: 2.8, t: 2.24, r: 1.5, w: 0, h: 0 };
export const CURB_RISE = 0.14;      // mặt vỉa hè cao hơn mặt nhựa (m)
export const ROAD_TOP = 0.11;       // mặt nhựa so với nền LAND_H (lớp dọc: KNOWLEDGE §5.3)
export const SIDEWALK_TOP = ROAD_TOP + CURB_RISE;

const k = (c) => (c in ROAD_W ? c : 'r');
export const curbLine = (c) => ROAD_HW[k(c)];                                 // mép lòng = mép bó vỉa
export const facadeLine = (c) => ROAD_HW[k(c)] + SIDEWALK_W[k(c)];             // mặt tiền nhà sát vỉa
export const treePitLine = (c) => ROAD_HW[k(c)] + Math.min(0.75, SIDEWALK_W[k(c)] * 0.3);   // hố cây sát bó vỉa
export const parkingLine = (c) => ROAD_HW[k(c)] + Math.max(0.6, SIDEWALK_W[k(c)] * 0.55);   // tâm hàng xe máy đỗ
export const furnitureLine = (c) => ROAD_HW[k(c)] + 0.35;                      // cột điện/đèn/biển báo
export const hasSidewalk = (c) => SIDEWALK_W[k(c)] > 0;
