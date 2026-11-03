-- 002_mesh_auction.sql (Plan 02, delivery mesh)
-- Adds row-level security policies for the mesh auction tables. No new tables:
-- 001_init.sql already creates mesh_food_auctions and auction_counter_bids and
-- enables RLS on mesh_food_auctions. This migration enables and forces RLS on
-- auction_counter_bids and adds the insert/update/read policies.

CREATE POLICY mesh_auctions_diner_insert ON mesh_food_auctions FOR INSERT
  WITH CHECK (diner_user_id = app_current_user_id());
CREATE POLICY mesh_auctions_diner_update ON mesh_food_auctions FOR UPDATE
  USING (diner_user_id = app_current_user_id())
  WITH CHECK (diner_user_id = app_current_user_id());
CREATE POLICY mesh_auctions_staff_open_read ON mesh_food_auctions FOR SELECT
  USING (status = 'open' AND EXISTS (
    SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead')));

ALTER TABLE auction_counter_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_counter_bids FORCE ROW LEVEL SECURITY;

CREATE POLICY counter_bids_staff_insert ON auction_counter_bids FOR INSERT
  WITH CHECK (
    restaurant_id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead'))
    AND EXISTS (SELECT 1 FROM mesh_food_auctions a
      WHERE a.id = auction_id AND a.status = 'open'
        AND now() < a.created_at + INTERVAL '18 seconds'));
CREATE POLICY counter_bids_diner_read ON auction_counter_bids FOR SELECT
  USING (EXISTS (SELECT 1 FROM mesh_food_auctions a
    WHERE a.id = auction_id AND a.diner_user_id = app_current_user_id()));
CREATE POLICY counter_bids_staff_read_own ON auction_counter_bids FOR SELECT
  USING (restaurant_id = (SELECT u.restaurant_id FROM users u WHERE u.id = app_current_user_id())
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = app_current_user_id()
      AND u.role IN ('restaurant_staff', 'kitchen_lead')));
