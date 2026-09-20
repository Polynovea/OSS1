-- Phase 12.5 — full operability control plane.
-- Provisioning, component actions, system diagnostics, schema deployment state,
-- website bootstrap bindings, backup/restore, upgrades, and high-risk approvals.

insert into permissions(key, description) values
  ('schema.promote', 'Promote canonical schemas to governed environments'),
  ('deployment.manage', 'Deploy and repair environment runtime components'),
  ('website.manage', 'Bind and test website publishing destinations'),
  ('approval.review', 'Review high-risk infrastructure requests')
on conflict(key) do nothing;

insert into role_permissions(role_id,permission_key)
select r.id,p.key from roles r join permissions p on p.key=any(array['schema.promote','deployment.manage','website.manage','approval.review']::text[])
where r.key='owner' on conflict do nothing;
insert into role_permissions(role_id,permission_key)
select r.id,p.key from roles r join permissions p on p.key=any(array['schema.promote','deployment.manage','website.manage']::text[])
where r.key='admin' on conflict do nothing;

create table if not exists infrastructure_approval_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid,
  operation text not null check(operation in ('schema_promote','restore','credential_rotate','component_deploy','upgrade','provision')),
  entity_type text not null,
  entity_id text not null,
  requested_by uuid references admin_users(id) on delete set null,
  reason text,
  request_json jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','approved','rejected','executed','cancelled','expired')),
  reviewed_by uuid references admin_users(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  executed_at timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists infrastructure_approval_pending_idx on infrastructure_approval_requests(workspace_id,status,created_at desc);

create table if not exists environment_provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  provider_kind text not null check(provider_kind in ('managed','postgres','supabase','local')),
  operation text not null check(operation in ('preflight','initialize','upgrade','verify','repair')),
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','blocked','cancelled')),
  idempotency_key text not null,
  correlation_id uuid not null default gen_random_uuid(),
  safe_input_json jsonb not null default '{}'::jsonb,
  checks_json jsonb not null default '[]'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  last_error_code text,
  last_error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,idempotency_key),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create table if not exists environment_component_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  component_id uuid,
  operation text not null check(operation in ('check','deploy','redeploy','upgrade','repair')),
  status text not null default 'queued' check(status in ('queued','running','succeeded','failed','blocked','unsupported')),
  provider text,
  correlation_id uuid not null default gen_random_uuid(),
  safe_request_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  generated_instructions text,
  last_error text,
  created_by uuid references admin_users(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade,
  foreign key(component_id) references environment_components(id) on delete set null
);

create table if not exists environment_schema_deployments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  content_model_id uuid not null,
  schema_version integer not null check(schema_version>0),
  schema_hash text not null,
  status text not null default 'deployed' check(status in ('planned','deployed','drifted','failed','rolled_back')),
  source_environment_id uuid,
  developer_schema_run_id uuid references developer_schema_runs(id) on delete set null,
  deployed_by uuid references admin_users(id) on delete set null,
  deployed_at timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb,
  unique(environment_id,content_model_id,schema_version),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade,
  foreign key(source_environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete set null,
  foreign key(content_model_id,workspace_id) references content_models(id,workspace_id) on delete cascade
);
create index if not exists environment_schema_current_idx on environment_schema_deployments(workspace_id,environment_id,content_model_id,deployed_at desc);

create table if not exists website_connection_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  connection_id uuid not null,
  publication_target_id uuid references publication_targets(id) on delete set null,
  integration_method text not null check(integration_method in ('polynovea_rest','signed_webhook','custom_rest','wordpress')),
  model_api_keys text[] not null default '{}',
  route_mapping_json jsonb not null default '{}'::jsonb,
  status text not null default 'configured' check(status in ('configured','testing','active','degraded','failed','disabled')),
  last_test_job_id uuid references delivery_jobs(id) on delete set null,
  last_test_at timestamptz,
  last_error text,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(environment_id,connection_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade,
  foreign key(connection_id,workspace_id) references workspace_connections(id,workspace_id) on delete cascade
);

create table if not exists system_doctor_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  status text not null check(status in ('healthy','warning','blocked','failed')),
  correlation_id uuid not null default gen_random_uuid(),
  findings_json jsonb not null default '[]'::jsonb check(jsonb_typeof(findings_json)='array'),
  summary_json jsonb not null default '{}'::jsonb,
  checked_by uuid references admin_users(id) on delete set null,
  checked_at timestamptz not null default now(),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists system_doctor_recent_idx on system_doctor_runs(workspace_id,environment_id,checked_at desc);

create table if not exists workspace_backups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  backup_kind text not null default 'workspace' check(backup_kind in ('workspace','local_runtime')),
  status text not null default 'creating' check(status in ('creating','verified','failed','restored','superseded')),
  format_version integer not null default 1,
  checksum_sha256 text,
  manifest_json jsonb not null default '{}'::jsonb,
  payload_json jsonb,
  storage_locator text,
  size_bytes bigint,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  restored_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create table if not exists workspace_restore_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  backup_id uuid not null references workspace_backups(id) on delete restrict,
  mode text not null check(mode in ('dry_run','restore')),
  status text not null check(status in ('planned','blocked','running','succeeded','failed')),
  compatibility_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  approval_request_id uuid references infrastructure_approval_requests(id) on delete set null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create table if not exists environment_upgrade_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  from_app_version text,
  to_app_version text,
  current_migration text,
  target_migration text,
  status text not null default 'planned' check(status in ('planned','blocked','running','succeeded','failed','cancelled')),
  risk text not null default 'safe' check(risk in ('safe','review','destructive')),
  plan_json jsonb not null default '{}'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  backup_id uuid references workspace_backups(id) on delete set null,
  approval_request_id uuid references infrastructure_approval_requests(id) on delete set null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

create table if not exists cms_runtime_state (
  singleton boolean primary key default true check(singleton),
  schema_migration text not null,
  app_version text,
  worker_version text,
  updated_at timestamptz not null default now()
);
insert into cms_runtime_state(singleton,schema_migration,app_version,worker_version)
values(true,'0053','1.0.0','1.0.0')
on conflict(singleton) do update set schema_migration=excluded.schema_migration,updated_at=now();

alter table infrastructure_approval_requests enable row level security;
alter table environment_provisioning_runs enable row level security;
alter table environment_component_runs enable row level security;
alter table environment_schema_deployments enable row level security;
alter table website_connection_bindings enable row level security;
alter table system_doctor_runs enable row level security;
alter table workspace_backups enable row level security;
alter table workspace_restore_runs enable row level security;
alter table environment_upgrade_runs enable row level security;
alter table cms_runtime_state enable row level security;

-- Service-only approval boundary. Requesters cannot self-approve.
create or replace function cms_request_infrastructure_approval(
 p_workspace_id uuid,p_environment_id uuid,p_actor_id uuid,p_operation text,p_entity_type text,p_entity_id text,p_reason text,p_request_json jsonb default '{}'::jsonb
) returns infrastructure_approval_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v infrastructure_approval_requests%rowtype;
begin
 if p_operation not in ('schema_promote','restore','credential_rotate','component_deploy','upgrade','provision') then raise exception 'Unsupported approval operation' using errcode='22023'; end if;
 insert into infrastructure_approval_requests(workspace_id,environment_id,operation,entity_type,entity_id,requested_by,reason,request_json,expires_at)
 values(p_workspace_id,p_environment_id,p_operation,p_entity_type,p_entity_id,p_actor_id,nullif(trim(p_reason),''),coalesce(p_request_json,'{}'::jsonb),now()+interval '24 hours') returning * into v;
 insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json) values(p_workspace_id,p_actor_id,'infrastructure.approval_requested','infrastructure_approval',v.id::text,jsonb_build_object('operation',p_operation,'environmentId',p_environment_id));
 return v;
end $$;

create or replace function cms_review_infrastructure_approval(
 p_workspace_id uuid,p_actor_id uuid,p_request_id uuid,p_decision text,p_note text default null
) returns infrastructure_approval_requests language plpgsql security definer set search_path=public,pg_temp as $$
declare v infrastructure_approval_requests%rowtype;
begin
 select * into v from infrastructure_approval_requests where id=p_request_id and workspace_id=p_workspace_id for update;
 if not found then raise exception 'Approval request not found' using errcode='P0002'; end if;
 if v.status<>'pending' or (v.expires_at is not null and v.expires_at<=now()) then raise exception 'Approval request is not reviewable' using errcode='P0003'; end if;
 if v.requested_by=p_actor_id then raise exception 'Requester cannot approve their own high-risk operation' using errcode='40300'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected' using errcode='22023'; end if;
 update infrastructure_approval_requests set status=p_decision,reviewed_by=p_actor_id,review_note=p_note,reviewed_at=now(),updated_at=now() where id=p_request_id returning * into v;
 insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json) values(p_workspace_id,p_actor_id,'infrastructure.approval_reviewed','infrastructure_approval',v.id::text,jsonb_build_object('decision',p_decision,'operation',v.operation));
 return v;
end $$;

revoke execute on function cms_request_infrastructure_approval(uuid,uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function cms_review_infrastructure_approval(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function cms_request_infrastructure_approval(uuid,uuid,uuid,text,text,text,text,jsonb) to service_role,postgres;
grant execute on function cms_review_infrastructure_approval(uuid,uuid,uuid,text,text) to service_role,postgres;
