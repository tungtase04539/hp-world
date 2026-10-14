-- 022_social_blocks.sql — S3: per-player mute / block lists. The server stops delivering chat between the two:
-- mute = I stop seeing the target; block = neither of us sees the other.
CREATE TABLE social_blocks (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'block' CHECK (kind IN ('mute', 'block')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, target_id),
  CHECK (account_id <> target_id)
);
CREATE INDEX social_blocks_target_idx ON social_blocks (target_id);
