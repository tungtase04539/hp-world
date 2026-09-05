import * as THREE from 'three';
import { LITE } from './device.js';

// ============ CULLING TỪNG INSTANCE (kỹ thuật của InstancedMesh2 / agargaro) ============
// THREE.InstancedMesh vẽ TOÀN BỘ instance mỗi khung — kể cả cây ở sau lưng hoặc cách 1,5km.
// Đo được: hero_trees = 7,0 TRIỆU tam giác/khung (nhiều hơn cả phần còn lại của thành phố cộng lại).
//
// Cách làm: chụp lại ma trận gốc 1 lần, mỗi ~0.4s NÉN danh sách — chỉ ghi ma trận của instance
// trong tầm rồi hạ `mesh.count`. GPU chỉ vẽ đúng số đó. Không đụng hình học, không thêm draw call.
//
// CHỈ áp cho instance TĨNH (prop thế giới). Instance ĐỘNG (xe cộ, người đi) tự cập nhật ma trận
// mỗi khung nên bỏ qua — nén sẽ ghi đè chuyển động của chúng.

const tracked = [];
const known = new WeakSet();   // quét lại nhiều lần (GLB cây/model nạp async) mà không đăng ký trùng

export function registerInstancedForCull(mesh, radius) {
  const n = mesh.count;
  if (!n || !mesh.instanceMatrix || known.has(mesh)) return;
  known.add(mesh);
  const src = new Float32Array(mesh.instanceMatrix.array);   // bản gốc bất biến
  const px = new Float32Array(n), pz = new Float32Array(n);
  for (let i = 0; i < n; i++) { px[i] = src[i * 16 + 12]; pz[i] = src[i * 16 + 14]; }
  // instanceColor PHẢI nén CÙNG THỨ TỰ với ma trận, nếu không xe/prop sẽ nhận màu của cái khác
  // (nhiều cụm ở đây dùng setColorAt: xe máy, xe đạp, xe đẩy, dù...).
  const csrc = mesh.instanceColor ? new Float32Array(mesh.instanceColor.array) : null;
  const citems = mesh.instanceColor ? mesh.instanceColor.itemSize : 0;
  // GIỮ frustumCulled: sau mỗi lần nén tính lại boundingSphere theo đúng instance đang vẽ (xem updateInstanceCull).
  // Trước đây tắt hẳn → ô cây hero 250 m (85-101k tri/cây, world.js loadHeroTrees đã chia ô + tính sphere) vẽ cả khi
  // ở SAU LƯNG camera. idx[k] = chỉ số gốc của instance ở khe k — phát hiện đổi TẬP hợp kể cả khi số lượng không đổi.
  tracked.push({ mesh, src, csrc, citems, px, pz, n, r2: radius * radius, last: -1, idx: new Int32Array(n), hidden: false });
}

// Tự tìm mọi InstancedMesh TĨNH trong scene (khỏi phải sửa 21 chỗ tạo instance).
export function autoRegisterInstances(scene) {
  scene.traverse((o) => {
    if (!o.isInstancedMesh || known.has(o)) return;
    if (o.userData.dyn || o.userData.noCull) return;
    let p = o.parent; while (p) { if (p.userData && p.userData.dyn) return; p = p.parent; }
    // Cây GLB rất nặng (~14k tri/cây) → tầm ngắn hơn prop hộp đơn giản.
    const heavy = /tree|hero/i.test(o.name || '');
    const R = LITE ? (heavy ? 150 : 300) : (heavy ? 520 : 700);   // đo: cây trong 230m vẫn 1.29M tri
    registerInstancedForCull(o, R);
  });
  return tracked.length;
}

let _t = 0;
export function updateInstanceCull(camX, camZ) {
  // nhịp theo ĐỒNG HỒ THẬT (dt game bị clamp → máy yếu càng tick chậm, đúng chỗ cần cull nhất)
  const now = performance.now();
  if (now - _t < 400) return;
  _t = now;
  for (const t of tracked) {
    const { mesh, src, csrc, citems, px, pz, n, r2, idx } = t;
    const dst = mesh.instanceMatrix.array;
    const cdst = csrc ? mesh.instanceColor.array : null;
    let k = 0, changed = false;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - camX, dz = pz[i] - camZ;
      if (dx * dx + dz * dz > r2) continue;
      if (k !== i) {
        dst.set(src.subarray(i * 16, i * 16 + 16), k * 16);
        if (cdst) cdst.set(csrc.subarray(i * citems, i * citems + citems), k * citems);
      }
      // tập hợp đổi (1 vào 1 ra cùng nhịp) mà chỉ so SỐ LƯỢNG thì GPU giữ ma trận cũ tới lần đổi count kế tiếp
      if (idx[k] !== i) { idx[k] = i; changed = true; }
      k++;
    }
    if (changed || k !== t.last) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      if (cdst) mesh.instanceColor.needsUpdate = true;
      t.last = k;
      // sphere bao đúng k instance đầu (r160 InstancedMesh.computeBoundingSphere duyệt tới count) → frustum
      // culling thật; cụm rỗng ẩn hẳn (đỡ projectObject) và chỉ hiện lại khi chính ta đã ẩn nó.
      if (k > 0) {
        mesh.computeBoundingSphere();
        if (t.hidden) { t.hidden = false; mesh.visible = true; }
      } else if (!t.hidden) { t.hidden = true; mesh.visible = false; }
    }
  }
}

export function instanceCullStats() {
  let total = 0, shown = 0;
  for (const t of tracked) { total += t.n; shown += t.mesh.count; }
  return { groups: tracked.length, total, shown };
}
