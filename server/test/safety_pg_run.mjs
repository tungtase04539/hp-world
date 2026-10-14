// node test/safety_pg_run.mjs — run the S3 safety DB tests (chat service + admin API) against a throw-away Docker
// Postgres 17 (same compose file as `npm run test:pg`), then remove it.
// Env: PG_TEST_PORT (default 55434), PG_TEST_PROJECT (default hpmp-safety), PG_TEST_KEEP=1 keeps the container.
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PG_TEST_PORT || '55434';
const project = process.env.PG_TEST_PROJECT || 'hpmp-safety';
const password = crypto.randomBytes(18).toString('base64url');
const env = { ...process.env, PG_TEST_PORT: port, PG_TEST_PASSWORD: password };
const compose = ['compose', '-p', project, '-f', path.join(here, 'pg-compose.yml')];
const docker = (args) => { const r = spawnSync('docker', [...compose, ...args], { env, stdio: 'inherit' }); if (r.error) throw r.error; return r.status; };

let code = 1;
try {
  console.log(`[safety:pg] postgres:17 on 127.0.0.1:${port} (compose project ${project})`);
  if (docker(['up', '-d', '--wait']) !== 0) throw new Error('docker compose up failed');
  const url = `postgres://hp:${password}@127.0.0.1:${port}/hp_test`;
  code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['--test', '--test-concurrency=1', path.join(here, 'safety_chat.test.js'), path.join(here, 'safety_admin.test.js')],
      { env: { ...process.env, TEST_DB_URL: url }, stdio: 'inherit' });
    p.on('exit', (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error('[safety:pg]', e.message);
  code = 1;
} finally {
  if (process.env.PG_TEST_KEEP === '1') console.log('[safety:pg] PG_TEST_KEEP=1: leaving the container running');
  else docker(['down', '-v']);
}
process.exit(code);
