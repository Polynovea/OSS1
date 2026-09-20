-- Phase 12.75 — governed operational ML feature, model, prediction and evaluation foundation.
-- ML is advisory only. Deterministic safety, permissions, approvals and verification remain authoritative.

create table if not exists operational_learning_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  local_learning_enabled boolean not null default true,
  cross_install_learning_opt_in boolean not null default false,
  content_level_features_enabled boolean not null default false,
  retention_days integer not null default 365 check(retention_days between 7 and 3650),
  settings_json jsonb not null default '{}'::jsonb,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id)
);

create table if not exists operational_feature_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  feature_family text not null,
  feature_contract_version integer not null default 1 check(feature_contract_version > 0),
  features_json jsonb not null default '{}'::jsonb,
  provenance_json jsonb not null default '{}'::jsonb,
  source_event_ids uuid[] not null default '{}',
  source_window_start timestamptz,
  source_window_end timestamptz,
  sample_support integer not null default 0 check(sample_support >= 0),
  checksum_sha256 text not null,
  captured_at timestamptz not null default now(),
  expires_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_feature_snapshots_recent_idx on operational_feature_snapshots(workspace_id,environment_id,feature_family,captured_at desc);

create table if not exists operational_model_registry (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  model_key text not null,
  model_family text not null check(model_family in (
    'migration_change_risk','execution_duration','failure_root_cause','subsystem_anomaly',
    'capacity_forecast','plan_ranking','dependency_impact','remediation_success',
    'maintenance_window','environment_health_forecast'
  )),
  task_type text not null check(task_type in ('classification','probability','duration','ranking','anomaly','forecast')),
  scope text not null default 'workspace_local' check(scope in ('workspace_local','cross_install_opt_in')),
  title text not null,
  description text,
  owner text not null default 'cms-operational-intelligence',
  enabled boolean not null default true,
  minimum_support integer not null default 20 check(minimum_support >= 1),
  feature_contract_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,model_key)
);

create table if not exists operational_model_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  model_id uuid not null references operational_model_registry(id) on delete cascade,
  version integer not null check(version > 0),
  status text not null default 'candidate' check(status in ('candidate','validated','deployed','retired','failed')),
  technique text not null,
  training_window_start timestamptz,
  training_window_end timestamptz,
  training_sample_count integer not null default 0 check(training_sample_count >= 0),
  validation_sample_count integer not null default 0 check(validation_sample_count >= 0),
  holdout_sample_count integer not null default 0 check(holdout_sample_count >= 0),
  feature_contract_json jsonb not null default '{}'::jsonb,
  artifact_json jsonb not null default '{}'::jsonb,
  metrics_json jsonb not null default '{}'::jsonb,
  calibration_json jsonb not null default '{}'::jsonb,
  integrity_sha256 text not null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  deployed_at timestamptz,
  unique(model_id,version)
);
create unique index if not exists operational_model_one_deployed_idx on operational_model_versions(model_id) where status='deployed';

create table if not exists operational_predictions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  model_id uuid not null references operational_model_registry(id) on delete restrict,
  model_version_id uuid references operational_model_versions(id) on delete set null,
  feature_snapshot_id uuid references operational_feature_snapshots(id) on delete set null,
  prediction_key text not null,
  subject_type text not null,
  subject_id text,
  status text not null check(status in ('ready','insufficient_data','out_of_distribution','stale','disabled','failed')),
  predicted_label text,
  probability double precision check(probability is null or (probability >= 0 and probability <= 1)),
  estimate double precision,
  interval_lower double precision,
  interval_upper double precision,
  confidence double precision check(confidence is null or (confidence >= 0 and confidence <= 1)),
  support_count integer not null default 0 check(support_count >= 0),
  calibration_state text not null default 'unavailable' check(calibration_state in ('calibrated','provisional','degraded','unavailable')),
  distribution_state text not null default 'unknown' check(distribution_state in ('in_distribution','low_support','out_of_distribution','unknown')),
  prediction_json jsonb not null default '{}'::jsonb,
  explanation_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_predictions_subject_idx on operational_predictions(workspace_id,environment_id,subject_type,subject_id,created_at desc);

create table if not exists operational_prediction_outcomes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prediction_id uuid not null references operational_predictions(id) on delete cascade,
  outcome_json jsonb not null default '{}'::jsonb,
  evaluation_json jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(prediction_id)
);

create table if not exists operational_model_evaluations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  model_version_id uuid not null references operational_model_versions(id) on delete cascade,
  evaluation_kind text not null check(evaluation_kind in ('validation','holdout','online','calibration','drift')),
  sample_count integer not null default 0 check(sample_count >= 0),
  metrics_json jsonb not null default '{}'::jsonb,
  distribution_json jsonb not null default '{}'::jsonb,
  status text not null default 'recorded' check(status in ('recorded','warning','failed')),
  evaluated_at timestamptz not null default now()
);

alter table operational_learning_policies enable row level security;
alter table operational_feature_snapshots enable row level security;
alter table operational_model_registry enable row level security;
alter table operational_model_versions enable row level security;
alter table operational_predictions enable row level security;
alter table operational_prediction_outcomes enable row level security;
alter table operational_model_evaluations enable row level security;
