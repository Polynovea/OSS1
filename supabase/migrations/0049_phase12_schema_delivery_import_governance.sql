-- Phase 12 closure — schema-as-code/promotion and governed migration/import ledgers.

create table if not exists developer_schema_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  api_token_id uuid references developer_api_tokens(id) on delete set null,
  actor_admin_user_id uuid references admin_users(id) on delete set null,
  operation text not null check (operation in ('dry_run','push','promotion')),
  status text not null check (status in ('planned','blocked','applied','partially_applied','failed')),
  source_environment text,
  target_environment text,
  bundle_hash text not null,
  plan_json jsonb not null default '{}'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  approval_note text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists developer_schema_runs_workspace_idx
  on developer_schema_runs(workspace_id, created_at desc);

create table if not exists developer_import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  api_token_id uuid references developer_api_tokens(id) on delete set null,
  actor_admin_user_id uuid references admin_users(id) on delete set null,
  content_model_id uuid not null,
  format text not null check (format in ('json','csv','markdown','wordpress')),
  mode text not null check (mode in ('dry_run','commit')),
  status text not null check (status in ('planned','completed','partially_failed','failed')),
  source_name text,
  locale text not null default 'en',
  total_rows integer not null default 0 check (total_rows >= 0),
  succeeded_rows integer not null default 0 check (succeeded_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  errors_json jsonb not null default '[]'::jsonb,
  result_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (content_model_id, workspace_id) references content_models(id, workspace_id) on delete cascade
);

create index if not exists developer_import_runs_workspace_idx
  on developer_import_runs(workspace_id, created_at desc);

alter table developer_schema_runs enable row level security;
alter table developer_import_runs enable row level security;

comment on table developer_schema_runs is 'Auditable Phase 12 schema-as-code dry-run/push/promotion history. No secrets are stored.';
comment on table developer_import_runs is 'Auditable Phase 12 governed JSON/CSV/Markdown/WordPress import and migration history.';
