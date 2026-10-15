// tools/qa/mp2_c1_unit.mjs — kiểm nhanh phía game MP-2 C1 trong node (không trình duyệt, không mạng). Thoát 1 nếu trượt.
//   node tools/qa/mp2_c1_unit.mjs
// 1) main.js: KHÔNG import tĩnh js/net/* (0 request mới khi chơi một mình) và NET_DEFAULT_ON khớp DEFAULT_SERVER.
// 2) config.parseServer: wss/https/ws-localhost nhận; ws ra ngoài, IP trần công khai, http lạ bị từ chối.
// 3) correct.js: lệch nhỏ kéo mượt hết trong 0,15 s; lệch lớn nhảy hẳn; đang cưỡi thì dời xe.
// 4) i18n: mọi khoá mp*/chat* có cả vi lẫn en.
// 5) Chuyển gói SNAPSHOT worker ↔ net.js: cùng bố cục (SNAP_HDR/ENTER_F/UPD_F).
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rd = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let fail = 0, pass = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.error('TRƯỢT:', msg); } };

// 1
const main = rd('js/main.js');
ok(!/^import[^;]*['"]\.\/net\//m.test(main), 'main.js import tĩnh js/net/*');
ok(!/^import[^;]*['"]\.\/ui\/chat/m.test(main), 'main.js import tĩnh js/ui/chat.js');
const cfg = await import(pathToFileURL(path.join(ROOT, 'js/net/config.js')).href);
const defOn = /const NET_DEFAULT_ON = (true|false);/.exec(main);
ok(defOn && (defOn[1] === 'true') === !!cfg.DEFAULT_SERVER, 'NET_DEFAULT_ON (main.js) phải = DEFAULT_SERVER khác rỗng (js/net/config.js)');

// 2
const P = cfg.parseServer;
ok(P('wss://hp.example.vn')?.ws === 'wss://hp.example.vn/play', 'wss');
ok(P('https://hp.example.vn/')?.http === 'https://hp.example.vn', 'https → http API');
ok(P('ws://127.0.0.1:9210')?.ws === 'ws://127.0.0.1:9210/play', 'ws localhost');
ok(P('localhost:9210')?.local === true, 'localhost không giao thức');
ok(P('ws://example.com') === null, 'ws:// ra ngoài phải bị từ chối');
ok(P('wss://8.8.8.8') === null, 'IP trần công khai phải bị từ chối');
ok(P('ftp://x.vn') === null, 'giao thức lạ');
ok(P('') === null && P('   ') === null, 'rỗng');
ok(P('wss://user:pw@x.vn') === null, 'có user:pass');

// 3
const { createCorrector, SNAP_M, PULL_S } = await import(pathToFileURL(path.join(ROOT, 'js/net/correct.js')).href);
const V = (x, y, z) => ({ x, y, z, set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; }, copy(o) { this.x = o.x; this.y = o.y; this.z = o.z; return this; } });
{
  const ps = { pos: V(0, 2, 0), yaw: 0, vy: 0, mounted: null };
  const c = createCorrector({ pState: ps, surfaceY: () => 2 });
  const r = c.apply({ x: 3, z: 0, y: 2, yaw: 0, epoch: 1, reason: 1 });
  ok(!r.snapped && Math.abs(r.dist - 3) < 1e-9, 'lệch 3 m → kéo mượt');
  for (let i = 0; i < 20; i++) c.step(1 / 60);
  ok(Math.abs(ps.pos.x - 3) < 1e-6 && !c.pending, `kéo mượt xong trong ${PULL_S} s (x=${ps.pos.x})`);
  const r2 = c.apply({ x: 300, z: 40, y: 2, yaw: 1, epoch: 2, reason: 5 });
  ok(r2.snapped && ps.pos.x === 300 && ps.pos.z === 40 && ps.yaw === 1, `lệch > ${SNAP_M} m → nhảy hẳn`);
  const veh = { pos: V(10, 2, 10), vel: 9, heading: 0, mesh: { position: V(10, 2, 10), rotation: { y: 0 } } };
  ps.mounted = veh;
  c.apply({ x: 100, z: 100, y: 2, yaw: 2, epoch: 3, reason: 1 });
  ok(veh.pos.x === 100 && veh.vel === 0 && veh.mesh.position.x === 100, 'đang cưỡi → dời xe, xe dừng');
}

// 4
const i18n = rd('js/i18n.js');
const keysOf = (blk) => new Set([...blk.matchAll(/^\s+((?:mp|chat|vehicleBusy)\w*):/gm)].map((m) => m[1]));
const viBlk = i18n.slice(i18n.indexOf('vi: {'), i18n.indexOf('en: {'));
const enBlk = i18n.slice(i18n.indexOf('en: {'));
const kv = keysOf(viBlk), ke = keysOf(enBlk);
// một số dòng khai báo nhiều khoá: lấy thêm "khoá:" giữa dòng
const allKeys = (blk) => new Set([...blk.matchAll(/\b((?:mp|chat)[A-Za-z_0-9]*):\s*'/g)].map((m) => m[1]));
const av = allKeys(viBlk), ae = allKeys(enBlk);
for (const k of av) ok(ae.has(k), `i18n thiếu en.${k}`);
for (const k of ae) ok(av.has(k), `i18n thiếu vi.${k}`);
ok(kv.size > 10 && ke.size > 10, 'có khoá mp/chat');

// 5
const wk = rd('js/net/net_worker.js'), nt = rd('js/net/net.js');
const lay = (s) => (/const SNAP_HDR = (\d+), ENTER_F = (\d+), UPD_F = (\d+);/.exec(s) || []).slice(1).join(',');
ok(lay(wk) && lay(wk) === lay(nt), `bố cục SNAPSHOT worker (${lay(wk)}) ≠ net.js (${lay(nt)})`);
ok(!/import[^;]*net_worker/.test(nt), 'net.js không được import net_worker.js (chỉ new Worker)');

console.log(`mp2_c1_unit: ${pass} đạt, ${fail} trượt`);
process.exit(fail ? 1 : 0);
