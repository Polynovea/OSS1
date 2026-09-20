-- Phase 1, Milestone H — Deterministic editorial workflow.
create table if not exists workflow_definitions (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  content_model_id uuid references content_models(id) on delete cascade,
  definition_json jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
create table if not exists workflow_instances (
  id uuid default gen_random_uuid() primary key,
  entry_id uuid not null references content_entries(id) on delete cascade,
  version_id uuid not null references content_entry_versions(id) on delete restrict,
  workflow_definition_id uuid not null references workflow_definitions(id) on delete restrict,
  current_state text not null check (current_state in ('in_review', 'approved', 'changes_requested', 'completed')),
  started_by uuid references admin_users(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists workflow_actions (
  id uuid default gen_random_uuid() primary key,
  workflow_instance_id uuid not null references workflow_instances(id) on delete cascade,
  actor_id uuid references admin_users(id),
  action text not null check (action in ('submitted', 'approved', 'changes_requested')),
  from_state text,
  to_state text not null,
  comment text,
  created_at timestamptz not null default now()
);
create unique index if not exists workflow_active_entry_idx on workflow_instances(entry_id) where completed_at is null;
create index if not exists workflow_instances_entry_idx on workflow_instances(entry_id, started_at desc);
alter table workflow_definitions enable row level security;
alter table workflow_instances enable row level security;
alter table workflow_actions enable row level security;

insert into workflow_definitions (workspace_id, name, definition_json)
select id, 'Default editorial workflow', '{"states":["draft","in_review","approved","published"],"transitions":{"draft":"in_review","in_review":["approved","changes_requested"],"approved":"published"},"self_approval":false}'::jsonb
from workspaces where slug = 'polynovea'
on conflict (workspace_id, name) do nothing;
