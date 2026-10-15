// tools/qa/mp_c2_avatars.mjs — KIỂM CHỨNG MP-2 C2 trong game THẬT (không sửa main.js): người chơi khác (remote_avatars),
// nội suy (interp), bảng tên (nametags), chấm minimap. MỘT Chrome (khoá GPU qua launch.mjs openGame), lần lượt full rồi lite.
//   python -m http.server 8812   (gốc worktree)
//   PW_PATH=<playwright-core/index.mjs> node tools/qa/mp_c2_avatars.mjs --port 8812 --out C:/Users/Admin/hp-world-work/mp2/c2 [--only full|lite]
// Ra: ảnh *.png, atlas.png, report.json (draw call / fps / chương trình shader trước-sau, số liệu từng kịch bản),
//     interp.json (sai số vị trí theo thời gian của luồng 10 Hz rung + kẹt + RESUME, đo trên vị trí ĐANG VẼ trong game).
import fs from 'fs';
import path from 'path';
import { openGame, args } from './launch.mjs';

const A = args();
const PORT = +A.get('port', 8812);
const OUT = A.get('out', 'C:/Users/Admin/hp-world-work/mp2/c2');
const ONLY = A.get('only', '');
fs.mkdirSync(OUT, { recursive: true });
const report = { when: new Date().toISOString(), port: PORT, runs: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SQ = [-6, 49];            // tâm quảng trường Nhà hát lớn (mapdata EXTRAS.square)

async function shot(g, name, clip) {
  const f = path.join(OUT, name);
  await g.pg.screenshot({ path: f, clip });
  return f;
}
async function view(g, x, z, yaw, pitch, dist, settle = 1500) {
  await g.pg.evaluate(([x, z, yaw, pitch, dist]) => { window.__hp.teleport(x, z, yaw, pitch, dist); window.__hp.player.group.visible = false; }, [x, z, yaw, pitch, dist]);
  await wait(settle);
}

async function runFull() {
  const g = await openGame({ port: PORT, quality: 'full' });
  const R = { tier: g.tier, gpu: g.gpu, hpReadyMs: g.hpReadyMs, errors: g.errors };
  report.runs.full = R;
  try {
    if (!g.hpReadyMs) throw new Error('game không lên');
    await g.cleanUI();
    await g.pg.evaluate(() => { document.getElementById('hud').style.display = ''; for (const id of ['questPanel', 'topRight']) { const e = document.getElementById(id); if (e) e.style.display = 'none'; } });
    await g.pg.evaluate(() => window.__hp.setTime(0.45));
    await view(g, SQ[0] + 2, SQ[1] + 6, 0, 0.32, 26, 4000);
    await g.pg.evaluate(() => import('/tools/qa/mp_c2_page.js'));
    // A/B CÙNG PHIÊN: (1) chưa có module, (2) module + 0 người, (3) 96 người ở quảng trường
    R.base = await g.pg.evaluate(() => window.__c2.measure(5000));
    R.programsBase = await g.pg.evaluate(() => window.__c2.programs());
    await g.pg.evaluate(() => { window.__c2.makeRA(); return 1; });
    await wait(500);
    R.module0 = await g.pg.evaluate(() => window.__c2.measure(5000));
    R.crowd = await g.pg.evaluate(([x, z]) => window.__c2.SC.crowd(x, z, 96), SQ);
    await wait(6000);
    R.crowd96 = await g.pg.evaluate(() => window.__c2.measure(6000));
    R.programsAfter = await g.pg.evaluate(() => window.__c2.programs());
    await shot(g, 'crowd96_opera.png');
    await view(g, SQ[0] + 2, SQ[1] + 6, 0.6, 0.85, 70, 2500);
    await shot(g, 'crowd96_opera_high.png');
    R.crowdStats = await g.pg.evaluate(() => window.__c2.stats());
    // minimap: chấm người chơi khác (markers({all:true}) — mặc định người lạ ẩn)
    R.markersDefault = await g.pg.evaluate(() => window.__ra.markers().length);
    R.markersAll = await g.pg.evaluate(([x, z]) => window.__c2.minimap(x, z, 0, true), [SQ[0] + 2, SQ[1] + 6]);
    await wait(300);
    const mm = await g.pg.evaluate(() => { const r = document.getElementById('minimap').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (mm.width) await shot(g, 'minimap_markers.png', mm);

    // TRỘN: đi bộ / chạy / xe máy (ngồi sau, chở hàng) / ngồi / nhảy / xích lô / vắng mặt
    R.mix = await g.pg.evaluate(([x, z]) => window.__c2.SC.mix(x, z), SQ);
    await view(g, SQ[0] + 2, SQ[1] + 6, 0.2, 0.3, 22, 5000);
    await shot(g, 'mix_walk_run.png');
    // tới đoạn phố có xe máy: lấy vị trí 1 xe máy gần và đặt camera sau nó
    const bike = await g.pg.evaluate(() => { for (const id of [313, 315, 317, 312]) { const d = window.__c2.debug(id); if (d && d.mode === 4) return { id, ...d }; } return null; });
    R.bike = bike;
    if (bike) {
      await view(g, bike.x, bike.z, bike.yaw + Math.PI * 0.75, 0.22, 9, 300);
      await shot(g, 'riders_close.png');
      await view(g, bike.x, bike.z, bike.yaw + Math.PI * 0.5, 0.35, 30, 1200);
      await shot(g, 'riders_street.png');
    }
    R.mixStats = await g.pg.evaluate(() => ({ s: window.__c2.stats(), pill: [window.__c2.debug(364), window.__c2.debug(368), window.__c2.debug(314), window.__c2.debug(318)], air: window.__c2.debug(322), cyclo: window.__c2.debug(320) }));

    // BẢNG TÊN cận cảnh: dấu tiếng Việt khó, huy hiệu, vắng mặt
    const TX = SQ[0] + 10, TZ = SQ[1] + 30;
    R.tags = await g.pg.evaluate(([x, z]) => window.__c2.SC.tags(x, z), [TX, TZ]);
    await view(g, TX, TZ + 3, 0, 0.12, 4.2, 3500);
    await shot(g, 'tags_close.png');
    await shot(g, 'tags_zoom.png', { x: 300, y: 200, width: 680, height: 200 });
    await view(g, TX, TZ + 1.5, 0, 0.02, 2.2, 2500);
    await shot(g, 'tags_zoom2.png', { x: 200, y: 120, width: 880, height: 300 });
    await view(g, TX, TZ + 3, 0.15, 0.2, 14, 3000);
    await shot(g, 'tags_fade.png');
    const png = await g.pg.evaluate(() => window.__c2.atlasPNG());
    fs.writeFileSync(path.join(OUT, 'atlas.png'), Buffer.from(png.split(',')[1], 'base64'));
    R.tagStats = await g.pg.evaluate(() => window.__c2.stats());

    // MẶT CẦU nâng (Cầu Lạc Long)
    R.bridge = await g.pg.evaluate(() => window.__c2.SC.bridge());
    const [mx, mz] = R.bridge.mid;
    await view(g, mx, mz, 1.2, 0.3, 30, 5000);
    await shot(g, 'bridge_deck.png');
    R.bridgeCheck = await g.pg.evaluate(async () => {
      const W = await import('/js/world.js');
      const out = [];
      for (let id = 700; id < 716; id++) {
        const d = window.__c2.debug(id); if (!d) continue;
        out.push({ id, mode: d.mode, y: +d.y.toFixed(2), gy: +d.gy.toFixed(2), ground: +W.groundHeightNoDeck(d.x, d.z).toFixed(2) });
      }
      return out;
    });

    // NỘI SUY: 60 s luồng rung + kẹt TCP + rớt 40–42 s + RESUME
    const IX = SQ[0] - 60, IZ = SQ[1] + 40;
    await view(g, IX + 60, IZ, 0, 0.6, 80, 500);
    await g.pg.evaluate(([x, z]) => window.__c2.SC.interp(x, z), [IX, IZ]);
    await wait(61000);
    const rec = await g.pg.evaluate(() => window.__c2.stopRec());
    const truth = await g.pg.evaluate(([x, z]) => window.__c2.truthTable(x, z, 61, 0.005), [IX, IZ]);
    R.interp = analyseInterp(rec.rec, truth);
    R.evLog = await g.pg.evaluate(() => window.__c2.evLog);
    R.errorsEnd = g.errors.slice();
  } catch (e) {
    R.fatal = String(e && e.stack || e);
  } finally {
    await g.close();
    save();
  }
}

async function runLite() {
  const g = await openGame({ port: PORT, quality: 'lite' });
  const R = { tier: g.tier, gpu: g.gpu, hpReadyMs: g.hpReadyMs, errors: g.errors };
  report.runs.lite = R;
  try {
    if (!g.hpReadyMs) throw new Error('game không lên');
    await g.cleanUI();
    await g.pg.evaluate(() => window.__hp.setTime(0.45));
    await view(g, SQ[0] + 2, SQ[1] + 6, 0, 0.32, 26, 4000);
    await g.pg.evaluate(() => import('/tools/qa/mp_c2_page.js'));
    R.base = await g.pg.evaluate(() => window.__c2.measure(5000));
    await g.pg.evaluate(() => { window.__c2.makeRA(); return 1; });
    R.module0 = await g.pg.evaluate(() => window.__c2.measure(5000));
    R.crowd = await g.pg.evaluate(([x, z]) => window.__c2.SC.crowd(x, z, 96), SQ);
    await wait(6000);
    R.crowd96 = await g.pg.evaluate(() => window.__c2.measure(6000));
    await shot(g, 'lite_crowd96_cap40.png');
    await view(g, SQ[0] + 2, SQ[1] + 6, 0.6, 0.85, 70, 2500);
    await shot(g, 'lite_crowd96_cap40_high.png');
    R.crowdStats = await g.pg.evaluate(() => ({ s: window.__c2.stats(), d: [100, 101, 102, 103, 150].map((i) => window.__c2.debug(i)), cam: window.__hp.camera.position.toArray(), n: window.__c2.players.size, ev: window.__c2.evLog }));
    const TX = SQ[0] + 10, TZ = SQ[1] + 30;
    R.tags = await g.pg.evaluate(([x, z]) => window.__c2.SC.tags(x, z), [TX, TZ]);
    await view(g, TX, TZ + 3, 0, 0.12, 4.2, 3500);
    await shot(g, 'lite_tags_close.png');
    R.errorsEnd = g.errors.slice();
  } catch (e) {
    R.fatal = String(e && e.stack || e);
  } finally {
    await g.close();
    save();
  }
}

// sai số = |vị trí vẽ(t) − quỹ đạo thật(t − delay − A)|, A = tuổi mẫu cố định khớp nhất (như tests/net/interp_sim.mjs)
function analyseInterp(rec, truth) {
  const tAt = (ms) => {
    const i = Math.max(0, Math.min(truth.length - 2, Math.floor(ms / 5)));
    const a = truth[i], b = truth[i + 1], u = Math.max(0, Math.min(1, (ms - a[0]) / (b[0] - a[0])));
    return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  };
  const valid = (r) => r[0] > 1500 && !(r[0] > 39700 && r[0] < 42800) && r[0] < 60000;
  const err = (r, A) => { const g = tAt(r[0] - r[3] - A); return Math.hypot(r[1] - g[0], r[2] - g[1]); };
  let bestA = 0, bm = Infinity;
  for (let A = 0; A <= 400; A += 5) { let m = 0, n = 0; for (let i = 0; i < rec.length; i += 5) if (valid(rec[i])) { m += err(rec[i], A); n++; } if (n && m / n < bm) { bm = m / n; bestA = A; } }
  const errs = [], series = [];
  let maxJump = 0;
  for (let i = 0; i < rec.length; i++) {
    const r = rec[i], e = err(r, bestA);
    series.push([r[0], +e.toFixed(4)]);
    if (!valid(r)) continue;
    errs.push(e);
    if (i > 0 && valid(rec[i - 1]) && rec[i][4] === rec[i - 1][4]) {
      const p = rec[i - 1], ga = tAt(p[0] - p[3] - bestA), gb = tAt(r[0] - r[3] - bestA);
      maxJump = Math.max(maxJump, Math.hypot((r[1] - p[1]) - (gb[0] - ga[0]), (r[2] - p[2]) - (gb[1] - ga[1])));
    }
  }
  errs.sort((a, b) => a - b);
  const q = (p) => +errs[Math.min(errs.length - 1, Math.floor(p * errs.length))].toFixed(4);
  const summary = { frames: rec.length, fitAgeMs: bestA, delayMs: rec.length ? rec[rec.length - 1][3] : null, displayLagMs: bestA + (rec.length ? rec[rec.length - 1][3] : 0),
    p50: q(0.5), p90: q(0.9), p95: q(0.95), p99: q(0.99), max: q(1), maxFrameJumpM: +maxJump.toFixed(3), snaps: rec.length ? rec[rec.length - 1][4] : 0 };
  fs.writeFileSync(path.join(OUT, 'interp.json'), JSON.stringify({
    what: 'MP-2 C2: sai số vị trí ĐANG VẼ của 1 người chơi khác (quỹ đạo tests/net/interp_sim.mjs truthAt: đi bộ 3 m/s → chạy vòng 7 m/s → đứng 5 s → xe máy 16 m/s) qua luồng giả lập trong game: STATE 15 Hz, snapshot 10 Hz chỉ bản ghi đổi, trễ 35 + rung 0–60 ms + đuôi 4 %, kẹt TCP 1,2 %/snapshot 300–700 ms, rớt mạng 40–42 s rồi RESUME (keyframe ENTER lại). Sai số = |vẽ(t) − thật(t − delay − A)|, A = tuổi mẫu khớp nhất. Bỏ cửa sổ 39,7–42,8 s (rớt mạng: đứng yên rồi nhảy là thiết kế).',
    summary, series,
  }));
  return summary;
}

if (!ONLY || ONLY === 'full') await runFull();
if (!ONLY || ONLY === 'lite') await runLite();
console.log(JSON.stringify(report, (k, v) => (k === 'programsAfter' ? v.length : v), 1));
