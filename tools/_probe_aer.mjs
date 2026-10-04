// scratch probe (not committed): close aerial of traffic at junctions
import { openGame } from './qa/launch.mjs';
const OUT = process.argv[2];
const PTS = JSON.parse(process.argv[3] || '[[-20,162,60],[-379,-503,60],[0,60,70],[-211,114,60]]');
const g = await openGame({ port: 8308, quality: 'full' });
const pg = g.pg;
await pg.waitForTimeout(4000);
await g.cleanUI();
for (const [x, z, half] of PTS) {
  await pg.evaluate(([x, z]) => { const hp = window.__hp; hp.aerialOff(); hp.setTime(0.4); hp.teleport(x, z, 0, 0.3, 10); hp.player.group.visible = false; }, [x, z]);
  await pg.waitForTimeout(3500);
  await pg.evaluate(([x, z, half]) => { window.__hp.aerial(x, z, half, 400); }, [x, z, half]);
  await pg.waitForTimeout(900);
  await pg.screenshot({ path: `${OUT}/aer_${x}_${z}.png` });
}
console.log('errors', g.errors.slice(0, 5));
await g.close();
