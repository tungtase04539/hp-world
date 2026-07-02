import * as THREE from 'three';

function mat(color) { return new THREE.MeshLambertMaterial({ color }); }

function wheel(r, w) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), mat(0x222428));
  m.rotation.z = Math.PI / 2;
  return m;
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
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.7), mat(0xd8332a));
  body.position.y = 0.75; g.add(body);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.14, 0.8), mat(0x2a2a2e));
  seat.position.set(0, 1, -0.25); g.add(seat);
  const wF = wheel(0.34, 0.16); wF.rotation.z = 0; wF.rotation.x = Math.PI / 2;
  wF.position.set(0, 0.34, 0.85); g.add(wF);
  const wB = wF.clone(); wB.position.z = -0.8; g.add(wB);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.08), mat(0x8a8a90));
  bar.position.set(0, 1.15, 0.6); g.add(bar);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 5), mat(0xfff2b0));
  lamp.position.set(0, 1, 0.9); g.add(lamp);
  g.add(blobShadow(1));
  return { mesh: g, seatY: 1.1, seatZ: -0.2 };
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
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1, 6.4, 7, 1), mat(0x2e6fa1));
  hull.rotation.x = Math.PI / 2;
  hull.scale.z = 0.45;
  hull.position.y = 0.5;
  g.add(hull);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 5.2), mat(0xc9a86a));
  deck.position.y = 0.95; g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.6), mat(0xf0ead8));
  cabin.position.set(0, 1.6, -1.2); g.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.9), mat(0xd8332a));
  roof.position.set(0, 2.25, -1.2); g.add(roof);
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
export function createVehicles(scene, groundHeight, waterHeight) {
  const defs = [
    { type: 'motorbike', x: 22, z: -14, heading: Math.PI / 2, maker: makeMotorbike, speed: 42, turn: 2.2, nameKey: 'vMotorbike', land: true },
    { type: 'cyclo', x: -36, z: 14, heading: Math.PI / 2, maker: makeCyclo, speed: 18, turn: 2.2, nameKey: 'vCyclo', land: true },
    { type: 'boat', x: 29, z: -160, heading: Math.PI / 2, maker: makeBoat, speed: 38, turn: 1.5, nameKey: 'vBoat', land: false },
    { type: 'boat', x: 440, z: 1884, heading: Math.PI / 2, maker: makeBoat, speed: 38, turn: 1.5, nameKey: 'vBoat', land: false },
  ];
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
    if (nx < -560 || nx > 3560 || nz < -660 || nz > 2560) blocked = true;
    if (!blocked) {
      v.pos.x = nx; v.pos.z = nz;
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
