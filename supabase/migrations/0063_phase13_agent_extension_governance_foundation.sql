-- Phase 13 — governed agent identities/provenance and constrained extension manifests.
-- This is the governance substrate. MCP/extension transports must consume these
-- contracts rather than creating privileged mutation paths.

create table if not exists agent_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_key text not null,
  name text not null,
  status text not null default 'active' check(status in ('active','suspended','revoked')),
  default_mode text not null default 'draft_only' check(default_mode in ('draft_only','scoped')),
  provider text,
  model text,
  metadata_json jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata_json)='object'),
  created_by uuid references admin_users(id) on delete set null,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(agent_key ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  unique(workspace_id,agent_key),
  unique(id,workspace_id)
);
create index if not exists agent_identities_workspace_status_idx
  on agent_identities(workspace_id,status,created_at desc);

alter table developer_api_tokens add column if not exists agent_identity_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='developer_api_tokens_agent_workspace_fk') then
    alter table developer_api_tokens add constraint developer_api_tokens_agent_workspace_fk
      foreign key(agent_identity_id,workspace_id) references agent_identities(id,workspace_id) on delete set null;
  end if;
end $$;
create index if not exists developer_api_tokens_agent_idx
  on developer_api_tokens(workspace_id,agent_identity_id) where agent_identity_id is not null;

create table if not exists agent_operation_provenance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  agent_identity_id uuid not null,
  developer_api_token_id uuid references developer_api_tokens(id) on delete set null,
  initiating_admin_user_id uuid references admin_users(id) on delete set null,
  request_id text not null,
  tool_name text not null,
  operation_class text not null check(operation_class in ('read','draft_write','high_risk')),
  status text not null check(status in ('requested','allowed','blocked','approval_required','succeeded','failed')),
  model_provider text,
  model_name text,
  source_context_json jsonb not null default '[]'::jsonb check(jsonb_typeof(source_context_json)='array'),
  changed_fields text[] not null default '{}',
  before_json jsonb,
  after_json jsonb,
  input_digest_sha256 text,
  approval_reference_type text,
  approval_reference_id text,
  operational_plan_id uuid references operational_change_plans(id) on delete set null,
  simulation_run_id uuid references operational_simulation_runs(id) on delete set null,
  evidence_package_id uuid references operational_evidence_packages(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata_json)='object'),
  occurred_at timestamptz not null default now(),
  foreign key(agent_identity_id,workspace_id) references agent_identities(id,workspace_id) on delete cascade,
  check(operation_class='read' or initiating_admin_user_id is not null),
  check(input_digest_sha256 is null or input_digest_sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists agent_operation_provenance_recent_idx
  on agent_operation_provenance(workspace_id,agent_identity_id,occurred_at desc);
create index if not exists agent_operation_provenance_request_idx
  on agent_operation_provenance(workspace_id,request_id);
create index if not exists agent_operation_provenance_operational_idx
  on agent_operation_provenance(workspace_id,operational_plan_id,simulation_run_id,evidence_package_id);

create table if not exists extension_manifests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  extension_key text not null,
  name text not null,
  version text not null,
  publisher text,
  compatible_core_versions text[] not null default '{}',
  requested_permissions text[] not null default '{}',
  routes_json jsonb not null default '[]'::jsonb check(jsonb_typeof(routes_json)='array'),
  events_json jsonb not null default '{}'::jsonb check(jsonb_typeof(events_json)='object'),
  fields_json jsonb not null default '[]'::jsonb check(jsonb_typeof(fields_json)='array'),
  admin_extensions_json jsonb not null default '[]'::jsonb check(jsonb_typeof(admin_extensions_json)='array'),
  network_requirements_json jsonb not null default '[]'::jsonb check(jsonb_typeof(network_requirements_json)='array'),
  required_capabilities text[] not null default '{}',
  requested_connections_json jsonb not null default '[]'::jsonb check(jsonb_typeof(requested_connections_json)='array'),
  manifest_json jsonb not null check(jsonb_typeof(manifest_json)='object'),
  manifest_sha256 text not null check(manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(extension_key ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  check(version ~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$'),
  unique(workspace_id,extension_key,version),
  unique(id,workspace_id)
);
create index if not exists extension_manifests_workspace_idx
  on extension_manifests(workspace_id,extension_key,created_at desc);

create table if not exists extension_installations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  manifest_id uuid not null,
  status text not null default 'proposed' check(status in ('proposed','installed','disabled','blocked','uninstalled')),
  granted_permissions text[] not null default '{}',
  granted_network_json jsonb not null default '[]'::jsonb check(jsonb_typeof(granted_network_json)='array'),
  granted_connections_json jsonb not null default '[]'::jsonb check(jsonb_typeof(granted_connections_json)='array'),
  configuration_json jsonb not null default '{}'::jsonb check(jsonb_typeof(configuration_json)='object'),
  installed_by uuid references admin_users(id) on delete set null,
  installed_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(manifest_id,workspace_id) references extension_manifests(id,workspace_id) on delete cascade,
  unique(workspace_id,manifest_id),
  unique(id,workspace_id)
);
create index if not exists extension_installations_workspace_status_idx
  on extension_installations(workspace_id,status,created_at desc);

create table if not exists extension_permission_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  installation_id uuid not null,
  permission_key text not null,
  decision text not null check(decision in ('granted','denied')),
  constraints_json jsonb not null default '{}'::jsonb check(jsonb_typeof(constraints_json)='object'),
  granted_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(installation_id,workspace_id) references extension_installations(id,workspace_id) on delete cascade,
  unique(installation_id,permission_key)
);
create index if not exists extension_permission_grants_workspace_idx
  on extension_permission_grants(workspace_id,installation_id,permission_key);

alter table agent_identities enable row level security;
alter table agent_operation_provenance enable row level security;
alter table extension_manifests enable row level security;
alter table extension_installations enable row level security;
alter table extension_permission_grants enable row level security;

comment on table agent_identities is 'Phase 13 governed agent identities. Draft-only is the default mode; scope grants remain separate and explicit.';
comment on table agent_operation_provenance is 'Phase 13 complete agent operation provenance linking initiating human, agent, tool, diff, approvals and operational proof references.';
comment on table extension_manifests is 'Phase 13 constrained declarative extension manifests. No implicit database, secret, filesystem or arbitrary network access is granted by a manifest.';
comment on table extension_installations is 'Workspace-scoped extension installations with explicit granted permissions/network/connections.';

update cms_runtime_state set schema_migration='0063',updated_at=now() where singleton=true;
