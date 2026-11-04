-- 010_business_ledger.sql: outlet SaaS subscriptions, delivery pass-through ledger, and the
-- kitchen prep estimate used by the 30 minute SLA filter (owner decisions, 2026-11-04).
-- Append-only: 001 to 009 are not edited. Runs as food_admin (owner of the new objects).

-- ===== Kitchen prep estimate (SLA filter, lib/auction/sla.ts) =====
-- No prep column existed before. 12 minutes is the existing estimate used by sandbox kitchens.
-- food_app cannot update it (008 grants only the listed restaurant_nodes columns); ops sets it
-- as food_admin.
ALTER TABLE restaurant_nodes
  ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER NOT NULL DEFAULT 12
  CHECK (prep_time_minutes BETWEEN 1 AND 120);

-- ===== Restaurant SaaS: 499 INR per physical outlet per month =====
CREATE TABLE IF NOT EXISTS outlet_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id) ON DELETE CASCADE,
  outlet_label TEXT NOT NULL CHECK (length(btrim(outlet_label)) > 0),
  monthly_fee_inr NUMERIC(10,2) NOT NULL DEFAULT 499.00 CHECK (monthly_fee_inr >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end > period_start)
);
CREATE INDEX IF NOT EXISTS idx_outlet_subscriptions_restaurant ON outlet_subscriptions (restaurant_id);

ALTER TABLE outlet_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outlet_subscriptions_staff_read ON outlet_subscriptions;
CREATE POLICY outlet_subscriptions_staff_read ON outlet_subscriptions FOR SELECT
  USING (restaurant_id = app_current_staff_restaurant_id());

-- ===== Delivery pass-through ledger: 3PL dispatch cost, passed through at cost =====
-- No default cost here. The cost is the dispatch adapter's value for each order.
CREATE TABLE IF NOT EXISTS delivery_pass_through_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL UNIQUE CHECK (length(btrim(delivery_id)) > 0),
  provider TEXT NOT NULL CHECK (provider IN ('shadowfax', 'rapido', 'dunzo')),
  cost_inr NUMERIC(10,2) NOT NULL CHECK (cost_inr >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pass_through_restaurant ON delivery_pass_through_costs (restaurant_id);

ALTER TABLE delivery_pass_through_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pass_through_staff_read ON delivery_pass_through_costs;
CREATE POLICY pass_through_staff_read ON delivery_pass_through_costs FOR SELECT
  USING (restaurant_id = app_current_staff_restaurant_id());

-- ===== Grants: food_app reads only (default privileges from 001 are revoked first) =====
REVOKE ALL ON outlet_subscriptions, delivery_pass_through_costs FROM food_app, food_sync;
GRANT SELECT ON outlet_subscriptions, delivery_pass_through_costs TO food_app;
