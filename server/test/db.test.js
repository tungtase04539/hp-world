// DB layer + migrations. Runs on PGlite (in-memory) by default; `npm run test:pg` runs this same file against Docker
// Postgres 17 by setting TEST_DB_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb } from '../src/db/db.js';
import { migrate, listMigrations, MIGRATIONS_DIR } from '../src/db/migrate.js';

const url = process.env.TEST_DB_URL || '';
const cfg = url ? { driver: 'pg', url, poolMax: 4 } : { driver: 'pglite', pgliteDir: 'memory' };
const label = url ? 'pg' : 'pglite';

async function fresh() {
  const db = await createDb(cfg);
  if (url) {
    // clean slate on the shared test database
    await db.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  return db;
}

test(`[${label}] migrations: naming, idempotence, schema`, async () => {
  const list = listMigrations();
  assert.ok(list.length >= 1);
  assert.equal(list[0].name, '001_base.sql');
  const db = await fresh();
  try {
    const r1 = await migrate(db);
    assert.deepEqual(r1.applied.slice(0, 1), ['001_base.sql']);
    assert.ok(r1.current >= 1);
    const r2 = await migrate(db);
    assert.deepEqual(r2.applied, []);
    const t = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`);
    const names = t.rows.map((r) => r.table_name);
    for (const n of ['accounts', 'identities', 'refresh_tokens', 'characters', 'invites', 'admin_audit', 'playtime_daily', 'schema_migrations']) {
      assert.ok(names.includes(n), `missing table ${n}`);
    }
  } finally { await db.close(); }
});

test(`[${label}] query / one / tx / types`, async () => {
  const db = await fresh();
  try {
    await migrate(db);
    const inv = await db.one(`INSERT INTO invites (code_hash, uses_left, uses_total, note) VALUES ($1, 3, 3, 'test') RETURNING id, uses_left`, [Buffer.from('abc')]);
    assert.equal(typeof inv.id, 'number');   // bigserial → number on both drivers
    assert.equal(inv.uses_left, 3);
    const acc = await db.one(`INSERT INTO accounts (invite_id) VALUES ($1) RETURNING id, kind, status, created_at, play_seconds`, [inv.id]);
    assert.match(acc.id, /^[0-9a-f-]{36}$/);
    assert.equal(acc.kind, 'guest'); assert.equal(acc.status, 'active');
    assert.ok(acc.created_at instanceof Date);
    assert.equal(acc.play_seconds, 0);
    const ch = await db.one(`INSERT INTO characters (account_id, nickname, discriminator, display_name, appearance) VALUES ($1, 'Tùng', 1234, 'Tùng#1234', $2) RETURNING appearance, version`,
      [acc.id, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])]);
    assert.deepEqual([...ch.appearance], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(ch.version, 0);
    // appearance must be 8 bytes
    await assert.rejects(db.query(`INSERT INTO characters (account_id, nickname, discriminator, display_name, appearance) VALUES ($1, 'x', 1, 'x#0001', $2)`,
      [acc.id, Buffer.from([1])]));
    // name uniqueness is case-insensitive per discriminator
    const acc2 = await db.one(`INSERT INTO accounts DEFAULT VALUES RETURNING id`);
    await assert.rejects(db.query(`INSERT INTO characters (account_id, nickname, discriminator, display_name) VALUES ($1, 'TÙNG', 1234, 'TÙNG#1234')`, [acc2.id]));
    // jsonb round trip
    await db.query(`INSERT INTO admin_audit (action, target, detail) VALUES ('mute', $1, $2)`, [acc.id, { minutes: 10, why: 'spam' }]);
    const a = await db.one(`SELECT detail FROM admin_audit WHERE target = $1`, [acc.id]);
    assert.deepEqual(a.detail, { minutes: 10, why: 'spam' });
    // tx commit / rollback
    await db.tx(async (q) => { await q.query(`UPDATE invites SET uses_left = uses_left - 1 WHERE id = $1`, [inv.id]); });
    assert.equal((await db.one(`SELECT uses_left FROM invites WHERE id = $1`, [inv.id])).uses_left, 2);
    await assert.rejects(db.tx(async (q) => {
      await q.query(`UPDATE invites SET uses_left = 0 WHERE id = $1`, [inv.id]);
      throw new Error('boom');
    }), /boom/);
    assert.equal((await db.one(`SELECT uses_left FROM invites WHERE id = $1`, [inv.id])).uses_left, 2);
    // CHECK uses_left >= 0
    await assert.rejects(db.query(`UPDATE invites SET uses_left = -1 WHERE id = $1`, [inv.id]));
    const r = await db.query(`UPDATE invites SET note = 'x' WHERE id = $1`, [inv.id]);
    assert.equal(r.rowCount, 1);
    assert.equal(await db.one(`SELECT 1 AS x WHERE false`), null);
    assert.ok((await db.ping()) >= 0);
    // playtime upsert pattern
    for (let i = 0; i < 2; i++) {
      await db.query(`INSERT INTO playtime_daily (account_id, day, seconds) VALUES ($1, CURRENT_DATE, 30)
        ON CONFLICT (account_id, day) DO UPDATE SET seconds = playtime_daily.seconds + EXCLUDED.seconds`, [acc.id]);
    }
    assert.equal((await db.one(`SELECT seconds FROM playtime_daily WHERE account_id = $1`, [acc.id])).seconds, 60);
  } finally { await db.close(); }
});

test(`[${label}] a broken migration rolls back and is not recorded`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpmig-'));
  try {
    fs.copyFileSync(path.join(MIGRATIONS_DIR, '001_base.sql'), path.join(dir, '001_base.sql'));
    fs.writeFileSync(path.join(dir, '002_broken.sql'), 'CREATE TABLE t_ok (id int);\nSELECT * FROM does_not_exist;\n');
    const db = await fresh();
    try {
      await assert.rejects(migrate(db, { dir }));
      const v = await db.one('SELECT max(version) AS v FROM schema_migrations');
      assert.equal(v.v, 1);
      const t = await db.one(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 't_ok'`);
      assert.equal(t.n, 0);
    } finally { await db.close(); }
    fs.writeFileSync(path.join(dir, 'bad-name.sql'), '');
    assert.throws(() => listMigrations(dir), /bad migration file name/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
