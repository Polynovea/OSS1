-- Phases 12-14: durable delivery control plane, signed event delivery, and locale lifecycle.
create table if not exists publication_targets (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  target_type text not null check (target_type in ('next_revalidate','webhook','static_build','search_index','cdn_purge','custom_http')),
  config_json_encrypted text not null,
  active boolean not null default true,
  created_by uuid references admin_users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists publication_jobs (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  target_id uuid not null references publication_targets(id) on delete restrict,
  release_id uuid references releases(id) on delete set null,
  entry_id uuid references content_entries(id) on delete set null,
  version_id uuid references content_entry_versions(id) on delete set null,
  idempotency_key text not null,
  status text not null check (status in ('queued','running','succeeded','failed','retrying','cancelled')) default 'queued',
  attempt_count integer not null default 0, max_attempts integer not null default 5,
  next_attempt_at timestamptz, started_at timestamptz, completed_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create table if not exists publication_delivery_logs (
  id uuid default gen_random_uuid() primary key, job_id uuid not null references publication_jobs(id) on delete cascade,
  attempt_number integer not null, status_code integer, outcome text not null, detail text, created_at timestamptz not null default now()
);
create table if not exists webhook_subscriptions (
  id uuid default gen_random_uuid() primary key, workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null, endpoint_url text not null, event_filters text[] not null default '{}',
  signing_secret_hash text not null, signing_secret_encrypted text not null, active boolean not null default true,
  consecutive_failures integer not null default 0, created_by uuid references admin_users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists webhook_deliveries (
  id uuid default gen_random_uuid() primary key, subscription_id uuid not null references webhook_subscriptions(id) on delete cascade,
  event_type text not null, event_id text not null, payload_json jsonb not null, status text not null check (status in ('queued','running','succeeded','failed','cancelled')) default 'queued',
  attempt_count integer not null default 0, next_attempt_at timestamptz, last_error text, response_status integer, completed_at timestamptz, created_at timestamptz not null default now(),
  unique (subscription_id, event_id)
);
create table if not exists workspace_locales (
  id uuid default gen_random_uuid() primary key, workspace_id uuid not null references workspaces(id) on delete cascade,
  locale text not null, enabled boolean not null default true, required boolean not null default false, is_default boolean not null default false, created_at timestamptz not null default now(), unique (workspace_id, locale)
);
create table if not exists content_entry_translations (
  id uuid default gen_random_uuid() primary key, workspace_id uuid not null references workspaces(id) on delete cascade,
  source_entry_id uuid not null references content_entries(id) on delete cascade,
  locale text not null, translated_entry_id uuid references content_entries(id) on delete set null,
  source_version_id uuid references content_entry_versions(id) on delete set null,
  reviewed_at timestamptz, stale_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (source_entry_id, locale)
);
create index if not exists publication_jobs_ready_idx on publication_jobs(workspace_id, status, next_attempt_at);
create index if not exists webhook_deliveries_ready_idx on webhook_deliveries(status, next_attempt_at);
create index if not exists content_entry_translations_source_idx on content_entry_translations(source_entry_id, locale);
alter table publication_targets enable row level security; alter table publication_jobs enable row level security; alter table publication_delivery_logs enable row level security;
alter table webhook_subscriptions enable row level security; alter table webhook_deliveries enable row level security; alter table workspace_locales enable row level security; alter table content_entry_translations enable row level security;
