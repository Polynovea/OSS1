-- Phase 12.75 — predictive plan comparison, governed human feedback, and learning lineage.

create table if not exists operational_plan_comparisons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  plan_id uuid not null references operational_change_plans(id) on delete cascade,
  comparison_json jsonb not null default '{}'::jsonb,
  selected_scenario_key text,
  selection_reason text,
  selected_by uuid references admin_users(id) on delete set null,
  selected_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_plan_comparisons_recent_idx
  on operational_plan_comparisons(workspace_id,environment_id,plan_id,created_at desc);

create table if not exists operational_prediction_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  prediction_id uuid not null references operational_predictions(id) on delete cascade,
  feedback_type text not null check(feedback_type in ('accepted','rejected','corrected','overridden')),
  corrected_label text,
  reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists operational_prediction_feedback_prediction_idx
  on operational_prediction_feedback(workspace_id,prediction_id,created_at desc);

alter table operational_plan_comparisons enable row level security;
alter table operational_prediction_feedback enable row level security;

update cms_runtime_state set schema_migration='0062',updated_at=now() where singleton=true;
