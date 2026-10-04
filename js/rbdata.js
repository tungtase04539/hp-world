// js/rbdata.js — footprint nhà THẬT (RB01 trong buildings_real.js) giải mã MỘT lần cho cả trang + 1 lưới tra dùng chung.
// Đợt 3 wave 2 (W2-F): trước đó cell sink (realBuildings), citygen (fabricData) giải mã RIÊNG 2 lần (+ trees/props tự giải
// thêm khi không được truyền lưới) — mỗi lần ~5-15 ms + 2,6 MB mảng + lưới ô 24 m. Mọi module lấy D/G ở ĐÂY.
// HỢP ĐỒNG: D.dead[b] = 1 do người dùng đặt (claims/pano/vùng cấm — citygen) là trạng thái CHUNG; lưới G lọc nhà dead
// NGAY LÚC TRA (near/at kiểm D.dead mỗi lần) nên dựng 1 lần trước khi giết nhà vẫn đúng sau đó. Không ai được đổi hình
// học D (x/z/vStart); refreshPartyEdges chỉ sửa edge/edgeCover (citygen gọi sau khi chốt D.dead).
import { RB_B64 } from './buildings_real.js';
import { decodeRB, makeFootprintGrid } from './buildings_data.js';

let _D = null, _G = null;
export function rbData() { if (!_D) _D = decodeRB(RB_B64); return _D; }
export function rbGrid() { if (!_G) _G = makeFootprintGrid(rbData()); return _G; }
