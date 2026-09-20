-- Phase 7 — Managed Site Tree, Route Registry & Redirect Manager.
--
-- Governs canonical routes, path collisions, route history, and locale-aware redirects.

create table if not exists content_routes (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  parent_route_id uuid,
  entry_id uuid references content_entries(id) on delete cascade,
  locale text not null,
  path text not null,
  title text,
  node_type text not null check (node_type in ('routable_entry', 'virtual_folder', 'external_link', 'custom_path')) default 'routable_entry',
  is_canonical boolean not null default true,
  status text not null check (status in ('active', 'draft', 'archived')) default 'active',
  order_index integer not null default 0,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, locale, path),
  foreign key (parent_route_id, workspace_id) references content_routes(id, workspace_id) on delete set null
);

create unique index if not exists content_routes_canonical_entry_locale_idx
  on content_routes(workspace_id, entry_id, locale)
  where is_canonical = true and status != 'archived';

create table if not exists content_route_history (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  route_id uuid not null,
  entry_id uuid references content_entries(id) on delete cascade,
  locale text not null,
  old_path text not null,
  new_path text not null,
  changed_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (route_id, workspace_id) references content_routes(id, workspace_id) on delete cascade
);

create table if not exists content_redirects (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  locale text,
  source_path text not null,
  target_path text not null,
  status_code integer not null check (status_code in (301, 302, 307, 308)) default 301,
  is_active boolean not null default true,
  description text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, locale, source_path)
);

create table if not exists content_redirect_history (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  redirect_id uuid not null,
  old_source_path text not null,
  new_source_path text not null,
  old_target_path text not null,
  new_target_path text not null,
  old_status_code integer not null,
  new_status_code integer not null,
  changed_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (redirect_id, workspace_id) references content_redirects(id, workspace_id) on delete cascade
);

create index if not exists content_routes_tree_idx on content_routes(workspace_id, parent_route_id, order_index);
create index if not exists content_redirects_lookup_idx on content_redirects(workspace_id, source_path) where is_active = true;

alter table content_routes enable row level security;
alter table content_route_history enable row level security;
alter table content_redirects enable row level security;
alter table content_redirect_history enable row level security;
