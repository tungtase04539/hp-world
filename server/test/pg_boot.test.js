// Full server boot on real Postgres (only under `npm run test:pg`, which sets TEST_DB_URL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootTestServer, openWs, pingRtts, getJson } from './helpers/client.mjs';

const url = process.env.TEST_DB_URL;

test('[pg] boot with DB_URL: migrations, /healthz, PING/PONG', { skip: !url && 'TEST_DB_URL not set (run npm run test:pg)' }, async () => {
  const s = await bootTestServer({ DB_URL: url, DB_DRIVER: 'pg' });
  try {
    assert.equal(s.app.db.driver, 'pg');
    const h = await getJson(s.game + '/healthz');
    assert.equal(h.status, 200); assert.equal(h.body.db, 'ok');
    const v = await s.app.db.one('SELECT max(version) AS v FROM schema_migrations');
    assert.ok(v.v >= 1);
    const ver = await s.app.db.one('SHOW server_version');
    assert.match(ver.server_version, /^17\./);
    const ws = await openWs(s.ws + '/play');
    const r = await pingRtts(ws, 10);
    assert.equal(r.length, 10);
    ws.close();
  } finally { await s.app.stop(); }
});
