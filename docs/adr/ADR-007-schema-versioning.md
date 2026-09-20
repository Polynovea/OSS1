# ADR-007: Schema Versioning

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone C

## Context

The brief requires "never silently mutate the meaning of historical
content" and immutable schema versions (original upgrade plan §10.3;
Phase 1 brief §9). Once entries exist against a given schema version
(Milestone E), that version's exact shape needs to be recoverable forever
— both to interpret old entry data correctly and to support the
version-history/diff/rollback UX the brief describes.

## Decision

- **Every content model has a monotonically increasing `version_number`**,
  starting at 1 when the model is created (`content_model_versions`, unique
  on `(content_model_id, version_number)`).
- **A version row, once written, is never updated or deleted.**
  `content_model_versions` has no `UPDATE`/`DELETE` code path anywhere in
  `lib/schema/modelService.ts` — the only write is `INSERT`.
- **`content_models.current_schema_version` is the only mutable pointer** —
  it advances to the new version number after a successful apply, but the
  old version row stays exactly as it was.
- **`schema_hash`** (`lib/schema/modelService.ts`'s `computeSchemaHash` —
  a SHA-256 of the schema JSON with keys stably sorted) is stored alongside
  every version as a cheap integrity/dedup signal — not enforced as a
  uniqueness constraint in Phase 1 (two versions could theoretically hash
  the same if a change was applied and then reverted byte-for-byte; that's
  a valid history, not a bug), but available for future tooling (e.g., "has
  this exact schema shape existed before").
- **`change_summary`** is a free-text field, optionally supplied by the
  caller of `apply-change` — not required, not structured, in Phase 1. A
  structured changelog derived from the diff engine's output (`ADR-008`)
  is more useful long-term than hand-typed summaries, but that's a UI-layer
  concern for Milestone D, not this ADR's scope.

## Consequences

- **Storage grows with every schema change, forever** — acceptable and
  intentional; this is the "versioned schema changes" requirement, not
  something to optimize away by pruning history in Phase 1.
- **Rollback is "create a new version with the old content," never
  "restore/mutate a past row"** — consistent with the original upgrade
  plan's "Restoration creates another version" rule for entry version
  history (§14), applied here to schema versions too, even though building
  an actual rollback UI/endpoint is not Milestone C scope.
- **Any future migration-execution feature that mutates a model's
  compiled representation** (Schema CI/CD, per the original 50-phase plan)
  must key off `version_number`, not a timestamp or a mutable row, to stay
  consistent with this model.
