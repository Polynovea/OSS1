# ADR-012: Provider-Specific Features Are Adapters

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1 (pre-Milestone-B cleanup)

## Context

`ADR-011` draws a line around what the portable core must not depend on.
This ADR says what happens to the things on the other side of that line —
because Supabase-specific capabilities (RLS policies using `auth.jwt()`,
Supabase Auth itself, the service-role client, Supabase Storage) are
genuinely useful and actively relied on by Polynovea's real deployment
(`ADR-010`). The goal isn't to avoid using them; it's to avoid letting them
become *irreversible assumptions baked into the core schema/business
logic*.

## Decision

Split every capability into one of two categories:
- **Portable Core** — the canonical schema (workspaces, content models,
  entries, versions, relations, permissions, audit) and the business logic
  that operates on it. Must satisfy `ADR-011`.
- **Provider Enhancement / Adapter** — anything that is genuinely
  provider-specific, isolated behind a narrow boundary so a different
  deployment can supply a different implementation without touching the
  core. Concretely, as of Phase 1:
  - **Identity**: `lib/platform/actor.ts` (Milestone B) is the one place
    that translates a Supabase-authenticated request into a CMS actor.
    Nothing else calls Supabase auth helpers directly. A future AWS/Azure
    deployment would supply a different identity adapter (OIDC, Cognito,
    Entra ID) behind the same boundary — see `ADR-013` (written in
    Milestone B) and `ADR-015` (RLS portability specifically).
  - **Object storage**: `lib/r2Storage.ts`'s provider-neutral function
    names (`uploadObject`, `deleteObject`, `createPresignedUpload`,
    `resolveObjectUrl` — renamed from `uploadBlob`/`deleteBlob`/
    `generateUploadSasUrl`, which carried R2/Azure-specific naming) are the
    current adapter surface. See `ADR-014`.
  - **RLS policies themselves**: portable in mechanism (`ADR-011`), but the
    *policies* written against Supabase's `auth.jwt()` are Supabase-specific
    integration code, organized separately from the core table DDL (see
    `ADR-002`, `ADR-015`).
- Migrations get classified accordingly (`core` vs. `provider`) starting
  from Milestone B's workspace tables onward, so it's always visible which
  files are portable-by-construction and which are Supabase-specific
  integration.

Provider Enhancements may be used freely and are not required to have a
fallback shipped in Phase 1 (e.g., Supabase Realtime, if ever adopted, would
be optional — the core CMS must still function without it, but building
that specific feature is not in scope now). The requirement is isolation,
not universal support.

## Consequences

- Adding a new deployment target later means writing new adapters, not
  rewriting the schema. This is the entire point of `ADR-011`'s contract.
- This is deliberately not built as a formal plugin/interface system in
  Phase 1 (that would be premature — see the Phase 1 brief's explicit
  non-goal on plugin marketplaces). It's a organizational discipline
  (where does this code live, what does it depend on) enforced by review,
  not by a runtime abstraction layer, for now.
