-- Phase 7 — Media Operations Expansion.
--
-- Adds hierarchical media collections and recoverable asset replacement history.

alter table assets add constraint assets_id_workspace_unique unique (id, workspace_id);

create table if not exists media_collections (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (char_length(trim(slug)) between 1 and 120),
  description text,
  parent_collection_id uuid,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, slug),
  foreign key (parent_collection_id, workspace_id) references media_collections(id, workspace_id) on delete cascade
);

create table if not exists media_collection_assets (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  collection_id uuid not null,
  asset_id uuid not null,
  position integer not null default 0,
  primary key (collection_id, asset_id),
  foreign key (collection_id, workspace_id) references media_collections(id, workspace_id) on delete cascade,
  foreign key (asset_id, workspace_id) references assets(id, workspace_id) on delete cascade
);

create table if not exists asset_replacement_history (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_id uuid not null,
  old_storage_provider text not null,
  old_storage_key text not null,
  old_checksum text not null,
  old_filename text not null,
  old_mime_type text not null,
  old_size_bytes bigint not null,
  old_width integer,
  old_height integer,
  new_storage_provider text not null,
  new_storage_key text not null,
  new_checksum text not null,
  new_filename text not null,
  new_mime_type text not null,
  new_size_bytes bigint not null,
  new_width integer,
  new_height integer,
  reason text,
  replaced_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (asset_id, workspace_id) references assets(id, workspace_id) on delete cascade
);

create index if not exists media_collections_tree_idx on media_collections(workspace_id, parent_collection_id);
create index if not exists media_collection_assets_asset_idx on media_collection_assets(workspace_id, asset_id);

alter table media_collections enable row level security;
alter table media_collection_assets enable row level security;
alter table asset_replacement_history enable row level security;
