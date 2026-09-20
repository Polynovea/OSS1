# Reference Deployment

**Date:** 2026-09-01. This is the single source of truth for "what
Polynovea actually runs on" — referenced by ADRs and other docs instead of
each restating it.

## Polynovea's production/reference deployment

| Layer | Provider | Status |
|---|---|---|
| Hosting / API | Vercel + Next.js | Active |
| Authentication | Supabase Auth | Active |
| Primary database | Supabase PostgreSQL | Active — Polynovea's reference deployment |
| Blob / media storage | Cloudflare R2 (via the S3-compatible API) | Active — Polynovea's actual and intended storage backend |
| Analytics | Google Analytics 4 | Active |
| Legacy: AWS RDS venue lookup | — | **Decommissioned and removed** (2026-09-01) |
| Legacy: AWS S3 | — | **Decommissioned** — R2 is the real backend; the AWS S3 SDK is used only because R2 exposes an S3-compatible interface, not because AWS S3 is in use |

## The distinction this document exists to make

Polynovea uses Supabase because it is useful — not as a temporary
placeholder to be migrated away from. Supabase (Postgres + Auth) and
Cloudflare R2 are the **reference implementation**, and stay that way. The
open-source direction keeps the canonical schema and business logic ready
for future adapters; it does not claim that the current application can
directly run against RDS/Aurora, Azure Database for PostgreSQL, or a bare
self-hosted PostgreSQL server.

Two statements that both have to stay true:
- **Polynovea uses Supabase because it is useful to us.**
- **The current supported application runtime requires Supabase/PostgREST- and
  GoTrue-compatible services; provider-neutral runtime support is a target.**

Concretely, this means: don't build things that make Polynovea's actual
Supabase deployment worse for the sake of hypothetical portability. It also
means: keep new provider coupling at named boundaries, preserve workspace
and audit invariants, and do not let the core schema or business logic
depend on a Supabase public URL as an asset's canonical identity. Typed
persistence and identity seams now exist, but the Supabase adapters remain
the only certified implementations.

See `docs/adr/ADR-010-reference-deployment-uses-supabase.md`,
`ADR-011-portable-postgresql-core.md`, and
`ADR-012-provider-specific-features-are-adapters.md` for the full reasoning.

## What was removed, and why

The AWS RDS `venues` lookup (`lib/rdsClient.ts`, `/api/rds/venues`, and the
"Client Venues" search UI in the Content Tracking entity switcher) has been
deleted, not preserved, rotated, or wrapped in an adapter. It was a separate
legacy venue-data integration, not part of the CMS's core architecture, and
The correct remediation for decommissioned infrastructure was deletion,
not continued operation. The fresh public repository history excludes the
retired integration and its internal implementation history.
The venue/client-entity product is pending a future redesign and is out of
scope for Phase 1; the Content Tracking entity switcher currently offers
Polynovea only, with no fabricated placeholder venues.
