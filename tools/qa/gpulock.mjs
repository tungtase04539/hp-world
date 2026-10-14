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
import { spawn } from 'child_process';

const LOCK = path.join(os.tmpdir(), 'hpworld_gpu.lock');
const STALE_MS = 20 * 60 * 1000;     // khoá không có nhịp tim quá 20 phút (chủ treo/chết) thì cướp
const BEAT_MS = 60 * 1000;           // chủ khoá chạm mtime thư mục khoá mỗi phút (nhịp tim)
// BÀI HỌC 2026-10-14: bản cũ cướp theo TUỔI khoá (> 20 phút) kể cả khi chủ còn sống → lượt chụp 480 ảnh (~60 phút) bị
// cướp giữa chừng → 2 Chrome GPU song song (đúng kịch bản BSOD). Nay: chủ còn sống + còn nhịp tim thì KHÔNG bao giờ cướp.

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
      const beat = setInterval(() => { try { const t = new Date(); fs.utimesSync(dir, t, t); } catch {} }, BEAT_MS);
      beat.unref();
      const release = () => { if (released) return; released = true; clearInterval(beat); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
      process.on('exit', release);
      for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { release(); process.exit(130); });
      return release;
    } catch (e) {
      if (e.code === 'ENOENT' && dir !== LOCK) return acquireDir(LOCK, who, timeoutMs);   // khoá cha vừa nhả → xin khoá thường
      if (e.code !== 'EEXIST') throw e;
      // chủ khoá đã chết (bị kill cứng / harness hết giờ) → cướp NGAY, không đợi 20 phút
      const pid = pidOf(dir);
      if (pid && !alive(pid)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} continue; }
      // chủ CÒN SỐNG: chỉ cướp khi mất nhịp tim quá 3 giờ (treo thật); bản cũ không có nhịp tim vẫn được giữ trọn lượt chụp dài.
      // Không đọc được pid (owner.txt hỏng) → cướp sau 20 phút như cũ.
      try { const st = fs.statSync(dir); const lim = pid && alive(pid) ? 3 * 60 * 60 * 1000 : STALE_MS; if (Date.now() - st.mtimeMs > lim) { fs.rmSync(dir, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() - t0 > timeoutMs) throw new Error('gpulock: hết thời gian chờ khoá GPU');
      await new Promise((r) => setTimeout(r, 3000 + Math.random() * 2000));
    }
  }
}

// MÁY CHỦ GAME ĐANG PHỤC VỤ NGƯỜI CHƠI (chủ dự án 14/10/2026: "đảm bảo an toàn 100% cho máy tôi"): script
// server/ops/mo-may-chu.ps1 ghi tệp đánh dấu này và chạm mtime mỗi phút; khi nó còn tươi (< 10 phút) MỌI việc GPU (chụp,
// đo perf, Chrome 3D) phải CHỜ — màn xanh giữa buổi chơi thử = sập máy chủ. tat-may-chu.ps1 xoá tệp. Bỏ qua (chỉ khi chủ
// dự án đồng ý): HPWORLD_ALLOW_GPU_WHILE_LIVE=1. Chạy thử server trong lúc phát triển KHÔNG ghi tệp này (chế độ test).
export const SERVER_LIVE = path.join(os.tmpdir(), 'hpworld_server_live.txt');
const LIVE_FRESH_MS = 10 * 60 * 1000;
const serverLive = () => { try { return Date.now() - fs.statSync(SERVER_LIVE).mtimeMs < LIVE_FRESH_MS; } catch { return false; } };
async function waitServerIdle(who, timeoutMs) {
  if (process.env.HPWORLD_ALLOW_GPU_WHILE_LIVE === '1' || !serverLive()) return;
  console.error(`gpulock: máy chủ game đang chạy (${SERVER_LIVE}) — ${who} chờ tới khi tắt máy chủ`);
  const t0 = Date.now();
  while (serverLive()) {
    if (Date.now() - t0 > timeoutMs) throw new Error('gpulock: máy chủ game vẫn chạy — không mở GPU');
    await new Promise((r) => setTimeout(r, 15000));
  }
}

export async function acquireGpu(who = 'unknown', timeoutMs = 3 * 60 * 60 * 1000) {
  await waitServerIdle(who, timeoutMs);
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
  // spawn BẤT ĐỒNG BỘ (không spawnSync): vòng sự kiện phải chạy để nhịp tim giữ khoá trong lúc lệnh con chạy lâu
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, HPWORLD_GPU_LOCK: String(process.pid) } });
  const code = await new Promise((res) => { child.on('exit', (c) => res(c ?? 1)); child.on('error', () => res(1)); });
  rel();
  process.exit(code);
}
