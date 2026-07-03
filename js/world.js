import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { registerModel } from './assets.js';
import {
  WORLD_BOUNDS, LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BRIDGES, BUILDINGS,
  groundHeight, groundHeightNoDeck, isWater, landAt, riverFactor,
  nearestRiverPoint, findShore, addPier,
} from './terrain.js';

// Thế giới dựng từ dữ liệu OpenStreetMap thật của Hải Phòng (tỉ lệ 1:10,
// trung tâm phóng đại 2.2x). Mọi con phố trung tâm là phố thật.
export { groundHeight, groundHeightNoDeck, isWater, landAt, WORLD_BOUNDS, LM, LM_DIR, LM_FACE, EXTRAS };

const LAND_H = 2;

function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function rectFactor(x, x1, x2, z, z1, z2, m) {
  return smoothstep(x1 - m, x1, x) * (1 - smoothstep(x2, x2 + m, x))
       * smoothstep(z1 - m, z1, z) * (1 - smoothstep(z2, z2 + m, z));
}
function mat(color, opts = {}) { return new THREE.MeshLambertMaterial({ color, ...opts }); }

// Góc quay quanh Y để trục dài của mô hình (local X) trùng cạnh dài thật (LM_DIR),
// và mặt tiền (local +Z) quay về hướng LM_FACE
function orientLong(dir, face) {
  let th = Math.atan2(-dir[1], dir[0]);
  if (face && Math.sin(th) * face[0] + Math.cos(th) * face[1] < 0) th += Math.PI;
  return th;
}
// Quay thẳng local +Z về hướng face (nhà thờ: mặt tiền nằm ở đầu hồi)
function orientFace(face) { return Math.atan2(face[0], face[1]); }
// Đưa điểm local (lx,lz) của mô hình đã quay th quanh (cx,cz) ra tọa độ thế giới
function localPt(cx, cz, lx, lz, th) {
  return [cx + lx * Math.cos(th) + lz * Math.sin(th), cz - lx * Math.sin(th) + lz * Math.cos(th)];
}

export const sharedMats = {
  lampGlow: mat(0xfff2b8, { emissive: 0xffdd77, emissiveIntensity: 0 }),
  window: mat(0x557788, { emissive: 0xffcc66, emissiveIntensity: 0 }),
  trunk: mat(0x6b4a2e),
  leafGreen: mat(0x5cb84e, { flatShading: true }),
  leafGreen2: mat(0x7ecb5e, { flatShading: true }),
  leafDark: mat(0x3d8a44, { flatShading: true }),
  flower: mat(0xe8402a, { emissive: 0xd42a12, emissiveIntensity: 0.35, flatShading: true }),
  cloud: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, flatShading: true }),
};

// ---------- Texture thủ tục ----------
function makeTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function speckle(g, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(0,0,0,${(alpha * Math.random()).toFixed(3)})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}
function facadeTextures(colorCss) {
  const draw = (em) => (g, w, h) => {
    g.fillStyle = em ? '#000' : colorCss;
    g.fillRect(0, 0, w, h);
    if (!em) {
      speckle(g, w, h, 110, 0.06);
      const grad = g.createLinearGradient(0, 0, 0, h * 0.18);
      grad.addColorStop(0, 'rgba(0,0,0,0.24)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h * 0.18);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      g.fillRect(0, h * 0.955, w, h * 0.045);
    }
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        const x = w * (0.13 + col * 0.29), y = h * (0.15 + row * 0.4);
        const ww = w * 0.17, wh = h * 0.25;
        if (!em) {
          g.fillStyle = '#f5f2e8';
          g.fillRect(x - 3, y - 3, ww + 6, wh + 6);
        }
        g.fillStyle = em ? '#ffd98a' : '#3d5a72';
        g.fillRect(x, y, ww, wh);
        if (!em) {
          g.strokeStyle = '#f5f2e8';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(x + ww / 2, y); g.lineTo(x + ww / 2, y + wh);
          g.moveTo(x, y + wh / 2); g.lineTo(x + ww, y + wh / 2);
          g.stroke();
        }
      }
    }
    if (!em) {
      g.fillStyle = '#5a3c26';
      g.fillRect(w * 0.42, h * 0.6, w * 0.16, h * 0.36);
    }
  };
  return { map: makeTex(128, 128, draw(false)), emissiveMap: makeTex(128, 128, draw(true)) };
}
function grandFacadeTextures(baseCss, trimCss, opts = {}) {
  const { cols = 7, arch = true } = opts;
  const draw = (em) => (g, w, h) => {
    g.fillStyle = em ? '#000' : baseCss;
    g.fillRect(0, 0, w, h);
    if (!em) {
      speckle(g, w, h, 200, 0.05);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, h * 0.86, w, h * 0.14);
      g.strokeStyle = 'rgba(0,0,0,0.15)';
      g.lineWidth = 2;
      for (let y = h * 0.885; y < h; y += 9) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
      g.fillStyle = trimCss;
      g.fillRect(0, 0, w, h * 0.07);
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.fillRect(0, h * 0.07, w, h * 0.016);
      g.fillStyle = trimCss;
      g.fillRect(0, h * 0.47, w, h * 0.028);
      for (let i = 0; i <= cols; i++) {
        const x = (w / cols) * i;
        g.fillStyle = trimCss;
        g.fillRect(x - 5, h * 0.07, 10, h * 0.8);
        g.fillStyle = 'rgba(0,0,0,0.13)';
        g.fillRect(x + 3, h * 0.07, 3, h * 0.8);
      }
    }
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < cols; i++) {
        const cw = w / cols;
        const x = cw * i + cw * 0.25, ww = cw * 0.5;
        const y = row === 0 ? h * 0.16 : h * 0.55, wh = h * 0.26;
        if (!em) {
          g.fillStyle = '#f2ecd8';
          g.fillRect(x - 3, y - 2, ww + 6, wh + 2);
          if (arch) {
            g.beginPath();
            g.ellipse(x + ww / 2, y, ww / 2 + 3, ww / 2 + 3, 0, Math.PI, 0);
            g.fill();
          }
        }
        g.fillStyle = em ? '#ffd98a' : '#3a5a74';
        g.fillRect(x, y, ww, wh);
        if (arch) {
          g.beginPath();
          g.ellipse(x + ww / 2, y, ww / 2, ww / 2, 0, Math.PI, 0);
          g.fill();
        }
      }
    }
  };
  return { map: makeTex(512, 256, draw(false)), emissiveMap: makeTex(512, 256, draw(true)) };
}
function signTexture(text, bgCss, fgCss) {
  return makeTex(512, 96, (g, w, h) => {
    g.fillStyle = bgCss;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fgCss;
    g.lineWidth = 4;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fgCss;
    g.font = 'bold 52px "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  });
}
function canopyGeo(r, seed) {
  const geo = new THREE.IcosahedronGeometry(r, 1);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const hash = Math.sin(v.x * 12.98 + v.y * 78.23 + v.z * 37.72 + seed) * 43758.54;
    const n = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.5;
    v.multiplyScalar(n);
    p.setXYZ(i, v.x, v.y * 0.82, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}
function karstGeo(r, h, seed) {
  const geo = new THREE.CylinderGeometry(r * 0.22, r, h, 8, 4);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i));
    const t = (v.y / h) + 0.5;
    const hash = Math.sin(v.x * 17.31 + v.y * 51.7 + v.z * 29.11 + seed) * 43758.54;
    const n = 1 + ((hash - Math.floor(hash)) - 0.5) * (0.45 + t * 0.25);
    p.setXYZ(i, v.x * n, v.y + ((hash * 7 - Math.floor(hash * 7)) - 0.5) * h * 0.06, v.z * n);
  }
  geo.computeVertexNormals();
  return geo;
}

// ============================================================
export function buildWorld(scene) {
  const colliders = [];
  const updaters = [];
  const world = {
    colliders, updaters, groundHeight, groundHeightNoDeck, isWater, sharedMats,
    vehicleSpawns: [], npcSpots: {}, walkPaths: [],
  };
  function addCollider(x, z, r) { colliders.push({ x, z, r }); }

  // đẩy điểm ra khỏi vật cản — chỉ mục lưới, tự xây lại khi có collider mới (vd NPC thêm sau)
  let colIdx = null, colIdxCount = -1;
  world.resolveCollisions = (p, pr = 0.45) => {
    if (!colIdx || colIdxCount !== colliders.length) {
      colIdx = new Map();
      colIdxCount = colliders.length;
      for (const c of colliders) {
        const k = `${Math.floor(c.x / 48)},${Math.floor(c.z / 48)}`;
        if (!colIdx.has(k)) colIdx.set(k, []);
        colIdx.get(k).push(c);
      }
    }
    const kx = Math.floor(p.x / 48), kz = Math.floor(p.z / 48);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = colIdx.get(`${kx + dx},${kz + dz}`);
        if (!list) continue;
        for (const c of list) {
          const ddx = p.x - c.x, ddz = p.z - c.z;
          const d = Math.hypot(ddx, ddz), min = c.r + pr;
          if (d < min && d > 0.001) {
            p.x = c.x + (ddx / d) * min;
            p.z = c.z + (ddz / d) * min;
          }
        }
      }
    }
  };

  // ---------- Mặt đất (từ lưới đất/biển OSM) ----------
  const W = WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX;
  const D = WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ;
  const CX = (WORLD_BOUNDS.maxX + WORLD_BOUNDS.minX) / 2;
  const CZ = (WORLD_BOUNDS.maxZ + WORLD_BOUNDS.minZ) / 2;
  const geo = new THREE.PlaneGeometry(W, D, 500, 340);
  geo.rotateX(-Math.PI / 2);
  geo.translate(CX, 0, CZ);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const cSand = new THREE.Color(0xeeda9e), cGrass = new THREE.Color(0x83cb6a),
        cGrass2 = new THREE.Color(0x5fae52), cDeep = new THREE.Color(0x6fa393),
        cCity = new THREE.Color(0xcfc7b2), cHill = new THREE.Color(0x4f9a52),
        cPort = new THREE.Color(0xa9a9a4), cRock = new THREE.Color(0x93a086);
  const tmp = new THREE.Color();
  // công viên/thảm cỏ thật từ OSM: tô xanh nền đất
  const parkPolys = PARKS.map((pts) => {
    let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
    for (const [x, z] of pts) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
    return { pts, x1, x2, z1, z2 };
  });
  function inPark(x, z) {
    for (const p of parkPolys) {
      if (x < p.x1 || x > p.x2 || z < p.z1 || z > p.z2) continue;
      let inside = false;
      for (let i = 0, j = p.pts.length - 1; i < p.pts.length; j = i++) {
        const [xi, zi] = p.pts[i], [xj, zj] = p.pts[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  world.inPark = inPark;
  const cPark = new THREE.Color(0x6fbf5a);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeightNoDeck(x, z);
    pos.setY(i, h);
    if (h < -0.6) tmp.copy(cDeep);
    else if (h < 1.1) tmp.copy(cSand);
    else {
      const patch = Math.sin(x * 0.047) * Math.sin(z * 0.041)
                  + 0.6 * Math.sin(x * 0.11 + 1.7) * Math.sin(z * 0.093 + 0.6);
      tmp.copy(cGrass).lerp(cGrass2, smoothstep(-0.5, 0.9, patch));
      tmp.lerp(cHill, smoothstep(4, 12, h));
      tmp.lerp(cRock, smoothstep(12, 22, h));
    }
    tmp.lerp(cCity, rectFactor(x, DT_BOX.x1, DT_BOX.x2, z, DT_BOX.z1, DT_BOX.z2, 40) * 0.8);
    tmp.lerp(cPort, rectFactor(x, LM.port[0] - 95, LM.port[0] + 95, z, LM.port[1] - 45, LM.port[1] + 45, 12) * 0.9);
    tmp.lerp(cCity, rectFactor(x, EXTRAS.catbaTown[0] - 95, EXTRAS.catbaTown[0] + 95, z, EXTRAS.catbaTown[1] - 70, EXTRAS.catbaTown[1] + 70, 16) * 0.7);
    if (h > 1.2 && h < 3.5 && inPark(x, z)) tmp.lerp(cPark, 0.72);
    const hash = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    const noise = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.09;
    colors[i * 3] = tmp.r * noise;
    colors[i * 3 + 1] = tmp.g * noise;
    colors[i * 3 + 2] = tmp.b * noise;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundMesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  groundMesh.name = 'ground';
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---------- Mặt nước ----------
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0x2b9fd4, transparent: true, opacity: 0.86, shininess: 130, specular: 0x99d4ee,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, D, 1, 1), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(CX, 0, CZ);
  water.name = 'water';
  scene.add(water);
  world.waterMat = waterMat;
  updaters.push((dt, time) => { water.position.y = Math.sin(time * 0.8) * 0.06; });

  // ---------- Đường phố THẬT (merge geometry để nhẹ GPU) ----------
  const ROAD_W = { p: 7, s: 6, t: 5, r: 4, w: 3 }; // sát tỉ lệ thật hơn (thực ~4.4 với phố chính)
  const asphaltGeos = [], sidewalkGeos = [], dashGeos = [], pathGeos = [];
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), e4 = new THREE.Euler(), s4 = new THREE.Vector3(1, 1, 1);
  function pushBox(arr, w, h, l, x, y, z, rotY, rotX = 0) {
    const g = new THREE.BoxGeometry(w, h, l);
    e4.set(rotX, rotY, 0);
    q4.setFromEuler(e4);
    m4.compose(new THREE.Vector3(x, y, z), q4, s4);
    g.applyMatrix4(m4);
    arr.push(g);
  }
  function layRoad(pts, wRoad, opts = {}) {
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const segLen = Math.hypot(x2 - x1, z2 - z1);
      if (segLen < 1) continue;
      const rotY = Math.atan2(x2 - x1, z2 - z1);
      // chia nhỏ theo địa hình (đoạn dài qua dốc cầu không bị thành tấm nghiêng khổng lồ)
      const nChunk = Math.max(1, Math.ceil(segLen / 14));
      for (let c = 0; c < nChunk; c++) {
        const t1 = c / nChunk, t2 = (c + 1) / nChunk;
        const cx1 = x1 + (x2 - x1) * t1, cz1 = z1 + (z2 - z1) * t1;
        const cx2 = x1 + (x2 - x1) * t2, cz2 = z1 + (z2 - z1) * t2;
        const len = segLen / nChunk;
        const mx = (cx1 + cx2) / 2, mz = (cz1 + cz2) / 2;
        // dùng địa hình GỐC (không mặt cầu vòm): qua sông thành cầu phẳng 2.04,
        // mặt cầu vòm đã có mô hình riêng vẽ đè lên
        const h1 = Math.max(groundHeightNoDeck(cx1, cz1), LAND_H);
        const h2 = Math.max(groundHeightNoDeck(cx2, cz2), LAND_H);
        if (Math.abs(h1 - h2) > 6) continue; // chỗ gãy bất thường -> bỏ mảnh
        const my = (h1 + h2) / 2 + 0.04;
        const rotX = Math.atan2(h1 - h2, len);
        pushBox(opts.path ? pathGeos : asphaltGeos, wRoad, 0.14, len + 1.2, mx, my, mz, rotY, rotX);
        if (opts.sidewalk) {
          const px = Math.cos(rotY), pz = -Math.sin(rotY);
          for (const side of [-1, 1]) {
            const off = side * (wRoad / 2 + wRoad * 0.14);
            pushBox(sidewalkGeos, wRoad * 0.28, 0.24, len + 1.2,
              mx + off * px, my + 0.02, mz + off * pz, rotY, rotX);
          }
        }
        if (opts.dashes && c % 2 === 0) {
          pushBox(dashGeos, 0.35, 0.05, 2.4, mx, my + 0.09, mz, rotY, rotX);
        }
      }
    }
  }
  for (const r of ROADS_DT) {
    layRoad(r.pts, ROAD_W[r.c], {
      sidewalk: r.c === 'p' || r.c === 's',
      dashes: r.c === 'p' || r.c === 's' || r.c === 't',
      path: r.c === 'w',
    });
  }
  for (const r of ROADS_REGION) layRoad(r.pts, 9, { dashes: true });
  function addMerged(geos, material, name) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  addMerged(asphaltGeos, mat(0x4c5158), 'roads');
  addMerged(sidewalkGeos, mat(0xbcb5a2), 'sidewalks');
  addMerged(dashGeos, mat(0xe8e4d2), 'dashes');
  addMerged(pathGeos, mat(0xc9b896), 'paths');

  // ---------- 1.200+ TÒA NHÀ THẬT (footprint OSM đùn khối, gộp 1 mesh) ----------
  world.buildingCells = new Set();
  {
    const bldGeos = [];
    // chừa chỗ quanh địa danh; trường học là KHUÔN VIÊN rộng nên chừa rộng hơn
    const lmSkip = Object.entries(LM).map(([k, [x, z]]) =>
      [x, z, (k === 'thptnq' || k === 'thcsnq' || k === 'thcstp') ? 38 : 30]);
    const wallPalette = [0xf5e4b8, 0xf0cfa0, 0xdfe8dc, 0xf4b8a0, 0xcfe0ee, 0xf7efc9, 0xe8d0b0, 0xd8c8a8]
      .map((c) => new THREE.Color(c));
    const roofPalette = [0xc24a30, 0x96603c, 0xa84036, 0x8a8f96].map((c) => new THREE.Color(c));
    let nBld = 0;
    for (const b of BUILDINGS) {
      // làm sạch đa giác: bỏ điểm trùng/kề sát (đa giác bẩn làm tam giác hóa nổ tung)
      const poly = [];
      for (const [x, z] of b.p) {
        const last = poly[poly.length - 1];
        if (!last || Math.hypot(x - last[0], z - last[1]) > 0.35) poly.push([x, z]);
      }
      if (poly.length >= 3) {
        const [fx, fz] = poly[0], [lx2, lz2] = poly[poly.length - 1];
        if (Math.hypot(fx - lx2, fz - lz2) < 0.35) poly.pop();
      }
      if (poly.length < 3) continue;
      let cx = 0, cz = 0;
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of poly) {
        cx += x; cz += z;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      cx /= poly.length; cz /= poly.length;
      // chừa chỗ cho mô hình địa danh 3D chi tiết & mặt nước
      if (lmSkip.some(([lx, lz, r]) => (cx - lx) ** 2 + (cz - lz) ** 2 < r * r)) continue;
      if (riverFactor(cx, cz) > 0.01 || Math.abs(groundHeightNoDeck(cx, cz) - LAND_H) > 0.4) continue;
      const hash = Math.abs(Math.floor(cx * 13 + cz * 7));
      const lv = b.l > 0 ? b.l : (b.a < 150 ? 2 + (hash % 3) : 2 + (hash % 2));
      const h = Math.min(46, 3.2 + lv * 2.7);
      try {
        const shape = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)));
        // nhà cao chia nhiều nấc để có vân tầng (dải cửa sổ giả)
        const steps = Math.max(1, Math.ceil(h / 5.5));
        const g2 = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 1, steps });
        g2.rotateX(-Math.PI / 2);
        g2.translate(0, LAND_H, 0);
        const nrm = g2.attributes.normal;
        const posA = g2.attributes.position;
        const cnt = posA.count;
        const cols = new Float32Array(cnt * 3);
        const wall = wallPalette[hash % wallPalette.length];
        const roofC = roofPalette[hash % roofPalette.length];
        const glassy = h > 18; // nhà cao tầng: tông kính xanh xám
        for (let i = 0; i < cnt; i++) {
          const isRoof = nrm.getY(i) > 0.6;
          const c = isRoof ? roofC : wall;
          let shade = isRoof ? 0.95 : 0.84 + 0.16 * Math.abs(nrm.getX(i));
          if (!isRoof) {
            // vân tầng: dải đậm/nhạt xen kẽ theo đúng nấc đùn (không bị nội suy làm nhòe)
            const rowH = h / steps;
            const band = Math.floor(posA.getY(i) / rowH + 0.01) % 2 === 0 ? 1 : 0.82;
            shade *= band;
          }
          if (glassy && !isRoof) {
            cols[i * 3] = 0.45 * shade;
            cols[i * 3 + 1] = 0.56 * shade;
            cols[i * 3 + 2] = 0.64 * shade;
            continue;
          }
          cols[i * 3] = c.r * shade;
          cols[i * 3 + 1] = c.g * shade;
          cols[i * 3 + 2] = c.b * shade;
        }
        g2.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        // chặn geometry "nổ" vượt khung footprint (earcut lỗi với đa giác tự cắt)
        g2.computeBoundingBox();
        const bb = g2.boundingBox;
        if (bb.max.x - bb.min.x > (maxX - minX) + 8 || bb.max.z - bb.min.z > (maxZ - minZ) + 8
          || !isFinite(bb.max.x) || !isFinite(bb.min.x)) {
          g2.dispose();
          continue;
        }
        bldGeos.push(g2);
        addCollider(cx, cz, Math.min(18, Math.sqrt(b.a / Math.PI) * 0.85 + 0.4));
        world.buildingCells.add(`${Math.round(cx / 22)},${Math.round(cz / 22)}`);
        nBld++;
      } catch (e) { /* polygon lỗi -> bỏ qua */ }
    }
    if (bldGeos.length) {
      const merged = mergeGeometries(bldGeos);
      bldGeos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = 'buildings';
      scene.add(mesh);
    }
  }
  function nearRealBuilding(x, z) {
    const kx = Math.round(x / 22), kz = Math.round(z / 22);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (world.buildingCells.has(`${kx + dx},${kz + dz}`)) return true;
      }
    }
    return false;
  }

  // ---------- Nhà phố tự mọc dọc các phố thật (chỉ nơi CHƯA có footprint thật) ----------
  const roofMats = [mat(0xc24a30, { flatShading: true }), mat(0x96603c, { flatShading: true }),
                    mat(0xa84036, { flatShading: true }), mat(0x7d6b58, { flatShading: true })];
  const wallColorsCss = ['#f5e4b8', '#f0cfa0', '#dfe8dc', '#f4b8a0', '#cfe0ee', '#f7efc9'];
  const wallMats = wallColorsCss.map((c) => mat(new THREE.Color(c).getHex()));
  const facadeMats = wallColorsCss.map((c) => {
    const { map, emissiveMap } = facadeTextures(c);
    return new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffcc77, emissiveIntensity: 0 });
  });
  world.facadeMats = facadeMats;
  function house(x, z, w = 8, d = 7, hgt = 6, rotY = 0, wallOverride = null) {
    const g = new THREE.Group();
    const idx = Math.floor(Math.abs(x * 7 + z * 13)) % facadeMats.length;
    const fmat = wallOverride || facadeMats[idx];
    const plain = wallOverride || wallMats[idx];
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), [fmat, fmat, plain, plain, fmat, fmat]);
    body.position.y = hgt / 2;
    g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.6, 4),
      roofMats[Math.floor(Math.abs(x * 3 + z * 5)) % roofMats.length]);
    roof.position.y = hgt + 1.3;
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    g.position.set(x, groundHeight(x, z), z);
    g.rotation.y = rotY;
    scene.add(g);
    addCollider(x, z, Math.max(w, d) * 0.62);
    return g;
  }
  {
    const placed = [];
    const lmPts = Object.values(LM);
    let count = 0;
    outer:
    for (const r of ROADS_DT) {
      if (r.c !== 'r' && r.c !== 't') continue;
      for (let i = 0; i < r.pts.length - 1 && count < 210; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 14; s < len - 8; s += 24) {
          const t = s / len;
          for (const side of [-1, 1]) {
            const hx = x1 + (x2 - x1) * t + side * 7.5 * px;
            const hz = z1 + (z2 - z1) * t + side * 7.5 * pz;
            const hSeed = Math.abs(Math.floor(hx * 3 + hz * 7));
            if (hSeed % 3 === 0) continue; // thưa bớt
            if (Math.abs(groundHeightNoDeck(hx, hz) - LAND_H) > 0.25) continue;
            if (riverFactor(hx, hz) > 0.01) continue;
            if (nearRealBuilding(hx, hz)) continue;
            let ok = true;
            for (const [lx, lz] of lmPts) {
              if ((hx - lx) ** 2 + (hz - lz) ** 2 < 30 * 30) { ok = false; break; }
            }
            if (!ok) continue;
            for (const [ox2, oz2] of placed) {
              if ((hx - ox2) ** 2 + (hz - oz2) ** 2 < 9 * 9) { ok = false; break; }
            }
            if (!ok) continue;
            house(hx, hz, 5 + (hSeed % 3), 5 + (hSeed % 2), 5 + (hSeed % 5), rotY + Math.PI / 2 * side);
            placed.push([hx, hz]);
            count++;
            if (count >= 210) break outer;
          }
        }
      }
    }
  }
  // vài tòa cao tầng khu Lê Hồng Phong (đông trung tâm)
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
  tower(310, -40, 16, 64, 0x9fb8c8);
  tower(360, 60, 14, 46, 0xc8b89a);
  tower(255, 140, 13, 38, 0xa8c0b8);

  const grandMat = (base, trim, opts) => {
    const { map, emissiveMap } = grandFacadeTextures(base, trim, opts);
    const m = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffcc77, emissiveIntensity: 0 });
    facadeMats.push(m);
    return m;
  };

  // Đặt GLB địa danh (từ ảnh thật qua Meshy): scale theo cạnh dài/chiều cao,
  // xoay theo hướng thật, hạ tâm về (x,z), dìm nhẹ chân chống lơ lửng
  function placeGLB({ url, name, x, z, rot = 0, size = 26, bySide = 'max', sink = 0.55, preload = false, radius }) {
    registerModel({
      url, name, x, z, preload, radius,
      place: (m) => {
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const sz = box.getSize(new THREE.Vector3());
        const s = size / (bySide === 'y' ? sz.y : Math.max(sz.x, sz.z));
        m.scale.setScalar(s);
        m.rotation.y = rot;
        m.updateMatrixWorld(true);
        box.setFromObject(m);
        const c = box.getCenter(new THREE.Vector3());
        m.position.x += x - c.x;
        m.position.z += z - c.z;
        m.position.y += LAND_H - box.min.y - sink;
        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mt = o.material;
            if (mt) {
              for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
                if (mt[k]) mt[k].anisotropy = 8;
              }
              mt.envMapIntensity = 0.85;
            }
          }
        });
        scene.add(m);
      },
    });
  }

  // ---------- NHÀ HÁT LỚN: GLB chất lượng gốc, đặt & xoay đúng footprint OSM ----------
  const thOpera = orientLong(LM_DIR.opera, LM_FACE.opera);
  {
    const [opX, opZ] = LM.opera;
    registerModel({
      url: 'assets/nhahat.glb', name: 'Nhà hát lớn', x: opX, z: opZ, preload: true,
      place: (m) => {
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const s = 27 / Math.max(size.x, size.z);
        m.scale.setScalar(s);
        m.rotation.y = thOpera; // trục dài + mặt tiền theo cạnh thật (quay ra quảng trường)
        m.updateMatrixWorld(true);
        box.setFromObject(m);
        const center = box.getCenter(new THREE.Vector3());
        m.position.x += opX - center.x;
        m.position.z += opZ - center.z;
        m.position.y += LAND_H - box.min.y - 0.55; // dìm nhẹ chân, thân nhà không lơ lửng
        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mt = o.material;
            if (mt) {
              for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
                if (mt[key]) mt[key].anisotropy = 8;
              }
              mt.envMapIntensity = 0.85;
            }
          }
        });
        scene.add(m);
        // Chân dung Chủ tịch Hồ Chí Minh trên mặt tiền: dùng ẢNH CHUẨN phủ đè lên
        // hình do AI nướng vào texture (bị méo — TUYỆT ĐỐI không dùng hình AI cho chân dung)
        {
          const tex = new THREE.TextureLoader().load('assets/img_bacho.jpg');
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 8;
          const PH = 5.4, PW = PH * (512 / 664); // giữ đúng tỉ lệ ảnh gốc, không kéo méo
          const grp = new THREE.Group();
          const frame = new THREE.Mesh(new THREE.PlaneGeometry(PW + 0.55, PH + 0.55), mat(0xf5eede));
          grp.add(frame);
          const portrait = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH),
            new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
          portrait.position.z = 0.03;
          grp.add(portrait);
          const halfDepth = (box.max.z - box.min.z) / 2;
          const [px2, pz2] = localPt(opX, opZ, 0, halfDepth + 0.22, thOpera);
          grp.position.set(px2, LAND_H + 7.7, pz2);
          grp.rotation.y = thOpera;
          scene.add(grp);
        }
        const fw = (box.max.x - box.min.x) + 3, fd = (box.max.z - box.min.z) + 3;
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.9, fd), mat(0xcfc5ac));
        plinth.position.set(opX, LAND_H + 0.15, opZ);
        plinth.rotation.y = thOpera;
        plinth.receiveShadow = true;
        scene.add(plinth);
        for (let st = 0; st < 3; st++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.7 - st * 2, 0.3, 1.6), mat(0xd8cdb0));
          const [sx2, sz2] = localPt(opX, opZ, 0, fd / 2 + 1.4 - st * 0.7, thOpera);
          step.position.set(sx2, LAND_H + 0.15 + st * 0.22, sz2);
          step.rotation.y = thOpera;
          step.receiveShadow = true;
          scene.add(step);
        }
      },
    });
    addCollider(LM.opera[0], LM.opera[1], 15);

    // quảng trường: sân lát gạch hoa văn tròn, đài phun nước, cột cờ, bồn hoa
    const paveTex = makeTex(256, 256, (gc, w, h) => {
      gc.fillStyle = '#d9d0b8';
      gc.fillRect(0, 0, w, h);
      speckle(gc, w, h, 300, 0.06);
      gc.strokeStyle = 'rgba(120,105,80,0.5)';
      gc.lineWidth = 2;
      for (let r2 = 14; r2 < 190; r2 += 16) { // vòng gạch đồng tâm
        gc.beginPath(); gc.arc(w / 2, h / 2, r2, 0, Math.PI * 2); gc.stroke();
      }
      for (let a = 0; a < 16; a++) { // nan quạt
        gc.beginPath();
        gc.moveTo(w / 2, h / 2);
        gc.lineTo(w / 2 + Math.cos(a / 16 * Math.PI * 2) * 190, h / 2 + Math.sin(a / 16 * Math.PI * 2) * 190);
        gc.stroke();
      }
    });
    // quảng trường thật (way OSM) nằm trước mặt tiền nhà hát; đài phun nước là node OSM thật
    const pcx = EXTRAS.square[0] + LM_FACE.opera[0] * 9;
    const pcz = EXTRAS.square[1] + LM_FACE.opera[1] * 9;
    const [ftX, ftZ] = EXTRAS.fountain;
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(14, 32),
      new THREE.MeshLambertMaterial({ map: paveTex }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(pcx, LAND_H + 0.06, pcz);
    scene.add(plaza);
    const white2 = mat(0xfdf6e0);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1, 16), white2);
    pool.position.set(ftX, LAND_H + 0.5, ftZ);
    scene.add(pool);
    const poolWater = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 0.9, 16),
      new THREE.MeshLambertMaterial({ color: 0x5ec8e8, transparent: true, opacity: 0.85 }));
    poolWater.position.set(ftX, LAND_H + 0.62, ftZ);
    scene.add(poolWater);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0xeafaff, transparent: true, opacity: 0.7 }));
    jet.position.set(ftX, LAND_H + 3, ftZ);
    scene.add(jet);
    updaters.push((dt, time) => { jet.scale.y = 0.8 + Math.sin(time * 3) * 0.2; });
    addCollider(ftX, ftZ, 5.5);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 16, 6), mat(0xd8d8d8));
    pole.position.set(pcx + 18, LAND_H + 8, pcz - 6);
    scene.add(pole);
    const vnFlag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    vnFlag.position.set(pcx + 20, LAND_H + 14.5, pcz - 6);
    scene.add(vnFlag);
    updaters.push((dt, time) => { vnFlag.rotation.y = Math.sin(time * 1.8) * 0.35; });
    const bedColors = [0xe8402a, 0xf2ce4b, 0xe87ab8, 0xffffff, 0xf28c3a];
    [[pcx - 16, pcz + 12], [pcx + 16, pcz + 10], [pcx - 22, pcz - 2], [pcx + 22, pcz - 2]].forEach(([bx, bz], bi) => {
      const bed = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.2, 0.6, 8), mat(0x9b6b44));
      bed.position.set(bx, LAND_H + 0.3, bz);
      scene.add(bed);
      for (let k = 0; k < 6; k++) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 5, 4), mat(bedColors[(bi + k) % 5], { flatShading: true }));
        fl.position.set(bx + Math.cos(k * 1.05) * 1.2, LAND_H + 0.75, bz + Math.sin(k * 1.05) * 1.2);
        scene.add(fl);
      }
    });
  }

  // ---------- QUÁN HOA: GLB từ ảnh thật, nhân 5 quán dọc cạnh dài thật ----------
  {
    const qhDir = LM_DIR.quanhoa, qhTh = orientFace(LM_FACE.quanhoa);
    registerModel({
      url: 'assets/quanhoa.glb', name: 'Quán hoa',
      x: LM.quanhoa[0], z: LM.quanhoa[1],
      place: (m) => {
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const sz = box.getSize(new THREE.Vector3());
        const s = 5 / Math.max(sz.x, sz.z);
        for (let i = 0; i < 5; i++) {
          const inst = i === 0 ? m : m.clone(true);
          inst.scale.setScalar(s);
          inst.rotation.y = qhTh;
          inst.updateMatrixWorld(true);
          const b2 = new THREE.Box3().setFromObject(inst);
          const c2 = b2.getCenter(new THREE.Vector3());
          const qx = LM.quanhoa[0] + qhDir[0] * (i - 2) * 5.6;
          const qz = LM.quanhoa[1] + qhDir[1] * (i - 2) * 5.6;
          inst.position.x += qx - c2.x;
          inst.position.z += qz - c2.z;
          inst.position.y += LAND_H - b2.min.y - 0.25;
          inst.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
              const mt = o.material;
              if (mt) {
                for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
                  if (mt[k]) mt[k].anisotropy = 8;
                }
                mt.envMapIntensity = 0.85;
              }
            }
          });
          scene.add(inst);
        }
      },
    });
    for (let i = 0; i < 5; i++) {
      addCollider(LM.quanhoa[0] + qhDir[0] * (i - 2) * 5.6, LM.quanhoa[1] + qhDir[1] * (i - 2) * 5.6, 2.1);
    }
  }

  // ---------- TƯỢNG ĐÀI LÊ CHÂN: GLB AI có màu (bệ đá + bảng tên giữ nguyên) ----------
  {
    const g = new THREE.Group();
    const granite = mat(0x9a948a);
    const base = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.9, 8.5), granite);
    base.position.y = 0.45; g.add(base);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.2, 4.6), granite);
    ped.position.y = 3; g.add(ped);
    const pedCap = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.5, 5.2), granite);
    pedCap.position.y = 5.35; g.add(pedCap);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1),
      new THREE.MeshLambertMaterial({ map: signTexture('NỮ TƯỚNG LÊ CHÂN', '#7a7468', '#f5edd8') }));
    plaque.position.set(0, 2.6, 2.32); g.add(plaque);
    g.position.set(LM.lechan[0], LAND_H, LM.lechan[1]);
    scene.add(g);
    addCollider(LM.lechan[0], LM.lechan[1], 4.6);

    registerModel({
      url: 'assets/lechan.glb', name: 'Tượng đài Lê Chân',
      x: LM.lechan[0], z: LM.lechan[1], preload: true,
      place: (m) => {
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const s = 9 / size.y; // tượng cao ~9 (tượng thật 7,5m + chân đế liền khối)
        m.scale.setScalar(s);
        m.updateMatrixWorld(true);
        box.setFromObject(m);
        const center = box.getCenter(new THREE.Vector3());
        m.position.x += LM.lechan[0] - center.x;
        m.position.z += LM.lechan[1] - center.z;
        m.position.y += (LAND_H + 5.6) - box.min.y; // đứng trên mặt bệ đá
        m.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            const mt = o.material;
            if (mt) {
              for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) {
                if (mt[key]) mt[key].anisotropy = 8;
              }
              mt.envMapIntensity = 0.85;
            }
          }
        });
        scene.add(m);
      },
    });
    const expo = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 9), mat(0xeae6da));
    expo.position.set(LM.lechan[0], LAND_H + 4.5, LM.lechan[1] - 14);
    scene.add(expo);
    addCollider(LM.lechan[0], LM.lechan[1] - 14, 9);
  }

  // ---------- NHÀ THỜ CHÍNH TÒA: GLB từ ảnh thật (Wikimedia Commons) ----------
  {
    // trục dài gian giữa theo cạnh dài OSM; tháp chuông (đầu -X của mô hình) quay về hướng mặt tiền thật
    const thCa = orientLong(LM_DIR.cathedral, null) + Math.PI;
    placeGLB({
      url: 'assets/nhatho.glb', name: 'Nhà thờ chính tòa',
      x: LM.cathedral[0], z: LM.cathedral[1], rot: thCa, size: 25,
    });
    addCollider(LM.cathedral[0], LM.cathedral[1], 9);
    const [c1x, c1z] = localPt(LM.cathedral[0], LM.cathedral[1], -11, 0, thCa);
    const [c2x, c2z] = localPt(LM.cathedral[0], LM.cathedral[1], 11, 0, thCa);
    addCollider(c1x, c1z, 7);
    addCollider(c2x, c2z, 7);
  }

  // ---------- BƯU ĐIỆN: GLB từ ảnh thật (Wikimedia Commons) ----------
  {
    // lùi nhẹ khỏi mặt phố (đường trong game vẽ rộng hơn thực tế)
    const poX = LM.postoffice[0] - LM_FACE.postoffice[0] * 4.5;
    const poZ = LM.postoffice[1] - LM_FACE.postoffice[1] * 4.5;
    placeGLB({
      url: 'assets/buudien.glb', name: 'Bưu điện trung tâm',
      x: poX, z: poZ,
      rot: orientLong(LM_DIR.postoffice, LM_FACE.postoffice), size: 23,
    });
    addCollider(poX, poZ, 11);
  }

  // ---------- BẢO TÀNG: GLB từ ảnh thật (tòa nhà vàng kem thật, không phải gạch đỏ) ----------
  placeGLB({
    url: 'assets/baotang.glb', name: 'Bảo tàng Hải Phòng',
    x: LM.museum[0], z: LM.museum[1],
    rot: orientLong(LM_DIR.museum, LM_FACE.museum), size: 17,
  });
  addCollider(LM.museum[0], LM.museum[1], 9);

  // ---------- GA HẢI PHÒNG: GLB từ ảnh thật + đường ray & đoàn tàu phía sau ----------
  {
    placeGLB({
      url: 'assets/ga.glb', name: 'Ga Hải Phòng',
      x: LM.station[0], z: LM.station[1] + 12, rot: 0, size: 26,
    });
    addCollider(LM.station[0], LM.station[1] + 12, 13);
    // sân ga + đường ray + đoàn tàu (sau lưng nhà ga, phía bắc)
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 8), mat(0x8a8f96));
    canopy.position.set(0, 6, -10); g.add(canopy);
    for (const sx of [-12, -4, 4, 12]) {
      const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 6, 6), mat(0x5a5f66));
      cp.position.set(sx, 3, -10); g.add(cp);
    }
    for (const rz of [-14.2, -13.2]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(60, 0.15, 0.25), mat(0x777777));
      rail.position.set(0, 0.35, rz); g.add(rail);
    }
    const sleeper = new THREE.Mesh(new THREE.BoxGeometry(60, 0.2, 1.6), mat(0x5a4632));
    sleeper.position.set(0, 0.2, -13.7); g.add(sleeper);
    const loco = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 2.6), mat(0x2e6fa1));
    loco.position.set(-14, 2.1, -13.7); g.add(loco);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 2.6), mat(0x24557d));
    cab.position.set(-11.5, 4.5, -13.7); g.add(cab);
    for (let i = 0; i < 2; i++) {
      const car = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 2.5), mat(0x8fb03e));
      car.position.set(-4 + i * 9.5, 1.9, -13.7); g.add(car);
    }
    g.position.set(LM.station[0], LAND_H, LM.station[1] + 14);
    scene.add(g);
    addCollider(LM.station[0], LM.station[1] + 2, 12);
  }

  // ---------- CHỢ SẮT (khối lớn xanh xám + tháp tròn góc như tòa nhà thật) ----------
  {
    const g = new THREE.Group();
    const grey = mat(0x8fa3b0);
    const marketFacade = grandMat('#8fa3b0', '#dde5ea', { cols: 8, arch: false });
    const hall = new THREE.Mesh(new THREE.BoxGeometry(28, 13, 18),
      [marketFacade, marketFacade, grey, grey, marketFacade, marketFacade]);
    hall.position.y = 6.5; g.add(hall);
    // tháp tròn ở góc — nét nhận diện của chợ Sắt
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 15, 14), mat(0xa3b5c0));
    drum.position.set(14, 7.5, 9);
    g.add(drum);
    for (let fy = 3.5; fy <= 12.5; fy += 3) {
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(5.3, 5.3, 1, 14), sharedMats.window);
      strip.position.set(14, fy, 9);
      g.add(strip);
    }
    const drumCap = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.7, 14), mat(0x7a8d99));
    drumCap.position.set(14, 15.3, 9);
    g.add(drumCap);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9),
      new THREE.MeshLambertMaterial({ map: signTexture('CHỢ SẮT', '#b03428', '#ffe9b8') }));
    sign.position.set(-2, 11, 9.06); g.add(sign);
    // sạp hàng vỉa hè phía trước
    for (const sx of [-10, -2, 6]) {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 3), mat(0xe8b84d));
      stall.position.set(sx, 1.1, 12.5); g.add(stall);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(3, 1.4, 4), mat(0xd84040, { flatShading: true }));
      canopy.rotation.y = Math.PI / 4;
      canopy.position.set(sx, 3, 12.5); g.add(canopy);
    }
    const thMk = orientLong(LM_DIR.market, LM_FACE.market);
    g.position.set(LM.market[0], LAND_H, LM.market[1]);
    g.rotation.y = thMk;
    scene.add(g);
    addCollider(LM.market[0], LM.market[1], 17);
    const [drX, drZ] = localPt(LM.market[0], LM.market[1], 14, 9, thMk); // tháp tròn góc
    addCollider(drX, drZ, 6);
  }

  // ---------- CẦU HOÀNG VĂN THỤ & CẦU BÍNH (đúng vị trí + trục thật từ way OSM) ----------
  // mọi chi tiết dựng trong tọa độ LOCAL (z = dọc trục cầu), cả nhóm quay theo b.ang
  function bridgeGroup(b) {
    const g = new THREE.Group();
    g.position.set(b.x, 0, b.zc);
    g.rotation.y = b.ang;
    scene.add(g);
    return g;
  }
  function bridgeDeckAndRails(g, b, railColor) {
    const deckMat = mat(0xcfd4da);
    for (let z = -b.half; z <= b.half; z += 4) {
      const tt = z / b.half;
      const y = LAND_H + b.rise * Math.max(0, 1 - tt * tt);
      const seg = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8, 4.4), deckMat);
      seg.position.set(0, y - 0.45, z);
      g.add(seg);
      for (const sx of [-6.6, 6.6]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 4.4), mat(railColor));
        rail.position.set(sx, y + 0.55, z);
        g.add(rail);
      }
    }
  }
  {
    // Cầu Hoàng Văn Thụ: HAI vòm thép đỏ nghiêng vào nhau — dáng "cánh chim biển" thật
    const b = BRIDGES[0];
    const g = bridgeGroup(b);
    bridgeDeckAndRails(g, b, 0xe8524a);
    const red = mat(0xd8402e);
    const TILT = 0.24, RIB_X = 6.2, ARCH_H = 26, AS = 96; // vòm chỉ ôm nhịp chính giữa sông
    for (const s of [-1, 1]) {
      const arcPts = [];
      for (let i = 0; i <= 24; i++) {
        const tt = i / 24;
        arcPts.push(new THREE.Vector3(0, Math.sin(tt * Math.PI) * ARCH_H + 2, (tt - 0.5) * AS));
      }
      const rib = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 32, 0.85, 7), red);
      rib.position.set(s * RIB_X, 0, 0);
      rib.rotation.z = -s * TILT;
      g.add(rib);
    }
    // giằng ngang nối hai đỉnh vòm
    for (const tt of [0.34, 0.5, 0.66]) {
      const y = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const xOff = RIB_X - Math.sin(TILT) * y;
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, xOff * 2 * Math.cos(TILT) + 1, 6), red);
      brace.rotation.z = Math.PI / 2;
      brace.position.set(0, y * Math.cos(TILT), (tt - 0.5) * AS);
      g.add(brace);
    }
    // dây treo từ vòm xuống hai mép mặt cầu
    for (let i = 2; i <= 22; i += 2) {
      const tt = i / 24;
      const topYr = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const zz = (tt - 0.5) * AS;
      const ttd = zz / b.half;
      const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
      for (const s of [-1, 1]) {
        const topY = topYr * Math.cos(TILT);
        const topX = s * (RIB_X - Math.sin(TILT) * topYr);
        const len = Math.hypot(topY - deckY, topX - s * 5.8);
        if (len < 2) continue;
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat(0xe8e0d8));
        cable.position.set((topX + s * 5.8) / 2, (topY + deckY) / 2, zz);
        cable.rotation.z = Math.atan2(topX - s * 5.8, topY - deckY);
        g.add(cable);
      }
    }
  }
  {
    const b = BRIDGES[1];
    const g = bridgeGroup(b);
    bridgeDeckAndRails(g, b, 0x88b8c8);
    for (const dz of [-40, 40]) {
      for (const dx of [-6, 6]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 34, 1.6), mat(0xb8c4c8));
        pylon.position.set(dx, 15, dz);
        g.add(pylon);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.4), mat(0xb8c4c8));
      beam.position.set(0, 28, dz);
      g.add(beam);
      for (let k = 1; k <= 4; k++) {
        for (const dir of [-1, 1]) {
          const zz = dz + dir * k * 12;
          if (Math.abs(zz) > b.half) continue;
          const ttd = zz / b.half;
          const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
          const topY = 30;
          const dzLen = Math.abs(zz - dz);
          const len = Math.hypot(topY - deckY, dzLen);
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat(0xd8e0e4));
          cable.position.set(0, (topY + deckY) / 2, (zz + dz) / 2);
          cable.rotation.x = Math.atan2(dzLen, topY - deckY) * Math.sign(zz - dz);
          g.add(cable);
        }
      }
    }
  }

  // ---------- CẢNG HẢI PHÒNG (vị trí thật từ OSM, neo theo bờ sông Cấm) ----------
  const PORT_X = LM.port[0];
  const portBank = nearestRiverPoint(PORT_X) || [PORT_X, LM.port[1] - 30, 62];
  // dò đúng mép nước tại kinh độ cảng (đỉnh polyline sông có thể lệch xa theo x)
  let quayZ = portBank[1] + portBank[2] / 2 + 7;
  for (let z = LM.port[1]; z > LM.port[1] - 150; z -= 4) {
    if (groundHeightNoDeck(PORT_X, z) < 0) { quayZ = z + 10; break; }
  }
  world.portAnchor = [PORT_X, quayZ + 14];
  {
    const g = new THREE.Group();
    const quay = new THREE.Mesh(new THREE.BoxGeometry(150, 2.4, 12), mat(0x9a9a96));
    quay.position.set(PORT_X, 1.2, quayZ);
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
      c.position.set(x, LAND_H, quayZ + 12);
      c.rotation.y = Math.PI;
      g.add(c);
      addCollider(x, quayZ + 12, 5);
    }
    crane(PORT_X - 50); crane(PORT_X); crane(PORT_X + 50);
    const ctColors = [0xd84040, 0x2e86c1, 0x28a05c, 0xe8a020, 0x8e44ad];
    let ci = 0;
    for (let cx = PORT_X - 60; cx <= PORT_X + 70; cx += 13) {
      for (let cz = quayZ + 24; cz <= quayZ + 40; cz += 8) {
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
  {
    // tàu hàng cập cảng: dò điểm nước sâu ngay ngoài cầu cảng
    let shipZ = quayZ - 26;
    for (let z = quayZ - 8; z > quayZ - 120; z -= 4) {
      if (groundHeightNoDeck(PORT_X - 20, z) < -1.5) { shipZ = z - 8; break; }
    }
    ship(PORT_X - 20, shipZ, 44, 0x24455f, 0xf0f0e8, 0.1);
  }
  ship(1000, -125, 40, 0x555a44, 0xe8e8e0, 0.3);            // tàu ra cửa biển trên sông Cấm
  const seaShip = ship(2650, 1450, 48, 0x7d2b20, 0xe8e8e0); // tàu tuần du ngoài khơi
  updaters.push((dt, time) => {
    const ang = time * 0.02;
    seaShip.position.set(2650 + Math.cos(ang) * 270, Math.sin(time * 0.7) * 0.15, 1450 + Math.sin(ang) * 210);
    seaShip.rotation.y = -ang + Math.PI / 2;
  });

  // ---------- Bến tàu (tự dò bờ) ----------
  function buildPier(x0, z0, dirX, dirZ, len = 34) {
    // kéo dài tới khi đủ sâu
    let endT = len;
    for (let t = 8; t <= 70; t += 4) {
      if (groundHeightNoDeck(x0 + dirX * t, z0 + dirZ * t) < -1.2) { endT = t + 8; break; }
      endT = t + 8;
    }
    const ex = x0 + dirX * endT, ez = z0 + dirZ * endT;
    const midX = (x0 + ex) / 2, midZ = (z0 + ez) / 2;
    const L = Math.hypot(ex - x0, ez - z0);
    const rotY = Math.atan2(ex - x0, ez - z0);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 0.6, L + 4), mat(0x9a7448));
    deck.position.set(midX, LAND_H - 0.25, midZ);
    deck.rotation.y = rotY;
    scene.add(deck);
    for (let t = 4; t < endT; t += 8) {
      for (const off of [-2.6, 2.6]) {
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        const pile = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 7, 6), mat(0x6b4a2e));
        pile.position.set(x0 + dirX * t + off * px, -1.4, z0 + dirZ * t + off * pz);
        scene.add(pile);
      }
    }
    // đăng ký mặt bến (hình chữ nhật bao) cho địa hình
    addPier({
      x0: Math.min(x0, ex) - 4, x1: Math.max(x0, ex) + 4,
      z0: Math.min(z0, ez) - 4, z1: Math.max(z0, ez) + 4,
    });
    return { end: [ex, ez], boatSpot: [x0 + dirX * (endT + 9), z0 + dirZ * (endT + 9)], rotY };
  }

  // Bến Bính (bờ nam sông Cấm, trung tâm)
  const bbBank = nearestRiverPoint(-30) || [-12, -166, 62];
  const bbShoreZ = bbBank[1] + bbBank[2] / 2 + 6;
  const benBinh = buildPier(-24, bbShoreZ, 0, -1);
  world.npcSpots.captain = [-32, bbShoreZ + 14];
  world.vehicleSpawns.push({ type: 'boat', x: benBinh.boatSpot[0], z: benBinh.boatSpot[1], heading: 0 });

  // ---------- ĐỒ SƠN: bãi tắm + Bến Nghiêng + biệt thự Bảo Đại ----------
  {
    const shore = findShore(LM.doson[0], LM.doson[1], 320);
    const umbColors = [0xe8524a, 0x2e86c1, 0xe8a020, 0x28a05c];
    let placedBeach = [];
    if (shore) {
      for (const [bx, bz] of shore.beach) {
        if (placedBeach.some(([px, pz]) => (px - bx) ** 2 + (pz - bz) ** 2 < 20 * 20)) continue;
        placedBeach.push([bx, bz]);
        if (placedBeach.length > 7) break;
      }
      placedBeach.forEach(([ux, uz], i) => {
        const y = groundHeightNoDeck(ux, uz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 6), mat(0xf0f0e8));
        pole.position.set(ux, y + 1.7, uz);
        scene.add(pole);
        const umb = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.3, 8), mat(umbColors[i % 4], { flatShading: true }));
        umb.position.set(ux, y + 3.6, uz);
        scene.add(umb);
      });
      const [pbx, pbz] = shore.pierBase;
      const pier = buildPier(pbx, pbz, shore.seaDir[0], shore.seaDir[1]);
      world.vehicleSpawns.push({ type: 'boat', x: pier.boatSpot[0], z: pier.boatSpot[1], heading: pier.rotY });
      world.npcSpots.fisherman = [pbx - shore.seaDir[0] * 8, pbz - shore.seaDir[1] * 8];
      world.dosonBeach = shore.pierBase;
    }
    // biệt thự Bảo Đại — node OSM thật trên đồi Vụng
    const villaXZ = EXTRAS.baodai;
    const vy = groundHeight(villaXZ[0], villaXZ[1]);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 10), mat(0xf5efd8));
    body.position.y = 3.5; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.5, 3.4, 4), mat(0x8a4030));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 8.6; g.add(roof);
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(18, 0.8, 14), mat(0xd8cdb0));
    terrace.position.y = 0.4; g.add(terrace);
    g.position.set(villaXZ[0], vy, villaXZ[1]);
    scene.add(g);
    addCollider(villaXZ[0], villaXZ[1], 11);
  }

  // ---------- HẢI ĐĂNG HÒN DẤU ----------
  {
    const [hx, hz] = LM.hondau;
    const g = new THREE.Group();
    const y0 = groundHeight(hx, hz);
    // tháp đá bát giác màu nâu xám như hải đăng thật (không sọc đỏ trắng)
    const stone = mat(0x8f8674);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.5, 17, 8), stone);
    tower.position.y = 8.5;
    g.add(tower);
    for (const wy of [5, 9, 13]) { // ô cửa sổ nhỏ dọc thân
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.2), mat(0x3a3f45));
      win.position.set(0, wy, 2.5 - wy * 0.047);
      g.add(win);
    }
    // sảnh chân tháp
    const lodge = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.8, 4), mat(0xd8cfb8));
    lodge.position.set(3.4, 1.4, 0); g.add(lodge);
    const lodgeRoof = new THREE.Mesh(new THREE.ConeGeometry(3.8, 1.6, 4), mat(0x8a4030));
    lodgeRoof.rotation.y = Math.PI / 4;
    lodgeRoof.position.set(3.4, 3.6, 0); g.add(lodgeRoof);
    // ban công quan sát trắng + lan can
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.4, 10), mat(0xf0ead8));
    gallery.position.y = 17.2; g.add(gallery);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 4), mat(0xf0ead8));
      post.position.set(Math.cos(a) * 2.4, 17.9, Math.sin(a) * 2.4);
      g.add(post);
    }
    const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 10),
      new THREE.MeshLambertMaterial({ color: 0xfff0b0, emissive: 0xffdd66, emissiveIntensity: 0.2 }));
    lampRoom.position.y = 19.5;
    g.add(lampRoom);
    world.lighthouseLamp = lampRoom.material;
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.55, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x2f353d));
    cap.position.y = 20.6; g.add(cap);
    const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 4), mat(0x2f353d));
    finial.position.y = 22.6; g.add(finial);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xfff0a8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(7, 90, 10, 1, true), beamMat);
    beam.geometry.translate(0, -45, 0);
    beam.rotation.z = Math.PI / 2 - 0.06;
    beam.position.y = 19.5;
    const beamPivot = new THREE.Group();
    beamPivot.add(beam);
    g.add(beamPivot);
    world.lighthouseBeam = { pivot: beamPivot, mat: beamMat };
    updaters.push((dt, time) => { beamPivot.rotation.y = time * 0.5; });
    g.position.set(hx, y0, hz);
    scene.add(g);
    addCollider(hx, hz, 3.2);
    buildPier(hx - 14, hz + 4, -1, 0.25);
    for (const [tx, tz] of [[hx - 10, hz - 12], [hx + 14, hz - 6], [hx + 6, hz + 14]]) {
      const ty = groundHeightNoDeck(tx, tz);
      if (ty < 1) continue;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 4, 6), sharedMats.trunk);
      trunk.position.set(tx, ty + 2, tz);
      scene.add(trunk);
      const leaf = new THREE.Mesh(canopyGeo(3, tx + tz), sharedMats.leafDark);
      leaf.position.set(tx, ty + 5.5, tz);
      scene.add(leaf);
    }
  }

  // ---------- CÁT BÀ: thị trấn + bến + núi đá Lan Hạ (tâm thị trấn thật từ OSM) ----------
  const CBT = EXTRAS.catbaTown;
  {
    const rowColors = [0xf2ce6b, 0x6fbde8, 0xe87a6a, 0x8fd0a0, 0xf4b8d0, 0xb8a8e8, 0xf28c3a, 0x9fd8d8];
    for (let i = 0; i < 8; i++) {
      const x = CBT[0] - 33 + i * 9.5;
      const rz = CBT[1] - 20;
      const hgt = 10 + (i * 3) % 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(8, hgt, 9), mat(rowColors[i]));
      b.position.set(x, LAND_H + hgt / 2, rz);
      scene.add(b);
      for (let fy = 3; fy < hgt - 1; fy += 3.2) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.15), sharedMats.window);
        win.position.set(x, LAND_H + fy, rz + 4.6);
        scene.add(win);
      }
      addCollider(x, rz, 5.8);
    }
    const shore = findShore(CBT[0], CBT[1] + 45, 220);
    if (shore) {
      const pier = buildPier(shore.pierBase[0], shore.pierBase[1], shore.seaDir[0], shore.seaDir[1]);
      world.catbaPier = pier;
      let placed = [];
      for (const [bx, bz] of shore.beach) {
        if (placed.some(([px2, pz2]) => (px2 - bx) ** 2 + (pz2 - bz) ** 2 < 18 * 18)) continue;
        placed.push([bx, bz]);
        if (placed.length > 6) break;
      }
      for (const [px2, pz2] of placed) palm(px2, pz2);
    }
    world.npcSpots.catba = [CBT[0] - 25, CBT[1] - 5];
  }

  // núi đá vôi: rải theo lưới đất/biển thật của quần đảo
  {
    const karstMat = mat(0x93a284, { flatShading: true });
    const karstTop = mat(0x53a04c, { flatShading: true });
    let nKarst = 0;
    for (let x = 3600; x <= 5500 && nKarst < 150; x += 44) {
      for (let z = 700; z <= 2540 && nKarst < 150; z += 44) {
        const hash = Math.abs(Math.sin(x * 1.37 + z * 2.91) * 43758.54) % 1;
        const jx = x + (hash - 0.5) * 32, jz = z + (hash * 7 % 1 - 0.5) * 32;
        if (jx > CBT[0] - 115 && jx < CBT[0] + 115 && jz > CBT[1] - 90 && jz < CBT[1] + 90) continue; // chừa thị trấn
        const v = landAt(jx, jz);
        if (v > 0.75 && hash < 0.32) { // núi trên đảo lớn
          const r = 16 + hash * 22, h = 34 + hash * 34;
          const y = groundHeightNoDeck(jx, jz);
          const rock = new THREE.Mesh(karstGeo(r, h, jx + jz), karstMat);
          rock.position.set(jx, y + h / 2 - 0.6, jz);
          scene.add(rock);
          const top = new THREE.Mesh(canopyGeo(r * 0.45, jx * 2 + jz), karstTop);
          top.position.set(jx, y + h - 0.5, jz);
          scene.add(top);
          addCollider(jx, jz, r * 0.75);
          nKarst++;
        } else if (v > 0.06 && v < 0.62 && hash > 0.45) { // đảo đá vôi giữa vịnh Lan Hạ
          const r = 8 + hash * 14, h = 16 + hash * 26;
          const rock = new THREE.Mesh(karstGeo(r, h, jx + jz), karstMat);
          rock.position.set(jx, -3 + h / 2, jz);
          scene.add(rock);
          const top = new THREE.Mesh(canopyGeo(r * 0.42, jx + jz * 3), karstTop);
          top.position.set(jx, -3 + h - 0.5, jz);
          scene.add(top);
          addCollider(jx, jz, r * 0.75);
          nKarst++;
        }
      }
    }
  }

  // ---------- Cây phượng dải trung tâm + đèn đường (dọc phố thật) ----------
  function phuongTree(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.55, 4.2, 6), sharedMats.trunk);
    trunk.position.y = 2.1; g.add(trunk);
    const blobs = [[0, 5.2, 0, 2.7], [-1.6, 4.6, 0.9, 1.7], [1.5, 4.8, -0.8, 1.8], [0.4, 6.2, 0.8, 1.6]];
    blobs.forEach(([bx, by, bz, br], i) => {
      const leaf = new THREE.Mesh(canopyGeo(br, x * 3.1 + z * 1.7 + i),
        i % 2 === 0 ? sharedMats.leafGreen : sharedMats.leafGreen2);
      leaf.position.set(bx, by, bz);
      g.add(leaf);
    });
    for (const [fx, fy, fz] of [[-1.6, 5.7, 0.9], [1.4, 6, -0.7], [0.2, 6.9, 1], [-0.9, 5.3, -1.5], [1.8, 5.4, 1.1]]) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 4), sharedMats.flower);
      fl.position.set(fx, fy, fz);
      g.add(fl);
    }
    g.position.set(x, y, z);
    g.rotation.y = x * 1.3 + z;
    scene.add(g);
    addCollider(x, z, 0.8);
  }
  function palm(x, z) {
    const g = new THREE.Group();
    const y = groundHeightNoDeck(x, z);
    if (y < 0.7) return;
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
  {
    // phượng + đèn dọc các trục trung tâm gần Nhà hát lớn
    const lmPts = Object.values(LM);
    let nTree = 0, nLamp = 0, sideFlip = 1;
    for (const r of ROADS_DT) {
      if (r.c !== 's' && r.c !== 'p') continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        if (mx * mx + mz * mz > 300 * 300) continue;
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 20; s < len; s += 46) {
          const t = s / len;
          sideFlip = -sideFlip;
          const off = sideFlip * (ROAD_W[r.c] / 2 + 3.4);
          const tx = x1 + (x2 - x1) * t + off * px;
          const tz = z1 + (z2 - z1) * t + off * pz;
          if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.3) continue;
          if (lmPts.some(([lx, lz]) => (tx - lx) ** 2 + (tz - lz) ** 2 < 24 * 24)) continue;
          if (nTree <= nLamp * 1.6 && nTree < 46) {
            phuongTree(tx, tz);
            nTree++;
          } else if (nLamp < 30) {
            const y = groundHeight(tx, tz);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5, 6), mat(0x38424a));
            pole.position.set(tx, y + 2.5, tz);
            scene.add(pole);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), sharedMats.lampGlow);
            bulb.position.set(tx, y + 5.2, tz);
            scene.add(bulb);
            nLamp++;
          }
        }
      }
    }
  }

  // ---------- CÂY THẬT từ OSM (node natural=tree) + cây trong công viên thật ----------
  {
    const lmPts = Object.values(LM);
    let nReal = 0;
    const freeSpot = (x, z) => {
      const p = { x, z };
      world.resolveCollisions(p, 0.5);
      return Math.hypot(p.x - x, p.z - z) < 0.3;
    };
    for (const [tx, tz] of TREES) {
      if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.4) continue;
      if (riverFactor(tx, tz) > 0.01) continue;
      if (lmPts.some(([lx, lz]) => (tx - lx) ** 2 + (tz - lz) ** 2 < 18 * 18)) continue;
      if (!freeSpot(tx, tz)) continue;
      const hash = Math.abs(Math.floor(tx * 7 + tz * 13));
      if (hash % 5 === 0) palm(tx, tz);
      else phuongTree(tx, tz);
      nReal++;
    }
    // rải thêm cây trong các công viên thật (lưới + jitter, thưa)
    let nPark = 0;
    for (const p of (PARKS || [])) {
      let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
      for (const [x, z] of p) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
      for (let gx = x1 + 8; gx < x2 && nPark < 90; gx += 17) {
        for (let gz = z1 + 8; gz < z2 && nPark < 90; gz += 17) {
          const hash = Math.abs(Math.sin(gx * 2.17 + gz * 3.31) * 43758.54) % 1;
          if (hash > 0.55) continue;
          const jx = gx + (hash - 0.5) * 8, jz = gz + (hash * 7 % 1 - 0.5) * 8;
          if (!world.inPark(jx, jz)) continue;
          if (Math.abs(groundHeightNoDeck(jx, jz) - LAND_H) > 0.4) continue;
          if (riverFactor(jx, jz) > 0.01) continue;
          if (lmPts.some(([lx, lz]) => (jx - lx) ** 2 + (jz - lz) ** 2 < 18 * 18)) continue;
          if (!freeSpot(jx, jz)) continue;
          if (hash < 0.12) palm(jx, jz); else phuongTree(jx, jz);
          nPark++;
        }
      }
    }
  }

  // ---------- 3 TRƯỜNG HỌC THẬT (footprint OSM) ----------
  // THPT Ngô Quyền (trường Bonnal): GLB từ ảnh thật — cổng + dãy nhà vàng
  placeGLB({
    url: 'assets/thptnq.glb', name: 'THPT Ngô Quyền',
    x: LM.thptnq[0], z: LM.thptnq[1],
    rot: orientLong(LM_DIR.thptnq, LM_FACE.thptnq), size: 22,
  });
  addCollider(LM.thptnq[0], LM.thptnq[1], 9);
  // 2 trường THCS: khối lớp chữ U + sân + cột cờ + cổng bảng tên (chưa có ảnh kiến trúc đạt chuẩn)
  function schoolCompound(key, label) {
    const [sx, sz] = LM[key];
    const th = orientLong(LM_DIR[key], LM_FACE[key]);
    const g = new THREE.Group();
    const wallM = mat(0xf2d488);
    const trimM = mat(0xfdf6e0);
    function block(w, d, floors, lx, lz, rotL = 0) {
      const hgt = 3.4 * floors + 0.6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), wallM);
      b.position.set(lx, hgt / 2, lz);
      b.rotation.y = rotL;
      g.add(b);
      for (let f = 0; f < floors; f++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(w + 0.14, 1.2, d + 0.14), sharedMats.window);
        strip.position.set(lx, 2.2 + f * 3.4, lz);
        strip.rotation.y = rotL;
        g.add(strip);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, 0.5, d + 0.8), mat(0xb0543c));
      roof.position.set(lx, hgt + 0.25, lz);
      roof.rotation.y = rotL;
      g.add(roof);
    }
    block(24, 7, 3, 0, -7);        // dãy chính (song song mặt phố, lùi sâu)
    block(7, 12, 2, -10, 3);       // cánh trái
    block(7, 12, 2, 10, 3);        // cánh phải
    // sân trường + cột cờ
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(22, 12), mat(0xcabfa8));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(0, 0.06, 4);
    g.add(yard);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 9, 6), mat(0xd8d8d8));
    pole.position.set(0, 4.5, 2); g.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    fl.position.set(1.1, 8.2, 2); g.add(fl);
    updaters.push((dt, time) => { fl.rotation.y = Math.sin(time * 1.7 + sx) * 0.35; });
    // cổng + bảng tên quay ra phố (local +z)
    for (const gx of [-3.4, 3.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.6, 0.9), trimM);
      post.position.set(gx, 1.8, 11); g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.2, 1),
      new THREE.MeshLambertMaterial({ map: signTexture(label, '#28457d', '#ffe9b8') }));
    lintel.position.set(0, 3.9, 11); g.add(lintel);
    // tường rào thấp hai bên cổng
    for (const side of [-1, 1]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(9, 1.4, 0.4), wallM);
      fence.position.set(side * 8.4, 0.7, 11); g.add(fence);
    }
    g.position.set(sx, LAND_H, sz);
    g.rotation.y = th;
    scene.add(g);
    addCollider(sx, sz, 3);
    const [b1x, b1z] = localPt(sx, sz, 0, -7, th);
    addCollider(b1x, b1z, 12);
    for (const wingX of [-10, 10]) {
      const [wx, wz] = localPt(sx, sz, wingX, 3, th);
      addCollider(wx, wz, 5.5);
    }
  }
  schoolCompound('thcsnq', 'THCS NGÔ QUYỀN');
  schoolCompound('thcstp', 'THCS TRẦN PHÚ');

  // ghế đá ven hồ Tam Bạc + quảng trường
  {
    const woodMat = mat(0x6a4a30);
    function bench(x, z, rotY) {
      const b = new THREE.Group();
      const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), woodMat);
      seat.position.y = 0.55; b.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.1), woodMat);
      back.position.set(0, 0.95, -0.28); b.add(back);
      for (const lx of [-0.9, 0.9]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 0.5), mat(0x3a3f45));
        leg.position.set(lx, 0.28, 0); b.add(leg);
      }
      b.position.set(x, groundHeight(x, z), z);
      b.rotation.y = rotY;
      scene.add(b);
    }
    // ven hồ Tam Bạc (bờ nam, ngoài lòng hồ đào) + mép quảng trường Nhà hát lớn
    bench(LM.lake[0] - 20, LM.lake[1] + 33, 0); bench(LM.lake[0], LM.lake[1] + 34, 0); bench(LM.lake[0] + 20, LM.lake[1] + 35, 0);
    const [ftX2, ftZ2] = EXTRAS.fountain;
    bench(ftX2 - 12, ftZ2 + 10, Math.PI); bench(ftX2 + 12, ftZ2 + 10, Math.PI);
  }

  // ---------- Hoa phượng nhặt (nhiệm vụ) ----------
  const flowerPickups = [];
  const pickupMat = new THREE.MeshLambertMaterial({
    color: 0xff4d30, emissive: 0xff3010, emissiveIntensity: 0.9,
  });
  // tự tìm 10 chỗ trống dọc phố trung tâm (không dính nhà, không dưới nước)
  const flowerSpots = [];
  {
    const tryAdd = (x, z) => {
      if (flowerSpots.length >= 10) return;
      if (Math.abs(groundHeightNoDeck(x, z) - LAND_H) > 0.3) return;
      const p = { x, z };
      world.resolveCollisions(p, 0.7);
      if (Math.hypot(p.x - x, p.z - z) > 0.05) return; // dính vật cản
      if (flowerSpots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < 42 * 42)) return;
      flowerSpots.push([x, z]);
    };
    for (const r of ROADS_DT) {
      if (flowerSpots.length >= 10) break;
      if (r.c !== 's' && r.c !== 't' && r.c !== 'w') continue;
      for (let i = 0; i < r.pts.length - 1 && flowerSpots.length < 10; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        if (mx * mx + mz * mz > 280 * 280) continue;
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        tryAdd(mx + Math.cos(rotY) * 7.5, mz - Math.sin(rotY) * 7.5);
      }
    }
  }
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

  // ---------- Mây, hải âu ----------
  const clouds = [];
  for (let i = 0; i < 18; i++) {
    const c = new THREE.Group();
    const nBlob = 3 + (i % 3);
    for (let k = 0; k < nBlob; k++) {
      const r = 8 + ((i * 5 + k * 3) % 9);
      const blob = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), sharedMats.cloud);
      blob.position.set(k * r * 1.1 - nBlob * 3, (k % 2) * 2.5, ((k * 7) % 5) - 2);
      blob.scale.set(1.7, 0.55, 1);
      c.add(blob);
    }
    c.position.set(
      WORLD_BOUNDS.minX + ((i * 397) % (WORLD_BOUNDS.maxX - WORLD_BOUNDS.minX)),
      130 + (i * 13) % 60,
      WORLD_BOUNDS.minZ + ((i * 691) % (WORLD_BOUNDS.maxZ - WORLD_BOUNDS.minZ))
    );
    scene.add(c);
    clouds.push(c);
  }
  updaters.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * 2.2;
      if (c.position.x > WORLD_BOUNDS.maxX + 100) c.position.x = WORLD_BOUNDS.minX - 100;
    }
  });
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
  gullFlock(portBank[0] + 100, portBank[1], 6);
  gullFlock(LM.doson[0] + 180, LM.doson[1] + 60, 5);
  gullFlock(CBT[0] + 45, CBT[1] + 90, 5);

  // ---------- Xe & NPC mặc định (bám các mốc thật) ----------
  world.vehicleSpawns.push({ type: 'motorbike', x: LM.opera[0] + 32, z: LM.opera[1] + 4, heading: Math.PI / 2 });
  world.vehicleSpawns.push({ type: 'cyclo', x: LM.lechan[0] + 14, z: LM.lechan[1] + 8, heading: Math.PI / 2 });
  world.npcSpots.guide = [EXTRAS.fountain[0] + 9, EXTRAS.fountain[1] + 5];
  world.npcSpots.coba = [LM.lake[0] - 8, LM.lake[1] + 34];
  world.npcSpots.xichlo = [LM.quanhoa[0] - 14, LM.quanhoa[1] + 10];
  world.npcSpots.florist = [LM.quanhoa[0] + 6, LM.quanhoa[1] - 1];

  // ---------- Nhãn chữ nổi ----------
  world.makeTextSprite = function makeTextSprite(text, opts = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${opts.size || 44}px 'Segoe UI', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 8;
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
