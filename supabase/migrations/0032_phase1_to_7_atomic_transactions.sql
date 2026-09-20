-- Phase 1 to 7 Atomic Transactions, Database Uniqueness Invariants, and Schema Synchronization.

-- 1. Dedicated Uniqueness Projection Table for Dynamic Content Models
create table if not exists content_entry_unique_values (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  content_model_id uuid not null references content_models(id) on delete cascade,
  field_key text not null,
  normalized_value text not null,
  entry_id uuid not null references content_entries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, content_model_id, field_key, normalized_value)
);

create index if not exists idx_content_entry_unique_values_entry
  on content_entry_unique_values(entry_id);

alter table content_entry_unique_values enable row level security;

-- 2. Atomic Model Creation RPC
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

  return jsonb_build_object(
    'model', row_to_json(v_model),
    'version', row_to_json(v_version)
  );
end;
$$;

-- 3. Atomic Schema Version Application RPC
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

  return jsonb_build_object(
    'version', row_to_json(v_version)
  );
end;
$$;

-- 4. Atomic Content Entry Creation RPC with Dynamic Uniqueness Reservation
create or replace function cms_create_content_entry(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_model_id uuid,
  p_data_jsonb jsonb,
  p_locale text default 'en',
  p_change_summary text default 'Initial draft',
  p_unique_reservations jsonb default '[]'::jsonb
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

  -- 4. Update draft pointer
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

-- 5. Atomic Save Draft RPC with Concurrency Conflict & Dynamic Uniqueness Sync
create or replace function cms_save_entry_draft(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid,
  p_data_jsonb jsonb,
  p_locale text default 'en',
  p_change_summary text default null,
  p_expected_version_number integer default null,
  p_unique_reservations jsonb default '[]'::jsonb
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

  -- 3. Update entry draft pointer
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

-- 6. Atomic Publish Entry RPC
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
  v_draft_version record;
  v_published record;
begin
  select * into v_entry from content_entries where workspace_id = p_workspace_id and id = p_entry_id for update;
  if not found or v_entry.current_draft_version_id is null then
    raise exception 'Draft entry % not found in workspace %', p_entry_id, p_workspace_id;
  end if;

  if v_entry.status != 'approved' then
    raise exception 'Entry must be approved before publishing (current status: %)', v_entry.status;
  end if;

  select * into v_draft_version from content_entry_versions where id = v_entry.current_draft_version_id;
  if not found then
    raise exception 'Draft version % not found', v_entry.current_draft_version_id;
  end if;

  -- Archive prior published version
  update content_entry_versions
  set state = 'archived'
  where entry_id = p_entry_id and state = 'published';

  -- Mark target version as published
  update content_entry_versions
  set state = 'published'
  where id = v_draft_version.id;

  -- Update entry published pointer
  update content_entries
  set
    status = 'published',
    published_version_id = v_draft_version.id,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_entry_id
  returning * into v_published;

  return row_to_json(v_published)::jsonb;
end;
$$;

-- 7. Security Hardening & Permissions on All New Functions
revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from public;
revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from public;
revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb) from public;
revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb) from public;
revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from anon;
    revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from anon;
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb) from anon;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb) from anon;
    revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) from authenticated;
    revoke execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) from authenticated;
    revoke execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb) from authenticated;
    revoke execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb) from authenticated;
    revoke execute on function cms_publish_content_entry(uuid, uuid, uuid) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_create_content_model(uuid, uuid, text, text, text, text, jsonb, text, text) to service_role;
    grant execute on function cms_apply_model_schema_version(uuid, uuid, uuid, jsonb, text, text, text) to service_role;
    grant execute on function cms_create_content_entry(uuid, uuid, uuid, jsonb, text, text, jsonb) to service_role;
    grant execute on function cms_save_entry_draft(uuid, uuid, uuid, jsonb, text, text, integer, jsonb) to service_role;
    grant execute on function cms_publish_content_entry(uuid, uuid, uuid) to service_role;
  end if;
end $$;
