-- Phase 12.75 — deterministic remediation execution history and privacy-safe operational event stream.
-- This does not introduce ML authority. It creates governed outcome evidence that future models may consume.

create table if not exists operational_remediation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  remediation_key text not null references operational_remediation_registry(remediation_key) on delete restrict,
  source_drift_item_id uuid references operational_drift_items(id) on delete set null,
  target_type text not null,
  target_id text,
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  execution_mode text not null check(execution_mode in ('manual','approval_execute','policy_auto_repair')),
  status text not null default 'running' check(status in ('running','succeeded','failed','blocked','partial')),
  correlation_id uuid not null default gen_random_uuid(),
  safe_input_json jsonb not null default '{}'::jsonb,
  safe_result_json jsonb not null default '{}'::jsonb,
  verification_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_by uuid references admin_users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_remediation_runs_recent_idx on operational_remediation_runs(workspace_id,environment_id,started_at desc);

create table if not exists operational_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  event_type text not null,
  event_version integer not null default 1 check(event_version > 0),
  source_type text not null,
  source_id text,
  correlation_id uuid,
  occurred_at timestamptz not null default now(),
  features_json jsonb not null default '{}'::jsonb,
  outcome_json jsonb not null default '{}'::jsonb,
  privacy_class text not null default 'operational_minimized' check(privacy_class in ('operational_minimized','workspace_local_sensitive')),
  eligible_for_local_learning boolean not null default true,
  eligible_for_cross_install_learning boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_events_training_idx on operational_events(workspace_id,environment_id,event_type,occurred_at desc);

alter table operational_remediation_runs enable row level security;
alter table operational_events enable row level security;

insert into operational_remediation_registry(
  remediation_key,title,failure_class,deterministic_classification,
  detection_contract_json,repair_contract_json,verification_contract_json,compensation_contract_json
) values
  ('world.rediscover','Refresh stale operational observations','stale_observation','safe',
   '{"drift_suffix":".stale"}'::jsonb,'{"operation":"world.refresh"}'::jsonb,'{"postcondition":"fresh observed world state"}'::jsonb,'{}'::jsonb),
  ('delivery.replay','Replay recoverable durable delivery job','recoverable_queue_state','safe',
   '{"requires":"dead_letter_job_id"}'::jsonb,'{"operation":"delivery.replay"}'::jsonb,'{"postcondition":"replacement job queued"}'::jsonb,'{}'::jsonb)
on conflict(remediation_key) do update set
  title=excluded.title,
  failure_class=excluded.failure_class,
  deterministic_classification=excluded.deterministic_classification,
  detection_contract_json=excluded.detection_contract_json,
  repair_contract_json=excluded.repair_contract_json,
  verification_contract_json=excluded.verification_contract_json,
  compensation_contract_json=excluded.compensation_contract_json,
  updated_at=now();
