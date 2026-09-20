# ADR-010: Reference Deployment Uses Supabase

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1 (pre-Milestone-B cleanup)

## Context

An earlier framing of the open-source direction risked being read as "move
Polynovea off Supabase, or treat it as temporary infrastructure to be
abstracted away." That is not the intent. Polynovea's actual, ongoing
production deployment is Supabase PostgreSQL + Supabase Auth + Cloudflare
R2 + Vercel, and it works well for the current scale and team.

## Decision

Supabase remains Polynovea's reference deployment, permanently, not as an
interim state. It is treated as **a first-class supported PostgreSQL
deployment** — not "temporary infrastructure we are trying to remove."
Concretely:
- The production application continues using Supabase JS, Supabase Auth,
  the service-role client, and Supabase's SQL Editor for migrations, exactly
  as it does today.
- Nothing in Phase 1 (or beyond) may make Polynovea's own deployment worse
  for the sake of hypothetical portability — e.g., stripping out RLS in
  favor of a fully abstracted permission layer, or routing every read
  through an extra indirection that Supabase's PostgREST already handles
  well, would be a regression, not progress.
- Open-source portability is a property of the **canonical schema and core
  business logic**, not a requirement that Polynovea itself run on anything
  other than Supabase.

See `docs/upgrade/CURRENT_ARCHITECTURE.md` for the concrete reference
deployment table this ADR is describing, and `ADR-011` /`ADR-012` for how
portability is achieved without contradicting this decision.

## Consequences

- Future ADRs and milestones must be read against this constraint: "does
  this change make Polynovea's actual deployment worse?" is a valid
  objection to any proposed abstraction, on its own.
- The distinction to hold in mind for every future decision: *Polynovea uses
  Supabase because it is useful to us. Polynovea CMS does not require
  Supabase in order to exist.* Both statements are true simultaneously.
