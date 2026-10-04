import * as THREE from 'three';
import { ROADS_DT } from './terrain.js';
import { TIER } from './device.js';
import { SIDEWALK_W, ROAD_TOP, SIDEWALK_TOP } from './xsection.js';
import { buildRoadGraph, edgePoint } from './roadgraph.js';
import { motorbikeGeometry, motorbikeFarGeometry, carGeometry, carFarGeometry, CAR_FAR_SCALE, pedestrianGeometry, kitMaterial, kitShadowMaterial, shared,
  contactShadowGeometry, KIT_U, OPT, optWord, BIKE_PAINT, CAR_PAINT, TAXI_PAINT, SHIRT, JACKET } from './models_kit.js';

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
//  - vẽ INSTANCED bằng BỘ MÔ HÌNH CHUNG js/models_kit.js (W2-C): 3 kiểu xe máy (ga nhỏ / xe số / ga lớn — người lái
//    + người ngồi sau / hàng chở là PHỤ KIỆN bật theo bit instance) + 6 kiểu ô tô (con / hatchback / gầm cao / MPV /
//    16 chỗ / tải nhỏ; taxi = hộp đèn bật theo bit) + 1 người đi bộ (nón lá / mũ / tóc dài / khẩu trang / túi theo bit),
//    LOD XA (> 55-95 m) 1 xe máy + 1 ô tô thu gọn, 1 mesh BÓNG TIẾP ĐẤT chung = 13 draw call cho cả thành phố (không
//    đổ bóng vào bản đồ bóng); dáng đi (gập gối, tay đánh) bằng vertex shader; chân trên SIDEWALK_TOP (xsection).
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
// kiểu xe theo tỉ lệ pano HP (xe ga ≈ xe số, ô tô con/hatchback chiếm đa số, nhiều xe 16 chỗ/tải nhỏ trong phố)
const BIKE_KINDS = [['scooter', 0.45], ['underbone', 0.4], ['bigscooter', 0.15]];
const CAR_KINDS = [['sedan', 0.27], ['hatch', 0.2], ['suv', 0.19], ['mpv', 0.13], ['van', 0.12], ['truck', 0.09]];
const WALK_KINDS = [['ped', 1]];
// LOD: gần hơn NEAR_* m vẽ mô hình đủ (xe máy+người ≈ 1,1-1,5k tam giác, ô tô ≈ 1,9k); xa hơn: mô hình thu gọn
// (xe máy+người ≈ 0,27k, ô tô ≈ 0,28k chung mọi kiểu — scale instance theo kích thước kiểu)
const NEAR_BIKE = TIER >= 3 ? 50 : TIER === 2 ? 42 : 32, NEAR_CAR = TIER >= 3 ? 70 : TIER === 2 ? 58 : 45;

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

  // ---------- Ô TÔ ĐỖ mép đường (js/props.js → world.props.parkedCars, tâm ở curbLine − 0,95; phố r curbLine − 0,05) ----------
  // Đợt 3 wave 2 (W2-F): xe chạy từng xuyên qua xe đỗ (xe máy tới hw − 0,55, ô tô hw − 1,1 ⇒ trùng dải đỗ hw − 0,05…hw − 1,85).
  // Mỗi xe đỗ chiếu lên cạnh đồ thị có tim gần nhất: đoạn [u0,u1] (quãng theo chiều a→b, ±2,5 m quá đầu/đuôi xe để kịp lách)
  // + phía σ (+1 = bên phải chiều a→b) + MÉP TRONG (|lệch tâm| − nửa rộng 0,9). Tác tử đi qua đoạn đó ở phía đó: |lat| ≤
  // mép trong − nửa rộng xe chạy − 0,3 (trượt ngang mượt a.pk, xem parkShift). Gộp các đoạn chồng nhau (giữ mép trong nhỏ nhất).
  const PARK_HALF = { bike: 0.45, car: 0.95 };
  const parkStats = { cars: 0, mapped: 0, edges: 0, spans: 0 };
  (function indexParked(list) {
    if (!list || !list.length) return;
    const CELL = 24, sh = new Map(), key = (i, j) => (i + 4096) * 8192 + (j + 4096);
    edges.forEach((e, ei) => {
      for (let k = 0; k < e.xs.length - 1; k++) {
        const x0 = Math.min(e.xs[k], e.xs[k + 1]) - 8, x1 = Math.max(e.xs[k], e.xs[k + 1]) + 8;
        const z0 = Math.min(e.zs[k], e.zs[k + 1]) - 8, z1 = Math.max(e.zs[k], e.zs[k + 1]) + 8;
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
          const kk = key(i, j); let a = sh.get(kk); if (!a) sh.set(kk, (a = [])); a.push(ei, k);
        }
      }
    });
    const per = new Map();
    for (const c of list) {
      parkStats.cars++;
      const a = sh.get(key(Math.floor(c.x / CELL), Math.floor(c.z / CELL))); if (!a) continue;
      let best = null, bd = 1e9;
      for (let q = 0; q < a.length; q += 2) {
        const e = edges[a[q]], k = a[q + 1];
        const ax = e.xs[k], az = e.zs[k], dx = e.xs[k + 1] - ax, dz = e.zs[k + 1] - az, L = Math.hypot(dx, dz) || 1e-6;
        const t = Math.max(0, Math.min(1, ((c.x - ax) * dx + (c.z - az) * dz) / (L * L)));
        const px = ax + dx * t, pz = az + dz * t;
        const lat = (c.x - px) * (-dz / L) + (c.z - pz) * (dx / L);   // dương = phải chiều a→b
        const d = Math.abs(lat);
        if (d > e.hw + 1.2 || d < e.hw - 2.6) continue;                  // tâm xe đỗ phải nằm ở dải sát bó vỉa
        if (Math.hypot(c.x - px, c.z - pz) - d > 0.5) continue;          // chiếu rơi ra ngoài đầu đoạn
        const sc = Math.abs(d - (e.hw - 0.6));                            // tim gần mép bó vỉa của CHÍNH cạnh này nhất
        if (sc < bd) { bd = sc; best = { ei: a[q], u: e.cum[k] + t * L, sg: lat > 0 ? 1 : -1, inner: d - 0.9 }; }
      }
      if (!best) continue;
      parkStats.mapped++;
      const half = (c.len || 4.4) / 2 + 2.5;
      let arr = per.get(best.ei); if (!arr) per.set(best.ei, (arr = []));
      arr.push([best.sg, best.u - half, best.u + half, best.inner]);
    }
    for (const [ei, arr] of per) {
      arr.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const m = [];
      for (const s of arr) {
        const l = m[m.length - 1];
        if (l && l[0] === s[0] && s[1] <= l[2]) { l[2] = Math.max(l[2], s[2]); l[3] = Math.min(l[3], s[3]); } else m.push(s.slice());
      }
      edges[ei].park = m; parkStats.edges++; parkStats.spans += m.length;
    }
  })(world.props && world.props.parkedCars);
  // độ lệch ngang mục tiêu (hệ tác tử: dương = phải hướng đi) để không đè xe đỗ trong cửa sổ [s, s+look] phía trước
  function parkShift(a, e, lat) {
    if (!e.park || a.type === 'walk' || Math.abs(lat) < 0.05) return 0;
    const sgA = (a.dir ? -1 : 1) * (lat > 0 ? 1 : -1);                 // phía (theo a→b) mà tác tử đang lệch về
    const look = Math.max(5, a.v * 1.4);                               // bắt đầu lách ~1,4 s trước (trượt ngang ≤ 1,6 m/s)
    const u0 = a.dir ? e.L - a.s - look : a.s, u1 = a.dir ? e.L - a.s : a.s + look;
    let inner = 1e9;
    for (const p of e.park) if (p[0] === sgA && p[1] < u1 && p[2] > u0 && p[3] < inner) inner = p[3];
    if (inner > 1e8) return 0;
    let cap = inner - PARK_HALF[a.type] - 0.3;
    if (!e.oneway) cap = Math.max(cap, 0.35);                          // phố 2 chiều: không bị đẩy qua tim đường
    else cap = Math.max(cap, 0);
    const al = Math.abs(lat);
    return al > cap ? (lat > 0 ? cap - al : al - cap) : 0;
  }

  // ---------- Mesh instanced ----------
  const STD = TIER >= 2;   // MeshStandard (sơn bóng + kính phản chiếu trời) từ TIER 2; LITE: Lambert
  const vehMat = kitMaterial({ name: 'veh', shirts: true, std: STD }), walkMat = kitMaterial({ name: 'traffic_walk', shirts: true, walk: 'cpu', std: STD });
  const groups = {};   // kind → {mesh, cap, list:[agents], sets, n (ô đang ghi khung này)}
  // DỮ LIỆU THEO INSTANCE: 1 bộ đệm XEN KẼ (stride 28: ma trận 16 | sơn 3 | áo A 3 | áo B 3 | pha 1 | nhịp bước 1
  // | aOpt 1 = bit phụ kiện + hạt giống màu) × 3 BẢN XOAY VÒNG mỗi khung. Lý do (đo 2026-10-04, Radeon 890M, ANGLE d3d11): ghi đè mỗi khung vào CHÍNH
  // bộ đệm GPU còn đang vẽ khung trước bắt trình điều khiển ĐỒNG BỘ CPU↔GPU → mất 5-9 fps khi bật giao thông, dù
  // update() chỉ tốn 0,5 ms và giao thông chỉ +0,15 M tam giác ("đóng băng" giao thông = như tắt). Ghi vào bản
  // khung N−2 thì GPU đã đọc xong → hết chờ (thử nghiệm: hồi lại 70-90% số fps mất). 1 lần tải/nhóm/khung thay vì 2-6.
  const STRIDE = 28, NSET = 3;   // đo 2/3/5 bản: khác biệt nằm trong nhiễu đo → 3 (an toàn khi GPU trễ 2 khung)
  function makeGroup(key, geo, cap, mat, walk) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.name = 'traffic_' + key;
    const sets = [];
    for (let k = 0; k < NSET; k++) {
      const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * STRIDE), STRIDE, 1);
      ib.setUsage(THREE.DynamicDrawUsage);
      const at = (size, off) => new THREE.InterleavedBufferAttribute(ib, size, off);
      sets.push({ ib, mat: at(16, 0), col: at(3, 16), sh: at(3, 19), sh2: at(3, 22), ph: at(1, 25), wk: at(1, 26), opt: at(1, 27) });
    }
    mesh.count = 0;
    // KHÔNG đổ bóng vào bản đồ bóng: main.js chỉ làm mới bóng 4,5-10 Hz (mỗi lần +~20 ms trên 890M) → bóng thật của xe
    // 10 m/s nhảy từng bước ~2 m, tách khỏi xe. Thay bằng elip bóng tiếp đất mềm (smesh bên dưới).
    // Vẫn NHẬN bóng (xe chạy vào bóng cây/nhà tối đi).
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.noCull = true;      // instcull: KHÔNG nén (ma trận đổi mỗi khung)
    mesh.raycast = () => {};          // instanceMatrix xen kẽ không có .array — và tia chọn (__hp.pick…) không cần xe chạy
    // frustum cull theo ĐĨA VẼ (r160: InstancedMesh.boundingSphere tính 1 lần từ ma trận lúc đầu rồi cũ mãi)
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DRAW_R + 12);
    mesh.matrixAutoUpdate = false;    // gốc tĩnh ở (0,0,0); chỉ dữ liệu instance đổi
    const g = { key, mesh, geo, cap, list: [], sets, k: 0, walk, n: 0, sh: geo.userData.shadow || [0.5, 1, 0.5] };
    bindSet(g, sets[0]);
    scene.add(mesh);
    groups[key] = g;
  }
  function bindSet(g, s) {
    g.mesh.instanceMatrix = s.mat; g.mesh.instanceColor = s.col;
    g.geo.setAttribute('aShirt', s.sh); g.geo.setAttribute('aShirt2', s.sh2); g.geo.setAttribute('aOpt', s.opt);
    if (g.walk) { g.geo.setAttribute('aPhase', s.ph); g.geo.setAttribute('aWalk', s.wk); }
  }
  for (const [k, w] of BIKE_KINDS) makeGroup('bike_' + k, shared('ride_' + k, () => motorbikeGeometry(k, { rider: 'ride' })), Math.ceil(CAP.bike * Math.min(1, w * 1.6)), vehMat, false);
  for (const [k, w] of CAR_KINDS) makeGroup('car_' + k, shared('car_' + k, () => carGeometry(k)), Math.ceil(CAP.car * Math.min(1, w * 1.8)), vehMat, false);
  makeGroup('walk_ped', shared('ped', pedestrianGeometry), CAP.walk, walkMat, true);
  // LOD xa: CHUNG cho mọi kiểu xe máy / ô tô (tác tử ghi vào nhóm gần HOẶC nhóm xa theo khoảng cách mỗi khung)
  makeGroup('bike_far', shared('ride_far', motorbikeFarGeometry), CAP.bike, vehMat, false);
  makeGroup('car_far', shared('car_far', carFarGeometry), CAP.car, vehMat, false);
  // BÓNG TIẾP ĐẤT mềm: MỘT InstancedMesh trong suốt cho mọi tác tử (trước: 8 mesh bóng, mỗi nhóm 1) — đĩa đơn vị,
  // ma trận instance mang sẵn scale (rx, 1, rz) theo kiểu + độ đậm aShA; bộ đệm xen kẽ riêng (stride 17) × 3 bản xoay vòng.
  const SH_STRIDE = 17, SH_CAP = CAP.bike + CAP.car + CAP.walk;
  const shGeo = contactShadowGeometry(1, 1, 1);
  const shSets = [];
  for (let k = 0; k < NSET; k++) {
    const ib = new THREE.InstancedInterleavedBuffer(new Float32Array(SH_CAP * SH_STRIDE), SH_STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    shSets.push({ ib, mat: new THREE.InterleavedBufferAttribute(ib, 16, 0), a: new THREE.InterleavedBufferAttribute(ib, 1, 16) });
  }
  const shMesh = new THREE.InstancedMesh(shGeo, kitShadowMaterial(), SH_CAP);
  shMesh.name = 'traffic_shadow'; shMesh.count = 0; shMesh.castShadow = false; shMesh.receiveShadow = false;
  shMesh.userData.noCull = true; shMesh.raycast = () => {}; shMesh.matrixAutoUpdate = false;
  shMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), DRAW_R + 12);
  let shK = 0;
  const shBind = (s) => { shMesh.instanceMatrix = s.mat; shGeo.setAttribute('aShA', s.a); };
  shBind(shSets[0]);
  scene.add(shMesh);

  // ---------- Tác tử ----------
  const agents = [];   // {type:'bike'|'car'|'walk', grp, e, dir, s, lat, vmax, v, prev, next, ...}
  const _p = { x: 0, z: 0, tx: 0, tz: 1 }, _q = { x: 0, z: 0, tx: 0, tz: 1 };

  const rightOf = (o) => [-o.tz, o.tx];
  // lệch ngang (dương = bên phải hướng đi) theo loại + cấp phố
  // đường đôi một chiều (roadgraph e.oneway): người đi bộ chỉ ở vỉa hè PHÍA NGOÀI (−e.partner theo chiều a→b)
  // latFor(a, e): lệch cho CẠNH HIỆN TẠI (đi theo a.dir; đường đôi → chốt a.side = vỉa ngoài). Cạnh SẮP TỚI (đoạn bo
  // cua trong place): truyền side/dir của a.next — không ghi đè a.side (trước: tính vỉa ngoài của cạnh mới bằng a.dir
  // của cạnh cũ rồi ghi vào a.side).
  const outerSide = (dir, e) => (dir === 0 ? 1 : -1) * -e.partner;
  function latFor(a, e, side = 0, dir = -1) {
    const hw = e.hw;
    if (a.type === 'walk') {
      let sd = side || a.side;
      if (e.oneway) { sd = outerSide(dir < 0 ? a.dir : dir, e); if (dir < 0) a.side = sd; }
      const sw = SIDEWALK_W[e.c] || 1.2;
      return sd * (hw + Math.max(0.6, sw * a.lat01));
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
      else {
        // người đi bộ giữ MÉP VỈA đang đi: rẽ về phía vỉa của mình (side) không phải băng qua lòng đường; rẽ về phía
        // kia = băng chéo qua giữa ngã tư (trước: mọi lượt rẽ, người đi bộ cắt chéo lòng đường trong đoạn bo 3,5 m)
        const turn = -_p.tz * _q.tx + _p.tx * _q.tz;             // > 0: rẽ phải
        if (turn * a.side < -0.5) w *= 0.12;
      }
      cands.push([ref, w, cos]); tot += w;
    }
    if (!cands.length) {
      // ngõ cụt: quay đầu — trừ khi đang ở đường đôi một chiều (quay đầu = đi ngược chiều) → cho biến mất, tái sinh chỗ khác
      // người đi bộ quay đầu: đổi bên (side) để vẫn ở CÙNG vỉa hè vật lý, không băng sang vỉa đối diện
      if (dirOK(a, e, a.dir ^ 1)) return { e: a.e, dir: a.dir ^ 1, cos: -1, side: a.type === 'walk' ? -a.side : 0 };
      a.kill = true; return { e: a.e, dir: a.dir, cos: 1 };
    }
    let r = rnd() * tot;
    for (const c of cands) { r -= c[1]; if (r <= 0) { best = c; break; } }
    if (!best) best = cands[cands.length - 1];
    return { e: best[0] >> 1, dir: best[0] & 1, cos: best[2], side: 0 };
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
    const lat = a.latCur + a.pk;                                       // pk: lách xe đỗ (parkShift)
    const Rb = a.rb;
    if (a.next && a.s > e.L - Rb) {
      const u = a.s - e.L;   // âm trước nút
      const en = edges[a.next.e];
      offsetPoint(e, a.dir, a.s, lat, _A);
      // + a.pk: sau nút pk vẫn mang sang cạnh mới (prevLat = latCur+pk, lat mới = latFor+pk) — thiếu nó ở đây thì đúng
      // lúc qua nút vị trí nhảy ngang 0,5·pk trong 1 khung (phản biện W2-F)
      offsetPoint(en, a.next.dir, u, latFor(a, en, a.next.side, a.next.dir) + a.pk, _B);
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
      a.prev = null; a.next = null; a.rb = 6; a.prevRb = 0; a.pk = 0;
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
      a.blockedT = 0; a.checkAt = 0; a.ghostT = 0; a.waitT = 0; a.avoid = 0; a.avT = 0; a.pk = 0;
      return true;
    }
    return false;
  }
  function newAgent(type) {
    const grp = groupFor(type);
    if (grp.list.length >= grp.cap) return null;
    const a = { type, grp, kind: grp.key.slice(grp.key.indexOf('_') + 1), pk: 0 };   // pk: độ lệch ngang lách xe đỗ (W2-F, place() cộng vào latCur)
    // phụ kiện + màu theo tỉ lệ pano HP: ~30% xe chở 2, ~10% chở hàng, khẩu trang ~35%, nữ (tóc dài) ~45% — nữ
    // đi xe thường mặc áo chống nắng dài tay; người ngồi sau CHỈ có bit B khi có PILLION (cổng B không lồng nhau)
    const bits = [];
    const female = rnd() < 0.45, female2 = rnd() < 0.55;
    let top = pick(SHIRT), top2 = pick(SHIRT);
    if (type === 'bike') {
      const r = rnd();
      if (r < 0.3) bits.push(OPT.PILLION); else if (r < 0.4) bits.push(OPT.CARGO);
      if (rnd() < 0.35) bits.push(OPT.MASK_A);
      if (female) { bits.push(OPT.HAIR_A); if (rnd() < 0.65) { bits.push(OPT.SLEEVE_A); top = pick(JACKET); } } else if (rnd() < 0.15) bits.push(OPT.SHORTS_A);
      else if (rnd() < 0.2) bits.push(OPT.SLEEVE_A);
      if (r < 0.3) {
        if (rnd() < 0.3) bits.push(OPT.MASK_B);
        if (female2) { bits.push(OPT.HAIR_B); if (rnd() < 0.5) { bits.push(OPT.SLEEVE_B); top2 = pick(JACKET); } }
      }
      a.paint = new THREE.Color(pick(BIKE_PAINT));
    } else if (type === 'car') {
      const taxi = (a.kind === 'sedan' || a.kind === 'hatch') && rnd() < 0.28;
      if (taxi) bits.push(OPT.TAXI);
      if ((a.kind === 'suv' || a.kind === 'mpv') && rnd() < 0.3) bits.push(OPT.RACK);
      a.paint = new THREE.Color(taxi ? pick(TAXI_PAINT) : pick(CAR_PAINT));
    } else {
      const r = rnd();
      if (r < 0.12) bits.push(OPT.NONLA); else if (r < 0.24) bits.push(OPT.CAP);
      if (female) bits.push(OPT.HAIR_A); else if (rnd() < 0.18) bits.push(OPT.SHORTS_A);
      if (rnd() < 0.2) bits.push(OPT.MASK_A);
      if (rnd() < 0.25) bits.push(OPT.BAG);
      if (rnd() < (female ? 0.4 : 0.15)) bits.push(OPT.SLEEVE_A);
      a.paint = new THREE.Color(top);
      a.phase = rnd() * 6.28;
      a.sc = female ? 0.92 + rnd() * 0.06 : 0.97 + rnd() * 0.07;   // cao 1,56-1,80 m
    }
    a.opt = optWord(bits, Math.floor(rnd() * 256));
    a.shirt = new THREE.Color(top);
    a.shirt2 = new THREE.Color(top2);
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
  // wmap: người đi bộ đang trong vùng bo NGÃ TƯ (≤ rb+2 m từ nút — chỗ họ băng qua lòng đường) → xe nhường. Người
  // trên vỉa hè dọc phố không vào (khỏi làm xe phanh vô cớ / chặn chỗ mọc xe).
  let wmap = new Map();
  function rebuildHash() {
    hmap = new Map(); wmap = new Map();
    for (const a of agents) {
      if (a.type === 'walk') {
        const L = edges[a.e].L;
        if (!(a.s < (a.prev ? a.prevRb : 0) + 2 || (a.next && a.s > L - a.rb - 2))) continue;
        const k = hk(a.x, a.z); let l = wmap.get(k); if (!l) wmap.set(k, (l = [])); l.push(a);
        continue;
      }
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
    lim = Math.min(lim, walkerLimit(a));
    if (lim < 0.7) { a.waitT += 0.1; if (a.waitT > 3) { a.waitT = 0; a.ghostT = 1.5; } } else a.waitT = 0;
    return lim;
  }
  // XE NHƯỜNG NGƯỜI ĐI BỘ (gọi trong followLimit, TRƯỚC bộ đếm chờ: chờ người > 3 s vẫn được "thoát kẹt" như chờ xe —
  // đo mô phỏng node 72 điểm × 50 s: tách riêng khỏi ghost KHÔNG giảm va chạm, giữ chung cho xe khỏi đứng mãi).
  function walkerLimit(a) {
    // người đi bộ đang băng qua ngã tư trong hành lang phía trước → giảm tốc, dừng trước họ (không chạy xuyên người).
    // Tầm nhìn = quãng phanh (v²/2·4 m/s²) + chỗ dừng + 2 m (xe máy 11 m/s ≈ 20 m); xét cả vị trí người đó 1,2 s nữa
    // (đang bước VÀO hành lang). Lưới băm 8 m, quét ±2 ô → tầm 14 m luôn nằm trong vùng quét.
    let lim = 1e9;
    const fx = Math.sin(a.h), fz = Math.cos(a.h);
    const wHalf = a.type === 'car' ? 1.1 : 0.55, wStop = a.type === 'car' ? 4.5 : 2.6;
    const wLook = Math.min(14, wStop + 2 + a.v * a.v / 8);
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      const l = wmap.get(hk(a.x + i * HC, a.z + j * HC)); if (!l) continue;
      for (const b of l) {
        const bx = b.x - a.x, bz = b.z - a.z;
        const ahead = bx * fx + bz * fz; if (ahead <= 0 || ahead > wLook) continue;
        const bv = (b.v || 0) * 1.2, ex = bx + Math.sin(b.h) * bv, ez = bz + Math.cos(b.h) * bv;
        const s0 = bx * fz - bz * fx, s1 = ex * fz - ez * fx;   // lệch ngang bây giờ / 1,2 s nữa
        const w = wHalf + 0.45;
        if ((s0 > w && s1 > w) || (s0 < -w && s1 < -w)) continue;   // cả 2 thời điểm cùng ở ngoài một bên
        lim = Math.min(lim, Math.max(0, (ahead - wStop) * 0.8));
      }
    }
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
      a.prev = { e: a.e, dir: a.dir }; a.prevRb = a.rb; a.prevLat = a.latCur + a.pk;
      a.s -= e.L; a.e = nx.e; a.dir = nx.dir; a.next = null;
      if (nx.side) a.side = nx.side;
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
    // né XE ĐỖ (W2-F): trượt ngang mượt về độ lệch mục tiêu của parkShift (chỉ cạnh có xe đỗ — đa số cạnh bỏ qua ngay)
    if (a.type !== 'walk') {
      const tgt = parkShift(a, edges[a.e], a.latCur);
      if (tgt || a.pk) {
        const k = (a.type === 'car' ? 1.1 : 1.6) * dt;
        a.pk += Math.max(-k, Math.min(k, tgt - a.pk));
        if (!tgt && Math.abs(a.pk) < 1e-3) a.pk = 0;
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

  const DRAW_R2 = DRAW_R * DRAW_R, LOD_HYST = 5;
  const gBikeFar = groups.bike_far, gCarFar = groups.car_far;
  // Ghi instance: mỗi tác tử trong bán kính vẽ → nhóm GẦN của kiểu nó hoặc nhóm XA (LOD) theo khoảng cách; mỗi nhóm
  // ghi vào bản đệm khung N−2 của nó (xem STRIDE/NSET) — 1 lần tải/nhóm/khung. Bóng tiếp đất: 1 bộ đệm chung.
  // LOD gần/xa theo khoảng cách tới CAMERA (cx, cz), KHÔNG tới người chơi: camera LITE lùi tới CAM_MAX 36 m > NEAR_BIKE
  // 32 m, camera đạo diễn __cine bay xa người chơi → bản XA (người que trên nêm) từng hiện cách ống kính 2-6 m (phản biện).
  // Trễ LOD_HYST 5 m (xa → gần khi < ngưỡng − 5 m) — không nhấp nháy ở ngưỡng. Cắt DRAW_R + mô phỏng vẫn quanh người chơi.
  // Người đi bộ: pha bước tích phân trên CPU (a.wph) + biên độ êm theo tốc độ (a.wamp) — trước: biên độ nhảy 0↔1 ở
  // 0,2 m/s và pha = uKitTime·nhịp nhảy khi nhịp đổi.
  function writeInstances(px, pz, cx, cz, dt) {
    for (const k in groups) { const g = groups[k]; g.k = (g.k + 1) % NSET; g.n = 0; g.arr = g.sets[g.k].ib.array; }
    shK = (shK + 1) % NSET;
    const ss = shSets[shK], sa = ss.ib.array;
    let ns = 0;
    for (let j = 0; j < agents.length; j++) {
      const a = agents[j];
      const d2 = (a.x - px) * (a.x - px) + (a.z - pz) * (a.z - pz);
      if (d2 > DRAW_R2) continue;
      if (!(Math.abs(a.x - a.yx) + Math.abs(a.z - a.yz) < 4)) { a.yx = a.x; a.yz = a.z; a.y = groundHeight(a.x, a.z) + (a.type === 'walk' ? SIDEWALK_TOP : ROAD_TOP); }
      let g = a.grp, sx = 1, sy = 1, sz = 1;
      if (a.type !== 'walk') {
        const lim = (a.type === 'bike' ? NEAR_BIKE : NEAR_CAR) - (a.far ? LOD_HYST : 0);
        a.far = (a.x - cx) * (a.x - cx) + (a.z - cz) * (a.z - cz) > lim * lim;
      }
      if (a.type === 'bike' && a.far) g = gBikeFar;
      else if (a.type === 'car' && a.far) { g = gCarFar; const f = CAR_FAR_SCALE[a.kind]; sx = f[2]; sy = f[1]; sz = f[0]; }
      else if (a.type === 'walk') {
        sx = sy = sz = a.sc || 1;
        a.wph = ((a.wph ?? a.phase ?? 0) + dt * (a.v > 0.05 ? a.v * 4.5 / sx : 0)) % 6.2832;   // nhịp bước (rad/s) ∝ tốc độ / chiều dài chân
        const wt = Math.min(1, Math.max(0, (a.v - 0.05) / 0.55));
        a.wamp = (a.wamp ?? wt) + (wt - (a.wamp ?? wt)) * Math.min(1, dt * 5);
      }
      const arr = g.arr, o = g.n * STRIDE;
      const ch = Math.cos(a.h), shh = Math.sin(a.h), cl = Math.cos(a.lean || 0), sl = Math.sin(a.lean || 0);
      // R = Ry(h)·Rz(lean)·S (cột-trước như Matrix4.elements)
      arr[o] = ch * cl * sx; arr[o + 1] = sl * sx; arr[o + 2] = -shh * cl * sx; arr[o + 3] = 0;
      arr[o + 4] = -ch * sl * sy; arr[o + 5] = cl * sy; arr[o + 6] = shh * sl * sy; arr[o + 7] = 0;
      arr[o + 8] = shh * sz; arr[o + 9] = 0; arr[o + 10] = ch * sz; arr[o + 11] = 0;
      arr[o + 12] = a.x; arr[o + 13] = a.y; arr[o + 14] = a.z; arr[o + 15] = 1;
      arr[o + 16] = a.paint.r; arr[o + 17] = a.paint.g; arr[o + 18] = a.paint.b;
      arr[o + 19] = a.shirt.r; arr[o + 20] = a.shirt.g; arr[o + 21] = a.shirt.b;
      arr[o + 22] = a.shirt2.r; arr[o + 23] = a.shirt2.g; arr[o + 24] = a.shirt2.b;
      arr[o + 25] = a.type === 'walk' ? a.wph : 0;    // pha bước (rad)
      arr[o + 26] = a.type === 'walk' ? a.wamp : 0;   // biên độ bước 0..1
      arr[o + 27] = a.opt || 0;
      g.n++;
      // bóng tiếp đất: elip (rx, rz) của mô hình gần, theo hướng xe (không nghiêng theo lean)
      const shp = a.grp.sh, ks = a.type === 'walk' ? (a.sc || 1) : 1, rx = shp[0] * ks, rz = shp[1] * ks, q = ns * SH_STRIDE;   // elip của mô hình GẦN theo kiểu (đã đúng kích thước — không nhân scale LOD xa)
      sa[q] = ch * rx; sa[q + 1] = 0; sa[q + 2] = -shh * rx; sa[q + 3] = 0;
      sa[q + 4] = 0; sa[q + 5] = 1; sa[q + 6] = 0; sa[q + 7] = 0;
      sa[q + 8] = shh * rz; sa[q + 9] = 0; sa[q + 10] = ch * rz; sa[q + 11] = 0;
      sa[q + 12] = a.x; sa[q + 13] = a.y; sa[q + 14] = a.z; sa[q + 15] = 1;
      sa[q + 16] = shp[2];
      ns++;
    }
    for (const k in groups) {
      const g = groups[k], s = g.sets[g.k];
      g.mesh.count = g.n;
      if (!g.n) continue;
      bindSet(g, s);
      s.ib.clearUpdateRanges(); s.ib.addUpdateRange(0, g.n * STRIDE); s.ib.needsUpdate = true;
      g.mesh.boundingSphere.center.set(px, 2, pz);
    }
    shMesh.count = ns;
    if (ns) {
      shBind(ss);
      ss.ib.clearUpdateRanges(); ss.ib.addUpdateRange(0, ns * SH_STRIDE); ss.ib.needsUpdate = true;
      shMesh.boundingSphere.center.set(px, 2, pz);
    }
  }

  refreshBubble(-5, 72);
  fill(-5, 72, SPAWN_NEAR);

  let enabled = true, msEMA = 0;
  // đèn pha/đèn hậu sáng theo đêm (main.js truyền dayNight.update().night mỗi khung)
  const setNight = (v) => { KIT_U.uNight.value = v; };
  function setEnabled(on) {
    enabled = !!on;
    for (const k in groups) groups[k].mesh.visible = enabled;
    shMesh.visible = enabled;
  }
  // camPos (tuỳ chọn, main.js: camera.position): tâm chọn LOD gần/xa; thiếu → dùng người chơi
  function update(dt, time, playerPos, camPos) {
    if (!enabled) return stats;
    frameNo++;
    const now = performance.now();
    const px = playerPos.x, pz = playerPos.z;
    KIT_U.uKitTime.value = time;
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
    writeInstances(px, pz, camPos ? camPos.x : px, camPos ? camPos.z : pz, dt);
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

  // KIỂM BẤT BIẾN (tools/diag.mjs) trên VỊ TRÍ ĐANG VẼ (a.x,a.z — gồm lách người chơi/ghost), không phải làn gán:
  //  wrongSide: xe ở phố 2 chiều mà tâm xe lệch < 0,3 m sang phải tim đường (ngoài đoạn bo ngã tư, không đang lách);
  //  offRoad: tâm xe ra ngoài mép lòng đường > 0,3 m; wrongWay: ngược chiều đường đôi; walkInBuilding: người đi bộ
  //  trong footprint nhà/địa danh; walkOnRoad: người đi bộ trong lòng đường NGOÀI vùng ngã tư (băng qua ngã tư là được);
  //  overlap: 2 xe chồng tâm < 0,9 m (xe máy) / 1,8 m (có ô tô) ngoài ghost; outside: ra ngoài vùng chơi.
  function check() {
    const r = { vehicles: 0, walkers: 0, wrongSide: 0, offRoad: 0, wrongWay: 0, walkInBuilding: 0, walkOnRoad: 0, overlap: 0, outside: 0, parkHit: 0, examples: [] };
    const ex = (k, a) => { if (r.examples.length < 8) r.examples.push([k, Math.round(a.x), Math.round(a.z)]); };
    rebuildHash();
    for (const a of agents) {
      const e = edges[a.e];
      if (Math.hypot(a.x, a.z) > PLAY_R + 70) r.outside++;
      const inJunction = (a.prev && a.s < a.prevRb + 0.5) || (a.next && a.s > e.L - a.rb - 0.5);
      edgePoint(e, a.dir, Math.min(e.L, Math.max(0, a.s)), _q);
      const lat = (a.x - _q.x) * -_q.tz + (a.z - _q.z) * _q.tx;   // dương = bên phải hướng đi
      if (a.type === 'walk') {
        r.walkers++;
        if (fp && fp.blocked(a.x, a.z)) { r.walkInBuilding++; ex('walkInBuilding', a); }
        if (!inJunction && Math.abs(lat) < e.hw - 0.2) { r.walkOnRoad++; ex('walkOnRoad', a); }
        continue;
      }
      r.vehicles++;
      if (!dirOK(a, e, a.dir)) { r.wrongWay++; ex('wrongWay', a); }
      if (inJunction) continue;
      if (!e.oneway && Math.abs(a.avoid || 0) < 0.3 && lat < 0.3) { r.wrongSide++; ex('wrongSide', a); }
      if (Math.abs(lat) > e.hw + 0.3) { r.offRoad++; ex('offRoad', a); }
      if (parkedHit(a)) { r.parkHit++; ex('parkHit', a); }
      if (a.ghostT > 0) continue;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = hmap.get(hk(a.x + i * HC, a.z + j * HC)); if (!l) continue;
        for (const b of l) {
          if (b === a || b.ghostT > 0 || b.x < a.x || (b.x === a.x && b.z <= a.z)) continue;   // mỗi cặp 1 lần
          if (Math.hypot(b.x - a.x, b.z - a.z) < (a.type === 'car' || b.type === 'car' ? 1.8 : 0.9)) { r.overlap++; ex('overlap', a); }
        }
      }
    }
    return r;
  }

  // parkHit (check): thân xe đang chạy (hình chữ nhật xấp xỉ) chồng lên ô tô đỗ (props.parkedCars) — sau W2-F phải ≈ 0
  let _pkGrid = null;
  function parkedHit(a) {
    const list = world.props && world.props.parkedCars; if (!list || !list.length) return false;
    if (!_pkGrid) { _pkGrid = new Map(); for (const c of list) { const k = hk(c.x, c.z); let l = _pkGrid.get(k); if (!l) _pkGrid.set(k, (l = [])); l.push(c); } }
    const hw = PARK_HALF[a.type] - 0.1, hl = a.type === 'car' ? 2.0 : 0.8;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = _pkGrid.get(hk(a.x + i * HC, a.z + j * HC)); if (!l) continue;
      for (const c of l) {
        const dx = a.x - c.x, dz = a.z - c.z, sh = Math.sin(c.heading || 0), ch = Math.cos(c.heading || 0);
        const along = dx * sh + dz * ch, across = dx * ch - dz * sh;
        if (Math.abs(across) < 0.85 + hw && Math.abs(along) < (c.len || 4.4) / 2 + hl) return true;
      }
    }
    return false;
  }

  // Người chơi (đi bộ/lái xe) không xuyên qua xe đang chạy: xe máy = 1 vòng 0,55 m, ô tô = 3 vòng dọc thân.
  const OFF_CAR = [-1.5, 0, 1.5], OFF_BIKE = [0];   // hằng — pushOut chạy mỗi bước con của người chơi (không cấp phát)
  function pushOut(p, r = 0.45) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const l = hmap.get(hk(p.x + i * HC, p.z + j * HC)); if (!l) continue;
      for (const b of l) {
        const fx = Math.sin(b.h), fz = Math.cos(b.h);
        const offs = b.type === 'car' ? OFF_CAR : OFF_BIKE;
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
    update, graph: G, pushOut, setEnabled, setNight, check, agents, parkStats,   // agents: chỉ để chẩn đoán (tool/test), không sửa từ ngoài
    stats: () => ({ ...stats, groups: Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, g.list.length])) }),
  };
}
