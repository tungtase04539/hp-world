-- 020_chat_log.sql — S3: every chat line the server handled (delivered, masked, flagged, blocked, shadow, system).
-- Retention 30 days (CHAT_LOG_DAYS): server/src/chat/index.js deletes older rows every 6 hours. Reports keep their own
-- copy of the 20 context lines, so the purge never empties the owner's queue.
CREATE TABLE chat_log (
  id          bigserial PRIMARY KEY,
  ref         bigint NOT NULL,                       -- msgRef (u32 on the wire, S2C CHAT / C2S REPORT.chatRef)
  at          timestamptz NOT NULL DEFAULT now(),
  account_id  uuid REFERENCES accounts(id) ON DELETE CASCADE,   -- NULL = system line (broadcast)
  net_id      integer,
  name        text,                                  -- display name at the time ("Nick#1234")
  channel     smallint NOT NULL DEFAULT 0,           -- CHANNEL.SAY / SYSTEM
  text        text NOT NULL,                         -- as delivered (masked) — or as typed when blocked
  raw         text,                                  -- normalised original when it differs from text (owner only)
  action      text NOT NULL CHECK (action IN ('pass', 'mask', 'flag', 'block', 'system')),
  reasons     text[] NOT NULL DEFAULT '{}',
  flagged     boolean NOT NULL DEFAULT false,
  shadow      boolean NOT NULL DEFAULT false,        -- shadow-muted sender: only the sender saw it
  x           real,
  z           real
);
CREATE INDEX chat_log_at_idx ON chat_log (at);
CREATE INDEX chat_log_account_idx ON chat_log (account_id, at);
CREATE INDEX chat_log_ref_idx ON chat_log (ref);
