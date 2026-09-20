# ADR-013: CMS Actor vs External Identity

**Status:** Accepted; master-email bypass superseded before OSS V1 release
**Date:** 2026-09-01
**Phase:** 1, Milestone B

## 2026-09-13 amendment

The external-identity -> `admin_users` -> workspace-membership architecture remains
the accepted design. The transitional hardcoded master-email bypass described
later in this historical ADR has been removed.

`requireAdminRequest()` now resolves every authenticated identity through an
active `admin_users` profile, and `resolveActor()` requires an active
`workspace_members` row plus role permissions for every actor. The first
administrator is created through the server-only `npm run bootstrap:admin`
command, which also establishes the default-workspace owner role. There is no
synthetic actor or email-specific authorization path in the OSS V1 runtime.

## Context

`ADR-012` establishes that identity resolution must sit behind an adapter
boundary so a future non-Supabase deployment isn't blocked by the core
schema assuming Supabase Auth forever. Milestone B is where that boundary
actually gets built: `lib/platform/actor.ts`'s `resolveActor()` is the one
place that turns "an authenticated identity" into a `CmsActor` (workspace
membership + resolved permissions), and nothing else in the new
`lib/platform/*` code queries `workspace_members`/`member_roles`/`roles`/
`role_permissions` directly.

The open question this ADR resolves: **how much of the "external identity →
CMS actor" abstraction should be built now**, versus deferred while
`admin_users` keeps serving as the bridge.

## Decision

**Keep `admin_users` as the bridge for Phase 1. Do not build a separate
`cms_users`/`actors` table or a formal multi-provider identity-adapter
system yet.**

Concretely, `resolveActor()` takes an already-resolved `AdminUser` (today,
always produced by `lib/admin/serverAccess.ts`'s `requireAdminRequest`,
which validates a Supabase JWT and resolves it to an `admin_users` row) and
maps it to workspace membership. This means:
- `lib/platform/permissions.ts`'s `requirePlatformAccess()` is built ON TOP
  of `requireAdminRequest`, not a parallel reimplementation of Supabase
  token validation — there remains exactly one place that talks to
  Supabase Auth directly.
- `workspace_members.admin_user_id` is a foreign key to `admin_users(id)`,
  not to Supabase's own `auth.users` table directly. This is already one
  layer removed from "the database identity IS the Supabase Auth user,"
  even though `admin_users` itself still assumes Supabase Auth today (via
  `admin_users.auth_user_id`).

**The one deliberate exception, carried over from the existing system and
not "fixed" here:** `lib/admin/serverAccess.ts` and `lib/admin/access.ts`
bypass the `admin_users` table entirely for the hardcoded master account
(`lib/admin/constants.ts`'s `MASTER_EMAIL`), granting full access
(`module_access: ["*"]`) regardless of what (if anything) is in the table
for that email. `resolveActor()` mirrors this exactly: if the resolved
`AdminUser`'s email matches `MASTER_EMAIL`, it returns a synthetic
`CmsActor` with every permission and `workspaceMemberId: null`, without a
database lookup.

Note this is a code-path bypass, not a guarantee that no `admin_users` row
exists — in production, a row for the master email has existed since the
CMS was first built (`admin_users` is, and has always been, the real
mechanism controlling who has access to the CMS — this bypass is an
exception carved out for one specific account, not a sign the table is
vestigial or only recently populated). Milestone B's `workspace_members`
backfill picked that row up like any other and correctly mapped it to the
`owner` role via the migration's defensive `case ... when 'master' then
'owner'` branch. That row and its `workspace_members`/`member_roles` entry
are functionally inert today — `resolveActor()` never reaches them for the
master email — but harmless and arguably useful groundwork if the
code-level bypass is ever retired in favor of the real membership row.

## Why not build the full abstraction now

A generic `External Identity → CMS Actor → Workspace Membership → Role/
Permissions` chain (a real `cms_users`/`actors` table decoupled from
`admin_users`, with `admin_users` becoming just one "Supabase Auth"
identity-provider record among possible future OIDC/Cognito/Entra ID
ones) is the right target eventually — but Phase 1 has exactly one
identity provider (Supabase Auth) and one consumer (Polynovea). Building
the full abstraction now would be speculative generality with no second
provider to validate it against, and would mean touching
`lib/admin/serverAccess.ts`'s login/session-resolution path, which is
explicitly supposed to keep working unchanged through Phase 1 (per the
brief's "the current Admin/CMS is not being replaced" instruction).

## Consequences

- **Residual technical debt, tracked, not hidden:** the master-email
  bypass now exists in two places doing the same thing
  (`lib/admin/access.ts`'s `isMasterUser` and `lib/platform/actor.ts`'s
  email check in `resolveActor`) rather than one shared implementation.
  Unifying them is possible but would require the older code to depend on
  the newer `lib/platform` module (or vice versa) prematurely; left
  duplicated deliberately for now, same spirit as `ADR-002`'s residual
  hardcoded-email note.
- **When a real identity-adapter migration eventually happens** (a second
  auth provider, or fixing the master-bootstrap mechanism per `ADR-002`'s
  own deferred item), the seam to change is `resolveActor()`'s input type
  — today it accepts an `AdminUser`; a future version would accept
  whatever a generic `CmsActor`-producing identity layer resolves to. The
  rest of `lib/platform/*` (permission checks, workspace resolution)
  doesn't need to change, because it never touches Supabase Auth directly.
- This ADR does **not** change `lib/admin/serverAccess.ts`,
  `lib/admin/access.ts`, or any existing route. Zero regression risk to
  current Blog/Metrics/Content Tracking/Access functionality.
