import * as THREE from 'three';
import { ROADS_DT } from './terrain.js';
import { TIER, IS_MOBILE } from './device.js';
import { SIDEWALK_W, ROAD_TOP } from './xsection.js';
import { buildRoadGraph, edgePoint } from './roadgraph.js';
import { motorbikeGeometry, carGeometry, walkerGeometry, trafficMaterial, walkDepthMaterial, trafficUniforms } from './trafficmodels.js';

// ============================================================
// THÀNH PHỐ SỐNG (Đợt 3 WP8) — xe máy, ô tô, người đi bộ trên đồ thị PHỐ THẬT (js/roadgraph.js).
// Trước: 8 polyline dài nhất toàn DT_BOX chạy khứ hồi, 88-100% quãng đường ngoài vùng chơi (~2 xe nhìn thấy), LÀN
// TRÁI, 13-18 m/s, xe máy là con nhộng; 14 người đi bộ chibi ×24 mesh; 3 thuyền du lịch nằm trên CẠN (toạ độ 1:10 cũ).
// Nay:
//  - "BONG BÓNG" quanh người chơi (bán kính RB): đủ mật độ xe theo cấp phố (km đường trong bóng × mật độ/km), xe ra
//    khỏi bóng được TÁI SINH ở vành 130-RB m (ngoài tầm mắt — phố hẹp bị nhà che) → chi phí CPU cố định theo ngân sách;
//  - đi BÊN PHẢI: lệch ngang dương theo vector phải (−tz, tx); xe máy dàn trải phần phải lòng đường (bầy xe máy kiểu
//    VN, vượt nhau tự nhiên), ô tô đi giữa làn phải;
//  - qua NÚT thật: chọn cạnh tiếp theo (ưu tiên đi thẳng/đường lớn, cấm quay đầu trừ ngõ cụt), bo cua mượt bằng nội
//    suy 2 quỹ đạo lệch-làn quanh nút (bán kính bo ≤ 6 m), giảm tốc theo độ gắt của góc rẽ;
//  - tốc độ thật nội đô: xe máy 8-11 m/s (p/s), 6-9 (t), 4.5-7 (r); ô tô 9-12 / 7-9 / 5-6; người đi bộ 1,1-1,6;
//  - bám đuôi: lưới băm 10 Hz, xe phía trước trong hành lang ngang → giảm tốc, quá sát thì dừng; người chơi đứng giữa
//    đường → xe dừng/bấm còi (đếm số còi cho audio.js);
//  - người đi bộ trên vỉa hè 2 bên (xsection: mép bó vỉa + 55% bề rộng vỉa hè), KHÔNG đi vào footprint nhà thật
//    (footprints.js): gặp nhà thì nép ra mép vỉa, vẫn kẹt thì quay đầu;
//  - vẽ INSTANCED: 3 kiểu xe máy (1 người / chở 2 / chở hàng) + 3 kiểu ô tô (con / gầm cao / 16 chỗ) + 2 kiểu người
//    (đầu trần / nón lá) = 8 draw call (+8 bóng) cho cả thành phố; tay chân vung bằng vertex shader.
// HỢP ĐỒNG: InstancedMesh ở đây mang userData.noCull (instcull.js KHÔNG được nén — ma trận đổi mỗi khung) và
// boundingSphere = đĩa VẼ DRAW_R quanh người chơi (frustum cull đúng; harness tools/qa không ẩn nhầm).
// ============================================================

const RB = TIER >= 3 ? 340 : TIER === 2 ? 300 : 220;          // bán kính bong bóng xe (m) — xa hơn bị nhà che/còn vài px
const RW = TIER >= 2 ? 230 : 150;                              // bong bóng người đi bộ
// bán kính VẼ (quanh người chơi): xa hơn vẫn mô phỏng (dòng xe liền mạch khi tới gần) nhưng không vẽ — ở 260 m xe máy
// còn ~3 px và phần lớn bị nhà che; vẽ hết bong bóng 340 m tốn gấp ~1,7× vertex (cả lượt bóng) mà không thấy gì thêm.
const DRAW_R = TIER >= 3 ? 260 : TIER === 2 ? 230 : 170;
const SPAWN_MIN = 130;                                         // tái sinh ngoài vành này (khỏi "mọc" trước mặt)
const SPAWN_NEAR = 12;                                         // rải lại sau teleport: không mọc ĐÈ lên người chơi/camera
const CAP = TIER >= 3 ? { bike: 520, car: 90, walk: 260 } : TIER === 2 ? { bike: 380, car: 70, walk: 200 } : { bike: 140, car: 26, walk: 70 };
// mật độ trên mỗi km phố (cả 2 chiều) — pano: 196/551 ảnh tả xe máy "dày/kín", ô tô thưa hơn nhiều
const DENS = {
  bike: { p: 85, s: 65, t: 42, r: 20 },
  car: { p: 13, s: 9, t: 5, r: 1.5 },
  walk: { p: 34, s: 30, t: 22, r: 12 },
};
const VMAX = {
  bike: { p: [8.5, 11], s: [8, 10.5], t: [6, 8.5], r: [4.5, 7] },
  car: { p: [9, 12], s: [8.5, 11], t: [7, 9], r: [4.5, 6] },
};
const BIKE_KINDS = [['single', 0.58], ['pillion', 0.3], ['cargo', 0.12]];
const CAR_KINDS = [['sedan', 0.55], ['suv', 0.25], ['van', 0.2]];
const WALK_KINDS = [['plain', 0.8], ['nonla', 0.2]];
// màu (sRGB) — xe máy: đen/đỏ/trắng/xanh/bạc/nâu; ô tô: trắng/bạc/đen/đỏ/xanh; áo: trơn, sơ-mi, áo chống nắng
const BIKE_PAINT = [0x1b1b1d, 0x1b1b1d, 0x9b1b1b, 0xd9d9d6, 0xd9d9d6, 0x1f3f7a, 0x8d9095, 0x5a3b2a, 0x2c6a3e, 0xc9a24a];
const CAR_PAINT = [0xe9e9e6, 0xe9e9e6, 0xe9e9e6, 0xa6a9ad, 0xa6a9ad, 0x17181a, 0x17181a, 0x8a1a1a, 0x234a7a, 0x6b6e62];
const SHIRT = [0xe9e6dc, 0x2b4f8a, 0x7a2b2b, 0x3d6b4a, 0xd2b48c, 0x8fa9c9, 0x222225, 0xe0c64a, 0xc27aa0, 0x5f6b78, 0xf0f0ec, 0x8a5a3a];
const PANTS = [0x2a3140, 0x1e1f22, 0x3c4a63, 0x4a4036, 0x6b6f75, 0x23324d];

// PRNG xác định (seed cố định → ảnh A/B so sánh được; KHÔNG Math.random)
let _seed = 0x5eed1234;
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const pickW = (arr) => { let r = rnd() * arr.reduce((s, a) => s + a[1], 0); for (const a of arr) { r -= a[1]; if (r <= 0) return a[0]; } return arr[0][0]; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function createTraffic(scene, world, opts = {}) {
  const { groundHeight } = world;
  const PLAY_R = opts.playRadius || 1588;
  const fp = opts.footprints || null;
  const G = buildRoadGraph(ROADS_DT, { radius: PLAY_R, margin: 60 });
  const { nodes, edges } = G;
  const nodeIn = nodes.map((n) => Math.hypot(n.x, n.z) <= PLAY_R + 30);

  // ---------- Mesh instanced ----------
  const vehMat = trafficMaterial(false), walkMat = trafficMaterial(true);
  const groups = {};   // kind → {mesh, cap, list:[agents], aShirt, aShirt2}
  function makeGroup(key, geo, cap, mat, walk) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'traffic_' + key;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const sh = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    const sh2 = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    geo.setAttribute('aShirt', sh); geo.setAttribute('aShirt2', sh2);
    let ph = null, wk = null;
    if (walk) {
      ph = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      wk = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
      geo.setAttribute('aPhase', ph); geo.setAttribute('aWalk', wk);
      mesh.customDepthMaterial = walkDepthMaterial();
    }
    for (let i = 0; i < cap; i++) mesh.setColorAt(i, new THREE.Color(1, 1, 1));
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.castShadow = !IS_MOBILE || TIER >= 2;
    mesh.receiveShadow = true;
    mesh.userData.noCull = true;      // instcull: KHÔNG nén (ma trận đổi mỗi khung)
    // frustum cull theo BONG BÓNG (r160: InstancedMesh.boundingSphere tính 1 lần từ ma trận lúc đầu rồi cũ mãi)
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DRAW_R + 12);
    mesh.matrixAutoUpdate = false;    // gốc tĩnh ở (0,0,0); chỉ instanceMatrix đổi
    scene.add(mesh);
    groups[key] = { key, mesh, cap, list: [], sh, sh2, ph, wk, walk };
  }
  const nBikeK = BIKE_KINDS.length, nCarK = CAR_KINDS.length;
  for (const [k, w] of BIKE_KINDS) makeGroup('bike_' + k, motorbikeGeometry(k), Math.ceil(CAP.bike * Math.min(1, w * 1.6)), vehMat, false);
  for (const [k, w] of CAR_KINDS) makeGroup('car_' + k, carGeometry(k), Math.ceil(CAP.car * Math.min(1, w * 1.7)), vehMat, false);
  for (const [k, w] of WALK_KINDS) makeGroup('walk_' + k, walkerGeometry(k), Math.ceil(CAP.walk * Math.min(1, w * 1.4)), walkMat, true);

  // ---------- Tác tử ----------
  const agents = [];   // {type:'bike'|'car'|'walk', grp, e, dir, s, lat, vmax, v, prev, next, ...}
  const _p = { x: 0, z: 0, tx: 0, tz: 1 }, _q = { x: 0, z: 0, tx: 0, tz: 1 };
  const tmpCol = new THREE.Color();

  const rightOf = (o) => [-o.tz, o.tx];
  // lệch ngang (dương = bên phải hướng đi) theo loại + cấp phố
  // đường đôi một chiều (roadgraph e.oneway): người đi bộ chỉ ở vỉa hè PHÍA NGOÀI (−e.partner theo chiều a→b)
  const outerSide = (a, e) => (a.dir === 0 ? 1 : -1) * -e.partner;
  function latFor(a, e) {
    const hw = e.hw;
    if (a.type === 'walk') {
      if (e.oneway) a.side = outerSide(a, e);
      const sw = SIDEWALK_W[e.c] || 1.2;
      return a.side * (hw + Math.max(0.6, sw * a.lat01));
    }
    if (e.oneway) {   // một chiều: dùng CẢ lòng đường (xe máy dàn khắp, ô tô giữa ±)
      if (a.type === 'car') return Math.max(-(hw - 1.1), Math.min(hw - 1.1, hw * (-0.35 + 0.7 * a.lat01)));
      return Math.max(-(hw - 0.55), Math.min(hw - 0.55, hw * (-0.7 + 1.5 * a.lat01)));
    }
    if (a.type === 'car') return Math.max(1.25, Math.min(hw - 1.1, hw * (0.3 + 0.25 * a.lat01)));
    return Math.max(0.7, Math.min(hw - 0.55, hw * (0.3 + 0.62 * a.lat01)));   // xe máy: nửa phải lòng đường
  }
  const dirOK = (a, e, d) => a.type === 'walk' || !e.oneway || (e.oneway === 1) === (d === 0);
  function vmaxFor(a, e) {
    if (a.type === 'walk') return a.walkV;
    const r = VMAX[a.type][e.c] || VMAX[a.type].r;
    return r[0] + (r[1] - r[0]) * a.drive01;
  }
  // chọn cạnh tiếp theo tại nút cuối của (e,dir)
  function chooseNext(a) {
    const e = edges[a.e];
    const nodeId = a.dir ? e.a : e.b;
    const n = nodes[nodeId];
    edgePoint(e, a.dir, e.L, _p);
    let best = null, tot = 0;
    const cands = [];
    for (const ref of n.out) {
      const ei = ref >> 1, d = ref & 1;
      if (ei === a.e && n.out.length > 1) continue;            // không quay đầu (trừ ngõ cụt)
      const e2 = edges[ei];
      const far = d ? e2.a : e2.b;
      if (!nodeIn[far] && a.type !== 'walk') continue;         // không chạy ra ngoài vùng chơi
      if (!dirOK(a, e2, d)) continue;                          // không đi ngược chiều đường đôi
      edgePoint(e2, d, 0, _q);
      const cos = _p.tx * _q.tx + _p.tz * _q.tz;
      let w = 0.15 + (cos + 1) * (cos + 1);                     // ưu tiên đi thẳng
      if (a.type !== 'walk') w *= e2.c === 'p' ? 1.6 : e2.c === 's' ? 1.3 : e2.c === 't' ? 1 : 0.55;
      cands.push([ref, w, cos]); tot += w;
    }
    if (!cands.length) {
      // ngõ cụt: quay đầu — trừ khi đang ở đường đôi một chiều (quay đầu = đi ngược chiều) → cho biến mất, tái sinh chỗ khác
      if (dirOK(a, e, a.dir ^ 1)) return { e: a.e, dir: a.dir ^ 1, cos: -1 };
      a.kill = true; return { e: a.e, dir: a.dir, cos: 1 };
    }
    let r = rnd() * tot;
    for (const c of cands) { r -= c[1]; if (r <= 0) { best = c; break; } }
    if (!best) best = cands[cands.length - 1];
    return { e: best[0] >> 1, dir: best[0] & 1, cos: best[2] };
  }
  // vị trí thế giới của tác tử (có bo cua quanh nút)
  const _A = { x: 0, z: 0, tx: 0, tz: 1 }, _B = { x: 0, z: 0, tx: 0, tz: 1 };
  function offsetPoint(e, dir, s, lat, out) {
    edgePoint(e, dir, s, out);
    out.x += -out.tz * lat; out.z += out.tx * lat;
    return out;
  }
  function place(a, out) {
    const e = edges[a.e];
    const lat = a.latCur;
    const Rb = a.rb;
    if (a.next && a.s > e.L - Rb) {
      const u = a.s - e.L;   // âm trước nút
      const en = edges[a.next.e];
      offsetPoint(e, a.dir, a.s, lat, _A);
      offsetPoint(en, a.next.dir, u, latFor(a, en), _B);
      const w = smooth((u + Rb) / (2 * Rb));
      out.x = _A.x + (_B.x - _A.x) * w; out.z = _A.z + (_B.z - _A.z) * w;
      return out;
    }
    if (a.prev && a.s < a.prevRb) {
      const ep = edges[a.prev.e];
      offsetPoint(ep, a.prev.dir, ep.L + a.s, a.prevLat, _A);
      offsetPoint(e, a.dir, a.s, lat, _B);
      const w = smooth((a.s + a.prevRb) / (2 * a.prevRb));
      out.x = _A.x + (_B.x - _A.x) * w; out.z = _A.z + (_B.z - _A.z) * w;
      return out;
    }
    offsetPoint(e, a.dir, a.s, lat, out);
    return out;
  }

  // ---------- Danh sách cạnh trong bong bóng (làm mới 1 s) ----------
  let bubX = 1e9, bubZ = 1e9, bubEdges = [], bubAt = -1e9;
  const want = { bike: 0, car: 0, walk: 0 };
  function refreshBubble(px, pz) {
    bubX = px; bubZ = pz;
    bubEdges = [];
    const km = { bike: 0, car: 0, walk: 0 };
    const RB2 = RB * RB, RW2 = RW * RW;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      if (Math.hypot(e.mx - px, e.mz - pz) - e.L / 2 > RB) continue;
      // chiều dài nằm trong bóng: lấy mẫu 6 điểm dọc cạnh
      let inB = 0, inW = 0;
      for (let k = 0; k < 6; k++) {
        edgePoint(e, 0, e.L * (k + 0.5) / 6, _q);
        const d2 = (_q.x - px) * (_q.x - px) + (_q.z - pz) * (_q.z - pz);
        if (d2 < RB2) inB++;
        if (d2 < RW2) inW++;
      }
      if (!inB) continue;
      bubEdges.push(i);
      const Lb = e.L * inB / 6000, Lw = e.L * inW / 6000;   // km
      km.bike += Lb * (DENS.bike[e.c] || 0);
      km.car += Lb * (DENS.car[e.c] || 0);
      km.walk += Lw * (DENS.walk[e.c] || 0);
    }
    want.bike = Math.min(CAP.bike, Math.round(km.bike));
    want.car = Math.min(CAP.car, Math.round(km.car));
    want.walk = Math.min(CAP.walk, Math.round(km.walk));
  }

  function groupFor(type) {
    if (type === 'bike') return groups['bike_' + pickW(BIKE_KINDS)];
    if (type === 'car') return groups['car_' + pickW(CAR_KINDS)];
    return groups['walk_' + pickW(WALK_KINDS)];
  }
  // đặt 1 tác tử lên cạnh ngẫu nhiên trong bóng (theo trọng số chiều dài × mật độ), cách người chơi ≥ minD
  function spawnAgent(a, px, pz, minD, maxD) {
    const dens = DENS[a.type];
    for (let tries = 0; tries < 24; tries++) {
      const ei = bubEdges[Math.floor(rnd() * bubEdges.length)];
      if (ei === undefined) return false;
      const e = edges[ei];
      if (rnd() * 90 > (dens[e.c] || 0)) continue;              // trọng số mật độ theo cấp phố
      a.e = ei; a.dir = rnd() < 0.5 ? 0 : 1; a.s = rnd() * e.L;
      if (!dirOK(a, e, a.dir)) a.dir ^= 1;
      a.prev = null; a.next = null; a.rb = 6; a.prevRb = 0;
      a.lat01 = rnd(); a.drive01 = rnd();
      if (a.type === 'walk') { a.side = rnd() < 0.5 ? 1 : -1; a.lat01 = 0.35 + rnd() * 0.4; a.walkV = 1.1 + rnd() * 0.5; }
      a.latCur = latFor(a, e);
      place(a, _p);
      const d = Math.hypot(_p.x - px, _p.z - pz);
      if (d < minD || d > maxD) continue;
      if (a.type === 'walk' && fp && fp.blocked(_p.x, _p.z)) continue;   // không mọc trong nhà
      if (!hashFree(_p.x, _p.z, a.type === 'car' ? 6 : a.type === 'bike' ? 2.5 : 1)) continue;
      a.vmax = vmaxFor(a, e); a.v = a.vmax * 0.8; a.lim = a.vmax;
      a.x = _p.x; a.z = _p.z; a.h = Math.atan2(_p.tx, _p.tz); a.hInit = true; a.lean = 0;
      a.blockedT = 0; a.checkAt = 0; a.ghostT = 0; a.waitT = 0; a.avoid = 0; a.avT = 0;
      return true;
    }
    return false;
  }
  function newAgent(type) {
    const grp = groupFor(type);
    if (grp.list.length >= grp.cap) return null;
    const a = { type, grp, slot: -1 };
    a.paint = new THREE.Color(type === 'car' ? pick(CAR_PAINT) : pick(BIKE_PAINT));
    a.shirt = new THREE.Color(pick(SHIRT));
    a.shirt2 = new THREE.Color(type === 'walk' ? pick(PANTS) : pick(SHIRT));
    if (type === 'walk') a.phase = rnd() * 6.28;
    grp.list.push(a);
    agents.push(a);
    return a;
  }
  function removeAgent(a) {
    const L = a.grp.list; const i = L.indexOf(a); if (i >= 0) { L[i] = L[L.length - 1]; L.pop(); }
    const j = agents.indexOf(a); if (j >= 0) { agents[j] = agents[agents.length - 1]; agents.pop(); }
  }

  // ---------- Lưới băm vị trí (bám đuôi + tránh mọc chồng) ----------
  const HC = 8;
  let hmap = new Map();
  const hk = (x, z) => (Math.floor(x / HC) + 4096) * 8192 + (Math.floor(z / HC) + 4096);
  function rebuildHash() {
    hmap = new Map();
    for (const a of agents) {
      if (a.type === 'walk') continue;
      const k = hk(a.x, a.z); let l = hmap.get(k); if (!l) hmap.set(k, (l = [])); l.push(a);
    }
  }
  function hashFree(x, z, r) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = hmap.get(hk(x + i * HC, z + j * HC)); if (!l) continue;
      for (const b of l) if (Math.hypot(b.x - x, b.z - z) < r) return false;
    }
    return true;
  }
  // tốc độ mục tiêu theo xe phía trước (hành lang ngang) + người chơi
  let honk = 0;
  function followLimit(a, px, pz) {
    const fx = Math.sin(a.h), fz = Math.cos(a.h);
    const look = a.type === 'car' ? 11 : 6.5, halfW = a.type === 'car' ? 1.5 : 0.75;
    let lim = a.vmax;
    if (a.ghostT > 0) { a.ghostT -= 0.1; return lim; }        // vừa thoát kẹt: chạy xuyên 1,5 s (chống khoá chết ở nút)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = hmap.get(hk(a.x + i * HC, a.z + j * HC)); if (!l) continue;
      for (const b of l) {
        if (b === a) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const ahead = dx * fx + dz * fz; if (ahead <= 0.3 || ahead > look) continue;
        const side = Math.abs(dx * fz - dz * fx);
        const wb = b.type === 'car' ? 1.0 : 0.4;
        if (side > halfW + wb) continue;
        const same = fx * Math.sin(b.h) + fz * Math.cos(b.h);   // cos góc giữa 2 hướng đi
        const len = (a.type === 'car' || b.type === 'car' ? 4.2 : 2.0);
        if (same > 0.4) {                                   // cùng chiều → bám tốc độ xe trước
          const gap = ahead - len;
          lim = Math.min(lim, gap <= 0 ? 0 : Math.max(0, Math.min(b.v * 1.05 + gap * 0.6, a.vmax)));
        } else if (ahead < len + 1.5) {                     // cắt ngang/ngược chiều sát mũi → nhường
          lim = Math.min(lim, 0.6);
        }
      }
    }
    if (lim < 0.7) { a.waitT += 0.1; if (a.waitT > 3) { a.waitT = 0; a.ghostT = 1.5; } } else a.waitT = 0;
    return lim;
  }
  // NGƯỜI CHƠI (đi bộ hoặc đang lái) đứng trên đường đi của tác tử: LÁCH sang bên cho đủ khoảng hở (như xe máy VN
  // lách người qua đường), lách không đủ (lòng đường/vỉa hè hẹp) thì giảm tốc, dừng hẳn + bấm còi. Trả trần tốc độ.
  // a.avT = độ lệch ngang mục tiêu (m, dương = bên phải hướng đi) — stepAgent trượt a.avoid về đó với tốc độ giới hạn.
  // Áp cho cả tác tử đang "thoát kẹt" (ghostT) — trước đây nhánh đó bỏ qua người chơi, xe chạy xuyên qua người.
  const CLEAR = { bike: 2.0, car: 2.7, walk: 1.0 };      // khoảng cách tâm–người chơi khi lách qua (m)
  const STOPW = { bike: 1.35, car: 2.1, walk: 0.6 };     // hở ngang nhỏ hơn mức này mà vẫn tới gần → dừng
  function avoidPlayer(a, px, pz) {
    const fx = Math.sin(a.h), fz = Math.cos(a.h);
    const dx = px - a.x, dz = pz - a.z, ahead = dx * fx + dz * fz;
    const look = a.type === 'car' ? 11 : a.type === 'bike' ? 6.5 : 2.5;
    // lệch ngang của người chơi so với QUỸ ĐẠO GỐC (chưa lách): bên phải hướng đi = (−fz, fx)
    const plBase = -dx * fz + dz * fx + (a.avoid || 0);
    const clr = CLEAR[a.type];
    let avT = 0;
    if (ahead > -2 && ahead < look + (a.type === 'walk' ? 3 : 14) && Math.abs(plBase) < clr) {
      avT = plBase > 0 ? plBase - clr : plBase + clr;
      // giới hạn trong mặt cắt phố: xe trong lòng đường (xe máy được lấn tạm sang làn ngược), người trên vỉa hè
      const e = edges[a.e], hw = e.hw;
      let lo, hi;
      if (a.type === 'walk') {
        const sw = SIDEWALK_W[e.c] || 1.2, i0 = hw + 0.25, i1 = hw + Math.max(0.6, sw - 0.25);
        lo = a.side > 0 ? i0 : -i1; hi = a.side > 0 ? i1 : -i0;
      } else {
        const m = a.type === 'car' ? 1.1 : 0.5;
        lo = -(hw - m); hi = hw - m;
        if (a.type === 'car' && !e.oneway) lo = Math.min(lo + hw * 0.6, a.latCur);   // ô tô không lấn hẳn làn ngược
      }
      avT = Math.max(lo - a.latCur, Math.min(hi - a.latCur, avT));
    }
    a.avT = avT;
    let lim = 1e9;
    if (ahead > 0 && ahead < look + 4 && Math.abs(plBase - avT) < STOPW[a.type]) {
      lim = Math.max(0, (ahead - (a.type === 'walk' ? 0.9 : 3)) * 0.8);
      if (a.type !== 'walk' && lim < 0.5) { a.blockedT += 0.1; if (a.blockedT > 1.2 && rnd() < 0.08) honk++; }
    } else a.blockedT = 0;
    return lim;
  }

  // ---------- Khởi tạo quanh điểm xuất phát ----------
  function fill(px, pz, minD) {
    for (const type of ['bike', 'car', 'walk']) {
      const rmax = type === 'walk' ? RW : RB;
      let have = agents.filter((a) => a.type === type).length;
      let guard = 0;
      while (have < want[type] && guard++ < want[type] * 2 + 20) {
        const a = newAgent(type);
        if (!a) continue;
        if (spawnAgent(a, px, pz, minD, rmax)) { have++; rebuildHashLite(a); }
        else removeAgent(a);
      }
    }
  }
  function rebuildHashLite(a) {
    if (a.type === 'walk') return;
    const k = hk(a.x, a.z); let l = hmap.get(k); if (!l) hmap.set(k, (l = [])); l.push(a);
  }

  // ---------- Cập nhật ----------
  const m4 = new THREE.Matrix4();
  let frameNo = 0, lastHash = 0, lastFill = 0;
  let stats = { near: 0, honk: 0, bikes: 0, cars: 0, walkers: 0 };
  function stepAgent(a, dt, px, pz) {
    const e = edges[a.e];
    // tốc độ mục tiêu: bám đuôi + giảm tốc vào cua
    let target = a.lim;
    if (a.type !== 'walk' && a.next && e.L - a.s < 18) {
      const sharp = (1 - a.next.cos) * 0.5;                // 0 thẳng … 1 quay đầu
      target = Math.min(target, a.vmax * (1 - 0.6 * sharp) + 1);
    }
    const acc = a.type === 'car' ? 2.2 : a.type === 'bike' ? 3 : 2;
    a.v += Math.max(-6 * dt, Math.min(acc * dt, target - a.v));
    if (a.v < 0) a.v = 0;
    a.s += a.v * dt;
    if (!a.next && a.s > e.L - 8) {
      a.next = chooseNext(a);
      const en = edges[a.next.e];
      a.rb = Math.max(1.5, Math.min(a.type === 'walk' ? 3.5 : 6, e.L * 0.4, en.L * 0.4));
    }
    if (a.s >= e.L) {
      const nx = a.next || chooseNext(a);
      a.prev = { e: a.e, dir: a.dir }; a.prevRb = a.rb; a.prevLat = a.latCur;
      a.s -= e.L; a.e = nx.e; a.dir = nx.dir; a.next = null;
      const en = edges[a.e];
      a.latCur = latFor(a, en);
      if (a.type !== 'walk') a.vmax = vmaxFor(a, en);
      a.rb = Math.max(1.5, Math.min(a.type === 'walk' ? 3.5 : 6, en.L * 0.4));
      if (a.prevRb > en.L * 0.45) a.prevRb = Math.max(1, en.L * 0.45);
    }
    // người đi bộ: không đi vào nhà thật — nép ra mép vỉa, vẫn kẹt thì quay đầu
    if (a.type === 'walk' && fp && (a.checkAt -= dt) <= 0) {
      a.checkAt = 0.5;
      const ee = edges[a.e];
      offsetPoint(ee, a.dir, a.s + 2, a.latCur, _q);
      if (fp.blocked(_q.x, _q.z)) {
        const inner = a.side * (ee.hw + 0.55);
        offsetPoint(ee, a.dir, a.s + 2, inner, _q);
        if (!fp.blocked(_q.x, _q.z) && Math.abs(a.latCur - inner) > 0.1) a.latCur = inner;
        else { a.dir ^= 1; a.s = Math.max(0, ee.L - a.s); a.side = -a.side; a.latCur = latFor(a, ee); a.next = null; a.prev = null; }
      }
    }
    place(a, _p);
    // lách người chơi (avoidPlayer): lệch ngang trượt mượt về a.avT, cộng theo vector phải của hướng xe hiện tại
    if (a.avT || a.avoid) {
      const k = (a.type === 'car' ? 1.2 : a.type === 'bike' ? 1.8 : 0.9) * dt;
      a.avoid += Math.max(-k, Math.min(k, (a.avT || 0) - a.avoid));
      if (Math.abs(a.avoid) < 1e-3 && !a.avT) a.avoid = 0;
      _p.x += -Math.cos(a.h) * a.avoid; _p.z += Math.sin(a.h) * a.avoid;
    }
    const dx = _p.x - a.x, dz = _p.z - a.z, d = Math.hypot(dx, dz);
    if (d > 1e-3) {
      const hNew = Math.atan2(dx, dz);
      if (!a.hInit || d > 8) { a.h = hNew; a.hInit = true; }
      else {
        let dh = hNew - a.h; while (dh > Math.PI) dh -= 6.2832; while (dh < -Math.PI) dh += 6.2832;
        const yawRate = dh / Math.max(dt, 1e-3);
        a.h += dh * Math.min(1, dt * 14);
        if (a.type === 'bike') {                                   // nghiêng xe khi vào cua (atan(v·ω/g))
          const lt = -Math.max(-0.35, Math.min(0.35, Math.atan((a.v * yawRate) / 9.8)));
          a.lean += (lt - a.lean) * Math.min(1, dt * 5);
        }
      }
    }
    a.x = _p.x; a.z = _p.z;
  }

  const DRAW_R2 = DRAW_R * DRAW_R;
  function writeInstances(px, pz) {
    for (const k in groups) {
      const g = groups[k], arr = g.mesh.instanceMatrix.array, carr = g.mesh.instanceColor.array;
      const sh = g.sh.array, sh2 = g.sh2.array;
      const L = g.list;
      let i = 0;   // ô instance đang ghi (chỉ tác tử trong bán kính vẽ)
      for (let j = 0; j < L.length; j++) {
        const a = L[j];
        if ((a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz) > DRAW_R2) { a.slot = -1; continue; }   // ô cũ có thể bị xe khác ghi đè
        if (!(Math.abs(a.x - a.yx) + Math.abs(a.z - a.yz) < 4)) { a.yx = a.x; a.yz = a.z; a.y = groundHeight(a.x, a.z) + (a.type === 'walk' ? 0 : ROAD_TOP); }
        const y = a.y;
        const ch = Math.cos(a.h), shh = Math.sin(a.h), cl = Math.cos(a.lean || 0), sl = Math.sin(a.lean || 0);
        const o = i * 16;
        // R = Ry(h)·Rz(lean) (cột-trước như Matrix4.elements)
        arr[o] = ch * cl; arr[o + 1] = sl; arr[o + 2] = -shh * cl; arr[o + 3] = 0;
        arr[o + 4] = -ch * sl; arr[o + 5] = cl; arr[o + 6] = shh * sl; arr[o + 7] = 0;
        arr[o + 8] = shh; arr[o + 9] = 0; arr[o + 10] = ch; arr[o + 11] = 0;
        arr[o + 12] = a.x; arr[o + 13] = y; arr[o + 14] = a.z; arr[o + 15] = 1;
        if (a.slot !== i || a.grp !== g) {                         // màu chỉ ghi khi đổi chỗ
          a.slot = i;
          carr[i * 3] = a.paint.r; carr[i * 3 + 1] = a.paint.g; carr[i * 3 + 2] = a.paint.b;
          sh[i * 3] = a.shirt.r; sh[i * 3 + 1] = a.shirt.g; sh[i * 3 + 2] = a.shirt.b;
          sh2[i * 3] = a.shirt2.r; sh2[i * 3 + 1] = a.shirt2.g; sh2[i * 3 + 2] = a.shirt2.b;
          g.colorDirty = true;
          if (g.walk) g.ph.array[i] = a.phase;
        }
        if (g.walk) g.wk.array[i] = a.v > 0.2 ? a.v * 3.9 : 0;   // nhịp bước ∝ tốc độ (bước ~0,8 m)
        i++;
      }
      const n = i;
      g.mesh.count = n;
      if (!n) continue;
      const im = g.mesh.instanceMatrix; im.clearUpdateRanges(); im.addUpdateRange(0, n * 16); im.needsUpdate = true;
      if (g.colorDirty) {
        for (const at of [g.mesh.instanceColor, g.sh, g.sh2]) { at.clearUpdateRanges(); at.addUpdateRange(0, n * 3); at.needsUpdate = true; }
        if (g.walk) { g.ph.clearUpdateRanges(); g.ph.addUpdateRange(0, n); g.ph.needsUpdate = true; }
        g.colorDirty = false;
      }
      if (g.walk) { g.wk.clearUpdateRanges(); g.wk.addUpdateRange(0, n); g.wk.needsUpdate = true; }
      g.mesh.boundingSphere.center.set(px, 2, pz);
    }
  }

  refreshBubble(-5, 72);
  fill(-5, 72, SPAWN_NEAR);

  let enabled = true, msEMA = 0;
  // đèn pha/đèn hậu sáng theo đêm (main.js truyền dayNight.update().night mỗi khung)
  const setNight = (v) => { trafficUniforms.uNight.value = v; };
  function setEnabled(on) {
    enabled = !!on;
    for (const k in groups) groups[k].mesh.visible = enabled;
  }
  function update(dt, time, playerPos) {
    if (!enabled) return stats;
    frameNo++;
    const now = performance.now();
    const px = playerPos.x, pz = playerPos.z;
    trafficUniforms.uTime.value = time;
    if (now - bubAt > 1000 || Math.hypot(px - bubX, pz - bubZ) > 60) {
      // dịch chuyển xa (teleport) → rải lại toàn bộ trong bóng mới (từ 12 m — ảnh pano QA từng có ô tô đè lên camera)
      const jump = Math.hypot(px - bubX, pz - bubZ) > RB;
      bubAt = now; refreshBubble(px, pz);
      if (jump) for (const a of agents.slice()) removeAgent(a);
      if (jump) { rebuildHash(); fill(px, pz, SPAWN_NEAR); }
    }
    if (now - lastHash > 100) {
      lastHash = now; rebuildHash();
      for (const a of agents) a.lim = Math.min(a.type === 'walk' ? a.walkV : followLimit(a, px, pz), avoidPlayer(a, px, pz));
    }
    // tái sinh xe ra khỏi bóng + bù thiếu (rải đều theo thời gian: ≤ 12 tác tử/khung)
    let budget = 12;
    for (let i = agents.length - 1; i >= 0 && budget > 0; i--) {
      const a = agents[i];
      const lim = a.type === 'walk' ? RW + 30 : RB + 40;
      if (a.kill || Math.hypot(a.x - px, a.z - pz) > lim) {
        budget--;
        removeAgent(a);
      }
    }
    if (now - lastFill > 250) { lastFill = now; fill(px, pz, SPAWN_MIN); }
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a.lim === undefined) a.lim = a.vmax;
      a.acc = (a.acc || 0) + dt;
      const dd = Math.abs(a.x - px) + Math.abs(a.z - pz);   // khoảng cách Manhattan (rẻ, đủ để chia nhịp)
      const div = dd > 330 ? 4 : dd > 180 ? 2 : 1;
      if (div > 1 && (frameNo + i) % div) continue;
      const st = Math.min(a.acc, 0.2); a.acc = 0;
      stepAgent(a, st, px, pz);
    }
    writeInstances(px, pz);
    // thống kê cho âm thanh: mức xe gần (0..1) + số còi phát sinh
    let near = 0;
    let nb = 0, nc = 0, nw = 0;
    for (const a of agents) {
      if (a.type === 'walk') { nw++; continue; }
      if (a.type === 'bike') nb++; else nc++;
      const d = Math.hypot(a.x - px, a.z - pz);
      if (d < 70) near += (1 - d / 70) * (a.type === 'car' ? 1.6 : 1) * Math.min(1, a.v / 6 + 0.2);
    }
    stats.near = Math.min(1, near / 9);
    stats.honk = honk; honk = 0;
    stats.bikes = nb; stats.cars = nc; stats.walkers = nw;
    msEMA += (performance.now() - now - msEMA) * 0.05;   // chi phí CPU trung bình/khung (ms) — __hp.traffic.stats().ms
    stats.ms = +msEMA.toFixed(3);
    return stats;
  }

  // KIỂM BẤT BIẾN (tools/diag.mjs): xe đi bên PHẢI ở phố 2 chiều, không ngược chiều đường đôi, người đi bộ không
  // đứng trong footprint nhà thật, mọi tác tử trong vùng chơi (+biên 60 m của đồ thị).
  function check() {
    const r = { vehicles: 0, walkers: 0, wrongSide: 0, wrongWay: 0, walkInBuilding: 0, outside: 0, examples: [] };
    for (const a of agents) {
      const e = edges[a.e];
      if (Math.hypot(a.x, a.z) > PLAY_R + 70) r.outside++;
      if (a.type === 'walk') {
        r.walkers++;
        if (fp && fp.blocked(a.x, a.z)) { r.walkInBuilding++; if (r.examples.length < 6) r.examples.push(['walkInBuilding', Math.round(a.x), Math.round(a.z)]); }
        continue;
      }
      r.vehicles++;
      if (!e.oneway && a.latCur <= 0) { r.wrongSide++; if (r.examples.length < 6) r.examples.push(['wrongSide', Math.round(a.x), Math.round(a.z)]); }
      if (!dirOK(a, e, a.dir)) r.wrongWay++;
    }
    return r;
  }

  // Người chơi (đi bộ/lái xe) không xuyên qua xe đang chạy: xe máy = 1 vòng 0,55 m, ô tô = 3 vòng dọc thân.
  function pushOut(p, r = 0.45) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = hmap.get(hk(p.x + i * HC, p.z + j * HC)); if (!l) continue;
      for (const b of l) {
        const fx = Math.sin(b.h), fz = Math.cos(b.h);
        const offs = b.type === 'car' ? [-1.5, 0, 1.5] : [0];
        const rr = b.type === 'car' ? 0.95 : 0.55;
        for (const o of offs) {
          const cx = b.x + fx * o, cz = b.z + fz * o;
          const dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz), min = rr + r;
          if (d < min && d > 1e-3) { p.x = cx + (dx / d) * min; p.z = cz + (dz / d) * min; }
        }
      }
    }
  }

  console.info('[traffic] đồ thị:', nodes.length, 'nút,', edges.length, 'cạnh,', G.ms, 'ms — bóng', RB, 'm, trần', JSON.stringify(CAP));
  return {
    update, graph: G, pushOut, setEnabled, setNight, check,
    stats: () => ({ ...stats, groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.list.length])) }),
  };
}
