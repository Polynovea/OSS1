-- Phase 1, Milestone A — RLS rollout stage 2 of 4.
--
-- blog_posts and live_metrics. Every read and write to these tables goes
-- through a Next.js API route using the service-role client
-- (lib/dbAdapter.ts, lib/admin/audit.ts's revalidation path is unrelated) —
-- confirmed via a full-repo grep for supabase.from("blog_posts") /
-- supabase.from("live_metrics"). No component or hook calls Supabase
-- directly for either table. Service-role bypasses RLS, so this migration
-- should be invisible to the running application.

alter table blog_posts enable row level security;
alter table live_metrics enable row level security;

-- Manual verification checklist (run after applying, before stage 3):
--
-- 1. Public read path still works (uses the service-role client server-side,
--    unaffected by RLS, but confirm the actual HTTP behavior):
--      curl "https://<your-deployment>/api/content/blog-posts"
--      curl "https://<your-deployment>/api/content/live-metrics"
--    Both should return real data exactly as before.
-- 2. In the admin panel: open /admin/blog, create a draft post, edit it,
--    publish it, delete it. Open /admin/metrics, add/edit/save a metric.
--    All should work exactly as before — these go through
--    requireAdminRequest + the service-role client.
-- 3. Confirm the anon key can no longer read these tables directly:
--      curl "$SUPABASE_URL/rest/v1/blog_posts?select=*" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--      curl "$SUPABASE_URL/rest/v1/live_metrics?select=*" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
--    Both should come back empty/denied, not real rows.
-- 4. If all pass, proceed to 0005_rls_content_tracking.sql.
