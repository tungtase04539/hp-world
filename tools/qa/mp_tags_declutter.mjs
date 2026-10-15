// tools/qa/mp_tags_declutter.mjs — KIỂM CHỨNG GỠ CHỒNG BẢNG TÊN (MP-2 vấn đề mở: 96 người trong 13 m → bảng tên chồng nhau).
// Chạy trong game THẬT, MỘT Chrome (khoá GPU qua launch.mjs openGame), lần lượt full (TIER 3) rồi lite (TIER 1). Dùng chung
// giả lập máy chủ + mạng trong trang của tools/qa/mp_c2_page.js (KHÔNG sửa main.js) và lớp đo tools/qa/mp_tags_page.js.
//   python -m http.server 8823   (gốc worktree)
//   node tools/qa/mp_tags_declutter.mjs --port 8823 --out C:/Users/Admin/hp-world-work/mp2b/nametags/after [--only full|lite]
// Đo (mỗi TIER): ảnh 96 người quảng trường Nhà hát (góc như mp_c2) + đám đông DÀY 96 người / 13 m; chuỗi đi bộ 20 s camera
// đứng + 20 s camera quay chậm: số lần bảng tên bật/tắt mỗi giây + "nháy" (bật/tắt lại < 0,5 s), số cặp chồng lấn trên màn
// hình, ms lượt bảng tên; 60 s đám đông đi + camera quay: byte cấp phát (CDP HeapProfiler lấy mẫu, gồm cả vật đã bị GC) theo
// tệp js/net/*, heap sau GC đầu/cuối; draw call của mô-đun + số chương trình shader trước/sau; ảnh cận cảnh dấu tiếng Việt khó.
import fs from 'fs';
import path from 'path';
import { openGame, args } from './launch.mjs';

const A = args();
const PORT = +A.get('port', 8823);
const OUT = A.get('out', 'C:/Users/Admin/hp-world-work/mp2b/nametags/run');
const ONLY = A.get('only', '');
const HEAP_S = +A.get('heap', 60);
fs.mkdirSync(OUT, { recursive: true });
const report = { when: new Date().toISOString(), port: PORT, runs: {} };
const save = () => fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SQ = [-6, 49];            // tâm quảng trường Nhà hát lớn (mapdata EXTRAS.square)

async function run(quality) {
  const P = quality === 'lite' ? 'lite_' : '';
  const g = await openGame({ port: PORT, quality });
  const R = { tier: g.tier, gpu: g.gpu, hpReadyMs: g.hpReadyMs, errors: g.errors };
  report.runs[quality] = R;
  const ev = (fn, a) => g.pg.evaluate(fn, a);
  const shot = (name, clip) => g.pg.screenshot({ path: path.join(OUT, P + name), clip });
  const view = async (x, z, yaw, pitch, dist, settle = 1500) => {
    await ev(([x, z, yaw, pitch, dist]) => { window.__hp.teleport(x, z, yaw, pitch, dist); window.__hp.player.group.visible = false; }, [x, z, yaw, pitch, dist]);
    await wait(settle);
  };
  try {
    if (!g.hpReadyMs) throw new Error('game không lên');
    await g.cleanUI();
    await ev(() => window.__hp.setTime(0.45));
    await view(SQ[0] + 2, SQ[1] + 6, 0, 0.32, 26, 4000);
    await ev(() => import('/tools/qa/mp_c2_page.js'));
    R.programsBase = await ev(() => window.__c2.programs().length);
    await ev(() => { window.__c2.makeRA(); return 1; });
    await ev(() => import('/tools/qa/mp_tags_page.js'));
    await ev(() => { window.__tg.install(); return 1; });

    // 1) 96 người quảng trường Nhà hát (cùng kịch bản/góc với mp_c2_avatars crowd96_opera.png)
    R.opera = await ev(([x, z]) => window.__c2.SC.crowd(x, z, 96), SQ);
    await wait(6000);
    await shot('opera96.png');
    await ev(() => window.__tg.start());
    await wait(8000);
    R.operaStatic = await ev(() => window.__tg.stop());
    R.operaMeasure = await ev(() => window.__c2.measure(4000));

    // 2) đám đông DÀY 96 người / 13 m: người chơi đứng mép đám đông, camera sau lưng 8 m
    R.dense = await ev(([x, z]) => window.__c2.SC.dense(x, z, 96, 13), SQ);
    await view(SQ[0], SQ[1] + 9, 0, 0.22, 8, 4000);
    await shot('dense96.png');
    await ev(() => window.__tg.start());
    for (let i = 0; i < 4; i++) { await shot(`dense96_seq${i}.png`); await wait(500); }
    await wait(18000);
    R.denseWalkStatic = await ev(() => window.__tg.stop());
    R.denseMeasure = await ev(() => window.__c2.measure(4000));
    // camera quay chậm quanh tâm đám đông (0,15 rad/s, cách 16 m) — người chơi nhìn quanh
    await ev(([x, z]) => window.__tg.orbit(x, z, 16, 0.3, 0.15), SQ);
    await wait(1000);
    await ev(() => window.__tg.start());
    await wait(20000);
    R.denseWalkOrbit = await ev(() => window.__tg.stop());
    await shot('dense96_orbit.png');
    await ev(() => window.__tg.stopOrbit());
    // góc cao (nhìn xuống đám đông): bảng tên chồng theo chiều dọc màn hình nhiều nhất
    await view(SQ[0], SQ[1] + 6, 0, 0.6, 12, 3000);
    await ev(() => window.__tg.start());
    await wait(6000);
    R.denseHigh = await ev(() => window.__tg.stop());
    await shot('dense96_high.png');

    // 3) bộ nhớ: 60 s đám đông dày đi + camera quay — KHÔNG có lớp bọc đo
    await ev(() => window.__tg.uninstall());
    await ev(([x, z]) => window.__tg.orbit(x, z, 16, 0.3, 0.15), SQ);
    await wait(2000);
    const cdp = await g.ctx.newCDPSession(g.pg);
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const h0 = await cdp.send('Runtime.getHeapUsage');
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const t0 = Date.now();
    await wait(HEAP_S * 1000);
    const { profile } = await cdp.send('HeapProfiler.stopSampling');
    const secs = (Date.now() - t0) / 1000;
    await cdp.send('HeapProfiler.collectGarbage');
    const h1 = await cdp.send('Runtime.getHeapUsage');
    await ev(() => window.__tg.stopOrbit());
    const byFile = {}, byFn = {};
    let total = 0;
    const walk = (n) => {
      const sz = n.selfSize || 0;
      total += sz;
      const u = n.callFrame.url || '';
      const m = u.match(/\/(js\/[^?#]+)/);
      const f = m ? m[1] : (u ? 'other' : '(native/vm)');
      byFile[f] = (byFile[f] || 0) + sz;
      if (/js\/net\//.test(f) && sz) { const k = `${f}:${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`; byFn[k] = (byFn[k] || 0) + sz; }
      for (const c of n.children || []) walk(c);
    };
    walk(profile.head);
    const kbs = (b) => +(b / 1024 / secs).toFixed(1);
    const net = Object.entries(byFile).filter(([f]) => f.startsWith('js/net/')).map(([f, b]) => [f, kbs(b)]);
    R.heap = {
      seconds: +secs.toFixed(1), allocTotalKBs: kbs(total), allocNetKBs: Object.fromEntries(net),
      allocNametagsKBs: kbs(byFile['js/net/nametags.js'] || 0), allocRemoteAvatarsKBs: kbs(byFile['js/net/remote_avatars.js'] || 0),
      topNetFns: Object.entries(byFn).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, b]) => [k, kbs(b)]),
      topFiles: Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, b]) => [k, kbs(b)]),
      heapAfterGcStartMB: +(h0.usedSize / 1048576).toFixed(2), heapAfterGcEndMB: +(h1.usedSize / 1048576).toFixed(2),
      heapGrowthMB: +((h1.usedSize - h0.usedSize) / 1048576).toFixed(2),
    };
    await cdp.detach().catch(() => {});
    await ev(() => window.__tg.install());

    // 4) bảng tên cận cảnh: dấu tiếng Việt khó, huy hiệu, vắng mặt (như mp_c2)
    const TX = SQ[0] + 10, TZ = SQ[1] + 30;
    R.tags = await ev(([x, z]) => window.__c2.SC.tags(x, z), [TX, TZ]);
    await view(TX, TZ + 3, 0, 0.12, 4.2, 3500);
    await shot('tags_close.png');
    await shot('tags_zoom.png', { x: 300, y: 200, width: 680, height: 200 });
    await view(TX, TZ + 3, 0.15, 0.2, 14, 3000);
    await shot('tags_fade.png');
    const png = await ev(() => window.__c2.atlasPNG());
    fs.writeFileSync(path.join(OUT, P + 'atlas.png'), Buffer.from(png.split(',')[1], 'base64'));
    R.programsAfter = await ev(() => window.__c2.programs().length);
    R.errorsEnd = g.errors.slice();
  } catch (e) {
    R.fatal = String(e && e.stack || e);
  } finally {
    await g.close();
    save();
  }
}

if (!ONLY || ONLY === 'full') await run('full');
if (!ONLY || ONLY === 'lite') await run('lite');
const brief = (r) => r && ({ tier: r.tier, gpu: r.gpu, fatal: r.fatal, errors: (r.errorsEnd || r.errors || []).length, programs: [r.programsBase, r.programsAfter],
  operaStatic: r.operaStatic && { tags: r.operaStatic.tagsDrawnMean, tog: r.operaStatic.togglesPerSec, flick: r.operaStatic.flickerPerSec, ov: r.operaStatic.overlap, ms: r.operaStatic.tagPassMs },
  mpCalls: r.denseMeasure && r.denseMeasure.mpCalls, callsMedian: r.denseMeasure && r.denseMeasure.callsMedian,
  walk: r.denseWalkStatic && { tags: r.denseWalkStatic.tagsDrawnMean, tog: r.denseWalkStatic.togglesPerSec, flick: r.denseWalkStatic.flickerPerSec, ov: r.denseWalkStatic.overlap, ms: r.denseWalkStatic.tagPassMs },
  orbit: r.denseWalkOrbit && { tags: r.denseWalkOrbit.tagsDrawnMean, tog: r.denseWalkOrbit.togglesPerSec, flick: r.denseWalkOrbit.flickerPerSec, ov: r.denseWalkOrbit.overlap, ms: r.denseWalkOrbit.tagPassMs },
  high: r.denseHigh && { tags: r.denseHigh.tagsDrawnMean, tog: r.denseHigh.togglesPerSec, ov: r.denseHigh.overlap },
  heap: r.heap });
console.log(JSON.stringify({ out: OUT, full: brief(report.runs.full), lite: brief(report.runs.lite) }, null, 1));
