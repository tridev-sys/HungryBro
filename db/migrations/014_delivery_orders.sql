-- 014_delivery_orders.sql: customer delivery orders, payment state, and delivered settlement.
-- Append-only: 001 to 013 are not edited. Runs as food_admin (owner of the objects below).
--
-- Rules:
-- - Prices are never taken from the client. delivery_order_lines take unit_price and name from
--   menu_items (trigger). A deferred constraint checks that the order subtotal equals its lines.
-- - food_app (request traffic) can read its own orders and insert new pending orders. It cannot
--   update or delete orders or lines.
-- - Payment capture (webhook path) and delivery go through SECURITY DEFINER functions owned by
--   food_admin, after the HMAC check in the route.
-- - Delivered orders create an order_refs row (status completed, settled_at = now()). The existing
--   2-second rating window (migrations 004 and 008) then applies unchanged.

-- ===== delivery_orders =====
CREATE TABLE IF NOT EXISTS delivery_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id),
    diner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    auction_id UUID NULL REFERENCES mesh_food_auctions(id) ON DELETE SET NULL,
    client_key TEXT NOT NULL CHECK (char_length(client_key) BETWEEN 8 AND 64),
    status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('pending_payment', 'in_kitchen', 'delivered', 'cancelled')),
    subtotal NUMERIC(10, 2) NOT NULL CHECK (subtotal >= 0),
    gst NUMERIC(10, 2) NOT NULL CHECK (gst >= 0),
    total NUMERIC(10, 2) NOT NULL CHECK (total >= 0),
    payment_provider TEXT NOT NULL CHECK (payment_provider IN ('razorpay', 'cashfree')),
    provider_order_id TEXT NOT NULL UNIQUE,
    upi_intent_url TEXT NOT NULL,
    order_ref_id UUID NULL REFERENCES order_refs(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ NULL,
    delivered_at TIMESTAMPTZ NULL,
    CONSTRAINT delivery_orders_total_is_sum CHECK (total = subtotal + gst),
    CONSTRAINT delivery_orders_client_key_per_diner UNIQUE (diner_user_id, client_key),
    CONSTRAINT delivery_orders_delivered_has_ref CHECK (status <> 'delivered' OR order_ref_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_diner ON delivery_orders (diner_user_id, created_at DESC);

-- ===== delivery_order_lines =====
CREATE TABLE IF NOT EXISTS delivery_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
    menu_item_id UUID NOT NULL REFERENCES menu_items(id),
    name_snapshot VARCHAR(255) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL CHECK (unit_price >= 0),
    quantity INT NOT NULL CHECK (quantity BETWEEN 1 AND 20),
    line_total NUMERIC(10, 2) NOT NULL CHECK (line_total >= 0)
);
CREATE INDEX IF NOT EXISTS idx_delivery_order_lines_order ON delivery_order_lines (order_id);

-- The price and name come from the menu, never from the insert. Runs for every role.
CREATE OR REPLACE FUNCTION app_price_delivery_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_price NUMERIC(10, 2);
  v_name VARCHAR(255);
  v_restaurant UUID;
BEGIN
  SELECT mi.base_price, mi.name, mi.restaurant_id INTO v_price, v_name, v_restaurant
    FROM menu_items mi WHERE mi.id = NEW.menu_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'menu item not found' USING ERRCODE = '23503'; END IF;
  IF v_restaurant IS DISTINCT FROM (SELECT o.restaurant_id FROM delivery_orders o WHERE o.id = NEW.order_id) THEN
    RAISE EXCEPTION 'menu item belongs to another restaurant' USING ERRCODE = '23514';
  END IF;
  NEW.unit_price := v_price;
  NEW.name_snapshot := v_name;
  NEW.line_total := ROUND(v_price * NEW.quantity, 2);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_price_delivery_line ON delivery_order_lines;
CREATE TRIGGER trg_price_delivery_line BEFORE INSERT ON delivery_order_lines
  FOR EACH ROW EXECUTE FUNCTION app_price_delivery_line();

-- At commit, the order subtotal must equal the sum of its lines. Owner rights: reads lines past RLS.
CREATE OR REPLACE FUNCTION app_check_delivery_totals() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s NUMERIC(10, 2);
BEGIN
  SELECT COALESCE(SUM(l.line_total), 0) INTO s FROM delivery_order_lines l WHERE l.order_id = NEW.id;
  IF s <> NEW.subtotal THEN
    RAISE EXCEPTION 'delivery order subtotal does not match its lines' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_check_delivery_totals ON delivery_orders;
CREATE CONSTRAINT TRIGGER trg_check_delivery_totals AFTER INSERT ON delivery_orders
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_check_delivery_totals();

-- ===== Row-level security =====
ALTER TABLE delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS delivery_orders_diner_select ON delivery_orders;
CREATE POLICY delivery_orders_diner_select ON delivery_orders FOR SELECT
  USING (diner_user_id = app_current_user_id());

DROP POLICY IF EXISTS delivery_orders_diner_insert ON delivery_orders;
CREATE POLICY delivery_orders_diner_insert ON delivery_orders FOR INSERT
  WITH CHECK (diner_user_id = app_current_user_id()
              AND status = 'pending_payment' AND paid_at IS NULL
              AND delivered_at IS NULL AND order_ref_id IS NULL);

DROP POLICY IF EXISTS delivery_order_lines_diner_select ON delivery_order_lines;
CREATE POLICY delivery_order_lines_diner_select ON delivery_order_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM delivery_orders o
                  WHERE o.id = delivery_order_lines.order_id AND o.diner_user_id = app_current_user_id()));

DROP POLICY IF EXISTS delivery_order_lines_diner_insert ON delivery_order_lines;
CREATE POLICY delivery_order_lines_diner_insert ON delivery_order_lines FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM delivery_orders o
                       WHERE o.id = delivery_order_lines.order_id AND o.diner_user_id = app_current_user_id()
                         AND o.status = 'pending_payment'));

-- Default privileges may grant more: revoke, then grant the minimum.
REVOKE ALL ON delivery_orders, delivery_order_lines FROM PUBLIC, food_app;
GRANT SELECT, INSERT ON delivery_orders, delivery_order_lines TO food_app;

-- ===== Payment capture (webhook path) =====
-- Called only after the route verified the HMAC signature. One transaction: the event is recorded
-- once (webhook_events primary key), and only a new capture of the exact stored total marks the
-- order paid and moves it to the kitchen. Returns DUPLICATE, IGNORED, UNKNOWN_ORDER, NOOP,
-- AMOUNT_MISMATCH, or PAID.
CREATE OR REPLACE FUNCTION app_apply_payment_event(p_provider TEXT, p_event_id TEXT, p_event_type TEXT,
                                                   p_provider_order_id TEXT, p_amount NUMERIC)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order delivery_orders%ROWTYPE;
BEGIN
  INSERT INTO webhook_events (provider, event_id) VALUES (p_provider, p_event_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'DUPLICATE'; END IF;
  IF p_event_type <> 'payment.captured' THEN RETURN 'IGNORED'; END IF;

  SELECT * INTO v_order FROM delivery_orders
   WHERE provider_order_id = p_provider_order_id AND payment_provider = p_provider
   FOR UPDATE;
  IF NOT FOUND THEN RETURN 'UNKNOWN_ORDER'; END IF;
  IF v_order.status <> 'pending_payment' THEN RETURN 'NOOP'; END IF;
  IF p_amount IS DISTINCT FROM v_order.total THEN RETURN 'AMOUNT_MISMATCH'; END IF;

  UPDATE delivery_orders SET status = 'in_kitchen', paid_at = NOW() WHERE id = v_order.id;
  RETURN 'PAID';
END $$;

-- ===== Delivered: settlement for rating =====
-- Callable by staff of the order's restaurant, or platform_admin. Creates the completed order_refs
-- row (settled_at = now) and links it. The rating window starts here (migration 004 and 008 rules).
CREATE OR REPLACE FUNCTION app_mark_delivery_delivered(p_order_id UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order delivery_orders%ROWTYPE;
  v_role TEXT;
  v_staff_restaurant UUID;
  v_ref UUID;
BEGIN
  SELECT u.role::text, u.restaurant_id INTO v_role, v_staff_restaurant
    FROM users u WHERE u.id = app_current_user_id();
  IF v_role IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_order FROM delivery_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_role <> 'platform_admin'
     AND (v_role NOT IN ('restaurant_staff', 'kitchen_lead', 'delivery_agent')
          OR v_staff_restaurant IS DISTINCT FROM v_order.restaurant_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'in_kitchen' THEN RAISE EXCEPTION 'ORDER_NOT_IN_KITCHEN' USING ERRCODE = '55000'; END IF;

  INSERT INTO order_refs (restaurant_id, diner_user_id, session_id, status, settled_at)
  VALUES (v_order.restaurant_id, v_order.diner_user_id, NULL, 'completed', NOW())
  RETURNING id INTO v_ref;

  UPDATE delivery_orders SET status = 'delivered', delivered_at = NOW(), order_ref_id = v_ref
   WHERE id = v_order.id;
  RETURN v_ref;
END $$;

REVOKE ALL ON FUNCTION app_apply_payment_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_mark_delivery_delivered(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_check_delivery_totals() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_price_delivery_line() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_apply_payment_event(TEXT, TEXT, TEXT, TEXT, NUMERIC) TO food_app;
GRANT EXECUTE ON FUNCTION app_mark_delivery_delivered(UUID) TO food_app;
