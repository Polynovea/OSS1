-- Migration 0033: Complete Transaction Mutation Boundaries, Model Capability Enforcement, and Atomic Projections.
-- Genuinely closes the mutation boundary:
-- 1. cms_create_content_model & cms_apply_model_schema_version: atomic model + version + field projection + audit log.
-- 2. cms_create_content_entry & cms_save_entry_draft: atomic entry + version + unique reservation + relations + search + audit log.
-- 3. cms_publish_content_entry: enforces capability !== 'data_only' + version archive/publish + entry status + search status + audit log.

-- 1. Atomic Model Creation RPC with Audit
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

  -- 4. Atomic Platform Audit Record
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'schema.model_created', 'content_model', v_model.id::text, p_schema_json,
    jsonb_build_object('apiKey', p_api_key, 'name', p_name, 'capability', p_capability)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'model', row_to_json(v_model),
    'version', row_to_json(v_version)
  );
end;
$$;

-- 2. Atomic Schema Version Application RPC with Audit
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
  v_next_version integer;
  v_version record;
  v_field jsonb;
  v_idx integer := 0;
begin
  select * into v_model from content_models where workspace_id = p_workspace_id and id = p_model_id for update;
  if not found then
    raise exception 'Content model % not found in workspace %', p_model_id, p_workspace_id;
  end if;

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

  -- 4. Atomic Platform Audit Record
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, before_json, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'schema.version_applied', 'content_model', p_model_id::text,
    v_model.settings_json, p_schema_json,
    jsonb_build_object('version', v_next_version, 'changeSummary', p_change_summary, 'capability', p_capability)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'version', row_to_json(v_version)
  );
end;
$$;

-- 3. Atomic Content Entry Creation RPC with Complete Relations, Search, & Audit Mutation
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
begin
  select * into v_model from content_models where workspace_id = p_workspace_id and id = p_model_id;
  if not found or v_model.status != 'active' then
    raise exception 'Active content model % not found in workspace %', p_model_id, p_workspace_id;
  end if;

  -- 1. Insert content_entries row
  insert into content_entries (
    workspace_id, content_model_id, status, created_by, updated_by
  ) values (
    p_workspace_id, p_model_id, 'draft', p_actor_id, p_actor_id
  )
  on conflict do nothing
  returning * into v_entry;

  -- 2. Reserve unique field values in content_entry_unique_values (raises 23505 on collision)
  if jsonb_typeof(p_unique_reservations) = 'array' then
    for v_res in select * from jsonb_array_elements(p_unique_reservations) loop
      insert into content_entry_unique_values (
        workspace_id, content_model_id, field_key, normalized_value, entry_id
      ) values (
        p_workspace_id, p_model_id, v_res->>'fieldKey', v_res->>'normalizedValue', v_entry.id
      );
    end loop;
  end if;

  -- 3. Insert v1 content_entry_versions row
  insert into content_entry_versions (
    entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary
  ) values (
    v_entry.id, v_model.current_schema_version, 1, p_data_jsonb, p_locale, 'draft', p_actor_id, p_change_summary
  )
  on conflict (entry_id, version_number) do nothing
  returning * into v_version;

  -- 4. Insert entry-version origin relations
  if jsonb_typeof(p_relations) = 'array' then
    for v_rel in select * from jsonb_array_elements(p_relations) loop
      insert into content_relations (
        workspace_id, source_entry_id, source_version_id, source_field_key, target_entry_id, relation_type
      ) values (
        p_workspace_id, v_entry.id, v_version.id, v_rel->>'fieldKey', (v_rel->>'targetEntryId')::uuid, coalesce(v_rel->>'relationType', 'reference')
      )
      on conflict do nothing;
    end loop;
  end if;

  -- 5. Upsert search document projection
  insert into content_search_documents (
    entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text, updated_at
  ) values (
    v_entry.id, p_workspace_id, v_version.id, p_model_id, p_locale, 'draft', p_actor_id, p_search_text, now()
  )
  on conflict (entry_id) do update set
    version_id = excluded.version_id,
    search_text = excluded.search_text,
    status = excluded.status,
    locale = excluded.locale,
    updated_at = excluded.updated_at;

  -- 6. Insert platform audit event
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'content.entry.created', 'content_entry', v_entry.id::text, p_data_jsonb,
    jsonb_build_object('modelId', p_model_id, 'version', 1)
  )
  on conflict do nothing;

  -- 7. Update draft pointer
  update content_entries
  set current_draft_version_id = v_version.id, updated_at = now()
  where id = v_entry.id
  returning * into v_entry;

  return jsonb_build_object(
    'entry', row_to_json(v_entry),
    'version', row_to_json(v_version)
  );
end;
$$;

-- 4. Atomic Content Entry Draft Save RPC with Complete Relations, Search, & Audit Mutation
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
begin
  select * into v_entry from content_entries where workspace_id = p_workspace_id and id = p_entry_id for update;
  if not found then
    raise exception 'Entry % not found in workspace %', p_entry_id, p_workspace_id;
  end if;

  if v_entry.status = 'archived' then
    raise exception 'Archived entries cannot be edited';
  end if;

  select * into v_model from content_models where id = v_entry.content_model_id;
  if not found then
    raise exception 'Content model not found';
  end if;

  -- Get latest version
  select * into v_latest_version
  from content_entry_versions
  where entry_id = p_entry_id
  order by version_number desc
  limit 1;

  if p_expected_version_number is not null and v_latest_version.version_number != p_expected_version_number then
    raise exception 'Version conflict: latest version is %, expected %', v_latest_version.version_number, p_expected_version_number using errcode = 'P0002';
  end if;

  v_next_version_num := coalesce(v_latest_version.version_number, 0) + 1;

  -- 1. Sync unique reservations: delete current entry unique records then insert new
  delete from content_entry_unique_values where entry_id = p_entry_id;

  if jsonb_typeof(p_unique_reservations) = 'array' then
    for v_res in select * from jsonb_array_elements(p_unique_reservations) loop
      insert into content_entry_unique_values (
        workspace_id, content_model_id, field_key, normalized_value, entry_id
      ) values (
        p_workspace_id, v_entry.content_model_id, v_res->>'fieldKey', v_res->>'normalizedValue', p_entry_id
      );
    end loop;
  end if;

  -- 2. Insert new version
  insert into content_entry_versions (
    entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_by, change_summary
  ) values (
    p_entry_id, v_model.current_schema_version, v_next_version_num, p_data_jsonb, p_locale, 'draft', p_actor_id, p_change_summary
  )
  on conflict (entry_id, version_number) do nothing
  returning * into v_version;

  -- 3. Insert relations for this new version
  if jsonb_typeof(p_relations) = 'array' then
    for v_rel in select * from jsonb_array_elements(p_relations) loop
      insert into content_relations (
        workspace_id, source_entry_id, source_version_id, source_field_key, target_entry_id, relation_type
      ) values (
        p_workspace_id, p_entry_id, v_version.id, v_rel->>'fieldKey', (v_rel->>'targetEntryId')::uuid, coalesce(v_rel->>'relationType', 'reference')
      )
      on conflict do nothing;
    end loop;
  end if;

  -- 4. Upsert search document projection
  insert into content_search_documents (
    entry_id, workspace_id, version_id, content_model_id, locale, status, author_id, search_text, updated_at
  ) values (
    p_entry_id, p_workspace_id, v_version.id, v_entry.content_model_id, p_locale, 'draft', p_actor_id, p_search_text, now()
  )
  on conflict (entry_id) do update set
    version_id = excluded.version_id,
    search_text = excluded.search_text,
    status = excluded.status,
    locale = excluded.locale,
    updated_at = excluded.updated_at;

  -- 5. Insert platform audit event
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, after_json, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'content.entry.draft_saved', 'content_entry', p_entry_id::text, p_data_jsonb,
    jsonb_build_object('version', v_next_version_num, 'changeSummary', p_change_summary)
  )
  on conflict do nothing;

  -- 6. Update entry draft pointer
  update content_entries
  set
    status = 'draft',
    current_draft_version_id = v_version.id,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_entry_id
  returning * into v_entry;

  return jsonb_build_object(
    'entry', row_to_json(v_entry),
    'version', row_to_json(v_version)
  );
end;
$$;

-- 5. Atomic Publish Entry RPC with Model Capability Enforcement & Search/Audit Mutation
create or replace function cms_publish_content_entry(
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
  v_model record;
  v_draft_version record;
  v_published record;
begin
  select * into v_entry from content_entries where workspace_id = p_workspace_id and id = p_entry_id for update;
  if not found or v_entry.current_draft_version_id is null then
    raise exception 'Draft entry % not found in workspace %', p_entry_id, p_workspace_id;
  end if;

  select * into v_model from content_models where id = v_entry.content_model_id;
  if not found then
    raise exception 'Content model not found';
  end if;

  -- Model capability enforcement: data_only models must never be published
  if coalesce(v_model.settings_json->>'capability', 'publishable') = 'data_only' then
    raise exception 'Cannot publish entry: model "%" has capability "data_only"', v_model.api_key using errcode = 'P0003';
  end if;

  if v_entry.status != 'approved' then
    raise exception 'Entry must be approved before publishing (current status: %)', v_entry.status;
  end if;

  select * into v_draft_version from content_entry_versions where id = v_entry.current_draft_version_id;
  if not found then
    raise exception 'Draft version % not found', v_entry.current_draft_version_id;
  end if;

  -- 1. Archive prior published version
  update content_entry_versions
  set state = 'archived'
  where entry_id = p_entry_id and state = 'published';

  -- 2. Mark target version as published
  update content_entry_versions
  set state = 'published'
  where id = v_draft_version.id;

  -- 3. Update entry published pointer
  update content_entries
  set
    status = 'published',
    published_version_id = v_draft_version.id,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_entry_id
  returning * into v_published;

  -- 4. Update search projection status
  update content_search_documents
  set status = 'published', updated_at = now()
  where entry_id = p_entry_id;

  -- 5. Insert platform audit event
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'content.entry.published', 'content_entry', p_entry_id::text,
    jsonb_build_object('publishedVersionId', v_draft_version.id, 'versionNumber', v_draft_version.version_number)
  )
  on conflict do nothing;

  return row_to_json(v_published)::jsonb;
end;
$$;

-- 6. Security Hardening & Permissions
revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from public;
revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from public;
revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from public;
revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from public;
revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from anon;
    revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from anon;
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from anon;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from anon;
    revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from authenticated;
    revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from authenticated;
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) from authenticated;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) from authenticated;
    revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) to service_role;
    grant execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) to service_role;
    grant execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb, jsonb, text) to service_role;
    grant execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb, jsonb, text) to service_role;
    grant execute on function cms_publish_content_entry(uuid, uuid, uuid) to service_role;
  end if;
end $$;
