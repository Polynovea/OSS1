-- Phase 1, Milestone G — Workspace-scoped asset registry.
-- Object storage is accessed only through the provider interface in lib/media;
-- this table owns metadata, provenance, and lifecycle, never public URLs.

create table if not exists assets (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  storage_provider text not null,
  storage_key text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  width integer,
  height integer,
  checksum text not null,
  alt_text text,
  caption text,
  folder text not null default 'general',
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (workspace_id, checksum),
  unique (workspace_id, storage_key)
);
create table if not exists asset_tags (
  asset_id uuid not null references assets(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  primary key (asset_id, tag)
);
create index if not exists assets_workspace_folder_idx on assets(workspace_id, folder, created_at desc);
create index if not exists assets_workspace_mime_idx on assets(workspace_id, mime_type);
alter table assets enable row level security;
alter table asset_tags enable row level security;
