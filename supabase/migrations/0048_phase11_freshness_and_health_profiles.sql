-- Phase 11 closure: explicit analytics freshness aging and governed health-profile mutation.

create or replace function cms_age_analytics_freshness()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update analytics_sync_state
     set status = 'stale', updated_at = clock_timestamp()
   where status = 'fresh'
     and (fresh_through is null or fresh_through < current_date - 1);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function cms_upsert_content_health_profile(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid,
  p_owner_id uuid default null,
  p_review_cadence_days integer default null,
  p_last_reviewed_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns content_health_profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row content_health_profiles%rowtype;
begin
  if not exists(select 1 from content_entries where id=p_entry_id and workspace_id=p_workspace_id) then
    raise exception 'Entry not found in workspace' using errcode='P0002';
  end if;
  if p_owner_id is not null and not exists(
    select 1 from workspace_members where workspace_id=p_workspace_id and admin_user_id=p_owner_id and status='active'
  ) then
    raise exception 'Owner must be an active workspace member' using errcode='P0003';
  end if;
  if p_review_cadence_days is not null and (p_review_cadence_days < 1 or p_review_cadence_days > 3650) then
    raise exception 'review cadence must be between 1 and 3650 days' using errcode='22023';
  end if;

  insert into content_health_profiles(entry_id,workspace_id,owner_id,last_reviewed_at,review_cadence_days,expires_at,created_at,updated_at)
  values(p_entry_id,p_workspace_id,p_owner_id,p_last_reviewed_at,p_review_cadence_days,p_expires_at,clock_timestamp(),clock_timestamp())
  on conflict(entry_id) do update set
    owner_id=excluded.owner_id,
    last_reviewed_at=excluded.last_reviewed_at,
    review_cadence_days=excluded.review_cadence_days,
    expires_at=excluded.expires_at,
    updated_at=clock_timestamp()
  returning * into v_row;

  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
  values(p_workspace_id,p_actor_id,'content_health.profile_updated','content_entry',p_entry_id::text,
    jsonb_build_object('ownerId',p_owner_id,'reviewCadenceDays',p_review_cadence_days,'lastReviewedAt',p_last_reviewed_at,'expiresAt',p_expires_at));

  return v_row;
end;
$$;

revoke execute on function cms_age_analytics_freshness() from public,anon,authenticated;
revoke execute on function cms_upsert_content_health_profile(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function cms_age_analytics_freshness() to service_role,postgres;
grant execute on function cms_upsert_content_health_profile(uuid,uuid,uuid,uuid,integer,timestamptz,timestamptz) to service_role,postgres;
