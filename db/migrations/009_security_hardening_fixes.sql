-- 009_security_hardening_fixes.sql: corrections to the security fixes in 008.
-- 008 is already applied on existing databases, so it is not edited. This file is idempotent
-- (CREATE OR REPLACE, DROP ... IF EXISTS, GRANT repeats are harmless) and runs after 008.
-- Migrations run as food_admin, so the functions here are owned by food_admin.

-- ===== Row lock for cart and settlement (F3, F4) =====
-- FOR UPDATE, FOR NO KEY UPDATE, FOR SHARE, and FOR KEY SHARE all need the UPDATE privilege.
-- food_app no longer has UPDATE on tabletop_sessions, so the caller's own session row is locked
-- here, and only that session is returned.
CREATE OR REPLACE FUNCTION app_lock_session(p_session_token TEXT)
RETURNS TABLE (id UUID, status session_status, diner_user_id UUID, restaurant_id UUID,
               table_number VARCHAR, bill_split_spec JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_require_session_token(p_session_token);
  RETURN QUERY
    SELECT s.id, s.status, s.diner_user_id, dt.restaurant_id, dt.table_number, s.bill_split_spec
      FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
     WHERE s.session_token = p_session_token
     FOR UPDATE OF s;
END $$;

REVOKE ALL ON FUNCTION app_lock_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lock_session(TEXT) TO food_app;

-- ===== POS credentials are read only on the verified webhook path (F6) =====
-- The function returns one restaurant's ciphertext only when the transaction is the integration
-- path for that same restaurant (asIntegration sets app.integration_restaurant_id, and the POS
-- route calls it there before the HMAC check that needs the secret), or when the session user
-- is platform_admin. Any other caller, including staff of another restaurant and an anonymous
-- app login, gets NULL.
CREATE OR REPLACE FUNCTION app_pos_credentials_for_restaurant(p_restaurant_id UUID) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid IS DISTINCT FROM p_restaurant_id
     AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id() AND u.role = 'platform_admin') THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT c.ciphertext FROM restaurant_pos_credentials c WHERE c.restaurant_id = p_restaurant_id);
END $$;

REVOKE ALL ON FUNCTION app_pos_credentials_for_restaurant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pos_credentials_for_restaurant(UUID) TO food_app;
