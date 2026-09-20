-- Phase 5 — durable, workspace-scoped editorial collaboration.
--
-- Additive only. These records are intentionally separate from immutable
-- content_entry_versions: comments, assignments and watches describe the
-- review process around an entry/version and must never rewrite its history.
-- All browser access continues through authorized server routes; RLS is
-- enabled with default-deny, consistent with migrations 0007–0018.

create table if not exists content_assignments (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete cascade,
  assigned_to_admin_user_id uuid not null references admin_users(id) on delete cascade,
  assigned_by_admin_user_id uuid references admin_users(id) on delete set null,
  role text not null check (role in ('owner', 'author', 'reviewer', 'approver')) default 'owner',
  status text not null check (status in ('active', 'completed', 'cancelled')) default 'active',
  due_at timestamptz,
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entry_id, assigned_to_admin_user_id, role)
);

create table if not exists content_comments (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete cascade,
  entry_version_id uuid references content_entry_versions(id) on delete set null,
  parent_comment_id uuid references content_comments(id) on delete cascade,
  author_admin_user_id uuid references admin_users(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 8000),
  status text not null check (status in ('open', 'resolved')) default 'open',
  resolved_by_admin_user_id uuid references admin_users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'open' and resolved_at is null and resolved_by_admin_user_id is null) or status = 'resolved')
);

create table if not exists content_comment_mentions (
  comment_id uuid not null references content_comments(id) on delete cascade,
  mentioned_admin_user_id uuid not null references admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, mentioned_admin_user_id)
);

create table if not exists content_entry_watchers (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid not null references content_entries(id) on delete cascade,
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, admin_user_id)
);

create table if not exists editorial_notifications (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recipient_admin_user_id uuid not null references admin_users(id) on delete cascade,
  entry_id uuid references content_entries(id) on delete cascade,
  kind text not null check (kind in ('assignment', 'mention', 'comment_reply', 'workflow', 'due_soon')),
  payload_json jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists content_assignments_assignee_queue_idx
  on content_assignments (workspace_id, assigned_to_admin_user_id, status, due_at asc nulls last);
create index if not exists content_assignments_entry_idx
  on content_assignments (entry_id, status);
create index if not exists content_comments_entry_thread_idx
  on content_comments (workspace_id, entry_id, parent_comment_id, created_at);
create index if not exists content_comment_mentions_recipient_idx
  on content_comment_mentions (mentioned_admin_user_id, created_at desc);
create index if not exists editorial_notifications_inbox_idx
  on editorial_notifications (workspace_id, recipient_admin_user_id, read_at, created_at desc);

alter table content_assignments enable row level security;
alter table content_comments enable row level security;
alter table content_comment_mentions enable row level security;
alter table content_entry_watchers enable row level security;
alter table editorial_notifications enable row level security;

-- Manual verification after an authorized migration release:
-- 1. Confirm all five tables and seven indexes exist.
-- 2. Confirm duplicate assignment role rows, empty comments and cross-workspace
--    references are rejected by constraints/server authorization.
-- 3. Confirm anon access remains denied and server routes enforce membership.
