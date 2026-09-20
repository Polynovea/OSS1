-- Migration 0034: Drop Legacy Mutation Overloads and Complete Foundation Mutation Boundaries
-- Closes the two principal blockers:
-- 1. Drops obsolete legacy overloads:
--    - cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb) [7 args]
--    - cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb) [8 args]
--    leaving strictly the complete 9-arg and 10-arg signatures that execute relations, search projections, and audit events within the single atomic transaction.
-- 2. Aligns cms_create_content_model and cms_apply_model_schema_version to canonical audit action names
--    ('schema.model.created', 'schema.migration.completed', 'schema.model.updated') inside the PostgreSQL transaction.
-- 3. Implements atomic cms_archive_content_entry and cms_unarchive_content_entry RPCs with search document projection
--    and audit event persistence inside the transaction.

-- =============================================================================
-- 1. DROP OBSOLETE LEGACY OVERLOADS
-- =============================================================================
drop function if exists public.cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb);
drop function if exists public.cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb);

-- =============================================================================
-- 2. HARDEN ATOMIC MODEL CREATION RPC WITH CANONICAL AUDIT ACTION
-- =============================================================================
create or replace function cms_create_content_model(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_name text,
  p_api_key text,
  p_description text default null,
  p_icon text default null,
  p_schema_json jsonb default '{}'::jsonb,
  p_schema_hash text default '',
  p_capability text default 'content_enabled'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model record;
  v_version record;
  v_field jsonb;
  v_idx integer := 0;
begin
  -- Verify api_key uniqueness in workspace
  if exists (select 1 from content_models where workspace_id = p_workspace_id and api_key = p_api_key) then
    raise exception 'A content model with apiKey "%" already exists in this workspace', p_api_key using errcode = '23505';
  end if;

  -- 1. Insert content_models row
  insert into content_models (
    workspace_id, name, api_key, description, icon, status,
    current_schema_version, settings_json, created_by
  ) values (
    p_workspace_id, p_name, p_api_key, p_description, p_icon, 'active',
    1, jsonb_build_object('capability', p_capability), p_actor_id
  )
  on conflict (workspace_id, api_key) do nothing
  returning * into v_model;

  -- 2. Insert initial content_model_versions row
  insert into content_model_versions (
    content_model_id, version_number, schema_json, schema_hash, change_summary, created_by
  ) values (
    v_model.id, 1, p_schema_json, p_schema_hash, 'Initial version', p_actor_id
  )
  on conflict (content_model_id, version_number) do nothing
  returning * into v_version;

  -- 3. Rebuild content_fields projection
  delete from content_fields where content_model_id = v_model.id;

  if jsonb_typeof(p_schema_json->'fields') = 'array' then
    for v_field in select * from jsonb_array_elements(p_schema_json->'fields') loop
      insert into content_fields (
        content_model_id, field_key, label, field_type, position, configuration_json
      ) values (
        v_model.id,
        v_field->>'key',
        coalesce(v_field->>'label', v_field->>'key'),
        v_field->>'type',
        v_idx,
        jsonb_build_object(
          'required', coalesce((v_field->>'required')::boolean, false),
          'localized', coalesce((v_field->>'localized')::boolean, false),
          'unique', coalesce((v_field->>'unique')::boolean, false),
          'defaultValue', v_field->'defaultValue',
          'validation', coalesce(v_field->'validation', '{}'::jsonb),
          'relation', v_field->'relation',
          'generatedFrom', v_field->>'generatedFrom',
          'index', coalesce((v_field->>'index')::boolean, false),
          'providerSpecific', coalesce((v_field->>'providerSpecific')::boolean, false),
          'uiHints', coalesce(v_field->'uiHints', '{}'::jsonb)
        )
      )
      on conflict do nothing;
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- 4. Atomic Platform Audit Record with Canonical Action Name
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'schema.model.created', 'content_model', v_model.id::text, p_schema_json,
    jsonb_build_object('apiKey', p_api_key, 'name', p_name, 'capability', p_capability)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'model', row_to_json(v_model),
    'version', row_to_json(v_version)
  );
end;
$$;

-- =============================================================================
-- 3. HARDEN ATOMIC SCHEMA VERSION APPLICATION RPC WITH CANONICAL AUDIT ACTION
-- =============================================================================
create or replace function cms_apply_model_schema_version(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_model_id uuid,
  p_schema_json jsonb,
  p_schema_hash text,
  p_change_summary text default null,
  p_capability text default 'content_enabled'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_model record;
  v_current_version_row record;
  v_next_version integer;
  v_version record;
  v_field jsonb;
  v_idx integer := 0;
begin
  select * into v_model from content_models where workspace_id = p_workspace_id and id = p_model_id for update;
  if not found then
    raise exception 'Content model % not found in workspace %', p_model_id, p_workspace_id;
  end if;

  select * into v_current_version_row
  from content_model_versions
  where content_model_id = p_model_id and version_number = v_model.current_schema_version;

  v_next_version := v_model.current_schema_version + 1;

  -- 1. Insert new immutable schema version
  insert into content_model_versions (
    content_model_id, version_number, schema_json, schema_hash, change_summary, created_by
  ) values (
    p_model_id, v_next_version, p_schema_json, p_schema_hash, p_change_summary, p_actor_id
  )
  on conflict (content_model_id, version_number) do nothing
  returning * into v_version;

  -- 2. Update model projections
  update content_models
  set
    name = coalesce(p_schema_json->>'name', name),
    description = p_schema_json->>'description',
    current_schema_version = v_next_version,
    settings_json = jsonb_build_object('capability', p_capability),
    updated_at = now()
  where id = p_model_id;

  -- 3. Rebuild content_fields projection
  delete from content_fields where content_model_id = p_model_id;

  if jsonb_typeof(p_schema_json->'fields') = 'array' then
    for v_field in select * from jsonb_array_elements(p_schema_json->'fields') loop
      insert into content_fields (
        content_model_id, field_key, label, field_type, position, configuration_json
      ) values (
        p_model_id,
        v_field->>'key',
        coalesce(v_field->>'label', v_field->>'key'),
        v_field->>'type',
        v_idx,
        jsonb_build_object(
          'required', coalesce((v_field->>'required')::boolean, false),
          'localized', coalesce((v_field->>'localized')::boolean, false),
          'unique', coalesce((v_field->>'unique')::boolean, false),
          'defaultValue', v_field->'defaultValue',
          'validation', coalesce(v_field->'validation', '{}'::jsonb),
          'relation', v_field->'relation',
          'generatedFrom', v_field->>'generatedFrom',
          'index', coalesce((v_field->>'index')::boolean, false),
          'providerSpecific', coalesce((v_field->>'providerSpecific')::boolean, false),
          'uiHints', coalesce(v_field->'uiHints', '{}'::jsonb)
        )
      )
      on conflict do nothing;
      v_idx := v_idx + 1;
    end loop;
  end if;

  -- 4. Atomic Platform Audit Records with Canonical Action Names
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'schema.migration.completed', 'content_model', p_model_id::text,
    v_current_version_row.schema_json, p_schema_json,
    jsonb_build_object(
      'fromVersion', v_model.current_schema_version,
      'toVersion', v_next_version,
      'changeSummary', p_change_summary,
      'capability', p_capability
    )
  )
  on conflict do nothing;

  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, before_json, after_json
  ) values (
    p_workspace_id, p_actor_id, 'schema.model.updated', 'content_model', p_model_id::text,
    v_current_version_row.schema_json, p_schema_json
  )
  on conflict do nothing;

  return jsonb_build_object(
    'version', row_to_json(v_version)
  );
end;
$$;

-- =============================================================================
-- 4. ATOMIC ENTRY ARCHIVE RPC
-- =============================================================================
create or replace function cms_archive_content_entry(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_archived record;
begin
  select * into v_entry from content_entries
  where workspace_id = p_workspace_id and id = p_entry_id
  for update;

  if not found then
    raise exception 'Entry % not found in workspace %', p_entry_id, p_workspace_id;
  end if;

  if v_entry.status = 'archived' then
    raise exception 'Entry is already archived';
  end if;

  -- 1. Update content_entries atomically
  update content_entries
  set
    status = 'archived',
    status_before_archive = v_entry.status,
    archived_at = now(),
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_entry_id
  returning * into v_archived;

  -- 2. Update search document projection
  update content_search_documents
  set status = 'archived', updated_at = now()
  where entry_id = p_entry_id;

  -- 3. Insert platform audit event inside the transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, before_json, after_json
  ) values (
    p_workspace_id, p_actor_id, 'content.entry.archived', 'content_entry', p_entry_id::text,
    jsonb_build_object('status', v_entry.status),
    jsonb_build_object('status', 'archived')
  )
  on conflict do nothing;

  return row_to_json(v_archived)::jsonb;
end;
$$;

-- =============================================================================
-- 5. ATOMIC ENTRY UNARCHIVE RPC
-- =============================================================================
create or replace function cms_unarchive_content_entry(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_unarchived record;
  v_next_status text;
begin
  select * into v_entry from content_entries
  where workspace_id = p_workspace_id and id = p_entry_id
  for update;

  if not found then
    raise exception 'Entry % not found in workspace %', p_entry_id, p_workspace_id;
  end if;

  if v_entry.status != 'archived' then
    raise exception 'Entry is not archived';
  end if;

  v_next_status := coalesce(v_entry.status_before_archive, case when v_entry.published_version_id is not null then 'published' else 'draft' end);

  -- 1. Update content_entries atomically
  update content_entries
  set
    status = v_next_status,
    status_before_archive = null,
    archived_at = null,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_entry_id
  returning * into v_unarchived;

  -- 2. Update search document projection
  update content_search_documents
  set status = v_next_status, updated_at = now()
  where entry_id = p_entry_id;

  -- 3. Insert platform audit event inside the transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, before_json, after_json
  ) values (
    p_workspace_id, p_actor_id, 'content.entry.unarchived', 'content_entry', p_entry_id::text,
    jsonb_build_object('status', 'archived'),
    jsonb_build_object('status', v_next_status)
  )
  on conflict do nothing;

  return row_to_json(v_unarchived)::jsonb;
end;
$$;

-- =============================================================================
-- 6. PERMISSIONS & SECURITY HARDENING
-- =============================================================================
revoke execute on function cms_archive_content_entry(uuid, uuid, uuid) from public;
revoke execute on function cms_unarchive_content_entry(uuid, uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_archive_content_entry(uuid, uuid, uuid) from anon;
    revoke execute on function cms_unarchive_content_entry(uuid, uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_archive_content_entry(uuid, uuid, uuid) from authenticated;
    revoke execute on function cms_unarchive_content_entry(uuid, uuid, uuid) from authenticated;
  end if;
end $$;

grant execute on function cms_archive_content_entry(uuid, uuid, uuid) to service_role;
grant execute on function cms_archive_content_entry(uuid, uuid, uuid) to postgres;
grant execute on function cms_unarchive_content_entry(uuid, uuid, uuid) to service_role;
grant execute on function cms_unarchive_content_entry(uuid, uuid, uuid) to postgres;
