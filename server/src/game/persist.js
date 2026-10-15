// game/persist.js — OWNER: S2. Character persistence (pos, appearance 8 B, display name) and playtime_daily.
// Dirty characters are flushed every 30 s in ONE statement (jsonb_to_recordset), on disconnect and on shutdown.
// Play time: seconds accumulate per session while it is active; each flush adds them to accounts.play_seconds and
// playtime_daily (day = Vietnam local date, UTC+7).

export const VN_OFFSET_MS = 7 * 3600 * 1000;
export const vnDay = (t = Date.now()) => new Date(t + VN_OFFSET_MS).toISOString().slice(0, 10);

// → {account: {id, kind, status, play_seconds}, character: {...} | null} | null
export async function loadPlayer(db, accountId) {
  const r = await db.one(
    `SELECT a.id, a.kind, a.status, a.play_seconds, c.id AS char_id, c.nickname, c.discriminator, c.display_name,
            c.appearance, c.pos_x, c.pos_z, c.pos_y, c.yaw
       FROM accounts a LEFT JOIN characters c ON c.account_id = a.id WHERE a.id = $1`, [accountId]);
  if (!r) return null;
  return {
    account: { id: r.id, kind: r.kind, status: r.status, play_seconds: Number(r.play_seconds) || 0 },
    character: r.char_id ? {
      id: r.char_id, nickname: r.nickname, discriminator: r.discriminator, displayName: r.display_name,
      appearance: r.appearance ? new Uint8Array(r.appearance) : null,
      x: r.pos_x, z: r.pos_z, y: r.pos_y, yaw: r.yaw,
    } : null,
  };
}

// rows: [{accountId, x?, z?, y?, yaw?, cell?, play}]  (rows without x only add play time)
export async function flushRows(db, rows, now = Date.now()) {
  if (!rows.length) return 0;
  const pos = rows.filter((r) => r.x !== undefined);
  const play = rows.filter((r) => r.play >= 1);
  await db.tx(async (q) => {
    if (pos.length) {
      await q.query(
        `UPDATE characters c SET pos_x = v.x, pos_z = v.z, pos_y = v.y, yaw = v.yaw, cell = v.cell,
                version = c.version + 1, updated_at = now()
           FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, x real, z real, y real, yaw real, cell smallint)
          WHERE c.account_id = v.id`,
        [JSON.stringify(pos.map((r) => ({ id: r.accountId, x: r.x, z: r.z, y: r.y, yaw: r.yaw, cell: r.cell })))]);
    }
    if (play.length) {
      const js = JSON.stringify(play.map((r) => ({ id: r.accountId, s: Math.floor(r.play) })));
      await q.query(
        `INSERT INTO playtime_daily (account_id, day, seconds)
           SELECT v.id, $2::date, v.s FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, s integer) WHERE v.s > 0
         ON CONFLICT (account_id, day) DO UPDATE SET seconds = playtime_daily.seconds + EXCLUDED.seconds`, [js, vnDay(now)]);
      await q.query(
        `UPDATE accounts a SET play_seconds = a.play_seconds + v.s, last_seen = now()
           FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, s integer) WHERE a.id = v.id`, [js]);
    }
  });
  return rows.length;
}
