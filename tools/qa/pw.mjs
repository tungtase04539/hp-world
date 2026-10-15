// pw.mjs — đường dẫn module playwright-core cho mọi công cụ QA (bài học 2026-10-15: bản cài trong thư mục tạm của phiên bị
// xoá → mọi công cụ mặc định hỏng). Thứ tự: PW_PATH (env) → tools/qa/node_modules của checkout/worktree đang chạy →
// tools/qa/node_modules của checkout chính C:/Users/Admin/hp-world (worktree chưa `npm ci` vẫn chạy được).
// Cài: cd tools/qa && npm ci
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
const REL = 'node_modules/playwright-core/index.mjs';
const local = new URL(`./${REL}`, import.meta.url);
const main = pathToFileURL(`C:/Users/Admin/hp-world/tools/qa/${REL}`);
export const PW_URL = process.env.PW_PATH || (fs.existsSync(fileURLToPath(local)) ? local.href : main.href);
