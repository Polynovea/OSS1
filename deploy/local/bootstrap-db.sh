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

for file in /docker-entrypoint-initdb.d/migrations/[0-9][0-9][0-9][0-9]_*.sql; do
  [ -f "$file" ] || continue
  echo "Applying Polynovea CMS migration: $file"
  psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --file "$file"
done
