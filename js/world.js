import * as THREE from 'three';

// ============================================================
// Bản đồ Hải Phòng tỉ lệ ~1:10 (1 đơn vị ≈ 10m thực tế cho khoảng cách,
// công trình giữ kích thước gần thật so với nhân vật — quy ước game thế giới mở)
//
//   Gốc tọa độ (0,0) = Nhà hát lớn. Bắc = -z, Đông = +x.
//   - Sông Cấm chạy ngang phía bắc trung tâm (z ≈ -170), đổ ra biển phía đông
//   - Biển ở phía đông (x lớn), bờ biển chéo xuống tây nam
//   - Đồ Sơn: bán đảo đồi + bãi tắm, cách trung tâm ~1.900 đơn vị (19km thật) về ĐN
//   - Hòn Dấu: đảo hải đăng ngoài khơi Đồ Sơn
//   - Cát Bà + vịnh Lan Hạ: quần đảo đá vôi phía đông, ~2.500 đơn vị
// ============================================================

export const WORLD_BOUNDS = { minX: -600, maxX: 3600, minZ: -700, maxZ: 2600 };

const SEA_FLOOR = -4;
const LAND_H = 2;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }
function rectFactor(x, x0, x1, z, z0, z1, m) {
  return smoothstep(x0 - m, x0, x) * (1 - smoothstep(x1, x1 + m, x))
       * smoothstep(z0 - m, z0, z) * (1 - smoothstep(z1, z1 + m, z));
}
function distToSeg(x, z, x1, z1, x2, z2) {
  const dx = x2 - x1, dz = z2 - z1;
  const t = clamp(((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
}

// Bờ biển: đất liền khi x < coastX(z)
export function coastX(z) {
  return 500 - z * 0.22 + 40 * Math.sin(z * 0.004) + 15 * Math.sin(z * 0.013);
}

// Quốc lộ ra Đồ Sơn (đường Phạm Văn Đồng thu nhỏ)
const HIGHWAY = [
  [30, 120], [120, 480], [180, 950], [240, 1480], [300, 1760], [330, 1930],
];
// Đường trên đảo Cát Bà
const CATBA_ROAD = [[2360, 1090], [2510, 1160]];
// Đường xuống bãi tắm Đồ Sơn + Bến Nghiêng
const DOSON_ROAD = [[300, 1760], [340, 1810], [388, 1886]];

function polyDist(x, z, poly) {
  let d = 1e9;
  for (let i = 0; i < poly.length - 1; i++) {
    d = Math.min(d, distToSeg(x, z, poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]));
  }
  return d;
}

function nearRoad(x, z) {
  return Math.min(
    polyDist(x, z, HIGHWAY),
    polyDist(x, z, CATBA_ROAD),
    polyDist(x, z, DOSON_ROAD)
  );
}

// Cầu qua sông Cấm: [xTâm, nhịp z từ, đến, độ cao vòm]
const BRIDGES = [
  { x: -20, z0: -218, z1: -122, rise: 8 },   // cầu Hoàng Văn Thụ
  { x: -250, z0: -218, z1: -122, rise: 7 },  // cầu Bính
];
// Cầu tàu gỗ (đi bộ được, thuyền không bị chặn)
const PIERS = [
  { x0: 22, x1: 36, z0: -152, z1: -134 },      // Bến Bính (trung tâm)
  { x0: 396, x1: 430, z0: 1884, z1: 1898 },    // Bến Nghiêng (Đồ Sơn)
  { x0: 2432, x1: 2446, z0: 1168, z1: 1212 },  // bến Cát Bà
];

function deckHeight(x, z) {
  let h = -Infinity;
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) < 7 && z > b.z0 && z < b.z1) {
      const mid = (b.z0 + b.z1) / 2, half = (b.z1 - b.z0) / 2;
      const tt = (z - mid) / half;
      h = Math.max(h, LAND_H + b.rise * Math.max(0, 1 - tt * tt));
    }
  }
  for (const p of PIERS) {
    if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) h = Math.max(h, LAND_H);
  }
  return h;
}

// Địa hình gốc — KHÔNG tính mặt cầu/cầu tàu (thuyền dùng hàm này)
export function groundHeightNoDeck(x, z) {
  const c = coastX(z);
  // nền: đáy biển -> đất liền, dốc thoải làm bãi cát
  let h = lerp(SEA_FLOOR, LAND_H, smoothstep(-40, 10, c - x));
  const inland = smoothstep(12, 60, c - x);
  h += 0.5 * Math.sin(x * 0.013) * Math.sin(z * 0.011) * inland;
  // đồi Thủy Nguyên phía bắc sông Cấm
  if (z < -230) {
    h += inland * 6 * smoothstep(-230, -420, z) * (0.55 + 0.45 * Math.sin(x * 0.012) * Math.sin(z * 0.016));
  }
  // bán đảo Đồ Sơn: dải đất + dãy đồi
  const dDS = distToSeg(x, z, 180, 1680, 310, 2010);
  h = Math.max(h, lerp(LAND_H, SEA_FLOOR, smoothstep(110, 175, dDS)));
  const dHill = distToSeg(x, z, 200, 1750, 265, 1930);
  h += 20 * (1 - smoothstep(20, 85, dHill)) * (0.7 + 0.3 * Math.sin(x * 0.05 + z * 0.03));
  // đảo Hòn Dấu
  const dHD = Math.hypot(x - 520, z - 2100);
  h = Math.max(h, lerp(3.2, SEA_FLOOR, smoothstep(20, 46, dHD)));
  // đảo Cát Bà (2 khối chính tạo dáng dài)
  const dCB1 = Math.hypot(x - 2450, z - 850);
  const dCB2 = Math.hypot(x - 2650, z - 1000);
  const cbEdge = Math.min(
    smoothstep(250, 320, dCB1),
    smoothstep(200, 270, dCB2)
  );
  h = Math.max(h, lerp(LAND_H, SEA_FLOOR, cbEdge));
  // đồi trên đảo Cát Bà
  const dCBHill = Math.hypot(x - 2500, z - 830);
  h += 8 * (1 - smoothstep(60, 200, dCBHill)) * (0.6 + 0.4 * Math.sin(x * 0.02) * Math.sin(z * 0.02))
     * (1 - smoothstep(250, 300, dCB1));
  // làm phẳng trung tâm thành phố + khu cảng + thị trấn Cát Bà
  h = lerp(h, LAND_H, rectFactor(x, -300, 180, z, -140, 120, 20));
  h = lerp(h, LAND_H, rectFactor(x, 40, 160, z, -148, -96, 12));
  h = lerp(h, LAND_H, rectFactor(x, 2360, 2530, z, 1080, 1170, 16));
  // đường quốc lộ: san phẳng hành lang
  const rd = nearRoad(x, z);
  h = lerp(LAND_H, h, smoothstep(10, 30, rd));
  // sông Cấm (đào lòng sông sau khi san nền)
  const riverF = 1 - smoothstep(24, 40, Math.abs(z + 170));
  h = lerp(h, -3, riverF);
  // hồ Tam Bạc (dải hồ đông-tây giữa trung tâm)
  const lakeD = ((x + 120) / 62) ** 2 + ((z - 10) / 17) ** 2;
  h = lerp(h, -2, 1 - smoothstep(0.72, 1.1, lakeD));
  return h;
}

export function groundHeight(x, z) {
  return Math.max(groundHeightNoDeck(x, z), deckHeight(x, z));
}

export function isWater(x, z) { return groundHeightNoDeck(x, z) < 0.25; }

// ============================================================
// Vật liệu dùng chung
// ============================================================
function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

export const sharedMats = {
  lampGlow: mat(0xfff2b8, { emissive: 0xffdd77, emissiveIntensity: 0 }),
  window: mat(0x557788, { emissive: 0xffcc66, emissiveIntensity: 0 }),
  trunk: mat(0x6b4a2e),
  leafGreen: mat(0x4e9e46),
  leafDark: mat(0x35773a),
  flower: mat(0xe8402a, { emissive: 0xd42a12, emissiveIntensity: 0.35 }),
};

// ============================================================
export function buildWorld(scene) {
  const colliders = [];   // { x, z, r }
  const updaters = [];    // fn(dt, time)
  const world = {
    colliders, updaters, groundHeight, groundHeightNoDeck, isWater, sharedMats, coastX,
  };
  function addCollider(x, z, r) { colliders.push({ x, z, r }); }

  // ---------- Mặt đất ----------
  const W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;   // 4200
  const D = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;   // 3300
  const CX = (WORLD_BOUNDS.maxX + WORLD_BOUNDS.minX) / 2;
  const CZ = (WORLD_BOUNDS.maxZ + WORLD_BOUNDS.minZ) / 2;
  const geo = new THREE.PlaneGeometry(W, D, 336, 264);
  geo.rotateX(-Math.PI / 2);
  geo.translate(CX, 0, CZ);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xe6d295), cGrass = new THREE.Color(0x77bd62),
        cDeep = new THREE.Color(0x7f9a8a), cCity = new THREE.Color(0xc2baa6),
        cHill = new THREE.Color(0x4e9450), cPort = new THREE.Color(0xa5a5a2),
        cRock = new THREE.Color(0x8f9884);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeightNoDeck(x, z);
    pos.setY(i, h);
    if (h < -0.6) tmp.copy(cDeep);
    else if (h < 1.1) tmp.copy(cSand);
    else {
      tmp.copy(cGrass).lerp(cHill, smoothstep(3, 9, h));
      tmp.lerp(cRock, smoothstep(9, 20, h));
    }
    tmp.lerp(cCity, rectFactor(x, -295, 175, z, -135, 115, 14) * 0.85);
    tmp.lerp(cPort, rectFactor(x, 42, 158, z, -146, -98, 8) * 0.9);
    tmp.lerp(cCity, rectFactor(x, 2365, 2525, z, 1085, 1165, 10) * 0.7);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  groundMesh.name = 'ground';
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---------- Mặt nước (phản chiếu ánh mặt trời) ----------
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x2f8fbe, transparent: true, opacity: 0.85,
    shininess: 130, specular: 0x99d4ee,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CX, 0, CZ);
  water.name = 'water';
  scene.add(water);
  world.waterMat = waterMat;
  updaters.push((dt, time) => { water.position.y = Math.sin(time * 0.8) * 0.06; });

  // ---------- Đường ----------
  const roadMat = mat(0x565a60);
  function roadSeg(x1, z1, x2, z2, w) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, len + w * 0.6), roadMat);
    m.position.set((x1 + x2) / 2, LAND_H + 0.02, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1);
    scene.add(m);
  }
  // lưới phố trung tâm (mô phỏng dải trung tâm & các trục chính)
  roadSeg(-260, 8, 120, 8, 10);        // Quang Trung / dải trung tâm
  roadSeg(-200, -60, 130, -60, 9);     // Điện Biên Phủ
  roadSeg(-200, 66, 110, 66, 9);       // Trần Phú
  roadSeg(-20, -110, -20, 110, 9);     // trục qua cầu HVT
  roadSeg(-100, -90, -100, 100, 8);
  roadSeg(-180, -90, -180, 100, 8);
  roadSeg(60, -90, 60, 100, 8);
  roadSeg(-20, -110, -20, -121, 9);    // dẫn lên cầu Hoàng Văn Thụ (mặt cầu tự vẽ)
  roadSeg(-20, -219, -20, -256, 9);
  roadSeg(-250, -110, -250, -121, 9);  // dẫn lên cầu Bính
  roadSeg(-250, -219, -250, -256, 9);
  roadSeg(-250, -110, -180, -90, 8);
  roadSeg(60, -60, 100, -110, 8);      // ra cảng
  for (let i = 0; i < HIGHWAY.length - 1; i++) {
    roadSeg(HIGHWAY[i][0], HIGHWAY[i][1], HIGHWAY[i + 1][0], HIGHWAY[i + 1][1], 13);
  }
  roadSeg(CATBA_ROAD[0][0], CATBA_ROAD[0][1], CATBA_ROAD[1][0], CATBA_ROAD[1][1], 8);
  roadSeg(300, 1760, 340, 1810, 9);    // xuống bãi biển Đồ Sơn
  roadSeg(340, 1810, 388, 1886, 9);    // ra Bến Nghiêng

  // ---------- Nhà phố ----------
  const roofMats = [mat(0xb8452e), mat(0x8f5b3a), mat(0x9c3d33), mat(0x776655)];
  const wallMats = [mat(0xf5e4b8), mat(0xf0cfa0), mat(0xdfe8dc), mat(0xf4b8a0), mat(0xcfe0ee), mat(0xf7efc9)];
  function house(x, z, w = 8, d = 7, hgt = 6, rotY = 0, wallOverride = null) {
    const g = new THREE.Group();
    const wall = wallOverride || wallMats[Math.floor(Math.abs(x * 7 + z * 13)) % wallMats.length];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wall);
    body.position.y = hgt / 2;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.6, 4),
      roofMats[Math.floor(Math.abs(x * 3 + z * 5)) % roofMats.length]);
    roof.position.y = hgt + 1.3;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    for (const sx of [-w / 4, w / 4]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.5, 0.15), sharedMats.window);
      win.position.set(sx, hgt * 0.55, d / 2 + 0.02);
      g.add(win);
      const win2 = win.clone(); win2.position.z = -d / 2 - 0.02; g.add(win2);
    }
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = rotY;
    scene.add(g);
    addCollider(x, z, Math.max(w, d) * 0.62);
    return g;
  }
  // (chừa trống dải trung tâm z 8..66 — quảng trường, quán hoa, tượng đài — và mặt hồ Tam Bạc)
  const houseSpots = [
    [-160, -75], [-140, -75], [-120, -75], [-80, -75], [-60, -78], [-40, -75], [20, -75], [40, -78], [80, -75],
    [-160, -42], [-140, -45], [-60, -42], [-40, -45], [20, -42], [80, -45], [100, -42],
    [-160, 84], [-140, 82], [-120, 84], [-80, 82], [-40, 84], [20, 82], [60, 84], [90, 82],
    [-220, -75], [-240, -78], [-260, -75], [-220, 26], [-240, 24], [-220, 84], [-250, 82],
    [-280, -40], [-285, 40], [110, 26], [130, -20], [130, 40],
  ];
  for (const [hx, hz] of houseSpots) {
    house(hx, hz, 7 + (Math.abs(hx * hz) % 4), 6 + (Math.abs(hx + hz) % 3),
      5 + (Math.abs(hx * 2 + hz) % 5), (Math.abs(hx) % 2) * Math.PI / 2);
  }
  // vài tòa nhà cao tầng hiện đại phía đông trung tâm
  function tower(x, z, w, hgt, color) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, w), mat(color));
    b.position.set(x, LAND_H + hgt / 2, z);
    scene.add(b);
    for (let fy = 6; fy < hgt - 3; fy += 7) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.15, 1.6, w + 0.15), sharedMats.window);
      strip.position.set(x, LAND_H + fy, z);
      scene.add(strip);
    }
    addCollider(x, z, w * 0.75);
  }
  tower(150, -30, 16, 64, 0x9fb8c8);   // tháp kiểu Hoàng Huy
  tower(135, 90, 14, 46, 0xc8b89a);
  tower(-290, -15, 13, 38, 0xa8c0b8);

  // ---------- NHÀ HÁT LỚN (Baroque 2 tầng, tường vàng, cột trắng, quảng trường + đài phun nước) ----------
  {
    const g = new THREE.Group();
    const yellow = mat(0xf2ce6b), white = mat(0xfdf6e0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(34, 13, 20), yellow);
    body.position.y = 6.5; g.add(body);
    // tầng mái + trán tường tam giác trung tâm
    const roof = new THREE.Mesh(new THREE.BoxGeometry(35, 1.6, 21), mat(0x6d6d72));
    roof.position.y = 13.8; g.add(roof);
    const pedi = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 12, 3, 1), white);
    pedi.rotation.z = Math.PI / 2; pedi.rotation.x = 0;
    pedi.scale.set(0.5, 1, 1);
    pedi.position.set(0, 15.6, 0);
    g.add(pedi);
    // 6 cột trắng mặt tiền (hướng nam +z)
    for (let i = -2.5; i <= 2.5; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 9, 8), white);
      col.position.set(i * 4.6, 5.5, 10.8);
      g.add(col);
    }
    // ban công tầng 2 + dãy cửa vòm vàng đậm
    const balc = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 2.6), white);
    balc.position.set(0, 7.2, 10.6); g.add(balc);
    for (let i = -2; i <= 2; i++) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.6, 0.2), mat(0xc8912e));
      door.position.set(i * 5.2, 3.2, 10.15); g.add(door);
      const win = new THREE.Mesh(new THREE.BoxGeometry(2, 2.8, 0.2), sharedMats.window);
      win.position.set(i * 5.2, 9.6, 10.15); g.add(win);
    }
    const steps = new THREE.Mesh(new THREE.BoxGeometry(30, 1.4, 7), mat(0xd8cdb0));
    steps.position.set(0, 0.7, 14); g.add(steps);
    g.position.set(0, LAND_H, -30);
    scene.add(g);
    addCollider(0, -30, 20);

    // quảng trường: đài phun nước + cột cờ + bồn hoa
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 1, 16), white);
    pool.position.set(0, LAND_H + 0.5, 6);
    scene.add(pool);
    const poolWater = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.9, 16),
      new THREE.MeshLambertMaterial({ color: 0x5ec8e8, transparent: true, opacity: 0.85 }));
    poolWater.position.set(0, LAND_H + 0.62, 6);
    scene.add(poolWater);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0xeafaff, transparent: true, opacity: 0.7 }));
    jet.position.set(0, LAND_H + 3, 6);
    scene.add(jet);
    updaters.push((dt, time) => { jet.scale.y = 0.8 + Math.sin(time * 3) * 0.2; });
    addCollider(0, 6, 7.6);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 16, 6), mat(0xd8d8d8));
    pole.position.set(14, LAND_H + 8, 6);
    scene.add(pole);
    const vnFlag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    vnFlag.position.set(16, LAND_H + 14.5, 6);
    scene.add(vnFlag);
    updaters.push((dt, time) => { vnFlag.rotation.y = Math.sin(time * 1.8) * 0.35; });
    for (const [bx, bz] of [[-10, 2], [10, 14], [-10, 14], [10, 2]]) {
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.7, 10), mat(0x8f5b3a));
      bed.position.set(bx, LAND_H + 0.35, bz + 4);
      scene.add(bed);
      for (let k = 0; k < 5; k++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.35, 5, 4),
          mat([0xe8402a, 0xf2ce4b, 0xe87ab8][k % 3]));
        fl.position.set(bx + Math.cos(k * 2.2) * 1.3, LAND_H + 0.9, bz + 4 + Math.sin(k * 2.2) * 1.3);
        scene.add(fl);
      }
    }
  }

  // ---------- QUÁN HOA (5 gian mái đình, cột gỗ lim) ----------
  {
    for (let i = 0; i < 5; i++) {
      const g = new THREE.Group();
      for (const [cx, cz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.2, 6), mat(0x5a3a22));
        col.position.set(cx, 1.6, cz);
        g.add(col);
      }
      const roof1 = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.5, 4), mat(0x8a4030));
      roof1.rotation.y = Math.PI / 4;
      roof1.position.y = 3.9;
      g.add(roof1);
      const roofTip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), mat(0x6d3226));
      roofTip.rotation.y = Math.PI / 4;
      roofTip.position.y = 4.9;
      g.add(roofTip);
      // hoa bày bán
      for (let k = 0; k < 6; k++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 5, 4),
          mat([0xe8402a, 0xf2ce4b, 0xe87ab8, 0xffffff, 0xb85ae8, 0xf28c3a][k]));
        fl.position.set(-1 + (k % 3), 1.1, -0.8 + Math.floor(k / 3) * 1.6);
        g.add(fl);
      }
      const table = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 2.6), mat(0x8a6a45));
      table.position.y = 0.35;
      g.add(table);
      g.position.set(-26 + i * 8, LAND_H, 22);
      scene.add(g);
      addCollider(-26 + i * 8, 22, 2.4);
    }
  }

  // ---------- TƯỢNG ĐÀI NỮ TƯỚNG LÊ CHÂN (đồng, cao 7,5m trên bệ đá) ----------
  {
    const g = new THREE.Group();
    const bronze = mat(0x6e5a38);
    const granite = mat(0x8a8578);
    const base = new THREE.Mesh(new THREE.BoxGeometry(7, 1.2, 7), granite);
    base.position.y = 0.6; g.add(base);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(4, 3.4, 4), granite);
    ped.position.y = 2.9; g.add(ped);
    // váy áo choàng xòe
    const dress = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 2.1, 4.4, 8), bronze);
    dress.position.y = 6.8; g.add(dress);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(1.7, 2.2, 1.1), bronze);
    torso.position.y = 10; g.add(torso);
    // hai tay: một tay chỉ về phía trước
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), bronze);
    armR.position.set(1.1, 10.4, 0.5);
    armR.rotation.x = -1.1;
    g.add(armR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.5), bronze);
    armL.position.set(-1.1, 9.9, 0);
    g.add(armL);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 8, 6), bronze);
    head.position.y = 11.8; g.add(head);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 5), bronze);
    bun.position.set(0, 12.3, -0.3); g.add(bun);
    g.position.set(-58, LAND_H, 14);
    g.rotation.y = Math.PI; // nhìn về hướng nam (dải trung tâm)
    scene.add(g);
    addCollider(-58, 14, 4.4);
    // Trung tâm Triển lãm phía sau (khối trắng hiện đại)
    const expo = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 12), mat(0xeae6da));
    expo.position.set(-58, LAND_H + 4.5, -6);
    scene.add(expo);
    addCollider(-58, -6, 14);
  }

  // ---------- NHÀ THỜ CHÍNH TÒA (gothic, tháp chuông nhọn) ----------
  {
    const g = new THREE.Group();
    const grey = mat(0xd8d2c2);
    const nave = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 24), grey);
    nave.position.y = 4.5; g.add(nave);
    const naveRoof = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 24, 3), mat(0x7d5040));
    naveRoof.rotation.z = Math.PI / 2; naveRoof.rotation.y = Math.PI / 2;
    naveRoof.scale.x = 0.8;
    naveRoof.position.y = 10.5; g.add(naveRoof);
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(6, 16, 6), grey);
    belfry.position.set(0, 8, 14); g.add(belfry);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 8), mat(0x5a5a62));
    spire.position.set(0, 20, 14); g.add(spire);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), mat(0xf2ce6b));
    cross.position.set(0, 25.2, 14); g.add(cross);
    const crossArm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.3), mat(0xf2ce6b));
    crossArm.position.set(0, 25.6, 14); g.add(crossArm);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.6, 12),
      mat(0x4a7ab8, { emissive: 0x3a5a98, emissiveIntensity: 0.3 }));
    rose.position.set(0, 9, 17.05); g.add(rose);
    g.position.set(-150, LAND_H, -85);
    scene.add(g);
    addCollider(-150, -85, 10);
    addCollider(-150, -71, 5);
  }

  // ---------- BƯU ĐIỆN TRUNG TÂM (thuộc địa vàng, đồng hồ) ----------
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 10), mat(0xf0c868));
    body.position.y = 4.5; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 1.4, 11), mat(0x7d5040));
    roof.position.y = 9.7; g.add(roof);
    for (let i = -2; i <= 2; i++) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.4, 0.2), mat(0xfdf6e0));
      arch.position.set(i * 4.2, 3.4, 5.05); g.add(arch);
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2, 0.15), sharedMats.window);
      win.position.set(i * 4.2, 7, 5.05); g.add(win);
    }
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.1, 12), mat(0xfffbe8));
    clockFace.position.set(0, 11.2, 5.05); g.add(clockFace);
    const clockBox = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 1.4), mat(0xf0c868));
    clockBox.position.set(0, 11.2, 4.2); g.add(clockBox);
    g.position.set(38, LAND_H, 40);
    g.rotation.y = Math.PI;
    scene.add(g);
    addCollider(38, 40, 12);
  }

  // ---------- BẢO TÀNG HẢI PHÒNG (gạch đỏ kiểu gothic thuộc địa) ----------
  {
    const g = new THREE.Group();
    const brick = mat(0xa8503c);
    const body = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 12), brick);
    body.position.y = 4; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11.5, 4.5, 4), mat(0x5a3a30));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 10.2; g.add(roof);
    for (const sx of [-6, 6]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 6.5, 13), brick);
      wing.position.set(sx + Math.sign(sx) * 6.5, 3.25, 0); g.add(wing);
    }
    for (let i = -1; i <= 1; i++) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(2, 3.6, 0.2), mat(0xf5ead0));
      arch.position.set(i * 5, 3.4, 6.05); g.add(arch);
    }
    g.position.set(-95, LAND_H, -85);
    scene.add(g);
    addCollider(-95, -85, 14);
  }

  // ---------- GA HẢI PHÒNG (thuộc địa vàng + tàu hỏa) ----------
  {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 10), mat(0xf2ce6b));
    body.position.y = 4; g.add(body);
    const center = new THREE.Mesh(new THREE.BoxGeometry(8, 11, 11), mat(0xf2ce6b));
    center.position.y = 5.5; g.add(center);
    const roofC = new THREE.Mesh(new THREE.ConeGeometry(6.5, 3, 4), mat(0x7d5040));
    roofC.rotation.y = Math.PI / 4; roofC.position.y = 12.4; g.add(roofC);
    const roofB = new THREE.Mesh(new THREE.BoxGeometry(27, 1.2, 11), mat(0x7d5040));
    roofB.position.y = 8.5; g.add(roofB);
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      const arch = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.4, 0.2), mat(0xfdf6e0));
      arch.position.set(i * 5, 3.2, 5.05); g.add(arch);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.6, 0.2), mat(0x6d4a2e));
    door.position.set(0, 2.6, 5.6); g.add(door);
    // mái ke ga + tàu hỏa
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 8), mat(0x8a8f96));
    canopy.position.set(0, 6, -10); g.add(canopy);
    for (const sx of [-12, -4, 4, 12]) {
      const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), mat(0x5a5f66));
      cp.position.set(sx, 3, -10); g.add(cp);
    }
    // đường ray
    for (const rz of [-14.2, -13.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(60, 0.15, 0.25), mat(0x777777));
      rail.position.set(0, 0.35, rz); g.add(rail);
    }
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 1.6), mat(0x5a4632));
    sleeper.position.set(0, 0.2, -13.7); g.add(sleeper);
    // đầu máy + 2 toa
    const loco = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 2.6), mat(0x2e6fa1));
    loco.position.set(-14, 2.1, -13.7); g.add(loco);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.6), mat(0x24557d));
    cab.position.set(-11.5, 4.5, -13.7); g.add(cab);
    for (let i = 0; i < 2; i++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 2.5), mat(0x8fb03e));
      car.position.set(-4 + i * 9.5, 1.9, -13.7); g.add(car);
    }
    g.position.set(-120, LAND_H, 95);
    scene.add(g);
    addCollider(-120, 95, 16);
    addCollider(-120, 82, 12);
  }

  // ---------- CHỢ SẮT ----------
  {
    const g = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 18), mat(0xd8663c));
    hall.position.y = 4.5; g.add(hall);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(9.5, 9.5, 27, 3, 1), mat(0x7d3b2a));
    roof.rotation.z = Math.PI / 2;
    roof.scale.set(1, 1, 0.5);
    roof.position.y = 10.5; g.add(roof);
    for (const sx of [-9, 0, 9]) {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 3), mat(0xe8b84d));
      stall.position.set(sx, 1.1, 12.5); g.add(stall);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(3, 1.4, 4), mat(0xd84040));
      canopy.rotation.y = Math.PI / 4;
      canopy.position.set(sx, 3, 12.5); g.add(canopy);
    }
    g.position.set(-215, LAND_H, -35);
    scene.add(g);
    addCollider(-215, -35, 16);
  }

  // ---------- CẦU HOÀNG VĂN THỤ & CẦU BÍNH ----------
  function bridgeDeckAndRails(b, railColor) {
    const g = new THREE.Group();
    const deckMat = mat(0xcfd4da);
    const mid = (b.z0 + b.z1) / 2, half = (b.z1 - b.z0) / 2;
    for (let z = b.z0; z <= b.z1; z += 4) {
      const tt = (z - mid) / half;
      const y = LAND_H + b.rise * Math.max(0, 1 - tt * tt);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 4.4), deckMat);
      seg.position.set(b.x, y - 0.45, z);
      g.add(seg);
      for (const sx of [-6.6, 6.6]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 4.4), mat(railColor));
        rail.position.set(b.x + sx, y + 0.55, z);
        g.add(rail);
      }
    }
    scene.add(g);
    return { mid, half };
  }
  {
    // Cầu Hoàng Văn Thụ — "cánh chim biển": vòm đỏ
    const b = BRIDGES[0];
    const { mid } = bridgeDeckAndRails(b, 0xe8524a);
    const arcPts = [];
    for (let i = 0; i <= 24; i++) {
      const tt = i / 24;
      arcPts.push(new THREE.Vector3(0, Math.sin(tt * Math.PI) * 26 + 2, (tt - 0.5) * 96));
    }
    const arc = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 32, 1, 6), mat(0xe8524a));
    arc.position.set(b.x, 0, mid);
    scene.add(arc);
    // dây văng từ vòm xuống mặt cầu
    for (let i = 2; i <= 22; i += 2) {
      const tt = i / 24;
      const topY = Math.sin(tt * Math.PI) * 26 + 2;
      const zz = (tt - 0.5) * 96;
      const ttd = (zz) / ((b.z1 - b.z0) / 2);
      const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
      const len = topY - deckY;
      if (len < 2) continue;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, len, 4), mat(0xd8d8d8));
      cable.position.set(b.x, deckY + len / 2, mid + zz);
      scene.add(cable);
    }
  }
  {
    // Cầu Bính — dây văng 2 trụ chữ H
    const b = BRIDGES[1];
    const { mid } = bridgeDeckAndRails(b, 0x88b8c8);
    for (const dz of [-22, 22]) {
      for (const dx of [-6, 6]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 34, 1.6), mat(0xb8c4c8));
        pylon.position.set(b.x + dx, 15, mid + dz);
        scene.add(pylon);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.4), mat(0xb8c4c8));
      beam.position.set(b.x, 28, mid + dz);
      scene.add(beam);
      // dây văng
      for (let k = 1; k <= 4; k++) {
        for (const dir of [-1, 1]) {
          const zz = dz + dir * k * 9;
          if (Math.abs(zz) > 46) continue;
          const ttd = zz / ((b.z1 - b.z0) / 2);
          const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
          const topY = 30;
          const dzLen = Math.abs(zz - dz);
          const len = Math.hypot(topY - deckY, dzLen);
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat(0xd8e0e4));
          cable.position.set(b.x, (topY + deckY) / 2, mid + (zz + dz) / 2);
          cable.rotation.x = Math.atan2(dzLen, topY - deckY) * Math.sign(zz - dz);
          scene.add(cable);
        }
      }
    }
  }

  // ---------- CẢNG HẢI PHÒNG ----------
  {
    const g = new THREE.Group();
    const quay = new THREE.Mesh(new THREE.BoxGeometry(110, 2.4, 12), mat(0x9a9a96));
    quay.position.set(95, 1.2, -140);
    g.add(quay);
    function crane(x) {
      const c = new THREE.Group();
      const legMat = mat(0x3f6fb5);
      for (const [lx, lz] of [[-3, -2.5], [3, -2.5], [-3, 2.5], [3, 2.5]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.9, 16, 0.9), legMat);
        leg.position.set(lx, 8, lz); c.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 26), legMat);
      beam.position.set(0, 16.5, -6); c.add(beam);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.4, 3), mat(0xe8b820));
      cab.position.set(0, 14.5, 0); c.add(cab);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.18, 8, 0.18), mat(0x333333));
      cable.position.set(0, 12.5, -14); c.add(cable);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.4), mat(0xd84040));
      hook.position.set(0, 8, -14); c.add(hook);
      c.position.set(x, LAND_H, -128);
      g.add(c);
      addCollider(x, -128, 5);
    }
    crane(60); crane(95); crane(130);
    const ctColors = [0xd84040, 0x2e86c1, 0x28a05c, 0xe8a020, 0x8e44ad];
    let ci = 0;
    for (let cx = 50; cx <= 145; cx += 12) {
      for (let cz = -118; cz <= -104; cz += 7) {
        const stack = 1 + (ci % 3);
        for (let s = 0; s < stack; s++) {
          const ct = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 4.5), mat(ctColors[(ci + s) % 5]));
          ct.position.set(cx, LAND_H + 1.5 + s * 3, cz);
          g.add(ct);
        }
        addCollider(cx, cz, 5.5);
        ci++;
      }
    }
    scene.add(g);
  }

  // ---------- Tàu thủy ----------
  function ship(x, z, len, colHull, colTop, rotY = 0) {
    const s = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 4, len * 0.28), mat(colHull));
    hull.position.y = 1; s.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(len * 0.14, 7, 4), mat(colHull));
    bow.scale.y = 2;
    bow.position.set(len / 2 + 2.4, 1, 0);
    bow.rotation.z = -Math.PI / 2;
    s.add(bow);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(len * 0.18, 6, len * 0.2), mat(colTop));
    bridge.position.set(-len * 0.3, 6, 0); s.add(bridge);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 3.2, 8), mat(0xd84040));
    funnel.position.set(-len * 0.3, 10.4, 0); s.add(funnel);
    for (let i = 0; i < 3; i++) {
      const ct = new THREE.Mesh(new THREE.BoxGeometry(len * 0.14, 2.2, len * 0.16), mat([0x2e86c1, 0x28a05c, 0xe8a020][i]));
      ct.position.set(len * (0.05 + i * 0.16), 4.1, 0);
      s.add(ct);
    }
    s.position.set(x, 0, z);
    s.rotation.y = rotY;
    scene.add(s);
    return s;
  }
  ship(95, -172, 44, 0x24455f, 0xf0f0e8);                    // tàu hàng cập cảng
  ship(400, -190, 40, 0x555a44, 0xe8e8e0, 0.2);              // tàu ra cửa biển
  const seaShip = ship(1500, 600, 48, 0x7d2b20, 0xe8e8e0);   // tàu tuần du ngoài khơi
  updaters.push((dt, time) => {
    const ang = time * 0.02;
    seaShip.position.set(1500 + Math.cos(ang) * 420, Math.sin(time * 0.7) * 0.15, 650 + Math.sin(ang) * 320);
    seaShip.rotation.y = -ang + Math.PI / 2;
  });

  // ---------- Cầu tàu gỗ ----------
  for (const p of PIERS) {
    const lenX = p.x1 - p.x0, lenZ = p.z1 - p.z0;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.6, lenZ), mat(0x9a7448));
    deck.position.set((p.x0 + p.x1) / 2, LAND_H - 0.25, (p.z0 + p.z1) / 2);
    scene.add(deck);
    const nPiles = Math.max(2, Math.floor(Math.max(lenX, lenZ) / 8));
    for (let i = 0; i <= nPiles; i++) {
      const px = p.x0 + (lenX * i) / nPiles;
      const pz = p.z0 + (lenZ * i) / nPiles;
      for (const off of [-0.4, 0.4]) {
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 6.5, 6), mat(0x6b4a2e));
        pile.position.set(px + (lenX > lenZ ? 0 : off * (p.x1 - p.x0)), -1.2, pz + (lenX > lenZ ? off * 4 : 0));
        scene.add(pile);
      }
    }
  }

  // ---------- Đồ Sơn: ô che nắng, thuyền cá, biệt thự Bảo Đại, Bến Nghiêng ----------
  {
    const umbColors = [0xe8524a, 0x2e86c1, 0xe8a020, 0x28a05c];
    // hàng ô dọc mép nước phía đông bán đảo
    const spots = [[358, 1800], [366, 1820], [374, 1840], [382, 1860], [390, 1879], [370, 1808]];
    spots.forEach(([ux, uz], i) => {
      const y = groundHeight(ux, uz);
      if (y < 0.5) return;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), mat(0xf0f0e8));
      pole.position.set(ux, y + 1.7, uz);
      scene.add(pole);
      const umb = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.3, 8), mat(umbColors[i % 4]));
      umb.position.set(ux, y + 3.6, uz);
      scene.add(umb);
      const towel = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.2), mat(umbColors[(i + 1) % 4]));
      towel.position.set(ux - 1.6, y + 0.06, uz + 1.8);
      scene.add(towel);
    });
    for (const [bx, bz, r] of [[420, 1830, 0.4], [445, 1870, 2.2], [428, 1920, 1.2]]) {
      const b = new THREE.Group();
      const hull = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.1, 6, 6, 1), mat(0x2e6fa1));
      hull.rotation.z = Math.PI / 2; hull.scale.y = 0.5;
      hull.position.y = 0.4; b.add(hull);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 5), mat(0x6b4a2e));
      mast.position.y = 2; b.add(mast);
      b.position.set(bx, 0, bz); b.rotation.y = r;
      scene.add(b);
      updaters.push((dt, time) => {
        b.rotation.z = Math.sin(time * 1.1 + bx) * 0.05;
        b.position.y = Math.sin(time * 0.9 + bz) * 0.12;
      });
    }
    // Biệt thự Bảo Đại trên đồi
    {
      const g = new THREE.Group();
      const y = groundHeight(232, 1838);
      const body = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), mat(0xf5efd8));
      body.position.y = 3.5; g.add(body);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.4, 4), mat(0x8a4030));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 8.6; g.add(roof);
      const terrace = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 14), mat(0xd8cdb0));
      terrace.position.y = 0.4; g.add(terrace);
      for (const [cx, cz] of [[-6, 5], [6, 5]]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 6, 8), mat(0xfdf6e0));
        col.position.set(cx, 3, cz); g.add(col);
      }
      g.position.set(232, y, 1838);
      scene.add(g);
      addCollider(232, 1838, 11);
    }
    // vài khách sạn nhỏ ven đường biển
    house(330, 1786, 10, 8, 10, Math.PI / 2, mat(0xcfe0ee));
    house(342, 1836, 9, 8, 8, Math.PI / 2, mat(0xf4b8a0));
    house(356, 1858, 10, 8, 12, Math.PI / 2, mat(0xf7efc9));
  }

  // ---------- Hải đăng Hòn Dấu ----------
  {
    const g = new THREE.Group();
    const y0 = groundHeight(520, 2100);
    for (let i = 0; i < 5; i++) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(2.1 - i * 0.16, 2.3 - i * 0.16, 3.6, 10),
        mat(i % 2 === 0 ? 0xe8524a : 0xf5f0e0));
      band.position.y = 1.8 + i * 3.6;
      g.add(band);
    }
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.2, 8),
      new THREE.MeshLambertMaterial({ color: 0xfff0b0, emissive: 0xffdd66, emissiveIntensity: 0.2 }));
    lampRoom.position.y = 19.5;
    g.add(lampRoom);
    world.lighthouseLamp = lampRoom.material;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.8, 8), mat(0x7d3b2a));
    cap.position.y = 21.5; g.add(cap);
    g.position.set(520, y0, 2100);
    scene.add(g);
    addCollider(520, 2100, 3.2);
    // cây cổ thụ trên đảo
    for (const [tx, tz] of [[508, 2088], [534, 2092], [512, 2116]]) {
      const ty = groundHeight(tx, tz);
      if (ty < 1) continue;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 4, 6), sharedMats.trunk);
      trunk.position.set(tx, ty + 2, tz);
      scene.add(trunk);
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(3, 7, 5), sharedMats.leafDark);
      leaf.position.set(tx, ty + 5.5, tz);
      scene.add(leaf);
    }
  }

  // ---------- Cát Bà: thị trấn ven vịnh + núi đá vôi Lan Hạ ----------
  {
    // dãy nhà ống sắc màu nhìn ra vịnh (đặc trưng bến Cát Bà)
    const rowColors = [0xf2ce6b, 0x6fbde8, 0xe87a6a, 0x8fd0a0, 0xf4b8d0, 0xb8a8e8, 0xf28c3a, 0x9fd8d8];
    for (let i = 0; i < 8; i++) {
      const x = 2385 + i * 9;
      const hgt = 10 + (i * 3) % 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(7.5, hgt, 9), mat(rowColors[i]));
      b.position.set(x, LAND_H + hgt / 2, 1118);
      scene.add(b);
      for (let fy = 3; fy < hgt - 1; fy += 3.2) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.1, 0.15), sharedMats.window);
        win.position.set(x, LAND_H + fy, 1122.6);
        scene.add(win);
      }
      addCollider(x, 1118, 5.5);
    }
    // núi đá vôi
    const karstMat = mat(0x8a9a7a);
    const karstTop = mat(0x4e8e46);
    function karst(x, z, r, h) {
      const y = Math.max(groundHeightNoDeck(x, z), -3.5);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 7), karstMat);
      cone.position.set(x, y + h / 2 - 0.6, z);
      scene.add(cone);
      const top = new THREE.Mesh(new THREE.SphereGeometry(r * 0.42, 7, 5), karstTop);
      top.position.set(x, y + h - 0.5, z);
      scene.add(top);
      addCollider(x, z, r * 0.8);
    }
    // trên đảo chính
    karst(2480, 800, 34, 60); karst(2560, 880, 28, 48); karst(2420, 900, 22, 38);
    karst(2620, 980, 26, 44); karst(2540, 1040, 18, 30); karst(2380, 1010, 16, 28);
    // vịnh Lan Hạ — đảo đá rải rác trên biển
    karst(2700, 1250, 20, 40); karst(2790, 1180, 15, 30); karst(2620, 1330, 13, 26);
    karst(2880, 1300, 18, 34); karst(2760, 1400, 12, 24); karst(2540, 1280, 11, 22);
    karst(2950, 1150, 16, 30); karst(2850, 1050, 13, 26);
    // đảo đá lẻ trên đường thuyền từ đất liền ra
    karst(1250, 350, 14, 26); karst(1650, 600, 17, 32); karst(2050, 850, 13, 26);
    karst(1450, 500, 9, 18); karst(1900, 700, 10, 20);
  }

  // ---------- Cây phượng vĩ (dải trung tâm, ven hồ Tam Bạc) ----------
  function phuongTree(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 4, 6), sharedMats.trunk);
    trunk.position.y = 2; g.add(trunk);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(2.8, 7, 5), sharedMats.leafGreen);
    leaf.position.y = 5; leaf.scale.y = 0.7; g.add(leaf);
    for (const [fx, fy, fz] of [[-1.4, 5.6, 0.8], [1.2, 5.9, -0.6], [0.2, 6.1, 1.2], [-0.8, 5.4, -1.3], [1.6, 5.3, 1]]) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.85, 6, 4), sharedMats.flower);
      fl.position.set(fx, fy, fz);
      g.add(fl);
    }
    g.position.set(x, y, z);
    scene.add(g);
    addCollider(x, z, 0.8);
  }
  const phuongSpots = [
    [-240, 2], [-210, 14], [-186, 2], [-160, 40], [-146, 42], [-134, 30], [-104, 30],
    [-86, -16], [-70, 26], [-40, 0], [-34, 16], [-12, 44], [58, 44], [30, 14],
    [50, 0], [72, 14], [-70, -66], [-116, -52], [26, -52], [64, -66],
    [-186, 58], [-96, 58], [-12, 74], [58, 58], [-246, -46], [-260, 22],
  ];
  phuongSpots.forEach(([x, z]) => phuongTree(x, z));

  // ---------- Dừa (Đồ Sơn, Cát Bà) ----------
  function palm(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    if (y < 0.8) return;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 5, 6), mat(0x8a6a42));
    trunk.position.y = 2.5; trunk.rotation.z = 0.12; g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 4), sharedMats.leafDark);
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 1.5 + 0.5, 5.1, Math.sin(a) * 1.5);
      leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
      g.add(leaf);
    }
    g.position.set(x, y, z);
    scene.add(g);
    addCollider(x, z, 0.6);
  }
  [[349, 1796, 0], [362, 1829, 0], [373, 1856, 0], [386, 1889, 0], [352, 1812, 0],
   [340, 1782, 0], [2392, 1140, 0], [2420, 1146, 0], [2450, 1140, 0], [2478, 1146, 0],
   [2506, 1140, 0], [2530, 1120, 0]]
    .forEach(([x, z]) => palm(x, z));

  // ---------- Cây xanh: đồi Thủy Nguyên + ven quốc lộ ----------
  for (let i = 0; i < 40; i++) {
    const x = -420 + (i * 97) % 700, z = -260 - (i * 61) % 230;
    const y = groundHeight(x, z);
    if (y < 1.5) continue;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 3, 5), sharedMats.trunk);
    trunk.position.set(x, y + 1.5, z);
    scene.add(trunk);
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(2.2, 5, 6), sharedMats.leafDark);
    leaf.position.set(x, y + 5, z);
    scene.add(leaf);
  }
  for (let i = 0; i < HIGHWAY.length - 1; i++) {
    const [x1, z1] = HIGHWAY[i], [x2, z2] = HIGHWAY[i + 1];
    const segs = Math.floor(Math.hypot(x2 - x1, z2 - z1) / 90);
    for (let k = 1; k <= segs; k++) {
      const t = k / (segs + 1);
      for (const side of [-14, 14]) {
        const x = x1 + (x2 - x1) * t + side, z = z1 + (z2 - z1) * t;
        const y = groundHeight(x, z);
        if (y < 1.5) continue;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.38, 3.4, 5), sharedMats.trunk);
        trunk.position.set(x, y + 1.7, z);
        scene.add(trunk);
        const leaf = new THREE.Mesh(new THREE.SphereGeometry(2, 6, 5), sharedMats.leafGreen);
        leaf.position.set(x, y + 4.6, z);
        scene.add(leaf);
      }
    }
  }

  // ---------- Cột đèn đường ----------
  const lampSpots = [
    [-234, 2], [-180, 14], [-126, 2], [-72, 14], [-26, 2], [30, 2], [76, 14],
    [-160, -66], [-100, -54], [-40, -66], [30, -54], [90, -66],
    [-160, 72], [-100, 60], [-40, 72], [30, 60],
    [-26, -104], [-26, -128], [-256, -104], [70, -100], [110, -114],
    [346, 1806, 0], [364, 1840, 0], [382, 1876, 0], [2400, 1128, 0], [2460, 1128, 0], [2510, 1150, 0],
  ];
  for (const [lx, lz] of lampSpots) {
    const y = groundHeight(lx, lz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5, 6), mat(0x38424a));
    pole.position.set(lx, y + 2.5, lz);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), sharedMats.lampGlow);
    bulb.position.set(lx, y + 5.2, lz);
    scene.add(bulb);
  }

  // ---------- Hoa phượng nhặt được (nhiệm vụ 1) ----------
  const flowerPickups = [];
  const pickupMat = new THREE.MeshLambertMaterial({
    color: 0xff4d30, emissive: 0xff3010, emissiveIntensity: 0.9,
  });
  const flowerSpots = [
    [-228, 8], [-176, 20], [-142, 44], [-96, 44], [-52, 26],
    [-16, 36], [22, 36], [-66, -10], [44, 8], [-120, 34],
  ];
  for (const [fx, fz] of flowerSpots) {
    const p = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), pickupMat);
    p.position.set(fx, groundHeight(fx, fz) + 1.3, fz);
    p.userData.baseY = p.position.y;
    scene.add(p);
    flowerPickups.push(p);
  }
  updaters.push((dt, time) => {
    for (const p of flowerPickups) {
      if (!p.visible) continue;
      p.rotation.y += dt * 2.2;
      p.position.y = p.userData.baseY + Math.sin(time * 2.4 + p.position.x) * 0.22;
    }
  });
  world.flowerPickups = flowerPickups;

  // ---------- Chim hải âu (cửa sông + Đồ Sơn) ----------
  function gullFlock(cx, cz, n) {
    const gulls = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const gl = new THREE.Group();
      const bd = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 4), mat(0xf5f5f0));
      bd.scale.set(1.6, 0.8, 1); gl.add(bd);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.06, 1.4), mat(0xe8e8e0));
        wing.position.set(0, 0.1, s * 0.8);
        gl.add(wing);
        gl.userData['w' + (s > 0 ? 'r' : 'l')] = wing;
      }
      gl.userData.seed = i * 1.7;
      gulls.add(gl);
    }
    scene.add(gulls);
    updaters.push((dt, time) => {
      gulls.children.forEach((gl, i) => {
        const s = gl.userData.seed;
        const ang = time * 0.14 + s;
        gl.position.set(cx + Math.cos(ang) * (60 + i * 10), 16 + Math.sin(time * 0.5 + s) * 3, cz + Math.sin(ang) * (52 + i * 8));
        gl.rotation.y = -ang;
        const flap = Math.sin(time * 7 + s) * 0.6;
        gl.userData.wl.rotation.x = flap;
        gl.userData.wr.rotation.x = -flap;
      });
    });
  }
  gullFlock(480, -160, 6);
  gullFlock(400, 1900, 5);
  gullFlock(2400, 1230, 5);

  // ---------- Nhãn chữ nổi ----------
  world.makeTextSprite = function makeTextSprite(text, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${opts.size || 44}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 8;
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = opts.color || '#ffffff';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(16, 4, 1);
    return sp;
  };

  return world;
}
