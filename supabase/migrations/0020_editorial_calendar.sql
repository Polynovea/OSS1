-- Phase 5 completion: workspace-scoped editorial calendar and scheduled review.
-- Events may reference one entry or release, but retain their own immutable
-- scheduling intent so changes to a workflow/release do not erase history.
create table if not exists editorial_calendar_events (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entry_id uuid references content_entries(id) on delete cascade,
  release_id uuid references releases(id) on delete cascade,
  kind text not null check (kind in ('draft_due', 'review_due', 'approval_due', 'publish', 'release', 'expiry', 'campaign')),
  title text not null check (char_length(trim(title)) between 1 and 240),
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null check (status in ('scheduled', 'completed', 'cancelled')) default 'scheduled',
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at),
  check (entry_id is not null or release_id is not null or kind = 'campaign')
);
create index if not exists editorial_calendar_events_workspace_range_idx on editorial_calendar_events (workspace_id, starts_at, status);
create index if not exists editorial_calendar_events_entry_idx on editorial_calendar_events (entry_id, starts_at) where entry_id is not null;
alter table editorial_calendar_events enable row level security;
