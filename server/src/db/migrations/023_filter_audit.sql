-- 023_filter_audit.sql — S3: every load / reload of the chat filter word lists (server/data/filter/*.txt), with the
-- per-file line counts, hashes and the lines added / removed since the previous load.
CREATE TABLE filter_audit (
  id       bigserial PRIMARY KEY,
  at       timestamptz NOT NULL DEFAULT now(),
  actor    text NOT NULL DEFAULT 'system',
  action   text NOT NULL CHECK (action IN ('load', 'reload')),
  version  text,
  files    jsonb,          -- {list: {lines, bytes, sha256}}
  changes  jsonb,          -- {list: {added: [...], removed: [...]}} (≤ 50 lines each)
  ok       boolean NOT NULL DEFAULT true,
  error    text
);
CREATE INDEX filter_audit_at_idx ON filter_audit (at);
