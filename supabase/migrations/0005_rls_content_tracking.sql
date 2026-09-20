-- Phase 1, Milestone A — RLS rollout stage 3 of 4.
--
-- social_posts, ad_campaigns, platforms — the Content Tracking surface.
-- Same situation as stage 2: every read/write goes through an API route
-- using the service-role client (lib/dbAdapter.ts for the first two,
-- direct service-role calls in app/api/content/platforms*/route.ts for the
-- third). No client-side Supabase calls found for any of these three.

alter table social_posts enable row level security;
alter table ad_campaigns enable row level security;
alter table platforms enable row level security;

-- Manual verification checklist (run after applying, before stage 4):
--
-- 1. Public read paths still work:
--      curl "https://<your-deployment>/api/content/social-posts"
--      curl "https://<your-deployment>/api/content/ad-campaigns"
--      curl "https://<your-deployment>/api/content/platforms"
-- 2. In the admin panel: /admin/content/content — log a post, edit a
--    checkpoint, delete it. /admin/content/ads — log a campaign, edit it,
--    delete it. /admin/content/platforms — add a platform, toggle it,
--    delete it. All should work exactly as before.
-- 3. Confirm the anon key can no longer read these tables directly (same
--    curl pattern as the previous two stages, against
--    /rest/v1/social_posts, /rest/v1/ad_campaigns, /rest/v1/platforms).
-- 4. If all pass, proceed to 0006_rls_admin_tables.sql — that one is the
--    highest-consequence stage, since admin_users needs an actual policy
--    rather than pure deny-all.
