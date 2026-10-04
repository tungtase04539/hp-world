// tools/qa/gpulock.mjs — KHOÁ GPU TOÀN MÁY cho Chrome headless chạy WebGL trên GPU thật.
// BÀI HỌC 2026-10-04: 8 agent song song cùng mở Chrome headless (ANGLE d3d11) dựng cảnh 5-10 M tam giác trên
// Radeon 890M → máy BSOD 0x133 DPC_WATCHDOG_VIOLATION 3 lần (driver đồ hoạ treo). Quy tắc:
//   - Chụp ảnh kiểm tra (nhìn) → SwiftShader (CPU, không đụng driver GPU): mặc định của tools/qa/shoot.mjs.
//   - Đo perf trên GPU thật → PHẢI giữ khoá này (1 tiến trình GPU tại một thời điểm, cả máy).
// Dùng làm module: const rel = await acquireGpu('wp2 perf'); try { ... } finally { rel(); }
// Dùng CLI:        node tools/qa/gpulock.mjs run -- node my_probe.mjs --gpu ...
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const LOCK = path.join(os.tmpdir(), 'hpworld_gpu.lock');
const STALE_MS = 20 * 60 * 1000;     // khoá bỏ quên (tiến trình chết) quá 20 phút thì cướp

const pidOf = (dir) => { try { return +((fs.readFileSync(path.join(dir, 'owner.txt'), 'utf8').match(/pid=(\d+)/) || [])[1] || 0); } catch { return 0; } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

// Lấy khoá thư mục `dir` (mkdir nguyên tử trên NTFS). Chủ khoá đã chết → cướp ngay; khoá cũ quá 20 phút → cướp.
async function acquireDir(dir, who, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'owner.txt'), `${who} pid=${process.pid} at=${new Date().toISOString()}`);
      let released = false;
      const release = () => { if (released) return; released = true; try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
      process.on('exit', release);
      for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { release(); process.exit(130); });
      return release;
    } catch (e) {
      if (e.code === 'ENOENT' && dir !== LOCK) return acquireDir(LOCK, who, timeoutMs);   // khoá cha vừa nhả → xin khoá thường
      if (e.code !== 'EEXIST') throw e;
      // chủ khoá đã chết (bị kill cứng / harness hết giờ) → cướp NGAY, không đợi 20 phút
      const pid = pidOf(dir);
      if (pid && !alive(pid)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} continue; }
      try { const st = fs.statSync(dir); if (Date.now() - st.mtimeMs > STALE_MS) { fs.rmSync(dir, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() - t0 > timeoutMs) throw new Error('gpulock: hết thời gian chờ khoá GPU');
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }
}

export async function acquireGpu(who = 'unknown', timeoutMs = 60 * 60 * 1000) {
  // TÁI NHẬP CÓ KIỂM: `gpulock.mjs run -- …` đặt HPWORLD_GPU_LOCK=<pid chủ khoá> cho tiến trình con (xin lại khoá
  // thường sẽ chờ chính tiến trình cha). Chỉ tái nhập khi owner.txt đúng pid đó VÀ còn sống — env cũ/sai thì xin khoá
  // thường. Tái nhập vẫn phải lấy KHOÁ CON `<LOCK>/child`: 2 hậu duệ chạy SONG SONG (`run -- bash -c "a & b"`) không
  // được mở 2 Chrome GPU cùng lúc; nối tiếp (`a; b`) thì lần lượt vào. Cha nhả khoá → khoá con mất theo.
  const env = +(process.env.HPWORLD_GPU_LOCK || 0);
  if (env && pidOf(LOCK) === env && alive(env)) return acquireDir(path.join(LOCK, 'child'), who, timeoutMs);
  return acquireDir(LOCK, who, timeoutMs);
}

// CLI: node tools/qa/gpulock.mjs run -- <cmd> [args...]
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const i = process.argv.indexOf('--');
  if (process.argv[2] !== 'run' || i < 0) { console.error('usage: node tools/qa/gpulock.mjs run -- <cmd> [args]'); process.exit(2); }
  const [cmd, ...args] = process.argv.slice(i + 1);
  const rel = await acquireGpu(`cli ${cmd} ${args.join(' ').slice(0, 80)}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HPWORLD_GPU_LOCK: String(process.pid) } });
  rel();
  process.exit(r.status ?? 1);
}
