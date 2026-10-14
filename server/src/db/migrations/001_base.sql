-- 001_base.sql — foundation schema (accounts, identities, refresh tokens, characters, invites, admin audit, playtime).
-- Owners add their own files: 010–019 S2, 020–029 S3, 030–039 S5. Never edit an applied migration; add a new one.

-- Invite codes (closed test): only the hash of a code is stored.
CREATE TABLE invites (
  id          bigserial PRIMARY KEY,
  code_hash   bytea NOT NULL UNIQUE,                 -- sha256 / HMAC of the normalised code
  batch       text,                                  -- batch label from the admin generator
  uses_left   integer NOT NULL DEFAULT 1 CHECK (uses_left >= 0),
  uses_total  integer NOT NULL DEFAULT 1 CHECK (uses_total >= 0),
  expires_at  timestamptz,
  created_by  text NOT NULL DEFAULT 'admin',
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL DEFAULT 'guest' CHECK (kind IN ('guest', 'full')),
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'banned', 'deleted')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen         timestamptz,
  play_seconds      bigint NOT NULL DEFAULT 0,         -- lifetime play time (chat slow mode < 10 min)
  recovery_hash     bytea UNIQUE,                      -- hash of the 12-char recovery code (shown once)
  invite_id         bigint REFERENCES invites(id) ON DELETE SET NULL,
  locale            text NOT NULL DEFAULT 'vi',
  verified_phone_at timestamptz,                       -- legal hooks (ND 147/2024), unused in the closed test
  birth_year        smallint
);
CREATE INDEX accounts_last_seen_idx ON accounts (last_seen);

-- Login identities: device (guest), google (GĐ2), phone (if ever required). "Link, never merge".
CREATE TABLE identities (
  provider    text NOT NULL CHECK (provider IN ('device', 'google', 'phone')),
  subject     text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_account_idx ON identities (account_id);

-- Refresh tokens: 256-bit random, only the hash is stored; rotated on every use (rotated_from chain), 180 days.
CREATE TABLE refresh_tokens (
  id            bigserial PRIMARY KEY,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  device_id     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  rotated_from  bigint REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  revoked_at    timestamptz
);
CREATE INDEX refresh_tokens_account_idx ON refresh_tokens (account_id);

-- One character per account in v1.
CREATE TABLE characters (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  nickname       text NOT NULL,                        -- as typed (after filter), 3–16 chars
  discriminator  smallint NOT NULL CHECK (discriminator BETWEEN 0 AND 9999),
  display_name   text NOT NULL,                        -- "Nick#1234"
  appearance     bytea NOT NULL DEFAULT '\x0000000000000000'::bytea CHECK (length(appearance) = 8),
  pos_x          real,
  pos_z          real,
  pos_y          real,
  yaw            real,
  cell           smallint,
  version        bigint NOT NULL DEFAULT 0,            -- optimistic concurrency (handoff, multi-writer)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX characters_name_idx ON characters (lower(nickname), discriminator);

-- Every admin action (who, what, when).
CREATE TABLE admin_audit (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  actor   text NOT NULL DEFAULT 'owner',
  action  text NOT NULL,
  target  text,
  detail  jsonb,
  ip      text
);
CREATE INDEX admin_audit_at_idx ON admin_audit (at);

-- Legal hook: seconds played per account per day.
CREATE TABLE playtime_daily (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day         date NOT NULL,
  seconds     integer NOT NULL DEFAULT 0 CHECK (seconds >= 0),
  PRIMARY KEY (account_id, day)
);
