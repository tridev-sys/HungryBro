-- 005_integrations.sql (Plan 06). Policies only; no new tables, no SECURITY DEFINER function.
-- food_sync (BYPASSRLS, created NOLOGIN in 001_init.sql) needs no policy here.
-- 001_init.sql already enables RLS on menu_items and restaurant_nodes and provides
-- menu_items_read_all and restaurant_nodes_public_read, so those are not repeated here.
ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_categories_public_read ON menu_categories FOR SELECT USING (true);

CREATE POLICY menu_items_integration_write ON menu_items FOR ALL
  USING (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid)
  WITH CHECK (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
CREATE POLICY menu_categories_integration_write ON menu_categories FOR ALL
  USING (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid)
  WITH CHECK (restaurant_id = NULLIF(current_setting('app.integration_restaurant_id', true), '')::uuid);
