# ADR-008: Schema Migration Lifecycle

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone C

## Context

The brief is explicit that schema changes must not be a silent `PATCH`:
"The lifecycle should preferably become: propose → validate → diff →
apply, even if the first implementation combines some steps" (§28), and
unsafe changes must be classified and require explicit acknowledgement
before taking effect (§18, §28's "Unsafe schema change detection blocking
apply-change without an explicit override").

## Decision

Two endpoints implement the lifecycle, both operating on the same
underlying logic (`lib/schema/modelService.ts`):

- **`POST /api/models/:id/validate-change`** — propose + validate + diff,
  persists nothing. Runs `validateCanonicalSchema()` (structural
  correctness, `ADR-003`), rejects an `apiKey` change outright (immutable,
  `ADR-003`), then computes the diff (`lib/schema/diff.ts`) between the
  current version and the proposed schema. Returns the diff and its
  classification so a caller (the future Visual Builder's "Migration" tab,
  or a script) can show the consequences before committing to anything.
- **`POST /api/models/:id/apply-change`** — re-runs the *exact same*
  validate+diff logic (never trusts a diff computed by a prior
  `validate-change` call — the server is always the source of truth for
  whether a change is safe), then:
  - If the diff's `overallClassification` is `SAFE`, applies immediately.
  - If it's `POTENTIALLY_DESTRUCTIVE`, `DESTRUCTIVE`, or
    `REQUIRES_DATA_MIGRATION`, applies **only if** the caller passed
    `acknowledgeUnsafe: true`; otherwise returns HTTP 409 with the diff and
    a `blockedReason`, and writes nothing.
  - On success: inserts the new `content_model_versions` row, advances
    `content_models.current_schema_version`, rebuilds `content_fields`
    (`ADR-004`), and writes audit events (below).
- **A plain `PATCH /api/models/:id` exists but is scoped to model metadata
  only** (`description`, `icon`, `status`) — never `name`/`apiKey`/fields,
  which only exist inside `schema_json` and therefore only change through
  the lifecycle above. This is what "PATCH never silently mutates the live
  schema" means concretely: the metadata PATCH literally cannot touch
  schema content, by construction, not by convention.

### Audit trail

Every apply-change run emits, via `lib/platform/audit.ts`'s
`logPlatformEvent` (writing to the new `platform_audit_events` table, kept
separate from the legacy `admin_activity_log` — see `ADR-002`'s sibling
reasoning for why old and new audit tables aren't merged in Phase 1):
`schema.migration.started` → (`schema.field.added`/`schema.field.removed`
per changed field) → `schema.migration.completed` and
`schema.model.updated`, or `schema.migration.failed` if the version insert
itself errors. `schema.model.created` fires once, from `createModel`.

## Consequences

- **No "migration executor" exists in Phase 1** — "apply" here means
  "commit a new schema version and rebuild the read-projection," not
  "generate and run an `ALTER TABLE`." That's consistent with entries being
  stored generically in `content_entries.data_jsonb` (Milestone E,
  `ADR-005`) rather than per-model physical tables — there is no physical
  table to migrate yet. When/if per-model physical tables are ever
  introduced, `schema.migration.started/completed/failed` is already the
  right event shape to wrap that real DDL execution in; this ADR's
  lifecycle doesn't need to change, only what happens inside "apply."
- **`acknowledgeUnsafe` is a single boolean, not a per-change-entry
  acknowledgement.** A diff with five `POTENTIALLY_DESTRUCTIVE` entries and
  one `DESTRUCTIVE` entry is acknowledged or rejected as a whole. Granular,
  per-field override ("apply the safe parts, hold back the risky field")
  is a real future improvement but adds meaningful complexity Phase 1
  doesn't need yet — the current lifecycle already satisfies the brief's
  stated requirement.
- **Migration Preview / data-inspection** (brief §28's "8,492 records, 8,477
  convertible, 15 require review") is explicitly **not** built in Phase
  1 — the diff engine classifies *field-level* risk from the schema shapes
  alone, without inspecting actual entry data (there are no entries yet;
  that's Milestone E). Building real data-aware migration preview is
  future work once `content_entries` exists.
