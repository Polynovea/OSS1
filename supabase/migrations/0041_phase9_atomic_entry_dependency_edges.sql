-- Migration 0041: Phase 9 — atomic entry-origin dependency edges
-- Extends the existing canonical create/save RPC relation payload from entry-only
-- targets to entry, asset and route targets while keeping every edge in the same
-- transaction as the immutable entry version.

create or replace function cms_create_content_entry(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_model_id uuid,
  p_data_jsonb jsonb,
  p_locale text default 'en',
  p_change_summary text default 'Initial draft',
  p_unique_reservations jsonb default '[]'::jsonb,
  p_relations jsonb default '[]'::jsonb,
  p_search_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model record;
  v_entry record;
  v_version record;
  v_res jsonb;
  v_rel jsonb;
  v_target_type text;
begin
  select * into v_model from content_models where workspace_id = p_workspace_id and id = p_model_id;
  if not found or v_model.status != 'active' then
    raise exception 'Active content model % not found in workspace %', p_model_id, p_workspace_id;
  end if;
  if jsonb_typeof(coalesce(p_relations,'[]'::jsonb)) <> 'array' then raise exception 'relations must be an array' using errcode='22023'; end if;

  insert into content_entries (workspace_id, content_model_id, status, created_by, updated_by)
  values (p_workspace_id, p_model_id, 'draft', p_actor_id, p_actor_id)
  on conflict do nothing returning * into v_entry;

  if jsonb_typeof(p_unique_reservations) = 'array' then
    for v_res in select * from jsonb_array_elements(p_unique_reservations) loop
      insert into content_entry_unique_values (workspace_id, content_model_id, field_key, normalized_value, entry_id)
      values (p_workspace_id, p_model_id, v_res->>'fieldKey', v_res->>'normalizedValue', v_entry.id);
    end loop;
  end if;

  insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary)
  values (v_entry.id, v_model.current_schema_version, 1, p_data_jsonb, p_locale, 'draft', p_actor_id, p_change_summary)
  on conflict (entry_id, version_number) do nothing returning * into v_version;

  for v_rel in select * from jsonb_array_elements(coalesce(p_relations,'[]'::jsonb)) loop
    v_target_type := coalesce(nullif(v_rel->>'targetEntityType',''),
      case
        when nullif(v_rel->>'targetEntryId','') is not null then 'entry'
        when nullif(v_rel->>'targetAssetId','') is not null then 'asset'
        when nullif(v_rel->>'targetRouteId','') is not null then 'route'
        when nullif(v_rel->>'targetTermId','') is not null then 'term'
        when nullif(v_rel->>'targetMenuId','') is not null then 'menu'
        else null
      end);
    if v_target_type is null then raise exception 'Relation target is required' using errcode='22023'; end if;
    insert into content_relations (
      workspace_id, source_entry_id, source_version_id, source_field_key,
      source_entity_type, target_entity_type, relation_type,
      target_entry_id, target_asset_id, target_term_id, target_route_id, target_menu_id
    ) values (
      p_workspace_id, v_entry.id, v_version.id, v_rel->>'fieldKey',
      'entry', v_target_type, coalesce(nullif(v_rel->>'relationType',''),'reference'),
      nullif(v_rel->>'targetEntryId','')::uuid,
      nullif(v_rel->>'targetAssetId','')::uuid,
      nullif(v_rel->>'targetTermId','')::uuid,
      nullif(v_rel->>'targetRouteId','')::uuid,
      nullif(v_rel->>'targetMenuId','')::uuid
    );
  end loop;

  insert into content_search_documents (entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text, updated_at)
  values (v_entry.id, p_workspace_id, v_version.id, p_model_id, p_locale, 'draft', p_actor_id, p_search_text, now())
  on conflict (entry_id) do update set version_id=excluded.version_id, search_text=excluded.search_text, status=excluded.status, locale=excluded.locale, updated_at=excluded.updated_at;

  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, after_json, metadata_json)
  values (p_workspace_id, p_actor_id, 'content.entry.created', 'content_entry', v_entry.id::text, p_data_jsonb, jsonb_build_object('modelId',p_model_id,'version',1))
  on conflict do nothing;

  update content_entries set current_draft_version_id=v_version.id, updated_at=now() where id=v_entry.id returning * into v_entry;
  return jsonb_build_object('entry',row_to_json(v_entry),'version',row_to_json(v_version));
end;
$$;

create or replace function cms_save_entry_draft(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid,
  p_data_jsonb jsonb,
  p_locale text default 'en',
  p_change_summary text default null,
  p_expected_version_number integer default null,
  p_unique_reservations jsonb default '[]'::jsonb,
  p_relations jsonb default '[]'::jsonb,
  p_search_text text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_model record;
  v_latest_version record;
  v_next_version_num integer;
  v_version record;
  v_res jsonb;
  v_rel jsonb;
  v_target_type text;
begin
  select * into v_entry from content_entries where workspace_id=p_workspace_id and id=p_entry_id for update;
  if not found then raise exception 'Entry % not found in workspace %', p_entry_id, p_workspace_id; end if;
  if v_entry.status='archived' then raise exception 'Archived entries cannot be edited'; end if;
  select * into v_model from content_models where id=v_entry.content_model_id;
  if not found then raise exception 'Content model not found'; end if;
  if jsonb_typeof(coalesce(p_relations,'[]'::jsonb)) <> 'array' then raise exception 'relations must be an array' using errcode='22023'; end if;

  select * into v_latest_version from content_entry_versions where entry_id=p_entry_id order by version_number desc limit 1;
  if p_expected_version_number is not null and v_latest_version.version_number != p_expected_version_number then
    raise exception 'Version conflict: latest version is %, expected %', v_latest_version.version_number, p_expected_version_number using errcode='P0002';
  end if;
  v_next_version_num := coalesce(v_latest_version.version_number,0)+1;

  delete from content_entry_unique_values where entry_id=p_entry_id;
  if jsonb_typeof(p_unique_reservations)='array' then
    for v_res in select * from jsonb_array_elements(p_unique_reservations) loop
      insert into content_entry_unique_values (workspace_id,content_model_id,field_key,normalized_value,entry_id)
      values (p_workspace_id,v_entry.content_model_id,v_res->>'fieldKey',v_res->>'normalizedValue',p_entry_id);
    end loop;
  end if;

  insert into content_entry_versions (entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary)
  values (p_entry_id,v_model.current_schema_version,v_next_version_num,p_data_jsonb,p_locale,'draft',p_actor_id,p_change_summary)
  on conflict (entry_id,version_number) do nothing returning * into v_version;

  for v_rel in select * from jsonb_array_elements(coalesce(p_relations,'[]'::jsonb)) loop
    v_target_type := coalesce(nullif(v_rel->>'targetEntityType',''),
      case
        when nullif(v_rel->>'targetEntryId','') is not null then 'entry'
        when nullif(v_rel->>'targetAssetId','') is not null then 'asset'
        when nullif(v_rel->>'targetRouteId','') is not null then 'route'
        when nullif(v_rel->>'targetTermId','') is not null then 'term'
        when nullif(v_rel->>'targetMenuId','') is not null then 'menu'
        else null
      end);
    if v_target_type is null then raise exception 'Relation target is required' using errcode='22023'; end if;
    insert into content_relations (
      workspace_id, source_entry_id, source_version_id, source_field_key,
      source_entity_type, target_entity_type, relation_type,
      target_entry_id, target_asset_id, target_term_id, target_route_id, target_menu_id
    ) values (
      p_workspace_id, p_entry_id, v_version.id, v_rel->>'fieldKey',
      'entry', v_target_type, coalesce(nullif(v_rel->>'relationType',''),'reference'),
      nullif(v_rel->>'targetEntryId','')::uuid,
      nullif(v_rel->>'targetAssetId','')::uuid,
      nullif(v_rel->>'targetTermId','')::uuid,
      nullif(v_rel->>'targetRouteId','')::uuid,
      nullif(v_rel->>'targetMenuId','')::uuid
    );
  end loop;

  insert into content_search_documents (entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text,updated_at)
  values (p_entry_id,p_workspace_id,v_version.id,v_entry.content_model_id,p_locale,'draft',p_actor_id,p_search_text,now())
  on conflict (entry_id) do update set version_id=excluded.version_id,search_text=excluded.search_text,status=excluded.status,locale=excluded.locale,updated_at=excluded.updated_at;

  insert into platform_audit_events (workspace_id,actor_admin_user_id,action,entity_type,entity_id,after_json,metadata_json)
  values (p_workspace_id,p_actor_id,'content.entry.draft_saved','content_entry',p_entry_id::text,p_data_jsonb,jsonb_build_object('version',v_next_version_num,'changeSummary',p_change_summary))
  on conflict do nothing;

  update content_entries set status='draft',current_draft_version_id=v_version.id,updated_by=p_actor_id,updated_at=now()
  where id=p_entry_id returning * into v_entry;
  return jsonb_build_object('entry',row_to_json(v_entry),'version',row_to_json(v_version));
end;
$$;

revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from public;
revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from public;
do $$
begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from anon;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from authenticated;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) to service_role;
    grant execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) to service_role;
  end if;
  if exists(select 1 from pg_roles where rolname='postgres') then
    grant execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) to postgres;
    grant execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) to postgres;
  end if;
end $$;
