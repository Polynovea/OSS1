# Database Migration Discipline

**Status: active as of Phase 0 (2026-09-01).** This document is the source of truth
for how schema changes happen from now on. It supersedes the informal process
that produced `supabase/migration.sql`.

## What changed and why

Until Phase 0, this project had exactly one schema file — `supabase/migration.sql`
— that was hand-run in the Supabase SQL Editor and edited in place as the schema
evolved (e.g. `alter table admin_users add column if not exists module_write_access ...`
was appended directly into the same file rather than tracked as its own change).
An early schema review found two columns the application actively reads and writes
(`blog_posts.cover_image`, `social_posts.checkpoint_metrics`) that were never
added to that file at all — meaning the file stopped being an accurate record of
the live schema at some point, silently.

Per the open-source upgrade plan's engineering rules (no destructive schema
replacement, every schema change versioned, migrations never undocumented
production SQL), this is no longer acceptable once the codebase is meant to
become a reusable, self-hostable platform: a new deployment bootstrapped from
`supabase/migration.sql` alone would come up missing columns the application
depends on.

## The new process

1. **`supabase/migration.sql` is frozen.** It is kept only as a historical
   artifact. Do not edit it again.
2. **`supabase/migrations/` is the source of truth going forward.** Files are
   numbered sequentially: `0001_baseline.sql` (a verbatim snapshot of
   `migration.sql` as it stood at the start of Phase 0), `0002_*.sql`, `0003_*.sql`,
   etc. Each file is a single, reviewable, named change.
3. **Every migration is additive and idempotent where possible.** Prefer
   `add column if not exists`, `create table if not exists`, `create index if
   not exists`. Do not `drop table`/`drop column` as part of a routine change —
   if a column or table genuinely needs to go away, that is a deliberate,
   separately-called-out migration with a stated reason, run only after
   confirming nothing still reads it.
4. **No schema change ships without a migration file**, including changes made
   directly in the Supabase dashboard during development. If you run something
   ad hoc while debugging, write the migration file for it immediately
   afterward — the dashboard change and the committed file must match.
5. **Use the repository migration runner for supported installs and upgrades.**
   It reads `DATABASE_URL` from the process environment or `.env.local`, applies
   numbered migrations in order, and records every successful filename,
   migration ID, and SHA-256 checksum in `polynovea_migration_ledger`.
   ```
   npm run db:migrate
   ```
   Re-running an identical migration is a no-op. A checksum mismatch or an
   existing core schema without ledger provenance fails closed. Back up an
   existing installation before upgrading. Direct database credentials are
   server/operator secrets and must never be exposed to browser code.
6. **`app/api/admin/migrate/route.ts` is not the supported installation or
   upgrade mechanism.** Operators should use `npm run db:migrate`.

## Naming convention

`NNNN_short_description.sql`, four-digit zero-padded sequence number, lowercase
snake_case description. One logical change per file — don't bundle unrelated
table changes together just because they happened in the same coding session.

## Verifying a migration matches production

`0001_baseline.sql` through `0007_workspace_core.sql` were run against
production directly (via `scripts/run-migrations.mjs`) and verified with
real queries on 2026-09-01, during Phase 1 Milestone B. Two real
discrepancies surfaced by that verification, both now resolved by the run
itself:
- **`platforms` did not exist in production at all**, despite being in
  `0001_baseline.sql` and actively used by `app/api/content/platforms*` —
  the table (and its 9 seeded rows) now exists, created by re-running
  `0001` idempotently.
- **`0006_rls_admin_tables.sql`'s two `CREATE POLICY` statements had not
  taken effect** in an earlier manual application (RLS was enabled on
  `admin_users`/`admin_activity_log`, but `pg_policies` was empty) — now
  present, and the file itself was fixed to `DROP POLICY IF EXISTS` first
  (Postgres has no `CREATE POLICY IF NOT EXISTS`), so future re-runs won't
  silently skip or error on this again.

`blog_posts.cover_image` (`text`) and `social_posts.checkpoint_metrics`
(`jsonb`) were confirmed to match `0002`'s assumptions exactly. Going
forward, any new migration should be verified the same way — actual queries
against the real schema, not just "the script exited 0" — before being
considered done.
