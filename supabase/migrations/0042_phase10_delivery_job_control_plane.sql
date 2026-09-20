-- Phase 10 — Delivery Operations Centre foundation.
-- Generic durable jobs, worker leases, attempt history, replay/dead-letter state,
-- correlation/idempotency, and destination health. Execution remains adapter-owned
-- by an external worker; Vercel request handlers are not the durable job engine.

create table if not exists delivery_jobs (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in (
    'publish',
    'scheduled_release',
    'webhook',
    'search_index',
    'image_processing',
    'health_scan',
    'analytics_sync'
  )),
  queue_name text not null default 'default',
  status text not null default 'queued' check (status in (
    'queued', 'running', 'retrying', 'succeeded', 'dead_letter', 'cancelled'
  )),
  priority integer not null default 100 check (priority between 0 and 1000),
  correlation_id uuid not null default gen_random_uuid(),
  idempotency_key text not null,
  payload_json jsonb not null default '{}'::jsonb,
  safe_metadata_json jsonb not null default '{}'::jsonb,
  run_after timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 25),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  replay_of_job_id uuid references delivery_jobs(id) on delete set null,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index if not exists delivery_jobs_ready_idx
  on delivery_jobs(queue_name, status, run_after, priority, created_at)
  where status in ('queued', 'retrying');
create index if not exists delivery_jobs_workspace_status_idx
  on delivery_jobs(workspace_id, status, created_at desc);
create index if not exists delivery_jobs_correlation_idx
  on delivery_jobs(workspace_id, correlation_id);

create table if not exists delivery_job_attempts (
  id uuid default gen_random_uuid() primary key,
  job_id uuid not null references delivery_jobs(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null,
  outcome text not null default 'running' check (outcome in (
    'running', 'succeeded', 'retrying', 'dead_letter', 'cancelled'
  )),
  request_metadata_json jsonb not null default '{}'::jsonb,
  response_metadata_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  unique (job_id, attempt_number)
);

create index if not exists delivery_job_attempts_job_idx
  on delivery_job_attempts(job_id, attempt_number desc);

create table if not exists delivery_destination_health (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  destination_kind text not null check (destination_kind in ('publication_target', 'webhook_subscription')),
  destination_id uuid not null,
  health_state text not null default 'unknown' check (health_state in ('unknown', 'healthy', 'degraded', 'unhealthy', 'disabled')),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_latency_ms integer check (last_latency_ms is null or last_latency_ms >= 0),
  last_error_code text,
  last_error_message text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, destination_kind, destination_id)
);

create index if not exists delivery_destination_health_workspace_idx
  on delivery_destination_health(workspace_id, health_state, updated_at desc);

alter table delivery_jobs enable row level security;
alter table delivery_job_attempts enable row level security;
alter table delivery_destination_health enable row level security;

-- Safe public data is never placed in these operational tables. Service boundary only.

create or replace function cms_enqueue_delivery_job(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_safe_metadata jsonb default '{}'::jsonb,
  p_run_after timestamptz default now(),
  p_priority integer default 100,
  p_max_attempts integer default 5,
  p_queue_name text default 'default',
  p_correlation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job delivery_jobs%rowtype;
begin
  if p_kind not in ('publish','scheduled_release','webhook','search_index','image_processing','health_scan','analytics_sync') then
    raise exception 'Unsupported delivery job kind: %', p_kind using errcode = '22023';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if p_priority < 0 or p_priority > 1000 then
    raise exception 'priority must be between 0 and 1000' using errcode = '22023';
  end if;
  if p_max_attempts < 1 or p_max_attempts > 25 then
    raise exception 'max_attempts must be between 1 and 25' using errcode = '22023';
  end if;

  insert into delivery_jobs (
    workspace_id, kind, queue_name, priority, correlation_id, idempotency_key,
    payload_json, safe_metadata_json, run_after, max_attempts, created_by
  ) values (
    p_workspace_id, p_kind, coalesce(nullif(btrim(p_queue_name), ''), 'default'), p_priority,
    coalesce(p_correlation_id, gen_random_uuid()), btrim(p_idempotency_key),
    coalesce(p_payload, '{}'::jsonb), coalesce(p_safe_metadata, '{}'::jsonb),
    coalesce(p_run_after, now()), p_max_attempts, p_actor_id
  )
  on conflict (workspace_id, idempotency_key) do update
    set updated_at = delivery_jobs.updated_at
  returning * into v_job;

  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'delivery.job.enqueued', 'delivery_job', v_job.id::text,
    jsonb_build_object('kind', v_job.kind, 'status', v_job.status, 'correlationId', v_job.correlation_id, 'idempotencyKey', v_job.idempotency_key)
  ) on conflict do nothing;

  return row_to_json(v_job)::jsonb;
end;
$$;

create or replace function cms_claim_delivery_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 60,
  p_queue_name text default 'default',
  p_kinds text[] default null
)
returns setof delivery_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_worker_id is null or btrim(p_worker_id) = '' then
    raise exception 'worker id is required' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 100 then
    raise exception 'claim limit must be between 1 and 100' using errcode = '22023';
  end if;
  if p_lease_seconds < 15 or p_lease_seconds > 3600 then
    raise exception 'lease seconds must be between 15 and 3600' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select id
    from delivery_jobs
    where queue_name = coalesce(nullif(btrim(p_queue_name), ''), 'default')
      and status in ('queued', 'retrying')
      and run_after <= now()
      and (lease_expires_at is null or lease_expires_at < now())
      and (p_kinds is null or kind = any(p_kinds))
    order by priority asc, run_after asc, created_at asc
    for update skip locked
    limit p_limit
  ), claimed as (
    update delivery_jobs j
    set status = 'running',
        attempt_count = j.attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  ), attempts as (
    insert into delivery_job_attempts (job_id, attempt_number, worker_id, outcome)
    select id, attempt_count, p_worker_id, 'running'
    from claimed
    on conflict (job_id, attempt_number) do nothing
    returning job_id
  )
  select c.* from claimed c;
end;
$$;

create or replace function cms_complete_delivery_job(
  p_job_id uuid,
  p_worker_id text,
  p_response_metadata jsonb default '{}'::jsonb,
  p_latency_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job delivery_jobs%rowtype;
begin
  select * into v_job from delivery_jobs where id = p_job_id for update;
  if not found then raise exception 'Delivery job not found' using errcode = 'P0002'; end if;
  if v_job.status <> 'running' or v_job.lease_owner is distinct from p_worker_id then
    raise exception 'Worker does not own the active lease' using errcode = 'P0003';
  end if;

  update delivery_job_attempts
  set outcome = 'succeeded', response_metadata_json = coalesce(p_response_metadata, '{}'::jsonb),
      latency_ms = p_latency_ms, completed_at = now()
  where job_id = p_job_id and attempt_number = v_job.attempt_count and worker_id = p_worker_id;

  update delivery_jobs
  set status = 'succeeded', lease_owner = null, lease_expires_at = null,
      last_error_code = null, last_error_message = null,
      completed_at = now(), updated_at = now()
  where id = p_job_id
  returning * into v_job;

  insert into platform_audit_events (workspace_id, action, entity_type, entity_id, metadata_json)
  values (v_job.workspace_id, 'delivery.job.succeeded', 'delivery_job', v_job.id::text,
          jsonb_build_object('attempt', v_job.attempt_count, 'correlationId', v_job.correlation_id, 'latencyMs', p_latency_ms))
  on conflict do nothing;

  return row_to_json(v_job)::jsonb;
end;
$$;

create or replace function cms_fail_delivery_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_response_metadata jsonb default '{}'::jsonb,
  p_latency_ms integer default null,
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job delivery_jobs%rowtype;
  v_terminal boolean;
  v_delay integer;
  v_outcome text;
begin
  select * into v_job from delivery_jobs where id = p_job_id for update;
  if not found then raise exception 'Delivery job not found' using errcode = 'P0002'; end if;
  if v_job.status <> 'running' or v_job.lease_owner is distinct from p_worker_id then
    raise exception 'Worker does not own the active lease' using errcode = 'P0003';
  end if;

  v_terminal := v_job.attempt_count >= v_job.max_attempts;
  v_outcome := case when v_terminal then 'dead_letter' else 'retrying' end;
  v_delay := coalesce(p_retry_after_seconds, least(3600, 5 * (2 ^ greatest(v_job.attempt_count - 1, 0))));
  if v_delay < 1 or v_delay > 86400 then
    raise exception 'retry delay must be between 1 and 86400 seconds' using errcode = '22023';
  end if;

  update delivery_job_attempts
  set outcome = v_outcome, response_metadata_json = coalesce(p_response_metadata, '{}'::jsonb),
      error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
      error_message = left(coalesce(p_error_message, 'Delivery failed'), 2000),
      latency_ms = p_latency_ms, completed_at = now()
  where job_id = p_job_id and attempt_number = v_job.attempt_count and worker_id = p_worker_id;

  update delivery_jobs
  set status = v_outcome,
      run_after = case when v_terminal then run_after else now() + make_interval(secs => v_delay) end,
      lease_owner = null, lease_expires_at = null,
      last_error_code = nullif(btrim(coalesce(p_error_code, '')), ''),
      last_error_message = left(coalesce(p_error_message, 'Delivery failed'), 2000),
      completed_at = case when v_terminal then now() else null end,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;

  insert into platform_audit_events (workspace_id, action, entity_type, entity_id, metadata_json)
  values (v_job.workspace_id,
          case when v_terminal then 'delivery.job.dead_lettered' else 'delivery.job.retry_scheduled' end,
          'delivery_job', v_job.id::text,
          jsonb_build_object('attempt', v_job.attempt_count, 'correlationId', v_job.correlation_id, 'errorCode', p_error_code, 'retryAfterSeconds', case when v_terminal then null else v_delay end))
  on conflict do nothing;

  return row_to_json(v_job)::jsonb;
end;
$$;

create or replace function cms_replay_delivery_job(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source delivery_jobs%rowtype;
  v_job delivery_jobs%rowtype;
  v_replay_token uuid := gen_random_uuid();
begin
  select * into v_source from delivery_jobs where workspace_id = p_workspace_id and id = p_job_id;
  if not found then raise exception 'Delivery job not found' using errcode = 'P0002'; end if;
  if v_source.status not in ('dead_letter', 'succeeded', 'cancelled') then
    raise exception 'Only terminal jobs can be replayed' using errcode = 'P0003';
  end if;

  insert into delivery_jobs (
    workspace_id, kind, queue_name, status, priority, correlation_id, idempotency_key,
    payload_json, safe_metadata_json, run_after, attempt_count, max_attempts,
    replay_of_job_id, created_by
  ) values (
    v_source.workspace_id, v_source.kind, v_source.queue_name, 'queued', v_source.priority,
    v_source.correlation_id, v_source.idempotency_key || ':replay:' || v_replay_token::text,
    v_source.payload_json, v_source.safe_metadata_json, now(), 0, v_source.max_attempts,
    v_source.id, p_actor_id
  ) returning * into v_job;

  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'delivery.job.replayed', 'delivery_job', v_job.id::text,
          jsonb_build_object('sourceJobId', v_source.id, 'correlationId', v_source.correlation_id))
  on conflict do nothing;

  return row_to_json(v_job)::jsonb;
end;
$$;

create or replace function cms_cancel_delivery_job(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job delivery_jobs%rowtype;
begin
  select * into v_job from delivery_jobs where workspace_id = p_workspace_id and id = p_job_id for update;
  if not found then raise exception 'Delivery job not found' using errcode = 'P0002'; end if;
  if v_job.status in ('succeeded','dead_letter','cancelled') then return row_to_json(v_job)::jsonb; end if;

  update delivery_job_attempts
  set outcome = 'cancelled', completed_at = now()
  where job_id = p_job_id and outcome = 'running';

  update delivery_jobs
  set status = 'cancelled', lease_owner = null, lease_expires_at = null,
      completed_at = now(), updated_at = now()
  where id = p_job_id
  returning * into v_job;

  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'delivery.job.cancelled', 'delivery_job', p_job_id::text,
          jsonb_build_object('correlationId', v_job.correlation_id))
  on conflict do nothing;

  return row_to_json(v_job)::jsonb;
end;
$$;

create or replace function cms_record_destination_health(
  p_workspace_id uuid,
  p_destination_kind text,
  p_destination_id uuid,
  p_success boolean,
  p_latency_ms integer default null,
  p_error_code text default null,
  p_error_message text default null,
  p_disabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row delivery_destination_health%rowtype;
begin
  if p_destination_kind not in ('publication_target','webhook_subscription') then
    raise exception 'Unsupported destination kind' using errcode = '22023';
  end if;
  if p_destination_kind = 'publication_target' and not exists (
    select 1 from publication_targets where id = p_destination_id and workspace_id = p_workspace_id
  ) then raise exception 'Publication target not found in workspace' using errcode = 'P0002'; end if;
  if p_destination_kind = 'webhook_subscription' and not exists (
    select 1 from webhook_subscriptions where id = p_destination_id and workspace_id = p_workspace_id
  ) then raise exception 'Webhook subscription not found in workspace' using errcode = 'P0002'; end if;

  insert into delivery_destination_health (
    workspace_id, destination_kind, destination_id, health_state, consecutive_failures,
    last_success_at, last_failure_at, last_latency_ms, last_error_code, last_error_message, updated_at
  ) values (
    p_workspace_id, p_destination_kind, p_destination_id,
    case when p_disabled then 'disabled' when p_success then 'healthy' else 'degraded' end,
    case when p_success then 0 else 1 end,
    case when p_success then now() else null end,
    case when p_success then null else now() end,
    p_latency_ms,
    case when p_success then null else p_error_code end,
    case when p_success then null else left(coalesce(p_error_message,'Delivery failed'), 2000) end,
    now()
  )
  on conflict (workspace_id, destination_kind, destination_id) do update
  set health_state = case
        when p_disabled then 'disabled'
        when p_success then 'healthy'
        when delivery_destination_health.consecutive_failures + 1 >= 5 then 'unhealthy'
        else 'degraded'
      end,
      consecutive_failures = case when p_success then 0 else delivery_destination_health.consecutive_failures + 1 end,
      last_success_at = case when p_success then now() else delivery_destination_health.last_success_at end,
      last_failure_at = case when p_success then delivery_destination_health.last_failure_at else now() end,
      last_latency_ms = p_latency_ms,
      last_error_code = case when p_success then null else p_error_code end,
      last_error_message = case when p_success then null else left(coalesce(p_error_message,'Delivery failed'), 2000) end,
      updated_at = now()
  returning * into v_row;

  return row_to_json(v_row)::jsonb;
end;
$$;

revoke execute on function cms_enqueue_delivery_job(uuid, uuid, text, text, jsonb, jsonb, timestamptz, integer, integer, text, uuid) from public;
revoke execute on function cms_claim_delivery_jobs(text, integer, integer, text, text[]) from public;
revoke execute on function cms_complete_delivery_job(uuid, text, jsonb, integer) from public;
revoke execute on function cms_fail_delivery_job(uuid, text, text, text, jsonb, integer, integer) from public;
revoke execute on function cms_replay_delivery_job(uuid, uuid, uuid) from public;
revoke execute on function cms_cancel_delivery_job(uuid, uuid, uuid) from public;
revoke execute on function cms_record_destination_health(uuid, text, uuid, boolean, integer, text, text, boolean) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_enqueue_delivery_job(uuid, uuid, text, text, jsonb, jsonb, timestamptz, integer, integer, text, uuid) from anon;
    revoke execute on function cms_claim_delivery_jobs(text, integer, integer, text, text[]) from anon;
    revoke execute on function cms_complete_delivery_job(uuid, text, jsonb, integer) from anon;
    revoke execute on function cms_fail_delivery_job(uuid, text, text, text, jsonb, integer, integer) from anon;
    revoke execute on function cms_replay_delivery_job(uuid, uuid, uuid) from anon;
    revoke execute on function cms_cancel_delivery_job(uuid, uuid, uuid) from anon;
    revoke execute on function cms_record_destination_health(uuid, text, uuid, boolean, integer, text, text, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_enqueue_delivery_job(uuid, uuid, text, text, jsonb, jsonb, timestamptz, integer, integer, text, uuid) from authenticated;
    revoke execute on function cms_claim_delivery_jobs(text, integer, integer, text, text[]) from authenticated;
    revoke execute on function cms_complete_delivery_job(uuid, text, jsonb, integer) from authenticated;
    revoke execute on function cms_fail_delivery_job(uuid, text, text, text, jsonb, integer, integer) from authenticated;
    revoke execute on function cms_replay_delivery_job(uuid, uuid, uuid) from authenticated;
    revoke execute on function cms_cancel_delivery_job(uuid, uuid, uuid) from authenticated;
    revoke execute on function cms_record_destination_health(uuid, text, uuid, boolean, integer, text, text, boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_enqueue_delivery_job(uuid, uuid, text, text, jsonb, jsonb, timestamptz, integer, integer, text, uuid) to service_role;
    grant execute on function cms_claim_delivery_jobs(text, integer, integer, text, text[]) to service_role;
    grant execute on function cms_complete_delivery_job(uuid, text, jsonb, integer) to service_role;
    grant execute on function cms_fail_delivery_job(uuid, text, text, text, jsonb, integer, integer) to service_role;
    grant execute on function cms_replay_delivery_job(uuid, uuid, uuid) to service_role;
    grant execute on function cms_cancel_delivery_job(uuid, uuid, uuid) to service_role;
    grant execute on function cms_record_destination_health(uuid, text, uuid, boolean, integer, text, text, boolean) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    grant execute on function cms_enqueue_delivery_job(uuid, uuid, text, text, jsonb, jsonb, timestamptz, integer, integer, text, uuid) to postgres;
    grant execute on function cms_claim_delivery_jobs(text, integer, integer, text, text[]) to postgres;
    grant execute on function cms_complete_delivery_job(uuid, text, jsonb, integer) to postgres;
    grant execute on function cms_fail_delivery_job(uuid, text, text, text, jsonb, integer, integer) to postgres;
    grant execute on function cms_replay_delivery_job(uuid, uuid, uuid) to postgres;
    grant execute on function cms_cancel_delivery_job(uuid, uuid, uuid) to postgres;
    grant execute on function cms_record_destination_health(uuid, text, uuid, boolean, integer, text, text, boolean) to postgres;
  end if;
end $$;
