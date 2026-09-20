-- Phase 12.75 — deterministic operational intelligence foundation.
-- Canonical world model, evidence-backed discovery, desired state, drift,
-- immutable change plans, simulation, durable execution DAGs, proof packages,
-- reconciliation history and policy-bounded remediation.

insert into permissions(key, description) values
  ('operational_intelligence.read', 'Read operational world model, drift, plans, simulations and evidence'),
  ('operational_intelligence.manage', 'Manage desired state, reconciliation and deterministic plans'),
  ('operational_intelligence.execute', 'Execute governed deterministic operational plans'),
  ('operational_intelligence.policy', 'Manage operational autonomy and remediation policy')
on conflict(key) do nothing;

insert into role_permissions(role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key = any(array[
  'operational_intelligence.read',
  'operational_intelligence.manage',
  'operational_intelligence.execute',
  'operational_intelligence.policy'
]::text[])
where r.key = 'owner'
on conflict do nothing;

insert into role_permissions(role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key = any(array[
  'operational_intelligence.read',
  'operational_intelligence.manage',
  'operational_intelligence.execute'
]::text[])
where r.key = 'admin'
on conflict do nothing;

-- High-impact operational plan execution reuses the Phase 12.5 two-person
-- approval boundary rather than inventing a second governance mechanism.
alter table infrastructure_approval_requests
  drop constraint if exists infrastructure_approval_requests_operation_check;
alter table infrastructure_approval_requests
  add constraint infrastructure_approval_requests_operation_check
  check(operation in (
    'schema_promote','restore','credential_rotate','component_deploy','upgrade','provision',
    'change_execute','auto_repair'
  ));

create table if not exists operational_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  status text not null default 'running' check(status in ('running','succeeded','partial','failed')),
  correlation_id uuid not null default gen_random_uuid(),
  source text not null default 'controller' check(source in ('controller','system_doctor','manual','api','scheduler')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary_json jsonb not null default '{}'::jsonb,
  error_json jsonb not null default '{}'::jsonb,
  created_by uuid references admin_users(id) on delete set null,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_discovery_runs_recent_idx
  on operational_discovery_runs(workspace_id, environment_id, started_at desc);

create table if not exists operational_world_nodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  node_key text not null,
  node_type text not null check(node_type in (
    'environment','database','auth','storage','secret_provider','runtime','component','connection',
    'website','api','analytics','search','schema','model','migration','worker','scheduler','backup',
    'release','job','other'
  )),
  provider text,
  capability_key text,
  display_name text not null,
  state text not null default 'unverified' check(state in (
    'supported','present','missing','outdated','degraded','unverified','unsupported','healthy','blocked','unknown'
  )),
  attributes_json jsonb not null default '{}'::jsonb,
  source_entity_type text,
  source_entity_id text,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  valid_until timestamptz,
  is_stale boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, environment_id, node_key),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_world_nodes_type_idx
  on operational_world_nodes(workspace_id, environment_id, node_type, state);
create index if not exists operational_world_nodes_stale_idx
  on operational_world_nodes(workspace_id, environment_id, is_stale, last_observed_at);

create table if not exists operational_world_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  from_node_id uuid not null references operational_world_nodes(id) on delete cascade,
  to_node_id uuid not null references operational_world_nodes(id) on delete cascade,
  relationship text not null check(relationship in (
    'runs_on','connects_to','authenticates_with','stores_in','served_by','publishes_to','measured_by',
    'depends_on','requires','maps_to','deployed_as','governed_by'
  )),
  attributes_json jsonb not null default '{}'::jsonb,
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  valid_until timestamptz,
  is_stale boolean not null default false,
  unique(environment_id, from_node_id, to_node_id, relationship),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_world_edges_from_idx on operational_world_edges(environment_id, from_node_id);
create index if not exists operational_world_edges_to_idx on operational_world_edges(environment_id, to_node_id);

create table if not exists operational_observations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  discovery_run_id uuid references operational_discovery_runs(id) on delete set null,
  node_id uuid references operational_world_nodes(id) on delete cascade,
  edge_id uuid references operational_world_edges(id) on delete cascade,
  fact_key text not null,
  observation_kind text not null check(observation_kind in ('observed','declared','inferred','desired')),
  source_type text not null,
  source_ref text,
  value_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  confidence numeric(5,4) check(confidence is null or (confidence >= 0 and confidence <= 1)),
  observed_at timestamptz not null default now(),
  valid_until timestamptz,
  check((node_id is not null)::integer + (edge_id is not null)::integer = 1),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_observations_node_idx
  on operational_observations(workspace_id, environment_id, node_id, observed_at desc);
create index if not exists operational_observations_run_idx
  on operational_observations(discovery_run_id, observed_at);

create table if not exists operational_desired_state_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  revision integer not null check(revision > 0),
  status text not null default 'draft' check(status in ('draft','active','superseded','archived')),
  source text not null default 'user' check(source in ('user','generated_baseline','api','import')),
  desired_json jsonb not null check(jsonb_typeof(desired_json)='object'),
  checksum_sha256 text not null,
  change_note text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique(environment_id, revision),
  unique(environment_id, checksum_sha256),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create unique index if not exists operational_desired_state_one_active_idx
  on operational_desired_state_revisions(environment_id) where status='active';

create table if not exists operational_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  desired_state_revision_id uuid not null references operational_desired_state_revisions(id) on delete restrict,
  discovery_run_id uuid references operational_discovery_runs(id) on delete set null,
  status text not null default 'running' check(status in ('running','converged','drifted','partial','failed')),
  correlation_id uuid not null default gen_random_uuid(),
  summary_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_reconciliation_recent_idx
  on operational_reconciliation_runs(workspace_id, environment_id, started_at desc);

create table if not exists operational_drift_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  desired_state_revision_id uuid not null references operational_desired_state_revisions(id) on delete cascade,
  reconciliation_run_id uuid references operational_reconciliation_runs(id) on delete set null,
  node_id uuid references operational_world_nodes(id) on delete set null,
  drift_key text not null,
  category text not null check(category in (
    'environment','capability','connection','schema','migration','runtime','website','worker','storage','secret','other'
  )),
  severity text not null check(severity in ('info','warning','blocking')),
  action_class text not null check(action_class in (
    'observe_only','recommend','safe_auto_repair','approval_required','manual_provider_action_required'
  )),
  state text not null default 'open' check(state in ('open','acknowledged','planned','resolved','ignored')),
  current_json jsonb not null default '{}'::jsonb,
  desired_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique(environment_id, desired_state_revision_id, drift_key),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_drift_open_idx
  on operational_drift_items(workspace_id, environment_id, state, severity, last_seen_at desc);

create table if not exists operational_autonomy_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  mode text not null default 'diagnose_only' check(mode in ('diagnose_only','recommend','approval_execute','policy_auto_repair')),
  allowed_remediation_keys text[] not null default '{}',
  max_deterministic_classification text not null default 'safe' check(max_deterministic_classification in ('safe','requires_lock','requires_backfill')),
  require_approval_for_production boolean not null default true,
  settings_json jsonb not null default '{}'::jsonb,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(environment_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create table if not exists operational_remediation_registry (
  remediation_key text primary key,
  title text not null,
  failure_class text not null,
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  detection_contract_json jsonb not null default '{}'::jsonb,
  repair_contract_json jsonb not null default '{}'::jsonb,
  verification_contract_json jsonb not null default '{}'::jsonb,
  compensation_contract_json jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into operational_remediation_registry(
  remediation_key,title,failure_class,deterministic_classification,
  detection_contract_json,repair_contract_json,verification_contract_json,compensation_contract_json
) values
  ('connection.reverify','Reverify connection','connection_verification','safe',
   '{"requires":"connection_id"}'::jsonb,'{"operation":"connection.verify"}'::jsonb,'{"postcondition":"connection.status=active"}'::jsonb,'{}'::jsonb),
  ('component.recheck','Recheck runtime component','component_health','safe',
   '{"requires":"component_id"}'::jsonb,'{"operation":"component.check"}'::jsonb,'{"postcondition":"component.state present|supported"}'::jsonb,'{}'::jsonb),
  ('system.doctor','Refresh deterministic diagnostics','environment_health','safe',
   '{"requires":"environment_id"}'::jsonb,'{"operation":"system.doctor"}'::jsonb,'{"postcondition":"doctor evidence refreshed"}'::jsonb,'{}'::jsonb)
on conflict(remediation_key) do update set
  title=excluded.title,
  failure_class=excluded.failure_class,
  deterministic_classification=excluded.deterministic_classification,
  detection_contract_json=excluded.detection_contract_json,
  repair_contract_json=excluded.repair_contract_json,
  verification_contract_json=excluded.verification_contract_json,
  compensation_contract_json=excluded.compensation_contract_json,
  updated_at=now();

create table if not exists operational_change_plans (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  desired_state_revision_id uuid not null references operational_desired_state_revisions(id) on delete restrict,
  source_reconciliation_run_id uuid references operational_reconciliation_runs(id) on delete set null,
  source_discovery_run_id uuid references operational_discovery_runs(id) on delete set null,
  name text not null,
  status text not null default 'planned' check(status in ('planned','reviewed','approved','executing','succeeded','partial','failed','stale','cancelled')),
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  requires_approval boolean not null default false,
  immutable_plan_json jsonb not null check(jsonb_typeof(immutable_plan_json)='object'),
  plan_checksum_sha256 text not null,
  alternative_group_id uuid,
  alternative_key text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  expires_at timestamptz,
  unique(environment_id, plan_checksum_sha256),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_change_plans_recent_idx
  on operational_change_plans(workspace_id, environment_id, created_at desc);

create table if not exists operational_change_plan_nodes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references operational_change_plans(id) on delete cascade,
  node_key text not null,
  ordinal integer not null default 0,
  operation text not null,
  target_type text not null,
  target_id text,
  deterministic_classification text not null check(deterministic_classification in (
    'safe','requires_lock','requires_backfill','requires_data_migration','potentially_destructive','destructive'
  )),
  approval_class text not null default 'none' check(approval_class in ('none','environment','high_risk')),
  retry_semantics text not null default 'none' check(retry_semantics in ('none','safe_retry','manual_retry')),
  idempotency_key text not null,
  timeout_seconds integer not null default 60 check(timeout_seconds between 1 and 86400),
  preconditions_json jsonb not null default '[]'::jsonb,
  input_json jsonb not null default '{}'::jsonb,
  verification_json jsonb not null default '{}'::jsonb,
  compensation_json jsonb not null default '{}'::jsonb,
  unique(plan_id, node_key),
  unique(plan_id, idempotency_key)
);
create index if not exists operational_change_plan_nodes_plan_idx on operational_change_plan_nodes(plan_id, ordinal, node_key);

create table if not exists operational_change_plan_edges (
  plan_id uuid not null references operational_change_plans(id) on delete cascade,
  from_node_id uuid not null references operational_change_plan_nodes(id) on delete cascade,
  to_node_id uuid not null references operational_change_plan_nodes(id) on delete cascade,
  edge_kind text not null default 'depends_on' check(edge_kind in ('depends_on','blocks','verifies')),
  primary key(plan_id, from_node_id, to_node_id, edge_kind),
  check(from_node_id <> to_node_id)
);

create table if not exists operational_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  plan_id uuid not null references operational_change_plans(id) on delete cascade,
  status text not null check(status in ('running','passed','warning','blocked','failed')),
  hard_blockers_json jsonb not null default '[]'::jsonb,
  warnings_json jsonb not null default '[]'::jsonb,
  side_effects_json jsonb not null default '[]'::jsonb,
  approval_json jsonb not null default '{}'::jsonb,
  rollback_coverage_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  correlation_id uuid not null default gen_random_uuid(),
  created_by uuid references admin_users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_simulation_runs_plan_idx on operational_simulation_runs(plan_id, started_at desc);

create table if not exists operational_execution_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  plan_id uuid not null references operational_change_plans(id) on delete restrict,
  simulation_run_id uuid references operational_simulation_runs(id) on delete set null,
  approval_request_id uuid references infrastructure_approval_requests(id) on delete set null,
  status text not null default 'running' check(status in ('running','succeeded','partial','failed','blocked','compensating','compensated','cancelled')),
  correlation_id uuid not null default gen_random_uuid(),
  started_by uuid references admin_users(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result_json jsonb not null default '{}'::jsonb,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists operational_execution_runs_plan_idx on operational_execution_runs(plan_id, started_at desc);

create table if not exists operational_execution_node_runs (
  id uuid primary key default gen_random_uuid(),
  execution_run_id uuid not null references operational_execution_runs(id) on delete cascade,
  plan_node_id uuid not null references operational_change_plan_nodes(id) on delete restrict,
  status text not null default 'pending' check(status in ('pending','running','succeeded','failed','blocked','skipped','compensated')),
  attempt integer not null default 0 check(attempt >= 0),
  safe_input_json jsonb not null default '{}'::jsonb,
  safe_result_json jsonb not null default '{}'::jsonb,
  verification_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  unique(execution_run_id, plan_node_id)
);

create table if not exists operational_evidence_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  execution_run_id uuid not null references operational_execution_runs(id) on delete cascade,
  plan_id uuid not null references operational_change_plans(id) on delete restrict,
  desired_state_revision_id uuid not null references operational_desired_state_revisions(id) on delete restrict,
  pre_discovery_run_id uuid references operational_discovery_runs(id) on delete set null,
  post_discovery_run_id uuid references operational_discovery_runs(id) on delete set null,
  post_reconciliation_run_id uuid references operational_reconciliation_runs(id) on delete set null,
  package_json jsonb not null check(jsonb_typeof(package_json)='object'),
  checksum_sha256 text not null,
  created_at timestamptz not null default now(),
  unique(execution_run_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

-- Operational state is service-bound. APIs enforce workspace permissions before
-- the service-role controller reads/writes these tables.
alter table operational_discovery_runs enable row level security;
alter table operational_world_nodes enable row level security;
alter table operational_world_edges enable row level security;
alter table operational_observations enable row level security;
alter table operational_desired_state_revisions enable row level security;
alter table operational_reconciliation_runs enable row level security;
alter table operational_drift_items enable row level security;
alter table operational_autonomy_policies enable row level security;
alter table operational_remediation_registry enable row level security;
alter table operational_change_plans enable row level security;
alter table operational_change_plan_nodes enable row level security;
alter table operational_change_plan_edges enable row level security;
alter table operational_simulation_runs enable row level security;
alter table operational_execution_runs enable row level security;
alter table operational_execution_node_runs enable row level security;
alter table operational_evidence_packages enable row level security;

update cms_runtime_state
set schema_migration='0056', updated_at=now()
where singleton=true;


create or replace function cms_activate_operational_desired_state(
  p_workspace_id uuid,
  p_environment_id uuid,
  p_revision_id uuid,
  p_actor_id uuid
) returns operational_desired_state_revisions
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v operational_desired_state_revisions%rowtype;
begin
  select * into v
  from operational_desired_state_revisions
  where id=p_revision_id and workspace_id=p_workspace_id and environment_id=p_environment_id
  for update;
  if not found then raise exception 'Desired-state revision not found' using errcode='P0002'; end if;
  if v.status='archived' then raise exception 'Archived desired-state revision cannot be activated' using errcode='P0003'; end if;

  update operational_desired_state_revisions
  set status='superseded'
  where workspace_id=p_workspace_id and environment_id=p_environment_id and status='active' and id<>p_revision_id;

  update operational_desired_state_revisions
  set status='active', activated_at=now()
  where id=p_revision_id
  returning * into v;

  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
  values(p_workspace_id,p_actor_id,'operational.desired_state.activated','operational_desired_state',v.id::text,
         jsonb_build_object('environmentId',p_environment_id,'revision',v.revision,'checksum',v.checksum_sha256));
  return v;
end $$;

revoke execute on function cms_activate_operational_desired_state(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function cms_activate_operational_desired_state(uuid,uuid,uuid,uuid) to service_role,postgres;
