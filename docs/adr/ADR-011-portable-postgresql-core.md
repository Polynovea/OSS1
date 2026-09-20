# ADR-011: Portable PostgreSQL Core

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1 (pre-Milestone-B cleanup)

## Context

The open-source direction needs a precise portability contract, not a vague
"cloud agnostic" goal. Promising compatibility with every database engine
(MySQL, SQL Server, Oracle, MongoDB, DynamoDB, Cosmos DB, ...) would explode
scope for no real benefit to Polynovea's own use case. Promising nothing
leaves the schema free to accumulate Supabase-specific assumptions that
would be expensive to undo later.

## Decision

The portability contract is: **PostgreSQL-compatible across providers**,
specifically:
- Supabase PostgreSQL (Polynovea's reference deployment, see `ADR-010`)
- AWS RDS / Aurora PostgreSQL
- Azure Database for PostgreSQL
- Vanilla/self-hosted PostgreSQL

Not MySQL, SQL Server, Oracle, MongoDB, DynamoDB, Cosmos DB, or any other
non-Postgres engine. This is the "OSS V1" contract; broadening it later is
a decision for whenever (if ever) real demand appears, not something to
design around speculatively now.

The canonical database model (starting with the Workspace/Entity tables in
Milestone B, and every table after) is built primarily from standard
PostgreSQL capabilities that behave identically across all four targets
above: `UUID`, `TEXT`, `BOOLEAN`, `INTEGER`/`BIGINT`, `NUMERIC`, `DATE`,
`TIMESTAMPTZ`, `JSONB`, `ARRAY` where justified, `FOREIGN KEY`, `UNIQUE`,
`CHECK`, `INDEX`, transactions, CTEs, views, and PostgreSQL's built-in Row
Level Security. No core migration may depend on a Postgres extension that
isn't available by default across all four targets, without an explicit,
documented fallback.

## Consequences

- Every migration added from Milestone B onward gets reviewed against this
  list before being written, not after.
- This does **not** mean building AWS/Azure deployment scripts, multiple
  auth-provider integrations, or multi-cloud CI in Phase 1 — see
  `ADR-012` for where the actual Supabase-specific pieces (RLS policies
  bridging `auth.jwt()`, the service-role client, Supabase's SQL Editor
  workflow) live instead of inside the "core."
- A future "Advanced Schema Studio" compatibility badge (showing whether a
  given model uses anything provider-specific) is designed toward, but not
  built, in Phase 1 — the schema metadata just needs to not preclude it
  later.
