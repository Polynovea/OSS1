# ADR-001: Workspace vs Entity

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone B

## Context

The current application has an `entity` text column on `social_posts` and
`ad_campaigns` (values like `"polynovea"`, informally meant to distinguish
Polynovea's own content from a client venue's). Phase 0 found this is not a
real security/ownership boundary: it's a free-text column with one
hardcoded frontend value (`app/admin/content/layout.tsx`'s
`INTERNAL_ENTITIES`), no FK, no isolation semantics, and no bearing on who
can read or write anything. The open-source direction needs a real
workspace concept — the boundary multi-tenant deployments actually isolate
on — and it would be a mistake to retrofit the historical `entity` column
into that role.

## Decision

**Workspace is the security/ownership boundary. `entity` (soon: the new
`entities` table) is a subordinate content/business dimension that lives
*within* a workspace, not a replacement for one.**

```
Workspace
│
├── Members (workspace_members, mapped from admin_users)
├── Roles / Permissions (roles, permissions, role_permissions)
├── Content Models / Content / Assets (Milestones C, E, and future phases)
├── Integrations
│
└── Entities / Brands / Sites (entities table)
```

For Polynovea today: one workspace ("Polynovea"), containing one entity
("Polynovea"). No client-venue entities are created — the venue product is
a separate, future redesign (per the corrected Phase 1 direction; the old
AWS RDS venue lookup that used to populate the entity switcher has been
decommissioned and removed, not adapted into this new model).

`workspace_id` becomes the fundamental authorization/isolation column going
forward — every table introduced from Milestone B onward carries it. The
historical `entity` text columns on `social_posts`/`ad_campaigns` are left
completely as-is (Phase 1 does not touch that data or the columns' meaning);
a nullable `entity_id` FK to the new `entities` table is added alongside
them purely as a forward-compatible migration path, unused by any
application code yet.

## Consequences

- Every future table (content models, entries, releases, etc.) gets a
  `workspace_id` column from day one, not `entity`.
- The `entities` table's `type` column (`brand | site | client |
  publication | project | other`) is deliberately generic — `venue` is not
  one of the values, and nothing in Phase 1 assumes venues will map onto
  this table later. If/when the venue product is redesigned, it may or may
  not use `entities` — that's a decision for whoever does that redesign,
  not decided here.
- `social_posts`/`ad_campaigns`'s existing `entity` column remains
  functionally exactly as it is today; migrating actual data from `entity`
  text values into `entity_id` FK values is explicitly deferred, not
  attempted in Phase 1.
