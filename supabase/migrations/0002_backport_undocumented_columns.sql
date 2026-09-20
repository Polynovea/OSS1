-- Backport two columns that the application already reads/writes but that were
-- never added to supabase/migration.sql (schema drift found during the initial
-- migration review).
--
-- Both statements are idempotent (`add column if not exists`), so this is safe
-- to run whether or not the production database already has these columns from
-- an earlier out-of-band change. Because this migration was written from code
-- usage rather than from an inspection of the live production schema, confirm
-- the actual column type in Supabase before treating this file as authoritative
-- — in particular, `checkpoint_metrics` below is a best-guess `jsonb` shape
-- inferred from `CheckpointMetrics[]` in lib/admin/types.ts, not a verified copy
-- of the production column definition.

-- blog_posts.cover_image — read/written by components/admin/BlogForm.tsx and
-- passed through unfiltered by app/api/content/blog-posts/route.ts (POST) and
-- app/api/content/blog-posts/[id]/route.ts (PUT).
alter table blog_posts
  add column if not exists cover_image text;

-- social_posts.checkpoint_metrics — read/written by
-- app/admin/content/content/page.tsx and passed through unfiltered by
-- app/api/content/social-posts/[id]/route.ts (PATCH). Stored as a single jsonb
-- column holding a 4-element array (one entry per checkpoint, matching
-- social_posts.checkpoints) of CheckpointMetrics objects or null.
alter table social_posts
  add column if not exists checkpoint_metrics jsonb;
