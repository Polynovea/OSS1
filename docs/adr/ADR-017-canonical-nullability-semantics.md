# ADR-017: Canonical Nullability and Value Absence Semantics

**Status:** Accepted
**Date:** 2026-09-04
**Phase:** 1 (Foundation Closure)

## Context

The Master Plan requires unambiguous nullability semantics across dynamic content schemas, JSONB version storage, database projections, and delivery APIs. In dynamic schema systems, ambiguity often arises when distinguishing between:
1. Field value omission (key not present in JSON payload).
2. Explicit `null` value (`"field": null`).
3. Empty string / empty array (`""` or `[]`).

## Decision

Polynovea CMS adopts a **deterministic, contract-driven nullability model**:

1. **Authority via `required` Field Flag:**
   - A field with `required: false` is **nullable and optional**.
   - A field with `required: true` is **non-nullable and mandatory**.

2. **Validation and Storage Semantics:**
   - **`required: false` (Nullable):**
     - Omission of the field key, explicit `null`, or empty string `""` are valid at draft, review, and publication time.
     - Storage in `content_entry_versions.data_jsonb` preserves explicit `null` or omitted keys without mutation.
     - Derived PostgreSQL columns (where mapped) are defined as `NULL`.
   - **`required: true` (Non-Nullable):**
     - Value omission, explicit `null`, `undefined`, and empty strings `""` are rejected with validation errors during draft saving and publishing.
     - Derived PostgreSQL columns (where mapped) are defined as `NOT NULL`.

3. **Unique Field Interaction:**
   - Unique field enforcement (`unique: true`) applies exclusively to non-empty, non-null values.
   - Multiple entries may have `null` or omitted values for an optional unique field without triggering collision errors (matching standard SQL `UNIQUE` semantics where `NULL != NULL`).

4. **Delivery API Contract:**
   - Public Delivery APIs (`/api/content/:model`) serialize nullable fields as explicit `null` or the resolved value, ensuring stable TypeScript client contracts.

## Consequences

- Simplifies schema definition: no redundant `nullable: true` flag is required alongside `required: false`.
- Eliminates ambiguity in form renderers, schema diffing, and database migration projections.
- Fully compatible with standard PostgreSQL column constraints and ANSI SQL semantics.
