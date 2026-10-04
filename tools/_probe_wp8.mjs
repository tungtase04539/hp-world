// scratch probe (not committed)
import { openGame } from './qa/launch.mjs';
const OUT = process.argv[2];
const g = await openGame({ port: 8308, quality: 'full' });
const pg = g.pg;
await pg.waitForTimeout(3000);
await g.cleanUI();
const info = [];
async function shot(name, fn, arg) {
  if (fn) info.push([name, await pg.evaluate(fn, arg)]);
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/${name}.png` });
}
await shot('a_aerial', () => { const hp = window.__hp; hp.setTime(0.35); hp.aerial(-71, 13, 400, 1200); const s = hp.scene; return { fog: s.fog && [s.fog.near, s.fog.far, s.fog.density], cam: hp.camera.position.toArray().map(Math.round) }; });
await shot('b_aerial_notraffic', () => { const hp = window.__hp; hp.traffic.setEnabled(false); return 1; });
await shot('c_aerial_traffic_on_nofog', () => { const hp = window.__hp; hp.traffic.setEnabled(true); const f = hp.scene.fog; hp._f = f; hp.scene.fog = null; return 1; });
info.push(['children', await pg.evaluate(() => { const hp = window.__hp; hp.scene.fog = hp._f; const big = []; for (const o of hp.scene.children) { if (!o.visible) continue; o.updateMatrixWorld?.(); const g = o.geometry; if (g) { if (!g.boundingSphere) g.computeBoundingSphere(); const r = g.boundingSphere.radius; if (r > 900) big.push([o.name || o.type, Math.round(r), o.material && o.material.type, o.material && o.material.transparent, o.position.toArray().map(Math.round), o.layers.mask]); } } return big; })]);
console.log(JSON.stringify(info, null, 1));
console.log('errors', g.errors);
await g.close();
