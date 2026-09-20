# ADR-002: Supabase RLS Security Model

**Status:** Accepted; identity-specific bootstrap portion superseded by OSS V1 hardening
**Date:** 2026-09-01
**Phase:** 1, Milestone A

## 2026-09-13 amendment

The original Milestone A implementation used a narrowly-scoped, identity-specific
client bootstrap policy for the initial master account. That transitional path is
no longer part of the OSS V1 runtime.

Migration `0064_remove_identity_specific_master_bootstrap.sql` removes those
client `INSERT`/`UPDATE` policies. The first administrator is now provisioned by
the server-only `npm run bootstrap:admin` command after the auth identity exists.
Every administrator, including the initial master/owner, requires an auditable
`admin_users` row plus workspace membership. The default-deny RLS decision in
this ADR remains current; only the historical bootstrap exception is superseded.

## Context

Phase 0 found that every Supabase table in this project has Row Level
Security explicitly disabled (`alter table ... disable row level security`
in `supabase/migration.sql`), while the browser authenticates to Supabase
using the public anon key (`lib/supabase.ts`). The anon key is meant to be
public — it ships in every client bundle by design — but with RLS off, that
key alone grants direct read/write access to every table through Supabase's
REST API, completely bypassing the application's `requireAdminRequest`
permission checks. Section 1.3 of the Phase 1 brief calls this out
explicitly: the anon key is not the problem; "browser-accessible Supabase
API + table privileges + missing/insufficient RLS" together are.

Before deciding how to fix this, we needed to know exactly what would break.
A full-repo grep for every `supabase.from(...)` call site found something
important: **there is exactly one place in the entire codebase where the
browser calls Supabase directly** —
`lib/admin/useAdminAccess.ts:50`, a client-side `admin_users` upsert that
self-provisions the hardcoded master account's own row on first login,
already gated in application code to only fire for that one email and
already wrapped in a try/catch that treats failure as non-fatal. Every
other read and write in the app goes through a Next.js API route running
server-side, using either the anon client (routes intentionally public,
e.g. `GET /api/content/blog-posts`, consumed by the public website) or the
service-role client (everything gated by `requireAdminRequest`).

This matters because Supabase's `service_role` Postgres role has
`BYPASSRLS` by default. Enabling RLS on the anon/authenticated roles has
zero effect on anything that goes through an API route with the
service-role client — which is nearly everything in this app.

## Decision

1. **Enable RLS on all 10 existing tables**, with a default-deny posture
   (no policy = deny, for every role except the table owner and
   `service_role`).
2. **One exception**: `admin_users` gets a narrow `INSERT`/`UPDATE` policy
   permitting the self-upsert described above, scoped to the exact
   hardcoded master email (matching `lib/admin/constants.ts`'s
   `MASTER_EMAIL`), not a generic "any authenticated user can upsert their
   own row" rule. A generic rule would let any authenticated Supabase user
   create an `admin_users` row for themselves with an arbitrary `role`
   (including `'master'`) and arbitrary `module_access`, since RLS
   controls row *visibility*, not which column values are permitted —
   scoping tightly to the one email the application code actually uses for
   this path avoids that privilege-escalation route.
3. **Roll out in four stages, not one migration**, per the brief's explicit
   instruction not to enable RLS across all production tables at once
   without tests: dead tables first (zero risk), then blog/metrics, then
   Content Tracking, then the admin tables last (highest consequence). Each
   stage ships with a manual verification checklist since this environment
   has no way to execute or test migrations against a real Postgres
   instance directly (see the Phase 1 plan's stated constraint) — a human
   with Supabase dashboard access runs and confirms each stage before the
   next one is written.
4. **Do not touch the service-role/API-route architecture.** The existing
   `requireAdminRequest` chain remains the primary authorization boundary
   for everything the admin panel does; RLS here is closing the *bypass*
   route (direct REST calls with the anon key), not replacing that chain.
   This matches the brief's target shape (§5): server authorization →
   permission checks → database → RLS as defense-in-depth, plus a separate,
   narrower RLS-only path for the one legitimate direct-client operation.

## Consequences

- **No functional regression expected** for any existing feature, because
  every write/read path except the one described above is already
  service-role-mediated and therefore RLS-invisible. This was verified by
  exhaustive grep, not assumption, before writing any policy.
- **Residual technical debt, tracked explicitly, not hidden:** the
  `admin_users` policy still hardcodes the master email — the same
  hardcoded-identity smell Phase 0 flagged in application code, now also
  present in one SQL policy. This is intentional (the alternative, a
  generic self-upsert policy, is a privilege-escalation risk, see above) and
  should be revisited once Phase 1 Milestone B's workspace/actor model
  provides a real bootstrap mechanism (e.g., first authenticated user in an
  empty workspace becomes Owner) rather than a hardcoded email match.
- **This ADR does not address**: RLS policies for the new workspace/entity/
  schema/content-entry tables introduced in later Phase 1 milestones — those
  get their own RLS design as part of each milestone's migration, informed
  by the same "check what actually calls Supabase directly" method used
  here, not assumed by analogy.
- **Verification requires production/dashboard access this environment
  doesn't have.** Each migration ships with a curl-based and UI-based manual
  checklist; there is no automated test proving the RLS policies behave
  correctly against a live Postgres instance, only that the application
  code paths using the service-role client are unaffected (which unit tests
  *can* prove, and do, for the parts that don't require a live database).

## Alternatives considered

- **Leave RLS off, rely solely on the anon key being "hard to guess" or on
  obscurity.** Rejected outright — the anon key is meant to be public and
  is already visible in the client bundle; this was the actual
  vulnerability Phase 0 found, not a hypothetical.
- **Generic self-service RLS policies for all tables** (e.g., "authenticated
  users can read rows in their workspace"), skipping the deny-all-with-one-
  exception approach. Rejected for Phase 1: there is no workspace concept
  yet on these 10 tables (that's Milestone B), and no existing code path
  needs anything more permissive than deny-all today. Building generic
  workspace-scoped policies now, before `workspace_id` exists on these
  tables, would mean rewriting them again in Milestone B anyway.
- **Enable RLS on all 10 tables in a single migration.** Rejected per the
  brief's explicit instruction; staged rollout with per-stage verification
  is required given no automated test coverage against a live database is
  possible in this environment.
