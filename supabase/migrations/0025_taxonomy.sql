-- Phase 7 — Governed Workspace-Scoped Taxonomy Domain.
--
-- Includes hierarchical terms, localized labels, aliases, and version-aware term assignments.
-- Composite foreign keys guarantee cross-workspace container integrity.

create table if not exists taxonomies (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (char_length(trim(slug)) between 1 and 120),
  description text,
  hierarchical boolean not null default false,
  model_restrictions text[] default null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (workspace_id, slug)
);

create table if not exists taxonomy_terms (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  taxonomy_id uuid not null,
  parent_term_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  slug text not null check (char_length(trim(slug)) between 1 and 120),
  description text,
  order_index integer not null default 0,
  is_deprecated boolean not null default false,
  deprecated_by_term_id uuid,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (taxonomy_id, slug),
  foreign key (taxonomy_id, workspace_id) references taxonomies(id, workspace_id) on delete cascade,
  foreign key (parent_term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete set null,
  foreign key (deprecated_by_term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete set null
);

create table if not exists taxonomy_term_localizations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  term_id uuid not null,
  locale text not null,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (term_id, locale),
  foreign key (term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete cascade
);

create table if not exists taxonomy_term_aliases (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  term_id uuid not null,
  alias text not null,
  locale text,
  created_at timestamptz not null default now(),
  unique (term_id, alias),
  foreign key (term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete cascade
);

create table if not exists content_entry_version_terms (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete cascade,
  version_id uuid not null references content_entry_versions(id) on delete cascade,
  term_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (version_id, term_id),
  foreign key (term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete cascade
);

create index if not exists taxonomy_terms_tree_idx on taxonomy_terms(taxonomy_id, parent_term_id, order_index);
create index if not exists content_entry_version_terms_term_idx on content_entry_version_terms(workspace_id, term_id);
create index if not exists content_entry_version_terms_entry_idx on content_entry_version_terms(workspace_id, entry_id);

alter table taxonomies enable row level security;
alter table taxonomy_terms enable row level security;
alter table taxonomy_term_localizations enable row level security;
alter table taxonomy_term_aliases enable row level security;
alter table content_entry_version_terms enable row level security;
