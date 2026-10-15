// db/migrate.js — forward-only SQL migrations from server/src/db/migrations/NNN_name.sql.
// Number ranges (one owner each, so parallel work packages never collide):
//   001–009 foundation · 010–019 S2 (game/auth) · 020–029 S3 (chat/moderation/admin) · 030–039 S5 (ops/netprobe)
// Each file runs in its own transaction under a transaction-level advisory lock (safe with several processes) and is
// recorded in schema_migrations with a sha256 checksum. Editing an applied file only logs a warning: add a new file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const LOCK_KEY = 72_420_001;
const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export function listMigrations(dir = MIGRATIONS_DIR) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const out = [];
  const seen = new Map();
  for (const f of files) {
    const m = FILE_RE.exec(f);
    if (!m) throw new Error(`migrate: bad migration file name ${f} (want NNN_lower_snake.sql)`);
    const version = Number(m[1]);
    if (seen.has(version)) throw new Error(`migrate: duplicate version ${m[1]}: ${seen.get(version)} and ${f}`);
    seen.set(version, f);
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    out.push({ version, name: f, sql, checksum: crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex') });
  }
  return out;
}

export async function migrate(db, { dir = MIGRATIONS_DIR, log } = {}) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    name text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const list = listMigrations(dir);
  const applied = [];
  for (const m of list) {
    const done = await db.tx(async (q) => {
      await q.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const row = await q.one('SELECT checksum FROM schema_migrations WHERE version = $1', [m.version]);
      if (row) {
        if (row.checksum !== m.checksum) log?.warn('migration changed after it was applied (ignored; add a new file instead)', { name: m.name });
        return false;
      }
      await q.exec(m.sql);
      await q.query('INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)', [m.version, m.name, m.checksum]);
      return true;
    });
    if (done) { applied.push(m.name); log?.info('migration applied', { name: m.name }); }
  }
  const cur = await db.one('SELECT max(version) AS v FROM schema_migrations');
  return { applied, current: cur?.v ?? 0 };
}
