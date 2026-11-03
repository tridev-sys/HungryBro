-- 006_pos_credentials_table.sql: move POS credentials out of restaurant_nodes.
--
-- restaurant_nodes carries the policy restaurant_nodes_public_read (USING TRUE), so every
-- role could read every column, including pos_credentials. The ciphertext now lives in its
-- own table, which only food_sync (nightly menu sync) and food_admin (seeds, fixtures) can
-- read or write. The POS webhook needs the ciphertext to verify signatures, so it reads it
-- through app_pos_credentials_for_restaurant(), a SECURITY DEFINER function owned by
-- food_admin that returns one restaurant's ciphertext and nothing else.
--
-- Encryption is unchanged: the column holds the AES-256-GCM envelope from lib/pos/credentials.ts.

CREATE TABLE restaurant_pos_credentials (
  restaurant_id UUID PRIMARY KEY REFERENCES restaurant_nodes(id) ON DELETE CASCADE,
  pos_provider VARCHAR(32) NOT NULL,
  ciphertext JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Copy existing credentials. Rows still holding the default '{}' carry no credentials.
INSERT INTO restaurant_pos_credentials (restaurant_id, pos_provider, ciphertext)
SELECT id, pos_provider, pos_credentials
FROM restaurant_nodes
WHERE pos_credentials <> '{}'::jsonb;

ALTER TABLE restaurant_pos_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_pos_credentials FORCE ROW LEVEL SECURITY;

-- 001_init.sql and the default privileges grant every table to food_app; remove that for this table.
REVOKE ALL ON restaurant_pos_credentials FROM PUBLIC, food_app;
GRANT SELECT, INSERT, UPDATE ON restaurant_pos_credentials TO food_sync, food_admin;

CREATE FUNCTION app_pos_credentials_for_restaurant(p_restaurant_id UUID) RETURNS JSONB
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT c.ciphertext FROM restaurant_pos_credentials c WHERE c.restaurant_id = p_restaurant_id $$;

REVOKE ALL ON FUNCTION app_pos_credentials_for_restaurant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_pos_credentials_for_restaurant(UUID) TO food_app;

ALTER TABLE restaurant_nodes DROP COLUMN pos_credentials;
