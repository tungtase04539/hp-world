// tests/net/interp_sim.mjs — mô phỏng ĐẦU-CUỐI luồng vị trí 1 người chơi khác qua mạng (MP-2 C2), thuần node:
//   người chơi B (quỹ đạo thật: đi bộ → chạy vòng → đứng 5 s → xe máy lượn → rớt mạng 2 s rồi RESUME ở chỗ khác → xe máy
//   + mất gói thành chùm) gửi STATE 15 Hz khi di chuyển / 2 Hz khi đứng, trễ lên 30–70 ms
//   → máy chủ tick 20 Hz, giữ STATE mới nhất, snapshot 10 Hz cho người xem, CHỈ gửi khi bản ghi đổi, lượng tử x/z 5 cm
//   → trễ xuống 30 ms + rung 0–90 ms (+ đuôi dài), mất gói theo chùm
//   → người xem: createSnapClock(tick, giờ nhận) → Track.push; khung hình 60 Hz (thỉnh thoảng khựng 50 ms) → Track.sample.
// Sai số = |vị trí vẽ(T) − quỹ đạo thật(T − A)|, A = độ trễ hiển thị cố định khớp nhất (quét 0–400 ms) — đo RUNG/GIẬT
// chứ không đo độ trễ cố định (độ trễ in riêng: delay + A). Dùng bởi interp.test.mjs và (ghi JSON) tools/qa/mp_c2_interp.mjs.
import { Track, createSnapClock } from '../../js/net/interp.js';
import { qPos, dqPos, qSpd, dqSpd, qYaw, dqYaw } from '../../js/shared/quant.js';

export function truthAt(t) {   // t giây → {x, z, yaw, spd, mode}
  // 0–10 đi bộ 3 m/s về +x, 10–20 chạy 7 m/s vòng tròn R 20, 20–25 đứng, 25–60 xe máy 16 m/s lượn sin
  if (t < 10) return { x: 3 * t, z: 0, yaw: Math.PI / 2, spd: 3, mode: 0 };
  const x0 = 30;
  if (t < 20) {
    const a = (7 * (t - 10)) / 20;   // rad
    return { x: x0 + 20 * Math.sin(a), z: 20 - 20 * Math.cos(a), yaw: Math.PI / 2 - a, spd: 7, mode: 1 };
  }
  const a1 = (7 * 10) / 20, x1 = x0 + 20 * Math.sin(a1), z1 = 20 - 20 * Math.cos(a1);
  if (t < 25) return { x: x1, z: z1, yaw: Math.PI / 2 - a1, spd: 0, mode: 0 };
  // xe máy: tăng tốc 3,6 m/s² tới 16, đi theo x, lượn z = 6 sin(x/25)
  const u = t - 25, tA = 16 / 3.6;
  const s = u < tA ? 0.5 * 3.6 * u * u : 0.5 * 3.6 * tA * tA + 16 * (u - tA);
  const v = u < tA ? 3.6 * u : 16;
  const x = x1 + s, z = z1 + 6 * Math.sin(s / 25), dzdx = (6 / 25) * Math.cos(s / 25);
  return { x, z, yaw: Math.atan2(1, dzdx), spd: v * Math.hypot(1, dzdx) / Math.hypot(1, dzdx), mode: 4 };
}

export function simulate({ seed = 1, dur = 60, fps = 60, disconnect = [40, 42], loss = 'stall', debug = null } = {}) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // --- B gửi STATE: 15 Hz khi di chuyển, 2 Hz khi đứng, tại biên khung 60 Hz của máy B ---
  const states = [];   // {recv (ms máy chủ), x, z, yaw, spd, mode}
  let tB = 0, last = -1e9;
  while (tB < dur * 1000) {
    const tr = truthAt(tB / 1000), iv = tr.spd > 0.05 ? 1000 / 15 : 500;
    if (tB - last >= iv - 0.5) { last = tB; states.push({ recv: tB + 30 + rnd() * 40, sent: tB, ...tr }); }
    tB += 1000 / 60;
  }
  for (let i = 1; i < states.length; i++) if (states[i].recv < states[i - 1].recv) states[i].recv = states[i - 1].recv;   // TCP: đến theo thứ tự gửi
  // --- máy chủ: tick 50 ms, snapshot 10 Hz (tick chẵn), chỉ gửi khi bản ghi lượng tử đổi ---
  const snaps = [];   // {tick, arrival, x, z, yaw, spd, state, kf}
  let si = 0, cur = null, prevKey = '', burst = 0, stallEnd = 0;
  const offline = (t) => t >= disconnect[0] * 1000 && t < disconnect[1] * 1000;
  let wasOffline = false;
  for (let tick = 0; tick * 50 < dur * 1000; tick++) {
    const tS = tick * 50;
    while (si < states.length && states[si].recv <= tS) cur = states[si++];
    if (!cur || tick % 2) continue;
    if (offline(tS)) { wasOffline = true; continue; }
    const q = { x: dqPos(qPos(cur.x)), z: dqPos(qPos(cur.z)), yaw: dqYaw(qYaw(cur.yaw)), spd: dqSpd(qSpd(cur.spd)), state: cur.mode };
    const key = `${q.x},${q.z},${q.yaw},${q.spd},${q.state}`;
    const kf = wasOffline; wasOffline = false;
    if (key === prevKey && !kf) continue;
    prevKey = key;
    let lat = 30 + rnd() * 60; if (rnd() < 0.05) lat += 60 + rnd() * 150;     // đuôi dài (bufferbloat ngắn)
    if (loss === 'drop' && !kf) {          // mất hẳn (UDP/WebTransport sau này) — chùm 3–6 snapshot
      if (burst > 0) { burst--; continue; }
      if (rnd() < 0.012) { burst = 2 + Math.floor(rnd() * 4); continue; }
    } else if (loss === 'stall' && !kf) {  // TCP: không mất, nhưng truyền lại làm KẸT cả chùm 3–6 snapshot rồi xả một lúc
      if (burst > 0) { burst--; lat = Math.max(lat, stallEnd - tS); }
      else if (rnd() < 0.012) { burst = 2 + Math.floor(rnd() * 4); stallEnd = tS + 250 + (burst + 1) * 100 + rnd() * 150; lat = stallEnd - tS; }
    }
    snaps.push({ tick, arrival: tS + lat, ...q, kf });
  }
  // TCP: gói đến THEO THỨ TỰ GỬI — gói sau không vượt gói trước (trễ đuôi dài làm dồn cả chùm sau nó)
  for (let i = 1; i < snaps.length; i++) if (snaps[i].arrival < snaps[i - 1].arrival) snaps[i].arrival = snaps[i - 1].arrival;
  // --- người xem ---
  const clock = createSnapClock(), tr = new Track(), out = {};
  let k = 0, now = 0, frame = 0;
  const frames = [];   // {now, renderT, x, z, yaw, extrap, snapped}
  while (now < dur * 1000) {
    while (k < snaps.length && snaps[k].arrival <= now) {
      const p = snaps[k++];
      tr.push(clock.time(p.tick, p.arrival), p.x, 2, p.z, p.yaw, p.spd, p.state);
    }
    tr.sample(now, out);
    frames.push({ now, renderT: out.renderT, x: out.x, z: out.z, yaw: out.yaw, extrap: out.extrap, snapped: out.snapped, delay: out.delay, ox: tr.ox });
    if (debug && now >= debug[0] && now <= debug[1]) {
      const ss = []; for (let i = Math.max(0, tr.n - 4); i < tr.n; i++) { const kk = tr._k(i); ss.push(`${tr.t[kk].toFixed(0)}:${tr.x[kk].toFixed(2)}`); }
      console.log(now.toFixed(0), 'R', out.renderT.toFixed(0), 'x', out.x.toFixed(2), 'ox', tr.ox.toFixed(2), 'ex', out.extrap.toFixed(0), '|', ss.join(' '));
    }
    frame++;
    now += frame % 240 === 0 ? 50 : 1000 / fps;   // khựng 50 ms mỗi 4 s
  }
  // --- sai số theo độ trễ hiển thị khớp nhất ---
  const errAt = (A, f) => { const g = truthAt(Math.max(0, (f.renderT - A) / 1000)); return Math.hypot(f.x - g.x, f.z - g.z); };
  const valid = (f) => f.now > 1500 && !(f.now >= disconnect[0] * 1000 - 300 && f.now < disconnect[1] * 1000 + 800);
  let bestA = 0, bestM = Infinity;
  for (let A = 0; A <= 400; A += 5) {
    let m = 0, n = 0;
    for (let i = 0; i < frames.length; i += 7) if (valid(frames[i])) { m += errAt(A, frames[i]); n++; }
    if (m / n < bestM) { bestM = m / n; bestA = A; }
  }
  const series = [], errs = [], vErr = [], steady = [];
  let maxJump = 0, snaps2 = 0, maxExtrap = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], e = errAt(bestA, f);
    if (f.snapped) snaps2++;
    let ve = 0;
    if (valid(f)) {
      errs.push(e); if (f.extrap < 60 && Math.abs(f.ox) < 0.1) steady.push(e);
      if (truthAt(f.renderT / 1000).spd > 0.05) maxExtrap = Math.max(maxExtrap, f.extrap);
      if (i > 0 && !f.snapped) {
        // bước khung vẽ so với bước thật cùng khoảng thời gian (giật = chênh lệch này)
        const p = frames[i - 1], ga = truthAt((p.renderT - bestA) / 1000), gb = truthAt((f.renderT - bestA) / 1000);
        const jump = Math.hypot((f.x - p.x) - (gb.x - ga.x), (f.z - p.z) - (gb.z - ga.z));
        maxJump = Math.max(maxJump, jump);
        // sai số VẬN TỐC hiển thị trên cửa sổ 3 khung (~50 ms) — "đập tốc độ"/rung: m/s
        if (i >= 3 && !frames[i - 1].snapped && !frames[i - 2].snapped) {
          const p3 = frames[i - 3], dtw = (f.renderT - p3.renderT) / 1000;
          if (dtw > 0.02) {
            const g3 = truthAt((p3.renderT - bestA) / 1000);
            ve = Math.hypot((f.x - p3.x) - (gb.x - g3.x), (f.z - p3.z) - (gb.z - g3.z)) / dtw;
            vErr.push(ve);
          }
        }
      }
    }
    if (i % 3 === 0) series.push([Math.round(f.now), +e.toFixed(4), +f.extrap.toFixed(1), f.snapped ? 1 : 0, +f.delay.toFixed(1), +ve.toFixed(3)]);
  }
  errs.sort((a, b) => a - b); vErr.sort((a, b) => a - b);
  const q = (p) => +errs[Math.min(errs.length - 1, Math.floor(p * errs.length))].toFixed(4);
  const qv = (p) => +vErr[Math.min(vErr.length - 1, Math.floor(p * vErr.length))].toFixed(3);
  return {
    summary: {
      frames: frames.length, snapshots: snaps.length, states: states.length, holdSamples: tr.nHold, snaps: snaps2,
      displayLagMs: Math.round(bestA + tr.delay), fitAgeMs: bestA, delayMs: +tr.delay.toFixed(1),
      p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), maxFrameJump: +maxJump.toFixed(4), maxExtrapMs: +maxExtrap.toFixed(1),
      velErrP50: qv(0.5), velErrP95: qv(0.95), steadyFrac: +(steady.length / errs.length).toFixed(3),
      steadyP50: +(steady.sort((a, b) => a - b)[steady.length >> 1]).toFixed(4), steadyP95: +steady[Math.floor(steady.length * 0.95)].toFixed(4),
    },
    series,   // [nowMs, lỗi vị trí m, ngoại suy ms, nhảy 0/1, delay ms, lỗi vận tốc m/s]
  };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tests/net/interp_sim.mjs')) {
  const r = simulate({ seed: Number(process.argv[2] || 1) });
  console.log(JSON.stringify(r.summary, null, 1));
}
