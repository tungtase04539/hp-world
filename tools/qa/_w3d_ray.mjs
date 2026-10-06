// scratch probe (W3-D, NOT committed): raycast từ camera pano tới các điểm màn hình → tên mesh + vật liệu
import { openGame } from './launch.mjs';
const [X, Z, H] = [+process.argv[3], +process.argv[4], +process.argv[5]];
const g = await openGame({ port: +(process.argv[2] || 8504) });
try {
  await g.pg.waitForTimeout(2000);
  const r = await g.pg.evaluate(async ([X, Z, H]) => {
    const hp = window.__hp;
    const yaw = -H * Math.PI / 180; if (hp.camOcclusion) hp.camOcclusion(false);
    hp.teleport(X, Z, yaw, 0.02, 0.1);
    await new Promise((res) => setTimeout(res, 1500));
    const cam = hp.camera, THREE_ = cam.position.constructor;
    const out = [];
    const rc = new (hp.THREE ? hp.THREE.Raycaster : Object)();
    if (!rc.setFromCamera) return { err: 'no THREE on __hp', keys: Object.keys(hp).slice(0, 80) };
    for (const [sx, sy] of [[0.1, -0.01], [0.3, -0.03], [0.6, -0.03], [0.1, -0.15], [0.3, -0.2], [0.5, -0.25], [0.3, -0.1], [0.6, -0.12]]) {
      rc.setFromCamera({ x: sx, y: sy }, cam);
      const hits = rc.intersectObjects(hp.scene.children, true).filter((h) => h.object.visible);
      const h = hits.find((q) => !/sky/.test(q.object.name)); out.push(['all', hits.slice(0, 5).map((q) => [q.object.name, +q.distance.toFixed(1), +q.point.x.toFixed(1), +q.point.z.toFixed(1), +q.point.y.toFixed(2)])]);
      if (!h) { out.push([sx, sy, null]); continue; }
      const m = Array.isArray(h.object.material) ? h.object.material[h.face ? h.face.materialIndex : 0] : h.object.material;
      out.push([sx, sy, h.object.name || h.object.type, h.object.parent && h.object.parent.name, m && m.name, m && m.color && m.color.getHexString(), m && m.map && (m.map.name || 'map'), +h.distance.toFixed(1), [+h.point.x.toFixed(1), +h.point.y.toFixed(2), +h.point.z.toFixed(1)]]);
    }
    out.push(['cam', +cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2), cam.fov]); return out;
  }, [X, Z, H]);
  console.log(JSON.stringify(r));
} finally { await g.close(); }
