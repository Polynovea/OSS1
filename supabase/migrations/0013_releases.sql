-- Phase 1, Milestone I — Controlled release bundles.
create table if not exists releases (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  status text not null check (status in ('draft', 'approved', 'scheduled', 'publishing', 'published', 'partially_failed', 'cancelled')) default 'draft',
  scheduled_for timestamptz,
  created_by uuid references admin_users(id),
  approved_by uuid references admin_users(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists release_items (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null references releases(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete restrict,
  entry_version_id uuid not null references content_entry_versions(id) on delete restrict,
  delivery_status text not null check (delivery_status in ('pending', 'published', 'failed', 'skipped')) default 'pending',
  delivery_error text,
  created_at timestamptz not null default now(),
  unique (release_id, entry_id)
);
create index if not exists releases_workspace_status_idx on releases(workspace_id, status, created_at desc);
create index if not exists release_items_release_idx on release_items(release_id);
alter table releases enable row level security;
alter table release_items enable row level security;
