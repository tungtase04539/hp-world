import * as THREE from 'three';

// Cánh phượng đỏ 3D bay trong gió quanh dải trung tâm (instanced để nhẹ)
const COUNT = 200;
const RANGE = 42, HEIGHT = 20;

export function createPetals(scene) {
  const geo = new THREE.PlaneGeometry(0.4, 0.24);
  const mat = new THREE.MeshLambertMaterial({
    color: 0xff5238, side: THREE.DoubleSide, transparent: true, opacity: 0,
    emissive: 0xaa2210, emissiveIntensity: 0.55,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const parts = [];
  for (let i = 0; i < COUNT; i++) {
    parts.push({
      x: (Math.random() - 0.5) * RANGE * 2,
      y: Math.random() * HEIGHT,
      z: (Math.random() - 0.5) * RANGE * 2,
      fall: 1.1 + Math.random() * 1.3,
      phase: Math.random() * Math.PI * 2,
      sway: 0.6 + Math.random() * 1.1,
      spin: 2 + Math.random() * 3,
    });
  }

  return {
    // strength 0..1: chỉ rơi dày ở khu trung tâm
    update(dt, time, playerPos, strength, groundHeight) {
      const target = strength > 0.02 ? 0.95 * strength : 0;
      mat.opacity += (target - mat.opacity) * Math.min(1, dt * 1.5);
      if (mat.opacity < 0.02) { mesh.visible = false; return; }
      mesh.visible = true;
      const cx = playerPos.x, cz = playerPos.z;
      for (let i = 0; i < COUNT; i++) {
        const p = parts[i];
        p.y -= p.fall * dt;
        p.x += Math.sin(time * p.sway + p.phase) * dt * 1.6 + dt * 0.7;
        p.z += Math.cos(time * p.sway * 0.8 + p.phase) * dt * 1.2;
        const gy = groundHeight(cx + p.x, cz + p.z);
        if (p.y < Math.max(gy, 0) + 0.15) {
          p.x = (Math.random() - 0.5) * RANGE * 2;
          p.z = (Math.random() - 0.5) * RANGE * 2;
          p.y = HEIGHT * (0.7 + Math.random() * 0.3);
        }
        if (Math.abs(p.x) > RANGE) p.x = -Math.sign(p.x) * RANGE * 0.95;
        if (Math.abs(p.z) > RANGE) p.z = -Math.sign(p.z) * RANGE * 0.95;
        dummy.position.set(cx + p.x, p.y, cz + p.z);
        dummy.rotation.set(
          time * p.spin + p.phase,
          p.phase + time * 0.8,
          Math.sin(time * p.sway + p.phase) * 0.8
        );
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
