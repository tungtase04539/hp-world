// scratch probe (W3-D, NOT committed): scene objects by name + surfaceAt samples around the ĐBP west park
import { openGame } from './launch.mjs';
const g = await openGame({ port: +(process.argv[2] || 8504) });
try {
  await g.pg.waitForTimeout(3000);
  const r = await g.pg.evaluate(() => {
    const hp = window.__hp, out = { names: {} };
    const want = ['bs_park_dbp', 'bs_park_dbp_hedge', 'hvt_nonbo_hedge', 'garden_hedges', 'lqd_median_hedge', 'dm_park_hedge', 'lechan_hedge'];
    hp.scene.traverse((o) => {
      if (!want.includes(o.name)) return;
      const e = out.names[o.name] ||= { n: 0, vis: o.visible, tris: 0, pos: null };
      e.n++; if (o.geometry) { o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; e.bb = [b.min.x|0, b.min.y.toFixed(2), b.min.z|0, b.max.x|0, b.max.y.toFixed(2), b.max.z|0]; e.mw = o.matrixWorld.elements.slice(12, 15); e.layers = o.layers.mask; e.frustum = o.frustumCulled; e.mat = o.material && o.material.name; }
      if (o.geometry) e.tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
      if (o.name === 'bs_park_dbp_hedge') { const P = o.geometry.attributes.position, pts = []; for (let i = 0; i < P.count; i += 7 * 6) pts.push([+P.getX(i).toFixed(1), +P.getZ(i).toFixed(1)]); e.pts = pts; }
      if (o.isGroup) { e.children = o.children.length; e.childNames = o.children.slice(0, 40).map((c) => c.name || c.type); }
      const p = o.getWorldPosition ? o.getWorldPosition(new o.position.constructor()) : null; e.pos = p && [p.x | 0, p.y, p.z | 0];
    });
    const sa = hp.world && hp.world.roadNet && hp.world.roadNet.surfaceAt;
    out.hasSurfaceAt = !!sa;
    if (sa) {
      out.samples = [];
      for (const [x, z] of [[-243, -588], [-243, -586], [-260, -582], [-280, -576], [-250, -470], [-250, -472], [-250, -474], [-300, -540], [-296, -540]]) out.samples.push([x, z, +sa(x, z).toFixed(3), +hp.gh(x, z).toFixed(2)]);
    }
    out.gardenStats = hp.world && hp.world.gardenStats;
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
} finally { await g.close(); }
