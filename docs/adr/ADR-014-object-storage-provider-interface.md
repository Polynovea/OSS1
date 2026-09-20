# ADR-014: Object Storage Provider Interface

**Status:** Accepted (naming cleanup done; full adapter interface deferred)
**Date:** 2026-09-01
**Phase:** 1 (pre-Milestone-B cleanup)

## Context

`lib/r2Storage.ts` is Polynovea's real, intended media storage
implementation (Cloudflare R2, accessed via its S3-compatible API — not a
stand-in for AWS S3, and not being migrated to AWS S3/Azure Blob/Supabase
Storage for portability's own sake, per the corrected Phase 1 direction).
Its function names, however, carried provider-specific and historically
stale terminology: `generateUploadSasUrl` used "SAS" (an Azure Blob
Storage term, left over from an earlier implementation that predates R2),
and `uploadBlob`/`deleteBlob` named the operation after Azure's "blob"
terminology rather than the generic object-storage operation it actually
performs against an S3-compatible API.

## Decision

**Done now** (mechanical rename, no behavior change):
`lib/r2Storage.ts` exports `uploadObject`, `deleteObject`,
`createPresignedUpload`, and `resolveObjectUrl` — provider-neutral names,
updated at both call sites (`app/api/upload/route.ts`,
`app/api/upload/sas/route.ts`). No new abstraction layer, interface, or
class was introduced; this is naming cleanup only.

**Deferred, designed toward but not built in Phase 1**: a formal
`ObjectStorageProvider` interface (conceptually: `uploadObject`,
`deleteObject`, `createPresignedUpload`, `resolveObjectUrl` as an
interface `lib/r2Storage.ts` implements, alongside future implementations
for AWS S3, Azure Blob, MinIO, Supabase Storage, or local filesystem for
development). Building this now, with exactly one real implementation and
no second consumer, would be speculative abstraction with no current
payoff — the four function names above are already the shape that
interface would have, so introducing it later is a mechanical wrap, not a
redesign.

When the generic asset/media engine is eventually built (Phase 2+, per the
original roadmap — explicitly out of scope for Phase 1), the canonical
asset record must store `provider`, `storage_key`, `mime_type`, `size`,
`checksum`, and `metadata` — not a raw Cloudflare public URL as the asset's
canonical identity. `resolveObjectUrl(key)` already exists as the one place
that turns a key into a URL, which is exactly the seam that record shape
needs.

## Consequences

- Current deployment: `provider = "cloudflare_r2"` is implicit (there's
  only one implementation); it becomes an explicit column value once the
  assets table exists.
- No functional or behavioral change from this ADR — it is a pure rename at
  the module boundary, verified by TypeScript compilation catching every
  call site (there is no pre-existing test suite for the upload routes to
  regress; adding one is tracked as a test gap, not covered by this ADR).
