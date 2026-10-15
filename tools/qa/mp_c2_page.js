// tools/qa/mp_c2_page.js — phần CHẠY TRONG TRANG của tools/qa/mp_c2_avatars.mjs (MP-2 C2). Nạp bằng import() sau khi
// game dựng xong (window.__hp). KHÔNG sửa main.js: gắn remote_avatars vào world.updaters (chạy trong animate(), trước
// render) và giả lập máy chủ + mạng ngay trong trang:
//   người chơi giả (hàm quỹ đạo) → STATE 15 Hz khi đi / 2 Hz khi đứng, trễ lên 30–70 ms → máy chủ tick 20 Hz, snapshot
//   10 Hz, CHỈ gửi bản ghi đổi, lượng tử như js/shared/quant.js → trễ xuống 35 ms + rung 0–60 ms + đuôi dài, kẹt TCP theo
//   chùm (tuỳ chọn), rớt mạng + RESUME (keyframe ENTER lại) → createSnapClock → ra.enter/update/leave → ra.frame.
import { createRemoteAvatars } from '../../js/net/remote_avatars.js';
import { createSnapClock } from '../../js/net/interp.js';
import { qPos, dqPos, qY, dqY, qYaw, dqYaw, qSpd, dqSpd, packState } from '../../js/shared/quant.js';
import { MODE, SFLAG } from '../../js/shared/constants.js';
import { surfaceY, spawnY } from '../../js/world.js';
import { ROADS_DT, BRIDGE_WAYS } from '../../js/mapdata.js';
import { drawMinimap } from '../../js/minimap.js';
import { truthAt } from '../../tests/net/interp_sim.mjs';

const hp = window.__hp;
const R = hp.renderer, cam = hp.camera;
const nowS = () => performance.timeOrigin + performance.now();   // "giờ máy chủ" giả = đồng hồ thật (offset 0)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };

// ---------- đo draw call cả khung (composer gọi render nhiều lần → tắt autoReset, tự reset đầu khung) ----------
R.info.autoReset = false;
const frameInfo = { calls: [], tris: [], dts: [] };
let infoOn = false, lastT = performance.now();
function infoHook() {
  const t = performance.now();
  if (infoOn) { frameInfo.calls.push(R.info.render.calls); frameInfo.tris.push(R.info.render.triangles); frameInfo.dts.push(t - lastT); }
  lastT = t;
  R.info.reset();
}
hp.world.updaters.unshift(infoHook);
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
async function measure(ms = 4000) {
  frameInfo.calls.length = 0; frameInfo.tris.length = 0; frameInfo.dts.length = 0;
  infoOn = true;
  await new Promise((r) => setTimeout(r, ms));
  infoOn = false;
  const n = frameInfo.dts.length, sum = frameInfo.dts.reduce((a, b) => a + b, 0);
  const sorted = frameInfo.dts.slice().sort((a, b) => a - b);
  return {
    frames: n, fps: +(1000 * n / sum).toFixed(1), p50ms: +med(frameInfo.dts).toFixed(2), p95ms: +(sorted[Math.floor(n * 0.95)] || 0).toFixed(2),
    callsMedian: med(frameInfo.calls), callsMin: Math.min(...frameInfo.calls), callsMax: Math.max(...frameInfo.calls),
    trisMedian: med(frameInfo.tris), programs: R.info.programs.length,
    ra: ra ? ra.stats() : null,
  };
}

// ---------- mô-đun người chơi khác + máy chủ/mạng giả ----------
let ra = null, clock = createSnapClock();
const players = new Map();   // netId → {fn, app, key, seen, kfPending}
const queue = [];            // gói chờ tới: {arrival, tick, ops:[...]}
let t0 = nowS(), lastTick = -1, lastArrival = 0, stallUntil = 0, offline = null, wasOffline = false;
const net = { base: 35, jitter: 60, tailP: 0.04, stallP: 0, ids: [], names: [] };
const evLog = { enters: 0, updates: 0, leaves: 0, packets: 0 };

function makeRA(tier) {
  if (ra) { ra.dispose(); const i = hp.world.updaters.indexOf(raHook); if (i >= 0) hp.world.updaters.splice(i, 1); }
  ra = createRemoteAvatars({ scene: hp.scene, world: hp.world, camera: cam, tier: tier ?? hp.tier });
  hp.world.updaters.push(raHook);
  window.__ra = ra;
  return ra;
}
function raHook(dt) {
  if (!ra) return;
  serverStep();
  deliver();
  ra.frame(dt, nowS(), cam.position);
}
// trạng thái người chơi p ở giờ t (giây kể từ t0) — hàm quỹ đạo trả {x, z, y?, yaw, spd, mode, flags}
function stateOf(p, ts) {
  const s = p.fn(ts);
  if (s.y === undefined) {
    const g = surfaceY(s.x, s.z, s.yRef ?? 2.2);
    s.y = s.mode === MODE.MOTO || s.mode === MODE.PILLION ? g - 0.22 : s.mode === MODE.CYCLO ? g + 0.29 : s.mode === MODE.AIR ? g + (s.jump || 0) : g;
  }
  return s;
}
// STATE mới nhất máy chủ đã nhận lúc T (ms từ t0): người kia gửi 15 Hz (2 Hz khi đứng), trễ lên 30–70 ms
function latestState(p, T) {
  const iv = 1000 / 15;
  for (let k = Math.floor((T - 30) / iv); k >= 0 && k > Math.floor((T - 30) / iv) - 8; k--) {
    const sent = k * iv + p.phase, lat = 30 + hash(p.netId, k) * 40;
    if (sent + lat > T || sent < 0) continue;
    const s = stateOf(p, sent / 1000);
    if (s.spd < 0.05 && k % 7) continue;   // đứng: ~2 Hz
    return s;
  }
  return stateOf(p, Math.max(0, T - 100) / 1000);
}
function serverStep() {
  const now = nowS(), tick = Math.floor((now - t0) / 50);
  if (lastTick < 0) lastTick = tick - 1;
  for (let k = lastTick + 1; k <= tick; k++) {
    if (k % 2) continue;
    const T = k * 50;
    if (offline && T >= offline[0] && T < offline[1]) { wasOffline = true; continue; }
    const kf = wasOffline; wasOffline = false;
    const ops = [];
    for (const p of players.values()) {
      if (p.left) continue;
      const s = latestState(p, T);
      const rec = { x: dqPos(qPos(s.x)), z: dqPos(qPos(s.z)), y: dqY(qY(s.y)), yaw: dqYaw(qYaw(s.yaw)), spd: dqSpd(qSpd(s.spd)),
        state: packState(s.mode, s.flags || 0) };
      const key = `${rec.x},${rec.z},${rec.y},${rec.yaw},${rec.spd},${rec.state}`;
      if (!p.seen || kf) { ops.push(['enter', p.netId, rec, p.app]); p.seen = true; p.key = key; continue; }
      if (key === p.key) continue;
      p.key = key;
      ops.push(['update', p.netId, rec]);
    }
    for (const id of net.leaving.splice(0)) ops.push(['leave', id]);
    if (!ops.length && !kf) continue;
    let lat = net.base + rnd() * net.jitter; if (rnd() < net.tailP) lat += 60 + rnd() * 140;
    let arr = t0 + T + lat;
    if (net.stallP && !kf) {
      if (arr < stallUntil) arr = stallUntil;
      else if (rnd() < net.stallP) { stallUntil = t0 + T + 300 + rnd() * 400; arr = stallUntil; }
    }
    if (arr < lastArrival) arr = lastArrival;   // TCP: theo thứ tự gửi
    lastArrival = arr;
    queue.push({ arrival: arr, tick: k + 100000, ops });
  }
  lastTick = tick;
}
net.leaving = [];
function deliver() {
  const now = nowS();
  while (queue.length && queue[0].arrival <= now) {
    const pk = queue.shift();
    evLog.packets++;
    const ts = clock.time(pk.tick, pk.arrival);
    for (const op of pk.ops) {
      if (op[0] === 'enter') { ra.enter(op[1], op[2], op[3], ts); evLog.enters++; }
      else if (op[0] === 'update') { ra.update(op[1], op[2], ts); evLog.updates++; }
      else { ra.leave(op[1]); evLog.leaves++; }
    }
  }
}

// ---------- tên tiếng Việt (không tên thương hiệu) ----------
const NAMES = ['Nguyễn Thị Hường', 'Đặng Quốc Việt', 'Trần Ngọc Ẩn', 'Lê Thị Ứng', 'Phạm Minh Đức', 'Hoàng Thu Thủy', 'Vũ Đức Thắng',
  'Bùi Khánh Hưng', 'Đỗ Quỳnh Như', 'Hồ Sỹ Dũng', 'Dương Mỹ Ngọc', 'Lý Gia Bảo', 'Trịnh Xuân Trường', 'Mai Phương Thảo',
  'Võ Thành Đạt', 'Đinh Thế Hiển', 'Tạ Quang Thiều', 'Phan Thị Huệ', 'Kiều Oanh', 'Châu Ngọc Lữ', 'Ngô Thùy Dương', 'Lương Ỷ Lan',
  'Cù Huy Cận', 'Hà Thị Yến'];
function addPlayer(netId, fn, nameIdx, opts = {}) {
  const app = new Uint8Array(8);
  for (let i = 0; i < 7; i++) app[i] = Math.floor(hash(netId, i + 9) * 256);
  if (opts.hat === 'nonla') app[1] = (app[1] & ~7) | 5;
  players.set(netId, { netId, fn, app, seen: false, key: '', phase: hash(netId, 1) * 66, left: false });
  if (nameIdx !== null && nameIdx !== undefined) {
    const nm = NAMES[nameIdx % NAMES.length] + '#' + String(1000 + Math.floor(hash(netId, 3) * 8999));
    ra.names([{ netId, name: nm, badge: opts.badge || 0 }]);
  }
}
function clearPlayers() {
  for (const id of players.keys()) ra.leave(id);
  players.clear(); queue.length = 0;
  t0 = nowS(); lastTick = -1; lastArrival = 0; stallUntil = 0; offline = null; wasOffline = false; clock.reset();
}

// ---------- quỹ đạo ----------
const circle = (cx, cz, r, v, ph, mode = MODE.WALK, flags = 0) => (t) => {
  const w = v / r, a = ph + w * t;
  return { x: cx + r * Math.sin(a), z: cz + r * Math.cos(a), yaw: a + Math.PI / 2 * Math.sign(w || 1), spd: Math.abs(v), mode, flags };
};
const stand = (x, z, yaw, mode = MODE.WALK, flags = 0) => () => ({ x, z, yaw, spd: 0, mode, flags });
function polyPath(pts) {   // pts [[x,z,(y)]] → {L, at(s)} theo độ dài cung
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  return {
    L, at(s) {
      s = Math.max(0, Math.min(L, s));
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const u = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = pts[i - 1], b = pts[i];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      return { x: a[0] + dx * u, z: a[1] + dz * u, y: a[2] !== undefined ? a[2] + ((b[2] ?? a[2]) - a[2]) * u : undefined, tx: dx / l, tz: dz / l };
    },
  };
}
// xe/người đi qua lại trên đường (bên phải theo hướng đi, lệch lat m)
const along = (path, s0, v, lat, mode, flags = 0, yOf = null) => (t) => {
  const P2 = 2 * path.L, u = ((s0 + v * t) % P2 + P2) % P2, fwd = u < path.L, s = fwd ? u : P2 - u;
  const p = path.at(s), dir = fwd ? 1 : -1, tx = p.tx * dir, tz = p.tz * dir;
  const x = p.x + -tz * lat, z = p.z + tx * lat;
  const o = { x, z, yaw: Math.atan2(tx, tz), spd: v, mode, flags };
  if (yOf) o.y = yOf(x, z, p);
  return o;
};
function roadNear(cx, cz, R0 = 150, cls = ['p', 's', 't']) {
  let best = null, bl = 0;
  for (const r of ROADS_DT) {
    if (!cls.includes(r.c)) continue;
    const pts = r.pts.filter((q) => Math.hypot(q[0] - cx, q[1] - cz) < R0 * 2);
    if (pts.length < 2 || !pts.some((q) => Math.hypot(q[0] - cx, q[1] - cz) < R0)) continue;
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L > bl) { bl = L; best = pts; }
  }
  return best ? polyPath(best) : null;
}

// ---------- kịch bản ----------
const SC = {
  // 96 người ở quảng trường Nhà hát lớn: đi bộ vòng, đứng, chạy, xe máy trên phố gần nhất
  crowd(cx, cz, n = 96) {
    clearPlayers();
    const road = roadNear(cx, cz, 140);
    let id = 100;
    for (let i = 0; i < n; i++, id++) {
      const k = i % 10, r = 4 + (i * 7.3) % 28, ph = hash(id, 2) * 6.28;
      let fn;
      if (k < 5) fn = circle(cx, cz, r, (i % 2 ? 1 : -1) * (1.2 + hash(id, 4) * 1.8), ph);
      else if (k < 7) fn = stand(cx + r * Math.sin(ph), cz + r * Math.cos(ph), ph);
      else if (k < 8) fn = circle(cx, cz, 30 + (i % 5), 7, ph, MODE.RUN);
      else fn = road ? along(road, hash(id, 5) * road.L, 8 + hash(id, 6) * 6, 1.5 + hash(id, 7) * 3, MODE.MOTO) : circle(cx, cz, 45, 9, ph, MODE.MOTO);
      addPlayer(id, fn, i);
    }
    return { n: players.size, road: road ? Math.round(road.L) : 0 };
  },
  // trộn: đi bộ, chạy, xe máy (có người ngồi sau, chở hàng), ngồi, nhảy, xích lô, vắng mặt
  mix(cx, cz) {
    clearPlayers();
    const road = roadNear(cx, cz, 120);
    let id = 300;
    for (let i = 0; i < 8; i++) addPlayer(id++, circle(cx, cz, 5 + i * 1.5, 1.4 + (i % 3) * 0.6, i), i);
    for (let i = 0; i < 4; i++) addPlayer(id++, circle(cx, cz, 18 + i * 2, -7, i * 1.5, MODE.RUN), 8 + i);
    if (road) {
      for (let i = 0; i < 8; i++) {
        const s0 = (i / 8) * road.L, v = 7 + i;
        addPlayer(id, along(road, s0, v, 2 + (i % 3), MODE.MOTO, i === 5 ? SFLAG.CARGO : 0), 12 + i);
        if (i === 2 || i === 6) addPlayer(id + 50, along(road, s0 - 0.6, v, 2 + (i % 3), MODE.PILLION), 20 + i);   // ngồi sau
        id++;
      }
      addPlayer(id++, along(road, road.L * 0.3, 4.2, 2.5, MODE.CYCLO), 3);
    }
    addPlayer(id++, stand(cx + 3, cz + 2, 1, MODE.SIT), 5);
    addPlayer(id++, (t) => ({ x: cx - 4, z: cz + 3, yaw: 0, spd: 0, mode: MODE.AIR, jump: Math.max(0, Math.sin(t * 4)) * 0.8 }), 6);
    addPlayer(id++, stand(cx - 2, cz - 4, 2, MODE.WALK, SFLAG.AWAY), 7);
    return { n: players.size, road: road ? Math.round(road.L) : 0 };
  },
  // bảng tên cận cảnh quanh (cx, cz) — người đứng thành vòng cung trước camera (camera ở phía +z nhìn về −z)
  tags(cx, cz) {
    clearPlayers();
    const P = [[-2.4, -1.5, 0], [-0.8, -2.6, 1], [0.9, -2.2, 2], [2.5, -1.2, 3], [0.2, -5.5, 9], [-3.2, -6.5, 22]];
    P.forEach(([dx, dz, ni], i) => addPlayer(600 + i, stand(cx + dx, cz + dz, Math.PI * 0.1 * (i - 2) + 0.0, MODE.WALK, i === 3 ? SFLAG.AWAY : 0), ni,
      { badge: i === 2 ? 1 : 0, hat: i === 1 ? 'nonla' : undefined }));
    return { n: players.size };
  },
  // mặt cầu nâng (Cầu Lạc Long, kind 'deck'): đi bộ + xe máy trên MẶT CẦU, y = mặt cầu
  bridge() {
    clearPlayers();
    const b = BRIDGE_WAYS.find((w) => w.kind === 'deck') || BRIDGE_WAYS[0];
    const pts = b.pts.slice(b.i0 ?? 0, (b.i1 ?? b.pts.length - 1) + 1);
    const path = polyPath(pts);
    const yDeck = (x, z) => spawnY(x, z);
    let id = 700;
    for (let i = 0; i < 10; i++) addPlayer(id++, along(path, (i / 10) * path.L, 1.3 + (i % 3) * 0.5, (i % 2 ? 1 : -1) * 4.5, MODE.WALK, 0, (x, z) => yDeck(x, z)), i);
    for (let i = 0; i < 6; i++) addPlayer(id++, along(path, (i / 6) * path.L, 9 + i, 1.5 + (i % 2), MODE.MOTO, 0, (x, z) => yDeck(x, z) - 0.22), 10 + i);
    const mid = path.at(path.L / 2);
    return { n: players.size, name: b.n, L: Math.round(path.L), mid: [mid.x, mid.z, mid.y], deckY: yDeck(mid.x, mid.z), groundUnder: hp.world && surfaceY(mid.x, mid.z, -50) };
  },
  // nội suy: 1 người theo quỹ đạo interp_sim.truthAt (đi bộ → chạy vòng → đứng 5 s → xe máy) quanh (cx, cz),
  // rung mạng + kẹt TCP theo chùm + rớt mạng 40–42 s rồi RESUME (keyframe ENTER lại ở chỗ mới → nhảy)
  interp(cx, cz, { stallP = 0.012 } = {}) {
    clearPlayers();
    net.stallP = stallP;
    offline = [40000, 42000];
    const fn = (t) => { const s = truthAt(t); return { x: cx + s.x, z: cz + s.z, yaw: s.yaw, spd: s.spd, mode: s.mode }; };
    addPlayer(900, fn, 1);
    rec.length = 0; truth.length = 0; recOn = true;
    return { t0 };
  },
};
// ghi khung cho kịch bản nội suy: [now−t0, x, z, delay, extrap?] + quỹ đạo thật mỗi 10 ms
const rec = [], truth = [];
let recOn = false;
hp.world.updaters.push(() => {
  if (!recOn || !ra) return;
  const d = ra.debug(900);
  if (d) rec.push([+(nowS() - t0).toFixed(2), +d.x.toFixed(4), +d.z.toFixed(4), +d.delay.toFixed(2), d.snaps]);
});

window.__c2 = {
  makeRA, SC, measure, players, evLog, net,
  stats: () => ra && ra.stats(),
  debug: (id) => ra && ra.debug(id),
  stopRec() { recOn = false; net.stallP = 0; offline = null; return { rec: rec.slice(), n: rec.length }; },
  truthTable(cx, cz, dur = 60, step = 0.01) { const o = []; for (let t = 0; t <= dur; t += step) { const s = truthAt(t); o.push([+(t * 1000).toFixed(1), +(cx + s.x).toFixed(4), +(cz + s.z).toFixed(4)]); } return o; },
  clear: () => clearPlayers(),
  leave(ids) { for (const id of ids) { const p = players.get(id); if (p) { p.left = true; net.leaving.push(id); } } },
  minimap(px, pz, yaw, all = true) {   // vẽ minimap có chấm người chơi khác (sau khi main.js vẽ trong cùng khung)
    let n = 0;
    const loop = () => { drawMinimap(px, pz, yaw, ra.markers({ all })); if (++n < 40) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return ra.markers({ all }).length;
  },
  atlasPNG: () => ra.tags.canvas.toDataURL('image/png'),
  programs: () => R.info.programs.map((p) => p.name || p.cacheKey.slice(0, 40)),
};
export default window.__c2;
