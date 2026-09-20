#!/bin/sh
set -eu

psql -v ON_ERROR_STOP=1 -v db_password="$POSTGRES_PASSWORD" --username postgres --dbname postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
END $$;
ALTER ROLE authenticator WITH LOGIN PASSWORD :'db_password';
GRANT anon, authenticated, service_role TO authenticator;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
SQL

# Supabase's earlier migrate.sh has already applied every ordered SQL file in
# /docker-entrypoint-initdb.d/migrations. Replaying those files here breaks the
# migrations that intentionally create non-idempotent constraints and policies.
