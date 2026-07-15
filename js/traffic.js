import * as THREE from 'three';
import { makeHumanoid } from './character.js';
import { IS_MOBILE } from './assets.js';
import { ROADS_DT, ROADS_REGION } from './terrain.js';

function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }

// ============================================================
// Thành phố sống: người đi bộ + xe máy trên các PHỐ THẬT (từ OSM),
// thuyền du lịch trong vịnh Lan Hạ
// ============================================================

function plLen(pts) {
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) L += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  return L;
}
// Xe máy: 8 phố lớn dài nhất trong trung tâm (khứ hồi) + 2 trục vùng rộng
const BIKE_PATHS = ROADS_DT
  .filter((r) => (r.c === 's' || r.c === 't' || r.c === 'p'))
  .map((r) => r.pts)
  .sort((a, b) => plLen(b) - plLen(a))
  .slice(0, 8);
const REGION_PATHS = ROADS_REGION
  .map((r) => r.pts)
  .sort((a, b) => plLen(b) - plLen(a))
  .slice(0, 3);

// Người đi bộ: các phố gần trung tâm + bãi biển/thị trấn (điền sau từ world)
const WALK_PATHS = ROADS_DT
  .filter((r) => {
    const [x, z] = r.pts[0];
    return x * x + z * z < 300 * 300 && plLen(r.pts) > 90;
  })
  .map((r) => r.pts)
  .sort((a, b) => plLen(b) - plLen(a))
  .slice(0, 9);

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
    if (len < 1e-6) continue;   // segment suy biến (2 điểm trùng) → tránh 0/0 = NaN
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
  // thân xe cong
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.95, 4, 8), mat(color));
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1, 0.8);
  body.position.set(0, 0.7, 0);
  g.add(body);
  const front = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.45, 4, 8), mat(color));
  front.rotation.x = 0.6;
  front.position.set(0, 0.9, 0.6);
  g.add(front);
  const wheelTorus = new THREE.TorusGeometry(0.24, 0.08, 6, 12);
  for (const wz of [0.78, -0.72]) {
    const w = new THREE.Mesh(wheelTorus, mat(0x24262a));
    w.position.set(0, 0.32, wz);
    g.add(w);
  }
  // người lái bo tròn
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.35, 4, 10),
    mat(SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)]));
  torso.scale.set(1.1, 1, 0.75);
  torso.rotation.x = 0.15;
  torso.position.set(0, 1.32, -0.2);
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(0xf0c090));
  head.position.set(0, 1.75, -0.16);
  g.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.175, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    mat([0xd84040, 0x3a6ab8, 0xe8e8e0, 0x333333][Math.floor(Math.random() * 4)]));
  helmet.position.set(0, 1.77, -0.16);
  g.add(helmet);
  return g;
}

export function createTraffic(scene, world) {
  const { groundHeight } = world;
  const bikes = [];
  const walkers = [];
  const tourBoats = [];

  // ---------- Xe máy chạy trên các phố THẬT (khứ hồi) ----------
  const bikeColors = [0xd8332a, 0x2e86c1, 0x28a05c, 0xe8a020, 0x555a66, 0xb85ae8];
  BIKE_PATHS.forEach((path, li) => {
    const L = pathLength(path, false);
    for (let k = 0; k < (IS_MOBILE ? 1 : 2); k++) {   // mobile: nửa lưu lượng xe
      const mesh = makeTrafficBike(bikeColors[(li * 2 + k) % bikeColors.length]);
      scene.add(mesh);
      bikes.push({
        mesh, path, closed: false, L,
        s: L * (0.25 + 0.5 * k),
        speed: 13 + ((li + k) % 4) * 1.8,
        dir: k % 2 === 0 ? 1 : -1,
        lane: 3.2,
      });
    }
  });
  // trục vùng rộng (ra Đồ Sơn, Đình Vũ...)
  REGION_PATHS.forEach((path, li) => {
    const L = pathLength(path, false);
    const mesh = makeTrafficBike(bikeColors[(li + 3) % bikeColors.length]);
    scene.add(mesh);
    bikes.push({
      mesh, path, closed: false, L,
      s: L * (0.2 + 0.3 * li), speed: 12, lane: 4, dir: li % 2 === 0 ? 1 : -1,
    });
  });

  // ---------- Người đi bộ ----------
  const allWalks = [...WALK_PATHS, ...(world.walkPaths || [])];
  allWalks.forEach((p, i) => {
    const n = IS_MOBILE ? 1 : (i < 5 ? 2 : 1); // trung tâm đông hơn; mobile giảm tải
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
  tourBoat(4780, 1900, 90, 0.045, 0);   // vịnh Lan Hạ
  tourBoat(4930, 1620, 70, -0.06, 2);   // giữa các đảo đá
  tourBoat(2700, 1400, 160, 0.035, 4);  // trên đường biển ra đảo

  // ---------- Cập nhật mỗi khung hình ----------
  let frameNo = 0;
  function update(dt, time, playerPos) {
    frameNo++;
    for (let bi = 0; bi < bikes.length; bi++) {
      const b = bikes[bi];
      // xa >700m: cập nhật 1/4 nhịp (dồn dt để tốc độ không đổi) — sương 4200 nhưng xe 2m gần như vô hình
      b.acc = (b.acc || 0) + dt;
      const ddx = playerPos.x - b.mesh.position.x, ddz = playerPos.z - b.mesh.position.z;
      if (ddx * ddx + ddz * ddz > 490000 && (frameNo + bi) % 4 !== 0) continue;
      const step = b.acc; b.acc = 0;
      // né người chơi: chậm lại khi tới gần
      const d = Math.hypot(ddx, ddz);
      const slow = d < 6 ? Math.max(0.15, (d - 2) / 4) : 1;
      if (b.closed) {
        b.s = (b.s + b.speed * slow * step) % b.L;
      } else {
        b.s += b.speed * slow * step * b.dir;
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

    for (let wi = 0; wi < walkers.length; wi++) {
      const w = walkers[wi];
      w.acc = (w.acc || 0) + dt;
      const ddx = playerPos.x - w.rig.group.position.x, ddz = playerPos.z - w.rig.group.position.z;
      if (ddx * ddx + ddz * ddz > 490000 && (frameNo + wi) % 4 !== 0) continue;   // xa: bỏ cả animate chân tay
      const step = w.acc; w.acc = 0;
      w.s += w.speed * step * w.dir;
      if (w.s > w.L) { w.s = w.L; w.dir = -1; }
      if (w.s < 0) { w.s = 0; w.dir = 1; }
      const p = samplePath(w.path, w.s, false);
      const head = w.dir === -1 ? p.heading + Math.PI : p.heading;
      // đi trên vỉa hè (lệch khỏi tim đường)
      const ox = Math.cos(p.heading) * 3.4, oz = -Math.sin(p.heading) * 3.4;
      const wx = p.x + ox, wz = p.z + oz;
      w.rig.group.position.set(wx, groundHeight(wx, wz), wz);
      w.rig.group.rotation.y = head;
      w.rig.animate(step, 0.55, time + w.s);
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
