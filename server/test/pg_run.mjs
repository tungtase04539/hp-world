// npm run test:pg — run the DB tests (and a full boot) against a throw-away Docker Postgres 17, then remove it.
// Env: PG_TEST_PORT (default 55432), PG_TEST_PROJECT (compose project, default hpmp-pgtest), PG_TEST_KEEP=1 keeps it.
// Needs Docker. Windows-safe (no shell features).
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PG_TEST_PORT || '55432';
const project = process.env.PG_TEST_PROJECT || 'hpmp-pgtest';
const password = crypto.randomBytes(18).toString('base64url');
const env = { ...process.env, PG_TEST_PORT: port, PG_TEST_PASSWORD: password };
const compose = ['compose', '-p', project, '-f', path.join(here, 'pg-compose.yml')];

function docker(args, opts = {}) {
  const r = spawnSync('docker', [...compose, ...args], { env, stdio: 'inherit', ...opts });
  if (r.error) throw r.error;
  return r.status;
}

let code = 1;
try {
  console.log(`[test:pg] starting postgres:17 on 127.0.0.1:${port} (compose project ${project})`);
  if (docker(['up', '-d', '--wait']) !== 0) throw new Error('docker compose up failed');
  const url = `postgres://hp:${password}@127.0.0.1:${port}/hp_test`;
  code = await new Promise((resolve) => {
    // every suite that honours TEST_DB_URL (integration 15/10/2026: + S2 core, S3 safety, cross-module integ)
    const suites = ['db.test.js', 'pg_boot.test.js', 'core_auth.test.js', 'core_session.test.js', 'integ.test.js', 'safety_chat.test.js', 'safety_admin.test.js'];
    const p = spawn(process.execPath, ['--test', '--test-concurrency=1', ...suites.map((f) => path.join(here, f))],
      { env: { ...process.env, TEST_DB_URL: url }, stdio: 'inherit' });
    p.on('exit', (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error('[test:pg]', e.message);
  code = 1;
} finally {
  if (process.env.PG_TEST_KEEP === '1') console.log('[test:pg] PG_TEST_KEEP=1: leaving the container running');
  else docker(['down', '-v']);
}
process.exit(code);
