-- Phase 3 — durable, workspace-scoped Data Studio saved views.
--
-- Filter state is product data, not an unscoped browser preference: each
-- view belongs to one workspace, can optionally be scoped to one model, and
-- is owned by its creator. App routes use the service role only after the
-- normal CMS actor and workspace authorization checks; RLS remains deny-all
-- for direct clients, consistent with the rest of the portable CMS core.

create table if not exists content_entry_saved_views (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_model_id uuid references content_models(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  filters_json jsonb not null default '{}'::jsonb,
  created_by uuid not null references admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, created_by, name)
);

create index if not exists content_entry_saved_views_workspace_owner_idx
  on content_entry_saved_views(workspace_id, created_by, updated_at desc);
create index if not exists content_entry_saved_views_workspace_model_idx
  on content_entry_saved_views(workspace_id, content_model_id);

alter table content_entry_saved_views enable row level security;

-- Manual verification:
-- 1. Confirm relrowsecurity is true for content_entry_saved_views.
-- 2. Create a view through Data Studio, reload it, and confirm it is visible
--    only to its owner within the current workspace.
