-- Phase 3 (Data Studio) follow-up — precise archive/unarchive state.
--
-- archiveEntry() previously overwrote content_entries.status to 'archived'
-- with nothing recording what it was before, so unarchiveEntry() could only
-- guess (published if published_version_id was set, else draft) — an entry
-- archived mid-review (in_review/approved/scheduled) came back as a bare
-- draft, silently losing its workflow position. This column lets
-- unarchiveEntry() restore the exact prior status instead of guessing.
--
-- Additive only: nullable, no backfill needed (existing archived rows with
-- a null status_before_archive fall back to the same published/draft guess
-- as before — never worse than the current behavior, only better for rows
-- archived after this migration).

alter table content_entries
  add column if not exists status_before_archive text
  check (status_before_archive in ('draft', 'in_review', 'approved', 'scheduled', 'published'));

-- Manual verification checklist:
-- 1. select column_name from information_schema.columns where table_name = 'content_entries' and column_name = 'status_before_archive'; -- 1 row
-- 2. Archive an in_review entry, confirm status_before_archive = 'in_review'; unarchive it, confirm status returns to 'in_review'.
