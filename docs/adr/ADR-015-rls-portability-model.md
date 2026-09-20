# ADR-015: RLS Portability Model

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1 (pre-Milestone-B cleanup)

## Context

`ADR-002` establishes that RLS is now a real security boundary for
Polynovea's Supabase deployment. This ADR addresses a narrower but
important follow-on question: PostgreSQL's Row Level Security *mechanism*
(`ENABLE ROW LEVEL SECURITY`, `CREATE POLICY ... USING (...) WITH CHECK
(...)`) is standard, portable Postgres — but the actual *expressions*
inside a Supabase RLS policy commonly call `auth.uid()` or
`auth.jwt() ->> 'email'`, which are Supabase-specific SQL functions that
inject the authenticated request's JWT claims. An AWS RDS or Azure
PostgreSQL deployment has no such functions available, because there is no
Supabase Auth sitting in front of them.

The Phase 1 Milestone A migration (`0006_rls_admin_tables.sql`) already
writes a policy using `auth.jwt() ->> 'email'` directly — correct and
necessary for Polynovea's actual Supabase deployment today, but worth
being explicit about what would need to change for a different deployment,
rather than leaving that as an implicit, undocumented assumption.

## Decision

- **The permission semantics are defined generically, independent of any
  auth provider**: Actor, Workspace, Membership, Role, Permission,
  Ownership. This vocabulary (formalized starting in Milestone B's
  `lib/platform/actor.ts` and `lib/platform/permissions.ts`) is what the
  application's own permission checks (`requireAdminRequest` today,
  `hasPermission()` from Milestone B onward) operate on — never a
  Supabase-specific concept directly.
- **Supabase's `auth.*` helpers are confined to Supabase-specific RLS
  policy files**, organized separately from the portable core migrations
  per `ADR-011`/`ADR-012` (e.g., under a `providers/supabase/` migration
  path once that reorganization happens, per the Phase 1 plan's Milestone
  F). A different deployment would write different policy expressions
  against the same core tables — e.g., an AWS deployment fronted by a
  Next.js API layer doing all authorization server-side might reasonably
  skip client-facing RLS policies entirely and rely solely on the
  server-authorization + service-role path (`ADR-005`'s target shape),
  since there'd be no direct-browser-to-Postgres path to defend against in
  that topology.
- **This is a documentation and organizational decision for Phase 1, not
  an implementation of multiple RLS variants.** Only the Supabase variant
  is written and shipped now, matching `ADR-010`'s decision that Supabase
  is the reference deployment. The point of this ADR is to make sure that
  when a second provider is eventually built, whoever does it knows
  exactly which files to look at (`providers/supabase/*.sql`) and doesn't
  need to reverse-engineer which parts of the RLS design are portable
  concept vs. Supabase-specific syntax.

## Consequences

- The one already-written Supabase-specific policy
  (`0006_rls_admin_tables.sql`'s `auth.jwt() ->> 'email'` check) is
  correct as-is and does not need to change — this ADR documents why it's
  acceptable for it to be Supabase-specific, not a requirement to rewrite
  it generically.
- Future RLS policies for the workspace/entity/schema/entry tables
  (Milestones B, C, E) get written the same way: policy *logic* expressed
  in terms of Actor/Workspace/Role/Permission, policy *implementation*
  using whatever the current deployment (Supabase) provides to evaluate
  that logic at the database layer.
