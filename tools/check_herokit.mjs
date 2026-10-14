// tools/check_herokit.mjs — KHOÁ CHỐNG DỮ LIỆU HERO CŨ (Đợt 3 W5-A, phản biện): js/herokit_data.js khoá theo TÂM footprint của
// js/buildings_real.js. Ai sinh lại buildings_real.js (process_buildings / W5-D) mà quên `node tools/gen_herokit.mjs <fp_json>
// <fp_plan.json>` thì nhà đổi hình MẤT chương trình (hoặc khớp nhầm nhà khác) mà runtime không báo gì → kiểm ở đây:
//   1. HERO_META.rb == số nhà RB, HERO_META.rbHash == FNV-1a(RB_B64)  (dữ liệu sinh trên ĐÚNG bản buildings_real này)
//   2. mọi HERO[i] khớp đúng 1 nhà (heroOfPoly, ≤ 0,6 m)
// usage: node tools/check_herokit.mjs   (thoát 1 nếu lệch) — tools/diag.mjs gọi checkHerokit() trước khi mở trình duyệt.
import { pathToFileURL } from 'url';

export function rbHash(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }

export async function checkHerokit() {
  const { RB_B64 } = await import('../js/buildings_real.js');
  const { decodeRB } = await import('../js/buildings_data.js');
  const { HERO, HERO_META } = await import('../js/herokit_data.js');
  const { heroOfPoly } = await import('../js/herokit.js');
  const D = decodeRB(RB_B64), out = [];
  const fix = ' → chạy lại: node tools/gen_herokit.mjs <keep/fp_json> <keep/fp_plan.json>';
  if (HERO_META.rb !== D.nB) out.push(`herokit: HERO_META.rb ${HERO_META.rb} ≠ buildings_real ${D.nB} nhà${fix}`);
  const h = rbHash(RB_B64);
  if (HERO_META.rbHash !== h) out.push(`herokit: băm buildings_real ${h} ≠ HERO_META.rbHash ${HERO_META.rbHash}${fix}`);
  const hit = new Map();
  for (let b = 0; b < D.nB; b++) { const r = heroOfPoly(D, b); if (r.hi >= 0) hit.set(r.hi, (hit.get(r.hi) || 0) + 1); }
  const miss = HERO.length - hit.size, dup = [...hit.values()].filter((v) => v > 1).length;
  if (miss) out.push(`herokit: ${miss}/${HERO.length} nhà hero không khớp footprint nào${fix}`);
  if (dup) out.push(`herokit: ${dup} nhà hero khớp > 1 footprint${fix}`);
  return { problems: out, n: HERO.length, matched: hit.size, hash: h };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await checkHerokit();
  console.log(r.problems.length ? 'VẤN ĐỀ:\n' + r.problems.join('\n') : `herokit OK — ${r.matched}/${r.n} khớp, băm ${r.hash}`);
  process.exit(r.problems.length ? 1 : 0);
}
