-- Phase 12 — Developer Platform foundation.
-- Scoped service tokens, fixed-window API rate limiting, and audit-safe token lifecycle.

create table if not exists developer_api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  token_prefix text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  allowed_models text[] not null default '{}',
  rate_limit_per_minute integer not null default 120 check (rate_limit_per_minute between 1 and 10000),
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(workspace_id, name)
);

create index if not exists developer_api_tokens_workspace_idx
  on developer_api_tokens(workspace_id, created_at desc);
create index if not exists developer_api_tokens_active_idx
  on developer_api_tokens(workspace_id, revoked_at, expires_at);

create table if not exists developer_api_rate_windows (
  token_id uuid not null references developer_api_tokens(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key(token_id, window_start)
);

create index if not exists developer_api_rate_windows_cleanup_idx
  on developer_api_rate_windows(window_start);

alter table developer_api_tokens enable row level security;
alter table developer_api_rate_windows enable row level security;

create or replace function cms_consume_developer_api_rate_limit(
  p_token_id uuid,
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if p_limit < 1 then
    raise exception 'Rate limit must be positive';
  end if;

  insert into developer_api_rate_windows(token_id, window_start, request_count, updated_at)
  values(p_token_id, v_window, 1, now())
  on conflict(token_id, window_start) do update
    set request_count = developer_api_rate_windows.request_count + 1,
        updated_at = now()
  returning request_count into v_count;

  return jsonb_build_object(
    'allowed', v_count <= p_limit,
    'limit', p_limit,
    'remaining', greatest(p_limit - v_count, 0),
    'resetAt', v_window + interval '1 minute',
    'count', v_count
  );
end;
$$;

revoke all on function cms_consume_developer_api_rate_limit(uuid, integer) from public, anon, authenticated;
grant execute on function cms_consume_developer_api_rate_limit(uuid, integer) to service_role;

comment on table developer_api_tokens is 'Phase 12 service/API tokens. Only a SHA-256 token hash is persisted; plaintext is returned once at creation.';
comment on table developer_api_rate_windows is 'Fixed-window per-token request counters for the Phase 12 stable REST API.';
