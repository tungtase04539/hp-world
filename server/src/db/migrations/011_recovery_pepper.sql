-- 011_recovery_pepper.sql — fixer round 1 (SEC-5): recovery codes are stored as HMAC-SHA256(RECOVERY_PEPPER, code)
-- (version 2). Existing rows hold the plain sha256 (version 1) and are upgraded on their next successful recovery.
ALTER TABLE accounts ADD COLUMN recovery_hash_v smallint NOT NULL DEFAULT 1;
