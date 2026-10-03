// tools/diag.mjs — KIỂM THỰC THỂ + BẤT BIẾN GAMEPLAY (chạy trên Windows: Chrome hệ thống + playwright-core, xem
// tools/qa/launch.mjs). Thay bản Linux cũ (/opt/pw-browsers, toạ độ 1:10 của tàu/thuyền đã lỗi thời).
//   python -m http.server 8177   (ở gốc repo)      node tools/diag.mjs [--port 8177] [--quality full|lite]
// Kiểm:
//  1. __hp.diag(): biển địa danh / NPC / xe / hoa — cao độ hợp lý, TIẾP CẬN được, nằm TRONG vùng chơi;
//  2. thuyền đậu trên nước đủ sâu (gh < −0.6), xe cạn trên đất;
//  3. giao thông (js/traffic.js check()): xe chạy bên PHẢI ở phố 2 chiều, không ngược chiều đường đôi, người đi bộ
//     không đứng trong footprint nhà thật, không tác tử nào ngoài vùng chơi; có xe máy + ô tô + người đi bộ;
//  4. nhiệm vụ: mục tiêu địa danh = số biển trong vùng chơi (allDone đạt được);
//  5. 0 lỗi JS.
// Thoát mã 1 nếu có vấn đề (dùng được trong CI/pre-push).
import { openGame, args } from './qa/launch.mjs';
const A = args();
const g = await openGame({ port: A.get('port', '8177'), quality: A.get('quality', 'full') });
const problems = [];
if (!g.hpReadyMs) problems.push('game không khởi động được');
else {
  await g.pg.waitForTimeout(+A.get('settle', '4000'));
  const r = await g.pg.evaluate(() => {
    const hp = window.__hp;
    const out = { diag: hp.diag(), boats: [], traffic: hp.traffic.check(), stats: hp.traffic.stats() };
    for (const v of hp.vehicles) out.boats.push([v.type, Math.round(v.pos.x), Math.round(v.pos.z), +hp.gh(v.pos.x, v.pos.z).toFixed(2), v.land]);
    const ql = document.querySelectorAll('#questList .qprog');
    out.questText = [...ql].map((e) => e.textContent);
    return out;
  });
  for (const p of r.diag) problems.push('diag: ' + p);
  for (const [type, x, z, h, land] of r.boats) {
    if (!land && h > -0.6) problems.push(`thuyền ${type} (${x},${z}) mắc cạn h=${h}`);
    if (land && h < 0.3) problems.push(`xe ${type} (${x},${z}) dưới nước h=${h}`);
  }
  const t = r.traffic;
  if (t.wrongSide) problems.push(`giao thông: ${t.wrongSide}/${t.vehicles} xe đi bên TRÁI phố 2 chiều ${JSON.stringify(t.examples)}`);
  if (t.wrongWay) problems.push(`giao thông: ${t.wrongWay} xe ngược chiều đường đôi`);
  if (t.walkInBuilding) problems.push(`giao thông: ${t.walkInBuilding}/${t.walkers} người đi bộ trong nhà ${JSON.stringify(t.examples)}`);
  if (t.outside) problems.push(`giao thông: ${t.outside} tác tử ngoài vùng chơi`);
  if (!r.stats.bikes || !r.stats.cars || !r.stats.walkers) problems.push('giao thông: thiếu xe máy/ô tô/người đi bộ ' + JSON.stringify(r.stats));
  console.log('Phương tiện:', r.boats.map((b) => b.join(' ')).join(' | '));
  console.log('Giao thông:', JSON.stringify(r.stats), '| bất biến:', JSON.stringify(t));
  console.log('Nhiệm vụ:', r.questText.join(' · '));
}
for (const e of g.errors) problems.push('JS: ' + e);
console.log(`tier ${g.tier} | ${g.gpu} | hpReady ${g.hpReadyMs} ms | start ${g.startReadyMs} ms`);
console.log(problems.length ? 'VẤN ĐỀ:\n' + problems.join('\n') : 'TẤT CẢ THỰC THỂ OK — 0 lỗi JS');
await g.close();
process.exit(problems.length ? 1 : 0);
