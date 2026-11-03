-- 002_app_login.sql: the login role the app container uses at runtime (APP_DATABASE_URL).
--
-- Why: the database service's POSTGRES_USER (`food`) is a superuser, and superusers bypass
-- row-level security. The app must connect as food_app_login, which is not a superuser and
-- does not bypass RLS. It inherits the food_app role, which migrations create.
--
-- Run ONCE by the instance owner, after migrations 001 to 006 are applied, with the superuser
-- login. The file is idempotent: re-running it creates nothing new and rotates the password to
-- the value supplied. Pass the password as a psql variable so it never appears in this file or
-- in shell history. Use a URL-safe password (for example `openssl rand -hex 32`), because it is
-- embedded in APP_DATABASE_URL.
--
-- Owner command (run on the EC2 host, in the repository folder; APP_DB_PASSWORD is exported
-- from the owner's .env, never typed on the command line):
--   docker exec -i food-os-db psql -U food -d food_os -v ON_ERROR_STOP=1 \
--     -v app_password="$APP_DB_PASSWORD" < db/bootstrap/002_app_login.sql
--
-- Then set the same APP_DB_PASSWORD in .env and restart the app container.

\set ON_ERROR_STOP on

\if :{?app_password}
\else
  -- Fails the run (ON_ERROR_STOP) with a message that names the missing variable.
  DO $$ BEGIN RAISE EXCEPTION 'app_password is not set: pass -v app_password="$APP_DB_PASSWORD"'; END $$;
\endif

SELECT (NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_app_login'))::int AS need_role \gset
\if :need_role
  CREATE ROLE food_app_login LOGIN PASSWORD :'app_password';
\endif

-- Always applied, so re-running keeps the role at the expected attributes and password.
ALTER ROLE food_app_login WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'app_password';
GRANT food_app TO food_app_login;
