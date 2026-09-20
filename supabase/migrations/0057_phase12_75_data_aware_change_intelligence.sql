-- Phase 12.75-D — data-aware migration and schema-change intelligence.
-- Stores aggregate target-data evidence only; no sampled content values or credentials.

create table if not exists operational_change_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  content_model_id uuid not null references content_models(id) on delete cascade,
  current_schema_version integer not null,
  proposed_schema_hash text not null,
  status text not null check(status in ('passed','warning','blocked','failed')),
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  schema_diff_json jsonb not null default '{}'::jsonb,
  data_profile_json jsonb not null default '{}'::jsonb,
  hard_blockers_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  alternatives_json jsonb not null default '[]'::jsonb,
  estimate_json jsonb not null default '{}'::jsonb,
  source_connection_id uuid references workspace_connections(id) on delete set null,
  correlation_id uuid not null default gen_random_uuid(),
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create index if not exists operational_change_assessments_recent_idx
  on operational_change_assessments(workspace_id, environment_id, content_model_id, created_at desc);

alter table operational_change_assessments enable row level security;

update cms_runtime_state
set schema_migration='0057', updated_at=now()
where singleton=true;
