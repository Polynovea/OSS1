-- Phase 10 closure: durable job producers for schedules, indexing, media and maintenance.
-- Producers are database-side so request completion is never required for a job to exist.

create or replace function cms_enqueue_release_schedule_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text;
begin
  if new.status = 'scheduled' and new.scheduled_for is not null then
    -- Cancel obsolete schedule jobs for this release before creating the new schedule.
    update delivery_jobs
      set status = 'cancelled', completed_at = clock_timestamp(), updated_at = clock_timestamp(),
          last_error_code = 'RESCHEDULED', last_error_message = 'Superseded by a newer release schedule'
    where workspace_id = new.workspace_id
      and kind = 'scheduled_release'
      and status in ('queued','retrying')
      and payload_json->>'releaseId' = new.id::text;

    v_key := 'scheduled-release:' || new.id::text || ':' || extract(epoch from new.scheduled_for)::bigint::text;
    perform cms_enqueue_delivery_job(
      new.workspace_id,
      new.updated_by,
      'scheduled_release',
      v_key,
      jsonb_build_object('releaseId', new.id, 'scheduledFor', new.scheduled_for, 'actorId', new.updated_by),
      jsonb_build_object('releaseId', new.id, 'releaseName', new.name, 'scheduledFor', new.scheduled_for),
      new.scheduled_for,
      75,
      5,
      'default',
      null
    );
  elsif old.status = 'scheduled' and new.status <> 'scheduled' then
    update delivery_jobs
      set status = 'cancelled', completed_at = clock_timestamp(), updated_at = clock_timestamp(),
          last_error_code = 'RELEASE_NO_LONGER_SCHEDULED', last_error_message = 'Release left scheduled state'
    where workspace_id = new.workspace_id
      and kind = 'scheduled_release'
      and status in ('queued','retrying')
      and payload_json->>'releaseId' = new.id::text;
  end if;
  return new;
end;
$$;

drop trigger if exists releases_enqueue_schedule_job on releases;
create trigger releases_enqueue_schedule_job
after update of status, scheduled_for on releases
for each row execute function cms_enqueue_release_schedule_job();

create or replace function cms_enqueue_entry_search_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_version uuid;
  v_key text;
begin
  v_version := coalesce(new.published_version_id, new.current_draft_version_id);
  if v_version is null then return new; end if;
  if tg_op = 'UPDATE' and
     new.current_draft_version_id is not distinct from old.current_draft_version_id and
     new.published_version_id is not distinct from old.published_version_id and
     new.status is not distinct from old.status then
    return new;
  end if;
  v_key := 'search-index:' || new.id::text || ':' || v_version::text || ':' || new.status::text;
  perform cms_enqueue_delivery_job(
    new.workspace_id,
    new.updated_by,
    'search_index',
    v_key,
    jsonb_build_object('entryId', new.id, 'versionId', v_version),
    jsonb_build_object('entryId', new.id, 'versionId', v_version, 'status', new.status),
    now(),
    120,
    3,
    'intelligence',
    null
  );
  return new;
end;
$$;

drop trigger if exists content_entries_enqueue_search_job on content_entries;
create trigger content_entries_enqueue_search_job
after insert or update of current_draft_version_id, published_version_id, status on content_entries
for each row execute function cms_enqueue_entry_search_job();

create or replace function cms_enqueue_image_processing_job()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.mime_type like 'image/%' then
    perform cms_enqueue_delivery_job(
      new.workspace_id,
      new.created_by,
      'image_processing',
      'image-process:' || new.id::text || ':' || new.checksum,
      jsonb_build_object('assetId', new.id),
      jsonb_build_object('assetId', new.id, 'filename', new.filename, 'mimeType', new.mime_type, 'sizeBytes', new.size_bytes),
      now(),
      150,
      3,
      'media',
      null
    );
  end if;
  return new;
end;
$$;

drop trigger if exists assets_enqueue_image_processing_job on assets;
create trigger assets_enqueue_image_processing_job
after insert on assets
for each row execute function cms_enqueue_image_processing_job();

-- Idempotent daily maintenance producer. Safe for every worker to call; unique
-- workspace/idempotency keys collapse concurrent producers.
create or replace function cms_enqueue_daily_maintenance_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace record;
  v_connector record;
  v_count integer := 0;
  v_day text := to_char(current_date, 'YYYY-MM-DD');
begin
  for v_workspace in select id from workspaces loop
    perform cms_enqueue_delivery_job(
      v_workspace.id, null, 'health_scan',
      'health-daily:' || v_workspace.id::text || ':' || v_day,
      jsonb_build_object('workspaceId', v_workspace.id),
      jsonb_build_object('scope', 'workspace', 'scheduled', true, 'date', v_day),
      now(), 200, 3, 'intelligence', null
    );
    v_count := v_count + 1;
  end loop;

  for v_connector in
    select id, workspace_id, provider from analytics_connectors where active = true
  loop
    perform cms_enqueue_delivery_job(
      v_connector.workspace_id, null, 'analytics_sync',
      'analytics-daily:' || v_connector.id::text || ':' || v_day,
      jsonb_build_object('connectorId', v_connector.id, 'freshThrough', current_date - 1),
      jsonb_build_object('connectorId', v_connector.id, 'provider', v_connector.provider, 'scheduled', true, 'freshThrough', current_date - 1),
      now(), 210, 3, 'intelligence', null
    );
    insert into analytics_sync_state(connector_id, workspace_id, status, updated_at)
      values(v_connector.id, v_connector.workspace_id, 'queued', clock_timestamp())
      on conflict(connector_id) do update set
        status = case when analytics_sync_state.status = 'running' then analytics_sync_state.status else 'queued' end,
        updated_at = clock_timestamp();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function cms_enqueue_release_schedule_job() from public, anon, authenticated;
revoke execute on function cms_enqueue_entry_search_job() from public, anon, authenticated;
revoke execute on function cms_enqueue_image_processing_job() from public, anon, authenticated;
revoke execute on function cms_enqueue_daily_maintenance_jobs() from public, anon, authenticated;
grant execute on function cms_enqueue_daily_maintenance_jobs() to service_role, postgres;
