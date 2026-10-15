// tools/qa/mp_c2_plot.mjs — vẽ interp.json (tools/qa/mp_c2_avatars.mjs) thành SVG: sai số vị trí (m) theo thời gian.
//   node tools/qa/mp_c2_plot.mjs C:/Users/Admin/hp-world-work/mp2/c2/interp.json   → interp.svg cạnh tệp json
import fs from 'fs';
const f = process.argv[2];
const J = JSON.parse(fs.readFileSync(f, 'utf8'));
const S = J.series, W = 1200, H = 360, L = 50, B = 30, T = 30;
const tMax = S[S.length - 1][0], yMax = 2;
const X = (t) => L + (t / tMax) * (W - L - 10), Y = (e) => H - B - (Math.min(e, yMax) / yMax) * (H - B - T);
let d = '';
S.forEach(([t, e], i) => { d += (i ? 'L' : 'M') + X(t).toFixed(1) + ',' + Y(e).toFixed(1); });
const grid = [0, 0.25, 0.5, 1, 1.5, 2].map((v) => `<line x1="${L}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" stroke="#ddd"/><text x="${L - 6}" y="${Y(v) + 4}" font-size="11" text-anchor="end">${v}</text>`).join('');
const xt = []; for (let s = 0; s <= tMax / 1000; s += 5) xt.push(`<text x="${X(s * 1000)}" y="${H - 10}" font-size="11" text-anchor="middle">${s}s</text>`);
const sm = J.summary;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Segoe UI, Arial">
<rect width="100%" height="100%" fill="#fff"/>${grid}${xt.join('')}
<rect x="${X(39700)}" y="${T}" width="${X(42800) - X(39700)}" height="${H - B - T}" fill="#f3e0e0"/>
<text x="${X(41250)}" y="${T + 14}" font-size="11" text-anchor="middle">rớt mạng → RESUME</text>
<path d="${d}" fill="none" stroke="#1a73e8" stroke-width="1"/>
<text x="${L}" y="18" font-size="13">Sai số vị trí vẽ (m, cắt ở ${yMax}) — p50 ${sm.p50} · p95 ${sm.p95} · p99 ${sm.p99} · bước khung lớn nhất ${sm.maxFrameJumpM} m · trễ hiển thị ${sm.displayLagMs} ms</text>
</svg>`;
fs.writeFileSync(f.replace(/\.json$/, '.svg'), svg);
console.log('ok', f.replace(/\.json$/, '.svg'));
