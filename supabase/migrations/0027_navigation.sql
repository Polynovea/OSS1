-- Phase 7 — Versioned Navigation Menus & Draft/Published Lifecycle.
--
-- Enables governed multi-level navigation trees, draft preview, and instant rollback.

create table if not exists navigation_menus (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null check (char_length(trim(key)) between 1 and 120),
  name text not null check (char_length(trim(name)) between 1 and 120),
  description text,
  current_draft_version_id uuid,
  published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, key)
);

create table if not exists navigation_menu_versions (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  menu_id uuid not null,
  version_number integer not null,
  state text not null check (state in ('draft', 'published', 'archived')) default 'draft',
  items_jsonb jsonb not null default '[]'::jsonb,
  change_summary text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (menu_id, version_number),
  foreign key (menu_id, workspace_id) references navigation_menus(id, workspace_id) on delete cascade
);

alter table navigation_menus
  add constraint navigation_menus_draft_fk foreign key (current_draft_version_id, workspace_id) references navigation_menu_versions(id, workspace_id) on delete set null,
  add constraint navigation_menus_published_fk foreign key (published_version_id, workspace_id) references navigation_menu_versions(id, workspace_id) on delete set null;

create table if not exists navigation_items (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  menu_id uuid not null,
  parent_item_id uuid,
  label text not null,
  item_type text not null check (item_type in ('internal_entry', 'internal_route', 'external_url')),
  target_entry_id uuid references content_entries(id) on delete set null,
  target_route_id uuid,
  url text,
  open_in_new_tab boolean not null default false,
  audience_rule text not null check (audience_rule in ('all', 'authenticated', 'guest')) default 'all',
  order_index integer not null default 0,
  is_visible boolean not null default true,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (menu_id, workspace_id) references navigation_menus(id, workspace_id) on delete cascade,
  foreign key (parent_item_id, workspace_id) references navigation_items(id, workspace_id) on delete cascade,
  foreign key (target_route_id, workspace_id) references content_routes(id, workspace_id) on delete set null
);

create table if not exists navigation_item_localizations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  item_id uuid not null,
  locale text not null,
  label text not null,
  url_override text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, locale),
  foreign key (item_id, workspace_id) references navigation_items(id, workspace_id) on delete cascade
);

create index if not exists navigation_items_tree_idx on navigation_items(menu_id, parent_item_id, order_index);

alter table navigation_menus enable row level security;
alter table navigation_menu_versions enable row level security;
alter table navigation_items enable row level security;
alter table navigation_item_localizations enable row level security;
