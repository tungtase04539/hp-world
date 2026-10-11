// tools/qa/xsec.mjs — KIỂM MẶT CẮT PHỐ + "CAMERA TRUTH" (Đợt 3 W3-A, AUDIT3 FP-1.5). CHỈ DỮ LIỆU, không mở trình duyệt.
// Gọi qua: node tools/qa/clearance.mjs --xsec [--out f.json] [--ids pano_001,pano_487] [--repo <thư mục gốc khác để so A/B>]
// hoặc trực tiếp: node tools/qa/xsec.mjs [cùng tham số].
// Với 551 camera pano (tools/pano_loop/list_full_551.json):
//  (1) LỆCH TIM: hình chiếu lên way p/s/t/r gần nhất (≤ 14 m, trong nhịp đoạn) → off = |v|; cờ off>1,5 (chữ spec), NGOÀI LÒNG
//      (|v| > nửa lòng − 0,9 m nửa thân xe) và NGOÀI BÓ VỈA (|v| > nửa lòng). Bề rộng = xsection theo TỪNG WAY (ROADS_DT[i].w).
//  (2) MẶT NHÀ GẦN NHẤT mỗi hướng nhìn h0/90/180/270 (nón ±45°, tia 2°, ≤ 40 m): game = js/buildings_real.js (RB01, nhà
//      sống), thật = footprint Overture gốc (tools/ov_buildings.csv, cùng phép dịch nguồn như process_buildings). Cờ:
//      `close` = game < thật − 1,5 m (nhà game lấn về phía camera — CAMNEAR), `inside` = camera trong nhà game,
//      `near4` = game < 4 m trong khi thật ≥ 6 m. Ngưỡng động spec (hw + vỉa − 0,5) in kèm cho hướng vuông góc phố.
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export async function runXsec(argv) {
  const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(arg('repo', path.join(here, '../..')));
  const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
  const { ROADS_DT } = await imp('js/mapdata.js');
  const X = await imp('js/xsection.js');
  const { decodeRB, FLAG } = await imp('js/buildings_data.js');
  const { RB_B64 } = await imp('js/buildings_real.js');
  const { Grid } = await imp('tools/bgeom.mjs');
  const roadHW = X.roadHW || ((r) => X.ROAD_HW[r.c] ?? 2.75);
  const fl = (r) => X.facadeLine(X.roadHW ? r : r.c);
  // Overture: luôn đọc từ repo HIỆN TẠI (dữ liệu thật dùng chung cho A/B)
  const ovPath = path.join(here, '../ov_buildings.csv');
  const { loadOverture } = await import(pathToFileURL(path.join(here, '../street_fit.mjs')).href);
  const ov = loadOverture(ovPath);
  if (!ov) throw new Error('xsec: thiếu tools/ov_buildings.csv');
  const L = JSON.parse(fs.readFileSync(path.join(here, '../pano_loop/list_full_551.json'), 'utf8'));
  const only = arg('ids', '') ? new Set(arg('ids').split(',').map((s) => (s.startsWith('pano_') ? s : 'pano_' + s))) : null;
  // nhà game: lưới cạnh + lưới đa giác
  const D = decodeRB(RB_B64);
  const E = [], EB = [], polys = [];
  for (let b = 0; b < D.nB; b++) {
    const P = []; for (let v = D.vStart[b]; v < D.vStart[b + 1]; v++) P.push([D.x[v], D.z[v]]);
    polys.push(P);
    for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; E.push(a[0], a[1], c[0], c[1]); EB.push(b); }
  }
  let lastHit = -1;
  const eg = new Grid(8);
  for (let i = 0; i < E.length / 4; i++) eg.insert(i, [Math.min(E[4 * i], E[4 * i + 2]), Math.min(E[4 * i + 1], E[4 * i + 3]), Math.max(E[4 * i], E[4 * i + 2]), Math.max(E[4 * i + 1], E[4 * i + 3])]);
  const pg = new Grid(16); polys.forEach((P, i) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } pg.insert(i, [x0, z0, x1, z1]); });
  const pip = (P, x, z) => { let c = false; for (let i = 0, n = P.length, j = n - 1; i < n; j = i++) { const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const insideGame = (x, z) => { let h = false; pg.query([x, z, x, z], (i) => { if (!h && pip(polys[i], x, z)) h = true; }); return h; };
  const rayGame = (x, z, dx, dz, max) => {
    const ex = x + dx * max, ez = z + dz * max; let best = max + 1;
    eg.query([Math.min(x, ex), Math.min(z, ez), Math.max(x, ex), Math.max(z, ez)], (i) => {
      const ax = E[4 * i], az = E[4 * i + 1], sx = E[4 * i + 2] - ax, sz = E[4 * i + 3] - az, den = dx * sz - dz * sx;
      if (Math.abs(den) < 1e-9) return;
      const t = ((ax - x) * sz - (az - z) * sx) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0 && t < best && u >= 0 && u <= 1) { best = t; lastHit = EB[i]; }
    });
    return best <= max ? best : null;
  };
  const MAXR = 40;
  let coneHit = -1;
  const cone = (ray, x, z, hdg) => {   // hướng la bàn hdg (0 = Bắc = −Z) ±45°, tia 2°; coneHit = nhà game gần nhất
    let m = null; coneHit = -1;
    for (let a = -44; a <= 44; a += 2) { const t = ((hdg + a) * Math.PI) / 180; lastHit = -1; const d = ray(x, z, Math.sin(t), -Math.cos(t), MAXR); if (d != null && (m == null || d < m)) { m = d; coneHit = lastHit; } }
    return m;
  };
  const segs = []; ROADS_DT.forEach((r, ri) => { if (!'pstr'.includes(r.c)) return; for (let i = 0; i + 1 < r.pts.length; i++) segs.push([ri, ...r.pts[i], ...r.pts[i + 1]]); });
  const rows = [];
  for (const e of L) {
    if (only && !only.has(e.id)) continue;
    const x = e.X, z = e.Z;
    let best = null;
    for (const [ri, ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; if (L2 < 0.25) continue;
      const t = ((x - ax) * dx + (z - az) * dz) / L2; if (t < -0.02 || t > 1.02) continue;
      const Ls = Math.sqrt(L2), v = ((x - ax) * -dz + (z - az) * dx) / Ls;
      if (Math.abs(v) <= 14 && (!best || Math.abs(v) < Math.abs(best.v))) best = { ri, v, ux: dx / Ls, uz: dz / Ls };
    }
    const row = { id: e.id };
    if (best) {
      const r = ROADS_DT[best.ri], hw = roadHW(r);
      Object.assign(row, { ri: best.ri, c: r.c, w: +(2 * hw).toFixed(1), off: +Math.abs(best.v).toFixed(2), outCarr: Math.abs(best.v) > hw - 0.9, beyondKerb: Math.abs(best.v) > hw, flDyn: +(fl(r) - 0.5).toFixed(2) });
      // hướng nào gần VUÔNG GÓC phố (để in ngưỡng động spec)
      row.perp = [0, 90, 180, 270].filter((h) => { const t = (h * Math.PI) / 180; return Math.abs(Math.sin(t) * best.ux - Math.cos(t) * best.uz) < 0.5; });
      // ngưỡng động spec theo hướng vuông góc, đã trừ lệch camera về phía đó: hw + vỉa − 0,5 ∓ v (n = pháp tuyến trái (−uz, ux))
      row.dyn = {};
      for (const h of row.perp) { const t = (h * Math.PI) / 180, dn = Math.sin(t) * -best.uz + -Math.cos(t) * best.ux; row.dyn[h] = +(fl(r) - 0.5 - Math.sign(dn) * best.v).toFixed(2); }
    }
    row.inside = insideGame(x, z);
    row.game = {}; row.ov = {}; row.flag = [];
    for (const h of [0, 90, 180, 270]) {
      const g = row.inside ? 0 : cone(rayGame, x, z, h), gb = coneHit, o = cone(ov.ray, x, z, h);
      row.game[h] = g == null ? null : +g.toFixed(1); row.ov[h] = o == null ? null : +o.toFixed(1);
      if (g != null && (o == null ? g < 10 : g < o - 1.5)) row.flag.push('close' + h + (gb >= 0 && D.flags[gb] & FLAG.SYNTH ? 'S' : 'R'));
      if (g != null && g < 4 && (o == null || o >= 6)) row.flag.push('near4_' + h);
      if (g != null && row.dyn && row.dyn[h] != null && g < row.dyn[h]) row.flag.push('dyn' + h + (gb >= 0 && D.flags[gb] & FLAG.SYNTH ? 'S' : 'R'));
    }
    rows.push(row);
  }
  const n = rows.length, cnt = (f) => rows.filter(f).length;
  // SAI SỐ mặt nhà game − Overture trên các hướng có mặt nhà THẬT ≤ 30 m (chữ spec FP-1 "± 1,5 m của Overture"): đo cả 2 chiều —
  // QUÁ GẦN (< −1,5: nhà lấn về camera) lẫn QUÁ XA (> +1,5: nhà thật bị cắt lùi về facadeLine quá rộng, ô trống giả)
  const errs = []; for (const r of rows) for (const h of [0, 90, 180, 270]) { const o = r.ov[h]; if (o != null && o <= 30 && !r.inside) errs.push((r.game[h] ?? MAXR) - o); }
  const pct = (k) => +((100 * k) / Math.max(1, errs.length)).toFixed(1);
  const st = {
    facadeHeadings: errs.length, within1_5pct: pct(errs.filter((e) => Math.abs(e) <= 1.5).length),
    tooClose: errs.filter((e) => e < -1.5).length, tooFar: errs.filter((e) => e > 1.5).length, tooFar3: errs.filter((e) => e > 3).length,
    meanAbsErr: +(errs.reduce((s, e) => s + Math.abs(e), 0) / Math.max(1, errs.length)).toFixed(2),
    cams: n,
    onStreet: cnt((r) => r.ri != null),
    off_gt_1_5: cnt((r) => r.off > 1.5), off_ge_3: cnt((r) => r.off >= 3), outCarriage: cnt((r) => r.outCarr), beyondKerb: cnt((r) => r.beyondKerb),
    meanOff: +(rows.filter((r) => r.off != null).reduce((s, r) => s + r.off, 0) / Math.max(1, cnt((r) => r.off != null))).toFixed(2),
    insideGame: cnt((r) => r.inside),
    camsClose: cnt((r) => r.flag.some((f) => f.startsWith('close'))), headingsClose: rows.reduce((s, r) => s + r.flag.filter((f) => f.startsWith('close')).length, 0),
    camsNear4: cnt((r) => r.flag.some((f) => f.startsWith('near4'))),
    headingsCloseSynth: rows.reduce((s, r) => s + r.flag.filter((f) => /^close\d+S/.test(f)).length, 0),
    headingsCloseReal: rows.reduce((s, r) => s + r.flag.filter((f) => /^close\d+R/.test(f)).length, 0),
    // hướng VUÔNG GÓC phố có mặt nhà game gần hơn ngưỡng động (hw + vỉa − 0,5 − lệch camera về phía đó): S = nhà sinh, R = thật
    perpBelowDynSynth: rows.reduce((s, r) => s + r.flag.filter((f) => /^dyn\d+S/.test(f)).length, 0),
    perpBelowDynReal: rows.reduce((s, r) => s + r.flag.filter((f) => /^dyn\d+R/.test(f)).length, 0),
  };
  return { stats: st, rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const res = await runXsec(argv);
  const i = argv.indexOf('--out'); if (i >= 0) fs.writeFileSync(argv[i + 1], JSON.stringify(res, null, 1));
  console.log('XSEC', JSON.stringify(res.stats));
}
