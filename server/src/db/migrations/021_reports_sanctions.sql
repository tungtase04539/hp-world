-- 021_reports_sanctions.sql — S3: player reports / filter flags (owner queue) and sanctions with expiry.
CREATE TABLE reports (
  id             bigserial PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  source         text NOT NULL DEFAULT 'player' CHECK (source IN ('player', 'filter', 'admin')),
  reporter_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,   -- NULL for filter flags
  reporter_name  text,
  target_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_name    text,
  reason         smallint NOT NULL DEFAULT 0,        -- REPORT_REASON (js/shared/protocol.js), 0 = filter flag
  detail         text,                               -- filter reasons, note
  chat_ref       bigint,                             -- the reported line (msgRef), if any
  context        jsonb NOT NULL DEFAULT '[]'::jsonb, -- 20 surrounding chat lines, taken SERVER-side at report time
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_at    timestamptz,
  resolved_by    text,
  resolution     text
);
CREATE INDEX reports_status_idx ON reports (status, at);
CREATE INDEX reports_target_idx ON reports (target_id, at);

-- mute: no chat delivery; shadow: only the sender sees own lines; ban: cannot join; kick / warn: history only.
-- until NULL = permanent (mute / shadow / ban) or instantaneous (kick / warn).
CREATE TABLE sanctions (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('mute', 'shadow', 'ban', 'kick', 'warn')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  until       timestamptz,
  reason      text,
  source      text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'auto_report', 'auto_filter', 'system')),
  report_id   bigint REFERENCES reports(id) ON DELETE SET NULL,
  created_by  text NOT NULL DEFAULT 'system',
  revoked_at  timestamptz,
  revoked_by  text
);
CREATE INDEX sanctions_account_idx ON sanctions (account_id, starts_at);
CREATE INDEX sanctions_live_idx ON sanctions (kind, until) WHERE revoked_at IS NULL;
