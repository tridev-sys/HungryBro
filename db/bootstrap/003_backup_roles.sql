-- 003_backup_roles.sql: ops roles for backup-pg.sh and restore-check.sh (plan 07, Task 6).
-- NOT a schema migration. Run ONCE by the instance owner, as the superuser, idempotent.
--
-- Why each step exists:
--   food_backup: read-only login for pg_dump and row counts (pg_read_all_data, no write grants).
--   food_admin:  gets a LOGIN so restore-check can restore as the admin role (migrations create it NOLOGIN).
--                It also needs CREATEDB to create the scratch database.
--   food_os_restore_template: a database that already has the PostGIS and uuid/crypto extensions.
--                Only a superuser can install PostGIS, so the superuser does it here once, and the
--                restore check then creates its scratch database from this template as food_admin.
--
-- Owner command (on the EC2 host, from the repository folder; passwords come from .env, never typed):
--   docker exec -i food-os-db psql -U food -d postgres -v ON_ERROR_STOP=1 \
--     -v backup_pw="$BACKUP_DB_PASSWORD" -v admin_pw="$FOOD_ADMIN_DB_PASSWORD" < db/bootstrap/003_backup_roles.sql
--
-- Re-running changes nothing except re-setting the same passwords.

\set ON_ERROR_STOP on

\if :{?backup_pw}
\else
  DO $$ BEGIN RAISE EXCEPTION 'backup_pw is not set: pass -v backup_pw="$BACKUP_DB_PASSWORD"'; END $$;
\endif
\if :{?admin_pw}
\else
  DO $$ BEGIN RAISE EXCEPTION 'admin_pw is not set: pass -v admin_pw="$FOOD_ADMIN_DB_PASSWORD"'; END $$;
\endif

SELECT format('CREATE ROLE food_backup LOGIN PASSWORD %L', :'backup_pw')
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'food_backup') \gexec
ALTER ROLE food_backup LOGIN NOSUPERUSER BYPASSRLS PASSWORD :'backup_pw';
-- BYPASSRLS: pg_dump and the row counts must see every row. pg_read_all_data does not bypass RLS.
-- The role still has no write grants and is not a superuser.
GRANT pg_read_all_data TO food_backup;

ALTER ROLE food_admin LOGIN NOSUPERUSER PASSWORD :'admin_pw';
ALTER ROLE food_admin CREATEDB;

SELECT 'CREATE DATABASE food_os_restore_template OWNER food_admin'
  WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'food_os_restore_template') \gexec

\c food_os_restore_template
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- The postgis image also installs these; food_os has them, so the dump lists them.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;
