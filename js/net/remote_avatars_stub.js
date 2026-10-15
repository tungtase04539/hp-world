// js/net/remote_avatars_stub.js — BẢN TẠM của C2 (js/net/remote_avatars.js) để C1 chứng minh đầu-cuối. CÙNG API:
//   createRemoteAvatars({ scene, world, camera, tier }) → { enter(netId, abs, appearance), update(netId, rec, serverMs),
//     leave(netId), names(list), self(netId), frame(dt, nowServerMs, camPos), markers(), stats(), dispose() }
// Vẽ: MỘT InstancedMesh hộp (1 draw call, không phụ thuộc N), màu theo appearance, xe máy = hộp dài, vắng mặt = mờ.
// Nội suy 120 ms sau snapshot, ngoại suy ≤ 250 ms, nhảy khi lệch > 8 m. KHÔNG có bảng tên/vòng sáng (việc của C2).
// Bản thật thay bằng cách đổi MỘT dòng import trong js/net/net.js.
import * as THREE from 'three';

const DELAY_MS = 120, EXTRAP_MS = 250, SNAP_M = 8;
const MODE_MOTO = 4, MODE_CYCLO = 5, MODE_BOAT = 6, MODE_PILLION = 7, FLAG_AWAY = 16;

export function createRemoteAvatars({ scene, tier = 3 }) {
  const CAP = tier <= 1 ? 40 : 96;
  const geo = new THREE.BoxGeometry(0.55, 1.7, 0.35);
  geo.translate(0, 0.85, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  mesh.count = 0;
  mesh.name = 'remote_players_stub';
  mesh.frustumCulled = false;
  mesh.userData.noCull = true;                  // hợp đồng instcull.js: không nén/cull instance
  mesh.raycast = () => {};
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  scene.add(mesh);

  const P = new Map();                          // netId → {s: [{t,x,z,y,yaw,spd,state}], app, name, x,z,y,yaw,state}
  let selfId = -1;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const UPY = new THREE.Vector3(0, 1, 0);
  const order = [];

  function colorOf(app) {
    const h = app ? ((app[0] | (app[1] << 8)) % 360) / 360 : 0.6;
    return _c.setHSL(h, 0.75, 0.55).clone();
  }
  function push(p, rec, t) {
    const s = { t, x: rec.x, z: rec.z, y: rec.y, yaw: rec.yaw, spd: rec.spd, state: rec.state };
    const last = p.s[p.s.length - 1];
    if (last && Math.hypot(last.x - s.x, last.z - s.z) > SNAP_M) p.s.length = 0;   // dịch chuyển: bỏ lịch sử
    if (last && Number.isFinite(t) && t <= last.t) s.t = last.t + 1;
    p.s.push(s);
    if (p.s.length > 10) p.s.shift();
  }

  return {
    enter(netId, abs, appearance) {
      let p = P.get(netId);
      if (!p) { p = { s: [], app: appearance || null, name: '', x: abs.x, z: abs.z, y: abs.y, yaw: abs.yaw, state: abs.state, col: colorOf(appearance) }; P.set(netId, p); }
      else if (appearance) { p.app = appearance; p.col = colorOf(appearance); }
      p.s.length = 0;
      push(p, abs, Number.isFinite(abs.serverMs) ? abs.serverMs : NaN);
    },
    update(netId, rec, serverMs) {
      const p = P.get(netId);
      if (p) push(p, rec, serverMs);
    },
    leave(netId) { P.delete(netId); },
    names(list) { for (const n of list || []) { const p = P.get(n.netId); if (p) p.name = n.name; } },
    self(netId) { selfId = netId; P.delete(netId); },
    frame(dt, nowServerMs, camPos) {
      const rt = nowServerMs - DELAY_MS;
      order.length = 0;
      for (const [id, p] of P) {
        if (id === selfId || !p.s.length) continue;
        const s = p.s;
        let a = s[0], b = null;
        if (!Number.isFinite(rt) || !Number.isFinite(a.t)) a = s[s.length - 1];
        else {
          for (let i = s.length - 1; i >= 0; i--) { if (s[i].t <= rt) { a = s[i]; b = s[i + 1] || null; break; } }
        }
        if (b && Number.isFinite(b.t) && b.t > a.t) {
          const k = (rt - a.t) / (b.t - a.t);
          p.x = a.x + (b.x - a.x) * k; p.z = a.z + (b.z - a.z) * k; p.y = a.y + (b.y - a.y) * k;
          let d = b.yaw - a.yaw; if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
          p.yaw = a.yaw + d * k; p.state = b.state;
        } else {
          const ex = Number.isFinite(rt) && Number.isFinite(a.t) ? Math.min(EXTRAP_MS, Math.max(0, rt - a.t)) / 1000 : 0;
          p.x = a.x + Math.sin(a.yaw) * a.spd * ex; p.z = a.z + Math.cos(a.yaw) * a.spd * ex; p.y = a.y; p.yaw = a.yaw; p.state = a.state;
        }
        p.d2 = camPos ? (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2 : 0;
        order.push(p);
      }
      if (order.length > CAP) order.sort((u, v) => u.d2 - v.d2);
      const n = Math.min(CAP, order.length);
      for (let i = 0; i < n; i++) {
        const p = order[i];
        const mode = p.state & 7, away = ((p.state >> 3) & 31) & FLAG_AWAY;
        const ride = mode === MODE_MOTO || mode === MODE_CYCLO || mode === MODE_BOAT || mode === MODE_PILLION;
        _s.set(ride ? 1.3 : 1, ride ? 0.8 : 1, ride ? 5 : 1);
        _p.set(p.x, p.y, p.z);
        _q.setFromAxisAngle(UPY, p.yaw);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
        _c.copy(p.col); if (away) _c.multiplyScalar(0.35);
        mesh.setColorAt(i, _c);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this._drawn = n;
    },
    markers() { return []; },                    // người lạ mặc định ẩn trên bản đồ nhỏ
    stats() { return { count: P.size - (P.has(selfId) ? 1 : 0), drawn: this._drawn || 0, drawCalls: 1 }; },
    // QA: vị trí đang vẽ (sau nội suy)
    positions() { const out = []; for (const [id, p] of P) out.push({ netId: id, name: p.name, x: +p.x.toFixed(2), z: +p.z.toFixed(2), state: p.state }); return out; },
    dispose() { scene.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose && mesh.dispose(); P.clear(); },
  };
}
