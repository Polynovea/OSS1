-- Phase 7 Security Hardening — Fixed Search Path, Route Parent Invariant & Atomic Media Replacement RPC.

-- Drop legacy overload if exists
drop function if exists cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer);

-- 1. Route Path Update with Explicit Parent Supplying & Hardened Search Path
create or replace function cms_update_route_path(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_route_id uuid,
  p_new_path text,
  p_title text default null,
  p_parent_route_id uuid default null,
  p_order_index integer default null,
  p_parent_route_id_supplied boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_route record;
  v_collision record;
  v_updated_route record;
  v_redirect_created boolean := false;
  v_target_parent_id uuid;
begin
  -- 1. Fetch current route
  select * into v_current_route
  from content_routes
  where workspace_id = p_workspace_id and id = p_route_id;

  if not found then
    raise exception 'Route % not found in workspace %', p_route_id, p_workspace_id;
  end if;

  -- Determine parent route id: preserve current parent unless explicitly supplied
  if p_parent_route_id_supplied then
    v_target_parent_id := p_parent_route_id;
  else
    v_target_parent_id := v_current_route.parent_route_id;
  end if;

  -- 2. If path changed, verify collision
  if v_current_route.path != p_new_path then
    select * into v_collision
    from content_routes
    where workspace_id = p_workspace_id
      and locale = v_current_route.locale
      and path = p_new_path
      and status != 'archived'
      and id != p_route_id;

    if found then
      raise exception 'Route collision: path % already exists in locale %', p_new_path, v_current_route.locale;
    end if;

    -- Record route history
    insert into content_route_history (workspace_id, route_id, entry_id, locale, old_path, new_path, changed_by)
    values (p_workspace_id, p_route_id, v_current_route.entry_id, v_current_route.locale, v_current_route.path, p_new_path, p_actor_id)
    on conflict do nothing;

    -- Create/update 301 redirect
    insert into content_redirects (workspace_id, locale, source_path, target_path, status_code, is_active, description, created_by)
    values (p_workspace_id, v_current_route.locale, v_current_route.path, p_new_path, 301, true, 'Automatic route migration 301 redirect', p_actor_id)
    on conflict (workspace_id, locale, source_path)
    do update set target_path = excluded.target_path, status_code = 301, updated_at = now();

    v_redirect_created := true;
  end if;

  -- 3. Update route
  update content_routes
  set
    path = p_new_path,
    title = coalesce(p_title, title),
    parent_route_id = v_target_parent_id,
    order_index = coalesce(p_order_index, order_index),
    updated_at = now()
  where id = p_route_id
  returning * into v_updated_route;

  return jsonb_build_object(
    'route', row_to_json(v_updated_route),
    'redirectCreated', v_redirect_created
  );
end;
$$;

-- 2. Taxonomy Term Merge with Hardened Search Path
create or replace function cms_merge_taxonomy_terms(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_source_term_id uuid,
  p_target_term_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source record;
  v_target record;
begin
  if p_source_term_id = p_target_term_id then
    raise exception 'Cannot merge a term into itself';
  end if;

  select * into v_source from taxonomy_terms where workspace_id = p_workspace_id and id = p_source_term_id;
  if not found then
    raise exception 'Source term % not found in workspace %', p_source_term_id, p_workspace_id;
  end if;

  select * into v_target from taxonomy_terms where workspace_id = p_workspace_id and id = p_target_term_id;
  if not found then
    raise exception 'Target term % not found in workspace %', p_target_term_id, p_workspace_id;
  end if;

  if v_source.taxonomy_id != v_target.taxonomy_id then
    raise exception 'Cannot merge terms from different taxonomies';
  end if;

  -- 1. Deprecate source pointing to target
  update taxonomy_terms
  set
    is_deprecated = true,
    deprecated_by_term_id = p_target_term_id,
    updated_at = now()
  where id = p_source_term_id;

  -- 2. Transfer source name as alias on target
  insert into taxonomy_term_aliases (workspace_id, term_id, alias)
  values (p_workspace_id, p_target_term_id, v_source.name)
  on conflict (term_id, alias) do nothing;

  -- 3. Copy source aliases to target
  insert into taxonomy_term_aliases (workspace_id, term_id, alias, locale)
  select p_workspace_id, p_target_term_id, alias, locale
  from taxonomy_term_aliases
  where term_id = p_source_term_id
  on conflict (term_id, alias) do nothing;

  return jsonb_build_object(
    'ok', true,
    'sourceTermId', p_source_term_id,
    'targetTermId', p_target_term_id
  );
end;
$$;

-- 3. Navigation Menu Publish with Hardened Search Path
create or replace function cms_publish_navigation_menu(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_menu_id uuid,
  p_version_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_menu record;
  v_target_version record;
  v_published record;
begin
  select * into v_menu from navigation_menus where workspace_id = p_workspace_id and id = p_menu_id;
  if not found then
    raise exception 'Menu % not found in workspace %', p_menu_id, p_workspace_id;
  end if;

  if p_version_number is not null then
    select * into v_target_version
    from navigation_menu_versions
    where workspace_id = p_workspace_id and menu_id = p_menu_id and version_number = p_version_number;
  elsif v_menu.current_draft_version_id is not null then
    select * into v_target_version
    from navigation_menu_versions
    where workspace_id = p_workspace_id and id = v_menu.current_draft_version_id;
  end if;

  if v_target_version.id is null then
    raise exception 'No version available to publish for menu %', p_menu_id;
  end if;

  -- Archive currently published version
  update navigation_menu_versions
  set state = 'archived'
  where workspace_id = p_workspace_id and menu_id = p_menu_id and state = 'published';

  -- Mark target version as published
  update navigation_menu_versions
  set state = 'published'
  where id = v_target_version.id
  returning * into v_published;

  -- Update published_version_id on menu container
  update navigation_menus
  set published_version_id = v_published.id, updated_at = now()
  where id = p_menu_id;

  return row_to_json(v_published)::jsonb;
end;
$$;

-- 4. Atomic Media Replacement RPC
create or replace function cms_replace_asset_file(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_asset_id uuid,
  p_new_storage_provider text,
  p_new_storage_key text,
  p_new_checksum text,
  p_new_filename text,
  p_new_mime_type text,
  p_new_size_bytes bigint,
  p_new_width integer default null,
  p_new_height integer default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current_asset record;
  v_updated_asset record;
  v_history_id uuid;
begin
  select * into v_current_asset
  from assets
  where workspace_id = p_workspace_id and id = p_asset_id and archived_at is null;

  if not found then
    raise exception 'Asset % not found in workspace %', p_asset_id, p_workspace_id;
  end if;

  -- 1. Insert history
  insert into asset_replacement_history (
    workspace_id, asset_id,
    old_storage_provider, old_storage_key, old_checksum, old_filename, old_mime_type, old_size_bytes, old_width, old_height,
    new_storage_provider, new_storage_key, new_checksum, new_filename, new_mime_type, new_size_bytes, new_width, new_height,
    reason, replaced_by
  ) values (
    p_workspace_id, p_asset_id,
    v_current_asset.storage_provider, v_current_asset.storage_key, v_current_asset.checksum, v_current_asset.filename, v_current_asset.mime_type, v_current_asset.size_bytes, v_current_asset.width, v_current_asset.height,
    p_new_storage_provider, p_new_storage_key, p_new_checksum, p_new_filename, p_new_mime_type, p_new_size_bytes, p_new_width, p_new_height,
    p_reason, p_actor_id
  )
  on conflict do nothing
  returning id into v_history_id;

  -- 2. Update assets row
  update assets
  set
    storage_provider = p_new_storage_provider,
    storage_key = p_new_storage_key,
    checksum = p_new_checksum,
    filename = p_new_filename,
    mime_type = p_new_mime_type,
    size_bytes = p_new_size_bytes,
    width = p_new_width,
    height = p_new_height
  where id = p_asset_id
  returning * into v_updated_asset;

  return jsonb_build_object(
    'asset', row_to_json(v_updated_asset),
    'historyId', v_history_id
  );
end;
$$;

-- 5. Revoke Public Execution & Grant Only to Privileged Roles
revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from public;
revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from public;
revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from public;
revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from anon;
    revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from anon;
    revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from anon;
    revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from anon;
  end if;

  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from authenticated;
    revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from authenticated;
    revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from authenticated;
    revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) to service_role;
    grant execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) to service_role;
    grant execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) to service_role;
    grant execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) to service_role;
  end if;
end $$;
