-- Phase 1, Milestone C — Canonical Schema Engine + Content Model backend.
--
-- content_model_versions.schema_json is the canonical source of truth
-- (ADR-004). content_fields is a derived, read-optimized projection of the
-- CURRENT version's fields — rebuilt in application code
-- (lib/schema/modelService.ts) whenever a new version is applied, never
-- hand-edited directly. Do not write to content_fields from anywhere else.
--
-- All four tables are server-only, exactly like Milestone B's tables:
-- accessed only via app/api/models/** through
-- lib/platform/permissions.ts's requirePlatformAccess (schema.read /
-- schema.manage), using the service-role client. RLS enabled + deny-all
-- from creation, same standard as every table since Milestone A (ADR-002).

create table if not exists content_models (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  api_key text not null,
  description text,
  icon text,
  status text not null check (status in ('draft', 'active', 'archived')) default 'active',
  current_schema_version integer not null default 0,
  settings_json jsonb not null default '{}'::jsonb,
  created_by uuid references admin_users(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, api_key)
);

create table if not exists content_model_versions (
  id uuid default gen_random_uuid() primary key,
  content_model_id uuid not null references content_models(id) on delete cascade,
  version_number integer not null,
  schema_json jsonb not null,
  schema_hash text not null,
  change_summary text,
  created_by uuid references admin_users(id),
  created_at timestamptz default now(),
  unique (content_model_id, version_number)
);

create table if not exists content_fields (
  id uuid default gen_random_uuid() primary key,
  content_model_id uuid not null references content_models(id) on delete cascade,
  field_key text not null,
  label text not null,
  field_type text not null,
  position integer not null default 0,
  configuration_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (content_model_id, field_key)
);

create table if not exists platform_audit_events (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_admin_user_id uuid references admin_users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists content_models_workspace_idx on content_models(workspace_id);
create index if not exists content_model_versions_model_idx on content_model_versions(content_model_id);
create index if not exists content_fields_model_idx on content_fields(content_model_id);
create index if not exists platform_audit_events_workspace_idx on platform_audit_events(workspace_id);
create index if not exists platform_audit_events_created_at_idx on platform_audit_events(created_at desc);

alter table content_models enable row level security;
alter table content_model_versions enable row level security;
alter table content_fields enable row level security;
alter table platform_audit_events enable row level security;

-- Manual verification checklist:
-- 1. select count(*) from content_models; -- 0 immediately after this migration
-- 2. Confirm RLS is enabled on all four tables (relrowsecurity = true).
-- 3. Nothing in the existing application queries these tables yet — no
--    impact on Blog/Metrics/Content Tracking/Access/Workspace screens.
