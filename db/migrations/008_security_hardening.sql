-- 008_security_hardening.sql: fixes from the security suite (tests/security, commit 9b4f5d1).
-- Append-only: 001 to 007 are not edited. Migrations run as food_admin, so every table and
-- SECURITY DEFINER function here is owned by food_admin (BYPASSRLS, not superuser).
-- Sections map to the security findings (F1 to F10). F6 (POS lookup) is not in this file.

-- ===== F1 (CRITICAL): diners could change their own role and restaurant_id =====
-- users_self_manage lets a user update its own row. Column privileges limit the runtime role to
-- profile fields. Role and restaurant binding change only through food_admin (admin path).
REVOKE UPDATE ON users FROM food_app;
GRANT UPDATE (full_name, default_vpa, saved_gstin, updated_at) ON users TO food_app;

-- ===== F2 (CRITICAL): dining_tables had no RLS and food_app had full DML =====
-- Helper functions read the caller's restaurant, session table and table signature under owner
-- rights, so policies do not recurse through each other's RLS.
CREATE OR REPLACE FUNCTION app_current_staff_restaurant_id() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.restaurant_id FROM users u
   WHERE u.id = app_current_user_id() AND u.role IN ('restaurant_staff', 'kitchen_lead')
$$;

CREATE OR REPLACE FUNCTION app_current_session_table_id() RETURNS UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.table_id FROM tabletop_sessions s
   WHERE s.session_token = app_current_session_token() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION app_table_signature_matches(p_table_id UUID) RETURNS BOOLEAN
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_current_table_signature() IS NOT NULL AND EXISTS (
    SELECT 1 FROM dining_tables dt
     WHERE dt.id = p_table_id AND dt.current_signature_token = app_current_table_signature())
$$;

-- Table-open check. Compares the presented signature inside the function and returns only a
-- boolean, so the stored token never leaves the database through this path.
CREATE OR REPLACE FUNCTION app_verify_table_signature(p_restaurant_id UUID, p_table_number TEXT, p_signature TEXT)
RETURNS TABLE (table_id UUID, restaurant_id UUID, signature_ok BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dt.id, dt.restaurant_id,
         (p_signature IS NOT NULL AND dt.current_signature_token = p_signature)
    FROM dining_tables dt
   WHERE dt.restaurant_id = p_restaurant_id AND dt.table_number = p_table_number
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION app_current_staff_restaurant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_current_session_table_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_table_signature_matches(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_verify_table_signature(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_staff_restaurant_id() TO food_app;
GRANT EXECUTE ON FUNCTION app_current_session_table_id() TO food_app;
GRANT EXECUTE ON FUNCTION app_table_signature_matches(UUID) TO food_app;
GRANT EXECUTE ON FUNCTION app_verify_table_signature(UUID, TEXT, TEXT) TO food_app;

-- The old lookup returned the stored token to the caller. Replaced by app_verify_table_signature.
REVOKE ALL ON FUNCTION app_lookup_table(UUID, TEXT) FROM food_app;
DROP FUNCTION IF EXISTS app_lookup_table(UUID, TEXT);

ALTER TABLE dining_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_tables FORCE ROW LEVEL SECURITY;
REVOKE ALL ON dining_tables FROM food_app;
GRANT SELECT (id, restaurant_id, table_number, seating_capacity) ON dining_tables TO food_app;
-- current_signature_token is not granted to food_app. Direct reads of it fail with
-- "permission denied" (not zero rows). See the F2 report entry for the test expectation involved.

CREATE POLICY dining_tables_staff_read ON dining_tables FOR SELECT
  USING (restaurant_id = app_current_staff_restaurant_id());
CREATE POLICY dining_tables_session_read ON dining_tables FOR SELECT
  USING (id = app_current_session_table_id());

-- Presence policy from 003 read dining_tables.current_signature_token directly. Rewritten on the helper.
DROP POLICY IF EXISTS tabletop_sessions_table_presence ON tabletop_sessions;
CREATE POLICY tabletop_sessions_table_presence ON tabletop_sessions FOR SELECT
  USING (status IN ('active', 'payment_pending') AND app_table_signature_matches(table_id));

-- ===== F3 (HIGH): diners wrote their own session totals, status, and order-line prices =====
-- food_app loses UPDATE on tabletop_sessions. Totals, bill split, and status change only through
-- the functions below (owner rights). Each one requires the caller's own session token.
REVOKE UPDATE ON tabletop_sessions FROM food_app;

-- A diner may insert only an active session for itself. Totals, status, and closed_at are fixed.
CREATE OR REPLACE FUNCTION app_guard_session_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'food_app' THEN
    IF NEW.status <> 'active' OR NEW.subtotal <> 0 OR NEW.tax_amount <> 0 OR NEW.total_amount <> 0
       OR NEW.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'session status and totals are server-owned' USING ERRCODE = '42501';
    END IF;
    IF NEW.diner_user_id IS NOT NULL AND NEW.diner_user_id IS DISTINCT FROM app_current_user_id() THEN
      RAISE EXCEPTION 'diner_user_id must be the caller' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_session_insert ON tabletop_sessions;
CREATE TRIGGER trg_guard_session_insert BEFORE INSERT ON tabletop_sessions
  FOR EACH ROW EXECUTE FUNCTION app_guard_session_insert();

CREATE OR REPLACE FUNCTION app_require_session_token(p_session_token TEXT) RETURNS VOID
  LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF p_session_token IS NULL OR p_session_token IS DISTINCT FROM app_current_session_token() THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
END $$;

-- Totals from the session's own lines. GST is 5 percent (STATUTORY_GST_RATE in lib/pricing.ts).
CREATE OR REPLACE FUNCTION app_recalculate_session_totals(p_session_token TEXT) RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sub NUMERIC(10, 2); v_tax NUMERIC(10, 2);
BEGIN
  PERFORM app_require_session_token(p_session_token);
  SELECT COALESCE(SUM(l.unit_price * l.quantity), 0) INTO v_sub
    FROM tabletop_order_lines l JOIN tabletop_sessions s ON s.id = l.session_id
   WHERE s.session_token = p_session_token;
  v_tax := ROUND(v_sub * 0.05, 2);
  UPDATE tabletop_sessions
     SET subtotal = v_sub, tax_amount = v_tax, total_amount = v_sub + v_tax
   WHERE session_token = p_session_token;
END $$;

-- Bill split spec while the session is active (cart BILL_SPLIT action).
CREATE OR REPLACE FUNCTION app_set_bill_split_spec(p_session_token TEXT, p_spec JSONB) RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_require_session_token(p_session_token);
  UPDATE tabletop_sessions SET bill_split_spec = p_spec
   WHERE session_token = p_session_token AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_OPEN'; END IF;
END $$;

-- Starts payment: active -> payment_pending, with the server-computed totals and shares.
CREATE OR REPLACE FUNCTION app_begin_settlement(p_session_token TEXT, p_subtotal NUMERIC, p_tax NUMERIC,
                                                p_total NUMERIC, p_spec JSONB) RETURNS VOID
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM app_require_session_token(p_session_token);
  UPDATE tabletop_sessions
     SET status = 'payment_pending', subtotal = p_subtotal, tax_amount = p_tax,
         total_amount = p_total, bill_split_spec = p_spec
   WHERE session_token = p_session_token AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_OPEN'; END IF;
END $$;

-- Settlement step, called by the server after the payment adapter reports each share. Stores the
-- share state. Closes the session only when every share in the stored spec is paid. F4 section
-- covers order_refs. Returns the resulting status.
CREATE OR REPLACE FUNCTION app_apply_settlement_state(p_session_token TEXT, p_spec JSONB) RETURNS TEXT
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r RECORD;
  v_closed_at TIMESTAMPTZ;
  v_all_paid BOOLEAN;
BEGIN
  PERFORM app_require_session_token(p_session_token);
  SELECT s.id, s.status, s.diner_user_id, dt.restaurant_id INTO r
    FROM tabletop_sessions s JOIN dining_tables dt ON dt.id = s.table_id
   WHERE s.session_token = p_session_token
   FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF r.status <> 'payment_pending' THEN RETURN r.status::TEXT; END IF;

  UPDATE tabletop_sessions SET bill_split_spec = p_spec WHERE id = r.id;

  v_all_paid := jsonb_typeof(p_spec -> 'participants') = 'array'
            AND jsonb_array_length(p_spec -> 'participants') > 0
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_spec -> 'participants') p
                             WHERE (p ->> 'paid') IS DISTINCT FROM 'true');
  IF NOT v_all_paid THEN RETURN 'payment_pending'; END IF;

  UPDATE tabletop_sessions SET status = 'closed', closed_at = NOW()
   WHERE id = r.id RETURNING closed_at INTO v_closed_at;
  IF r.diner_user_id IS NOT NULL THEN
    INSERT INTO order_refs (restaurant_id, diner_user_id, session_id, status, settled_at)
    VALUES (r.restaurant_id, r.diner_user_id, r.id, 'completed', v_closed_at);
  END IF;
  RETURN 'closed';
END $$;

REVOKE ALL ON FUNCTION app_require_session_token(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_recalculate_session_totals(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_set_bill_split_spec(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_begin_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_apply_settlement_state(TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_require_session_token(TEXT) TO food_app;
GRANT EXECUTE ON FUNCTION app_recalculate_session_totals(TEXT) TO food_app;
GRANT EXECUTE ON FUNCTION app_set_bill_split_spec(TEXT, JSONB) TO food_app;
GRANT EXECUTE ON FUNCTION app_begin_settlement(TEXT, NUMERIC, NUMERIC, NUMERIC, JSONB) TO food_app;
GRANT EXECUTE ON FUNCTION app_apply_settlement_state(TEXT, JSONB) TO food_app;

-- Order lines: the runtime role cannot change a line's price. The price is read from the menu on insert.
REVOKE UPDATE ON tabletop_order_lines FROM food_app;
GRANT UPDATE (quantity, preparation_notes) ON tabletop_order_lines TO food_app;

CREATE OR REPLACE FUNCTION app_price_order_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_price NUMERIC(10, 2);
BEGIN
  IF current_user = 'food_app' THEN
    SELECT mi.base_price INTO v_price FROM menu_items mi
     WHERE mi.id = NEW.menu_item_id AND mi.restaurant_id = NEW.restaurant_id;
    IF v_price IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ITEM' USING ERRCODE = '42501'; END IF;
    NEW.unit_price := v_price;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_order_line ON tabletop_order_lines;
CREATE TRIGGER trg_price_order_line BEFORE INSERT ON tabletop_order_lines
  FOR EACH ROW EXECUTE FUNCTION app_price_order_line();

-- ===== F4 (HIGH): diners closed sessions, inserted completed order_refs, and rated them =====
-- order_refs writes (including status completed) happen only inside app_apply_settlement_state.
REVOKE INSERT, UPDATE ON order_refs FROM food_app;
DROP POLICY IF EXISTS order_refs_session_close_insert ON order_refs;

-- Belt and braces: a completed order may be written only by food_admin (owner) or the settlement
-- function, which runs with food_admin rights. A runtime session cannot insert status completed.
CREATE OR REPLACE FUNCTION app_guard_order_refs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'completed' AND current_user NOT IN ('food_admin', 'food') THEN
    RAISE EXCEPTION 'completed orders are written only by settlement' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_order_refs ON order_refs;
CREATE TRIGGER trg_guard_order_refs BEFORE INSERT OR UPDATE ON order_refs
  FOR EACH ROW EXECUTE FUNCTION app_guard_order_refs();

-- ===== F5 (HIGH): staff could write restaurant rating_aggregate and total_verified_reviews =====
-- Only app_refresh_restaurant_rating (owner rights, migration 004) writes these two columns.
REVOKE UPDATE ON restaurant_nodes FROM food_app;
DO $$
DECLARE cols TEXT;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a
   WHERE a.attrelid = 'restaurant_nodes'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname NOT IN ('id', 'created_at', 'rating_aggregate', 'total_verified_reviews');
  EXECUTE format('GRANT UPDATE (%s) ON restaurant_nodes TO food_app', cols);
END $$;

-- ===== F7 (MEDIUM): rating window trusted client-supplied created_at =====
-- created_at is always the database clock on insert, whatever the client sends.
CREATE OR REPLACE FUNCTION app_stamp_rating_created_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stamp_rating_created_at ON verified_customer_ratings;
CREATE TRIGGER trg_stamp_rating_created_at BEFORE INSERT ON verified_customer_ratings
  FOR EACH ROW EXECUTE FUNCTION app_stamp_rating_created_at();

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
         AND now() <= o.settled_at + INTERVAL '2 seconds'
    )
  );

-- ===== F10 (LOW): POS webhook replay =====
-- One row per (restaurant, body hash) for every accepted POS event. A repeat is refused. The
-- route writes this row inside the same transaction as the event, after the signature check.
CREATE TABLE IF NOT EXISTS pos_webhook_events (
  restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id) ON DELETE CASCADE,
  event_hash TEXT NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (restaurant_id, event_hash)
);
ALTER TABLE pos_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY pos_webhook_events_integration ON pos_webhook_events FOR ALL
  USING (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid)
  WITH CHECK (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
GRANT SELECT, INSERT ON pos_webhook_events TO food_app;
