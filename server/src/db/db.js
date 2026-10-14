// db/db.js — Postgres behind one small interface: `pg` Pool (Docker / VPS) or PGlite (in-process Postgres 17 for tests
// and for running without Docker). Hand-written SQL only, always parameterised ($1, $2 …).
//
//   const db = await createDb(config.db, { log, metrics })
//   db.driver                      'pg' | 'pglite'
//   await db.query(sql, params)    → { rows, rowCount }
//   await db.one(sql, params)      → first row | null
//   await db.exec(sql)             multi-statement SQL, no params (migrations)
//   await db.tx(async (q) => …)    transaction; q has query/one/exec; throws → ROLLBACK
//   await db.ping()                → round-trip ms
//   await db.close()
// Type normalisation (both drivers): int8/bigserial → JS number (ids/counters/money stay < 2^53), bytea → Uint8Array
// (Buffer under pg), timestamptz → Date, json/jsonb → parsed value.
import fs from 'node:fs';

const INT8_OID = 20;
const toNum = (v) => (v === null ? null : Number(v));

export async function createDb(dbCfg, { log, metrics } = {}) {
  const qLat = metrics?.histogram('db_query_ms', 'database query latency (ms)');
  const qErr = metrics?.counter('db_errors_total', 'database query errors');
  const timed = async (fn) => {
    const t0 = performance.now();
    try { return await fn(); } catch (e) { qErr?.inc(); throw e; } finally { qLat?.observe(performance.now() - t0); }
  };

  if (dbCfg.driver === 'pg') {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(INT8_OID, toNum);
    const pool = new pg.Pool({ connectionString: dbCfg.url, max: dbCfg.poolMax || 10, idleTimeoutMillis: 30000 });
    pool.on('error', (e) => log?.error('pg pool error', { err: e }));
    const wrap = (client) => ({
      query: (sql, params) => timed(async () => { const r = await client.query(sql, params); return { rows: r.rows, rowCount: r.rowCount ?? 0 }; }),
      one: async (sql, params) => (await client.query(sql, params)).rows[0] ?? null,
      exec: (sql) => timed(() => client.query(sql)),
    });
    const db = {
      driver: 'pg',
      ...wrap(pool),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await fn(wrap(client));
          await client.query('COMMIT');
          return out;
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch { /* connection broken */ }
          throw e;
        } finally { client.release(); }
      },
      async ping() { const t0 = performance.now(); await pool.query('SELECT 1'); return performance.now() - t0; },
      async close() { await pool.end(); },
    };
    return db;
  }

  // ---- PGlite ----
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = dbCfg.pgliteDir;
  const memory = !dir || dir === 'memory' || dir === ':memory:';
  if (!memory) fs.mkdirSync(dir, { recursive: true });
  const pgl = memory
    ? new PGlite({ parsers: { [INT8_OID]: toNum } })
    : new PGlite(dir, { parsers: { [INT8_OID]: toNum } });
  await pgl.waitReady;
  const wrapL = (h) => ({
    query: (sql, params) => timed(async () => { const r = await h.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; }),
    one: async (sql, params) => (await h.query(sql, params)).rows[0] ?? null,
    exec: (sql) => timed(() => h.exec(sql)),
  });
  return {
    driver: 'pglite',
    ...wrapL(pgl),
    tx: (fn) => pgl.transaction((tx) => fn(wrapL(tx))),
    async ping() { const t0 = performance.now(); await pgl.query('SELECT 1'); return performance.now() - t0; },
    async close() { if (!pgl.closed) await pgl.close(); },
  };
}
