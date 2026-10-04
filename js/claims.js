// claims.js — SỔ ĐĂNG KÝ VÙNG GIỮ CHỖ (địa danh, khuôn viên cơ quan dựng tay, quảng trường, công viên...).
// Thay cho FEATURED_CLEAR (1.687 hình tròn, quét tuyến tính) khi quyết định footprint nhà THẬT nào phải nhường chỗ.
// Hình: hộp xoay (cx,cz,hx,hz,rot) | tròn (cx,cz,r) | đa giác (pts). Lưới ô 32 m. Không import three.
//   rot theo quy ước world.js: local X → thế giới (cosθ, −sinθ), local Z → (sinθ, cosθ).
const CELL = 32;
const grid = new Map();
const list = [];
const key = (i, j) => (i + 4096) * 8192 + (j + 4096);

function bboxOf(c) {
  if (c.type === 'circle') return [c.cx - c.r, c.cz - c.r, c.cx + c.r, c.cz + c.r];
  if (c.type === 'poly') { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of c.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; }
  const cs = Math.cos(c.rot), sn = Math.sin(c.rot);
  const ex = Math.abs(c.hx * cs) + Math.abs(c.hz * sn), ez = Math.abs(c.hx * sn) + Math.abs(c.hz * cs);
  return [c.cx - ex, c.cz - ez, c.cx + ex, c.cz + ez];
}
function add(c) {
  c.id = list.length; list.push(c); c.bb = bboxOf(c);
  for (let i = Math.floor(c.bb[0] / CELL); i <= Math.floor(c.bb[2] / CELL); i++)
    for (let j = Math.floor(c.bb[1] / CELL); j <= Math.floor(c.bb[3] / CELL); j++) {
      const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(c);
    }
  return c;
}
// kind: 'landmark' | 'civic' | 'plaza' | 'park' | 'cell' | 'water' ... ; name: để gỡ lỗi
export function claimBox(cx, cz, hx, hz, rot = 0, kind = 'cell', name = '') { return add({ type: 'box', cx, cz, hx, hz, rot, kind, name }); }
export function claimCircle(cx, cz, r, kind = 'cell', name = '') { return add({ type: 'circle', cx, cz, r, kind, name }); }
export function claimPoly(pts, kind = 'cell', name = '') { return add({ type: 'poly', pts, kind, name }); }

function inside(c, x, z) {
  if (x < c.bb[0] || x > c.bb[2] || z < c.bb[1] || z > c.bb[3]) return false;
  if (c.type === 'circle') return (x - c.cx) ** 2 + (z - c.cz) ** 2 <= c.r * c.r;
  if (c.type === 'box') {
    const dx = x - c.cx, dz = z - c.cz, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;   // nghịch đảo của local→world
    return Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz;
  }
  let inn = false; const P = c.pts;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, zi] = P[i], [xj, zj] = P[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inn = !inn;
  }
  return inn;
}
// claim đầu tiên chứa điểm (lọc theo kind nếu có) hoặc null
export function claimAt(x, z, kinds = null) {
  const a = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!a) return null;
  for (const c of a) if ((!kinds || kinds.includes(c.kind)) && inside(c, x, z)) return c;
  return null;
}
// Tỉ lệ diện tích đa giác `pts` nằm trong vùng giữ chỗ (lấy mẫu lưới ~1 m, tối đa 400 mẫu)
export function claimOverlapFrac(pts, kinds = null) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  // lọc nhanh: phải có claim (đúng kind) mà BBOX giao bbox đa giác — không thì khỏi lấy mẫu (kết quả y hệt, chỉ nhanh hơn;
  // quan trọng khi WP3 thêm ~1.200 claim 'cell' rải khắp phố)
  let any = false;
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL) && !any; i++)
    for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL) && !any; j++) {
      const a = grid.get(key(i, j)); if (!a) continue;
      for (const c of a) if ((!kinds || kinds.includes(c.kind)) && c.bb[0] <= x1 && c.bb[2] >= x0 && c.bb[1] <= z1 && c.bb[3] >= z0) { any = true; break; }
    }
  if (!any) return 0;
  const step = Math.max(1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 400));
  let n = 0, hit = 0;
  const poly = { type: 'poly', pts, bb: [x0, z0, x1, z1] };
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    if (!inside(poly, x, z)) continue; n++; if (claimAt(x, z, kinds)) hit++;
  }
  return n ? hit / n : 0;
}
export function claimsAll() { return list; }
export function claimStats() { const by = {}; for (const c of list) by[c.kind] = (by[c.kind] || 0) + 1; return { total: list.length, by }; }
