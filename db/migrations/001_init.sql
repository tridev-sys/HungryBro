-- 001_init.sql: Plan 01 baseline schema.
-- Adapted from the md section 2 DDL. Fixes applied:
--  1. dining_tables.restaurant_id is typed UUID.
--  2. auth.uid() replaced by app_current_user_id(), which reads app.user_id.
--  3. request.headers session token replaced by current_setting('app.session_token').
--  4. users.restaurant_id added; kds_tickets policy scoped to the caller's restaurant.
--  5. order_refs added; verified_customer_ratings must reference a completed order of the diner.
--  6. restaurant_nodes.rating_aggregate defaults to 0.00 (decision 1).
--  7. mesh_food_auctions.expires_at stays NOW() + 90 seconds (decision 4).
--  8. Roles food_app (RLS enforced), food_sync and food_admin (BYPASSRLS); FORCE RLS on RLS tables.
--  Extra: tabletop_sessions staff access is also scoped to the staff member's restaurant.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app') THEN
    CREATE ROLE food_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_sync') THEN
    CREATE ROLE food_sync NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_admin') THEN
    CREATE ROLE food_admin NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- Session identity helpers (replace Supabase auth.uid() and request headers).
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- Enums
CREATE TYPE user_role AS ENUM ('guest', 'diner', 'restaurant_staff', 'kitchen_lead', 'delivery_agent', 'platform_admin');
CREATE TYPE dietary_classification AS ENUM ('pure_veg', 'jain', 'halal', 'non_veg', 'vegan', 'egg');
CREATE TYPE session_status AS ENUM ('active', 'payment_pending', 'closed', 'abandoned');
CREATE TYPE auction_status AS ENUM ('open', 'evaluating', 'awarded', 'fulfilled', 'expired', 'cancelled');
CREATE TYPE ticket_status AS ENUM ('queued', 'in_prep', 'ready', 'served', 'voided');

-- Restaurant nodes (created before users so users can reference it)
CREATE TABLE restaurant_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    fssai_license_number VARCHAR(14) UNIQUE NOT NULL,
    gstin VARCHAR(15) NOT NULL,
    pos_provider VARCHAR(32) NOT NULL DEFAULT 'direct',
    pos_credentials JSONB NOT NULL DEFAULT '{}'::jsonb,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    operational_floor_margin NUMERIC(4, 2) DEFAULT 0.05 NOT NULL,
    active_kds_load NUMERIC(3, 2) DEFAULT 0.00 NOT NULL,
    rating_aggregate NUMERIC(3, 2) DEFAULT 0.00 NOT NULL,
    total_verified_reviews INT DEFAULT 0 NOT NULL,
    is_accepting_delivery BOOLEAN DEFAULT TRUE NOT NULL,
    is_accepting_dinein BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_restaurant_nodes_location ON restaurant_nodes USING GIST(location);

-- 1. Users & profiles (phone-first +91 identity)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(15) UNIQUE NOT NULL,
    full_name VARCHAR(100),
    role user_role DEFAULT 'diner' NOT NULL,
    restaurant_id UUID REFERENCES restaurant_nodes(id),
    default_vpa VARCHAR(100),
    saved_gstin VARCHAR(15),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 2. Menus & categories
CREATE TABLE menu_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(100) NOT NULL,
    station VARCHAR(50) DEFAULT 'General' NOT NULL,
    display_order INT DEFAULT 0 NOT NULL
);

CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES menu_categories(id) ON DELETE SET NULL,
    pos_item_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    base_price NUMERIC(10, 2) NOT NULL,
    gst_rate NUMERIC(4, 2) DEFAULT 0.05 NOT NULL,
    dietary dietary_classification NOT NULL,
    spice_level INT CHECK (spice_level BETWEEN 0 AND 3) DEFAULT 1 NOT NULL,
    is_in_stock BOOLEAN DEFAULT TRUE NOT NULL,
    preparation_time_minutes INT DEFAULT 15 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(restaurant_id, pos_item_code)
);

-- 3. Tables, sessions & KDS
CREATE TABLE dining_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    table_number VARCHAR(16) NOT NULL,
    seating_capacity INT DEFAULT 4 NOT NULL,
    current_signature_token VARCHAR(64) NOT NULL,
    UNIQUE(restaurant_id, table_number)
);

CREATE TABLE tabletop_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_id UUID REFERENCES dining_tables(id) ON DELETE CASCADE NOT NULL,
    session_token VARCHAR(64) UNIQUE NOT NULL,
    status session_status DEFAULT 'active' NOT NULL,
    subtotal NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    tax_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    total_amount NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    bill_split_spec JSONB DEFAULT '{"strategy": "EQUAL", "participants": []}'::jsonb NOT NULL,
    opened_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    closed_at TIMESTAMPTZ
);

CREATE TABLE kds_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES tabletop_sessions(id) ON DELETE SET NULL,
    order_modality VARCHAR(16) NOT NULL,
    station VARCHAR(50) NOT NULL,
    ticket_number SERIAL,
    status ticket_status DEFAULT 'queued' NOT NULL,
    items JSONB NOT NULL,
    fired_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    bumped_at TIMESTAMPTZ
);

-- 4. Order references (anchor for verified ratings)
CREATE TABLE order_refs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES restaurant_nodes(id),
    diner_user_id UUID NOT NULL REFERENCES users(id),
    session_id UUID NULL,
    status TEXT NOT NULL CHECK (status IN ('open', 'completed')),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 5. Reverse mesh delivery auctions
CREATE TABLE mesh_food_auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    diner_user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    voice_query_transcript TEXT NOT NULL,
    raw_intent_payload JSONB NOT NULL,
    budget_ceiling_inr NUMERIC(10, 2) NOT NULL,
    max_sla_minutes INT NOT NULL,
    delivery_location GEOGRAPHY(Point, 4326) NOT NULL,
    status auction_status DEFAULT 'open' NOT NULL,
    awarded_restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE SET NULL,
    awarded_bid_amount NUMERIC(10, 2),
    assigned_3pl_provider VARCHAR(64),
    logistics_tracking_ref VARCHAR(128),
    handshake_token VARCHAR(64) NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 seconds'),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX idx_mesh_auctions_status_expires ON mesh_food_auctions(status, expires_at);

CREATE TABLE auction_counter_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID REFERENCES mesh_food_auctions(id) ON DELETE CASCADE NOT NULL,
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    offered_price_inr NUMERIC(10, 2) NOT NULL,
    estimated_prep_minutes INT NOT NULL,
    bundle_contents JSONB NOT NULL,
    is_accepted BOOLEAN DEFAULT FALSE NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 6. Verified ratings (purchase-gated)
CREATE TABLE verified_customer_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID REFERENCES restaurant_nodes(id) ON DELETE CASCADE NOT NULL,
    diner_user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    order_ref_id UUID NOT NULL REFERENCES order_refs(id),
    rating_score NUMERIC(2, 1) CHECK (rating_score BETWEEN 1.0 AND 5.0) NOT NULL,
    review_tags TEXT[],
    feedback_text TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(restaurant_id, order_ref_id)
);

-- Row-Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabletop_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kds_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mesh_food_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE verified_customer_ratings ENABLE ROW LEVEL SECURITY;

ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE restaurant_nodes FORCE ROW LEVEL SECURITY;
ALTER TABLE menu_items FORCE ROW LEVEL SECURITY;
ALTER TABLE tabletop_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE kds_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE order_refs FORCE ROW LEVEL SECURITY;
ALTER TABLE mesh_food_auctions FORCE ROW LEVEL SECURITY;
ALTER TABLE verified_customer_ratings FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self_manage ON users FOR ALL
  USING (id = app_current_user_id())
  WITH CHECK (id = app_current_user_id());

CREATE POLICY restaurant_nodes_public_read ON restaurant_nodes FOR SELECT USING (TRUE);
CREATE POLICY menu_items_read_all ON menu_items FOR SELECT USING (TRUE);

CREATE POLICY tabletop_sessions_diner_or_staff ON tabletop_sessions FOR ALL
  USING (
    session_token = NULLIF(current_setting('app.session_token', true), '')
    OR EXISTS (
      SELECT 1 FROM dining_tables dt
      JOIN users u ON u.restaurant_id = dt.restaurant_id
      WHERE dt.id = tabletop_sessions.table_id
        AND u.id = app_current_user_id()
        AND u.role IN ('restaurant_staff', 'kitchen_lead')
    )
  );

CREATE POLICY kds_tickets_staff_isolation ON kds_tickets FOR ALL
  USING (
    restaurant_id = (
      SELECT u.restaurant_id FROM users u
      WHERE u.id = app_current_user_id()
        AND u.role IN ('restaurant_staff', 'kitchen_lead', 'platform_admin')
    )
  )
  WITH CHECK (
    restaurant_id = (
      SELECT u.restaurant_id FROM users u
      WHERE u.id = app_current_user_id()
        AND u.role IN ('restaurant_staff', 'kitchen_lead', 'platform_admin')
    )
  );

CREATE POLICY order_refs_diner_read ON order_refs FOR SELECT
  USING (diner_user_id = app_current_user_id());

CREATE POLICY mesh_auctions_diner_read ON mesh_food_auctions FOR SELECT
  USING (diner_user_id = app_current_user_id());

CREATE POLICY ratings_public_read ON verified_customer_ratings FOR SELECT USING (TRUE);

CREATE POLICY ratings_insert_verified ON verified_customer_ratings FOR INSERT
  WITH CHECK (
    diner_user_id = app_current_user_id()
    AND EXISTS (
      SELECT 1 FROM order_refs o
      WHERE o.id = order_ref_id
        AND o.status = 'completed'
        AND o.diner_user_id = app_current_user_id()
        AND o.restaurant_id = verified_customer_ratings.restaurant_id
    )
  );

-- Table and sequence privileges for runtime and sync roles (existing and future objects)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO food_app, food_sync, food_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO food_app, food_sync, food_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO food_app, food_sync, food_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO food_app, food_sync, food_admin;
