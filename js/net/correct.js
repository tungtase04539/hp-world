// js/net/correct.js — áp lệnh CORRECT của máy chủ vào người chơi (MP-2 C1, SPEC §1.2: vị trí sửa là của máy chủ).
//
// Lệch nhỏ (≤ SNAP_M) → kéo về MƯỢT trong PULL_S (cộng dần phần lệch, người chơi vẫn điều khiển được); lệch lớn (bị
// dịch chuyển/teleport, đi xuyên nước…) → nhảy hẳn. Đang cưỡi xe: dời XE (người bám yên ở khung sau), xe dừng lại.
// corrEpoch: mọi STATE sau đó mang epoch mới (net.js) — máy chủ bỏ qua STATE mang epoch cũ.
export const SNAP_M = 6;        // m: lệch hơn thế thì nhảy hẳn (không lướt xuyên tường)
export const PULL_S = 0.15;     // s: thời gian kéo về khi lệch nhỏ

const wrapPI = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

// opts: { pState, surfaceY(x, z, yRef) }
export function createCorrector({ pState, surfaceY }) {
  let pend = null;               // {dx, dz, left}
  let count = 0, snaps = 0, lastAt = 0, lastDist = 0, lastReason = 0;

  function target() { return pState.mounted ? pState.mounted.pos : pState.pos; }

  return {
    // m: {x, z, y, yaw, epoch, reason}. Trả {dist, snapped}.
    apply(m) {
      count++; lastAt = performance.now(); lastReason = m.reason;
      const p = target();
      const dx = m.x - p.x, dz = m.z - p.z;
      const dist = Math.hypot(dx, dz);
      lastDist = dist;
      const v = pState.mounted;
      if (dist > SNAP_M) {
        snaps++;
        pend = null;
        const yRef = Number.isFinite(m.y) ? m.y : p.y;
        const gy = surfaceY(m.x, m.z, yRef + 0.5);
        if (v) {
          v.pos.set(m.x, gy, m.z);
          v.vel = 0;
          if (Number.isFinite(m.yaw)) v.heading = m.yaw;
          if (v.mesh) { v.mesh.position.copy(v.pos); v.mesh.rotation.y = v.heading; }
        } else {
          pState.pos.set(m.x, gy, m.z);
          pState.vy = 0;
          if (Number.isFinite(m.yaw)) pState.yaw = m.yaw;
        }
        return { dist, snapped: true };
      }
      pend = { dx, dz, left: PULL_S };
      if (v) v.vel *= 0.5;
      return { dist, snapped: false };
    },
    // mỗi khung (sau khi nhân vật di chuyển, trước khi gửi STATE)
    step(dt) {
      if (!pend) return;
      const k = pend.left <= dt ? 1 : dt / pend.left;
      const ax = pend.dx * k, az = pend.dz * k;
      const p = target();
      p.x += ax; p.z += az;
      const v = pState.mounted;
      if (v && v.mesh) v.mesh.position.copy(v.pos);
      pend.dx -= ax; pend.dz -= az; pend.left -= dt;
      if (pend.left <= 0 || k >= 1) pend = null;
    },
    get pending() { return !!pend; },
    stats() { return { count, snaps, lastAt, lastDist: +lastDist.toFixed(2), lastReason }; },
    wrapPI,
  };
}
