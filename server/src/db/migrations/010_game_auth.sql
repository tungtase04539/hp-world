-- 010_game_auth.sql — S2 (game / auth). Indexes for the auth housekeeping and the admin player views.
-- Expired refresh tokens are purged hourly (api/auth.js); the purge and the per-account revocation scan these.
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);
-- Invite batches are listed by the admin page (S3) per batch label.
CREATE INDEX invites_batch_idx ON invites (batch);
-- Play time per day (legal hook) is read per day for reports.
CREATE INDEX playtime_daily_day_idx ON playtime_daily (day);
