// scratch probe (not committed): gameplay smoke via real keyboard events
import { openGame } from './qa/launch.mjs';
const g = await openGame({ port: 8308, quality: 'full' });
const pg = g.pg;
await pg.waitForTimeout(2500);
const st = () => pg.evaluate(() => { const h = window.__hp, p = h.pState; return { x: +p.pos.x.toFixed(2), z: +p.pos.z.toFixed(2), y: +p.pos.y.toFixed(2), vy: +p.vy.toFixed(2), mounted: p.mounted ? p.mounted.type : null, vel: p.mounted ? +p.mounted.vel.toFixed(2) : 0, dlg: !document.getElementById('dialogue').classList.contains('hidden'), help: !document.getElementById('helpModal').classList.contains('hidden'), camD: +h.camera.position.distanceTo(p.pos).toFixed(1) }; });
const out = [];
out.push(['start', await st()]);
await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
out.push(['after Esc (dialog closed?)', await st()]);
// move to an open street spot (opera square), face north
await pg.evaluate(() => window.__hp.teleport(-6, 72, 0, 0.3, 12));
await pg.waitForTimeout(500);
let a = await st();
await pg.keyboard.down('KeyW'); await pg.waitForTimeout(2000); await pg.keyboard.up('KeyW');
let b = await st();
out.push(['walk 2s dist', +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)]);
await pg.evaluate(() => window.__hp.teleport(-6, 72, 0, 0.3, 12)); await pg.waitForTimeout(400);
a = await st();
await pg.keyboard.down('ShiftLeft'); await pg.keyboard.down('KeyW'); await pg.waitForTimeout(2000); await pg.keyboard.up('KeyW'); await pg.keyboard.up('ShiftLeft');
b = await st();
out.push(['run 2s dist', +Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)]);
// help toggled by E? open help via button then Esc
await pg.evaluate(() => document.getElementById('btnHelp').click()); await pg.waitForTimeout(200);
out.push(['help open', (await st()).help]);
await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
out.push(['help after Esc', (await st()).help]);
// moto
await pg.evaluate(() => window.__hp.teleport(-6, 72, 0, 0.3, 12)); await pg.waitForTimeout(400);
await pg.evaluate(() => document.getElementById('btnMoto').click()); await pg.waitForTimeout(400);
out.push(['moto called', await st()]);
await pg.keyboard.down('KeyW'); await pg.waitForTimeout(3000);
out.push(['moto 3s', await st()]);
await pg.keyboard.press('Space'); await pg.waitForTimeout(100);
await pg.keyboard.up('KeyW'); await pg.waitForTimeout(2500);
out.push(['moto coast 2.5s', await st()]);
await pg.keyboard.press('KeyE'); await pg.waitForTimeout(150);
out.push(['after E dismount', await st()]);
await pg.waitForTimeout(400);
out.push(['0.4s later (no jump)', await st()]);
// edge clamp while riding: teleport near edge and ride outward
await pg.evaluate(() => { const h = window.__hp; h.teleport(0, 1560, Math.PI, 0.3, 12); }); await pg.waitForTimeout(300);
await pg.evaluate(() => document.getElementById('btnMoto').click()); await pg.waitForTimeout(300);
await pg.evaluate(() => { const v = window.__hp.pState.mounted; if (v) v.heading = 0; });   // heading 0 = +z (south, outward)
await pg.keyboard.down('KeyW'); await pg.waitForTimeout(4000); await pg.keyboard.up('KeyW');
const e = await st();
out.push(['edge ride r', +Math.hypot(e.x, e.z).toFixed(1), 'PLAY_R', await pg.evaluate(() => window.__hp.PLAY_RADIUS)]);
// camera occlusion probe: stand by a real footprint and look across it
out.push(['camOcclusion', await pg.evaluate(() => window.__hp.camOcclusion())]);
console.log(JSON.stringify(out, null, 0).replace(/\],\[/g, '],\n['));
console.log('errors', g.errors.slice(0, 5));
await g.close();
