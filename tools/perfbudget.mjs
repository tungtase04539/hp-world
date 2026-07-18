// CỔNG NGÂN SÁCH HIỆU NĂNG (perf budget gate) — chạy lại được, dùng trước mỗi lần push nặng.
// Ý tưởng lấy từ repo Claude-Code-Game-Studios (skill perf-profile): ngân sách RÕ RÀNG + đo + PASS/OVER,
// thay vì script đo rời mỗi lần. Ở đây đo bằng số THẬT của three.js, không ước lượng.
//
//   node tools/perfbudget.mjs [port] [full|lite]
//
// Ngân sách theo playbook mobile của cộng đồng Three.js (mobile chết vì draw call/object/texture RAM,
// không phải triangle). LITE là cấu hình máy yếu — ngân sách chặt hơn.
// playwright-core KHÔNG cài trong repo (dự án không có build step / node_modules) — nạp từ nơi đã cài:
// đặt PW_PATH=<đường dẫn tới playwright-core> hoặc để mặc định thư mục scratchpad phiên làm việc.
const PW = process.env.PW_PATH || 'playwright-core';
const { chromium } = await import(PW);

const PORT = process.argv[2] || '8179';
const MODE = process.argv[3] || 'lite';

const BUDGET = {
  lite: { calls: 260, meshes: 3000, tris: 900_000, texMB: 90, programs: 90, transparent: 300 },
  full: { calls: 900, meshes: 6000, tris: 3_200_000, texMB: 320, programs: 150, transparent: 900 },
}[MODE];

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const br = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const pg = await br.newPage({ viewport: { width: 800, height: 520 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));

await pg.goto(`http://127.0.0.1:${PORT}/?quality=${MODE}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
// BẪY (KNOWLEDGE da): click startBtn trước khi listener gắn → started=false → mọi update-loop ngủ.
// Phải click tới khi titleScreen thật sự ẩn.
for (let i = 0; i < 200; i++) {
  const done = await pg.evaluate(() => {
    const b = document.getElementById('startBtn'), t = document.getElementById('titleScreen');
    if (b && t && !t.classList.contains('hidden')) b.click();
    return t && t.classList.contains('hidden');
  }).catch(() => false);
  if (done) break;
  await pg.waitForTimeout(1000);
}
for (let i = 0; i < 200; i++) {
  if (await pg.evaluate(() => !!(window.__hp && window.__hp.renderer)).catch(() => false)) break;
  await pg.waitForTimeout(1000);
}
await pg.waitForTimeout(6000);

// TÁCH METRIC (GPT khuyến nghị #1): renderer.info.render.triangles CỘNG CẢ shadow pass →
// số liệu "tự mâu thuẫn" với phân rã theo mesh. Đo main-only bằng cách tắt bóng rồi render 1 khung.
const split = await pg.evaluate(async () => {
  const R = window.__hp.renderer, S = window.__hp.scene, C = window.__hp.camera;
  const dn = R.shadowMap.enabled;
  R.render(S, C);
  const both = R.info.render.triangles, bothCalls = R.info.render.calls;
  R.shadowMap.enabled = false;
  R.render(S, C);
  const main = R.info.render.triangles, mainCalls = R.info.render.calls;
  R.shadowMap.enabled = dn;
  return { both, main, shadow: Math.max(0, both - main), bothCalls, mainCalls, shadowCalls: Math.max(0, bothCalls - mainCalls) };
});

const m = await pg.evaluate(() => {
  const R = window.__hp.renderer, info = R.info;
  // BỘ NHỚ TEXTURE THẬT: duyệt mọi map của mọi material, cộng w*h*4 (RGBA8) *1.33 nếu có mipmap.
  const seen = new Set();
  let texBytes = 0, texCount = 0, transparent = 0, meshes = 0, maxTex = 0;
  const SLOTS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'alphaMap', 'aoMap', 'bumpMap'];
  window.__hp.scene.traverse((o) => {
    if (!o.isMesh && !o.isSprite) return;
    if (o.isMesh) meshes++;
    for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!mat) continue;
      if (mat.transparent) transparent++;
      for (const s of SLOTS) {
        const t = mat[s];
        if (!t || !t.image || seen.has(t.uuid)) continue;
        seen.add(t.uuid);
        const w = t.image.width || 0, h = t.image.height || 0;
        const b = w * h * 4 * (t.generateMipmaps === false ? 1 : 1.33);
        texBytes += b; texCount++;
        if (b > maxTex) maxTex = b;
      }
    }
  });
  return {
    calls: info.render.calls,
    tris: info.render.triangles,
    meshes,
    texMB: +(texBytes / 1048576).toFixed(1),
    texCount,
    maxTexMB: +(maxTex / 1048576).toFixed(2),
    programs: (info.programs || []).length,
    transparent,
    geoMem: info.memory.geometries,
    texMem: info.memory.textures,
  };
});

const rows = [
  ['draw calls (main)', split.mainCalls, BUDGET.calls],
  ['mesh trong scene', m.meshes, BUDGET.meshes],
  ['triangles (main)', split.main, BUDGET.tris],
  ['RAM texture (MB)', m.texMB, BUDGET.texMB],
  ['shader programs', m.programs, BUDGET.programs],
  ['mesh transparent', m.transparent, BUDGET.transparent],
];
let over = 0;
console.log(`\n=== NGÂN SÁCH HIỆU NĂNG — chế độ ${MODE.toUpperCase()} ===`);
for (const [name, val, bud] of rows) {
  const ok = val <= bud;
  if (!ok) over++;
  console.log(`${ok ? 'OK   ' : 'OVER '} ${name.padEnd(20)} ${String(val).padStart(9)} / ${bud}`);
}
console.log(`  (texture riêng: ${m.texCount}, lớn nhất ${m.maxTexMB} MB | geometry đang giữ: ${m.geoMem})`);
console.log(`  TÁCH: main ${(split.main/1e6).toFixed(2)}M tri / ${split.mainCalls} calls  |  shadow ${(split.shadow/1e6).toFixed(2)}M tri / ${split.shadowCalls} calls`);
console.log(`  JS error: ${errs.length ? errs.slice(0, 2).join(' ; ') : 'KHÔNG'}`);
console.log(over ? `\n==> VƯỢT ${over} hạng mục\n` : '\n==> ĐẠT TOÀN BỘ\n');

await br.close();
process.exit(over || errs.length ? 1 : 0);
