-- Migration 0039: Phase 8 certification repair — required locale release invariant.
-- Fresh installs receive the same definition in 0038; this migration repairs
-- already-applied Phase 8 databases without replaying the full migration.

create or replace function cms_create_release(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_name text,
  p_description text,
  p_item_version_ids jsonb,
  p_locales jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release releases%rowtype;
  v_version_id uuid;
  v_locale text;
  v_expected integer;
  v_actual integer;
begin
  if p_name is null or btrim(p_name) = '' then
    raise exception 'Release name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_item_version_ids) <> 'array' or jsonb_array_length(p_item_version_ids) = 0 then
    raise exception 'A release needs at least one approved entry version' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_locales, '[]'::jsonb)) <> 'array' then
    raise exception 'locales must be an array' using errcode = '22023';
  end if;

  select count(distinct value::uuid) into v_expected
    from jsonb_array_elements_text(p_item_version_ids);
  select count(*) into v_actual
    from content_entry_versions cev
    join content_entries ce on ce.id = cev.entry_id
    join content_models cm on cm.id = ce.content_model_id
    where cev.id in (select distinct value::uuid from jsonb_array_elements_text(p_item_version_ids))
      and ce.workspace_id = p_workspace_id
      and ce.current_draft_version_id = cev.id
      and ce.status = 'approved'
      and coalesce(cm.settings_json->>'capability', 'publishable') <> 'data_only';
  if v_actual <> v_expected then
    raise exception 'Every release item must be the current approved publishable version in this workspace' using errcode = 'P0003';
  end if;

  insert into releases (workspace_id, name, description, created_by, updated_by)
  values (p_workspace_id, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_actor_id, p_actor_id)
  returning * into v_release;

  insert into release_items (release_id, entry_id, entry_version_id)
  select v_release.id, cev.entry_id, cev.id
  from content_entry_versions cev
  where cev.id in (select distinct value::uuid from jsonb_array_elements_text(p_item_version_ids));

  insert into release_locale_targets (release_id, workspace_id, locale, required)
  select v_release.id, p_workspace_id, locale, required
  from workspace_locales
  where workspace_id = p_workspace_id and enabled = true and required = true
  on conflict (release_id, locale) do nothing;

  if jsonb_array_length(coalesce(p_locales, '[]'::jsonb)) > 0 then
    for v_locale in select distinct value from jsonb_array_elements_text(p_locales)
    loop
      if not exists (select 1 from workspace_locales where workspace_id = p_workspace_id and locale = v_locale and enabled = true) then
        raise exception 'Locale % is not enabled in this workspace', v_locale using errcode = 'P0002';
      end if;
      insert into release_locale_targets (release_id, workspace_id, locale, required)
      select v_release.id, p_workspace_id, wl.locale, wl.required
      from workspace_locales wl
      where wl.workspace_id = p_workspace_id and wl.locale = v_locale
      on conflict (release_id, locale) do nothing;
    end loop;
  else
    insert into release_locale_targets (release_id, workspace_id, locale, required)
    select v_release.id, p_workspace_id, locale, required
    from workspace_locales
    where workspace_id = p_workspace_id and enabled = true
    on conflict (release_id, locale) do nothing;
  end if;

  insert into release_history (release_id, workspace_id, actor_admin_user_id, action, to_status, detail_json)
  values (v_release.id, p_workspace_id, p_actor_id, 'created', 'draft', jsonb_build_object('itemCount', v_expected));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.created', 'release', v_release.id::text, jsonb_build_object('itemCount', v_expected));

  return row_to_json(v_release)::jsonb;
end;
$$;

revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) to service_role;
  end if;
end $$;
grant execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) to postgres;
