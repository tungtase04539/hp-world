// Sinh js/shopsigns.js: biển hiệu TÊN THẬT từ catalog 551 pano (audit/audit_enriched.json)
// Vị trí = pano + 14m theo heading công trình; chữ lấy trong dấu nháy ở features.
import fs from 'fs';
const arr = JSON.parse(fs.readFileSync('audit/audit_enriched.json', 'utf8'));
const out = [], seen = new Set();
for (const p of arr) {
  if (p.X === undefined) continue;
  for (const b of p.buildings || []) {
    if (typeof b.heading !== 'number' || !b.features) continue;
    const names = [...(b.features.matchAll(/'([^']{2,26})'/g))].map((m) => m[1])
      .filter((n) => /[A-ZĐÀ-Ỹ0-9]/.test(n) && !/^(50%|CHO THUÊ)/i.test(n)).slice(0, 2);
    for (const name of names) {
      const rad = b.heading * Math.PI / 180;
      const x = +(p.X + Math.sin(rad) * 14).toFixed(1), z = +(p.Z - Math.cos(rad) * 14).toFixed(1);
      const key = name.toUpperCase() + '|' + Math.round(x / 30) + '|' + Math.round(z / 30);
      if (seen.has(key)) continue;
      seen.add(key);
      // biển quay MẶT về phía pano (ngược heading): góc quay game cho pháp tuyến -heading
      out.push([x, z, +(-rad).toFixed(3), name.toUpperCase().slice(0, 24)]);
    }
  }
}
fs.writeFileSync('js/shopsigns.js', '// SINH TỰ ĐỘNG bởi tools/pano_loop/gen_shopsigns.mjs — ĐỪNG SỬA TAY\n'
  + 'export const SHOP_SIGNS = ' + JSON.stringify(out) + ';\n');
console.log('signs:', out.length);
