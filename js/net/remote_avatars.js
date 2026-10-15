// js/net/remote_avatars.js — HÌNH NGƯỜI CHƠI KHÁC trong thành phố (MP-2 C2). main.js (C1) gọi API dưới đây; module này
// KHÔNG mở mạng, KHÔNG đọc main.js, mọi lỗi tự nuốt (không bao giờ làm hỏng vòng frame).
//
//   const ra = createRemoteAvatars({ scene, world, camera, tier })
//   ra.self(myNetId)                                  // WELCOME: bỏ qua chính mình nếu máy chủ có gửi
//   ra.names([{netId, name, badge}])                  // S2C NAMES (tên giữ qua leave/enter — máy chủ chỉ gửi 1 lần/phiên)
//   ra.enter(netId, abs, appearance, serverMs?)       // SNAPSHOT ENTER: abs = {x, z, y, yaw, spd, state}, appearance 8 B
//   ra.update(netId, rec, serverMs)                   // SNAPSHOT UPDATE: rec = {x, z, y, yaw, spd, state}
//   ra.leave(netId)                                   // SNAPSHOT LEAVE (slot → netId do C1 tra)
//   ra.frame(dt, nowServerMs, camPos)                 // MỖI KHUNG, trước traffic.update (codebase_hooks §9 mục 6)
//   drawMinimap(px, pz, yaw, ra.markers())            // minimap (người lạ mặc định ẩn → [] ở GĐ1)
//   ra.stats() → {count, drawn, drawCalls, ...}; ra.dispose()
// serverMs = GIỜ MÁY CHỦ của snapshot (khuyên: createSnapClock() của js/net/interp.js: tick·50 + độ lệch đường bao dưới);
// nowServerMs = đồng hồ thật + offset (js/shared/clock.js) — KHÔNG dùng time/dt đã kẹp của vòng frame (SPEC §1.4).
//
// Vẽ (SPEC §1.1, §2 C2): SỐ DRAW CALL CỐ ĐỊNH, không phụ thuộc N — tối đa 5:
//   1 người (pedestrianGeometry, vật liệu 'traffic_walk' DÙNG CHUNG với traffic.js — cùng chương trình shader, dáng đi
//     trong vertex shader), 2 xe máy+người lái gần (motorbikeGeometry rider 'ride'), 3 xe máy xa (motorbikeFarGeometry),
//   4 bóng tiếp đất (contactShadowGeometry + kitShadowMaterial — chương trình 'hp-kit-shadow' sẵn có),
//   5 vòng sáng + bảng tên + dấu "vắng mặt" (nametags.js: 1 Mesh động, MeshBasic map — biến thể sẵn có).
// Hợp đồng instcull/freeze như traffic.js: userData.noCull, raycast = () => {}, matrixAutoUpdate = false, bounding sphere
// đặt tay quanh camera; không đổ bóng vào shadow map; 3 bộ đệm instance xoay vòng (NSET) — không ghi vào bộ đệm GPU đang vẽ.
// Trần hiển thị theo TIER: 1 (và 0) → 40, 2/3 → 96 người gần camera nhất; bảng tên 24 người gần nhất trong 25 m, mờ dần
// từ 17 m. Vòng sáng xanh mảnh dưới chân = người thật (NPC/người đi đường không có); xám + "vắng mặt" khi họ rớt mạng.
import * as THREE from 'three';
import { TIER as DEVICE_TIER } from '../device.js';
import { surfaceY as worldSurfaceY } from '../world.js';
import { pedestrianGeometry, motorbikeGeometry, motorbikeFarGeometry, kitMaterial, kitShadowMaterial, shared,
  contactShadowGeometry, OPT, optWord, BIKE_PAINT, SHIRT, JACKET } from '../models_kit.js';
import { MODE, SFLAG } from '../shared/constants.js';
import { ROAD_TOP, SIDEWALK_TOP } from '../xsection.js';
import { Track } from './interp.js';
import { createNameTags, cleanName } from './nametags.js';

// ---------------------------------------------------------------------------------------------------------------------
// NGOẠI HÌNH 8 byte (C2S /v1/auth/guest `appearance` 16 hex; máy chủ lưu nguyên, gửi trong ENTER). Byte ngẫu nhiên
// (máy chủ tự sinh khi thiếu) vẫn ra người hợp lý: mọi trường giải mã bằng modulo / ngưỡng.
//   b0 hạt giống bảng màu (da, tóc, quần, mũ bảo hiểm, khẩu trang, giày, túi — băm trong shader như traffic)
//   b1 bit 0-2 mũ: 0-4 không, 5 nón lá, 6-7 mũ lưỡi trai · bit 3 tóc dài · bit 4-5 = 0 → khẩu trang · bit 6 túi
//   b2 áo: chỉ số SHIRT ∪ JACKET   b3 sơn xe máy: BIKE_PAINT   b4 dự trữ (kiểu xe — GĐ sau)
//   b5 chiều cao 0,94–1,06          b6 bit 0 quần short · bit 1 áo dài tay   b7 phiên bản (0)
// ---------------------------------------------------------------------------------------------------------------------
const SHIRTS = [...SHIRT, ...JACKET];
export function decodeAppearance(b) {
  const g = (i) => (b && b.length > i ? b[i] | 0 : 0);
  const h = g(1) & 7;
  return {
    seed: g(0), nonla: h === 5, cap: h >= 6, hairLong: !!(g(1) & 8), mask: ((g(1) >> 4) & 3) === 0, bag: !!(g(1) & 64),
    shirt: SHIRTS[g(2) % SHIRTS.length], paint: BIKE_PAINT[g(3) % BIKE_PAINT.length], scale: 0.94 + (g(5) / 255) * 0.12,
    shorts: !!(g(6) & 1), sleeve: !!(g(6) & 2),
  };
}
// look: {seed, hat: 'none'|'nonla'|'cap', hairLong, mask, bag, shirt (chỉ số), paint (chỉ số), height 0..1, shorts, sleeve}
export function encodeAppearance(look = {}) {
  const b = new Uint8Array(8);
  b[0] = (look.seed ?? 0) & 255;
  const hat = look.hat === 'nonla' ? 5 : look.hat === 'cap' ? 6 : 0;
  b[1] = hat | (look.hairLong ? 8 : 0) | (look.mask ? 0 : 16) | (look.bag ? 64 : 0);
  b[2] = (look.shirt ?? 0) % SHIRTS.length; b[3] = (look.paint ?? 0) % BIKE_PAINT.length;
  b[5] = Math.round(Math.max(0, Math.min(1, look.height ?? 0.5)) * 255);
  b[6] = (look.shorts ? 1 : 0) | (look.sleeve ? 2 : 0);
  return b;
}
export function randomAppearanceHex(rand = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(rand() * 256).toString(16).padStart(2, '0');
  return s.slice(0, 14) + '00';   // b7 = phiên bản 0
}

const CAP_BY_TIER = (t) => (t >= 2 ? 96 : 40);
const TAG_MAX = 24, TAG_R = 25, TAG_FADE = 17, RING_R = 90;
const STRIDE = 28, SH_STRIDE = 17, NSET = 3;
const DRAW_R = 200;                 // bán kính vẽ quanh camera (AOI máy chủ 160 m + camera lùi)
const BIKE_NEAR = DEVICE_TIER >= 3 ? 50 : DEVICE_TIER === 2 ? 42 : 32, LOD_HYST = 5;   // = traffic.js NEAR_BIKE
const SEAT_HIP = 0.9 - 0.53;        // hông người kit khi NGỒI (SK.hipY 0,9 − hạ 0,53 trong kitPose)
const LOCAL_HIP = 0.86;             // main.js updateMounted: pState.pos.y = hông − 0,86
// surfaceY = NỀN (không gồm lớp mặt nhựa/vỉa hè của xsection): xe/người đặt trên mặt nhựa (+ROAD_TOP, như traffic.js);
// vòng sáng người đi bộ trên mặt VỈA HÈ + 2 cm (không bị vỉa hè che — trên lòng đường thì nổi 16 cm, chấp nhận được)
const RING_DY = SIDEWALK_TOP + 0.02;

export function createRemoteAvatars({ scene, world = null, camera, tier = DEVICE_TIER, surfaceY = null } = {}) {
  const sY = surfaceY || (world && world.surfaceY) || worldSurfaceY;
  const CAP = CAP_BY_TIER(tier);
  // cùng tham số vật liệu với traffic.js → CÙNG đối tượng vật liệu (cache kitMaterial) → 0 chương trình shader mới
  const STD = DEVICE_TIER >= 2;
  const walkMat = kitMaterial({ name: 'traffic_walk', shirts: true, walk: 'cpu', std: STD });
  const vehMat = kitMaterial({ name: 'veh', shirts: true, std: STD });
  const meshes = [];

  function makeGroup(key, geo, cap, mat, walk) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'mp_' + key;
    const sets = [];
    for (let k = 0; k < NSET; k++) {
      const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
      ib.setUsage(THREE.DynamicDrawUsage);
      const at = (size, off) => new THREE.InterleavedBufferAttribute(ib, size, off);
      sets.push({ ib, mat: at(16, 0), col: at(3, 16), sh: at(3, 19), sh2: at(3, 22), ph: at(1, 25), wk: at(1, 26), opt: at(1, 27) });
    }
    mesh.count = 0;
    mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.noCull = true; mesh.raycast = () => {};
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DRAW_R + 20);
    mesh.matrixAutoUpdate = false;
    const g = { key, mesh, geo, cap, sets, k: 0, walk, n: 0, arr: null, sh: geo.userData.shadow || [0.5, 1, 0.5] };
    bindSet(g, sets[0]);
    if (scene) scene.add(mesh);
    meshes.push(mesh);
    return g;
  }
  function bindSet(g, s) {
    g.mesh.instanceMatrix = s.mat; g.mesh.instanceColor = s.col;
    g.geo.setAttribute('aShirt', s.sh); g.geo.setAttribute('aShirt2', s.sh2); g.geo.setAttribute('aOpt', s.opt);
    if (g.walk) { g.geo.setAttribute('aPhase', s.ph); g.geo.setAttribute('aWalk', s.wk); }
  }
  const gPed = makeGroup('ped', shared('ped', pedestrianGeometry), CAP, walkMat, true);
  const gBike = makeGroup('bike', shared('ride_scooter', () => motorbikeGeometry('scooter', { rider: 'ride' })), CAP, vehMat, false);
  const gBikeFar = makeGroup('bike_far', shared('ride_far', motorbikeFarGeometry), CAP, vehMat, false);
  const groups = [gPed, gBike, gBikeFar];
  // bóng tiếp đất: 1 InstancedMesh trong suốt (cùng chương trình 'hp-kit-shadow' với giao thông)
  const shGeo = contactShadowGeometry(1, 1, 1);
  const shSets = [];
  for (let k = 0; k < NSET; k++) {
    const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(CAP * SH_STRIDE), SH_STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    shSets.push({ ib, mat: new THREE.InterleavedBufferAttribute(ib, 16, 0), a: new THREE.InterleavedBufferAttribute(ib, 1, 16) });
  }
  const shMesh = new THREE.InstancedMesh(shGeo, kitShadowMaterial(), CAP);
  shMesh.name = 'mp_shadow'; shMesh.count = 0; shMesh.castShadow = false; shMesh.receiveShadow = false;
  shMesh.userData.noCull = true; shMesh.raycast = () => {}; shMesh.matrixAutoUpdate = false;
  shMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DRAW_R + 20);
  let shK = 0;
  const shBind = (s) => { shMesh.instanceMatrix = s.mat; shGeo.setAttribute('aShA', s.a); };
  shBind(shSets[0]);
  if (scene) scene.add(shMesh);
  meshes.push(shMesh);
  const tags = createNameTags({ scene, maxTags: TAG_MAX, maxRings: CAP });
  meshes.push(tags.mesh);

  // ---------- trạng thái ----------
  const avatars = new Map();     // netId → avatar
  const names = new Map();       // netId → {name, badge}
  const friends = new Set();
  let selfId = -1, lastSnapMs = NaN, lastNow = NaN, enabled = true, markerAll = false;
  let selAt = -1e9, selFrames = 0, frameMs = 0, frameMsEma = 0;
  const list = [];               // mảng avatar (duyệt nhanh)
  const drawnList = [];
  const out = {};
  const st = { count: 0, drawn: 0, drawCalls: 0, peds: 0, bikes: 0, bikesFar: 0, tags: 0, rings: 0, cap: CAP, ms: 0, snaps: 0, extrap: 0 };

  function makeAvatar(netId, appearance) {
    const a = {
      netId, tr: new Track(), app: decodeAppearance(appearance), shirt: new THREE.Color(), paint: new THREE.Color(),
      x: 0, y: 0, z: 0, yaw: 0, mode: 0, flags: 0, v: 0, px: NaN, pz: NaN, wph: (netId * 1.618) % 6.283, wamp: 0,
      lean: 0, yawPrev: NaN, gy: 0, gx: NaN, gz: NaN, gref: NaN, far: false, d2: 0, sel: false, score: 0, pillion: null, riding: null,
    };
    setLook(a, appearance);
    return a;
  }
  function setLook(a, appearance) {
    a.app = decodeAppearance(appearance);
    a.shirt.setHex(a.app.shirt); a.paint.setHex(a.app.paint);
    const L = a.app;
    const pedBits = [];
    if (L.nonla) pedBits.push(OPT.NONLA); else if (L.cap) pedBits.push(OPT.CAP);
    if (L.mask) pedBits.push(OPT.MASK_A);
    if (L.hairLong) pedBits.push(OPT.HAIR_A);
    if (L.bag) pedBits.push(OPT.BAG);
    if (L.sleeve) pedBits.push(OPT.SLEEVE_A);
    if (L.shorts) pedBits.push(OPT.SHORTS_A);
    a.optPed = optWord(pedBits, L.seed);
    a.optSit = optWord([...pedBits, OPT.SIT], L.seed);
    const rideBits = [];
    if (L.mask) rideBits.push(OPT.MASK_A);
    if (L.hairLong) rideBits.push(OPT.HAIR_A);
    if (L.sleeve) rideBits.push(OPT.SLEEVE_A);
    if (L.shorts) rideBits.push(OPT.SHORTS_A);
    a.optRide = optWord(rideBits, L.seed);
    // bit người ngồi SAU (B) lấy từ ngoại hình của chính người ngồi sau
    const b = [OPT.PILLION];
    if (L.mask) b.push(OPT.MASK_B);
    if (L.hairLong) b.push(OPT.HAIR_B);
    if (L.sleeve) b.push(OPT.SLEEVE_B);
    if (L.shorts) b.push(OPT.SHORTS_B);
    a.pillionMask = optWord(b, 0);   // cộng thẳng vào aOpt xe người lái (bit rời với bit người A, CARGO, BASKET)
  }
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
  function pushRec(a, rec, t) {
    const r = a.tr.push(t, num(rec.x), num(rec.y, 2), num(rec.z), num(rec.yaw), Math.max(0, num(rec.spd)), (rec.state | 0) & 255);
    if (r === 1) st.snaps++;
  }
  function stampOf(serverMs) {
    if (Number.isFinite(serverMs)) { if (!(serverMs <= lastSnapMs)) lastSnapMs = serverMs; return serverMs; }
    return Number.isFinite(lastSnapMs) ? lastSnapMs : Number.isFinite(lastNow) ? lastNow : 0;
  }

  // ---------- API ----------
  function enter(netId, abs, appearance, serverMs) {
    try {
      netId |= 0;
      if (netId === selfId || !abs) return;
      let a = avatars.get(netId);
      if (!a) { a = makeAvatar(netId, appearance); avatars.set(netId, a); list.push(a); }
      else if (appearance) setLook(a, appearance);   // keyframe / resume: ENTER lại cùng netId → giữ quỹ đạo (không nháy)
      pushRec(a, abs, stampOf(serverMs));
    } catch (e) { /* không bao giờ ném ra vòng mạng */ }
  }
  function update(netId, rec, serverMs) {
    try {
      const a = avatars.get(netId | 0);
      if (!a || !rec) return;
      pushRec(a, rec, stampOf(serverMs));
    } catch (e) { }
  }
  function leave(netId) {
    try {
      const a = avatars.get(netId | 0);
      if (!a) return;
      avatars.delete(netId | 0);
      const i = list.indexOf(a); if (i >= 0) list.splice(i, 1);
      if (a.riding) a.riding.pillion = null;
      if (a.pillion) a.pillion.riding = null;
    } catch (e) { }
  }
  function namesFn(arr) {
    try {
      for (const e of arr || []) {
        if (!e) continue;
        const id = e.netId | 0, nm = cleanName(e.name), badge = e.badge | 0;
        const old = names.get(id);
        if (old && (old.name !== nm || old.badge !== badge)) tags.forget(id);
        names.set(id, { name: nm, badge });
      }
      if (names.size > 4096) {   // giới hạn bộ nhớ: bỏ tên của netId không còn trong AOI
        for (const id of names.keys()) { if (names.size <= 2048) break; if (!avatars.has(id)) names.delete(id); }
      }
    } catch (e) { }
  }
  function self(netId) { selfId = netId | 0; if (avatars.has(selfId)) leave(selfId); }
  // KEYFRAME (tuỳ chọn cho C1): giữ đúng tập netId có trong keyframe, bỏ phần còn lại
  function keep(netIds) {
    const s = new Set(); for (const id of netIds || []) s.add(id | 0);
    for (const a of list.slice()) if (!s.has(a.netId)) leave(a.netId);
  }

  // ---------- mỗi khung ----------
  const _cam = new THREE.Vector3();
  function frame(dt, nowServerMs, camPos) {
    const t0 = performance.now();
    try {
      if (!enabled) return st;
      dt = Math.min(Math.max(num(dt, 0.016), 0), 0.1);
      const now = Number.isFinite(nowServerMs) ? nowServerMs : (Number.isFinite(lastNow) ? lastNow + dt * 1000 : (Number.isFinite(lastSnapMs) ? lastSnapMs : 0));
      lastNow = now;
      if (camPos) _cam.copy(camPos); else if (camera) _cam.copy(camera.position);
      const cx = _cam.x, cz = _cam.z;
      // 1) nội suy + dẫn xuất (tốc độ hiển thị, nghiêng xe, cao độ mặt đất/mặt cầu)
      let nEx = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        a.tr.sample(now, out);
        const snapped = out.snapped;
        a.mode = out.state & 7; a.flags = (out.state >> 3) & 31;
        if (out.extrap > 0) nEx++;
        if (snapped || !(a.px === a.px)) { a.v = out.spd; a.yawPrev = out.yaw; a.lean = 0; }
        else {
          const dv = Math.hypot(out.x - a.px, out.z - a.pz) / Math.max(dt, 1e-3);
          a.v += (Math.min(dv, 40) - a.v) * Math.min(1, dt * 10);
        }
        a.px = out.x; a.pz = out.z;
        a.x = out.x; a.z = out.z; a.yaw = out.yaw; a.yRec = out.y;
        // cao độ: mặt nền dưới chân theo tầng (mặt cầu ≤ yRef + 1,2 m — world.surfaceY), tra lại khi đi > 0,25 m
        const yRef = a.mode === MODE.MOTO || a.mode === MODE.PILLION ? out.y + 0.3 : out.y;
        if (!(Math.abs(a.x - a.gx) + Math.abs(a.z - a.gz) < 0.25) || Math.abs(yRef - a.gref) > 0.5) {
          a.gx = a.x; a.gz = a.z; a.gref = yRef;
          let gy = NaN;
          try { gy = sY(a.x, a.z, yRef); } catch (e) { }
          a.gy = Number.isFinite(gy) ? gy : out.y;
        }
        // nghiêng xe khi vào cua: atan(v·ω/g) (như traffic.js), êm dần
        if (a.mode === MODE.MOTO || a.mode === MODE.CYCLO) {
          const om = (a.yawPrev === a.yawPrev ? wrapPI(a.yaw - a.yawPrev) : 0) / Math.max(dt, 1e-3);
          const lt = -Math.max(-0.45, Math.min(0.45, Math.atan((a.v * om) / 9.8)));
          a.lean += (lt - a.lean) * Math.min(1, dt * 5);
        } else a.lean = 0;
        a.yawPrev = a.yaw;
        const dx = a.x - cx, dz = a.z - cz;
        a.d2 = dx * dx + dz * dz;
        a.pillion = null; a.riding = null;
      }
      st.extrap = nEx;
      // 2) chọn ai được vẽ: trần theo TIER, gần camera nhất (đang vẽ được ưu tiên 0,8 — không đổi qua lại), 10 Hz
      if (t0 - selAt > 100 || ++selFrames >= 6 || list.length <= CAP) {   // ~10 Hz (thời gian thật HOẶC 6 khung)
        selAt = t0; selFrames = 0;
        const R2 = DRAW_R * DRAW_R;
        if (list.length <= CAP) for (const a of list) a.sel = a.d2 <= R2;
        else {
          for (const a of list) a.score = a.d2 > R2 ? Infinity : a.sel ? a.d2 * 0.64 : a.d2;
          const s = list.slice().sort((p, q) => p.score - q.score);
          for (let i = 0; i < s.length; i++) s[i].sel = i < CAP && s[i].score < Infinity;
        }
      }
      // 3) người ngồi sau: gắn vào người lái xe máy gần nhất trong 3 m → bật bit PILLION trên xe đó
      for (const p of list) {
        if (!p.sel || p.mode !== MODE.PILLION) continue;
        let best = null, bd = 9;
        for (const d of list) {
          if (d === p || !d.sel || d.mode !== MODE.MOTO || d.pillion) continue;
          const q = (d.x - p.x) ** 2 + (d.z - p.z) ** 2;
          if (q < bd) { bd = q; best = d; }
        }
        if (best) { best.pillion = p; p.riding = best; }
      }
      // 4) ghi instance + bóng + vòng sáng + bảng tên
      for (const g of groups) { g.k = (g.k + 1) % NSET; g.n = 0; g.arr = g.sets[g.k].ib.array; }
      shK = (shK + 1) % NSET;
      const sa = shSets[shK].ib.array;
      let ns = 0;
      tags.begin(camera);
      drawnList.length = 0;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.sel) continue;
        drawnList.push(a);
        const away = !!(a.flags & SFLAG.AWAY);
        if (a.riding) {   // thân người ngồi sau nằm trong mô hình xe của người lái
          a.yDraw = a.riding.yDraw ?? a.gy; a.headY = a.gy + 1.75;
          continue;
        }
        let g, opt, sx = 1, py = a.gy + ROAD_TOP, sh2 = a.shirt, walk = false;
        const m = a.mode;
        if (m === MODE.MOTO || m === MODE.CYCLO) {
          const lim = BIKE_NEAR - (a.far ? LOD_HYST : 0);
          a.far = a.d2 > lim * lim;
          g = a.far ? gBikeFar : gBike;
          opt = a.optRide + (a.flags & SFLAG.CARGO ? 1 << OPT.CARGO : 0)
            + (m === MODE.CYCLO ? 1 << OPT.BASKET : 0);   // GĐ1: xích lô vẽ tạm bằng xe máy (+giỏ) — KNOWLEDGE §8c
          if (a.pillion) { opt += a.pillion.pillionMask; sh2 = a.pillion.shirt; }
          a.headY = py + 1.75;
        } else {
          g = gPed; sx = a.app.scale;
          const sit = m === MODE.SIT || m === MODE.BOAT || m === MODE.PILLION;
          opt = sit ? a.optSit : a.optPed;
          if (m === MODE.AIR) py = Math.max(a.gy + ROAD_TOP, a.yRec);
          else if (m === MODE.BOAT || m === MODE.PILLION) py = a.yRec + LOCAL_HIP - SEAT_HIP;   // hông lên ghế (thuyền: mặt nước + ghế)
          else if (m === MODE.SIT) py = a.gy + ROAD_TOP;
          walk = !sit;
          a.headY = py + (sit ? 1.25 : 1.72) * sx;
        }
        a.yDraw = py;
        if (g.n >= g.cap) continue;
        // pha bước: chu kỳ 2 bước dài 1,4 m khi đi, tới ~2,8 m khi chạy 7 m/s; biên độ êm theo tốc độ
        if (walk) {
          const L = 1.4 + 0.25 * Math.max(0, a.v - 1.5);
          a.wph = (a.wph + dt * (a.v > 0.05 ? (6.2832 * a.v) / (L * sx) : 0)) % 6.2832;
          const wt = Math.min(1, Math.max(0, (a.v - 0.05) / 0.55));
          a.wamp += (wt - a.wamp) * Math.min(1, dt * 6);
        } else a.wamp = 0;
        const arr = g.arr, o = g.n * STRIDE;
        const ch = Math.cos(a.yaw), shh = Math.sin(a.yaw), cl = Math.cos(a.lean), sl = Math.sin(a.lean);
        arr[o] = ch * cl * sx; arr[o + 1] = sl * sx; arr[o + 2] = -shh * cl * sx; arr[o + 3] = 0;
        arr[o + 4] = -ch * sl * sx; arr[o + 5] = cl * sx; arr[o + 6] = shh * sl * sx; arr[o + 7] = 0;
        arr[o + 8] = shh * sx; arr[o + 9] = 0; arr[o + 10] = ch * sx; arr[o + 11] = 0;
        arr[o + 12] = a.x; arr[o + 13] = py; arr[o + 14] = a.z; arr[o + 15] = 1;
        const pc = g === gPed ? a.shirt : a.paint;
        arr[o + 16] = pc.r; arr[o + 17] = pc.g; arr[o + 18] = pc.b;
        arr[o + 19] = a.shirt.r; arr[o + 20] = a.shirt.g; arr[o + 21] = a.shirt.b;
        arr[o + 22] = sh2.r; arr[o + 23] = sh2.g; arr[o + 24] = sh2.b;
        arr[o + 25] = walk ? a.wph : 0; arr[o + 26] = walk ? a.wamp : 0; arr[o + 27] = opt;
        g.n++;
        // bóng tiếp đất (mặt nền, không theo độ cao nhảy/ghế thuyền)
        if (m !== MODE.BOAT && ns < CAP) {
          const shp = g === gPed ? gPed.sh : gBike.sh, ks = g === gPed ? sx : 1, rx = shp[0] * ks, rz = shp[1] * ks, q = ns * SH_STRIDE;
          sa[q] = ch * rx; sa[q + 1] = 0; sa[q + 2] = -shh * rx; sa[q + 3] = 0;
          sa[q + 4] = 0; sa[q + 5] = 1; sa[q + 6] = 0; sa[q + 7] = 0;
          sa[q + 8] = shh * rz; sa[q + 9] = 0; sa[q + 10] = ch * rz; sa[q + 11] = 0;
          sa[q + 12] = a.x; sa[q + 13] = a.gy + (g === gPed ? RING_DY - 0.02 : ROAD_TOP); sa[q + 14] = a.z; sa[q + 15] = 1;
          sa[q + 16] = shp[2] * (m === MODE.AIR ? 0.6 : 1);
          ns++;
        }
      }
      // vòng sáng (≤ 90 m) + bảng tên (24 gần nhất trong 25 m có tên)
      let nTagCand = 0;
      for (const a of drawnList) {
        if (a.d2 > RING_R * RING_R || a.riding) continue;
        const away = !!(a.flags & SFLAG.AWAY), bike = a.mode === MODE.MOTO || a.mode === MODE.CYCLO;
        tags.ring(a.x, a.gy + (bike ? ROAD_TOP + 0.03 : RING_DY), a.z, a.yaw, bike ? 1.25 : 0.95 * a.app.scale, bike ? 2.35 : 0.95 * a.app.scale, away);
        if (a.d2 <= TAG_R * TAG_R && names.has(a.netId)) nTagCand++;
      }
      st.tags = 0;
      if (nTagCand) {
        const cand = [];
        for (const a of drawnList) if (a.d2 <= TAG_R * TAG_R && names.has(a.netId)) cand.push(a);
        if (cand.length > TAG_MAX) cand.sort((p, q) => p.d2 - q.d2);
        const cy = camera ? camera.position.y : 0;
        for (let i = 0; i < cand.length && i < TAG_MAX; i++) {
          const a = cand[i], nm = names.get(a.netId);
          const d = Math.sqrt(a.d2 + (a.headY - cy) ** 2);
          if (tags.tag(a.netId, nm.name, nm.badge, a.x, a.headY + 0.22, a.z, d, !!(a.flags & SFLAG.AWAY), TAG_FADE, TAG_R)) st.tags++;
        }
      }
      tags.end();
      // 5) tải dữ liệu instance (1 lần/nhóm/khung, chỉ phần đã ghi)
      let calls = 0, nDrawn = 0;
      for (const g of groups) {
        const s = g.sets[g.k];
        g.mesh.count = g.n;
        g.mesh.visible = g.n > 0;
        g.mesh.boundingSphere.center.set(cx, 2, cz);
        if (!g.n) continue;
        bindSet(g, s);
        s.ib.clearUpdateRanges(); s.ib.addUpdateRange(0, g.n * STRIDE); s.ib.needsUpdate = true;
        calls++; nDrawn += g.n;
      }
      shMesh.count = ns; shMesh.visible = ns > 0;
      shMesh.boundingSphere.center.set(cx, 2, cz);
      if (ns) {
        const ss = shSets[shK];
        shBind(ss);
        ss.ib.clearUpdateRanges(); ss.ib.addUpdateRange(0, ns * SH_STRIDE); ss.ib.needsUpdate = true;
        calls++;
      }
      if (tags.mesh.visible) calls++;
      st.count = list.length; st.drawn = drawnList.length; st.drawCalls = calls;
      st.peds = gPed.n; st.bikes = gBike.n; st.bikesFar = gBikeFar.n; st.rings = tags.stats().rings;
    } catch (e) {
      st.errors = (st.errors || 0) + 1; st.lastError = String(e && e.message || e).slice(0, 200);
      if (!frame._warned) { frame._warned = true; console.warn('[remote_avatars] frame lỗi (bỏ qua):', e); }
    } finally {
      frameMs = performance.now() - t0;
      frameMsEma += (frameMs - frameMsEma) * 0.05;
      st.ms = +frameMsEma.toFixed(3);
    }
    return st;
  }

  function markers(opts) {
    const all = (opts && opts.all) || markerAll, res = [];
    for (const a of list) {
      const f = friends.has(a.netId);
      if (f || all) res.push({ x: a.x, z: a.z, kind: f ? 'friend' : 'player', away: !!(a.flags & SFLAG.AWAY) });
    }
    return res;
  }
  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) for (const m of meshes) m.visible = false;   // bật lại: frame() tự đặt visible theo số instance
  }
  function dispose() {
    try {
      for (const m of meshes) if (m.parent) m.parent.remove(m);
      // KHÔNG geometry.dispose() hình kit: bản NÔNG dùng chung index/position với traffic.js (models_kit shared()) —
      // dispose sẽ xoá bộ đệm GPU của giao thông. Chỉ trả bộ đệm instance (InstancedMesh.dispose) + đồ của riêng mình.
      for (const g of groups) g.mesh.dispose();
      shMesh.dispose(); shGeo.dispose();
      tags.dispose();
      avatars.clear(); list.length = 0; drawnList.length = 0; names.clear();
    } catch (e) { }
  }

  return {
    enter, update, leave, names: namesFn, self, frame, markers, dispose, keep,
    stats: () => ({ ...st, tagAtlas: tags.stats() }),
    setFriends(ids) { friends.clear(); for (const id of ids || []) friends.add(id | 0); },
    setMarkerAll(on) { markerAll = !!on; },
    setEnabled,
    // chẩn đoán / QA (tools/qa/mp_c2_avatars.mjs)
    debug(netId) {
      const a = avatars.get(netId | 0);
      return a ? { x: a.x, y: a.yDraw, z: a.z, gy: a.gy, yaw: a.yaw, mode: a.mode, flags: a.flags, v: a.v, lean: a.lean, sel: a.sel,
        far: a.far, delay: a.tr.delay, n: a.tr.size, snaps: a.tr.nSnap, holds: a.tr.nHold } : null;
    },
    meshes, tags,
  };
}

function wrapPI(a) { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; }
