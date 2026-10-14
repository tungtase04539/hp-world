// tools/rekey_herokit.mjs — KHOÁ LẠI js/herokit_data.js theo js/buildings_real.js HIỆN TẠI bằng HÌNH HỌC footprint (2026-10-15).
//
// Vì sao: herokit_data khoá mỗi hero theo TÂM DIỆN TÍCH footprint (dm) + HERO_META.rbHash (FNV-1a của RB_B64) — tools/check_herokit.mjs
// báo lỗi ngay khi buildings_real.js sinh lại. Bộ sinh gốc tools/gen_herokit.mjs cần GHI CHÚ TỰ DO của 3.306 JSON trích xuất ảnh
// (keep/fp_json + fp_plan.json) — đã MẤT 2026-10-15 (thư mục scratchpad phiên bị dọn), audit/facade_fp.json không chứa ghi chú.
// ⇒ PHÂN LOẠI hero (chương trình/màu tường/màu nhấn/cờ/điểm tiêu) ĐÓNG BĂNG; khi buildings_real đổi, chạy tool này: mỗi hero được
// chuyển từ footprint CŨ (bản buildings_real nó được sinh/khoá lần trước) sang footprint MỚI:
//   1. hero → nhà cũ: tâm diện tích nhà cũ gần tâm hero nhất ≤ 0,6 m (cùng luật js/herokit.js heroAt/heroOfPoly).
//   2. nhà cũ → nhà mới: ứng viên = nhà mới có bbox giao bbox nhà cũ; độ CHỒNG = diện tích nhà cũ nằm trong nhà mới, đo bằng lưới
//      điểm tất định (bước sqrt(S)/24, trong [0,15; 1] m). Ưu tiên nhà mới CHỨA TÂM nhà cũ, rồi chồng lớn nhất, hoà (±1 %) → tâm
//      gần nhất, rồi chỉ số nhỏ. Nhận khi chồng ≥ 30 % nhà cũ HOẶC ≥ 50 % nhà mới (nhà bị cắt đôi/gộp vẫn giữ chương trình).
//   3. KHÔNG KHỚP (không ứng viên đạt ngưỡng) → bỏ; MƠ HỒ (≥ 2 hero cùng rơi vào 1 nhà mới) → giữ hero chồng lớn nhất, bỏ phần
//      còn lại; tâm mới trùng (≤ 0,6 m) tâm một nhà mới KHÁC → bỏ (check_herokit sẽ coi là khớp nhầm). Tất cả được in ra.
//   4. Ghi HERO (tâm mới, giữ nguyên mọi trường khác) + HERO_META (rb, rbHash, n, prog; `rekey` = nguồn, số khớp/bỏ).
// Tất định: cùng (herokit_data, bản cũ, bản mới) → cùng byte.
//
// usage: node tools/rekey_herokit.mjs [--from <buildings_real.js cũ>] [--dry]
//   không --from: tìm trong lịch sử git (`git log -- js/buildings_real.js`, cả HEAD) bản có FNV-1a(RB_B64) == HERO_META.rbHash.
import fs from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { decodeRB } from '../js/buildings_data.js';
import { RB_B64 } from '../js/buildings_real.js';
import { HERO_PROG, HERO_META, HERO } from '../js/herokit_data.js';
import { rbHash } from './check_herokit.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const A = process.argv.slice(2);
const opt = (k) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : null; };
const DRY = A.includes('--dry');
const b64Of = (txt) => { const m = /export const RB_B64 = "([^"]*)"/.exec(txt); return m ? m[1] : null; };

const curHash = rbHash(RB_B64);
// ---------- bản buildings_real CŨ (bản hero đang khoá theo) ----------
let oldB64 = null, oldSrc = null;
if (opt('--from')) { oldB64 = b64Of(fs.readFileSync(opt('--from'), 'utf8')); oldSrc = opt('--from'); }
else {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 });
  const shas = git('log', '--format=%H', 'HEAD', '--', 'js/buildings_real.js').trim().split('\n').filter(Boolean);
  for (const s of shas) {
    const b = b64Of(git('show', `${s}:js/buildings_real.js`));
    if (b && rbHash(b) === HERO_META.rbHash) { oldB64 = b; oldSrc = s.slice(0, 7) + ':js/buildings_real.js'; break; }
  }
}
if (!oldB64) { console.error(`không tìm thấy buildings_real có băm ${HERO_META.rbHash} (dùng --from <file>)`); process.exit(1); }
if (rbHash(oldB64) !== HERO_META.rbHash) { console.error(`--from: băm ${rbHash(oldB64)} ≠ HERO_META.rbHash ${HERO_META.rbHash}`); process.exit(1); }
if (curHash === HERO_META.rbHash) { console.log(`herokit đã khoá theo buildings_real hiện tại (${curHash}) — không làm gì`); process.exit(0); }

const DO = decodeRB(oldB64), DN = decodeRB(RB_B64);
function geom(D) {
  const P = [];
  for (let b = 0; b < D.nB; b++) {
    const s = D.vStart[b], n = D.vStart[b + 1] - s, pts = [];
    let a = 0, cx = 0, cz = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, xa = D.x[s + i], za = D.z[s + i], xb = D.x[s + j], zb = D.z[s + j], c = xa * zb - xb * za;
      a += c; cx += (xa + xb) * c; cz += (za + zb) * c; pts.push([xa, za]);
      if (xa < x0) x0 = xa; if (xa > x1) x1 = xa; if (za < z0) z0 = za; if (za > z1) z1 = za;
    }
    P.push(Math.abs(a) < 1e-6 ? null : { pts, cx: cx / (3 * a), cz: cz / (3 * a), area: Math.abs(a) / 2, x0, x1, z0, z1 });
  }
  return P;
}
const PO = geom(DO), PN = geom(DN);
const inPoly = (pts, x, z) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
// lưới ô 16 m: tâm (nhà cũ) + bbox (nhà mới)
const G = 16, key = (i, j) => i * 100003 + j;
const gC = new Map();
PO.forEach((p, b) => { if (!p) return; const k = key(Math.floor(p.cx / G), Math.floor(p.cz / G)); if (!gC.has(k)) gC.set(k, []); gC.get(k).push(b); });
const gN = new Map();
PN.forEach((p, b) => {
  if (!p) return;
  for (let i = Math.floor(p.x0 / G); i <= Math.floor(p.x1 / G); i++) for (let j = Math.floor(p.z0 / G); j <= Math.floor(p.z1 / G); j++) {
    const k = key(i, j); if (!gN.has(k)) gN.set(k, []); gN.get(k).push(b);
  }
});
const nearestCentroid = (P, grid, x, z, r2) => {
  let best = r2, bi = -1; const gx = Math.floor(x / G), gz = Math.floor(z / G);
  for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const b of grid.get(key(i, j)) || []) {
    const d = (P[b].cx - x) ** 2 + (P[b].cz - z) ** 2; if (d < best) { best = d; bi = b; }
  }
  return bi;
};
// centroid index of NEW buildings (to detect a rekeyed centre landing ≤ 0.6 m from ANOTHER new building's centre)
const gNC = new Map();
PN.forEach((p, b) => { if (!p) return; const k = key(Math.floor(p.cx / G), Math.floor(p.cz / G)); if (!gNC.has(k)) gNC.set(k, []); gNC.get(k).push(b); });

function bestNew(po) {
  const st = Math.min(1, Math.max(0.15, Math.sqrt(po.area) / 24));
  const samp = [];
  for (let x = po.x0 + st / 2; x < po.x1; x += st) for (let z = po.z0 + st / 2; z < po.z1; z += st) if (inPoly(po.pts, x, z)) samp.push([x, z]);
  if (!samp.length) samp.push([po.cx, po.cz]);
  const cand = new Set();
  for (let i = Math.floor(po.x0 / G); i <= Math.floor(po.x1 / G); i++) for (let j = Math.floor(po.z0 / G); j <= Math.floor(po.z1 / G); j++) for (const b of gN.get(key(i, j)) || []) cand.add(b);
  const res = [];
  for (const b of [...cand].sort((u, v) => u - v)) {
    const pn = PN[b];
    if (pn.x1 < po.x0 || pn.x0 > po.x1 || pn.z1 < po.z0 || pn.z0 > po.z1) continue;
    let k = 0; for (const [x, z] of samp) if (x >= pn.x0 && x <= pn.x1 && z >= pn.z0 && z <= pn.z1 && inPoly(pn.pts, x, z)) k++;
    if (!k) continue;
    const ov = (k / samp.length) * po.area;
    res.push({ b, ov, ctr: inPoly(pn.pts, po.cx, po.cz), d: Math.hypot(pn.cx - po.cx, pn.cz - po.cz), ok: ov >= 0.3 * po.area || ov >= 0.5 * pn.area });
  }
  const ok = res.filter((r) => r.ok);
  ok.sort((u, v) => (v.ctr - u.ctr) || (Math.abs(v.ov - u.ov) > 0.01 * po.area ? v.ov - u.ov : 0) || u.d - v.d || u.b - v.b);
  return ok[0] || null;
}

const unmatched = [], ambiguous = [], collide = [], claims = new Map();
let same = 0, moved = 0;
HERO.forEach((h, i) => {
  const bo = nearestCentroid(PO, gC, h[0] / 10, h[1] / 10, 0.36);
  if (bo < 0) { unmatched.push({ i, at: [h[0] / 10, h[1] / 10], why: 'không khớp nhà cũ' }); return; }
  const r = bestNew(PO[bo]);
  if (!r) { unmatched.push({ i, at: [h[0] / 10, h[1] / 10], why: 'nhà cũ không còn nhà mới chồng đủ' }); return; }
  if (!claims.has(r.b)) claims.set(r.b, []);
  claims.get(r.b).push({ i, ov: r.ov / PO[bo].area });
});
const OUT = [];
for (const [b, list] of [...claims.entries()].sort((u, v) => u[0] - v[0])) {
  list.sort((u, v) => v.ov - u.ov || u.i - v.i);
  for (const l of list.slice(1)) ambiguous.push({ i: l.i, at: [HERO[l.i][0] / 10, HERO[l.i][1] / 10], keptHero: list[0].i, newB: b });
  const h = HERO[list[0].i], pn = PN[b];
  const cx = Math.round(pn.cx * 10), cz = Math.round(pn.cz * 10);
  // tâm mới (làm tròn dm) phải về đúng nhà b theo luật heroAt (không nhà mới nào khác gần hơn trong 0,6 m)
  const nb = nearestCentroid(PN, gNC, cx / 10, cz / 10, 0.36);
  if (nb !== b) { collide.push({ i: list[0].i, at: [cx / 10, cz / 10], newB: b, nearest: nb }); continue; }
  if (cx === h[0] && cz === h[1]) same++; else moved++;
  OUT.push([cx, cz, ...h.slice(2)]);
}
OUT.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const prog = {}; for (const r of OUT) prog[HERO_PROG[r[2]]] = (prog[HERO_PROG[r[2]]] || 0) + 1;
const fmt = (l) => l.map((o) => `#${o.i} (${o.at.map((v) => v.toFixed(1)).join(', ')})${o.why ? ' ' + o.why : ''}`).join('; ');
console.log(`rekey herokit: nguồn ${oldSrc} (${HERO_META.rbHash}, ${DO.nB} nhà) → hiện tại (${curHash}, ${DN.nB} nhà)`);
console.log(`  ${HERO.length} hero: khớp ${OUT.length} (giữ tâm ${same}, dời tâm ${moved}) · không khớp ${unmatched.length} · mơ hồ ${ambiguous.length} · trùng tâm ${collide.length}`);
if (unmatched.length) console.log('  KHÔNG KHỚP (bỏ):', fmt(unmatched));
if (ambiguous.length) console.log('  MƠ HỒ (bỏ, nhà mới đã có hero chồng lớn hơn):', ambiguous.map((o) => `#${o.i} → b${o.newB} (giữ #${o.keptHero})`).join('; '));
if (collide.length) console.log('  TRÙNG TÂM (bỏ):', collide.map((o) => `#${o.i} b${o.newB}~b${o.nearest}`).join('; '));

const gen0 = HERO_META.rekey ? HERO_META.rekey.genRbHash : HERO_META.rbHash;
const meta = { ...HERO_META, rb: DN.nB, rbHash: curHash, n: OUT.length, prog,
  rekey: { tool: 'tools/rekey_herokit.mjs', genRbHash: gen0, from: HERO_META.rbHash, matched: OUT.length, moved, unmatched: unmatched.length, ambiguous: ambiguous.length, collide: collide.length } };
const txt = '// js/herokit_data.js — SINH TỰ ĐỘNG bởi tools/gen_herokit.mjs (Đợt 3 W5-A HERO-KIT). ĐỪNG SỬA TAY.\n'
  + '// HERO[i] = [cx·10, cz·10 (tâm diện tích footprint, dm), chương trình (HERO_PROG), màu tường sRGB | −1, màu nhấn (biển) sRGB | −1,\n'
  + '//            cờ: 1 mái ngói · 2 rào/cổng · 4 mái che sảnh · 8 bậc thang · 16 cửa vòm · 32 khối cong · 64 hàng cột · 128 điện máy · 256 thời trang · 512 điện thoại,\n'
  + '//            điểm tiêu x·10, z·10 (nơi tia quan sát chạm mặt nhà: sảnh/mái che/biển đặt ở đoạn mặt tiền đó)]\n'
  + '// KHOÁ LẠI bởi tools/rekey_herokit.mjs (phân loại đóng băng — ghi chú fp_json đã mất 2026-10-15; HERO_META.rekey).\n'
  + `export const HERO_PROG = ${JSON.stringify(HERO_PROG)};\n`
  + `export const HERO_META = ${JSON.stringify(meta)};\n`
  + 'export const HERO = [\n' + OUT.map((r) => JSON.stringify(r)).join(',\n') + '\n];\n';
if (DRY) console.log('  (--dry: không ghi)');
else { fs.writeFileSync(new URL('../js/herokit_data.js', import.meta.url), txt); console.log('  ghi js/herokit_data.js —', OUT.length, 'hero, rbHash', curHash); }
