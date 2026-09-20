-- Phase 12.5 closure: governed production credential rotation + runtime revision.

create or replace function cms_rotate_connection_secret_governed(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_connection_id uuid,
  p_purpose text,
  p_locator text,
  p_encrypted_value text,
  p_masked_hint text,
  p_metadata jsonb default '{}'::jsonb,
  p_approval_request_id uuid default null
) returns workspace_secret_refs
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_binding connection_secret_bindings%rowtype;
  v_ref workspace_secret_refs%rowtype;
  v_environment workspace_environments%rowtype;
  v_approval infrastructure_approval_requests%rowtype;
begin
  select e.* into v_environment
  from workspace_connections c
  join workspace_environments e on e.id=c.environment_id and e.workspace_id=c.workspace_id
  where c.id=p_connection_id and c.workspace_id=p_workspace_id
  for update of c;
  if not found then raise exception 'Connection not found in workspace' using errcode='P0002'; end if;

  if v_environment.kind='production' then
    if p_approval_request_id is null then raise exception 'Production credential rotation requires approval' using errcode='P0001'; end if;
    select * into v_approval from infrastructure_approval_requests
      where id=p_approval_request_id and workspace_id=p_workspace_id and environment_id=v_environment.id
        and operation='credential_rotate' and entity_id=p_connection_id::text and status='approved'
      for update;
    if not found then raise exception 'Approved credential rotation request not found' using errcode='P0001'; end if;
    if v_approval.expires_at is not null and v_approval.expires_at<=clock_timestamp() then raise exception 'Credential rotation approval expired' using errcode='P0001'; end if;
    if coalesce(v_approval.request_json->>'purpose',p_purpose)<>p_purpose then raise exception 'Credential rotation approval does not match purpose' using errcode='P0001'; end if;
  end if;

  select * into v_binding from connection_secret_bindings where connection_id=p_connection_id and workspace_id=p_workspace_id and purpose=p_purpose for update;
  if not found then raise exception 'Connection secret binding not found' using errcode='P0002'; end if;
  update workspace_secret_refs set locator=p_locator,encrypted_value=p_encrypted_value,masked_hint=p_masked_hint,state='unverified',metadata_json=coalesce(p_metadata,'{}'::jsonb),last_verified_at=null,rotated_at=clock_timestamp(),updated_by=p_actor_id,updated_at=clock_timestamp()
    where id=v_binding.secret_ref_id and workspace_id=p_workspace_id returning * into v_ref;
  update workspace_connections set status='configured',last_error_code=null,last_error_message=null,updated_by=p_actor_id,updated_at=clock_timestamp() where id=p_connection_id and workspace_id=p_workspace_id;
  if v_approval.id is not null then
    update infrastructure_approval_requests set status='executed',executed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_approval.id;
  end if;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
    values(p_workspace_id,p_actor_id,'connection.secret_rotated','workspace_connection',p_connection_id::text,jsonb_build_object('purpose',p_purpose,'secretRefId',v_ref.id,'maskedHint',p_masked_hint,'approvalRequestId',v_approval.id));
  return v_ref;
end $$;

revoke all on function cms_rotate_connection_secret_governed(uuid,uuid,uuid,text,text,text,text,jsonb,uuid) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke execute on function cms_rotate_connection_secret_governed(uuid,uuid,uuid,text,text,text,text,jsonb,uuid) from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke execute on function cms_rotate_connection_secret_governed(uuid,uuid,uuid,text,text,text,text,jsonb,uuid) from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function cms_rotate_connection_secret_governed(uuid,uuid,uuid,text,text,text,text,jsonb,uuid) to service_role; end if;
  if exists(select 1 from pg_roles where rolname='postgres') then grant execute on function cms_rotate_connection_secret_governed(uuid,uuid,uuid,text,text,text,text,jsonb,uuid) to postgres; end if;
end $$;

update cms_runtime_state set schema_migration='0055',updated_at=now() where singleton=true;
