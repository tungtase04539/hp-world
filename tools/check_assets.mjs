// KIỂM ASSET TRÊN CDN: mọi URL 'assets/x.glb' mà code dùng phải tồn tại ở COMMIT ASSETS_SHA ghim trong
// js/assets.js — CẢ bản gốc lẫn bản assets_lite/ (tier LITE). Bài học 2026-09-05: assets_lite/ chưa bao giờ
// được đẩy lên nhánh assets-storage → mọi máy LITE 404 rồi tải lại bản gốc 238MB; ASSETS_SHA cũ 2 commit.
//   node tools/check_assets.mjs        (cần đã fetch origin/assets-storage)
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const root = new URL('..', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const sha = (read('js/assets.js').match(/ASSETS_SHA = '([0-9a-f]+)'/) || [])[1];
if (!sha) { console.error('Không tìm thấy ASSETS_SHA trong js/assets.js'); process.exit(1); }
const urls = new Set();
for (const f of ['js/world.js', 'js/vehicles.js', 'js/assets.js']) {
  for (const m of read(f).matchAll(/['"`](assets\/[A-Za-z0-9_\-.]+\.glb)['"`]/g)) urls.add(m[1]);
  for (const m of read(f).matchAll(/HERO_FILES\s*=\s*\[([^\]]+)\]/g)) for (const x of m[1].matchAll(/['"]([^'"]+\.glb)['"]/g)) urls.add('assets/' + x[1]);
  for (const m of read(f).matchAll(/HERO_BED_FILE\s*=\s*['"]([^'"]+\.glb)['"]/g)) urls.add('assets/' + m[1]);
}
let tree;
try { tree = execSync(`git ls-tree -r --name-only ${sha}`, { cwd: root, encoding: 'utf8' }).split('\n'); }
catch (e) { console.error('git ls-tree thất bại — SHA', sha, 'không có ở local? Chạy: git fetch origin assets-storage'); process.exit(1); }
const have = new Set(tree);
let bad = 0;
for (const u of [...urls].sort()) {
  const lite = u.replace(/^assets\//, 'assets_lite/');
  const ok = have.has(u), okL = have.has(lite);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${u.padEnd(34)} ${okL ? 'lite OK' : 'lite MISS'}`);
  if (!ok || !okL) bad++;
}
const head = execSync('git rev-parse --short origin/assets-storage', { cwd: root, encoding: 'utf8' }).trim();
console.log(`\nASSETS_SHA ${sha} | origin/assets-storage ${head} ${head.startsWith(sha) || sha.startsWith(head) ? '(khớp)' : '(KHÁC — cập nhật ASSETS_SHA?)'}`);
console.log(bad ? `==> THIẾU ${bad} file` : '==> ĐỦ');
process.exit(bad ? 1 : 0);
