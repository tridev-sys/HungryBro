-- 004_auth_ratings_compliance.sql (Plan 05). Append-only; never edit 001, 002, or 003.

-- Settlement timestamp for the 2-second rating window (Tasks 1 and 9).
ALTER TABLE order_refs ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
-- NOT VALID: rows created before this migration (test data from Plan 01) may be 'completed' without
-- a settlement time. The check is enforced on every new or updated row; existing rows are not invented.
ALTER TABLE order_refs ADD CONSTRAINT order_refs_completed_has_settlement
  CHECK (status <> 'completed' OR settled_at IS NOT NULL) NOT VALID;

-- Decision 5: the 2-second window is enforced by the database. Policies OR together, so the
-- Plan 01 policy must be dropped and recreated with the extra condition. created_at has a
-- DEFAULT NOW() and the app never sets it, so it is the database clock.
DROP POLICY IF EXISTS ratings_insert_verified ON verified_customer_ratings;
CREATE POLICY ratings_insert_verified ON verified_customer_ratings FOR INSERT
  WITH CHECK (
    diner_user_id = app_current_user_id()
    AND EXISTS (
      SELECT 1 FROM order_refs o
       WHERE o.id = verified_customer_ratings.order_ref_id
         AND o.status = 'completed'
         AND o.diner_user_id = app_current_user_id()
         AND o.restaurant_id = verified_customer_ratings.restaurant_id
         AND o.settled_at IS NOT NULL
         AND verified_customer_ratings.created_at <= o.settled_at + INTERVAL '2 seconds'
    )
  );

-- Allergen tags (Task 11).
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS allergen_tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE menu_items ADD CONSTRAINT menu_items_allergen_tags_valid
  CHECK (allergen_tags <@ ARRAY['peanut', 'shellfish', 'dairy', 'gluten']::text[]);

-- Saved UPI VPAs (Task 7).
CREATE TABLE IF NOT EXISTS user_vpas (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vpa VARCHAR(100) NOT NULL CONSTRAINT user_vpas_format CHECK (vpa ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,30}$'),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (user_id, vpa)
);
ALTER TABLE user_vpas ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_vpas FORCE ROW LEVEL SECURITY;
CREATE POLICY user_vpas_self_manage ON user_vpas FOR ALL
  USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());

-- OTP challenges (Task 3). Only an HMAC of the code is stored.
CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 VARCHAR(13) NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_challenges(phone_e164, created_at DESC);

-- Webhook event ids for replay rejection (Task 8).
CREATE TABLE IF NOT EXISTS webhook_events (
  provider TEXT NOT NULL CHECK (provider IN ('razorpay', 'cashfree')),
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  PRIMARY KEY (provider, event_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_vpas, otp_challenges, webhook_events TO food_app;

-- OTP limit: at most 3 challenges per phone per hour (Task 3). The advisory lock serialises
-- concurrent requests for one phone. The 300-second TTL must equal OTP_TTL_SECONDS in Task 3.
CREATE OR REPLACE FUNCTION app_issue_otp_challenge(p_phone TEXT, p_code_hash TEXT)
RETURNS UUID LANGUAGE plpgsql AS $$
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
GRANT EXECUTE ON FUNCTION app_issue_otp_challenge(TEXT, TEXT) TO food_app;

-- Rating recalculation in the same transaction as each verified insert (decision: Task 1).
-- SECURITY DEFINER runs as its owner, food_admin (BYPASSRLS), so it can update restaurant_nodes past RLS.
CREATE OR REPLACE FUNCTION app_refresh_restaurant_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE restaurant_nodes r
     SET rating_aggregate = agg.avg_score,
         total_verified_reviews = agg.n
    FROM (SELECT ROUND(AVG(v.rating_score)::numeric, 2) AS avg_score, COUNT(*)::int AS n
            FROM verified_customer_ratings v
           WHERE v.restaurant_id = NEW.restaurant_id) agg
   WHERE r.id = NEW.restaurant_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app_refresh_restaurant_rating() FROM PUBLIC;
CREATE TRIGGER trg_refresh_restaurant_rating
  AFTER INSERT ON verified_customer_ratings
  FOR EACH ROW EXECUTE FUNCTION app_refresh_restaurant_rating();

-- Sign-in lookup: read-only, never creates a user. Returns zero or one row.
-- SECURITY DEFINER, owned by food_admin (BYPASSRLS, not superuser), fixed search_path.
CREATE OR REPLACE FUNCTION app_lookup_user_by_phone(p_phone TEXT)
RETURNS SETOF users LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT * FROM users WHERE phone_number = p_phone;
$$;
REVOKE ALL ON FUNCTION app_lookup_user_by_phone(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lookup_user_by_phone(TEXT) TO food_app;

-- The only path that creates a user. Called only by the OTP verify route, after verifyOtp succeeds
-- in the same request. Rejects unless this phone has a verified challenge (consumed_at set by
-- verifyOtp) in the last 10 minutes. SECURITY DEFINER, owned by food_admin, fixed search_path.
CREATE OR REPLACE FUNCTION app_create_user_after_otp(p_phone TEXT)
RETURNS users LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE r users;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM otp_challenges
    WHERE phone_e164 = p_phone
      AND consumed_at IS NOT NULL
      AND consumed_at > NOW() - INTERVAL '10 minutes'
  ) THEN
    RAISE EXCEPTION 'OTP_NOT_VERIFIED' USING ERRCODE = '42501';
  END IF;
  INSERT INTO users (phone_number) VALUES (p_phone)
  ON CONFLICT (phone_number) DO UPDATE SET updated_at = NOW()
  RETURNING * INTO r;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION app_create_user_after_otp(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_create_user_after_otp(TEXT) TO food_app;
