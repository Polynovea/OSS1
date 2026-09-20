-- Phase 12.5 live repair: connection credential-reference keys must satisfy
-- workspace_secret_refs_secret_key_check by starting with a letter.
create or replace function cms_create_connection(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_environment_id uuid,
  p_connector_type text,
  p_connector_family text,
  p_name text,
  p_config_json jsonb,
  p_secret_provider_id uuid,
  p_secrets jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_connection workspace_connections%rowtype;
  v_secret jsonb;
  v_secret_ref workspace_secret_refs%rowtype;
begin
  if not exists(select 1 from workspace_environments where id=p_environment_id and workspace_id=p_workspace_id) then raise exception 'Environment not found in workspace' using errcode='P0002'; end if;
  if not exists(select 1 from workspace_secret_providers where id=p_secret_provider_id and workspace_id=p_workspace_id and environment_id=p_environment_id and status='active') then raise exception 'Active secret provider not found for environment' using errcode='P0002'; end if;
  insert into workspace_connections(workspace_id,environment_id,connector_type,connector_family,name,status,config_json,created_by,updated_by)
  values(p_workspace_id,p_environment_id,p_connector_type,p_connector_family,trim(p_name),'configured',coalesce(p_config_json,'{}'::jsonb),p_actor_id,p_actor_id)
  returning * into v_connection;
  for v_secret in select value from jsonb_array_elements(coalesce(p_secrets,'[]'::jsonb)) loop
    insert into workspace_secret_refs(workspace_id,environment_id,provider_id,secret_key,label,locator,encrypted_value,masked_hint,state,metadata_json,created_by,updated_by)
    values(p_workspace_id,p_environment_id,p_secret_provider_id,'connection:'||v_connection.id::text||':'||(v_secret->>'purpose'),coalesce(v_secret->>'label',v_secret->>'purpose'),v_secret->>'locator',nullif(v_secret->>'encryptedValue',''),nullif(v_secret->>'maskedHint',''),'unverified',coalesce(v_secret->'metadata','{}'::jsonb),p_actor_id,p_actor_id)
    returning * into v_secret_ref;
    insert into connection_secret_bindings(workspace_id,connection_id,secret_ref_id,purpose)
    values(p_workspace_id,v_connection.id,v_secret_ref.id,v_secret->>'purpose');
  end loop;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,after_json,metadata_json)
  values(p_workspace_id,p_actor_id,'connection.created','workspace_connection',v_connection.id::text,to_jsonb(v_connection),jsonb_build_object('secretPurposes',(select coalesce(jsonb_agg(value->>'purpose'),'[]'::jsonb) from jsonb_array_elements(coalesce(p_secrets,'[]'::jsonb)))));
  return jsonb_build_object('connection',to_jsonb(v_connection));
end $$;
revoke execute on function cms_create_connection(uuid,uuid,uuid,text,text,text,jsonb,uuid,jsonb) from public,anon,authenticated;
grant execute on function cms_create_connection(uuid,uuid,uuid,text,text,text,jsonb,uuid,jsonb) to service_role,postgres;
