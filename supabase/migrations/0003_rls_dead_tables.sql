-- Phase 1, Milestone A — RLS rollout stage 1 of 4.
--
-- Context: every table in this Supabase project currently has RLS disabled,
-- and the browser talks to Supabase using the public anon key. With RLS off,
-- that key grants direct read/write access to every table via Supabase's
-- REST API, bypassing every application-level permission check. These legacy
-- tables have no browser access path and remain deny-by-default.
--
-- This first stage covers the three tables Phase 0 found are dead code —
-- live_events, past_shows, venue_partnerships have zero references anywhere
-- in app/ or lib/. Enabling RLS here has no application impact, so it's the
-- safest possible first step to confirm the RLS-enablement mechanics work
-- before touching a live table.
--
-- Enabling RLS with no policy defined denies all access to every role
-- except the table owner and roles with BYPASSRLS (Supabase's service_role
-- has BYPASSRLS by default, so server-side code using the service-role
-- client is completely unaffected by this migration).

alter table live_events enable row level security;
alter table past_shows enable row level security;
alter table venue_partnerships enable row level security;

-- Manual verification checklist (run after applying, before stage 2):
--
-- 1. Load the admin panel (/admin/cms, /admin/blog, /admin/metrics,
--    /admin/content*) and confirm nothing errors — none of these pages
--    reference these three tables, so there should be no visible change.
-- 2. From a shell, confirm the anon key can no longer read these tables
--    directly (expect an empty array or a permission-denied-shaped
--    response, not real rows):
--      curl "$SUPABASE_URL/rest/v1/live_events?select=*" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
-- 3. If both pass, proceed to 0004_rls_blog_and_metrics.sql.
