import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { registerModel, shrinkTexturesForMobile } from './assets.js';
import {
  WORLD_BOUNDS, LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BRIDGES, BUILDINGS,
  groundHeight, groundHeightNoDeck, isWater, landAt, riverFactor,
  nearestRiverPoint, findShore, addPier, LAKE_POLY, lakeSD,
} from './terrain.js';
import { STREETS, INTERSECTIONS, MEDIANS, GARDENS } from './mapdata.js';
import { SIDEWALK_BY_ROAD, SIDEWALK_DEFAULT } from './sidewalks.js';
import { PANO_SIDES } from './panosides.js';
import { PANO_HOUSES } from './housemap.js';
import { SHOP_SIGNS } from './shopsigns.js';

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
// ---------- VỈA HÈ tả thực: mỗi kiểu một texture (theo phân loại pano thật, R1a) ----------
// UV đã bake ~1 lần texture / 1.6m ở layRoad → texture 4 ô ⇒ ô ~0.4m (đúng gạch vỉa hè thật).
const _swMatCache = {};
function jitter(base, d) { const v = (c) => Math.max(0, Math.min(255, c + (Math.random() * 2 - 1) * d)); return `rgb(${v(base[0]) | 0},${v(base[1]) | 0},${v(base[2]) | 0})`; }
function tileGrid(g, W, H, N, rgb, dv, grout) {
  const s = W / N;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { g.fillStyle = jitter(rgb, dv); g.fillRect(x * s, y * s, s, s); }
  g.strokeStyle = grout; g.lineWidth = Math.max(1, s * 0.08);
  for (let i = 0; i <= N; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, H); g.moveTo(0, i * s); g.lineTo(W, i * s); g.stroke(); }
}
function sidewalkMaterial(type) {
  if (_swMatCache[type]) return _swMatCache[type];
  const S = 256;
  const tex = makeTex(S, S, (g, w, h) => {
    if (type === 'caro_do_xam') {                       // gạch kè hồ Tam Bạc THEO PANO_004:
      // nền gạch đỏ đất nung TRẦM là chủ đạo, điểm viên xám nhạt rải rác — KHÔNG phải
      // ca-rô đỏ/trắng xen kẽ đều (user đối chiếu pano chê sai)
      const s = w / 4;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const rr = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453, rv = rr - Math.floor(rr);
        g.fillStyle = rv < 0.72 ? jitter([158, 82, 58], 12)          // đỏ đất nung trầm (chủ đạo)
          : rv < 0.88 ? jitter([142, 70, 50], 10)                    // đỏ sẫm
          : jitter([160, 152, 138], 10);                             // xám nhạt điểm xuyết
        g.fillRect(x * s, y * s, s, s);
      }
      g.strokeStyle = 'rgba(40,20,12,.28)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
      speckle(g, w, h, 260, 0.08);
    } else if (type === 'terracotta') {                 // gạch đỏ đất nung liền (một vài đoạn)
      tileGrid(g, w, h, 4, [174, 86, 52], 16, 'rgba(70,30,15,.30)'); speckle(g, w, h, 300, 0.10);
    } else if (type === 'con_sau') {                     // gạch con sâu / xương cá (đỏ + xám xen)
      const b = 16; g.fillStyle = '#8f8a80'; g.fillRect(0, 0, w, h);
      for (let y = -b; y < h + b; y += b) for (let x = -b; x < w + b; x += b * 2) {
        const off = (Math.floor(y / b) % 2) * b;
        g.save(); g.translate(x + off, y);
        g.fillStyle = (Math.random() < 0.5) ? jitter([170, 84, 52], 14) : jitter([150, 144, 132], 10);
        g.fillRect(1, 1, b * 2 - 2, b - 2); g.restore();
      }
      g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 1; speckle(g, w, h, 220, 0.08);
    } else {                                             // 'gach_xam' — bê tông/đá xám (MẶC ĐỊNH, phổ biến nhất)
      tileGrid(g, w, h, 4, [182, 178, 168], 12, 'rgba(0,0,0,.16)'); speckle(g, w, h, 340, 0.09);
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshLambertMaterial({ map: tex });
  _swMatCache[type] = m; return m;
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
  // đẩy điểm ra khỏi vật cản — chỉ mục lưới XÂY 1 LẦN rồi CHÈN TĂNG DẦN (tránh xây lại O(P·C) lúc tải:
  // ~9000 addCollider xen kẽ resolveCollisions khi rải cây → trước đây xây lại toàn map mỗi lần).
  let colIdx = null;
  const colKey = (x, z) => `${Math.floor(x / 48)},${Math.floor(z / 48)}`;
  function addCollider(x, z, r) {
    const c = { x, z, r };
    colliders.push(c);
    if (colIdx) { const k = colKey(x, z); let l = colIdx.get(k); if (!l) colIdx.set(k, l = []); l.push(c); }
  }
  world.resolveCollisions = (p, pr = 0.45) => {
    if (!colIdx) {
      colIdx = new Map();
      for (const c of colliders) { const k = colKey(c.x, c.z); let l = colIdx.get(k); if (!l) colIdx.set(k, l = []); l.push(c); }
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
    let h = groundHeightNoDeck(x, z);
    // HÀNH LANG HỒ TAM BẠC: lưới toàn cầu ô ~112m KHÔNG THỂ diễn tả kênh 50-66m (2 đỉnh kề
    // nhau đứng 2 bờ → nội suy "bắc cầu đất" qua mặt nước). Dìm mọi đỉnh trong hành lang
    // xuống -3 (tam giác nào phủ kênh cũng chìm); dải lưới MỊN 5m phủ đè bên dưới sẽ vẽ
    // đúng bờ/kênh/phố (xem khối "DẢI LƯỚI MỊN" ngay sau).
    if (x > -1210 && x < -195 && z > 45 && z < 410) {
      if (lakeSD(x, z) < 200) h = -3;   // trong/quanh polygon hồ: dìm — dải lưới MỊN vẽ đè đúng cao độ
    }
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

  // ---------- DẢI LƯỚI MỊN HỒ TAM BẠC (5m) ----------
  // Phủ hành lang hồ bằng lưới mịn đúng cao độ + màu (lưới toàn cầu trong hành lang đã dìm -3).
  // +0.05 để nổi trên lưới toàn cầu ở rìa hộp (tránh z-fight nơi 2 mặt trùng cao độ).
  {
    // HỘP RỘNG HƠN vùng dìm ≥120m mọi phía: đỉnh dìm (-3) nội suy với đỉnh thường tạo VÀNH TRŨNG
    // lan 1 ô lưới thô (~112m) ra ngoài vùng dìm — không phủ thì lộ "rãnh nước" giả cạnh vườn hoa
    // Lê Chân (đông) và ven đập Tam Kỳ (tây) — user báo.
    const X1 = -1330, X2 = -65, Z1 = -75, Z2 = 530, STEP = 5;
    const g2 = new THREE.PlaneGeometry(X2 - X1, Z2 - Z1, Math.round((X2 - X1) / STEP), Math.round((Z2 - Z1) / STEP));
    g2.rotateX(-Math.PI / 2);
    g2.translate((X1 + X2) / 2, 0, (Z1 + Z2) / 2);
    const p2 = g2.attributes.position;
    const col2 = new Float32Array(p2.count * 3);
    for (let i = 0; i < p2.count; i++) {
      let x = p2.getX(i), z = p2.getZ(i);
      // NẮN mép bờ theo POLYGON hồ thật: bờ chạy chéo so với lưới 5m → răng cưa "lồi lõm".
      // Đỉnh trong ±2.4m quanh mép polygon → kéo VỀ đúng mép; đỉnh trong dải dốc (trong hồ,
      // cách mép 2.4-6.5m) → kéo về chân kè (2.1m trong mép) → mép nước + chân kè sắc nét.
      {
        let bd = 1e9, bpx = 0, bpz = 0;
        for (let e = 0, j = LAKE_POLY.length - 1; e < LAKE_POLY.length; j = e++) {
          const [x1, z1] = LAKE_POLY[j], [x2, z2] = LAKE_POLY[e];
          const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz;
          let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
          const px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(x - px, z - pz);
          if (d < bd) { bd = d; bpx = px; bpz = pz; }
        }
        if (bd > 0.01 && bd < 11) {
          const sd = lakeSD(x, z);                                       // âm = trong hồ
          // DẢI BẮT ĐỈNH PHẢI RỘNG HƠN BƯỚC LƯỚI 5m: |Δsd| giữa 2 đỉnh kề ≤5 nên mép ±3.6
          // và chân (−9.6,−3.6) đảm bảo MỌI tuyến lưới cắt bờ đều có đủ cặp đỉnh mép+chân
          // → tường kè dựng đứng đồng nhất, mực nước bám viền ĐỀU (hết "chỗ có chỗ không")
          let target = -1;
          if (Math.abs(sd) < 3.6) target = 0;                            // mép kè
          else if (sd < -3.6 && sd > -9.6) target = 2.1;                 // chân kè (2.1m trong mép)
          if (target >= 0) {
            const s = target / bd;                                       // 0 → về đúng mép
            x = bpx + (x - bpx) * s; z = bpz + (z - bpz) * s;
            p2.setX(i, x); p2.setZ(i, z);
          }
        }
      }
      const h = groundHeightNoDeck(x, z);
      p2.setY(i, h + 0.05);
      if (h < -0.6) tmp.copy(cDeep);
      else if (h < 1.1) tmp.copy(cSand);
      else {
        const patch = Math.sin(x * 0.047) * Math.sin(z * 0.041)
                    + 0.6 * Math.sin(x * 0.11 + 1.7) * Math.sin(z * 0.093 + 0.6);
        tmp.copy(cGrass).lerp(cGrass2, smoothstep(-0.5, 0.9, patch));
      }
      tmp.lerp(cCity, rectFactor(x, DT_BOX.x1, DT_BOX.x2, z, DT_BOX.z1, DT_BOX.z2, 40) * 0.8);
      if (h > 1.2 && h < 3.5 && inPark(x, z)) tmp.lerp(cPark, 0.72);
      const hash = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const noise = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.09;
      col2[i * 3] = tmp.r * noise; col2[i * 3 + 1] = tmp.g * noise; col2[i * 3 + 2] = tmp.b * noise;
    }
    g2.setAttribute('color', new THREE.BufferAttribute(col2, 3));
    g2.computeVertexNormals();
    const lakeGround = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true }));
    lakeGround.name = 'lake_ground';
    lakeGround.receiveShadow = true;
    scene.add(lakeGround);
  }

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
  const ROAD_W = { p: 13, s: 10, t: 8, r: 5.5, w: 3.5 }; // 1:1 — lòng đường thật
  const asphaltGeos = [], dashGeos = [], pathGeos = [];
  const sidewalkBuckets = {};  // { type: [geo,...] } — vỉa hè theo từng kiểu (đúng pano)
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
      const nChunk = Math.max(1, Math.ceil(segLen / 30));
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
          const sinR = Math.sin(rotY), cosR = Math.cos(rotY), S = 1 / 1.6;   // ô ca-rô ~0.8m
          for (const side of [-1, 1]) {
            const off = side * (wRoad / 2 + wRoad * 0.14);
            const sg = new THREE.BoxGeometry(wRoad * 0.28, 0.24, len + 1.2);
            e4.set(rotX, rotY, 0); q4.setFromEuler(e4);
            m4.compose(new THREE.Vector3(mx + off * px, my + 0.02, mz + off * pz), q4, s4);
            sg.applyMatrix4(m4);
            // UV ca-rô CHẠY THẲNG theo hướng ĐOẠN ĐƯỜNG (u dọc, v ngang) — hết lệch trục thế giới
            const sp = sg.attributes.position, suv = new Float32Array(sp.count * 2);
            for (let k = 0; k < sp.count; k++) {
              const vx = sp.getX(k), vz = sp.getZ(k);
              suv[k * 2] = (vx * sinR + vz * cosR) * S;       // dọc đường
              suv[k * 2 + 1] = (vx * cosR - vz * sinR) * S;   // ngang đường
            }
            sg.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
            const swType = opts.swType || SIDEWALK_DEFAULT;
            (sidewalkBuckets[swType] = sidewalkBuckets[swType] || []).push(sg);
          }
        }
        if (opts.dashes && c % 2 === 0) {
          pushBox(dashGeos, 0.35, 0.05, 2.4, mx, my + 0.09, mz, rotY, rotX);
        }
      }
    }
  }
  for (let ri = 0; ri < ROADS_DT.length; ri++) {
    const r = ROADS_DT[ri];
    const hasSW = r.c === 'p' || r.c === 's';
    layRoad(r.pts, ROAD_W[r.c], {
      sidewalk: hasSW,
      swType: hasSW ? (SIDEWALK_BY_ROAD[ri] || SIDEWALK_DEFAULT) : null,
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
  // ---------- ĐƯỜNG SẮT THẬT (tuyến Hà Nội - Hải Phòng chạy vào ga) ----------
  {
    const ballastGeos = [], railGeos = [];
    for (const r of RAIL) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1);
        if (segLen < 1) continue;
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const nCh = Math.max(1, Math.ceil(segLen / 30));
        for (let c = 0; c < nCh; c++) {
          const t1 = c / nCh, t2 = (c + 1) / nCh;
          const cx1 = x1 + (x2 - x1) * t1, cz1 = z1 + (z2 - z1) * t1;
          const cx2 = x1 + (x2 - x1) * t2, cz2 = z1 + (z2 - z1) * t2;
          const h1 = Math.max(groundHeightNoDeck(cx1, cz1), LAND_H);
          const h2 = Math.max(groundHeightNoDeck(cx2, cz2), LAND_H);
          if (Math.abs(h1 - h2) > 6) continue;
          const mx = (cx1 + cx2) / 2, mz = (cz1 + cz2) / 2;
          const my = (h1 + h2) / 2 + 0.02;
          const len = segLen / nCh;
          const rotX = Math.atan2(h1 - h2, len);
          pushBox(ballastGeos, 3, 0.16, len + 0.8, mx, my, mz, rotY, rotX);
          const px2 = Math.cos(rotY), pz2 = -Math.sin(rotY);
          for (const off of [-0.5, 0.5]) {   // khổ ray 1000mm thật
            pushBox(railGeos, 0.17, 0.14, len + 0.8, mx + off * px2, my + 0.15, mz + off * pz2, rotY, rotX);
          }
        }
      }
    }
    addMerged(ballastGeos, mat(0x6f6659), 'railballast');
    addMerged(railGeos, mat(0x848a92), 'rails');
  }

  addMerged(asphaltGeos, mat(0x4c5158), 'roads');
  // VỈA HÈ ĐA DẠNG theo từng nơi (phân loại từ pano Street View — R1a): mặc định xám bê tông,
  // ca-rô đỏ-xám ở bờ sông Tam Bạc/quảng trường, terracotta/con sâu ở vài đoạn. UV đã bake thẳng
  // theo hướng đoạn đường ở layRoad → gộp thẳng theo từng KIỂU, mỗi kiểu một material riêng.
  for (const [type, geos] of Object.entries(sidewalkBuckets)) {
    if (!geos.length) continue;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, sidewalkMaterial(type));
    mesh.name = 'sidewalk_' + type; mesh.receiveShadow = true; scene.add(mesh);
  }
  addMerged(dashGeos, mat(0xe8e4d2), 'dashes');
  addMerged(pathGeos, mat(0xc9b896), 'paths');

  // ---------- GIÀN VÒM THÉP TRẮNG trang trí (dải công viên trung tâm, gần Trần Bình Trọng) ----------
  // Theo pano thật pano_195 [~555,-234]: dãy vòm bán nguyệt trắng lặp trên lối đi lát.
  {
    const archGeos = [];
    const cx0 = 585, cz0 = -238;            // trong dải công viên phía đông pano
    const dir = Math.atan2(1, -0.15);        // chạy gần Bắc-Nam theo dải
    const dxn = Math.sin(dir), dzn = Math.cos(dir);
    for (let k = 0; k < 15; k++) {
      const x = cx0 + dxn * k * 2.4, z = cz0 + dzn * k * 2.4;
      const gy = groundHeight(x, z);
      if (gy < LAND_H - 0.5 || isWater(x, z)) continue;
      const arch = new THREE.TorusGeometry(1.7, 0.12, 6, 20, Math.PI);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, dir, 0));
      arch.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, gy + 0.05, z), q, new THREE.Vector3(1, 1, 1)));
      archGeos.push(arch);
    }
    if (archGeos.length) addMerged(archGeos, mat(0xf2f4f6), 'white_arches');
  }

  // ---------- CỘT CỜ LỚN giữa quảng trường (theo pano pano_407 [~-30,127]) ----------
  {
    const fx = -28, fz = 120, gy = groundHeight(fx, fz);
    if (gy > LAND_H - 0.5 && !isWater(fx, fz)) {
      const PH = 13;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, PH, 10), mat(0xd8dce0));
      pole.position.set(fx, gy + PH / 2, fz); scene.add(pole);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(0xe8c14a));
      knob.position.set(fx, gy + PH + 0.2, fz); scene.add(knob);
      const flagTex = makeTex(128, 86, (g, w, h) => {
        g.fillStyle = '#da251d'; g.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h / 2, R = h * 0.36, r = R * 0.42;
        g.fillStyle = '#ffdd00'; g.beginPath();
        for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 ? r : R; const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad; i ? g.lineTo(x, y) : g.moveTo(x, y); }
        g.closePath(); g.fill();
      });
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.3), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide }));
      flag.position.set(fx + 1.75, gy + PH - 1.5, fz); scene.add(flag);
      addCollider(fx, fz, 0.6);
    }
  }

  // ---------- KÈ HỒ TAM BẠC: lan can sắt xanh + ghế đá granite + cột đèn đôi Pháp cổ (pano_004-013, 028-037) ----------
  // Neo theo TRỤC HỒ (không theo tim đường) → lan can bám đúng mép nước cả 2 bờ, thứ tự thật
  // từ hồ ra: nước → LAN CAN (mép kè) → đèn → GHẾ ĐÁ (trên vỉa hè caro, quay mặt ra hồ) → vỉa hè → đường.
  {
    // Bám theo MÉP POLYGON hồ thật (LAKE_POLY, terrain.js) — kè/vỉa hè/rào theo đúng hình hồ
    // thực địa (2 đầu, bờ cong), KHÔNG còn xấp xỉ trục thẳng. Thứ tự từ nước ra:
    // RÀO (mép kè, gờ 0.5m) → mặt lát caro liền → mép nhựa đường. User chốt chuẩn này.
    const OFF_RAIL = -0.1, OFF_LAMP = 3.2, OFF_BENCH = 5.2;          // m tính từ mép nước ra ngoài
    const _sd = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), pz - (az + t * dz)); };
    const parSegs = [];   // MỌI đoạn đường gần hồ (kể cả đập 'r') — mốc lát vỉa hè kè tới MÉP NHỰA
    for (const r of ROADS_DT) {
      if (r.c !== 'p' && r.c !== 's' && r.c !== 't' && r.c !== 'r') continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        if (Math.max(x1, x2) < -1210 || Math.min(x1, x2) > -200 || Math.max(z1, z2) < 50 || Math.min(z1, z2) > 410) continue;
        const sd = lakeSD((x1 + x2) / 2, (z1 + z2) / 2);
        if (sd > -4 && sd < 60) parSegs.push([x1, z1, x2, z2, ROAD_W[r.c] / 2]);
      }
    }
    const railG = [], benchG = [], lampPostG = [], globeG = [], caroG = [];
    // LẤY MẪU CHU VI đều 2.6m — đi XUYÊN QUA GÓC polygon (bước dư cạnh này chuyển sang cạnh
    // sau) → rào/mặt lát liên tục quanh hồ kể cả 2 đầu ngắn, không đứt tại đỉnh góc
    const samples = [];
    {
      let next = 1.3;
      for (let e = 0; e < LAKE_POLY.length; e++) {
        const [ax, az] = LAKE_POLY[e], [bx2, bz2] = LAKE_POLY[(e + 1) % LAKE_POLY.length];
        const dx = bx2 - ax, dz = bz2 - az, L = Math.hypot(dx, dz);
        const ux = dx / L, uz = dz / L;
        let nx = -uz, nz = ux;
        { const mx0 = (ax + bx2) / 2 + nx * 3, mz0 = (az + bz2) / 2 + nz * 3;
          if (lakeSD(mx0, mz0) < 0) { nx = -nx; nz = -nz; } }         // pháp tuyến RA NGOÀI hồ
        let t = next;
        for (; t < L; t += 2.6) samples.push([ax + ux * t, az + uz * t, ux, uz, nx, nz, e]);
        next = t - L;
      }
    }
    // ĐĨA LÁT BO GÓC: tại đỉnh gãy >20° lát đĩa caro phủ nêm hở giữa 2 dải cạnh (cao hơn 1.5cm)
    for (let e = 0; e < LAKE_POLY.length; e++) {
      const [px0, pz0] = LAKE_POLY[(e + LAKE_POLY.length - 1) % LAKE_POLY.length];
      const [cx1, cz1] = LAKE_POLY[e];
      const [qx0, qz0] = LAKE_POLY[(e + 1) % LAKE_POLY.length];
      const d1x = cx1 - px0, d1z = cz1 - pz0, l1 = Math.hypot(d1x, d1z);
      const d2x = qx0 - cx1, d2z = qz0 - cz1, l2 = Math.hypot(d2x, d2z);
      const dot = (d1x * d2x + d1z * d2z) / (l1 * l2);
      if (dot > 0.94) continue;                                       // gần thẳng → dải cạnh tự phủ
      let bnx = -(d1z / l1 + d2z / l2), bnz = (d1x / l1 + d2x / l2);
      const bl = Math.hypot(bnx, bnz) || 1; bnx /= bl; bnz /= bl;
      if (lakeSD(cx1 + bnx * 3, cz1 + bnz * 3) < 0) { bnx = -bnx; bnz = -bnz; }  // phân giác ra ngoài
      const ccx = cx1 + bnx * 2.2, ccz = cz1 + bnz * 2.2;
      if (Math.abs(groundHeightNoDeck(ccx, ccz) - LAND_H) > 0.5) continue;
      const disc = new THREE.CylinderGeometry(3.6, 3.6, 0.24, 20);
      disc.translate(ccx, groundHeight(ccx, ccz) + 0.135, ccz);
      const dp = disc.attributes.position, duv = new Float32Array(dp.count * 2), DS = 1 / 1.6;
      for (let k = 0; k < dp.count; k++) { duv[k * 2] = dp.getX(k) * DS; duv[k * 2 + 1] = dp.getZ(k) * DS; }
      disc.setAttribute('uv', new THREE.BufferAttribute(duv, 2));
      caroG.push(disc);
    }
    {
      let tAcc = 0;
      for (const [cx0, cz0, ux, uz, nx, nz, eIdx] of samples) {
        tAcc += 2.6;
        const yJit = (eIdx % 3) * 0.005;   // lệch 5mm giữa dải các cạnh kề — chống z-fight nơi giao nhau
        const barAng = Math.atan2(ux, uz) + Math.PI / 2;              // thanh/ghế nằm dọc theo bờ
        const alongAng = Math.atan2(ux, uz);
        // VỈA HÈ CARO KÈ HỒ: lát LIỀN từ mép nước tới MÉP NHỰA của đường ven hồ (phủ luôn
        // dải vỉa hè bám-tim-đường bên dưới, cao hơn 6cm) — một mặt caro liền
        {
          const qx = cx0 + nx * 2, qz = cz0 + nz * 2;
          let roadD = 1e9, eOff = 3.25;
          for (const s of parSegs) { const d = _sd(qx, qz, s[0], s[1], s[2], s[3]); if (d < roadD) { roadD = d; eOff = s[4]; } }
          // ĐẦU ĐÔNG hồ (x>-480) là QUẢNG TRƯỜNG: caro lát liền góc vuông tới tận mép nhựa
          // các đường bao (user đối chiếu thực địa) → cho lát rộng tới 42m; bờ dài giữ 16m
          const capW = cx0 > -480 ? 42 : 16;
          let outer = roadD > 60 ? 5 : 2 + roadD - eOff + 0.3;        // m từ mép nước ra tới mép nhựa
          outer = Math.max(Math.min(outer, capW), 2.6);
          const inner = -0.6;                                          // chớm ra mép nước (gờ kè)
          const mid = (inner + outer) / 2, wAcross = outer - inner;
          const sx = cx0 + nx * mid, sz = cz0 + nz * mid;
          if (Math.abs(groundHeightNoDeck(sx, sz) - LAND_H) < 0.5) {
            const pg = new THREE.BoxGeometry(2.75, 0.24, wAcross);
            pg.rotateY(barAng); pg.translate(sx, groundHeight(sx, sz) + 0.12 + yJit, sz);
            // UV ca-rô chạy thẳng theo hướng bờ (khớp hoa văn vỉa hè của đường ven hồ)
            const pp = pg.attributes.position, puv = new Float32Array(pp.count * 2), S = 1 / 1.6;
            const sinR = Math.sin(alongAng), cosR = Math.cos(alongAng);
            for (let k = 0; k < pp.count; k++) { const vx = pp.getX(k), vz = pp.getZ(k); puv[k * 2] = (vx * sinR + vz * cosR) * S; puv[k * 2 + 1] = (vx * cosR - vz * sinR) * S; }
            pg.setAttribute('uv', new THREE.BufferAttribute(puv, 2));
            caroG.push(pg);
          }
        }
        const ox = cx0 + nx * OFF_RAIL, oz = cz0 + nz * OFF_RAIL;
        // rào ở mép nước (trên gờ kè) → kiểm tra ĐẤT tại lòng vỉa hè (+2m), cao độ theo mặt lát
        const gx2 = cx0 + nx * 2, gz2 = cz0 + nz * 2;
        if (Math.abs(groundHeightNoDeck(gx2, gz2) - LAND_H) > 0.4) continue;  // phải là đất kè chuẩn
        const gy = groundHeight(gx2, gz2) + 0.24;                     // đứng TRÊN mặt lát caro (+0.12 tâm, dày 0.24)
        addCollider(ox, oz, 1.6);                                     // RÀO CHẶN THẬT: người/xe không lao ra hồ (mỗi 2.6m, r1.6 → tường liền)
        const post = new THREE.BoxGeometry(0.07, 0.95, 0.07); post.translate(ox, gy + 0.48, oz); railG.push(post);
        for (const ry of [0.9, 0.5]) { const r2 = new THREE.BoxGeometry(2.62, 0.06, 0.05); r2.rotateY(barAng); r2.translate(ox, gy + ry, oz); railG.push(r2); }
        // ghế đá mỗi ~26m (TRÊN vỉa hè caro sau lan can, quay mặt ra hồ) + đèn đôi mỗi ~31m
        if (Math.round(tAcc) % 26 < 2.6) {
          const bx = cx0 + nx * OFF_BENCH, bz = cz0 + nz * OFF_BENCH;
          if (Math.abs(groundHeightNoDeck(bx, bz) - LAND_H) < 0.4) {
            const by = groundHeight(bx, bz) + 0.24;
            const seat = new THREE.BoxGeometry(1.7, 0.12, 0.5); seat.rotateY(barAng); seat.translate(bx, by + 0.46, bz); benchG.push(seat);
            for (const s of [-0.7, 0.7]) { const lg = new THREE.BoxGeometry(0.14, 0.42, 0.5); lg.rotateY(barAng); lg.translate(bx + ux * s, by + 0.21, bz + uz * s); benchG.push(lg); }
          }
        }
        if (Math.round(tAcc) % 31 < 2.6) {
          const lx = cx0 + nx * OFF_LAMP, lz = cz0 + nz * OFF_LAMP;
          if (Math.abs(groundHeightNoDeck(lx, lz) - LAND_H) < 0.4) {
            const ly = groundHeight(lx, lz) + 0.24;
            const pole = new THREE.CylinderGeometry(0.07, 0.11, 3.6, 8); pole.translate(lx, ly + 1.8, lz); lampPostG.push(pole);
            const arm = new THREE.BoxGeometry(1.5, 0.07, 0.07); arm.rotateY(barAng); arm.translate(lx, ly + 3.55, lz); lampPostG.push(arm);
            for (const s of [-0.62, 0.62]) { const gl = new THREE.SphereGeometry(0.17, 8, 6); gl.translate(lx + ux * s, ly + 3.72, lz + uz * s); globeG.push(gl); }
          }
        }
      }
    }
    if (caroG.length) addMerged(caroG, sidewalkMaterial('caro_do_xam'), 'lake_promenade'); // vỉa hè caro kè hồ
    if (railG.length) addMerged(railG, mat(0x2e5e46), 'lake_railing');          // lan can gang xanh
    if (benchG.length) addMerged(benchG, mat(0xd6d2c6), 'lake_benches');        // ghế đá granite
    if (lampPostG.length) addMerged(lampPostG, mat(0x23282b), 'lake_lampposts'); // trụ gang đen
    if (globeG.length) { const gm = new THREE.Mesh(mergeGeometries(globeG), sharedMats.lampGlow); gm.name = 'lake_lampglobes'; scene.add(gm); globeG.forEach((g) => g.dispose()); }

    // ---------- PROMENADE HỒ TAM BẠC mức chi tiết cao (pano_004-013, 028-037) ----------
    // Theo pano: HÀNG CÂY CỔ THỤ dọc kè (007-012, 028-033), GIÀN PERGOLA GỖ ĐỎ + PAVILION
    // nghỉ chân phố đi bộ Quang Trung (009, 011), THÙNG RÁC ĐÔI phân loại (005), TRẠM XE ĐẠP
    // công cộng xanh dương (030), CỘT ÁP PHÍCH khung đỏ (012, 032), CÂY ĐA quảng trường (035).
    {
      const dryLand = (x, z) => Math.abs(groundHeightNoDeck(x, z) - LAND_H) < 0.4;
      const okSpot = (x, z) => dryLand(x, z) && !nearCross(x, z, 10);
      const perG = [], binGreen = [], binBlue = [], bikeG = [], postRed = [], postWhite = [];
      // pergola 10×3m gỗ đỏ: 4 cột + 2 dầm dọc + thanh chớp — tâm cách đèn ≥13m (chu kỳ 31, tâm ≡15.5 mod 124)
      const pergolaAt = (cx, cz, barAng, ux, uz, nx2, nz2) => {
        const gy = groundHeight(cx, cz);
        for (const su of [-4.6, 4.6]) for (const sv of [-1.4, 1.4]) {
          const p = new THREE.BoxGeometry(0.16, 2.6, 0.16);
          p.translate(cx + ux * su + nx2 * sv, gy + 1.3, cz + uz * su + nz2 * sv); perG.push(p);
        }
        for (const sv of [-1.4, 1.4]) { const b = new THREE.BoxGeometry(10.4, 0.14, 0.14); b.rotateY(barAng); b.translate(cx + nx2 * sv, gy + 2.66, cz + nz2 * sv); perG.push(b); }
        for (let s = -4.8; s <= 4.8; s += 1.2) { const sl = new THREE.BoxGeometry(0.09, 0.07, 3.4); sl.rotateY(barAng); sl.translate(cx + ux * s, gy + 2.78, cz + uz * s); perG.push(sl); }
      };
      for (const [ax, az, bx2, bz2, HALF] of LAKE_SEGS) {
        const dx = bx2 - ax, dz = bz2 - az, L = Math.hypot(dx, dz);
        const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
        const barAng = Math.atan2(ux, uz) + Math.PI / 2;
        for (const side of [-1, 1]) {
          for (let t = 6; t < L - 6; t += 2.6) {
            const cx0 = ax + ux * t, cz0 = az + uz * t;
            // HÀNG CÂY cổ thụ ven kè mỗi ~18m (né chu kỳ ghế 26/đèn 31 và khoang pergola)
            const mPer = ((t - 15.5) % 124 + 124) % 124;
            if (Math.round(t) % 18 < 2.6 && Math.round(t) % 26 >= 2.6 && Math.round(t) % 31 >= 2.6 && !(side < 0 && (mPer < 8 || mPer > 116))) {
              const tx = cx0 + nx * side * (HALF + 4.6), tz = cz0 + nz * side * (HALF + 4.6);
              if (okSpot(tx, tz)) streetTree(tx, tz);
            }
            // THÙNG RÁC ĐÔI phân loại mỗi ~52m, sát lan can
            if (Math.round(t) % 52 < 2.6) {
              const rx = cx0 + nx * side * (HALF + 2.5), rz = cz0 + nz * side * (HALF + 2.5);
              if (okSpot(rx, rz)) {
                const ry = groundHeight(rx, rz);
                const b1 = new THREE.BoxGeometry(0.42, 0.62, 0.42); b1.translate(rx + ux * 0.26, ry + 0.44, rz + uz * 0.26); binGreen.push(b1);
                const b2 = new THREE.BoxGeometry(0.42, 0.62, 0.42); b2.translate(rx - ux * 0.26, ry + 0.44, rz - uz * 0.26); binBlue.push(b2);
              }
            }
            // PERGOLA gỗ đỏ chỉ bờ bắc (phố đi bộ Quang Trung), tâm mỗi 124m
            if (side < 0 && mPer < 2.6 && t > 20 && t < L - 20) {
              const px2 = cx0 + nx * side * (HALF + 4.0), pz2 = cz0 + nz * side * (HALF + 4.0);
              if (okSpot(px2, pz2) && okSpot(px2 + ux * 5, pz2 + uz * 5) && okSpot(px2 - ux * 5, pz2 - uz * 5)) pergolaAt(px2, pz2, barAng, ux, uz, nx * side, nz * side);
            }
          }
        }
      }
      // helper: chiếu 1 điểm neo pano lên trục hồ rồi đặt vật ở offset cách mép nước
      const projQuay = (px, pz, off) => {
        let bd = 1e9, r = null;
        for (const [ax, az, bx2, bz2, HALF] of LAKE_SEGS) {
          const dx = bx2 - ax, dz = bz2 - az, l2 = dx * dx + dz * dz;
          let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = Math.max(0.05, Math.min(0.95, t));
          const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(px - qx, pz - qz);
          if (d < bd) { bd = d; const L = Math.sqrt(l2), ux = dx / L, uz = dz / L; const sgn = ((px - qx) * -uz + (pz - qz) * ux) >= 0 ? 1 : -1; r = { x: qx + -uz * sgn * (HALF + off), z: qz + ux * sgn * (HALF + off), ux, uz, barAng: Math.atan2(ux, uz) + Math.PI / 2 }; }
        }
        return r;
      };
      // PAVILION nghỉ chân gỗ đỏ-cam mái bằng ~10×3.6m (pano_011, bờ bắc x≈-877)
      { const p = projQuay(-877, 260, 4.2);
        if (p && okSpot(p.x, p.z)) {
          const gy = groundHeight(p.x, p.z);
          for (const su of [-4.4, 0, 4.4]) for (const sv of [-1.5, 1.5]) { const c = new THREE.BoxGeometry(0.18, 2.7, 0.18); c.translate(p.x + p.ux * su + -p.uz * sv, gy + 1.35, p.z + p.uz * su + p.ux * sv); perG.push(c); }
          const roof = new THREE.BoxGeometry(10.6, 0.22, 4.0); roof.rotateY(p.barAng); roof.translate(p.x, gy + 2.82, p.z); perG.push(roof);
          const seat = new THREE.BoxGeometry(9.4, 0.1, 0.5); seat.rotateY(p.barAng); seat.translate(p.x + -p.uz * 1.0, gy + 0.46, p.z + p.ux * 1.0); perG.push(seat);
          addCollider(p.x, p.z, 2.4);
        } }
      // TRẠM XE ĐẠP công cộng xanh dương (pano_030, bờ nam Nguyễn Đức Cảnh x≈-690)
      { const p = projQuay(-690, 300, 4.0);
        if (p && okSpot(p.x, p.z)) {
          const gy = groundHeight(p.x, p.z);
          const rack = new THREE.BoxGeometry(7.6, 0.09, 0.09); rack.rotateY(p.barAng); rack.translate(p.x, gy + 0.72, p.z); bikeG.push(rack);
          for (let k = -3; k <= 3; k++) {
            const bx = p.x + p.ux * k * 1.1, bz = p.z + p.uz * k * 1.1;
            const frame = new THREE.BoxGeometry(0.08, 0.5, 1.5); frame.rotateY(p.barAng + Math.PI / 2); frame.translate(bx, gy + 0.55, bz); bikeG.push(frame);
            const fx = Math.sin(p.barAng + Math.PI / 2), fz = Math.cos(p.barAng + Math.PI / 2); // hướng thân xe (vuông góc rack)
            for (const w of [-0.62, 0.62]) { const wg = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10); wg.rotateZ(Math.PI / 2); wg.rotateY(p.barAng); wg.translate(bx + fx * w, gy + 0.3, bz + fz * w); bikeG.push(wg); }
          }
          addCollider(p.x, p.z, 1.6);
        } }
      // CỘT ÁP PHÍCH khung đỏ ven hồ (pano_012 bờ bắc x≈-957; pano_032 bờ nam x≈-576)
      for (const [axp, azp] of [[-957, 250], [-576, 300]]) {
        const p = projQuay(axp, azp, 2.8);
        if (!p || !okSpot(p.x, p.z)) continue;
        const gy = groundHeight(p.x, p.z);
        for (const s of [-0.75, 0.75]) { const c = new THREE.BoxGeometry(0.1, 2.6, 0.1); c.translate(p.x + p.ux * s, gy + 1.3, p.z + p.uz * s); postRed.push(c); }
        const fr = new THREE.BoxGeometry(1.8, 1.3, 0.1); fr.rotateY(p.barAng); fr.translate(p.x, gy + 1.9, p.z); postRed.push(fr);
        const pn = new THREE.BoxGeometry(1.62, 1.12, 0.12); pn.rotateY(p.barAng); pn.translate(p.x, gy + 1.9, p.z); postWhite.push(pn);
      }
      // CÂY ĐA cổ thụ quảng trường ven hồ (pano_035, x≈-380 bờ nam)
      { const p = projQuay(-380, 250, 6.5); if (p && okSpot(p.x, p.z)) { heroTree(p.x, p.z); streetTree(p.x + 7, p.z + 3); } }
      if (perG.length) addMerged(perG, mat(0xa63c28), 'lake_pergolas');            // gỗ sơn đỏ-cam
      if (binGreen.length) addMerged(binGreen, mat(0x2f8a4c), 'lake_bins_g');      // thùng rác xanh lá
      if (binBlue.length) addMerged(binBlue, mat(0x2668b8), 'lake_bins_b');        // thùng rác xanh dương
      if (bikeG.length) addMerged(bikeG, mat(0x2e6fd0), 'lake_bikestation');       // trạm xe đạp công cộng
      if (postRed.length) addMerged(postRed, mat(0xb32424), 'lake_posters');       // khung áp phích đỏ
      if (postWhite.length) addMerged(postWhite, mat(0xf1ece0), 'lake_posterpanels');
    }
  }

  // ---------- CỘT ĐÈN GANG TRANG TRÍ kiểu Pháp cổ (đèn 3 cầu) dọc dải vườn hoa trung tâm ----------
  {
    const ironG = [], globeG = [];
    const H = 3.9;
    function ornLamp(x, z, gy, rotY) {
      const base = new THREE.CylinderGeometry(0.34, 0.42, 0.7, 8); base.translate(x, gy + 0.35, z); ironG.push(base);
      const col = new THREE.CylinderGeometry(0.1, 0.15, H, 8); col.translate(x, gy + 0.7 + H / 2, z); ironG.push(col);
      const finial = new THREE.SphereGeometry(0.14, 8, 6); finial.translate(x, gy + 0.7 + H + 0.12, z); ironG.push(finial);
      // 3 cầu đèn: 1 đỉnh + 2 tay ngang
      const topY = gy + 0.7 + H - 0.1;
      const gl0 = new THREE.SphereGeometry(0.22, 10, 8); gl0.translate(x, topY + 0.5, z); globeG.push(gl0);
      for (const a of [rotY + Math.PI / 2, rotY - Math.PI / 2]) {
        const ax = Math.sin(a), az = Math.cos(a);
        const arm = new THREE.CylinderGeometry(0.05, 0.05, 0.95, 5); arm.rotateZ(Math.PI / 2);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0));
        arm.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x + ax * 0.48, topY + 0.05, z + az * 0.48), q, new THREE.Vector3(1, 1, 1)));
        ironG.push(arm);
        const gl = new THREE.SphereGeometry(0.2, 10, 8); gl.translate(x + ax * 0.92, topY + 0.02, z + az * 0.92); globeG.push(gl);
      }
    }
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 10) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const nx = Math.cos(rotY), nz = -Math.sin(rotY);
        for (let d = 14; d < segLen - 14; d += 38) {
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 800 * 800) continue;    // chỉ LÕI trung tâm (dải vườn hoa)
          for (const side of [-1, 1]) {
            const gx = mx + side * (wRoad / 2 + 1.0) * nx, gz = mz + side * (wRoad / 2 + 1.0) * nz;
            const gy = groundHeight(gx, gz);
            if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
            ornLamp(gx, gz, gy, rotY);
          }
        }
      }
    }
    if (ironG.length) { addMerged(ironG, mat(0x2b3a30), 'ornlamp_iron'); const gm = mergeGeometries(globeG); globeG.forEach((g) => g.dispose()); const mesh = new THREE.Mesh(gm, sharedMats.lampGlow); mesh.name = 'ornlamp_globes'; scene.add(mesh); }
  }

  // ---------- CỜ ĐỎ SAO VÀNG trên cột dọc các đại lộ trung tâm (thân thuộc + hợp 2/9) ----------
  {
    const flagTex = makeTex(128, 86, (g, w, h) => {
      g.fillStyle = '#da251d'; g.fillRect(0, 0, w, h);           // nền đỏ
      const cx = w / 2, cy = h / 2, R = h * 0.34, r = R * 0.42;  // sao vàng 5 cánh
      g.fillStyle = '#ffdd00'; g.beginPath();
      for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 ? r : R; const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad; i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.closePath(); g.fill();
    });
    const flagMat = new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide });
    const poleGeos = [], flagGeos = [];
    let fs = 777;
    const frnd = () => { fs = (fs * 1103515245 + 12345) & 0x7fffffff; return fs / 0x7fffffff; };
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p') continue;                    // chỉ đại lộ chính
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1);
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen;
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let d = 12; d < segLen - 12; d += 26) {   // cột cờ cách ~26m
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1300 * 1300) continue;
          const side = frnd() < 0.5 ? 1 : -1;
          const gx = mx + side * (ROAD_W.p / 2 + 1.2) * px, gz = mz + side * (ROAD_W.p / 2 + 1.2) * pz;
          const gy = groundHeight(gx, gz);
          if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
          const H = 5.4;
          const pole = new THREE.CylinderGeometry(0.06, 0.08, H, 6); pole.translate(gx, gy + H / 2, gz); poleGeos.push(pole);
          // lá cờ 1.4×0.9 gần đỉnh, bay dọc theo đường
          const flag = new THREE.PlaneGeometry(1.4, 0.9);
          const e = new THREE.Euler(0, rotY, 0), q = new THREE.Quaternion().setFromEuler(e);
          const mm = new THREE.Matrix4().compose(new THREE.Vector3(gx + dxn * 0.75, gy + H - 0.7, gz + dzn * 0.75), q, new THREE.Vector3(1, 1, 1));
          flag.applyMatrix4(mm); flagGeos.push(flag);
        }
      }
    }
    if (poleGeos.length) { addMerged(poleGeos, mat(0xb8bcc2), 'flagpoles'); const fm = mergeGeometries(flagGeos); flagGeos.forEach((g) => g.dispose()); const mesh = new THREE.Mesh(fm, flagMat); mesh.name = 'flags'; scene.add(mesh); }
  }

  // ---------- BĂNG RÔN CỔ ĐỘNG đỏ chữ vàng căng dọc phố (rất thân thuộc, hợp 2/9) ----------
  {
    const slogans = ['CHÀO MỪNG QUỐC KHÁNH 2 · 9', 'MỪNG ĐẢNG · MỪNG XUÂN · MỪNG ĐẤT NƯỚC ĐỔI MỚI', 'THÀNH PHỐ HOA PHƯỢNG ĐỎ'];
    const banMats = slogans.map((s) => {
      const tex = makeTex(512, 72, (g, w, h) => {
        g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, h);
        g.strokeStyle = '#ffdd00'; g.lineWidth = 5; g.strokeRect(4, 4, w - 8, h - 8);
        g.fillStyle = '#ffdd00'; g.font = "bold 34px 'Arial', sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(s, w / 2, h / 2 + 2);
      });
      return new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    });
    const banGeos = [[], [], []], banPoles = [];
    let bs = 4242; const brnd = () => { bs = (bs * 1103515245 + 12345) & 0x7fffffff; return bs / 0x7fffffff; };
    let bi = 0;
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p') continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1);
        if (segLen < 40) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen;
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let d = 30; d < segLen - 30; d += 68) {   // băng rôn cách ~68m
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1300 * 1300) continue;
          const side = brnd() < 0.5 ? 1 : -1;
          const off = side * (ROAD_W.p / 2 + 1.5);
          const cx = mx + off * px, cz = mz + off * pz;
          const gy = groundHeight(cx, cz);
          if (gy < LAND_H - 0.5 || isWater(cx, cz)) continue;
          const BW = 6, BH = 0.85, PH = 4.6;
          // 2 cột 2 đầu băng rôn
          for (const e2 of [-1, 1]) { const ex = cx + dxn * (BW / 2) * e2, ez = cz + dzn * (BW / 2) * e2; const pole = new THREE.CylinderGeometry(0.07, 0.09, PH, 6); pole.translate(ex, gy + PH / 2, ez); banPoles.push(pole); }
          const pl = new THREE.PlaneGeometry(BW, BH);
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
          pl.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, gy + PH - 0.7, cz), q, new THREE.Vector3(1, 1, 1)));
          banGeos[bi % 3].push(pl); bi++;
        }
      }
    }
    if (banPoles.length) addMerged(banPoles, mat(0x9aa0a6), 'bannerpoles');
    banGeos.forEach((geos, k) => { if (!geos.length) return; const m = mergeGeometries(geos); geos.forEach((g) => g.dispose()); const mesh = new THREE.Mesh(m, banMats[k]); mesh.name = 'banner' + k; scene.add(mesh); });
  }

  // ---------- CỘT ĐIỆN BÊ TÔNG + DÂY ĐIỆN CHẰNG CHỊT (rất đặc trưng phố Việt) ----------
  {
    const poleG = [], armG = [], wireG = [];
    const PH = 8.2;
    // cột + xà ngang; trả về [x, topY, z] để nối dây
    function utilPole(x, z, gy, rotY) {
      const p = new THREE.CylinderGeometry(0.12, 0.18, PH, 6); p.translate(x, gy + PH / 2, z); poleG.push(p);
      const px = Math.cos(rotY), pz = -Math.sin(rotY);
      for (const hy of [PH - 0.6, PH - 1.5]) { const a = new THREE.BoxGeometry(1.5, 0.1, 0.1); const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)); a.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, gy + hy, z), q, new THREE.Vector3(1, 1, 1))); armG.push(a); }
      return [x, gy, z, px, pz];
    }
    // dây võng giữa 2 cột (catenary 4 đoạn), theo offset ngang trên xà
    function stringWire(A, B, hy, lat) {
      const ax = A[0] + A[3] * lat, az = A[2] + A[4] * lat, bx = B[0] + B[3] * lat, bz = B[2] + B[4] * lat;
      const y0 = A[1] + hy, y1 = B[1] + hy, sag = 0.9, N = 4;
      let prev = null;
      for (let i = 0; i <= N; i++) { const t = i / N; const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = y0 + (y1 - y0) * t - Math.sin(t * Math.PI) * sag; if (prev) { const dx = x - prev[0], dy = y - prev[1], dz = z - prev[2]; const L = Math.hypot(dx, dy, dz); const seg = new THREE.CylinderGeometry(0.02, 0.02, L, 4); const mid = new THREE.Vector3((x + prev[0]) / 2, (y + prev[1]) / 2, (z + prev[2]) / 2); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()); seg.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1))); wireG.push(seg); } prev = [x, y, z]; }
    }
    let us = 91; const urnd = () => { us = (us * 1103515245 + 12345) & 0x7fffffff; return us / 0x7fffffff; };
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      // đi dọc toàn tuyến (nối các segment) đặt cột đều ~34m rồi nối dây
      const poles = [];
      const side = urnd() < 0.5 ? 1 : -1;
      let acc = 8;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 1) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const nx = Math.cos(rotY), nz = -Math.sin(rotY);
        for (; acc < segLen; acc += 34) {
          const mx = x1 + dxn * acc, mz = z1 + dzn * acc;
          if (mx * mx + mz * mz > 1350 * 1350) { poles.length = 0; continue; }
          const gx = mx + side * (wRoad / 2 + 1.1) * nx, gz = mz + side * (wRoad / 2 + 1.1) * nz;
          const gy = groundHeight(gx, gz);
          if (gy < LAND_H - 0.5 || isWater(gx, gz)) { poles.length && poles.push(null); continue; }
          poles.push(utilPole(gx, gz, gy, rotY));
        }
        acc -= segLen;
      }
      for (let i = 0; i < poles.length - 1; i++) { const A = poles[i], B = poles[i + 1]; if (!A || !B) continue; for (const [hy, lat] of [[PH - 0.6, -0.55], [PH - 0.6, 0.55], [PH - 1.5, -0.4], [PH - 1.5, 0.4]]) stringWire(A, B, hy, lat); }
    }
    if (poleG.length) { addMerged(poleG, mat(0x9a958c), 'utilpoles'); addMerged(armG, mat(0x6b6660), 'utilarms'); addMerged(wireG, mat(0x23262b), 'utilwires'); }
  }

  // ---------- XÍCH LÔ (biểu tượng du lịch) gần các điểm trung tâm — 2 InstancedMesh ----------
  {
    const bodyG = [], darkG = [];
    const box = (arr, w, h, l, x, y, z) => { const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); arr.push(g); };
    const wh = (x, z) => { const g = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12); g.rotateZ(Math.PI / 2); g.translate(x, 0.3, z); darkG.push(g); };
    wh(0.52, 0.62); wh(-0.52, 0.62); wh(0, -0.95);        // 2 bánh trước + 1 bánh sau
    box(bodyG, 1.02, 0.42, 0.95, 0, 0.52, 0.55);          // thùng chở khách
    box(bodyG, 1.02, 0.5, 0.12, 0, 0.78, 0.12);           // tựa lưng ghế
    box(bodyG, 0.94, 0.12, 0.8, 0, 0.74, 0.55);           // đệm ngồi
    box(darkG, 0.06, 0.5, 1.4, 0.42, 0.7, -0.3);          // khung trái
    box(darkG, 0.06, 0.5, 1.4, -0.42, 0.7, -0.3);         // khung phải
    box(darkG, 0.22, 0.1, 0.32, 0, 0.98, -0.72);          // yên tài xế
    box(darkG, 0.06, 0.44, 0.06, 0, 1.15, -0.4);          // cổ lái
    box(darkG, 0.5, 0.06, 0.06, 0, 1.32, -0.4);           // ghi-đông
    const bodyGeo = mergeGeometries(bodyG), darkGeo = mergeGeometries(darkG);
    bodyG.forEach((g) => g.dispose()); darkG.forEach((g) => g.dispose());
    const cycCols = [0x2f6db0, 0x2f8f56, 0xb23a2f, 0xcaa63c, 0x7a4bb0].map((c) => new THREE.Color(c));
    // điểm đặt gần địa danh trung tâm (chờ khách)
    const anchors = [LM.opera, LM.market, LM.cathedral, LM.station, LM.postoffice, LM.museum].filter(Boolean);
    let cs = 33; const crnd = () => { cs = (cs * 1103515245 + 12345) & 0x7fffffff; return cs / 0x7fffffff; };
    const slots = [];
    for (const [ax, az] of anchors) {
      const nC = 3 + (crnd() * 2 | 0);
      for (let k = 0; k < nC; k++) {
        const ang = crnd() * Math.PI * 2, rr = 26 + crnd() * 26;
        const gx = ax + Math.cos(ang) * rr, gz = az + Math.sin(ang) * rr;
        const gy = groundHeight(gx, gz);
        if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
        slots.push([gx, gy, gz, crnd() * Math.PI * 2, (crnd() * cycCols.length) | 0]);
      }
    }
    if (slots.length) {
      const bodyInst = new THREE.InstancedMesh(bodyGeo, mat(0xcccccc), slots.length);
      const darkInst = new THREE.InstancedMesh(darkGeo, mat(0x2a2a2e), slots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      slots.forEach(([x, y, z, ry, ci], k) => { e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y, z); m.compose(p, q, s); bodyInst.setMatrixAt(k, m); darkInst.setMatrixAt(k, m); bodyInst.setColorAt(k, cycCols[ci]); });
      bodyInst.instanceMatrix.needsUpdate = true; darkInst.instanceMatrix.needsUpdate = true; if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
      bodyInst.castShadow = darkInst.castShadow = true; bodyInst.name = 'cyclos'; scene.add(bodyInst); scene.add(darkInst);
    }
  }

  // ---------- HÀNG RONG (xe đẩy + ô che) & THÙNG RÁC công cộng dọc phố ----------
  {
    // xe hàng rong: phần "xe" (trung tính) + "ô che" (đổi màu) — 2 InstancedMesh
    const cartG = [], canopyG = [];
    const box = (arr, w, h, l, x, y, z) => { const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); arr.push(g); };
    box(cartG, 0.78, 0.55, 1.15, 0, 0.55, 0);        // thùng xe
    box(cartG, 0.72, 0.12, 1.06, 0, 0.9, 0);         // mặt bày hàng
    box(cartG, 0.24, 0.2, 0.24, -0.2, 1.06, -0.3); box(cartG, 0.22, 0.18, 0.22, 0.22, 1.05, 0.28); // rổ/thùng hàng
    { const w1 = new THREE.CylinderGeometry(0.22, 0.22, 0.1, 10); w1.rotateZ(Math.PI / 2); w1.translate(0.4, 0.22, 0); cartG.push(w1); const w2 = w1.clone(); w2.translate(-0.8, 0, 0); cartG.push(w2); }
    box(cartG, 0.05, 2.2, 0.05, 0.18, 1.55, 0);      // cột ô
    { const cone = new THREE.ConeGeometry(1.05, 0.5, 10); cone.translate(0.18, 2.6, 0); canopyG.push(cone); }
    const cartGeo = mergeGeometries(cartG), canopyGeo = mergeGeometries(canopyG);
    cartG.forEach((g) => g.dispose()); canopyG.forEach((g) => g.dispose());
    const paraCols = [0xd83b2f, 0x2f7bd8, 0x3aa35a, 0xe0a52f, 0xded2c4, 0xcf4fa0].map((c) => new THREE.Color(c));
    // thùng rác (gộp 1 mesh)
    const binG = [];
    let hs = 55; const hrnd = () => { hs = (hs * 1103515245 + 12345) & 0x7fffffff; return hs / 0x7fffffff; };
    const cartSlots = [];
    const binAnchors = [];
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 6) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const nx = Math.cos(rotY), nz = -Math.sin(rotY);
        for (let d = 5; d < segLen - 5; d += 6) {
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1300 * 1300) continue;
          const side = hrnd() < 0.5 ? 1 : -1;
          const gx = mx + side * (wRoad / 2 + 1.4) * nx, gz = mz + side * (wRoad / 2 + 1.4) * nz;
          const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
          const rv = hrnd();
          if (rv < 0.05 && cartSlots.length < 70) cartSlots.push([gx, gy, gz, hrnd() * Math.PI * 2, (hrnd() * paraCols.length) | 0]);
          else if (rv > 0.93 && binAnchors.length < 120) binAnchors.push([gx, gy, gz]);
        }
      }
    }
    for (const [x, y, z] of binAnchors) { const body = new THREE.CylinderGeometry(0.26, 0.22, 0.8, 8); body.translate(x, y + 0.4, z); binG.push(body); const lid = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 8); lid.translate(x, y + 0.84, z); binG.push(lid); }
    if (binG.length) addMerged(binG, mat(0x2f6b3a), 'trashbins');
    if (cartSlots.length) {
      const cInst = new THREE.InstancedMesh(cartGeo, mat(0x8a7f6a), cartSlots.length);
      const pInst = new THREE.InstancedMesh(canopyGeo, mat(0xcccccc), cartSlots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      cartSlots.forEach(([x, y, z, ry, ci], k) => { e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y, z); m.compose(p, q, s); cInst.setMatrixAt(k, m); pInst.setMatrixAt(k, m); pInst.setColorAt(k, paraCols[ci]); });
      cInst.instanceMatrix.needsUpdate = true; pInst.instanceMatrix.needsUpdate = true; if (pInst.instanceColor) pInst.instanceColor.needsUpdate = true;
      cInst.castShadow = pInst.castShadow = true; cInst.name = 'vendors'; scene.add(cInst); scene.add(pInst);
    }
  }

  // ---------- XE MÁY ĐỖ VỈA HÈ (đặc trưng nhất Hải Phòng) — 2 InstancedMesh low-poly ----------
  // Hero xe máy đang chạy vẫn là moto.glb Meshy; xe ĐỖ dùng scooter procedural nhẹ, instanced hàng trăm chiếc.
  {
    // hình học scooter (mũi +Z), bánh chạm đất y=0 — tách "thân" (đổi màu) và "tối" (bánh/ghi-đông)
    const bodyG = [], darkG = [];
    const box = (arr, w, h, l, x, y, z) => { const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); arr.push(g); };
    const wheel = (z) => { const g = new THREE.CylinderGeometry(0.27, 0.27, 0.14, 12); g.rotateZ(Math.PI / 2); g.translate(0, 0.27, z); darkG.push(g); };
    wheel(-0.62); wheel(0.62);
    box(bodyG, 0.46, 0.16, 1.35, 0, 0.5, 0);         // sàn/thân
    box(bodyG, 0.4, 0.34, 0.5, 0, 0.55, 0.5);        // yếm trước
    box(bodyG, 0.42, 0.17, 0.6, 0, 0.74, -0.32);     // yên
    box(bodyG, 0.34, 0.28, 0.26, 0, 0.9, -0.66);     // cốp/đuôi
    box(darkG, 0.1, 0.52, 0.1, 0, 0.9, 0.6);         // cổ phuộc
    box(darkG, 0.56, 0.07, 0.09, 0, 1.12, 0.62);     // ghi-đông
    box(darkG, 0.06, 0.44, 0.06, 0.18, 0.27, -0.62); box(darkG, 0.06, 0.44, 0.06, -0.18, 0.27, -0.62); // chân chống/khung sau
    const bodyGeo = mergeGeometries(bodyG), darkGeo = mergeGeometries(darkG);
    bodyG.forEach((g) => g.dispose()); darkG.forEach((g) => g.dispose());
    // màu thân đa dạng (đỏ, đen, xanh, trắng, xám...) — như xe thật đỗ san sát
    const scoolCols = [0xb23a2f, 0x2b2b2f, 0x3a5a8a, 0xd8d2c4, 0x6a6f76, 0x9c2f28, 0x24303a, 0xc7a24a].map((c) => new THREE.Color(c));
    // gom vị trí đỗ dọc vỉa hè các phố p/s vùng trung tâm
    const slots = [];
    let seed = 20260706;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1);
        if (segLen < 8) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen;
        const rotY = Math.atan2(x2 - x1, z2 - z1);       // dọc đường
        const px = Math.cos(rotY), pz = -Math.sin(rotY); // pháp tuyến
        for (let d = 4; d < segLen - 4; d += 1.35) {      // khoảng cách xe san sát
          // V5-fix: xe đỗ theo CỤM trước cửa hàng (model đọc dải liên tục thành "cọc chắn dày đặc")
          if (Math.sin((d + x1) * 0.35) < 0.15) continue;
          if (rnd() > 0.55) continue;
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1400 * 1400) continue;  // vùng trung tâm mở rộng
          const side = rnd() < 0.5 ? 1 : -1;
          const off = side * (wRoad / 2 + 0.85 + rnd() * 0.5);
          const gx = mx + off * px, gz = mz + off * pz;
          const gy = groundHeight(gx, gz);
          if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;   // né sông/cầu
          // mũi quay VÀO vỉa hè (vuông góc đường), lệch nhẹ cho tự nhiên
          slots.push([gx, gy, gz, rotY + Math.PI / 2 + (rnd() - 0.5) * 0.25, (rnd() * scoolCols.length) | 0]);
          if (slots.length >= 480) break;
        }
        if (slots.length >= 480) break;
      }
      if (slots.length >= 480) break;
    }
    if (slots.length) {
      const bodyInst = new THREE.InstancedMesh(bodyGeo, mat(0xcccccc), slots.length);
      const darkInst = new THREE.InstancedMesh(darkGeo, mat(0x1c1c1f), slots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      slots.forEach(([x, y, z, ry, ci], k) => {
        e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y, z); m.compose(p, q, s);
        bodyInst.setMatrixAt(k, m); darkInst.setMatrixAt(k, m);
        bodyInst.setColorAt(k, scoolCols[ci]);
      });
      bodyInst.instanceMatrix.needsUpdate = true; darkInst.instanceMatrix.needsUpdate = true;
      if (bodyInst.instanceColor) bodyInst.instanceColor.needsUpdate = true;
      bodyInst.castShadow = darkInst.castShadow = true;
      bodyInst.name = 'parked_scooters'; scene.add(bodyInst); scene.add(darkInst);
    }
  }

  // ---------- QUÁN VỈA HÈ: bàn + ghế nhựa đỏ/xanh + ô dù (rất thân thuộc, 27 cụm thật từ pano) ----------
  {
    // 1 "bộ" = bàn nhựa thấp + 4 ghế con; ô dù tách riêng để đổi màu
    const setG = [], parasolG = [];
    const cyl = (arr, rt, rb, h, x, y, z) => { const g = new THREE.CylinderGeometry(rt, rb, h, 10); g.translate(x, y, z); arr.push(g); };
    cyl(setG, 0.34, 0.34, 0.04, 0, 0.44, 0);         // mặt bàn
    cyl(setG, 0.04, 0.05, 0.44, 0, 0.22, 0);          // chân bàn
    for (const [sx, sz] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) { cyl(setG, 0.15, 0.15, 0.05, sx, 0.29, sz); cyl(setG, 0.03, 0.03, 0.29, sx, 0.145, sz); } // 4 ghế con
    cyl(parasolG, 0.04, 0.04, 2.15, 0, 1.07, 0);      // cột ô
    { const c = new THREE.ConeGeometry(1.35, 0.42, 12); c.translate(0, 2.35, 0); parasolG.push(c); } // tán ô
    const setGeo = mergeGeometries(setG), parasolGeo = mergeGeometries(parasolG);
    setG.forEach((g) => g.dispose()); parasolG.forEach((g) => g.dispose());
    const plasticCols = [0xd6382c, 0x2f6bd8, 0x2f9c4a, 0xe6e0d2].map((c) => new THREE.Color(c)); // đỏ/xanh dương/xanh lá/trắng
    const parasolCols = [0xd6382c, 0x2f6bd8, 0xe0a52f, 0x2f9c4a, 0xded2c4].map((c) => new THREE.Color(c));
    const FOOD = [[95.9,40.2],[185,94.5],[33.7,-229.6],[40.5,-340.6],[355.9,-243],[-429.1,73.9],[461.4,20.8],[-459.1,255.3],[591.5,50.1],[-325.2,513.1],[-143.5,601.5],[347.3,513.3],[-49,-627.1],[650.3,-5.6],[-405,528.9],[-357.2,-619.9],[-298.5,-704.8],[-400.7,-688.1],[-245.3,-766],[-783.2,185.2],[724.5,-395.6],[-47.8,842.8],[-825,-274.3],[-935,-96.6],[656.4,779.3],[929.7,-442.6],[-50.2,-1080.8]];
    let fs = 771; const frnd = () => { fs = (fs * 1103515245 + 12345) & 0x7fffffff; return fs / 0x7fffffff; };
    // BÀI HỌC PANO-LOOP V1: FOOD là tọa độ PANO (tim đường) → dời cụm quán sang VỈA HÈ:
    // chiếu lên đoạn đường gần nhất rồi đẩy ngang (nửa lòng + 2.6m); từng món vẫn né lòng đường.
    const _fsd = (px, pz, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t)); };
    const _onRoadF = (px, pz, m) => { for (const r of ROADS_DT) { if (r.c === 'w') continue; const hw = ROAD_W[r.c] / 2 + m; for (let i = 0; i < r.pts.length - 1; i++) if (_fsd(px, pz, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]) < hw) return true; } return false; };
    const toSidewalk = (cx, cz) => {
      let bd = 1e9, bx = cx, bz = cz, bn = null;
      for (const r of ROADS_DT) { if (r.c === 'w') continue; const hw = ROAD_W[r.c] / 2;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
          const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; if (!l2) continue;
          let t = ((cx - x1) * dx + (cz - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
          const px = x1 + dx * t, pz = z1 + dz * t, d = Math.hypot(cx - px, cz - pz);
          if (d < bd) { bd = d; const L = Math.sqrt(l2); let nx = -(dz / L), nz = dx / L;
            if (nx * (cx - px) + nz * (cz - pz) < 0) { nx = -nx; nz = -nz; }   // đẩy về phía cụm gốc
            bx = px + nx * (hw + 2.6); bz = pz + nz * (hw + 2.6); bn = true; }
        } }
      return bn && bd < 40 ? [bx, bz] : [cx, cz];
    };
    const setSlots = [], paraSlots = [];
    for (const [fx0, fz0] of FOOD) {
      const [cx, cz] = toSidewalk(fx0, fz0);
      const nSet = 3 + ((frnd() * 3) | 0);
      for (let k = 0; k < nSet; k++) {
        const gx = cx + (frnd() - 0.5) * 4.5, gz = cz + (frnd() - 0.5) * 4.5;
        const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz) || _onRoadF(gx, gz, 0.6)) continue;
        setSlots.push([gx, gy, gz, frnd() * Math.PI, (frnd() * plasticCols.length) | 0]);
      }
      const nPar = 1 + ((frnd() * 2) | 0);
      for (let k = 0; k < nPar; k++) {
        const gx = cx + (frnd() - 0.5) * 4, gz = cz + (frnd() - 0.5) * 4;
        const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz) || _onRoadF(gx, gz, 0.6)) continue;
        paraSlots.push([gx, gy, gz, (frnd() * parasolCols.length) | 0]);
      }
    }
    const putInst = (geo, baseMat, slots, cols, name, withRot) => {
      if (!slots.length) return;
      const inst = new THREE.InstancedMesh(geo, baseMat, slots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      slots.forEach((sl, k) => { const [x, y, z] = sl; const ry = withRot ? sl[3] : 0, ci = sl[withRot ? 4 : 3];
        e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y, z); m.compose(p, q, s); inst.setMatrixAt(k, m); inst.setColorAt(k, cols[ci]); });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = true; inst.name = name; scene.add(inst);
    };
    putInst(setGeo, mat(0xcccccc), setSlots, plasticCols, 'streetside_furniture', true);
    putInst(parasolGeo, mat(0xcccccc), paraSlots, parasolCols, 'streetside_parasols', false);
  }

  // ---------- ĐÀI PHUN NƯỚC (8 điểm thật: quảng trường, công viên, sảnh Trung tâm Hội nghị) ----------
  {
    const stoneG = [], waterG = [];
    const FOUNT = [[-31,78.7],[276.4,-264.3],[559.2,-300.1],[525.1,-448.2],[685.4,-323.9],[705.6,-358.9],[697.7,-447.5],[295.1,-799.5]];
    for (const [x, z] of FOUNT) {
      const gy = groundHeight(x, z); if (gy < LAND_H - 0.5 || isWater(x, z)) continue;
      const wall = new THREE.CylinderGeometry(2.0, 2.1, 0.55, 22); wall.translate(x, gy + 0.27, z); stoneG.push(wall);
      const inner = new THREE.CylinderGeometry(1.7, 1.7, 0.5, 22); inner.translate(x, gy + 0.24, z); // lòng
      const water = new THREE.CylinderGeometry(1.72, 1.72, 0.08, 22); water.translate(x, gy + 0.46, z); waterG.push(water);
      const tier1 = new THREE.CylinderGeometry(0.55, 0.72, 0.5, 14); tier1.translate(x, gy + 0.75, z); stoneG.push(tier1);
      const dish = new THREE.CylinderGeometry(0.95, 0.95, 0.12, 16); dish.translate(x, gy + 1.02, z); stoneG.push(dish);
      const tier2 = new THREE.CylinderGeometry(0.28, 0.4, 0.5, 12); tier2.translate(x, gy + 1.3, z); stoneG.push(tier2);
      const top = new THREE.SphereGeometry(0.26, 10, 8); top.translate(x, gy + 1.62, z); stoneG.push(top);
      addCollider(x, z, 2.1);
    }
    if (stoneG.length) addMerged(stoneG, mat(0xcfc9ba), 'fountains');
    if (waterG.length) addMerged(waterG, new THREE.MeshLambertMaterial({ color: 0x2f7fb5, transparent: true, opacity: 0.82, emissive: 0x18506f, emissiveIntensity: 0.15 }), 'fountain_water');
  }

  // ---------- CÂY XĂNG PETROLIMEX (mái che khung thép sơn khoang xanh–cam đặc trưng) ----------
  {
    const whiteG = [], orangeG = [], blueG = [], pumpG = [], darkG = [];
    const RAW = [[168.6,7.9],[224.6,-20],[211.7,80.4],[-897,-471.1],[664.9,-799]];
    const GAS = []; for (const c of RAW) { if (!GAS.some((k) => Math.hypot(k[0]-c[0], k[1]-c[1]) < 60)) GAS.push(c); }
    for (const [x, z] of GAS) {
      const gy = groundHeight(x, z); if (gy < LAND_H - 0.5 || isWater(x, z)) continue;
      // 4 trụ
      for (const [px, pz] of [[3,4],[-3,4],[3,-4],[-3,-4]]) { const pil = new THREE.BoxGeometry(0.28, 5, 0.28); pil.translate(x+px, gy+2.5, z+pz); whiteG.push(pil); }
      const roof = new THREE.BoxGeometry(7.2, 0.35, 10.2); roof.translate(x, gy + 5.1, z); whiteG.push(roof);
      const fasO = new THREE.BoxGeometry(7.4, 0.42, 10.4); fasO.translate(x, gy + 4.78, z); orangeG.push(fasO);   // khoang cam
      const fasB = new THREE.BoxGeometry(7.5, 0.3, 10.5); fasB.translate(x, gy + 4.5, z); blueG.push(fasB);       // khoang xanh
      // 2 trụ bơm
      for (const [px, pz] of [[1.2,0],[-1.2,0]]) { const pm = new THREE.BoxGeometry(0.6, 1.7, 0.95); pm.translate(x+px, gy+0.85, z+pz); pumpG.push(pm); const hd = new THREE.BoxGeometry(0.64, 0.4, 0.99); hd.translate(x+px, gy+1.55, z+pz); darkG.push(hd); }
      addCollider(x+3, z+4, 0.4); addCollider(x-3, z-4, 0.4);
    }
    if (whiteG.length) addMerged(whiteG, mat(0xe9e6df), 'gasstation_frame');
    if (orangeG.length) addMerged(orangeG, mat(0xe87a1e), 'gasstation_orange');
    if (blueG.length) addMerged(blueG, mat(0x1e5aa8), 'gasstation_blue');
    if (pumpG.length) addMerged(pumpG, mat(0xd8d2c6), 'gasstation_pumps');
    if (darkG.length) addMerged(darkG, mat(0x2a2d31), 'gasstation_pumpheads');
  }

  // ---------- CHỮ 3D "HẢI PHÒNG" (cụm chữ check-in đỏ khổ lớn, pano_009 [-718,219] bờ hồ Tam Bạc) ----------
  {
    // BÀI HỌC PANO-LOOP V1: tọa độ pano = TIM ĐƯỜNG (xe Google) → không đặt đồ vật tại đó.
    // Dò điểm trên MẶT LÁT KÈ HỒ: đất chuẩn + cách trục mọi đường lớn >(nửa lòng+2m) + gần mép hồ.
    const _hsd = (px, pz, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t)); };
    const _onRoadHP = (px, pz) => { for (const r of ROADS_DT) { if (r.c === 'w') continue; const hw = ROAD_W[r.c] / 2 + 2; for (let i = 0; i < r.pts.length - 1; i++) if (_hsd(px, pz, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]) < hw) return true; } return false; };
    let x = -718.6, z = 219.3;
    {
      let best = null, bd = 1e9;
      for (let r = 3; r <= 90; r += 3) { for (let a = 0; a < 24; a++) {
        const tx = -718.6 + Math.cos(a / 24 * Math.PI * 2) * r, tz = 219.3 + Math.sin(a / 24 * Math.PI * 2) * r;
        const sd = lakeSD(tx, tz);
        if (!isWater(tx, tz) && Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) < 0.4 && !_onRoadHP(tx, tz) && sd > 2 && sd < 30) { bd = r; best = [tx, tz]; break; }
      } if (best) break; }
      if (best) { x = best[0]; z = best[1]; }
    }
    const gy = groundHeight(x, z);
    if (gy > LAND_H - 0.5 && !isWater(x, z)) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.5, 1.4), mat(0x9a2a24)); base.position.set(x, gy + 0.25, z); base.name = 'hp_letters'; scene.add(base);
      const tex = makeTex(512, 150, (g, w, h) => { g.fillStyle = '#c62828'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#fff'; g.font = 'bold 96px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText('HẢI PHÒNG', w / 2, h / 2 + 6); });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 0.35), [mat(0xb23029), mat(0xb23029), mat(0xb23029), mat(0xb23029), new THREE.MeshLambertMaterial({ map: tex }), new THREE.MeshLambertMaterial({ map: tex })]);
      sign.position.set(x, gy + 1.75, z); scene.add(sign);
      addCollider(x, z, 4.2);
    }
  }

  // ---------- HÒN NON BỘ / ĐẢO CÂY CẢNH giữa vòng xuyến (cau vua + đá cảnh + bonsai) ----------
  {
    const rockG = [], moundG = [], trunkG = [], frondG = [];
    const RAW = [[498.6,-239.9],[534.1,-269.6],[-110.6,-937.7],[-201.6,-943.3],[653.9,-869.4]];
    const RB = []; for (const c of RAW) { if (!RB.some((k) => Math.hypot(k[0]-c[0], k[1]-c[1]) < 40)) RB.push(c); }
    let rs = 349; const rr = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
    for (const [x, z] of RB) {
      const gy = groundHeight(x, z); if (gy < LAND_H - 0.5 || isWater(x, z)) continue;
      const mound = new THREE.CylinderGeometry(3.2, 3.6, 0.4, 20); mound.translate(x, gy + 0.2, z); moundG.push(mound);
      const nRock = 3 + ((rr() * 3) | 0);
      for (let k = 0; k < nRock; k++) { const rk = new THREE.IcosahedronGeometry(0.5 + rr() * 0.7, 0); const rx = x + (rr()-0.5)*3, rz = z + (rr()-0.5)*3; rk.translate(rx, gy + 0.4 + rr()*0.3, rz); rockG.push(rk); }
      // cau vua giữa đảo
      const tr = new THREE.CylinderGeometry(0.12, 0.18, 3.6, 8); tr.translate(x, gy + 1.8, z); trunkG.push(tr);
      for (let f = 0; f < 6; f++) { const ang = f / 6 * Math.PI * 2; const fr = new THREE.BoxGeometry(0.16, 0.08, 1.8); fr.rotateY(ang); fr.rotateX(-0.5); fr.translate(x + Math.cos(ang)*0.8, gy + 3.5, z + Math.sin(ang)*0.8); frondG.push(fr); }
      addCollider(x, z, 3.2);
    }
    if (moundG.length) addMerged(moundG, mat(0x5f8a45), 'rockery_mound');
    if (rockG.length) addMerged(rockG, mat(0x8d8a82, { flatShading: true }), 'rockery_rocks');
    if (trunkG.length) addMerged(trunkG, sharedMats.trunk, 'rockery_palmtrunk');
    if (frondG.length) addMerged(frondG, sharedMats.leafDark, 'rockery_palmfronds');
  }

  // ---------- Ô TÔ ĐỖ dọc đại lộ (thực tế nhiều ô tô đỗ; game trước thiên về xe máy) ----------
  {
    const carG = [], wheelG = [];
    const box = (arr, w, h, l, x, y, z) => { const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); arr.push(g); };
    box(carG, 1.72, 0.5, 4.2, 0, 0.55, 0);            // thân
    box(carG, 1.5, 0.5, 2.2, 0, 1.0, -0.15);          // ca-bin
    { const wl = (z) => { for (const sx of [0.82, -0.82]) { const g = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 10); g.rotateZ(Math.PI/2); g.translate(sx, 0.32, z); wheelG.push(g); } }; wl(1.35); wl(-1.35); }
    const carGeo = mergeGeometries(carG), wheelGeo = mergeGeometries(wheelG);
    carG.forEach((g) => g.dispose()); wheelG.forEach((g) => g.dispose());
    const carCols = [0x1c1c20, 0xe4e2dc, 0xb0b3b6, 0x9c2f28, 0x64686e, 0x24354f, 0x3a3f45].map((c) => new THREE.Color(c));
    const slots = [];
    let cs = 20260707; const cr = () => { cs = (cs * 1103515245 + 12345) & 0x7fffffff; return cs / 0x7fffffff; };
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri]; if (r.c !== 'p') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 12) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let d = 6; d < segLen - 6; d += 5.5) {
          if (cr() > 0.5) continue;
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1350 * 1350) continue;
          const side = cr() < 0.5 ? 1 : -1;
          const off = side * (wRoad / 2 + 1.3);
          const gx = mx + off * px, gz = mz + off * pz;
          const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
          slots.push([gx, gy, gz, rotY + (cr() - 0.5) * 0.12, (cr() * carCols.length) | 0]);
          if (slots.length >= 200) break;
        }
        if (slots.length >= 200) break;
      }
      if (slots.length >= 200) break;
    }
    if (slots.length) {
      const carInst = new THREE.InstancedMesh(carGeo, mat(0xcccccc), slots.length);
      const whInst = new THREE.InstancedMesh(wheelGeo, mat(0x18181b), slots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      slots.forEach(([x, y, z, ry, ci], k) => { e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y, z); m.compose(p, q, s); carInst.setMatrixAt(k, m); whInst.setMatrixAt(k, m); carInst.setColorAt(k, carCols[ci]); });
      carInst.instanceMatrix.needsUpdate = true; whInst.instanceMatrix.needsUpdate = true; if (carInst.instanceColor) carInst.instanceColor.needsUpdate = true;
      carInst.castShadow = whInst.castShadow = true; carInst.name = 'parked_cars'; scene.add(carInst); scene.add(whInst);
    }
  }

  // ---------- CÔNG TRÌNH ĐẶC TRƯNG dải trung tâm (procedural tỉ mỉ theo mô tả pano) ----------
  {
    // texture mặt tiền lưới cửa sổ trên nền màu tòa nhà
    const facadeTex = (baseCss, winCss, cols, rows) => {
      const t = makeTex(256, 256, (g, w, h) => {
        g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
        const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.16, my + r * ch + ch * 0.16, cw * 0.68, ch * 0.66);
        }
      });
      t.wrapS = t.wrapT = THREE.RepeatWrapping; return new THREE.MeshLambertMaterial({ map: t });
    };
    // hướng mặt tiền: quay về đoạn đường 'p'/'s' gần nhất
    const faceRoad = (x, z) => {
      let bd = 1e9, ry = 0;
      for (const r of ROADS_DT) { if (r.c !== 'p' && r.c !== 's' && r.c !== 't') continue;
        for (let i = 0; i < r.pts.length - 1; i++) { const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
          const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, d = Math.hypot(mx - x, mz - z);
          if (d < bd) { bd = d; ry = Math.atan2(mx - x, mz - z); } } }
      return ry;
    };

    // (1) KHÁCH SẠN HỮU NGHỊ — tháp 12 tầng, khối ban công hộp nhô ra đặc trưng (pano_158 [257,-452])
    {
      const hx = 257, hz = -451.9, gy = groundHeight(hx, hz);
      if (gy > LAND_H - 0.5 && !isWater(hx, hz)) {
        const grp = new THREE.Group(); grp.position.set(hx, gy, hz); grp.rotation.y = faceRoad(hx, hz);
        const W = 22, D = 15, FL = 12, FH = 3.2, H = FL * FH;
        const pod = new THREE.Mesh(new THREE.BoxGeometry(W + 3, 4.4, D + 3), mat(0xe7dfd0)); pod.position.set(0, 2.2, 0); grp.add(pod);
        const tower = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), facadeTex('#e9e2d4', '#3f5a6b', 6, 11)); tower.position.set(0, 4.4 + H / 2, 0); grp.add(tower);
        // ban công hộp nhô ra (2 mặt W), lưới đặc trưng
        const balG = [];
        for (let f = 1; f < FL; f++) for (let c = -2; c <= 2; c++) {
          for (const zside of [D / 2 + 0.5, -D / 2 - 0.5]) { const bb = new THREE.BoxGeometry(3, 2.1, 1.1); bb.translate(c * 3.9, 4.4 + f * FH + 0.4, zside); balG.push(bb); }
        }
        const balMesh = new THREE.Mesh(mergeGeometries(balG), mat(0xd9d0bd)); balG.forEach((g) => g.dispose()); grp.add(balMesh);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 1, D + 1), mat(0xbfb6a2)); roof.position.set(0, 4.4 + H + 0.5, 0); grp.add(roof);
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; }); grp.name = 'ks_huunghi'; scene.add(grp);
        addCollider(hx, hz, Math.max(W, D) / 2 + 1);
      }
    }

    // (2) TÒA HOÀNG LONG — tân cổ điển mạ vàng, hàng cột + đầu hồi + cặp sư tử (pano_354 [10,-269])
    {
      const bx = 10.2, bz = -269.4, gy = groundHeight(bx, bz);
      if (gy > LAND_H - 0.5 && !isWater(bx, bz)) {
        const grp = new THREE.Group(); grp.position.set(bx, gy, bz); grp.rotation.y = faceRoad(bx, bz);
        const W = 18, D = 13, FL = 5, FH = 3.6, H = FL * FH;
        const goldMat = mat(0xc9a84e), creamMat = facadeTex('#e8dcae', '#8a6a2a', 5, 4);
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), creamMat); body.position.set(0, H / 2, 0); grp.add(body);
        // hàng cột mặt trước
        const colG = [];
        for (let c = -2; c <= 2; c++) { const cyl = new THREE.CylinderGeometry(0.5, 0.55, H - 1, 12); cyl.translate(c * 3.6, (H - 1) / 2 + 0.5, D / 2 + 0.3); colG.push(cyl); }
        grp.add(new THREE.Mesh(mergeGeometries(colG), goldMat)); colG.forEach((g) => g.dispose());
        // đầu hồi tam giác (fronton)
        const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.01, W * 0.62, 3.2, 3), goldMat); ped.rotation.y = Math.PI; ped.position.set(0, H + 1.6, D / 2 - 1); ped.scale.set(1, 1, 0.35); grp.add(ped);
        // cặp sư tử ở cửa
        const lionG = [];
        for (const sx of [-3.5, 3.5]) { const base = new THREE.BoxGeometry(1.2, 1.4, 1.2); base.translate(sx, 0.7, D / 2 + 2); lionG.push(base); const body2 = new THREE.SphereGeometry(0.6, 8, 6); body2.scale(1, 0.8, 1.4); body2.translate(sx, 1.7, D / 2 + 2); lionG.push(body2); }
        grp.add(new THREE.Mesh(mergeGeometries(lionG), mat(0xd8c98a))); lionG.forEach((g) => g.dispose());
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; }); grp.name = 'toa_hoanglong'; scene.add(grp);
        addCollider(bx, bz, Math.max(W, D) / 2 + 1);
      }
    }

    // (3) NHÀ PHÁP 2 TẦNG HÀNH LANG CUỐN VÒM (pano_358 [237,-265]) — vàng, cửa vòm
    {
      const bx = 236.5, bz = -265.1, gy = groundHeight(bx, bz);
      if (gy > LAND_H - 0.5 && !isWater(bx, bz)) {
        const grp = new THREE.Group(); grp.position.set(bx, gy, bz); grp.rotation.y = faceRoad(bx, bz);
        const W = 16, D = 11, H = 8.4;
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), facadeTex('#e4c96f', '#7a5a20', 5, 2)); body.position.set(0, H / 2, 0); grp.add(body);
        // hành lang cuốn vòm tầng trệt: các cột + vòm bán nguyệt
        const archG = [];
        for (let c = -2; c <= 2; c++) { const pil = new THREE.BoxGeometry(0.7, 4.2, 0.7); pil.translate(c * 3.4, 2.1, D / 2 + 0.4); archG.push(pil);
          const arc = new THREE.TorusGeometry(1.2, 0.28, 6, 14, Math.PI); arc.rotateY(0); arc.translate(c * 3.4 + 1.7, 4.2, D / 2 + 0.4); archG.push(arc); }
        grp.add(new THREE.Mesh(mergeGeometries(archG), mat(0xefe6cf))); archG.forEach((g) => g.dispose());
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.8, D + 1.4), mat(0x7a3b2a)); roof.position.set(0, H + 0.4, 0); grp.add(roof);
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; }); grp.name = 'nha_phap_arcade'; scene.add(grp);
        addCollider(bx, bz, Math.max(W, D) / 2 + 1);
      }
    }
  }

  // (MÁI HIÊN BẠT + BIỂN HIỆU chuyển xuống SAU khối bằng-chứng-nhà: cần houseEvidence/openSpace/panoDenies
  //  để biển hiệu chỉ mọc trước NHÀ THẬT — hết biển "bay" lơ lửng trên mặt hồ/quảng trường/vườn hoa)

  // ---------- PANÔ CỔ ĐỘNG đỏ sao vàng + HÀNG RÀO CÔNG SỞ + CỘT CỜ (rất thân thuộc VN, theo pano) ----------
  {
    const faceRoadM = (x, z) => { let bd = 1e9, ry = 0; for (const r of ROADS_DT) { if (r.c !== 'p' && r.c !== 's' && r.c !== 't') continue; for (let i = 0; i < r.pts.length - 1; i++) { const mx = (r.pts[i][0] + r.pts[i + 1][0]) / 2, mz = (r.pts[i][1] + r.pts[i + 1][1]) / 2, d = Math.hypot(mx - x, mz - z); if (d < bd) { bd = d; ry = Math.atan2(mx - x, mz - z); } } } return ry; };
    const MURALS = [[616.2,-869.1],[498.1,-844.5],[-575.9,281],[-300.7,224.1],[-429.1,73.9],[-129.7,683.5],[-187.8,201.6],[-119.7,97.5],[-256,-291.7],[387.1,-135.3],[68.3,-616.8],[-45.6,-319.3]];
    const CIVIC = [[-556.3,436.6],[763.8,253.2],[-777.3,11]];
    const muralTex = makeTex(256, 160, (g, w, h) => {
      g.fillStyle = '#c1201a'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd21a'; const cx = w * 0.22, cy = h * 0.5, R = h * 0.32, r = R * 0.42; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.fill();
      g.fillStyle = '#ffe9a8'; for (let i = 0; i < 3; i++) g.fillRect(w * 0.42, h * (0.3 + i * 0.2), w * 0.5, h * 0.09);
    });
    const muralMat = new THREE.MeshLambertMaterial({ map: muralTex });
    // KHÔNG đặt panô/hàng rào GIỮA ĐƯỜNG (user: "biển sao vàng giữa đường dẹp hết") — tọa độ
    // hardcode từ trước giờ rơi vào lòng đường sau các đợt chỉnh map
    const onRoadM = (x, z) => {
      for (const r of ROADS_DT) { if (!'pstr'.includes(r.c)) continue; const hw = ROAD_W[r.c] / 2 + 2;
        for (let i = 0; i < r.pts.length - 1; i++) { const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
          const ddx = x2 - x1, ddz = z2 - z1, l2 = ddx * ddx + ddz * ddz || 1e-9;
          let t = ((x - x1) * ddx + (z - z1) * ddz) / l2; t = Math.max(0, Math.min(1, t));
          if (Math.hypot(x - (x1 + ddx * t), z - (z1 + ddz * t)) < hw) return true; } }
      return false;
    };
    const postG = [];
    for (const [x, z] of MURALS) { const gy = groundHeight(x, z); if (gy < LAND_H - 0.5 || isWater(x, z) || onRoadM(x, z) || lakeSD(x, z) < 18) continue;
      const ry = faceRoadM(x, z);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.6, 0.2), [mat(0x9a1c17), mat(0x9a1c17), mat(0x9a1c17), mat(0x9a1c17), muralMat, muralMat]);
      panel.position.set(x, gy + 3.0, z); panel.rotation.y = ry; panel.name = 'mural'; scene.add(panel);
      const dx = Math.sin(ry + Math.PI / 2), dz = Math.cos(ry + Math.PI / 2);
      for (const s of [-1, 1]) { const p = new THREE.CylinderGeometry(0.1, 0.12, 3.6, 6); p.translate(x + dx * 1.7 * s, gy + 1.8, z + dz * 1.7 * s); postG.push(p); }
      addCollider(x, z, 0.6);
    }
    if (postG.length) addMerged(postG, mat(0x8a8f92), 'mural_posts');
    const fenceG = [];
    const flagTex = makeTex(80, 54, (g, w, h) => { g.fillStyle = '#da251d'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffdd00'; const cx = w / 2, cy = h / 2, R = h * 0.34, r = R * 0.42; g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r : R, px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad; i ? g.lineTo(px, py) : g.moveTo(px, py); } g.closePath(); g.fill(); });
    for (const [x, z] of CIVIC) { const gy = groundHeight(x, z); if (gy < LAND_H - 0.5 || isWater(x, z) || onRoadM(x, z)) continue;
      const ry = faceRoadM(x, z), dx = Math.cos(ry), dz = -Math.sin(ry);
      for (let t = -5; t <= 5; t += 0.55) { const bar = new THREE.BoxGeometry(0.07, 1.4, 0.07); bar.translate(x + dx * t, gy + 0.7, z + dz * t); fenceG.push(bar); }
      const top = new THREE.BoxGeometry(10.6, 0.12, 0.12); top.rotateY(ry); top.translate(x, gy + 1.4, z); fenceG.push(top);
      const bot = new THREE.BoxGeometry(10.6, 0.12, 0.12); bot.rotateY(ry); bot.translate(x, gy + 0.2, z); fenceG.push(bot);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 7, 8), mat(0xd8dce0)); pole.position.set(x, gy + 3.5, z); scene.add(pole);
      const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.5), new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide })); flag.position.set(x + 1.1, gy + 6, z); scene.add(flag);
      addCollider(x, z, 0.5);
    }
    if (fenceG.length) addMerged(fenceG, mat(0x35503a), 'civic_fences');
  }

  // ---------- 1.200+ TÒA NHÀ THẬT (footprint OSM đùn khối, gộp 1 mesh) ----------
  // BẢN ĐỒ BẰNG CHỨNG NHÀ: lưới centroid nhà OSM (_bldGrid) + lưới điểm nhà từ pano (housemap.js)
  const _bldGrid = new Map();
  const _phGrid = new Map();
  for (const [x, z] of PANO_HOUSES) { const k = `${Math.floor(x / 24)},${Math.floor(z / 24)}`; let l = _phGrid.get(k); if (!l) _phGrid.set(k, l = []); l.push([x, z]); }
  const _gridNear = (grid, x, z, r) => {
    const kx = Math.floor(x / 24), kz = Math.floor(z / 24), r2 = r * r, span = Math.ceil(r / 24);
    for (let dx = -span; dx <= span; dx++) for (let dz = -span; dz <= span; dz++) {
      const l = grid.get(`${kx + dx},${kz + dz}`); if (!l) continue;
      for (const [px, pz] of l) if ((x - px) ** 2 + (z - pz) ** 2 < r2) return true;
    }
    return false;
  };
  const _psGrid = new Map();
  for (const p of PANO_SIDES) { const k = `${Math.floor(p[0] / 24)},${Math.floor(p[1] / 24)}`; let l = _psGrid.get(k); if (!l) _psGrid.set(k, l = []); l.push([p[0], p[1]]); }
  // BẰNG CHỨNG để được đặt nhà: pano thấy nhà trong 20m; hoặc vùng KHÔNG pano nào (45m) thì cần nhà OSM trong 50m
  const houseEvidence = (x, z) => _gridNear(_phGrid, x, z, 20) || (!_gridNear(_psGrid, x, z, 45) && _gridNear(_bldGrid, x, z, 50));
  world.buildingCells = new Set();
  {
    const bldGeos = [];
    // chừa chỗ quanh địa danh; trường học là KHUÔN VIÊN rộng nên chừa rộng hơn
    const lmSkip = Object.entries(LM).map(([k, [x, z]]) =>
      [x, z, (k === 'thptnq' || k === 'thcsnq' || k === 'thcstp') ? 120 : 80]);
    const wallPalette = [0xf5e4b8, 0xf0cfa0, 0xdfe8dc, 0xf4b8a0, 0xcfe0ee, 0xf7efc9, 0xe8d0b0, 0xd8c8a8]
      .map((c) => new THREE.Color(c));
    const roofPalette = [0xc24a30, 0x96603c, 0xa84036, 0x8a8f96].map((c) => new THREE.Color(c));
    // ngói dốc kiểu Pháp cổ / nhà phố cũ cho DÃY TRUNG TÂM (nhà thấp tầng)
    const tilePalette = [0xb5462c, 0xc85a34, 0xa23c28, 0x9c5636, 0xbb5a30].map((c) => new THREE.Color(c));
    // Mái hip (4 dốc) phủ lên bbox footprint — đọc ngay ra "phố cổ mái ngói".
    function hipRoofGeo(x0, x1, z0, z1, yT, rh, col) {
      const o = 0.7;                       // đua mái (eaves)
      x0 -= o; x1 += o; z0 -= o; z1 += o;
      const zc = (z0 + z1) / 2, xc = (x0 + x1) / 2, yR = yT + rh;
      const longX = (x1 - x0) >= (z1 - z0);
      const insX = longX ? Math.min((x1 - x0) * 0.28, 5) : 0;
      const insZ = longX ? 0 : Math.min((z1 - z0) * 0.28, 5);
      // 4 mép mái + đỉnh nóc (ridge 2 điểm)
      const A = [x0, yT, z0], B = [x1, yT, z0], C = [x1, yT, z1], D = [x0, yT, z1];
      const R0 = [longX ? x0 + insX : xc, yR, longX ? zc : z0 + insZ];
      const R1 = [longX ? x1 - insX : xc, yR, longX ? zc : z1 - insZ];
      // ridge dọc trục dài; 2 mặt dốc hình thang + 2 mặt hồi tam giác
      const raw = longX
        ? [A, B, R1, A, R1, R0, C, D, R0, C, R0, R1, B, C, R1, D, A, R0]
        : [D, A, R0, D, R0, R1, B, C, R1, B, R1, R0, A, B, R0, C, D, R1];
      // đảo thứ tự đỉnh mỗi tam giác để pháp tuyến hướng LÊN (mặt ngói nhìn từ trên)
      const src = [];
      for (let t = 0; t < raw.length; t += 3) src.push(raw[t], raw[t + 2], raw[t + 1]);
      const pos = new Float32Array(src.length * 3);
      src.forEach((v, i) => { pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2]; });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(src.length * 2), 2));
      const cols = new Float32Array(src.length * 3);
      const nrm = g.attributes.normal;
      for (let i = 0; i < src.length; i++) {
        const sh = 0.82 + 0.18 * Math.max(0, nrm.getY(i));
        cols[i * 3] = col.r * sh; cols[i * 3 + 1] = col.g * sh; cols[i * 3 + 2] = col.b * sh;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    }
    // Bồn nước mái (inox/xanh) — đặc trưng nhà ống Việt Nam (theo Street View thật)
    function waterTankGeo(cx, cz, yTop, seed) {
      const g = new THREE.CylinderGeometry(0.62, 0.62, 1.45, 9).toNonIndexed();
      g.translate(cx, yTop + 0.75, cz);
      const col = seed % 3 === 0 ? new THREE.Color(0x2f6fb0) : new THREE.Color(0x9aa6ae);
      const n = g.attributes.position.count, cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b; }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      return g;
    }
    let nBld = 0, nRoof = 0;
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
      // Lõi trung tâm: phố thương mại thực tế 3-5 tầng liền mạch (đối chiếu pano) → nâng nhà generic
      const central = (cx * cx + cz * cz) < 780 * 780;
      let lv;
      if (b.l > 0) lv = central ? Math.max(b.l, 3) : b.l;
      else if (central) lv = (b.a < 130 ? 3 + (hash % 3) : 3 + (hash % 4)); // 3-5 / 3-6 tầng (shophouse sơn màu)
      else lv = (b.a < 150 ? 2 + (hash % 3) : 2 + (hash % 2));
      const h = Math.min(62, 3 + lv * 3.3);   // 1:1 — 3.3m/tầng thật
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
        const glassy = h > 30; // CHỈ cao ốc thật (~9+ tầng) mới tông kính; shophouse 3-6 tầng giữ tường sơn màu
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
          // TẦNG TRỆT SHOPFRONT: nhà ống VN tầng 1 là cửa hàng/kính/cửa cuốn tối màu ấm
          if (!isRoof) {
            const yRel = posA.getY(i) - LAND_H;
            if (yRel > 0.15 && yRel < 3.5) {
              cols[i * 3] = 0.34 * shade; cols[i * 3 + 1] = 0.31 * shade; cols[i * 3 + 2] = 0.29 * shade;
              continue;
            }
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
        // Mái ngói dốc kiểu Pháp cổ cho nhà THẤP tầng ở DÃY TRUNG TÂM (không kính, footprint gọn)
        const central = rectFactor(cx, DT_BOX.x1, DT_BOX.x2, cz, DT_BOX.z1, DT_BOX.z2, 60);
        const w0 = maxX - minX, d0 = maxZ - minZ;
        if (central > 0.3 && !glassy && w0 < 46 && d0 < 46 && w0 > 3 && d0 > 3) {
          if (h <= 17 && hash % 100 < 48) {          // ~48% nhà thấp: mái ngói dốc kiểu Pháp cổ
            const rh = 2.4 + (hash % 3) * 0.7;
            bldGeos.push(hipRoofGeo(minX, maxX, minZ, maxZ, LAND_H + h, rh, tilePalette[hash % tilePalette.length]));
            nRoof++;
          } else {                                    // còn lại: mái bằng + BỒN NƯỚC mái (nhà ống)
            const nT = 1 + (hash % 2);
            for (let k = 0; k < nT; k++) {
              const tx = Math.max(minX + 1, Math.min(maxX - 1, cx + (((hash * (k + 3)) % 7) - 3) * 0.8));
              const tz = Math.max(minZ + 1, Math.min(maxZ - 1, cz + (((hash * (k + 5)) % 7) - 3) * 0.8));
              bldGeos.push(waterTankGeo(tx, tz, LAND_H + h, hash + k));
            }
          }
        }
        addCollider(cx, cz, Math.min(18, Math.sqrt(b.a / Math.PI) * 0.85 + 0.4));
        world.buildingCells.add(`${Math.round(cx / 22)},${Math.round(cz / 22)}`);
        { const k = `${Math.floor(cx / 24)},${Math.floor(cz / 24)}`; let l = _bldGrid.get(k); if (!l) _bldGrid.set(k, l = []); l.push([cx, cz]); }
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

  // ---- KHÔNG ĐẶT NHÀ ở KHÔNG GIAN MỞ: công viên, dải vườn hoa, quảng trường Nhà hát, ven hồ Tam Bạc, đè đường cắt ----
  const _segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz; let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), pz - (az + t * dz)); };
  const _sqX = EXTRAS.square[0], _sqZ = EXTRAS.square[1];
  // đoạn đường lớn (p/s/t) để né đè nhà lên lòng/mép đường cắt ngang
  const _majSeg = [];
  for (const r of ROADS_DT) { if (r.c !== 'p' && r.c !== 's' && r.c !== 't') continue; const hw = ROAD_W[r.c] / 2; for (let i = 0; i < r.pts.length - 1; i++) _majSeg.push([r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], hw]); }
  function openSpace(x, z) {
    if (inPark(x, z)) return true;                                   // công viên OSM
    if (Math.hypot(x - _sqX, z - _sqZ) < 62) return true;            // quảng trường Nhà hát
    if (_segD(x, z, 5, 15, -45, 125) < 55) return true;              // HÀNH LANG quảng trường: Nhà hát → Quán hoa → cột cờ (user: không có nhà ở đây)
    if (LM.lechan && Math.hypot(x - LM.lechan[0], z - LM.lechan[1]) < 55) return true; // quảng trường tượng Lê Chân (pano_428: chỉ tượng + không gian mở)
    if (Math.hypot(x + 187.8, z - 201.6) < 50) return true;          // quảng trường Trung tâm Triển lãm (pano_421: đúng 1 công trình)
    for (const g of GARDENS) if (Math.hypot(x - g.x, z - g.z) < Math.max(g.w, g.d) / 2 + 12) return true; // dải vườn hoa
    if (lakeSD(x, z) < 16) return true; // ven hồ Tam Bạc (polygon thật + 16m)
    // KÈ HỒ (pano_004-013/028-037: lan can+ghế đá+đèn, KHÔNG nhà): cấm phía-hồ (cross<0) trong 25m dọc 2 tuyến bờ
    for (const [ax, az, bx, bz, x0, x1] of [[-211, 116, -1052, 285, -1e9, 1e9], [-1007, 367, -20, 162, -1050, -260]]) {
      if (x < x0 || x > x1) continue;
      if (_segD(x, z, ax, az, bx, bz) < 25 && ((bx - ax) * (z - az) - (bz - az) * (x - ax)) < 0) return true;
    }
    return false;
  }
  function onOtherRoad(x, z) { for (const s of _majSeg) if (_segD(x, z, s[0], s[1], s[2], s[3]) < s[4] + 2.5) return true; return false; }
  // PANO LÀ NGUỒN SỰ THẬT: pano gần nhất (<45m) phải THẤY NHÀ ở hướng từ pano tới vị trí đặt (±1 sector 45°);
  // nếu pano cho thấy hướng đó là bờ hồ/kè sông/công viên/quảng trường (không nhà) → KHÔNG đặt.
  function panoDenies(x, z) {
    let bd = 45 * 45, best = null;
    for (const p of PANO_SIDES) { const dx = x - p[0], dz = z - p[1], d2 = dx * dx + dz * dz; if (d2 < bd) { bd = d2; best = p; } }
    if (!best) return false;                                  // không có pano gần → không có dữ liệu, cho phép
    const dx = x - best[0], dz = z - best[1];
    if (dx * dx + dz * dz < 4) return false;                  // trùng điểm pano → không xác định hướng
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;  // compass: 0=Bắc(-Z), 90=Đông(+X)
    const s = Math.round(bearing / 45) % 8, mask = best[2];
    return !((mask >> s) & 1 || (mask >> ((s + 1) % 8)) & 1 || (mask >> ((s + 7) % 8)) & 1);
  }
  // CẢ 4 GÓC footprint phải là ĐẤT chuẩn (không chỉ tâm) — hết nhà "lội nước" trên dải đất hẹp ven hồ/sông
  function cornersDry(x, z, ux, uz, halfW, nx2, nz2, halfD) {
    for (const su of [-1, 1]) for (const sv of [-1, 1]) {
      const cx2 = x + su * halfW * ux + sv * halfD * nx2, cz2 = z + su * halfW * uz + sv * halfD * nz2;
      if (Math.abs(groundHeightNoDeck(cx2, cz2) - LAND_H) > 0.4) return false;
    }
    return true;
  }

  // ---------- MÁI HIÊN BẠT + BIỂN HIỆU shophouse dọc phố thương mại (rải rộng, rất thân thuộc) ----------
  // CHỈ đặt nơi có BẰNG CHỨNG NHÀ (pano/OSM) và KHÔNG phải không gian mở (hồ/quảng trường/vườn hoa)
  {
    // mái hiên: canopy nghiêng + diềm; protrusion hướng +Z (ra phía đường)
    const awnG = [];
    { const cano = new THREE.BoxGeometry(3.0, 0.08, 1.7); cano.rotateX(-0.22); cano.translate(0, 3.15, 0.85); awnG.push(cano);
      const val = new THREE.BoxGeometry(3.0, 0.42, 0.06); val.translate(0, 2.92, 1.66); awnG.push(val); }
    const awnGeo = mergeGeometries(awnG); awnG.forEach((g) => g.dispose());
    // biển hiệu: tấm chữ nhật đứng cạnh mặt tiền
    const signGeo = new THREE.BoxGeometry(0.9, 1.3, 0.12);
    const awnCols = [0x3f6ea8, 0xb24a3e, 0x4f8a5c, 0xd9c48a, 0xe4ddcd, 0x9fa3a0].map((c) => new THREE.Color(c)); // bạt vải dịu (đỡ sặc sỡ)
    const signCols = [0xd6382c, 0x1f6fae, 0x2f9c4a, 0xe0a52f, 0xb23a8a, 0xe8e2d6].map((c) => new THREE.Color(c));
    const awnSlots = [], signSlots = [];
    let as = 990201; const ar = () => { as = (as * 1103515245 + 12345) & 0x7fffffff; return as / 0x7fffffff; };
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri]; if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 8) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let d = 4; d < segLen - 4; d += 4.2) {
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1250 * 1250) continue;
          for (const side of [1, -1]) {
            if (ar() > 0.5) continue;
            const off = side * (wRoad / 2 + 3.4);                 // sát mặt nhà (sau vỉa hè)
            const gx = mx + off * px, gz = mz + off * pz;
            const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
            if (openSpace(gx, gz) || onOtherRoad(gx, gz)) continue;          // không mọc ở hồ/quảng trường/vườn hoa/lòng đường
            if (!houseEvidence(gx, gz) || panoDenies(gx, gz)) continue;      // phải có NHÀ thật ở đây (pano/OSM xác nhận)
            const faceY = Math.atan2(-side * px, -side * pz);      // protrusion hướng ra đường
            if (ar() < 0.82) awnSlots.push([gx, gy, gz, faceY, (ar() * awnCols.length) | 0]);
            if (ar() < 0.5) signSlots.push([gx, gy + 2.0, gz, faceY, (ar() * signCols.length) | 0]);
            if (awnSlots.length >= 300) break;
          }
          if (awnSlots.length >= 300) break;
        }
        if (awnSlots.length >= 300) break;
      }
      if (awnSlots.length >= 300) break;
    }
    const mkInst = (geo, slots, cols, name, yOff) => {
      if (!slots.length) return;
      const inst = new THREE.InstancedMesh(geo, mat(0xcccccc), slots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
      slots.forEach(([x, y, z, ry, ci], k) => { e.set(0, ry, 0); q.setFromEuler(e); p.set(x, y + (yOff || 0), z); m.compose(p, q, s); inst.setMatrixAt(k, m); inst.setColorAt(k, cols[ci]); });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.castShadow = true; inst.name = name; scene.add(inst);
    };
    mkInst(awnGeo, awnSlots, awnCols, 'shop_awnings', 0);
    mkInst(signGeo, signSlots, signCols, 'shop_signs', 0);
  }

  // ---------- BIỂN HIỆU TÊN THẬT từ catalog 551 pano (PANO-LOOP V3: 954 biển, texture-atlas → 3 draw call) ----------
  {
    const CELL_W = 512, CELL_H = 80, COLS = 8, ROWS = 51, PER = COLS * ROWS;   // 408 biển/atlas 4096²
    const bg = ['#c62828', '#1c56a0', '#1f7a3c', '#d8862a', '#26262c', '#8e2f80'];
    for (let a = 0; a < Math.ceil(SHOP_SIGNS.length / PER); a++) {
      const items = SHOP_SIGNS.slice(a * PER, (a + 1) * PER);
      const cv = document.createElement('canvas'); cv.width = COLS * CELL_W; cv.height = ROWS * CELL_H;
      const g = cv.getContext('2d');
      items.forEach(([, , , name], k) => {
        const cx = (k % COLS) * CELL_W, cy = ((k / COLS) | 0) * CELL_H;
        g.fillStyle = bg[(name.length + k) % bg.length]; g.fillRect(cx, cy, CELL_W, CELL_H);
        g.fillStyle = '#fff'; g.font = 'bold 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(name, cx + CELL_W / 2, cy + CELL_H / 2 + 2, CELL_W - 30);
      });
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const geos = [];
      items.forEach(([x, z, ry], k) => {
        const gy = groundHeightNoDeck(x, z);
        if (Math.abs(gy - LAND_H) > 0.5 || isWater(x, z)) return;
        const pg = new THREE.PlaneGeometry(4.2, 0.85);
        const u0 = (k % COLS) / COLS, v1 = 1 - ((k / COLS) | 0) / ROWS, v0 = v1 - 1 / ROWS;
        const uv = pg.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / COLS, v0 + uv.getY(i) * (v1 - v0));
        pg.rotateY(ry); pg.translate(x, groundHeight(x, z) + 3.35, z);
        geos.push(pg);
      });
      if (geos.length) {
        const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }));
        geos.forEach((gg) => gg.dispose());
        m.name = 'real_shop_signs_' + a; scene.add(m);
      }
    }
  }

  {
    const placed = [];
    const lmPts = Object.values(LM);
    let count = 0;
    outer:
    for (const r of ROADS_DT) {
      if (r.c !== 'r' && r.c !== 't') continue;
      // BÀI HỌC PANO-LOOP V1 (pano_022/023 khu Ga trống): cap 210 cạn theo THỨ TỰ ROADS_DT
      // → các phố 't' phía đông không bao giờ được đặt nhà. Nâng 210→380 (mesh vẫn gộp, không thêm draw call).
      for (let i = 0; i < r.pts.length - 1 && count < 380; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 14; s < len - 8; s += 24) {
          const t = s / len;
          for (const side of [-1, 1]) {
            const hx = x1 + (x2 - x1) * t + side * 12 * px;
            const hz = z1 + (z2 - z1) * t + side * 12 * pz;
            const hSeed = Math.abs(Math.floor(hx * 3 + hz * 7));
            if (hSeed % 3 === 0) continue; // thưa bớt
            if (Math.abs(groundHeightNoDeck(hx, hz) - LAND_H) > 0.25) continue;
            if (riverFactor(hx, hz) > 0.01) continue;
            if (_gridNear(_bldGrid, hx, hz, 13)) continue;             // không đè nhà OSM thật
            if (!houseEvidence(hx, hz)) continue;                      // BẢN ĐỒ NHÀ (pano+OSM): không bằng chứng → cấm
            if (openSpace(hx, hz) || onOtherRoad(hx, hz)) continue;   // né vườn hoa/quảng trường/ven hồ/đường cắt
            if (panoDenies(hx, hz)) continue;                          // pano thật không thấy nhà ở hướng này
            if (!cornersDry(hx, hz, Math.sin(rotY), Math.cos(rotY), 4.0, px, pz, 3.8)) continue; // 4 góc là đất
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
            if (count >= 380) break outer;
          }
        }
      }
    }
  }

  // ---------- DÃY SHOPHOUSE LIỀN MẠCH dọc PHỐ CHÍNH 'p'/'s' lõi trung tâm ----------
  // Lấp mặt phố cho hết trống: nhà ống/cửa hàng 3-5 tầng sát nhau tạo "tường phố" (đối chiếu pano).
  // Chỉ mọc nơi CHƯA có footprint OSM; né nước/địa danh/nhà thật. Gộp 1 mesh (vertex-color + vân tầng).
  {
    const shopGeos = [];
    // màu TỪNG CĂN đa dạng (bạc hà/kem/cam gạch/hồng/xám xanh/vàng/trắng/nâu) — hết "đơn điệu khối xám"
    const bayCols = [[0.62, 0.82, 0.74], [0.94, 0.88, 0.68], [0.88, 0.55, 0.34], [0.86, 0.58, 0.64],
                     [0.58, 0.66, 0.74], [0.95, 0.82, 0.42], [0.88, 0.90, 0.92], [0.72, 0.47, 0.40], [0.80, 0.74, 0.55]];
    const signCols = [[0.78, 0.14, 0.12], [0.10, 0.32, 0.62], [0.10, 0.52, 0.32], [0.90, 0.58, 0.10], [0.16, 0.16, 0.20], [0.85, 0.80, 0.10]];
    const shopfront = [0.24, 0.26, 0.30];   // cửa cuốn/kính tầng trệt (tối)
    const roofFlat = [0.56, 0.56, 0.58];    // mái bằng bê tông
    const railC = [0.30, 0.30, 0.33];       // lan can sắt
    const acC = [0.86, 0.87, 0.85];         // điều hoà cục nóng
    const tankC = [0.76, 0.78, 0.81];       // bồn nước inox
    const glassC = [0.34, 0.42, 0.50];      // kính cửa sổ (xanh xám)
    const frameC = [0.92, 0.92, 0.89];      // khung cửa trắng
    const plantC = [0.30, 0.55, 0.28];      // chậu cây ban công
    const antenC = [0.22, 0.22, 0.25];      // ăng-ten/khối kỹ thuật nóc
    const colorFlat = (g, rgb) => {
      const nrm = g.attributes.normal, cn = g.attributes.position.count, c = new Float32Array(cn * 3);
      for (let v = 0; v < cn; v++) { const sh = 0.8 + 0.2 * Math.abs(nrm.getX(v)); c[v * 3] = rgb[0] * sh; c[v * 3 + 1] = rgb[1] * sh; c[v * 3 + 2] = rgb[2] * sh; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
    };
    const colBox = (bw, bh, bd, x, y, z, rgb) => { const g = new THREE.BoxGeometry(bw, bh, bd); colorFlat(g, rgb); g.translate(x, y, z); return g; };
    const lmPtsS = Object.values(LM);
    let ss = 660317; const srnd = () => { ss = (ss * 1103515245 + 12345) & 0x7fffffff; return ss / 0x7fffffff; };
    const placedS = [];
    // PANO-LOOP V2: 780 chỉ phủ ~12% lô mặt phố (bước 4.7m×2 bên) → dãy phố đứt quãng khắp nơi
    // (76 finding house sev3). 3000 phủ trọn lõi; vẫn 1 mesh gộp — không thêm draw call.
    const CAP = 3000;
    outerShop:
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri]; if (r.c !== 'p' && r.c !== 's') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 9) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const nx = Math.cos(rotY), nz = -Math.sin(rotY);           // pháp tuyến
        for (let d = 3; d < segLen - 3; d += 4.7) {                 // shophouse sát nhau
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          // V3-fix: vành 830-980 trùm khu CƠ QUAN KHUÔN VIÊN/đất giải tỏa (Cảng vụ ~878m, pano_019
          // regression -1.4) → thu về 830; mật độ lõi vẫn giữ nhờ CAP 3000
          if (mx * mx + mz * mz > 830 * 830) continue;
          for (const side of [1, -1]) {
            const off = side * (wRoad / 2 + 5.6);                    // sau vỉa hè (building-line)
            const gx = mx + off * nx, gz = mz + off * nz;
            if (Math.abs(groundHeightNoDeck(gx, gz) - LAND_H) > 0.3) continue;
            if (riverFactor(gx, gz) > 0.01) continue;
            if (_gridNear(_bldGrid, gx, gz, 13)) continue;           // không đè nhà OSM thật
            if (!houseEvidence(gx, gz)) continue;                     // BẢN ĐỒ NHÀ (pano+OSM): không bằng chứng → cấm
            if (openSpace(gx, gz) || onOtherRoad(gx, gz)) continue;  // né vườn hoa/quảng trường/ven hồ/đường cắt
            if (panoDenies(gx, gz)) continue;                         // pano thật không thấy nhà ở hướng này
            if (!cornersDry(gx, gz, dxn, dzn, 2.6, nx, nz, 4.0)) continue; // 4 góc phải là đất — hết nhà lội nước
            let ok = true;
            for (const [lx, lz] of lmPtsS) { if ((gx - lx) ** 2 + (gz - lz) ** 2 < 34 * 34) { ok = false; break; } }
            if (!ok) continue;
            for (const [ox, oz] of placedS) { if ((gx - ox) ** 2 + (gz - oz) ** 2 < 4.1 * 4.1) { ok = false; break; } }
            if (!ok) continue;
            const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5) continue;
            const floors = (mx * mx + mz * mz < 480 * 480 ? 3 : 2) + ((srnd() * 4) | 0);   // lõi 3-6 tầng, ngoài 2-5 (pano V1: trung tâm cao hơn)
            const h = floors * 3.3, w = 4.0 + srnd() * 1.2, dp = 6.5 + srnd() * 1.5;
            const bay = bayCols[(Math.abs(gx * 7 + gz * 13) | 0) % bayCols.length];
            const sgn = signCols[(Math.abs(gx * 5 + gz * 11) | 0) % signCols.length];
            const fz = dp / 2;                                        // mặt tiền (local +Z)
            const parts = [];
            const windowAt = (wx, wy, ww, wh) => {                    // cửa sổ: khung trắng + kính xanh xám
              parts.push(colBox(ww + 0.14, wh + 0.14, 0.05, wx, wy, fz + 0.01, frameC));
              parts.push(colBox(ww, wh, 0.05, wx, wy, fz + 0.04, glassC));
            };
            // 1) THÂN: tầng trệt cửa cuốn/kính tối, tầng trên màu bay + vân tầng, mái bằng bê tông
            const body = new THREE.BoxGeometry(w, h, dp, 1, Math.max(1, floors), 1);
            { const nrm = body.attributes.normal, p = body.attributes.position, cn = p.count, c = new Float32Array(cn * 3);
              for (let v = 0; v < cn; v++) {
                const ny = nrm.getY(v), yy = p.getY(v) + h / 2; let rgb, sh = 0.82 + 0.16 * Math.abs(nrm.getX(v));
                if (ny > 0.6) { rgb = roofFlat; sh = 0.9; }
                else if (yy < 3.1) { rgb = shopfront; }
                else { rgb = bay; sh *= (Math.floor(yy / 3.3 + 0.01) % 2 === 0) ? 1 : 0.86; }
                c[v * 3] = rgb[0] * sh; c[v * 3 + 1] = rgb[1] * sh; c[v * 3 + 2] = rgb[2] * sh;
              }
              body.setAttribute('color', new THREE.BufferAttribute(c, 3)); body.translate(0, h / 2, 0); parts.push(body); }
            // 1b) TẦNG TRỆT: mặt kính lớn + khung cửa hàng
            parts.push(colBox(w * 0.9 + 0.12, 2.4, 0.04, 0, 1.35, fz + 0.01, frameC));  // khung
            parts.push(colBox(w * 0.9, 2.2, 0.05, 0, 1.3, fz + 0.05, glassC));          // kính lớn
            // 2) BIỂN HIỆU ngang phủ bề rộng trên tầng trệt
            parts.push(colBox(w * 0.98, 1.0, 0.3, 0, 3.15, fz + 0.02, sgn));
            // 3) BIỂN VẪY nhô vuông góc mặt tiền (đôi khi)
            if (srnd() < 0.5) parts.push(colBox(0.22, 0.85, 1.0, (srnd() < 0.5 ? 1 : -1) * w * 0.38, 3.5, fz + 0.55,
              signCols[(Math.abs(gx * 3 + gz * 17) | 0) % signCols.length]));
            // 4) CỬA SỔ + BAN CÔNG lan can sắt + điều hoà + chậu cây (tầng 2 trở lên)
            for (let f = 1; f < floors; f++) {
              windowAt(-w * 0.24, f * 3.3 + 1.65, w * 0.3, 1.45);       // 2 cửa sổ/tầng
              windowAt(w * 0.24, f * 3.3 + 1.65, w * 0.3, 1.45);
              const bal = srnd() < 0.62;
              if (bal) {
                parts.push(colBox(w * 0.86, 0.12, 0.9, 0, f * 3.3 + 0.1, fz + 0.42, railC));   // sàn ban công
                parts.push(colBox(w * 0.86, 0.85, 0.06, 0, f * 3.3 + 0.5, fz + 0.85, railC));  // lan can
                if (srnd() < 0.5) parts.push(colBox(0.32, 0.4, 0.32, (srnd() - 0.5) * w * 0.6, f * 3.3 + 0.75, fz + 0.55, plantC)); // chậu cây
              }
              if (srnd() < 0.5) parts.push(colBox(0.55, 0.4, 0.32, (srnd() - 0.5) * w * 0.7, f * 3.3 + 1.7, fz + 0.14, acC)); // điều hoà
            }
            // 5) BỒN NƯỚC INOX + ăng-ten/khối kỹ thuật trên mái
            if (srnd() < 0.6) { const tank = new THREE.CylinderGeometry(0.34, 0.34, 0.7, 8); colorFlat(tank, tankC);
              tank.translate((srnd() - 0.5) * w * 0.5, h + 0.35, (srnd() - 0.5) * dp * 0.4); parts.push(tank); }
            if (srnd() < 0.4) parts.push(colBox(0.06, 1.6, 0.06, (srnd() - 0.5) * w * 0.6, h + 0.8, (srnd() - 0.5) * dp * 0.3, antenC)); // ăng-ten
            // gộp parts → xoay để MẶT TIỀN (+Z local) QUAY RA ĐƯỜNG (side=+1 phải lật thêm 180°)
            const merged1 = mergeGeometries(parts); parts.forEach((g) => g.dispose());
            const faceAng = rotY + Math.PI / 2 + (side > 0 ? Math.PI : 0);
            merged1.applyMatrix4(new THREE.Matrix4().makeTranslation(gx, gy, gz).multiply(new THREE.Matrix4().makeRotationY(faceAng)));
            shopGeos.push(merged1); placedS.push([gx, gz]);
            addCollider(gx, gz, Math.max(w, dp) * 0.5);
            if (shopGeos.length >= CAP) break outerShop;
          }
        }
      }
    }
    if (shopGeos.length) {
      const merged = mergeGeometries(shopGeos); shopGeos.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = true; m.receiveShadow = true; m.name = 'shophouse_infill'; scene.add(m);
    }
  }

  // ---------- LẤP LÒNG Ô PHỐ theo 2 bản đồ (OSM + footprint): ô phố thật DÀY ĐẶC nhà, game đang rỗng ruột ----------
  // Nhà ống nhỏ 2-3 tầng phủ kín lòng ô (block interior), chừa: mọi loại đường, công viên/vườn hoa/quảng trường/kè,
  // hành lang đường sắt, nhà OSM thật, và chỉ nơi Ô CÓ BẰNG CHỨNG nhà (footprint OSM <60m hoặc điểm nhà pano <40m).
  {
    const BK = 48; const segBuck = new Map();
    const addSeg = (ax, az, bx, bz, big) => {
      for (let gx = Math.floor((Math.min(ax, bx) - BK) / BK); gx <= Math.floor((Math.max(ax, bx) + BK) / BK); gx++)
        for (let gz = Math.floor((Math.min(az, bz) - BK) / BK); gz <= Math.floor((Math.max(az, bz) + BK) / BK); gz++) {
          const k = gx + ',' + gz; let l = segBuck.get(k); if (!l) segBuck.set(k, l = []); l.push([ax, az, bx, bz, big]);
        }
    };
    for (const r of ROADS_DT) for (let i = 0; i < r.pts.length - 1; i++) addSeg(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], (r.c === 'p' || r.c === 's' || r.c === 't') ? 1 : 0);
    for (const rl of (RAIL || [])) for (let i = 0; i < rl.pts.length - 1; i++) addSeg(rl.pts[i][0], rl.pts[i][1], rl.pts[i + 1][0], rl.pts[i + 1][1], 2);
    const roadDists = (x, z) => {
      const kx = Math.floor(x / BK), kz = Math.floor(z / BK); let big = 1e9, alley = 1e9, rail = 1e9;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const l = segBuck.get((kx + dx) + ',' + (kz + dz)); if (!l) continue;
        for (const s of l) { const d = _segD(x, z, s[0], s[1], s[2], s[3]); if (s[4] === 2) { if (d < rail) rail = d; } else if (s[4] === 1) { if (d < big) big = d; } else if (d < alley) alley = d; }
      }
      return [big, alley, rail];
    };
    const wallTones = [[0.93, 0.87, 0.70], [0.90, 0.79, 0.62], [0.86, 0.88, 0.84], [0.92, 0.74, 0.62], [0.82, 0.85, 0.89], [0.88, 0.82, 0.68]];
    const roofTones = [[0.70, 0.28, 0.18], [0.64, 0.38, 0.24], [0.55, 0.57, 0.60], [0.45, 0.48, 0.52], [0.68, 0.25, 0.20]]; // ngói đỏ + tôn xám
    const geos = []; const lmPtsB = Object.values(LM);
    let bs = 424241; const brnd = () => { bs = (bs * 1103515245 + 12345) & 0x7fffffff; return bs / 0x7fffffff; };
    let nB = 0;
    const CAPB = 9500;   // vệ tinh GE: lòng ô kín mái ~100% → lưới dày, nhà gần chạm nhau
    // (PANO-LOOP V1: 5600 cạn quanh gx≈0 → cả dải đông tới Ga trống; 9500 đủ quét hết lưới, vẫn 1 mesh gộp)
    // KHU PHÂN LÔ LIỀN KỀ MỚI cạnh THPT Lê Hồng Phong (GE ảnh 4: dãy nhà trắng đều) — georef từ ảnh
    {
      const R = { x1: -1035, x2: -925, z1: -545, z2: -405 };
      for (let rx = R.x1 + 3; rx <= R.x2 - 3 && nB < CAPB; rx += 5.4) {
        for (let rz = R.z1 + 5; rz <= R.z2 - 5 && nB < CAPB; rz += 11) {
          if (Math.abs(groundHeightNoDeck(rx, rz) - LAND_H) > 0.3 || riverFactor(rx, rz) > 0.01) continue;
          const [big2, alley2] = roadDists(rx, rz);
          if (big2 < 17.5 || alley2 < 7) continue;                  // đường phân lô nhỏ: chỉ cần cách 7m
          if (_gridNear(_bldGrid, rx, rz, 12)) continue;
          if (openSpace(rx, rz)) continue;
          const h2 = 12.8, gy2 = groundHeight(rx, rz);              // liền kề mới 4 tầng, trắng kem, mái xám
          const bx2 = new THREE.BoxGeometry(4.8, h2, 8.2);
          { const nrm = bx2.attributes.normal, cn = bx2.attributes.position.count, c = new Float32Array(cn * 3);
            for (let v = 0; v < cn; v++) { const isR = nrm.getY(v) > 0.6; const sh = isR ? 0.94 : 0.84 + 0.16 * Math.abs(nrm.getX(v));
              c[v * 3] = (isR ? 0.62 : 0.93) * sh; c[v * 3 + 1] = (isR ? 0.63 : 0.91) * sh; c[v * 3 + 2] = (isR ? 0.66 : 0.86) * sh; }
            bx2.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
          bx2.translate(rx, gy2 + h2 / 2, rz);
          geos.push(bx2); addCollider(rx, rz, 4.2); nB++;
        }
      }
    }
    for (let gx = -1100; gx <= 900 && nB < CAPB; gx += 10.5) {
      for (let gz = -900; gz <= 560 && nB < CAPB; gz += 10.5) {
        const x = gx + (brnd() - 0.5) * 4, z = gz + (brnd() - 0.5) * 4;
        if (Math.abs(groundHeightNoDeck(x, z) - LAND_H) > 0.3) continue;
        if (riverFactor(x, z) > 0.01) continue;
        const [big, alley, rail] = roadDists(x, z);
        if (big < 17.5 || alley < 16 || rail < 15) continue;         // trong LÒNG ô, không đè dải nhà mặt phố/ngõ/ray
        if (big > 130 && alley > 130) continue;                       // quá xa mọi đường = ngoại vi trống
        if (_gridNear(_bldGrid, x, z, 13)) continue;                  // né nhà OSM thật
        if (!(_gridNear(_bldGrid, x, z, 60) || _gridNear(_phGrid, x, z, 40))) continue; // Ô PHẢI CÓ BẰNG CHỨNG nhà
        if (openSpace(x, z) || panoDenies(x, z)) continue;
        let lmHit = false; for (const [lx, lz] of lmPtsB) { if ((x - lx) ** 2 + (z - lz) ** 2 < 30 * 30) { lmHit = true; break; } }
        if (lmHit) continue;
        if (!cornersDry(x, z, 1, 0, 3.4, 0, 1, 3.4)) continue;
        const w = 6.2 + brnd() * 2.4, d = 6.2 + brnd() * 2.4, fl = 2 + ((brnd() * 2) | 0), h = fl * 3.2;
        const gy = groundHeight(x, z);
        const box = new THREE.BoxGeometry(w, h, d);
        const wc = wallTones[(Math.abs(x * 7 + z * 13) | 0) % wallTones.length];
        const rc = roofTones[(Math.abs(x * 3 + z * 5) | 0) % roofTones.length];
        { const nrm = box.attributes.normal, cn = box.attributes.position.count, c = new Float32Array(cn * 3);
          for (let v = 0; v < cn; v++) { const isR = nrm.getY(v) > 0.6; const t = isR ? rc : wc; const sh = isR ? 0.96 : 0.8 + 0.2 * Math.abs(nrm.getX(v)); c[v * 3] = t[0] * sh; c[v * 3 + 1] = t[1] * sh; c[v * 3 + 2] = t[2] * sh; }
          box.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
        box.rotateY((brnd() * 4 | 0) * Math.PI / 2 + (brnd() - 0.5) * 0.2);
        box.translate(x, gy + h / 2, z);
        geos.push(box); addCollider(x, z, Math.max(w, d) * 0.52); nB++;
      }
    }
    if (geos.length) {
      const merged = mergeGeometries(geos); geos.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      m.castShadow = true; m.receiveShadow = true; m.name = 'block_infill'; scene.add(m);
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
        const s = 49 / Math.max(size.x, size.z);  // cạnh dài thật từ OSM (LM_SIZE)
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
        // Chân dung Chủ tịch Hồ Chí Minh: ẢNH CHUẨN đã được dập thẳng vào texture
        // của nhahat.glb (tools: xem KNOWLEDGE.md §5.6 — fit affine UV↔3D rồi composite).
        // TUYỆT ĐỐI không dùng hình AI cho chân dung; muốn đổi ảnh → dập lại texture.
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
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(55, 40),
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
        const s = 9 / Math.max(sz.x, sz.z); // quán hoa to hơn cho đúng tầm nhìn 1:1
        for (let i = 0; i < 5; i++) {
          const inst = i === 0 ? m : m.clone(true);
          inst.scale.setScalar(s);
          inst.rotation.y = qhTh;
          inst.updateMatrixWorld(true);
          const b2 = new THREE.Box3().setFromObject(inst);
          const c2 = b2.getCenter(new THREE.Vector3());
          const qx = LM.quanhoa[0] + qhDir[0] * (i - 2) * 10.5;
          const qz = LM.quanhoa[1] + qhDir[1] * (i - 2) * 10.5;
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
      addCollider(LM.quanhoa[0] + qhDir[0] * (i - 2) * 10.5, LM.quanhoa[1] + qhDir[1] * (i - 2) * 10.5, 4);
    }
  }

  // ---------- TƯỢNG ĐÀI LÊ CHÂN: GLB AI có màu (bệ đá + bảng tên giữ nguyên) ----------
  {
    // Nữ tướng quay mặt VUÔNG GÓC với đường thật trước tượng (đường Đông–Tây, tiếp tuyến OSM
    // [-0.979,0.206]) → mặt hướng thẳng ra đường về phía Bắc: [-0.208,-0.978].
    const thLC = orientFace([0.992, -0.126]);   // CÙNG HƯỚNG cổng trường Ngô Quyền (theo yêu cầu)
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
    g.rotation.y = thLC;             // bảng tên quay ra quảng trường
    scene.add(g);
    addCollider(LM.lechan[0], LM.lechan[1], 4.6);

    // QUẢNG TRƯỜNG VƯỜN HOA nghi lễ quanh tượng (theo Street View thật: cây cắt tỉa + lối granite
    // đỏ + chậu cảnh + cột cờ). ĐI ĐƯỢC — chỉ tượng/chậu/cột chặn, không chặn cả quảng trường.
    {
      const LX = LM.lechan[0], LZ = LM.lechan[1];
      const faceV = [0.992, -0.126], perpV = [0.126, 0.992];   // mặt tượng = hướng cổng trường
      const P = (a, b) => [LX + a * faceV[0] + b * perpV[0], LZ + a * faceV[1] + b * perpV[1]];
      const redGranite = mat(0x9c4636), topiary = mat(0x3f7a3a, { flatShading: true }), potM = mat(0x6f4636), hedgeM = mat(0x356b33);
      // nền lát granite sáng + trục lối đi granite ĐỎ
      const pave = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 24), mat(0xbdb6a6));
      pave.position.set(LX, LAND_H + 0.06, LZ); pave.rotation.y = thLC; pave.receiveShadow = true; scene.add(pave);
      const axis = new THREE.Mesh(new THREE.BoxGeometry(5, 0.16, 22), redGranite);
      axis.position.set(LX, LAND_H + 0.1, LZ); axis.rotation.y = thLC; scene.add(axis);
      // cây cắt tỉa (vòm tròn) xếp hàng hai bên trục
      for (const b of [-11, -7.5, 7.5, 11]) for (const a of [-8, -4, 0, 4, 8]) {
        if (Math.abs(b) < 6 && Math.abs(a) < 4) continue;
        const [wx, wz] = P(a, b);
        const dome = new THREE.Mesh(canopyGeo(1.35, wx * 3 + wz), topiary);
        dome.position.set(wx, LAND_H + 0.9, wz); dome.scale.y = 0.7; scene.add(dome);
      }
      // chậu cảnh lớn 4 góc lối đi gần tượng
      for (const [a, b] of [[6, -4.5], [6, 4.5], [-6, -4.5], [-6, 4.5]]) {
        const [wx, wz] = P(a, b);
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.8, 1.2, 12), potM);
        pot.position.set(wx, LAND_H + 0.6, wz); scene.add(pot);
        const bush = new THREE.Mesh(canopyGeo(1.2, wx + wz * 2), topiary);
        bush.position.set(wx, LAND_H + 1.7, wz); bush.scale.y = 0.85; scene.add(bush);
        addCollider(wx, wz, 1.2);
      }
      // hàng rào cắt thấp viền quảng trường
      for (const [a, b, w, d] of [[0, -12, 30, 1], [0, 12, 30, 1], [-14.5, 0, 1, 24], [14.5, 0, 1, 24]]) {
        const [wx, wz] = P(a, b);
        const hedge = new THREE.Mesh(new THREE.BoxGeometry(w, 0.9, d), hedgeM);
        hedge.position.set(wx, LAND_H + 0.45, wz); hedge.rotation.y = thLC; scene.add(hedge);
      }
      // cột cờ đỏ phía sau tượng
      for (const b of [-5, 0, 5]) {
        const [wx, wz] = P(-7, b);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 7, 6), mat(0xd8d8d8));
        pole.position.set(wx, LAND_H + 3.5, wz); scene.add(pole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.05), new THREE.MeshLambertMaterial({ color: 0xd8202a, side: THREE.DoubleSide }));
        flag.position.set(wx + 0.85, LAND_H + 6, wz); flag.rotation.y = thLC; scene.add(flag);
      }
    }

    registerModel({
      url: 'assets/lechan.glb', name: 'Tượng đài Lê Chân',
      x: LM.lechan[0], z: LM.lechan[1], preload: true,
      place: (m) => {
        m.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(m);
        const size = box.getSize(new THREE.Vector3());
        const s = 9 / size.y; // tượng cao ~9 (tượng thật 7,5m + chân đế liền khối)
        m.scale.setScalar(s);
        m.rotation.y = thLC;         // xoay TRƯỚC khi đo lại box để tâm không lệch khỏi bệ
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
    {
      const eg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(16, 6.5, 9), mat(0xf0ece0));
      body.position.y = 3.25; eg.add(body);
      for (let i = -3; i <= 3; i++) { // hàng cột mặt tiền
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 5.2, 8), mat(0xfdf8ea));
        col.position.set(i * 2.2, 2.6, 4.9); eg.add(col);
      }
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(16.8, 0.9, 10), mat(0xddd6c2));
      cornice.position.y = 6.9; eg.add(cornice);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.1),
        new THREE.MeshLambertMaterial({ map: signTexture('TRUNG TÂM TRIỂN LÃM', '#2e5f8a', '#ffffff') }));
      sign.position.set(0, 5.6, 5.06); eg.add(sign);
      // Nhà triển lãm ĐẰNG SAU tượng: ngược hướng mặt tượng (−faceV), mặt tiền quay về tượng
      const egx = LM.lechan[0] - 16 * 0.992, egz = LM.lechan[1] - 16 * (-0.126);
      eg.position.set(egx, LAND_H, egz);
      eg.rotation.y = thLC;                 // mặt tiền (local +z) quay về tượng
      scene.add(eg);
      addCollider(egx, egz, 9);
    }
  }

  // ---------- NHÀ THỜ CHÍNH TÒA: GLB từ ảnh thật (Wikimedia Commons) ----------
  {
    // trục dài gian giữa theo cạnh dài OSM; tháp chuông (đầu -X mô hình) quay về phố (LM_FACE)
    // dir gần song song face -> tháp ở đầu hồi; orientLong đã cho tháp quay về phố, KHÔNG cộng π
    let thCa = orientLong(LM_DIR.cathedral, null);
    // đảm bảo đầu -X (mặt tiền) hướng về phố: nếu -X đang quay ngược face thì lật π
    if ((-Math.cos(thCa)) * LM_FACE.cathedral[0] + Math.sin(thCa) * LM_FACE.cathedral[1] < 0) thCa += Math.PI;
    placeGLB({
      url: 'assets/nhatho.glb', name: 'Nhà thờ chính tòa',
      x: LM.cathedral[0], z: LM.cathedral[1], rot: thCa, size: 45,
    });
    addCollider(LM.cathedral[0], LM.cathedral[1], 15);
    const [c1x, c1z] = localPt(LM.cathedral[0], LM.cathedral[1], -19, 0, thCa);
    const [c2x, c2z] = localPt(LM.cathedral[0], LM.cathedral[1], 19, 0, thCa);
    addCollider(c1x, c1z, 7);
    addCollider(c2x, c2z, 7);
  }

  // ---------- BƯU ĐIỆN: GLB từ ảnh thật (Wikimedia Commons) ----------
  {
    // lùi nhẹ khỏi mặt phố (đường trong game vẽ rộng hơn thực tế)
    const poX = LM.postoffice[0] - LM_FACE.postoffice[0] * 9;
    const poZ = LM.postoffice[1] - LM_FACE.postoffice[1] * 9;
    placeGLB({
      url: 'assets/buudien.glb', name: 'Bưu điện trung tâm',
      x: poX, z: poZ,
      rot: orientLong(LM_DIR.postoffice, LM_FACE.postoffice), size: 49,
    });
    addCollider(poX, poZ, 22);
  }

  // ---------- BẢO TÀNG: GLB từ ảnh thật (tòa nhà vàng kem thật, không phải gạch đỏ) ----------
  placeGLB({
    url: 'assets/baotang.glb', name: 'Bảo tàng Hải Phòng',
    x: LM.museum[0], z: LM.museum[1],
    rot: orientLong(LM_DIR.museum, LM_FACE.museum), size: 36,
  });
  addCollider(LM.museum[0], LM.museum[1], 18);

  // ---------- GA HẢI PHÒNG: GLB từ ảnh thật + đường ray & đoàn tàu phía sau ----------
  {
    placeGLB({
      url: 'assets/ga.glb', name: 'Ga Hải Phòng',
      x: LM.station[0], z: LM.station[1] + 25, rot: 0, size: 55,
    });
    addCollider(LM.station[0], LM.station[1] + 25, 27);
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
    g.position.set(LM.station[0], LAND_H, LM.station[1] - 6);
    scene.add(g);
    addCollider(LM.station[0], LM.station[1] - 18, 14);
  }

  // ---------- CHỢ SẮT (khối lớn xanh xám + tháp tròn góc như tòa nhà thật) ----------
  {
    // Chợ Sắt: khối hội chợ lớn lấp gần kín footprint thật (~147×114m), 6-7 tầng
    const g = new THREE.Group();
    const grey = mat(0x8fa3b0);
    const marketFacade = grandMat('#8fa3b0', '#dde5ea', { cols: 8, arch: false });
    // 110×80 dịch (+12,+4) so với node OSM: sim đối chiếu polyline đường → 0 điểm đè
    // lòng/vỉa hè đường, 0 chạm hồ (user: "chợ Sắt che cả đường, không lấn chiếm vỉa hè")
    const HW = 110, HD = 80, HH = 23;
    const hall = new THREE.Mesh(new THREE.BoxGeometry(HW, HH, HD),
      [marketFacade, marketFacade, grey, grey, marketFacade, marketFacade]);
    hall.position.y = HH / 2; g.add(hall);
    // tháp tròn ở góc trước — nét nhận diện của chợ Sắt
    const drumX = HW / 2 - 12, drumZ = HD / 2 - 8;
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 33, 18), mat(0xa3b5c0));
    drum.position.set(drumX, 16.5, drumZ);
    g.add(drum);
    for (let fy = 6; fy <= 27; fy += 5) {
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(13.2, 13.2, 2, 18), sharedMats.window);
      strip.position.set(drumX, fy, drumZ);
      g.add(strip);
    }
    const drumCap = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 1.6, 18), mat(0x7a8d99));
    drumCap.position.set(drumX, 33.6, drumZ);
    g.add(drumCap);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 7),
      new THREE.MeshLambertMaterial({ map: signTexture('CHỢ SẮT', '#b03428', '#ffe9b8') }));
    sign.position.set(-14, 19, HD / 2 + 0.1); g.add(sign);
    // sạp hàng vỉa hè phía trước (giữ tầm người)
    for (const sx of [-40, -30, -20, 18, 28, 38]) {
      const stall = new THREE.Mesh(new THREE.BoxGeometry(6, 2.4, 3.4), mat(0xe8b84d));
      stall.position.set(sx, 1.2, HD / 2 + 5); g.add(stall);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(4, 1.6, 4), mat(0xd84040, { flatShading: true }));
      canopy.rotation.y = Math.PI / 4;
      canopy.position.set(sx, 3.4, HD / 2 + 5); g.add(canopy);
    }
    const thMk = orientLong(LM_DIR.market, LM_FACE.market);
    const mkX = LM.market[0] + 12, mkZ = LM.market[1] + 4;   // dịch khỏi lòng đường (sim kiểm chứng)
    g.position.set(mkX, LAND_H, mkZ);
    g.rotation.y = thMk;
    scene.add(g);
    addCollider(mkX, mkZ, 58);
    const [drX, drZ] = localPt(mkX, mkZ, drumX, drumZ, thMk); // tháp tròn góc
    addCollider(drX, drZ, 13);
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
      const seg = new THREE.Mesh(new THREE.BoxGeometry(28, 0.8, 4.4), deckMat);
      seg.position.set(0, y - 0.45, z);
      g.add(seg);
      for (const sx of [-13.4, 13.4]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.4, 4.4), mat(railColor));
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
    const TILT = 0.24, RIB_X = 14, ARCH_H = 45, AS = 200; // 1:1 — nhịp chính 200m, vòm 45m
    for (const s of [-1, 1]) {
      const arcPts = [];
      for (let i = 0; i <= 24; i++) {
        const tt = i / 24;
        arcPts.push(new THREE.Vector3(0, Math.sin(tt * Math.PI) * ARCH_H + 2, (tt - 0.5) * AS));
      }
      const rib = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 40, 1.4, 8), red);
      rib.position.set(s * RIB_X, 0, 0);
      rib.rotation.z = -s * TILT;
      g.add(rib);
    }
    // giằng ngang nối hai đỉnh vòm
    for (const tt of [0.34, 0.5, 0.66]) {
      const y = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const xOff = RIB_X - Math.sin(TILT) * y;
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, xOff * 2 * Math.cos(TILT) + 1, 6), red);
      brace.rotation.z = Math.PI / 2;
      brace.position.set(0, y * Math.cos(TILT), (tt - 0.5) * AS);
      g.add(brace);
    }
    // dây treo ĐAN CHÉO (network arch — đặc trưng thật của cầu Hoàng Văn Thụ)
    for (let i = 2; i <= 22; i += 2) {
      const tt = i / 24;
      const topYr = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const zz = (tt - 0.5) * AS;
      for (const dDir of [-1, 1]) {
        const zd = zz + dDir * AS * 0.075; // chân dây lệch dọc cầu -> các dây cắt nhau
        if (Math.abs(zd) > AS / 2 + 4) continue;
        const ttd = zd / b.half;
        const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
        for (const s of [-1, 1]) {
          const topY = topYr * Math.cos(TILT);
          const topX = s * (RIB_X - Math.sin(TILT) * topYr);
          const dz = zd - zz;
          const len = Math.hypot(topY - deckY, topX - s * 13, dz);
          if (len < 2) continue;
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, len, 4), mat(0xe8e0d8));
          cable.position.set((topX + s * 13) / 2, (topY + deckY) / 2, zz + dz / 2);
          const v = new THREE.Vector3(topX - s * 13, topY - deckY, -dz).normalize();
          cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
          g.add(cable);
        }
      }
    }
    // trụ dẫn cầu đôi đỡ mặt cầu ngoài nhịp vòm (cầu dẫn thật chạy dài hai phía)
    for (const dir of [-1, 1]) {
      for (let a = AS / 2 + 30; a < b.half - 12; a += 40) {
        const along = dir * a;
        const ttd = along / b.half;
        const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
        if (deckY < 2.6) continue;
        for (const sx of [-9, 9]) {
          const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, deckY - 0.2, 8), mat(0xb9bec4));
          pier.position.set(sx, (deckY - 0.2) / 2, along);
          g.add(pier);
        }
        const cap = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 3), mat(0xa9aeb4));
        cap.position.set(0, deckY - 0.9, along);
        g.add(cap);
      }
    }
  }
  {
    const b = BRIDGES[1];
    const g = bridgeGroup(b);
    bridgeDeckAndRails(g, b, 0x88b8c8);
    for (const dir of [-1, 1]) {
      for (let a = 150; a < b.half - 12; a += 42) {
        const along = dir * a;
        const ttd = along / b.half;
        const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
        if (deckY < 2.6) continue;
        for (const sx of [-9, 9]) {
          const pier = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, deckY - 0.2, 8), mat(0xb9bec4));
          pier.position.set(sx, (deckY - 0.2) / 2, along);
          g.add(pier);
        }
      }
    }
    for (const dz of [-65, 65]) {
      for (const dx of [-11, 11]) {
        const pylon = new THREE.Mesh(new THREE.BoxGeometry(3, 101, 3), mat(0xb8c4c8));
        pylon.position.set(dx, 50, dz);
        g.add(pylon);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(26, 2.6, 2.6), mat(0xb8c4c8));
      beam.position.set(0, 92, dz);
      g.add(beam);
      for (let k = 1; k <= 8; k++) {
        for (const dir of [-1, 1]) {
          const zz = dz + dir * k * 15;
          if (Math.abs(zz) > b.half) continue;
          const ttd = zz / b.half;
          const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
          const topY = 95;
          const dzLen = Math.abs(zz - dz);
          const len = Math.hypot(topY - deckY, dzLen);
          const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, len, 4), mat(0xd8e0e4));
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
    const quay = new THREE.Mesh(new THREE.BoxGeometry(240, 3, 45), mat(0x9a9a96));
    quay.position.set(PORT_X, 1.2, quayZ);
    g.add(quay);
    // cần cẩu STS thật: chân cao ~50m, dầm vươn ~60m ra phía sông
    function crane(x) {
      const c = new THREE.Group();
      const legMat = mat(0x3f6fb5);
      for (const [lx, lz] of [[-8, -7], [8, -7], [-8, 7], [8, 7]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2, 50, 2), legMat);
        leg.position.set(lx, 25, lz); c.add(leg);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 3.5, 62), legMat);
      beam.position.set(0, 51, -16); c.add(beam);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(6, 5, 6), mat(0xe8b820));
      cab.position.set(0, 45, 2); c.add(cab);
      const cable = new THREE.Mesh(new THREE.BoxGeometry(0.4, 30, 0.4), mat(0x333333));
      cable.position.set(0, 36, -38); c.add(cable);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(4, 2.5, 4), mat(0xd84040));
      hook.position.set(0, 22, -38); c.add(hook);
      c.position.set(x, LAND_H, quayZ + 15);
      c.rotation.y = Math.PI;
      g.add(c);
      addCollider(x, quayZ + 15, 10);
    }
    crane(PORT_X - 70); crane(PORT_X); crane(PORT_X + 70);
    const ctColors = [0xd84040, 0x2e86c1, 0x28a05c, 0xe8a020, 0x8e44ad];
    const ctMats = ctColors.map((c) => mat(c));
    const ctBuckets = ctColors.map(() => []);   // gộp container theo màu → 5 mesh (trước ~340 mesh/material)
    let ci = 0;
    for (let cx = PORT_X - 95; cx <= PORT_X + 95; cx += 13) {
      for (let cz = quayZ + 40; cz <= quayZ + 95; cz += 6.5) {
        const stack = 1 + (ci % 4);
        for (let s = 0; s < stack; s++) {
          const geo = new THREE.BoxGeometry(12, 2.6, 2.4);
          geo.translate(cx, LAND_H + 1.3 + s * 2.6, cz);
          ctBuckets[(ci + s) % 5].push(geo);
        }
        addCollider(cx, cz, 6);
        ci++;
      }
    }
    ctBuckets.forEach((geos, i) => {
      if (!geos.length) return;
      const m = new THREE.Mesh(mergeGeometries(geos), ctMats[i]);
      geos.forEach((gg) => gg.dispose());
      m.castShadow = true; m.receiveShadow = true; g.add(m);
    });
    scene.add(g);
  }

  // ---------- Tàu thủy ----------
  function ship(x, z, len, colHull, colTop, rotY = 0) {
    const s = new THREE.Group();
    const HB = len * 0.11;               // chiều cao thân tàu tỉ lệ với chiều dài
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, HB, len * 0.28), mat(colHull));
    hull.position.y = HB / 2; s.add(hull);
    const bow = new THREE.Mesh(new THREE.ConeGeometry(len * 0.14, len * 0.12, 4), mat(colHull));
    bow.scale.y = 2;
    bow.position.set(len / 2 + len * 0.04, HB / 2, 0);
    bow.rotation.z = -Math.PI / 2;
    s.add(bow);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(len * 0.18, len * 0.14, len * 0.2), mat(colTop));
    bridge.position.set(-len * 0.3, HB + len * 0.07, 0); s.add(bridge);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(len * 0.02, len * 0.025, len * 0.08, 10), mat(0xd84040));
    funnel.position.set(-len * 0.3, HB + len * 0.18, 0); s.add(funnel);
    for (let i = 0; i < 3; i++) {
      const ct = new THREE.Mesh(new THREE.BoxGeometry(len * 0.14, len * 0.055, len * 0.16), mat([0x2e86c1, 0x28a05c, 0xe8a020][i]));
      ct.position.set(len * (0.05 + i * 0.16), HB + len * 0.03, 0);
      s.add(ct);
    }
    s.position.set(x, 0, z);
    s.rotation.y = rotY;
    scene.add(s);
    return s;
  }
  {
    // tàu hàng cập cảng: dò điểm nước sâu ngay ngoài cầu cảng
    let shipZ = quayZ - 70;
    for (let z = quayZ - 20; z > quayZ - 260; z -= 6) {
      if (groundHeightNoDeck(PORT_X - 30, z) < -1.5) { shipZ = z - 20; break; }
    }
    ship(PORT_X - 30, shipZ, 115, 0x24455f, 0xf0f0e8, 0.1);
  }
  ship(6500, 140, 95, 0x555a44, 0xe8e8e0, -0.1);           // tàu ra cửa biển trên sông Cấm
  const seaShip = ship(16000, 20000, 130, 0x7d2b20, 0xe8e8e0); // tàu tuần du ngoài khơi
  updaters.push((dt, time) => {
    const ang = time * 0.02;
    seaShip.position.set(16000 + Math.cos(ang) * 2500, Math.sin(time * 0.7) * 0.15, 20000 + Math.sin(ang) * 1800);
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
    const body = new THREE.Mesh(new THREE.BoxGeometry(25, 12, 18), mat(0xf5efd8));
    body.position.y = 6; g.add(body);
    for (let fy = 3.5; fy < 11; fy += 3.6) {  // dải cửa 2-3 tầng
      const win = new THREE.Mesh(new THREE.BoxGeometry(25.1, 1.3, 18.1), sharedMats.window);
      win.position.y = fy; g.add(win);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(17, 6, 4), mat(0x8a4030));
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 15; g.add(roof);
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(33, 1.2, 26), mat(0xd8cdb0));
    terrace.position.y = 0.6; g.add(terrace);
    g.position.set(villaXZ[0], vy, villaXZ[1]);
    scene.add(g);
    addCollider(villaXZ[0], villaXZ[1], 17);
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
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < 10; i++) {
        const x = CBT[0] - 45 + i * 9.5;
        const rz = CBT[1] - 24 + row * 22;
        const hgt = 17 + ((i * 5 + row * 7) % 14);   // 17-30m, nhà ống 5-9 tầng
        const b = new THREE.Mesh(new THREE.BoxGeometry(8, hgt, 9), mat(rowColors[(i + row * 3) % 8]));
        b.position.set(x, LAND_H + hgt / 2, rz);
        scene.add(b);
        for (let fy = 3; fy < hgt - 1; fy += 3.3) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.15), sharedMats.window);
          win.position.set(x, LAND_H + fy, rz + 4.6);
          scene.add(win);
        }
        addCollider(x, rz, 5.8);
      }
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
    world.npcSpots.catba = [CBT[0] - 60, CBT[1] - 12];
  }

  // núi đá vôi: rải theo lưới đất/biển thật của quần đảo
  {
    const karstMat = mat(0x93a284, { flatShading: true });
    const karstTop = mat(0x53a04c, { flatShading: true });
    const rockGeos = [], topGeos = [];   // gộp đá karst theo material → 2 mesh (trước tới ~440 mesh)
    const addRock = (jx, jy, jz, r, h, topR, topY, seed) => {
      const rg = karstGeo(r, h, seed); rg.translate(jx, jy, jz); rockGeos.push(rg);
      const tg = canopyGeo(topR, seed * 2 + 1); tg.translate(jx, topY, jz); topGeos.push(tg);
      addCollider(jx, jz, r * 0.75);
    };
    let nKarst = 0;
    for (let x = 30000; x <= 47000 && nKarst < 220; x += 700) {
      for (let z = 6000; z <= 22000 && nKarst < 220; z += 700) {
        const hash = Math.abs(Math.sin(x * 0.137 + z * 0.291) * 43758.54) % 1;
        const jx = x + (hash - 0.5) * 420, jz = z + (hash * 7 % 1 - 0.5) * 420;
        if (jx > CBT[0] - 260 && jx < CBT[0] + 260 && jz > CBT[1] - 190 && jz < CBT[1] + 190) continue; // chừa thị trấn
        const v = landAt(jx, jz);
        if (v > 0.75 && hash < 0.32) { // núi trên đảo lớn
          const r = 42 + hash * 70, h = 80 + hash * 90;
          const y = groundHeightNoDeck(jx, jz);
          addRock(jx, y + h / 2 - 0.6, jz, r, h, r * 0.45, y + h - 0.5, jx + jz);
          nKarst++;
        } else if (v > 0.06 && v < 0.62 && hash > 0.45) { // đảo đá vôi giữa vịnh Lan Hạ
          const r = 20 + hash * 42, h = 45 + hash * 80;
          addRock(jx, -4 + h / 2, jz, r, h, r * 0.42, -4 + h - 0.5, jx + jz);
          nKarst++;
        }
      }
    }
    if (rockGeos.length) {
      const rm = new THREE.Mesh(mergeGeometries(rockGeos.map((g) => g.toNonIndexed())), karstMat);
      rockGeos.forEach((g) => g.dispose()); rm.castShadow = true; rm.receiveShadow = true; scene.add(rm);
      const tm = new THREE.Mesh(mergeGeometries(topGeos.map((g) => g.toNonIndexed())), karstTop);
      topGeos.forEach((g) => g.dispose()); tm.castShadow = true; scene.add(tm);
    }
  }

  // ---------- CÂY PHƯỢNG "HERO": mô hình Meshy dựng từ ẢNH THẬT (3 dáng) ----------
  // Dùng ở dải trung tâm + các vườn hoa (nơi người chơi dạo nhiều). InstancedMesh: mỗi dáng
  // 1 draw-call dù nhiều cây. Cây nền (OSM/công viên xa) vẫn dùng procedural cho nhẹ.
  const HERO_FILES = ['phuong_a.glb', 'phuong_c.glb', 'phuong_d.glb'];
  const HERO_BASE_H = [8.6, 10.8, 8.8];   // chiều cao gốc (m) từng dáng — c là cây cao dáng bình
  const heroTrees = [];                   // {x,y,z,scale,yaw,variant}
  const fracH = (v) => { const t = Math.abs(v); return t - Math.floor(t); };
  function heroTree(x, z) {
    const y = groundHeight(x, z);
    const s1 = fracH(Math.sin(x * 1.73 + z * 0.91) * 43758.5);
    const s2 = fracH(Math.sin(x * 0.41 + z * 2.31) * 12543.7);
    const variant = s2 < 0.4 ? 0 : s2 < 0.72 ? 1 : 2;
    const scale = HERO_BASE_H[variant] * (0.82 + s1 * 0.5);   // biến thể cao/thấp
    heroTrees.push({ x, y, z, scale, yaw: (x * 1.3 + z) % (Math.PI * 2), variant });
    addCollider(x, z, 1.1);              // chỉ chặn quanh gốc; tán ở trên đầu, đi dưới được
  }
  const ASSET_BASE_W = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'assets/' : 'https://raw.githubusercontent.com/tungtase04539/hp-world/assets-storage/assets/';
  function loadHeroTrees() {
    if (!heroTrees.length) return;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const dummy = new THREE.Object3D();
    HERO_FILES.forEach((file, v) => {
      const slots = heroTrees.filter((t) => t.variant === v);
      if (!slots.length) return;
      loader.load(ASSET_BASE_W + file, (gltf) => {
        shrinkTexturesForMobile(gltf.scene);
        let mesh = null;
        gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
        if (!mesh) return;
        mesh.updateWorldMatrix(true, true);
        // GLB Meshy nén meshopt/quantize (buffer interleaved) — KHÔNG applyMatrix4 lên geometry
        // (làm hỏng vị trí → gai rủ). Thay vào đó gộp chuẩn-hoá + matrixWorld vào MA TRẬN INSTANCE,
        // giữ nguyên geometry y hệt lúc render scene.
        const box = new THREE.Box3().setFromObject(mesh);   // bbox trong hệ thế giới
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const h = Math.max(1e-3, box.max.y - box.min.y);
        // B = S(1/h) · T(-cx,-minY,-cz) · matrixWorld  → đưa cây về gốc y=0, tâm trục, cao = 1
        const B = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h)
          .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz))
          .multiply(mesh.matrixWorld);
        const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, slots.length);
        inst.frustumCulled = false;
        const trs = new THREE.Matrix4(), m = new THREE.Matrix4();
        const q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
        slots.forEach((t, i) => {
          q.setFromEuler(new THREE.Euler(0, t.yaw, 0));
          sv.setScalar(t.scale); pv.set(t.x, t.y, t.z);
          trs.compose(pv, q, sv);
          m.multiplyMatrices(trs, B);        // instance = TRS · B
          inst.setMatrixAt(i, m);
        });
        inst.instanceMatrix.needsUpdate = true;
        scene.add(inst);
      }, undefined, (err) => console.error('hero tree', file, err));
    });
  }

  // ---------- LUỐNG HOA "HERO": mô hình Meshy từ ẢNH THẬT (luống hồng đỏ) ----------
  // Đặt làm bồn hoa TRUNG TÂM mỗi vườn. ĐI ĐƯỢC (không collider) — công viên khác công trình.
  const HERO_BED_FILE = 'flowerbed_a.glb';
  const heroBeds = [];   // {x,y,z,diam,yaw}
  function heroBed(x, z, diam) {
    heroBeds.push({ x, y: groundHeight(x, z) + 0.02, z, diam, yaw: (x * 0.7 + z * 1.1) % (Math.PI * 2) });
  }
  function loadHeroBeds() {
    if (!heroBeds.length) return;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    loader.load(ASSET_BASE_W + HERO_BED_FILE, (gltf) => {
      shrinkTexturesForMobile(gltf.scene);
      let mesh = null;
      gltf.scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) return;
      mesh.updateWorldMatrix(true, true);
      const box = new THREE.Box3().setFromObject(mesh);
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const wxz = Math.max(1e-3, Math.max(box.max.x - box.min.x, box.max.z - box.min.z)); // chuẩn theo ĐƯỜNG KÍNH
      // B đưa luống về gốc y=0, tâm trục, đường kính = 1 (giữ nguyên tỉ lệ dẹt)
      const B = new THREE.Matrix4().makeScale(1 / wxz, 1 / wxz, 1 / wxz)
        .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz))
        .multiply(mesh.matrixWorld);
      const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, heroBeds.length);
      inst.frustumCulled = false;
      const trs = new THREE.Matrix4(), m = new THREE.Matrix4();
      const q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
      heroBeds.forEach((bd, i) => {
        q.setFromEuler(new THREE.Euler(0, bd.yaw, 0));
        sv.setScalar(bd.diam); pv.set(bd.x, bd.y, bd.z);
        trs.compose(pv, q, sv);
        m.multiplyMatrices(trs, B);
        inst.setMatrixAt(i, m);
      });
      inst.instanceMatrix.needsUpdate = true;
      scene.add(inst);
    }, undefined, (err) => console.error('hero bed', err));
  }

  // ---------- GỘP CÂY PROCEDURAL (phượng/xà cừ/cọ) → vài mesh tĩnh ----------
  // Trước: mỗi cây là 1 Group ~11-14 mesh, ~8700 cây → ~8700 draw call = sink FPS chính.
  // Nay: nướng (bake) geometry con vào hệ THẾ GIỚI, gom theo (material × ô lưới 500m) rồi merge.
  // Vẫn cull được theo ô (không phải luôn vẽ toàn thành phố), draw call giảm ~8700 → vài chục.
  const TREE_TILE = 500;
  const treeBuckets = new Map();     // key `matIdx|tx|tz` -> { mat, geos:[] }
  const treeMatList = [];
  const palmTrunkM = mat(0x8a6a42);
  function bakeTree(group, cx, cz) {
    group.updateMatrixWorld(true);
    const tx = Math.floor(cx / TREE_TILE), tz = Math.floor(cz / TREE_TILE);
    group.traverse((o) => {
      if (!o.isMesh) return;
      let mi = treeMatList.indexOf(o.material);
      if (mi < 0) { mi = treeMatList.length; treeMatList.push(o.material); }
      const key = mi + '|' + tx + '|' + tz;
      let b = treeBuckets.get(key);
      if (!b) treeBuckets.set(key, b = { mat: o.material, geos: [] });
      const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      geo.applyMatrix4(o.matrixWorld);   // geometry primitive nội bộ (KHÔNG phải GLB meshopt) → an toàn
      b.geos.push(geo);
    });
  }
  function flushTrees() {
    for (const { mat: matr, geos } of treeBuckets.values()) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, matr);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    treeBuckets.clear();
  }

  // ---------- Cây phượng dải trung tâm + đèn đường (dọc phố thật) ----------
  // Cây phượng vĩ ĐA DẠNG: tán ô rộng dẹt + vòm hoa đỏ phủ trên (đặc trưng Hoa Phượng Đỏ).
  // Mỗi cây tự sinh biến thể theo vị trí: cao/thấp, nở rộ / nở vừa / chưa nở (hết mùa).
  function phuongTree(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    const frac = (v) => { const t = Math.abs(v); return t - Math.floor(t); };
    const s1 = frac(Math.sin(x * 1.73 + z * 0.91) * 43758.5);   // cỡ cây
    const s2 = frac(Math.sin(x * 0.41 + z * 2.31) * 12543.7);   // độ nở hoa
    const scale = 0.72 + s1 * 1.05;                              // ~5m .. ~12m
    const bloom = s2 < 0.58 ? 1 : s2 < 0.84 ? 0.5 : 0;           // nở rộ / vừa / xanh
    const trunkH = 3.2 * scale, crownY = trunkH + 1.0 * scale, crownR = 3.2 * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26 * scale, 0.55 * scale, trunkH, 6), sharedMats.trunk);
    trunk.position.y = trunkH / 2; g.add(trunk);
    // vài cành chính toả ngang (dáng xoè của phượng)
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + s1 * 4;
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.22 * scale, 1.7 * scale, 5), sharedMats.trunk);
      br.position.set(Math.cos(a) * 0.9 * scale, trunkH - 0.4 * scale, Math.sin(a) * 0.9 * scale);
      br.rotation.set(Math.cos(a) * 0.8, 0, -Math.sin(a) * 0.8);
      g.add(br);
    }
    // tán lá dẹt xếp rộng thành hình Ô/DÙ
    const green = [[0, 0.5, 0, 1.15], [-0.62, 0.02, 0.5, 0.82], [0.6, 0.06, -0.5, 0.84], [0.12, -0.08, 0.72, 0.76], [-0.5, -0.02, -0.62, 0.8]];
    green.forEach(([ox, oy, oz, rf], i) => {
      const leaf = new THREE.Mesh(canopyGeo(crownR * rf, x * 3.1 + z * 1.7 + i),
        i % 2 === 0 ? sharedMats.leafGreen : sharedMats.leafGreen2);
      leaf.position.set(ox * crownR, crownY + oy * scale, oz * crownR);
      leaf.scale.y = 0.5;
      g.add(leaf);
    });
    // vòm HOA ĐỎ phủ mặt trên tán (dày khi nở rộ)
    if (bloom > 0) {
      const reds = bloom > 0.7
        ? [[0, 0.58, 0, 1.02], [-0.55, 0.48, 0.45, 0.64], [0.55, 0.48, -0.4, 0.66], [0.06, 0.52, 0.6, 0.6], [-0.1, 0.5, -0.55, 0.58]]
        : [[0, 0.56, 0, 0.86], [0.42, 0.48, 0.32, 0.52]];
      reds.forEach(([ox, oy, oz, rf], i) => {
        const fl = new THREE.Mesh(canopyGeo(crownR * rf, x * 5.1 + z * 2.3 + i + 40), sharedMats.flower);
        fl.position.set(ox * crownR, crownY + oy * scale, oz * crownR);
        fl.scale.y = 0.42;
        g.add(fl);
      });
    }
    g.position.set(x, y, z);
    g.rotation.y = x * 1.3 + z;
    bakeTree(g, x, z);
    addCollider(x, z, 0.9 * scale);
  }
  function palm(x, z) {
    const g = new THREE.Group();
    const y = groundHeightNoDeck(x, z);
    if (y < 0.7) return;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 5, 6), palmTrunkM);
    trunk.position.y = 2.5; trunk.rotation.z = 0.12; g.add(trunk);
    for (let i = 0; i < 6; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.4, 4), sharedMats.leafDark);
      const a = (i / 6) * Math.PI * 2;
      leaf.position.set(Math.cos(a) * 1.5 + 0.5, 5.1, Math.sin(a) * 1.5);
      leaf.rotation.set(Math.sin(a) * 1.25, 0, -Math.cos(a) * 1.25);
      g.add(leaf);
    }
    g.position.set(x, y, z);
    bakeTree(g, x, z);
    addCollider(x, z, 0.6);
  }
  // CÂY XANH BÓNG MÁT (xà cừ/bàng) — tán tròn xanh, biến thể cắt cụt cành (pollard) như phố thật
  function shadeTree(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    const frac = (v) => { const t = Math.abs(v); return t - Math.floor(t); };
    const s1 = frac(Math.sin(x * 1.11 + z * 0.71) * 33457.1);
    const pollard = frac(Math.sin(x * 0.53 + z * 1.9) * 9137.3) < 0.30;   // ~30% cây cắt cụt cành
    const scale = 0.85 + s1 * 1.05;
    const trunkH = (pollard ? 2.5 : 3.7) * scale, crownY = trunkH + (pollard ? 0.3 : 0.9) * scale, crownR = (pollard ? 1.9 : 3.4) * scale;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * scale, 0.6 * scale, trunkH, 6), sharedMats.trunk);
    trunk.position.y = trunkH / 2; g.add(trunk);
    if (pollard) {
      for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + s1 * 3; const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * scale, 0.18 * scale, 0.9 * scale, 4), sharedMats.trunk); stub.position.set(Math.cos(a) * 0.5 * scale, trunkH, Math.sin(a) * 0.5 * scale); stub.rotation.set(Math.cos(a) * 1.0, 0, -Math.sin(a) * 1.0); g.add(stub); }
      const ball = new THREE.Mesh(canopyGeo(crownR, x * 2 + z), sharedMats.leafDark); ball.position.y = crownY; ball.scale.y = 0.85; g.add(ball);
    } else {
      const blobs = [[0, 0.6, 0, 1.1], [-0.5, 0.15, 0.4, 0.76], [0.5, 0.2, -0.35, 0.78], [0.1, 0.0, 0.6, 0.7]];
      blobs.forEach(([ox, oy, oz, rf], i) => { const leaf = new THREE.Mesh(canopyGeo(crownR * rf, x * 2.7 + z * 1.3 + i), i % 2 ? sharedMats.leafGreen : sharedMats.leafDark); leaf.position.set(ox * crownR, crownY + oy * scale, oz * crownR); leaf.scale.y = 0.72; g.add(leaf); });
    }
    g.position.set(x, y, z); g.rotation.y = x * 0.7 + z;
    bakeTree(g, x, z); addCollider(x, z, 0.8 * scale);
  }
  // dispatcher cây phố: đa số xanh bóng mát, phượng vẫn nổi bật (Thành phố Hoa Phượng Đỏ), ít cọ
  function streetTree(x, z) {
    const h = (function (v) { const t = Math.abs(v); return t - Math.floor(t); })(Math.sin(x * 3.3 + z * 1.9) * 24571.3);
    // BÀI HỌC PANO-LOOP V1 (39 finding tree): ven hồ Tam Bạc thực địa là xà cừ/bàng tán XANH
    // + cây cắt tỉa, phượng đỏ chỉ điểm xuyết → trong hành lang hồ (lakeSD<45) hạ phượng còn ~12%.
    if (lakeSD(x, z) < 45) {
      if (h < 0.80) shadeTree(x, z);
      else if (h < 0.92) phuongTree(x, z);
      else palm(x, z);
      return;
    }
    if (h < 0.63) shadeTree(x, z);           // V3-fix: model chê "hoa đỏ dày" cả ngoài hồ → phượng 35%→27%
    else if (h < 0.90) phuongTree(x, z);
    else palm(x, z);
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
        if (mx * mx + mz * mz > 1350 * 1350) continue;
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 20; s < len; s += 46) {   // nhịp cây/đèn phố giữ cỡ người thật
          const t = s / len;
          sideFlip = -sideFlip;
          const off = sideFlip * (ROAD_W[r.c] / 2 + 3.4);
          const tx = x1 + (x2 - x1) * t + off * px;
          const tz = z1 + (z2 - z1) * t + off * pz;
          if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.3) continue;
          if (lmPts.some(([lx, lz]) => (tx - lx) ** 2 + (tz - lz) ** 2 < 24 * 24)) continue;
          if (nTree <= nLamp * 1.6 && nTree < 46) {
            heroTree(tx, tz);       // dải trung tâm: cây phượng ảnh-thật (Meshy)
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

  // ---------- CÂY ĐA/SI CỔ THỤ (pano-loop V2: 5 finding "thân bạnh, rễ phụ rủ, tán rất rộng") ----------
  function banyanTree(x, z) {
    const g = new THREE.Group();
    const y = groundHeight(x, z);
    const bark = mat(0x6b5a44), leaf = new THREE.MeshLambertMaterial({ color: 0x2f6b34 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.7, 5.2, 9), bark);
    trunk.position.set(0, 2.6, 0); g.add(trunk);
    const fr = (v) => { const t = Math.abs(Math.sin(v * 127.1)); return t - Math.floor(t); };
    for (let k = 0; k < 7; k++) {                                   // rễ phụ rủ quanh tán
      const a = k / 7 * Math.PI * 2 + fr(x + k) * 0.6, rr = 2.2 + fr(z + k) * 2.6;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.16, 4.6 + fr(x * k + 1) * 1.6, 5), bark);
      root.position.set(Math.sin(a) * rr, 2.6, Math.cos(a) * rr); g.add(root);
    }
    for (let k = 0; k < 5; k++) {                                    // tán nhiều lớp rất rộng (~16m)
      const a = k / 5 * Math.PI * 2, rr = k ? 3.6 : 0;
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(4.4 + fr(x + z + k) * 1.6, 1), leaf);
      blob.position.set(Math.sin(a) * rr, 7.2 + fr(k + z) * 1.6, Math.cos(a) * rr);
      blob.scale.y = 0.62; g.add(blob);
    }
    g.position.set(x, y, z); scene.add(g);
    addCollider(x, z, 1.9);
    bakeTree(g, x, z); scene.remove(g);
  }
  // vị trí từ finding V1 (quảng trường ven hồ + cạnh Sở KH&CN khu Ga) — đều đã né lòng đường
  for (const [bx, bz] of [[-795, 242], [-1004, 360], [-383, 245], [468, 13]]) {
    if (Math.abs(groundHeightNoDeck(bx, bz) - LAND_H) < 0.4 && !isWater(bx, bz)) banyanTree(bx, bz);
  }

  // ---------- HÀNG CÂY CỔ THỤ TRÊN KÈ HỒ TAM BẠC (pano-loop V1: promenade thật rợp cây tán rộng) ----------
  {
    const _tsd = (px, pz, x1, z1, x2, z2) => { const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; let t = l2 ? ((px - x1) * dx + (pz - z1) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + dx * t), pz - (z1 + dz * t)); };
    const _onRoadT = (px, pz) => { for (const r of ROADS_DT) { if (r.c === 'w') continue; const hw = ROAD_W[r.c] / 2 + 1.2; for (let i = 0; i < r.pts.length - 1; i++) if (_tsd(px, pz, r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1]) < hw) return true; } return false; };
    let nQ = 0;
    for (let e = 0; e < LAKE_POLY.length; e++) {
      const [ax, az] = LAKE_POLY[e], [bx, bz] = LAKE_POLY[(e + 1) % LAKE_POLY.length];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 12) continue;
      const ux = dx / L, uz = dz / L;
      for (let t = 8; t < L - 4; t += 14) {
        const cx0 = ax + ux * t, cz0 = az + uz * t;
        // đẩy 4.5m về phía ĐẤT (thử 2 phía pháp tuyến, chọn phía lakeSD dương)
        for (const s of [1, -1]) {
          const tx = cx0 - uz * s * 4.5, tz = cz0 + ux * s * 4.5;
          if (lakeSD(tx, tz) < 2.5) continue;
          if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.4 || _onRoadT(tx, tz)) break;
          shadeTree(tx, tz); nQ++;
          break;
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
      streetTree(tx, tz);   // đa số cây xanh bóng mát + phượng nổi bật + ít cọ
      nReal++;
    }
    // rải thêm cây trong các công viên thật (lưới + jitter, thưa)
    let nPark = 0;
    for (const p of (PARKS || [])) {
      let x1 = 1e9, x2 = -1e9, z1 = 1e9, z2 = -1e9;
      for (const [x, z] of p) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); z1 = Math.min(z1, z); z2 = Math.max(z2, z); }
      for (let gx = x1 + 8; gx < x2 && nPark < 260; gx += 17) {
        for (let gz = z1 + 8; gz < z2 && nPark < 260; gz += 17) {
          const hash = Math.abs(Math.sin(gx * 2.17 + gz * 3.31) * 43758.54) % 1;
          if (hash > 0.55) continue;
          const jx = gx + (hash - 0.5) * 8, jz = gz + (hash * 7 % 1 - 0.5) * 8;
          if (!world.inPark(jx, jz)) continue;
          if (Math.abs(groundHeightNoDeck(jx, jz) - LAND_H) > 0.4) continue;
          if (riverFactor(jx, jz) > 0.01) continue;
          if (lmPts.some(([lx, lz]) => (jx - lx) ** 2 + (jz - lz) ** 2 < 55 * 55)) continue;
          if (!freeSpot(jx, jz)) continue;
          streetTree(jx, jz);
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
    // Trường Bonnal là NHÀ GÓC: cạnh dài (mặt tiền +Z của mô hình) chạy dọc Phố Nguyễn
    // Đức Cảnh (tiếp tuyến OSM thật [0.981,-0.195], nằm phía Bắc trường), cạnh ngắn quay
    // ra Phố Mê Linh (phía Đông). → mặt tiền dài quay VUÔNG GÓC ra Nguyễn Đức Cảnh, pháp
    // tuyến hướng Bắc: [-0.195,-0.981] (khớp footprint OSM + ảnh Street View "32 Nguyễn Đức Cảnh").
    rot: orientFace([-0.195, -0.981]), size: 80,
  });
  addCollider(LM.thptnq[0], LM.thptnq[1], 32);
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
    block(46, 11, 3, 0, -14);      // dãy chính (song song mặt phố, lùi sâu)
    block(13, 22, 2, -20, 6);      // cánh trái
    block(13, 22, 2, 20, 6);       // cánh phải
    // sân trường + cột cờ
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(42, 24), mat(0xcabfa8));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set(0, 0.06, 8);
    g.add(yard);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 9, 6), mat(0xd8d8d8));
    pole.position.set(0, 4.5, 4); g.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    fl.position.set(1.1, 8.2, 4); g.add(fl);
    updaters.push((dt, time) => { fl.rotation.y = Math.sin(time * 1.7 + sx) * 0.35; });
    // cổng + bảng tên quay ra phố (local +z)
    for (const gx of [-4.4, 4.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.6, 0.9), trimM);
      post.position.set(gx, 1.8, 21); g.add(post);
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(7.8, 1.2, 1),
      new THREE.MeshLambertMaterial({ map: signTexture(label, '#28457d', '#ffe9b8') }));
    lintel.position.set(0, 3.9, 21); g.add(lintel);
    // tường rào thấp hai bên cổng
    for (const side of [-1, 1]) {
      const fence = new THREE.Mesh(new THREE.BoxGeometry(17, 1.4, 0.4), wallM);
      fence.position.set(side * 14.5, 0.7, 21); g.add(fence);
    }
    g.position.set(sx, LAND_H, sz);
    g.rotation.y = th;
    scene.add(g);
    addCollider(sx, sz, 3);
    const [b1x, b1z] = localPt(sx, sz, 0, -14, th);
    addCollider(b1x, b1z, 24);
    for (const wingX of [-20, 20]) {
      const [wx, wz] = localPt(sx, sz, wingX, 6, th);
      addCollider(wx, wz, 11);
    }
  }
  schoolCompound('thcsnq', 'THCS NGÔ QUYỀN');
  schoolCompound('thcstp', 'THCS TRẦN PHÚ');

  // ---------- PANO-LOOP V2: 2 công trình đích danh từ finding (procedural) ----------
  {
    // 1) Trung tâm Triển lãm & Mỹ thuật (1 Nguyễn Đức Cảnh) — vàng kem 2 tầng dài ~40m,
    //    hành lang vòm; pano_003 thấy ở h90/h180 (đông-nam pano → khối dọc Nguyễn Đức Cảnh)
    {
      const cx = -302, cz = 172, W = 40, D = 12, H = 8.6, rot = 0.20;   // trục ~song song NĐC
      const g = new THREE.Group();
      const cream = mat(0xead9a8), white = mat(0xf4efe2), roofM = mat(0x8a5a40);
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), cream); body.position.y = H / 2; g.add(body);
      for (let k = 0; k < 9; k++) {                                     // hàng cột vòm mặt bắc
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.4, 0.6), white);
        col.position.set(-W / 2 + 2.4 + k * (W - 4.8) / 8, 2.2, D / 2 + 1.1); g.add(col);
      }
      const porch = new THREE.Mesh(new THREE.BoxGeometry(W - 3, 0.5, 2.6), white); porch.position.set(0, 4.6, D / 2 + 1.0); g.add(porch);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 0.9, D + 1.6), roofM); roof.position.y = H + 0.45; g.add(roof);
      g.position.set(cx, groundHeight(cx, cz), cz); g.rotation.y = rot; scene.add(g);
      addCollider(cx, cz, W * 0.5);
    }
    // 2) Sở KH&CN (khu Ga, pano_022): 6 tầng kính xanh mặt cong trắng, ~30m, cột cờ
    {
      const cx = 474, cz = 6, W = 30, D = 15, FL = 6, H = FL * 3.4;
      const g = new THREE.Group();
      const glassM = new THREE.MeshLambertMaterial({ color: 0x5f8fb4 }), white = mat(0xeef0ee);
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), white); body.position.y = H / 2; g.add(body);
      for (let f = 0; f < FL; f++) {                                    // băng kính từng tầng, mặt tây (ra phố)
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.1, D - 2), glassM);
        band.position.set(-W / 2 - 0.05, f * 3.4 + 2.0, 0); g.add(band);
        const band2 = new THREE.Mesh(new THREE.BoxGeometry(W - 4, 2.1, 0.3), glassM);
        band2.position.set(0, f * 3.4 + 2.0, D / 2 + 0.05); g.add(band2);
      }
      const curve = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, H, 18, 1, false, Math.PI * 0.5, Math.PI * 0.55), glassM);
      curve.position.set(-W / 2 + 1.5, H / 2, -D / 2 + 3); g.add(curve);   // khối kính cong góc
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), mat(0xd8dce0)); pole.position.set(-W / 2 - 5, 4.5, 4); g.add(pole);
      g.position.set(cx, groundHeight(cx, cz), cz); scene.add(g);
      addCollider(cx, cz, W * 0.55);
    }
  }

  // ---------- PANO-LOOP V4: kiểu ô đất "CƠ QUAN KHUÔN VIÊN" + công trình đích danh còn lại ----------
  {
    // Cơ quan có khuôn viên: nhà chính + sân lát + rào sắt quanh + 2 trụ cổng (khác hẳn shophouse —
    // bài học pano_019: lấp shophouse vào loại ô này là sai thực địa)
    const compound = (cx, cz, W, D, FL, wallHex, roofHex, rotY) => {
      const g = new THREE.Group();
      const H = FL * 3.5;
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(wallHex)); body.position.y = H / 2; g.add(body);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 1.0, D + 1.4), mat(roofHex)); roof.position.y = H + 0.5; g.add(roof);
      const YW = W + 16, YD = D + 14;
      const yard = new THREE.Mesh(new THREE.BoxGeometry(YW, 0.12, YD), mat(0xb9b4a6)); yard.position.y = 0.06; g.add(yard);
      const rail = [];
      const post = (px, pz) => { const q = new THREE.BoxGeometry(0.09, 1.6, 0.09); q.translate(px, 0.8, pz); rail.push(q); };
      for (let x = -YW / 2; x <= YW / 2; x += 2.2) { post(x, -YD / 2); post(x, YD / 2); }
      for (let z = -YD / 2; z <= YD / 2; z += 2.2) { post(-YW / 2, z); post(YW / 2, z); }
      for (const [sx, sz, ln, hor] of [[0, -YD / 2, YW, 1], [0, YD / 2, YW, 1], [-YW / 2, 0, YD, 0], [YW / 2, 0, YD, 0]]) {
        const bar = new THREE.BoxGeometry(hor ? ln : 0.07, 0.07, hor ? 0.07 : ln); bar.translate(sx, 1.5, sz); rail.push(bar);
      }
      const rm = new THREE.Mesh(mergeGeometries(rail), mat(0x2e4a5e)); rail.forEach((r) => r.dispose()); g.add(rm);
      for (const s of [-2.6, 2.6]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 0.5), mat(0xd9d2bd)); p.position.set(s, 1.1, YD / 2); g.add(p); }
      g.position.set(cx, groundHeight(cx, cz), cz); g.rotation.y = rotY; scene.add(g);
      addCollider(cx, cz, Math.max(YW, YD) * 0.5);
    };
    // Cảng vụ HP (pano_019 h315): 3 tầng vàng kem ~38m mái xanh, mặt tiền quay ĐN (135°) về phố Hoàng Diệu
    compound(326, -826, 38, 13, 3, 0xead9a8, 0x3f6e50, -135 * Math.PI / 180);

    // FUNZ/quán trà (pano_010 h0, ~156 Quang Trung): 3 tầng mặt tiền ĐEN + gân hồng, quay Nam về pano
    {
      const cx = -798, cz = 221, W = 10, FL = 3, H = FL * 3.3;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, 8), mat(0x1e1e22)); body.position.y = H / 2; g.add(body);
      for (let f = 0; f <= FL; f++) { const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.15, 0.22, 8.15), mat(0xd4527e)); band.position.y = f * 3.3 + 0.1; g.add(band); }
      g.position.set(cx, groundHeight(cx, cz), cz); g.rotation.y = Math.PI; scene.add(g);
      addCollider(cx, cz, 6);
    }

    // Cao ốc văn phòng kính 11 tầng sau góc chợ Lãn Ông (pano_002 h45)
    // V5-fix: lùi 34m→55m khỏi pano_002 — đặt 34m "che phần lớn góc nhìn" (thật ở xa sau dãy chợ)
    {
      const cx = -247, cz = 92, FL = 11, H = FL * 3.4;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(16, H, 14), mat(0x9aa8b2)); body.position.y = H / 2; g.add(body);
      for (let f = 0; f < FL; f++) { const band = new THREE.Mesh(new THREE.BoxGeometry(16.15, 1.9, 14.15), new THREE.MeshLambertMaterial({ color: 0x5f8fb4 })); band.position.y = f * 3.4 + 2.1; g.add(band); }
      g.position.set(cx, groundHeight(cx, cz), cz); g.rotation.y = 0.28; scene.add(g);
      addCollider(cx, cz, 10);
    }
  }

  // ---------- ĐỢT ĐỊA DANH 2: 5 GLB từ ảnh thật ----------
  // Đền Nghè — di tích thờ Nữ tướng Lê Chân (node OSM, không có trục dài → xoay theo mặt phố)
  // lùi 9m khỏi mặt đường theo hướng mặt tiền — node OSM là CỔNG đền nên mô hình chìa ra lòng đường (user báo)
  placeGLB({
    url: 'assets/dennghe.glb', name: 'Đền Nghè',
    x: LM.dennghe[0] - LM_FACE.dennghe[0] * 9, z: LM.dennghe[1] - LM_FACE.dennghe[1] * 9,
    rot: orientFace(LM_FACE.dennghe), size: 22,
  });
  addCollider(LM.dennghe[0] - LM_FACE.dennghe[0] * 9, LM.dennghe[1] - LM_FACE.dennghe[1] * 9, 11);

  // Đình Hàng Kênh — đình cổ 300 năm, footprint OSM
  placeGLB({
    url: 'assets/dinhhk.glb', name: 'Đình Hàng Kênh',
    x: LM.dinhhk[0], z: LM.dinhhk[1],
    rot: orientLong(LM_DIR.dinhhk, LM_FACE.dinhhk), size: 30,
  });
  addCollider(LM.dinhhk[0], LM.dinhhk[1], 15);

  // Chùa Dư Hàng (Phúc Lâm tự) — gác chuông 3 tầng mái
  placeGLB({
    url: 'assets/chuahang.glb', name: 'Chùa Dư Hàng',
    x: LM.chuahang[0], z: LM.chuahang[1],
    rot: orientLong(LM_DIR.chuahang, LM_FACE.chuahang), size: 25,
  });
  addCollider(LM.chuahang[0], LM.chuahang[1], 12);

  // Ngân hàng Nhà nước — tân cổ điển Pháp đá granite (ảnh Commons, dựng mirror nửa trái)
  placeGLB({
    url: 'assets/nhnn.glb', name: 'Ngân hàng Nhà nước',
    x: LM.nhnn[0], z: LM.nhnn[1],
    rot: orientLong(LM_DIR.nhnn, LM_FACE.nhnn), size: 63,
  });
  addCollider(LM.nhnn[0], LM.nhnn[1], 28);

  // Đền Tam Kỳ — thờ Quan lớn Tuần Tranh, bên hồ Tam Bạc
  placeGLB({
    url: 'assets/dentamky.glb', name: 'Đền Tam Kỳ',
    x: LM.dentamky[0], z: LM.dentamky[1],
    rot: orientLong(LM_DIR.dentamky, LM_FACE.dentamky), size: 22,
  });
  addCollider(LM.dentamky[0], LM.dentamky[1], 11);

  // ---------- ĐỢT ĐỊA DANH 2: procedural (chưa có ảnh đạt chuẩn) ----------
  // UBND TP — khối Pháp cổ 3 tầng kem, mái đỏ, trán giữa + cờ
  {
    const [ux, uz] = LM.ubnd;
    const th = orientLong(LM_DIR.ubnd, LM_FACE.ubnd);
    const g = new THREE.Group();
    const wallM = mat(0xf3e3bc), trimM = mat(0xfdf8ea);
    const main = new THREE.Mesh(new THREE.BoxGeometry(48, 14, 16), wallM);
    main.position.y = 7; g.add(main);
    for (let f = 0; f < 4; f++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(48.15, 1.5, 16.15), sharedMats.window);
      strip.position.y = 2.4 + f * 3.4; g.add(strip);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(50, 1.3, 17.6), mat(0xa04a34));
    roof.position.y = 14.6; g.add(roof);
    // sảnh chính kiểu portico: HÀNG CỘT + dầm ngang + trán tam giác (thay khối đặc xấu)
    for (const cx of [-8, -4.8, -1.6, 1.6, 4.8, 8]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 11, 10), trimM);
      col.position.set(cx, 5.6, 9.4); g.add(col);
      const capB = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 1.7), trimM);
      capB.position.set(cx, 11.2, 9.4); g.add(capB);
    }
    const entab = new THREE.Mesh(new THREE.BoxGeometry(19.5, 1.8, 2.8), trimM);
    entab.position.set(0, 12.1, 9.4); g.add(entab);
    const pedShape = new THREE.Shape();
    pedShape.moveTo(-10.2, 0); pedShape.lineTo(10.2, 0); pedShape.lineTo(0, 4.4); pedShape.lineTo(-10.2, 0);
    const ped = new THREE.Mesh(new THREE.ExtrudeGeometry(pedShape, { depth: 2.6, bevelEnabled: false }), trimM);
    ped.position.set(0, 13, 8.2); g.add(ped);
    for (let s = 0; s < 3; s++) {   // bậc thềm
      const step = new THREE.Mesh(new THREE.BoxGeometry(21 - s * 2, 0.4, 2), mat(0xe6dcc2));
      step.position.set(0, 0.2 + s * 0.4, 11.4 - s * 0.9); g.add(step);
    }
    // cột cờ + cờ trên nóc chính
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 8, 6), mat(0xd8d8d8));
    pole.position.set(0, 19, 0); g.add(pole);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.9),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    fl.position.set(1.5, 22, 0); g.add(fl);
    updaters.push((dt, time) => { fl.rotation.y = Math.sin(time * 1.6 + 7) * 0.35; });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(14, 1.3, 0.3),
      new THREE.MeshLambertMaterial({ map: signTexture('UBND THÀNH PHỐ', '#7a1f1f', '#ffe9b8') }));
    sign.position.set(0, 12.1, 10.9); g.add(sign);
    g.position.set(ux, LAND_H, uz);
    g.rotation.y = th;
    scene.add(g);
    addCollider(ux, uz, 27);
  }

  // Rạp Tháng Tám — rạp chiếu bóng art-deco: mặt tiền kem + bảng dọc đỏ
  {
    const [rx, rz] = LM.rap78;   // 1:1 — footprint thật, hết lấn nhau
    const th = orientLong(LM_DIR.rap78, LM_FACE.rap78);
    const g = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(22, 10, 30), mat(0xe8dbb8));
    hall.position.set(0, 5, -6); g.add(hall);
    const front = new THREE.Mesh(new THREE.BoxGeometry(24, 12, 2.4), mat(0xf3ead0));
    front.position.set(0, 6, 10.2); g.add(front);
    const marquee = new THREE.Mesh(new THREE.BoxGeometry(18, 0.6, 4), mat(0x8a2f26));
    marquee.position.set(0, 4.5, 12.8); g.add(marquee);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2.2, 12.5, 1.2),
      new THREE.MeshLambertMaterial({ color: 0xc03428 }));
    tower.position.set(7.5, 7.5, 11); g.add(tower);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(8.5, 1.2, 0.3),
      new THREE.MeshLambertMaterial({ map: signTexture('RẠP THÁNG 8', '#c03428', '#ffe9b8') }));
    sign.position.set(0, 10.2, 11.6); g.add(sign);
    for (const dx of [-6, -2, 2]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 0.3), mat(0x5a3620));
      door.position.set(dx, 1.5, 11.5); g.add(door);
    }
    g.position.set(rx, LAND_H, rz);
    g.rotation.y = th;
    scene.add(g);
    addCollider(rx, rz, 17);
  }

  // Nhà Kèn — lầu bát giác vườn hoa Nguyễn Du (Pháp xây 1920s, nơi đội kèn diễn tấu)
  {
    const [kx, kz] = LM.nhaken;
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.7, 0.7, 8), mat(0xd8cdb4));
    base.position.y = 0.35; g.add(base);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 3.6, 8), mat(0xf3ead6));
      col.position.set(Math.cos(a) * 3.5, 2.5, Math.sin(a) * 3.5);
      g.add(col);
    }
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.45, 8), mat(0xe6dcc2));
    ring.position.y = 4.5; g.add(ring);
    const roofK = new THREE.Mesh(new THREE.ConeGeometry(4.9, 2.6, 8), mat(0x9c4632));
    roofK.position.y = 6.05; g.add(roofK);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), mat(0x7a5a28));
    tip.position.y = 7.5; g.add(tip);
    g.position.set(kx, LAND_H, kz);
    scene.add(g);
    addCollider(kx, kz, 4.6);
  }

  // Cung Văn hóa Thanh Niên — công trình văn hóa lớn (OSM way 240583084)
  {
    const cx = 947, cz = 803;
    if (Math.abs(groundHeightNoDeck(cx, cz) - LAND_H) < 1.2) {
      const g = new THREE.Group();
      const wallM = mat(0xe8ddc8);
      const body = new THREE.Mesh(new THREE.BoxGeometry(54, 15, 30), wallM);
      body.position.y = 7.5; g.add(body);
      for (let f = 0; f < 4; f++) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(54.2, 1.5, 30.2), sharedMats.window);
        strip.position.y = 2.6 + f * 3.4; g.add(strip);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(56, 1.2, 32), mat(0x9fb0bf));
      roof.position.y = 15.6; g.add(roof);
      // sảnh cong kính phía trước
      const lobby = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 12, 16, 1, false, -Math.PI / 2, Math.PI),
        new THREE.MeshLambertMaterial({ color: 0x9ec6e0, transparent: true, opacity: 0.8 }));
      lobby.position.set(0, 6, 15); g.add(lobby);
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 1, 16, 1, false, -Math.PI / 2, Math.PI), mat(0xc0392b));
      canopy.position.set(0, 12.5, 15); g.add(canopy);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(30, 2, 0.4),
        new THREE.MeshLambertMaterial({ map: signTexture('CUNG VĂN HÓA THANH NIÊN', '#164a7a', '#ffffff') }));
      sign.position.set(0, 13.6, 15.4); g.add(sign);
      g.position.set(cx, LAND_H, cz);
      g.rotation.y = Math.PI; // sảnh cong quay ra phố (−z)
      scene.add(g);
      addCollider(cx, cz, 30);
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
    // ven hồ Tam Bạc (bờ nam, ngoài lòng hồ đào) + mép quảng trường Nhà hát lớn
    bench(LM.lake[0] - 90, LM.lake[1] + 88, 0); bench(LM.lake[0], LM.lake[1] + 70, 0); bench(LM.lake[0] + 90, LM.lake[1] + 52, 0);
    const [ftX2, ftZ2] = EXTRAS.fountain;
    bench(ftX2 - 24, ftZ2 + 20, Math.PI); bench(ftX2 + 24, ftZ2 + 20, Math.PI);
  }

  // ---------- NỘI THẤT ĐƯỜNG PHỐ (từ dữ liệu OSM: STREETS/INTERSECTIONS/MEDIANS) ----------
  {
    // 1) Biển tên phố xanh lá — đặt tại GIAO LỘ gần nhất (đúng thực tế; tâm nhãn OSM có thể
    //    rơi giữa lòng đường/sát điểm pano — bài học pano-loop V1, pano_031), chữ song song phố
    const poleM = mat(0x5a5f66);
    for (const st of STREETS) {
      const perp = [-st.d[1], st.d[0]];
      let ax = st.x, az = st.z, abd = 1e9;
      for (const [ix, iz] of INTERSECTIONS) { const d = Math.hypot(ix - st.x, iz - st.z); if (d < abd) { abd = d; ax = ix; az = iz; } }
      if (abd > 220) { ax = st.x; az = st.z; }               // phố không có giao lộ gần → giữ tâm nhãn
      const sx = ax + perp[0] * 4.6 + st.d[0] * 6, sz = az + perp[1] * 4.6 + st.d[1] * 6;
      if (isWater(sx, sz)) continue;
      const y = groundHeightNoDeck(sx, sz);
      if (Math.abs(y - LAND_H) > 1.5) continue;
      const th = Math.atan2(-st.d[1], st.d[0]);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 6), poleM);
      post.position.set(sx, y + 1.3, sz); scene.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.62, 0.08),
        new THREE.MeshLambertMaterial({ map: signTexture(st.n.toUpperCase().replace(/^(ĐƯỜNG|PHỐ|CẦU) /, ''), '#1c6e43', '#ffffff') }));
      plate.position.set(sx, y + 2.75, sz);
      plate.rotation.y = th;
      scene.add(plate);
    }

    // 2) Đèn tín hiệu tại giao lộ lớn — 3 bóng, chu kỳ xanh/vàng/đỏ lệch pha
    const lampHeads = [];
    for (let i = 0; i < INTERSECTIONS.length; i++) {
      const [ix, iz] = INTERSECTIONS[i];
      const cx = ix + 5, cz = iz + 5;
      if (isWater(cx, cz)) continue;
      const y = groundHeightNoDeck(cx, cz);
      if (Math.abs(y - LAND_H) > 1.5) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 4.6, 6), poleM);
      pole.position.set(cx, y + 2.3, cz); scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 0.12), poleM);
      arm.position.set(cx - 1.1, y + 4.5, cz); scene.add(arm);
      const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.35, 0.3), mat(0x24272b));
      headBox.position.set(cx - 2.1, y + 3.9, cz); scene.add(headBox);
      const lamps = [];
      const cols = [0xff2e20, 0xffb300, 0x2ecc40];
      for (let k = 0; k < 3; k++) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x222222 }));
        lamp.position.set(cx - 2.1, y + 4.3 - k * 0.4, cz + 0.17);
        scene.add(lamp);
        lamps.push({ lamp, col: cols[k] });
      }
      lampHeads.push({ lamps, phase: i * 2.3 });
    }
    updaters.push((dt, time) => {
      for (const h of lampHeads) {
        const t = (time + h.phase) % 10;
        const on = t < 4.5 ? 2 : t < 6 ? 1 : 0; // xanh → vàng → đỏ
        for (let k = 0; k < 3; k++) h.lamps[k].lamp.material.color.setHex(k === on ? h.lamps[k].col : 0x222222);
      }
    });

    // 3) Dải phân cách giữa các đại lộ (THĐ, Trần Phú, Điện Biên Phủ) + CÂY XÀ CỪ tán lớn + bụi cây
    // (theo Street View thật: đại lộ trung tâm rợp cây xà cừ/muồng tán tròn to, xanh quanh năm)
    const medM = mat(0xb9c2b6), bushM = mat(0x3e7a3a);
    const fracM = (v) => { const t = Math.abs(v); return t - Math.floor(t); };
    // Cây xà cừ: thân to + tán tròn XANH lớn (không nở đỏ), rợp bóng đại lộ
    function shadeTree(x, z) {
      const gg = new THREE.Group();
      const yy = groundHeight(x, z);
      const s = 0.9 + fracM(Math.sin(x * 2.1 + z * 1.3) * 7919.3) * 0.55;   // ~11–17m
      const trunkH = 4.4 * s;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.34 * s, 0.6 * s, trunkH, 7), sharedMats.trunk);
      trunk.position.y = trunkH / 2; gg.add(trunk);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + s * 3;
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.26 * s, 2 * s, 5), sharedMats.trunk);
        br.position.set(Math.cos(a) * 0.8 * s, trunkH - 0.3 * s, Math.sin(a) * 0.8 * s);
        br.rotation.set(Math.cos(a) * 0.7, 0, -Math.sin(a) * 0.7); gg.add(br);
      }
      const crownY = trunkH + 2.4 * s, crownR = 4.8 * s;
      const blobs = [[0, 0.42, 0, 1], [-0.56, 0.02, 0.5, 0.74], [0.56, 0.06, -0.5, 0.74], [0.12, -0.05, 0.66, 0.68], [-0.5, -0.02, -0.6, 0.7], [0, 0.78, 0, 0.72]];
      blobs.forEach(([ox, oy, oz, rf], i) => {
        const leaf = new THREE.Mesh(canopyGeo(crownR * rf, x * 2.3 + z * 1.9 + i), i % 2 ? sharedMats.leafGreen2 : sharedMats.leafGreen);
        leaf.position.set(ox * crownR, crownY + oy * crownR, oz * crownR); leaf.scale.y = 0.8; gg.add(leaf);
      });
      gg.position.set(x, yy, z); gg.rotation.y = x + z * 1.7; bakeTree(gg, x, z);
      addCollider(x, z, 1.0 * s);
    }
    // 2b) VẠCH QUA ĐƯỜNG zebra tại giao lộ lớn (PANO-LOOP V3: nhiều finding "thiếu vạch qua đường")
    {
      const zebraG = [];
      for (const [ix, iz] of INTERSECTIONS) {
        if (ix * ix + iz * iz > 1000 * 1000) continue;
        if (isWater(ix, iz)) continue;
        // đoạn đường p/s gần nhất → hướng đặt vạch
        let bd = 1e9, ux = 1, uz = 0, hw = 5;
        for (const r of ROADS_DT) {
          if (r.c !== 'p' && r.c !== 's') continue;
          for (let i = 0; i < r.pts.length - 1; i++) {
            const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
            const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz; if (!l2) continue;
            let t = ((ix - x1) * dx + (iz - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
            const d = Math.hypot(ix - (x1 + dx * t), iz - (z1 + dz * t));
            if (d < bd) { bd = d; const L = Math.sqrt(l2); ux = dx / L; uz = dz / L; hw = ROAD_W[r.c] / 2; }
          }
        }
        if (bd > 6) continue;                                   // giao lộ không nằm trên p/s
        const rotY = Math.atan2(ux, uz);
        for (const dir of [-1, 1]) {                             // 2 phía giao lộ
          const cx = ix + ux * dir * (hw + 3.2), cz = iz + uz * dir * (hw + 3.2);
          const y = groundHeightNoDeck(cx, cz);
          if (Math.abs(y - LAND_H) > 0.4) continue;
          for (let k = -Math.floor(hw - 1); k <= Math.floor(hw - 1); k += 1.15) {  // sọc song song trục đường
            const sx = cx - uz * k, sz = cz + ux * k;
            const strip = new THREE.BoxGeometry(0.5, 0.03, 2.1);
            strip.rotateY(rotY); strip.translate(sx, y + 0.12, sz);
            zebraG.push(strip);
          }
        }
      }
      if (zebraG.length) addMerged(zebraG, mat(0xe8e6df), 'zebra_crossings');
    }

    for (const line of MEDIANS) {
      let acc = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const [x1, z1] = line[i], [x2, z2] = line[i + 1];
        const segL = Math.hypot(x2 - x1, z2 - z1);
        const d = [(x2 - x1) / segL, (z2 - z1) / segL];
        const th = Math.atan2(-d[1], d[0]);
        for (let s = 6; s < segL - 6; s += 10) {
          const mx = x1 + d[0] * s, mz = z1 + d[1] * s;
          if (INTERSECTIONS.some(([px, pz]) => (px - mx) ** 2 + (pz - mz) ** 2 < 14 * 14)) continue;
          if (isWater(mx, mz)) continue;
          const y = groundHeightNoDeck(mx, mz);
          if (Math.abs(y - LAND_H) > 1) continue;
          const block = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.3, 1.1), medM);
          block.position.set(mx, y + 0.15, mz);
          block.rotation.y = th;
          block.receiveShadow = true;
          scene.add(block);
          acc += 10;
          if (acc >= 22) {           // cây xà cừ lớn ~ mỗi 22m
            acc = 0;
            shadeTree(mx, mz);
          } else {
            const bush = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), bushM);
            bush.position.set(mx, y + 0.65, mz);
            bush.scale.set(1.6, 0.8, 0.7);
            bush.rotation.y = th;
            scene.add(bush);
          }
        }
      }
    }
    // Cây xà cừ rợp bóng dọc HAI BÊN các đại lộ lớn trung tâm (theo ảnh thật) — giới hạn để giữ FPS
    let nShade = 0;
    for (const r of ROADS_DT) {
      if (r.c !== 'p' || nShade >= 170) continue;
      for (let i = 0; i < r.pts.length - 1 && nShade < 170; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const rotY = Math.atan2(x2 - x1, z2 - z1), px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let s = 16; s < len && nShade < 170; s += 44) {
          const t = s / len;
          for (const sgn of [-1, 1]) {
            const tx = x1 + (x2 - x1) * t + sgn * (ROAD_W.p / 2 + 2.6) * px;
            const tz = z1 + (z2 - z1) * t + sgn * (ROAD_W.p / 2 + 2.6) * pz;
            if (tx * tx + tz * tz > 850 * 850) continue;
            if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.3) continue;
            if (Object.values(LM).some(([lx, lz]) => (tx - lx) ** 2 + (tz - lz) ** 2 < 22 * 22)) continue;
            const p = { x: tx, z: tz }; world.resolveCollisions(p, 0.6);
            if (Math.hypot(p.x - tx, p.z - tz) > 0.3) continue;
            shadeTree(tx, tz); nShade++;
          }
        }
      }
    }

    // 4) Nhà chờ xe buýt dọc các phố lớn nhất
    for (const st of STREETS.slice(0, 6)) {
      const perp = [-st.d[1], st.d[0]];
      const bx = st.x - perp[0] * 5.4 + st.d[0] * 9, bz = st.z - perp[1] * 5.4 + st.d[1] * 9;
      if (isWater(bx, bz)) continue;
      const y = groundHeightNoDeck(bx, bz);
      if (Math.abs(y - LAND_H) > 1.2) continue;
      const th = Math.atan2(-st.d[1], st.d[0]);
      const g = new THREE.Group();
      const roofB = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.15, 1.7), mat(0x2e6fa1));
      roofB.position.y = 2.5; g.add(roofB);
      for (const px of [-1.9, 1.9]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.5, 6), poleM);
        p.position.set(px, 1.25, -0.6); g.add(p);
      }
      const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 0.08), mat(0xd7e2ea));
      back.position.set(0, 1.5, -0.72); g.add(back);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.1, 0.5), mat(0x8a6a44));
      seat.position.set(0, 0.55, -0.35); g.add(seat);
      g.position.set(bx, y, bz);
      g.rotation.y = th;
      scene.add(g);
    }

    // 5) Thuyền thiên nga hồ Tam Bạc
    const swanW = mat(0xf5f5f0);
    function swan(x, z, rot) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), swanW);
      body.scale.set(1.35, 0.8, 1); body.position.y = 0.5; g.add(body);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.3, 8), swanW);
      tail.rotation.x = -1.1; tail.position.set(-1.35, 0.95, 0); g.add(tail);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.7, 8), swanW);
      neck.rotation.z = -0.25; neck.position.set(1.15, 1.45, 0); g.add(neck);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), swanW);
      head.position.set(1.4, 2.35, 0); g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), mat(0xe8842a));
      beak.rotation.z = -Math.PI / 2; beak.position.set(1.75, 2.32, 0); g.add(beak);
      const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.3), mat(0xd8332a));
      canopy.position.set(-0.2, 1.75, 0); g.add(canopy);
      g.position.set(x, 0.12, z);
      g.rotation.y = rot;
      scene.add(g);
      const x0 = x, z0 = z, ph = x * 0.7;
      updaters.push((dt, time) => {
        g.position.y = 0.12 + Math.sin(time * 1.1 + ph) * 0.07;
        g.position.x = x0 + Math.sin(time * 0.13 + ph) * 3;
        g.position.z = z0 + Math.cos(time * 0.11 + ph) * 2;
        g.rotation.y = rot + Math.sin(time * 0.13 + ph) * 0.4;
      });
    }
    swan(LM.lake[0] + 60, LM.lake[1] - 12, 0.6);
    swan(LM.lake[0] + 250, LM.lake[1] - 52, -1.2);
    swan(LM.lake[0] + 480, LM.lake[1] - 100, 2.1);

    // 6) Dây đèn đêm dải trung tâm: quảng trường → đầu đông hồ Tam Bạc
    {
      const bulbM = new THREE.MeshBasicMaterial({ color: 0xffd98a });
      const p0 = [EXTRAS.square[0] - 10, EXTRAS.square[1] + 10], p1 = [-430, 195];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const d = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L];
      const step = 16;
      let prev = null;
      for (let s = 0; s <= L; s += step) {
        const px = p0[0] + d[0] * s, pz = p0[1] + d[1] * s;
        if (isWater(px, pz)) continue;
        const y = groundHeightNoDeck(px, pz);
        if (Math.abs(y - LAND_H) > 1) { prev = null; continue; }
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.6, 6), poleM);
        pole.position.set(px, y + 1.8, pz);
        scene.add(pole);
        if (prev) {
          for (let k = 1; k < 7; k++) {
            const t = k / 7;
            const bx = prev[0] + (px - prev[0]) * t, bz = prev[1] + (pz - prev[1]) * t;
            const sag = Math.sin(t * Math.PI) * 0.55;
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 6, 5), bulbM);
            bulb.position.set(bx, y + 3.55 - sag, bz);
            scene.add(bulb);
          }
        }
        prev = [px, pz];
      }
    }
  }

  // ---------- DẢI VƯỜN HOA TRUNG TÂM (chuỗi vườn hoa đặc trưng Hải Phòng) ----------
  // An Biên → Ng.Văn Trỗi → Ng.Bỉnh Khiêm → Nguyễn Du(Nhà Kèn) → Kim Đồng → Tố Hữu
  {
    const flowerCols = [0xe8402a, 0xf4c430, 0xff5fa2, 0xff8c00, 0x9b59b6, 0xfdfdfd, 0xe74c3c];
    // material bồn hoa CHIA SẺ theo màu (trước: tạo material mới mỗi bồn — hàng trăm bồn)
    const flowerDomeM = flowerCols.map((col) =>
      new THREE.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.14, flatShading: true }));
    const hedgeM = mat(0x3f7a3a);
    const pathM = mat(0xd8cba8);
    const bedRimM = mat(0xa89878);
    const lawnM = mat(0x6fae4e);
    function flowerBed(bx, bz, r, seed) {
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.3, 0.4, 10), bedRimM);
      rim.position.set(bx, LAND_H + 0.2, bz); rim.receiveShadow = true; scene.add(rim);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(r * 0.92, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
        flowerDomeM[seed % flowerCols.length]);
      dome.position.set(bx, LAND_H + 0.38, bz); dome.scale.y = 0.5; scene.add(dome);
    }
    // MỖI Ô ĐẤT có HƯỚNG RIÊNG (phố cong, ô xéo khác nhau) → KHÔNG dùng 1 góc lưới chung
    // (dùng chung làm vườn xiên so với mép ô). Tính HÌNH CHỮ NHẬT BAO DIỆN TÍCH NHỎ NHẤT của
    // CHÍNH polygon công viên (min-area rect: 1 cạnh trùng cạnh đa giác) → vườn khớp mép ô, cạnh
    // song song vỉa hè, phủ đúng tới mép đất (hết "xiên xẹo").
    function nearestPark(gx, gz, maxD = 170) {
      let best = null, bd = maxD;
      for (const pts of (PARKS || [])) {
        let sx = 0, sz = 0; for (const [x, z] of pts) { sx += x; sz += z; }
        const cx = sx / pts.length, cz = sz / pts.length;
        const d = Math.hypot(cx - gx, cz - gz);
        if (d < bd) { bd = d; best = pts; }
      }
      return best;
    }
    function minAreaRect(pts) {
      let best = null; const seen = new Set();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 1) continue;
        const ux = dx / len, uz = dz / len;
        const q = ((Math.round(Math.atan2(uz, ux) * 57.2958) % 180) + 180) % 180;  // gộp hướng trùng
        if (seen.has(q)) continue; seen.add(q);
        let u1 = 1e9, u2 = -1e9, v1 = 1e9, v2 = -1e9;
        for (const [x, z] of pts) {
          const u = x * ux + z * uz, v = -x * uz + z * ux;
          if (u < u1) u1 = u; if (u > u2) u2 = u; if (v < v1) v1 = v; if (v > v2) v2 = v;
        }
        const w = u2 - u1, h = v2 - v1, area = w * h;
        if (!best || area < best.area) {
          const cu = (u1 + u2) / 2, cv = (v1 + v2) / 2;
          best = { area, u: [ux, uz], w, d: h, cx: cu * ux - cv * uz, cz: cu * uz + cv * ux };
        }
      }
      return best;
    }
    for (const g0 of GARDENS) {
      const poly = nearestPark(g0.x, g0.z);
      const rect = poly && poly.length >= 3 ? minAreaRect(poly) : null;
      const GU = rect ? rect.u : [1, 0];              // trục dọc theo mép ô ĐẤT NÀY
      const GV = [-GU[1], GU[0]];                     // trục ngang vuông góc
      const GROT = Math.atan2(-GU[1], GU[0]);         // rot.y để local +X trùng GU
      if (!rect) continue;
      const y = groundHeightNoDeck(rect.cx, rect.cz);
      if (Math.abs(y - LAND_H) > 1.5 || riverFactor(rect.cx, rect.cz) > 0.02) continue;
      // ---- CỎ theo ĐÚNG hình POLYGON ô đất (bình hành/thang vẫn khớp — HẾT LỆCH), nong ra tới vỉa hè ----
      const cx0 = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cz0 = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      const SC = 1.14;   // nong polygon ra ~ tới vỉa hè (giữ nguyên HÌNH DẠNG)
      const spoly = poly.map(([x, z]) => [cx0 + (x - cx0) * SC, cz0 + (z - cz0) * SC]);
      const shape = new THREE.Shape(spoly.map(([x, z]) => new THREE.Vector2(x, -z)));   // (x,-z): sau rotateX ra đúng XZ
      const lawnGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
      lawnGeo.rotateX(-Math.PI / 2);
      const lawn = new THREE.Mesh(lawnGeo, lawnM);
      lawn.position.y = LAND_H; lawn.receiveShadow = true; scene.add(lawn);
      // point-in-polygon (ray cast) để CẮT luống hoa/cây theo đúng hình
      const inPoly = (x, z) => { let c = false; for (let i = 0, j = spoly.length - 1; i < spoly.length; j = i++) { const [xi, zi] = spoly[i], [xj, zj] = spoly[j]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c; };
      // extent theo TRỤC ô đất (GU dọc / GV ngang) quanh tâm
      let u1 = 1e9, u2 = -1e9, v1 = 1e9, v2 = -1e9;
      for (const [x, z] of spoly) { const u = (x - cx0) * GU[0] + (z - cz0) * GU[1], v = (x - cx0) * GV[0] + (z - cz0) * GV[1]; if (u < u1) u1 = u; if (u > u2) u2 = u; if (v < v1) v1 = v; if (v > v2) v2 = v; }
      const uc = (u1 + u2) / 2, vc = (v1 + v2) / 2, uw = u2 - u1, vw = v2 - v1;
      const L = (ox, oz) => [cx0 + ox * GU[0] + oz * GV[0], cz0 + ox * GU[1] + oz * GV[1]];
      // lối đi chữ thập lát gạch — vừa khít extent ô, giao ở tâm
      const gg = new THREE.Group(); gg.position.set(cx0, LAND_H, cz0); gg.rotation.y = GROT; scene.add(gg);
      const pH = new THREE.Mesh(new THREE.BoxGeometry(uw, 0.16, 3.4), pathM); pH.position.set(uc, 0.14, vc); gg.add(pH);
      const pV = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, vw), pathM); pV.position.set(uc, 0.14, vc); gg.add(pV);
      // bồn hoa TRUNG TÂM (Meshy) — trừ vườn Nhà Kèn giữ Nhà Kèn
      const [bcx, bcz] = L(uc, vc);
      const isKen = Math.hypot(cx0 - LM.nhaken[0], cz0 - LM.nhaken[1]) < 20;
      if (!isKen) heroBed(bcx, bcz, Math.max(7, Math.min(14, uw * 0.21, vw * 0.21)));
      else addCollider(bcx, bcz, 5);
      // LUỐNG HOA lưới — CHỈ trong polygon (đi được)
      let bi = 3;
      for (let ox = u1 + 8; ox <= u2 - 8; ox += 17) {
        for (let oz = v1 + 8; oz <= v2 - 8; oz += 17) {
          if (Math.abs(ox - uc) < 5 || Math.abs(oz - vc) < 5) continue;                 // chừa lối đi
          if (Math.hypot(ox - uc, oz - vc) < Math.max(12, uw * 0.12)) continue;         // chừa bồn giữa
          const [wx, wz] = L(ox, oz);
          if (!inPoly(wx, wz)) continue;
          flowerBed(wx, wz, 1.7 + ((bi * 7) % 3) * 0.45, bi); bi++;
        }
      }
      // Cây quanh CHU VI: rải dọc BIÊN polygon, thụt vào ~4m (hero ở đoạn đầu, còn lại procedural)
      const nb = spoly.length; let ti = 0;
      for (let i = 0; i < nb; i++) {
        const [ax, az] = spoly[i], [bx, bz] = spoly[(i + 1) % nb];
        const segL = Math.hypot(bx - ax, bz - az), steps = Math.max(1, Math.floor(segL / 24));
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps; let tx = ax + (bx - ax) * t, tz = az + (bz - az) * t;
          const dx = cx0 - tx, dz = cz0 - tz, dl = Math.hypot(dx, dz) || 1; tx += dx / dl * 4; tz += dz / dl * 4;
          if (Math.abs(groundHeightNoDeck(tx, tz) - LAND_H) > 0.6) continue;
          if ((ti++ % 5) === 0) heroTree(tx, tz); else streetTree(tx, tz);
        }
      }
      // KHÔNG chặn giữa vườn (trừ Nhà Kèn) — công viên/vườn hoa ĐI ĐƯỢC
    }
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
        if (mx * mx + mz * mz > 900 * 900) continue;
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
  // Mây TRÔI theo gió — tốc độ hợp tỉ lệ 1:1 (trước để 2.2 m/s, ở thế giới 55km nhìn như đứng im)
  clouds.forEach((c, i) => { c.userData.drift = 13 + (i % 5) * 3.5; });   // ~13–27 m/s mỗi đám
  updaters.push((dt) => {
    for (const c of clouds) {
      c.position.x += dt * c.userData.drift;
      if (c.position.x > WORLD_BOUNDS.maxX + 400) c.position.x = WORLD_BOUNDS.minX - 400;
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
  world.npcSpots.coba = [LM.lake[0] - 20, LM.lake[1] + 62];
  world.npcSpots.xichlo = [LM.quanhoa[0] - 26, LM.quanhoa[1] + 18];
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

  flushTrees();      // GỘP toàn bộ cây procedural đã bake → vài mesh tĩnh (giảm ~8700 draw call)
  loadHeroTrees();   // nạp GLB cây phượng ảnh-thật rồi dựng InstancedMesh (bất đồng bộ)
  loadHeroBeds();    // nạp GLB luống hoa ảnh-thật rồi dựng InstancedMesh
  return world;
}
