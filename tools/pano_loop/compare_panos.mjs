// So sánh từng pano thật ↔ game bằng cx/gpt-5.6-sol-xhigh (điều phối bởi Claude, kiểm duyệt sau)
// usage: node compare_panos.mjs [startIdx] [endIdx]
import fs from 'fs';
const SPP = '/tmp/claude-0/-home-user-hp-world/c2e34905-ff51-516d-bf34-6f2f3d70ade9/scratchpad';
const sharp = (await import(SPP + '/node_modules/sharp/lib/index.js')).default;
async function gameJpg(f) {   // PNG game -> JPG 640px (giảm payload ~60%, đỡ rate-limit)
  const out = f.replace('.png', '.jq.jpg');
  if (!fs.existsSync(out)) await sharp(f).resize(640).jpeg({ quality: 68 }).toFile(out);
  return out;
}
const SP = '/tmp/claude-0/-home-user-hp-world/c2e34905-ff51-516d-bf34-6f2f3d70ade9/scratchpad';
const K = process.env.PANO_LOOP_KEY;   // API key qua env — KHÔNG commit key vào repo
const EP = process.env.PANO_LOOP_ENDPOINT || 'https://rqfwtnk.abc-tunnel.us/v1';
const LIST = JSON.parse(fs.readFileSync(SP + '/capture_list.json', 'utf8'));
const AUDIT = JSON.parse(fs.readFileSync('/home/user/hp-world/audit/audit_done.json', 'utf8'));
const AMAP = new Map(AUDIT.map((a) => [a.id, a]));
const [S, E] = [parseInt(process.argv[2] || '0'), Math.min(parseInt(process.argv[3] || '9999'), LIST.length)];
const HS = ['000', '090', '180', '270'];
const b64 = (f) => 'data:image/jpeg;base64,' + fs.readFileSync(f).toString('base64');
const b64p = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const SYS = `Bạn là chuyên gia đối chiếu ảnh thực địa với thế giới game 3D low-poly "Hải Phòng 3D" (tái tạo 1:1 trung tâm TP Hải Phòng bằng Three.js từ dữ liệu OSM + Street View). MỤC TIÊU DỰ ÁN: game giống thực tế hết mức về CẤU TRÚC — đúng loại công trình, số tầng, vị trí, vỉa hè, cây, rào, đèn, biển hiệu; KHÔNG chấm điểm độ chân thực texture/style (low-poly là chủ đích). Xe cộ/người qua lại là động, bỏ qua. Ảnh Street View chụp 10/2024; game tái tạo trạng thái đó.`;
async function callModel(messages) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(EP + '/chat/completions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'cx/gpt-5.6-sol-xhigh', messages }),
      });
      const j = await r.json();
      if (j.choices && j.choices[0]) return j.choices[0].message.content;
      console.log('ERR', JSON.stringify(j).slice(0, 200));
    } catch (e) { console.log('EXC', e.message.slice(0, 120)); }
    await new Promise((res) => setTimeout(res, 5000 * (a + 1)));
  }
  return null;
}
async function onePano(p) {
  const out = `${SP}/compare3/${p.id}.json`;
  if (fs.existsSync(out)) return 'skip';
  for (const h of HS) {
    if (!fs.existsSync(`${SP}/realsmall/${p.id}_h${h}.jpg`)) return 'wait_real';
    if (!fs.existsSync(`${SP}/gamepano3/${p.id}_h${String(parseInt(h)).padStart(3, '0')}.png`)) return 'wait_game';
  }
  const a = AMAP.get(p.id);
  const content = [{ type: 'text', text:
`PANO ${p.id} — tọa độ game (x=${p.X}, z=${p.Z}).
MÔ TẢ THỰC ĐỊA (đã catalog từ ảnh thật): ${JSON.stringify(a || {})}
8 ảnh theo thứ tự: THẬT h0 (nhìn Bắc), THẬT h90 (Đông), THẬT h180 (Nam), THẬT h270 (Tây), rồi GAME h0, GAME h90, GAME h180, GAME h270 — cùng vị trí cùng hướng.
NHIỆM VỤ: so từng cặp heading, rồi tổng hợp. CHỈ trả về JSON đúng schema:
{"headings":{"0":{"score":0-10,"missing":[],"wrong":[],"extra":[]},"90":{...},"180":{...},"270":{...}},
"score":0-10 (tổng),
"top_fixes":[{"what":"mô tả sửa gì cụ thể","type":"house|sidewalk|tree|rail|lamp|sign|water|road|landmark|other","severity":1-3,"heading":0|90|180|270}]}
score 10 = cấu trúc khớp hoàn toàn. Ghi missing/wrong/extra NGẮN GỌN cụ thể (vd "thiếu dãy nhà ống 3-4 tầng bên trái", "vỉa hè caro nhưng thật là gạch xám"). Tối đa 6 mục top_fixes, ưu tiên severity cao.` }];
  for (const h of HS) content.push({ type: 'image_url', image_url: { url: b64(`${SP}/realsmall/${p.id}_h${h}.jpg`) } });
  for (const h of HS) content.push({ type: 'image_url', image_url: { url: b64(await gameJpg(`${SP}/gamepano3/${p.id}_h${String(parseInt(h)).padStart(3, '0')}.png`)) } });
  const res = await callModel([{ role: 'system', content: SYS }, { role: 'user', content }]);
  if (!res) return 'fail';
  let parsed = null;
  try { parsed = JSON.parse(res.replace(/^```json\s*|```\s*$/g, '')); } catch (e) { /* giữ raw */ }
  fs.writeFileSync(out, JSON.stringify({ id: p.id, X: p.X, Z: p.Z, raw: res, parsed }, null, 1));
  return parsed ? `ok score=${parsed.score}` : 'ok_raw';
}
let done = 0;
for (let i = S; i < E; i++) {
  const p = LIST[i];
  let st = await onePano(p);
  let waits = 0;
  while ((st === 'wait_real' || st === 'wait_game') && waits < 520) {   // đợi tối đa 60' cho ảnh
    await new Promise((r) => setTimeout(r, 15000)); waits++;
    st = await onePano(p);
  }
  done++;
  console.log(`[${i + 1}/${E}] ${p.id}: ${st}`);
}
console.log('COMPARE_DONE');
