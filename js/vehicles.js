import * as THREE from 'three';
import { WORLD_BOUNDS } from './terrain.js';

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

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
  const g = new THREE.Group();
  const red = mat(0xd8332a);
  // thân xe cong kiểu xe tay ga
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.9, 4, 10), red);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.8);
  body.position.set(0, 0.72, -0.1);
  g.add(body);
  const front = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 4, 8), red);
  front.rotation.x = 0.6;
  front.position.set(0, 0.95, 0.62);
  g.add(front);
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), mat(0x2a2a2e));
  seat.rotation.x = Math.PI / 2;
  seat.scale.set(1.15, 1, 0.55);
  seat.position.set(0, 1, -0.3);
  g.add(seat);
  const wF = wheel(0.34, 0.16);
  wF.position.set(0, 0.34, 0.85); g.add(wF);
  const wB = wheel(0.34, 0.16);
  wB.position.set(0, 0.34, -0.8); g.add(wB);
  // tay lái cong + gương
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 8), mat(0x8a8f96));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.22, 0.58);
  g.add(bar);
  for (const sx of [-0.3, 0.3]) {
    const mirror = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), mat(0xcfd8e0));
    mirror.position.set(sx, 1.34, 0.56);
    g.add(mirror);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8),
    mat(0xfff2b0, { emissive: 0xffee99, emissiveIntensity: 0.3 }));
  lamp.scale.set(1, 0.85, 0.7);
  lamp.position.set(0, 1.02, 0.86);
  g.add(lamp);
  g.add(blobShadow(1));
  return { mesh: g, seatY: 1.12, seatZ: -0.28 };
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
  motorbike: { maker: makeMotorbike, speed: 50, turn: 2.2, nameKey: 'vMotorbike', land: true },
  cyclo: { maker: makeCyclo, speed: 19, turn: 2.2, nameKey: 'vCyclo', land: true },
  boat: { maker: makeBoat, speed: 46, turn: 1.5, nameKey: 'vBoat', land: false },
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
        const before = { x: v.pos.x, z: v.pos.z };
        resolveCollisions(v.pos, v.land ? 0.8 : 1.6);
        if (Math.hypot(v.pos.x - before.x, v.pos.z - before.z) > 0.01) v.vel *= 0.4;
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

  return { vehicles, update };
}
