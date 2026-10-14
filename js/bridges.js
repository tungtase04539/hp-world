// bridges.js — CẦU THEO WAY OSM (Đợt 3 W3-F, AUDIT3 FP-6 "elevated decks"): mặt cầu nâng + lan can + trụ + vòm HVT,
// và bộ lan can/dầm biên/trụ cho cầu PHẲNG (Lạc Long, Tam Kỳ, Tam Bạc…). Dữ liệu: mapdata BRIDGE_WAYS (SINH bởi
// tools/process_osm.mjs §6b4 — mỗi way: pts [[x,z,y]] cách ~3 m, w bề rộng mặt cầu, kind span|ramp|flat, ri chỉ số ROADS_DT).
//
// Vì sao: mô hình cũ (world.js "CẦU HOÀNG VĂN THỤ") dựng 1 hộp thẳng nối 2 đầu way bắc (75,−898)→(−45,−1883): vòm đỏ lệch
// ~110 m về đông pano_285 và tâm vòm ở z −1391 (trên đất Thủy Nguyên); 2 nút XOẮN ỐC phía Hải Phòng (đặc trưng thật
// của cầu HVT, ảnh pano_304/349) không tồn tại — roadnet vẽ chúng thành vòng nhựa NẰM ĐẤT (tấm đen trên nền đất).
//
// TRA CAO ĐỘ (thuần JS, không three): makeDeckIndex(ways) → { yAt(x,z,yRef), topAt(x,z), nearestAt(x,z) }
//   yAt: mặt cầu (≤ yRef + 1,2 m — "bước lên") CAO NHẤT phủ (x,z); −∞ nếu không — người chơi/xe/tác tử giao thông giữ
//        mặt cầu đang đứng (nút xoắn 2 tầng chồng nhau, cầu vượt trên phố mặt đất), lên cầu bằng dốc từ đầu nối mặt đất.
//   nearestAt: mặt cầu có TIM gần (x,z) nhất (đặt camera pano / spawn khi không có cao độ tham chiếu).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DECK_DEPTH = { span: 1.9, ramp: 1.35 };
const STEP_UP = 1.2;

export function makeDeckIndex(ways) {
  const segs = [];   // [ax, az, ay, bx, bz, by, hw, wi (chỉ số way), span (1: nhịp chính)]
  for (const [wi, b] of ways.entries()) {
    if (b.kind === 'flat') continue;
    const P = b.pts, hw = b.w / 2, dy = b.kind === 'deck' ? 0.11 : 0.02;   // mặt nhựa trên cao độ hồ sơ
    // cầu phố 'deck': chỉ khoảng nâng pts[i0..i1] (2 đầu sát đất là phố mặt đất của roadnet — không phải "mặt cầu")
    const i0 = b.kind === 'deck' ? b.i0 ?? 0 : 0, i1 = b.kind === 'deck' ? b.i1 ?? P.length - 1 : P.length - 1;
    for (let i = i0; i < i1; i++) segs.push([P[i][0], P[i][1], P[i][2] + dy, P[i + 1][0], P[i + 1][1], P[i + 1][2] + dy, hw, wi, b.kind === 'span' ? 1 : 0]);
  }
  const C = 16, G = new Map(), key = (i, j) => (i + 4096) * 8192 + (j + 4096);
  segs.forEach((s, si) => {
    const r = s[6] + 1;
    for (let i = Math.floor((Math.min(s[0], s[3]) - r) / C); i <= Math.floor((Math.max(s[0], s[3]) + r) / C); i++)
      for (let j = Math.floor((Math.min(s[1], s[4]) - r) / C); j <= Math.floor((Math.max(s[1], s[4]) + r) / C); j++) {
        const k = key(i, j); let a = G.get(k); if (!a) G.set(k, a = []); a.push(si);
      }
  });
  // duyệt các mặt cầu phủ (x,z): cb(y, khoảng cách ngang tới tim)
  function each(x, z, pad, cb) {
    const a = G.get(key(Math.floor(x / C), Math.floor(z / C))); if (!a) return;
    for (const si of a) {
      const s = segs[si], dx = s[3] - s[0], dz = s[4] - s[1], l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
      let t = ((x - s[0]) * dx + (z - s[1]) * dz) / l2;
      if (t < -0.02 || t > 1.02) continue;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - s[0] - dx * t, z - s[1] - dz * t);
      if (d > s[6] + pad) continue;
      cb(s[2] + (s[5] - s[2]) * t, d, si);
    }
  }
  // đoạn mặt cầu CÙNG TẦNG yRef (−2 … +STEP_UP) có TIM GẦN nhất (−1: không có) — không lấy "cao nhất": 2 nhịp chồng mép nhau
  // vài dm (x ≈ −53,5, z −935…−955) cao độ lệch mm → đi sát gờ nhịp này từng bị coi là đứng trên nhịp kia
  function segAt(x, z, yRef) {
    let bd = Infinity, bs = -1;
    each(x, z, 0.15, (y, d, si) => { if (y <= yRef + STEP_UP && y >= yRef - 2 && d < bd) { bd = d; bs = si; } });
    return bs;
  }
  return {
    segs,
    yAt(x, z, yRef) {
      let best = -Infinity;
      each(x, z, 0.15, (y) => { if (y <= yRef + STEP_UP && y > best) best = y; });
      return best;
    },
    topAt(x, z, pad = 0.15) { let best = -Infinity; each(x, z, pad, (y) => { if (y > best) best = y; }); return best; },
    nearestAt(x, z) { let best = -Infinity, bd = Infinity; each(x, z, 0.15, (y, d) => { if (d < bd) { bd = d; best = y; } }); return best; },
    nearestInfo(x, z) { let best = -Infinity, bd = Infinity; each(x, z, 0.15, (y, d) => { if (d < bd) { bd = d; best = y; } }); return { y: best, d: bd }; },
    covers(x, z, pad = 0) { let hit = false; each(x, z, pad, () => { hit = true; }); return hit; },
    // W3-F r5 (phản biện r2): bước (x0,z0)→(x1,z1) ở tầng yRef VƯỢT GỜ LAN CAN giữa 2 NHỊP CHÍNH (span) khác way — 2 nhịp HVT
    // một chiều chạm/chồng mép nhau ở x ≈ −53,5 (main.js tắt collider 2D trên cầu cao → từng đi/chạy xe xuyên 2 gờ). Nhịp chỉ
    // nối đầu-đầu với vòng xoắn/dốc (không bao giờ nhịp-nhịp) → đổi way giữa 2 nhịp luôn là đi NGANG qua gờ. (Thử tiêu chí
    // "điểm mới nằm cạnh way cũ" chặn nhầm ở chỗ nối dốc ↔ vòng xoắn: vòng cong, dốc rời tiếp tuyến — tools: r5/parapet4.mjs.)
    crossesParapet(x0, z0, x1, z1, yRef) {
      const a = segAt(x0, z0, yRef); if (a < 0 || !segs[a][8]) return false;
      const b = segAt(x1, z1, yRef); return b >= 0 && segs[b][8] === 1 && segs[b][7] !== segs[a][7];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Bộ đệm hình học đơn giản (position/normal/color/uv) — gộp thành 1 BufferGeometry mỗi material.
function Buf() { return { p: [], n: [], c: [], u: [], idx: [] }; }
function quad(B, a, b, c, d, nrm, col, uv) {   // a,b,c,d theo chiều ngược kim đồng hồ nhìn từ phía pháp tuyến
  const o = B.p.length / 3;   // (r5: 1 lệnh push mỗi thuộc tính — quad() là điểm nóng dựng cầu/bờ kè)
  B.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  const nx = nrm[0], ny = nrm[1], nz = nrm[2], r = col[0], g = col[1], bl = col[2];
  B.n.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
  B.c.push(r, g, bl, r, g, bl, r, g, bl, r, g, bl);
  if (uv) B.u.push(uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1], uv[3][0], uv[3][1]); else B.u.push(0, 0, 0, 0, 0, 0, 0, 0);
  B.idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
// withUV = false cho material KHÔNG texture (r5): freezeStatic gộp lượt 1 chép từng tam giác (splitGeometryByTile — kể cả
// mesh nhỏ, qua toWorld) rồi XOÁ uv — chép uv là phí. (Đã thử CHIA Ô SẴN theo lưới freeze: không lợi gì — mesh nhỏ cũng bị
// chép từng tam giác khi gộp; chi phí freeze ∝ số tam giác × số thuộc tính.)
function toGeo(B, withUV = true) {
  if (!B.idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
  if (withUV) g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2));
  g.setIndex(B.idx);
  // nhả mảng JS nguồn (đã chép sang typed array): closure trả về (keep/promSide…) giữ NGỮ CẢNH hàm dựng — mảng Buf
  // nằm trong ngữ cảnh đó (hàm con dùng chung) ⇒ không nhả thì ~30 MB heap sống suốt phiên (heap sau gc so với dot3: +54 → +27 MB)
  B.p = B.n = B.c = B.u = B.idx = [];
  return g;
}
// dải "hộp" dọc polyline: mỗi đoạn i→i+1 nối 2 mặt cắt; prof = [[l, y], ...] (l ngang, + = phải), mặt nối các cặp liên tiếp
function sweep(B, frames, prof, col, closed) {
  const nP = prof.length;
  for (let i = 0; i < frames.length - 1; i++) {
    const F1 = frames[i], F2 = frames[i + 1];
    for (let k = 0; k < (closed ? nP : nP - 1); k++) {
      const p1 = prof[k], p2 = prof[(k + 1) % nP];
      const A = [F1.x + F1.nx * p1[0], F1.y + p1[1], F1.z + F1.nz * p1[0]];
      const Bp = [F1.x + F1.nx * p2[0], F1.y + p2[1], F1.z + F1.nz * p2[0]];
      const Cp = [F2.x + F2.nx * p2[0], F2.y + p2[1], F2.z + F2.nz * p2[0]];
      const D = [F2.x + F2.nx * p1[0], F2.y + p1[1], F2.z + F2.nz * p1[0]];
      // pháp tuyến mặt: (B−A) × (D−A)
      const ux = Bp[0] - A[0], uy = Bp[1] - A[1], uz = Bp[2] - A[2], vx = D[0] - A[0], vy = D[1] - A[1], vz = D[2] - A[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl; ny /= nl; nz /= nl;
      quad(B, A, D, Cp, Bp, [-nx, -ny, -nz], col);
    }
  }
}
// khung rút gọn cho THANH MẢNH chạy dọc cầu (tay vịn): giữ khung mà đường thanh (tim + n·l) lệch dây cung ≥ tol (3D),
// dây ≤ 16 khung. Nhịp thẳng/dốc đều (span HVT, đường cong đứng bán kính lớn) còn vài khung/50 m; nút xoắn giữ gần đủ.
// (W3-F r5 perf: 4 sweep tay vịn kín theo khung 3 m = 36k tam giác; freezeStatic tách ô → không chỉ mục ×3 đỉnh)
function simplifyFrames(F, l, tol) {
  if (F.length <= 2) return F;
  const Q = F.map((f) => [f.x + f.nx * l, f.y, f.z + f.nz * l]), keep = [0];
  let i = 0;
  while (i < F.length - 1) {
    let j = i + 1;
    for (let c = i + 2; c < F.length && c - i <= 16; c++) {
      const A = Q[i], B = Q[c], dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], L2 = dx * dx + dy * dy + dz * dz || 1;
      let ok = true;
      for (let k = i + 1; k < c && ok; k++) {
        const P = Q[k], t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy + (P[2] - A[2]) * dz) / L2;
        ok = Math.hypot(P[0] - A[0] - dx * t, P[1] - A[1] - dy * t, P[2] - A[2] - dz * t) < tol;
      }
      if (!ok) break;
      j = c;
    }
    keep.push(j); i = j;
  }
  return keep.map((k) => F[k]);
}
// hộp đặc (trụ vuông/dầm) quay quanh trục y; noTop: bỏ mặt trên (cột tay vịn — đỉnh nằm trong thanh vịn)
function box(B, cx, cy, cz, sx, sy, sz, rotY, col, noTop) {
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const P = (lx, ly, lz) => [cx + lx * c + lz * s, cy + ly, cz - lx * s + lz * c];
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const N = (lx, ly, lz) => [lx * c + lz * s, ly, -lx * s + lz * c];
  quad(B, P(-hx, -hy, hz), P(hx, -hy, hz), P(hx, hy, hz), P(-hx, hy, hz), N(0, 0, 1), col);
  quad(B, P(hx, -hy, -hz), P(-hx, -hy, -hz), P(-hx, hy, -hz), P(hx, hy, -hz), N(0, 0, -1), col);
  quad(B, P(hx, -hy, hz), P(hx, -hy, -hz), P(hx, hy, -hz), P(hx, hy, hz), N(1, 0, 0), col);
  quad(B, P(-hx, -hy, -hz), P(-hx, -hy, hz), P(-hx, hy, hz), P(-hx, hy, -hz), N(-1, 0, 0), col);
  if (!noTop) quad(B, P(-hx, hy, hz), P(hx, hy, hz), P(hx, hy, -hz), P(-hx, hy, -hz), N(0, 1, 0), col);
}
// trụ tròn (không nắp dưới), n mặt
function cyl(B, cx, cz, y0, y1, r0, r1, n, col) {
  for (let k = 0; k < n; k++) {
    const a1 = (k / n) * Math.PI * 2, a2 = ((k + 1) / n) * Math.PI * 2, am = (a1 + a2) / 2;
    const c1 = Math.cos(a1), s1 = Math.sin(a1), c2 = Math.cos(a2), s2 = Math.sin(a2);
    quad(B, [cx + c1 * r0, y0, cz + s1 * r0], [cx + c1 * r1, y1, cz + s1 * r1], [cx + c2 * r1, y1, cz + s2 * r1], [cx + c2 * r0, y0, cz + s2 * r0],
      [Math.cos(am), 0, Math.sin(am)], col);
  }
}
const shade = (hex, f) => { const c = new THREE.Color(hex); return [c.r * f, c.g * f, c.b * f]; };

// texture mặt cầu: nhựa xám + vạch mép trắng liền + vạch giữa trắng đứt (làn một chiều 2 làn) — lặp dọc 12 m.
// twoWay: tim VÀNG liền đôi (cầu phố 2 chiều — ảnh pano_074 h270 Cầu Lạc Long)
// Texel ~ VUÔNG (256 px / bề rộng ~10 m ≈ 4 cm × 288 px / 12 m ≈ 4,2 cm): bản cũ 64 × 256 (16 × 4,7 cm) kéo hạt nhựa thành
// VỆT hướng về camera (ảnh W3-F after2 pano_074 h0 / 285 h90 — mặt cầu như "nhoè chuyển động").
function deckTexture(twoWay) {
  const W = 256, H = 288;   // u ngang (0..1 = mép trái → mép phải), v dọc 12 m
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#625f5a'; g.fillRect(0, 0, W, H);
  let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // mảng loang (vá, vệt bánh xe) lớn mờ → hạt cốt liệu nhỏ sáng/tối (phủ kín, không theo hướng)
  for (let i = 0; i < 70; i++) {
    const v = rnd() < 0.5 ? 0 : 255, r = 6 + rnd() * 26;
    g.fillStyle = `rgba(${v},${v},${v},${0.025 + rnd() * 0.03})`;
    g.beginPath(); g.ellipse(rnd() * W, rnd() * H, r, r * (0.6 + rnd() * 0.8), rnd() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 7000; i++) {
    const v = rnd() < 0.55 ? 78 + rnd() * 20 : 112 + rnd() * 28, sz = rnd() < 0.85 ? 1 : 2;
    g.fillStyle = `rgba(${v | 0},${(v - 2) | 0},${(v - 6) | 0},${0.16 + rnd() * 0.2})`;
    g.fillRect((rnd() * W) | 0, (rnd() * H) | 0, sz, sz);
  }
  // vệt bánh xe sẫm nhẹ giữa mỗi làn (2 làn: 1/4, 3/4 bề rộng)
  for (const c of [0.25, 0.75]) for (const d of [-0.07, 0.07]) {
    const gr = g.createLinearGradient(W * (c + d) - 10, 0, W * (c + d) + 10, 0);
    gr.addColorStop(0, 'rgba(30,28,26,0)'); gr.addColorStop(0.5, 'rgba(30,28,26,0.10)'); gr.addColorStop(1, 'rgba(30,28,26,0)');
    g.fillStyle = gr; g.fillRect(W * (c + d) - 10, 0, 20, H);
  }
  g.fillStyle = 'rgba(233,230,220,0.92)';
  g.fillRect(5, 0, 4, H); g.fillRect(W - 9, 0, 4, H);          // vạch mép ~16 cm
  if (twoWay) { g.fillStyle = '#d9b23a'; g.fillRect(W / 2 - 5, 0, 3, H); g.fillRect(W / 2 + 2, 0, 3, H); }
  else g.fillRect(W / 2 - 2, 0, 4, H * 0.4);                   // vạch giữa đứt (4,8 m / 12 m)
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// gạch vỉa hè cầu phố: ô vuông đỏ hồng mạch xám (ảnh pano_074 h180) — 1 texture = 2×2 ô (0,3 m)
function tileTexture() {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  let s = 5; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  g.fillStyle = '#8f8a82'; g.fillRect(0, 0, S, S);
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const k = 0.92 + rnd() * 0.12; g.fillStyle = `rgb(${188 * k | 0},${128 * k | 0},${118 * k | 0})`; g.fillRect(i * 32 + 1, j * 32 + 1, 30, 30); }
  for (let i = 0; i < 300; i++) { const v = rnd() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${v},${v},${v},0.07)`; g.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// tấm lan can con tiện trắng hoa văn ô van (alpha) — 1 ô = 1,5 m × 0,73 m
function balTexture() {
  const W = 192, H = 96, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); g.clearRect(0, 0, W, H);
  g.strokeStyle = '#f2efe8'; g.fillStyle = '#f2efe8';
  g.fillRect(0, H - 8, W, 8); g.fillRect(0, 0, W, 6);
  g.lineWidth = 5;
  for (let x = 12; x < W; x += 24) { g.beginPath(); g.ellipse(x, H / 2, 9, 30, 0, 0, Math.PI * 2); g.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------
// deps: { ways (BRIDGE_WAYS), ROADS_DT, groundHeightNoDeck, roadSurfaceAt(x,z) (world.roadNet.surfaceAt), panoCams,
//         hw(x), sw(x) (xsection: way {c, w?, sw?} hoặc cấp), LAND_H, isWater, lite, addCollider }
export function buildBridges(scene, deps) {
  const t0 = performance.now();
  const { ways, groundHeightNoDeck: ghN, LAND_H = 2 } = deps;
  const index = makeDeckIndex(ways);
  const stats = { decks: 0, deckM: 0, piers: 0, portals: 0, flatRails: 0, tris: 0 };
  const conc = Buf(), concD = Buf(), top = Buf(), rail = Buf(), red = Buf(), cable = Buf(), lamp = Buf(), concBal = Buf();
  const top2 = Buf(), walk = Buf(), balPanel = Buf();   // cầu phố 'deck': lòng 2 chiều, vỉa hè gạch, tấm lan can hoa văn
  const CONC = shade(0xc9c6bd, 1), CONC_SIDE = shade(0xbab6ac, 1), CONC_UNDER = shade(0xcdc9bf, 1), PIER = shade(0xbcb8ae, 1);   // mặt dưới SÁNG: pháp tuyến hướng xuống chỉ nhận ánh sáng trời/đất — 0x8d8a83 cũ thành mảng nâu đen (pano_349 h0; thật xám nhạt)
  const RAIL = shade(0x9aa1a3, 1), RED = shade(0xc63a2c, 1), CABLE = shade(0xe2ddd4, 1), CONC_PAR = shade(0xa9a8a2, 1);
  const panoNear = (x, z, r) => { for (const p of deps.panoCams || []) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < r * r) return true; return false; };
  const roadAt = (x, z) => (deps.roadSurfaceAt ? deps.roadSurfaceAt(x, z) > 0 : false);
  const groundY = (x, z) => Math.max(ghN(x, z), -3);

  // ---- khung (frame) dọc polyline: tâm, cao độ, pháp tuyến ngang (phải) ----
  const framesOf = (P) => P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return { x: p[0], z: p[1], y: p[2], tx, tz, nx: -tz, nz: tx };
  });

  // ================= CẦU PHỐ NÂNG NHẸ (kind 'deck' — Cầu Lạc Long, pano_074) =================
  // mặt cắt: lòng (ROAD_W cấp) + bó vỉa sơn sọc đỏ-trắng 1,5 m + vỉa hè gạch đỏ + gờ + lan can con tiện trắng hoa văn
  // ô van (tấm alpha) + tay vịn + trụ vuông 3 m; dầm biên xuống −1 m; trụ vuông trong nước mỗi ~20 m.
  const urbanDecks = [];
  function urbanDeck(b) {
    // r4: chỉ KHOẢNG NÂNG pts[i0..i1] (2 đầu sát đất = dải mặt đất của roadnet, nút giao 2 đầu nguyên vẹn)
    const F = framesOf(b.pts.slice(b.i0 ?? 0, (b.i1 ?? b.pts.length - 1) + 1)), W = b.w / 2, hw = Math.min(deps.hw(b.c), W - 1.5);
    const RT = 0.11, ST = 0.25, PL = 0.3;
    stats.decks++; urbanDecks.push(b);
    let acc = 0;
    const P3 = (Fr, l, dy) => [Fr.x + Fr.nx * l, Fr.y + dy, Fr.z + Fr.nz * l];
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
      // lòng đường (texture 2 chiều: tim vàng đôi)
      quad(top2, P3(A, -hw, RT), P3(A, hw, RT), P3(Bf, hw, RT), P3(Bf, -hw, RT), [0, 1, 0], [1, 1, 1], [[0, acc / 12], [1, acc / 12], [1, (acc + L) / 12], [0, (acc + L) / 12]]);
      for (const sg of [-1, 1]) {
        // vỉa hè gạch (uv theo mét /0,6)
        const a1 = sg * hw, a2 = sg * (W - PL);
        const V = [P3(A, a1, ST), P3(Bf, a1, ST), P3(Bf, a2, ST), P3(A, a2, ST)];
        const UV = [[a1 / 0.6, acc / 0.6], [a1 / 0.6, (acc + L) / 0.6], [a2 / 0.6, (acc + L) / 0.6], [a2 / 0.6, acc / 0.6]];
        if (sg > 0) quad(walk, V[0], V[3], V[2], V[1], [0, 1, 0], [1, 1, 1], [UV[0], UV[3], UV[2], UV[1]]);
        else quad(walk, V[0], V[1], V[2], V[3], [0, 1, 0], [1, 1, 1], UV);
        // bó vỉa: 2 nửa 1,5 m đỏ / trắng
        for (const [t0, t1, red] of [[0, 0.5, true], [0.5, 1, false]]) {
          const fa = { x: A.x + (Bf.x - A.x) * t0, y: A.y + (Bf.y - A.y) * t0, z: A.z + (Bf.z - A.z) * t0, nx: A.nx, nz: A.nz };
          const fb = { x: A.x + (Bf.x - A.x) * t1, y: A.y + (Bf.y - A.y) * t1, z: A.z + (Bf.z - A.z) * t1, nx: A.nx, nz: A.nz };
          const col = red ? shade(0xb8352a, 1) : shade(0xe6e2d8, 1);
          sweep(conc, [fa, fb], sg > 0 ? [[hw, ST], [hw, RT]] : [[-hw, RT], [-hw, ST]], col, false);
          // gờ chân lan can (mặt trên + 2 mặt đứng) cùng sọc
          sweep(conc, [fa, fb], sg > 0 ? [[W, ST + 0.32], [W - PL, ST + 0.32], [W - PL, ST]] : [[-(W - PL), ST], [-(W - PL), ST + 0.32], [-W, ST + 0.32]], red ? shade(0xb8352a, 1) : shade(0xe6e2d8, 1), false);
        }
        // tấm lan can hoa văn + tay vịn
        const lp = sg * (W - PL / 2);
        quad(balPanel, P3(A, lp, ST + 0.32), P3(Bf, lp, ST + 0.32), P3(Bf, lp, ST + 1.05), P3(A, lp, ST + 1.05), [A.nx * sg, 0, A.nz * sg], [1, 1, 1],
          [[acc / 1.5, 0], [(acc + L) / 1.5, 0], [(acc + L) / 1.5, 1], [acc / 1.5, 1]]);
        sweep(concBal, [A, Bf], [[lp - 0.13, ST + 1.04], [lp + 0.13, ST + 1.04], [lp + 0.13, ST + 1.16], [lp - 0.13, ST + 1.16]], shade(0xeeebe3, 1), true);
      }
      acc += L; stats.deckM += L;
    }
    // trụ lan can vuông mỗi 3 m (2 bên)
    for (let i = 0; i < F.length; i++) for (const sg of [-1, 1]) {
      const A = F[i], lp = sg * (W - PL / 2);
      box(concBal, A.x + A.nx * lp, A.y + ST + 0.32 + 0.45, A.z + A.nz * lp, 0.3, 0.9, 0.3, Math.atan2(A.tx, A.tz), shade(0xeeebe3, 1));
    }
    // dầm biên / TƯỜNG NỀN ĐẮP + mặt dưới (r4, phản biện): đoạn trên ĐẤT là nền đắp đầu cầu (ảnh vệ tinh tile 7: đường dẫn
    // tây cao giữa 2 phố gom 51/222 mặt đất) → mặt đứng 2 bên xuống TẬN ĐẤT (bản cũ: tấm bê tông lơ lửng, gầm 0,9 m — Bạch
    // Đằng "đâm" vào tấm); trên NƯỚC: dầm biên sâu theo cao độ (đầu cầu sát đất mỏng dần còn 0,25 m — không cắm xuống
    // mặt sông) + mặt dưới + MỐ chắn ngang ở chỗ chuyển đất ↔ nước (đầu nền đắp nhìn từ sông).
    const dep = (y) => Math.min(1.0, 0.25 + Math.max(0, y - LAND_H) * 0.5);
    const wet = F.map((Fr) => deps.isWater(Fr.x, Fr.z));
    const bot = (Fr, x, z) => (deps.isWater(x, z) ? Fr.y - dep(Fr.y) : Math.min(Fr.y - dep(Fr.y), groundY(x, z) - 0.3));
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], Bf = F[i + 1];
      for (const sg of [-1, 1]) {
        const ax = A.x + A.nx * sg * W, az = A.z + A.nz * sg * W, bx = Bf.x + Bf.nx * sg * W, bz = Bf.z + Bf.nz * sg * W;
        const a0 = [ax, bot(A, ax, az), az], b0 = [bx, bot(Bf, bx, bz), bz], a1 = [ax, A.y + ST + 0.32, az], b1 = [bx, Bf.y + ST + 0.32, bz];
        const nrm = [A.nx * sg, 0, A.nz * sg];
        if (sg > 0) quad(conc, a0, b0, b1, a1, nrm, CONC_SIDE); else quad(conc, b0, a0, a1, b1, nrm, CONC_SIDE);
      }
      if (wet[i] || wet[i + 1]) sweep(concD, [A, Bf].map((Fr) => ({ ...Fr, y: Fr.y - dep(Fr.y) })), [[-W, 0], [W, 0]], CONC_UNDER, false);
      if (wet[i] !== wet[i + 1]) {   // mố: tường ngang cả bề rộng, từ dưới mặt nước lên đáy dầm, ở khung phía đất
        const Fl = wet[i] ? Bf : A, top = Fl.y - dep(Fl.y), b0 = LAND_H - 3.2;
        box(conc, Fl.x, (top + b0) / 2, Fl.z, 2 * W, top - b0, 0.8, Math.atan2(Fl.tx, Fl.tz), CONC_SIDE);
        stats.abutments = (stats.abutments || 0) + 1;
      }
    }
    // trụ trong nước mỗi ~20 m (đỉnh trụ = đáy dầm)
    let s = 0, next = 10;
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
      while (next <= s + L) {
        const t = (next - s) / L; next += 20;
        const x = A.x + (Bf.x - A.x) * t, z = A.z + (Bf.z - A.z) * t, y = A.y + (Bf.y - A.y) * t;
        if (!deps.isWater(x, z)) continue;
        const d = dep(y);
        box(conc, x, (y - d - 3) / 2, z, 2 * W * 0.86, y - d + 3, 1.5, Math.atan2(A.nx, A.nz), PIER);
        stats.piers++;
      }
      s += L;
    }
  }

  // ================= CẦU NÂNG: mặt cầu + lan can + mặt dưới =================
  for (const b of ways) {
    if (b.kind === 'flat') continue;
    if (b.kind === 'deck') { urbanDeck(b); continue; }
    const F = framesOf(b.pts), hw = b.w / 2, D = DECK_DEPTH[b.kind] || 1.4;
    const PAR = 0.42, PH = 0.95;                       // gờ bê tông lan can: dày, cao
    stats.decks++;
    // mặt nhựa giữa 2 gờ (uv: u ngang 0..1, v dọc theo mét/12)
    let acc = 0;
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
      const li = hw - PAR;
      const p = (Fr, l) => [Fr.x + Fr.nx * l, Fr.y + 0.02, Fr.z + Fr.nz * l];
      quad(top, p(A, -li), p(A, li), p(Bf, li), p(Bf, -li), [0, 1, 0], [1, 1, 1], [[0, acc / 12], [1, acc / 12], [1, (acc + L) / 12], [0, (acc + L) / 12]]);
      acc += L; stats.deckM += L;
    }
    // gờ lan can 2 bên + mặt hông dầm (fascia) + mặt dưới
    for (const sg of [-1, 1]) {
      const li = sg * (hw - PAR), lo = sg * hw;
      // mặt ngoài (từ đáy dầm lên) → đỉnh gờ → mặt trong (xuống mặt nhựa). sweep: pháp tuyến = hướng đoạn mặt cắt quay
      // CHIỀU KIM ĐỒNG HỒ 90° trong mặt (l phải, y lên) ⇒ mặt cắt đi NGƯỢC chiều kim đồng hồ = pháp tuyến ra ngoài.
      // mặt ngoài (dầm biên) sáng CONC; đỉnh gờ + mặt trong xám lạnh hơn CONC_PAR (r4, phản biện: đỉnh/mặt trong cùng màu be
      // sáng thành "vệt be" loá dọc mép cầu ở pano_285 h90/h270 — gờ chắn bê tông thật xám, mặt trong khuất nắng)
      // Đ3-W5-D: SỌC ĐỎ trên mặt ngoài gờ lan can dốc/nhịp nâng (ảnh pano_304 h0/h90, 349 h0/h90: các nhánh xoắn trắng viền
      // một dải đỏ ~0,6 m chạy dọc mép trên) — dầm biên dưới sọc giữ CONC
      // chỉ đoạn mặt cầu cao ≥ 3 m trên đất (đoạn dốc sát đất = tường chắn nền đắp, ảnh 349 h90: xám trơn)
      const RS = PH - 0.6;
      const high = F.map((Fr) => Fr.y - groundY(Fr.x + Fr.nx * lo, Fr.z + Fr.nz * lo) >= 3);
      const runs = [[], []];   // [thấp, cao]: đoạn khung liên tiếp (chồng 1 khung ở chỗ chuyển)
      { let cur = null, k = -1; for (let i = 0; i < F.length; i++) { const h = high[i] ? 1 : 0; if (h !== k) { if (cur) cur.push(F[i]); cur = [F[i]]; runs[h].push(cur); k = h; } else cur.push(F[i]); } }
      const band = (prof) => { for (const R of runs[1]) if (R.length > 1) sweep(conc, R, prof, RED, false); for (const R of runs[0]) if (R.length > 1) sweep(conc, R, prof, CONC, false); };
      if (sg > 0) { sweep(conc, F, [[lo, -D], [lo, RS]], CONC, false); band([[lo, RS], [lo, PH]]); sweep(conc, F, [[lo, PH], [li, PH], [li, 0.02]], CONC_PAR, false); }
      else { sweep(conc, F, [[li, 0.02], [li, PH], [lo, PH]], CONC_PAR, false); band([[lo, PH], [lo, RS]]); sweep(conc, F, [[lo, RS], [lo, -D]], CONC, false); }
      // tay vịn thép trên gờ: thanh ngang + cột 2,5 m
      const rl = sg * (hw - PAR / 2);
      const FR = simplifyFrames(F, rl, 0.02);
      sweep(rail, FR, [[rl - 0.05, PH + 0.42], [rl + 0.05, PH + 0.42], [rl + 0.05, PH + 0.5], [rl - 0.05, PH + 0.5]], RAIL, true);
      sweep(rail, FR, [[rl - 0.03, PH + 0.18], [rl + 0.03, PH + 0.18], [rl + 0.03, PH + 0.23], [rl - 0.03, PH + 0.23]], RAIL, true);
      let s = 0;
      for (let i = 0; i < F.length - 1; i++) {
        const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
        for (let u = (2.5 - (s % 2.5)) % 2.5; u < L; u += 2.5) {
          const t = u / L, x = A.x + (Bf.x - A.x) * t + A.nx * rl, z = A.z + (Bf.z - A.z) * t + A.nz * rl, y = A.y + (Bf.y - A.y) * t;
          box(rail, x, y + PH + 0.25, z, 0.07, 0.5, 0.07, Math.atan2(A.tx, A.tz), RAIL, true);
        }
        s += L;
      }
    }
    sweep(concD, F, [[-hw, -D], [hw, -D]], CONC_UNDER, false);
    // đèn đường trên gờ ngoài (cột 9 m + cần vươn) mỗi 36 m, so le 2 bên
    {
      let s = 0, k = 0;
      for (let i = 0; i < F.length - 1; i++) {
        const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
        for (let u = (36 - (s % 36)) % 36; u < L; u += 36) {
          const t = u / L, sg = (k++ & 1) ? 1 : -1, l = sg * (hw - PAR / 2);
          const x = A.x + (Bf.x - A.x) * t + A.nx * l, z = A.z + (Bf.z - A.z) * t + A.nz * l, y = A.y + (Bf.y - A.y) * t + PH;
          cyl(lamp, x, z, y, y + 9, 0.13, 0.09, 6, shade(0x8e9496, 1));
          box(lamp, x - A.nx * sg * 1.0, y + 9, z - A.nz * sg * 1.0, 0.1, 0.1, 2.0, Math.atan2(A.nx, A.nz), shade(0x8e9496, 1));
          box(lamp, x - A.nx * sg * 1.9, y + 8.9, z - A.nz * sg * 1.9, 0.35, 0.18, 0.7, Math.atan2(A.nx, A.nz), shade(0x55595b, 1));
        }
        s += L;
      }
    }
  }

  // ================= TRỤ cầu nâng =================
  // khoảng cách trụ: dốc xoắn 24 m, nhịp chính 42 m; bỏ trong nhịp vòm; dời ±6 m khỏi lòng phố mặt đất / camera pano;
  // tầng TRÊN chồng lên tầng dưới → khung cổng 2 cột đứng NGOÀI mép tầng dưới + xà mũ.
  const arch = deps.arch || null;   // {z0, z1} nhịp vòm (không trụ giữa)
  for (const b of ways) {
    if (b.kind === 'flat' || b.kind === 'deck') continue;
    const F = framesOf(b.pts), hw = b.w / 2, D = DECK_DEPTH[b.kind] || 1.4;
    const SP = b.kind === 'span' ? 42 : 24;
    let s = 0, next = SP * 0.5;
    for (let i = 0; i < F.length - 1; i++) {
      const A = F[i], Bf = F[i + 1], L = Math.hypot(Bf.x - A.x, Bf.z - A.z);
      while (next <= s + L) {
        const t = (next - s) / L;
        next += SP;
        const fx = A.x + (Bf.x - A.x) * t, fz = A.z + (Bf.z - A.z) * t, fy = A.y + (Bf.y - A.y) * t;
        if (Math.hypot(fx, fz) > 2050) continue;
        if (arch && b.kind === 'span' && fz < arch.z0 - 6 && fz > arch.z1 + 6) continue;
        const under = fy - D;
        // chỗ đặt: tâm, dời dọc ±3/±6 m nếu vướng lòng phố/camera
        let px = fx, pz = fz, ok = false;
        for (const dl of [0, 3, -3, 6, -6]) {
          const qx = fx + A.tx * dl, qz = fz + A.tz * dl;
          if (roadAt(qx, qz) || panoNear(qx, qz, 4)) continue;
          px = qx; pz = qz; ok = true; break;
        }
        if (!ok) continue;
        const gy = groundY(px, pz);
        if (under - gy < 2.2) continue;                     // gầm thấp: dốc sát đất → không trụ (tường chắn bên dưới)
        // tầng dưới chồng ở đây? (mặt cầu khác thấp hơn ≥ 3 m phủ trong bán kính hw+1)
        let lower = null;
        for (const o of ways) {
          if (o === b || o.kind === 'flat') continue;
          const P = o.pts;
          for (let k = 0; k < P.length - 1; k++) {
            const dx = P[k + 1][0] - P[k][0], dz = P[k + 1][1] - P[k][1], l2 = dx * dx + dz * dz; if (!l2) continue;
            let tt = ((px - P[k][0]) * dx + (pz - P[k][1]) * dz) / l2; if (tt < 0 || tt > 1) continue;
            const qx = P[k][0] + dx * tt, qz = P[k][1] + dz * tt, d = Math.hypot(px - qx, pz - qz);
            const qy = P[k][2] + (P[k + 1][2] - P[k][2]) * tt;
            if (d < o.w / 2 + hw && qy < fy - 3) { const l = Math.hypot(dx, dz); lower = { x: qx, z: qz, y: qy, nx: -dz / l, nz: dx / l, hw: o.w / 2 }; break; }
          }
          if (lower) break;
        }
        const R = b.kind === 'span' ? 1.25 : 0.95;
        if (lower) {
          // cổng: 2 cột ngoài mép tầng dưới, xà mũ dưới tầng trên
          const off = lower.hw + 1.4;
          const pts2 = [[lower.x + lower.nx * off, lower.z + lower.nz * off], [lower.x - lower.nx * off, lower.z - lower.nz * off]];
          for (const [cx, cz] of pts2) cyl(conc, cx, cz, groundY(cx, cz) - 0.2, under - 0.6, 0.8, 0.75, 10, PIER);
          const mx = (pts2[0][0] + pts2[1][0]) / 2, mz = (pts2[0][1] + pts2[1][1]) / 2;
          box(conc, mx, under - 0.6, mz, 2 * off + 1.6, 1.2, 1.6, Math.atan2(lower.nx, lower.nz) + Math.PI / 2, CONC_SIDE);
          stats.portals++;
          continue;
        }
        cyl(conc, px, pz, gy - 0.2, under - 1.1, R, R * 0.92, 12, PIER);
        // mũ trụ (xà ngang dưới mặt cầu)
        box(conc, px, under - 0.55, pz, b.w * 0.82, 1.1, 1.8, Math.atan2(A.tx, A.tz), CONC_SIDE);
        stats.piers++;
      }
      s += L;
    }
  }

  // ================= VÒM THÉP HVT (nhịp chính) =================
  if (arch) {
    const spans = ways.filter((b) => b.kind === 'span');
    const mid = (z) => {   // tim giữa 2 làn + cao độ mặt cầu tại z
      let sx = 0, sy = 0, n = 0;
      for (const b of spans) {
        const P = b.pts;
        for (let k = 0; k < P.length - 1; k++) {
          const z0 = P[k][1], z1 = P[k + 1][1];
          if ((z - z0) * (z - z1) > 0 || z0 === z1) continue;
          const t = (z - z0) / (z1 - z0); sx += P[k][0] + (P[k + 1][0] - P[k][0]) * t; sy += P[k][2] + (P[k + 1][2] - P[k][2]) * t; n++; break;
        }
      }
      return n ? [sx / n, sy / n] : null;
    };
    const A0 = mid(arch.z0), A1 = mid(arch.z1);
    if (A0 && A1) {
      const ax = A1[0] - A0[0], az = arch.z1 - arch.z0, AL = Math.hypot(ax, az), ux = ax / AL, uz = az / AL, nx = -uz, nz = ux;
      const RIB = 16, H = arch.h || 38, TILT = 0.24;
      // Đ3-W5-D: SƯỜN VÒM = GIÀN MẮT CÁO (ảnh pano_285 h0/h270, 304 h0: mỗi sườn là giàn thép đỏ 2 biên trên/dưới cách ~3-4 m +
      // thanh xiên tam giác + thanh đứng, 2 sườn nghiêng vào nhau nối bằng giằng ngang/chéo ở đoạn đỉnh) thay HỘP ĐẶC 1,8 × 2,4 m
      // (đọc thành "dải đỏ trơn"). Biên dưới = cùng đường cong hạ DEP·bao (bao → 0 ở 2 chân: 2 biên chụm vào gối), cùng mặt
      // phẳng nghiêng TILT. ~350 thanh hộp ≈ 4,2k tam giác (cũ ~0,9k), 1 draw call (gộp như cũ).
      const DEP = 3.6, NT = 40;
      const env = (t) => Math.min(1, t / 0.07, (1 - t) / 0.07);
      const chordPt = (sg, t, lower) => {
        const along = t * AL, yb = A0[1] + (A1[1] - A0[1]) * t;
        const hh = Math.sin(t * Math.PI) * H - (lower ? DEP * env(t) : 0);
        const lat = sg * (RIB - Math.sin(TILT) * hh);
        return [A0[0] + ux * along + nx * lat, yb + 0.5 + hh * Math.cos(TILT), arch.z0 + uz * along + nz * lat];
      };
      red.geos = red.geos || [];
      const member = (p1, p2, w, h) => {
        const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2], L = Math.hypot(dx, dy, dz); if (L < 0.05) return;
        const g = new THREE.BoxGeometry(w, h, L + Math.min(w, h) * 0.5);
        const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(dx, dy, dz), Math.abs(dy) > 0.98 * L ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
        m.setPosition((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2, (p1[2] + p2[2]) / 2);
        g.applyMatrix4(m); red.geos.push(g);
      };
      const TOP = [[], []], BOT = [[], []];
      for (const [si, sg] of [[0, -1], [1, 1]]) {
        for (let k = 0; k <= NT; k++) { TOP[si].push(chordPt(sg, k / NT, false)); BOT[si].push(chordPt(sg, k / NT, true)); }
        for (let k = 0; k < NT; k++) {
          member(TOP[si][k], TOP[si][k + 1], 1.15, 1.3);                       // biên trên
          member(BOT[si][k], BOT[si][k + 1], 1.0, 1.1);                        // biên dưới
          if (env(k / NT) > 0.35 && k > 0) member(BOT[si][k], TOP[si][k], 0.42, 0.42);   // thanh đứng
          const kk = k + 1;                                                    // thanh xiên tam giác (Warren, đổi chiều mỗi khoang)
          if (env(Math.min(k, kk) / NT) > 0.2 || env(Math.max(k, kk) / NT) > 0.2) {
            if (k % 2 === 0) member(BOT[si][k], TOP[si][kk], 0.38, 0.38); else member(TOP[si][k], BOT[si][kk], 0.38, 0.38);
          }
        }
        // dây treo đan chéo (network arch): neo ở BIÊN DƯỚI, chân dây lệch dọc ±0,08 nhịp
        for (let k = 2; k <= NT - 2; k += 2) {
          const t = k / NT, top2 = BOT[si][k];
          for (const dd of [-0.08, 0.08]) {
            const tf = t + dd; if (tf < 0.03 || tf > 0.97) continue;
            const along = tf * AL, yb = A0[1] + (A1[1] - A0[1]) * tf + 0.9;
            const foot = [A0[0] + ux * along + nx * sg * 12.2, yb, arch.z0 + uz * along + nz * sg * 12.2];
            const dx = top2[0] - foot[0], dy = top2[1] - foot[1], dz = top2[2] - foot[2], L = Math.hypot(dx, dy, dz);
            const g = new THREE.CylinderGeometry(0.09, 0.09, L, 4, 1, true);
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
            g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3((top2[0] + foot[0]) / 2, (top2[1] + foot[1]) / 2, (top2[2] + foot[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
            cable.geos = cable.geos || []; cable.geos.push(g);
          }
        }
      }
      // giằng giữa 2 sườn ở đoạn đỉnh: thanh ngang ở biên trên + biên dưới mỗi 2 khoang, chéo chữ X giữa các thanh ngang (mặt trên)
      let prevK = -1;
      for (let k = Math.ceil(NT * 0.24); k <= Math.floor(NT * 0.76); k += 2) {
        member(TOP[0][k], TOP[1][k], 0.8, 0.8);
        member(BOT[0][k], BOT[1][k], 0.6, 0.6);
        if (prevK >= 0) { member(TOP[0][prevK], TOP[1][k], 0.45, 0.45); member(TOP[1][prevK], TOP[0][k], 0.45, 0.45); }
        prevK = k;
      }
      // trụ chân vòm (2 trụ lớn mỗi đầu, xuống nước)
      for (const [P, z] of [[A0, arch.z0], [A1, arch.z1]]) {
        for (const sg of [-1, 1]) {
          const cx = P[0] + nx * sg * 9.5, cz = z + nz * sg * 9.5;
          cyl(conc, cx, cz, -3, P[1] - 2.4, 2.4, 2.2, 14, PIER);
        }
        box(conc, P[0], P[1] - 2.6, z, 31, 2.2, 4.5, Math.atan2(nx, nz) + Math.PI / 2, CONC_SIDE);
      }
      stats.arch = { z0: arch.z0, z1: arch.z1, x0: +A0[0].toFixed(1), y0: +A0[1].toFixed(1) };
    }
  }

  // ================= THÁP THANG MÁY bộ hành (cạnh nhịp chính, bờ nam) — ảnh pano_304 h90 (tháp khung thép kính ở trái),
  // pano_285 h90 (cabin kính cạnh lan can phải). deps.lift = {x, z, side:+1 đông} =================
  if (deps.lift) {
    const { x: lx, z: lz } = deps.lift;
    const top = index.topAt(lx - 14, lz);         // cao độ mặt cầu cạnh tháp (tim làn bắc ~14,8 m phía tây)
    if (top > 4) {
      const S = 4.2, H = top + 3.2, STEEL = shade(0x6f7a80, 1), GLASS = shade(0x7e9aa6, 1);
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(rail, lx + sx * S / 2, H / 2 + 0.5, lz + sz * S / 2, 0.28, H, 0.28, 0, STEEL);
      for (let y = 3; y < H; y += 3) box(rail, lx, y, lz, S + 0.2, 0.18, S + 0.2, 0, STEEL);
      box(conc, lx, H / 2 + 0.5, lz, S - 0.3, H - 0.6, S - 0.3, 0, GLASS);                     // giếng kính
      box(conc, lx, H + 0.7, lz, S + 0.6, 0.35, S + 0.6, 0, shade(0x5c666b, 1));               // mái
      box(conc, (lx + (lx - 9.6)) / 2, top - 0.2, lz, 9.6 - S / 2, 0.4, 2.2, 0, CONC_SIDE);       // cầu nối sang mặt cầu
      box(rail, (lx + (lx - 9.6)) / 2, top + 0.8, lz - 1.05, 9.6 - S / 2, 0.06, 0.06, 0, RAIL);
      box(rail, (lx + (lx - 9.6)) / 2, top + 0.8, lz + 1.05, 9.6 - S / 2, 0.06, 0.06, 0, RAIL);
      if (deps.addCollider) deps.addCollider(lx, lz, 3.0);
      stats.lift = [lx, lz, +top.toFixed(1)];
    }
  }

  // ================= CẦU PHẲNG: lan can con tiện trắng + dầm biên + trụ trong nước =================
  // (mặt đường/vỉa hè sơn đỏ-trắng do roadnet vẽ ở LAND_H; ở đây chỉ phần "cầu": lan can ở MÉP NGOÀI vỉa hè, dầm biên từ
  //  mặt vỉa hè xuống dưới mặt nước, trụ vuông dưới mép ~ 18 m/trụ) — chỉ đoạn trên nước + 14 m mỗi bên.
  const BAL = shade(0xe9e6de, 1), BAL_D = shade(0xcfcbc1, 1);
  for (const b of ways) {
    if (b.kind !== 'flat') continue;
    const ri = b.ri && b.ri.length ? b.ri[0] : -1;
    const road = ri >= 0 && deps.ROADS_DT ? deps.ROADS_DT[ri] : null;
    if (!road) continue;
    if (!road.pts.some(([x, z]) => Math.hypot(x, z) < 1700)) continue;
    const c = road.c, edge = deps.hw(road) + deps.sw(road);   // tích hợp W3: mép vỉa RIÊNG way (W3-A) = mép roadnet vẽ
    // lấy mẫu 1,5 m dọc tim ROADS_DT; đánh dấu ướt
    const S = [];
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 1.5));
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * k / n, z = az + (bz - az) * k / n; S.push({ x, z, tx, tz, nx: -tz, nz: tx, wet: deps.isWater(x, z) }); }
    }
    if (!S.some((s) => s.wet)) continue;
    // mở rộng vùng "cầu" 14 m mỗi đầu đoạn ướt
    const on = S.map(() => false);
    S.forEach((s, i) => { if (!s.wet) return; for (let k = Math.max(0, i - 9); k <= Math.min(S.length - 1, i + 9); k++) on[k] = true; });
    for (const sg of [-1, 1]) {
      let prev = null, bay = 0;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        // miệng phố khác chạm cầu (nút giao) → hở lan can
        const ex = s.x + s.nx * sg * edge, ez = s.z + s.nz * sg * edge;
        const blocked = !on[i] || (deps.roadSurfaceAt && (() => { const v = deps.roadSurfaceAt(s.x + s.nx * sg * (edge + 1.2), s.z + s.nz * sg * (edge + 1.2)); return v > 0 && v < 0.2; })());
        if (blocked) { prev = null; continue; }
        const y0 = LAND_H + 0.25;
        if (prev) {
          const F2 = [{ x: prev[0], z: prev[1], y: y0, nx: s.nx, nz: s.nz }, { x: ex, z: ez, y: y0, nx: s.nx, nz: s.nz }];
          // gờ chân + tay vịn (mặt cắt ngược chiều kim đồng hồ — xem sweep)
          sweep(concBal, F2, [[0.16, 0], [0.16, 0.22], [-0.16, 0.22], [-0.16, 0]], BAL_D, false);
          sweep(concBal, F2, [[-0.12, 0.98], [0.12, 0.98], [0.12, 1.1], [-0.12, 1.1]], BAL, true);
          // con tiện: 2 thanh / 1,5 m
          for (const t of [0.25, 0.75]) box(concBal, prev[0] + (ex - prev[0]) * t, y0 + 0.6, prev[1] + (ez - prev[1]) * t, 0.11, 0.76, 0.11, 0, BAL);
          if ((bay++ % 2) === 0) box(concBal, ex, y0 + 0.58, ez, 0.26, 1.16, 0.26, Math.atan2(s.tx, s.tz), BAL);
          // dầm biên: mặt đứng ngoài từ mặt vỉa hè xuống −0,6 (che khe nước dưới đường) — chỉ đoạn trên nước
          if (s.wet) {
            const o = 0.18 * sg;
            const a = [prev[0] + s.nx * o, y0, prev[1] + s.nz * o], bb = [prev[0] + s.nx * o, -0.6, prev[1] + s.nz * o];
            const cc = [ex + s.nx * o, -0.6, ez + s.nz * o], d = [ex + s.nx * o, y0, ez + s.nz * o];
            // thứ tự (trên-đầu, dưới-đầu, dưới-cuối, trên-cuối) cho pháp tuyến +phải → bên trái đảo thứ tự
            if (sg > 0) quad(concBal, a, bb, cc, d, [s.nx, 0, s.nz], shade(0xb7b2a6, 1));
            else quad(concBal, d, cc, bb, a, [-s.nx, 0, -s.nz], shade(0xb7b2a6, 1));
          }
          stats.flatRails += 1.5;
        }
        prev = [ex, ez];
      }
    }
    // trụ trong nước mỗi ~18 m (dưới tim đường)
    let acc = 0;
    for (let i = 0; i < S.length; i++) {
      if (S[i].wet && acc >= 18) { const s = S[i]; box(concBal, s.x, -1.2, s.z, (edge + 0.2) * 2 * 0.9, 4.2, 1.6, Math.atan2(s.nx, s.nz), shade(0xa9a499, 1)); acc = 0; }
      acc += 1.5;
    }
  }

  // ---- ráp mesh ----
  const addMesh = (B, mat, name) => {
    let g = toGeo(B, !!mat.map);
    if (B.geos && B.geos.length) {
      const gs = B.geos.map((x) => { const y = x.index ? x.toNonIndexed() : x; y.deleteAttribute('uv'); return y; });
      const gg = mergeGeometries(gs); B.geos.forEach((x) => x.dispose());
      g = gg;
    }
    if (!g) return;
    const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = true; m.receiveShadow = true;
    scene.add(m); stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  };
  const vc = (hex) => new THREE.MeshLambertMaterial({ color: hex, vertexColors: true });
  // MẶT DƯỚI cầu (r4, phản biện pano_349 h0/h90/h180: "tấm nâu khaki sẫm"): pháp tuyến hướng XUỐNG chỉ nhận màu ĐẤT của đèn
  // bán cầu (nhựa/mái tối ~0,15) → nâu đen; bê tông gầm thật xám nhạt (ánh dội từ mặt nước/mặt phố + trời 2 bên). Pháp tuyến
  // (0,6·trục cầu, 0,8, ·) → bán cầu ~80 % trời: thử NGANG (50 %) còn nâu ở đoạn trục quay lưng nắng (349 h180) + sọc bóng
  // (normal bias ngang); nắng trực tiếp bị chính mặt cầu che (bản đồ bóng — bias đẩy điểm tra LÊN trong mặt cầu).
  for (let q = 0; q + 11 < concD.p.length; q += 12) {
    let dx = concD.p[q + 3] - concD.p[q], dz = concD.p[q + 5] - concD.p[q + 2], l = Math.hypot(dx, dz);
    if (l < 1e-6) { dx = 1; dz = 0; l = 1; }
    for (let k = 0; k < 4; k++) { concD.n[q + k * 3] = 0.6 * dx / l; concD.n[q + k * 3 + 1] = 0.8; concD.n[q + k * 3 + 2] = 0.6 * dz / l; }
  }
  addMesh(conc, vc(0xffffff), 'bridge_group_conc');
  addMesh(concD, vc(0xffffff), 'bridge_group_under');
  addMesh(concBal, vc(0xffffff), 'bridge_group_flat');
  addMesh(rail, vc(0xffffff), 'bridge_group_rail');
  addMesh(lamp, vc(0xffffff), 'bridge_group_lamps');
  const topMat = new THREE.MeshLambertMaterial({ map: deckTexture() });
  addMesh(top, topMat, 'bridge_group_deck');
  addMesh(top2, new THREE.MeshLambertMaterial({ map: deckTexture(true) }), 'bridge_group_deck2');
  addMesh(walk, new THREE.MeshLambertMaterial({ map: tileTexture() }), 'bridge_group_walk');
  const bp = toGeo(balPanel);
  if (bp) {
    const m = new THREE.Mesh(bp, new THREE.MeshLambertMaterial({ map: balTexture(), alphaTest: 0.5, side: THREE.DoubleSide }));
    m.name = 'bridge_group_balpanel'; m.userData.noMerge = true; scene.add(m);
  }
  if (red.geos) addMesh({ p: [], n: [], c: [], u: [], idx: [], geos: red.geos }, new THREE.MeshLambertMaterial({ color: 0xc63a2c }), 'bridge_group_arch');
  if (cable.geos) addMesh({ p: [], n: [], c: [], u: [], idx: [], geos: cable.geos }, new THREE.MeshLambertMaterial({ color: 0xe2ddd4 }), 'bridge_group_cables');
  stats.ms = Math.round(performance.now() - t0);
  stats.tris = Math.round(stats.tris);
  // KHÔNG trả mesh: freezeStatic gộp/tách ô rồi gỡ mesh gốc — giữ tham chiếu = giữ geometry gốc (JS) suốt phiên
  return { index, stats };
}
