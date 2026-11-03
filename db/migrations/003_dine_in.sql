-- 003_dine_in.sql (Plan 03). Append-only; never edit an applied migration.
--
-- Order: 001 (Plan 01), 002 (Plan 02), 003 (this file), 004 (Plan 05), 005 (Plan 06).
-- On a database that already has 004 applied, this file runs after it, so it must not
-- depend on 004 objects. Changes:
--   * restaurant_nodes.settlement_vpa: payee VPA for UPI shares (NULL means NO_SETTLEMENT_VPA).
--   * tabletop_sessions.diner_user_id: NULL for guest sessions; drives the order_refs write at close.
--   * tabletop_order_lines: one row per (session, menu item), with RLS by session token.
--   * one open session per table (partial unique index).
--   * session and table-signature helpers, and app_lookup_table (SECURITY DEFINER).
--   * RLS: table-signature read of open sessions, session-scoped tickets, kitchen load updates
--     (decision 2), and the order_refs insert at session close.
-- menu_items allergens are NOT added here: migration 004 already provides menu_items.allergen_tags
-- with the same four tags (peanut, shellfish, dairy, gluten).

ALTER TABLE restaurant_nodes ADD COLUMN IF NOT EXISTS settlement_vpa VARCHAR(100);
ALTER TABLE tabletop_sessions ADD COLUMN IF NOT EXISTS diner_user_id UUID REFERENCES users(id);

CREATE OR REPLACE FUNCTION app_current_session_token() RETURNS TEXT
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.session_token', true), '') $$;

CREATE OR REPLACE FUNCTION app_current_table_signature() RETURNS TEXT
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.table_signature', true), '') $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_session_per_table
  ON tabletop_sessions(table_id)
  WHERE status IN ('active', 'payment_pending');

-- At most one order_refs row per dine-in session (written once, at close).
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refs_one_per_session
  ON order_refs(session_id)
  WHERE session_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tabletop_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES tabletop_sessions(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES menu_items(id),
  station VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  preparation_notes VARCHAR(100),
  dietary_flags TEXT[] NOT NULL DEFAULT '{}',
  participant_index INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, menu_item_id)
);

ALTER TABLE tabletop_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabletop_order_lines FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON tabletop_order_lines TO food_app;

-- Table lookup before any session exists. Returns at most one row and only these columns.
CREATE OR REPLACE FUNCTION app_lookup_table(p_restaurant_id UUID, p_table_number TEXT)
RETURNS TABLE (table_id UUID, restaurant_id UUID, current_signature_token TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT dt.id, dt.restaurant_id, dt.current_signature_token::text
    FROM dining_tables dt
   WHERE dt.restaurant_id = p_restaurant_id AND dt.table_number = p_table_number
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION app_lookup_table(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_lookup_table(UUID, TEXT) TO food_app;

-- Policies below are permissive, so they OR with the Plan 01 and Plan 05 policies.

-- A table signature reveals only that table's open session (Review Focus 2).
CREATE POLICY tabletop_sessions_table_presence ON tabletop_sessions FOR SELECT
  USING (
    status IN ('active', 'payment_pending')
    AND EXISTS (
      SELECT 1 FROM dining_tables dt
       WHERE dt.id = tabletop_sessions.table_id
         AND dt.current_signature_token = app_current_table_signature()
    )
  );

-- A diner sees and fires tickets only for their own active session, in that session's restaurant.
CREATE POLICY kds_tickets_session_read ON kds_tickets FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM tabletop_sessions s
        JOIN dining_tables dt ON dt.id = s.table_id
       WHERE s.id = kds_tickets.session_id
         AND s.session_token = app_current_session_token()
         AND s.status = 'active'
         AND dt.restaurant_id = kds_tickets.restaurant_id
    )
  );

CREATE POLICY kds_tickets_session_insert ON kds_tickets FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tabletop_sessions s
        JOIN dining_tables dt ON dt.id = s.table_id
       WHERE s.id = kds_tickets.session_id
         AND s.session_token = app_current_session_token()
         AND s.status = 'active'
         AND dt.restaurant_id = kds_tickets.restaurant_id
    )
  );

CREATE POLICY tabletop_order_lines_session ON tabletop_order_lines FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tabletop_sessions s
       WHERE s.id = tabletop_order_lines.session_id
         AND s.session_token = app_current_session_token()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tabletop_sessions s
       WHERE s.id = tabletop_order_lines.session_id
         AND s.session_token = app_current_session_token()
    )
  );

CREATE POLICY tabletop_order_lines_staff ON tabletop_order_lines FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
       WHERE u.id = app_current_user_id()
         AND u.role IN ('restaurant_staff', 'kitchen_lead', 'platform_admin')
         AND u.restaurant_id = tabletop_order_lines.restaurant_id
    )
  );

-- Decision 2: only the restaurant's own staff or kitchen lead may write its kitchen load.
-- Diners have no UPDATE policy on restaurant_nodes. RLS filters rows, not columns.
CREATE POLICY restaurant_nodes_kitchen_load_update ON restaurant_nodes FOR UPDATE
  USING (
    id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND (SELECT u.role FROM users u WHERE u.id = app_current_user_id()) IN ('restaurant_staff', 'kitchen_lead')
  )
  WITH CHECK (
    id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND (SELECT u.role FROM users u WHERE u.id = app_current_user_id()) IN ('restaurant_staff', 'kitchen_lead')
  );

-- Order record at session close (Plan 03 Task 6 Step 7). The session must be closed in this
-- transaction, the diner must be the session's diner, and the row must belong to that restaurant.
-- Guest sessions (diner_user_id NULL) cannot match, so they write no row.
CREATE POLICY order_refs_session_close_insert ON order_refs FOR INSERT
  WITH CHECK (
    diner_user_id = app_current_user_id()
    AND session_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM tabletop_sessions s
        JOIN dining_tables dt ON dt.id = s.table_id
       WHERE s.id = order_refs.session_id
         AND s.session_token = app_current_session_token()
         AND s.status = 'closed'
         AND s.diner_user_id = order_refs.diner_user_id
         AND dt.restaurant_id = order_refs.restaurant_id
    )
  );
