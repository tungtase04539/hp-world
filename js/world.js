import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { registerModel, shrinkTexturesForMobile, IS_MOBILE } from './assets.js';
import {
  WORLD_BOUNDS, LM, LM_DIR, LM_FACE, EXTRAS, TREES, PARKS, RAIL, DT_BOX, RIVERS, ROADS_DT, ROADS_REGION, BRIDGES, BUILDINGS,
  groundHeight, groundHeightNoDeck, isWater, landAt, riverFactor,
  nearestRiverPoint, findShore, addPier, LAKE_POLY, lakeSD, HOSEN_POLY, hoSenSD,
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
    // HỒ SEN (cell_nam V1): hồ 85m < ô lưới thô 112m → dìm cả bbox, lưới mịn vẽ đè
    if (x > -95 && x < 85 && z > 810 && z < 1100) h = -3;
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

  // ---------- DẢI LƯỚI MỊN HỒ SEN (5m) — phủ bbox đã dìm, đúng cao độ + màu ----------
  {
    const X1 = -215, X2 = 205, Z1 = 690, Z2 = 1220, STEP = 5;
    const g2 = new THREE.PlaneGeometry(X2 - X1, Z2 - Z1, Math.round((X2 - X1) / STEP), Math.round((Z2 - Z1) / STEP));
    g2.rotateX(-Math.PI / 2);
    g2.translate((X1 + X2) / 2, 0, (Z1 + Z2) / 2);
    const p2 = g2.attributes.position;
    const col2 = new Float32Array(p2.count * 3);
    const cSand2 = new THREE.Color(0xeeda9e), cDeep2 = new THREE.Color(0x6fa393),
          cG1 = new THREE.Color(0x83cb6a), cG2 = new THREE.Color(0x5fae52), cCity2 = new THREE.Color(0xcfc7b2);
    const tmp2 = new THREE.Color();
    for (let i = 0; i < p2.count; i++) {
      const x = p2.getX(i), z = p2.getZ(i);
      const h = groundHeightNoDeck(x, z);
      p2.setY(i, h + 0.05);
      if (h < -0.6) tmp2.copy(cDeep2);
      else if (h < 1.1) tmp2.copy(cSand2);
      else {
        const patch = Math.sin(x * 0.047) * Math.sin(z * 0.041);
        tmp2.copy(cG1).lerp(cG2, smoothstep(-0.5, 0.9, patch));
        tmp2.lerp(cCity2, 0.55);
      }
      const hash = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const noise = 1 + ((hash - Math.floor(hash)) - 0.5) * 0.09;
      col2[i * 3] = tmp2.r * noise; col2[i * 3 + 1] = tmp2.g * noise; col2[i * 3 + 2] = tmp2.b * noise;
    }
    g2.setAttribute('color', new THREE.BufferAttribute(col2, 3));
    g2.computeVertexNormals();
    const m2 = new THREE.Mesh(g2, new THREE.MeshLambertMaterial({ vertexColors: true }));
    m2.name = 'hosen_ground'; m2.receiveShadow = true; scene.add(m2);
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
  water.userData.dyn = true;
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
  // Tọa độ pano = TIM ĐƯỜNG → cột từng đứng chình ình giữa lòng đường; dời sang đảo/quảng
  // trường bonsai phía ĐÔNG đường (chiếu lên đoạn đường gần nhất + đẩy ngang nửa lòng + 4m)
  {
    const fx = -18.7, fz = 118.3, gy = groundHeight(fx, fz);
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

  // ---------- QUẢNG TRƯỜNG NHÀ HÁT: nền đá xám + bonsai kiềng gỗ + đồ quảng trường ----------
  // PLAN corridor4056 V2 (pano_055 h270: nền đá xám khổ lớn + 2 hàng bonsai chậu kiềng cọc gỗ
  // + cột đèn pha + kiosk báo + trạm xe đạp). Trục road#9: A=(41,59) u=(0.2989,0.9543) n_tây=(-0.9543,0.2989)
  {
    const AX = 41, AZ = 59, UX = 0.2989, UZ = 0.9543, NX = -0.9543, NZ = 0.2989;
    const P = (along, lat) => [AX + UX * along + NX * lat, AZ + UZ * along + NZ * lat];
    // nền đá xám khổ lớn (quad theo PLAN, +0.045 — THẤP hơn sân tròn hoa văn +0.06 nên không z-fight)
    const sqTex = makeTex(256, 256, (g, w, h) => {
      g.fillStyle = '#b9bcb9'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 240; i++) { const v = 170 + Math.random() * 26 | 0; g.fillStyle = `rgba(${v},${v+2},${v},0.5)`; g.fillRect(Math.random()*w, Math.random()*h, 3, 3); }
      g.strokeStyle = 'rgba(70,74,72,.42)'; g.lineWidth = 2;
      const s = w / 4;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i*s,0); g.lineTo(i*s,h); g.moveTo(0,i*s); g.lineTo(w,i*s); g.stroke(); }
    });
    sqTex.wrapS = sqTex.wrapT = THREE.RepeatWrapping; sqTex.repeat.set(14, 14);
    const shp = new THREE.Shape([[12,45],[62,58],[78,140],[20,152]].map(([x,z]) => new THREE.Vector2(x, -z)));
    const sg = new THREE.ShapeGeometry(shp); sg.rotateX(-Math.PI / 2);
    { const p = sg.attributes.position, uv = new Float32Array(p.count * 2);
      for (let i = 0; i < p.count; i++) { uv[i*2] = p.getX(i) / 4.2; uv[i*2+1] = p.getZ(i) / 4.2; }
      sg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); }
    const sqMesh = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ map: sqTex }));
    sqMesh.position.y = LAND_H + 0.045; sqMesh.receiveShadow = true; sqMesh.name = 'opera_sq_stone'; scene.add(sqMesh);
    // 16 bonsai chậu đá + kiềng 3 cọc gỗ (2 hàng lat 12/24, along 6..83)
    const potG = [], greenG = [], woodG = [];
    for (const lat of [12, 24]) for (let k = 0; k < 8; k++) {
      const [bx, bz] = P(6 + k * 11, lat);
      const gy = LAND_H + 0.045;
      const pot = new THREE.CylinderGeometry(0.55, 0.7, 0.7, 8); pot.translate(bx, gy + 0.35, bz); potG.push(pot);
      const ball = new THREE.IcosahedronGeometry(0.95, 1); ball.scale(1, 0.8, 1); ball.translate(bx, gy + 1.75, bz); greenG.push(ball);
      const trunk = new THREE.CylinderGeometry(0.09, 0.12, 0.9, 5); trunk.translate(bx, gy + 1.1, bz); woodG.push(trunk);
      for (let c = 0; c < 3; c++) { const a = c / 3 * Math.PI * 2 + k;
        const st = new THREE.CylinderGeometry(0.035, 0.035, 1.5, 4);
        st.rotateZ(0.42); st.rotateY(a); st.translate(bx + Math.cos(a) * 0.55, gy + 0.95, bz + Math.sin(a) * 0.55); woodG.push(st); }
      addCollider(bx, bz, 0.75);
    }
    addMerged(potG, mat(0x9aa0a2), 'sq_bonsai_pots');
    addMerged(greenG, sharedMats.leafDark, 'sq_bonsai_green');
    addMerged(woodG, mat(0x8a6a42), 'sq_bonsai_wood');
    // 2 cột đèn pha 14m cụm 4 pha
    for (const [lx, lz] of [[23.1, 85.6], [42.8, 131.8]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 14, 8), mat(0x8f979c));
      pole.position.set(lx, LAND_H + 7, lz); scene.add(pole);
      for (let c = 0; c < 4; c++) { const a = c / 4 * Math.PI * 2 + 0.4;
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.45), sharedMats.lampGlow);
        head.position.set(lx + Math.cos(a) * 0.75, LAND_H + 13.6, lz + Math.sin(a) * 0.75); head.rotation.y = -a; scene.add(head); }
      addCollider(lx, lz, 0.5);
    }
    // kiosk báo trắng-xanh + trạm xe đạp công cộng + biển LED 2 cột
    { const [kx, kz] = [64.4, 93.6];
      const k1 = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.4, 2), mat(0xf2f5f4)); k1.position.set(kx, LAND_H + 1.2, kz); scene.add(k1);
      const k2 = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.24, 2.2), mat(0x1f6fae)); k2.position.set(kx, LAND_H + 2.55, kz); scene.add(k2);
      addCollider(kx, kz, 1.6); }
    { const [tx, tz] = [67.9, 108.2];
      const roof = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.16, 1.8), mat(0x2f6bd8)); roof.position.set(tx, LAND_H + 2.5, tz); scene.add(roof);
      for (const s of [-2.9, 2.9]) { const p2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.5, 6), mat(0x8f979c)); p2.position.set(tx + s, LAND_H + 1.25, tz); scene.add(p2); }
      for (let b = 0; b < 6; b++) { const bike = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.85, 1.5), mat(0x2f6bd8)); bike.position.set(tx - 2.5 + b, LAND_H + 0.6, tz); scene.add(bike); }
      addCollider(tx, tz, 3.4); }
    { const [bx2, bz2] = [63.4, 83.4];
      const ledTex = makeTex(256, 128, (g, w, h) => { g.fillStyle = '#12161c'; g.fillRect(0,0,w,h); g.fillStyle = '#e33'; g.fillRect(10,10,w-20,26); g.fillStyle = '#ffd21a'; g.font = 'bold 30px sans-serif'; g.textAlign='center'; g.fillText('HẢI PHÒNG', w/2, h*0.68); });
      const led = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), new THREE.MeshLambertMaterial({ map: ledTex, side: THREE.DoubleSide }));
      led.position.set(bx2, LAND_H + 4.6, bz2); led.rotation.y = Math.atan2(-0.9543, 0.2989); scene.add(led);
      for (const s of [-3.6, 3.6]) { const p3 = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 4.6, 6), mat(0x565c60)); const [px3, pz3] = [bx2 + UX * s, bz2 + UZ * s]; p3.position.set(px3, LAND_H + 2.3, pz3); scene.add(p3); }
      addCollider(bx2, bz2, 1.2); }
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
      const roadClear = (x, z) => { for (const s of parSegs) if (_sd(x, z, s[0], s[1], s[2], s[3]) < s[4] + 1.0) return false; return true; };
      const okSpot = (x, z) => dryLand(x, z) && lakeSD(x, z) > 0.8 && roadClear(x, z);
      const SLAB = 0.24;                                              // vật đứng TRÊN mặt lát caro kè
      const perG = [], binGreen = [], binBlue = [], bikeG = [], postRed = [], postWhite = [];
      // pergola 10×3m gỗ đỏ: 4 cột + 2 dầm dọc + thanh chớp — tâm cách đèn ≥13m (chu kỳ 31, tâm ≡15.5 mod 124)
      const pergolaAt = (cx, cz, barAng, ux, uz, nx2, nz2) => {
        const gy = groundHeight(cx, cz) + SLAB;
        for (const su of [-4.6, 4.6]) for (const sv of [-1.4, 1.4]) {
          const p = new THREE.BoxGeometry(0.16, 2.6, 0.16);
          p.translate(cx + ux * su + nx2 * sv, gy + 1.3, cz + uz * su + nz2 * sv); perG.push(p);
        }
        for (const sv of [-1.4, 1.4]) { const b = new THREE.BoxGeometry(10.4, 0.14, 0.14); b.rotateY(barAng); b.translate(cx + nx2 * sv, gy + 2.66, cz + nz2 * sv); perG.push(b); }
        for (let s = -4.8; s <= 4.8; s += 1.2) { const sl = new THREE.BoxGeometry(0.09, 0.07, 3.4); sl.rotateY(barAng); sl.translate(cx + ux * s, gy + 2.78, cz + uz * s); perG.push(sl); }
      };
      // đi vòng CHU VI hồ theo đúng samples của kè (mỗi 2.6m, pháp tuyến ra ngoài)
      const edgeLen = LAKE_POLY.map((p, e) => { const q = LAKE_POLY[(e + 1) % LAKE_POLY.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
      let tPr = 0;
      for (const [cx0, cz0, ux, uz, nx, nz, eIdx] of samples) {
        tPr += 2.6;
        const barAng = Math.atan2(ux, uz) + Math.PI / 2;
        // bờ bắc = phố đi bộ Quang Trung: pháp tuyến hướng bắc VÀ cạnh DÀI (mũi tây hồ cong
        // cũng có đoạn nz<-0.35 → pergola từng mọc lạc ra đầu tây)
        const isNorth = nz < -0.35 && edgeLen[eIdx] > 150;
        const mPer = ((tPr - 15.5) % 124 + 124) % 124;
        const tR = Math.round(tPr);
        const m26 = tPr % 26;                                         // pha chu kỳ ghế đá
        // (hàng cây cổ thụ ven kè do khối "HÀNG CÂY CỔ THỤ TRÊN KÈ HỒ" phía dưới trồng — mỗi 14m
        //  theo chu vi LAKE_POLY; KHÔNG trồng ở đây: streetTree gọi lúc này là TDZ + trồng sau
        //  flushTrees() sẽ thành cây vô hình kèm collider ma)
        // THÙNG RÁC ĐÔI phân loại mỗi ~52m, sát lan can
        if (tR % 52 < 2.6) {
          const rx = cx0 + nx * 2.5, rz = cz0 + nz * 2.5;
          if (okSpot(rx, rz)) {
            const ry = groundHeight(rx, rz) + SLAB;
            const b1 = new THREE.BoxGeometry(0.42, 0.62, 0.42); b1.translate(rx + ux * 0.26, ry + 0.44, rz + uz * 0.26); binGreen.push(b1);
            const b2 = new THREE.BoxGeometry(0.42, 0.62, 0.42); b2.translate(rx - ux * 0.26, ry + 0.44, rz - uz * 0.26); binBlue.push(b2);
          }
        }
        // PERGOLA gỗ đỏ chỉ bờ bắc (phố đi bộ Quang Trung), tâm mỗi 124m; né chu kỳ GHẾ ĐÁ
        // (khoang ±6m quanh tâm không được dính pha ghế 0..2.6 mod 26 → yêu cầu m26 ∈ [8.6,17.4])
        if (isNorth && mPer < 2.6 && m26 > 8.6 && m26 < 17.4) {
          const px2 = cx0 + nx * 4.0, pz2 = cz0 + nz * 4.0;
          if (okSpot(px2, pz2) && okSpot(px2 + ux * 5, pz2 + uz * 5) && okSpot(px2 - ux * 5, pz2 - uz * 5)) pergolaAt(px2, pz2, barAng, ux, uz, nx, nz);
        }
      }
      // helper: chiếu 1 điểm neo pano lên MÉP POLYGON hồ rồi đặt vật ở offset ra ngoài mép nước
      const projQuay = (px, pz, off) => {
        let bd = 1e9, r = null;
        for (let e = 0; e < LAKE_POLY.length; e++) {
          const [ax, az] = LAKE_POLY[e], [bx2, bz2] = LAKE_POLY[(e + 1) % LAKE_POLY.length];
          const dx = bx2 - ax, dz = bz2 - az, l2 = dx * dx + dz * dz;
          let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = Math.max(0.08, Math.min(0.92, t));
          const qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(px - qx, pz - qz);
          if (d >= bd) continue;
          bd = d;
          const L = Math.sqrt(l2), ux = dx / L, uz = dz / L;
          let nx = -uz, nz = ux;
          if (lakeSD(qx + nx * 3, qz + nz * 3) < 0) { nx = -nx; nz = -nz; }   // pháp tuyến ra ngoài hồ
          r = { x: qx + nx * off, z: qz + nz * off, ux, uz, barAng: Math.atan2(ux, uz) + Math.PI / 2 };
        }
        return r;
      };
      // PAVILION nghỉ chân gỗ đỏ-cam mái bằng ~10×3.6m (pano_011, bờ bắc x≈-877)
      { const p = projQuay(-877, 260, 4.2);
        if (p && okSpot(p.x, p.z)) {
          const gy = groundHeight(p.x, p.z) + SLAB;
          for (const su of [-4.4, 0, 4.4]) for (const sv of [-1.5, 1.5]) { const c = new THREE.BoxGeometry(0.18, 2.7, 0.18); c.translate(p.x + p.ux * su + -p.uz * sv, gy + 1.35, p.z + p.uz * su + p.ux * sv); perG.push(c); }
          const roof = new THREE.BoxGeometry(10.6, 0.22, 4.0); roof.rotateY(p.barAng); roof.translate(p.x, gy + 2.82, p.z); perG.push(roof);
          const seat = new THREE.BoxGeometry(9.4, 0.1, 0.5); seat.rotateY(p.barAng); seat.translate(p.x + -p.uz * 1.0, gy + 0.46, p.z + p.ux * 1.0); perG.push(seat);
          addCollider(p.x, p.z, 2.4);
        } }
      // TRẠM XE ĐẠP công cộng xanh dương (pano_030, bờ nam Nguyễn Đức Cảnh x≈-690)
      { const p = projQuay(-690, 300, 4.0);
        if (p && okSpot(p.x, p.z)) {
          const gy = groundHeight(p.x, p.z) + SLAB;
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
        const gy = groundHeight(p.x, p.z) + SLAB;
        for (const s of [-0.75, 0.75]) { const c = new THREE.BoxGeometry(0.1, 2.6, 0.1); c.translate(p.x + p.ux * s, gy + 1.3, p.z + p.uz * s); postRed.push(c); }
        const fr = new THREE.BoxGeometry(1.8, 1.3, 0.1); fr.rotateY(p.barAng); fr.translate(p.x, gy + 1.9, p.z); postRed.push(fr);
        const pn = new THREE.BoxGeometry(1.62, 1.12, 0.12); pn.rotateY(p.barAng); pn.translate(p.x, gy + 1.9, p.z); postWhite.push(pn);
      }
      // (cây đa quảng trường ven hồ: đã có banyanTree(-383,245) ở khối cây đa phía dưới)
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
    // gồm cả phố 't' (khu Ga pano_022/023: xe máy đỗ kín vỉa hè phố t như phố s); cap 480→620
    const SCOOTER_CAP = 620;
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri];
      if (r.c !== 'p' && r.c !== 's' && r.c !== 't') continue;
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
          // 1.9-2.4m khỏi mép nhựa: tránh dải cột đèn/cột cờ/băng rôn (+1.0..+1.5) — hết xe xuyên cột
          const off = side * (wRoad / 2 + 1.9 + rnd() * 0.5);
          const gx = mx + off * px, gz = mz + off * pz;
          const gy = groundHeight(gx, gz);
          if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;   // né sông/cầu
          // né LÒNG ĐƯỜNG KHÁC tại giao lộ (pháp tuyến phố A rơi vào mặt nhựa phố B)
          { let onRoad = false;
            for (const r2 of ROADS_DT) { if (r2.c === 'w') continue; const hw2 = ROAD_W[r2.c] / 2 + 0.3;
              for (let j = 0; j < r2.pts.length - 1; j++) { const [ax2, az2] = r2.pts[j], [bx2, bz2] = r2.pts[j + 1];
                if (Math.max(ax2, bx2) < gx - 30 || Math.min(ax2, bx2) > gx + 30 || Math.max(az2, bz2) < gz - 30 || Math.min(az2, bz2) > gz + 30) continue;
                const ddx = bx2 - ax2, ddz = bz2 - az2, l22 = ddx * ddx + ddz * ddz || 1e-9;
                let tt = ((gx - ax2) * ddx + (gz - az2) * ddz) / l22; tt = Math.max(0, Math.min(1, tt));
                if (Math.hypot(gx - (ax2 + ddx * tt), gz - (az2 + ddz * tt)) < hw2) { onRoad = true; break; } }
              if (onRoad) break; }
            if (onRoad) continue; }
          // mũi quay VÀO vỉa hè (vuông góc đường), lệch nhẹ cho tự nhiên; +0.18 đứng TRÊN mặt lát vỉa hè
          slots.push([gx, gy + 0.18, gz, rotY + Math.PI / 2 + (rnd() - 0.5) * 0.25, (rnd() * scoolCols.length) | 0]);
          if (slots.length >= SCOOTER_CAP) break;
        }
        if (slots.length >= SCOOTER_CAP) break;
      }
      if (slots.length >= SCOOTER_CAP) break;
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
    const FOOD = [[95.9,40.2],[185,94.5],[33.7,-229.6],[40.5,-340.6],[355.9,-243],[-429.1,73.9],[461.4,20.8],[-459.1,255.3],[591.5,50.1],[-325.2,513.1],[-143.5,601.5],[347.3,513.3],[-49,-627.1],[650.3,-5.6],[-405,528.9],[-357.2,-619.9],[-298.5,-704.8],[-400.7,-688.1],[-245.3,-766],[-783.2,185.2],[724.5,-395.6],[-47.8,842.8],[-825,-274.3],[-935,-96.6],[656.4,779.3],[929.7,-442.6],[-50.2,-1080.8],[-427,943],[-450,940]];
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

  // CÔNG TRÌNH ĐÍCH DANH + vùng quang đãng quanh — MỌI khối nhà infill (shophouse liền kề,
  // nhà tự mọc, block_infill) phải né, không thì mọc đè/che mặt tiền (bài học pano_158/354/358:
  // dãy shophouse liền kề từng nuốt chửng tháp KS Hữu Nghị & nhà Pháp arcade).
  // Tọa độ = tọa độ ĐÃ DỜI KHỎI TIM ĐƯỜNG của từng công trình (đồng bộ với khối dựng bên dưới).
  // KHAI BÁO TRƯỚC khối ô tô đỗ (khối đầu tiên dùng nearFeatured) — TDZ, xem bài học (aj).
  const FEATURED_CLEAR = [
    [257.5, -484.9, 30],   // KS Hữu Nghị
    [-11.8, -256.6, 22],   // tòa Hoàng Long (góc nam ngã ba TQK)
    [237, -292, 26],       // nhà Pháp arcade (Hội LHPN)
    [773.9, -732, 38],     // KS Harbour View (dời theo PLAN corridor4056 V3)
    [-302, 172, 32],       // TT Triển lãm & Mỹ thuật
    [474, 6, 28],          // Sở KH&CN
    [326, -826, 40],       // Cảng vụ (compound + sân)
    [-798, 221, 13],       // FUNZ
    [-247, 92, 16],        // cao ốc kính Lãn Ông
  ];
  const nearFeatured = (x, z) => {
    for (const f of FEATURED_CLEAR) if ((x - f[0]) ** 2 + (z - f[1]) ** 2 < f[2] * f[2]) return true;
    return false;
  };

  // ---------- DẢI HOÀNG DIỆU VEN CẢNG (pano_015-021 — vùng trũng 0.9-2.3 điểm) ----------
  // Thực địa 10/2024: BẮC đường = bãi GIẢI TỎA trống trải đầy gạch vụn nhìn ra cần cẩu cảng
  // (game từng lấp nhà kín); NAM đường = dãy showroom/gara ô tô thấp mái tôn xanh, biển lớn.
  // Trục Hoàng Diệu đoạn ven cảng (từ polyline OSM 'p'): A=(315,-809.5) → hướng (0.9795,-0.2012), dài 360m
  const HD_A = [315, -809.5], HD_U = [0.9795, -0.2012], HD_N = [-0.2012, -0.9795], HD_L = 360;
  const hdAcross = (x, z) => {
    const dx = x - HD_A[0], dz = z - HD_A[1];
    return { along: dx * HD_U[0] + dz * HD_U[1], across: dx * HD_N[0] + dz * HD_N[1] };
  };
  // vùng giải tỏa: phía BẮC đường 7..140m, chừa khuôn viên Cảng vụ (công trình thật còn lại)
  const clearedZone = (x, z) => {
    const { along, across } = hdAcross(x, z);
    if (along < -10 || along > HD_L || across < 7 || across > 140) return false;
    if ((x - 326) ** 2 + (z + 826) ** 2 < 45 * 45) return false;   // khuôn viên Cảng vụ giữ nguyên
    if ((x - 636.5) ** 2 + (z + 894.7) ** 2 < 400) return false;   // nhà hàng bo cong (lm_drafts) đứng trong bãi
    return true;
  };
  // hành lang cây Hoàng Diệu (cả 2 phía ±30m): thực địa là xà cừ/bàng CẮT TRỤI, không phượng đỏ
  const hdTreeBelt = (x, z) => {
    const { along, across } = hdAcross(x, z);
    return along > -10 && along < HD_L && Math.abs(across) < 30;
  };
  {
    // 1) NỀN BÃI: tấm đất nâu + gạch vụn + đống đất + vài mảng tường dở dang
    const dirtTex = makeTex(256, 256, (g, w, h) => {
      g.fillStyle = '#96876e'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        const v = 100 + Math.random() * 80 | 0;
        g.fillStyle = `rgba(${v},${v - 14},${v - 32},0.5)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 3);
      }
    });
    dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping; dirtTex.repeat.set(22, 9);
    const ang = Math.atan2(HD_U[0], HD_U[1]);
    const cxD = HD_A[0] + HD_U[0] * HD_L / 2 + HD_N[0] * 72;
    const czD = HD_A[1] + HD_U[1] * HD_L / 2 + HD_N[1] * 72;
    const dirt = new THREE.Mesh(new THREE.PlaneGeometry(HD_L + 30, 128), new THREE.MeshLambertMaterial({ map: dirtTex }));
    dirt.rotation.x = -Math.PI / 2; dirt.rotation.z = ang - Math.PI / 2;
    dirt.position.set(cxD, LAND_H + 0.06, czD);
    dirt.receiveShadow = true; dirt.name = 'hd_cleared_dirt'; scene.add(dirt);
    // gạch vụn instanced (khối nhỏ nâu đỏ/xám) + đống đất
    const rubbleGeo = new THREE.BoxGeometry(1, 0.5, 0.8);
    const rubbleCols = [0x9a5a44, 0x8a8478, 0xb0aca0, 0x7a6a58].map((c) => new THREE.Color(c));
    let hs = 15021; const hr = () => { hs = (hs * 1103515245 + 12345) & 0x7fffffff; return hs / 0x7fffffff; };
    const slotsR = [];
    for (let k = 0; k < 260; k++) {
      const al = hr() * HD_L, ac = 10 + hr() * 120;
      const x = HD_A[0] + HD_U[0] * al + HD_N[0] * ac, z = HD_A[1] + HD_U[1] * al + HD_N[1] * ac;
      if (!clearedZone(x, z) || Math.abs(groundHeightNoDeck(x, z) - LAND_H) > 0.4) continue;
      slotsR.push([x, z, hr() * Math.PI, 0.6 + hr() * 1.8, (hr() * rubbleCols.length) | 0]);
    }
    if (slotsR.length) {
      const inst = new THREE.InstancedMesh(rubbleGeo, mat(0xcccccc), slotsR.length);
      const m4r = new THREE.Matrix4(), qr = new THREE.Quaternion(), er = new THREE.Euler(), sr = new THREE.Vector3(), pr = new THREE.Vector3();
      slotsR.forEach(([x, z, ry, s, ci], k) => {
        er.set(0, ry, 0); qr.setFromEuler(er); sr.setScalar(s); pr.set(x, LAND_H + 0.25 * s, z);
        m4r.compose(pr, qr, sr); inst.setMatrixAt(k, m4r); inst.setColorAt(k, rubbleCols[ci]);
      });
      inst.instanceMatrix.needsUpdate = true; if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.name = 'hd_rubble'; scene.add(inst);
    }
    // 2-3 mảng tường dở dang (nhà phá dở — pano_019 "nhà dở dang, tường lộ bê tông")
    for (const [al, ac, wl] of [[95, 55, 14], [210, 40, 10], [300, 70, 16]]) {
      const x = HD_A[0] + HD_U[0] * al + HD_N[0] * ac, z = HD_A[1] + HD_U[1] * al + HD_N[1] * ac;
      if (!clearedZone(x, z)) continue;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(wl, 3.2 + (al % 3), 0.35), mat(0xaaa295));
      wall.position.set(x, LAND_H + 1.6, z); wall.rotation.y = ang + (al % 2 ? 0.35 : -0.2);
      wall.castShadow = true; wall.name = 'hd_ruin'; scene.add(wall);
      addCollider(x, z, wl * 0.4);
    }

    // 2) DÃY SHOWROOM/GARA Ô TÔ phía NAM đường (Toản Auto, Tùng Lâm... — biển đỏ/đen chữ to)
    const SHOWROOMS = ['TOẢN AUTO', 'TÙNG LÂM AUTO', 'LIÊU NHÂN AUTO', 'QUỐC TOÀN', 'BẢO MINH', 'AUTO 568', 'GARA ĐẠI PHÁT', 'SALON Ô TÔ HP'];
    const srBg = ['#b91c1c', '#111318', '#1c56a0', '#b91c1c', '#0f6a38', '#111318', '#b06010', '#1c56a0'];
    for (let k = 0; k < SHOWROOMS.length; k++) {
      const al = 42 + k * 41;
      if (al > HD_L - 14) break;
      const W = 18 + (k % 3) * 6, D = 14, H = k % 3 === 1 ? 7.4 : 5.2;   // 1-2 tầng thấp
      const off = -(6.5 + 2.3 + D / 2);                                  // phía NAM (ngược pháp tuyến bắc)
      const x = HD_A[0] + HD_U[0] * al + HD_N[0] * off, z = HD_A[1] + HD_U[1] * al + HD_N[1] * off;
      if (Math.abs(groundHeightNoDeck(x, z) - LAND_H) > 0.4 || isWater(x, z)) continue;
      const g = new THREE.Group(); g.position.set(x, LAND_H, z); g.rotation.y = ang + Math.PI / 2;
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(k % 2 ? 0xe8e4da : 0xd8d4c8));
      body.position.y = H / 2; g.add(body);
      // mặt kính lớn tầng trệt (quay ra đường = local +Z sau xoay)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 3.1, 0.12), sharedMats.window);
      glass.position.set(0, 1.75, D / 2 + 0.05); g.add(glass);
      // mái tôn xanh cong (nửa trụ dẹt) trên một số khối — đặc trưng gara
      if (k % 2 === 0) {
        const vault = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 12, 1, false, 0, Math.PI), mat(0x2e6e56));
        vault.rotation.z = Math.PI / 2; vault.scale.y = 1; vault.scale.z = 0.42;
        vault.position.y = H; g.add(vault);
      } else {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.5, D + 1), mat(0x88b0a0));
        roof.position.y = H + 0.25; g.add(roof);
      }
      // biển hiệu chữ TO phủ bề rộng
      const st = makeTex(512, 84, (gc, w2, h2) => {
        gc.fillStyle = srBg[k]; gc.fillRect(0, 0, w2, h2);
        gc.fillStyle = '#ffe9b0'; gc.font = 'bold 52px system-ui, sans-serif';
        gc.textAlign = 'center'; gc.textBaseline = 'middle'; gc.fillText(SHOWROOMS[k], w2 / 2, h2 / 2 + 2, w2 - 26);
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, 1.5), new THREE.MeshLambertMaterial({ map: st }));
      sign.position.set(0, H - 0.2 + (k % 2 === 0 ? 1.2 : 0.9), D / 2 + 0.1); g.add(sign);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.name = 'hd_showroom'; scene.add(g);
      addCollider(x, z, Math.max(W, D) * 0.5 + 0.5);
      FEATURED_CLEAR.push([x, z, Math.max(W, D) / 2 + 8]);   // shophouse/OSM/nhà rời tự né
    }

    // 3) CÔNG TRÌNH ĐÍCH DANH khu này (tọa độ đã dời khỏi tim đường theo catalog):
    const bandTower = (x, z, W, D, FL, FH, wallHex, name, signTxt, signBg) => {
      if (Math.abs(groundHeightNoDeck(x, z) - LAND_H) > 0.4 || isWater(x, z)) return null;
      const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z);
      const H = FL * FH;
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(wallHex)); body.position.y = H / 2; g.add(body);
      for (let f = 0; f < FL; f++) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 1.5, D + 0.14), sharedMats.window);
        band.position.y = f * FH + FH * 0.62; g.add(band);
      }
      const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.7, D + 1), mat(0xb8b2a2)); roof.position.y = H + 0.35; g.add(roof);
      if (signTxt) {
        const st = makeTex(512, 84, (gc, w2, h2) => {
          gc.fillStyle = signBg || '#b91c1c'; gc.fillRect(0, 0, w2, h2);
          gc.fillStyle = '#fff'; gc.font = 'bold 50px system-ui, sans-serif';
          gc.textAlign = 'center'; gc.textBaseline = 'middle'; gc.fillText(signTxt, w2 / 2, h2 / 2 + 2, w2 - 26);
        });
        const sp = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(W * 0.9, 14), 1.6), new THREE.MeshLambertMaterial({ map: st }));
        sp.position.set(0, H - 1.4, D / 2 + 0.1); g.add(sp);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      g.name = name; scene.add(g);
      addCollider(x, z, Math.max(W, D) * 0.52);
      FEATURED_CLEAR.push([x, z, Math.max(W, D) / 2 + 10]);
      return g;
    };
    // Solis Hotel (pano_018 h180): 5 tầng kính xanh-trắng, W~15
    { const g = bandTower(424.5, -815.4, 15, 13, 5, 3.3, 0xeef2f4, 'solis_hotel', 'SOLIS HOTEL', '#b91c1c');
      if (g) g.rotation.y = ang + Math.PI / 2; }
    // Trung tâm Hội nghị TP (pano_020 h0): 3 tầng vàng kem mái xanh W~70 + đài phun tròn trước sân
    {
      const cx0 = 284.2, cz0 = -831.8;
      if (Math.abs(groundHeightNoDeck(cx0, cz0) - LAND_H) < 0.4) {
        const g = new THREE.Group(); g.position.set(cx0, LAND_H, cz0); g.rotation.y = ang - Math.PI / 2;
        const W = 66, D = 18, H = 11.5;
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), grandFacadeReady()); body.position.y = H / 2; g.add(body);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 2, 1.1, D + 2), mat(0x2e6e56)); roof.position.y = H + 0.55; g.add(roof);
        for (let c = -4; c <= 4; c++) { const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 4.4, 10), mat(0xf6f1e0)); col.position.set(c * 6.2, 2.2, D / 2 + 0.6); g.add(col); }
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'tt_hoinghi'; scene.add(g);
        for (const lx of [-24, 0, 24]) { const [ccx, ccz] = localPt(cx0, cz0, lx, 0, ang - Math.PI / 2); addCollider(ccx, ccz, 11); }
        FEATURED_CLEAR.push([cx0, cz0, 44]);
        // đài phun tròn trước sân (phía đường)
        const fx = cx0 - HD_N[0] * 24, fz = cz0 - HD_N[1] * 24;
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.6, 0.8, 16), mat(0xdcd6c4));
        pool.position.set(fx, LAND_H + 0.4, fz); scene.add(pool);
        const wat = new THREE.Mesh(new THREE.CylinderGeometry(4.0, 4.0, 0.7, 16), new THREE.MeshLambertMaterial({ color: 0x5ec8e8, transparent: true, opacity: 0.85 }));
        wat.position.set(fx, LAND_H + 0.52, fz); scene.add(wat);
        addCollider(fx, fz, 4.9);
      }
    }
    // Biệt thự Vietcombank (pano_020 h180): 2 tầng + trụ cổng + rào sắt
    { const g = bandTower(300.5, -783.5, 16, 12, 2, 3.6, 0xf2ead2, 'vcb_villa', 'VIETCOMBANK', '#0f6a38');
      if (g) g.rotation.y = ang - Math.PI / 2; }
    // Nút giao Minh Khai–Trần Phú (pano_021): tháp EximBank 12 tầng + cao ốc kính 15 tầng
    { const g = bandTower(391.9, -40.3, 17, 15, 12, 3.3, 0xdfe4e8, 'eximbank_tower', 'EXIMBANK', '#1c56a0'); if (g) g.rotation.y = 0; }
    { const g = bandTower(428.2, -61.4, 26, 18, 15, 3.3, 0xc9d4dc, 'caooc_minhkhai', null, null); if (g) g.rotation.y = 0.2; }
  }
  // texture mặt tiền TT Hội nghị (vàng kem cửa vòm) — helper nhỏ dùng 1 lần
  function grandFacadeReady() {
    const { map, emissiveMap } = grandFacadeTextures('#ead9a8', '#f6f1e0', { cols: 9, arch: true });
    return new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: 0xffcc77, emissiveIntensity: 0 });
  }

  // ---------- Ô TÔ ĐỖ dọc phố (thực tế ô tô đỗ kín 2 bên cả phố lớn lẫn phố vừa khu Ga) ----------
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
    // PANO-LOOP: khu Ga (pano_022/023) thật KÍN ô tô đỗ 2 bên phố s/t nhưng game chỉ rải phố 'p'
    // → phủ cả 'p'/'s'/'t'; cap 200→520 (trần cạn theo thứ tự ROADS_DT là bài học cũ);
    // phố 's'/'t' hẹp hơn nên thưa hơn phố 'p' một chút (bước 5.5→7)
    const CAR_CAP = 520;
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      const r = ROADS_DT[ri]; if (r.c !== 'p' && r.c !== 's' && r.c !== 't') continue;
      const wRoad = ROAD_W[r.c];
      const step = r.c === 'p' ? 5.5 : 7;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 12) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const px = Math.cos(rotY), pz = -Math.sin(rotY);
        for (let d = 6; d < segLen - 6; d += step) {
          if (cr() > 0.5) continue;
          const mx = x1 + dxn * d, mz = z1 + dzn * d;
          if (mx * mx + mz * mz > 1350 * 1350) continue;
          const side = cr() < 0.5 ? 1 : -1;
          const off = side * (wRoad / 2 + 1.3);
          const gx = mx + off * px, gz = mz + off * pz;
          const gy = groundHeight(gx, gz); if (gy < LAND_H - 0.5 || isWater(gx, gz)) continue;
          if (lakeSD(gx, gz) < 20 || nearFeatured(gx, gz)) continue;   // không đỗ trên promenade/sân công trình
          slots.push([gx, gy, gz, rotY + (cr() - 0.5) * 0.12, (cr() * carCols.length) | 0]);
          if (slots.length >= CAR_CAP) break;
        }
        if (slots.length >= CAR_CAP) break;
      }
      if (slots.length >= CAR_CAP) break;
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
  // (FEATURED_CLEAR/nearFeatured khai báo Ở TRÊN, trước khối ô tô đỗ)
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

    // (1) KHÁCH SẠN HỮU NGHỊ — tháp 12 tầng, khối ban công hộp nhô ra đặc trưng
    // pano_158 [257,-452] thấy tháp ở h000 (BẮC) — tọa độ pano là TIM ĐƯỜNG Điện Biên Phủ,
    // đặt tại đó camera pano chui VÀO trong tháp → dời 33m về bắc (phía vỉa hè + sân khách sạn)
    {
      const hx = 257.5, hz = -484.9, gy = groundHeight(hx, hz);
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

    // (2) TÒA HOÀNG LONG — tân cổ điển mạ vàng, hàng cột + đầu hồi + cặp sư tử
    // pano_354 [10,-269] thấy tòa ở h270 (TÂY, catalog audit) — tọa độ pano là tim đường
    // Trần Quang Khải (chạy Đ-T) → tòa ở GÓC NAM ngã ba, lệch tây ~22m + nam khỏi lòng đường
    // (đặt thẳng trục tây từng CHẶN NGANG đường — render kiểm chứng)
    {
      const bx = -11.8, bz = -256.6, gy = groundHeight(bx, bz);
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

    // (3) NHÀ PHÁP 2 TẦNG HÀNH LANG CUỐN VÒM — Hội LH Phụ nữ HP (pano_358 thấy ở h000 BẮC,
    // thật rộng ~45m, LÙI SAU HÀNG RÀO + SÂN). Tọa độ pano là tim đường Trần Quang Khải
    // → dời 27m về bắc (17m từng làm mặt tiền dí sát camera — render kiểm chứng).
    {
      const bx = 237, bz = -292, gy = groundHeight(bx, bz);
      if (gy > LAND_H - 0.5 && !isWater(bx, bz)) {
        // mặt vòm quay NAM (+z) ra Trần Quang Khải — faceRoad từng bắt nhầm phố phía đông gần hơn
        const grp = new THREE.Group(); grp.position.set(bx, gy, bz); grp.rotation.y = 0;
        const W = 28, D = 11, H = 8.4;
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), facadeTex('#e4c96f', '#7a5a20', 7, 2)); body.position.set(0, H / 2, 0); grp.add(body);
        // hành lang cuốn vòm tầng trệt: các cột + vòm bán nguyệt
        const archG = [];
        for (let c = -2; c <= 2; c++) { const pil = new THREE.BoxGeometry(0.7, 4.2, 0.7); pil.translate(c * 5.0, 2.1, D / 2 + 0.4); archG.push(pil);
          const arc = new THREE.TorusGeometry(1.6, 0.28, 6, 14, Math.PI); arc.rotateY(0); arc.translate(c * 5.0 + 2.5, 4.2, D / 2 + 0.4); archG.push(arc); }
        grp.add(new THREE.Mesh(mergeGeometries(archG), mat(0xefe6cf))); archG.forEach((g) => g.dispose());
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.8, D + 1.4), mat(0x7a3b2a)); roof.position.set(0, H + 0.4, 0); grp.add(roof);
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; }); grp.name = 'nha_phap_arcade'; scene.add(grp);
        addCollider(bx, bz, Math.max(W, D) / 2 + 1);
      }
    }

    // (4) KHÁCH SẠN HARBOUR VIEW (pano_042 h40 — tân thuộc địa 5 tầng kem trắng, dài ~70m
    // dọc Trần Phú, vòm tầng trệt + sảnh porte-cochère). Trước đây chỉ là hộp beige trống.
    {
      // PLAN corridor4056 V3: dời tâm về (773.9,-732) — khối cũ trải quá về nam,
      // chắn trục nhìn h180 của pano_042; mép nam giờ dừng ~z=-699
      const bx = 773.9, bz = -732, gy = groundHeight(bx, bz);
      if (gy > LAND_H - 0.5 && !isWater(bx, bz)) {
        const grp = new THREE.Group(); grp.position.set(bx, gy, bz); grp.rotation.y = faceRoad(bx, bz);
        const W = 66, D = 18, FL = 5, FH = 3.5, H = FL * FH;
        const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), facadeTex('#f1ead7', '#4a6a55', 12, 5)); body.position.set(0, H / 2, 0); grp.add(body);
        // dải vòm/cột trắng tầng trệt
        const archG = [];
        for (let c = -6; c <= 6; c++) { const pil = new THREE.BoxGeometry(0.8, 4.0, 0.8); pil.translate(c * 4.9, 2.0, D / 2 + 0.45); archG.push(pil); }
        const band = new THREE.BoxGeometry(W, 0.7, 1.4); band.translate(0, 4.15, D / 2 + 0.2); archG.push(band);
        grp.add(new THREE.Mesh(mergeGeometries(archG), mat(0xfdf8ec))); archG.forEach((g) => g.dispose());
        // sảnh porte-cochère giữa mặt tiền
        const porch = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 6), mat(0xf7f2e2)); porch.position.set(0, 4.1, D / 2 + 3.4); grp.add(porch);
        for (const sx of [-4, 4]) for (const sz of [D / 2 + 1.2, D / 2 + 5.4]) {
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 3.9, 10), mat(0xfdf8ec)); col.position.set(sx, 1.95, sz); grp.add(col);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 0.9, D + 1.6), mat(0xc9bfa4)); roof.position.set(0, H + 0.45, 0); grp.add(roof);
        // biển "HARBOUR VIEW" gắn LÊN mặt tiền (ảnh 041/042: chữ trên thân nhà, không phải tấm rời)
        const hvTex = makeTex(512, 72, (gc, w2, h2) => { gc.fillStyle = '#f1ead7'; gc.fillRect(0, 0, w2, h2); gc.fillStyle = '#3a5a4a'; gc.font = 'bold 46px Georgia, serif'; gc.textAlign = 'center'; gc.textBaseline = 'middle'; gc.fillText('HARBOUR VIEW', w2 / 2, h2 / 2 + 2); });
        const hvSign = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), new THREE.MeshLambertMaterial({ map: hvTex }));
        hvSign.position.set(0, H - 1.6, D / 2 + 0.08); grp.add(hvSign);
        grp.traverse((o) => { if (o.isMesh) o.castShadow = true; }); grp.name = 'ks_harbourview'; scene.add(grp);
        // collider 3 vòng dọc trục dài (1 vòng lớn sẽ trùm cả lòng đường)
        const ryHV = grp.rotation.y;
        for (const lx of [-22, 0, 22]) { const [ccx, ccz] = localPt(bx, bz, lx, 0, ryHV); addCollider(ccx, ccz, 12); }
      }
    }
  }

  // ---------- CÔNG TRÌNH ĐÍCH DANH LÔ 2 (agent lm_drafts — 12 khối, 19 công trình có tên) ----------
  {
// ============================================================================
// NHÁP 12 KHỐI CÔNG TRÌNH ĐÍCH DANH CÒN THIẾU (cụm lỗi 'landmark' severity 3,
// gom từ compare_v6_sol56 + compare_v7_sol56, đối chiếu audit_done.json).
//
// VỊ TRÍ DÁN ĐỀ XUẤT: js/world.js, CUỐI khối "CÔNG TRÌNH ĐẶC TRƯNG dải trung tâm"
// (sau block (4) Harbour View, ~line 1725) — tức là SAU khai báo FEATURED_CLEAR
// (line 1369) và TRƯỚC khối OSM "1.200+ TÒA NHÀ THẬT" (line 1777) + khối shophouse
// liền kề, để FEATURED_CLEAR.push() ở đây có tác dụng đuổi nhà OSM/infill
// (world.js:1876 `if (nearFeatured(cx, cz)) continue;`).
//
// Mọi tọa độ đã DỜI KHỎI TIM ĐƯỜNG: chiếu pano lên đoạn p/s/t gần nhất trong
// ROADS_DT, đẩy theo pháp tuyến cùng phía heading fix một đoạn
// (nửa_lòng + 2.3 vỉa hè + D/2 [+ sân]), có dịch DỌC PHỐ khi cần để bearing
// từ pano khớp bucket heading của giám khảo (script tính: scratchpad/lm_drafts/place2.mjs).
// Giả định trong scope buildWorld: THREE, mat, makeTex, sharedMats, addCollider,
// FEATURED_CLEAR, groundHeight, groundHeightNoDeck, isWater, LAND_H, localPt,
// mergeGeometries, scene.
// ============================================================================

// === HELPER CHUNG (dán 1 LẦN trước các block dưới) ===
const lmSign = (txt, bg, fg = '#ffffff', px = 50) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 26);
  }),
});
const lmFacade = (baseCss, winCss, cols, rows) => {           // như facadeTex world.js:1612
  const t = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.16, my + r * ch + ch * 0.16, cw * 0.68, ch * 0.66);
    }
  });
  return new THREE.MeshLambertMaterial({ map: t });
};
const lmOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - LAND_H) < 0.4 && !isWater(x, z);
// tháp dải cửa sổ theo mẫu bandTower (world.js:1495) nhưng nhận ry + material thân
const lmTower = (x, z, ry, W, D, FL, FH, wallMat, name) => {
  if (!lmOK(x, z)) return null;
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry;
  const H = FL * FH;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat); body.position.y = H / 2; g.add(body);
  for (let f = 0; f < FL; f++) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.14, 1.5, D + 0.14), sharedMats.window);
    band.position.y = f * FH + FH * 0.62; g.add(band);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.7, D + 1), mat(0xb8b2a2)); roof.position.y = H + 0.35; g.add(roof);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.name = name; scene.add(g);
  addCollider(x, z, Math.max(W, D) * 0.52);
  FEATURED_CLEAR.push([x, z, Math.max(W, D) / 2 + 10]);
  return g;
};

// === (1) SKYLINE SAU CÔNG VIÊN TRẦN PHÚ: tháp kính xanh 18T + office xám 12T
//     + công sở kem 6T (pano_040/041/042/043 h270 — 7 fix sev3, score 2.3-3.8;
//     audit_041: "18T kính xanh đậm phản quang h220, W~45" + "12T xám h250, W~40";
//     audit_040: "6T vàng kem h200-277, W~40". Đặt cách Trần Phú 140-170m về TÂY,
//     bearing kiểm chứng: tháp H040=225/H041=236/H042=249; office H041=250/H042=263;
//     công sở H040=276 — đều rơi bucket h270 của fix) ===
{
  // tháp kính xanh 18 tầng (đậm, phản quang) — mặt về ĐÔNG ra Trần Phú
  const g1 = lmTower(620, -640, Math.PI / 2, 35, 28, 18, 3.2, mat(0x1d4d66), 'skyline_thapkinh18');
  if (g1) { // crown kính nhạt trên đỉnh
    const crown = new THREE.Mesh(new THREE.BoxGeometry(26, 2.4, 20), sharedMats.window);
    crown.position.y = 18 * 3.2 + 1.9; crown.castShadow = true; g1.add(crown);
  }
  // office xám 12 tầng phía nam tháp
  lmTower(598, -676, Math.PI / 2, 32, 22, 12, 3.2, mat(0x8f959b), 'skyline_officexam12');
  // công sở vàng kem 6 tầng (khối dài, cửa sổ đều) gần đầu phố (pano_040)
  const bx = 616, bz = -790;
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = Math.PI / 2;
    const W = 38, D = 16, H = 6 * 3.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#ead9a8', '#5a6a70', 10, 6));
    body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.8, D + 1.2), mat(0xb8b2a2)); roof.position.y = H + 0.4; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'skyline_congso6'; scene.add(g);
    for (const lx of [-12, 12]) { const [cx, cz] = localPt(bx, bz, lx, 0, Math.PI / 2); addCollider(cx, cz, 10); }
    FEATURED_CLEAR.push([bx, bz, W / 2 + 10]);
  }
}

// === (2) HP BBQ / LẨU & ẨM THỰC THÁI + billboard "ĐẠI DƯƠNG - HP SEAFOOD"
//     (góc TÂY-NAM nút Điện Biên Phủ × Đinh Tiên Hoàng; pano_046 h180 v6+v7 +
//     pano_047 h270 v6+v7 = 4 fix sev3, score 2.3-3.1. Audit_046 h225: "2T đỏ đô
//     W~15, biển HP BBQ + Lẩu Thái + billboard Đại Dương HP Seafood trên mái";
//     audit_047 h315: "2T W12 đỏ-cam, biển buffet lớn". Tam giác đạc 2 pano ≈ (32,-436);
//     đặt (35,-441): H046=229 (bucket 180 sát biên) / H047=328) ===
{
  const bx = 35, bz = -441;                     // TÂY ĐTH 16m, NAM ĐBP 18m khỏi tim nút (53,-459)
  if (lmOK(bx, bz)) {
    const ry = 1.466;                           // mặt tiền quay ĐÔNG ra Đinh Tiên Hoàng
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 14, D = 12, H = 6.8;              // 2 tầng đỏ đô
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0x8e1f24)); body.position.y = H / 2; g.add(body);
    // kính tầng trệt + dải biển đỏ-cam phủ mặt tiền tầng 2
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 2.6, 0.12), sharedMats.window);
    glass.position.set(0, 1.5, D / 2 + 0.05); g.add(glass);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, 1.7), lmSign('HP BBQ — BUFFET LẨU NƯỚNG', '#c2410c', '#ffe9b0'));
    s1.position.set(0, H - 1.1, D / 2 + 0.08); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 1.1), lmSign('LẨU & ẨM THỰC THÁI', '#8e1f24', '#ffd21a', 44));
    s2.position.set(0, 3.6, D / 2 + 0.08); g.add(s2);
    // billboard trên mái (đích danh fix v6 pano_046: "billboard Đại Dương trên mái")
    const bbPan = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), lmSign('ĐẠI DƯƠNG — HP SEAFOOD', '#0e5a8a'));
    bbPan.position.set(0, H + 2.6, 1); g.add(bbPan);
    for (const sx of [-3.4, 3.4]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 2.8, 6), mat(0x8a8f92));
      post.position.set(sx, H + 1.3, 1); g.add(post);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'hp_bbq'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 9]);
  }
}

// === (3) BIDV chi nhánh Hải Phòng — góc TÂY-BẮC nút ĐBP × ĐTH
//     (pano_046 h0 v6 + h270 v7 = 2 fix sev3; audit_046 h315: "5T W~20 đỏ gạch
//     phối kem, biển BIDV xanh". Đặt (34.6,-477.7): H046=319 ≈ h315 audit,
//     mặt quay về góc nút giao) ===
{
  const bx = 34.6, bz = -477.7;
  if (lmOK(bx, bz)) {
    const ry = 0.777;                           // mặt quay ĐÔNG-NAM về tim nút (53,-459)
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 20, D = 14, FL = 5, FH = 3.4, H = FL * FH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#9e3b30', '#f3e9d8', 6, 5));
    body.position.y = H / 2; g.add(body);
    // băng kem ngang giữa các tầng (đỏ gạch PHỐI kem theo audit)
    for (const fy of [FH, FH * 3]) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(W + 0.16, 0.55, D + 0.16), mat(0xf3e9d8));
      belt.position.y = fy; g.add(belt);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.7, D + 1), mat(0xb8b2a2)); roof.position.y = H + 0.35; g.add(roof);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.6), lmSign('BIDV', '#0b6e4f'));
    s.position.set(0, H - 1.3, D / 2 + 0.1); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'bidv_dbp'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 10]);
  }
}

// === (4) TRUNG TÂM VĂN HÓA TP (Sở VH&TT) — 18 Đinh Tiên Hoàng, phía TÂY phố
//     (pano_047 h270 v6 + h180 v7 = 2 fix sev3; audit_047 h180: "2T W15 vàng kem cũ,
//     biển xanh Sở Văn hóa và Thể thao + áp phích". Đặt (31.6,-401.9) = 15.3m tây tim
//     ĐTH + 20m nam pano, sân trước 3m; H047=222) ===
{
  const bx = 31.6, bz = -401.9;
  if (lmOK(bx, bz)) {
    const ry = 1.466;                           // mặt quay ĐÔNG ra Đinh Tiên Hoàng
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 15, D = 10, H = 7.2;              // 2 tầng công sở cũ
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#e6d29a', '#6b5a33', 5, 2));
    body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.7, D + 1.2), mat(0x8a6a4a)); roof.position.y = H + 0.35; g.add(roof);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 1.3), lmSign('SỞ VH&TT — TT VĂN HÓA TP HẢI PHÒNG', '#1c56a0', '#ffffff', 38));
    s.position.set(0, H - 0.9, D / 2 + 0.08); g.add(s);
    // áp phích tuyển sinh trước sân + 2 trụ cổng
    const ap = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.6), lmSign('TUYỂN SINH LỚP QUỐC TẾ VŨ', '#f3e9d8', '#1c56a0', 34));
    ap.position.set(-4, 1.6, D / 2 + 2.6); g.add(ap);
    for (const sx of [-5.5, 5.5]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.7), mat(0xd9d0bd));
      post.position.set(sx, 1.1, D / 2 + 3.0); g.add(post);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'tt_vanhoa'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 9]);
  }
}

// === (5) VICTORY BUILDING (đế MSB đỏ) — Nguyễn Đức Cảnh ven hồ Tam Bạc
//     (pano_026 h180 v6 + h90 v7 = 2 fix sev3; audit_026 h90: "10T kính xanh W22,
//     biển MSB đỏ lớn, sảnh ngân hàng". Đặt (-892.7,357.9): mặt nam NĐC, dịch 33m
//     đông theo phố để bearing từ pano = 101 ≈ h90; sát vỉa hè theo fix v6) ===
{
  const bx = -892.7, bz = 357.9, ry = -2.937;   // mặt quay BẮC ra NĐC/hồ
  const g = lmTower(bx, bz, ry, 22, 14, 10, 3.1, mat(0x2f5266), 'victory_building');
  if (g) {
    const H = 10 * 3.1;
    // đế sảnh MSB kính 1 tầng nhô ra
    const pod = new THREE.Mesh(new THREE.BoxGeometry(22, 4.2, 3), sharedMats.window);
    pod.position.set(0, 2.1, 14 / 2 + 1.4); g.add(pod);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), lmSign('MSB', '#d51f2e'));
    s1.position.set(0, 4.6, 14 / 2 + 3); g.add(s1);
    // biển đỏ MSB trên nóc (đặc trưng nhìn từ xa ven hồ)
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.8), lmSign('MSB • VICTORY BUILDING', '#d51f2e', '#ffffff', 40));
    s2.position.set(0, H + 1.4, 14 / 2 - 1); g.add(s2);
  }
}

// === (6) THÁP HD BANK (kính xanh-đen) + NORTH HOTEL nền sau — NĐC số 96
//     (HD Bank: pano_027 h90 v6+v7 = 2 fix sev3, audit: "9T W20 kính xanh-đen,
//     biển HD Bank đỏ, sát vỉa hè". Đặt (-861.1,350.8): dịch 25m đông để H=106 ≈ h90.
//     North Hotel: pano_027 h180 v7 = 1 fix, audit h180: "10T trắng W15 phía xa,
//     ban công + biển dọc". Đặt (-885,378) sau lưng dãy phố, H=175) ===
{
  // HD Bank
  const g = lmTower(-861.1, 350.8, -2.937, 20, 13, 9, 3.1, mat(0x1f2e38), 'hdbank_tower');
  if (g) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.5), lmSign('HD BANK', '#d51f2e'));
    s.position.set(0, 4.4, 13 / 2 + 0.12); g.add(s);
  }
  // North Hotel (khối trắng cao nền phía sau, biển DỌC)
  const g2 = lmTower(-885, 378, -2.937, 15, 12, 10, 3.0, mat(0xf4f2ec), 'north_hotel');
  if (g2) {
    const sv = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 9), new THREE.MeshLambertMaterial({
      map: makeTex(64, 512, (gc, w, h) => {
        gc.fillStyle = '#1c3f6e'; gc.fillRect(0, 0, w, h);
        gc.fillStyle = '#fff'; gc.font = 'bold 40px system-ui, sans-serif'; gc.textAlign = 'center';
        gc.save(); gc.translate(w / 2, h / 2); gc.rotate(Math.PI / 2); gc.fillText('NORTH HOTEL', 0, 12); gc.restore();
      }),
    }));
    sv.position.set(15 / 2 - 0.7, 15, 12 / 2 + 0.1); g2.add(sv);
  }
}

// === (7) TÒA TRUNG TÂM Y TẾ "THIẾT BỊ Y TẾ" (ốp bạc đục lỗ) — NĐC 118
//     (pano_025 h90 v6+v7 = 2 fix sev3; audit_025 h90: "7T W~45 ốp kim loại đục lỗ
//     + kính, đế kính 2T, biển THIẾT BỊ Y TẾ đỏ". Đặt (-979.8,381.7): dịch 26m đông
//     tránh ngõ 'r' chạy sát mép tây (ROADS_DT r (-1007,367)→(-958,643)); H=118 ≈ h90.
//     Ở đây có footprint OSM thấp — FEATURED_CLEAR đuổi nó (world.js:1876)) ===
{
  const bx = -979.8, bz = 381.7, ry = -3.044;   // mặt quay BẮC ra NĐC
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 45, DP = 20, DT = 16;
    // đế kính 2 tầng (audit h135: "khối đế kính, bồn cây cắt tỉa")
    const pod = new THREE.Mesh(new THREE.BoxGeometry(W, 7.4, DP), sharedMats.window);
    pod.position.y = 3.7; g.add(pod);
    const podTrim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.5, DP + 0.6), mat(0x9aa0a6));
    podTrim.position.y = 7.6; g.add(podTrim);
    // tháp 5 tầng trên, ốp bạc ĐỤC LỖ (texture chấm lỗ tròn trên nền bạc)
    const perfoTex = makeTex(256, 256, (gc, w, h) => {
      gc.fillStyle = '#c3c8cd'; gc.fillRect(0, 0, w, h);
      gc.fillStyle = '#7d838a';
      for (let yy = 8; yy < h; yy += 16) for (let xx = 8 + (yy % 32 ? 8 : 0); xx < w; xx += 16) {
        gc.beginPath(); gc.arc(xx, yy, 3.4, 0, Math.PI * 2); gc.fill();
      }
    });
    perfoTex.wrapS = perfoTex.wrapT = THREE.RepeatWrapping; perfoTex.repeat.set(6, 3);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(W, 16.5, DT), new THREE.MeshLambertMaterial({ map: perfoTex }));
    tower.position.set(0, 7.9 + 16.5 / 2, -1.5); g.add(tower);
    // dải kính đứng giữa mặt tiền tháp
    const strip = new THREE.Mesh(new THREE.BoxGeometry(10, 16.5, 0.3), sharedMats.window);
    strip.position.set(0, 7.9 + 16.5 / 2, -1.5 + DT / 2 + 0.1); g.add(strip);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.5), lmSign('THIẾT BỊ Y TẾ', '#c1201a'));
    s.position.set(0, 6.4, DP / 2 + 0.1); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'toa_yte_ndc'; scene.add(g);
    for (const lx of [-16, 0, 16]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 11); }
    FEATURED_CLEAR.push([bx, bz, W / 2 + 10]);
  }
}

// === (8) VPBANK QUANG TRUNG (~số 185, bờ BẮC hồ Tam Bạc) — pano_012 h0 v6+v7
//     = 2 fix sev3; audit_012 h0: "5T W8: tầng trệt xanh lá VPBank + ATM, tầng trên
//     cam-đỏ kính". Đặt (-959.4,253.8): 12.3m bắc tim Quang Trung, H=349 ≈ h0.
//     Kèm khối cam-đỏ 5T 'Âu Tư Lộc Phong' kề đông (audit h45) ===
{
  const bx = -959.4, bz = 253.8, ry = 0.198;    // mặt quay NAM ra Quang Trung/hồ
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 8, D = 10, FL = 5, FH = 3.2, H = FL * FH;
    // tầng trên cam-đỏ + kính
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H - 3.4, D), lmFacade('#c95b35', '#3f5a6b', 2, 4));
    body.position.y = 3.4 + (H - 3.4) / 2; g.add(body);
    // tầng trệt xanh lá VPBank
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, 3.4, D), mat(0x0e8a45)); base.position.y = 1.7; g.add(base);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, 1.3), lmSign('VPBank', '#0e8a45'));
    s.position.set(0, 2.7, D / 2 + 0.08); g.add(s);
    // booth ATM kính cạnh cửa
    const atm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.2), sharedMats.window);
    atm.position.set(W / 2 + 1, 1.2, D / 2 - 0.4); g.add(atm);
    // khối cam-đỏ 5T kề đông (VP đại diện Âu Tư Lộc Phong — audit h45)
    const nb = new THREE.Mesh(new THREE.BoxGeometry(7, H, D - 1), lmFacade('#b0402a', '#4a5a66', 2, 5));
    nb.position.set(-(W / 2 + 3.5), H / 2, -0.5); g.add(nb);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'vpbank_quangtrung'; scene.add(g);
    addCollider(bx, bz, 9);
    FEATURED_CLEAR.push([bx, bz, 17]);
  }
}

// === (9) VIETABANK trắng 5T mặt vòm — NĐC ~số 50 (pano_034 h90 v6+v7 = 2 fix sev3
//     "đặt đúng PHÍA NHÀ"; audit_034: "5T W10 trắng, mặt tiền vòm cổ điển, ban công
//     lan can, biển NÓC VIETABANK". Đặt (-437.4,261.2): phía nam NĐC (phía nhà, không
//     phải phía hồ), dịch 20m đông; H=105 ≈ h90) ===
{
  const bx = -437.4, bz = 261.2, ry = -2.937;   // mặt quay BẮC ra NĐC
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 10, D = 10, FL = 5, FH = 3.3, H = FL * FH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#f2f0ea', '#7d838a', 3, 5));
    body.position.y = H / 2; g.add(body);
    // vòm cổ điển tầng trệt (cột + cuốn vòm — mẫu arcade world.js:1692)
    const archG = [];
    for (let c = -1; c <= 1; c++) {
      const pil = new THREE.BoxGeometry(0.5, 3.6, 0.5); pil.translate(c * 3.2, 1.8, D / 2 + 0.3); archG.push(pil);
      if (c < 1) { const arc = new THREE.TorusGeometry(1.25, 0.2, 6, 12, Math.PI); arc.translate(c * 3.2 + 1.6, 3.6, D / 2 + 0.3); archG.push(arc); }
    }
    // dải ban công mảnh mỗi tầng
    for (let f = 1; f < FL; f++) { const bal = new THREE.BoxGeometry(W * 0.86, 0.5, 0.5); bal.translate(0, f * FH + 0.55, D / 2 + 0.3); archG.push(bal); }
    g.add(new THREE.Mesh(mergeGeometries(archG), mat(0xfdf8ec))); archG.forEach((gg) => gg.dispose());
    // biển NÓC trên khung trụ
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.4), lmSign('VIETABANK', '#12409e'));
    s.position.set(0, H + 1.3, 0); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'vietabank_ndc'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 9]);
  }
}

// === (10) CỤM SHOPHOUSE ĐÍCH DANH NĐC 69-116 + LONG CHÂU 70
//     (pano_032: 3 fix sev3 v6+v7 "chuỗi Đông Mận 4T → Nhà thuốc 69 kính cong 3T →
//     Long Châu 116 4T" h180 + "Noah's trắng 2T, May10 xanh 2T đúng góc phố" h270;
//     pano_031: 2 fix sev3 "Long Châu 70 khối xanh 4T phía dãy nhà, xóa biển phía hồ" h90.
//     Bờ NAM NĐC quanh giao lộ phố 't' (-587,281); bearing khớp audit:
//     May10 176 / Noah's 143 / LC116 113 / NT69 104 / ĐM 99 / LC70(từ 031) 120) ===
{
  const ry = -2.937;                            // cả dãy mặt quay BẮC ra NĐC/hồ
  const ROW = [
    // [tên biển, bx, bz, W, FL, màu tường, nền biển, chữ]
    ['MAY10', -575.2, 291.1, 5, 2, 0x2a6db5, '#1c56a0', '#ffffff'],
    ["NOAH'S", -567.9, 289.6, 10, 2, 0xf4f2ec, '#22252a', '#ffffff'],
    ['NHÀ THUỐC LONG CHÂU 116', -559.5, 287.9, 7, 4, 0x1553a0, '#1050c8', '#ffffff'],
    ['NHÀ THUỐC 69', -553.2, 286.6, 6, 3, 0x8f959b, '#c1201a', '#ffffff'],
    ['ĐÔNG MẬN — TRÁI CÂY NHẬP KHẨU', -547.3, 285.3, 6, 4, 0xe8c85a, '#d97706', '#ffffff'],
    ['NHÀ THUỐC LONG CHÂU 70', -596.2, 295.4, 6, 4, 0x1553a0, '#1050c8', '#ffffff'], // tây giao lộ (pano_031)
  ];
  for (const [txt, bx, bz, W, FL, wall, bg, fg] of ROW) {
    if (!lmOK(bx, bz)) continue;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const FH = 3.3, H = FL * FH, D = 10;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(wall)); body.position.y = H / 2; g.add(body);
    for (let f = 0; f < FL; f++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 1.4, 0.12), sharedMats.window);
      win.position.set(0, f * FH + FH * 0.62, D / 2 + 0.05); g.add(win);
    }
    // NHÀ THUỐC 69: mặt cong kính nhô (audit "mặt tiền bo cong lắp kính")
    if (txt === 'NHÀ THUỐC 69') {
      const curve = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.45, W * 0.45, H - 3.3, 14, 1, false, -Math.PI / 2, Math.PI), sharedMats.window);
      curve.scale.z = 0.45; curve.position.set(0, 3.3 + (H - 3.3) / 2, D / 2); g.add(curve);
    }
    const s = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(W * 0.94, 4.6), 1.1), lmSign(txt, bg, fg, 40));
    s.position.set(0, 3.5, D / 2 + (txt === 'NHÀ THUỐC 69' ? W * 0.45 * 0.45 + 0.15 : 0.1)); g.add(s);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.4, D + 0.4), mat(0xb8b2a2)); roof.position.y = H + 0.2; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'ndc_shop_' + txt.slice(0, 8); scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.5);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 7]);
  }
}

// === (11) NHÀ HÀNG MẶT BO CONG + KHỐI VIETABANK — nút Hoàng Diệu × Trần Hưng Đạo
//     (pano_014 h0 v6+v7 = 2 fix sev3, score 2.4-2.8; audit_014 h0: "2T W20 kem-vàng,
//     mặt tiền BO TRÒN kính, biển NHÀ HÀNG; ngân hàng VIETABANK". Nhà hàng góc TÂY-BẮC
//     nút (tim nút 657,-880), VietABank góc ĐÔNG-BẮC.
//     ⚠ NHÀ HÀNG NẰM TRONG clearedZone Hoàng Diệu (along 332, across 19 — world.js:1395):
//     cần thêm carve-out vào clearedZone như đã làm cho Cảng vụ:
//       if ((x - 636.5) ** 2 + (z + 894.7) ** 2 < 20 * 20) return false; ) ===
{
  // nhà hàng bo cong (góc TB nút, mặt quay ĐN về tim nút)
  const bx = 636.5, bz = -894.7, ry = 0.949;
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 20, D = 14, H = 7.2;              // 2 tầng kem-vàng
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#efe6cf', '#4a6a55', 6, 2));
    body.position.y = H / 2; g.add(body);
    // GÓC BO CONG kính hướng nút giao (trụ tròn 2 tầng + dải kính)
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, H, 18), mat(0xefe6cf));
    drum.position.set(W / 2 - 2, H / 2, D / 2 - 2); g.add(drum);
    for (const fy of [1.9, 5.3]) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(5.08, 5.08, 1.5, 18), sharedMats.window);
      ring.position.set(W / 2 - 2, fy, D / 2 - 2); g.add(ring);
    }
    // mảng xanh nước biển trên mặt tiền (audit "mảng xanh nước biển")
    const teal = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 0.14), mat(0x1c6e8a));
    teal.position.set(-4, H - 1.2, D / 2 + 0.05); g.add(teal);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.3), lmSign('NHÀ HÀNG', '#efe6cf', '#8a1c14'));
    s.position.set(W / 2 - 2, H - 1.2, D / 2 + 3.1); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'nhahang_bocong_hd'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 9]);
  }
  // khối VIETABANK 5T trắng (góc ĐB nút — audit LM "Ngân hàng VIETABANK")
  const g2 = lmTower(666.9, -897.1, -0.525, 12, 12, 5, 3.3, mat(0xf2f0ea), 'vietabank_hoangdieu');
  if (g2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), lmSign('VIETABANK', '#12409e'));
    s.position.set(0, 5 * 3.3 - 1.2, 12 / 2 + 0.12); g2.add(s);
  }
}

// === (12) VPBANK PHẠM NGŨ LÃO + TT ĐIỆN MÁY DUNG HƯNG (CHIGO/SPELIER)
//     (pano_024: VPBank h0 v6+v7 + Dung Hưng h180 v6+v7 = 4 fix sev3, score 3.6-3.9;
//     audit_024: VPBank "5T W15 kính, xanh lá, ATM, biển lớn" h0; Dung Hưng "4T W12 đỏ,
//     biển CHIGO/SPELIER/TRUNG TÂM ĐIỆN MÁY DUNG HƯNG ĐC 10-12-14 PNL" h270.
//     Phố Phạm Ngũ Lão chạy chéo ĐB (u≈(0.639,0.770), lớp 't'): VPBank bờ ĐÔNG-BẮC
//     (515.7,63.0) H024=27 ≈ h0; Dung Hưng bờ TÂY-NAM (496.2,76.6) H024=270) ===
{
  // VPBank Phạm Ngũ Lão — 5T kính, đế + biển xanh lá
  const bx = 515.7, bz = 63.0, ry = -0.878;     // mặt quay TÂY-NAM ra PNL
  if (lmOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 15, D = 12, FL = 5, FH = 3.3, H = FL * FH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#eef2f4', '#3f5a6b', 4, 5));
    body.position.y = H / 2; g.add(body);
    const base = new THREE.Mesh(new THREE.BoxGeometry(W, 3.4, D + 0.2), mat(0x0e8a45)); base.position.y = 1.7; g.add(base);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 1.5), lmSign('VPBank — Vì một Việt Nam thịnh vượng', '#0e8a45', '#ffffff', 36));
    s.position.set(0, 2.7, D / 2 + 0.12); g.add(s);
    const atm = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 1.2), sharedMats.window);
    atm.position.set(W / 2 - 1.4, 1.2, D / 2 + 0.8); g.add(atm);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.7, D + 1), mat(0xb8b2a2)); roof.position.y = H + 0.35; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'vpbank_pnl'; scene.add(g);
    addCollider(bx, bz, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([bx, bz, Math.max(W, D) / 2 + 9]);
  }
  // TT Điện máy Dung Hưng — 4T, biển đỏ CHIGO/SPELIER xếp tầng
  const dx2 = 496.2, dz2 = 76.6, ry2 = 2.264;   // mặt quay ĐÔNG-BẮC ra PNL
  if (lmOK(dx2, dz2)) {
    const g = new THREE.Group(); g.position.set(dx2, groundHeight(dx2, dz2), dz2); g.rotation.y = ry2;
    const W = 12, D = 10, FL = 4, FH = 3.3, H = FL * FH;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#f4f2ec', '#3f5a6b', 3, 4));
    body.position.y = H / 2; g.add(body);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, 1.4), lmSign('TT ĐIỆN MÁY DUNG HƯNG — 10-12-14 PHẠM NGŨ LÃO', '#c1201a', '#ffe9b0', 32));
    s1.position.set(0, 3.2, D / 2 + 0.1); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.1), lmSign('CHIGO', '#c1201a'));
    s2.position.set(-3, H - 1.4, D / 2 + 0.1); g.add(s2);
    const s3 = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.1), lmSign('SPELIER — Smart Kitchen', '#22252a', '#ffffff', 36));
    s3.position.set(3, H - 2.9, D / 2 + 0.1); g.add(s3);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'dunghung_pnl'; scene.add(g);
    addCollider(dx2, dz2, Math.max(W, D) * 0.52);
    FEATURED_CLEAR.push([dx2, dz2, Math.max(W, D) / 2 + 9]);
  }
}


  // ===== CELL_NAM: 15 block công trình khu Tô Hiệu/hồ Sen (agent nháp, dùng chung helper lô 2) =====
// ============================================================================
// MẶT TRẬN NAM — 15 KHỐI CÔNG TRÌNH ĐÍCH DANH (trục Tô Hiệu / Chùa Hàng / Dư Hàng /
// Hồ Sen / Chợ Con / Hàng Kênh, quận Lê Chân; 37 pano điểm 0.3-3.0).
// Nguồn: compare_full_sol56 + audit_done.json + ẢNH THẬT đã xem 11 pano × 2 heading
// (324/325/172/463/187/322/460/321/457/461/481). Chi tiết: PLAN.md cùng thư mục.
//
// VỊ TRÍ DÁN: js/world.js — TIẾP NGAY SAU khối "LÔ 2 công trình đích danh"
// (sau block hdbank_tower ~line 2001 hiện tại), TRƯỚC khối OSM "1.200+ TÒA NHÀ THẬT".
// GIẢ ĐỊNH: các helper lmSign / lmFacade / lmOK / lmTower ĐÃ TỒN TẠI trong scope
// (đã tích hợp cùng lô lm_drafts trước — world.js:1822-1864). KHÔNG khai báo lại.
// Scope buildWorld có sẵn: THREE, mat, makeTex, sharedMats, addCollider,
// FEATURED_CLEAR, groundHeight, groundHeightNoDeck, isWater, LAND_H, localPt, scene.
//
// Mọi tọa độ đã DỜI KHỎI TIM ĐƯỜNG (pano = xe Google giữa đường):
// chiếu pano lên đoạn ROADS_DT gần nhất rồi đẩy pháp tuyến về phía heading
// một đoạn nửa_lòng(p6.5/s5/t4/r2.75) + 2.3 vỉa hè + D/2 (+ sân với công sở),
// dịch dọc phố 12-25m khi cần cho bearing rơi đúng bucket heading giám khảo.
// Góc quay dùng sẵn (đã tính từ vector đoạn đường):
//   Hồ Sen #294 (bearing 168.5): bờ TÂY mặt quay ĐÔNG ry=1.771; bờ ĐÔNG quay TÂY ry=-1.371
//   Tô Hiệu #49 (bearing 78.3): bờ BẮC quay NAM ry=0.2035; bờ NAM quay BẮC ry=-2.938
//   Chợ Con #44 (bearing 85):   bờ BẮC quay NAM ry=0.0873
//   Vòng Hồ Sen #102 (836→963): bờ ĐÔNG quay TÂY (ra hồ) ry=-1.508
// ============================================================================

// === (1) CỤM UBND + NHÀ VĂN HÓA QUẬN LÊ CHÂN — bờ TÂY Phố Hồ Sen
//     (pano_324 h270 sev3 "UBND 3T + NVH" + pano_322 h270; ảnh thật pano_324_h270:
//     UBND khối hộp 3T vàng kem, biển đỏ trên nóc, sân đỗ xe + bonsai trước;
//     NVH tân cổ điển vàng đậm, phù điêu + chân dung Bác. OSM bld (-128,896) a=3268
//     đang là "hộp trắng khổng lồ" trong game → FEATURED_CLEAR ở đây đuổi nó) ===
{
  const bx = -105, bz = 874;                    // UBND — cách tim Hồ Sen ~28m (sân 13m)
  if (lmOK(bx, bz)) {
    const ry = 1.771;                            // mặt quay ĐÔNG ra Phố Hồ Sen
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 30, D = 14, H = 3 * 3.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#efe3bd', '#5f6e74', 9, 3));
    body.position.y = H / 2; g.add(body);
    // sảnh giữa nhô + mái đón
    const porch = new THREE.Mesh(new THREE.BoxGeometry(8, 4.2, 2.4), mat(0xe6d8a8));
    porch.position.set(0, 2.1, D / 2 + 1.1); g.add(porch);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.9, 1.5),
      lmSign('ỦY BAN NHÂN DÂN QUẬN LÊ CHÂN', '#b91c1c', '#ffe9b0', 40));
    s.position.set(0, H + 0.9, D / 2 - 1); g.add(s);                 // biển đỏ trên nóc (ảnh thật)
    // cột cờ giữa sân
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 9, 6), mat(0xd9dde0));
    pole.position.set(0, 4.5, D / 2 + 9); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.1), mat(0xc8102e));
    flag.position.set(0.95, 8.2, D / 2 + 9); g.add(flag);
    // 2 bonsai tròn trước sảnh (ảnh: hàng bonsai chậu)
    for (const sx of [-5.5, 5.5]) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), mat(0x3f6f3a));
      bush.position.set(sx, 1.1, D / 2 + 4); g.add(bush);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'ubnd_lechan'; scene.add(g);
    for (const lx of [-9, 0, 9]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 8); }
    FEATURED_CLEAR.push([bx, bz, 26]);           // phủ cả sân + đuổi OSM bld (-128,896)
    FEATURED_CLEAR.push([bx + 9, bz + 4, 20]);   // vá phía sân đông-nam
  }
  // NHÀ VĂN HÓA — nam UBND (pano_324 h180-225, w~25, 2T tân cổ điển vàng đậm)
  const nx = -90, nz = 902;
  if (lmOK(nx, nz)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(nx, groundHeight(nx, nz), nz); g.rotation.y = ry;
    const W = 20, D = 12, H = 2 * 4.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#e9cf8d', '#6b5433', 6, 2));
    body.position.y = H / 2; g.add(body);
    // hàng 4 cột trắng hiên + mái đỏ dốc nhẹ
    for (const sx of [-6, -2, 2, 6]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, H, 8), mat(0xf3ecd8));
      col.position.set(sx, H / 2, D / 2 + 1.2); g.add(col);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 1.0, D + 3.2), mat(0x8f3b2e));
    roof.position.y = H + 0.5; g.add(roof);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.2),
      lmSign('NHÀ VĂN HÓA QUẬN LÊ CHÂN', '#8f1d1d', '#ffd21a', 42));
    s.position.set(0, H - 1.1, D / 2 + 1.5); g.add(s);
    // khung chân dung Bác trên mảng tường trái (ảnh thật — KHÔNG vẽ mặt, chỉ khung nền đỏ)
    const memo = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.8), mat(0xa31f1f));
    memo.position.set(-7.2, H - 3.4, D / 2 + 0.06); g.add(memo);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'nvh_lechan'; scene.add(g);
    for (const lx of [-6, 6]) { const [cx, cz] = localPt(nx, nz, lx, 0, ry); addCollider(cx, cz, 7.5); }
    FEATURED_CLEAR.push([nx, nz, 18]);
  }
}

// === (2) CỔNG CÔNG VIÊN THỂ THAO HỒ SEN — hình CÁNH SEN nhiều màu
//     (pano_324 h0 sev3 "cổng cánh sen xanh-đỏ-lam"; ảnh thật: 2 cụm cánh cong
//     xanh lá/cam/đỏ ôm biển ngang đỏ "CÔNG VIÊN THỂ THAO HỒ SEN" + bông sen.
//     Đặt mép ĐÔNG công viên OSM (PARK#29 bbox -233..-121 × 762..906) nhìn ra nút giao) ===
{
  const bx = -112, bz = 838;
  if (lmOK(bx, bz)) {
    const ry = 1.771;                            // quay mặt ĐÔNG ra nút Hồ Sen × Chợ Con
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    // 3 cặp "cánh sen" = nửa vành khuyên đứng, màu khác nhau, bán kính giảm dần
    const petal = [[0x2e8b3e, 5.2], [0xd97a1e, 4.2], [0xc0392b, 3.2]];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const [col, r] = petal[i];
        const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.28, 8, 18, Math.PI * 0.85), mat(col));
        arc.position.set(side * (6.2 - i * 0.9), 2.0, 0);   // nâng tâm vành để cánh cong vươn khỏi mặt đất
        arc.rotation.z = side > 0 ? 0.35 : Math.PI - 0.35 - Math.PI * 0.85; // cong ôm vào giữa
        g.add(arc);
      }
    }
    const board = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 1.4),
      lmSign('CÔNG VIÊN THỂ THAO HỒ SEN', '#c0392b', '#ffe9b0', 44));
    board.position.set(0, 4.6, 0.1); g.add(board);
    const board2 = board.clone(); board2.rotation.y = Math.PI; board2.position.z = -0.1; g.add(board2);
    const lotus = new THREE.Mesh(new THREE.SphereGeometry(0.75, 8, 6), mat(0xd0312d));
    lotus.position.set(0, 5.9, 0); g.add(lotus);                     // bông sen đỏ trên đỉnh
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'cong_cv_hosen'; scene.add(g);
    for (const lx of [-6.2, 6.2]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 1.2); }
    FEATURED_CLEAR.push([bx, bz, 12]);
  }
}

// === (3) TÒA HÀNH CHÍNH KIỂU PHÁP MÁI ĐỎ (Quận ủy/công sở) — bờ TÂY Hồ Sen
//     (pano_322 h270 + pano_323 h270 sev3 "tòa vàng kem 3T, fronton, hàng cột, mái đỏ,
//     cờ nóc"; ảnh thật pano_322_h270: đối xứng, sảnh bậc cấp, sân rào sắt, sau
//     dải phân cách hoa giấy) ===
{
  const bx = -81, bz = 992;
  if (lmOK(bx, bz)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 26, D = 14, H = 3 * 3.8;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#eedcab', '#6a4f2e', 8, 3));
    body.position.y = H / 2; g.add(body);
    // khối giữa nhô + fronton tam giác (2 tấm nghiêng) + mái đỏ dốc
    const mid = new THREE.Mesh(new THREE.BoxGeometry(8, H + 1.6, 2), lmFacade('#f2e3b6', '#6a4f2e', 2, 3));
    mid.position.set(0, (H + 1.6) / 2, D / 2 + 0.9); g.add(mid);
    for (const sd of [-1, 1]) {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(W / 2 + 1.2, 0.5, D + 1.6), mat(0x8f3b2e));
      slope.position.set(sd * (W / 4), H + 1.35, 0); slope.rotation.z = -sd * 0.22; slope.castShadow = true;
      g.add(slope);
    }
    const fron = new THREE.Mesh(new THREE.BoxGeometry(8.4, 1.6, 0.4), mat(0xf2e3b6));
    fron.position.set(0, H + 2.2, D / 2 + 1.7); g.add(fron);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 4, 6), mat(0xd9dde0));
    pole.position.set(0, H + 4.4, 0); g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), mat(0xc8102e));
    flag.position.set(0.85, H + 5.6, 0); g.add(flag);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'congso_phap_hosen'; scene.add(g);
    for (const lx of [-8, 0, 8]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 7.5); }
    FEATURED_CLEAR.push([bx, bz, 24]);           // phủ sân + rào tới mép đường
  }
}

// === (4) TÒA CÔNG SỞ KÍNH CONG HIỆN ĐẠI + HÀNG CAU — bờ TÂY Hồ Sen
//     (pano_322/323 h270 sev3 "tòa kính cong trắng, cờ đỏ, hàng cọ/dừa, sân rào") ===
{
  const bx = -85, bz = 952;
  if (lmOK(bx, bz)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 22, D = 13, H = 3 * 3.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#f0efe9', '#47606b', 7, 3));
    body.position.y = H / 2; g.add(body);
    // góc kính cong (1/4 trụ) nhô ra phía đường — điểm nhận diện
    const curve = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, H, 14, 1, false, 0, Math.PI / 2), sharedMats.window);
    curve.position.set(W / 2 - 2.5, H / 2, D / 2 - 2.5); g.add(curve);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.6, D + 1), mat(0xb8b2a2));
    roof.position.y = H + 0.3; g.add(roof);
    // hàng 4 cau vua trước sân
    for (const sx of [-8, -3, 2, 7]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 6.5, 6), mat(0xb9b3a0));
      trunk.position.set(sx, 3.25, D / 2 + 5); g.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 7, 5), mat(0x2f6b33));
      crown.scale.y = 0.62; crown.position.set(sx, 7.1, D / 2 + 5); g.add(crown);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'congso_kinhcong'; scene.add(g);
    for (const lx of [-7, 7]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 8); }
    FEATURED_CLEAR.push([bx, bz, 22]);
  }
}

// === (5) SCOTS ENGLISH + FIVE STAR — dãy tây Hồ Sen đoạn nam
//     (pano_321 h270 sev3 "cụm SCOTS–Teng–FIVE STAR"; ảnh thật pano_321_h270:
//     SCOTS 4T trắng khối kính viền xanh dương; FIVE STAR nhà Pháp vàng kem 3-4T
//     phào chỉ trắng, biển đỏ, ở phía bắc chếch nam nhà SCOTS) ===
{
  const sx0 = -58, sz0 = 1028;                   // SCOTS ENGLISH
  if (lmOK(sx0, sz0)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(sx0, groundHeight(sx0, sz0), sz0); g.rotation.y = ry;
    const W = 10, D = 12, H = 4 * 3.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#f4f5f2', '#274a72', 3, 4));
    body.position.y = H / 2; g.add(body);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.3), lmSign('SCOTS ENGLISH', '#1550a0'));
    s.position.set(0, H - 0.9, D / 2 + 0.08); g.add(s);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(8.6, 1.0), lmSign('HỆ THỐNG ANH NGỮ QUỐC TẾ', '#1550a0', '#ffffff', 34));
    s2.position.set(0, 3.4, D / 2 + 0.08); g.add(s2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'scots_english'; scene.add(g);
    addCollider(sx0, sz0, 6.5); FEATURED_CLEAR.push([sx0, sz0, 12]);
  }
  const fx = -61, fz = 1010;                     // FIVE STAR — biệt thự Pháp vàng kem
  if (lmOK(fx, fz)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(fx, groundHeight(fx, fz), fz); g.rotation.y = ry;
    const W = 12, D = 11, H = 3 * 3.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#eedcab', '#7a5c33', 4, 3));
    body.position.y = H / 2; g.add(body);
    // phào ngang trắng giữa các tầng + mái đua
    for (let f = 1; f <= 2; f++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, 0.32, D + 0.24), mat(0xf6f1e2));
      band.position.y = f * 3.4; g.add(band);
    }
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 0.9, 0.5, D + 0.9), mat(0xf6f1e2));
    cornice.position.y = H + 0.25; g.add(cornice);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.2), lmSign('FIVE STAR', '#c01822', '#ffe9b0'));
    s.position.set(0, H - 1, D / 2 + 0.08); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'fivestar_hosen'; scene.add(g);
    addCollider(fx, fz, 7); FEATURED_CLEAR.push([fx, fz, 12]);
  }
}

// === (6) NEW SCHOOL — tòa tối màu cao nhất ven hồ (bờ ĐÔNG hồ Sen)
//     (pano_321/322/323 h90 sev3 "New School tòa tối + nhà ống bên kia hồ";
//     ảnh thật pano_321_h90: tháp ~8-9T ốp tối, khung LED trên nóc, podium
//     nâu đỏ dạng "con tàu" 2T, biển vàng NEW SCHOOL — mốc skyline bên kia hồ) ===
{
  const bx = 88, bz = 1002;
  const g = lmTower(bx, bz, -1.508, 20, 16, 8, 3.2, mat(0x2c2c31), 'newschool_tower'); // quay TÂY ra hồ
  if (g) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(15, 6.4, 9), mat(0x6e3428));
    pod.position.set(-2, 3.2, 12); pod.castShadow = true; g.add(pod);   // podium nâu đỏ phía hồ
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), lmSign('NEW SCHOOL', '#191919', '#e8c35a'));
    s.position.set(0, 8 * 3.2 - 1.4, 8.08); g.add(s);
    const led = new THREE.Mesh(new THREE.BoxGeometry(12, 2.2, 0.3), sharedMats.window);
    led.position.set(0, 8 * 3.2 + 1.8, 2); g.add(led);                  // khung LED trên nóc
    const [px, pz] = localPt(bx, bz, -2, 12, -1.508); addCollider(px, pz, 7);
    FEATURED_CLEAR.push([px, pz, 10]);
  }
}

// === (7) SAMNEC + ĐÔNG DƯƠNG HOTEL — bờ TÂY Hồ Sen đoạn bắc (gần Ga)
//     (pano_325 h270 sev3 "SAMNEC 4T rộng ~40m" + pano_326 h270 "SAMNEC–LP BUILDING
//     6T, SCB, ĐÔNG DƯƠNG HOTEL"; ảnh thật pano_325_h270: biển xanh lá lớn logo 4 màu,
//     dải logo TOSHIBA SONY SAMSUNG vàng trên nóc, kính trệt; tháp hotel kính xanh sau.
//     TRONG vành 830m — FEATURED_CLEAR phải đuổi shophouse hiện hữu) ===
{
  const bx = -109, bz = 793;                     // khối SAMNEC
  if (lmOK(bx, bz)) {
    const ry = 1.771;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 38, D = 18, H = 4 * 3.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#e8ecef', '#2d5d8a', 10, 4));
    body.position.y = H / 2; g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 3.0, 0.14), sharedMats.window);
    glass.position.set(0, 1.7, D / 2 + 0.06); g.add(glass);            // kính trệt showroom
    const s = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.2), lmSign('SAMNEC', '#0c7a3c', '#ffffff', 64));
    s.position.set(-4, H - 2.4, D / 2 + 0.1); g.add(s);                // biển xanh lá lớn
    const logos = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.85, 1.2),
      lmSign('TOSHIBA • SONY • SAMSUNG • beko • HITACHI', '#e8a013', '#20242b', 34));
    logos.position.set(0, H + 0.8, D / 2 - 1); g.add(logos);           // dải logo vàng trên nóc
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.0), lmSign('SAMNEC — Chăm sóc Gia đình Việt', '#0c7a3c', '#ffffff', 30));
    s2.position.set(6, 4.6, D / 2 + 0.08); g.add(s2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'samnec'; scene.add(g);
    for (const lx of [-13, 0, 13]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 9); }
    FEATURED_CLEAR.push([bx, bz, 30]);
  }
  // tháp ĐÔNG DƯƠNG HOTEL kính xanh 7T + biển đỏ dọc (ảnh pano_325/326 h270)
  const hx = -112, hz = 772;
  const g2 = lmTower(hx, hz, 1.771, 14, 14, 7, 3.2, mat(0x33566b), 'dongduong_hotel');
  if (g2) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), lmSign('HOTEL', '#c01822', '#ffffff', 60));
    s.rotation.z = -Math.PI / 2;                                       // xoay 90° → dải biển ĐỨNG dọc mép nhà
    s.position.set(6.4, 12, 7.1); g2.add(s);
  }
}

// === (8) KHU TẬP THỂ CŨ PHỐ HỒ SEN — bờ ĐÔNG đoạn z 762-840 (2 dãy)
//     (pano_325 h90 sev3 "tập thể cũ 3T ~90m, ban công sắt, cửa chớp, trạm xe đạp" +
//     pano_326 h90 "4T ~100m, bồn nước inox mái"; ảnh thật: tường trắng xám loang,
//     cửa lá sách gỗ, cây non trước — TRONG vành 830m, FEATURED_CLEAR đuổi shophouse) ===
{
  const mkTapThe = (bx, bz, FL, W, name) => {
    if (!lmOK(bx, bz)) return;
    const ry = -1.371;                           // mặt quay TÂY ra Phố Hồ Sen
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const D = 11, H = FL * 3.1;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#d8d3c6', '#4c5a50', 10, FL));
    body.position.y = H / 2; g.add(body);
    // dải ban công sắt chạy dài mỗi tầng (Box mỏng nhô ra mặt tây)
    for (let f = 1; f < FL; f++) {
      const balc = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 0.9, 0.7), mat(0x9a958a));
      balc.position.set(0, f * 3.1 + 0.45, D / 2 + 0.35); g.add(balc);
    }
    // bồn nước inox trên nóc (đặc trưng nhìn từ xa)
    for (const sx of [-W * 0.3, 0, W * 0.3]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.4, 10), mat(0xc9ced2));
      tank.rotation.z = Math.PI / 2; tank.position.set(sx, H + 0.8, 0); tank.castShadow = true; g.add(tank);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = name; scene.add(g);
    for (const lx of [-W * 0.33, 0, W * 0.33]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 7); }
    FEATURED_CLEAR.push([bx, bz, W / 2 + 9]);
  };
  mkTapThe(-81.5, 779.4, 4, 42, 'tapthe_hosen_a');   // dãy bắc 4 tầng (pano_326)
  mkTapThe(-72.5, 820.5, 3, 40, 'tapthe_hosen_b');   // dãy nam 3 tầng (pano_325)
}

// === (9) CHỢ CON — nhà chợ truyền thống mái tôn + billboard VIFON
//     (pano_460 h0 sev3 "chợ 2T mái tôn dốc cũ, mặt mở, sạp nền đỏ" + pano_461 h0
//     "dãy chợ 2T ~20m pano Vifon Phở Bò lớn"; ảnh thật: tường vàng ố, mái tôn xám,
//     khung thép biển trên nóc, mái hiên bạt xanh sọc, dây điện chằng chịt.
//     OSM có footprint chợ (268,783) a=2199 đang là hộp trơn → FEATURED_CLEAR thay thế) ===
{
  const bx = 268, bz = 793;
  if (lmOK(bx, bz)) {
    const ry = 0.0873;                           // mặt quay NAM ra Phố Chợ Con
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 58, D = 38, H = 7.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#d9c07a', '#7a6a4a', 12, 2));
    body.position.y = H / 2; g.add(body);
    // 2 mảng mái tôn dốc xám úp lên nhau
    for (const sd of [-1, 1]) {
      const slope = new THREE.Mesh(new THREE.BoxGeometry(W + 1.5, 0.35, D / 2 + 2), mat(0x8b8f93));
      slope.position.set(0, H + 1.5, sd * D / 4); slope.rotation.x = sd * 0.22; slope.castShadow = true;
      g.add(slope);
    }
    // khung thép biển quảng cáo trên nóc (ảnh pano_460)
    for (const sx of [-18, 0, 18]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.4, 0.18), mat(0x6d6f72));
      strut.position.set(sx, H + 3.2, D / 2 - 2); g.add(strut);
    }
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(24, 2.6), lmSign('VIFON — PHỞ BÒ ĂN LIỀN', '#c01822', '#ffe9b0', 48));
    bb.position.set(0, H + 3.4, D / 2 - 1.85); g.add(bb);              // billboard Vifon (pano_461)
    const nameS = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.6), lmSign('CHỢ CON', '#1550a0', '#ffffff', 60));
    nameS.position.set(-20, H - 0.6, D / 2 + 0.1); g.add(nameS);
    // dải mái hiên bạt xanh sọc dọc mặt nam + cửa chợ mở tối
    const awn = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.24, 3.4), mat(0x2f6ea5));
    awn.position.set(0, 3.4, D / 2 + 1.7); awn.rotation.x = 0.2; g.add(awn);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), mat(0x1f1d1a));
    door.position.set(0, 1.6, D / 2 + 0.06); g.add(door);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'cho_con'; scene.add(g);
    for (const lx of [-20, 0, 20]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 12); }
    FEATURED_CLEAR.push([bx, bz, 42]);           // đuổi hộp OSM (268,783) + nhà tự mọc
  }
}

// === (10) WINMART+ — bờ NAM Tô Hiệu (pano_170 h180 sev3 "WinMart+ 1 tầng biển
//     đỏ-vàng TƯƠI NGON THƯỢNG HẠNG"; chuỗi nhận diện mạnh, footprint nhỏ) ===
{
  const bx = -582.3, bz = 808.5;
  if (lmOK(bx, bz)) {
    const ry = -2.938;                           // mặt quay BẮC ra Tô Hiệu
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 9, D = 10, H = 4.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0xe9e6df));
    body.position.y = H / 2; g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 2.5, 0.12), sharedMats.window);
    glass.position.set(0, 1.45, D / 2 + 0.05); g.add(glass);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 1.2), lmSign('WinMart+', '#c8102e', '#ffffff', 52));
    s.position.set(0, H - 0.7, D / 2 + 0.08); g.add(s);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 0.7), lmSign('TƯƠI NGON THƯỢNG HẠNG', '#f2b705', '#7a1420', 30));
    s2.position.set(0, H - 1.75, D / 2 + 0.08); g.add(s2);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'winmart_tohieu'; scene.add(g);
    addCollider(bx, bz, 6); FEATURED_CLEAR.push([bx, bz, 11]);
  }
}

// === (11) DÃY LONG CHÂU – HỒNG NGÀ – HÒA DIỆP — bờ BẮC Tô Hiệu tại nút đèn
//     (pano_172 h0 sev3 "Long Châu 3T + Hồng Ngà 2T + Hòa Diệp 3T đúng bề rộng";
//     ảnh thật pano_172_h0: biển LONG CHÂU xanh dương lớn, biển đỏ ĐỒNG HỒ-KÍNH MẮT,
//     biển HÒA DIỆP xanh đậm + dải logo hãng xe — 3 nhà liền kề 1 block) ===
{
  const bx = -470.1, bz = 760.2;                 // tâm dãy 3 nhà, W tổng 24
  if (lmOK(bx, bz)) {
    const ry = 0.2035;                           // bờ BẮC Tô Hiệu → mặt quay NAM ra phố
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const homes = [                              // [tâmX cục bộ, W, tầng, màu tường, biển, nền biển]
      [-8, 8, 3, '#eef1f4', 'NHÀ THUỐC LONG CHÂU', '#1550a0'],
      [-1, 6, 2, '#f4ece0', 'ĐỒNG HỒ – KÍNH MẮT HỒNG NGÀ', '#c01822'],
      [7, 10, 3, '#e8edf2', 'HÒA DIỆP — XE MÁY 50CC', '#123c78'],
    ];
    const D = 10;
    for (const [lx, W, FL, css, txt, bg] of homes) {
      const H = FL * 3.3;
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade(css, '#55606a', 2, FL));
      body.position.set(lx, H / 2, 0); g.add(body);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, 1.1), lmSign(txt, bg, '#ffffff', 34));
      s.position.set(lx, 3.55, D / 2 + 0.08); g.add(s);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.85, 2.4, 0.12), sharedMats.window);
      glass.position.set(lx, 1.4, D / 2 + 0.05); g.add(glass);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'day_longchau_172'; scene.add(g);
    for (const lx of [-8, 7]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 6.5); }
    FEATURED_CLEAR.push([bx, bz, 16]);
  }
}

// === (12) DOJI — tòa 5T đen-đỏ màn hình LED, bờ BẮC Tô Hiệu
//     (pano_463 h45/h90 sev3 "DOJI 5T đỏ-đen LED"; ảnh thật pano_463_h45/135:
//     khối ốp đen, crown đỏ logo DOJI trắng, màn LED lớn góc — mốc dễ thấy cả đoạn) ===
{
  const bx = -377.3, bz = 740.1;
  if (lmOK(bx, bz)) {
    const ry = 0.2035;                           // bờ BẮC Tô Hiệu → mặt quay NAM ra phố
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 15, D = 12, H = 5 * 3.3;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#232326', '#3c3f45', 4, 5));
    body.position.y = H / 2; g.add(body);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 2.6, D + 0.3), mat(0xc81a28));
    crown.position.y = H - 1.3; g.add(crown);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.8), lmSign('DOJI', '#c81a28', '#ffffff', 62));
    s.position.set(0, H - 1.3, D / 2 + 0.2); g.add(s);
    // màn hình LED sáng (basic material — không ăn nắng, như màn LED thật)
    const led = new THREE.Mesh(new THREE.PlaneGeometry(7, 4),
      new THREE.MeshBasicMaterial({ map: makeTex(256, 148, (gg, w, h) => {
        gg.fillStyle = '#12203a'; gg.fillRect(0, 0, w, h);
        gg.fillStyle = '#e8b34c'; gg.font = 'bold 44px system-ui'; gg.textAlign = 'center';
        gg.fillText('TRANG SỨC', w / 2, 62); gg.fillStyle = '#ffffff'; gg.fillText('DOJI', w / 2, 118);
      }) }));
    led.position.set(-2.5, H * 0.55, D / 2 + 0.1); g.add(led);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'doji_tohieu'; scene.add(g);
    addCollider(bx, bz, 8); FEATURED_CLEAR.push([bx, bz, 15]);
  }
}

// === (13) VPBANK 230 TÔ HIỆU — 2T kính xanh lá (pano_463 h0 sev3 "VPBank 230
//     rộng ~12m kính xanh, ATM"; ảnh thật: khối kính xanh VPBank sát góc cây) ===
{
  const bx = -402.1, bz = 746.1;
  if (lmOK(bx, bz)) {
    const ry = 0.2035;                           // bờ BẮC Tô Hiệu → mặt quay NAM ra phố
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 12, D = 10, H = 2 * 3.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0x0f6a38));
    body.position.y = H / 2; g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W + 0.16, H - 2.2, 0.14), sharedMats.window);
    glass.position.set(0, (H - 2.2) / 2, D / 2 + 0.06); g.add(glass);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.3), lmSign('VPBank', '#0b7a41', '#ffffff', 52));
    s.position.set(0, H - 0.8, D / 2 + 0.14); g.add(s);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'vpbank_230'; scene.add(g);
    addCollider(bx, bz, 7); FEATURED_CLEAR.push([bx, bz, 12]);
  }
}

// === (14) BIỆT THỰ PHÁP VÀNG OCHRE — bờ NAM Tô Hiệu khu 225
//     (pano_463 h135 sev3 catalog "biệt thự Pháp 3T vàng ochre, cửa vòm cuốn,
//     ban công, vườn cây sân thượng — kiến trúc thuộc địa nổi bật") ===
{
  const bx = -376.9, bz = 767.2;
  if (lmOK(bx, bz)) {
    const ry = -2.938;                           // bờ NAM Tô Hiệu → mặt quay BẮC ra phố
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 11, D = 12, H = 3 * 3.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), lmFacade('#dfae4f', '#6a4f2e', 3, 3));
    body.position.y = H / 2; g.add(body);
    // 3 cửa vòm cuốn tầng 2 (nửa trụ trắng ốp mặt) + ban công
    for (const sx of [-3.2, 0, 3.2]) {
      const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 10, 1, false, 0, Math.PI), mat(0xf3ecd8));
      arch.rotation.x = Math.PI / 2; arch.rotation.z = Math.PI / 2;
      arch.position.set(sx, 6.6, D / 2 + 0.05); g.add(arch);
    }
    const balc = new THREE.Mesh(new THREE.BoxGeometry(W * 0.8, 0.8, 0.8), mat(0xf3ecd8));
    balc.position.set(0, 4.6, D / 2 + 0.4); g.add(balc);
    // vườn cây sân thượng
    for (const sx of [-3, 1.5]) {
      const bush = new THREE.Mesh(new THREE.SphereGeometry(1.0, 7, 5), mat(0x3f6f3a));
      bush.position.set(sx, H + 0.7, -1); g.add(bush);
    }
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.5, D + 0.8), mat(0xf3ecd8));
    cornice.position.y = H + 0.25; g.add(cornice);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'bietthu_phap_225'; scene.add(g);
    addCollider(bx, bz, 7); FEATURED_CLEAR.push([bx, bz, 12]);
  }
}

// === (15) VĨNH VY HOTEL — bờ ĐÔNG Vòng Hồ Sen (pano_481 h0 sev3 "khách sạn 4T
//     biển đen chữ vàng"; nhìn thấy từ bên kia hồ → tăng skyline mặt nước) ===
{
  const bx = 33.5, bz = 859.1;
  const g = lmTower(bx, bz, -1.508, 10, 9, 4, 3.2, mat(0xe3ded2), 'vinhvy_hotel'); // quay TÂY ra hồ
  if (g) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.1), lmSign('VĨNH VY HOTEL', '#191919', '#e8c35a', 44));
    s.position.set(0, 4 * 3.2 - 0.9, 4.6); g.add(s);
  }
}


  // ===== CELL_TAY: 6 block khu Hai Bà Trưng/chợ Kỳ Đồng (agent nháp, helper hb* riêng) =====
// ============================================================================
// NHÁP MẶT TRẬN TÂY — PHỐ HAI BÀ TRƯNG đoạn 227 → Ngõ 326 (pano_278/279/280/281,
// điểm 0.9/1.5/1.3/1.2). Audit khẳng định đây là P. HAI BÀ TRƯNG khu Cát Dài
// (Lê Chân) — KHÔNG phải chợ An Dương; chợ thật ở đây = CHỢ KỲ ĐỒNG trong ngõ
// bắc pano_280 (ảnh pano_280_h000: cổng khung sắt + 2 băng rôn đỏ).
//
// VỊ TRÍ DÁN: js/world.js, cuối khối "CÔNG TRÌNH ĐẶC TRƯNG dải trung tâm"
// (sau block (4) Harbour View ~line 1725) — SAU khai báo FEATURED_CLEAR (1434),
// TRƯỚC khối OSM (2386)/nhà rời (2724)/shophouse_infill (2818, dừng ở vành 830m
// nên đoạn này r=979-1087m đang TRỐNG toàn mặt phố)/block_infill (2950).
//
// TRỤC PHỐ: ROADS_DT[233] c='s' (nửa lòng 5m): A=(-534,556) → B=(-958,643),
// L=432.8m, U=(-0.9796,0.2010) (dọc phố, s tăng về TÂY), N=(0.2010,0.9796)
// (pháp tuyến BỜ NAM, bearing 168 ≈ bucket h180; bờ bắc = -N, bearing 348 ≈ h0).
// Điểm đặt = A + U*s + N*off (off>0 nam, off<0 bắc); mặt tiền cách tim
// 5 + 2.3 = 7.3m → tâm khối off = ±(7.3 + D/2). Pano: 278 s=242.4, 279 s=281.3,
// 280 s=320.3, 281 s=359.3. groundHeightNoDeck = 2.00 toàn dải (đã kiểm 27 điểm).
// Biển catalog shopsigns.js nằm ±14m theo z quanh pano → lọt VÀO TRONG khối nhà
// D≥8 (tự khuất, hết "biển treo lơ lửng"); 5 biển đặt giữa lòng đường xem PLAN.md.
// ============================================================================

// === HELPER CHUNG MẶT TRẬN TÂY (dán 1 LẦN trước 6 block dưới, prefix hb ≠ lm) ===
const HB_A = [-534, 556], HB_U = [-0.9796, 0.2010], HB_N = [0.2010, 0.9796];
const HB_RYS = -2.9391;                        // mặt tiền bờ NAM quay BẮC ra phố
const HB_RYN = 0.2025;                         // mặt tiền bờ BẮC quay NAM ra phố
const hbPt = (s, off) => [HB_A[0] + HB_U[0] * s + HB_N[0] * off, HB_A[1] + HB_U[1] * s + HB_N[1] * off];
const hbOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - 2.0) < 0.4 && !isWater(x, z);
const hbRnd = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const hbSign = (txt, bg, fg = '#ffffff', px = 46) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 26);
  }), side: THREE.DoubleSide,
});
const hbVSign = (txt, bg, fg = '#ffffff') => new THREE.MeshLambertMaterial({ // biển ĐỨNG
  map: makeTex(64, 512, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = 'bold 38px system-ui, sans-serif'; g.textAlign = 'center';
    g.save(); g.translate(w / 2, h / 2); g.rotate(Math.PI / 2); g.fillText(txt, 0, 13, h - 30); g.restore();
  }), side: THREE.DoubleSide,
});
const hbFacade = (baseCss, winCss, cols, rows) => new THREE.MeshLambertMaterial({
  map: makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.16, my + r * ch + ch * 0.16, cw * 0.68, ch * 0.66);
    }
  }),
});
// nhà ống ĐÍCH DANH: thân + kính trệt + biển ngang, mặt tiền local +Z quay ra phố
const hbShopAt = (x, z, ry, W, D, FL, wallHex, sign, name) => {
  if (!hbOK(x, z)) return null;
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry;
  const FH = 3.3, H = FL * FH;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(wallHex)); body.position.y = H / 2; g.add(body);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 2.3, 0.1), sharedMats.window);
  glass.position.set(0, 1.35, D / 2 + 0.05); g.add(glass);
  for (let f = 1; f < FL; f++) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(W * 0.72, 1.4, 0.1), sharedMats.window);
    win.position.set(0, f * FH + 1.7, D / 2 + 0.05); g.add(win);
  }
  if (sign) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(W * 0.96, 4.2), 1.05), hbSign(sign[0], sign[1], sign[2] || '#ffffff', sign[3] || 40));
    s.position.set(0, 3.35, D / 2 + 0.1); g.add(s);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.4, D + 0.4), mat(0xb8b2a2)); roof.position.y = H + 0.2; g.add(roof);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = name; scene.add(g);
  addCollider(x, z, Math.max(W, D) * 0.5);
  FEATURED_CLEAR.push([x, z, Math.max(W, D) / 2 + 7]);
  return g;
};
// đặt theo trục phố: side +1 = bờ NAM (bucket h180), -1 = bờ BẮC (h0)
const hbShop = (s, side, W, D, FL, wallHex, sign, name) => {
  const [x, z] = hbPt(s, side * (7.3 + D / 2));
  return hbShopAt(x, z, side > 0 ? HB_RYS : HB_RYN, W, D, FL, wallHex, sign, name);
};

// === (T1) CỤM 227-229 + APOLLO — pano_278 (điểm 0.9, tệ nhất dải; h180=0.2)
//     (fix sev3 h180 "cụm 227-229: TMH 4T + Bún Cá Cay 2T + Mediphar 4T sát vỉa hè"
//      + h0 "Apollo 3T mặt xanh, cầu thang sắt xanh ngoài trời" + h270 2 bờ.
//      Audit_278: TMH W5 4T biển 'TAI-MŨI-HỌNG NỘI SOI 227'; BCC W5 2T biển vàng-đỏ
//      'BÚN CÁ CAY 229'; Mediphar W8 4T biển đứng cam; Koji cam 'CHI NHÁNH HP'.
//      Ảnh thật h180/h000/h270 khớp. Bearing từ pano: TMH 145/BCC 169/Mediphar 197
//      (bucket h180) — Apollo 353/Koji ~340 (h0). Biển rác catalog ' VÀ BIỂN ĐỨNG
//      CAM ' (-771.1,617.8) lọt vào trong khối BCC/TMH → tự khuất) ===
{
  // BỜ NAM (lẻ 227-231, đông→tây)
  hbShop(236.5, 1, 5, 9, 4, 0xf2efe6, ['TAI - MŨI - HỌNG • NỘI SOI • 227', '#1c56a0', '#ffffff', 34], 'hbt_tmh227');       // (-763.3,615.1)
  const bcc = hbShop(242, 1, 5, 8, 2, 0xe8b823, ['BÚN CÁ CAY — 229 HAI BÀ TRƯNG', '#c62828', '#ffe066', 34], 'hbt_buncacay229'); // (-768.8,615.7)
  if (bcc) { // biển đứng vàng đặc sản (ảnh h180: cạnh đông mặt tiền)
    const v = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 3.2), hbVSign('ĐẶC SẢN HẢI PHÒNG', '#e8b823', '#c62828'));
    v.position.set(-2.7, 3.4, 4 + 0.12); bcc.add(v);
  }
  const mp = hbShop(249, 1, 8, 10, 4, 0xf4f2ec, ['CTCP BỆNH VIỆN QUỐC TẾ MEDIPHARCARE', '#1c56a0', '#ffffff', 30], 'hbt_mediphar'); // (-775.4,618.1)
  if (mp) { // biển đứng CAM trên cao (đặc trưng nhìn dọc phố h270)
    const v = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5), hbVSign('MEDIPHAR CARE', '#e2711d'));
    v.position.set(3.6, 9.2, 5 + 0.12); mp.add(v);
  }
  // BỜ BẮC (chẵn, đông→tây): Giang Pháo — Apollo — Koji
  hbShop(233.5, -1, 5, 8, 3, 0xf4f2ec, ['GIANG PHÁO — HAIR PROFESSIONAL', '#26262c', '#ffffff', 32], 'hbt_giangphao');     // (-765.0,591.9)
  const ap = hbShop(241, -1, 8, 10, 3, 0x1d5fa8, ['APOLLO', '#1d5fa8', '#ffffff', 56], 'hbt_apollo');                       // (-772.6,592.4)
  if (ap) { // CẦU THANG SẮT XANH NGOÀI TRỜI 2 vế + chiếu nghỉ (fix sev3 h0, ảnh h000/h270)
    const stMat = mat(0x1b4f9e);
    const f1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 3.4), stMat); f1.position.set(2.9, 1.65, 5.9); f1.rotation.x = -0.75; f1.castShadow = true; ap.add(f1);
    const lan = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.2), stMat); lan.position.set(2.9, 3.3, 4.7); ap.add(lan);
    const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 3.4), stMat); f2.position.set(2.9, 4.95, 5.9); f2.rotation.x = 0.75; ap.add(f2);
    for (const [py, pz] of [[1.2, 6.9], [2.4, 4.7], [4.4, 6.9]]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.4, 0.08), stMat); p.position.set(3.35, py, pz); ap.add(p);
    }
  }
  hbShop(249.5, -1, 7, 9, 3, 0xd96b2b, ['Koji — CHI NHÁNH HẢI PHÒNG', '#d96b2b', '#ffffff', 34], 'hbt_koji');              // (-780.8,594.6)
}

// === (T2) DÃY BÁN LẺ 233-243 — pano_279 (điểm 1.5)
//     (fix sev3 h90 "shophouse liên tục 2 bên" + h180 "Tâm Bích Vân xanh lá +
//      Max Shop 233" + h0 "Nhaxinh/Smile Coffee" + h90 "30 Shine sát dãy trái".
//      Audit_279: Nhaxinh 3T vàng W6 + biển đứng đỏ 'ĐỒ GIA DỤNG TIỆN ÍCH';
//      30 Shine 3T xanh dương W6 billboard; Tâm Bích Vân 3T ốp XANH LÁ W8
//      'NHỰA TIỀN PHONG'; Max Shop 233 tối màu. Ảnh h000 thứ tự bắc đông→tây:
//      Bích Hảo, Smile, 30 Shine, Nhaxinh. Bearing: 30Shine 48 (h45-90),
//      Nhaxinh 353 (h0), MaxShop 146/TBV 180 (h180). Biển catalog TBV/MaxShop
//      (-809.9,625.1) lọt vào khối TBV → tự khuất) ===
{
  // BỜ BẮC
  hbShop(254.5, -1, 4, 8, 2, 0xd9b23a, ['BÍCH HẢO', '#a8842c', '#ffffff', 46], 'hbt_bichhao');                              // (-785.6,596.1)
  hbShop(258.5, -1, 4.5, 8, 2, 0xf4ece0, ['Smile Coffee', '#3c2f26', '#ffd98a', 42], 'hbt_smilecoffee');                    // (-789.5,596.9)
  const sh = hbShop(264, -1, 6, 9, 3, 0x1e63b0, ['30 SHINE — TÓC NAM', '#123f8f', '#ffffff', 40], 'hbt_30shine');           // (-795.0,597.5)
  if (sh) { // billboard lớn phủ tầng 2 (ảnh h000: hình người cắt tóc khổ lớn)
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.4), hbSign('30 SHINE — Combo Cắt Gội Massage', '#0d2f6b', '#9fd3ff', 30));
    bb.position.set(0, 6.6, 4.5 + 0.12); sh.add(bb);
  }
  const nx = hbShop(280.5, -1, 6, 9, 3, 0xe8d9a0, ['NHAXINHHAIPHONG.COM — ĐỒ GIA DỤNG', '#1c56a0', '#ffe066', 30], 'hbt_nhaxinh'); // (-811.1,600.8)
  if (nx) {
    const v = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 4.2), hbVSign('ĐỒ GIA DỤNG TIỆN ÍCH', '#c62828'));
    v.position.set(2.7, 4.6, 4.5 + 0.12); nx.add(v);
  }
  // BỜ NAM
  hbShop(276, 1, 6, 9, 3, 0x35383d, ['MAX SHOP 233 — EST 2015', '#26262c', '#ffffff', 38], 'hbt_maxshop233');               // (-802.0,623.0)
  hbShop(284, 1, 8, 9, 3, 0x2e8b4a, ['NHỰA TIỀN PHONG — CTY TM BÍCH VÂN', '#1f7a3c', '#ffffff', 30], 'hbt_tambichvan');     // (-809.8,624.6)
  hbShop(290.5, 1, 4.5, 8, 2, 0xf2efe6, ['CHUYÊN SỬA HÀNG HIỆU', '#1c56a0', '#ffffff', 36], 'hbt_suahanghieu');             // (-816.3,625.5)
}

// === (T3) CỔNG CHỢ KỲ ĐỒNG + CỤM Y TẾ 253 — pano_280 (điểm 1.3; h180=0.5)
//     (fix sev3 h0 "nhà phòng khám nhi/nhà thuốc 3T ~8m, ban công sắt VÀNG" +
//      h0 "cổng ngõ chợ: khung sắt, băng rôn đỏ lớn, hàng cơm/mì tại miệng ngõ" +
//      h180 "phòng khám PGS.TS Khúc Thị Nhụn 3T ~6m, cửa cuốn, biển xanh, LED đỏ".
//      Audit_280 + ảnh h000: băng rôn 'UBND PHƯỜNG CÁT DÀI TỔ 3-5-8' / 'TOÀN DÂN
//      ĐOÀN KẾT...'; trong ngõ bạt sọc xanh-trắng + ô dù + 'MÌ CHỢ KỲ ĐỒNG' +
//      'CƠM RANG THẬP CẨM'. Bearing: cổng 20/PKNhi 320 (h0) — PK253 170 (h180).
//      Biển catalog 'PHÒNG KHÁM CHUYÊN KHOA N'/'NHÀ THUỐC HOA ĐIỆP' (-848,604.1)
//      lọt vào khối PKNhi → tự khuất. Ngõ chợ KHÔNG có trong ROADS_DT → chừa
//      GAP s=[311,322] (block T6 cũng chừa), lòng ngõ là đất — xem PLAN.md) ===
{
  // BỜ BẮC: NOKIA — [miệng ngõ chợ] — PK Nhi + Hoa Điệp
  hbShop(310, -1, 5, 8, 3, 0xeef2f4, ['NOKIA — ĐIỆN THOẠI', '#1c56a0', '#ffffff', 40], 'hbt_nokia253');                     // (-839.9,607.2)
  const nhi = hbShop(325.5, -1, 8, 10, 3, 0xf0e6cf, ['PHÒNG KHÁM CHUYÊN KHOA NHI', '#1f7a3c', '#ffffff', 34], 'hbt_pknhi'); // (-855.3,609.4)
  if (nhi) { // ban công sắt uốn MẠ VÀNG 2 tầng (đặc trưng audit/ảnh) + biển Hoa Điệp
    for (const fy of [3.3, 6.6]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.85, 0.1), mat(0xc9a227));
      rail.position.set(0, fy + 0.55, 5 + 0.42); nhi.add(rail);
      const fl = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.1, 0.85), mat(0xd9cba8));
      fl.position.set(0, fy + 0.1, 5 + 0.3); nhi.add(fl);
    }
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.9), hbSign('NHÀ THUỐC HOA ĐIỆP — BS. ĐIỆP', '#1f7a3c', '#ffe066', 32));
    s2.position.set(0, 2.45, 5 + 0.1); nhi.add(s2);
  }
  // CỔNG NGÕ CHỢ KỲ ĐỒNG (miệng ngõ s∈[313,320], khung sắt + 2 băng rôn đỏ)
  {
    const [mx, mz] = hbPt(316.5, -10);
    FEATURED_CLEAR.push([mx, mz, 9]);            // giữ miệng ngõ + lòng ngõ nông quang đãng
    const gy = groundHeight(mx, mz);
    const g = new THREE.Group(); g.position.set(0, 0, 0); g.name = 'hbt_congchokydong'; scene.add(g);
    for (const sp of [313.5, 319.5]) {           // 2 trụ thép
      const [px, pz] = hbPt(sp, -6);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 4.6, 6), mat(0x5a6068));
      post.position.set(px, groundHeight(px, pz) + 2.3, pz); post.castShadow = true; g.add(post);
      addCollider(px, pz, 0.2);
    }
    const [bx, bz] = hbPt(316.5, -6);
    const b1 = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 0.8), hbSign('TOÀN DÂN ĐOÀN KẾT XÂY DỰNG ĐỜI SỐNG VĂN HÓA, ĐÔ THỊ VĂN MINH', '#c62828', '#ffe066', 26));
    b1.position.set(bx, groundHeight(bx, bz) + 4.1, bz); b1.rotation.y = HB_RYN; g.add(b1); // +Z quay RA PHỐ (nam) — chữ không ngược
    const b2 = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.7), hbSign('UBND PHƯỜNG CÁT DÀI — TỔ DÂN PHỐ SỐ 3-5-8', '#c62828', '#ffffff', 28));
    b2.position.set(bx, groundHeight(bx, bz) + 3.2, bz); b2.rotation.y = HB_RYN; g.add(b2);
    // trong ngõ: 2 quầy bạt sọc xanh-trắng + ô dù đỏ-trắng + 2 biển hàng ăn
    const strip = new THREE.MeshLambertMaterial({
      map: makeTex(128, 64, (gc, w, h) => { for (let i = 0; i < 8; i++) { gc.fillStyle = i % 2 ? '#ffffff' : '#2e7fa8'; gc.fillRect(i * w / 8, 0, w / 8, h); } }),
      side: THREE.DoubleSide,
    });
    for (const [sp, off] of [[314.8, -12.5], [318.4, -15.5]]) {
      const [qx, qz] = hbPt(sp, off); const qy = groundHeight(qx, qz);
      const awn = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.7), strip);
      awn.position.set(qx, qy + 2.5, qz); awn.rotation.set(-0.5, HB_RYS, 0, 'YXZ'); awn.castShadow = true; g.add(awn);
      const stall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 0.9), mat(0x8a7a5e));
      stall.position.set(qx, qy + 0.5, qz); stall.rotation.y = HB_RYS; g.add(stall);
      addCollider(qx, qz, 0.8);
    }
    const [ux, uz] = hbPt(316.6, -13.8); const uy = groundHeight(ux, uz);
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 8), mat(0xc23b3b)); um.position.set(ux, uy + 2.2, uz); um.castShadow = true; g.add(um);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), mat(0x777777)); up.position.set(ux, uy + 1.1, uz); g.add(up);
    const [s1x, s1z] = hbPt(312.6, -8.6);
    const ms = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), hbSign('MÌ CHỢ KỲ ĐỒNG', '#c62828', '#ffe066', 40));
    ms.position.set(s1x, groundHeight(s1x, s1z) + 1.5, s1z); ms.rotation.y = HB_RYN - 0.5; g.add(ms); // quay ra phố, chếch về pano
    const [s2x, s2z] = hbPt(320.4, -8.6);
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.6), hbSign('CƠM RANG THẬP CẨM', '#e8b823', '#7a2d12', 36));
    cs.position.set(s2x, groundHeight(s2x, s2z) + 1.5, s2z); cs.rotation.y = HB_RYN + 0.5; g.add(cs);
  }
  // BỜ NAM: PK 253 PGS.TS Khúc Thị Nhụn + Ô TÔ TỰ LÁI
  const pk = hbShop(320.5, 1, 6, 9, 3, 0xe9e6df, ['PHÒNG KHÁM 253 — PGS.TS KHÚC THỊ NHỤN', '#1c56a0', '#ffffff', 28], 'hbt_pk253nhun'); // (-845.6,632.0)
  if (pk) { // bảng LED chạy chữ ĐỎ gắn mặt tiền (fix: bỏ biển placeholder treo rời)
    const led = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.5), hbSign('KHÚC THỊ NHỤN — NỘI SOI', '#1a0505', '#ff3b30', 34));
    led.position.set(0, 2.5, 4.5 + 0.12); pk.add(led);
  }
  hbShop(328, 1, 5, 8, 2, 0xf4f2ec, ['Ô TÔ TỰ LÁI', '#f4f2ec', '#c62828', 46], 'hbt_otutulai');                             // (-853.0,633.0)
}

// === (T4) NGÃ BA NGÕ 326 — BỜ BẮC — pano_281 (điểm 1.2; h0=0.8)
//     (fix sev3 h0 "mở lòng Ngõ 326 + shophouse 4-5T hai bên ngõ, biển xanh
//      Ngõ 326, số 326" + h270 "dãy shophouse THIẾT BỊ Y TẾ 4-5T, gắn biển 326 +
//      ĐIỆN THOẠI 0912 lên mặt tiền". Audit_281 + ảnh h000/h270: góc TÂY ngõ =
//      TRUNG QUÂN THIẾT BỊ Y TẾ 326 trắng-kem 5T (OMRON, số 326 đỏ, LED
//      'ĐIỆN THOẠI 0912.045.496'), góc ĐÔNG = nhà cam 4T; trong ngõ nhà ống
//      trắng 4-5T hai bên. Bearing: TrungQuân 310 (h270) — NhàCam 36 (h0).
//      GAP miệng ngõ s=[353.5,364.5]; biển catalog '326'/'ĐIỆN THOẠI 0912' đang
//      nằm GIỮA LÒNG ĐƯỜNG (-902.3,625.7) → PLAN.md đề nghị xóa khỏi shopsigns.js.
//      Ngõ 326 không có trong ROADS_DT — fix 'road' sev3 chỉ đạt một phần (gap +
//      2 dãy nhà trong ngõ); muốn trọn vẹn phải thêm nhánh 'r' (PLAN.md)) ===
{
  const [mx, mz] = hbPt(359, -10);
  FEATURED_CLEAR.push([mx, mz, 9]);              // (-887.7,618.4) giữ miệng + lòng ngõ quang
  // góc TÂY ngõ: TRUNG QUÂN 5T + biển chồng tầng
  const tq = hbShopAt(...hbPt(368, -11.8), HB_RYN, 5.5, 9, 5, 0xf2efe6, ['TRUNG QUÂN — THIẾT BỊ Y TẾ', '#1f7a3c', '#ffffff', 32], 'hbt_trungquan326'); // (-896.9,618.4)
  if (tq) {
    const om = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.55), hbSign('OMRON', '#ffffff', '#1c56a0', 44));
    om.position.set(-1.4, 4.6, 4.5 + 0.1); tq.add(om);
    const n326 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), hbSign('326', '#ffffff', '#c62828', 64));
    n326.position.set(1.5, 5.8, 4.5 + 0.1); tq.add(n326);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.5), hbSign('ĐIỆN THOẠI 0912.045.496', '#1a0505', '#ff3b30', 30));
    led.position.set(0, 7.6, 4.5 + 0.1); tq.add(led);
  }
  // dãy y tế thứ 2 phía tây (fix h270 "dãy shophouse y tế", bearing 292)
  hbShopAt(...hbPt(374.5, -11.8), HB_RYN, 5.5, 9, 4, 0xeef2f4, ['DỤNG CỤ Y TẾ — MÁY ĐO HUYẾT ÁP', '#1c56a0', '#ffffff', 30], 'hbt_dungcuyte'); // (-903.2,619.7)
  // góc ĐÔNG ngõ: nhà cam 4T (ảnh h000 bên phải miệng ngõ)
  hbShopAt(...hbPt(351, -12.3), HB_RYN, 8, 10, 4, 0xd98e4a, null, 'hbt_nhacam326');                                          // (-880.3,614.5)
  // 2 nhà ống 4-5T TRONG ngõ, mặt quay vào lòng ngõ (fix h0 "shophouse hai bên ngõ")
  hbShopAt(-895.7, 606.4, 1.773, 8, 6, 5, 0xf4f2ec, null, 'hbt_ngo326_tay');   // bờ tây ngõ, mặt quay ĐÔNG
  hbShopAt(-884.9, 604.2, -1.368, 8, 6, 4, 0xe9e6df, null, 'hbt_ngo326_dong'); // bờ đông ngõ, mặt quay TÂY
  // biển xanh 'Ngõ 326' trên cột tại góc tây miệng ngõ (ảnh h000/h270)
  {
    const [px, pz] = hbPt(363, -6); const py = groundHeight(px, pz);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.2, 5), mat(0x5a6068));
    post.position.set(px, py + 1.6, pz); post.castShadow = true; scene.add(post);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55), hbSign('Ngõ 326 HAI BÀ TRƯNG', '#1c56a0', '#ffffff', 34));
    sg.position.set(px, py + 3.0, pz); sg.rotation.y = HB_RYN; scene.add(sg);
    addCollider(px, pz, 0.15);
  }
}

// === (T5) TRỤ SỞ VÀNG + NHÀ GIÀN GIÁO + CHỢ ĂN UỐNG — BỜ NAM pano_281
//     (fix sev3 h90 "trụ sở vàng 2T, cổng sắt, tường rào, bốt bảo vệ" + h180
//      "nhà bê tông 3T đang thi công kèm giàn giáo" + sev2 h180 "cây thân lớn +
//      cụm chợ ăn uống dưới ô che". Audit_281: công sở vàng kem W22 2T, băng rôn
//      đỏ PCCC trên mặt tiền; ảnh h090/h180: rào + trụ cổng sẫm + bốt vàng, nhà
//      xám giàn giáo lưới, cây cổ thụ bồn tròn, BÚN CHẢ + MÁY TRỢ THÍNH + ô dù.
//      Bearing từ pano_281: trụ sở 119 (h90) — giàn giáo 155 / chợ ăn 202 (h180)) ===
{
  // trụ sở vàng 2T: nhà lùi sân 4m sau rào sắt sát vỉa hè
  const [bx, bz] = hbPt(338, 17);                // (-861.7,640.6)
  if (hbOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = HB_RYS;
    const W = 22, D = 12, H = 7.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), hbFacade('#e8c86a', '#6b5a33', 8, 2)); body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.7, D + 1.2), mat(0x8a6a4a)); roof.position.y = H + 0.35; g.add(roof);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(15, 0.8), hbSign('TÍCH CỰC THAM GIA PHONG TRÀO TOÀN DÂN PHÒNG CHÁY VÀ CHỮA CHÁY', '#c62828', '#ffe066', 24));
    ban.position.set(0, H - 0.9, D / 2 + 0.1); g.add(ban);
    // rào sắt + tường thấp chạy sát vỉa hè (local +Z = 9.7 trước mặt nhà)
    const wall = new THREE.Mesh(new THREE.BoxGeometry(24, 0.5, 0.25), mat(0xcfc7b0)); wall.position.set(0, 0.25, 9.7); g.add(wall);
    const fence = new THREE.Mesh(new THREE.BoxGeometry(24, 1.0, 0.07), mat(0x2f3438)); fence.position.set(0, 1.0, 9.7); g.add(fence);
    for (const px of [-2, 2]) {                  // 2 trụ cổng sẫm, cổng rộng 4m giữa rào
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.65, 2.2, 0.65), mat(0x4a4038)); p.position.set(px, 1.1, 9.7); g.add(p);
    }
    const booth = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.4, 1.8), mat(0xe0a83c)); booth.position.set(4.4, 1.2, 8.4); g.add(booth);
    const broof = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.18, 2.2), mat(0x8a6a4a)); broof.position.set(4.4, 2.5, 8.4); g.add(broof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'hbt_trusovang'; scene.add(g);
    for (const lx of [-8, 0, 8]) { const [cx, cz] = localPt(bx, bz, lx, 0, HB_RYS); addCollider(cx, cz, 6.5); }
    FEATURED_CLEAR.push([bx, bz, 20]);           // đuổi infill khỏi khuôn viên (bài học pano_019: cơ quan ≠ shophouse)
  }
  // nhà 3T ĐANG XÂY: thân bê tông xám + khung giàn giáo + lưới xanh
  const gg = hbShopAt(...hbPt(357.5, 11.8), HB_RYS, 8, 9, 3, 0x9aa29e, null, 'hbt_nhagiangiao'); // (-881.8,639.4)
  if (gg) {
    const sc = mat(0x8a8f92);
    for (const px of [-3.6, -1.2, 1.2, 3.6]) {   // 4 cột giáo + 3 thanh ngang
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 10.4, 0.07), sc); p.position.set(px, 5.2, 4.5 + 0.55); gg.add(p);
    }
    for (const py of [2.6, 5.9, 9.2]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.07, 0.07), sc); h.position.set(0, py, 4.5 + 0.55); gg.add(h);
    }
    const net = new THREE.Mesh(new THREE.PlaneGeometry(7.9, 9.6), new THREE.MeshLambertMaterial({ color: 0x86a888, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
    net.position.set(0, 5.3, 4.5 + 0.62); gg.add(net);
  }
  // cây thân lớn bồn tròn trên vỉa hè (ảnh h180 — che một phần nhà giàn giáo)
  {
    const [tx, tz] = hbPt(362, 6.7); const ty = groundHeight(tx, tz); // (-887.3,635.3)
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.5, 10), mat(0xb8b2a2)); bowl.position.set(tx, ty + 0.25, tz); scene.add(bowl);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, 7, 7), mat(0x6b4a2f)); trunk.position.set(tx, ty + 3.5, tz); trunk.castShadow = true; scene.add(trunk);
    const can = new THREE.Mesh(new THREE.SphereGeometry(4.4, 8, 6), mat(0x3f6f3a)); can.position.set(tx, ty + 8.6, tz); can.castShadow = true; scene.add(can);
    addCollider(tx, tz, 0.6);
  }
  // cụm chợ ăn uống dưới ô che (BÚN CHẢ + MÁY TRỢ THÍNH) chiếm vỉa hè trước dãy nhà
  {
    const g = new THREE.Group(); g.name = 'hbt_choanuong326'; scene.add(g);
    for (const [sp, off, col] of [[369, 9, 0xc23b3b], [373, 8.5, 0x2e6fa8]]) {
      const [ux, uz] = hbPt(sp, off); const uy = groundHeight(ux, uz);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.0, 8), mat(col)); um.position.set(ux, uy + 2.3, uz); um.castShadow = true; g.add(um);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5), mat(0x777777)); up.position.set(ux, uy + 1.15, uz); g.add(up);
      const tb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.7), mat(0x9a8a6a)); tb.position.set(ux + 0.3, uy + 0.3, uz + 0.3); g.add(tb);
      addCollider(ux, uz, 0.4);
    }
    const [px, pz] = hbPt(367, 7.8); const py = groundHeight(px, pz);
    const bc = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), hbSign('BÚN CHẢ', '#c62828', '#ffe066', 52));
    bc.position.set(px, py + 1.6, pz); bc.rotation.y = HB_RYS; g.add(bc);
    const [qx, qz] = hbPt(376, 7.8); const qy = groundHeight(qx, qz);
    const tt = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.55), hbSign('MÁY TRỢ THÍNH', '#1a0505', '#ff3b30', 40));
    tt.position.set(qx, qy + 1.6, qz); tt.rotation.y = HB_RYS; g.add(tt);
  }
}

// === (T6) HÀNH LANG NHÀ ỐNG LIỀN KỀ + HÀNG CÂY — 2 BỜ s∈[222,404]
//     (fix sev3 lấp dãy 2-4T liên tục cả 4 pano: 278 h90/h270, 279 h90/h270,
//      280 h90/h270, 281 h270 + sev2 hàng cây bàng/xà cừ 278 h90, 279 h270.
//      Tương đương shophouse_infill (world.js:2811-2879) nhưng NGOÀI vành 830m —
//      generator gốc dừng ở 830 (line 2818) nên tự viết row ở đây. PHẢI DÁN SAU
//      T1-T5: né công trình đích danh qua chính FEATURED_CLEAR (dist < r-3).
//      Chừa 2 miệng ngõ bắc: chợ Kỳ Đồng [311,322] + Ngõ 326 [353.5,364.5].
//      1 mesh vertex-color (~60-70 lô) + 2 mesh cây, mỗi lô addCollider +
//      FEATURED_CLEAR bán kính NHỎ (D/2+2) chỉ đuổi infill đè trực tiếp) ===
{
  const GAPS_N = [[311, 322], [353.5, 364.5]];
  const PAL = [[0.93, 0.90, 0.82], [0.90, 0.85, 0.70], [0.85, 0.87, 0.88], [0.80, 0.72, 0.58],
    [0.94, 0.93, 0.90], [0.72, 0.78, 0.74], [0.88, 0.78, 0.62], [0.76, 0.80, 0.86]];
  const SGN = [[0.76, 0.16, 0.16], [0.11, 0.34, 0.63], [0.12, 0.48, 0.24], [0.85, 0.53, 0.16], [0.15, 0.15, 0.17]];
  const GLA = [0.45, 0.56, 0.62], SHF = [0.22, 0.23, 0.25], RAI = [0.35, 0.37, 0.40], ROF = [0.72, 0.70, 0.64];
  const cb = (w, h, d, x, y, z, rgb, out) => {
    const g = new THREE.BoxGeometry(w, h, d); const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.translate(x, y, z); out.push(g);
  };
  const lots = [], trunkG = [], canG = [];
  let seed = 7;
  for (const side of [1, -1]) {
    let d = 222;
    while (d < 404) {
      seed++;
      const W = 4.2 + hbRnd(seed) * 1.4, D = 7 + hbRnd(seed * 3 + 1) * 2;
      if (side < 0) {                            // chừa miệng ngõ (chỉ bờ bắc)
        const gap = GAPS_N.find(([a, b]) => d + W > a && d < b);
        if (gap) { d = gap[1]; continue; }
      }
      const sC = d + W / 2;
      const [gx, gz] = hbPt(sC, side * (7.3 + D / 2));
      let blocked = !hbOK(gx, gz);
      if (!blocked) for (const f of FEATURED_CLEAR) {          // né đích danh T1-T5 (và cũ)
        const rr = Math.max(f[2] - 5.5, 4);      // -5.5: nửa featured ≤4 + nửa lô 2.4 vẫn không chồng, tường phố kín hơn
        if ((gx - f[0]) ** 2 + (gz - f[1]) ** 2 < rr * rr) { blocked = true; break; }
      }
      if (blocked) { d += 2.2; continue; }
      const FL = 2 + ((hbRnd(seed * 7 + 2) * 3) | 0), H = FL * 3.3;   // 2-4 tầng (pano: phố 3-4T)
      const wall = PAL[(seed * 5) % PAL.length], sg = SGN[(seed * 11) % SGN.length];
      const parts = [];
      cb(W, H, D, 0, H / 2, 0, wall, parts);                          // thân
      cb(W + 0.06, 3.05, D + 0.06, 0, 1.525, 0, SHF, parts);          // trệt tối cửa cuốn/kính
      cb(W * 0.98, 0.95, 0.3, 0, 3.55, D / 2 - 0.02, sg, parts);      // băng biển hiệu màu
      for (let f = 1; f < FL; f++) {
        cb(W * 0.62, 1.35, 0.08, 0, f * 3.3 + 1.7, D / 2 + 0.03, GLA, parts);
        if (hbRnd(seed * 13 + f) < 0.55) {                            // ban công lan can
          cb(W * 0.8, 0.1, 0.8, 0, f * 3.3 + 0.08, D / 2 + 0.32, RAI, parts);
          cb(W * 0.8, 0.75, 0.08, 0, f * 3.3 + 0.6, D / 2 + 0.68, RAI, parts);
        }
      }
      cb(W + 0.3, 0.35, D + 0.3, 0, H + 0.17, 0, ROF, parts);         // mái bằng
      const merged = mergeGeometries(parts); parts.forEach((p) => p.dispose());
      merged.applyMatrix4(new THREE.Matrix4().makeTranslation(gx, groundHeight(gx, gz), gz)
        .multiply(new THREE.Matrix4().makeRotationY(side > 0 ? HB_RYS : HB_RYN)));
      lots.push(merged);
      addCollider(gx, gz, Math.max(W, D) * 0.5);
      FEATURED_CLEAR.push([gx, gz, D / 2 + 2]);  // chỉ đuổi block_infill/nhà rời đè trực tiếp
      if (lots.length > 120) break;
      d += W + 0.12;
    }
  }
  if (lots.length) {
    const m = new THREE.Mesh(mergeGeometries(lots), new THREE.MeshLambertMaterial({ vertexColors: true }));
    lots.forEach((g) => g.dispose());
    m.castShadow = true; m.receiveShadow = true; m.name = 'hbt_row_west'; scene.add(m);
  }
  // hàng cây bóng mát 2 vỉa hè (ảnh: bàng/xà cừ tán lớn, ~10m/cây, off 6.35m)
  for (const side of [1, -1]) {
    for (let s = 226; s <= 400; s += 10.5) {
      if (side < 0 && GAPS_N.some(([a, b]) => s > a - 2 && s < b + 2)) continue;
      const js = s + (hbRnd(s * 17 + side) - 0.5) * 2.4;
      const [tx, tz] = hbPt(js, side * 6.35);
      if (!hbOK(tx, tz)) continue;
      const ty = groundHeight(tx, tz), sc = 0.85 + hbRnd(js * 3) * 0.5;
      const tr = new THREE.CylinderGeometry(0.16 * sc, 0.24 * sc, 4.2 * sc, 6); tr.translate(tx, ty + 2.1 * sc, tz); trunkG.push(tr);
      const cn = new THREE.SphereGeometry(2.6 * sc, 7, 5); cn.translate(tx, ty + 5.1 * sc, tz); canG.push(cn);
      addCollider(tx, tz, 0.35);
    }
  }
  if (trunkG.length) {
    const t = new THREE.Mesh(mergeGeometries(trunkG), mat(0x6b4a2f)); trunkG.forEach((g) => g.dispose());
    t.castShadow = true; t.name = 'hbt_trees_trunk'; scene.add(t);
    const c = new THREE.Mesh(mergeGeometries(canG), mat(0x4a7a40)); canG.forEach((g) => g.dispose());
    c.castShadow = true; c.name = 'hbt_trees_canopy'; scene.add(c);
  }
}



  // ===== CELL_BAC: 15 block khu Hạ Lý/Thượng Lý/nút cầu HVT (agent nháp + smoke-run, helper bc* riêng) =====
// ============================================================================
// NHÁP 15 KHỐI — MẶT TRẬN BẮC (32 pano 0.4-2.5, khu Hạ Lý/Thượng Lý bắc Tam Bạc
// + trục Hoàng Văn Thụ + nút cầu HVT + dải cảng đông cầu).
// Nguồn: SP/cells3.json[BAC] + compare_full_sol56 + audit_done.json + ẢNH THẬT
// (đã xem 12 pano × 2 heading: 305,331,334,533,548,547,549,219,218,423,420,499,
//  304,282,519). Terrain probe: mọi vị trí đặt đều groundHeightNoDeck≈2.0 (đã
//  kiểm); pano_383 khu (-460,-951) là NƯỚC trong game (lòng Cấm lệch) — KHÔNG
//  đặt gì ở đó.
//
// VỊ TRÍ DÁN: js/world.js, CUỐI khối "CÔNG TRÌNH ĐẶC TRƯNG dải trung tâm"
// (sau các block lm_drafts lô 2) — SAU khai báo FEATURED_CLEAR/nearFeatured,
// TRƯỚC khối nhà OSM + shophouse, để FEATURED_CLEAR.push() đuổi nhà tự sinh.
//
// Tọa độ đã DỜI KHỎI TIM ĐƯỜNG theo quy tắc: chiếu pano lên đoạn ROADS_DT gần
// nhất, đẩy pháp tuyến = nửa_lòng (p6.5/s5/t4/r2.75) + 2.3 vỉa hè + D/2 (+sân),
// dịch dọc phố cho khớp bucket heading (bearing ghi trong comment từng khối).
// Scope giả định: THREE, mat, makeTex, sharedMats, addCollider, FEATURED_CLEAR,
// groundHeight, groundHeightNoDeck, isWater, localPt, scene, mergeGeometries.
// ============================================================================

// === HELPER CHUNG MẶT TRẬN BẮC (dán 1 LẦN trước các block) ===
const bcSign = (txt, bg, fg = '#ffffff', px = 52) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 26);
  }),
});
const bcFacade = (baseCss, winCss, cols, rows) => {
  const t = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.16, my + r * ch + ch * 0.16, cw * 0.68, ch * 0.66);
    }
  });
  return new THREE.MeshLambertMaterial({ map: t });
};
const bcOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - 2.0) < 0.45 && !isWater(x, z);
// cây tán rộng đơn giản (trunk + 2 cầu lá) — thêm vào group cha tại local (lx,lz)
const bcTree = (parent, lx, lz, h = 7, r = 3.2) => {
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, h * 0.55, 6), sharedMats.trunk);
  tr.position.set(lx, h * 0.275, lz); parent.add(tr);
  const c1 = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), sharedMats.leafDark);
  c1.position.set(lx, h * 0.75, lz); parent.add(c1);
  const c2 = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 8, 6), sharedMats.leafDark);
  c2.position.set(lx + r * 0.5, h * 0.9, lz + r * 0.3); parent.add(c2);
};
// cau vua (thân cao trắng xám + chùm lá)
const bcPalm = (parent, lx, lz, h = 9) => {
  const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, h, 6), mat(0xb9b4a6));
  tr.position.set(lx, h / 2, lz); parent.add(tr);
  for (let i = 0; i < 5; i++) {
    const fr = new THREE.Mesh(new THREE.ConeGeometry(0.22, 2.6, 4), sharedMats.leafDark);
    const a = i * Math.PI * 2 / 5;
    fr.position.set(lx + Math.cos(a) * 0.9, h + 0.35, lz + Math.sin(a) * 0.9);
    fr.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15); parent.add(fr);
  }
};

// === (B1) CỔNG NHÀ MÁY X46 - HẢI QUÂN, 35 Phan Đình Phùng (pano_305 = 0.4,
//     TỆ NHẤT toàn dải: 4 fix sev3. Ảnh 305_h000+h090: tường vàng đậm dọc bờ
//     BẮC đường #245(t), trụ cổng ốp granite có Ô ĐÈN LỒNG trên đỉnh, cổng sắt
//     xám, bốt gác xanh mint mái chóp, biển đá 'NHÀ MÁY X46', băng rôn đỏ
//     'DOANH TRẠI QĐND VN', nhà Pháp 2T vàng kem hành lang VÒM + lan can trắng
//     phía sau, cau + hoa giấy. Đặt cổng ở (-617.4,-782.8) = node bend #245
//     (-619,-775) + pháp tuyến bắc 8m; bearing từ pano ≈ 1° (bucket h0 ✓);
//     tường theo hướng đoạn (-862,-825)->(-619,-775), ry=-0.2014) ===
{
  const gx = -617.4, gz = -782.8, ry = -0.2014;
  if (bcOK(gx, gz)) {
    const g = new THREE.Group(); g.position.set(gx, groundHeight(gx, gz), gz); g.rotation.y = ry;
    const ochre = mat(0xc99a3f);
    for (const sx of [-19, 19]) {                          // 2 cánh tường vàng, chừa cổng 8m
      const w = new THREE.Mesh(new THREE.BoxGeometry(30, 2.6, 0.35), ochre);
      w.position.set(sx, 1.3, 0); g.add(w);
    }
    for (const sx of [-4, 4]) {                            // trụ granite + ô đèn lồng đặc trưng
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.15, 4.6, 1.15), mat(0x74777b));
      p.position.set(sx, 2.3, 0); g.add(p);
      const lan = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.9, 0.95), mat(0xd7d9d6));
      lan.position.set(sx, 5.1, 0); g.add(lan);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.18, 1.25), mat(0x5f6266));
      cap.position.set(sx, 5.65, 0); g.add(cap);
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(7.6, 2.3, 0.12), mat(0x5a6a72)); // cổng sắt xám
    gate.position.set(0, 1.15, 0.12); g.add(gate);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.5, 2.2), mat(0x9fb8ad)); // bốt gác mint
    booth.position.set(-7.5, 1.25, -2.6); g.add(booth);
    const bRoof = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.9, 4), mat(0x8a8f92));
    bRoof.position.set(-7.5, 2.95, -2.6); bRoof.rotation.y = Math.PI / 4; g.add(bRoof);
    // biển đá granite 3 dòng trên bệ gạch đỏ (đông cổng, như ảnh h090)
    const plaqueTex = new THREE.MeshLambertMaterial({ map: makeTex(512, 160, (c, w, h) => {
      c.fillStyle = '#565a5e'; c.fillRect(0, 0, w, h); c.fillStyle = '#e8c96a';
      c.textAlign = 'center'; c.font = 'bold 40px system-ui';
      c.fillText('NHÀ MÁY X46 - HẢI QUÂN', w / 2, 46, w - 20);
      c.font = 'bold 28px system-ui'; c.fillText('CÔNG TY TNHH MTV', w / 2, 92, w - 20);
      c.fillText('ĐÓNG VÀ SỬA CHỮA TÀU HẢI LONG', w / 2, 130, w - 20);
    }) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.5, 0.5), mat(0x8e3b2e));
    base.position.set(13, 0.25, 0.35); g.add(base);
    const plq = new THREE.Mesh(new THREE.BoxGeometry(6, 1.9, 0.25), plaqueTex);
    plq.position.set(13, 1.45, 0.35); g.add(plq);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.05),
      bcSign('DOANH TRẠI QUÂN ĐỘI NHÂN DÂN VIỆT NAM', '#b01f1f', '#ffd21a', 40));
    ban.position.set(-12, 3.5, 0.2); g.add(ban);
    // nhà Pháp 2T vàng kem hành lang vòm + lan can con tiện trắng (sau tường 22m)
    const fb = new THREE.Mesh(new THREE.BoxGeometry(36, 7.2, 12), bcFacade('#f3e0b0', '#7a5c3a', 10, 2));
    fb.position.set(2, 3.6, -22); g.add(fb);
    const balu = new THREE.Mesh(new THREE.BoxGeometry(36.2, 0.55, 12.2), mat(0xf5f2ea));
    balu.position.set(2, 7.5, -22); g.add(balu);
    const fRoof = new THREE.Mesh(new THREE.BoxGeometry(37, 0.6, 13), mat(0xb8b2a2));
    fRoof.position.set(2, 8.05, -22); g.add(fRoof);
    bcPalm(g, -6, -12, 8); bcPalm(g, 9, -13, 9); bcTree(g, 22, -10, 8, 3.6);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'x46_gate'; scene.add(g);
    for (const lx of [-24, -12, 12, 24]) { const [cx, cz] = localPt(gx, gz, lx, 0, ry); addCollider(cx, cz, 5.5); }
    { const [cx, cz] = localPt(gx, gz, 2, -22, ry); addCollider(cx, cz, 9); addCollider(cx + 12, cz, 8); FEATURED_CLEAR.push([cx, cz, 26]); }
    FEATURED_CLEAR.push([gx, gz, 30]);
  }
}

// === (B2) PHỐ THUYỀN TAM BẠC — dải bờ TÂY ngõ Tam Bạc (road#322):
//     lều/nhà thuyền bạt xanh-cam trên bãi bùn + RÀO SẮT HOA VĂN VÒNG TRÒN +
//     thùng phuy xanh + cây cổ thụ rợp tán (pano_334 h0 'phố thuyền', 519 h180,
//     331 h270, 332/384 fix tree/rail sev2-3 — 7 pano cùng dải 0.6-1.8 điểm.
//     Ảnh 334_h000: dãy thuyền-lều mái bạt sát mép bùn; 331_h270/519_h180: rào
//     vòng tròn + chậu cảnh + lều tôn. Probe: nước bắt đầu 15-30m tây tim đường
//     → rào ở +7.5m, lều dò NoDeck<1.75 trong 15..32m) ===
{
  const PTS = [[-536, -904], [-503, -821], [-426, -725]];   // polyline #322 (s)
  const g = new THREE.Group(); g.name = 'tambac_phothuyen'; g.position.set(0, 0, 0);
  const ringG = [], postG = [], railG = [];
  const tarps = [mat(0x2f6db5), mat(0x3f8f5a), mat(0xd9822b)];
  const hull = mat(0x6b5136), skin = mat(0xc9c4b8);
  let shackCount = 0, colStep = 0;
  for (let s = 0; s < PTS.length - 1; s++) {
    const [ax, az] = PTS[s], [bx, bz] = PTS[s + 1];
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const wx = -uz, wz = ux;                                 // pháp tuyến TÂY (phía sông ✓ probe)
    for (let d = 6; d < L - 4; d += 6.5) {
      const px = ax + ux * d, pz = az + uz * d;
      // — rào sắt hoa văn vòng tròn ở +7.5m (chỉ trên đất) —
      const fx = px + wx * 7.5, fz = pz + wz * 7.5;
      if (groundHeightNoDeck(fx, fz) > 1.7) {
        const gy = groundHeight(fx, fz);
        const post = new THREE.BoxGeometry(0.09, 1.15, 0.09); post.translate(fx, gy + 0.575, fz); postG.push(post);
        for (const ry2 of [0.35, 1.05]) {
          const rail = new THREE.BoxGeometry(6.3, 0.05, 0.05);
          rail.rotateY(Math.atan2(-uz, ux)); rail.translate(fx, gy + ry2, fz); railG.push(rail);
        }
        for (const rr of [-2.1, 0, 2.1]) {
          const ring = new THREE.TorusGeometry(0.27, 0.03, 5, 12);
          ring.rotateY(Math.atan2(-uz, ux) + Math.PI / 2);
          ring.translate(fx + ux * rr, gy + 0.7, fz + uz * rr); ringG.push(ring);
        }
        if ((colStep++ % 2) === 0) addCollider(fx, fz, 1.1);
        FEATURED_CLEAR.push([fx + wx * 6, fz + wz * 6, 11]); // giữ dải bờ sạch nhà tự sinh
      }
      // — lều/nhà thuyền: điểm đầu tiên NoDeck<1.75 trong 14..42m tây —
      if (shackCount < 15 && (d % 13) < 6.5) {
        let sxp = null, szp = null, sh = 0;
        for (let off = 14; off <= 42; off += 1.5) {
          const tx = px + wx * off, tz = pz + wz * off, hh = groundHeightNoDeck(tx, tz);
          if (hh < 1.75 && hh > -1.4) { sxp = tx; szp = tz; sh = Math.max(hh, 0.1); break; }
        }
        if (sxp !== null) {
          const sg = new THREE.Group(); sg.name = 'tb_shack'; sg.position.set(sxp, sh, szp);
          sg.rotation.y = Math.atan2(-uz, ux) + (shackCount % 3 - 1) * 0.12;
          const b = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.9, 2.6), hull); b.position.y = 0.45; sg.add(b);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(4.0, 1.7, 2.3), skin); cab.position.y = 1.75; sg.add(cab);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.12, 2.8), tarps[shackCount % 3]);
          roof.position.y = 2.68; roof.rotation.z = 0.06; sg.add(roof);
          sg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          g.add(sg); shackCount++;
        }
      }
      // — cây cổ thụ tán rợp mỗi ~13m ở +4.5m —
      if ((d % 13) >= 6.5) {
        const tx = px + wx * 4.5, tz = pz + wz * 4.5;
        if (groundHeightNoDeck(tx, tz) > 1.7) {
          const tg = new THREE.Group(); tg.position.set(tx, groundHeight(tx, tz), tz);
          bcTree(tg, 0, 0, 8.5 + (d % 3), 4.2);
          tg.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.add(tg);
        }
      }
    }
  }
  // thùng phuy xanh Castrol xếp sát rào phía sông (ảnh 334_h000) — 2 cụm, dời
  // 9m khỏi tim #322 (nửa lòng s=5 + lề) và guard đất khô
  {
    const drumSpots = [];
    for (const [d0, s0] of [[16, 1], [34, 0]]) {             // [khoảng cách dọc đoạn, chỉ số đoạn]
      const [ax, az] = PTS[s0], [bx2, bz2] = PTS[s0 + 1];
      const L = Math.hypot(bx2 - ax, bz2 - az), ux = (bx2 - ax) / L, uz = (bz2 - az) / L;
      drumSpots.push([ax + ux * d0 - uz * 9, az + uz * d0 + ux * 9]);
    }
    for (const [dx0, dz0] of drumSpots) {
      if (!bcOK(dx0, dz0)) continue;
      for (let i = 0; i < 4; i++) {
        const dr = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.9, 8), i === 3 ? mat(0xb03028) : mat(0x1f7a3c));
        dr.position.set(dx0 + (i % 2) * 0.7, groundHeight(dx0, dz0) + 0.45, dz0 + Math.floor(i / 2) * 0.7);
        dr.castShadow = true; g.add(dr);
      }
      addCollider(dx0, dz0, 1.0);
    }
  }
  if (postG.length) {
    const pm = new THREE.Mesh(mergeGeometries(postG), mat(0x4c4f52)); pm.name = 'tb_fence_posts'; pm.castShadow = true; g.add(pm);
    const rm = new THREE.Mesh(mergeGeometries(railG), mat(0x4c4f52)); g.add(rm);
    const gm = new THREE.Mesh(mergeGeometries(ringG), mat(0x565a5e)); g.add(gm);
  }
  scene.add(g);
}

// === (B3) BON'S HOUSE + tập thể vàng lan can xanh — ngõ Tam Bạc bờ ĐÔNG
//     (pano_333 = 1.8 'Bon's House 3T mặt tối, biển chữ bạc' sev3; pano_334
//     h180 mặt sau; 333 h180 'tập thể vàng 4T lan can xanh'. Ảnh 334_h180:
//     nhà trắng hiện đại, mảng ốp đen, cửa kính, nền gạch đỏ, chậu cảnh.
//     Offset: bend #322 (-503,-821) + 9m dọc + 11.8m pháp tuyến ĐB;
//     Bon's (-488.2,-821.4), tập thể (-475.5,-807.2); ry=-0.895 (mặt về ngõ)) ===
{
  const ry = -0.895;                                        // mặt tiền quay TÂY-NAM về ngõ
  const bx = -488.2, bz = -821.4;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 8, D = 9, H = 9.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), mat(0xf2f1ec)); body.position.y = H / 2; g.add(body);
    const dark = new THREE.Mesh(new THREE.BoxGeometry(3.6, H, 0.14), mat(0x2e2c2a)); // mảng ốp sẫm
    dark.position.set(-2.1, H / 2, D / 2 + 0.06); g.add(dark);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 0.1), sharedMats.window);
    win.position.set(1.6, 7.0, D / 2 + 0.06); g.add(win);
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 0.1), sharedMats.window);
    door.position.set(1.4, 1.25, D / 2 + 0.06); g.add(door);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.85), bcSign("Bon's House", '#232120', '#d8d4c8', 46));
    sign.position.set(-2.1, 7.7, D / 2 + 0.16); g.add(sign);
    const apron = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.08, 2.4), mat(0x9e4a3a)); // nền gạch đỏ
    apron.position.set(0, 0.04, D / 2 + 1.3); g.add(apron);
    for (const px of [-3.2, 3.2]) {                          // chậu cảnh 2 bên cửa
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.24, 0.5, 6), mat(0x9e4a3a));
      pot.position.set(px, 0.33, D / 2 + 0.9); g.add(pot);
      const pl = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), sharedMats.leafDark);
      pl.position.set(px, 1.0, D / 2 + 0.9); g.add(pl);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'bons_house'; scene.add(g);
    addCollider(bx, bz, 5.2); FEATURED_CLEAR.push([bx, bz, 12]);
  }
  const tx = -475.5, tz = -807.2;                            // tập thể vàng 4T lan can xanh
  if (bcOK(tx, tz)) {
    const g = new THREE.Group(); g.position.set(tx, groundHeight(tx, tz), tz); g.rotation.y = ry;
    const W = 22, D = 10, H = 4 * 3.1;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bcFacade('#d9b348', '#6a5a35', 7, 4));
    body.position.y = H / 2; g.add(body);
    for (let f = 1; f < 4; f++) {                            // dải lan can xanh mỗi tầng
      const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.15, 0.55, 0.2), mat(0x2e7d4f));
      b.position.set(0, f * 3.1 + 0.5, D / 2 + 0.12); g.add(b);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.5, D + 0.8), mat(0xb8b2a2));
    roof.position.y = H + 0.25; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'tambac_tapthe_vang'; scene.add(g);
    for (const lx of [-7, 7]) { const [cx, cz] = localPt(tx, tz, lx, 0, ry); addCollider(cx, cz, 6); }
    FEATURED_CLEAR.push([tx, tz, 16]);
  }
}

// === (B4) BỂ BƠI HẠ LÝ — ngõ 80 Hạ Lý (pano_533=1.3 fix sev3 'tường tranh BƠI
//     HẠ LÝ + Hikawa + trạm biến áp + cau vua + chòi bảo vệ'; pano_548=1.3 fix
//     sev3 'cổng sắt, mái tôn xanh, khối 5 tầng, băng rôn'. Ảnh 533_h090: tường
//     trắng vẽ vịnh Hạ Long chữ đỏ BƠI HẠ LÝ, bốt trắng, cột biến áp lớn, hàng
//     cau; 548_h000: cổng + băng rôn đỏ + bạt xanh + khối sẫm 5T sau. Vị trí:
//     sân TÂY ngõ #409 (x=-594): tường tranh chạy N-S tại x=-600 z -320..-296
//     (533 đứng TRONG sân x-602.4 → tường ở bearing 90 ✓; cổng z-323 → từ 548
//     bearing ≈ -10° bucket h0 ✓)) ===
{
  if (bcOK(-607, -308)) {
    const g = new THREE.Group(); g.position.set(0, 0, 0); g.name = 'beboi_haly';
    const gy = groundHeight(-600, -308);
    // tường tranh 24m (2 mặt cùng texture — nhìn từ sân lẫn ngõ)
    const muralTex = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: makeTex(1024, 128, (c, w, h) => {
      const sky = c.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#bfe3f2'); sky.addColorStop(0.65, '#7fc4e0'); sky.addColorStop(1, '#3f9ec4');
      c.fillStyle = sky; c.fillRect(0, 0, w, h);
      c.fillStyle = '#8a7355';                              // núi đá vịnh Hạ Long
      for (let i = 0; i < 7; i++) { const x0 = 60 + i * 140, r = 34 + (i % 3) * 16; c.beginPath(); c.ellipse(x0, h - 26, r, r * 1.5, 0, Math.PI, 0); c.fill(); }
      c.fillStyle = '#6d4c2f'; c.beginPath();               // cánh buồm
      c.moveTo(500, h - 30); c.lineTo(540, 18); c.lineTo(548, h - 30); c.fill();
      c.fillStyle = '#c8281e'; c.font = 'bold 64px system-ui'; c.textAlign = 'left';
      c.fillText('BƠI HẠ LÝ', 30, 70);
    }) });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.5, 24), muralTex);
    wall.position.set(-600, gy + 1.25, -308); g.add(wall);
    // cổng: 2 trụ xanh ngọc + cánh lưới + băng rôn đỏ (bắc tường, z -323)
    for (const pz of [-326, -320.5]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.0, 0.5), mat(0x5fa8a0));
      p.position.set(-600, gy + 1.5, pz); g.add(p);
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.0, 5.0), mat(0x7d8489));
    mesh.position.set(-600, gy + 1.1, -323.2); g.add(mesh);
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.95),
      bcSign('BỂ BƠI HẠ LÝ TƯNG BỪNG KHAI TRƯƠNG', '#c22020', '#ffd21a', 40));
    ban.position.set(-599.6, gy + 3.5, -323.2); ban.rotation.y = Math.PI / 2; g.add(ban);
    // lều bạt xám che lối vào + bốt bảo vệ trắng (ảnh 533/548)
    const shed = new THREE.Mesh(new THREE.BoxGeometry(6, 2.5, 4), mat(0x8f9296));
    shed.position.set(-605.5, gy + 1.25, -324); g.add(shed);
    const tarp = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 5), mat(0x4a7fb5));
    tarp.position.set(-605.5, gy + 2.7, -324); tarp.rotation.z = 0.05; g.add(tarp);
    const booth = new THREE.Mesh(new THREE.BoxGeometry(1.9, 2.4, 1.9), mat(0xe8e6e0));
    booth.position.set(-601.6, gy + 1.2, -298.5); g.add(booth);
    const bo = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 4), mat(0x8a8f92));
    bo.position.set(-601.6, gy + 2.75, -298.5); bo.rotation.y = Math.PI / 4; g.add(bo);
    // cột điện + giàn biến áp (ảnh 533_h090 — đứng mép sân ĐB)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 9, 6), mat(0x9a9891));
    pole.position.set(-590.8, gy + 4.5, -295.5); g.add(pole);
    const tf = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.0), mat(0x5f6266));
    tf.position.set(-590.8, gy + 6.2, -295.5); g.add(tf);
    // biển Hikawa/NGON xanh lá (ảnh 548 phải)
    const hik = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.6), bcSign('NPP ĐIỀU HÒA HIKAWA - TÚ LƯU', '#1f7a4c', '#eef4ea', 34));
    hik.position.set(-589.5, gy + 2.2, -299); hik.rotation.y = -Math.PI / 2; g.add(hik);
    // hàng cau vua dọc tường + khối tập thể 5T xanh ghi mái tôn xanh phía sau
    for (const pz of [-318, -311, -304, -297]) {
      const pg = new THREE.Group(); pg.position.set(-601.8, gy, pz);
      bcPalm(pg, 0, 0, 9.5); g.add(pg);
    }
    const tp = new THREE.Group(); tp.position.set(-621, groundHeight(-621, -310), -310); tp.rotation.y = Math.PI / 2;
    const tw = new THREE.Mesh(new THREE.BoxGeometry(24, 15.5, 10), bcFacade('#9fb6c4', '#3f4a52', 8, 5));
    tw.position.y = 7.75; tp.add(tw);
    const troof = new THREE.Mesh(new THREE.BoxGeometry(25, 0.5, 11), mat(0x2f6d5a));
    troof.position.y = 15.9; tp.add(troof);
    g.add(tp);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    addCollider(-600, -308, 2.2); addCollider(-600, -316, 2.2); addCollider(-605.5, -324, 3.4);
    addCollider(-601.6, -298.5, 1.4); addCollider(-621, -310, 12.5);
    FEATURED_CLEAR.push([-606, -310, 20]); FEATURED_CLEAR.push([-621, -310, 16]);
  }
}

// === (B5) LÔ ĐẤT TRỐNG NGÕ 80 — tường rào cũ + CỔNG TÔN ĐỎ GRAFFITI bờ ĐÔNG
//     (pano_549=1.3 'tường tôn đỏ hoen gỉ chữ sơn tay + trái tim, lô cỏ rào
//     thép gai' sev3; pano_532=1.0 'tường bê tông cũ BÁN ĐẤT/CẤM ĐỔ RÁC + chậu
//     rau chân tường' sev3. Ảnh 549_h090 khớp. Mặt tường x=-588.5 (tim #409
//     x=-594 + 2.75 + 2.3); CHỪA KHE z -269.5..-263.5 cho nhánh #565
//     (-595,-266)->(-506,-267) — KHÔNG chặn lòng đường) ===
{
  if (bcOK(-585, -270)) {
    const g = new THREE.Group(); g.name = 'ngo80_lodat'; scene.add(g);
    const gy = groundHeight(-588.5, -270);
    const tinTex = new THREE.MeshLambertMaterial({ map: makeTex(512, 128, (c, w, h) => {
      c.fillStyle = '#7e3a26'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#93502f'; for (let x = 0; x < w; x += 18) c.fillRect(x, 0, 7, h); // sóng tôn + gỉ
      c.fillStyle = '#e8c22a'; c.font = 'bold 34px system-ui'; c.textAlign = 'center';
      c.fillText('KHÔNG ĐỂ XE Ở ĐÂY', w / 2, 46);
      c.fillText('XE ÔTÔ RA VÀO NGÕ', w / 2, 92);
      c.fillStyle = '#e8d9a8'; c.beginPath(); c.arc(w - 52, 62, 16, 0, 7); c.fill(); // "trái tim"
    }) });
    // 2 vạt tôn đỏ 2 bên khe nhánh #565 + trụ
    for (const [zc, len] of [[-272.7, 6.4], [-261.2, 4.6]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, len), tinTex);
      t.position.set(-588.5, gy + 1.1, zc); g.add(t);
      addCollider(-588.5, zc, len / 2 + 0.2);
    }
    for (const pz of [-269.5, -263.5]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.5, 0.4), mat(0x6f6a63));
      p.position.set(-588.5, gy + 1.25, pz); g.add(p);
    }
    // tường bê tông cũ graffiti BÁN ĐẤT (nam khe, z -292..-276)
    const oldTex = new THREE.MeshLambertMaterial({ map: makeTex(512, 128, (c, w, h) => {
      c.fillStyle = '#9a9891'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#8a877e'; c.fillRect(0, h - 34, w, 34);
      c.fillStyle = '#b23a2a'; c.font = 'bold 36px system-ui'; c.textAlign = 'left';
      c.fillText('BÁN ĐẤT 09I4 999...', 18, 52);
      c.fillStyle = '#3a5f9e'; c.font = 'bold 26px system-ui';
      c.fillText('CẤM ĐỔ RÁC', 300, 96);
    }) });
    const ow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.1, 16), oldTex);
    ow.position.set(-588.5, gy + 1.05, -284); g.add(ow);
    addCollider(-588.5, -284, 8.2);
    // hàng chậu rau/cảnh dọc chân tường (pano_532) — merge 10 chậu
    const potG = [], leafG = [];
    for (let i = 0; i < 10; i++) {
      const pz = -290.5 + i * 1.5;
      const pot = new THREE.CylinderGeometry(0.22, 0.17, 0.4, 6); pot.translate(-589.3, gy + 0.2, pz); potG.push(pot);
      const lf = new THREE.SphereGeometry(0.32, 5, 4); lf.translate(-589.3, gy + 0.62, pz); leafG.push(lf);
    }
    g.add(new THREE.Mesh(mergeGeometries(potG), mat(0x9e4a3a)));
    g.add(new THREE.Mesh(mergeGeometries(leafG), sharedMats.leafDark));
    // rào lưới B40 + dây gai (bắc khe, z -259..-247) + lô cỏ + cây
    const fPost = [];
    for (let pz = -259; pz >= -247; pz += 3) { const p = new THREE.BoxGeometry(0.1, 1.9, 0.1); p.translate(-588.5, gy + 0.95, pz); fPost.push(p); }
    for (const ry2 of [0.5, 1.1, 1.7]) { const r = new THREE.BoxGeometry(0.05, 0.05, 12); r.translate(-588.5, gy + ry2, -253); fPost.push(r); }
    g.add(new THREE.Mesh(mergeGeometries(fPost), mat(0x7d8489)));
    const lot = new THREE.Mesh(new THREE.PlaneGeometry(22, 34), mat(0x6f8f4a));
    lot.rotation.x = -Math.PI / 2; lot.position.set(-576, gy + 0.03, -268); lot.receiveShadow = true; g.add(lot);
    const tg = new THREE.Group(); tg.position.set(-586.8, gy, -261.5); bcTree(tg, 0, 0, 9, 4.4); g.add(tg); // cây lớn trùm cổng
    const tg2 = new THREE.Group(); tg2.position.set(-577, gy, -252); bcTree(tg2, 0, 0, 6, 3); g.add(tg2);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    FEATURED_CLEAR.push([-585, -281, 12]); FEATURED_CLEAR.push([-585, -254, 10]);
  }
}

// === (B6) DÃY LIỀN KỀ HIỆN ĐẠI NGÕ 80 — bờ TÂY, 8 lô 6.5m z -202..-254
//     (pano_547=2.5 h270 sev3 'dãy 3-4T ô 6-7m'; 549 h180/h270 'nhà ống 4T';
//     530 h270 'cụm nhà 2-3T sân gạch'. Ảnh 547_h270: mái ngói đua che cổng,
//     cổng nan gỗ nâu đỏ / rào trắng, ốp nâu-xám-kem, ban công hoa. Tim #409
//     x=-594 → tâm nhà x = -594-(2.75+2.3+4.5) = -603.55, mặt về ĐÔNG ry=π/2.
//     Từ 547 (-595.6,-216.2): bearing lô giữa ≈ 270 ✓) ===
{
  const palette = [0xe8e4dc, 0xcfc8bd, 0xb9a48e, 0xd8d3c9];
  const gateM = [mat(0x7a4a2e), mat(0xf2f0ea), mat(0x5f6266)];
  for (let i = 0; i < 8; i++) {
    const bz = -202 - i * 6.6, bx = -603.55;
    if (!bcOK(bx, bz)) continue;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = Math.PI / 2;
    const FL = 3 + (i % 2), H = FL * 3.3, W = 6.2, D = 9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bcFacade('#' + palette[i % 4].toString(16).padStart(6, '0'), '#4a5258', 2, FL));
    body.position.y = H / 2; g.add(body);
    for (let f = 1; f < FL; f++) {                          // ban công nhô
      const bal = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.9), mat(0xdad5cb));
      bal.position.set(0, f * 3.3 + 0.1, D / 2 + 0.45); g.add(bal);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.7, 0.06), mat(0x6f6a63));
      rail.position.set(0, f * 3.3 + 0.55, D / 2 + 0.87); g.add(rail);
    }
    if (i % 2 === 0) {                                      // mái ngói đua che cổng (ảnh 547)
      const can = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, 0.14, 2.2), mat(0x8a6f52));
      can.position.set(0, 3.15, D / 2 + 1.0); can.rotation.x = 0.42; g.add(can);
    }
    const gate = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.1, 0.1), gateM[i % 3]); // cổng nan gỗ/rào trắng
    gate.position.set(-0.8, 1.05, D / 2 + 0.08); g.add(gate);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.4, D + 0.5), mat(0xb8b2a2));
    roof.position.y = H + 0.2; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'ngo80_lienke_' + i; scene.add(g);
    addCollider(bx, bz, 4.6); FEATURED_CLEAR.push([bx, bz, 7.5]);
  }
  // cau vua 2 bên + dây cờ đuôi nheo giăng ngang ngõ (đặc trưng pano_547)
  if (bcOK(-599, -220)) {
    const g = new THREE.Group(); g.position.set(0, 0, 0); g.name = 'ngo80_flags';
    const gy = groundHeight(-594, -220);
    bcPalm(g, -599.2, -212, 10); bcPalm(g, -588.8, -228, 9);
    g.children.forEach((c) => { c.position.y += gy; });
    const cols = ['#e33', '#3a7', '#fd2', '#37c', '#e70'];
    for (let i = 0; i < 11; i++) {
      const t = i / 10, fx = -599 + t * 10, sag = Math.sin(t * Math.PI) * 0.7;
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5),
        new THREE.MeshLambertMaterial({ color: cols[i % 5], side: THREE.DoubleSide }));
      fl.position.set(fx, gy + 4.6 - sag, -220); fl.rotation.y = Math.PI / 2; g.add(fl);
    }
    scene.add(g);
  }
}

// === (B7) THANG LONG HOTEL (SỐ 2 HOÀNG VĂN THỤ) + TIME COFFEE — bờ TÂY HVT
//     (pano_219=1.2, 2 fix sev3: 'hotel trắng 6T sảnh cột trụ cờ' h270 + 'TIME
//     COFFEE' — ảnh 219_h270: tân cổ điển TRẮNG, portico 2 cột tròn, hàng cờ
//     màu, chữ THANG LONG HOTEL; TIME COFFEE = 2T gạch đỏ sẫm bên phải(bắc).
//     Tim #178 x≈-55.2 tại z-772 → hotel (-88,-772) mặt ĐÔNG (sân đỗ trước);
//     bearing từ 219 ≈ 276° ✓ h270) ===
{
  const bx = -88, bz = -772;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(30, 13.6, 20), bcFacade('#f4f2ec', '#43525a', 7, 4));
    wing.position.y = 6.8; g.add(wing);
    const tower = new THREE.Mesh(new THREE.BoxGeometry(22, 28.8, 13), bcFacade('#f4f2ec', '#5a6a72', 8, 9));
    tower.position.set(0, 14.4, -3.5); g.add(tower);
    const tRoof = new THREE.Mesh(new THREE.BoxGeometry(23, 0.7, 14), mat(0xb8b2a2)); tRoof.position.set(0, 29.1, -3.5); g.add(tRoof);
    for (const sx of [-2.6, 2.6]) {                          // portico 2 cột tròn
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 5.6, 10), mat(0xf7f5ef));
      col.position.set(sx, 2.8, 12.2); g.add(col);
    }
    const ent = new THREE.Mesh(new THREE.BoxGeometry(10, 1.3, 4.4), mat(0xf4f2ec)); ent.position.set(0, 6.2, 11.4); g.add(ent);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.05), bcSign('THANG LONG HOTEL', '#f4f2ec', '#8a7635', 52));
    s1.position.set(0, 7.4, 13.6); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.6), bcSign('SỐ 2 HOÀNG VĂN THỤ - HẢI PHÒNG', '#f4f2ec', '#7a7d80', 30));
    s2.position.set(0, 8.25, 13.6); g.add(s2);
    const cols = ['#e33', '#c3d', '#fd2', '#3a7', '#37c', '#e70'];
    for (let i = 0; i < 6; i++) {                            // hàng cờ màu trên mái sảnh
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.8), new THREE.MeshLambertMaterial({ color: cols[i], side: THREE.DoubleSide }));
      fl.position.set(-7.5 + i * 3, 9.5, 12.8); g.add(fl);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'thanglong_hotel'; scene.add(g);
    for (const lz of [-8, 8]) { const [cx, cz] = localPt(bx, bz, 0, lz, Math.PI / 2); addCollider(cx, cz, 11); }
    FEATURED_CLEAR.push([bx, bz, 24]);
  }
  const tx = -82, tz = -790;                                 // TIME COFFEE 2T gạch nâu đỏ
  if (bcOK(tx, tz)) {
    const g = new THREE.Group(); g.position.set(tx, groundHeight(tx, tz), tz); g.rotation.y = Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 6.8, 10), mat(0x7e3b2c)); body.position.y = 3.4; g.add(body);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(11, 0.1, 2), mat(0x4c4f52)); aw.position.set(0, 3.1, 6); aw.rotation.x = 0.3; g.add(aw);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.0), bcSign('TIME COFFEE', '#2a2724', '#e8b64a', 52));
    s.position.set(0, 6.0, 5.08); g.add(s);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'time_coffee'; scene.add(g);
    addCollider(tx, tz, 6.5); FEATURED_CLEAR.push([tx, tz, 10]);
  }
}

// === (B8) VINAPHONE 3T XANH + GOODYEAR TRẦN KIÊN — bờ ĐÔNG HVT
//     (pano_219 h90 sev3 'tòa Vinaphone xanh 3T + Goodyear thấp kề bên';
//     pano_218 h90 'GOODYEAR'. Ảnh 219_h090: nhà 3T xanh dương trim kem, cột
//     ăng-ten mái, biển vinaphone + băng rôn Data; Goodyear = quán thấp biển
//     vàng chữ đen, bạt xanh. Tim #178 x≈-54.9 (z-764)/-55.9 (z-791) →
//     Vinaphone (-40,-764) bearing 104°✓, Goodyear (-38,-800) 112° từ 218 ✓) ===
{
  const bx = -40, bz = -764;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = -Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 10.2, 12), bcFacade('#2f6fb5', '#dfe8ee', 4, 3));
    body.position.y = 5.1; g.add(body);
    for (const fy of [3.4, 6.8]) { const belt = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.4, 12.2), mat(0xe8e2d2)); belt.position.y = fy; g.add(belt); }
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 8, 5), mat(0x8a8f92)); mast.position.set(3, 14.2, -2); g.add(mast);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.4), bcSign('vinaphone', '#1f66b0', '#ffffff', 56));
    s1.position.set(0, 9.2, 6.1); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(9, 0.9), bcSign('Nói tới Data - Phải là Vina', '#1f66b0', '#cfe3f5', 40));
    s2.position.set(0, 5.4, 6.1); g.add(s2);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'vinaphone_hvt'; scene.add(g);
    addCollider(bx, bz, 8); FEATURED_CLEAR.push([bx, bz, 12]);
  }
  const gx2 = -38, gz2 = -800;
  if (bcOK(gx2, gz2)) {
    const g = new THREE.Group(); g.position.set(gx2, groundHeight(gx2, gz2), gz2); g.rotation.y = -Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(14, 4.4, 10), mat(0xe3ddcf)); body.position.y = 2.2; g.add(body);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.2), bcSign('GOODYEAR — TRẦN KIÊN', '#f2c21a', '#20242a', 52));
    s.position.set(0, 3.9, 5.08); g.add(s);
    const aw = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 2.2), mat(0x2f6db5)); aw.position.set(0, 2.6, 6.1); aw.rotation.x = 0.32; g.add(aw);
    for (let i = 0; i < 3; i++) {                            // chồng lốp trước cửa
      const t = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 6, 12), mat(0x1e2124));
      t.rotation.x = Math.PI / 2; t.position.set(-4.5 + i * 1.1, 0.34 + (i % 2) * 0.26, 6.6); g.add(t);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'goodyear_trankien'; scene.add(g);
    addCollider(gx2, gz2, 7.5); FEATURED_CLEAR.push([gx2, gz2, 11]);
  }
}

// === (B9) MICHELIN CAR SERVICE / OTO XANH + NHÀ KHÁCH QUÂN KHU 3 — bờ TÂY HVT
//     (pano_218=2.0 h270 sev3 'showroom Michelin 2T gara mở + biển OTO XANH';
//     h180 'khối nhà khách 8T trắng'; đồng thời trả lời 329/330 h90-180 'tòa
//     trắng kem 9T nổi bật' nhìn từ nhánh cầu. Ảnh 218_h270: trệt gara MỞ, băng
//     xanh MICHELIN, mái deck sẫm, pylon đứng OTO XANH; sau lưng = tháp trắng
//     NHÀ KHÁCH QUÂN KHU 3. Tim #178 x≈-56.6 (z-812) → Michelin (-78,-812)
//     bearing 270 ✓; tháp (-104,-806)) ===
{
  const bx = -78, bz = -812;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = Math.PI / 2;
    const inner = new THREE.Mesh(new THREE.BoxGeometry(20, 3.2, 12), mat(0x2a2d31)); inner.position.set(0, 1.6, -1); g.add(inner);
    for (const sx of [-9, -3, 3, 9]) {                       // cột trệt gara mở
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), mat(0xd8d5cd));
      c.position.set(sx, 1.7, 6.7); g.add(c);
    }
    const up = new THREE.Mesh(new THREE.BoxGeometry(22, 3.4, 14), mat(0xf0eee8)); up.position.y = 5.1; g.add(up);
    const band = new THREE.Mesh(new THREE.PlaneGeometry(20, 1.5), bcSign('MICHELIN CAR SERVICE', '#1f4e9e', '#ffffff', 54));
    band.position.set(0, 3.9, 7.08); g.add(band);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(23, 0.6, 15), mat(0x33373c)); deck.position.y = 7.1; g.add(deck);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7.5, 0.5), mat(0x8a8f92)); pylon.position.set(12.2, 3.75, 6); g.add(pylon);
    const py1 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), bcSign('MICHELIN', '#1f4e9e', '#ffffff', 56)); py1.position.set(12.2, 6.4, 6.3); g.add(py1);
    const py2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.1), bcSign('OTO XANH', '#f2c21a', '#20242a', 56)); py2.position.set(12.2, 5.1, 6.3); g.add(py2);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'michelin_otoxanh'; scene.add(g);
    for (const lx of [-7, 7]) { const [cx, cz] = localPt(bx, bz, lx, 0, Math.PI / 2); addCollider(cx, cz, 7); }
    FEATURED_CLEAR.push([bx, bz, 16]);
  }
  const tx = -104, tz = -806;                                // tháp trắng 9T Nhà khách QK3
  if (bcOK(tx, tz)) {
    const g = new THREE.Group(); g.position.set(tx, groundHeight(tx, tz), tz); g.rotation.y = Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(26, 28.8, 16), bcFacade('#f2f0ea', '#5a6a72', 9, 9));
    body.position.y = 14.4; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(27, 0.7, 17), mat(0xb8b2a2)); roof.position.y = 29.15; g.add(roof);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.1), bcSign('NHÀ KHÁCH QUÂN KHU 3', '#f2f0ea', '#1f66b0', 44));
    s.position.set(0, 27.6, 8.1); g.add(s);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'nhakhach_qk3'; scene.add(g);
    for (const lx of [-8, 8]) { const [cx, cz] = localPt(tx, tz, lx, 0, Math.PI / 2); addCollider(cx, cz, 9); }
    FEATURED_CLEAR.push([tx, tz, 20]);
  }
}

// === (B10) TRỤ SỞ VINASHIP — bờ ĐÔNG HVT trước nút cầu vượt (pano_499=1.0,
//     fix sev3 'VINASHIP 2T dài mái xanh, hành lang trắng, cổng + rào gạch đỏ'.
//     Ảnh 499_h090: nhà 2T hồng nhạt, hành lang lan can trắng T2, mái tôn XANH
//     NHẠT có CHỮ VINASHIP TRẮNG trên mái, rào đá + song sắt, trụ cổng trắng,
//     cau vua. Tim #178 x≈-57.6 (z-843) → nhà (-22,-843) mặt TÂY; rào x=-46;
//     bearing từ 499 = 84.6° ✓ h90) ===
{
  const bx = -22, bz = -843;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = -Math.PI / 2;
    const W = 40, D = 13, H = 7.2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bcFacade('#e8a99a', '#6a4a42', 12, 2));
    body.position.y = H / 2; g.add(body);
    const balu = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.5, 0.25), mat(0xf5f2ea)); // lan can trắng hành lang T2
    balu.position.set(0, 4.4, D / 2 + 0.15); g.add(balu);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 1.0, D + 1.6), mat(0x9fc4d8)); roof.position.y = H + 0.5; g.add(roof);
    const rs = new THREE.Mesh(new THREE.PlaneGeometry(17, 1.7), bcSign('V I N A S H I P', '#9fc4d8', '#ffffff', 60));
    rs.position.set(0, H + 1.35, D / 2 - 1.2); rs.rotation.x = -0.5; g.add(rs);   // chữ trên mái nghiêng về phố
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'vinaship'; scene.add(g);
    for (const lx of [-12, 0, 12]) { const [cx, cz] = localPt(bx, bz, lx, 0, -Math.PI / 2); addCollider(cx, cz, 7.5); }
    FEATURED_CLEAR.push([bx, bz, 26]);
    // rào gạch đỏ + song sắt + trụ cổng trắng dọc x=-46 (z -860..-826, cổng z-843)
    const fg = new THREE.Group(); fg.position.set(0, 0, 0);
    const gy = groundHeight(-46, -843);
    for (const [zc, len] of [[-854.5, 11], [-831.5, 11]]) {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.7, len), mat(0x8e3b2e));
      base.position.set(-46, gy + 0.35, zc); fg.add(base);
      const iron = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, len), mat(0x3f4a52));
      iron.position.set(-46, gy + 1.15, zc); fg.add(iron);
      addCollider(-46, zc, len / 2);
    }
    for (const pz of [-848, -838]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 2.2, 0.6), mat(0xf2f0ea));
      p.position.set(-46, gy + 1.1, pz); fg.add(p);
    }
    const bb = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.5), bcSign('VINASHIP', '#b01f1f', '#ffd21a', 50));
    bb.position.set(-45.7, gy + 1.6, -851); bb.rotation.y = Math.PI / 2; fg.add(bb); // bảng đỏ trên rào
    for (const [px, pz, ph] of [[-43, -856, 9], [-43, -830, 10]]) {
      const pg = new THREE.Group(); pg.position.set(px, gy, pz);
      bcPalm(pg, 0, 0, ph); fg.add(pg);
    }
    fg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(fg);
  }
}

// === (B11) CÔNG SỞ 2T + SÂN BÓNG QUÂY LƯỚI — bờ ĐÔNG HVT giữa Goodyear và
//     VINASHIP (pano_218 h90 sev3 'công sở 2 tầng, sân lùi và sân bóng quây
//     lưới'. Ảnh 218_h090: nhà 2T kem hồng mái trắng dài, sân tennis lưới ĐEN
//     khung xanh trên tường gạch đỏ thấp. Nhà (-32,-826), sân (-31,-812)) ===
{
  const bx = -32, bz = -826;
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = -Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(24, 7.0, 10), bcFacade('#e8c8b8', '#5f5148', 8, 2));
    body.position.y = 3.5; g.add(body);
    const balu = new THREE.Mesh(new THREE.BoxGeometry(24.2, 0.45, 0.22), mat(0xf5f2ea));
    balu.position.set(0, 4.2, 5.15); g.add(balu);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(25, 0.6, 11), mat(0xd8d5cd)); roof.position.y = 7.3; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'congso_hvt'; scene.add(g);
    for (const lx of [-8, 8]) { const [cx, cz] = localPt(bx, bz, lx, 0, -Math.PI / 2); addCollider(cx, cz, 6); }
    FEATURED_CLEAR.push([bx, bz, 15]);
  }
  const cx0 = -31, cz0 = -812;                               // sân bóng quây lưới đen
  if (bcOK(cx0, cz0)) {
    const g = new THREE.Group(); g.position.set(cx0, groundHeight(cx0, cz0), cz0);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(20, 11), mat(0x2f6d4a));
    court.rotation.x = -Math.PI / 2; court.position.y = 0.04; court.receiveShadow = true; g.add(court);
    const baseW = new THREE.Mesh(new THREE.BoxGeometry(20, 0.5, 0.25), mat(0x8e3b2e));
    const netN = new THREE.Mesh(new THREE.BoxGeometry(20, 3.6, 0.06), new THREE.MeshLambertMaterial({ color: 0x1d2b22, transparent: true, opacity: 0.75 }));
    for (const s of [-1, 1]) {
      const b = baseW.clone(); b.position.set(0, 0.25, s * 5.5); g.add(b);
      const n = netN.clone(); n.position.set(0, 2.3, s * 5.5); g.add(n);
    }
    for (const s of [-1, 1]) {
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.5, 11), mat(0x8e3b2e)); b2.position.set(s * 10, 0.25, 0); g.add(b2);
      const n2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.6, 11), netN.material); n2.position.set(s * 10, 2.3, 0); g.add(n2);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.name = 'sanbong_hvt'; scene.add(g);
    addCollider(cx0, cz0 - 5.5, 2); addCollider(cx0, cz0 + 5.5, 2);
    FEATURED_CLEAR.push([cx0, cz0, 13]);
  }
}

// === (B12) ĐẢO GIAO THÔNG NÚT CẦU HVT: HÒN NON BỘ + topiary + TẬP THỂ CŨ 5T
//     (pano_304=1.0: 2 fix sev3 'đảo trung tâm hòn non bộ lớn + bonsai/topiary'
//     h180 + 'chung cư cũ 5T dài ~40m' h180; pano_217 h90 'quảng trường cây
//     cảnh'. Ảnh 304_h180: núi đá cảnh cao ~8m trên đảo cỏ viền đá, cây topiary
//     tròn; sau = tập thể 5T trắng xám. Khe trống giữa các nhánh #244/#435/
//     #300/#359 đã đo: đảo (-110,-915) cách mọi tim đường ≥30m — bearing từ
//     304 = 178° ✓ h180; tập thể (-125,-893) cách #300 21.8m, bearing 198°) ===
{
  const ix = -110, iz = -915;
  if (bcOK(ix, iz)) {
    const g = new THREE.Group(); g.position.set(ix, groundHeight(ix, iz), iz);
    const curb = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 0.35, 22), mat(0x8d8a82)); curb.position.y = 0.18; g.add(curb);
    const grass = new THREE.Mesh(new THREE.CylinderGeometry(11.2, 11.2, 0.35, 22), mat(0x6f9a4f)); grass.position.y = 0.24; g.add(grass);
    const rockM = mat(0x8d8a82, { flatShading: true });
    const rocks = [];
    for (let i = 0; i < 7; i++) {                            // cụm núi đá vươn cao ~7-8m
      const h = [7.5, 6, 5, 4, 3.2, 2.6, 2][i], r = 1.5 - i * 0.12;
      const rk = new THREE.ConeGeometry(r + 0.9, h, 5);
      rk.translate(-1.8 + (i % 3) * 1.7, h / 2 + 0.4, -1.4 + Math.floor(i / 3) * 1.6);
      rocks.push(rk);
    }
    const rm = new THREE.Mesh(mergeGeometries(rocks), rockM); rm.castShadow = true; g.add(rm);
    for (let i = 0; i < 8; i++) {                            // topiary tròn quanh viền
      const a = i * Math.PI / 4, tx = Math.cos(a) * 8.2, tz = Math.sin(a) * 8.2;
      const tp = new THREE.Mesh(new THREE.SphereGeometry(0.85 + (i % 3) * 0.2, 7, 6), sharedMats.leafDark);
      tp.position.set(tx, 1.15, tz); tp.castShadow = true; g.add(tp);
    }
    bcTree(g, 5.5, -4, 5, 2.2); bcTree(g, -6, 4.5, 4.5, 2);
    g.name = 'hvt_nonbo'; scene.add(g);
    addCollider(ix, iz, 6.5);
    FEATURED_CLEAR.push([ix, iz, 15]);
  }
  const tx = -125, tz = -893;                                // tập thể cũ 5T trắng xám
  if (bcOK(tx, tz)) {
    const g = new THREE.Group(); g.position.set(tx, groundHeight(tx, tz), tz); g.rotation.y = Math.PI; // mặt về BẮC (nhìn từ cầu/đảo)
    const W = 36, D = 11, H = 15.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), bcFacade('#d9d6ce', '#4a5258', 10, 5));
    body.position.y = H / 2; g.add(body);
    for (let f = 1; f < 5; f++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.15, 0.45, 0.22), mat(0x9a9891));
      b.position.set(0, f * 3.1 + 0.4, D / 2 + 0.12); g.add(b);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.5, D + 0.8), mat(0xb8b2a2)); roof.position.y = H + 0.25; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'hvt_tapthe5t'; scene.add(g);
    for (const lx of [-12, 0, 12]) { const [cx, cz] = localPt(tx, tz, lx, 0, Math.PI); addCollider(cx, cz, 7); }
    FEATURED_CLEAR.push([tx, tz, 24]);
  }
}

// === (B13) ZONE CẢNG HẢI PHÒNG ĐÔNG CẦU: 5 KHO DÀI MÁI TÔN + 4 CẦN CẨU CHÂN
//     ĐẾ CAM (pano_282/283/348/328 h90 sev2-3 'kho mái tôn + cần cẩu cổng cam'
//     — 4 pano trên cầu 0.9-2.2. Ảnh 282_h090: 2 dãy kho RẤT DÀI mái tôn gỉ
//     nâu/kaki song song bờ, dàn cẩu chân đế cần nghiêng dọc mép nước.
//     Probe: đất tới z≈-950, nước từ -960 (x 60..420); dải deck cầu x 55..90 —
//     kho đặt x 130..410 z -936/-908, cẩu z -949, TRÁNH cả hai) ===
{
  const roofM = [mat(0x9c6b4a), mat(0x8f8a5f), mat(0x8a7a5a)];
  const wallM = mat(0x8c8a7e);
  const rows = [
    [-936, [[170, 80], [260, 80], [350, 80]]],               // dãy sát quay
    [-908, [[210, 70], [330, 70]]],                          // dãy trong
  ];
  let wi = 0;
  for (const [zc, units] of rows) for (const [xc, W] of units) {
    if (!bcOK(xc, zc)) continue;
    const g = new THREE.Group(); g.position.set(xc, groundHeight(xc, zc), zc);
    const D = zc === -936 ? 22 : 20, H = 5.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallM); body.position.y = H / 2; g.add(body);
    for (const s of [-1, 1]) {                               // 2 mái dốc kho (đầu hồi đông-tây)
      const r = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.18, D * 0.58), roofM[wi % 3]);
      r.position.set(0, H + 0.9, s * D * 0.22); r.rotation.x = -s * 0.32; g.add(r);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'port_kho_' + wi; scene.add(g);
    for (const lx of [-W / 3, 0, W / 3]) addCollider(xc + lx, zc, D / 2 + 1);
    FEATURED_CLEAR.push([xc, zc, W / 2 + 8]); wi++;
  }
  const orange = mat(0xd07018);
  for (const cx0 of [150, 220, 290, 360]) {                  // cẩu chân đế cần nghiêng
    if (!bcOK(cx0, -949)) continue;
    const g = new THREE.Group(); g.position.set(cx0, groundHeight(cx0, -949), -949);
    for (const [lx, lz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 9, 6), orange);
      leg.position.set(lx, 4.5, lz); g.add(leg);
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(7, 1, 7), orange); deck.position.y = 9.5; g.add(deck);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 4.4), orange); cab.position.set(0, 11.5, 0.6); g.add(cab);
    const cw = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 3), mat(0x8a5010)); cw.position.set(0, 12, 3.6); g.add(cw);
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 26, 6), orange);
    boom.position.set(0, 12 + 9.5, -7.5); boom.rotation.x = -0.72; g.add(boom);    // cần vươn nghiêng ra sông (bắc = -z)
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 14, 4), mat(0x3f4a52));
    tip.position.set(0, 24, -16.3); g.add(tip);                                    // cáp rủ từ đầu cần (y≈31) xuống
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'port_cau_' + cx0; scene.add(g);
    addCollider(cx0, -949, 4.5); FEATURED_CLEAR.push([cx0, -949, 12]);
  }
  // dải quay bê tông sẫm dọc mép nước
  if (bcOK(250, -952)) {
    const quay = new THREE.Mesh(new THREE.PlaneGeometry(300, 9), mat(0x7e7f82));
    quay.rotation.x = -Math.PI / 2; quay.position.set(255, groundHeight(250, -952) + 0.05, -951.5);
    quay.receiveShadow = true; quay.name = 'port_quay'; scene.add(quay);
  }
}

// === (B14) PHỐ THẤT KHÊ: DÃY PHÁP 3T VÀNG+XANH bờ NAM + PHỞ BÒ HÀ NỘI / AMI
//     BAKERY bờ BẮC (pano_423=1.5: 3 fix sev3; pano_219 h90 xa. Ảnh 423_h180:
//     công thự Pháp 3T KEM pilaster trắng cửa cao + khối XANH DƯƠNG cũ kề đông;
//     423_h000: biển vàng PHỞ BÒ HÀ NỘI + biển xanh đậm Ami BAKERY, nhà xám 2T.
//     Tim #3 (r) z≈-777.2 tại x=-11 → nam offset 11.55 → z=-765.7?? — CHÚ Ý
//     trục z: nam = z LỚN hơn; đã kiểm bearing: từ 423 tòa vàng = 202° ✓ h180,
//     Phở Bò = 343° ✓ h0) ===
{
  const ry = Math.PI;                                        // mặt tiền quay BẮC ra phố
  const A = [[-16, -765.4, 26, 0xe9ddb0], [14, -764.2, 24, 0x7fa8c9]]; // [x,z,W,màu] vàng + xanh
  for (const [bx, bz, W, col] of A) {
    if (!bcOK(bx, bz)) continue;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const css = '#' + col.toString(16).padStart(6, '0');
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, 10.5, 13), bcFacade(css, '#3f4a52', 6, 3));
    body.position.y = 5.25; g.add(body);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(W + 0.2, 0.5, 13.2), mat(0xf2efe6)); belt.position.y = 3.5; g.add(belt);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 0.6, 14), mat(0xb8b2a2)); roof.position.y = 10.8; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'thatkhe_phap_' + bx; scene.add(g);
    for (const lx of [-W / 3, W / 3]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 7); }
    FEATURED_CLEAR.push([bx, bz, W / 2 + 8]);
  }
  // bờ bắc: 3 shopfront nhỏ (Phở Bò vàng, Ami xanh đậm, nhà xám)
  const shops = [
    [-14, -786.5, 'PHỞ BÒ HÀ NỘI — ĐT 0373 758 555', '#f2c21a', '#8e1f24', 0xefe9d8],
    [-6, -786.1, 'Ami BAKERY — Số 6 Thất Khê', '#1d3a6e', '#ffffff', 0xe3ddcf],
    [1.5, -785.8, 'CÀ PHÊ — SINH TỐ', '#2e7d4f', '#ffffff', 0xc9c4b8],
  ];
  for (const [bx, bz, txt, bg, fg, col] of shops) {
    if (!bcOK(bx, bz)) continue;
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz);
    const body = new THREE.Mesh(new THREE.BoxGeometry(7, 6.6, 8), mat(col)); body.position.y = 3.3; g.add(body);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 1.0), bcSign(txt, bg, fg, 36));
    s.position.set(0, 3.6, 4.08); g.add(s);                  // biển quay NAM ra phố (z+)
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'thatkhe_shop'; scene.add(g);
    addCollider(bx, bz, 4.4); FEATURED_CLEAR.push([bx, bz, 7]);
  }
}

// === (B15) QUẦN THỂ ĐINH TIÊN HOÀNG: CÔNG SỞ PHÁP 2T VÀNG + BIỆT THỰ GÓC +
//     TƯỜNG BÍCH HỌA + bồn cây kiềng gỗ + cọc xích cam (pano_420=0.9: 5 fix
//     sev3; pano_422 cây cổ thụ. Ảnh 420_h090: quảng trường đỗ xe, cây bệ tròn
//     + kiềng gỗ 3 chân, công thự vàng xa; 420_h180: TƯỜNG MURAL lễ hội + sóng
//     nước dọc tây phố hướng nam. Né lưới đường: công sở (175,-735) cách #580
//     25m, bearing từ 420 = 104° ✓ h90; biệt thự (68,-742) = 238° ✓ h270;
//     mural dọc tây #464 (74.5,-710)->(71.5,-682), bearing tâm = 197° ✓ h180) ===
{
  const bx = 175, bz = -735;                                 // công sở Pháp 2T vàng kem, mặt TÂY
  if (bcOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = -Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(46, 7.6, 14), bcFacade('#d9a441', '#2e5d43', 12, 2));
    body.position.y = 3.8; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(47.5, 1.4, 15.5), mat(0x8a4a3a)); roof.position.y = 8.3; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'dth_congso_phap'; scene.add(g);
    for (const lx of [-15, 0, 15]) { const [cx, cz] = localPt(bx, bz, lx, 0, -Math.PI / 2); addCollider(cx, cz, 8); }
    FEATURED_CLEAR.push([bx, bz, 30]);
  }
  const vx = 68, vz = -742;                                  // biệt thự Pháp góc, cửa vòm T2, mái ngói
  if (bcOK(vx, vz)) {
    const g = new THREE.Group(); g.position.set(vx, groundHeight(vx, vz), vz); g.rotation.y = Math.PI / 2;
    const body = new THREE.Mesh(new THREE.BoxGeometry(12, 7.2, 10), bcFacade('#ecd9a8', '#6a4a2e', 4, 2));
    body.position.y = 3.6; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(8.6, 3.2, 4), mat(0x8a4a3a));
    roof.position.y = 8.8; roof.rotation.y = Math.PI / 4; g.add(roof);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'dth_bietthu_goc'; scene.add(g);
    addCollider(vx, vz, 7); FEATURED_CLEAR.push([vx, vz, 10]);
  }
  // tường bích họa lễ hội + dải sóng xanh (28m dọc tây trục nam ĐTH/NTP)
  if (bcOK(73, -696)) {
    const muralTex = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map: makeTex(1024, 128, (c, w, h) => {
      c.fillStyle = '#e8c66a'; c.fillRect(0, 0, w, h);
      const cols = ['#c23a2a', '#2e5d9e', '#2e7d4f', '#d07018', '#7a3a8a'];
      for (let i = 0; i < 16; i++) {                         // dáng người lễ hội cách điệu
        const x0 = 26 + i * 62; c.fillStyle = cols[i % 5];
        c.beginPath(); c.arc(x0, 42, 9, 0, 7); c.fill();
        c.fillRect(x0 - 7, 52, 14, 34);
      }
      c.fillStyle = '#2e6d9e';                               // dải sóng nước
      for (let x0 = 0; x0 < w; x0 += 32) { c.beginPath(); c.arc(x0 + 16, h - 8, 16, Math.PI, 0); c.fill(); }
    }) });
    const g = new THREE.Group(); g.position.set(73, groundHeight(73, -696), -696); g.rotation.y = 1.4646;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(28, 2.2, 0.3), muralTex); wall.position.y = 1.1; g.add(wall);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(28.3, 0.15, 0.45), mat(0x8a4a3a)); cap.position.y = 2.28; g.add(cap);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.name = 'dth_mural'; scene.add(g);
    for (const lx of [-9, 0, 9]) { const [cx, cz] = localPt(73, -696, lx, 0, 1.4646); addCollider(cx, cz, 4.8); }
    FEATURED_CLEAR.push([73, -696, 16]);
  }
  // 2 bồn cây tròn + kiềng gỗ 3 chân + hàng cọc xích cam (quảng trường đỗ xe)
  for (const [px, pz] of [[100, -745], [120, -752]]) {
    if (!bcOK(px, pz)) continue;
    const g = new THREE.Group(); g.position.set(px, groundHeight(px, pz), pz);
    const bed = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.55, 12), mat(0x9a9891)); bed.position.y = 0.28; g.add(bed);
    bcTree(g, 0, 0, 8, 3.4);
    for (let i = 0; i < 3; i++) {                            // kiềng gỗ 3 chân
      const a = i * Math.PI * 2 / 3;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 4), mat(0x8a6f52));
      st.position.set(Math.cos(a) * 1.1, 1.9, Math.sin(a) * 1.1);
      st.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); g.add(st);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.name = 'dth_boncay'; scene.add(g);
    addCollider(px, pz, 2.0); FEATURED_CLEAR.push([px, pz, 5]);
  }
  if (bcOK(92, -748)) {                                      // cọc cam + xích
    const g = new THREE.Group(); g.position.set(0, 0, 0); g.name = 'dth_bollards';
    const gy = groundHeight(92, -748);
    for (let i = 0; i < 6; i++) {
      const b = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.85, 8), mat(0xd07018));
      b.position.set(92 + Math.sin(i) * 0.4, gy + 0.42, -758 + i * 4); g.add(b);
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
  }
}



  // ===== CELL_DONG: 12 block khu Lê Quang Đạo/ĐBP đông/Lê Lợi (agent nháp + kiểm hình học, helper dg* riêng) =====
// ============================================================================
// MẶT TRẬN ĐÔNG — 12 block nháp cho 20 pano ô (900,0)/(900,-300)/(900,300).
// ĐỊNH DANH THẬT (đã xem 27 ảnh × 12 pano, KHÔNG phải "Lê Hồng Phong"):
//   t#98+t#400  = ĐẠI LỘ LÊ QUANG ĐẠO (đường đôi MỚI, dải phân cách cây bụi) — pano 478/215
//   s#556       = ĐIỆN BIÊN PHỦ đoạn đông (số 9-34)                          — pano 408-413
//   s#23        = LƯƠNG KHÁNH THIỆN                                          — pano 086-091/444
//   s#48/#428   = LÊ LỢI (phố xe đạp + VPP 108)                              — pano 162-165/380/462
// VỊ TRÍ DÁN: js/world.js SAU khai báo FEATURED_CLEAR (~line 1468), cạnh các
// block cell khác, TRƯỚC khối OSM/shophouse_infill/block_infill — để
// FEATURED_CLEAR.push ở đây đuổi block_infill (vd "tường lớn" đè pano_408).
// Tọa độ đã DỜI KHỎI TIM ĐƯỜNG: nửa_lòng(s5/t4) + 2.3 vỉa hè + D/2 (+sân),
// kiểm groundHeightNoDeck=2.00 & bucket heading = scratchpad/cell_dong/geom.mjs.
// Scope buildWorld: THREE, mat, makeTex, sharedMats, addCollider, FEATURED_CLEAR,
// groundHeight, groundHeightNoDeck, isWater, localPt, scene, mergeGeometries.
// Prefix "dg" — không đụng lm*/hb*/bc*/tb*.
// ============================================================================

// === HELPER CHUNG dg* (dán 1 LẦN trước 12 block) ===
const dgSign = (txt, bg, fg = '#ffffff', px = 46) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 26);
  }),
});
const dgFacade = (baseCss, winCss, cols, rows) => new THREE.MeshLambertMaterial({
  map: makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.12, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.16, my + r * ch + ch * 0.16, cw * 0.68, ch * 0.66);
    }
  }),
});
const dgOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - 2.0) < 0.4 && !isWater(x, z);
// Nhà phố/shophouse: thân + kính trệt + biển băng mặt tiền + mái; trả group để gắn thêm
const dgShop = (x, z, ry, W, D, FL, FH, wallMat, name, signTxt, signBg, signFg) => {
  if (!dgOK(x, z)) return null;
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry;
  const H = FL * FH;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat); body.position.y = H / 2; g.add(body);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, FH * 0.72, 0.12), sharedMats.window);
  glass.position.set(0, FH * 0.42, D / 2 + 0.05); g.add(glass);
  if (signTxt) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.94, Math.min(1.6, FH * 0.5)), dgSign(signTxt, signBg, signFg));
    s.position.set(0, FH + 0.65, D / 2 + 0.08); g.add(s);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.6, D + 0.8), mat(0xb8b2a2)); roof.position.y = H + 0.3; g.add(roof);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.name = name; scene.add(g);
  addCollider(x, z, Math.max(W, D) * 0.52);
  FEATURED_CLEAR.push([x, z, Math.max(W, D) / 2 + 9]);
  return g;
};
// Rào thanh đứng (sắt/tôn) giữa 2 điểm; kind: 'bar' sắt thưa | 'ton' tấm đặc
const dgRail = (ax, az, bx, bz, h, kind, colHex) => {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
  const th = Math.atan2(-uz, ux), gs = [];
  const gy = groundHeight((ax + bx) / 2, (az + bz) / 2);
  if (kind === 'ton') {
    const p = new THREE.BoxGeometry(L, h, 0.08); p.rotateY(th);
    p.translate((ax + bx) / 2, gy + h / 2, (az + bz) / 2); gs.push(p);
  } else {
    for (let t = 0.3; t < L; t += 0.62) {
      const b = new THREE.BoxGeometry(0.07, h, 0.07); b.rotateY(th);
      b.translate(ax + ux * t, gy + h / 2, az + uz * t); gs.push(b);
    }
    for (const yy of [h - 0.08, 0.25]) {
      const r = new THREE.BoxGeometry(L, 0.1, 0.1); r.rotateY(th);
      r.translate((ax + bx) / 2, gy + yy, (az + bz) / 2); gs.push(r);
    }
  }
  const m = new THREE.Mesh(mergeGeometries(gs), mat(colHex));
  m.castShadow = true; scene.add(m);
  return m;
};

// === (1) DẢI PHÂN CÁCH CÂY BỤI ĐẠI LỘ LÊ QUANG ĐẠO — fix 'road' sev3 ở CẢ pano_478
//     h0 (score 0.8-1.2) lẫn pano_215 h0: "đường đôi, dải phân cách bê tông liên tục
//     phủ bụi xanh dày". Trong game 2 carriageway t#98//t#400 cách nhau ~8m dính
//     thành 1 dải nhựa — đặt bó vỉa + hedge lên TIM khe (offset n2*4 từ #98, đo
//     probe.mjs). 3 đoạn, chừa nút giao (928,83) và miệng ngõ r#338 (1082,257).
//     KHÔNG collider: gờ 0.3m, tránh rải ~90 collider giữa lòng đường. ===
{
  const strips = [
    [948.2, 98.2, 1006.5, 158.8],    // đoạn (928,83)->(1004,162), chừa 25m đầu nút Lê Lợi
    [1007.4, 159.8, 1081.9, 249.4],  // đoạn (1004,162)->…, dừng trước miệng ngõ r#338
    [1090.2, 259.4, 1119, 294],      // sau ngõ, tới mép lưới nhà x~1120
  ];
  const curbG = [], hedgeG = [];
  for (const [ax, az, bx, bz] of strips) {
    if (!dgOK((ax + bx) / 2, (az + bz) / 2)) continue;
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const th = Math.atan2(-uz, ux), gy = groundHeight((ax + bx) / 2, (az + bz) / 2);
    const curb = new THREE.BoxGeometry(L, 0.32, 1.5); curb.rotateY(th);
    curb.translate((ax + bx) / 2, gy + 0.16, (az + bz) / 2); curbG.push(curb);
    for (let t = 1.8; t < L - 1.8; t += 4.2) {          // bụi cây 3.2m + khe 1m
      const hb = new THREE.BoxGeometry(3.2, 0.85, 1.0); hb.rotateY(th);
      hb.translate(ax + ux * t, gy + 0.32 + 0.42, az + uz * t); hedgeG.push(hb);
    }
  }
  if (curbG.length) {
    const cm = new THREE.Mesh(mergeGeometries(curbG), mat(0xb9bdb9));
    cm.receiveShadow = true; cm.name = 'lqd_median_curb'; scene.add(cm);
    const hm = new THREE.Mesh(mergeGeometries(hedgeG), mat(0x3f7d3a, { flatShading: true }));
    hm.castShadow = true; hm.name = 'lqd_median_hedge'; scene.add(hm);
  }
}

// === (2) LÊ QUANG ĐẠO bờ ĐÔNG: Higashi + CHÁO LÒNG + nhà thô xám + STRONGFIT
//     (pano_478 h0 fix sev3 "cụm nhà trắng 3T Higashi/CHÁO LÒNG cùng lều xanh";
//     h90 fix sev3 "nhà phố 3T mặt kính chứa biển STRONGFIT; bỏ biển nổi" — biển
//     catalog đang treo rời, FEATURED_CLEAR ở đây tự nuốt; pano_215 h90 "nhà ống
//     trắng 4T, nhà thô xám". Ảnh 478_h000/h180: nhà trắng ban công con tiện,
//     lều bạt XANH DƯƠNG + biển đứng CHÁO LÒNG Anh; gym kính 3T. Bearing kiểm:
//     Higashi 478→4°, 215→84°; STRONGFIT 478→84°) ===
{
  const ryE = -0.8768;                             // mặt tiền quay TÂY ra đại lộ
  // Trung tâm tiếng Nhật Higashi — 3T trắng, ban công con tiện, biển xám nhạt
  const g1 = dgShop(1033.1, 166.4, ryE, 10, 10, 3, 3.3, mat(0xf2f3f0), 'lqd_higashi',
    'TRUNG TÂM TIẾNG NHẬT HIGASHI', '#e8e6e0', '#374151');
  if (g1) {
    for (let f = 1; f < 3; f++) {                  // ban công lan can con tiện trắng
      const bal = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.95, 0.5), mat(0xffffff));
      bal.position.set(0, f * 3.3 + 0.5, 5.2); bal.castShadow = true; g1.add(bal);
    }
    // lều bạt xanh dương + biển đứng CHÁO LÒNG Anh trước sân (ảnh h000)
    const tentTop = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1.2, 4), mat(0x1e5fb4, { flatShading: true }));
    tentTop.rotation.y = Math.PI / 4; tentTop.position.set(-1.5, 3.0, 8.6); g1.add(tentTop);
    for (const [px, pz] of [[-3.6, 6.6], [0.6, 6.6], [-3.6, 10.6], [0.6, 10.6]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 5), mat(0x9aa0a6));
      pole.position.set(px, 1.25, pz); g1.add(pole);
    }
    const chao = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.9, 0.1), dgSign('CHÁO LÒNG Anh', '#f5e9c8', '#a01c1c', 60));
    chao.position.set(4.2, 1.15, 7.4); chao.rotation.y = -0.2; g1.add(chao);
    const [tx, tz] = localPt(1033.1, 166.4, -1.5, 8.6, ryE); addCollider(tx, tz, 2.6);
  }
  // nhà thô xám 4T đang hoàn thiện (215 h90 "nhà thô xám nhiều tầng") — bê tông trần
  const g2 = dgShop(1040.5, 174.6, ryE, 9, 11, 4, 3.2, dgFacade('#9aa0a0', '#565c60', 3, 4),
    'lqd_nhatho_xam', null, null);
  if (g2) g2.children[1].visible = false;          // thô chưa lắp kính trệt
  // STRONGFIT GYM & PILATES — 3T kính, biển xanh lá nhạt (ảnh 478_h180)
  const g3 = dgShop(1053.7, 189.6, ryE, 10, 12, 3, 3.4, dgFacade('#dfe4e6', '#3d5a66', 4, 3),
    'lqd_strongfit', 'STRONGFIT GYM & PILATES', '#e9f5ee', '#1f6b45');
  if (g3) {
    const glass2 = new THREE.Mesh(new THREE.BoxGeometry(8.6, 2.2, 0.12), sharedMats.window);
    glass2.position.set(0, 5.6, 6.05); g3.add(glass2);  // kính suốt tầng 2 (gym)
  }
}

// === (3) LÊ QUANG ĐẠO bờ TÂY: kem 5T + nhà tôn xanh-vàng + trắng 4T + RÀO TÔN
//     + quán thấp (pano_215 h180 fix sev3 "khối kem 5T ban công liên tục, kính/cửa
//     cuốn trệt" thay nhà generic 2T sát camera; pano_478 h270 fix sev3 "cụm nhà
//     xanh-vàng, nhà xám 4T"; pano_215 h270 fix sev2 rail "hàng rào tôn xanh, dãy
//     quán thấp". Ảnh 478_h270: hộp tầng 2 TÔN XANH DƯƠNG trên trệt vàng, tường
//     gạch trần; 215_h270: rào tôn + ô dù + ghế nhựa. Bearing: kem5T 215→192,
//     478→288; xanhvang 478→258) ===
{
  const ryW = 2.2648;                              // mặt tiền quay ĐÔNG ra đại lộ
  // nhà phố kem 5 tầng nhiều ban công (sát pano_215)
  const g1 = dgShop(1008.1, 184.6, ryW, 12, 10, 5, 3.2, dgFacade('#efe3c2', '#5a6a70', 4, 5),
    'lqd_kem5t', null, null);
  if (g1) for (let f = 1; f < 5; f++) {
    const bal = new THREE.Mesh(new THREE.BoxGeometry(11.4, 0.9, 0.5), mat(0xf7f2e4));
    bal.position.set(0, f * 3.2 + 0.5, 5.2); bal.castShadow = true; g1.add(bal);
  }
  // nhà xanh-vàng: trệt vàng + tầng 2 quây TÔN XANH DƯƠNG, mái tôn (ảnh 478_h270)
  if (dgOK(1017.4, 195)) {
    const g = new THREE.Group(); g.position.set(1017.4, groundHeight(1017.4, 195), 195); g.rotation.y = ryW;
    const lower = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 9), mat(0xead9a0)); lower.position.y = 1.7; g.add(lower);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(8.2, 3.1, 9.2), mat(0x2563a8)); upper.position.y = 3.4 + 1.55; g.add(upper);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.25, 9.6), mat(0x4a7ec0)); roof.position.y = 6.7; g.add(roof);
    const win = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 0.1), mat(0xffffff)); win.position.set(1.6, 5.0, 4.7); g.add(win);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'lqd_ton_xanh'; scene.add(g);
    addCollider(1017.4, 195, 4.8); FEATURED_CLEAR.push([1017.4, 195, 13.5]);
  }
  // nhà ống trắng 4T (dãy 478 h270 "nhà xám 4T + dãy liền kề")
  dgShop(1023.8, 202.7, ryW, 8, 9, 4, 3.2, dgFacade('#eceff1', '#4a5a62', 3, 4), 'lqd_trang4t', null, null);
  // RÀO TÔN XANH quanh lô trống + quán 1T mái bạt + ô dù + bàn ghế (215 h270)
  dgRail(995.2, 161.6, 1007.3, 176.2, 2.3, 'ton', 0x3e7d4e);
  if (dgOK(997.5, 168)) {
    const q = new THREE.Group(); q.position.set(997.5, groundHeight(997.5, 168), 168); q.rotation.y = ryW;
    const hut = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 4.5), mat(0xcfc6ae)); hut.position.y = 1.3; q.add(hut);
    const bat = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.12, 5.4), mat(0x2f6ea8)); bat.position.y = 2.75; q.add(bat); // mái bạt xanh
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.6, 0.7, 8), mat(0x8a6db8, { flatShading: true }));
    um.position.set(1.2, 2.2, 4.6); q.add(um);     // ô dù tím (ảnh 215_h270)
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 5), mat(0x8a8f92)); up.position.set(1.2, 1.1, 4.6); q.add(up);
    for (const bx2 of [-1.4, 0.2]) { const tb = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.75, 0.9), mat(0xd9c650)); tb.position.set(bx2, 0.38, 4.3); q.add(tb); }
    q.traverse((o) => { if (o.isMesh) o.castShadow = true; }); q.name = 'lqd_quan_thap'; scene.add(q);
    addCollider(997.5, 168, 3.6); FEATURED_CLEAR.push([997.5, 168, 10]);
  }
  FEATURED_CLEAR.push([1001.2, 168.8, 9]);         // giữ dải rào tôn khỏi nhà tự sinh
}

// === (4) CHI CỤC KIỂM ĐỊNH HẢI QUAN — pano_409 h0 fix sev3 ×2 ('other' xóa khối
//     nền đặc + 'landmark' trụ sở 3T, sân, cổng, rào). Ảnh 409_h000: nhà 3T TRẮNG
//     W~40 sau sân gạch, rào sắt TRẮNG + cổng xếp, băng rôn đỏ, biển xanh 2 trụ
//     cổng, cây me/phượng sân. Bờ BẮC ĐBP tại (963,-450). Bearing 409→15°∈h0.
//     FEATURED_CLEAR phủ cả sân → đuổi "tường lớn" block_infill (fix 408 h0) ===
{
  const bx = 963.5, bz = -464.7, ry = -0.0232;     // mặt tiền quay NAM ra ĐBP
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 40, D = 13, H = 3 * 3.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), dgFacade('#f4f6f4', '#3f5a6b', 10, 3));
    body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.4, 0.7, D + 1.4), mat(0x8fa8c0)); roof.position.y = H + 0.35; g.add(roof);
    // sảnh giữa + biển xanh cơ quan
    const porch = new THREE.Mesh(new THREE.BoxGeometry(10, 4.2, 2.2), mat(0xffffff)); porch.position.set(0, 2.1, D / 2 + 1.1); g.add(porch);
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.3), dgSign('CHI CỤC KIỂM ĐỊNH HẢI QUAN 2', '#1c56a0', '#ffffff', 40));
    bs.position.set(0, 5.4, D / 2 + 0.12); g.add(bs);
    // băng rôn đỏ ngang mặt tiền (ảnh: poster tuyên truyền đỏ 2 bên)
    const br = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.0), dgSign('NHIỆT LIỆT CHÀO MỪNG ĐẠI HỘI ĐẢNG BỘ', '#c62828', '#ffe082', 34));
    br.position.set(-9, 3.4, D / 2 + 0.1); g.add(br);
    // cột cờ giữa sân
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 7.5, 6), mat(0xd8dce0)); fp.position.set(6, 3.75, D / 2 + 6); g.add(fp);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.25), dgSign('★', '#da251d', '#ffdd00', 60));
    fl.position.set(6.95, 6.6, D / 2 + 6); g.add(fl);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'dbp_haiquan'; scene.add(g);
    for (const lx of [-13, 0, 13]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 8.5); }
    FEATURED_CLEAR.push(...[-10, 10].map((lx) => { const [cx, cz] = localPt(bx, bz, lx, 0, ry); return [cx, cz, 16]; }));
    FEATURED_CLEAR.push([963.3, -450.5, 13]);      // sân trước — dọn block_infill sát mép đường
  }
  // rào sắt TRẮNG + 2 trụ cổng biển xanh dọc vỉa hè bắc (z≈-450, x 941→984)
  dgRail(941, -450.4, 958.5, -450.0, 1.5, 'bar', 0xe8ecef);
  dgRail(968.5, -449.8, 984, -449.4, 1.5, 'bar', 0xe8ecef);
  for (const gx of [959.6, 967.4]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.2, 0.9), mat(0xdde3e8));
    post.position.set(gx, groundHeight(gx, -449.9) + 1.1, -449.9); post.castShadow = true; scene.add(post);
    addCollider(gx, -449.9, 0.7);
  }
}

// === (5) BẢO HIỂM BẢO VIỆT — pano_410 h0 fix sev3 "trụ sở 3T lùi sân, rào pano,
//     cổng sắt, cờ". Ảnh 410_h000: nhà trắng 3T mái sẫm sau hàng phượng, TƯỜNG RÀO
//     ĐẶC gắn DÃY PANO QUẢNG CÁO trắng-xanh giữa các trụ, biển xanh "Insurance"
//     trên cổng trái. Bờ BẮC ĐBP số 24. Bearing 410→345°∈h0 ===
{
  const bx = 924.4, bz = -462.6, ry = -0.0232;
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 30, D = 13, H = 3 * 3.5;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), dgFacade('#f6f7f5', '#46606e', 8, 3));
    body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 1.1, D + 1.6), mat(0x7a4c40)); roof.position.y = H + 0.55; g.add(roof);
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.2), dgSign('BẢO VIỆT ⬥ Insurance', '#0b5ea8', '#ffffff', 44));
    bs.position.set(0, H - 1.2, D / 2 + 0.1); g.add(bs);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'dbp_baoviet'; scene.add(g);
    for (const lx of [-9, 9]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 8); }
    FEATURED_CLEAR.push(...[-8, 8].map((lx) => { const [cx, cz] = localPt(bx, bz, lx, 0, ry); return [cx, cz, 15]; }));
    FEATURED_CLEAR.push([925, -452, 11]);          // sân + rào
  }
  // tường rào thấp + dãy 5 pano quảng cáo bảo hiểm trắng-xanh (đặc trưng ảnh h000)
  {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(36, 0.9, 0.25), mat(0xcfd4cd));
    wall.position.set(924, groundHeight(924, -451.2) + 0.45, -451.2); wall.rotation.y = -0.0232;
    wall.receiveShadow = true; scene.add(wall);
    const ads = ['BẢO HIỂM SỨC KHỎE', 'BẢO HIỂM NHÀ TƯ NHÂN', 'BẢO HIỂM Ô TÔ', 'BẢO HIỂM TÀU BIỂN', 'AN TÂM VỮNG BƯỚC'];
    ads.forEach((t, i) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.5), dgSign(t, '#eef4fb', '#0b5ea8', 40));
      const gx = 909.5 + i * 7.2, gz = -451.05 + (924 - gx) * 0.0232;
      p.position.set(gx, groundHeight(gx, gz) + 1.7, gz + 0.15); p.rotation.y = -0.0232; scene.add(p);
    });
    addCollider(915, -451.1, 1); addCollider(933, -450.7, 1);
  }
}

// === (6) MẶT NAM nút Bảo Việt: KÍNH MẮT THẾ HỆ MỚI + ACB 7T + XỔ SỐ HẢI PHÒNG
//     (pano_410 h180 fix sev3. Ảnh 410_h180: nhà 4T gạch đỏ-trắng biển đỏ
//     "THẾ HỆ MỚI KÍNH MẮT", tòa ACB 7T kem cờ dây, biển xanh dài "CÔNG TY TNHH
//     MTV XỔ SỐ..." trên rào sắt + bãi xe sau rào. Bearing: kính mắt 230, ACB 167,
//     xổ số 122 — trải trọn bucket h135-225) ===
{
  const ryS = 3.1184;                              // mặt tiền quay BẮC ra ĐBP
  // Kính Mắt Thế Hệ Mới — 4T gạch đỏ, biển đỏ 2 tầng biển
  const g1 = dgShop(916.7, -431.6, ryS, 10, 10, 4, 3.2, dgFacade('#b5533c', '#e8e2d4', 3, 4),
    'dbp_kinhmat', 'THẾ HỆ MỚI KÍNH MẮT', '#c62828', '#ffffff');
  if (g1) {
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.2), dgSign('ĐỒN — KÍNH MẮT', '#c62828', '#fff59d', 44));
    s2.position.set(0, 6.7, 5.1); g1.add(s2);
  }
  // ACB 7 tầng kem — băng biển xanh dương ACB trệt + logo mái
  const g2 = dgShop(932.7, -429.8, ryS, 20, 13, 7, 3.1, dgFacade('#efe8d2', '#51606a', 6, 7),
    'dbp_acb', 'ACB — NGÂN HÀNG Á CHÂU', '#0f4c9e', '#ffffff');
  if (g2) {
    const logo = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), dgSign('ACB', '#0f4c9e', '#ffffff', 64));
    logo.position.set(0, 7 * 3.1 + 1.2, 0); logo.rotation.y = 0; g2.add(logo);
  }
  // Xổ số Hải Phòng: nhà 3T kem lùi sâu + rào sắt + biển xanh dài trên rào
  dgShop(955.6, -426.7, ryS, 16, 10, 3, 3.3, dgFacade('#f2ead0', '#5a6a70', 5, 3), 'dbp_xoso', null, null);
  dgRail(945.5, -437.1, 966, -436.6, 1.4, 'bar', 0xcfd4d8);
  {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.1), dgSign('CÔNG TY TNHH MTV XỔ SỐ HẢI PHÒNG', '#0e6aa8', '#ffe082', 34));
    p.position.set(955.8, groundHeight(955.8, -436.8) + 2.0, -436.8); p.rotation.y = 3.1184; scene.add(p);
  }
}

// === (7) TÒA PHÁP CỔ VÀNG ARCADE + dãy nhà cổ Bình Minh Flower/Bánh Cuốn 28
//     (pano_411 h180 fix sev3 "tòa Pháp cổ vàng ~45m, 2T, arcade HAI tầng + rào
//     sắt trụ gạch"; h0 fix sev3 "dãy nhà cổ/shophouse vàng-đỏ 2T ~35m". Ảnh
//     411_h180: vòm cuốn 2 tầng vàng ochre, rổ hoa quả hàng rong trên vỉa hè;
//     411_h000: nhà 2T vàng mái ngói, biển Bình Minh Flower + Bánh Cuốn Nóng 28.
//     audit W45/W35. Bearing 182/342) ===
{
  // thân arcade: texture 2 hàng vòm cuốn trên nền vàng ochre
  const arcTex = makeTex(512, 128, (g, w, h) => {
    g.fillStyle = '#d9a94f'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8a6a30';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 10; c++) {
      const cx = 26 + c * 50, cy = r * 64 + 46, rw = 15, rh = 30;
      g.fillRect(cx - rw / 2, cy - rh + 8, rw, rh);
      g.beginPath(); g.arc(cx, cy - rh + 8, rw / 2, Math.PI, 0); g.fill();
    }
  });
  const bx = 887.7, bz = -430.3, ry = 3.1184;
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const W = 44, D = 14, H = 9.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D),
      new THREE.MeshLambertMaterial({ map: arcTex })); body.position.y = H / 2; g.add(body);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 1.2, 0.5, D + 1.2), mat(0xf0e6c8)); cornice.position.y = H + 0.25; g.add(cornice);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W - 2, 1.6, D - 2), mat(0x9c4a34)); roof.position.y = H + 1.05; g.add(roof); // ngói thấp sau lan can
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'dbp_phapco_arcade'; scene.add(g);
    for (const lx of [-15, 0, 15]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 8.5); }
    FEATURED_CLEAR.push(...[-11, 11].map((lx) => { const [cx, cz] = localPt(bx, bz, lx, 0, ry); return [cx, cz, 16]; }));
  }
  // rào sắt trụ gạch dọc vỉa hè nam + rổ hoa quả hàng rong (ảnh h180)
  dgRail(868, -438.1, 908, -437.2, 1.6, 'bar', 0x3a3f45);
  for (const gx of [868, 878, 888, 898, 908]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.9, 0.55), mat(0xa05238));
    const gz = -437.65 + (888 - gx) * 0.0232;
    post.position.set(gx, groundHeight(gx, gz) + 0.95, gz); post.castShadow = true; scene.add(post);
  }
  { const fruitC = [0xe8c34a, 0xdd7f2b, 0x7fae4e];
    fruitC.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.4, 0.5, 8), mat(c, { flatShading: true }));
      b.position.set(893.5 + i * 1.4, groundHeight(893.5, -441) + 0.25, -441.2); b.castShadow = true; scene.add(b);
    }); }
  // dãy nhà cổ 2T vàng-đỏ mái ngói bờ BẮC (Bình Minh Flower + Bánh Cuốn Nóng 28)
  const g2 = dgShop(884.3, -457, -0.0232, 32, 10, 2, 3.4, dgFacade('#e3b95c', '#6b4a2e', 8, 2),
    'dbp_nhaco_binhminh', null, null);
  if (g2) {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(33.5, 1.7, 11.5), mat(0x9c4a34)); roof.position.y = 2 * 3.4 + 0.7; g2.add(roof);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), dgSign('BÌNH MINH FLOWER', '#f3ede0', '#b0403a', 44)); s1.position.set(-9, 3.9, 5.1); g2.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.1), dgSign('BÁNH CUỐN NÓNG — 28 ĐIỆN BIÊN PHỦ', '#c62828', '#ffe082', 30)); s2.position.set(4, 3.9, 5.1); g2.add(s2);
  }
}

// === (8) VOSA HẢI PHÒNG + TƯỜNG TÂY + WINMART+ — pano_413 (bờ NAM ĐBP số 25).
//     h180 fix sev3 ×2 "VOSA 3T vàng kem, cửa sổ dày, sân + rào sắt" + "cụm Tường
//     Tây/Flower nhà ống 3T"; h90 fix sev3 "WinMart+ cùng dãy shophouse". Ảnh
//     413_h180: VOSA biển trắng chữ xanh trên mái, Tường Tây biển ĐEN + Flower
//     biển KEM số 25, WinMart+ đỏ. Bearing: 223/163/124 ===
{
  const ryS = 3.1184;
  // VOSA Corporation — công sở kiểu cũ 3T vàng kem, nhiều cửa sổ, rào sắt
  const g1 = dgShop(797.7, -432.9, ryS, 22, 13, 3, 3.4, dgFacade('#eeddab', '#54626c', 7, 3),
    'dbp_vosa', null, null);
  if (g1) {
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), dgSign('VOSA CORPORATION — VOSA HAIPHONG', '#f4f6f8', '#0e5a9e', 34));
    bs.position.set(0, 3 * 3.4 + 1.0, 2); g1.add(bs);
    dgRail(787, -439.5, 808, -439.0, 1.4, 'bar', 0x3a3f45);
  }
  // Tường Tây — cưới hỏi trọn gói (biển đen) + Tường Tây Flower 25 ĐBP (biển kem)
  // (dịch 814 tránh chạm mép VOSA W22; bearing từ 413 = 152° vẫn lọt cụm h135-180)
  const g2 = dgShop(814, -434.5, ryS, 11, 9, 3, 3.3, dgFacade('#e8e4dc', '#4f5c64', 4, 3),
    'dbp_tuongtay', 'TƯỜNG TÂY — CƯỚI HỎI TRỌN GÓI', '#26262c', '#f5f0e6');
  if (g2) {
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 2.2), dgSign('Tường Tây Flower — 25 ĐBP', '#efe6d2', '#8a5a28', 34));
    s2.position.set(3.2, 6.8, 4.6); g2.add(s2);
  }
  // WinMart+ — 2T, băng biển đỏ đặc trưng
  dgShop(825.5, -434.2, ryS, 8, 9, 2, 3.3, dgFacade('#efefe9', '#5a6a70', 3, 2),
    'dbp_winmart', 'WinMart+ ⬥ TƯƠI NGON THƯỢNG HẠNG', '#d31c25', '#ffffff');
}

// === (9) SHOWROOM SAMSUNG + BIỆT THỰ PHÁP VÀNG Ố — pano_089 (LKT số 24).
//     h90 fix sev3 "SAMSUNG footprint 15-18m, 2-3T, mặt đen kính rộng, ban công";
//     h270 fix sev3 "biệt thự Pháp vàng ố 2T: cửa vòm, mái ngói đỏ, cửa cuốn xanh".
//     Ảnh 089_h090: biển SAMSUNG chữ bạc nền đen dài, kính trưng bày; 089_h270:
//     vòm cuốn vàng ố, cửa xám, mái ngói. Bearing 89/271 — trúng tâm bucket ===
{
  // SAMSUNG — 2 tầng rưỡi: khối đen kính + tầng trên kem bong tróc (audit h135)
  const bx = 930.6, bz = -258.5, ry = -2.3813;     // mặt tiền quay TÂY BẮC ra LKT
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    const black = new THREE.Mesh(new THREE.BoxGeometry(16, 4.6, 12), mat(0x1c1d20)); black.position.y = 2.3; g.add(black);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(16, 3.4, 11), dgFacade('#e6ddc8', '#6a6a62', 5, 1)); upper.position.y = 4.6 + 1.7; g.add(upper);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(14.5, 2.6, 0.12), sharedMats.window); glass.position.set(0, 1.6, 6.05); g.add(glass);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.3), dgSign('S A M S U N G', '#111214', '#e8eaed', 56)); sign.position.set(0, 3.9, 6.1); g.add(sign);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(15.4, 0.8, 0.3), mat(0xd8dce0)); rail.position.set(0, 5.0, 5.6); g.add(rail);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'lkt_samsung'; scene.add(g);
    for (const lx of [-5.5, 5.5]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 6.5); }
    FEATURED_CLEAR.push([bx, bz, 17]);
  }
  // biệt thự Pháp 2T vàng ố — cửa sổ vòm (texture), mái ngói đỏ, cửa cuốn xanh trệt
  const vTex = makeTex(512, 128, (g, w, h) => {
    g.fillStyle = '#cfa84a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7a5c28';
    for (let c = 0; c < 8; c++) { const cx = 34 + c * 60, cy = 46, rw = 16, rh = 26;
      g.fillRect(cx - rw / 2, cy - rh + 8, rw, rh);
      g.beginPath(); g.arc(cx, cy - rh + 8, rw / 2, Math.PI, 0); g.fill(); }
    g.fillStyle = '#2e6b4f';
    for (let c = 0; c < 4; c++) g.fillRect(30 + c * 124, 78, 44, 44);  // cửa cuốn xanh trệt
  });
  const vx = 891.5, vz = -258.7, vry = 0.7603;     // mặt tiền quay ĐÔNG NAM ra LKT
  if (dgOK(vx, vz)) {
    const g = new THREE.Group(); g.position.set(vx, groundHeight(vx, vz), vz); g.rotation.y = vry;
    const W = 20, D = 13, H = 7.6;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshLambertMaterial({ map: vTex }));
    body.position.y = H / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 1.6, 1.9, D + 1.6), mat(0xa8442e)); roof.position.y = H + 0.9; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'lkt_villa_phap'; scene.add(g);
    for (const lx of [-6, 6]) { const [cx, cz] = localPt(vx, vz, lx, 0, vry); addCollider(cx, cz, 7); }
    FEATURED_CLEAR.push([vx, vz, 16]);
  }
}

// === (10) GENCE + TAGONE FLORAL + kho vàng + THIÊN ĐỊA BẢO — pano_090 h90 fix
//     sev3 "cụm GENCE–TAGONE–PHƯỢNG 3T mặt kính, biển gắn mặt tiền" + pano_089
//     h0 fix sev3 "nhà kho vàng 1T + tiệm Thiên Địa Bảo/Toàn Thắng 3T". Ảnh
//     090_h090: GENCE đen 3T + TAGONE FLORAL biển trắng nhà kem. Bearing:
//     gence 89 từ 090; kho 1/thiendb 19 từ 089 ===
{
  const ryE = -2.3813, ryW = 0.7603;
  // khối đôi GENCE (đen) + TAGONE FLORAL (kem) bờ ĐÔNG NAM
  const bx = 951.8, bz = -280, W = 13, D = 10;
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ryE;
    const left = new THREE.Mesh(new THREE.BoxGeometry(6.2, 9.9, D), mat(0x232428)); left.position.set(-3.3, 4.95, 0); g.add(left);
    const right = new THREE.Mesh(new THREE.BoxGeometry(6.2, 9.3, D), dgFacade('#efe9d8', '#5c6a72', 2, 3)); right.position.set(3.3, 4.65, 0); g.add(right);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.1), dgSign('GENCE', '#17181b', '#d8d3c0', 60)); s1.position.set(-3.3, 5.6, D / 2 + 0.08); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.0), dgSign('TAGONE FLORAL', '#f4f1e8', '#4a4438', 44)); s2.position.set(3.3, 4.4, D / 2 + 0.08); g.add(s2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(11.6, 2.4, 0.12), sharedMats.window); glass.position.set(0, 1.5, D / 2 + 0.04); g.add(glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.6, D + 0.8), mat(0xb8b2a2)); roof.position.y = 10.1; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'lkt_gence_tagone'; scene.add(g);
    addCollider(bx, bz, 7); FEATURED_CLEAR.push([bx, bz, 16]);
  }
  // kho vàng kem ố 1T cửa cuốn (bờ TÂY BẮC, audit 089 h0 W12)
  const g2 = dgShop(914, -278, ryW, 14, 10, 1, 3.6, mat(0xd9c37a), 'lkt_kho_vang', null, null);
  if (g2) {
    const door = new THREE.Mesh(new THREE.BoxGeometry(9, 2.8, 0.15), mat(0x8a8f92)); door.position.set(0, 1.4, 5.1); g2.add(door);
  }
  // Trầm hương Thiên Địa Bảo — 3T biển ĐỎ (kèm Toàn Thắng)
  dgShop(923, -285.9, ryW, 6, 9, 3, 3.2, dgFacade('#efe6cf', '#5a6a70', 2, 3),
    'lkt_thiendiabao', 'TRẦM HƯƠNG THIÊN ĐỊA BẢO', '#b71c1c', '#ffe082');
}

// === (11) CỤM ĐIỆN MÁY GREE/SONY CẢNH LOAN + ĐIỆN LẠNH DUY HÀO — pano_091 &
//     pano_444 TRÙNG TỌA ĐỘ (966.6,-309.7) → 1 block ăn điểm 2 pano. Fix h0 sev3
//     (444 landmark "khối Cảnh Loan/GREE/SONY 3T rộng ~30m"; 091 house "dãy Cảnh
//     Loan-GREE-SONY-Duy Hào 3T") + h270 fix "mặt tiền điện máy phía phải". Ảnh:
//     biển GREE đỏ + SONY + thùng carton điều hòa chất đống. Bearing 0 ===
{
  const bx = 966.6, bz = -328.7, ry = 0.7603, W = 26, D = 11;
  if (dgOK(bx, bz)) {
    const g = new THREE.Group(); g.position.set(bx, groundHeight(bx, bz), bz); g.rotation.y = ry;
    // 3 nhịp: đỏ đô GREE | trắng SONY | kem Duy Hào
    const bays = [[-9, 0x8e2222, 9.9], [0, 0xf0ede4, 9.3], [9, 0xe9dfc0, 9.9]];
    for (const [lx, col, hh] of bays) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(8.6, hh, D), mat(col)); b.position.set(lx, hh / 2, 0); g.add(b);
    }
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.2), dgSign('GREE AIR CONDITIONER', '#c62828', '#ffffff', 40)); s1.position.set(-9, 3.9, D / 2 + 0.08); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 1.1), dgSign('SONY — ĐIỀU HÒA CHUYÊN NGHIỆP', '#10467e', '#ffffff', 32)); s2.position.set(0, 3.8, D / 2 + 0.08); g.add(s2);
    const s3 = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.1), dgSign('ĐIỆN LẠNH DUY HÀO', '#1769aa', '#ffe082', 44)); s3.position.set(9, 3.8, D / 2 + 0.08); g.add(s3);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9, 2.3, 0.12), sharedMats.window); glass.position.set(0, 1.45, D / 2 + 0.04); g.add(glass);
    // đống thùng carton điều hòa trước cửa (SPECIAL 444)
    for (const [lx, lz2, n] of [[-7, D / 2 + 1.6, 3], [-4.5, D / 2 + 1.3, 2]]) {
      for (let k = 0; k < n; k++) {
        const c = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.75, 0.8), mat(0xc0a070));
        c.position.set(lx + (k % 2) * 1.2, 0.4 + Math.floor(k / 2) * 0.8, lz2); g.add(c);
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.6, D + 0.8), mat(0xb8b2a2)); roof.position.y = 10.0; g.add(roof);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); g.name = 'lkt_gree_canhloan'; scene.add(g);
    for (const lx of [-8, 0, 8]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 6.5); }
    FEATURED_CLEAR.push(...[-7, 7].map((lx) => { const [cx, cz] = localPt(bx, bz, lx, 0, ry); return [cx, cz, 14]; }));
  }
}

// === (12) PHỐ XE ĐẠP LÊ LỢI: DŨNG VÂN + THỐNG NHẤT/GIANT + BẠC HẢI YẾN +
//     HUY LUXURY 203 — pano_162 h270 fix sev3 "cụm Dũng Vân/Thống Nhất/GIANT,
//     ô dù và xe đạp phủ vỉa hè" + h90 sev3 "Huy Luxury 3T đen số 203 sát đường"
//     + h0 sign sev3 "biển Bạc Hải Yến gắn đúng mặt tiền 3T" (nuốt biển catalog
//     treo rời). Ảnh 162_h000/h270 + 462_h270. Bearing: 270/253/0/90 từ 162 ===
{
  const ryW = 0.7996, ryE = -2.3416;               // bờ TÂY BẮC quay ĐN / bờ ĐN quay TB
  // Dũng Vân — 2T vàng cũ ban công con tiện, biển xanh dương lớn kín tầng 2
  const g1 = dgShop(860.9, 135.2, ryW, 12, 9, 2, 3.4, dgFacade('#e5c86a', '#6b5a34', 4, 2),
    'lloi_dungvan', 'XE ĐẠP ĐIỆN DŨNG VÂN — 178 LÊ LỢI', '#1565c0', '#ffffff');
  if (g1) {
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.0), dgSign('XE ĐẠP TRỢ ĐIỆN NHẬT — XE ĐẠP THỐNG NHẤT', '#0d47a1', '#ffe082', 28));
    s2.position.set(0, 5.6, 4.6); g1.add(s2);
    // ô dù + dãy xe đạp bày kín vỉa hè (SPECIAL 162)
    for (const [lx, col] of [[-3.5, 0xd8d8d8], [0.5, 0xc2554a], [4, 0xd8cfc0]]) {
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.75, 8), mat(col, { flatShading: true }));
      um.position.set(lx, 2.3, 7.2); g1.add(um);
      const up = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.3, 5), mat(0x8a8f92)); up.position.set(lx, 1.15, 7.2); g1.add(up);
    }
    for (let k = 0; k < 7; k++) {
      const bike = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.85, 1.6), mat([0xc0392b, 0x2471a3, 0xd8d8d8, 0xe6b03a][k % 4]));
      bike.position.set(-4.6 + k * 1.5, 0.55, 6.2); g1.add(bike);
    }
    const [ox, oz] = localPt(860.9, 135.2, 0, 6.8, ryW); addCollider(ox, oz, 3.2);
  }
  // Thống Nhất/GIANT — 4T trắng-xám biển xanh (audit 162 h0 W25)
  dgShop(852.6, 143.7, ryW, 10, 9, 4, 3.2, dgFacade('#eceff1', '#4a5a62', 3, 4),
    'lloi_giant', 'XE ĐẠP THỐNG NHẤT — GIANT', '#1565c0', '#ffffff');
  // Bạc Hải Yến — 3T đen, biển trắng chữ đen gắn mặt tiền (fix sign h0)
  dgShop(880, 115.5, ryW, 8, 9, 3, 3.2, mat(0x26262a),
    'lloi_bachaiyen', 'BẠC HẢI YẾN', '#f2f0ea', '#1c1c1e');
  // Huy Luxury — 3T đen số 203, băng rôn SALE OFF (bờ đối diện)
  const g4 = dgShop(893.7, 135.2, ryE, 9, 9, 3, 3.2, mat(0x2a2a2e),
    'lloi_huyluxury', 'HUY LUXURY — THỜI TRANG CAO CẤP', '#17181b', '#e8c96a');
  if (g4) {
    const sale = new THREE.Mesh(new THREE.PlaneGeometry(2, 3.6), dgSign('SALE OFF', '#c62828', '#ffffff', 54));
    sale.rotation.z = Math.PI / 2; sale.position.set(3.2, 4.6, 4.65); g4.add(sale);
  }
}



  // ===== CELL_TTBAC: 15 block lõi bắc HVT/ĐTH/NTP (agent nháp + phân tích xung đột, helper tb*) =====
// ============================================================================
// NHÁP 15 KHỐI — MẶT TRẬN TRUNG TÂM-BẮC (2 ô 300m: (0,-600) & (0,-300))
// 39 pano điểm 0.9-2.5: trục Hoàng Văn Thụ / Đinh Tiên Hoàng / Trần Quang Khải /
// Nguyễn Tri Phương. Nguồn: compare_full_sol56 + audit_done.json + ẢNH THẬT
// audit/550_pano_dai_trung_tam_hai_phong (đã xem 14 pano × 2-3 heading).
//
// VỊ TRÍ DÁN: js/world.js, cuối khối "CÔNG TRÌNH ĐẶC TRƯNG dải trung tâm"
// (sau block lm_drafts lô 2 ~line 2280) — SAU khai báo FEATURED_CLEAR (1468),
// TRƯỚC khối nhà OSM + shophouse, để FEATURED_CLEAR.push() đuổi nhà tự sinh.
//
// Mọi tọa độ đã DỜI KHỎI TIM ĐƯỜNG (quy tắc: nửa_lòng p6.5/s5/t4 + 2.3 vỉa hè
// + D/2 [+ sân]); tim tra theo polyline ROADS_DT thật:
//   HVT nam  road#219 tim x≈-42.7…-46.5 (z -240→-399); HVT bắc road#463 x≈-48…-52
//   ĐTH nam  road#7   x = 53-0.105·t (z -459→-269), đoạn -269→-208 x≈33.5-38
//   ĐTH bắc  road#464 x = 84-0.115·t từ (84,-727), z=-727+0.993t
//   TQK      road#355 z ≈ -266…-269 (E-W);  NTP road#379 z = -727-0.375(x-84)
//   ĐBP đông road#43 tim z≈-453.5; ĐBP tây road#532 z≈-460
// Bearing từng công trình đã kiểm khớp bucket heading của fix (ghi trong comment).
// Scope giả định (trong buildWorld): THREE, mat, makeTex, sharedMats, addCollider,
// FEATURED_CLEAR, groundHeight, groundHeightNoDeck, isWater, LAND_H, localPt,
// mergeGeometries, scene.  KHÔNG import. Helper prefix "tb" (không đụng lm*/hb*/bc*).
// ============================================================================

// === HELPER CHUNG TB (dán 1 LẦN trước 15 block dưới) ===
const tbSign = (txt, bg, fg = '#ffffff', px = 50) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 26);
  }),
});
const tbFacade = (baseCss, winCss, cols, rows, archTret = false) => {  // archTret: trệt cửa vòm (phố Pháp)
  const t = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.1, my = h * 0.1, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const x0 = mx + c * cw + cw * 0.18, y0 = my + r * ch + ch * 0.18, ww = cw * 0.64, hh = ch * 0.62;
      g.fillStyle = winCss;
      if (archTret && r === rows - 1) {              // hàng dưới cùng = trệt: cửa vòm
        g.fillRect(x0, y0 + hh * 0.3, ww, hh * 0.9);
        g.beginPath(); g.arc(x0 + ww / 2, y0 + hh * 0.3, ww / 2, Math.PI, 0); g.fill();
      } else g.fillRect(x0, y0, ww, hh);
    }
  });
  return new THREE.MeshLambertMaterial({ map: t });
};
const tbOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - LAND_H) < 0.4 && !isWater(x, z);
// khối nhà hộp nhanh: trả group đã đặt+xoay (front = local +Z), KHÔNG collider (tự thêm ngoài)
const tbBlockM = (x, z, ry, W, H, D, wallMat, name) => {
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry;
  const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), wallMat); body.position.y = H / 2; g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W + 0.8, 0.55, D + 0.8), mat(0xb8b2a2)); roof.position.y = H + 0.27; g.add(roof);
  g.name = name; return g;
};
const tbDone = (g, x, z, r, clearR) => {             // shadow + add + collider + FEATURED_CLEAR
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(g);
  if (r > 0) addCollider(x, z, r);
  FEATURED_CLEAR.push([x, z, clearR]);
};
// hàng rào sắt: trụ + 2 thanh ngang, merged 1 mesh (không collider — người lách qua cổng)
const tbFence = (ax, az, bx, bz, h, hex, postEvery = 3) => {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, geos = [];
  const yaw = Math.atan2(ux, uz);
  for (let d = 0; d <= L; d += postEvery) {
    const p = new THREE.BoxGeometry(0.12, h, 0.12);
    p.rotateY(yaw); p.translate(ax + ux * d, groundHeight(ax + ux * d, az + uz * d) + h / 2, az + uz * d);
    geos.push(p);
  }
  for (const fy of [h * 0.55, h * 0.95]) {
    const rail = new THREE.BoxGeometry(0.07, 0.07, L);
    rail.rotateY(yaw); rail.translate((ax + bx) / 2, groundHeight((ax + bx) / 2, (az + bz) / 2) + fy, (az + bz) / 2);
    geos.push(rail);
  }
  const m = new THREE.Mesh(mergeGeometries(geos), mat(hex)); m.castShadow = true; return m;
};
// chòi gác nhỏ mái chóp (compound công sở — ảnh 496_h090/393_h090)
const tbHut = (x, z, ry, wallHex, roofHex) => {
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry;
  const b = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.0, 2.6), mat(wallHex)); b.position.y = 1.5; g.add(b);
  const r = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.3, 4), mat(roofHex)); r.position.y = 3.65; r.rotation.y = Math.PI / 4; g.add(r);
  return g;
};

// === (TB1) KS THẮNG LONG — CÁNH SẢNH TRẮNG HÀNG CỘT "2 HVT" + KS sọc xanh nền
//     (pano_220 h270 = 0 điểm: "KS Thắng Long trắng 6T, hàng cột, mái sảnh";
//     pano_540 h0 "công trình tân cổ điển hàng cột phía Bắc"; pano_395 h0
//     "công trình trắng 4T hàng cột Corinthian". Ảnh 220_h270: sảnh trắng 2-3T
//     hàng cột + số "2" vàng trên trụ, sân đỗ + cây trước, góc TÂY-BẮC nút
//     HVT×NTP. Bearing: 220→(-95,-702)=292° ✓h270; 540→=26° ✓h0.
//     ⚠ CÙNG BĐS với block (B7) thanglong_hotel (-88,-772) world.js:3628 (nháp
//     từ pano_219 phía bắc) — đây là CÁNH NAM cùng khuôn viên, KHÔNG đè nhau
//     (cách 70m); khi tích hợp xem render 2 khối có liền mạch, nếu lệch thì xóa
//     bớt 1. Tim HVT bắc road#178 x≈-55; front đông x -88 → sân 26m như thật) ===
{
  const bx = -95, bz = -702;
  if (tbOK(bx, bz)) {
    const ry = Math.PI / 2;                        // mặt về ĐÔNG ra sân + nút giao
    const g = tbBlockM(bx, bz, ry, 42, 12.6, 14, tbFacade('#f4f1e8', '#4a5860', 9, 3), 'tb_thanglong_canhnam');
    // hàng cột trắng cao 2 tầng dọc mặt đông (photo: colonnade 8 cột)
    for (let i = 0; i < 8; i++) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 9.2, 10), mat(0xf7f5ef));
      col.position.set(-17.5 + i * 5, 4.6, 8.6); g.add(col);
    }
    const arch = new THREE.Mesh(new THREE.BoxGeometry(42, 2.2, 2.4), mat(0xf4f1e8)); arch.position.set(0, 10.3, 8.4); g.add(arch);
    const par = new THREE.Mesh(new THREE.BoxGeometry(43, 1.1, 15), mat(0xefeadd)); par.position.y = 13.1; g.add(par);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), tbSign('2', '#f4f1e8', '#b8912f', 64));
    s2.position.set(-19.2, 6.4, 8.9); g.add(s2);
    tbDone(g, bx, bz, 0, 32);
    for (const lx of [-14, 0, 14]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 9); }
    // annex nhà hàng hiên đen (phải khung h270, cây rợp) — giữa cánh nam và B7
    if (tbOK(-88, -724)) {
      const a = tbBlockM(-88, -724, Math.PI / 2, 16, 7.2, 11, mat(0x6d5844), 'tb_thanglong_annex');
      const can = new THREE.Mesh(new THREE.BoxGeometry(15, 0.25, 3.6), mat(0x2e2b28)); can.position.set(0, 3.4, 7); a.add(can);
      tbDone(a, -88, -724, 8.5, 14);
    }
    // KS sọc xanh 7T nền sau TÂY-BẮC (ảnh 220_h270 hậu cảnh; 220→(-140,-700)=283°✓)
    if (tbOK(-140, -700)) {
      const h = tbBlockM(-140, -700, Math.PI / 2, 26, 23.1, 13, tbFacade('#eef2f4', '#2f6fa8', 7, 7), 'tb_hotel_socxanh');
      tbDone(h, -140, -700, 14, 20);
    }
  }
}

// === (TB2) TRƯỜNG HỌC CONG HỒNG-KEM 4T — bờ ĐÔNG HVT sát nút NTP
//     (pano_220 h90 "trường học cong 4 tầng đối diện" + h180 "trường học cong
//     bên trái" — ảnh 220_h090/h180: khối dài 4T hồng-kem, BAN CÔNG/lô-gia
//     trắng chạy NGANG liên tục từng tầng, GÓC BO TRÒN phía nút giao, hàng cau
//     trong sân, rào sắt; pano_537 h90 (1.4đ) "công sở 3 tầng hồng-kem dài
//     ~40m lô-gia liên tục, sân + rào" = CHÍNH dãy này nhìn từ nam.
//     Bearing: 220→(-24,-648)=136°✓h90-180; 537→(-38,-627 mép)=90°✓.
//     Tim HVT road#463 x≈-51.5 → front tây x -38 (sân 6m) ===
{
  const bx = -24, bz = -646;
  if (tbOK(bx, bz)) {
    const ry = -Math.PI / 2;                       // mặt về TÂY ra HVT
    const g = tbBlockM(bx, bz, ry, 52, 13.2, 13, tbFacade('#e8cfc0', '#5d6a70', 12, 4), 'tb_truongcong_hvt');
    for (let f = 1; f <= 4; f++) {                 // lô-gia trắng ngang liên tục mỗi tầng
      const band = new THREE.Mesh(new THREE.BoxGeometry(52.4, 0.5, 1.1), mat(0xf2ede4));
      band.position.set(0, f * 3.3 - 0.55, 7.0); g.add(band);
    }
    tbDone(g, bx, bz, 0, 34);
    for (const lx of [-18, 0, 18]) { const [cx, cz] = localPt(bx, bz, lx, 0, ry); addCollider(cx, cz, 10); }
    // góc BO TRÒN phía nút (tây-nam khối, NTP tim z≈-684 tại x-31 → mép nam -660 còn 15m đệm)
    const gy = groundHeight(-31, -668);
    const corner = new THREE.Mesh(
      new THREE.CylinderGeometry(8, 8, 13.2, 14, 1, false, Math.PI, Math.PI / 2), mat(0xe8cfc0));
    corner.position.set(-31, gy + 6.6, -668); corner.castShadow = true; corner.name = 'tb_truongcong_goc'; scene.add(corner);
    addCollider(-31, -670, 7.5); FEATURED_CLEAR.push([-31, -670, 13]);
    // rào sắt + sân trước dọc HVT
    scene.add(tbFence(-38.5, -618, -38.5, -668, 1.7, 0x4a6c58));
  }
}

// === (TB3) NÚT NTP TÂY: GOLD STAR HOSPITAL + THÁP KÍNH + MSB + BIỆT THỰ TRẮNG
//     (pano_540 = 1.1đ: h90 "bệnh viện Gold Star mặt lam kim loại 5T" — ảnh
//     540_h090: mặt LAM KIM LOẠI tối + biển đen chữ đỏ GOLD STAR HOSPITAL số 6
//     NTP + NHÀ THUỐC; h180 "cao ốc kính bệnh viện 6T"; h0 "cụm MSB 4T" — ảnh
//     540_h000: MSB trắng modernist băng kính + logo đỏ. pano_537 h270 "biệt
//     thự trắng 2T mái đỏ cổng trụ rào vòm". Bearing 540→GoldStar(-88,-641)=100✓,
//     →MSB(-140,-679)=341✓, →tháp(-115,-622)=166✓; 537→(-68,-628)=270✓) ===
{
  // Gold Star Hospital — nam NTP (front TÂY-BẮC ra đường, n=( -0.358,-0.934))
  if (tbOK(-88, -641)) {
    const ry = Math.atan2(-0.358, -0.934);         // ≈ -2.776
    const g = tbBlockM(-88, -641, ry, 24, 16.5, 14, tbFacade('#3a3f45', '#20242a', 10, 5), 'tb_goldstar');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.0), tbSign('GOLD STAR HOSPITAL', '#17181a', '#d43b3b', 46));
    s.position.set(0, 12.6, 7.2); g.add(s);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), tbSign('NHÀ THUỐC', '#7a1f1f', '#ffe9c9', 46));
    s2.position.set(-7, 2.6, 7.2); g.add(s2);
    tbDone(g, -88, -641, 13, 20);
  }
  // tháp kính 6T phía nam (hậu cảnh h180)
  if (tbOK(-115, -622)) {
    const t = tbBlockM(-115, -622, Math.atan2(-0.358, -0.934), 22, 19.8, 14, tbFacade('#9fb6bf', '#37545f', 8, 6), 'tb_goldstar_thap');
    tbDone(t, -115, -622, 12, 18);
  }
  // MSB 4T trắng — bắc NTP (front ĐÔNG-NAM ra đường)
  if (tbOK(-140, -679)) {
    const ry = Math.atan2(0.358, 0.934);           // ≈ 0.366
    const g = tbBlockM(-140, -679, ry, 24, 13.6, 13, tbFacade('#f0efe9', '#33454e', 8, 4), 'tb_msb_ntp');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.5), tbSign('MSB', '#ffffff', '#e2492f', 60));
    s.position.set(-5, 9.8, 6.9); g.add(s);
    tbDone(g, -140, -679, 13, 20);
  }
  // biệt thự trắng 2T mái đỏ + rào vòm trắng — tây HVT (pano_537 h270)
  if (tbOK(-68, -628)) {
    const g = tbBlockM(-68, -628, Math.PI / 2, 13, 7.2, 10, tbFacade('#f2efe6', '#57646b', 4, 2), 'tb_bietthu_trang_hvt');
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.4, 2.6, 4), mat(0x9e4436));
    roof.position.y = 8.3; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.72); g.add(roof);
    tbDone(g, -68, -628, 7.5, 12);
    scene.add(tbFence(-60.5, -618, -60.5, -638, 1.6, 0xe8e5da));
  }
}

// === (TB4) QUẦN THỂ NÚT NTP ĐÔNG: CỔNG TRƯỜNG NGUYỄN TRI PHƯƠNG (bắc) +
//     DÃY CÔNG SỞ PHÁP VÀNG 2T (nam NTP)
//     (pano_527 = 1.8đ h0 "cổng Trường NTP mái ngói đỏ + khối vàng kem 2T",
//     h180/h90 "công sở Pháp vàng 2T cửa vòm chớp xanh"; pano_362 h180+h90
//     cùng dãy công sở; pano_361/538 h0 "công sở Pháp 1T lùi sân rào sắt trụ
//     vàng". Bearing: 527→cổng(43,-722)=345✓h0, →côngsở(44,-694)=191✓h180;
//     362→(10,-680)=166✓h180, →(44,-694)=95✓h90.
//     Tim NTP z=-727-0.375(x-84): x43→-712; sân trước 3-4m đã cộng) ===
{
  // cổng trường mái ngói đỏ + rào + khối trường vàng kem 2T lùi sâu (bắc NTP)
  if (tbOK(36, -742)) {
    const gate = new THREE.Group(); gate.position.set(43, groundHeight(43, -722), -722);
    gate.rotation.y = Math.atan2(-0.351, -0.936) + Math.PI;    // nhìn về đường (nam)
    for (const sx of [-2.6, 2.6]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 0.7), mat(0xe6c464)); p.position.set(sx, 1.7, 0); gate.add(p);
    }
    const r = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.9, 1.6), mat(0x9e4436)); r.position.y = 3.7; gate.add(r);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 0.85), tbSign('TRƯỜNG TIỂU HỌC NGUYỄN TRI PHƯƠNG', '#f5efdd', '#1c4587', 26));
    s.position.set(0, 2.9, 0.9); gate.add(s);
    gate.name = 'tb_cong_truong_ntp'; tbDone(gate, 43, -722, 0, 9);
    const sch = tbBlockM(36, -742, 0, 34, 7.4, 12, tbFacade('#efe0b4', '#5d6a70', 9, 2, true), 'tb_truong_ntp');
    tbDone(sch, 36, -742, 0, 24);
    addCollider(26, -742, 9); addCollider(46, -742, 9);
    // rào sắt xanh 2 bên cổng — bám 10m bắc tim NTP (z = -727-0.375(x-84) − 10)
    scene.add(tbFence(28, -716.5, 40, -721, 1.6, 0x3f5d4e));
    scene.add(tbFence(46, -723, 58, -727.5, 1.6, 0x3f5d4e));
  }
  // dãy công sở Pháp vàng 2T nam NTP — 2 khối, mái ngói, cửa vòm trệt, sân + rào thấp
  const ryS = Math.atan2(-0.351, -0.936);          // mặt về TÂY-BẮC ra NTP
  for (const [bx, bz, W] of [[10, -681, 26], [44, -694, 26]]) {
    if (!tbOK(bx, bz)) continue;
    const g = tbBlockM(bx, bz, ryS, W, 7.6, 12, tbFacade('#e6c464', '#43604f', 7, 2, true), 'tb_congso_ntp_' + bx);
    const rf = new THREE.Mesh(new THREE.BoxGeometry(W + 1, 1.5, 13.4), mat(0x8a4636)); rf.position.y = 8.4; g.add(rf); // mái ngói thấp
    tbDone(g, bx, bz, 0, W / 2 + 9);
    addCollider(bx - 8, bz - 3, 8); addCollider(bx + 8, bz + 3, 8);
  }
  scene.add(tbFence(-2, -685.5, 28, -696.5, 1.4, 0x7a7d80));   // rào sắt thấp trước sân (9m nam tim NTP)
}

// === (TB5) ĐINH TIÊN HOÀNG TÂY: THÀNH ĐOÀN 3T VÀNG + NHÀ KEM-HỒNG + TẬP THỂ VÀNG Ố
//     (pano_393 = 1.0đ h270 "công sở Pháp vàng kem 3T mặt tiền 35m" + sign
//     "cờ, băng rôn Đoàn" — ảnh 393_h270: 3T vàng kem, ban công con tiện, cửa
//     chớp xám, băng rôn XANH DƯƠNG trên tường, 2 cờ đỏ; pano_392 h270 "công sở
//     Pháp vàng kem 3T + nhà kem-hồng cửa chớp xanh"; pano_394 h270 "nhà tập thể
//     vàng ố 2T, cổng ngõ, quán mái bạt". Bearing: 393→(52,-608)=277✓;
//     392→(54,-624)=272✓; 394→(43.5,-528)=277✓. Tim ĐTH x=70.2@z-608) ===
{
  if (tbOK(52, -608)) {
    const g = tbBlockM(52, -608, Math.PI / 2, 28, 10.8, 14, tbFacade('#e8c86a', '#6b7a80', 8, 3, true), 'tb_thanhdoan');
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 2.6), tbSign('TUỔI TRẺ KHỐI DOANH NGHIỆP', '#1c67b5', '#ffffff', 30));
    bn.position.set(-8, 4.2, 7.15); g.add(bn);
    for (const sx of [-3, 3]) {                    // 2 cờ đỏ trên ban công
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.1), new THREE.MeshLambertMaterial({ color: 0xc22a1e, side: THREE.DoubleSide }));
      fl.position.set(sx, 9.4, 7.4); g.add(fl);
    }
    tbDone(g, 52, -608, 0, 24);
    addCollider(44, -608, 8); addCollider(60, -608, 8);
  }
  if (tbOK(54, -624)) {
    const g = tbBlockM(54, -624, Math.PI / 2, 16, 10.2, 12, tbFacade('#efd9c4', '#4d6a55', 5, 3), 'tb_kemhong_dth');
    tbDone(g, 54, -624, 9, 14);
  }
  if (tbOK(43.5, -528)) {
    const g = tbBlockM(43.5, -528, Math.PI / 2, 18, 7.0, 11, tbFacade('#d9c88f', '#5d6a70', 6, 2), 'tb_tapthe_vango');
    const aw = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 2.2), mat(0x3f6e50)); aw.position.set(-4, 3.1, 6.6); aw.rotation.x = 0.28; g.add(aw);
    tbDone(g, 43.5, -528, 10, 15);
  }
}

// === (TB6) ĐINH TIÊN HOÀNG ĐÔNG: 2 KHUÔN VIÊN CÔNG SỞ PHÁP (mansard trắng +
//     chòi gác vàng; compound rào đen lùi sâu 50m) + BIỆT THỰ VÀNG 3T
//     (pano_496 = 1.5đ h90 — ảnh 496_h090: nhà TRẮNG 3T MÁI MANSARD XÁM sau
//     sân, CỔNG SẮT TRẮNG kép trụ đá + CHÒI GÁC VÀNG mái chóp, rào trắng con
//     tiện dài; pano_392/393 h90 — ảnh 393_h090: rào SẮT ĐEN + cổng trụ trắng,
//     nhà 2T kem mái đỏ LÙI SÂU ~50m trong sân cây; pano_551 h90 "biệt thự Pháp
//     3T vàng kem, sân cổng rào sắt". Bearing: 496→(91,-543)=97✓; 551→(83,-584)
//     =100✓; 392→trong sân (110,-612)=99✓. Tim ĐTH x=63@z-546, 67.7@z-586.5.
//     ⚠ rào trắng dừng ở z -535 để không lấn zone Bảo tàng (x64..135,z-535..-466)) ===
{
  // khuôn viên 1: mansard trắng + chòi gác vàng + rào trắng (9 ĐTH)
  if (tbOK(91, -543)) {
    const g = tbBlockM(91, -543, -Math.PI / 2, 22, 8.4, 13, tbFacade('#f4f1e8', '#4f463c', 7, 2), 'tb_mansard_dth');
    const mr = new THREE.Mesh(new THREE.BoxGeometry(21, 3.2, 12), mat(0x5a5f66)); mr.position.y = 9.9; g.add(mr);
    const mr2 = new THREE.Mesh(new THREE.BoxGeometry(16, 1.6, 8), mat(0x565b62)); mr2.position.y = 12.2; g.add(mr2);
    tbDone(g, 91, -543, 12, 18);
    scene.add(tbHut(74.5, -550, -Math.PI / 2, 0xe6c464, 0x8a4636));
    addCollider(74.5, -550, 2);
    scene.add(tbFence(72, -536, 72, -560, 1.7, 0xe8e5da));     // rào trắng con tiện
  }
  // biệt thự vàng 3T + rào (7 ĐTH — pano_551)
  if (tbOK(83, -584)) {
    const g = tbBlockM(83, -584, -Math.PI / 2, 20, 10.2, 12, tbFacade('#e8c86a', '#43604f', 6, 3), 'tb_bietthu_vang_dth');
    tbDone(g, 83, -584, 11, 16);
    scene.add(tbFence(76, -570, 76, -596, 1.7, 0xe8e5da));
  }
  // khuôn viên 2: rào đen + cổng trắng + nhà 2T kem mái đỏ lùi sâu + bốt gác (5-6 ĐTH)
  if (tbOK(110, -612)) {
    const g = tbBlockM(110, -612, -Math.PI / 2, 24, 7.4, 12, tbFacade('#efe0b4', '#5d6a70', 7, 2), 'tb_compound_sau_dth');
    const rf = new THREE.Mesh(new THREE.BoxGeometry(25, 1.6, 13.2), mat(0x8a4636)); rf.position.y = 8.2; g.add(rf);
    tbDone(g, 110, -612, 13, 18);
    scene.add(tbHut(80, -617, -Math.PI / 2, 0xf2efe6, 0x9e4436));
    scene.add(tbFence(76.5, -600, 74, -640, 1.8, 0x2e3336));   // rào sắt đen mũi nhọn
    for (const dz of [-2.2, 2.2]) {                            // trụ cổng trắng
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.6, 0.8), mat(0xf2efe6));
      p.position.set(75.5, groundHeight(75.5, -617 + dz) + 1.3, -617 + dz); p.castShadow = true; scene.add(p);
    }
  }
}

// === (TB7) BỆNH VIỆN PHỤ SẢN HẢI PHÒNG — khối trắng 8T + khối vàng cũ 5T +
//     tường rào + cổng KHU KHÁM BỆNH (khu đất giữa ĐTH×TQK)
//     (pano_356 = 1.1đ h180 — ảnh 356_h180: khối 5T VÀNG KEM CŨ dài sau tường
//     trắng thấp + rào tôn xanh + trụ cổng trắng biển xanh; h90: tháp TRẮNG 8T
//     hiện đại sát phố; pano_429 h0 "bệnh viện trắng 8T bên phải" — ảnh
//     429_h000: khối trắng biển băng xanh 'BỆNH VIỆN PHỤ SẢN HẢI PHÒNG';
//     pano_051 h90 "Khoa Quốc tế 6T mặt trắng cổ điển"; pano_357 h180 "cổng Khu
//     Khám Bệnh + biển xanh + ATM"; pano_355 h180 "tòa tân cổ điển trắng 6T cửa
//     vòm" = chính khối trắng nhìn từ bắc (bearing 355→(57,-243)=199°... dùng
//     (57,-246)→164✓h180). Bearing: 429→(57,-243)=40 (mép phải h0 ✓ ảnh),
//     051→(55,-235 mép nam)=76✓h90, 357→cổng(150,-258)=175✓h180.
//     Tim: ĐTH x≈35@z-243 → front tây x47; TQK z≈-267 → front bắc z-257.
//     GHI CHÚ ZONE: đề xuất thêm rect cấm infill x45..170 z-258..-225 (PLAN S1)) ===
{
  // khối trắng 8T (Khoa Quốc tế + sảnh) — dọc ĐTH, front TÂY
  if (tbOK(57, -243)) {
    const g = tbBlockM(57, -243, -Math.PI / 2, 30, 26.4, 20, tbFacade('#f2f0ea', '#41525c', 9, 8, true), 'tb_bvps_trang');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(19, 1.6), tbSign('BỆNH VIỆN PHỤ SẢN HẢI PHÒNG', '#1c67b5', '#ffffff', 34));
    s.position.set(0, 24.6, 10.15); g.add(s);
    const cor = new THREE.Mesh(new THREE.BoxGeometry(31, 0.8, 21), mat(0xe4e0d4)); cor.position.y = 22.2; g.add(cor); // gờ cổ điển
    tbDone(g, 57, -243, 0, 26);
    for (const lx of [-10, 10]) { const [cx, cz] = localPt(57, -243, lx, 0, -Math.PI / 2); addCollider(cx, cz, 11); }
  }
  // khối vàng kem cũ 5T — dọc TQK, front BẮC
  if (tbOK(115, -247)) {
    const g = tbBlockM(115, -247, Math.PI, 52, 16.5, 20, tbFacade('#e3d49a', '#4d5a60', 14, 5), 'tb_bvps_cu');
    tbDone(g, 115, -247, 0, 34);
    for (const lx of [-18, 0, 18]) { const [cx, cz] = localPt(115, -247, lx, 0, Math.PI); addCollider(cx, cz, 11); }
  }
  // tường thấp trắng + rào tôn xanh + 2 cổng trụ trắng + biển + ATM dọc TQK
  {
    const wallG = [];
    for (const [x0, x1] of [[92, 104], [112, 144], [156, 166]]) {
      const w = new THREE.BoxGeometry(x1 - x0, 1.0, 0.3); w.translate((x0 + x1) / 2, groundHeight((x0 + x1) / 2, -258.5) + 0.5, -258.5); wallG.push(w);
      const t = new THREE.BoxGeometry(x1 - x0, 1.0, 0.12); t.translate((x0 + x1) / 2, groundHeight((x0 + x1) / 2, -258.5) + 1.5, -258.5); wallG.push(t);
    }
    const wm = new THREE.Mesh(mergeGeometries(wallG), mat(0x3f7ab0)); wm.castShadow = true; wm.name = 'tb_bvps_rao'; scene.add(wm);
    for (const gx of [108, 150]) {                             // trụ cổng trắng + biển xanh
      for (const dx of [-2.6, 2.6]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.6, 0.9), mat(0xf2efe6));
        p.position.set(gx + dx, groundHeight(gx + dx, -258.5) + 1.3, -258.5); p.castShadow = true; scene.add(p);
      }
    }
    const gy = groundHeight(150, -258);
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.9), tbSign('KHU KHÁM BỆNH — BV PHỤ SẢN', '#1c67b5', '#ffffff', 30));
    sb.position.set(150, gy + 2.9, -258.2); sb.rotation.y = Math.PI; scene.add(sb);
    const atm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.4), mat(0x2f7d4f));
    atm.position.set(162, groundHeight(162, -256.5) + 1.2, -256.5); atm.castShadow = true; scene.add(atm);
    addCollider(162, -256.5, 1.4);
    FEATURED_CLEAR.push([150, -240, 20]); FEATURED_CLEAR.push([90, -240, 16]); // đuổi infill lọt giữa 2 khối
  }
}

// === (TB8) CỔNG TRƯỜNG MẦM NON HOÀNG VĂN THỤ + CHỢ HOA QUẢ VỈA HÈ + NHÀ GÓC BO
//     (pano_355 = 1.0đ h0 — ảnh 355_h000: cổng VÒM XANH LÁ cong chữ 'TRƯỜNG MẦM
//     NON HOÀNG VĂN THỤ' + hoa, villa kem 3T mái đỏ trong sân; TRƯỚC cổng = chợ
//     hoa quả: dù đủ màu, sạp, sọt trái cây, ghế đỏ, biển 'HOA QUẢ CÔ CHÁ';
//     fix s2 "nhà góc bo tròn 3T + khối mái tôn xanh sau chợ". Bearing:
//     355→cổng(70,-277)=1°✓h0. Tim TQK z=-268.1@x70 → cổng 8.9m, dù 5.5-6.5m
//     (TRÊN vỉa hè, không lấn lòng — nửa lòng t=4)) ===
{
  if (tbOK(76, -296)) {
    // cổng vòm xanh: 2 trụ + vòm torus + biển
    const gy = groundHeight(70, -277);
    for (const dx of [-3.4, 3.4]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 3.2, 8), mat(0x3f8a4f));
      p.position.set(70 + dx, gy + 1.6, -277); p.castShadow = true; scene.add(p);
    }
    const arc = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.22, 8, 14, Math.PI), mat(0x3f8a4f));
    arc.position.set(70, gy + 3.2, -277); arc.castShadow = true; scene.add(arc);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.8), tbSign('TRƯỜNG MẦM NON HOÀNG VĂN THỤ', '#3f8a4f', '#fff3c4', 28));
    s.position.set(70, gy + 3.0, -276.6); scene.add(s);
    FEATURED_CLEAR.push([70, -279, 8]);
    // villa trường kem 3T mái đỏ trong sân
    const v = tbBlockM(76, -296, 0, 20, 9.9, 14, tbFacade('#f0e6c8', '#5d6a70', 6, 3), 'tb_mamnon_hvt');
    const rf = new THREE.Mesh(new THREE.BoxGeometry(21, 1.8, 15.2), mat(0x9e4436)); rf.position.y = 10.8; v.add(rf);
    tbDone(v, 76, -296, 12, 17);
    // chợ hoa quả: 5 dù màu + sạp + sọt dọc vỉa hè bắc TQK (x 54..88, z -273.6)
    const uc = [0xd94040, 0x3f7ab0, 0x3f8a4f, 0xe3a13a, 0xb04a8f];
    for (let i = 0; i < 5; i++) {
      const ux = 56 + i * 8, uz = -273.6, gy2 = groundHeight(ux, uz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), mat(0x8a8f92)); pole.position.set(ux, gy2 + 1.2, uz); scene.add(pole);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.8, 8), mat(uc[i])); um.position.set(ux, gy2 + 2.6, uz); um.castShadow = true; scene.add(um);
      const stall = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.75, 1.3), mat(0x8a6b4a)); stall.position.set(ux, gy2 + 0.38, uz); stall.castShadow = true; scene.add(stall);
      const fruit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.28, 1.0), mat(i % 2 ? 0xd97b2f : 0x6fae4e)); fruit.position.set(ux, gy2 + 0.9, uz); scene.add(fruit);
    }
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.7), tbSign('HOA QUẢ CÔ CHÁ', '#1c67b5', '#ffe9b0', 40));
    bs.position.set(52, groundHeight(52, -275) + 3.0, -275); scene.add(bs);   // mặt +z (nam) về phố
    // nhà góc bo tròn 3T tây chợ + khối mái tôn xanh sau
    const gy3 = groundHeight(49.5, -281);
    const cg = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 9.9, 14, 1, false, Math.PI / 2, Math.PI / 2), mat(0xdfd2b0));
    cg.position.set(49.5, gy3 + 4.95, -281); cg.castShadow = true; cg.name = 'tb_nhagoc_bo'; scene.add(cg);
    addCollider(49.5, -281, 6); FEATURED_CLEAR.push([49.5, -281, 10]);
    const tin = tbBlockM(56, -292, 0, 14, 5.2, 10, mat(0x3e6f86), 'tb_maiton_xanh');
    tbDone(tin, 56, -292, 8, 12);
  }
}

// === (TB9) UBND PHƯỜNG HOÀNG VĂN THỤ + HANA — bờ ĐÔNG ĐTH 34
//     (pano_049 = 3.0đ h90 sev3 — ảnh 049_h090: khối TRẮNG-BE 4T lùi sân, CỔNG
//     SẮT TRẮNG-VÀNG hoa văn 2 cánh cao, cờ đỏ + cờ phướn xanh, biển đỏ dọc
//     trụ, dù xanh quầy bánh mì cay trong sân; phải = HANA kính đen 4T ~8-9m
//     chữ trắng. Bearing: 049→UBND(63,-338)=96✓, →HANA(53,-353)=135 (mép ✓ảnh).
//     Tim ĐTH x=40.2@z-338 → cổng x49.5 (9.3m), khối x63 (sân 7m)) ===
{
  if (tbOK(63, -338)) {
    const g = tbBlockM(63, -338, -Math.PI / 2, 20, 13.6, 13, tbFacade('#efe9db', '#57646b', 6, 4), 'tb_ubnd_hvt');
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 5.2), tbSign('UBND PHƯỜNG', '#c22a1e', '#ffe9b0', 40));
    bn.position.set(-6.5, 6.2, 6.7); g.add(bn);
    tbDone(g, 63, -338, 12, 18);
    // cột cờ + cổng sắt trắng hoa văn + rào
    const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 9, 8), mat(0xd8d5cc));
    fp.position.set(54, groundHeight(54, -334) + 4.5, -334); scene.add(fp);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshLambertMaterial({ color: 0xc22a1e, side: THREE.DoubleSide }));
    fl.position.set(54.8, groundHeight(54, -334) + 8.4, -334); scene.add(fl);
    for (const dz of [-3.2, 3.2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.9, 0.7), mat(0xe9e6dd));
      p.position.set(49.5, groundHeight(49.5, -340 + dz) + 1.45, -340 + dz); p.castShadow = true; scene.add(p);
    }
    const gt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 6.2), mat(0xcfae52)); // cánh cổng sắt vàng-trắng
    gt.position.set(49.5, groundHeight(49.5, -340) + 1.2, -340); scene.add(gt);
    scene.add(tbFence(49.5, -347, 49.5, -330, 1.6, 0xe9e6dd));
    // quầy bánh mì cay dù xanh-tím trong sân (fix s2 pano_049 h90)
    const um = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8), mat(0x4553a0));
    um.position.set(55, groundHeight(55, -343) + 2.4, -343); scene.add(um);
  }
  if (tbOK(53, -353)) {
    const g = tbBlockM(53, -353, -Math.PI / 2, 9, 13.2, 10, tbFacade('#23262a', '#101214', 3, 4), 'tb_hana');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 1.3), tbSign('HANA', '#17181a', '#f2f0ea', 58));
    s.position.set(0, 11.2, 5.15); g.add(s);
    tbDone(g, 53, -353, 6.5, 11);
  }
}

// === (TB10) CHỢ TRẦN QUANG KHẢI + BAZAAR FOOD GARDEN — bờ NAM TQK 35
//     (pano_353 = 1.8đ h180 — ảnh 353_h180: trái = BAZAAR: nhà khung THÉP ĐEN
//     1-2T mái dốc lớn, cột trắng dạng NHÁNH CÂY, biển vàng 'BAZAAR food
//     garden'; phải = cổng chợ: biển đỏ 'CHỢ TRẦN QUANG KHẢI' trên 2 cột +
//     ngõ + tập thể vàng 3T; sạp dù XANH DƯƠNG + bạt quanh; h270: chợ tràn
//     2 bờ tây. Bearing: 353→BAZAAR(-107,-250)=161✓h180, →cổng(-122,-257)=196✓.
//     Tim TQK z≈-266 → BAZAAR front z-258 (8m), cổng z-259.5) ===
{
  if (tbOK(-107, -250)) {
    const g = new THREE.Group(); g.position.set(-107, groundHeight(-107, -250), -250);
    const hall = new THREE.Mesh(new THREE.BoxGeometry(24, 6.4, 16), mat(0x2b2e31)); hall.position.y = 3.2; g.add(hall);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(26, 0.35, 19), mat(0x1e2124));
    roof.position.y = 7.6; roof.rotation.x = 0.16; g.add(roof);               // mái dốc lớn đen
    for (const sx of [-8, 0, 8]) {                                            // cột trắng nhánh cây (mặt phố = local +Z)
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.2, 8), mat(0xe8e5da));
      c.position.set(sx, 3.1, 8.6); g.add(c);
      for (const a of [-0.5, 0.5]) {
        const br = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.6, 6), mat(0xe8e5da));
        br.position.set(sx + a * 1.2, 6.2, 8.6); br.rotation.z = a; g.add(br);
      }
    }
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), tbSign('BAZAAR food garden', '#141414', '#d8b23f', 44));
    s1.position.set(4, 5.6, 8.15); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), tbSign('BAZAAR beer garden', '#3a3d40', '#d8b23f', 40));
    s2.position.set(-10.5, 1.9, 8.4); g.add(s2);
    g.rotation.y = Math.PI;                                                    // mặt về BẮC ra TQK (local +Z → thế giới -z)
    g.name = 'tb_bazaar'; tbDone(g, -107, -250, 0, 18);
    addCollider(-114, -250, 8); addCollider(-100, -250, 8);
  }
  // cổng chợ đỏ + tập thể vàng 3T sau cổng
  if (tbOK(-124, -242)) {
    const gy = groundHeight(-122, -259.5);
    for (const dx of [-3, 3]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.6, 0.35), mat(0x8a8f92));
      p.position.set(-122 + dx, gy + 1.8, -259.5); p.castShadow = true; scene.add(p);
    }
    const sb = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.0), tbSign('CHỢ TRẦN QUANG KHẢI', '#b3241c', '#ffe9b0', 40));
    sb.position.set(-122, gy + 3.3, -259.4); sb.rotation.y = Math.PI; scene.add(sb);
    FEATURED_CLEAR.push([-122, -259, 6]);
    const tt = tbBlockM(-124, -242, Math.PI, 16, 9.9, 11, tbFacade('#d9c88f', '#5d6a70', 5, 3), 'tb_tapthe_cho');
    tbDone(tt, -124, -242, 9, 13);
  }
  // sạp chợ dù xanh dương + bạt: 5 nam + 3 bắc (đồ tầm người, KHÔNG lấn lòng t=4)
  {
    for (let i = 0; i < 8; i++) {
      const south = i < 5;
      const ux = south ? -132 + i * 8 : -118 + (i - 5) * 9;
      const uz = south ? -260.8 : -271.6;
      if (!tbOK(ux, uz)) continue;
      const gy = groundHeight(ux, uz);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), mat(0x8a8f92)); pole.position.set(ux, gy + 1.15, uz); scene.add(pole);
      const um = new THREE.Mesh(new THREE.ConeGeometry(2.0, 0.75, 8), mat(0x3f6fb0)); um.position.set(ux, gy + 2.5, uz); um.castShadow = true; scene.add(um);
      const stall = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 1.2), mat(0x9a7a52)); stall.position.set(ux, gy + 0.35, uz); scene.add(stall);
    }
  }
}

// === (TB11) TPBANK GÓC TQK + TRƯỜNG TIỂU HỌC ĐINH TIÊN HOÀNG
//     (pano_354 = 1.3đ h180 "TPBank kính tím-trắng 2T mặt ~45m ôm góc Đông-Nam";
//     pano_050 = 4.0đ (cao nhất ô — chỉ vá đích danh) h270 sev3: "Trường Tiểu
//     học: cổng vòm xanh, trụ khẩu hiệu, LED, rào, sân, khối vàng 4T" + h0 rail
//     "tường/rào dọc tây". Bearing: 354→TPB(14,-256)=163✓h180;
//     050→cổng(26.5,-301)=276✓h270, khối vàng(10,-305)=259✓.
//     Tim TQK z=-268.6@x14 → TPB front -261.5; ĐTH x=36.7@z-305 → cổng 10.2m) ===
{
  if (tbOK(14, -256)) {
    const g = tbBlockM(14, -256, Math.PI, 25, 7.4, 11, tbFacade('#f2f0ee', '#6b5ca8', 8, 2), 'tb_tpbank');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 1.3), tbSign('TPBank', '#ffffff', '#6b3fa0', 56));
    s.position.set(0, 6.2, 5.65); g.add(s);
    const gl = new THREE.Mesh(new THREE.BoxGeometry(23, 2.8, 0.15), sharedMats.window); gl.position.set(0, 1.7, 5.6); g.add(gl);
    tbDone(g, 14, -256, 0, 18);
    addCollider(6, -256, 7); addCollider(22, -256, 7);
  }
  // trường tiểu học ĐTH: khối vàng 4T + cổng vòm xanh + trụ khẩu hiệu + rào + sân
  if (tbOK(10, -305)) {
    const g = tbBlockM(10, -305, Math.PI / 2, 30, 13.2, 12, tbFacade('#eed9a0', '#57646b', 9, 4), 'tb_truong_dth');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.1), tbSign('TRƯỜNG TIỂU HỌC ĐINH TIÊN HOÀNG', '#1c4587', '#ffffff', 30));
    s.position.set(0, 12.2, 6.15); g.add(s);
    tbDone(g, 10, -305, 0, 22);
    addCollider(10, -295, 9); addCollider(10, -315, 9);
    const gy = groundHeight(26.5, -301);
    for (const dz of [-2.8, 2.8]) {                            // trụ cổng + khẩu hiệu đỏ
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3.1, 0.8), mat(0xeed9a0));
      p.position.set(26.5, gy + 1.55, -301 + dz); p.castShadow = true; scene.add(p);
      const bn = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.4), tbSign('THI ĐUA DẠY TỐT', '#c22a1e', '#ffe9b0', 30));
      bn.position.set(26.95, gy + 1.7, -301 + dz); bn.rotation.y = Math.PI / 2; scene.add(bn);
    }
    const arc = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.2, 8, 14, Math.PI), mat(0x2f6fa8));
    arc.position.set(26.5, gy + 3.1, -301); arc.rotation.y = Math.PI / 2; arc.castShadow = true; scene.add(arc);
    const led = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.5), tbSign('CHÀO MỪNG NĂM HỌC MỚI', '#101418', '#ff4040', 26));
    led.position.set(26.9, gy + 2.4, -301); led.rotation.y = Math.PI / 2; scene.add(led);
    scene.add(tbFence(26.5, -283, 26.5, -298, 1.6, 0x3f5d4e)); // rào dọc tây ĐTH (fix h0 rail)
    scene.add(tbFence(26.5, -304, 26.5, -322, 1.6, 0x3f5d4e));
    FEATURED_CLEAR.push([20, -305, 14]);                       // giữ sân trường quang
  }
}

// === (TB12) NÚT TRẦN PHÚ × HVT — 4 GÓC ĐÍCH DANH: ELISE + NHÀ PHÁP HIÊN ĐEN +
//     BẮC NAM TAILOR + HMH-BOSCH (pano_254 = 0.9đ, pano_253 = 1.5đ)
//     (ảnh 254_h090: trái = khuôn viên Pháp kem 2-3T MÁI HIÊN ĐEN dài + rào
//     vàng trụ, sau lưng là tháp Hoàng Long (ĐÃ CÓ (-11.8,-256.6) — KHÔNG dựng
//     lại); phải = ELISE trắng tân cổ điển 2T vòm; ảnh 254_h270: BẮC NAM TAILOR
//     2T trắng góc, băng biển 'Thời Trang Thiết Kế - May Đo', kính mannequin.
//     253 h270 "showroom HMH-BOSCH/Takara số 60 cam-trắng". Bearing:
//     253→ELISE(-29,-241)=49 (mép h90 ✓), 254→nhàPháp(-26,-289)=67✓h90,
//     254→BắcNam(-56.5,-283)=272✓h270, 253→HMH(-55,-240)=268✓h270.
//     Tim HVT x≈-42.8. ⚠ ELISE cách tháp Hoàng Long 18m — cùng dãy, không đè) ===
{
  if (tbOK(-29, -241)) {
    const g = tbBlockM(-29, -241, -Math.PI / 2, 24, 8.0, 11, tbFacade('#f4f1ea', '#8a8478', 7, 2, true), 'tb_elise');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.0), tbSign('ELISE', '#111111', '#f4f1ea', 56));
    s.position.set(-5, 6.9, 5.65); g.add(s);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 0.8), tbSign('CHRISBELLA', '#f4f1ea', '#9a2c2c', 44));
    s2.position.set(6, 6.8, 5.65); g.add(s2);
    tbDone(g, -29, -241, 0, 15);
    addCollider(-29, -233, 7); addCollider(-29, -249, 7);
  }
  if (tbOK(-26, -289)) {                           // nhà Pháp kem + mái hiên đen (trước Hoàng Long)
    const g = tbBlockM(-26, -289, -Math.PI / 2, 32, 8.4, 13, tbFacade('#efe3c0', '#5d6a70', 9, 2, true), 'tb_nhaphap_tqk');
    const can = new THREE.Mesh(new THREE.BoxGeometry(30, 0.22, 3.4), mat(0x24272a)); can.position.set(0, 3.6, 8.0); g.add(can);
    tbDone(g, -26, -289, 0, 20);
    addCollider(-26, -278, 8); addCollider(-26, -300, 8);
    scene.add(tbFence(-33.5, -276, -33.5, -302, 1.3, 0xcfae52));
  }
  if (tbOK(-56.5, -283)) {                         // Bắc Nam Tailor — góc vát
    const g = tbBlockM(-56.5, -283, Math.PI / 2, 14, 7.6, 10, tbFacade('#f0ede4', '#3c4348', 4, 2), 'tb_bacnam');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 0.95), tbSign('BẮC NAM TAILOR — THỜI TRANG THIẾT KẾ MAY ĐO', '#f0ede4', '#7a4a1e', 24));
    s.position.set(0, 5.4, 5.15); g.add(s);
    const win = new THREE.Mesh(new THREE.BoxGeometry(9, 2.4, 0.15), sharedMats.window); win.position.set(0, 1.5, 5.1); g.add(win);
    tbDone(g, -56.5, -283, 8, 13);
  }
  if (tbOK(-55, -240)) {                           // HMH-BOSCH số 60
    const g = tbBlockM(-55, -240, Math.PI / 2, 18, 7.2, 10, tbFacade('#f2ede2', '#c96a2a', 6, 2), 'tb_hmh_bosch');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.0), tbSign('HMH — BOSCH — TAKARA', '#c9531e', '#ffffff', 40));
    s.position.set(0, 6.2, 5.15); g.add(s);
    tbDone(g, -55, -240, 9, 14);
  }
}

// === (TB13) HVT 31-46: MẶT TIỀN PHÁP DÀI 58m + TƯỜNG KHUÔN VIÊN NHÀ THỜ +
//     NHA KHOA SING + NHÀ SÁCH ĐỨC MẸ (pano_255 = 0.9đ, pano_256 = 1.5đ)
//     (ảnh 255_h090: mặt tiền Pháp 2T dài: trệt kem CỬA VÒM gỗ đỏ + pilaster +
//     cửa cuốn xám, tầng 2 trắng-hồng nhạt băng hiên; ảnh 255_h270: TƯỜNG đá
//     trắng-xám + trụ cổng trắng cổng sắt, cây rậm khuôn viên (đất nhà thờ —
//     GLB cathedral (-123,-351) ĐÃ CÓ, đây chỉ dựng TƯỜNG BAO phía HVT).
//     256 h90 "Nha khoa Sing 3T ~8m biển xanh-trắng"; 256 h270 "toà Pháp cổ dài
//     2T kem loang" + s2 biển 'Nhà sách Đức Mẹ, Caritas'. Bearing:
//     255→mặtPháp(-30.5,-320)=92✓, →cổng tường(-53,-330)=305 (mép h270✓);
//     256→Sing(-33,-357)=100✓, →nhàsách(-59,-366)=297... dùng (-59,-368)=304
//     (mép h270 — fix ghi h270 ✓). Tim HVT x -44.6…-46) ===
{
  if (tbOK(-30.5, -320)) {                         // mặt tiền Pháp dài 58m — front TÂY
    const g = tbBlockM(-30.5, -320, -Math.PI / 2, 58, 8.2, 13, tbFacade('#efe2c2', '#7c4a38', 14, 2, true), 'tb_matphap_hvt');
    const belt = new THREE.Mesh(new THREE.BoxGeometry(58.3, 0.6, 13.3), mat(0xe7c9c0)); belt.position.y = 4.1; g.add(belt);
    for (let i = 0; i < 7; i++) {                  // pilaster kem nhạt
      const pl = new THREE.Mesh(new THREE.BoxGeometry(0.8, 8.2, 0.3), mat(0xf5ecd4));
      pl.position.set(-24 + i * 8, 4.1, 6.65); g.add(pl);
    }
    tbDone(g, -30.5, -320, 0, 34);
    for (const lx of [-20, 0, 20]) { const [cx, cz] = localPt(-30.5, -320, lx, 0, -Math.PI / 2); addCollider(cx, cz, 9); }
  }
  // tường khuôn viên nhà thờ + trụ cổng (KHÔNG dựng nhà — sau tường là đất GLB cathedral)
  {
    const wg = [];
    for (const [z0, z1] of [[-346, -334], [-326, -302]]) {
      const w = new THREE.BoxGeometry(0.4, 2.2, z1 - z0);
      w.translate(-52.5, groundHeight(-52.5, (z0 + z1) / 2) + 1.1, (z0 + z1) / 2); wg.push(w);
    }
    const wm = new THREE.Mesh(mergeGeometries(wg), mat(0xd9d6cc)); wm.castShadow = true; wm.name = 'tb_tuong_nhatho'; scene.add(wm);
    for (const dz of [-3.2, 3.2]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.8, 0.9), mat(0xf0ede4));
      p.position.set(-52.5, groundHeight(-52.5, -330 + dz) + 1.4, -330 + dz); p.castShadow = true; scene.add(p);
    }
    FEATURED_CLEAR.push([-60, -324, 14]); FEATURED_CLEAR.push([-60, -344, 12]); // khuôn viên xanh sau tường
  }
  if (tbOK(-33, -357)) {                           // Nha khoa Sing 3T hẹp
    const g = tbBlockM(-33, -357, -Math.PI / 2, 9, 9.9, 11, tbFacade('#eef2f4', '#2f6fa8', 3, 3), 'tb_nhakhoa_sing');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.9), tbSign('NHA KHOA SING', '#1c67b5', '#ffffff', 44));
    s.position.set(0, 8.9, 5.65); g.add(s);
    tbDone(g, -33, -357, 6, 10);
  }
  if (tbOK(-59, -368)) {                           // nhà sách Đức Mẹ / Caritas — kem loang 2T dài
    const g = tbBlockM(-59, -368, Math.PI / 2, 26, 7.6, 11, tbFacade('#e2d3ac', '#6a5f4a', 8, 2, true), 'tb_nhasach_ducme');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.9), tbSign('NHÀ SÁCH ĐỨC MẸ — CARITAS', '#2a5c9a', '#fff3c4', 30));
    s.position.set(0, 6.6, 5.65); g.add(s);
    tbDone(g, -59, -368, 0, 17);
    addCollider(-59, -360, 7); addCollider(-59, -376, 7);
  }
}

// === (TB14) HVT 14-28 + GÓC 23: FiiN COFFEE GÓC CONG + DIAMOND POKER +
//     DÃY ARCADE VÀNG Ố + BIỆT THỰ TEAL CƠM VIỆT + TAKE OUT + BẮC KINH + TẬP THỂ
//     (pano_257 = 1.4đ — ảnh 257_h270: FiiN coffee 2T GÓC CONG mái hiên bo
//     tròn kim loại, cây leo tầng 2, Ô DÙ TRẮNG vỉa hè; h90: DIAMOND BRIDGE &
//     POKER đen 2T ~22m KHUNG THÉP biển nóc + nhà ốp đá xám 2T. pano_390/495/
//     536 (2.0-2.6đ) h90: dãy Pháp 2T ARCADE VÒM liên tục vàng ố ~50m; h270:
//     biệt thự teal Cơm Việt + TAKE OUT CAFE 3T. pano_391 h90 "nhà Bắc Kinh 2T
//     ~12m kem ố", h270 "tập thể cũ 4T ban công + quán cà phê". Bearing:
//     257→FiiN(-61,-409)=304 (mép✓ảnh phải khung), →Diamond(-33,-405)=66✓mép90;
//     390→arcade(-36,-537…)=90✓; 495→TAKEOUT(-62.5,-554)=257✓;
//     391→BắcKinh(-36.5,-577)=91✓, →tậpthể(-64,-581)=254✓. Tim HVT x-46.5…-51) ===
{
  if (tbOK(-61, -409)) {                           // FiiN — trụ 1/4 cong góc đông-bắc + cánh
    const gy = groundHeight(-61, -409);
    const cur = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 7.2, 14, 1, false, 0, Math.PI / 2), mat(0x3a3d3b));
    cur.position.set(-61, gy + 3.6, -409); cur.castShadow = true; cur.name = 'tb_fiin_cong'; scene.add(cur);
    const wing = tbBlockM(-66, -413, Math.PI / 2, 12, 7.2, 9, tbFacade('#4a4d4a', '#8fae74', 4, 2), 'tb_fiin_wing');
    tbDone(wing, -66, -413, 8, 12);
    addCollider(-61, -409, 7);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.9), tbSign('FiiN coffee', '#2e3130', '#e8e5da', 48));
    s.position.set(-56.5, gy + 5.6, -406.5); s.rotation.y = Math.PI / 4; scene.add(s);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(7.9, 7.9, 0.18, 14, 1, false, 0, Math.PI / 2), mat(0x6d6f6c));
    can.position.set(-61, gy + 3.9, -409); scene.add(can);    // mái hiên bo tròn
    for (const [ux, uz] of [[-54, -404], [-52.5, -409]]) {    // ô dù trắng vỉa hè
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.3, 6), mat(0x8a8f92)); pole.position.set(ux, gy + 1.15, uz); scene.add(pole);
      const um = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.7, 8), mat(0xf0efe9)); um.position.set(ux, gy + 2.5, uz); um.castShadow = true; scene.add(um);
    }
    FEATURED_CLEAR.push([-63, -411, 13]);
  }
  if (tbOK(-33, -405)) {                           // Diamond Bridge & Poker — đen, biển nóc khung thép
    const g = tbBlockM(-33, -405, -Math.PI / 2, 20, 7.8, 12, tbFacade('#2c2f33', '#4a5560', 6, 2), 'tb_diamond_poker');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.9), tbSign('DIAMOND BRIDGE & POKER', '#101214', '#e8e2c8', 40));
    s.position.set(0, 9.3, 4); g.add(s);
    for (const sx of [-6, 6]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.2, 6), mat(0x6a6f74)); p.position.set(sx, 8.6, 4); g.add(p);
    }
    tbDone(g, -33, -405, 0, 15);
    addCollider(-33, -398, 7); addCollider(-33, -412, 7);
  }
  if (tbOK(-36, -548)) {                           // dãy arcade vòm vàng ố 52m — front TÂY
    const g = tbBlockM(-36, -548, -Math.PI / 2, 52, 7.8, 10, tbFacade('#d8c07c', '#6a5f4a', 13, 2, true), 'tb_arcade_hvt');
    for (let i = 0; i < 12; i++) {                 // cột arcade trệt (hành lang vòm)
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.7, 3.4, 0.7), mat(0xcdb572));
      c.position.set(-22 + i * 4.2, 1.7, 6.2); g.add(c);
    }
    const led = new THREE.Mesh(new THREE.BoxGeometry(52.3, 0.5, 11), mat(0xc4ad6c)); led.position.y = 3.6; g.add(led);
    tbDone(g, -36, -548, 0, 32);
    for (const lx of [-18, 0, 18]) { const [cx, cz] = localPt(-36, -548, lx, 0, -Math.PI / 2); addCollider(cx, cz, 8); }
  }
  if (tbOK(-63, -539)) {                           // biệt thự teal Cơm Việt
    const g = tbBlockM(-63, -539, Math.PI / 2, 14, 7.6, 11, tbFacade('#3e7d78', '#e8e5da', 4, 2), 'tb_comviet');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.8), tbSign('CƠM VIỆT', '#2a5c58', '#ffe9b0', 48));
    s.position.set(0, 6.4, 5.65); g.add(s);
    tbDone(g, -63, -539, 8, 13);
  }
  if (tbOK(-62.5, -554)) {                         // TAKE OUT CAFE 3T
    const g = tbBlockM(-62.5, -554, Math.PI / 2, 10, 9.9, 10, tbFacade('#e8e2d2', '#3c4348', 3, 3), 'tb_takeout');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 0.85), tbSign('TAKE OUT CAFE', '#17181a', '#e8b64a', 40));
    s.position.set(0, 8.9, 5.15); g.add(s);
    tbDone(g, -62.5, -554, 6.5, 11);
  }
  if (tbOK(-36.5, -577)) {                         // nhà Bắc Kinh kem ố 2T ~12m
    const g = tbBlockM(-36.5, -577, -Math.PI / 2, 12, 7.2, 10, tbFacade('#e0d0a2', '#5d6a70', 4, 2), 'tb_backinh');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.9), tbSign('NHÀ HÀNG BẮC KINH', '#9a2c2c', '#ffe9b0', 38));
    s.position.set(0, 6.1, 5.15); g.add(s);
    tbDone(g, -36.5, -577, 7.5, 12);
  }
  if (tbOK(-64, -581)) {                           // tập thể cũ 4T ban công + quán cà phê trệt
    const g = tbBlockM(-64, -581, Math.PI / 2, 22, 13.2, 12, tbFacade('#d9c88f', '#57646b', 7, 4), 'tb_tapthe_hvt14');
    const aw = new THREE.Mesh(new THREE.BoxGeometry(8, 0.12, 2.2), mat(0x6d3b2c)); aw.position.set(-5, 3.1, 7.1); aw.rotation.x = 0.28; g.add(aw);
    tbDone(g, -64, -581, 0, 17);
    addCollider(-64, -573, 8); addCollider(-64, -589, 8);
  }
}

// === (TB15) ĐIỆN BIÊN PHỦ: SCB + NEM + APPLE LAND (nam 73 ĐBP) + CÔNG SỞ RÀO
//     TRẮNG (bắc) + AN TRÀ GÓC CONG + AGRIBANK (nút Hoàng Diệu / 70-84 ĐBP)
//     (pano_161 = 1.5đ h180 — ảnh 161_h180: SCB 5T trắng băng XANH DƯƠNG
//     'NGÂN HÀNG SÀI GÒN' + ATM; NEM kính đen logo trắng; Apple Land LED
//     'iPhone 16 Series'; h0 — ảnh 161_h000: công sở Pháp vàng sau RÀO SẮT
//     TRẮNG cao + băng rôn xanh. pano_389 = 2.0đ h0 "mặt tiền cong 2T AN TRÀ";
//     pano_396 = 3.1đ h0 "Agribank đỏ 4T ~12m + ATM". Bearing: 161→SCB(132,
//     -439)=196✓h180, →côngsở(140,-484)=8✓h0; 389→ANTRÀ(-24,-474)=348✓h0;
//     396→Agribank(13,-473)=0✓h0. Tim ĐBP đông z-453.5, tây z-460.
//     ⚠ Agribank cách BIDV lm_drafts (34.6,-477.7) 22m — KHÔNG đè (đã né x13);
//     khu (64..135,-535..-466) là zone Bảo tàng — cả 6 khối đều NGOÀI) ===
{
  if (tbOK(132, -439)) {                           // SCB 5T
    const g = tbBlockM(132, -439, Math.PI, 20, 16.5, 12, tbFacade('#eef1f2', '#39536b', 6, 5), 'tb_scb');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(15, 1.7), tbSign('SCB — NGÂN HÀNG SÀI GÒN', '#1a4f9c', '#ffffff', 40));
    s.position.set(0, 12.4, 6.15); g.add(s);
    const atm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 1.3), mat(0x1a4f9c));
    atm.position.set(-8, 1.15, 7.2); g.add(atm);
    tbDone(g, 132, -439, 11, 16);
  }
  if (tbOK(147, -440)) {                           // NEM kính đen 3T
    const g = tbBlockM(147, -440, Math.PI, 12, 9.9, 11, tbFacade('#1e2124', '#0e1012', 4, 3), 'tb_nem');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.4), tbSign('NEM', '#111214', '#f2f0ea', 62));
    s.position.set(0, 8.4, 5.65); g.add(s);
    tbDone(g, 147, -440, 7, 11);
  }
  if (tbOK(159, -440)) {                           // Apple Land — LED iPhone
    const g = tbBlockM(159, -440, Math.PI, 10, 7.2, 10, tbFacade('#26292c', '#141618', 3, 2), 'tb_appleland');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 0.8), tbSign('iPhone 16 Series — APPLE LAND', '#101214', '#58c7f0', 30));
    s.position.set(0, 6.1, 5.15); g.add(s);
    tbDone(g, 159, -440, 6.5, 10);
  }
  if (tbOK(140, -484)) {                           // công sở Pháp vàng + rào sắt trắng cao (bắc ĐBP)
    const g = tbBlockM(140, -484, 0, 30, 8.2, 13, tbFacade('#e8c86a', '#43604f', 9, 2, true), 'tb_congso_dbp');
    const rf = new THREE.Mesh(new THREE.BoxGeometry(31, 1.7, 14.4), mat(0x8a4636)); rf.position.y = 9.0; g.add(rf);
    tbDone(g, 140, -484, 0, 22);
    addCollider(130, -484, 8); addCollider(150, -484, 8);
    scene.add(tbFence(120, -464.5, 168, -464.5, 2.0, 0xe8e5da));
    const bn = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.8), tbSign('ĐẢM BẢO NGÂN SÁCH NHÀ NƯỚC', '#1c67b5', '#ffffff', 28));
    bn.position.set(136, groundHeight(136, -464) + 1.6, -464.2); scene.add(bn); // mặt +z (nam) về ĐBP
  }
  if (tbOK(-24, -474)) {                           // AN TRÀ — mặt cong 2T về nút (front BẮC)
    const gy = groundHeight(-24, -474);
    const cur = new THREE.Mesh(new THREE.CylinderGeometry(6.5, 6.5, 7.4, 14, 1, false, -Math.PI / 4, Math.PI / 2), mat(0xefe6d2));
    cur.position.set(-24, gy + 3.7, -474); cur.castShadow = true; cur.name = 'tb_antra_cong'; scene.add(cur);
    const wing = tbBlockM(-28, -479, Math.PI, 14, 7.4, 9, tbFacade('#efe6d2', '#6a5f4a', 5, 2), 'tb_antra_wing');
    tbDone(wing, -28, -479, 8, 13);
    addCollider(-24, -474, 6.5);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), tbSign('AN TRÀ', '#3f6e50', '#fff3c4', 52));
    s.position.set(-24, gy + 5.9, -468.2); scene.add(s);
    FEATURED_CLEAR.push([-25, -476, 11]);
  }
  if (tbOK(13, -473)) {                            // Agribank đỏ đô 4T + ATM
    const g = tbBlockM(13, -473, 0, 13, 13.6, 11, tbFacade('#8e1f24', '#f3e3d3', 4, 4), 'tb_agribank');
    const s = new THREE.Mesh(new THREE.PlaneGeometry(8, 1.2), tbSign('AGRIBANK', '#7a1418', '#ffffff', 52));
    s.position.set(0, 12.2, 5.65); g.add(s);
    const atm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.3, 1.3), mat(0x8e1f24));
    atm.position.set(4.5, 1.15, 6.6); g.add(atm);
    tbDone(g, 13, -473, 8, 13);
  }
}


  // ===== CELL_TAYBAC: 12 block Phạm Phú Thứ/Bạch Đằng khu Hạ Lý tây (agent nháp, helper tw*) =====
// ============================================================================
// MẶT TRẬN TÂY-BẮC — Hạ Lý tây (Phạm Phú Thứ) + Bạch Đằng + bờ tây Tam Bạc
// (Thế Lữ / Tam Bạc / Nguyễn Thái Học / Hà Lý). 16 pano điểm 1.0-2.8 trong 3 ô
// (-900,-300), (-1200,0), (-900,-600). Nguồn: audit_done.json + findings
// compare_full_sol56 + XEM ẢNH THẬT 26 khung (16 pano × ≥2 heading, 2026-07-13).
//
// VỊ TRÍ DÁN: js/world.js — CUỐI khối "CÔNG TRÌNH ĐẶC TRƯNG" (sau khai báo
// FEATURED_CLEAR, TRƯỚC khối OSM "1.200+ TÒA NHÀ THẬT" + shophouse_infill),
// như các đợt lm*/hb*/bc*. Mỗi block tự FEATURED_CLEAR.push để đuổi nhà OSM
// hộp trống + infill trong khuôn viên.
//
// Helper prefix tw — KHÔNG đụng lm*/hb*/bc*/tb*/dg*.
// Scope giả định: THREE, mat, makeTex, sharedMats, addCollider, FEATURED_CLEAR,
// groundHeight, groundHeightNoDeck, isWater, localPt, scene, mergeGeometries.
//
// TỌA ĐỘ ĐƯỜNG (từ ROADS_DT, đã probe):
//  - Phạm Phú Thứ  = road#26  c='t': tim x=-826 (z -110..-472)  → mặt tây
//    x=-832.3, mặt đông x=-819.7 (nửa lòng 4 + 2.3 vỉa hè).
//  - Bạch Đằng     = road#567 c='p': (-541,-470)->(-1102,-477)
//    → twBDz(x) = -470 + 7*(x+541)/561; mặt nam +8.8, mặt bắc −8.8.
//  - Thế Lữ        = road#243 c='t': (-1154,25)->(-918,-51) u=(0.9516,-0.3065).
//  - Nguyễn T.Học  = road#85  c='t': (-1092,95)->(-1052,285) u=(0.206,0.978).
//  - Hà Lý         = road#28  c='t': (-969,-95)->(-1223,-53).
// NƯỚC (probe terrain 2026-07-13): dải z≈40..115 tại x<-1040 là NƯỚC (sông
// Tam Bạc trong game lấn ~70m nam). pano_212 (-1086.8,93.1) gh=-3 → KHÔNG đặt
// gì tại đó; mọi vật kè/công trường đều guard twOK().
// ============================================================================

// === HELPER tw (dán 1 LẦN trước 12 block) ===
const twSign = (txt, bg, fg = '#ffffff', px = 44) => new THREE.MeshLambertMaterial({
  map: makeTex(512, 84, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = `bold ${px}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, w / 2, h / 2 + 2, w - 24);
  }),
});
const twFacade = (baseCss, winCss, cols, rows) => {
  const t = makeTex(256, 256, (g, w, h) => {
    g.fillStyle = baseCss; g.fillRect(0, 0, w, h);
    const mx = w * 0.1, my = h * 0.12, cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      g.fillStyle = winCss; g.fillRect(mx + c * cw + cw * 0.18, my + r * ch + ch * 0.18, cw * 0.62, ch * 0.6);
    }
  });
  return new THREE.MeshLambertMaterial({ map: t });
};
const twStripe = (a, b) => new THREE.MeshLambertMaterial({    // bạt sọc (xanh-trắng...)
  map: makeTex(128, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * w / 8, 0, w / 8, h); }
  }),
});
const twOK = (x, z) => Math.abs(groundHeightNoDeck(x, z) - 2) < 0.45 && !isWater(x, z);
const twGrp = (x, z, ry, name) => {
  const g = new THREE.Group(); g.position.set(x, groundHeight(x, z), z); g.rotation.y = ry; g.name = name;
  return g;
};
const twBox = (grp, W, H, D, m, lx, ly, lz, ry = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), m);
  mesh.position.set(lx, ly, lz); if (ry) mesh.rotation.y = ry; grp.add(mesh); return mesh;
};
const twDone = (g, x, z, r) => {                              // shadow + add + collider + clear
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; }); scene.add(g);
  if (r) { addCollider(x, z, r * 0.62); FEATURED_CLEAR.push([x, z, r + 8]); }
  return g;
};
// tường/rào chạy giữa 2 điểm thế giới (đặt thẳng trên mặt đất, collider mỗi 8m)
const twWall = (x1, z1, x2, z2, H, m, thick = 0.25, collide = true, clear = 0) => {
  if (!twOK(x1, z1) || !twOK(x2, z2)) return null;
  const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz);
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, ry = Math.atan2(dx / L, dz / L) - Math.PI / 2;
  const w = new THREE.Mesh(new THREE.BoxGeometry(L, H, thick), m);
  w.position.set(cx, groundHeight(cx, cz) + H / 2, cz); w.rotation.y = ry; w.castShadow = true; scene.add(w);
  if (collide) for (let d = 0; d <= L; d += 8) addCollider(x1 + dx * d / L, z1 + dz * d / L, 0.6);
  if (clear) for (let d = 6; d < L; d += 14) FEATURED_CLEAR.push([x1 + dx * d / L, z1 + dz * d / L, clear]);
  return w;
};
// rào song sắt (đế thấp + thanh đứng merge + tay vịn) — cổng trường/chợ/kè
const twRail = (x1, z1, x2, z2, H, colHex, step = 1.7) => {
  if (!twOK(x1, z1) || !twOK(x2, z2)) return null;
  const dx = x2 - x1, dz = z2 - z1, L = Math.hypot(dx, dz), g = [];
  for (let d = 0; d <= L + 0.01; d += step) {
    const px = x1 + dx * d / L, pz = z1 + dz * d / L;
    const b = new THREE.BoxGeometry(0.07, H, 0.07); b.translate(px, groundHeight(px, pz) + H / 2, pz); g.push(b);
  }
  const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, gy = groundHeight(cx, cz);
  for (const hy of [H - 0.06, H * 0.45]) {
    const r = new THREE.BoxGeometry(L, 0.07, 0.07);
    r.translate(0, 0, 0); const m = new THREE.Matrix4().makeRotationY(Math.atan2(dx / L, dz / L) - Math.PI / 2);
    r.applyMatrix4(m); r.translate(cx, gy + hy, cz); g.push(r);
  }
  const mesh = new THREE.Mesh(mergeGeometries(g), mat(colHex)); mesh.castShadow = true; scene.add(mesh);
  for (let d = 0; d <= L; d += 8) addCollider(x1 + dx * d / L, z1 + dz * d / L, 0.5);
  return mesh;
};
// mái dốc 2 mái (nóc dọc local X của group)
const twGable = (grp, W, D, eaveY, rise, m) => {
  const a = Math.atan2(rise, D / 2), pl = D / 2 / Math.cos(a);
  for (const s of [1, -1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(W + 0.5, 0.14, pl + 0.3), m);
    p.position.set(0, eaveY + rise / 2, s * D / 4); p.rotation.x = -s * a; grp.add(p);
  }
};
const twTreeAt = (x, z, r = 3.4, h = 6.5) => {                // cây tán tròn đơn giản
  if (!twOK(x, z)) return;
  const gy = groundHeight(x, z), tr = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, h * 0.55, 7), mat(0x6b4f35));
  tr.position.set(x, gy + h * 0.27, z); tr.castShadow = true; scene.add(tr);
  const ca = new THREE.Mesh(new THREE.SphereGeometry(r, 9, 7), mat(0x3e6b2f));
  ca.position.set(x, gy + h * 0.62 + r * 0.55, z); ca.castShadow = true; scene.add(ca);
  addCollider(x, z, 0.55);
};
const twBDz = (x) => -470 + 7 * (x + 541) / 561;              // tim Bạch Đằng theo x

// === (1) THPT LÊ HỒNG PHONG — TÂY Phạm Phú Thứ z -212..-256 (pano_095 h270
//     score 0.5: "toàn bộ cổng THPT Lê Hồng Phong... mái cổng, chữ đỏ, LED, cờ"
//     sev3 ×2; ảnh thật 095_h270: 2 trụ kem chân đỏ nâu + mái phẳng đua, biển
//     đỏ chữ vàng, LED đen, cổng sắt nâu, nhà thường trực nhỏ, RÀO SẮT hở,
//     khối trường 3T vàng kem chạy dọc sau sân) ===
{
  const fx = -832.3;                                          // mặt tây PPT
  if (twOK(fx, -234)) {
    twRail(fx, -212, fx, -227.6, 1.9, 0x4a5568);              // rào sắt 2 đoạn quanh cổng
    twRail(fx, -240.4, fx, -256, 1.9, 0x4a5568);
    const g = twGrp(fx, -234, -Math.PI / 2, 'lhp_gate');      // mặt +Z quay ĐÔNG ra phố
    for (const lz of [-5.4, 5.4]) {                           // (local X dọc phố z)
      twBox(g, 1.3, 4.6, 1.3, mat(0xead9a8), lz, 2.3, 0);     // trụ kem
      twBox(g, 1.42, 0.9, 1.42, mat(0x7e3b2a), lz, 0.45, 0);  // chân đỏ nâu
    }
    twBox(g, 12.4, 0.5, 2.3, mat(0xead9a8), 0, 4.5, 0);       // mái phẳng đua
    const s = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 1.1),
      twSign('TRƯỜNG THPT LÊ HỒNG PHONG', '#a5231f', '#ffd54a', 40));
    s.position.set(0, 3.68, 0.75); s.rotation.y = 0; g.add(s); // biển đỏ chữ vàng (mặt +Z)
    const led = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 0.62), twSign('CHÀO MỪNG NĂM HỌC MỚI', '#131313', '#ff5533', 30));
    led.position.set(0, 2.85, 0.72); g.add(led);              // bảng LED đen
    twBox(g, 9.4, 2.0, 0.1, mat(0x5b4634), 0, 1.0, 0.1);      // cổng sắt nâu (đóng)
    twDone(g, fx, -234, 7);
    // nhà thường trực + khối trường 3T vàng kem hành lang (sân lùi 8m)
    const tt = twGrp(-838.5, -224.5, -Math.PI / 2, 'lhp_bv');
    twBox(tt, 5, 3, 4, mat(0xead9a8), 0, 1.5, 0);
    twBox(tt, 5.6, 0.4, 4.6, mat(0x9e3b30), 0, 3.2, 0);       // mái đỏ phẳng
    twDone(tt, -838.5, -224.5, 3.4);
    const sc = twGrp(-845.5, -231, Math.PI / 2, 'lhp_school'); // trục dài dọc z
    twBox(sc, 32, 10.2, 10, twFacade('#efe3c0', '#5f6d74', 10, 3), 0, 5.1, 0);
    twBox(sc, 33, 0.6, 11, mat(0xb8b2a2), 0, 10.5, 0);
    twDone(sc, -845.5, -231, 0);
    for (const [cx, cz] of [[-845.5, -220], [-845.5, -242]]) { addCollider(cx, cz, 6); }
    FEATURED_CLEAR.push([-845.5, -231, 26], [-834, -234, 11], [-838, -218, 12], [-838, -250, 12]);
    twTreeAt(-834.6, -221, 4.2, 7.5); twTreeAt(-834.8, -248, 4.2, 7.5); // phượng cổng
  }
}

// === (2) KHU MÁI TÔN ĐỎ + RÀO SẮT XANH (mầm non/chợ) — TÂY PPT z -258..-291
//     (pano_096 h270 score 1.0 sev3: "chợ 1 tầng mái tôn đỏ dài, rào sắt xanh,
//     băng rôn khẩu hiệu, bạt che, trạm điện"; ảnh 096_h270: 2 khối mái tôn đỏ
//     dốc + tường thấp vàng + song sắt XANH DƯƠNG + cổng xanh lá + băng rôn đỏ
//     'VÌ LỢI ÍCH TRĂM NĂM PHẢI TRỒNG NGƯỜI' + phượng lớn nhiều thân) ===
{
  const fx = -832.5;
  if (twOK(fx, -275)) {
    twWall(fx, -259, fx, -290.5, 0.9, mat(0xd9c489), 0.3);    // tường thấp vàng
    twRail(fx + 0.05, -259, fx + 0.05, -279.5, 2.0, 0x2456a8, 1.2); // song sắt xanh dương
    twRail(fx + 0.05, -285.5, fx + 0.05, -290.5, 2.0, 0x2456a8, 1.2);
    const gate = twGrp(fx, -282.5, -Math.PI / 2, 'mt_gate');
    twBox(gate, 5.6, 2.1, 0.12, mat(0x1f7a3d), 0, 1.05, 0);   // cổng sắt xanh lá
    twDone(gate, fx, -282.5, 3);
    const A = twGrp(-842, -267, Math.PI / 2, 'mt_khoiA');     // khối mái tôn đỏ (dọc z)
    twBox(A, 13, 3.0, 7, mat(0xdfd3ae), 0, 1.5, 0);
    twGable(A, 13, 7, 3.0, 1.6, mat(0xb03a2a));
    twDone(A, -842, -267, 8);
    const B = twGrp(-841, -282, Math.PI / 2, 'mt_khoiB');
    twBox(B, 11, 3.0, 7, mat(0xdfd3ae), 0, 1.5, 0);
    twGable(B, 11, 7, 3.0, 1.6, mat(0xb03a2a));
    twDone(B, -841, -282, 7);
    const br = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.95),
      twSign('VÌ LỢI ÍCH TRĂM NĂM PHẢI TRỒNG NGƯỜI', '#b91c1c', '#ffe08a', 30));
    br.position.set(-836.2, groundHeight(-836.2, -267) + 4.6, -267); br.rotation.y = Math.PI / 2; scene.add(br);
    const bat = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.2), mat(0x2a5fa8)); // bạt xanh nghiêng dọc rào
    bat.position.set(-834.2, groundHeight(-834, -273) + 2.1, -273);
    bat.rotation.set(0, Math.PI / 2, 0.5); scene.add(bat);
    twBox(twDone(twGrp(-834.4, -262, 0, 'mt_tudien'), -834.4, -262, 1), 0.9, 1.4, 0.7, mat(0x8f9aa3), 0, 0.7, 0);
    twTreeAt(-834.5, -276, 4.6, 7.5);                          // phượng trước rào
    FEATURED_CLEAR.push([-841.5, -274, 15]);
  }
}

// === (3) TRẠM Y TẾ PHƯỜNG HẠ LÝ — ĐÔNG PPT z -316..-338 (pano_097 h0 sev3:
//     "Trạm Y tế Hạ Lý 2 tầng, rộng ~25m, cửa cuốn, cổng đỏ, biển đơn vị";
//     ảnh 097_h000: nhà 2T kem TRỰC TIẾP bên PHẢI/đông, biển trắng chữ đỏ +
//     chữ thập, băng rôn đỏ dài tầng mái, cửa cuốn xám. LƯU Ý nguồn: cổng chào
//     'PHỐ VĂN HÓA' thật nằm Ở NGÕ TÂY — game đang chắn trục bắc, xem PLAN) ===
{
  const bx = -814.7, bz = -327;                                // mặt tây tại x=-819.7
  if (twOK(bx, bz)) {
    const g = twGrp(bx, bz, -Math.PI / 2, 'tramyte_haly');     // mặt +Z quay TÂY ra phố
    twBox(g, 22, 7.4, 10, twFacade('#efe8d5', '#77828a', 7, 2), 0, 3.7, 0);
    twBox(g, 22.6, 0.5, 10.6, mat(0xb8b2a2), 0, 7.65, 0);
    for (const lx of [-7, 0, 7]) twBox(g, 4.6, 2.6, 0.12, mat(0x9aa2a8), lx, 1.3, 5.06); // cửa cuốn xám
    twBox(g, 21.6, 0.5, 0.5, mat(0xffffff), 0, 3.95, 5.2);     // ban công băng trắng
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.85), twSign('TRẠM Y TẾ PHƯỜNG HẠ LÝ', '#f5f2ea', '#b31d1d', 36));
    s1.position.set(-4, 5.0, 5.12); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 0.7), twSign('TRUNG TÂM Y TẾ QUẬN HỒNG BÀNG', '#f5f2ea', '#b31d1d', 30));
    s2.position.set(4.2, 4.1, 5.12); g.add(s2);
    const br = new THREE.Mesh(new THREE.PlaneGeometry(15, 0.7), twSign('SỐNG VÀ LÀM VIỆC THEO PHÁP LUẬT', '#b91c1c', '#ffe08a', 28));
    br.position.set(0, 6.9, 5.14); g.add(br);
    const cross = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), twSign('+', '#ffffff', '#c01f1f', 64));
    cross.position.set(-8.6, 3.2, 5.1); g.add(cross);          // logo chữ thập
    twDone(g, bx, bz, 12);
  }
}

// === (4) CỤM TRƯỜNG TRẦN VĂN ƠN (THCS tường vàng + TH cổng đỏ mái ngói) —
//     ĐÔNG PPT z -340..-402 (pano_098 h90 score 0.5 sev3 "tường vàng dài ~60m";
//     pano_099 h90 score 1.0 sev3 "cổng trụ đỏ mái ngói + biển LED Trần Văn Ơn
//     + hội trường mái ngói đỏ + bảng tin xanh"; ảnh 098_h090: tường vàng ố
//     h~2.2 + biển đỏ nâu chữ vàng; 099_h090: khung cổng ĐỎ NÂU mái ngói 2 lớp,
//     LED đen, rào trắng phải, nhà kho tôn đỏ sẫm cao, nhà vàng cũ 2T trái) ===
{
  const fx = -819.7;                                           // mặt đông PPT
  if (twOK(fx, -370)) {
    twWall(fx, -340, fx, -369, 2.3, mat(0xc9a54b), 0.3, true, 9); // tường vàng ố THCS
    const bs = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.5), twSign('TRƯỜNG THCS TRẦN VĂN ƠN', '#7e2d22', '#ffd54a', 34));
    bs.position.set(fx - 0.2, groundHeight(fx, -364) + 2.1, -364); bs.rotation.y = -Math.PI / 2; scene.add(bs);
    // nhà tập thể vàng cũ 2T + rào B40 + bạt xám (099 h0: "nhà vàng cũ, rào B40")
    const nv = twGrp(-814.5, -376, -Math.PI / 2, 'tvo_nhavang');
    twBox(nv, 11, 6.5, 8, twFacade('#c9a54b', '#8a8f92', 5, 2), 0, 3.25, 0);
    twBox(nv, 11.6, 0.4, 8.6, mat(0x8f8677), 0, 6.7, 0);
    twDone(nv, -814.5, -376, 7);
    twRail(fx, -370, fx, -381.6, 1.7, 0x9aa4ad, 2.2);          // rào B40 xám trước nhà vàng
    // CỔNG Tiểu học TVO z -383..-391 (trụ + khung đỏ nâu, mái ngói đỏ, LED)
    const g = twGrp(fx, -387, Math.PI / 2, 'tvo_gate');        // mặt +Z quay TÂY ra phố
    for (const lx of [-4, 4]) twBox(g, 0.95, 4.0, 0.95, mat(0x8c2f26), lx, 2.0, 0);
    twBox(g, 9.4, 0.5, 1.6, mat(0x8c2f26), 0, 4.1, 0);         // dầm ngang đỏ nâu
    twGable({ add: (m) => { m.position.z += 0; g.add(m); } }, 9.8, 2.4, 4.35, 0.9, mat(0x9e3b30)); // mái ngói 2 dốc
    const led = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.8), twSign('TRƯỜNG TIỂU HỌC TRẦN VĂN ƠN', '#131313', '#ff5533', 30));
    led.position.set(0, 3.35, 0.85); g.add(led);
    twBox(g, 7.4, 1.9, 0.1, mat(0x707a82), 0, 0.95, 0);        // cổng sắt xám
    // cổng phụ mái ngói nhỏ (bắc trụ)
    twBox(g, 2.2, 0.4, 1.3, mat(0x9e3b30), -5.6, 3.1, 0);
    const bt = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), twSign('BẢNG TIN', '#1f6f9e', '#ffffff', 40));
    bt.position.set(6.2, 1.6, 0.4); g.add(bt);                 // bảng tin xanh
    twDone(g, fx, -387, 6);
    twRail(fx, -392, fx, -402, 1.5, 0xe8e8e2, 1.4);            // rào cọc trắng
    // hội trường/kho mái TÔN ĐỎ sẫm chạy sâu vào trong + nhà công vụ xanh nhạt
    const ht = twGrp(-806, -391, 0, 'tvo_hoitruong');
    twBox(ht, 18, 4.2, 9, mat(0xb08968), 0, 2.1, 0);
    twGable(ht, 18, 9, 4.2, 2.1, mat(0x7e2d22));
    twDone(ht, -806, -391, 0);
    addCollider(-812, -391, 5); addCollider(-800, -391, 5);
    const cv = twGrp(-804, -361, 0, 'tvo_congvu');
    twBox(cv, 12, 6.8, 8, twFacade('#cfe3dc', '#5f6d74', 5, 2), 0, 3.4, 0);
    twBox(cv, 12.6, 0.4, 8.6, mat(0xb8b2a2), 0, 7.0, 0);
    twDone(cv, -804, -361, 8);
    FEATURED_CLEAR.push([-810, -352, 14], [-808, -371, 13], [-806, -391, 14], [-812, -399, 10]);
    twTreeAt(-812, -346, 4.5, 8); twTreeAt(-808, -381, 4, 7);  // cây trong sân trường
  }
}

// === (5) TRẠM BIẾN ÁP + THANH HUYỀN APARTMENT — ĐÔNG PPT z -403..-448
//     (pano_100 h90 score 0.5 sev3: "trạm biến áp 40m: máy biến áp, sứ, giàn
//     thép, tường vàng, rào B40, gạch vụn"; h0 sev3: "Thanh Huyền Apartment 5T
//     biển hiệu, mái hiên, chậu cây". Ảnh 100_h090: rào sắt + cột thép giàn +
//     sứ nâu + biến áp xám, tường vàng hậu; 100_h000: tòa kem 5-6T biển xanh
//     chéo THANH HUYEN APARTMENT + chữ Nhật/Hàn + dãy chậu cây) ===
{
  const fx = -819.7;
  if (twOK(fx, -415)) {
    twRail(fx, -403.5, fx, -426, 1.8, 0x8f9aa3, 2.0);          // rào sắt/B40
    const g = twGrp(-812, -414, 0, 'tramdien_haly');
    for (const [lx, lz] of [[-3, -6], [3, -6], [-3, 6], [3, 6]]) {
      twBox(g, 0.32, 9, 0.32, mat(0x7f8a91), lx, 4.5, lz);     // 4 cột thép
      twBox(g, 0.5, 0.5, 0.5, mat(0x6b4f35), lx, 8.2, lz);     // chuỗi sứ nâu
    }
    twBox(g, 6.8, 0.22, 0.22, mat(0x7f8a91), 0, 8.6, -6);      // xà ngang
    twBox(g, 6.8, 0.22, 0.22, mat(0x7f8a91), 0, 8.6, 6);
    for (const lz of [-2.5, 2.5]) {
      twBox(g, 2.6, 0.4, 2.0, mat(0x9aa2a8), 0, 0.2, lz);      // bệ
      twBox(g, 2.3, 2.6, 1.8, mat(0x5b6670), 0, 1.7, lz);      // máy biến áp
      twBox(g, 0.2, 0.9, 0.2, mat(0x6b4f35), 0.6, 3.4, lz);    // sứ trên nóc
    }
    twDone(g, -812, -414, 9);
    twWall(-801, -404, -801, -426, 2.4, mat(0xd9c489), 0.3);   // tường vàng hậu
    const nd = twGrp(-804.5, -421.5, 0, 'tramdien_nha');       // nhà điện vàng 1T
    twBox(nd, 7, 3.6, 5, mat(0xd9c489), 0, 1.8, 0);
    twBox(nd, 7.6, 0.4, 5.6, mat(0xb8b2a2), 0, 3.8, 0);
    twDone(nd, -804.5, -421.5, 4);
    for (const [gx, gz, s] of [[-820.8, -407, 1.2], [-820.4, -412, 0.8], [-818.5, -419, 1.1], [-816, -409, 0.9], [-821, -423, 1.0]]) {
      const rb = new THREE.Mesh(new THREE.BoxGeometry(s, 0.4, s * 0.8), mat(0x9c8a76)); // gạch vụn thi công
      rb.position.set(gx, groundHeight(gx, gz) + 0.2, gz); rb.rotation.y = gx * 3; rb.castShadow = true; scene.add(rb);
    }
    // Thanh Huyền Apartment 5T (bắc trạm, mặt tây)
    const th = twGrp(-814.4, -438.5, -Math.PI / 2, 'thanhhuyen_apt');
    twBox(th, 9, 16.5, 9, twFacade('#ead2c8', '#5f6d74', 3, 5), 0, 8.25, 0);
    twBox(th, 9.6, 0.5, 9.6, mat(0xb8b2a2), 0, 16.8, 0);
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 0.9), twSign('THANH HUYỀN APARTMENT', '#1d4ea3', '#ffffff', 34));
    s1.position.set(0, 12.8, 4.56); th.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.7), twSign('CHO THUÊ CĂN HỘ — ワンルーム', '#e8e8e2', '#3a3f45', 28));
    s2.position.set(0, 11.6, 4.56); th.add(s2);
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.8), twStripe('#e07b28', '#f4efe4'));
    aw.position.set(0, 3.1, 5.2); aw.rotation.x = 0.55; th.add(aw); // hiên bạt sọc cam
    for (let i = 0; i < 4; i++) {                              // dãy chậu cây
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.7), mat(0x39603a));
      p.position.set(-2.4 + i * 1.6, 0.4, 5.0); th.add(p);
    }
    twDone(th, -814.4, -438.5, 8);
    FEATURED_CLEAR.push([-810, -414, 17], [-806, -430, 10]);
  }
}

// === (6) PICO + PYLON CAO THẾ + CPRANK — nút Bạch Đằng × PPT (pano_101 score
//     2.8: h0 sev3 "Pico khối 2T rộng ~45m đỏ-kính + pylon thép sát phố";
//     h90 sev3 "CPRANK kính 5T sát góc phải, bỏ biển treo giữa đường"; pano_100
//     h0 "Pico chính diện trục". Ảnh 101_h000: khối dài trắng viền ĐỎ, biển đỏ
//     Pico giữa, dải logo hãng trắng, sân đất vật liệu, nhà bảo vệ mái đỏ,
//     PYLON lattice lớn bên tây; 101_h090: tòa kính xanh đen CPRANK sát góc) ===
{
  const bx = -842, bz = -500;                                  // BẮC BĐ, sân trước 8.5m
  if (twOK(bx, bz)) {
    const g = twGrp(bx, bz, 0, 'pico_bachdang');               // mặt +Z về nam ra BĐ
    twBox(g, 46, 8, 18, mat(0xf0ece2), 0, 4, 0);               // thân trắng kem
    twBox(g, 46.3, 1.7, 18.3, mat(0xd6231f), 0, 7.0, 0);       // dải viền đỏ quanh mái
    const sp = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), twSign('Pico', '#d6231f', '#ffffff', 60));
    sp.position.set(0, 5.3, 9.2); g.add(sp);
    const lg1 = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.3), twSign('SONY • PANASONIC • LG • TCL', '#f4f2ec', '#3a3f45', 26));
    lg1.position.set(-13, 5.2, 9.18); g.add(lg1);
    const lg2 = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.3), twSign('OPPO • DAIKIN • AQUA • ASUS', '#f4f2ec', '#3a3f45', 26));
    lg2.position.set(13, 5.2, 9.18); g.add(lg2);
    twBox(g, 40, 2.8, 0.14, sharedMats.window, 0, 1.5, 9.05);  // kính trệt
    twDone(g, bx, bz, 0);
    addCollider(bx - 15, bz, 10); addCollider(bx, bz, 10); addCollider(bx + 15, bz, 10);
    FEATURED_CLEAR.push([bx, bz, 33], [bx, bz - 14, 18]);
    for (const [sx, sz] of [[-849, -487], [-836, -486]]) {     // đống cát + pallet sân đất
      const c = new THREE.Mesh(new THREE.ConeGeometry(2, 1.2, 9), mat(0xc9a06c));
      c.position.set(sx, groundHeight(sx, sz) + 0.6, sz); c.castShadow = true; scene.add(c);
    }
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1), mat(0x9a8a6a));
      p.position.set(-830 + i * 2.1, groundHeight(-830, -484) + 0.25, -484); p.castShadow = true; scene.add(p);
    }
    const bv = twGrp(-817.5, -493, 0, 'pico_baove');           // nhà bảo vệ mái đỏ
    twBox(bv, 3.2, 3, 3.2, mat(0xf0ead8), 0, 1.5, 0);
    twBox(bv, 3.8, 0.4, 3.8, mat(0x9e3b30), 0, 3.2, 0);
    twDone(bv, -817.5, -493, 2.6);
    // PYLON cao thế 24m (4 chân + giằng + 2 xà) — "cột điện cao thế sát Pico"
    const py = twGrp(-866, -486, 0.3, 'pylon_pico');
    for (const [lx, lz] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]])
      twBox(py, 0.2, 24, 0.2, mat(0x8e979e), lx, 12, lz);
    for (let hy = 4; hy <= 20; hy += 5) {
      twBox(py, 3.6, 0.14, 0.14, mat(0x8e979e), 0, hy, -1.7);
      twBox(py, 3.6, 0.14, 0.14, mat(0x8e979e), 0, hy, 1.7);
      twBox(py, 0.14, 0.14, 3.6, mat(0x8e979e), -1.7, hy, 0);
      twBox(py, 0.14, 0.14, 3.6, mat(0x8e979e), 1.7, hy, 0);
    }
    twBox(py, 8, 0.3, 0.3, mat(0x8e979e), 0, 20.5, 0);         // 2 xà đỡ dây
    twBox(py, 6, 0.3, 0.3, mat(0x8e979e), 0, 22.8, 0);
    twDone(py, -866, -486, 3);
    // CPRANK — tòa kính xanh đen 5T góc ĐÔNG-NAM nút (mặt bắc ra BĐ)
    const cp = twGrp(-812, -458.6, Math.PI, 'cprank');
    twBox(cp, 10, 17, 12, mat(0x1d3742), 0, 8.5, 0);
    for (let f = 0; f < 5; f++) twBox(cp, 10.15, 1.5, 12.15, sharedMats.window, 0, f * 3.4 + 2.1, 0);
    twBox(cp, 10.6, 0.5, 12.6, mat(0x9aa0a6), 0, 17.3, 0);
    const cs = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 0.9), twSign('CPRANK', '#1257a5', '#ffffff', 44));
    cs.position.set(0, 4.0, 6.12); cp.add(cs);
    twDone(cp, -812, -458.6, 8);
  }
}

// === (7) NHÀ HÀNG GIA VIÊN — vườn rào cọc trắng, BẮC BĐ x -808..-758
//     (pano_417 h0 score 0.5 sev3 ×2: "nhà cấp 4 mái ngói đỏ trong khuôn viên
//     vườn + hàng rào cọc trắng"; ảnh 417_h000: rào trắng con tiện + cổng sắt
//     nâu + nhà mái ngói đỏ dài + mái vòm xám sau cây + pallet gạch trên hè;
//     map: 'Gia Viên Restaurant and event centre'. KHUÔN VIÊN kiểu (b) —
//     FEATURED_CLEAR phủ để corridor Bạch Đằng KHÔNG lấp shophouse vào) ===
{
  const fz = -482;                                             // mặt bắc BĐ tại x≈-783
  if (twOK(-783, fz)) {
    twRail(-808, fz + 0.4, -786.5, fz + 0.15, 1.15, 0xf2f2ec, 1.5); // rào cọc trắng 2 đoạn
    twRail(-779.5, fz + 0.08, -758, fz - 0.15, 1.15, 0xf2f2ec, 1.5);
    const gate = twGrp(-783, fz, 0, 'giavien_gate');
    twBox(gate, 6.4, 1.9, 0.12, mat(0x5b4634), 0, 0.95, 0);    // cổng sắt nâu
    const gs = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), twSign('GIA VIÊN', '#3b5d3a', '#ffe8b0', 44));
    gs.position.set(0, 2.3, 0.1); gate.add(gs);
    twBox(gate, 0.4, 2.6, 0.4, mat(0xcfc9ba), -3.4, 1.3, 0);
    twBox(gate, 0.4, 2.6, 0.4, mat(0xcfc9ba), 3.4, 1.3, 0);
    twDone(gate, -783, fz, 3.6);
    const nh = twGrp(-789, -503, 0, 'giavien_nha');            // nhà chính mái ngói đỏ
    twBox(nh, 16, 4.6, 10, mat(0xf0e8d2), 0, 2.3, 0);
    twGable(nh, 16, 10, 4.6, 2.2, mat(0x99392c));
    for (const lx of [-6, -2, 2, 6]) twBox(nh, 0.4, 3.2, 0.4, mat(0xe8dfc8), lx, 1.6, 5.2); // hiên cột
    twDone(nh, -789, -503, 10);
    const np = twGrp(-770, -496.5, 0.3, 'giavien_phu');        // nhà phụ 1T
    twBox(np, 9, 3.4, 6, mat(0xf0e8d2), 0, 1.7, 0);
    twGable(np, 9, 6, 3.4, 1.5, mat(0x99392c));
    twDone(np, -770, -496.5, 6);
    const dm = twGrp(-797, -512, 0, 'giavien_vom');            // khối mái vòm xám
    twBox(dm, 5.5, 4.2, 5.5, mat(0xece7db), 0, 2.1, 0);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(2.7, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x8e979e));
    dome.position.y = 4.2; dm.add(dome);
    twDone(dm, -797, -512, 4.5);
    for (const [tx, tz] of [[-800, -492], [-792, -490], [-777, -493], [-764, -498], [-802, -507]]) twTreeAt(tx, tz, 3.8, 7);
    for (let i = 0; i < 3; i++) {                              // pallet gạch lát trên hè (thi công)
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1), mat(0xb5a284));
      p.position.set(-800 + i * 9, groundHeight(-800, -480.4) + 0.3, -480.4); p.castShadow = true; scene.add(p);
    }
    FEATURED_CLEAR.push([-800, -496, 16], [-783, -496, 16], [-765, -496, 16]);
  }
}

// === (8) DÃY ĐÍCH DANH NAM BĐ x -798..-760: ĐẠI PHÁT / THIÊN LỘC AUDIO / BIDV
//     / HUY PHƯƠNG / TRÍ ĐỨC (pano_417 h180 score 0.5 sev3 ×2: "BIDV 4 tầng +
//     Trí Đức 3 tầng sát vỉa hè"; h90 sev3 "Thiên Lộc Audio/Đại Phát"; ảnh
//     417_h180: 5 lô liền kề 3-4T kem/trắng/nâu, biển BIDV xanh ngọc, TRÍ ĐỨC
//     đỏ chữ vàng, THIÊN LỘC AUDIO + CHO THUÊ LOA xanh lá, NHÀ NGHỈ HUY PHƯƠNG
//     vàng) — mặt tiền z = twBDz(x)+8.8, D=10 → tâm +5 ===
{
  const lots = [
    [-794.5, 4, 0xe6d3a3, 'ĐẠI PHÁT', '#c22b21', '#ffe08a'],
    [-787, 3, 0xf2efe6, 'THIÊN LỘC AUDIO — CHO THUÊ LOA', '#1f8a3d', '#ffffff'],
    [-779.5, 4, 0xefe6d0, 'BIDV ♦ NGÂN HÀNG ĐẦU TƯ VÀ PHÁT TRIỂN', '#0a5950', '#ffffff'],
    [-772, 4, 0x8a6a4e, 'NHÀ NGHỈ HUY PHƯƠNG', '#e7b53a', '#a5231f'],
    [-764.5, 4, 0xf4f1e8, 'TRUNG TÂM NGOẠI NGỮ TRÍ ĐỨC', '#c22b21', '#ffd54a'],
  ];
  for (const [lx, fl, col, txt, bg, fg] of lots) {
    const cz = twBDz(lx) + 8.8 + 5;
    if (!twOK(lx, cz)) continue;
    const H = fl * 3.3;
    const g = twGrp(lx, cz, Math.PI, `bd_lot_${txt.slice(0, 8)}`); // mặt bắc ra BĐ
    twBox(g, 6.8, H, 10, twFacade('#' + col.toString(16).padStart(6, '0'), '#5f6d74', 2, fl), 0, H / 2, 0);
    twBox(g, 7.1, 0.4, 10.4, mat(0xb8b2a2), 0, H + 0.2, 0);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.0), twSign(txt, bg, fg, 28));
    s.position.set(0, 3.35, 5.08); g.add(s);
    twBox(g, 5.6, 2.4, 0.12, mat(0xd9d2c0), 0, 1.25, 5.02);    // cửa cuốn kem
    twDone(g, lx, cz, 5.4);
  }
  twTreeAt(-791, twBDz(-791) + 7.6, 2.0, 4.5);                 // cây mới trồng chống cọc
  twTreeAt(-769, twBDz(-769) + 7.6, 2.0, 4.5);
}

// === (9) CHI CỤC THUẾ HỒNG BÀNG-AN DƯƠNG + BAOVIET BANK + DẢI TƯỜNG ĐỎ
//     (pano_418 score 1.6: h180 sev3 ×2 "Chi cục Thuế 4T mái tam giác, quốc
//     huy, biển vàng đỏ" + "BaoViet Bank 3T sát bên phải"; h0 sev3 "công trình
//     tường đỏ 1 tầng dài, rào sắt, quán bạt cam". Ảnh 418_h180: tháp trắng
//     5T pediment + quốc huy + biển vàng ngang, BaoViet kính xanh phải(=tây);
//     418_h000: tường/ki-ốt ĐỎ TƯƠI dài + ô cam + cây cổ thụ + rào trắng.
//     CÂY XĂNG thật ở ĐÔNG (x≈-868 nam BĐ) — game đặt TRÙM PANO (-897,-471.1):
//     SỬA Ở NGUỒN world.js RAW cây xăng → (-868,-457.5), xem PLAN mục D) ===
{
  const bx = -891, bz = twBDz(-891) + 8.8 + 6;                 // ≈ (-891,-459.6)
  if (twOK(bx, bz)) {
    const g = twGrp(bx, bz, Math.PI, 'chicucthue');
    twBox(g, 13, 17, 12, twFacade('#f2efe6', '#48586b', 4, 5), 0, 8.5, 0);
    twBox(g, 13, 3, 0.3, mat(0x6d5844), 0, 1.5, 6.05);         // trệt ốp đá nâu
    twGable(g, 13, 5, 17, 1.8, mat(0xe8e2d2));                 // mái/pediment
    const qh = new THREE.Mesh(new THREE.CircleGeometry(0.65, 20), twSign('★', '#d9a821', '#a5231f', 56));
    qh.position.set(0, 15.6, 6.1); g.add(qh);                  // quốc huy
    const s1 = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.95),
      twSign('CHI CỤC THUẾ KHU VỰC HỒNG BÀNG - AN DƯƠNG', '#e7b53a', '#a5231f', 26));
    s1.position.set(0, 10.1, 6.12); g.add(s1);
    const s2 = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.7), twSign('CHI CỤC THUẾ KHU VỰC HỒNG BÀNG', '#8c1d18', '#ffd54a', 28));
    s2.position.set(0, 3.4, 6.12); g.add(s2);
    twDone(g, bx, bz, 9);
    const bv = twGrp(-903.5, twBDz(-903.5) + 8.8 + 5, Math.PI, 'baoviet');
    twBox(bv, 9, 10, 10, mat(0x2a5fa8), 0, 5, 0);
    for (let f = 0; f < 3; f++) twBox(bv, 9.15, 1.4, 10.15, sharedMats.window, 0, f * 3.3 + 2, 0);
    const s3 = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 0.9), twSign('BAOVIET Bank', '#1257a5', '#ffffff', 40));
    s3.position.set(0, 8.6, 5.1); bv.add(s3);
    twDone(bv, -903.5, twBDz(-903.5) + 8.8 + 5, 7);
    // dải tường đỏ + ki-ốt + quán ô cam + rào trắng, BẮC BĐ x -914..-860
    const zN = (x) => twBDz(x) - 8.8;
    twWall(-914, zN(-914) - 0.4, -876, zN(-876) - 0.4, 2.8, mat(0xc22b21), 0.3, true, 10);
    for (const kx of [-905, -888]) {
      const k = twGrp(kx, zN(kx) - 6, 0, 'dinh_kiot');
      twBox(k, 6, 3, 4.5, mat(0xc22b21), 0, 1.5, 0);
      twBox(k, 6.6, 0.4, 5.1, mat(0x8c1d18), 0, 3.2, 0);
      twDone(k, kx, zN(kx) - 6, 4.5);
    }
    twRail(-874, zN(-874) - 0.3, -860, zN(-860) - 0.3, 1.3, 0xf2f2ec, 1.5); // rào sắt trắng
    for (const ox of [-898, -892, -884]) {                     // quán vỉa hè ô/bạt CAM
      const oc = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1.0, 10), mat(0xe07b28));
      const oz = zN(ox) + 2.6;
      if (!twOK(ox, oz)) continue;
      oc.position.set(ox, groundHeight(ox, oz) + 2.1, oz); oc.castShadow = true; scene.add(oc);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.1, 6), mat(0x8a8f92));
      pole.position.set(ox, groundHeight(ox, oz) + 1.05, oz); scene.add(pole);
    }
    twTreeAt(-908, zN(-908) + 1.5, 5.2, 9); twTreeAt(-882, zN(-882) + 1.5, 5.2, 9); // cổ thụ
    FEATURED_CLEAR.push([-895, zN(-895) - 5, 22], [-866, zN(-866) - 4, 12]);
  }
}

// === (10) CÔNG SỞ PHÁP VÀNG KEM + TÒA KÍNH — NAM BĐ x -1000..-915 (pano_419
//     score 1.4: h180 sev3 "công sở Pháp vàng 4T dài ~40m, sảnh vòm, cột, ban
//     công con tiện"; h90 sev3 "tòa văn phòng 6T trắng-kính xanh ~30m bên
//     phải". Ảnh 419_h180: tòa VÀNG KEM 5T, vòm kính đen trệt, băng con tiện
//     trắng mỗi tầng, mái sảnh đen + biển xanh 'BỘ PHẬN TIẾP NHẬN...', băng rôn
//     đỏ; nền sau có tòa kính hiện đại cao — bearing từ pano 117° → bucket 90) ===
{
  const bx = -979, bz = twBDz(-979) + 8.8 + 7;                 // ≈ (-979,-459.7)
  if (twOK(bx, bz)) {
    const g = twGrp(bx, bz, Math.PI, 'congso_phap');           // mặt bắc ra BĐ
    twBox(g, 38, 16.5, 14, mat(0xe8cf9e), 0, 8.25, 0);
    twBox(g, 39, 0.7, 15, mat(0xcbb98e), 0, 16.85, 0);
    twBox(g, 34, 3.2, 0.2, mat(0x2e3438), 0, 1.8, 7.02);       // dải vòm kính đen trệt
    for (let i = 0; i < 8; i++) twBox(g, 0.5, 3.2, 0.28, mat(0xf4ecd8), -14 + i * 4, 1.8, 7.06); // cột trắng nhịp vòm
    for (let f = 1; f <= 4; f++) {
      twBox(g, 38.4, 0.55, 0.5, mat(0xf7f3e8), 0, f * 3.3 + 0.6, 7.15); // băng con tiện trắng
      twBox(g, 38.2, 1.3, 0.16, sharedMats.window, 0, f * 3.3 + 1.7, 7.02);
    }
    twBox(g, 7, 0.4, 3.4, mat(0x2e3438), 0, 4.0, 8.4);         // mái sảnh đen
    twBox(g, 0.35, 4.0, 0.35, mat(0x2e3438), -3, 2, 9.8);
    twBox(g, 0.35, 4.0, 0.35, mat(0x2e3438), 3, 2, 9.8);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 0.8), twSign('BỘ PHẬN TIẾP NHẬN VÀ TRẢ KẾT QUẢ', '#1257a5', '#ffffff', 26));
    s.position.set(0, 3.4, 7.12); g.add(s);
    for (const lx of [-5, 5]) {                                // băng rôn đỏ dọc
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 4.2), twSign('MỪNG ĐẢNG MỪNG XUÂN', '#c01f1f', '#ffe08a', 30));
      b.position.set(lx, 4.4, 7.1); b.rotation.z = Math.PI / 2; g.add(b);
    }
    twDone(g, bx, bz, 0);
    addCollider(bx - 13, bz, 9); addCollider(bx, bz, 9); addCollider(bx + 13, bz, 9);
    FEATURED_CLEAR.push([bx - 12, bz, 17], [bx + 12, bz, 17]);
    // tòa kính trắng-xanh 7T (đông-nam, sau công sở — thấy ở h90 của 419)
    const tk = twGrp(-931, -446, Math.PI, 'toakinh_bd');
    twBox(tk, 26, 23, 17, mat(0xf1f1ec), 0, 11.5, 0);
    for (let f = 0; f < 7; f++) twBox(tk, 26.15, 1.6, 17.15, sharedMats.window, 0, f * 3.2 + 2.1, 0);
    twBox(tk, 27, 0.6, 18, mat(0x9aa0a6), 0, 23.3, 0);
    twDone(tk, -931, -446, 0);
    addCollider(-940, -446, 9); addCollider(-922, -446, 9);
    FEATURED_CLEAR.push([-931, -446, 23]);
    twTreeAt(-994, twBDz(-994) + 11, 4.8, 8.5); twTreeAt(-963, twBDz(-963) + 11, 4.8, 8.5); // xà cừ
  }
}

// === (11) NHÀ HÀNG DÂN CHỦ (góc bo) + BILLBOARD 'VIỆT NAM TIẾN LÊN' + KHO TÔN
//     + KÈ THẾ LỮ (pano_287 score 2.1: h0 sev3 "Dân Chủ 3T góc bo tròn vàng
//     kem + billboard mái"; h180 sev3 "lớp kè promenade→lan can→sông"; h270
//     "kho mái tôn trắng + tủ AFANI + vỉa hè caro"; pano_212 h0/h270 phần khô:
//     lan can xanh rêu + cây non chống cọc + đèn cần vươn + bảng tin đỏ.
//     Thế Lữ = road#243, u=(0.9516,-0.3065), n_bắc=(-0.3065,-0.9516); NƯỚC từ
//     z≈35 (x-1080) — mọi vật guard twOK) ===
{
  const ryTL = 0.3117;                                         // mặt +Z quay NAM ra phố/sông
  if (twOK(-1083.4, -11.2)) {
    const g = twGrp(-1083.4, -11.2, ryTL, 'danchu');
    twBox(g, 15, 10, 13, mat(0xe8d49b), 0, 5, 0);              // thân 3T vàng kem
    const corner = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 10, 18), mat(0xe8d49b));
    corner.position.set(7.2, 5, 5.0); g.add(corner);           // GÓC BO TRÒN về giao lộ
    twBox(g, 15.2, 1.5, 13.2, sharedMats.window, 0, 5.6, 0);   // dải kính băng tầng 2
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(13, 1.6), mat(0x7e3b2a)); // awning nâu đỏ trệt
    aw.position.set(0, 3.2, 6.7); aw.rotation.x = 0.5; g.add(aw);
    const dc = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.95), twSign('DÂN CHỦ', '#1c6b39', '#ffd54a', 48));
    dc.position.set(7.6, 6.8, 6.2); dc.rotation.y = -0.7; g.add(dc); // biển xanh lá trên góc bo
    twBox(g, 14.6, 0.5, 12.6, mat(0xd9c489), 0, 10.2, 0);      // viền sân thượng
    const bbP = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 4.4),
      twSign('VIỆT NAM TIẾN LÊN', '#bcd7e8', '#c01f1f', 56));
    bbP.position.set(2, 12.6, 1.5); bbP.rotation.x = -0.06; g.add(bbP); // billboard cổ động trên nóc
    twBox(g, 0.3, 4.4, 0.3, mat(0x6a7176), -2.5, 12.4, 0.6);
    twBox(g, 0.3, 4.4, 0.3, mat(0x6a7176), 6.5, 12.4, 0.6);
    twDone(g, -1083.4, -11.2, 10);
    // kho tôn trắng + container AFANI + tường hông xám 5T không cửa sổ (tây)
    const kh = twGrp(-1109.3, -0.2, ryTL, 'kho_theLu');
    twBox(kh, 14, 3.2, 8, mat(0xe9e9e4), 0, 1.6, 0);
    twGable(kh, 14, 8, 3.2, 1.1, mat(0xc7c7c0));
    twDone(kh, -1109.3, -0.2, 8);
    const af = twGrp(-1100.5, 3.4, ryTL + 0.2, 'afani');
    twBox(af, 4, 2.3, 2.3, mat(0x5a4fa0), 0, 1.15, 0);
    const at = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), twSign('AFANI', '#5a4fa0', '#ffffff', 40));
    at.position.set(0, 1.5, 1.2); af.add(at);
    twDone(af, -1100.5, 3.4, 2.6);
    const hw = twGrp(-1096, -16, ryTL, 'tuonghong_xam');       // tường hông bê tông cao
    twBox(hw, 10, 16, 1.2, mat(0xb9b9b3), 0, 8, 0);
    twDone(hw, -1096, -16, 6);
    // ===== KÈ TAM BẠC (bờ bắc, đoạn KHÔ z<30): nền caro + lan can xanh rêu =====
    const zR = (x) => 25 - 0.322 * (x + 1154);                 // tim Thế Lữ theo x
    const off = (x, s) => [x + 0.3065 * s, zR(x) + 0.9516 * s];
    { // nền caro đỏ-xám (quad ShapeGeometry, mép ngoài s=13.2 — trước mép nước)
      const caro = makeTex(128, 128, (gc, w, h) => {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
          gc.fillStyle = (i + j) % 2 ? '#b8574a' : '#9aa0a2'; gc.fillRect(i * 32, j * 32, 32, 32);
        }
      });
      caro.wrapS = caro.wrapT = THREE.RepeatWrapping; caro.repeat.set(0.25, 0.25);
      const [ax, az] = off(-1118, 6.8), [bx2, bz2] = off(-1048, 6.8),
        [cx2, cz2] = off(-1048, 13.2), [dx2, dz2] = off(-1118, 13.2);
      const sh = new THREE.Shape([new THREE.Vector2(ax, az), new THREE.Vector2(bx2, bz2),
        new THREE.Vector2(cx2, cz2), new THREE.Vector2(dx2, dz2)]);
      const geo = new THREE.ShapeGeometry(sh); geo.rotateX(Math.PI / 2);
      const pm = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: caro }));
      pm.position.y = 2.05; pm.receiveShadow = true; scene.add(pm);
    }
    { // lan can sắt xanh rêu dọc mép kè (s=13.4) + cây non chống cọc + đèn + bảng tin
      const [lx1, lz1] = off(-1116, 13.4), [lx2, lz2] = off(-1046, 13.4);
      twRail(lx1, lz1, lx2, lz2, 1.05, 0x3f6f4f, 2.4);
      for (let x = -1112; x <= -1050; x += 13) {
        const [tx, tz] = off(x, 11.6); twTreeAt(tx, tz, 1.2, 3.2); // cây non
      }
      for (const x of [-1100, -1066]) {                        // đèn cần vươn
        const [px, pz] = off(x, 12.2); if (!twOK(px, pz)) continue;
        const gy = groundHeight(px, pz);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 8, 8), mat(0xdfe3e6));
        pole.position.set(px, gy + 4, pz); pole.castShadow = true; scene.add(pole);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 2.6), mat(0xdfe3e6));
        arm.position.set(px, gy + 7.9, pz + 1.2); arm.rotation.x = -0.25; scene.add(arm);
        addCollider(px, pz, 0.4);
      }
      const [btx, btz] = off(-1088, 11.8);
      if (twOK(btx, btz)) {
        const bt = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.0), twSign('TIN TỨC PHƯỜNG', '#c01f1f', '#ffe08a', 34));
        bt.position.set(btx, groundHeight(btx, btz) + 1.6, btz); bt.rotation.y = ryTL + Math.PI; scene.add(bt);
      }
      for (let i = 0; i < 4; i++) {                            // giá xe đạp công cộng xanh
        const [vx, vz] = off(-1074 + i * 1.6, 10.8); if (!twOK(vx, vz)) break;
        const bk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.9, 1.6), mat(0x2a7fc0));
        bk.position.set(vx, groundHeight(vx, vz) + 0.45, vz); bk.castShadow = true; scene.add(bk);
      }
      for (const x of [-1110, -1090, -1070, -1052]) {          // chặn corridor đặt nhà lên kè
        const [fx2, fz2] = off(x, 10); FEATURED_CLEAR.push([fx2, fz2, 13]);
      }
    }
  }
}

// === (12) CÔNG TRƯỜNG DELTA GROUP + TUẤN HỒNG — Nguyễn Thái Học (pano_214
//     score 1.0: h270 sev3 "silo xanh DELTA GROUP + cần cẩu bánh xích sau rào
//     tôn"; h180 sev3 "rào tôn cao liên tục"; h90 "cụm Tuấn Hồng 4T + Nguyên
//     Hương"; pano_212 h180 sev3 "công trường rào tôn xanh DELTA". Ảnh
//     214_h270: rào TÔN TRẮNG ~3m, 2 SILO XANH DƯƠNG cao có chữ trắng, biển
//     giàn DELTA GROUP-GENERAL CONTRACTOR, cẩu DELTA + máy ép cọc; 214_h090:
//     biển VÀNG Tuấn Hồng chữ tím + bạt sọc xanh-trắng + cuộn dây trắng.
//     road#85 u=(0.206,0.978), n_tây=(-0.978,0.206); NƯỚC z<125 gần góc!) ===
{
  if (twOK(-1085, 150)) {
    // rào tôn trắng dọc TÂY road#85 (mặt 6.5m) + đoạn quặt tây theo phố Tam Bạc
    twWall(-1091.4, 129.3, -1065.8, 251.3, 3, mat(0xeceff1), 0.15, true, 11);
    twWall(-1091.4, 129.3, -1105, 124.5, 3, mat(0xeceff1), 0.15, true, 11);
    // biển giàn DELTA GROUP (nhìn từ pano_212 hướng nam qua giao lộ)
    const bb = twGrp(-1094, 127, 0.2, 'delta_bb');
    twBox(bb, 0.3, 9, 0.3, mat(0x8e979e), -3.6, 4.5, 0);
    twBox(bb, 0.3, 9, 0.3, mat(0x8e979e), 3.6, 4.5, 0);
    const bp = new THREE.Mesh(new THREE.PlaneGeometry(8, 3.4), twSign('DELTA GROUP — GENERAL CONTRACTOR', '#f4f6f8', '#1c4f8a', 28));
    bp.position.set(0, 7, 0); bp.rotation.y = Math.PI; bb.add(bp);
    twDone(bb, -1094, 127, 4);
    for (const [sx, sz] of [[-1103, 168], [-1096.5, 179]]) {   // 2 silo xanh dương
      if (!twOK(sx, sz)) continue;
      const gy = groundHeight(sx, sz);
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 16, 18), mat(0x1f63b0));
      silo.position.set(sx, gy + 8, sz); silo.castShadow = true; scene.add(silo);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(4.28, 4.28, 1.5, 18), mat(0xf4f6f8));
      ring.position.set(sx, gy + 13, sz); scene.add(ring);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(4.3, 1.6, 18), mat(0x174e8c));
      cap.position.set(sx, gy + 16.8, sz); scene.add(cap);
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), twSign('DELTA GROUP', '#ffffff', '#1c4f8a', 44));
      tag.position.set(sx + 4.35, gy + 12.9, sz); tag.rotation.y = Math.PI / 2; scene.add(tag);
      addCollider(sx, sz, 4.6);
    }
    const vt = twGrp(-1089, 165, 0.21, 'delta_vp');            // nhà điều hành container trắng
    twBox(vt, 8, 5.6, 5, mat(0xf4f6f8), 0, 2.8, 0);
    twBox(vt, 8.2, 0.3, 5.2, mat(0x9aa0a6), 0, 5.75, 0);
    twDone(vt, -1089, 165, 5.5);
    if (twOK(-1112, 192)) {                                    // cần cẩu bánh xích DELTA
      const cr = twGrp(-1112, 192, 0.6, 'delta_crane');
      twBox(cr, 4.2, 0.8, 1.1, mat(0x24272b), 0, 0.4, -1.2);   // 2 dải xích
      twBox(cr, 4.2, 0.8, 1.1, mat(0x24272b), 0, 0.4, 1.2);
      twBox(cr, 3.2, 2.4, 2.6, mat(0x1f4e8c), 0, 2.0, 0);      // thân xanh
      const boom = new THREE.Mesh(new THREE.BoxGeometry(0.6, 26, 0.6), mat(0x2a63a8));
      boom.position.set(0.8, 12.5, 0); boom.rotation.z = -0.35; cr.add(boom); // cần nghiêng
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 21, 5), mat(0x3a3f45));
      cab.position.set(6.2, 11, 0); cr.add(cab);               // cáp
      twDone(cr, -1112, 192, 4);
    }
    for (const [mx, mz] of [[-1121, 208], [-1108, 228]]) {     // 2 máy ép cọc vàng nhạt
      if (!twOK(mx, mz)) continue;
      const m = twGrp(mx, mz, 0.4, 'delta_epcoc');
      twBox(m, 2.6, 2.2, 3, mat(0xd9c76a), 0, 1.1, 0);
      twBox(m, 1.0, 14, 1.0, mat(0xcdb852), 0, 7, 1.2);
      twDone(m, mx, mz, 3);
    }
    // TUẤN HỒNG 4T + NGUYÊN HƯƠNG TATTOO (ĐÔNG road#85, mặt tây ra phố chợ)
    const ryE = -1.363;                                        // +Z → (-0.978,0.206) tây
    const th = twGrp(-1072.4, 138, ryE, 'tuanhong');
    twBox(th, 12, 13.2, 8, twFacade('#eadfbe', '#5f6d74', 4, 4), 0, 6.6, 0);
    const ts = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.0),
      twSign('TUẤN HỒNG — DÂY NILON • DÂY TỜI • LƯỚI XD', '#f4c81f', '#5b2a86', 26));
    ts.position.set(0, 8.6, 4.08); th.add(ts);                 // biển VÀNG lớn
    const taw = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.2), twStripe('#2a5fa8', '#f4efe4'));
    taw.position.set(0, 3.3, 5.1); taw.rotation.x = 0.55; th.add(taw); // bạt sọc xanh-trắng
    for (let i = 0; i < 4; i++) {                              // cuộn dây/lưới trắng trước cửa
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.0, 10), mat(0xe8e4d8));
      c.position.set(-3 + i * 2, 0.5, 5.6); th.add(c);
    }
    twDone(th, -1072.4, 138, 7.5);
    const nh = twGrp(-1070.5, 146.8, ryE, 'nguyenhuong');
    twBox(nh, 6, 9.9, 8, twFacade('#f4f2ec', '#5f6d74', 2, 3), 0, 4.95, 0);
    const ns = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.8), twSign('NGUYÊN HƯƠNG • TATTOO • MICROBLADING', '#151515', '#e8d9a8', 24));
    ns.position.set(0, 3.3, 4.08); nh.add(ns);                 // biển đen
    twDone(nh, -1070.5, 146.8, 5);
    FEATURED_CLEAR.push([-1100, 173, 18], [-1112, 192, 10], [-1115, 218, 12], [-1089, 165, 9]);
  }
}

// === (BONUS trong ngân sách 12: gộp vào block 11/12 đã đủ — 2 mục dưới đây
//     là DÃY THEO PHỐ để tích hợp qua EXT_CORRIDORS, xem PLAN.md mục A) ===
// EXT_CORRIDORS bổ sung (DÁN vào mảng EXT_CORRIDORS trong world.js ~line 4641):
//   [[-826, -115], [-826, -470]],          // TB-C1 Phạm Phú Thứ (t) — 2 bên
//   [[-690, -471.9], [-1102, -477]],       // TB-C2 Bạch Đằng (p) ngoài vành 830
//   [[-1154, 25], [-918, -51]],            // TB-C3 Thế Lữ (t) — kè đã FEATURED_CLEAR
//   [[-1085, 128], [-1052, 285]],          // TB-C4 Nguyễn Thái Học (t) phố chợ
//   [[-1040, -84], [-1150, -66]],          // TB-C5 Hà Lý (t) quanh ngã ba pano_115

// === (12b — thuộc block ngã ba Hà Lý, tính là block 12 tổng? KHÔNG: đây là
//     block THỨ 12 theo cách đếm PLAN — xem PLAN B11/B12 gộp Dân Chủ+kè.
//     TÒA GÓC TRẮNG 5T + NHÀ CẤP 4 CŨ + RÀO TÔN — ngã ba Hà Lý (pano_115
//     score 1.0: h180 sev3 "tòa góc trắng 6T ban công dày cây + mái bạt xanh";
//     h90 sev3 "nhà cấp bốn vữa cũ + BẢNG TIN + bồn rau"; h270 sev3 "rào tôn".
//     Ảnh 115_h180: tòa trắng bậc thang ~5T ban công tràn cây, bạt sọc xanh
//     dương trệt; 115_h090: nhà 1T vữa loang cửa chớp gỗ + điều hòa + BẢNG TIN
//     trắng + dãy chậu/bồn rau; rào tôn container gỉ quây lô đất) ===
{
  if (twOK(-1092, -62)) {
    const ry = Math.atan2(-0.163, -0.987);                     // mặt +Z quay BẮC về ngã ba
    const g = twGrp(-1092, -62, ry, 'goc_haly');
    twBox(g, 14, 16.5, 12, twFacade('#f4f2ee', '#66707a', 4, 5), 0, 8.25, 0);
    twBox(g, 10, 3.3, 8, mat(0xf4f2ee), 0, 18.1, -1);          // khối bậc thang trên
    for (let f = 1; f <= 4; f++) {
      twBox(g, 14.3, 0.5, 0.55, mat(0xffffff), 0, f * 3.3 + 0.55, 6.1); // băng ban công
      for (let i = 0; i < 5; i++) {                            // cây rủ ban công
        const pl = new THREE.Mesh(new THREE.SphereGeometry(0.45, 6, 5), mat(0x4a7a38));
        pl.position.set(-5.2 + i * 2.6, f * 3.3 + 0.95, 6.2); g.add(pl);
      }
    }
    const aw = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.9), twStripe('#2a5fa8', '#f4efe4'));
    aw.position.set(0, 3.0, 6.9); aw.rotation.x = 0.55; g.add(aw); // bạt sọc xanh trệt
    twDone(g, -1092, -62, 9);
    // nhà cấp 4 vữa cũ (đông ngõ, mặt tây) + BẢNG TIN + bồn rau/chậu cây
    const nc = twGrp(-1078.5, -80, -Math.PI / 2, 'nhacap4_haly');
    twBox(nc, 10, 3.4, 7, mat(0x9c9484), 0, 1.7, 0);
    twBox(nc, 10.6, 0.3, 7.6, mat(0x7e756a), 0, 3.55, 0);
    for (const lx of [-3, 1.5]) twBox(nc, 1.3, 1.1, 0.1, mat(0x5b4634), lx, 2.1, 3.55); // cửa chớp gỗ
    twBox(nc, 1.2, 0.6, 0.3, mat(0xdfe3e6), 3.2, 2.6, 3.6);    // cục điều hòa
    const bt = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), twSign('BẢNG TIN', '#f4f2ec', '#b31d1d', 40));
    bt.position.set(2.2, 1.7, 3.58); nc.add(bt);               // bảng tin cộng đồng trắng
    for (let i = 0; i < 6; i++) {                              // dãy chậu cây + bồn rau
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.5), mat(i % 2 ? 0x39603a : 0x7aa0c4));
      p.position.set(-4 + i * 1.6, 0.25, 3.9); nc.add(p);
    }
    twDone(nc, -1078.5, -80, 6);
    // rào tôn container gỉ quây lô đất trống (tây ngõ)
    twWall(-1096, -88, -1112, -84.5, 2.6, mat(0xa8886a), 0.15, true, 9);
    twTreeAt(-1085, -68, 3.2, 6);
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
    // dải biển hiệu màu trên mép tầng trệt (pano_009: nhà OSM từng là hộp nhạt TRỐNG TRƠN
    // trong khi thật là shophouse kín biển) — cùng bảng màu với shophouse_infill
    const signPalette = [0xc62828, 0x1c56a0, 0x1f7a3c, 0xd8862a, 0x26262c, 0x8e2f80].map((c) => new THREE.Color(c));
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
      // chừa chỗ cho công trình đích danh procedural (khối OSM trơn từng chồng đè lên KS Harbour View)
      if (nearFeatured(cx, cz)) continue;
      if (clearedZone(cx, cz)) continue;   // bãi giải tỏa Hoàng Diệu: footprint cũ đã bị phá (10/2024)
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
            // 0.82→0.74: tương phản mạnh hơn — hộp OSM từng đọc thành "tường nhạt trống trơn" (pano_009)
            const rowH = h / steps;
            const band = Math.floor(posA.getY(i) / rowH + 0.01) % 2 === 0 ? 1 : 0.74;
            shade *= band;
          }
          if (glassy && !isRoof) {
            cols[i * 3] = 0.45 * shade;
            cols[i * 3 + 1] = 0.56 * shade;
            cols[i * 3 + 2] = 0.64 * shade;
            continue;
          }
          // TẦNG TRỆT SHOPFRONT + DẢI BIỂN HIỆU: nhà ống VN tầng 1 là cửa hàng tối màu,
          // trên mép trệt là băng biển hiệu màu (khu trung tâm) — như shophouse_infill
          if (!isRoof) {
            const yRel = posA.getY(i) - LAND_H;
            if (yRel > 0.15 && yRel < 3.1) {
              cols[i * 3] = 0.34 * shade; cols[i * 3 + 1] = 0.31 * shade; cols[i * 3 + 2] = 0.29 * shade;
              continue;
            }
            // KHÔNG dùng biến `central` ở đây — trong try này có `const central` KHÁC khai báo
            // phía dưới (mái ngói) → TDZ ReferenceError (bài học aj); tính thẳng điều kiện
            if ((cx * cx + cz * cz) < 780 * 780 && yRel >= 3.1 && yRel < 4.15 && h > 5) {
              const sc = signPalette[hash % signPalette.length];
              cols[i * 3] = sc.r * 0.95; cols[i * 3 + 1] = sc.g * 0.95; cols[i * 3 + 2] = sc.b * 0.95;
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
  // BAKE nhà infill theo material (trước: mỗi nhà 1 Group + 2 mesh → ~380 nhà = ~760 mesh rời;
  // giờ gộp thành ≤ facadeMats.length + roofMats.length mesh). Mặt +y/-y đổi từ wallMats sang
  // facadeMats (chỉ là nắp hộp dưới mái chóp, không nhìn thấy). houseFlush() gọi SAU vòng đặt nhà.
  const _houseBodyG = new Map(), _houseRoofG = new Map();
  function house(x, z, w = 8, d = 7, hgt = 6, rotY = 0, wallOverride = null) {
    const idx = Math.floor(Math.abs(x * 7 + z * 13)) % facadeMats.length;
    const gy = groundHeight(x, z);
    const body = new THREE.BoxGeometry(w, hgt, d);
    body.translate(0, hgt / 2, 0); body.rotateY(rotY); body.translate(x, gy, z);
    const bKey = wallOverride ? '_ov' : String(idx);
    let bl = _houseBodyG.get(bKey); if (!bl) _houseBodyG.set(bKey, bl = { m: wallOverride || facadeMats[idx], g: [] });
    bl.g.push(body);
    const rIdx = Math.floor(Math.abs(x * 3 + z * 5)) % roofMats.length;
    const roof = new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.6, 4);
    roof.rotateY(Math.PI / 4 + rotY); roof.translate(x, gy + hgt + 1.3, z);
    let rl = _houseRoofG.get(rIdx); if (!rl) _houseRoofG.set(rIdx, rl = { m: roofMats[rIdx], g: [] });
    rl.g.push(roof);
    addCollider(x, z, Math.max(w, d) * 0.62);
  }
  function houseFlush() {
    for (const bucket of [..._houseBodyG.values(), ..._houseRoofG.values()]) {
      if (!bucket.g.length) continue;
      const m = new THREE.Mesh(mergeGeometries(bucket.g), bucket.m);
      m.castShadow = true; m.receiveShadow = true; m.name = 'house_infill'; scene.add(m);
      bucket.g.forEach((x2) => x2.dispose()); bucket.g.length = 0;
    }
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
    if (Math.hypot(x + 427, z - 943) < 28) return true;              // chợ Cột Đèn (cell_nam: sạp ô dù, không nhà kín)
    if (hoSenSD(x, z) < 10) return true;                             // kè hồ Sen
    for (const g of GARDENS) if (Math.hypot(x - g.x, z - g.z) < Math.max(g.w, g.d) / 2 + 12) return true; // dải vườn hoa
    if (lakeSD(x, z) < 16) return true; // ven hồ Tam Bạc (polygon thật + 16m)
    // QUẢNG TRƯỜNG NHÀ HÁT + VƯỜN HOA dọc road#9 (41,59)->(67,142) — pano_055/056 (2.0/1.3 điểm):
    // openSpace cũ chỉ vòng r62 quanh (-6,49) nên shophouse lấp KÍN quảng trường (PLAN corridor4056 V1)
    {
      const ax = 41, az = 59, ux = 0.2989, uz = 0.9543;                 // trục road#9
      const dx = x - ax, dz = z - az;
      const along = dx * ux + dz * uz, west = dx * -0.9543 + dz * 0.2989;
      if (along > -8 && along < 95) {
        if (west > 0 && west < 95) return true;                          // Z-C1: quảng trường phía TÂY
        if (west < 0 && west > -45) return true;                         // Z-C2: vườn hoa phía ĐÔNG
      }
    }
    // NGÃ TƯ BẢO TÀNG (Z-B1): mặt tiền Bảo tàng GLB bị shophouse generic che (pano_046/047)
    if (x > 64 && x < 135 && z > -535 && z < -466) return true;
    // Z-TTB1: phố công sở Pháp Đinh Tiên Hoàng bắc (nhà lùi sân sau rào — pano_392..496/551)
    { const t = (z + 727) / 0.993, tim = 84 - 0.115 * t;
      if (z > -648 && z < -500 && Math.abs(x - tim) < 45) return true; }
    // Z-TTB2: Bệnh viện Phụ Sản chiếm nguyên khối phố (pano_355..357/429/051)
    if (x > 45 && x < 170 && z > -258 && z < -225) return true;
    // Z-TTB3: quần thể nút Nguyễn Tri Phương (trường + công sở — pano_361/538/527/362/537)
    if (x > -160 && x < 60 && z > -760 && z < -615) return true;
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
            if (lakeSD(gx, gz) < 24) continue;                               // dải promenade ven hồ KHÔNG có nhà → không bạt/biển lơ lửng
            if (openSpace(gx, gz) || onOtherRoad(gx, gz)) continue;          // không mọc ở hồ/quảng trường/vườn hoa/lòng đường
            if (!houseEvidence(gx, gz) || panoDenies(gx, gz)) continue;      // phải có NHÀ thật ở đây (pano/OSM xác nhận)
            if (nearFeatured(gx, gz)) continue;                              // không dán bạt/biển lơ lửng lên công trình đích danh
            if (clearedZone(gx, gz)) continue;                               // bãi giải tỏa Hoàng Diệu
            const faceY = Math.atan2(-side * px, -side * pz);      // protrusion hướng ra đường
            if (ar() < 0.82) awnSlots.push([gx, gy + 0.18, gz, faceY, (ar() * awnCols.length) | 0]);
            if (ar() < 0.5) signSlots.push([gx, gy + 2.18, gz, faceY, (ar() * signCols.length) | 0]);
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
    // MOBILE: atlas 4096² ≈ 85MB VRAM/tấm không nén — thu 1/4 cạnh (1024², chữ vẫn đọc được
    // ở cự ly chơi trên màn nhỏ); desktop giữ nguyên 100%
    const MS = IS_MOBILE ? 0.25 : 1;
    for (let a = 0; a < Math.ceil(SHOP_SIGNS.length / PER); a++) {
      const items = SHOP_SIGNS.slice(a * PER, (a + 1) * PER);
      const cv = document.createElement('canvas'); cv.width = COLS * CELL_W * MS; cv.height = Math.ceil(ROWS * CELL_H * MS);
      const g = cv.getContext('2d'); g.scale(MS, MS);
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
        if (clearedZone(x, z)) return;   // bãi giải tỏa Hoàng Diệu: hết nhà thì hết biển
        // NGOÀI vành sinh nhà (>830m) mà không có nhà OSM gần → biển treo LƠ LỬNG giữa đồng
        // (prop-hunt: "SỐ 270/274 TÔ HIỆU" nổi giữa bãi cỏ) — chỉ đặt khi có nhà render được
        if (x * x + z * z > 830 * 830 && !_gridNear(_bldGrid, x, z, 35)) return;
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
        // phố 't' TRONG vành 830m giờ thuộc dãy shophouse liền kề — bỏ nhà rời ở đó (tránh chồng lô)
        if (r.c === 't' && (((x1 + x2) / 2) ** 2 + ((z1 + z2) / 2) ** 2) < 830 * 830) continue;
        // phố 'r' hành lang chợ Đổ cũng đã vào dãy liền kề — bỏ nhà rời (tránh chồng lô)
        { const mxr = (x1 + x2) / 2, mzr = (z1 + z2) / 2;
          if (r.c === 'r' && mxr > -520 && mxr < -80 && mzr > -260 && mzr < 80) continue;
          // khu NAM (Tô Hiệu/hồ Sen) + TÂY (Hai Bà Trưng) đã vào dãy liền kề EXT_CORRIDORS
          if (mzr > 580 && mzr < 1160 && mxr > -800 && mxr < 460) continue;
          if (mxr > -960 && mxr < -740 && mzr > 580 && mzr < 660) continue; }
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
            if (nearFeatured(hx, hz)) continue;                        // không đè/che công trình đích danh
            if (clearedZone(hx, hz)) continue;                         // bãi giải tỏa Hoàng Diệu
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
    houseFlush();   // gộp ~380 nhà × 2 mesh → ~10 mesh theo material
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
    // PANO-LOOP V2: 780 chỉ phủ ~12% lô mặt phố → 3000. CỤM HOUSE (V5+): dãy phải LIỀN KỀ
    // như thực địa — đi dọc từng PHÍA phố, tiến đúng bằng bề rộng lô (không bước cố định),
    // lô bị guard chặn chỉ nhảy 2m rồi thử tiếp → khe hở tối thiểu. Vẫn 1 mesh gộp.
    // CAP theo ĐO thực tế: p/s/t trong vành 830m = 20.9km → tối đa 8400 lô (trần không cạn giữa chừng)
    const CAP = 8600;
    // toàn bộ điều kiện đặt 1 lô (giữ NGUYÊN bộ guard chống regression: 3 kiểu ô đất,
    // vành 830m, pano là nguồn sự thật) — buffer nhà OSM 13→8.5m để dãy lấp SÁT cạnh nhà thật
    const slotOK = (gx, gz, dxn, dzn, nx, nz, w, dp) => {
      if (Math.abs(groundHeightNoDeck(gx, gz) - LAND_H) > 0.3) return false;
      if (riverFactor(gx, gz) > 0.01) return false;
      if (_gridNear(_bldGrid, gx, gz, 8.5)) return false;          // không đè nhà OSM thật (sát hơn: hết khe cạnh nhà thật)
      if (!houseEvidence(gx, gz)) return false;                    // BẢN ĐỒ NHÀ (pano+OSM): không bằng chứng → cấm
      if (openSpace(gx, gz) || onOtherRoad(gx, gz)) return false;  // né vườn hoa/quảng trường/ven hồ/đường cắt
      if (panoDenies(gx, gz)) return false;                        // pano thật không thấy nhà ở hướng này
      if (nearFeatured(gx, gz)) return false;                      // không đè/che công trình đích danh
      if (clearedZone(gx, gz)) return false;                       // bãi giải tỏa Hoàng Diệu
      if (hoSenSD(gx, gz) < 12) return false;                      // kè hồ Sen = sân đi dạo
      if (!cornersDry(gx, gz, dxn, dzn, w / 2, nx, nz, dp / 2)) return false; // 4 góc phải là đất
      for (const [lx, lz] of lmPtsS) if ((gx - lx) ** 2 + (gz - lz) ** 2 < 34 * 34) return false;
      for (const [ox, oz] of placedS) if ((gx - ox) ** 2 + (gz - oz) ** 2 < 4.1 * 4.1) return false;
      if (groundHeight(gx, gz) < LAND_H - 0.5) return false;
      return true;
    };
    // KHU PHỐ CŨ CHỢ ĐỔ (pano_135): phố 'r' ở đây thực địa cũng là tường shophouse cũ liền kề
    // dày đặc biển hiệu — cho 'r' vào dãy liền kề CHỈ trong hành lang này (nơi khác giữ nhà rời)
    const R_CORRIDOR = (x, z) => x > -520 && x < -80 && z > -260 && z < 80;
    // HÀNH LANG MỞ RỘNG NGOÀI VÀNH 830m (cell_nam C1-C9 + cell_tay Hai Bà Trưng): dãy liền kề
    // theo ĐOẠN TUYẾN đã khảo sát từ pano (kể cả phố 'r')
    const EXT_CORRIDORS = [
      [[-750, 830.6], [-360, 750.1]],
      [[-486, 777], [-519, 863], [-594, 912], [-625, 960]],
      [[-519, 863], [-440, 937], [-222, 1090]],
      [[-111, 699], [-20, 1146]],
      [[-91, 847], [340, 812]],
      [[21, 836], [29, 963], [48, 990], [62, 1047], [13, 1065], [-33, 1069]],
      [[326, 604], [340, 812], [390, 1076]],
      [[-87, 811], [-53, 806], [-54, 765], [16, 749]], [[-53, 789], [21, 773]],
      [[340, 812], [448, 796]],
      [[-751.4, 600.6], [-929.6, 637.2]],
      [[-533, -897], [-430, -731]],
      [[-588.4, -300], [-588.4, -350]],
      // Phạm Phú Thứ đoạn bắc (pano_093/094: ảnh thật = dãy liền kề Viettel Post — regression -0.9 đợt 2)
      [[-828, -180], [-815, -460]],
      // MẶT TRẬN ĐÔNG (cell_dong, houseEvidence 65-80% dọc tuyến — probe.mjs):
      [[770, -123], [1050, -390]],
      [[745, -448], [1085, -440]],
      [[928, 83], [700, 318]],
      [[1100, -89], [999, 11], [928, 83]],
      [[940, 95], [1120, 300]],
      // Thất Khê [[10,-785],[150,-779]] ĐÃ GỠ: pano_420/422 regression (2→0.8) — thực địa là
      // KHUÔN VIÊN tập thể sân cây, nhà lùi sâu, không phải shophouse sát vỉa (bài học 3 kiểu ô đất)
    ];
    const nearExtCorridor = (x, z) => {
      for (const line of EXT_CORRIDORS) for (let i = 0; i < line.length - 1; i++) {
        const [x1, z1] = line[i], [x2, z2] = line[i + 1];
        const dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1e-9;
        let t = ((x - x1) * dx + (z - z1) * dz) / l2; t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) < 45) return true;
      }
      return false;
    };
    outerShop:
    for (let ri = 0; ri < ROADS_DT.length; ri++) {
      // gồm cả phố 't' (pano 131/492: phố t trung tâm thực địa cũng là tường shophouse liền kề)
      const r = ROADS_DT[ri]; if (r.c !== 'p' && r.c !== 's' && r.c !== 't' && r.c !== 'r') continue;
      const wRoad = ROAD_W[r.c];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
        { const mxr = (x1 + x2) / 2, mzr = (z1 + z2) / 2;
          if (r.c === 'r' && !R_CORRIDOR(mxr, mzr) && !nearExtCorridor(mxr, mzr)) continue; }
        const segLen = Math.hypot(x2 - x1, z2 - z1); if (segLen < 9) continue;
        const dxn = (x2 - x1) / segLen, dzn = (z2 - z1) / segLen, rotY = Math.atan2(x2 - x1, z2 - z1);
        const nx = Math.cos(rotY), nz = -Math.sin(rotY);           // pháp tuyến
        for (const side of [1, -1]) {                               // từng PHÍA phố: dãy liền kề độc lập
          let d = 2.2;
          while (d < segLen - 2.2) {
            const w = 4.2 + srnd() * 1.4, dp = 6.5 + srnd() * 1.5;  // lô ~4.2-5.6m như thực địa
            if (d + w > segLen - 2.2) break;
            const dc = d + w / 2;
            const mx = x1 + dxn * dc, mz = z1 + dzn * dc;
            // V3-fix: vành 830-980 trùm khu CƠ QUAN KHUÔN VIÊN/đất giải tỏa → giữ trong 830m
            if (mx * mx + mz * mz > 830 * 830 && !nearExtCorridor(mx, mz)) { d += 3.0; continue; }
            // MẶT TIỀN THẲNG HÀNG: tâm lùi theo dp để mặt trước luôn cách mép đường 2.3m
            const off = side * (wRoad / 2 + 2.3 + dp / 2);
            const gx = mx + off * nx, gz = mz + off * nz;
            if (!slotOK(gx, gz, dxn, dzn, nx, nz, w, dp)) { d += 2.0; continue; }
            const gy = groundHeight(gx, gz);
            // phố 'r' khu chợ Đổ: nhà ống CŨ thấp 2-4 tầng (pano_135); phố lớn giữ 2-6
            const floors = r.c === 'r' ? 2 + ((srnd() * 3) | 0)
              : (mx * mx + mz * mz < 480 * 480 ? 3 : 2) + ((srnd() * 4) | 0);   // lõi 3-6 tầng, ngoài 2-5 (pano V1: trung tâm cao hơn)
            const h = floors * 3.3;
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
            d += w + 0.08;                                          // lô kế tiếp SÁT lô này — tường phố liền kề
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
        if (nearFeatured(x, z)) continue;                             // không đè/che công trình đích danh
        if (clearedZone(x, z)) continue;                              // bãi giải tỏa Hoàng Diệu
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
    jet.userData.dyn = true;
    updaters.push((dt, time) => { jet.scale.y = 0.8 + Math.sin(time * 3) * 0.2; });
    addCollider(ftX, ftZ, 5.5);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 16, 6), mat(0xd8d8d8));
    pole.position.set(pcx + 18, LAND_H + 8, pcz - 6);
    scene.add(pole);
    const vnFlag = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.6),
      new THREE.MeshLambertMaterial({ color: 0xd8332a, side: THREE.DoubleSide }));
    vnFlag.position.set(pcx + 20, LAND_H + 14.5, pcz - 6);
    scene.add(vnFlag);
    vnFlag.userData.dyn = true;
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
  // GỘP geometry theo material (trước đây mỗi đoạn 4m = 3 Mesh riêng → 2 cầu ~2.000 mesh
  // = 36% mesh scene + ~1.200 material trùng; giờ mỗi cầu còn vài mesh)
  function bridgeDeckAndRails(g, b, railColor) {
    const deckG = [], railG = [];
    for (let z = -b.half; z <= b.half; z += 4) {
      const tt = z / b.half;
      const y = LAND_H + b.rise * Math.max(0, 1 - tt * tt);
      const seg = new THREE.BoxGeometry(28, 0.8, 4.4); seg.translate(0, y - 0.45, z); deckG.push(seg);
      for (const sx of [-13.4, 13.4]) { const rl = new THREE.BoxGeometry(0.4, 1.4, 4.4); rl.translate(sx, y + 0.55, z); railG.push(rl); }
    }
    const dm = new THREE.Mesh(mergeGeometries(deckG), mat(0xcfd4da)); deckG.forEach((x) => x.dispose()); g.add(dm);
    const rm = new THREE.Mesh(mergeGeometries(railG), mat(railColor)); railG.forEach((x) => x.dispose()); g.add(rm);
  }
  {
    // Cầu Hoàng Văn Thụ: HAI vòm thép đỏ nghiêng vào nhau — dáng "cánh chim biển" thật
    const b = BRIDGES[0];
    const g = bridgeGroup(b);
    bridgeDeckAndRails(g, b, 0xe8524a);
    const redG = [], cabG = [], pierG = [], capG = [];
    const TILT = 0.24, RIB_X = 14, ARCH_H = 45, AS = 200; // 1:1 — nhịp chính 200m, vòm 45m
    for (const s of [-1, 1]) {
      const arcPts = [];
      for (let i = 0; i <= 24; i++) {
        const tt = i / 24;
        arcPts.push(new THREE.Vector3(0, Math.sin(tt * Math.PI) * ARCH_H + 2, (tt - 0.5) * AS));
      }
      const rib = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 40, 1.4, 8);
      rib.rotateZ(-s * TILT); rib.translate(s * RIB_X, 0, 0); redG.push(rib);
    }
    // giằng ngang nối hai đỉnh vòm
    for (const tt of [0.34, 0.5, 0.66]) {
      const y = Math.sin(tt * Math.PI) * ARCH_H + 2;
      const xOff = RIB_X - Math.sin(TILT) * y;
      const brace = new THREE.CylinderGeometry(0.55, 0.55, xOff * 2 * Math.cos(TILT) + 1, 6);
      brace.rotateZ(Math.PI / 2); brace.translate(0, y * Math.cos(TILT), (tt - 0.5) * AS); redG.push(brace);
    }
    // dây treo ĐAN CHÉO (network arch — đặc trưng thật của cầu Hoàng Văn Thụ)
    const _upV = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1), _p3 = new THREE.Vector3(), _v3 = new THREE.Vector3();
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
          const cable = new THREE.CylinderGeometry(0.11, 0.11, len, 4);
          _v3.set(topX - s * 13, topY - deckY, -dz).normalize();
          _q.setFromUnitVectors(_upV, _v3);
          _p3.set((topX + s * 13) / 2, (topY + deckY) / 2, zz + dz / 2);
          cable.applyMatrix4(_m4.compose(_p3, _q, _one));
          cabG.push(cable);
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
          const pier = new THREE.CylinderGeometry(1.6, 1.9, deckY - 0.2, 8);
          pier.translate(sx, (deckY - 0.2) / 2, along); pierG.push(pier);
        }
        const cap = new THREE.BoxGeometry(24, 1.4, 3); cap.translate(0, deckY - 0.9, along); capG.push(cap);
      }
    }
    for (const [arr, c] of [[redG, 0xd8402e], [cabG, 0xe8e0d8], [pierG, 0xb9bec4], [capG, 0xa9aeb4]]) {
      if (arr.length) { const m = new THREE.Mesh(mergeGeometries(arr), mat(c)); arr.forEach((x) => x.dispose()); g.add(m); }
    }
  }
  {
    const b = BRIDGES[1];
    const g = bridgeGroup(b);
    bridgeDeckAndRails(g, b, 0x88b8c8);
    const pierG = [], pylG = [], cabG = [];
    for (const dir of [-1, 1]) {
      for (let a = 150; a < b.half - 12; a += 42) {
        const along = dir * a;
        const ttd = along / b.half;
        const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
        if (deckY < 2.6) continue;
        for (const sx of [-9, 9]) {
          const pier = new THREE.CylinderGeometry(1.6, 1.9, deckY - 0.2, 8);
          pier.translate(sx, (deckY - 0.2) / 2, along); pierG.push(pier);
        }
      }
    }
    for (const dz of [-65, 65]) {
      for (const dx of [-11, 11]) { const pylon = new THREE.BoxGeometry(3, 101, 3); pylon.translate(dx, 50, dz); pylG.push(pylon); }
      const beam = new THREE.BoxGeometry(26, 2.6, 2.6); beam.translate(0, 92, dz); pylG.push(beam);
      for (let k = 1; k <= 8; k++) {
        for (const dir of [-1, 1]) {
          const zz = dz + dir * k * 15;
          if (Math.abs(zz) > b.half) continue;
          const ttd = zz / b.half;
          const deckY = LAND_H + b.rise * Math.max(0, 1 - ttd * ttd);
          const topY = 95;
          const dzLen = Math.abs(zz - dz);
          const len = Math.hypot(topY - deckY, dzLen);
          const cable = new THREE.CylinderGeometry(0.13, 0.13, len, 4);
          cable.rotateX(Math.atan2(dzLen, topY - deckY) * Math.sign(zz - dz));
          cable.translate(0, (topY + deckY) / 2, (zz + dz) / 2);
          cabG.push(cable);
        }
      }
    }
    for (const [arr, c] of [[pierG, 0xb9bec4], [pylG, 0xb8c4c8], [cabG, 0xd8e0e4]]) {
      if (arr.length) { const m = new THREE.Mesh(mergeGeometries(arr), mat(c)); arr.forEach((x) => x.dispose()); g.add(m); }
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
  seaShip.userData.dyn = true;
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
  let bbShoreZ = bbBank[1] + bbBank[2] / 2 + 6;
  // Polyline sông thưa + sông cong → mép nước thật có thể cách điểm polyline hàng trăm mét
  // (từng làm thuyền Bến Bính mắc cạn h=2.0 ở z=-883 trong khi nước bắt đầu ~z=-952).
  // Dò mép nước THẬT dọc trục bến rồi neo chân bến ngay trên bờ.
  for (let tz = bbShoreZ; tz > bbShoreZ - 400; tz -= 4) {
    if (groundHeightNoDeck(-24, tz) < 0.25) { bbShoreZ = tz + 8; break; }
  }
  const benBinh = buildPier(-24, bbShoreZ, 0, -1);
  world.npcSpots.captain = [-32, bbShoreZ + 14];
  world.vehicleSpawns.push({ type: 'boat', x: benBinh.boatSpot[0], z: benBinh.boatSpot[1], heading: 0 });

  // ---------- ĐỒ SƠN: bãi tắm + Bến Nghiêng + biệt thự Bảo Đại ----------
  {
    // searchR 320→700: tâm bãi OSM (way 693082800) nằm TRÊN ĐỒI (h≈43) — dải cát thật cách
    // ~400m về phía đông; 320 từng trả null → MẤT toàn bộ ô dù + Bến Nghiêng + thuyền Đồ Sơn
    const shore = findShore(LM.doson[0], LM.doson[1], 700);
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
      // Vị trí biển địa danh Đồ Sơn: lùi từ bãi vào ĐẤT KHÔ gần nhất (tâm bãi OSM là đồi 43m
      // → biển từng "KHÔNG TIẾP CẬN ĐƯỢC"); landmarks.js sẽ neo biển + chấm minimap vào đây
      let dsx = pbx, dsz = pbz;
      for (let k = 0; k < 40 && groundHeightNoDeck(dsx, dsz) < 1.4; k++) {
        dsx -= shore.seaDir[0] * 6; dsz -= shore.seaDir[1] * 6;
      }
      world.dosonSign = [Math.round(dsx), Math.round(dsz)];
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
    beamPivot.userData.dyn = true;
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
        // CHIA Ô 250m + computeBoundingSphere → frustum culling THẬT (trước: frustumCulled=false
        // → 7,2 TRIỆU tam giác cây hero submit MỌI khung dù camera nhìn đâu — 70% tam giác scene)
        const tiles = new Map();
        for (const t of slots) { const k = Math.floor(t.x / 250) + ',' + Math.floor(t.z / 250); let l = tiles.get(k); if (!l) tiles.set(k, l = []); l.push(t); }
        const trs = new THREE.Matrix4(), m = new THREE.Matrix4();
        const q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
        for (const l of tiles.values()) {
          const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, l.length);
          l.forEach((t, i) => {
            q.setFromEuler(new THREE.Euler(0, t.yaw, 0));
            sv.setScalar(t.scale); pv.set(t.x, t.y, t.z);
            trs.compose(pv, q, sv);
            m.multiplyMatrices(trs, B);        // instance = TRS · B
            inst.setMatrixAt(i, m);
          });
          inst.instanceMatrix.needsUpdate = true;
          inst.computeBoundingSphere();        // bao đúng các instance trong Ô
          inst.name = 'hero_trees';
          scene.add(inst);
        }
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
    // hành lang Hoàng Diệu ven cảng: thực địa toàn xà cừ/bàng CẮT TRỤI, không phượng (pano_015-019)
    if (hdTreeBelt(x, z)) { shadeTree(x, z); return; }
    const h = (function (v) { const t = Math.abs(v); return t - Math.floor(t); })(Math.sin(x * 3.3 + z * 1.9) * 24571.3);
    // BÀI HỌC PANO-LOOP V1 (39 finding tree): ven hồ Tam Bạc thực địa là xà cừ/bàng tán XANH
    // + cây cắt tỉa, phượng đỏ chỉ điểm xuyết → trong hành lang hồ (lakeSD<45) hạ phượng còn ~12%.
    if (lakeSD(x, z) < 45) {
      if (h < 0.84) shadeTree(x, z);         // ven hồ phượng 12%→8% (pano_030 h090 vẫn đọc "đỏ dày")
      else if (h < 0.92) phuongTree(x, z);
      else palm(x, z);
      return;
    }
    if (h < 0.70) shadeTree(x, z);           // phượng 27%→20% (pano_019/030: thật đa số tán xanh)
    else if (h < 0.90) phuongTree(x, z);
    else palm(x, z);
  }
  {
    // phượng + đèn dọc các trục trung tâm gần Nhà hát lớn; SAU quota hero/đèn: trồng tiếp
    // streetTree (đa số xanh) dọc MỌI phố p/s/t — pano-loop: khu Ga (022/023) thật rợp cây
    // nhưng game trống trơn vì vòng này hết quota ngay ở lõi (cây bake theo ô 500m, rẻ)
    const lmPts = Object.values(LM);
    let nTree = 0, nLamp = 0, nFill = 0, sideFlip = 1;
    for (const r of ROADS_DT) {
      if (r.c !== 's' && r.c !== 'p' && r.c !== 't') continue;
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
          if (nearFeatured(tx, tz)) continue;
          if (hdTreeBelt(tx, tz)) { streetTree(tx, tz); nFill++; continue; } // Hoàng Diệu: xà cừ, cấm phượng hero
          if (r.c !== 't' && nTree <= nLamp * 1.6 && nTree < 46) {
            heroTree(tx, tz);       // dải trung tâm: cây phượng ảnh-thật (Meshy)
            nTree++;
          } else if (r.c !== 't' && nLamp < 30) {
            const y = groundHeight(tx, tz);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 5, 6), mat(0x38424a));
            pole.position.set(tx, y + 2.5, tz);
            scene.add(pole);
            const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), sharedMats.lampGlow);
            bulb.position.set(tx, y + 5.2, tz);
            scene.add(bulb);
            nLamp++;
          } else if (nFill < 300) {
            streetTree(tx, tz);     // phủ xanh phần còn lại (khu Ga, phố t...) — bake, ~vài draw call
            nFill++;
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
    fl.userData.dyn = true;
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
    // (band trên cùng TỪNG trùm kín mái → nhìn từ trên là ô hồng lạc tông; mặt tiền từng trống trơn)
    {
      const cx = -798, cz = 221, W = 10, FL = 3, H = FL * 3.3;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, 8), mat(0x1e1e22)); body.position.y = H / 2; g.add(body);
      for (let f = 0; f < FL; f++) { const band = new THREE.Mesh(new THREE.BoxGeometry(W + 0.15, 0.22, 8.15), mat(0xd4527e)); band.position.y = f * 3.3 + 0.1; g.add(band); }
      const roofS = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.25, 8.1), mat(0x6a6d72)); roofS.position.y = H + 0.08; g.add(roofS);   // mái bê tông xám
      // tầng trệt: cửa kính + khung + biển hiệu hồng chữ trắng (nhìn ra phố phía Nam, local +Z... group xoay π nên mặt tiền = -Z local)
      const glass = new THREE.Mesh(new THREE.BoxGeometry(W - 1.6, 2.5, 0.12), sharedMats.window); glass.position.set(0, 1.35, -4.02); g.add(glass);
      for (const sx of [-(W - 1.6) / 2 - 0.2, (W - 1.6) / 2 + 0.2]) { const fr = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.7, 0.16), mat(0x0f0f12)); fr.position.set(sx, 1.35, -4.02); g.add(fr); }
      const signTex = makeTex(256, 48, (gc, w2, h2) => { gc.fillStyle = '#1a1a1e'; gc.fillRect(0, 0, w2, h2); gc.fillStyle = '#ff6fa5'; gc.font = 'bold 30px sans-serif'; gc.textAlign = 'center'; gc.textBaseline = 'middle'; gc.fillText('FUNZ · TRÀ & BAR', w2 / 2, h2 / 2 + 1); });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 2, 1.0), new THREE.MeshLambertMaterial({ map: signTex })); sign.position.set(0, 3.1, -4.06); sign.rotation.y = Math.PI; g.add(sign);
      for (let f = 1; f < FL; f++) { const win = new THREE.Mesh(new THREE.BoxGeometry(W - 2.4, 1.2, 0.1), sharedMats.window); win.position.set(0, f * 3.3 + 1.7, -4.01); g.add(win); }
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
    fl.userData.dyn = true;
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

    // ĐOẠN KHÔNG CÓ DẢI PHÂN CÁCH THẬT (prop-hunt + đối chiếu ảnh pano_153/225/195: mặt đường
    // liền chỉ vạch vàng, bồn cây giữa đường là bịa) — MEDIANS OSM lấy cả tuyến nhưng dải thật
    // chỉ có từng đoạn. Bán kính 90m quanh điểm đã xác nhận bằng ảnh.
    const MEDIAN_SKIP = [[572, -451.2, 90], [667.9, -640.2, 90], [589.3, -204, 90]];
    for (const line of MEDIANS) {
      let acc = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const [x1, z1] = line[i], [x2, z2] = line[i + 1];
        const segL = Math.hypot(x2 - x1, z2 - z1);
        const d = [(x2 - x1) / segL, (z2 - z1) / segL];
        const th = Math.atan2(-d[1], d[0]);
        for (let s = 6; s < segL - 6; s += 10) {
          const mx = x1 + d[0] * s, mz = z1 + d[1] * s;
          if (MEDIAN_SKIP.some(([qx, qz, qr]) => (mx - qx) ** 2 + (mz - qz) ** 2 < qr * qr)) continue;
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
      g.userData.dyn = true;
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
    // GOM geometry bồn hoa theo material (trước: 2 mesh/bồn × ~262 bồn = ~524 mesh rời
    // ngay khu trung tâm đông người chơi → giờ 8 mesh)
    const rimGeos = [], domeGeos = flowerCols.map(() => []);
    function flowerBed(bx, bz, r, seed) {
      const rim = new THREE.CylinderGeometry(r, r + 0.3, 0.4, 10); rim.translate(bx, LAND_H + 0.2, bz); rimGeos.push(rim);
      const dome = new THREE.SphereGeometry(r * 0.92, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      dome.scale(1, 0.5, 1); dome.translate(bx, LAND_H + 0.38, bz); domeGeos[seed % flowerCols.length].push(dome);
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
    // xả bồn hoa đã gom → 1 mesh vành + 7 mesh vòm hoa theo màu
    if (rimGeos.length) { const m = new THREE.Mesh(mergeGeometries(rimGeos), bedRimM); m.receiveShadow = true; m.name = 'flowerbed_rims'; scene.add(m); rimGeos.forEach((x) => x.dispose()); }
    domeGeos.forEach((arr, i) => { if (!arr.length) return; const m = new THREE.Mesh(mergeGeometries(arr), flowerDomeM[i]); m.name = 'flowerbed_domes_' + i; scene.add(m); arr.forEach((x) => x.dispose()); });
  }

  // ---------- KÈ HỒ SEN (cell_nam V1): lan can đỏ + nhịp vòm trắng bờ tây, phượng bờ đông ----------
  {
    const railG = [], archG = [];
    let acc = 0, archAcc = 0;
    for (let e = 0; e < HOSEN_POLY.length; e++) {
      const [ax, az] = HOSEN_POLY[e], [bx, bz] = HOSEN_POLY[(e + 1) % HOSEN_POLY.length];
      const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
      let nx = -uz, nz = ux;
      if (hoSenSD((ax + bx) / 2 + nx * 3, (az + bz) / 2 + nz * 3) < 0) { nx = -nx; nz = -nz; }
      const barAng = Math.atan2(ux, uz) + Math.PI / 2;
      for (let t = 1.3; t < L; t += 2.6) {
        const cx0 = ax + ux * t + nx * 1.2, cz0 = az + uz * t + nz * 1.2;
        if (Math.abs(groundHeightNoDeck(cx0, cz0) - LAND_H) > 0.5) continue;
        const post = new THREE.CylinderGeometry(0.06, 0.07, 1.1, 5); post.translate(cx0, LAND_H + 0.55, cz0); railG.push(post);
        for (const ry of [0.55, 0.95]) { const bar = new THREE.BoxGeometry(0.06, 0.06, 2.7); bar.rotateY(barAng + Math.PI / 2); bar.translate(cx0, LAND_H + ry, cz0); railG.push(bar); }
        acc += 2.6; archAcc += 2.6;
        if (archAcc >= 35 && cx0 < -30) {   // nhịp vòm thép TRẮNG bờ TÂY mỗi ~35m
          archAcc = 0;
          const arc = new THREE.TorusGeometry(1.9, 0.09, 6, 16, Math.PI);
          arc.rotateY(barAng + Math.PI / 2); arc.translate(cx0, LAND_H + 1.0, cz0); archG.push(arc);
        }
        if (cx0 > 18 && acc >= 20) { acc = 0; const tx2 = cx0 + nx * 3.5, tz2 = cz0 + nz * 3.5;
          if (Math.abs(groundHeightNoDeck(tx2, tz2) - LAND_H) < 0.4) phuongTree(tx2, tz2); }   // phượng bờ ĐÔNG
      }
    }
    addMerged(railG, mat(0xb03028), 'hosen_rail');
    addMerged(archG, mat(0xf2f4f6), 'hosen_arches');
    const base = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 1.2, 14), mat(0xcfc5ac));
    base.position.set(-10, 0.4, 950); scene.add(base);   // đài phun giữa hồ
    const jet2 = new THREE.Mesh(new THREE.ConeGeometry(0.6, 4.5, 8), new THREE.MeshLambertMaterial({ color: 0xeafaff, transparent: true, opacity: 0.7 }));
    jet2.position.set(-10, 3.2, 950); jet2.userData.dyn = true; scene.add(jet2);
    updaters.push((dt, time) => { jet2.scale.y = 0.8 + Math.sin(time * 2.7) * 0.2; });
    const deck2 = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 16), mat(0xb03028));
    deck2.position.set(5, LAND_H + 0.9, 852); deck2.rotation.y = 0.35; scene.add(deck2);   // cầu vòm đầu bắc
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
    p.userData.baseY = p.position.y; p.userData.dyn = true;
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
  clouds.forEach((c, i) => { c.userData.drift = 13 + (i % 5) * 3.5; c.userData.dyn = true; });   // ~13–27 m/s mỗi đám
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
    gulls.userData.dyn = true;
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
  // LƯU Ý: KHÔNG gọi streetTree/bakeTree sau flushTrees() — cây sẽ vô hình + collider ma.

  // ĐÓNG BĂNG ma trận local cho toàn bộ thế giới TĨNH (~6.400 object khỏi recompose mỗi khung).
  // Vật world.js tự animate đã đánh dấu userData.dyn (nước, thiên nga, mây, hải âu, cờ, tàu,
  // hải đăng, hoa nhặt) — cả cây con của chúng đều được chừa. Gọi từ main.js SAU buildWorld,
  // TRƯỚC khi tạo NPC/xe/traffic (mấy thứ đó thêm vào sau nên vẫn matrixAutoUpdate mặc định).
  world.freezeStatic = () => {
    scene.updateMatrixWorld(true);
    scene.traverse((o) => {
      if (o === scene || o.userData.dyn) return;
      let p = o.parent;
      while (p) { if (p.userData && p.userData.dyn) return; p = p.parent; }
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  };

  return world;
}
