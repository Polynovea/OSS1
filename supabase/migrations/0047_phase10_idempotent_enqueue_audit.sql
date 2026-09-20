-- Phase 10 closure: repeated idempotent enqueue calls must not emit duplicate
-- delivery.job.enqueued audit events.

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
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into v_job;

  if not found then
    select * into v_job
    from delivery_jobs
    where workspace_id = p_workspace_id and idempotency_key = btrim(p_idempotency_key);
    if not found then
      raise exception 'Could not resolve idempotent delivery job' using errcode = 'P0002';
    end if;
    return row_to_json(v_job)::jsonb;
  end if;

  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'delivery.job.enqueued', 'delivery_job', v_job.id::text,
    jsonb_build_object('kind', v_job.kind, 'status', v_job.status, 'correlationId', v_job.correlation_id, 'idempotencyKey', v_job.idempotency_key)
  );

  return row_to_json(v_job)::jsonb;
end;
$$;

revoke execute on function cms_enqueue_delivery_job(uuid,uuid,text,text,jsonb,jsonb,timestamptz,integer,integer,text,uuid) from public, anon, authenticated;
grant execute on function cms_enqueue_delivery_job(uuid,uuid,text,text,jsonb,jsonb,timestamptz,integer,integer,text,uuid) to service_role, postgres;
