-- Phase 12.5 — Environments, Connections & Guided Provisioning foundation.
-- First-class environment state, typed connection metadata, secret-provider references,
-- connector verification history, deployment capabilities, and service-only mutation RPCs.

-- ---------------------------------------------------------------------------
-- Permission catalog
-- ---------------------------------------------------------------------------
insert into permissions(key, description) values
  ('environment.read', 'View workspace environments and deployment readiness'),
  ('environment.manage', 'Create and configure workspace environments'),
  ('environment.provision', 'Provision, repair, or upgrade environment infrastructure'),
  ('connection.read', 'View configured external connections and verification state'),
  ('connection.manage', 'Create, edit, disable, and rotate external connections'),
  ('connection.verify', 'Run constrained connection verification checks'),
  ('secret.manage', 'Create, rotate, and rebind secret references without reading plaintext'),
  ('infrastructure.diagnose', 'Run environment and workspace infrastructure diagnostics'),
  ('infrastructure.backup', 'Create and verify workspace/environment backups'),
  ('infrastructure.restore', 'Restore workspace/environment backups'),
  ('infrastructure.upgrade', 'Plan and execute infrastructure/application upgrades')
on conflict(key) do nothing;

-- Existing owner/admin system roles receive the Phase 12.5 control-plane permissions.
-- High-risk restore/upgrade/provision permissions are intentionally owner-only by default.
insert into role_permissions(role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key = any(array[
  'environment.read','environment.manage','environment.provision',
  'connection.read','connection.manage','connection.verify','secret.manage',
  'infrastructure.diagnose','infrastructure.backup','infrastructure.restore','infrastructure.upgrade'
]::text[])
where r.key='owner'
on conflict do nothing;

insert into role_permissions(role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key = any(array[
  'environment.read','environment.manage',
  'connection.read','connection.manage','connection.verify',
  'infrastructure.diagnose','infrastructure.backup'
]::text[])
where r.key='admin'
on conflict do nothing;

insert into role_permissions(role_id, permission_key)
select r.id, p.key
from roles r
join permissions p on p.key = any(array['environment.read','connection.read']::text[])
where r.key in ('editor','viewer')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Environment model
-- ---------------------------------------------------------------------------
create table if not exists workspace_environments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('local','development','staging','production','custom')),
  status text not null default 'disconnected' check (status in ('provisioning','ready','degraded','blocked','maintenance','disconnected')),
  is_default boolean not null default false,
  cms_base_url text,
  public_site_urls jsonb not null default '[]'::jsonb check (jsonb_typeof(public_site_urls)='array'),
  database_provider text,
  storage_provider text,
  runtime_provider text,
  deployed_schema_hash text,
  deployed_schema_revision text,
  config_json jsonb not null default '{}'::jsonb,
  health_json jsonb not null default '{}'::jsonb,
  last_health_check_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,key),
  unique(id,workspace_id)
);

create unique index if not exists workspace_environments_one_default_idx
  on workspace_environments(workspace_id) where is_default;
create index if not exists workspace_environments_status_idx
  on workspace_environments(workspace_id,status,kind);

-- ---------------------------------------------------------------------------
-- Secret-provider abstraction. Secret metadata is portable; values are not.
-- ---------------------------------------------------------------------------
create table if not exists workspace_secret_providers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  provider_kind text not null check (provider_kind in ('environment','encrypted_postgres','supabase_vault','external')),
  name text not null,
  status text not null default 'active' check (status in ('active','degraded','disabled','unavailable')),
  config_json jsonb not null default '{}'::jsonb,
  created_by uuid references admin_users(id) on delete set null,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(environment_id,name),
  unique(id,workspace_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

alter table workspace_environments add column if not exists secret_provider_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='workspace_environments_secret_provider_workspace_fk') then
    alter table workspace_environments add constraint workspace_environments_secret_provider_workspace_fk
      foreign key(secret_provider_id,workspace_id) references workspace_secret_providers(id,workspace_id) on delete set null;
  end if;
end $$;

create table if not exists workspace_secret_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  provider_id uuid not null,
  secret_key text not null check (secret_key ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,127}$'),
  label text not null,
  locator text not null,
  encrypted_value text,
  masked_hint text,
  state text not null default 'unverified' check (state in ('missing','unverified','healthy','failed','expired','revoked','inaccessible')),
  metadata_json jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  rotated_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_id,secret_key),
  unique(id,workspace_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade,
  foreign key(provider_id,workspace_id) references workspace_secret_providers(id,workspace_id) on delete cascade
);
create index if not exists workspace_secret_refs_state_idx on workspace_secret_refs(workspace_id,environment_id,state);

-- ---------------------------------------------------------------------------
-- Typed connection instances + secret bindings + verification history.
-- ---------------------------------------------------------------------------
create table if not exists workspace_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  connector_type text not null check (connector_type ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  connector_family text not null check (connector_family in ('analytics','website','database','storage','search','webhook','communication','ai','custom')),
  name text not null check (length(trim(name)) between 1 and 120),
  status text not null default 'configured' check (status in ('unconfigured','configured','verifying','active','degraded','failed','disabled')),
  active boolean not null default true,
  config_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  last_verified_at timestamptz,
  last_success_at timestamptz,
  last_used_at timestamptz,
  last_error_code text,
  last_error_message text,
  legacy_resource_type text,
  legacy_resource_id uuid,
  created_by uuid references admin_users(id) on delete set null,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id,environment_id,connector_type,name),
  unique(id,workspace_id),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);
create index if not exists workspace_connections_status_idx on workspace_connections(workspace_id,environment_id,status,connector_family);

create table if not exists connection_secret_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null,
  secret_ref_id uuid not null,
  purpose text not null check (purpose ~ '^[a-z][a-z0-9_.-]{0,79}$'),
  created_at timestamptz not null default now(),
  unique(connection_id,purpose),
  foreign key(connection_id,workspace_id) references workspace_connections(id,workspace_id) on delete cascade,
  foreign key(secret_ref_id,workspace_id) references workspace_secret_refs(id,workspace_id) on delete restrict
);

create table if not exists connection_verifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  connection_id uuid not null,
  correlation_id uuid not null default gen_random_uuid(),
  status text not null check (status in ('passed','warning','failed')),
  checks_json jsonb not null default '[]'::jsonb check (jsonb_typeof(checks_json)='array'),
  safe_evidence_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  verified_by uuid references admin_users(id) on delete set null,
  verified_at timestamptz not null default now(),
  foreign key(connection_id,workspace_id) references workspace_connections(id,workspace_id) on delete cascade
);
create index if not exists connection_verifications_recent_idx on connection_verifications(workspace_id,connection_id,verified_at desc);

-- ---------------------------------------------------------------------------
-- Provider-neutral deployment capability projection (used by Setup/Doctor later).
-- ---------------------------------------------------------------------------
create table if not exists environment_components (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  environment_id uuid not null,
  capability_key text not null,
  component_key text not null,
  provider text,
  required boolean not null default true,
  state text not null default 'missing' check (state in ('present','missing','outdated','degraded','unsupported','deploying','failed')),
  current_version text,
  required_version text,
  metadata_json jsonb not null default '{}'::jsonb,
  last_deployed_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(environment_id,component_key),
  foreign key(environment_id,workspace_id) references workspace_environments(id,workspace_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Service-only mutation boundaries
-- ---------------------------------------------------------------------------
create or replace function cms_create_environment(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_key text,
  p_name text,
  p_kind text,
  p_is_default boolean default false,
  p_cms_base_url text default null,
  p_public_site_urls jsonb default '[]'::jsonb,
  p_database_provider text default null,
  p_storage_provider text default null,
  p_runtime_provider text default null,
  p_secret_provider_kind text default 'encrypted_postgres'
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_env workspace_environments%rowtype;
  v_provider workspace_secret_providers%rowtype;
begin
  if p_kind not in ('local','development','staging','production','custom') then raise exception 'Unsupported environment kind' using errcode='22023'; end if;
  if p_secret_provider_kind not in ('environment','encrypted_postgres','supabase_vault','external') then raise exception 'Unsupported secret provider' using errcode='22023'; end if;
  if p_is_default then update workspace_environments set is_default=false,updated_at=clock_timestamp(),updated_by=p_actor_id where workspace_id=p_workspace_id and is_default=true; end if;
  insert into workspace_environments(workspace_id,key,name,kind,status,is_default,cms_base_url,public_site_urls,database_provider,storage_provider,runtime_provider,created_by,updated_by)
  values(p_workspace_id,lower(trim(p_key)),trim(p_name),p_kind,'disconnected',p_is_default,p_cms_base_url,coalesce(p_public_site_urls,'[]'::jsonb),p_database_provider,p_storage_provider,p_runtime_provider,p_actor_id,p_actor_id)
  returning * into v_env;
  insert into workspace_secret_providers(workspace_id,environment_id,provider_kind,name,created_by,updated_by)
  values(p_workspace_id,v_env.id,p_secret_provider_kind,case when p_secret_provider_kind='environment' then 'Environment Variables' when p_secret_provider_kind='encrypted_postgres' then 'Encrypted PostgreSQL' else initcap(replace(p_secret_provider_kind,'_',' ')) end,p_actor_id,p_actor_id)
  returning * into v_provider;
  update workspace_environments set secret_provider_id=v_provider.id where id=v_env.id returning * into v_env;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,after_json,metadata_json)
  values(p_workspace_id,p_actor_id,'environment.created','workspace_environment',v_env.id::text,to_jsonb(v_env)-'health_json',jsonb_build_object('kind',p_kind,'secretProviderKind',p_secret_provider_kind));
  return jsonb_build_object('environment',to_jsonb(v_env),'secretProvider',to_jsonb(v_provider));
end $$;

create or replace function cms_update_environment(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_environment_id uuid,
  p_name text,
  p_status text,
  p_is_default boolean,
  p_cms_base_url text,
  p_public_site_urls jsonb,
  p_database_provider text,
  p_storage_provider text,
  p_runtime_provider text,
  p_config_json jsonb
) returns workspace_environments
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before workspace_environments%rowtype; v_after workspace_environments%rowtype;
begin
  select * into v_before from workspace_environments where id=p_environment_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Environment not found in workspace' using errcode='P0002'; end if;
  if p_status not in ('provisioning','ready','degraded','blocked','maintenance','disconnected') then raise exception 'Unsupported environment status' using errcode='22023'; end if;
  if p_is_default then update workspace_environments set is_default=false,updated_at=clock_timestamp(),updated_by=p_actor_id where workspace_id=p_workspace_id and id<>p_environment_id and is_default=true; end if;
  update workspace_environments set name=trim(p_name),status=p_status,is_default=p_is_default,cms_base_url=p_cms_base_url,public_site_urls=coalesce(p_public_site_urls,'[]'::jsonb),database_provider=p_database_provider,storage_provider=p_storage_provider,runtime_provider=p_runtime_provider,config_json=coalesce(p_config_json,'{}'::jsonb),updated_by=p_actor_id,updated_at=clock_timestamp()
  where id=p_environment_id returning * into v_after;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,before_json,after_json)
  values(p_workspace_id,p_actor_id,'environment.updated','workspace_environment',p_environment_id::text,to_jsonb(v_before)-'health_json',to_jsonb(v_after)-'health_json');
  return v_after;
end $$;

create or replace function cms_create_connection(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_environment_id uuid,
  p_connector_type text,
  p_connector_family text,
  p_name text,
  p_config_json jsonb,
  p_secret_provider_id uuid,
  p_secrets jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_connection workspace_connections%rowtype;
  v_secret jsonb;
  v_secret_ref workspace_secret_refs%rowtype;
begin
  if not exists(select 1 from workspace_environments where id=p_environment_id and workspace_id=p_workspace_id) then raise exception 'Environment not found in workspace' using errcode='P0002'; end if;
  if not exists(select 1 from workspace_secret_providers where id=p_secret_provider_id and workspace_id=p_workspace_id and environment_id=p_environment_id and status='active') then raise exception 'Active secret provider not found for environment' using errcode='P0002'; end if;
  insert into workspace_connections(workspace_id,environment_id,connector_type,connector_family,name,status,config_json,created_by,updated_by)
  values(p_workspace_id,p_environment_id,p_connector_type,p_connector_family,trim(p_name),'configured',coalesce(p_config_json,'{}'::jsonb),p_actor_id,p_actor_id)
  returning * into v_connection;
  for v_secret in select value from jsonb_array_elements(coalesce(p_secrets,'[]'::jsonb)) loop
    insert into workspace_secret_refs(workspace_id,environment_id,provider_id,secret_key,label,locator,encrypted_value,masked_hint,state,metadata_json,created_by,updated_by)
    values(p_workspace_id,p_environment_id,p_secret_provider_id,'connection:'||v_connection.id::text||':'||(v_secret->>'purpose'),coalesce(v_secret->>'label',v_secret->>'purpose'),v_secret->>'locator',nullif(v_secret->>'encryptedValue',''),nullif(v_secret->>'maskedHint',''),'unverified',coalesce(v_secret->'metadata','{}'::jsonb),p_actor_id,p_actor_id)
    returning * into v_secret_ref;
    insert into connection_secret_bindings(workspace_id,connection_id,secret_ref_id,purpose)
    values(p_workspace_id,v_connection.id,v_secret_ref.id,v_secret->>'purpose');
  end loop;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,after_json,metadata_json)
  values(p_workspace_id,p_actor_id,'connection.created','workspace_connection',v_connection.id::text,to_jsonb(v_connection),jsonb_build_object('secretPurposes',(select coalesce(jsonb_agg(value->>'purpose'),'[]'::jsonb) from jsonb_array_elements(coalesce(p_secrets,'[]'::jsonb)))));
  return jsonb_build_object('connection',to_jsonb(v_connection));
end $$;

create or replace function cms_rotate_connection_secret(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_connection_id uuid,
  p_purpose text,
  p_locator text,
  p_encrypted_value text,
  p_masked_hint text,
  p_metadata jsonb default '{}'::jsonb
) returns workspace_secret_refs
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_binding connection_secret_bindings%rowtype; v_ref workspace_secret_refs%rowtype;
begin
  select * into v_binding from connection_secret_bindings where connection_id=p_connection_id and workspace_id=p_workspace_id and purpose=p_purpose for update;
  if not found then raise exception 'Connection secret binding not found' using errcode='P0002'; end if;
  update workspace_secret_refs set locator=p_locator,encrypted_value=p_encrypted_value,masked_hint=p_masked_hint,state='unverified',metadata_json=coalesce(p_metadata,'{}'::jsonb),last_verified_at=null,rotated_at=clock_timestamp(),updated_by=p_actor_id,updated_at=clock_timestamp()
  where id=v_binding.secret_ref_id and workspace_id=p_workspace_id returning * into v_ref;
  update workspace_connections set status='configured',last_error_code=null,last_error_message=null,updated_by=p_actor_id,updated_at=clock_timestamp() where id=p_connection_id and workspace_id=p_workspace_id;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
  values(p_workspace_id,p_actor_id,'connection.secret_rotated','workspace_connection',p_connection_id::text,jsonb_build_object('purpose',p_purpose,'secretRefId',v_ref.id,'maskedHint',p_masked_hint));
  return v_ref;
end $$;

create or replace function cms_record_connection_verification(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_connection_id uuid,
  p_status text,
  p_checks jsonb,
  p_safe_evidence jsonb,
  p_error_code text,
  p_error_message text,
  p_duration_ms integer,
  p_correlation_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_ver connection_verifications%rowtype; v_connection workspace_connections%rowtype;
begin
  if p_status not in ('passed','warning','failed') then raise exception 'Unsupported verification status' using errcode='22023'; end if;
  select * into v_connection from workspace_connections where id=p_connection_id and workspace_id=p_workspace_id for update;
  if not found then raise exception 'Connection not found in workspace' using errcode='P0002'; end if;
  insert into connection_verifications(workspace_id,connection_id,correlation_id,status,checks_json,safe_evidence_json,error_code,error_message,duration_ms,verified_by)
  values(p_workspace_id,p_connection_id,coalesce(p_correlation_id,gen_random_uuid()),p_status,coalesce(p_checks,'[]'::jsonb),coalesce(p_safe_evidence,'{}'::jsonb),p_error_code,p_error_message,p_duration_ms,p_actor_id)
  returning * into v_ver;
  update workspace_connections set status=case when not active then 'disabled' when p_status='passed' then 'active' when p_status='warning' then 'degraded' else 'failed' end,last_verified_at=clock_timestamp(),last_success_at=case when p_status='passed' then clock_timestamp() else last_success_at end,last_error_code=case when p_status='failed' then p_error_code else null end,last_error_message=case when p_status='failed' then p_error_message else null end,updated_by=p_actor_id,updated_at=clock_timestamp()
  where id=p_connection_id returning * into v_connection;
  update workspace_secret_refs s set state=case when p_status='passed' then 'healthy' when p_status='failed' then 'failed' else s.state end,last_verified_at=clock_timestamp(),updated_at=clock_timestamp()
  from connection_secret_bindings b where b.connection_id=p_connection_id and b.secret_ref_id=s.id and b.workspace_id=p_workspace_id;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
  values(p_workspace_id,p_actor_id,'connection.verified','workspace_connection',p_connection_id::text,jsonb_build_object('status',p_status,'verificationId',v_ver.id,'correlationId',v_ver.correlation_id,'durationMs',p_duration_ms,'errorCode',p_error_code));
  return jsonb_build_object('connection',to_jsonb(v_connection),'verification',to_jsonb(v_ver));
end $$;

alter table workspace_environments enable row level security;
alter table workspace_secret_providers enable row level security;
alter table workspace_secret_refs enable row level security;
alter table workspace_connections enable row level security;
alter table connection_secret_bindings enable row level security;
alter table connection_verifications enable row level security;
alter table environment_components enable row level security;

revoke execute on function cms_create_environment(uuid,uuid,text,text,text,boolean,text,jsonb,text,text,text,text) from public,anon,authenticated;
revoke execute on function cms_update_environment(uuid,uuid,uuid,text,text,boolean,text,jsonb,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function cms_create_connection(uuid,uuid,uuid,text,text,text,jsonb,uuid,jsonb) from public,anon,authenticated;
revoke execute on function cms_rotate_connection_secret(uuid,uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke execute on function cms_record_connection_verification(uuid,uuid,uuid,text,jsonb,jsonb,text,text,integer,uuid) from public,anon,authenticated;

grant execute on function cms_create_environment(uuid,uuid,text,text,text,boolean,text,jsonb,text,text,text,text) to service_role,postgres;
grant execute on function cms_update_environment(uuid,uuid,uuid,text,text,boolean,text,jsonb,text,text,text,jsonb) to service_role,postgres;
grant execute on function cms_create_connection(uuid,uuid,uuid,text,text,text,jsonb,uuid,jsonb) to service_role,postgres;
grant execute on function cms_rotate_connection_secret(uuid,uuid,uuid,text,text,text,text,jsonb) to service_role,postgres;
grant execute on function cms_record_connection_verification(uuid,uuid,uuid,text,jsonb,jsonb,text,text,integer,uuid) to service_role,postgres;
