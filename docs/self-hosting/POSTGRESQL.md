# PostgreSQL and self-hosting

## Portability contract

Polynovea CMS has a PostgreSQL-centred schema and worker core. Migrations use PostgreSQL DDL/PLpgSQL and require PostgreSQL 15+ with `pg_trgm`.

The current web application uses `@supabase/supabase-js` query/RPC semantics and Supabase/GoTrue authentication APIs. Therefore OSS V1 supports a **Supabase/PostgREST-compatible application runtime**, not a bare PostgreSQL server by itself.

Supported components:

| Component | OSS V1 requirement |
| --- | --- |
| Database | PostgreSQL 15+ in a Supabase-compatible stack |
| Data API | PostgREST-compatible endpoint |
| Authentication | GoTrue-compatible Supabase Auth |
| Application | Node.js 20+ Next.js server |
| Jobs | Persistent `npm run worker:delivery` process |
| Media | Optional S3-compatible storage; R2 is the supplied reference adapter |

A managed Supabase project is the simplest reference backend. Self-hosted Supabase-compatible infrastructure is also valid when it provides the same required API/auth semantics.

Docker/Compose is **optional packaging only**. The CMS does not require Docker as an installation or release gate.

## Installation

1. Install Node.js 20+.
2. Provision the supported Supabase-compatible backend.
3. Copy `.env.example` to `.env.local`.
4. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` and `CMS_CONFIG_ENCRYPTION_KEY`.
5. Enable `pg_trgm` in PostgreSQL.
6. Run `npm ci`.
7. Against a fresh database, run `npm run db:migrate`.
8. Create the first user identity in the configured auth service.
9. Run `npm run bootstrap:admin -- --email=owner@example.com` to bind that identity to the auditable CMS master/owner profile.
10. Start the app with `npm run dev`, or `npm run build && npm start`.
11. Run `npm run worker:delivery` persistently when enabling durable delivery/processing features.

The first-admin bootstrap is deliberately server-only. Browser clients cannot create their own `admin_users` records or promote themselves to `master`.

## Optional packaged local profile

`deploy/local/` and `scripts/local-runtime.mjs` remain available for operators who prefer a containerized Supabase-compatible local stack. They are convenience tooling, not the canonical V1 installation path and not a release blocker.

## Existing installations and upgrades

Back up first, apply only the required ordered migrations, and rehearse restore before production upgrades. The numbered migration files are immutable once applied to a shared or production database. Do not edit old migrations to change deployed state; add a new migration instead.

For a fresh database, `npm run db:migrate` applies all numbered migrations in order. For an existing database, review the currently applied migration set and apply only pending migrations with `node scripts/run-migrations.mjs <file1.sql> [file2.sql ...]`.

The worker uses a direct `DATABASE_URL`, `CMS_CONFIG_ENCRYPTION_KEY`, and credentials required by enabled publication, analytics or storage adapters. The Next.js application also requires the public Supabase URL/anon key plus the server-only service-role key.

## Authentication and permissions

GoTrue authenticates identities. Polynovea CMS then maps the authenticated email to an active `admin_users` profile and resolves workspace membership, roles and permission keys server-side.

The `master` role is a normal auditable profile role. It is **not** granted by a hardcoded email or client-side self-provisioning bypass. Use `npm run bootstrap:admin` for the first owner, then use the Access administration surface for subsequent users.

RLS is defence in depth; backend actions additionally enforce actor/workspace scope. The service-role credential is server-only.

## Backup and restore

Use provider-native PostgreSQL backups and/or `pg_dump`, retain backups outside the application host, encrypt them at rest, and rehearse restore into an isolated database.

Treat restore-over-existing, destructive migration and credential replacement as high-risk operations. Never copy production secrets into examples, logs, issue reports or test fixtures.

## Troubleshooting

- **“Supabase is not configured”**: set both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; there is no production fallback.
- **Service routes fail with a service-role error**: set `SUPABASE_SERVICE_ROLE_KEY` only in the server environment.
- **Authenticated user gets Access denied**: ensure the identity has an active `admin_users` row and workspace membership. For the first owner, run `npm run bootstrap:admin`.
- **Jobs remain queued**: ensure the persistent worker is running and `DATABASE_URL` can reach PostgreSQL.
- **A migration fails**: stop, inspect the failing migration and database state, restore if required, and do not skip/edit already-applied migrations.
- **Media fails**: verify the configured bucket, endpoint, credentials and public/signed URL policy.

Generic PostgreSQL and non-Supabase auth adapters remain future work. Until they exist and are certified, describe the CMS as PostgreSQL-centred and Supabase-compatible—not as turnkey direct RDS/Aurora/Azure PostgreSQL runtime support.
