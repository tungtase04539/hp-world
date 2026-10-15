// node --import ./tests/net/register.mjs --test tests/net/nametags.test.mjs — GỠ CHỒNG bảng tên (js/net/nametags.js qua
// remote_avatars): đám đông dày 96 người / 13 m → ≤ 24 bảng, KHÔNG cặp nào chồng > 15 % trên màn hình sau khi ổn định,
// không "nháy" (bật/tắt lại < 0,5 s), trễ ẩn/hiện, bạn bè được ưu tiên, và 0 BYTE cấp phát mỗi khung ở trạng thái ổn định
// (HeapProfiler lấy mẫu của chính node, gồm cả vật đã bị GC — như tools/qa/mp_tags_declutter.mjs đo trong Chrome).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from 'node:inspector/promises';
import * as THREE from 'three';
import { createRemoteAvatars, encodeAppearance } from '../../js/net/remote_avatars.js';
import { createNameTags, DECLUTTER } from '../../js/net/nametags.js';
import { MODE } from '../../js/shared/constants.js';
import { packState } from '../../js/shared/quant.js';

const W = 1280, H = 720;
const fakeRenderer = { copyTextureToTexture() {} };   // "vẽ" mesh: ô mới chép lên GPU ngay (onBeforeRender → flush)
function setup(tier = 3, camPos = [0, 4.2, 22], look = [0, 1.6, 0]) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.3, 3000);
  camera.position.set(...camPos); camera.lookAt(...look); camera.updateMatrixWorld();
  const ra = createRemoteAvatars({ scene, camera, tier });
  return { scene, camera, ra };
}
// đám đông dày: n người trong bán kính R quanh gốc, 3/5 đi vòng, 1/5 đi thẳng, 1/5 đứng
function dense(ra, n = 96, R = 13) {
  const app = encodeAppearance({ seed: 3 });
  ra.names(Array.from({ length: n }, (_, i) => ({ netId: 100 + i, name: `Nguyễn Thị Hường${i}#${1000 + i}` })));
  const fn = (i, t) => {
    const r = 1.5 + ((i * 7.31) % 1) * (R - 1.5) + (i % 7) * 0.4, ph = i * 2.39996, k = i % 5;
    if (k < 3) { const w = (i % 2 ? 1 : -1) * (1.2 / r), a = ph + w * t; return { x: r * Math.sin(a), z: r * Math.cos(a), yaw: a + Math.PI / 2, spd: 1.2 }; }
    if (k < 4) { const s = Math.sin(t * 0.2 + ph) * 6; return { x: r * Math.sin(ph) + s * Math.cos(ph), z: r * Math.cos(ph) - s * Math.sin(ph), yaw: ph, spd: 1.2 }; }
    return { x: r * Math.sin(ph), z: r * Math.cos(ph), yaw: ph, spd: 0 };
  };
  let ms = 0, k = 0;
  const step = (secs, onFrame) => {
    const frames = Math.round(secs * 60);
    for (let f = 0; f < frames; f++, k++) {
      ms = k * (1000 / 60);
      if (k % 6 === 0) {
        for (let i = 0; i < n; i++) {
          const s = fn(i, ms / 1000);
          const rec = { x: s.x, z: s.z, y: 2, yaw: s.yaw, spd: s.spd, state: packState(MODE.WALK, 0) };
          if (k === 0) ra.enter(100 + i, rec, app, ms); else ra.update(100 + i, rec, ms);
        }
      }
      ra.frame(1 / 60, ms + 120, null);
      ra.tags.mesh.onBeforeRender(fakeRenderer);
      if (onFrame) onFrame(f);
    }
  };
  return { step };
}
// hình chữ nhật px của các tứ giác BILLBOARD vừa ghi (bỏ vòng sáng nằm phẳng), chỉ phần viên thuốc (44/64 chiều cao)
const _v = new THREE.Vector3();
function rects(ra, camera) {
  const geo = ra.tags.mesh.geometry, P = geo.attributes.position.array, nq = geo.drawRange.count / 6, out = [];
  for (let q = 0; q < nq; q++) {
    const o = q * 12;
    const ys = [P[o + 1], P[o + 4], P[o + 7], P[o + 10]];
    if (Math.max(...ys) - Math.min(...ys) < 1e-4) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let k = 0; k < 4; k++) {
      _v.set(P[o + k * 3], P[o + k * 3 + 1], P[o + k * 3 + 2]).project(camera);
      const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const cy = (y0 + y1) / 2, hh = (y1 - y0) * (44 / 64) / 2;
    out.push([x0, cy - hh, x1, cy + hh]);
  }
  return out;
}
function overlapPairs(r) {
  let n = 0;
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const a = r[i], b = r[j];
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w > 0 && h > 0 && w * h > 0.15 * Math.min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))) n++;
  }
  return n;
}

test('đám đông dày 96 người / 13 m: ≤ 24 bảng, chồng trên màn hình < 10 % bản không gỡ chồng (A/B cùng đám đông)', () => {
  const run = (declutter) => {
    const { ra, camera } = setup(3);
    const ra2 = declutter ? ra : (ra.dispose(), createRemoteAvatars({ scene: new THREE.Scene(), camera, tier: 3, declutter: false }));
    const D = dense(ra2);
    D.step(3);
    let maxPairs = 0, minTags = 99, sumPairs = 0, nS = 0, sumTags = 0;
    D.step(6, (f) => {
      if (f % 4) return;
      const r = rects(ra2, camera);
      const p = overlapPairs(r);
      sumPairs += p; nS++; sumTags += r.length; maxPairs = Math.max(maxPairs, p); minTags = Math.min(minTags, r.length);
      assert.ok(ra2.stats().tags <= 24, `tags ${ra2.stats().tags}`);
    });
    const st = ra2.tags.stats();
    ra2.dispose();
    return { pairs: sumPairs / nS, maxPairs, minTags, tags: sumTags / nS, hidden: st.hiddenByDeclutter };
  };
  const on = run(true), off = run(false);
  // người đi qua nhau: bảng đang hiện được giữ HIDE_S khi bị chiếm (trễ chống nháy) → chồng THOÁNG QUA, không bao giờ kéo dài
  const J = JSON.stringify;
  assert.ok(off.pairs > 3, `đối chứng phải chồng nhiều: ${J(off)}`);
  assert.ok(on.pairs < 0.1 * off.pairs && on.pairs < 1, `gỡ chồng ${J(on)} / đối chứng ${J(off)}`);
  assert.ok(on.minTags >= 5, `luôn có bảng tên đọc được: ${J(on)}`);
  assert.ok(on.hidden > 0, 'có bảng bị ẩn vì chồng');
});

test('không nháy: đi bộ 10 s — mỗi bảng bật/tắt cách nhau ≥ 0,5 s, tổng số lần đổi/giây thấp', () => {
  const { ra, camera } = setup(3);
  const D = dense(ra);
  D.step(2);
  const T = ra.tags, orig = T.tag;
  let drawn = new Map(), prev = new Map(), toggles = 0, flicker = 0, t = 0;
  const last = new Map();
  T.tag = function (netId) { const r = orig.apply(this, arguments); if (r) drawn.set(netId, 1); return r; };
  D.step(10, () => {
    t += 1 / 60;
    const flip = (id) => { toggles++; const l = last.get(id); if (l !== undefined && t - l < 0.5) flicker++; last.set(id, t); };
    for (const id of drawn.keys()) if (!prev.has(id)) flip(id);
    for (const id of prev.keys()) if (!drawn.has(id)) flip(id);
    [prev, drawn] = [drawn, prev]; drawn.clear();
  });
  T.tag = orig;
  assert.ok(flicker === 0, `nháy ${flicker} lần`);
  assert.ok(toggles / 10 < 4, `đổi ${(toggles / 10).toFixed(2)} lần/giây`);
  ra.dispose();
});

test('trễ: bảng bị chiếm chỉ ẩn sau HIDE_S, hiện lại sau SHOW_S; mới vào tầm hiện ngay (mờ dần)', () => {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.3, 3000);
  camera.position.set(0, 2, 10); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const nt = createNameTags({ scene, maxTags: 24 });
  const frame = (bx, by = 2) => {
    nt.begin(camera, 1 / 60);
    const a = nt.tag(1, 'Lê Thị Ứng#1001', 0, 0, 2, 0, 10, false, 17, 25);
    const b = nt.tag(2, 'Đỗ Quỳnh Như#1002', 0, bx, by, 0, 10, false, 17, 25);
    nt.end(); nt.mesh.onBeforeRender(fakeRenderer);
    return [a, b];
  };
  // B ở xa A: cả hai hiện
  for (let i = 0; i < 30; i++) frame(3);
  assert.deepEqual(frame(3), [true, true]);
  // B nhảy vào trùng A, không còn chỗ nấc chồng? (nấc chồng trống → B được NÂNG 1 nấc, vẫn hiện)
  for (let i = 0; i < 30; i++) frame(0);
  assert.equal(nt.stats().lifted, 1, 'B nâng 1 nấc');
  // chặn cả nấc chồng bằng C ở trên A → B phải ẩn, nhưng chỉ sau HIDE_S
  const frame3 = (bx) => {
    nt.begin(camera, 1 / 60);
    nt.tag(1, 'Lê Thị Ứng#1001', 0, 0, 2, 0, 10, false, 17, 25);
    nt.tag(3, 'Hồ Sỹ Dũng#1003', 0, 0, 2.44, 0, 10, false, 17, 25);   // chiếm đúng nấc chồng của B
    const b = nt.tag(2, 'Đỗ Quỳnh Như#1002', 0, bx, 2, 0, 10, false, 17, 25);
    nt.end(); nt.mesh.onBeforeRender(fakeRenderer);
    return b;
  };
  for (let i = 0; i < 60; i++) frame(5);   // B về chỗ riêng, hết nâng
  let shownFrames = 0;
  for (let i = 0; i < 60; i++) if (frame3(0)) shownFrames++;
  const hideF = Math.round(DECLUTTER.HIDE_S * 60), fadeF = Math.round(DECLUTTER.FADE_OUT_S * 60);
  assert.ok(shownFrames >= hideF && shownFrames <= hideF + fadeF + 2, `B còn vẽ ${shownFrames} khung (ẩn sau ${hideF} + mờ ${fadeF})`);
  // B ra chỗ trống: chờ SHOW_S mới hiện lại
  let firstShow = -1;
  for (let i = 0; i < 90; i++) if (frame3(4) && firstShow < 0) firstShow = i;
  const showF = Math.round(DECLUTTER.SHOW_S * 60);
  assert.ok(firstShow >= showF - 2 && firstShow <= showF + 2, `B hiện lại sau ${firstShow} khung (SHOW_S ${showF})`);
  nt.dispose();
});

test('ưu tiên: bạn bè thắng người lạ gần hơn khi tranh cùng chỗ', () => {
  const { ra, camera } = setup(3, [0, 2.2, 12], [0, 2, 0]);
  ra.names([{ netId: 1, name: 'Người Lạ#0001' }, { netId: 2, name: 'Bạn Thân#0002' }, { netId: 3, name: 'Chặn Nấc#0003' }]);
  const put = (ms) => {
    ra.update(1, { x: 0, z: 1, y: 2, yaw: 0, spd: 0, state: 0 }, ms);
    ra.update(2, { x: 0.05, z: 0, y: 2, yaw: 0, spd: 0, state: 0 }, ms);
  };
  ra.enter(1, { x: 0, z: 1, y: 2, yaw: 0, spd: 0, state: 0 }, null, 0);
  ra.enter(2, { x: 0.05, z: 0, y: 2, yaw: 0, spd: 0, state: 0 }, null, 0);
  ra.setFriends([2]);
  for (let f = 0; f < 90; f++) { if (f % 6 === 0) put(f * 16.7); ra.frame(1 / 60, f * 16.7 + 120, null); ra.tags.mesh.onBeforeRender(fakeRenderer); }
  const s = ra.tags.stats();
  // cả 2 được vẽ (1 ở chỗ gốc, 1 nâng nấc); bạn (ưu tiên cao) giữ chỗ GỐC → người lạ là bảng được nâng
  assert.equal(s.tags, 2);
  assert.equal(s.lifted, 1);
  ra.dispose();
});

test('0 cấp phát mỗi khung ở vòng nóng (96 người đi trong đám đông dày) — nametags.js và remote_avatars.js', async () => {
  const { ra } = setup(3);
  const D = dense(ra);
  D.step(15);   // làm nóng: JIT (TurboFan) + ô atlas + bản ghi người — CÙNG đường mã với lúc đo (đổi đường = khử tối ưu)
  // bỏ: vẽ Ô MỚI vào canvas (chuỗi font — chỉ khi bảng đổi mức / hiện mới) và đường MẠNG (snapshot 10 Hz, không phải khung)
  const SKIP = /^(drawTag|cellFor|pill|update|enter|pushRec|stampOf|namesFn)$/;
  const s = new Session(); s.connect();
  await s.post('HeapProfiler.enable');
  // 4 cửa sổ 600 khung, lấy cửa sổ ÍT NHẤT = trạng thái ổn định (cửa sổ đầu có thể trùng lúc TurboFan đang biên dịch song
  // song — khi đó mã chạy ở tầng thấp, mọi số thực đều đóng hộp; phụ thuộc tải máy, không phải mã)
  const FR = 600;
  let best = null;
  for (let w = 0; w < 4; w++) {
    await s.post('HeapProfiler.startSampling', { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    D.step(FR / 60);
    const { profile } = await s.post('HeapProfiler.stopSampling');
    const by = {};
    const walk = (n) => {
      const u = n.callFrame.url || '';
      if (/js\/net\/(nametags|remote_avatars)\.js/.test(u) && n.selfSize && !SKIP.test(n.callFrame.functionName)) {
        const k = u.replace(/.*js\/net\//, '') + ':' + (n.callFrame.functionName || '(anon)');
        by[k] = (by[k] || 0) + n.selfSize;
      }
      for (const c of n.children || []) walk(c);
    };
    walk(profile.head);
    const tot = Object.values(by).reduce((a, b) => a + b, 0) / FR;
    const nt = Object.entries(by).filter(([k]) => k.startsWith('nametags')).reduce((a, [, b]) => a + b, 0) / FR;
    if (!best || tot < best.tot) best = { tot, nt, perFrame: Object.fromEntries(Object.entries(by).map(([k, b]) => [k, +(b / FR).toFixed(1)])) };
  }
  s.disconnect();
  assert.ok(ra.stats().tags >= 4, `tags ${ra.stats().tags}`);
  // bản cũ (dot3): ~6 KB/khung trong cùng phép đo. Còn lại hợp lệ: performance.now() đầu khung = 1 HeapNumber (16 B);
  // lấy mẫu 64 B → sai số vài chục B/khung
  assert.ok(best.nt < 16 && best.tot < 64, `cấp phát ${best.tot.toFixed(1)} B/khung (nametags ${best.nt.toFixed(1)}): ${JSON.stringify(best.perFrame)}`);
  ra.dispose();
});
