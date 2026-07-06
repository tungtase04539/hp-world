import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { WORLD_BOUNDS } from './terrain.js';

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

// ---- Xe máy Meshy (ảnh thật Honda Cub) — nạp 1 lần rồi CLONE cho mỗi xe ----
// GLB nén meshopt: KHÔNG đụng geometry (applyMatrix4 làm hỏng). Chỉ transform Object3D/Group.
const ASSET_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'assets/' : 'https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/assets/';
let motoTemplate = null;           // Group đã chuẩn-hoá (tâm XZ, đáy y=0, dài theo +Z, tỉ lệ thật)
const motoPending = [];            // các outer group chờ template tải xong
function normalizeMoto(gltf) {
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  const lenX = Math.max(1e-3, box.max.x - box.min.x);   // trục dài mô hình (đầu xe ở −X)
  const s = 1.98 / lenX;             // Honda Cub thật ~1.95–2.0 m
  model.position.set(-cx, -box.min.y, -cz);   // tâm XZ, bánh chạm y=0
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.rotation.y = Math.PI / 2;    // đầu xe (−X) → +Z (hướng tiến trong game)
  pivot.scale.setScalar(s);
  pivot.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return pivot;
}
function attachMoto(outer) {
  outer.add(motoTemplate.clone(true));
}
function makeMotoFallback() {   // dự phòng khi GLB lỗi mạng — khối tối giản, KHÔNG để xe tàng hình
  const p = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 8), mat(0xd8332a));
  body.rotation.x = Math.PI / 2; body.position.set(0, 0.7, 0); p.add(body);
  for (const z of [0.75, -0.75]) { const w = wheel(0.32, 0.14); w.position.set(0, 0.32, z); p.add(w); }
  return p;
}
(function loadMoto() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.load(ASSET_BASE + 'moto.glb', (gltf) => {
    motoTemplate = normalizeMoto(gltf);
    for (const outer of motoPending) attachMoto(outer);
    motoPending.length = 0;
  }, undefined, (err) => {
    console.error('moto.glb', err);
    motoTemplate = makeMotoFallback();          // clone-able group
    for (const outer of motoPending) outer.add(motoTemplate.clone(true));
    motoPending.length = 0;
  });
})();

function wheel(r, w) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, r * 0.24, 8, 14), mat(0x24262a));
  g.add(tire);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.6, 10), mat(0x8a8f96));
  hub.rotation.x = Math.PI / 2;
  g.add(hub);
  return g;
}

function blobShadow(r) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  return m;
}

function makeMotorbike() {
  // Mô hình Meshy ảnh-thật (Honda Cub đỏ). Xe chạy = di chuyển GROUP ngoài, không đụng geometry.
  const g = new THREE.Group();
  g.add(blobShadow(0.95));
  if (motoTemplate) attachMoto(g);
  else motoPending.push(g);       // template chưa tải xong → gắn sau
  // yên xe thật ~0.72 m; công thức đặt nhân vật (main.js): hip_world = pos.y + seatY + 0.09
  return { mesh: g, seatY: 0.64, seatZ: -0.05 };
}

function makeCyclo() {
  const g = new THREE.Group();
  const bench = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), mat(0x2e7fc1));
  bench.position.set(0, 0.85, 0.55); g.add(bench);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.14), mat(0x2e7fc1));
  back.position.set(0, 1.35, 0.25); g.add(back);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 1), mat(0xe8b020));
  canopy.position.set(0, 1.95, 0.5); g.add(canopy);
  for (const sx of [-0.55, 0.55]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.9, 5), mat(0x8a8a90));
    post.position.set(sx, 1.5, 0.85); g.add(post);
    const wF = wheel(0.38, 0.1); wF.rotation.x = Math.PI / 2;
    wF.position.set(sx, 0.38, 0.75); g.add(wF);
  }
  const wB = wheel(0.38, 0.1); wB.rotation.x = Math.PI / 2;
  wB.position.set(0, 0.38, -0.75); g.add(wB);
  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.36), mat(0x2a2a2e));
  saddle.position.set(0, 1.05, -0.65); g.add(saddle);
  g.add(blobShadow(1.1));
  return { mesh: g, seatY: 1.15, seatZ: -0.6 };
}

function makeBoat() {
  const g = new THREE.Group();
  // vỏ thuyền cong dạng elipxoit + mũi vát
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat(0x2e6fa1));
  hull.scale.set(1.25, 0.62, 3.4);
  hull.position.y = 0.42;
  g.add(hull);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.09, 8, 20), mat(0xc9a86a));
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.22, 3.32, 1);
  rim.position.y = 0.88;
  g.add(rim);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.1, 16), mat(0xc9a86a));
  deck.scale.set(1.12, 1, 3.1);
  deck.position.y = 0.86;
  g.add(deck);
  const cabin = new THREE.Mesh(new THREE.CapsuleGeometry(0.72, 0.7, 4, 10), mat(0xf0ead8));
  cabin.rotation.x = Math.PI / 2;
  cabin.scale.set(1.1, 1, 1.35);
  cabin.position.set(0, 1.55, -1.2);
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.1, 14), mat(0xd8332a));
  roof.scale.set(1, 1, 1.1);
  roof.position.set(0, 2.28, -1.2);
  g.add(roof);
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4, 5), mat(0x8a8a90));
  flagPole.position.set(0, 3, -1.2); g.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
  flag.position.set(0.46, 3.4, -1.2);
  g.add(flag);
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.14, 5), new THREE.MeshBasicMaterial({ color: 0xffe14d, side: THREE.DoubleSide }));
  star.position.set(0.46, 3.4, -1.19);
  g.add(star);
  return { mesh: g, seatY: 1.05, seatZ: 0.4, flag };
}

// type: 'motorbike' | 'cyclo' | 'boat'
// groundHeight: có mặt cầu (xe chạy qua cầu được); waterHeight: KHÔNG có mặt cầu (thuyền chui qua gầm cầu)
// spawns: [{type, x, z, heading}] — do world.js tính từ dữ liệu bản đồ thật (bến, bờ sông...)
const TEMPLATES = {
  motorbike: { maker: makeMotorbike, speed: 23, turn: 2.2, nameKey: 'vMotorbike', land: true },   // ~83 km/h
  cyclo: { maker: makeCyclo, speed: 8, turn: 2.2, nameKey: 'vCyclo', land: true },
  boat: { maker: makeBoat, speed: 19, turn: 1.5, nameKey: 'vBoat', land: false },   // ~37 hải lý
};
export function createVehicles(scene, groundHeight, waterHeight, spawns, resolveCollisions) {
  const defs = spawns.map((s) => ({ ...TEMPLATES[s.type], type: s.type, x: s.x, z: s.z, heading: s.heading || 0 }));
  const vehicles = defs.map((d) => {
    const built = d.maker();
    built.mesh.position.set(d.x, d.land ? groundHeight(d.x, d.z) : 0.1, d.z);
    built.mesh.rotation.y = d.heading;
    scene.add(built.mesh);
    return {
      ...d, ...built,
      pos: new THREE.Vector3(d.x, built.mesh.position.y, d.z),
      vel: 0, mounted: false,
    };
  });

  function update(v, dt, fwdInput, turnInput, time) {
    // tăng/giảm tốc
    const target = fwdInput * v.speed * (fwdInput < 0 ? 0.45 : 1);
    v.vel += (target - v.vel) * Math.min(1, dt * 2.4);
    if (Math.abs(v.vel) > 0.3) {
      v.heading -= turnInput * v.turn * dt * Math.sign(v.vel);
    }
    const nx = v.pos.x + Math.sin(v.heading) * v.vel * dt;
    const nz = v.pos.z + Math.cos(v.heading) * v.vel * dt;
    let blocked = false;
    if (v.land) {
      if (groundHeight(nx, nz) < 0.3) blocked = true;   // xe không xuống nước
    } else {
      if (waterHeight(nx, nz) > -0.6) blocked = true;   // thuyền cần nước đủ sâu (bỏ qua mặt cầu)
    }
    // giới hạn mép bản đồ
    if (nx < WORLD_BOUNDS.minX + 40 || nx > WORLD_BOUNDS.maxX - 40
      || nz < WORLD_BOUNDS.minZ + 40 || nz > WORLD_BOUNDS.maxZ - 40) blocked = true;
    if (!blocked) {
      v.pos.x = nx; v.pos.z = nz;
      // không xuyên nhà cửa / đảo đá
      if (resolveCollisions) {
        const bx = v.pos.x, bz = v.pos.z;
        resolveCollisions(v.pos, v.land ? 0.8 : 1.6);
        if (Math.hypot(v.pos.x - bx, v.pos.z - bz) > 0.01) v.vel *= 0.4;
      }
    } else {
      v.vel = 0;
    }
    if (v.land) {
      v.pos.y = groundHeight(v.pos.x, v.pos.z);
      v.mesh.rotation.set(0, v.heading, 0);
    } else {
      v.pos.y = Math.sin(time * 1.3) * 0.1;
      v.mesh.rotation.set(Math.sin(time * 1.1) * 0.03, v.heading, Math.sin(time * 0.9) * 0.04);
      if (v.flag) v.flag.rotation.y = Math.sin(time * 5) * 0.3;
    }
    v.mesh.position.copy(v.pos);
  }

  // Gọi/sinh thêm một phương tiện tại chỗ (nút "gọi xe máy")
  function spawn(type, x, z, heading = 0) {
    const t = TEMPLATES[type];
    if (!t) return null;
    const built = t.maker();
    const y = t.land ? groundHeight(x, z) : 0.1;
    built.mesh.position.set(x, y, z);
    built.mesh.rotation.y = heading;
    scene.add(built.mesh);
    const v = {
      ...t, type, x, z, heading, ...built,
      pos: new THREE.Vector3(x, y, z), vel: 0, mounted: false,
    };
    vehicles.push(v);
    return v;
  }

  return { vehicles, update, spawn };
}
