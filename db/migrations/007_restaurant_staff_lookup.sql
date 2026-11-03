-- 007_restaurant_staff_lookup.sql: narrow staff lookup for sandbox kitchens (Plan 02, F4).
--
-- users carries only users_self_manage, so food_app sees its own row and no other user.
-- runSandboxKitchens needs the staff user id of each candidate restaurant to submit a bid
-- on its behalf. app_restaurant_staff_ids() is a SECURITY DEFINER function owned by
-- food_admin (BYPASSRLS). It returns the user ids with role restaurant_staff or kitchen_lead
-- for one restaurant, and nothing else. No other user columns or roles are exposed.

CREATE FUNCTION app_restaurant_staff_ids(restaurant_id UUID) RETURNS SETOF UUID
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$
    SELECT u.id FROM users u
    WHERE u.restaurant_id = $1 AND u.role IN ('restaurant_staff', 'kitchen_lead')
  $$;

REVOKE ALL ON FUNCTION app_restaurant_staff_ids(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_restaurant_staff_ids(UUID) TO food_app;

-- food_app_login is created by db/bootstrap/002_app_login.sql, which may run after migrations
-- on a fresh database. It inherits EXECUTE through membership in food_app either way.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app_login') THEN
    GRANT EXECUTE ON FUNCTION app_restaurant_staff_ids(UUID) TO food_app_login;
  END IF;
END $$;
