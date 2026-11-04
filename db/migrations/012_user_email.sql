-- 012_user_email.sql: email as a second sign-in identifier (owner decision, 2026-11-04).
-- Append-only: 001 to 011 are not edited. Runs as food_admin (owner of the objects below).
--
-- Each user has at most one phone and at most one email, and at least one of them. Phone and
-- email each resolve to one user (phone_number is UNIQUE from 001; email has a unique index on
-- lower(email)). Email is stored normalised (trimmed, lowercase), enforced by CHECK. Existing rows
-- keep their phone and get a NULL email.
--
-- otp_challenges takes exactly one identifier: phone_e164 (existing rows) or email (new rows).
-- The phone functions from 004 are unchanged. Email has its own issue, lookup and create functions.
-- food_app keeps the same grants and RLS: users stays self-manage, otp_challenges stays
-- request-role DML, and the SECURITY DEFINER functions run as food_admin (BYPASSRLS).

-- ===== users: optional phone, optional email, at least one =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE users ALTER COLUMN phone_number DROP NOT NULL;

ALTER TABLE users ADD CONSTRAINT users_email_normalised CHECK (
  email IS NULL OR (
    email = lower(btrim(email))
    AND length(email) BETWEEN 3 AND 254
    AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);
ALTER TABLE users ADD CONSTRAINT users_has_identifier CHECK (phone_number IS NOT NULL OR email IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email)) WHERE email IS NOT NULL;

-- ===== otp_challenges: one identifier per challenge =====
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE otp_challenges ALTER COLUMN phone_e164 DROP NOT NULL;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_one_identifier CHECK ((phone_e164 IS NULL) <> (email IS NULL));
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_email_normalised CHECK (email IS NULL OR email = lower(btrim(email)));
CREATE INDEX IF NOT EXISTS idx_otp_email_created ON otp_challenges(email, created_at DESC);

-- Issue an email challenge: at most 3 per address per hour, same rule as the phone path in 004.
-- The advisory lock key is separate from the phone key, so phone and email never share a lock.
CREATE OR REPLACE FUNCTION app_issue_otp_challenge_email(p_email TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
DECLARE new_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp:email:' || p_email));
  IF (SELECT count(*) FROM otp_challenges
        WHERE email = p_email AND created_at > NOW() - INTERVAL '1 hour') >= 3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO otp_challenges (email, code_hash, expires_at)
  VALUES (p_email, p_code_hash, NOW() + INTERVAL '300 seconds')
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION app_issue_otp_challenge_email(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_issue_otp_challenge_email(TEXT, TEXT) TO food_app;

-- Read-only sign-in lookup by email. Case-insensitive through the index. Never creates a user.
CREATE OR REPLACE FUNCTION app_lookup_user_by_email(p_email TEXT)
RETURNS SETOF users LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM users WHERE lower(email) = lower(btrim(p_email));
$$;
REVOKE ALL ON FUNCTION app_lookup_user_by_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lookup_user_by_email(TEXT) TO food_app;

-- The only path that creates an email user. Rejects unless this address has a challenge that
-- verifyOtp consumed in the last 10 minutes. Same rule as app_create_user_after_otp (004).
CREATE OR REPLACE FUNCTION app_create_user_after_email_otp(p_email TEXT)
RETURNS users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r users;
        e TEXT := lower(btrim(p_email));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM otp_challenges
    WHERE email = e
      AND consumed_at IS NOT NULL
      AND consumed_at > NOW() - INTERVAL '10 minutes'
  ) THEN
    RAISE EXCEPTION 'OTP_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;
  INSERT INTO users (email) VALUES (e)
  ON CONFLICT (lower(email)) WHERE email IS NOT NULL DO UPDATE SET updated_at = NOW()
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app_create_user_after_email_otp(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_user_after_email_otp(TEXT) TO food_app;
