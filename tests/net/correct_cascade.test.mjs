// node --test tests/net/correct_cascade.test.mjs — NC-1 (fixer vòng 1): một CORRECT nhỏ (1,5–6 m, đường KÉO MƯỢT) phải
// kết thúc bằng ĐÚNG 1 CORRECT, không dây chuyền, không bị đuổi.
// Mô phỏng client (js/net/correct.js + luật của net.js preFrame: `pulled = corr.step(dt)`; đang `pending` thì CHƯA gửi
// STATE) chạy với Validator THẬT của máy chủ (server/src/game/validate.js → js/shared/move.js MoveCheck.correctTo),
// khung 60/30 Hz, RTT 5/50/150 ms. Người chơi đi bộ liên tục; ở t = 4 s vị trí nhảy lên d m (va chạm đẩy ra, mép bờ,
// kẹp vùng chơi…) khi điểm vi phạm đã 5,5 → vi phạm kế tiếp sinh CORRECT.
// Bản cũ (gửi STATE ngay khung sau CORRECT, gate=false): 3–8 CORRECT liên tiếp (đo trên trình duyệt thật: 15 rồi kick).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Validator } from '../../server/src/game/validate.js';
import { MCF } from '../../js/shared/move.js';
import { MODE } from '../../js/shared/constants.js';
import { createCorrector, SNAP_M } from '../../js/net/correct.js';

function run({ d, rttMs, fps = 60, walk = 2.8, gate = true, seconds = 8 }) {
  const v = new Validator(); v.extraFlags = MCF.SKIP_SURFACE;
  let t = 1000; v.reset(0, 0, MODE.WALK, t, true);
  const pos = { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const pState = { pos, mounted: null, vy: 0, yaw: 0 };
  const corr = createCorrector({ pState, surfaceY: () => 0 });
  let srvEpoch = 0, cliEpoch = 0, ex = 0, ez = 0, nextStateAt = 0;
  const q = [];
  let corrections = 0, kicked = false, viol = 0;
  const dt = 1000 / fps;
  const sendCorrect = (bump) => {
    if (bump) { srvEpoch = (srvEpoch + 1) & 255; v.corrected(ex, ez, MODE.WALK, t); }
    corrections++;
    q.push({ at: t + rttMs / 2, to: 'c', m: { x: ex, z: ez, y: 0, yaw: 0, epoch: srvEpoch, reason: 1 } });
  };
  let injected = false;
  for (let f = 0; f < fps * seconds; f++) {
    t += dt;
    for (let i = 0; i < q.length; i++) {
      const e = q[i]; if (e.at > t) continue; q.splice(i--, 1);
      if (e.to === 'c') { cliEpoch = e.m.epoch; corr.apply(e.m); nextStateAt = 0; continue; }
      if (kicked) continue;
      const m = e.m;
      if (m.corrEpoch !== srvEpoch) { const a = v.onStale(t); if (a === 'resend') sendCorrect(false); else if (a === 'kick') kicked = true; continue; }
      const r = v.onState(m.clientMs, m.x, m.z, MODE.WALK, t, true);
      if (r.accepted) { ex = m.x; ez = m.z; continue; }
      viol++;
      if (r.kick) { kicked = true; continue; }
      if (r.correct) sendCorrect(true);
    }
    pos.x += walk * dt / 1000;                       // người chơi vẫn đi tiếp trong lúc bị kéo
    if (!injected && t > 4000) { injected = true; pos.x += d; v.points = 5.5; v.pointsT = t; }
    corr.step(dt / 1000);
    if (gate && corr.pending) continue;            // net.js preFrame: chưa gửi STATE khi đang kéo
    if (t >= nextStateAt) {
      q.push({ at: t + rttMs / 2, to: 's', m: { clientMs: Math.floor(t) & 0xffff, x: pos.x, z: pos.z, corrEpoch: cliEpoch } });
      nextStateAt = t + 1000 / 15;
    }
  }
  return { corrections, kicked, viol, points: v.points };
}

test('CORRECT nhỏ (kéo mượt) → đúng 1 CORRECT, không bị đuổi (60/30 Hz, RTT 5/50/150 ms, lệch 1,5–6 m)', () => {
  for (const fps of [60, 30]) for (const rttMs of [5, 50, 150]) for (const d of [1.5, 2, 3, 4, 5, SNAP_M - 0.05]) {
    const r = run({ d, rttMs, fps });
    assert.equal(r.kicked, false, `bị đuổi d=${d} rtt=${rttMs} fps=${fps}`);
    assert.equal(r.corrections, 1, `d=${d} m rtt=${rttMs} ms fps=${fps}: ${r.corrections} CORRECT (vi phạm ${r.viol})`);
  }
});

test('CORRECT lớn (> SNAP_M, nhảy hẳn) → 1 CORRECT', () => {
  for (const rttMs of [5, 150]) {
    const r = run({ d: 12, rttMs });
    assert.equal(r.kicked, false);
    assert.equal(r.corrections, 1);
  }
});

test('đối chứng: bỏ luật giữ STATE (bản trước NC-1) thì CORRECT dây chuyền', () => {
  const r = run({ d: 4, rttMs: 5, gate: false });
  assert.ok(r.corrections > 1, `mong > 1 CORRECT khi không giữ STATE, được ${r.corrections}`);
});
