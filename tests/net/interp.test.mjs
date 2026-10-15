// node --test tests/net/interp.test.mjs — js/net/interp.js (MP-2 C2): nội suy 100–150 ms, ngoại suy ≤ 250 ms,
// nhảy > 8 m, mẫu giữ chỗ sau khi đứng yên, độ lệch hiển thị tắt dần, đồng hồ snapshot chống rung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Track, INTERP, createSnapClock, wrapAngle, lerpAngle } from '../../js/net/interp.js';
import { simulate } from './interp_sim.mjs';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} ≉ ${b} (±${eps})`);

test('wrapAngle / lerpAngle đi cung ngắn nhất', () => {
  near(Math.abs(wrapAngle(3 * Math.PI)), Math.PI, 1e-9);
  near(wrapAngle(-3 * Math.PI / 2), Math.PI / 2, 1e-9);
  near(lerpAngle(3.0, -3.0, 0.5), Math.PI, 0.01);     // qua ±π, không qua 0
  near(lerpAngle(0.2, 0.4, 0.5), 0.3, 1e-9);
});

test('nội suy tuyến tính giữa 2 mẫu kẹp renderT', () => {
  const tr = new Track();
  tr.push(1000, 0, 2, 0, 0, 3, 0);
  tr.push(1100, 0.3, 2, 0, 0, 3, 0);
  tr.push(1200, 0.6, 2, 0, 0, 3, 0);
  const o = tr.sampleAt(1150, {});
  near(o.x, 0.45, 1e-9); near(o.z, 0, 1e-9); assert.equal(o.extrap, 0);
});

test('delay tự chỉnh trong [100, 150] ms theo nhịp mẫu', () => {
  for (const [iv, lo, hi] of [[100, 115, 125], [200, 149, 150], [50, 100, 101]]) {
    const tr = new Track();
    let now = 0;
    for (let i = 0; i < 300; i++) {
      const t = i * iv;
      tr.push(t, i * 0.3, 2, 0, 0, 3, 0);
      for (let f = 0; f < iv / 16; f++) { now = t + f * 16; tr.sample(now, {}); }
    }
    assert.ok(tr.delay >= lo && tr.delay <= hi, `iv ${iv}: delay ${tr.delay}`);
    assert.ok(tr.delay >= INTERP.DELAY_MIN_MS && tr.delay <= INTERP.DELAY_MAX_MS);
  }
});

test('ngoại suy theo vận tốc, chặn 250 ms rồi đứng', () => {
  const tr = new Track();
  tr.push(0, 0, 2, 0, Math.PI / 2, 10, 4);
  tr.push(100, 1, 2, 0, Math.PI / 2, 10, 4);
  let o = tr.sampleAt(200, {});
  near(o.x, 2, 1e-6, 'ngoại suy 100 ms'); near(o.extrap, 100, 1e-9);
  o = tr.sampleAt(1000, {});
  near(o.x, 1 + 10 * 0.25, 1e-6, 'chặn 250 ms');
  assert.ok(o.extrap > 250);
});

test('người đứng (spd 0) không bị ngoại suy trôi', () => {
  const tr = new Track();
  tr.push(0, 5, 2, 5, 0, 0, 0);
  tr.push(100, 5.02, 2, 5, 0, 0, 0);   // rung lượng tử
  const o = tr.sampleAt(400, {});
  near(o.x, 5.02, 1e-9);
});

test('lệch > 8 m so với quỹ đạo dự đoán → NHẢY (xoá đệm)', () => {
  const tr = new Track();
  tr.push(0, 0, 2, 0, 0, 3, 0);
  tr.push(100, 0.3, 2, 0, 0, 3, 0);
  tr.sampleAt(-20, {});
  assert.equal(tr.push(200, 50, 2, 0, 0, 3, 0), 1);
  assert.equal(tr.size, 1);
  const o = tr.sampleAt(80, {});
  near(o.x, 50, 1e-9); assert.equal(o.snapped, true);
  // xe máy 16 m/s mất gói 1 s: dự đoán theo vận tốc → KHÔNG nhảy
  const tb = new Track();
  tb.push(0, 0, 2, 0, 0, 16, 4); tb.push(100, 1.6, 2, 0, 0, 16, 4);
  assert.equal(tb.push(1100, 17.6, 2, 0, 0, 16, 4), 0);
});

test('mẫu cũ / đảo thứ tự bị bỏ, cùng t thì ghi đè', () => {
  const tr = new Track();
  tr.push(100, 1, 2, 0, 0, 3, 0);
  assert.equal(tr.push(50, 9, 2, 0, 0, 3, 0), -1);
  assert.equal(tr.push(100, 2, 2, 0, 0, 3, 0), 0);
  assert.equal(tr.size, 1);
  near(tr.sampleAt(100, {}).x, 2, 1e-9);
});

test('đứng lâu rồi đi: chèn mẫu giữ chỗ → bắt đầu đi đúng lúc', () => {
  const tr = new Track();
  tr.push(0, 0, 2, 0, 0, 0, 0);           // đứng
  tr.push(5000, 0.3, 2, 0, 0, 3, 0);      // 5 s sau mới có mẫu (máy chủ không gửi khi không đổi)
  assert.equal(tr.size, 3, 'mẫu giữ chỗ tại 4900');
  near(tr.sampleAt(4800, {}).x, 0, 1e-9, 'vẫn đứng trước 4900');
  near(tr.sampleAt(4950, {}).x, 0.15, 1e-9);
  // đang chạy mà mất gói 600 ms: KHÔNG chèn (nội suy thẳng)
  const t2 = new Track();
  t2.push(0, 0, 2, 0, 0, 7, 1); t2.push(100, 0.7, 2, 0, 0, 7, 1); t2.push(700, 4.9, 2, 0, 0, 7, 1);
  assert.equal(t2.size, 3);
  near(t2.sampleAt(400, {}).x, 2.8, 1e-9);
});

test('gói trễ sau khi đã ngoại suy: không giật (độ lệch tắt dần), không nhảy', () => {
  const tr = new Track();
  tr.push(0, 0, 2, 0, 0, 10, 4); tr.push(100, 1, 2, 0, 0, 10, 4);
  const a = tr.sampleAt(300, {});                  // ngoại suy 200 ms → x = 3
  near(a.x, 3, 1e-6);
  tr.push(200, 1.5, 2, 0, 0, 5, 4);                 // thật ra đã phanh
  const b = tr.sampleAt(301, {});
  assert.ok(Math.abs(b.x - a.x) < 0.2, `liền mạch ${a.x} → ${b.x}`);
  let o; for (let T = 302; T < 900; T += 16) o = tr.sampleAt(T, {});
  near(o.x, tr._raw(o.renderT, {}).x, 0.01, 'độ lệch đã tắt');
});

test('createSnapClock: đường bao dưới khử rung', () => {
  const c = createSnapClock();
  let maxErr = 0;
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 400; i++) {
    const tick = 1000 + i * 2, send = tick * 50 + 123456;
    const arr = send + 30 + rnd() * 90;
    const t = c.time(tick, arr);
    if (i > 20) maxErr = Math.max(maxErr, Math.abs(t - (send + 30)));
  }
  assert.ok(maxErr < 12, `sai số dấu thời gian ${maxErr} ms`);
  // máy chủ khởi động lại (tick về 0) → đặt lại
  const t0 = c.time(0, 999999);
  near(t0, 999999, 1e-9);
});

test('mô phỏng luồng 10 Hz rung + TCP kẹt chùm + resume: sai số nhỏ, không giật', () => {
  for (const seed of [1, 2, 3]) {
    const r = simulate({ seed }).summary;
    assert.ok(r.p50 < 0.12, `seed ${seed} p50 ${r.p50}`);
    assert.ok(r.steadyP95 < 0.4, `seed ${seed} p95 lúc ổn định ${r.steadyP95}`);
    assert.ok(r.maxFrameJump < 2, `seed ${seed} bước khung lớn nhất ${r.maxFrameJump}`);
    assert.equal(r.snaps, 2, 'chỉ nhảy lúc vào + lúc resume ở chỗ khác');
    assert.ok(r.delayMs >= 100 && r.delayMs <= 150);
  }
  const d = simulate({ seed: 4, loss: 'drop' }).summary;   // mất hẳn gói: vẫn chạy, ít nhảy
  assert.ok(d.p50 < 0.15 && d.snaps <= 6, JSON.stringify(d));
});
