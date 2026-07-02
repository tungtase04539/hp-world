import * as THREE from 'three';
import { makeHumanoid } from './character.js';

function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }

// ============================================================
// Thành phố sống: người đi bộ trên vỉa hè, xe máy chạy phố,
// thuyền du lịch trong vịnh Lan Hạ
// ============================================================

// Vòng lặp đường phố cho xe máy (đi bên phải, lệch làn +2.2)
const BIKE_LOOPS = [
  [[-180, 8], [-20, 8], [-20, 66], [-180, 66]],
  [[-100, -60], [60, -60], [60, 8], [-100, 8]],
  [[-180, -60], [-20, -60], [-20, 8], [-180, 8]],
  [[-100, 8], [60, 8], [60, 66], [-100, 66]],
];
// Tuyến dài: trung tâm ↔ Đồ Sơn (khứ hồi trên quốc lộ)
const HIGHWAY_PATH = [[30, 120], [120, 480], [180, 950], [240, 1480], [300, 1760], [330, 1930]];

// Lối đi bộ (đi qua đi lại trên vỉa hè & dải trung tâm)
const WALK_PATHS = [
  [[-240, 16], [-40, 16]],           // dạo dải trung tâm
  [[-160, 58], [-40, 58]],           // vỉa hè Trần Phú
  [[-16, 30], [30, 30]],             // quảng trường nhà hát
  [[-90, -52], [40, -52]],           // Điện Biên Phủ
  [[-208, -28], [-168, -12]],        // trước chợ Sắt
  [[352, 1802], [388, 1878]],        // bãi biển Đồ Sơn
  [[2390, 1128], [2500, 1136]],      // phố biển Cát Bà
];

const SHIRT_COLORS = [0xe86a4a, 0x4a90d8, 0x8fc16a, 0xd8a03a, 0xb87ad8, 0x5abcb0, 0xe8d05a];
const PANT_COLORS = [0x33475e, 0x5e4a38, 0x2f5548, 0x4a3a5e];

function pathLength(pts, closed) {
  let L = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return L;
}

// Lấy vị trí + hướng tại quãng đường s dọc polyline
function samplePath(pts, s, closed) {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= len) {
      const t = s / len;
      return {
        x: a[0] + (b[0] - a[0]) * t,
        z: a[1] + (b[1] - a[1]) * t,
        heading: Math.atan2(b[0] - a[0], b[1] - a[1]),
      };
    }
    s -= len;
  }
  const last = closed ? pts[0] : pts[pts.length - 1];
  return { x: last[0], z: last[1], heading: 0 };
}

function makeTrafficBike(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 1.7), mat(color));
  body.position.y = 0.75; g.add(body);
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.14, 8);
  for (const wz of [0.8, -0.75]) {
    const w = new THREE.Mesh(wheelGeo, mat(0x24262a));
    w.rotation.x = Math.PI / 2; w.rotation.z = Math.PI / 2;
    w.position.set(0, 0.32, wz);
    g.add(w);
  }
  // người lái đơn giản
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.3),
    mat(SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]));
  torso.position.set(0, 1.35, -0.15); g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mat(0xf0c090));
  head.position.set(0, 1.85, -0.15); g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
    mat([0xd84040, 0x3a6ab8, 0xe8e8e0, 0x333333][Math.floor(Math.random() * 4)]));
  helmet.position.set(0, 1.87, -0.15); g.add(helmet);
  return g;
}

export function createTraffic(scene, world) {
  const { groundHeight } = world;
  const bikes = [];
  const walkers = [];
  const tourBoats = [];

  // ---------- Xe máy chạy vòng phố ----------
  const bikeColors = [0xd8332a, 0x2e86c1, 0x28a05c, 0xe8a020, 0x555a66, 0xb85ae8];
  BIKE_LOOPS.forEach((loop, li) => {
    const L = pathLength(loop, true);
    for (let k = 0; k < 2; k++) {
      const mesh = makeTrafficBike(bikeColors[(li * 2 + k) % bikeColors.length]);
      scene.add(mesh);
      bikes.push({
        mesh, path: loop, closed: true, L,
        s: (L / 2) * k + li * 13,
        speed: 13 + (li + k) * 1.6,
        lane: 2.2,
      });
    }
  });
  // hai xe chạy quốc lộ ra Đồ Sơn và ngược lại (ping-pong)
  {
    const L = pathLength(HIGHWAY_PATH, false);
    for (let k = 0; k < 2; k++) {
      const mesh = makeTrafficBike(bikeColors[(k + 3) % bikeColors.length]);
      scene.add(mesh);
      bikes.push({
        mesh, path: HIGHWAY_PATH, closed: false, L,
        s: L * (0.2 + 0.5 * k), speed: 26, lane: 3, dir: k === 0 ? 1 : -1,
      });
    }
  }

  // ---------- Người đi bộ ----------
  WALK_PATHS.forEach((p, i) => {
    const n = i < 5 ? 2 : 1; // trung tâm đông hơn
    const L = pathLength(p, false);
    for (let k = 0; k < n; k++) {
      const rig = makeHumanoid({
        shirt: SHIRT_COLORS[(i * 2 + k) % SHIRT_COLORS.length],
        shorts: PANT_COLORS[(i + k) % PANT_COLORS.length],
        skin: [0xf0c090, 0xe0ac7c, 0xd8a070][(i + k) % 3],
        hat: (i + k) % 3 === 0 ? 'nonla' : null,
        backpack: 0,
      });
      scene.add(rig.group);
      walkers.push({
        rig, path: p, L,
        s: (L / (n + 1)) * (k + 1),
        speed: 1.7 + ((i * 3 + k) % 4) * 0.25,
        dir: k % 2 === 0 ? 1 : -1,
      });
    }
  });

  // ---------- Thuyền du lịch vịnh Lan Hạ ----------
  function tourBoat(cx, cz, r, speed, phase) {
    const g = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.2, 8, 7, 1), mat(0xc9a86a));
    hull.rotation.x = Math.PI / 2; hull.scale.y = 0.45; hull.position.y = 0.5;
    g.add(hull);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 3.4), mat(0xf0ead8));
    cabin.position.y = 1.5; g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.14, 4), mat(0x8a4030));
    roof.position.y = 2.3; g.add(roof);
    scene.add(g);
    tourBoats.push({ mesh: g, cx, cz, r, speed, phase });
  }
  tourBoat(2700, 1270, 90, 0.045, 0);
  tourBoat(2820, 1180, 70, -0.06, 2);
  tourBoat(1600, 560, 130, 0.035, 4); // thuyền trên đường ra đảo

  // ---------- Cập nhật mỗi khung hình ----------
  function update(dt, time, playerPos) {
    for (const b of bikes) {
      // né người chơi: chậm lại khi tới gần
      const d = Math.hypot(playerPos.x - b.mesh.position.x, playerPos.z - b.mesh.position.z);
      const slow = d < 6 ? Math.max(0.15, (d - 2) / 4) : 1;
      if (b.closed) {
        b.s = (b.s + b.speed * slow * dt) % b.L;
      } else {
        b.s += b.speed * slow * dt * b.dir;
        if (b.s > b.L) { b.s = b.L; b.dir = -1; }
        if (b.s < 0) { b.s = 0; b.dir = 1; }
      }
      const p = samplePath(b.path, b.s, b.closed);
      const head = b.dir === -1 ? p.heading + Math.PI : p.heading;
      // lệch làn bên phải theo hướng đi
      const ox = Math.cos(head) * b.lane, oz = -Math.sin(head) * b.lane;
      const x = p.x + ox, z = p.z + oz;
      b.mesh.position.set(x, groundHeight(x, z), z);
      b.mesh.rotation.y = head;
    }

    for (const w of walkers) {
      w.s += w.speed * dt * w.dir;
      if (w.s > w.L) { w.s = w.L; w.dir = -1; }
      if (w.s < 0) { w.s = 0; w.dir = 1; }
      const p = samplePath(w.path, w.s, false);
      const head = w.dir === -1 ? p.heading + Math.PI : p.heading;
      w.rig.group.position.set(p.x, groundHeight(p.x, p.z), p.z);
      w.rig.group.rotation.y = head;
      w.rig.animate(dt, 0.55, time + w.s);
    }

    for (const tb of tourBoats) {
      const a = time * tb.speed + tb.phase;
      tb.mesh.position.set(
        tb.cx + Math.cos(a) * tb.r,
        Math.sin(time * 0.9 + tb.phase) * 0.12,
        tb.cz + Math.sin(a) * tb.r
      );
      tb.mesh.rotation.y = -a + (tb.speed > 0 ? Math.PI / 2 : -Math.PI / 2);
      tb.mesh.rotation.z = Math.sin(time * 1.1 + tb.phase) * 0.03;
    }
  }

  return { update };
}
