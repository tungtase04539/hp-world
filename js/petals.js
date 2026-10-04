import * as THREE from 'three';

// Cánh phượng đỏ 3D rơi trong gió DƯỚI TÁN CÂY PHƯỢNG ĐANG NỞ gần người chơi (instanced để nhẹ).
// Đợt 3 WP4: trước đây đám cánh hoa bám người chơi nhưng chỉ bật quanh một điểm cố định tính từ thời bản đồ 1:10
// (giữa hồ Tam Bạc và Nhà hát) → lúc spawn không có, ở dưới gốc phượng thật cũng không. Nay: main.js truyền
// `bloomNear(x,z,r)` (js/trees.js — cây phượng nở gần nhất, theo uniform mùa hoa) → tâm = gốc cây đó, cánh rơi
// trong bán kính tán, cường độ giảm dần khi người chơi ra xa cây (18 → 45 m).
const COUNT = 170;
const RANGE = 6.5, TOP = 9;

export function createPetals(scene) {
  // cánh hoa thật ~5-7 cm; 18×11 cm để còn thấy được trong khung hình (trước 40×24 cm — như tờ giấy A4 bay)
  const geo = new THREE.PlaneGeometry(0.18, 0.11);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xff5238, side: THREE.DoubleSide, transparent: true, opacity: 0,
    emissive: 0xaa2210, emissiveIntensity: 0.55,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // 3 bộ đệm ma trận XOAY VÒNG (Đợt 3 WP8, đo trên 890M/ANGLE d3d11): ghi đè mỗi khung vào bộ đệm GPU khung trước còn
  // đang đọc bắt CPU chờ GPU (đồng bộ) → mất vài fps ở khu trung tâm. Ghi bản của khung N−2 thì không phải chờ.
  const sets = [mesh.instanceMatrix, mesh.instanceMatrix.clone(), mesh.instanceMatrix.clone()];
  for (const s of sets) s.setUsage(THREE.DynamicDrawUsage);
  let setK = 0;
  mesh.frustumCulled = false;
  // instcull KHÔNG được quản: nó chụp ma trận lúc đăng ký rồi ghi đè mỗi 0,4 s (+ đặt lại count) → cánh hoa đứng
  // im giữa không trung và tool chụp ảnh không ẩn được (BUG cũ, lộ ra khi cánh hoa có mặt ở chỗ người chơi)
  mesh.userData.noCull = true;
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  // vị trí cánh hoa TƯƠNG ĐỐI tâm cây (tất định — không Math.random để ảnh A/B so được)
  let seed = 7919;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const parts = [];
  for (let i = 0; i < COUNT; i++) {
    parts.push({
      x: (rnd() - 0.5) * RANGE * 2, y: rnd() * TOP, z: (rnd() - 0.5) * RANGE * 2,
      fall: 0.7 + rnd() * 0.9, phase: rnd() * Math.PI * 2, sway: 0.6 + rnd() * 1.1, spin: 2 + rnd() * 3,
      gy: 2,   // cao độ đất cache — cập nhật so le (groundHeight từng bị gọi 200 lần/khung)
    });
  }
  let frameNo = 0, cx = 0, cz = 0, cy = 2, topY = TOP, targetS = 0, findT = -1e9;

  return {
    // strength 0..1 (giảm khi người dùng bật "giảm chuyển động"); bloomNear: (x,z,r) → {x,z,d,h,y} | null
    update(dt, time, playerPos, strength, groundHeight, bloomNear) {
      const now = performance.now();
      if (now - findT > 500) {            // tìm lại cây nở gần nhất 2 lần/giây (đồng hồ thật)
        findT = now;
        const b = bloomNear ? bloomNear(playerPos.x, playerPos.z, 45) : null;
        if (b) {
          if (Math.hypot(b.x - cx, b.z - cz) > 1) {   // đổi cây → rải lại cánh trên tán mới
            cx = b.x; cz = b.z; cy = b.y ?? groundHeight(cx, cz); topY = Math.max(5, Math.min(13, b.h * 0.85));
            for (const p of parts) { p.y = topY * (0.3 + rnd() * 0.7); p.gy = groundHeight(cx + p.x, cz + p.z); }
          }
          targetS = (1 - Math.min(1, Math.max(0, (b.d - 18) / 27))) * strength;
        } else targetS = 0;
      }
      const target = targetS > 0.02 ? 0.95 * targetS : 0;
      mat.opacity += (target - mat.opacity) * Math.min(1, dt * 1.5);
      if (mat.opacity < 0.02) { mesh.visible = false; return; }
      mesh.visible = true;
      frameNo++;
      setK = (setK + 1) % sets.length; mesh.instanceMatrix = sets[setK];   // setMatrixAt ghi vào bản này
      for (let i = 0; i < COUNT; i++) {
        const p = parts[i];
        p.y -= p.fall * dt;
        p.x += Math.sin(time * p.sway + p.phase) * dt * 1.2 + dt * 0.5;
        p.z += Math.cos(time * p.sway * 0.8 + p.phase) * dt * 0.9;
        if ((i + frameNo) % 20 === 0) p.gy = groundHeight(cx + p.x, cz + p.z);
        if (cy + p.y < Math.max(p.gy, 0) + 0.15) {
          p.x = (rnd() - 0.5) * RANGE * 2; p.z = (rnd() - 0.5) * RANGE * 2;
          p.y = topY * (0.75 + rnd() * 0.25);
          p.gy = groundHeight(cx + p.x, cz + p.z);
        }
        if (Math.abs(p.x) > RANGE * 1.6) p.x = -Math.sign(p.x) * RANGE * 0.9;
        if (Math.abs(p.z) > RANGE * 1.6) p.z = -Math.sign(p.z) * RANGE * 0.9;
        dummy.position.set(cx + p.x, cy + p.y, cz + p.z);
        dummy.rotation.set(time * p.spin + p.phase, p.phase + time * 0.8, Math.sin(time * p.sway + p.phase) * 0.8);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
