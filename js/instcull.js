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
  mesh.frustumCulled = false;         // bounding sphere của cả cụm vô nghĩa sau khi nén
  tracked.push({ mesh, src, px, pz, n, r2: radius * radius, last: -1 });
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
    const { mesh, src, px, pz, n, r2 } = t;
    const dst = mesh.instanceMatrix.array;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const dx = px[i] - camX, dz = pz[i] - camZ;
      if (dx * dx + dz * dz > r2) continue;
      if (k !== i) dst.set(src.subarray(i * 16, i * 16 + 16), k * 16);
      k++;
    }
    if (k !== t.last) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      t.last = k;
    }
  }
}

export function instanceCullStats() {
  let total = 0, shown = 0;
  for (const t of tracked) { total += t.n; shown += t.mesh.count; }
  return { groups: tracked.length, total, shown };
}
