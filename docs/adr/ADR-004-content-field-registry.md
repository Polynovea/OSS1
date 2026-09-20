# ADR-004: Content Field Registry (and the `content_fields` Source-of-Truth Decision)

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone C

## Context

Two related problems the brief calls out explicitly:

1. **Field-type logic sprawl** (§20): "Avoid spreading `switch(field.type)`
   logic across dozens of React/API files. Prefer a field registry."
2. **Two competing sources of truth** (§9): if both `content_model_versions
   .schema_json` and `content_fields` are treated as canonical, they will
   drift — the brief explicitly says "Pick one. Document the decision in an
   ADR." This is that ADR.

## Decision

### Field registry

`lib/schema/fields/registry.ts` exports `FIELD_TYPE_REGISTRY`, a
`Record<FieldType, FieldTypeDefinition>` — one entry per field type
(text, number, boolean, slug, relation, ... all 20 from the brief §11
list), each providing `validateValue()`, a `postgresType` (metadata for a
future compiler/compatibility view, not used to generate real columns in
Phase 1 — see `ADR-005`), and `supportedValidation` (which
`FieldValidationConfig` keys are meaningful for that type). Consumers
(the meta-schema validator, the diff engine, eventually entry validation
in Milestone E and the Visual Builder in Milestone D) look up
`FIELD_TYPE_REGISTRY[field.type]` — none of them branch on field type
directly.

This is deliberately **one file with one exported map**, not twenty
separate files (one per type), despite the brief's literal "one module per
field type" phrasing. Most of these types differ only in a validator
function and a Postgres-type label; twenty near-empty files would be
sprawl of a different kind. What actually matters — no
`switch(field.type)` in *consuming* code — is satisfied either way.

### `content_fields` is derived, not canonical

**`content_model_versions.schema_json` is the single source of truth.
`content_fields` is a read-optimized projection of the *current* version's
`fields[]`, rebuilt in full (`lib/schema/modelService.ts`'s
`rebuildContentFields()` — delete then re-insert) every time a schema
version is applied. Nothing ever writes to `content_fields` directly or
partially.**

Why this direction and not the reverse (treat `content_fields` as
canonical, generate `schema_json` from it): the versioned JSON is what
needs to be immutable history (`ADR-007`) — a `content_model_versions` row
is written once and never updated. A relational table can't cheaply give
you that same "every past version, byte-for-byte, forever" guarantee
without becoming an event-sourced table itself, which is more machinery
than Phase 1 needs. The relational projection exists purely so SQL queries
like "which models use a `relation` field pointing at X" don't require
parsing JSON in every query — a read-time convenience, not a write target.

## Consequences

- **One extra write** (`content_fields` delete+insert) on every schema
  change — acceptable; the table's whole row count is bounded by workspace
  content-model complexity, not entry volume.
- **`content_fields` can safely be dropped and rebuilt from
  `content_model_versions` at any time** with zero data loss — a genuine
  test of whether this design decision was followed. (Not required for
  Phase 1, but worth remembering if `content_fields` is ever suspected to
  have drifted.)
- **Anyone tempted to `UPDATE content_fields` directly** (in a future
  migration, a debugging session, or a well-meaning shortcut) is
  introducing exactly the two-sources-of-truth bug this ADR exists to
  prevent. Code review should treat a hand-edit of `content_fields` as a
  bug, not a fix.
