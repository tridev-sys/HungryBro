-- 013_verified_email_claim.sql: a phone-only account attaches a verified email on the same row.
-- Append-only: 001 to 012 are not edited. Runs as food_admin (owner of the objects below).
--
-- Rules (docs/superpowers/plans/2026-11-03-tech-decisions.md, "Verified email for phone-only accounts"):
-- - An email is attached only after a 6-digit code sent to that address is entered. The challenge is
--   tagged purpose 'attach_email' and bound to the signed-in user (claim_user_id).
-- - app_attach_verified_email sets users.email only for the caller in app.user_id, only with a claim
--   consumed by that same caller in the last 10 minutes, and only when users.email is NULL.
-- - A sign-in challenge (purpose 'sign_in') can never attach an email.
-- - Duplicates are stopped by users_email_lower_key (012), so one address maps to one account.

-- ===== otp_challenges: purpose and claim owner =====
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'sign_in';
ALTER TABLE otp_challenges ADD COLUMN IF NOT EXISTS claim_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check CHECK (purpose IN ('sign_in', 'attach_email'));
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_claim_owner CHECK (
  (purpose = 'attach_email') = (claim_user_id IS NOT NULL)
);

-- Issue an attach challenge for the signed-in caller. Same 3-per-address-per-hour rule and the same
-- advisory lock key as sign-in, so the limit counts both purposes together.
-- Raises ALREADY_HAS_EMAIL when the caller already has an email, and NOT_SIGNED_IN without a caller.
CREATE OR REPLACE FUNCTION app_issue_email_claim_otp(p_email TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  new_id UUID;
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  e TEXT := lower(btrim(p_email));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM users WHERE id = uid AND email IS NOT NULL) THEN
    RAISE EXCEPTION 'ALREADY_HAS_EMAIL' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('otp:email:' || e));
  IF (SELECT count(*) FROM otp_challenges
        WHERE email = e AND created_at > NOW() - INTERVAL '1 hour') >= 3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO otp_challenges (email, code_hash, expires_at, purpose, claim_user_id)
  VALUES (e, p_code_hash, NOW() + INTERVAL '300 seconds', 'attach_email', uid)
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION app_issue_email_claim_otp(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_issue_email_claim_otp(TEXT, TEXT) TO food_app;

-- Attach the verified email to the caller's own row. The only UPDATE path for users.email from the app.
-- Raises NOT_VERIFIED unless the caller consumed an attach challenge for this address in the last 10
-- minutes, and ALREADY_HAS_EMAIL when the row already has one. A taken address raises 23505 (EMAIL_TAKEN).
CREATE OR REPLACE FUNCTION app_attach_verified_email(p_email TEXT)
RETURNS users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  r users;
  uid UUID := NULLIF(current_setting('app.user_id', true), '')::uuid;
  e TEXT := lower(btrim(p_email));
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM otp_challenges
    WHERE email = e
      AND purpose = 'attach_email'
      AND claim_user_id = uid
      AND consumed_at IS NOT NULL
      AND consumed_at > NOW() - INTERVAL '10 minutes'
  ) THEN
    RAISE EXCEPTION 'NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;
  UPDATE users SET email = e, updated_at = NOW()
   WHERE id = uid AND email IS NULL
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ALREADY_HAS_EMAIL' USING ERRCODE = '42501';
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app_attach_verified_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_attach_verified_email(TEXT) TO food_app;
