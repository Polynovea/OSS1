-- Phase 12.5: bridge typed GA4 Connections into the Phase 11 analytics subsystem.

alter table analytics_connectors add column if not exists connection_id uuid;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='analytics_connectors_connection_workspace_fk') then
    alter table analytics_connectors add constraint analytics_connectors_connection_workspace_fk
      foreign key(connection_id,workspace_id) references workspace_connections(id,workspace_id) on delete restrict;
  end if;
end $$;
create unique index if not exists analytics_connectors_connection_unique_idx on analytics_connectors(connection_id) where connection_id is not null;

create or replace function cms_link_ga4_connection(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_connection_id uuid
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_connection workspace_connections%rowtype; v_connector analytics_connectors%rowtype;
begin
  select * into v_connection from workspace_connections where id=p_connection_id and workspace_id=p_workspace_id and connector_type='analytics.ga4' for update;
  if not found then raise exception 'GA4 connection not found in workspace' using errcode='P0002'; end if;
  select * into v_connector from analytics_connectors where connection_id=p_connection_id and workspace_id=p_workspace_id;
  if not found then
    insert into analytics_connectors(workspace_id,provider,name,credential_mode,config_json_encrypted,active,created_by,connection_id)
    values(p_workspace_id,'ga4',v_connection.name,'encrypted',null,v_connection.active,p_actor_id,p_connection_id)
    returning * into v_connector;
    insert into analytics_sync_state(connector_id,workspace_id,status,updated_at)
    values(v_connector.id,p_workspace_id,'never_synced',clock_timestamp()) on conflict(connector_id) do nothing;
  end if;
  update workspace_connections set legacy_resource_type='analytics_connector',legacy_resource_id=v_connector.id,updated_by=p_actor_id,updated_at=clock_timestamp() where id=p_connection_id;
  insert into platform_audit_events(workspace_id,actor_admin_user_id,action,entity_type,entity_id,metadata_json)
  values(p_workspace_id,p_actor_id,'connection.linked','workspace_connection',p_connection_id::text,jsonb_build_object('resourceType','analytics_connector','resourceId',v_connector.id))
  on conflict do nothing;
  return jsonb_build_object('connectionId',p_connection_id,'analyticsConnectorId',v_connector.id);
end $$;

revoke execute on function cms_link_ga4_connection(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function cms_link_ga4_connection(uuid,uuid,uuid) to service_role,postgres;
