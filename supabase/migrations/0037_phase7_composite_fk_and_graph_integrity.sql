-- Migration 0037: Phase 7 Source Version/Entry Composite Foreign Key and Graph Mutation Safety

-- ============================================================================
-- 1. Composite Foreign Key on content_relations (source_version_id, source_entry_id)
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_version_entry_fk') then
    alter table content_relations
      add constraint content_relations_source_version_entry_fk
      foreign key (source_version_id, source_entry_id)
      references content_entry_versions(id, entry_id)
      on delete cascade;
  end if;
end $$;

-- ============================================================================
-- 2. Atomic Graph Replacement Function (Replacing Unchecked delete+insert)
-- ============================================================================

create or replace function cms_replace_source_relations(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_relations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rel jsonb;
begin
  if p_source_type = 'menu' then
    delete from content_relations
    where workspace_id = p_workspace_id and source_menu_id = p_source_id;
  elsif p_source_type = 'route' then
    delete from content_relations
    where workspace_id = p_workspace_id and source_route_id = p_source_id;
  else
    raise exception 'Unsupported source type: %', p_source_type using errcode = '22023';
  end if;

  if p_relations is not null and jsonb_array_length(p_relations) > 0 then
    for v_rel in select * from jsonb_array_elements(p_relations) loop
      insert into content_relations (
        workspace_id,
        source_menu_id,
        source_route_id,
        source_entity_type,
        target_entity_type,
        relation_type,
        target_entry_id,
        target_asset_id,
        target_term_id,
        target_route_id,
        target_menu_id
      ) values (
        p_workspace_id,
        case when p_source_type = 'menu' then p_source_id else null end,
        case when p_source_type = 'route' then p_source_id else null end,
        (v_rel->>'source_entity_type'),
        (v_rel->>'target_entity_type'),
        (v_rel->>'relation_type'),
        (v_rel->>'target_entry_id')::uuid,
        (v_rel->>'target_asset_id')::uuid,
        (v_rel->>'target_term_id')::uuid,
        (v_rel->>'target_route_id')::uuid,
        (v_rel->>'target_menu_id')::uuid
      );
    end loop;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from public;
revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from anon;
revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from authenticated;
grant execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) to service_role;
grant execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) to postgres;
