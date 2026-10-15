// admin/netprobe.js — netprobe results by carrier for the admin page. The table belongs to S5 (migrations 030–039,
// POST /v1/netprobe). Documented query contract (SERVER.md §3): a table whose name starts with "netprobe" with
//   carrier text, net (or net_type / network) text, median_ms (or median / rtt_median_ms / p50_ms) real,
//   p95_ms (or p95) real, jitter_ms (or jitter) real, loss_pct (or loss) real, created_at (or at) timestamptz.
// Missing table / columns → { available: false } (the page shows "chưa có dữ liệu"). Identifiers come from
// information_schema and are validated before being quoted into the SQL.
const PICK = {
  carrier: ['carrier', 'isp', 'operator'],
  net: ['net', 'net_type', 'network', 'nettype', 'conn_type'],
  median: ['median_ms', 'median', 'rtt_median_ms', 'p50_ms', 'rtt_p50_ms', 'rtt_ms'],
  p95: ['p95_ms', 'p95', 'rtt_p95_ms'],
  jitter: ['jitter_ms', 'jitter'],
  loss: ['loss_pct', 'loss', 'loss_percent'],
  at: ['created_at', 'at', 'ts', 'time'],
};
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export async function netprobeSummary(db, { days = 14 } = {}) {
  let table;
  try {
    const t = await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'netprobe%'
      ORDER BY (table_name = 'netprobe_results') DESC, (table_name = 'netprobe') DESC, table_name LIMIT 1`);
    table = t.rows[0]?.table_name;
  } catch { return { available: false, reason: 'query_failed' }; }
  if (!table || !IDENT.test(table)) return { available: false, reason: 'no_table' };
  const cols = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows.map((r) => r.column_name));
  const col = {};
  for (const [k, names] of Object.entries(PICK)) col[k] = names.find((n) => cols.has(n) && IDENT.test(n)) || null;
  if (!col.carrier || !col.median) return { available: false, reason: 'columns', table, columns: [...cols] };
  const q = (c) => `"${c}"`;
  const sel = [
    `coalesce(${q(col.carrier)}::text, '?') AS carrier`,
    col.net ? `coalesce(${q(col.net)}::text, '?') AS net` : `'?' AS net`,
    'count(*)::int AS n',
    `percentile_cont(0.5) WITHIN GROUP (ORDER BY ${q(col.median)}) AS median_ms`,
    col.p95 ? `avg(${q(col.p95)}) AS p95_ms` : 'NULL AS p95_ms',
    col.jitter ? `avg(${q(col.jitter)}) AS jitter_ms` : 'NULL AS jitter_ms',
    col.loss ? `avg(${q(col.loss)}) AS loss_pct` : 'NULL AS loss_pct',
    col.at ? `max(${q(col.at)}) AS last_at` : 'NULL AS last_at',
  ];
  const where = col.at ? `WHERE ${q(col.at)} > now() - make_interval(days => $1)` : '';
  try {
    const rows = (await db.query(`SELECT ${sel.join(', ')} FROM ${q(table)} ${where} GROUP BY 1, 2 ORDER BY 1, 2`, col.at ? [days] : [])).rows;
    const r1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
    return { available: true, table, days: col.at ? days : null,
      rows: rows.map((r) => ({ carrier: r.carrier, net: r.net, n: r.n, medianMs: r1(r.median_ms), p95Ms: r1(r.p95_ms), jitterMs: r1(r.jitter_ms), lossPct: r1(r.loss_pct), lastAt: r.last_at })) };
  } catch (e) { return { available: false, reason: 'query_failed', error: e.message }; }
}
