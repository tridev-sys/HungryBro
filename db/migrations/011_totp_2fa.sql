-- 011_totp_2fa.sql: TOTP second factor (RFC 6238) and single-use recovery codes.
--
-- user_totp holds one row per user. secret_encrypted is the AES-256-GCM envelope from
-- lib/pos/credentials.ts, keyed by TOTP_ENCRYPTION_KEY. The plain base32 secret is never stored.
-- enabled_at is NULL until the user proves a valid code (enrolment), so a pending secret does
-- not enforce 2FA at sign-in. last_used_step stores the last accepted 30-second counter, so a
-- code cannot be replayed inside its window.
--
-- totp_recovery_codes holds HMAC digests of the ten recovery codes issued at activation.
-- used_at is set atomically on use, so each code works once.
--
-- Both tables are user-scoped: RLS with FORCE, the same policy shape as user_vpas (004).
-- food_app gets SELECT, INSERT, UPDATE only (no DELETE). food_sync gets nothing.

CREATE TABLE IF NOT EXISTS user_totp (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted JSONB NOT NULL CHECK (jsonb_typeof(secret_encrypted) = 'object'),
  enabled_at TIMESTAMPTZ,
  last_used_step BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_user ON totp_recovery_codes(user_id);

ALTER TABLE user_totp ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_totp FORCE ROW LEVEL SECURITY;
CREATE POLICY user_totp_self_manage ON user_totp FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

ALTER TABLE totp_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE totp_recovery_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY totp_recovery_codes_self_manage ON totp_recovery_codes FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

-- Default privileges from 001_init.sql grant every table to food_app and food_sync. Remove that,
-- then grant only what the sign-in and enrolment code needs.
REVOKE ALL ON user_totp, totp_recovery_codes FROM PUBLIC, food_app, food_sync;
GRANT SELECT, INSERT, UPDATE ON user_totp, totp_recovery_codes TO food_app;
