import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import {
  WORLD_BOUNDS, LM, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BRIDGES, BUILDINGS,
  groundHeight, groundHeightNoDeck, isWater, landAt, riverFactor,
  nearestRiverPoint, findShore, addPier,
} from './terrain.js';

// Thế giới dựng từ dữ liệu OpenStreetMap thật của Hải Phòng (tỉ lệ 1:10,
// trung tâm phóng đại 2.2x). Mọi con phố trung tâm là phố thật.
export { groundHeight, groundHeightNoDeck, isWater, landAt, WORLD_BOUNDS, LM };

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
    tmp.lerp(cPort, rectFactor(x, 130, 320, z, -195, -120, 12) * 0.9);
    tmp.lerp(cCity, rectFactor(x, 4400, 4580, z, 1660, 1785, 16) * 0.7);
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
  const ROAD_W = { p: 11, s: 9, t: 7.5, r: 5.5, w: 4 };
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
  for (const r of ROADS_REGION) layRoad(r.pts, 12, { dashes: true });
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
    const lmSkip = Object.values(LM);
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
      if (lmSkip.some(([lx, lz]) => (cx - lx) ** 2 + (cz - lz) ** 2 < 30 * 30)) continue;
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
      for (let i = 0; i < r.pts.length - 1 && count < 130; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 18; s < len - 10; s += 34) {
          const t = s / len;
          for (const side of [-1, 1]) {
            const hx = x1 + (x2 - x1) * t + side * 9.5 * px;
            const hz = z1 + (z2 - z1) * t + side * 9.5 * pz;
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
              if ((hx - ox2) ** 2 + (hz - oz2) ** 2 < 13 * 13) { ok = false; break; }
            }
            if (!ok) continue;
            house(hx, hz, 6.5 + (hSeed % 4), 6 + (hSeed % 3), 5 + (hSeed % 6), rotY + Math.PI / 2 * side);
            placed.push([hx, hz]);
            count++;
            if (count >= 130) break outer;
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

  // ---------- NHÀ HÁT LỚN: mô hình 3D chi tiết (GLB nén meshopt, do người dùng cung cấp) ----------
  {
    const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    gltfLoader.load('assets/nhahat.glb', (gltf) => {
      const m = gltf.scene;
      // xoay mặt tiền về phía quảng trường (hướng nam +z), chỉnh sau khi soi thực tế
      m.rotation.y = 0;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const s = 34 / Math.max(size.x, size.z); // cạnh dài = 34 (cỡ nhà hát thật trong game)
      m.scale.setScalar(s);
      m.updateMatrixWorld(true);
      box.setFromObject(m);
      const center = box.getCenter(new THREE.Vector3());
      m.position.x += 4 - center.x;
      m.position.z += -22 - center.z;
      m.position.y += LAND_H - box.min.y;
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      scene.add(m);
    });
    addCollider(4, -22, 20);

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
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(24, 32),
      new THREE.MeshLambertMaterial({ map: paveTex }));
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(8, LAND_H + 0.06, 16);
    scene.add(plaza);
    const white2 = mat(0xfdf6e0);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 1, 16), white2);
    pool.position.set(12, LAND_H + 0.5, 14);
    scene.add(pool);
    const poolWater = new THREE.Mesh(new THREE.CylinderGeometry(5.9, 5.9, 0.9, 16),
      new THREE.MeshLambertMaterial({ color: 0x5ec8e8, transparent: true, opacity: 0.85 }));
    poolWater.position.set(12, LAND_H + 0.62, 14);
    scene.add(poolWater);
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.7, 4, 8),
      new THREE.MeshLambertMaterial({ color: 0xeafaff, transparent: true, opacity: 0.7 }));
    jet.position.set(12, LAND_H + 3, 14);
    scene.add(jet);
    updaters.push((dt, time) => { jet.scale.y = 0.8 + Math.sin(time * 3) * 0.2; });
    addCollider(12, 14, 7);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 16, 6), mat(0xd8d8d8));
    pole.position.set(26, LAND_H + 8, 10);
    scene.add(pole);
    const vnFlag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    vnFlag.position.set(28, LAND_H + 14.5, 10);
    scene.add(vnFlag);
    updaters.push((dt, time) => { vnFlag.rotation.y = Math.sin(time * 1.8) * 0.35; });
    const bedColors = [0xe8402a, 0xf2ce4b, 0xe87ab8, 0xffffff, 0xf28c3a];
    [[-6, 30], [22, 28], [-8, 4], [26, -2]].forEach(([bx, bz], bi) => {
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

  // ---------- QUÁN HOA ----------
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    for (const [cx, cz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.2, 6), mat(0x5a3a22));
      col.position.set(cx, 1.6, cz);
      g.add(col);
    }
    const roof1 = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.5, 4), mat(0x8a4030, { flatShading: true }));
    roof1.rotation.y = Math.PI / 4;
    roof1.position.y = 3.9;
    g.add(roof1);
    const roofTip = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), mat(0x6d3226));
    roofTip.rotation.y = Math.PI / 4;
    roofTip.position.y = 4.9;
    g.add(roofTip);
    for (let k = 0; k < 6; k++) {
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.32, 5, 4),
        mat([0xe8402a, 0xf2ce4b, 0xe87ab8, 0xffffff, 0xb85ae8, 0xf28c3a][k], { flatShading: true }));
      fl.position.set(-1 + (k % 3), 1.1, -0.8 + Math.floor(k / 3) * 1.6);
      g.add(fl);
    }
    const table = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 2.6), mat(0x8a6a45));
    table.position.y = 0.35;
    g.add(table);
    g.position.set(-42 + i * 8, LAND_H, -8);
    scene.add(g);
    addCollider(-42 + i * 8, -8, 2.4);
  }

  // ---------- TƯỢNG ĐÀI LÊ CHÂN (dáng đồng mềm mại, bệ đá 2 cấp, bảng tên) ----------
  {
    const g = new THREE.Group();
    const bronze = mat(0x4f5a44, { flatShading: false }); // đồng xanh rêu như tượng thật
    const granite = mat(0x9a948a);
    // bệ 2 cấp
    const base = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.9, 8.5), granite);
    base.position.y = 0.45; g.add(base);
    const ped = new THREE.Mesh(new THREE.BoxGeometry(4.6, 4.2, 4.6), granite);
    ped.position.y = 3; g.add(ped);
    const pedCap = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.5, 5.2), granite);
    pedCap.position.y = 5.35; g.add(pedCap);
    const plaque = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1),
      new THREE.MeshLambertMaterial({ map: signTexture('NỮ TƯỚNG LÊ CHÂN', '#7a7468', '#f5edd8') }));
    plaque.position.set(0, 2.6, 2.32); g.add(plaque);
    // thân áo dài + vạt choàng: đường lathe mềm
    const profile = [
      [2.05, 0], [1.9, 0.5], [1.5, 1.6], [1.05, 3.0], [0.78, 4.2],
      [0.72, 4.9], [0.88, 5.5], [0.82, 6.1], [0.6, 6.5], [0.3, 6.7],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const robe = new THREE.Mesh(new THREE.LatheGeometry(profile, 18), bronze);
    robe.position.y = 5.6; g.add(robe);
    // vai + hai tay hơi dang (thế tượng thật)
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 2.2, 4, 8), bronze);
      arm.position.set(s * 1.05, 10.6, 0.15);
      arm.rotation.z = s * 0.42;
      arm.rotation.x = -0.12;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), bronze);
      hand.position.set(s * 1.62, 9.55, 0.34);
      g.add(hand);
    }
    // đầu, búi tóc, vành khăn
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 10), bronze);
    head.scale.set(1, 1.12, 1);
    head.position.y = 12.5; g.add(head);
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), bronze);
    bun.position.set(0, 13.15, -0.28); g.add(bun);
    // đốc kiếm bên hông trái
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.34), bronze);
    sword.position.set(-0.95, 8.6, 0.55);
    sword.rotation.z = 0.18;
    g.add(sword);
    // vạt áo choàng bay nhẹ phía sau
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(1.5, 6.4, 10, 1, true), bronze);
    cloak.scale.set(1, 1, 0.55);
    cloak.position.set(0, 8.8, -0.85);
    cloak.rotation.x = 0.16;
    g.add(cloak);
    g.position.set(LM.lechan[0], LAND_H, LM.lechan[1]);
    scene.add(g); // mặt tượng nhìn về hướng nam (phía biển hiệu & dải trung tâm)
    addCollider(LM.lechan[0], LM.lechan[1], 4.6);
    const expo = new THREE.Mesh(new THREE.BoxGeometry(24, 9, 11), mat(0xeae6da));
    expo.position.set(LM.lechan[0], LAND_H + 4.5, LM.lechan[1] - 14);
    scene.add(expo);
    addCollider(LM.lechan[0], LM.lechan[1] - 14, 13);
  }

  // ---------- NHÀ THỜ CHÍNH TÒA ----------
  {
    const g = new THREE.Group();
    const cream = mat(0xe6cd96); // vàng kem như nhà thờ thật
    const white = mat(0xfdf6e0);
    const nave = new THREE.Mesh(new THREE.BoxGeometry(12, 9, 24), cream);
    nave.position.y = 4.5; g.add(nave);
    for (const sz of [-8, -2, 4]) { // trụ tường bên hông
      for (const sx of [-6.2, 6.2]) {
        const butt = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8, 1.2), white);
        butt.position.set(sx, 4, sz);
        g.add(butt);
      }
    }
    const naveRoof = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, 24, 3), mat(0x7d5040));
    naveRoof.rotation.z = Math.PI / 2;
    naveRoof.rotation.y = Math.PI / 2;
    naveRoof.scale.x = 0.8;
    naveRoof.position.y = 10.5; g.add(naveRoof);
    const belfry = new THREE.Mesh(new THREE.BoxGeometry(6, 16, 6), cream);
    belfry.position.set(0, 8, 14); g.add(belfry);
    for (const sx of [-3, 3]) { // viền góc trắng tháp chuông
      for (const sz2 of [11.2, 16.8]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(0.6, 16, 0.6), white);
        trim.position.set(sx, 8, sz2 - 14 + 14);
        trim.position.z = sz2;
        g.add(trim);
      }
    }
    const louvre = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4, 0.3), mat(0x6b5a40));
    louvre.position.set(0, 12.5, 17.1); g.add(louvre);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(4, 8, 8), mat(0x5a5a62, { flatShading: true }));
    spire.position.set(0, 20, 14); g.add(spire);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), mat(0xf2ce6b));
    cross.position.set(0, 25.2, 14); g.add(cross);
    const crossArm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.3), mat(0xf2ce6b));
    crossArm.position.set(0, 25.6, 14); g.add(crossArm);
    const rose = new THREE.Mesh(new THREE.CircleGeometry(1.6, 12),
      mat(0x4a7ab8, { emissive: 0x3a5a98, emissiveIntensity: 0.3 }));
    rose.position.set(0, 9, 17.05); g.add(rose);
    g.position.set(LM.cathedral[0], LAND_H, LM.cathedral[1] - 12);
    scene.add(g);
    addCollider(LM.cathedral[0], LM.cathedral[1] - 12, 10);
    addCollider(LM.cathedral[0], LM.cathedral[1] + 2, 5);
  }

  // ---------- BƯU ĐIỆN ----------
  {
    const g = new THREE.Group();
    const postFacade = grandMat('#f0c868', '#fdf6e0', { cols: 6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 10),
      [postFacade, postFacade, mat(0xf0c868), mat(0xf0c868), postFacade, postFacade]);
    body.position.y = 4.5; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(23, 1.4, 11), mat(0x7d5040));
    roof.position.y = 9.7; g.add(roof);
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.1, 16), mat(0xfffbe8));
    clockFace.position.set(0, 11.2, 5.05); g.add(clockFace);
    const clockBox = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 1.4), mat(0xf0c868));
    clockBox.position.set(0, 11.2, 4.2); g.add(clockBox);
    g.position.set(LM.postoffice[0] + 6, LAND_H, LM.postoffice[1] + 8);
    g.rotation.y = Math.PI;
    scene.add(g);
    addCollider(LM.postoffice[0] + 6, LM.postoffice[1] + 8, 12);
  }

  // ---------- BẢO TÀNG ----------
  {
    const g = new THREE.Group();
    const brick = mat(0xa8503c);
    const brickFacade = grandMat('#a8503c', '#f0e4d0', { cols: 5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(18, 8, 12),
      [brickFacade, brickFacade, brick, brick, brickFacade, brickFacade]);
    body.position.y = 4; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(11.5, 4.5, 4), mat(0x5a3a30));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 10.2; g.add(roof);
    for (const sx of [-6, 6]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 6.5, 13),
        [brickFacade, brickFacade, brick, brick, brickFacade, brickFacade]);
      wing.position.set(sx + Math.sign(sx) * 6.5, 3.25, 0); g.add(wing);
    }
    g.position.set(LM.museum[0] - 4, LAND_H, LM.museum[1] - 10);
    scene.add(g);
    addCollider(LM.museum[0] - 4, LM.museum[1] - 10, 14);
  }

  // ---------- GA HẢI PHÒNG ----------
  {
    const g = new THREE.Group();
    const stationFacade = grandMat('#f2ce6b', '#fdf6e0', { cols: 6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 8, 10),
      [stationFacade, stationFacade, mat(0xf2ce6b), mat(0xf2ce6b), stationFacade, stationFacade]);
    body.position.y = 4; g.add(body);
    const center = new THREE.Mesh(new THREE.BoxGeometry(8, 11, 11), mat(0xf2ce6b));
    center.position.y = 5.5; g.add(center);
    const roofC = new THREE.Mesh(new THREE.ConeGeometry(6.5, 3, 4), mat(0x7d5040));
    roofC.rotation.y = Math.PI / 4; roofC.position.y = 12.4; g.add(roofC);
    const roofB = new THREE.Mesh(new THREE.BoxGeometry(27, 1.2, 11), mat(0x7d5040));
    roofB.position.y = 8.5; g.add(roofB);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.6, 0.2), mat(0x6d4a2e));
    door.position.set(0, 2.6, 5.6); g.add(door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3),
      new THREE.MeshLambertMaterial({ map: signTexture('GA HẢI PHÒNG', '#28457d', '#ffffff') }));
    sign.position.set(0, 9.6, 5.62); g.add(sign);
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
    addCollider(LM.station[0], LM.station[1] + 14, 16);
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
    g.position.set(LM.market[0], LAND_H, LM.market[1] - 6);
    scene.add(g);
    addCollider(LM.market[0], LM.market[1] - 6, 17);
    addCollider(LM.market[0] + 14, LM.market[1] + 3, 6);
  }

  // ---------- CẦU HOÀNG VĂN THỤ & CẦU BÍNH (vòm/dây văng trên vị trí thật) ----------
  function bridgeDeckAndRails(b, railColor) {
    const g = new THREE.Group();
    const deckMat = mat(0xcfd4da);
    for (let z = b.zc - b.half; z <= b.zc + b.half; z += 4) {
      const tt = (z - b.zc) / b.half;
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
  }
  {
    // Cầu Hoàng Văn Thụ: HAI vòm thép đỏ nghiêng vào nhau — dáng "cánh chim biển" thật
    const b = BRIDGES[0];
    bridgeDeckAndRails(b, 0xe8524a);
    const red = mat(0xd8402e);
    const TILT = 0.24, RIB_X = 6.2, ARCH_H = 24;
    for (const s of [-1, 1]) {
      const arcPts = [];
      for (let i = 0; i <= 24; i++) {
        const tt = i / 24;
        arcPts.push(new THREE.Vector3(0, Math.sin(tt * Math.PI) * ARCH_H + 2, (tt - 0.5) * b.half * 2.05));
      }
      const rib = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 32, 0.85, 7), red);
      rib.position.set(b.x + s * RIB_X, 0, b.zc);
      rib.rotation.z = -s * TILT;
      scene.add(rib);
    }
    // giằng ngang nối hai đỉnh vòm
    for (const tt of [0.34, 0.5, 0.66]) {
      const y = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const xOff = RIB_X - Math.sin(TILT) * y;
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, xOff * 2 * Math.cos(TILT) + 1, 6), red);
      brace.rotation.z = Math.PI / 2;
      brace.position.set(b.x, y * Math.cos(TILT), b.zc + (tt - 0.5) * b.half * 2.05);
      scene.add(brace);
    }
    // dây treo từ vòm xuống hai mép mặt cầu
    for (let i = 2; i <= 22; i += 2) {
      const tt = i / 24;
      const topYr = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const zz = (tt - 0.5) * b.half * 2.05;
      const ttd = zz / b.half;
      const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
      for (const s of [-1, 1]) {
        const topY = topYr * Math.cos(TILT);
        const topX = s * (RIB_X - Math.sin(TILT) * topYr);
        const len = Math.hypot(topY - deckY, topX - s * 5.8);
        if (len < 2) continue;
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat(0xe8e0d8));
        cable.position.set(b.x + (topX + s * 5.8) / 2, (topY + deckY) / 2, b.zc + zz);
        cable.rotation.z = Math.atan2(topX - s * 5.8, topY - deckY);
        scene.add(cable);
      }
    }
  }
  {
    const b = BRIDGES[1];
    bridgeDeckAndRails(b, 0x88b8c8);
    for (const dz of [-26, 26]) {
      for (const dx of [-6, 6]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(1.6, 34, 1.6), mat(0xb8c4c8));
        pylon.position.set(b.x + dx, 15, b.zc + dz);
        scene.add(pylon);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(13, 1.4, 1.4), mat(0xb8c4c8));
      beam.position.set(b.x, 28, b.zc + dz);
      scene.add(beam);
      for (let k = 1; k <= 4; k++) {
        for (const dir of [-1, 1]) {
          const zz = dz + dir * k * 10;
          if (Math.abs(zz) > b.half) continue;
          const ttd = zz / b.half;
          const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
          const topY = 30;
          const dzLen = Math.abs(zz - dz);
          const len = Math.hypot(topY - deckY, dzLen);
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 4), mat(0xd8e0e4));
          cable.position.set(b.x, (topY + deckY) / 2, b.zc + (zz + dz) / 2);
          cable.rotation.x = Math.atan2(dzLen, topY - deckY) * Math.sign(zz - dz);
          scene.add(cable);
        }
      }
    }
  }

  // ---------- CẢNG HẢI PHÒNG (neo theo bờ sông Cấm thật) ----------
  const portBank = nearestRiverPoint(200) || [109, -206, 62];
  const quayZ = portBank[1] + portBank[2] / 2 + 7;
  world.portAnchor = [180, quayZ + 14];
  {
    const g = new THREE.Group();
    const quay = new THREE.Mesh(new THREE.BoxGeometry(150, 2.4, 12), mat(0x9a9a96));
    quay.position.set(180, 1.2, quayZ);
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
    crane(130); crane(180); crane(230);
    const ctColors = [0xd84040, 0x2e86c1, 0x28a05c, 0xe8a020, 0x8e44ad];
    let ci = 0;
    for (let cx = 120; cx <= 250; cx += 13) {
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
  ship(175, portBank[1], 44, 0x24455f, 0xf0f0e8, 0.1);      // tàu hàng cập cảng trên sông Cấm
  ship(1000, -60, 40, 0x555a44, 0xe8e8e0, 0.3);             // tàu ra cửa biển
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
    const shore = findShore(LM.doson[0] + 90, LM.doson[1] + 20, 320);
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
    // biệt thự Bảo Đại trên đỉnh đồi thật
    const villaXZ = [1452, 2338];
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

  // ---------- CÁT BÀ: thị trấn + bến + núi đá Lan Hạ ----------
  {
    const rowColors = [0xf2ce6b, 0x6fbde8, 0xe87a6a, 0x8fd0a0, 0xf4b8d0, 0xb8a8e8, 0xf28c3a, 0x9fd8d8];
    for (let i = 0; i < 8; i++) {
      const x = 4420 + i * 9.5;
      const hgt = 10 + (i * 3) % 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(8, hgt, 9), mat(rowColors[i]));
      b.position.set(x, LAND_H + hgt / 2, 1720);
      scene.add(b);
      for (let fy = 3; fy < hgt - 1; fy += 3.2) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.15), sharedMats.window);
        win.position.set(x, LAND_H + fy, 1724.6);
        scene.add(win);
      }
      addCollider(x, 1720, 5.8);
    }
    const shore = findShore(4500, 1790, 220);
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
    world.npcSpots.catba = [4470, 1740];
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
        if (jx > 4390 && jx < 4600 && jz > 1650 && jz < 1800) continue; // chừa thị trấn
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
    bench(-150, 42, 0); bench(-172, 44, 0); bench(-194, 46, 0);
    bench(-4, 30, Math.PI); bench(20, 32, Math.PI);
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
  gullFlock(4560, 1850, 5);

  // ---------- Xe & NPC mặc định ----------
  world.vehicleSpawns.push({ type: 'motorbike', x: 34, z: 2, heading: Math.PI / 2 });
  world.vehicleSpawns.push({ type: 'cyclo', x: -52, z: 4, heading: Math.PI / 2 });
  world.npcSpots.guide = [16, 24];
  world.npcSpots.coba = [-150, 36];
  world.npcSpots.xichlo = [-56, 10];
  world.npcSpots.florist = [-30, -14];

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
