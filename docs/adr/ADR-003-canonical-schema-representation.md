# ADR-003: Canonical Schema Representation

**Status:** Accepted
**Date:** 2026-09-01
**Phase:** 1, Milestone C

## Context

The whole point of the Canonical Schema Engine (brief §8, §20, §25) is that
one representation drives the Visual Builder, the Advanced Builder, the
API, validation, and eventually the SDK/CLI/MCP — "the Visual Builder must
never emit 'Supabase schema instructions' as its canonical output." That
representation has to be decided now, in code, not left as a vague JSON
blob shape that every consumer interprets slightly differently.

## Decision

The canonical schema is a plain JSON object matching this shape (defined in
`lib/schema/fields/types.ts` as `CanonicalSchema`, validated by a Zod
meta-schema in `lib/schema/canonicalSchema.ts`):

```json
{
  "name": "Blog Post",
  "apiKey": "blog_post",
  "description": "optional",
  "fields": [
    {
      "key": "title",
      "label": "Title",
      "type": "text",
      "required": true,
      "localized": false,
      "unique": false,
      "validation": { "minLength": 5, "maxLength": 150 }
    },
    {
      "key": "slug",
      "label": "Slug",
      "type": "slug",
      "required": true,
      "unique": true,
      "generatedFrom": "title"
    }
  ]
}
```

Key decisions baked into this shape:
- **`apiKey` is immutable after creation** (enforced in
  `lib/schema/modelService.ts`'s `applyChange`) — it's the stable
  identifier every consumer (API paths, generic entries, relations)
  references, and letting it change would break every downstream
  reference silently.
- **`fields` is an ordered array, not a map** — array order is the
  canonical field order (used for UI rendering and the `content_fields`
  projection's `position` column), and `key` is each field's stable
  identifier within that array, validated to be unique
  (`superRefine` in the Zod schema) and to match `^[a-z][a-z0-9_]*$`
  (lowercase snake_case) so it's safe to use as a JSON object key,
  a URL path segment, and a Postgres column name if ever compiled to one.
- **Validation, relation, and localization metadata live inline on each
  field**, not in separate top-level sections — keeps one field's full
  definition readable as one object, and matches the brief §10 example
  exactly.
- **No UI-layout metadata in the canonical schema itself** (brief §10:
  "Do not let layout-specific UI configuration contaminate core
  semantics"). `uiHints` exists as an escape hatch for the eventual Visual
  Builder to store display-only preferences (field grouping, help text
  placement), but validation/compilation code must never read it — only
  UI rendering code should.
- **No version number inside the schema JSON itself** — versioning is a
  property of *where the schema is stored*
  (`content_model_versions.version_number`), not the schema content, so
  the same schema shape is valid whether it's version 1 or version 40 (see
  `ADR-007`).

## Consequences

- A malformed schema can never reach `content_model_versions` — every
  write path (`createModel`, `applyChange`) runs through
  `validateCanonicalSchema()` first, and the Zod schema is strict about
  field key/apiKey format and field type enum membership.
- Every other Milestone C/D/E component builds on this exact shape: the
  field registry (`ADR-004`) keys off `field.type`, the diff engine
  (`lib/schema/diff.ts`) walks `fields` by `key`, and the (future) Visual
  Builder renders directly from it.
- This is a JSON Schema-*inspired* shape, not literal JSON Schema —
  deliberately, since JSON Schema doesn't cleanly express relation
  cardinality, localization, or CMS-specific concepts like `generatedFrom`.
  Generating a real JSON Schema / OpenAPI document *from* this canonical
  shape (brief §8's "REST API" / "OpenAPI metadata" targets) remains
  future work, not built in Phase 1.
