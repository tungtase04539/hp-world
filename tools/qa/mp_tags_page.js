// tools/qa/mp_tags_page.js — phần TRONG TRANG của tools/qa/mp_tags_declutter.mjs (bảng tên trong đám đông dày).
// Nạp SAU tools/qa/mp_c2_page.js + window.__c2.makeRA(). Bọc ra.tags.{begin, ring, tag, end} (API chung cho bản cũ dot3 và bản
// gỡ chồng) để đo — không phụ thuộc nội bộ nametags.js:
//   · bật/tắt hiển thị từng bảng tên mỗi khung (tag() trả true = đã vẽ) → số lần ĐỔI/giây + "nháy" (đổi lại trong < 0,5 s)
//   · thời gian lượt bảng tên (ring() đầu tiên → end() xong: gồm cả chọn/sắp ứng viên trong remote_avatars)
//   · chồng lấn TRÊN MÀN HÌNH: đọc tứ giác billboard trong bộ đệm đỉnh vừa ghi, chiếu bằng camera → hình chữ nhật px,
//     đếm cặp chồng > 15 % diện tích bảng nhỏ hơn
// uninstall() trả lại hàm gốc (đo heap không có lớp bọc).
import * as THREE from 'three';

const hp = window.__hp;
const cam = hp.camera;
const _v = new THREE.Vector3();
let T = null, orig = null;
const S = {
  on: false, frames: 0, toggles: 0, flicker: 0, drawnSum: 0, drawnNow: 0, spanMs: [], raMs: [],
  ov: { samples: 0, tags: 0, pairs: 0, overlapped: 0, maxPairs: 0, maxOverlapped: 0 },
  t0: 0, sampleEvery: 6,
};
let cur = new Map(), prev = new Map();   // netId (đầu trong màn hình) → 1 đã vẽ / 0 không, khung này / khung trước
const lastToggle = new Map();
let spanT = -1;

function rects() {
  const geo = T.mesh.geometry, P = geo.attributes.position.array, nq = Math.floor(geo.drawRange.count / 6);
  const W = innerWidth, H = innerHeight, out = [];
  cam.updateMatrixWorld();
  for (let q = 0; q < nq; q++) {
    const o = q * 12;
    const ys = [P[o + 1], P[o + 4], P[o + 7], P[o + 10]];
    if (Math.max(...ys) - Math.min(...ys) < 1e-4) continue;   // vòng sáng nằm phẳng
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
    for (let k = 0; k < 4; k++) {
      _v.set(P[o + k * 3], P[o + k * 3 + 1], P[o + k * 3 + 2]).applyMatrix4(cam.matrixWorldInverse);
      if (_v.z > -0.05) { behind = true; break; }
      _v.applyMatrix4(cam.projectionMatrix);
      const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    if (behind || x1 < 0 || y1 < 0 || x0 > W || y0 > H) continue;
    // tứ giác gồm lề trong suốt 10 px trên/dưới ô 64 px (viên thuốc = 44/64 chiều cao) — đo trên VIÊN THUỐC
    const cy = (y0 + y1) / 2, hh = (y1 - y0) * (44 / 64) / 2;
    out.push([x0, cy - hh, x1, cy + hh]);
  }
  return out;
}
function overlapSample() {
  const r = rects();
  let pairs = 0;
  const hit = new Uint8Array(r.length);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j];
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w <= 0 || h <= 0) continue;
    const ar = Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]));
    if (w * h > 0.15 * ar) { pairs++; hit[i] = hit[j] = 1; }
  }
  let n = 0; for (const h of hit) n += h;
  const o = S.ov;
  o.samples++; o.tags += r.length; o.pairs += pairs; o.overlapped += n;
  o.maxPairs = Math.max(o.maxPairs, pairs); o.maxOverlapped = Math.max(o.maxOverlapped, n);
  return { tags: r.length, pairs, overlapped: n };
}

const drawnIds = new Set();
// người có đầu trong màn hình (|ndc| < 0,92, trước camera) cách camera 3–24 m → cur: netId → 1 có bảng / 0 không
function onscreen() {
  const ra = window.__ra, cp = cam.position;
  for (const p of ra.positions()) {
    if (!p.drawn) continue;
    const d = Math.hypot(p.x - cp.x, p.z - cp.z);
    if (d < 3 || d > 24) continue;
    const dbg = ra.debug(p.netId);
    _v.set(p.x, (dbg ? dbg.y : 2) + 1.9, p.z).applyMatrix4(cam.matrixWorldInverse);
    if (_v.z > -0.5) continue;
    _v.applyMatrix4(cam.projectionMatrix);
    if (Math.abs(_v.x) < 0.92 && Math.abs(_v.y) < 0.92) cur.set(p.netId, drawnIds.has(p.netId) ? 1 : 0);
  }
}
function install() {
  if (orig) return;
  T = window.__ra.tags;
  // bản gỡ chồng gọi ringA/tagA (khối tham số số thực); bản cũ dot3 gọi ring/tag — bọc cái đang được dùng
  const RK = T.ringA ? 'ringA' : 'ring', TK = T.tagA ? 'tagA' : 'tag';
  orig = { begin: T.begin, [RK]: T[RK], [TK]: T[TK], end: T.end };
  T.begin = function () { spanT = -1; cam.updateMatrixWorld(); return orig.begin.apply(this, arguments); };
  T[RK] = function () { if (spanT < 0) spanT = performance.now(); return orig[RK].apply(this, arguments); };
  // bật/tắt tính trên MỌI người có đầu TRONG MÀN HÌNH và cách camera 3–24 m ở cả 2 khung (onscreen() trong end): bản cũ chỉ
  // gọi tag() cho 24 người gần nhất (người rơi khỏi top 24 biến mất mà không qua tag()), bản mới gọi cho mọi ứng viên và trả
  // false khi bảng ngoài màn hình — chỉ đếm theo lời gọi thì không công bằng
  T[TK] = function (netId) {
    if (spanT < 0) spanT = performance.now();
    const r = orig[TK].apply(this, arguments);
    if (r) { S.drawnNow++; drawnIds.add(netId); }
    return r;
  };
  T.end = function () {
    if (spanT < 0) spanT = performance.now();
    const r = orig.end.apply(this, arguments);
    const t1 = performance.now();
    if (S.on) {
      S.spanMs.push(t1 - spanT);
      S.frames++;
      S.drawnSum += S.drawnNow;
      const now = t1 / 1000;
      const flip = (id) => { S.toggles++; const l = lastToggle.get(id); if (l !== undefined && now - l < 0.5) S.flicker++; lastToggle.set(id, now); };
      onscreen();
      S.onSum += cur.size;
      for (const [id, v] of cur) { const p = prev.get(id); if (p !== undefined && p !== v) flip(id); }
      if (S.frames % S.sampleEvery === 0) overlapSample();
    }
    S.drawnNow = 0; drawnIds.clear();
    const t = prev; prev = cur; cur = t; cur.clear();
    return r;
  };
}
function uninstall() {
  if (!orig) return;
  Object.assign(T, orig); orig = null;
}
function start() {
  Object.assign(S, { on: true, frames: 0, toggles: 0, flicker: 0, drawnSum: 0, onSum: 0, spanMs: [], t0: performance.now() });
  S.ov = { samples: 0, tags: 0, pairs: 0, overlapped: 0, maxPairs: 0, maxOverlapped: 0 };
  lastToggle.clear(); prev.clear(); cur.clear();
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
function stop() {
  S.on = false;
  const sec = (performance.now() - S.t0) / 1000, o = S.ov;
  const mean = S.spanMs.reduce((a, b) => a + b, 0) / Math.max(1, S.spanMs.length);
  return {
    seconds: +sec.toFixed(1), frames: S.frames, fps: +(S.frames / sec).toFixed(1),
    tagsDrawnMean: +(S.drawnSum / Math.max(1, S.frames)).toFixed(1), onscreenPeopleMean: +(S.onSum / Math.max(1, S.frames)).toFixed(1),
    togglesPerSec: +(S.toggles / sec).toFixed(2), flickerPerSec: +(S.flicker / sec).toFixed(2), toggles: S.toggles, flicker: S.flicker,
    tagPassMs: { mean: +mean.toFixed(3), p50: +q(S.spanMs, 0.5).toFixed(3), p95: +q(S.spanMs, 0.95).toFixed(3), max: +q(S.spanMs, 1).toFixed(3) },
    overlap: { samples: o.samples, onscreenTagsMean: +(o.tags / Math.max(1, o.samples)).toFixed(1), pairsMean: +(o.pairs / Math.max(1, o.samples)).toFixed(2),
      overlappedTagsMean: +(o.overlapped / Math.max(1, o.samples)).toFixed(2), maxPairs: o.maxPairs, maxOverlapped: o.maxOverlapped },
    raStats: window.__ra.stats(),
  };
}
// camera quay chậm quanh (cx, cz) trong khi đo (người chơi nhìn quanh đám đông)
let orbitOn = false;
function orbit(cx, cz, dist, pitch, radPerSec) {
  orbitOn = true;
  const t0 = performance.now();
  const f = () => {
    if (!orbitOn) return;
    const yaw = ((performance.now() - t0) / 1000) * radPerSec;
    hp.teleport(cx, cz, yaw, pitch, dist); hp.player.group.visible = false;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}
window.__tg = { install, uninstall, start, stop, overlapSample, orbit, stopOrbit: () => { orbitOn = false; } };
export default window.__tg;
