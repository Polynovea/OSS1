-- Phase 7 Closure — Database Integrity, Unified Dependency Invariants & Atomic Transaction RPCs.

-- 1. Ensure composite unique constraint on content_entries for cross-table integrity
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_entries_id_workspace_unique') then
    alter table content_entries add constraint content_entries_id_workspace_unique unique (id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entry_versions_id_entry_unique') then
    alter table content_entry_versions add constraint content_entry_versions_id_entry_unique unique (id, entry_id);
  end if;
end $$;

-- 2. Strengthen content_entry_version_terms container integrity
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_entry_version_terms_version_entry_fk') then
    alter table content_entry_version_terms
      add constraint content_entry_version_terms_version_entry_fk
      foreign key (version_id, entry_id) references content_entry_versions(id, entry_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entry_version_terms_entry_workspace_fk') then
    alter table content_entry_version_terms
      add constraint content_entry_version_terms_entry_workspace_fk
      foreign key (entry_id, workspace_id) references content_entries(id, workspace_id) on delete cascade;
  end if;
end $$;

-- 3. Strengthen content_routes entry workspace integrity
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_routes_entry_workspace_fk') then
    alter table content_routes
      add constraint content_routes_entry_workspace_fk
      foreign key (entry_id, workspace_id) references content_entries(id, workspace_id) on delete cascade;
  end if;
end $$;

-- 4. Correct content_relations target check constraint & unified source/target edges
do $$
begin
  -- Drop legacy 0009 check constraint if exists
  alter table content_relations drop constraint if exists content_relations_check;
  alter table content_relations drop constraint if exists content_relations_target_check;

  -- Add source edge columns for generic dependency graph
  alter table content_relations
    add column if not exists source_menu_id uuid references navigation_menus(id) on delete cascade,
    add column if not exists source_route_id uuid references content_routes(id) on delete cascade;

  -- Enforce exactly one target per dependency edge
  alter table content_relations
    add constraint content_relations_target_check check (
      (
        case when target_entry_id is not null then 1 else 0 end +
        case when target_asset_id is not null then 1 else 0 end +
        case when target_term_id is not null then 1 else 0 end +
        case when target_route_id is not null then 1 else 0 end +
        case when target_menu_id is not null then 1 else 0 end
      ) = 1
    );
end $$;

-- 5. Atomic Transaction RPC: Route Path Migration & Automatic 301 Redirect
create or replace function cms_update_route_path(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_route_id uuid,
  p_new_path text,
  p_title text default null,
  p_parent_route_id uuid default null,
  p_order_index integer default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_current_route record;
  v_collision record;
  v_updated_route record;
  v_redirect_created boolean := false;
begin
  -- 1. Fetch current route
  select * into v_current_route
  from content_routes
  where workspace_id = p_workspace_id and id = p_route_id;

  if not found then
    raise exception 'Route % not found in workspace %', p_route_id, p_workspace_id;
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
    parent_route_id = p_parent_route_id,
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

-- 6. Atomic Transaction RPC: Taxonomy Term Merge
create or replace function cms_merge_taxonomy_terms(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_source_term_id uuid,
  p_target_term_id uuid
)
returns jsonb
language plpgsql
security definer
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

-- 7. Atomic Transaction RPC: Navigation Menu Publish
create or replace function cms_publish_navigation_menu(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_menu_id uuid,
  p_version_number integer default null
)
returns jsonb
language plpgsql
security definer
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
