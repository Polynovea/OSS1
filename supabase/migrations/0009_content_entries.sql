-- Phase 1, Milestone E — Generic Content Entry Engine.
--
-- Entries and every saved version are immutable records. The two pointer
-- columns on content_entries identify the working draft and last published
-- version without ever overwriting a historical payload. Relations are a
-- first-class projection, not an unqueryable convention hidden in JSONB.
-- Existing blog_posts is deliberately untouched; its staged compatibility
-- migration belongs in a later, separately verified migration.

create table if not exists content_entries (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_model_id uuid not null references content_models(id) on delete restrict,
  status text not null check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')) default 'draft',
  current_draft_version_id uuid,
  published_version_id uuid,
  created_by uuid references admin_users(id),
  updated_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists content_entry_versions (
  id uuid default gen_random_uuid() primary key,
  entry_id uuid not null references content_entries(id) on delete cascade,
  model_schema_version integer not null,
  version_number integer not null,
  data_jsonb jsonb not null default '{}'::jsonb,
  locale text not null default 'en',
  state text not null check (state in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'archived')) default 'draft',
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  change_summary text,
  unique (entry_id, version_number)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'content_entries_current_draft_version_fk') then
    alter table content_entries add constraint content_entries_current_draft_version_fk
      foreign key (current_draft_version_id) references content_entry_versions(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entries_published_version_fk') then
    alter table content_entries add constraint content_entries_published_version_fk
      foreign key (published_version_id) references content_entry_versions(id) on delete set null;
  end if;
end $$;

create table if not exists content_relations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source_entry_id uuid not null references content_entries(id) on delete cascade,
  source_version_id uuid not null references content_entry_versions(id) on delete cascade,
  source_field_key text not null,
  target_entry_id uuid references content_entries(id) on delete restrict,
  target_asset_id uuid,
  relation_type text not null default 'reference',
  created_at timestamptz not null default now(),
  check (target_entry_id is not null or target_asset_id is not null)
);

create unique index if not exists content_entries_unique_value_idx
  on content_entry_versions (entry_id, locale, version_number);
create index if not exists content_entries_workspace_model_idx on content_entries(workspace_id, content_model_id, updated_at desc);
create index if not exists content_entries_published_idx on content_entries(workspace_id, content_model_id) where published_version_id is not null;
create index if not exists content_entry_versions_entry_idx on content_entry_versions(entry_id, version_number desc);
create index if not exists content_relations_source_idx on content_relations(source_entry_id, source_version_id);
create index if not exists content_relations_target_entry_idx on content_relations(target_entry_id) where target_entry_id is not null;

alter table content_entries enable row level security;
alter table content_entry_versions enable row level security;
alter table content_relations enable row level security;
