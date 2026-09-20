create extension if not exists pg_trgm;
create table if not exists content_search_documents (
  entry_id uuid primary key references content_entries(id) on delete cascade, workspace_id uuid not null references workspaces(id) on delete cascade,
  version_id uuid not null references content_entry_versions(id) on delete cascade, content_model_id uuid not null references content_models(id) on delete cascade,
  locale text not null, status text not null, author_id uuid references admin_users(id), search_text text not null default '', updated_at timestamptz not null default now()
);
create index if not exists content_search_documents_workspace_idx on content_search_documents(workspace_id, content_model_id, status, locale);
create index if not exists content_search_documents_trgm_idx on content_search_documents using gin (search_text gin_trgm_ops);
create table if not exists content_analytics_snapshots (
  id uuid default gen_random_uuid() primary key, workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete cascade, version_id uuid references content_entry_versions(id) on delete set null,
  destination_url text not null, source text not null default 'ga4', period_start date not null, period_end date not null,
  page_views bigint, users_count bigint, engagement_seconds numeric, conversions numeric, metrics_json jsonb not null default '{}'::jsonb, captured_at timestamptz not null default now(),
  unique (workspace_id, entry_id, version_id, source, period_start, period_end)
);
create table if not exists content_health_profiles (
  entry_id uuid primary key references content_entries(id) on delete cascade, workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_id uuid references admin_users(id), last_reviewed_at timestamptz, review_cadence_days integer, expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists content_analytics_snapshots_entry_idx on content_analytics_snapshots(entry_id, captured_at desc);
alter table content_search_documents enable row level security; alter table content_analytics_snapshots enable row level security; alter table content_health_profiles enable row level security;
