// tools/qa/lmfit_prep.mjs — dữ liệu cho tools/qa/lmfit.py (Đợt 3 W2-E): <dir>/lmpoly.json (LM_POLY) + <dir>/segs.json
// (đoạn phố ROADS_DT p/s/t/r/w/h: [ax,az,bx,bz,facadeLine,curbLine] theo js/xsection.js). usage: node tools/qa/lmfit_prep.mjs <dir>
import fs from 'fs';
const dir = process.argv[2] || '.';
const J = (f) => new URL('../../js/' + f, import.meta.url).href;
const { LM_POLY } = await import(J('landmark_polys.js'));
const { ROADS_DT } = await import(J('mapdata.js'));
const X = await import(J('xsection.js'));
const segs = [];
for (const r of ROADS_DT) {
  if (!'pstrwh'.includes(r.c)) continue;
  for (let i = 0; i + 1 < r.pts.length; i++) segs.push([...r.pts[i], ...r.pts[i + 1], X.facadeLine(r.c), X.curbLine(r.c)]);
}
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(dir + '/lmpoly.json', JSON.stringify(LM_POLY));
fs.writeFileSync(dir + '/segs.json', JSON.stringify(segs));
console.log('lmpoly', Object.keys(LM_POLY).length, 'segs', segs.length, '→', dir);
