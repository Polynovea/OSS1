# ADR-005: Generic Entry Storage and Immutable Versions

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone E

## Decision

Store stable entry identity and lifecycle pointers in `content_entries`, and
store each authoring revision as a new `content_entry_versions` record with a
JSONB payload validated against the model's immutable schema version. Never
overwrite a version payload.

`current_draft_version_id` identifies the current editable draft;
`published_version_id` identifies the version last released. `content_relations`
is the authoritative relational projection for relation fields, so references
are queryable and can later power impact analysis, preflight, and safe delete.

## Consequences

- A draft save always creates a new version and records an audit event.
- The API validates required/type/field-key rules, model-scoped unique fields,
  workspace boundaries, relation targets, and relation target-model type.
- Publishing promotes an existing validated draft; it does not mutate the
  payload or create an untracked status-only publish.
- `blog_posts` remains unchanged until `0010_blog_compatibility_backfill.sql`
  has been applied and parity verification has passed. The ledger makes that
  one-way copy repeatable and auditable.
- The current implementation uses the server service-role client for the
  multi-write sequence, as established by the current platform architecture.
  A future PostgreSQL RPC/job boundary should wrap the sequence in one database
  transaction before public API/SDK release, because a network failure between
  version and pointer writes otherwise needs recovery handling.
