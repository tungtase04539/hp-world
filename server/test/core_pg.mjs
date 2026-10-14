// core_pg.mjs — run the S2 core tests (auth / session) against a throw-away Docker Postgres 17, then remove it.
//   node test/core_pg.mjs            env PG_TEST_PORT (default 55433), PG_TEST_PROJECT (default hpmp-core)
// Uses the same compose file as npm run test:pg (test/pg-compose.yml). Windows-safe (no shell features).
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.PG_TEST_PORT || '55433';
const project = process.env.PG_TEST_PROJECT || 'hpmp-core';
const password = crypto.randomBytes(18).toString('base64url');
const env = { ...process.env, PG_TEST_PORT: port, PG_TEST_PASSWORD: password };
const compose = ['compose', '-p', project, '-f', path.join(here, 'pg-compose.yml')];
const docker = (args) => {
  const r = spawnSync('docker', [...compose, ...args], { env, stdio: 'inherit' });
  if (r.error) throw r.error;
  return r.status;
};

let code = 1;
try {
  console.log(`[core:pg] postgres:17 on 127.0.0.1:${port} (compose project ${project})`);
  if (docker(['up', '-d', '--wait']) !== 0) throw new Error('docker compose up failed');
  const url = `postgres://hp:${password}@127.0.0.1:${port}/hp_test`;
  const files = ['core_auth.test.js', 'core_session.test.js'].map((f) => path.join(here, f));
  code = await new Promise((resolve) => {
    const p = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { env: { ...process.env, TEST_DB_URL: url }, stdio: 'inherit' });
    p.on('exit', (c) => resolve(c ?? 1));
  });
} catch (e) {
  console.error('[core:pg]', e.message);
} finally {
  docker(['down', '-v']);
}
process.exit(code);
