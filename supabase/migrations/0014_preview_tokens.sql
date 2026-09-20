-- Phase 1, Milestone J — Expiring, revocable draft preview tokens.
create table if not exists preview_tokens (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid references content_entries(id) on delete cascade,
  entry_version_id uuid not null references content_entry_versions(id) on delete cascade,
  token_hash text not null unique,
  locale text not null default 'en',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references admin_users(id),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists preview_tokens_hash_idx on preview_tokens(token_hash);
alter table preview_tokens enable row level security;
