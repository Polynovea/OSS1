-- Phase 12.75 — declarative, resumable data/schema migration strategy runs.
-- Raw transformation/backfill values are deliberately NOT persisted; callers must resupply
-- the same input and the controller verifies its SHA-256 hash before each resumed batch.

create table if not exists operational_migration_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  content_model_id uuid not null,
  assessment_id uuid not null references operational_change_assessments(id) on delete restrict,
  strategy_key text not null check(strategy_key in (
    'direct_metadata_change','staged_backfill','copy_transform_verify',
    'deduplicate_then_unique','deprecate_retain','maintenance_window'
  )),
  status text not null default 'planned' check(status in ('planned','running','paused','blocked','succeeded','failed','cancelled')),
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  input_hash_sha256 text not null,
  input_descriptor_json jsonb not null default '{}'::jsonb,
  provenance_json jsonb not null default '{}'::jsonb,
  plan_json jsonb not null default '{}'::jsonb,
  cursor_json jsonb not null default '{}'::jsonb,
  progress_json jsonb not null default '{"processed":0,"succeeded":0,"failed":0}'::jsonb,
  postcondition_json jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_by uuid references admin_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade,
  foreign key(content_model_id,workspace_id) references content_models(id,workspace_id) on delete cascade
);
create index if not exists operational_migration_runs_recent_idx on operational_migration_runs(workspace_id,environment_id,content_model_id,created_at desc);

create table if not exists operational_migration_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  migration_run_id uuid not null references operational_migration_runs(id) on delete cascade,
  batch_number integer not null check(batch_number > 0),
  status text not null check(status in ('running','succeeded','partial','failed','blocked')),
  cursor_before_json jsonb not null default '{}'::jsonb,
  cursor_after_json jsonb not null default '{}'::jsonb,
  processed_count integer not null default 0 check(processed_count >= 0),
  succeeded_count integer not null default 0 check(succeeded_count >= 0),
  failed_count integer not null default 0 check(failed_count >= 0),
  safe_results_json jsonb not null default '[]'::jsonb,
  error_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(migration_run_id,batch_number)
);
create index if not exists operational_migration_batches_run_idx on operational_migration_batches(migration_run_id,batch_number);

alter table operational_migration_runs enable row level security;
alter table operational_migration_batches enable row level security;
