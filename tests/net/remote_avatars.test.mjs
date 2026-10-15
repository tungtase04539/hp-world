// node --import ./tests/net/register.mjs --test tests/net/remote_avatars.test.mjs — js/net/remote_avatars.js (MP-2 C2)
// không cần trình duyệt: three thật + world/device giả + canvas giả. Kiểm: số draw call cố định ≤ 6 (≤ 5 thực tế) không
// phụ thuộc N, trần theo TIER (1 → 40, 3 → 96), chọn người GẦN camera, bảng tên ≤ 24 trong 25 m, mặt cầu, ngồi sau,
// ngoại hình 8 byte khứ hồi, API không bao giờ ném lỗi với dữ liệu hỏng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createRemoteAvatars, decodeAppearance, encodeAppearance, randomAppearanceHex } from '../../js/net/remote_avatars.js';
import { MODE, SFLAG } from '../../js/shared/constants.js';
import { packState } from '../../js/shared/quant.js';

function setup(tier) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.3, 3000);
  camera.position.set(0, 10, 30); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const ra = createRemoteAvatars({ scene, camera, tier });
  return { scene, camera, ra };
}
// N người: một nửa đi bộ vòng quanh gốc, 1/4 đứng, 1/4 xe máy — chạy `secs` giây ở 60 Hz, snapshot 10 Hz
function crowd(ra, camera, N, secs = 1.5, start = 0) {
  const app = encodeAppearance({ seed: 7, hat: 'nonla' });
  for (let k = 0; k <= secs * 10; k++) {
    const t = start + k * 100;
    for (let i = 0; i < N; i++) {
      const r = 3 + i * 0.8, a = i + t / 1000 * (i % 4 === 3 ? 0.5 : 0.2);
      const mode = i % 4 === 3 ? MODE.MOTO : MODE.WALK, spd = i % 4 === 2 ? 0 : i % 4 === 3 ? 8 : 1.5;
      const rec = { x: r * Math.sin(a), z: r * Math.cos(a), y: 2, yaw: a + Math.PI / 2, spd, state: packState(mode, 0) };
      if (k === 0) ra.enter(100 + i, rec, app, t); else ra.update(100 + i, rec, t);
    }
    for (let f = 0; f < 6; f++) ra.frame(1 / 60, t + 120 + f * 16.7, camera.position);
  }
  return ra.stats();
}

test('ngoại hình 8 byte: mã hoá/giải mã khứ hồi, byte ngẫu nhiên vẫn hợp lệ', () => {
  const L = decodeAppearance(encodeAppearance({ seed: 200, hat: 'cap', hairLong: true, mask: true, bag: true, shirt: 3, paint: 4, height: 1, shorts: true, sleeve: true }));
  assert.equal(L.seed, 200); assert.ok(L.cap && !L.nonla && L.hairLong && L.mask && L.bag && L.shorts && L.sleeve);
  assert.ok(Math.abs(L.scale - 1.06) < 1e-9);
  for (let i = 0; i < 200; i++) {
    const hex = randomAppearanceHex();
    assert.match(hex, /^[0-9a-f]{16}$/);
    const D = decodeAppearance(Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16))));
    assert.ok(D.scale >= 0.94 && D.scale <= 1.06 && Number.isInteger(D.shirt) && !(D.nonla && D.cap));
  }
  assert.doesNotThrow(() => decodeAppearance(null));
});

test('draw call CỐ ĐỊNH (≤ 6) không phụ thuộc N; TIER 3 vẽ đủ 96', () => {
  const calls = [];
  for (const N of [1, 12, 48, 96]) {
    const { ra, camera } = setup(3);
    const s = crowd(ra, camera, N);
    assert.equal(s.count, N);
    assert.equal(s.drawn, N, `N ${N}: vẽ ${s.drawn}`);
    assert.ok(s.drawCalls <= 6, `N ${N}: ${s.drawCalls} draw call`);
    calls.push(s.drawCalls);
    ra.dispose();
  }
  assert.ok(Math.max(...calls) <= 5, `draw call ${calls}`);
});

test('TIER 1: trần 40, chọn 40 người GẦN camera nhất', () => {
  const { ra, camera } = setup(1);
  const s = crowd(ra, camera, 96);
  assert.equal(s.cap, 40);
  assert.equal(s.drawn, 40, `vẽ ${s.drawn}`);
  // người được vẽ phải là người gần camera
  const far = [], near = [];
  for (let i = 0; i < 96; i++) { const d = ra.debug(100 + i); (d.sel ? near : far).push(Math.hypot(d.x - camera.position.x, d.z - camera.position.z)); }
  assert.ok(Math.max(...near) <= Math.min(...far) * 1.25 + 1, `gần ${Math.max(...near)} / xa ${Math.min(...far)}`);
});

test('bảng tên: ≤ 24, chỉ trong 25 m, cần tên', () => {
  const { ra, camera } = setup(3);
  ra.names(Array.from({ length: 96 }, (_, i) => ({ netId: 100 + i, name: `Nguyễn Thị Hường#${1000 + i}`, badge: i === 0 ? 1 : 0 })));
  let s = crowd(ra, camera, 96, 2.5);
  assert.ok(s.tags > 0 && s.tags <= 24, `tags ${s.tags}`);
  ra.names([{ netId: 100, name: 'Đặng Quốc Việt#0001' }]);   // đổi tên → ô cũ được nhả
  s = crowd(ra, camera, 96, 0.5, 2600);
  assert.ok(s.tags <= 24);
});

test('mặt cầu: y vẽ = mặt cầu khi y bản ghi ở tầng cầu, = mặt đất khi đi dưới gầm', () => {
  const { ra, camera } = setup(3);
  ra.enter(1, { x: 150, z: 0, y: 4.1, yaw: 0, spd: 0, state: 0 }, null, 0);
  ra.enter(2, { x: 152, z: 0, y: 2, yaw: 0, spd: 0, state: 0 }, null, 0);
  camera.position.set(150, 10, 30);
  for (let f = 0; f < 30; f++) ra.frame(1 / 60, 200 + f * 16.7, camera.position);
  assert.ok(Math.abs(ra.debug(1).gy - 4.1) < 1e-6 && Math.abs(ra.debug(2).gy - 2) < 1e-6);
});

test('ngồi sau: gắn vào người lái xe máy gần nhất (1 thân xe, người ngồi sau không vẽ riêng)', () => {
  const { ra, camera } = setup(3);
  ra.enter(1, { x: 0, z: 0, y: 1.8, yaw: 0, spd: 8, state: packState(MODE.MOTO, SFLAG.CARGO) }, null, 0);
  ra.enter(2, { x: 0, z: -0.6, y: 1.8, yaw: 0, spd: 8, state: packState(MODE.PILLION, 0) }, null, 0);
  let s;
  for (let f = 0; f < 10; f++) s = ra.frame(1 / 60, 200 + f * 16.7, camera.position);
  assert.equal(s.drawn, 2); assert.equal(s.peds, 0); assert.equal(s.bikes + s.bikesFar, 1);
});

test('dữ liệu hỏng / gọi sai thứ tự không bao giờ ném lỗi; self() và leave() bỏ người', () => {
  const { ra, camera } = setup(3);
  assert.doesNotThrow(() => {
    ra.update(5, { x: 1 }, 0); ra.leave(77); ra.names(null); ra.names([null, { netId: 3 }]);
    ra.enter(9, null); ra.enter(10, { x: NaN, z: 'a', y: undefined, yaw: 0, spd: -3, state: 999 }, new Uint8Array(2), 'x');
    ra.frame(NaN, undefined, null); ra.frame(1 / 60, Infinity, camera.position);
  });
  ra.enter(11, { x: 1, z: 1, y: 2, yaw: 0, spd: 0, state: 0 }, null, 100);
  ra.self(11);
  assert.equal(ra.debug(11), null);
  ra.enter(12, { x: 1, z: 1, y: 2, yaw: 0, spd: 0, state: 0 }, null, 100);
  ra.leave(12);
  assert.equal(ra.debug(12), null);
  ra.keep([]);
  assert.equal(ra.frame(1 / 60, 400, camera.position).count, 0);
  assert.deepEqual(ra.markers(), []);   // người lạ mặc định ẩn trên minimap
});

test('hide(netId): người đã chặn không vẽ (thân/vòng sáng/bảng tên/minimap), bỏ chặn thì hiện lại (fixer vòng 1 SAFE-3)', () => {
  const { ra, camera } = setup(3);
  crowd(ra, camera, 12);
  ra.setMarkerAll(true);
  const before = ra.stats().drawn;
  ra.hide(103, true);
  for (let f = 0; f < 3; f++) ra.frame(1 / 60, 1800 + f * 16.7, camera.position);
  const p = ra.positions().find((q) => q.netId === 103);
  assert.ok(p && p.hidden && !p.drawn, 'người bị ẩn vẫn trong danh sách nhưng không vẽ');
  assert.equal(ra.stats().drawn, before - 1);
  assert.ok(!ra.markers().some((m) => Math.abs(m.x - p.x) < 1e-6 && Math.abs(m.z - p.z) < 1e-6), 'không có chấm minimap');
  ra.hide(103, false);
  for (let f = 0; f < 3; f++) ra.frame(1 / 60, 1900 + f * 16.7, camera.position);
  assert.equal(ra.stats().drawn, before);
  ra.dispose();
});
