# ADR-016: Data Model Capability, Index, and Permission-Policy Metadata

**Status:** Accepted
**Date:** 2026-09-02
**Phase:** 1 (Complete Canonical Data & Schema Engine)

## Context

V2 §4.4 requires that "a model may be data-only, content-enabled, or
publishable; publishing/SEO/workflow/route/preview are capabilities layered
on top, not a requirement for every record." §13 Phase 1 asks the canonical
schema to carry "default values, validation, uniqueness, nullable/required,
indexes, relation semantics, permissions, portability, and migration
behaviour" — most of that already existed (`defaultValue`, `validation`,
`unique`, `required`, `relation`); index metadata, the data/content/
publishable distinction, and permission-policy metadata did not.

The constraint from ADR-003/ADR-004 is unchanged: `content_model_versions
.schema_json` is the only canonical schema authority. This ADR must extend
that one representation, not introduce a second one (e.g. a separate
`data_models` table with its own schema shape).

## Decision

### Capability lives on the canonical schema, not a new table

`CanonicalSchema.capability?: "data_only" | "content_enabled" |
"publishable"` (`lib/schema/fields/types.ts`), validated by `CanonicalSchemaZ`
with a `default("content_enabled")`. A model with no schema-level opinion
behaves exactly as every model did before this change — this is why the
field is optional on the TypeScript type: existing `content_model_versions`
rows (e.g. `blog_post`) persisted before this ADR have no `capability` key
in their stored JSON, and are never retroactively rewritten (versions are
immutable, ADR-007). Call sites read capability through
`resolveModelCapability(schema)`, never `schema.capability` directly, so
that default is applied consistently instead of once per call site.

`content_models.settings_json` (already present since migration `0008`, and
already documented there as free-form JSON) now carries `{ capability }` as
a **read-optimized projection** of the current version's capability — same
relationship `content_fields` has to `schema_json` (ADR-004): rebuilt by
`createModel`/`applyChange`, never hand-written, never authoritative. No
migration was needed because the column already existed for exactly this
kind of extension.

### Field-level index and portability metadata

`FieldDefinition.index?: boolean` requests a basic (non-unique) index; a
`unique: true` field already implies one and does not need `index` too.
`FieldDefinition.providerSpecific?: boolean` flags a field whose storage
depends on a non-portable database feature, for the Advanced/API studio
views' portability warning (V2 §4.3, ADR-011/ADR-012). Both are stored in
`content_fields.configuration_json`, alongside the other derived field
configuration.

### Permission policy is intent, not enforcement

`CanonicalSchema.permissions?: ModelPermissionPolicy[]` — `{ role,
operations }` pairs from a fixed `ModelOperation` set (`read`, `create`,
`edit`, `publish`, `archive`, `delete`). This is schema-level *intent*
("this model's Editor role may edit but not publish"), compiled later
(Phase 2 Visual DB Studio policy UI) into the platform's actual
`permissions`/`role_permissions` tables and, where applicable, RLS. It is
never itself an enforcement point — `lib/platform/permissions.ts`'s
`requirePlatformAccess` remains the only place a request is actually
authorized. Two schema-level rules are enforced at validation time because
they are structural, not policy: no duplicate policy per role, and a
`data_only` model cannot grant `publish` (publishing does not apply to
non-content data — the capability and the permission model must agree).

### Diff classification for capability changes

`computeSchemaDiff` now also compares `resolveModelCapability(before)` vs
`resolveModelCapability(after)` and emits a synthetic entry keyed
`__capability__` (not a real field key) when it changes. Downgrading to
`data_only`, or away from `publishable`, is `POTENTIALLY_DESTRUCTIVE` (the
model's records may have live publish/workflow state that becomes
unreachable); every other capability change is `SAFE`.

## Consequences

- No second schema authority: capability, index, and permission metadata
  all live inside `schema_json`; `settings_json` and `content_fields` remain
  derived projections per the existing ADR-004 pattern.
- Every existing schema (fields, tests, stored rows) that predates this ADR
  continues to validate and behave identically — `capability` defaults to
  `content_enabled`, `index`/`providerSpecific`/`permissions` default to
  absent.
- The Visual Database Studio (Phase 2) has real metadata to build its
  capability selector, index/uniqueness controls, and role/operation policy
  UI against, instead of inventing new server state.
- Permission *policy* metadata existing on the schema is not itself a
  security boundary; a future Phase 2/3 change that compiles it into
  `role_permissions` must still go through the same audited, server-side
  path as every other permission grant.
