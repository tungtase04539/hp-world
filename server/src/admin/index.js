// admin/index.js — OWNER: S3. Localhost-only admin HTTP (port 9101) + static Vietnamese page server/admin/ (SPEC §3.3):
// live CCU / tick / bandwidth / degrade, live 2D map, chat feed, report queue + one-click sanctions, player search,
// invite batches, broadcast, filter reload, admin_audit, netprobe results by carrier.
// Every /admin/api/* route uses { auth: 'admin' } (Authorization: Bearer <ADMIN_TOKEN from server/.env>).
//
// FOUNDATION STUB (working): GET /admin → placeholder page; GET /admin/api/status → live numbers (token required).
import { publicConfig } from '../config.js';

const PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Quản trị máy chủ</title><style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem;background:#f6f6f4;color:#222}
code{background:#e8e8e4;padding:0 .3em;border-radius:4px}</style></head><body>
<h1>Trang quản trị máy chủ Hải Phòng 3D</h1>
<p>Trang này đang được xây dựng. Số liệu trực tiếp: <code>GET /admin/api/status</code> (cần mã quản trị trong <code>server/.env</code>).</p>
<p>Chỉ mở được trên chính máy chủ (localhost).</p></body></html>`;

export function register(app) {
  app.admin.get('/admin', (req, res) => res.text(PAGE, 200, 'text/html; charset=utf-8', { 'cache-control': 'no-store' }));
  app.admin.get('/admin/api/status', async () => ({
    health: await app.health(),
    sim: app.has('sim') ? app.get('sim').stats() : null,
    metrics: app.metrics.snapshot(),
    config: publicConfig(app.config),
    services: app.services(),
  }), { auth: 'admin' });
}
