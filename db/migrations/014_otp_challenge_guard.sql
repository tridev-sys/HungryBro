-- 014_otp_challenge_guard.sql: otp_challenges is written and read only through functions.
-- Append-only: 001 to 013 are not edited. Runs as food_admin (owner of the objects below).
--
-- Why: 004 granted food_app SELECT, INSERT, UPDATE, DELETE on otp_challenges, and the table has no RLS.
-- A compromised app session could then reset attempts, un-consume a code, or delete rows.
--
-- Rules:
-- - food_app and food_sync lose every table privilege on otp_challenges.
-- - The issue functions (004, 012) insert the row, so they become SECURITY DEFINER with a fixed
--   search_path. Their bodies are unchanged.
-- - app_claim_otp_challenge counts an attempt atomically and returns the candidate challenge.
-- - app_consume_otp_challenge marks a challenge consumed, once.
-- Both claim and consume run as food_admin. food_app gets EXECUTE only.

-- ===== Issue functions: same bodies as 004 and 012, now SECURITY DEFINER =====
CREATE OR REPLACE FUNCTION app_issue_otp_challenge(p_phone TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE new_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('otp:' || p_phone));
  IF (SELECT count(*) FROM otp_challenges
        WHERE phone_e164 = p_phone AND created_at > NOW() - INTERVAL '1 hour') >= 3 THEN
    RETURN NULL;
  END IF;
  INSERT INTO otp_challenges (phone_e164, code_hash, expires_at)
  VALUES (p_phone, p_code_hash, NOW() + INTERVAL '300 seconds')
  RETURNING id INTO new_id;
  RETURN new_id;
END $$;

CREATE OR REPLACE FUNCTION app_issue_otp_challenge_email(p_email TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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

REVOKE ALL ON FUNCTION app_issue_otp_challenge(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_issue_otp_challenge_email(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_issue_otp_challenge(TEXT, TEXT) TO food_app;
GRANT EXECUTE ON FUNCTION app_issue_otp_challenge_email(TEXT, TEXT) TO food_app;

-- ===== Claim: count one attempt on the newest open challenge for an identifier =====
-- p_kind is 'phone' or 'email'. Returns zero rows when nothing is open, or the attempt cap is reached.
CREATE OR REPLACE FUNCTION app_claim_otp_challenge(p_kind TEXT, p_value TEXT, p_max_attempts INT)
RETURNS TABLE (out_id UUID, out_code_hash TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF p_kind = 'phone' THEN
    RETURN QUERY
      UPDATE otp_challenges c SET attempts = c.attempts + 1
       WHERE c.id = (
         SELECT s.id FROM otp_challenges s
          WHERE s.phone_e164 = p_value AND s.consumed_at IS NULL AND s.expires_at > NOW()
            AND s.attempts < p_max_attempts
          ORDER BY s.created_at DESC LIMIT 1)
       RETURNING c.id, c.code_hash;
  ELSIF p_kind = 'email' THEN
    RETURN QUERY
      UPDATE otp_challenges c SET attempts = c.attempts + 1
       WHERE c.id = (
         SELECT s.id FROM otp_challenges s
          WHERE s.email = p_value AND s.consumed_at IS NULL AND s.expires_at > NOW()
            AND s.attempts < p_max_attempts
          ORDER BY s.created_at DESC LIMIT 1)
       RETURNING c.id, c.code_hash;
  ELSE
    RAISE EXCEPTION 'INVALID_IDENTIFIER_KIND' USING ERRCODE = '22023';
  END IF;
END $$;

-- ===== Consume: mark a challenge used. True only for the call that flips consumed_at. =====
CREATE OR REPLACE FUNCTION app_consume_otp_challenge(p_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE done UUID;
BEGIN
  UPDATE otp_challenges SET consumed_at = NOW()
   WHERE id = p_id AND consumed_at IS NULL
  RETURNING id INTO done;
  RETURN done IS NOT NULL;
END $$;

REVOKE ALL ON FUNCTION app_claim_otp_challenge(TEXT, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_consume_otp_challenge(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_claim_otp_challenge(TEXT, TEXT, INT) TO food_app;
GRANT EXECUTE ON FUNCTION app_consume_otp_challenge(UUID) TO food_app;

-- ===== Remove direct DML =====
REVOKE ALL ON otp_challenges FROM PUBLIC, food_app, food_sync;
