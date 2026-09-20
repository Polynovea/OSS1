-- Migration 0036: Phase 5 Concurrency Safety, Phase 7 Transactional Audits, and Cross-Workspace Graph Integrity

-- ============================================================================
-- 1. Phase 5: Concurrency-Safe Editorial Workflow RPC with Row Locking
-- ============================================================================

create or replace function cms_transition_workflow(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_entry_id uuid,
  p_action text,
  p_comment text default null,
  p_can_publish boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entry record;
  v_instance record;
  v_def record;
  v_new_instance_id uuid;
  v_target_state text;
  v_entry_status text;
begin
  -- 1. Fetch entry with workspace scoping and row-level lock
  select id, workspace_id, content_model_id, status, current_draft_version_id, created_by
  into v_entry
  from content_entries
  where workspace_id = p_workspace_id and id = p_entry_id
  for update;

  if not found or v_entry.current_draft_version_id is null then
    raise exception 'Entry with a draft is required' using errcode = 'P0002';
  end if;

  -- 2. Fetch latest workflow instance with row-level lock
  select * into v_instance
  from workflow_instances
  where entry_id = p_entry_id
  order by started_at desc
  limit 1
  for update;

  -- 3. Handle Submit
  if p_action = 'submit' then
    if v_entry.status not in ('draft', 'approved') then
      raise exception 'Only a draft can be submitted for review' using errcode = 'P0003';
    end if;

    if v_instance.id is not null and v_instance.completed_at is null then
      raise exception 'An active review already exists' using errcode = 'P0003';
    end if;

    -- Find active workflow definition
    select * into v_def
    from workflow_definitions
    where workspace_id = p_workspace_id
      and active = true
      and (content_model_id = v_entry.content_model_id or content_model_id is null)
    order by content_model_id nulls last
    limit 1;

    if v_def.id is null then
      raise exception 'No active workflow definition' using errcode = 'P0002';
    end if;

    -- Insert new workflow instance
    insert into workflow_instances (
      entry_id, version_id, workflow_definition_id, current_state, started_by
    ) values (
      v_entry.id, v_entry.current_draft_version_id, v_def.id, 'in_review', p_actor_id
    )
    on conflict do nothing
    returning id into v_new_instance_id;

    -- Insert workflow action log
    insert into workflow_actions (
      workflow_instance_id, actor_id, action, from_state, to_state, comment
    ) values (
      v_new_instance_id, p_actor_id, 'submitted', 'draft', 'in_review', p_comment
    )
    on conflict do nothing;

    -- Atomically advance entry status
    update content_entries
    set status = 'in_review', updated_by = p_actor_id, updated_at = clock_timestamp()
    where id = v_entry.id;

    -- Atomically record audit event
    insert into platform_audit_events (
      workspace_id, actor_admin_user_id, action, entity_type, entity_id
    ) values (
      p_workspace_id, p_actor_id, 'workflow.review_submitted', 'content_entry', v_entry.id
    )
    on conflict do nothing;

    return jsonb_build_object('success', true, 'instance_id', v_new_instance_id, 'state', 'in_review');

  -- 4. Handle Approve or Request Changes
  elsif p_action in ('approve', 'request_changes') then
    if v_instance.id is null or v_instance.completed_at is not null or v_instance.current_state <> 'in_review' then
      raise exception 'No review awaiting action' using errcode = 'P0003';
    end if;

    if not p_can_publish then
      raise exception 'Publishing permission is required for review decisions' using errcode = '40301';
    end if;

    -- Invariant: Self-Approval is strictly forbidden for the requester or creator
    if p_action = 'approve' and (v_instance.started_by = p_actor_id or v_entry.created_by = p_actor_id) then
      raise exception 'A requester cannot approve their own review' using errcode = '40300';
    end if;

    if p_action = 'approve' then
      v_target_state := 'approved';
      v_entry_status := 'approved';
    else
      v_target_state := 'changes_requested';
      v_entry_status := 'draft';
    end if;

    -- Complete workflow instance with conditional concurrency check
    update workflow_instances
    set current_state = v_target_state, completed_at = clock_timestamp()
    where id = v_instance.id
      and current_state = 'in_review'
      and completed_at is null;

    if not found then
      raise exception 'Workflow state conflict: review has already been decided or completed' using errcode = 'P0003';
    end if;

    -- Insert action log
    insert into workflow_actions (
      workflow_instance_id, actor_id, action, from_state, to_state, comment
    ) values (
      v_instance.id, p_actor_id, v_target_state, 'in_review', v_target_state, p_comment
    )
    on conflict do nothing;

    -- Atomically advance entry status
    update content_entries
    set status = v_entry_status, updated_by = p_actor_id, updated_at = clock_timestamp()
    where id = v_entry.id;

    -- Atomically record audit event inside transaction
    insert into platform_audit_events (
      workspace_id, actor_admin_user_id, action, entity_type, entity_id
    ) values (
      p_workspace_id, p_actor_id,
      case when p_action = 'approve' then 'workflow.approved' else 'workflow.changes_requested' end,
      'content_entry', v_entry.id
    )
    on conflict do nothing;

    return jsonb_build_object('success', true, 'instance_id', v_instance.id, 'state', v_target_state);

  else
    raise exception 'Unsupported workflow action: %', p_action using errcode = '22023';
  end if;
end;
$$;

revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from public;
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from anon;
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from authenticated;
grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to postgres;

-- ============================================================================
-- 2. Phase 7: Transactional Audit Inside Route Path Update RPC
-- ============================================================================

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
  select * into v_current_route
  from content_routes
  where workspace_id = p_workspace_id and id = p_route_id;

  if not found then
    raise exception 'Route % not found in workspace %', p_route_id, p_workspace_id;
  end if;

  if p_parent_route_id_supplied then
    v_target_parent_id := p_parent_route_id;
  else
    v_target_parent_id := v_current_route.parent_route_id;
  end if;

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

    insert into content_route_history (workspace_id, route_id, entry_id, locale, old_path, new_path, changed_by)
    values (p_workspace_id, p_route_id, v_current_route.entry_id, v_current_route.locale, v_current_route.path, p_new_path, p_actor_id)
    on conflict do nothing;

    insert into content_redirects (workspace_id, locale, source_path, target_path, status_code, is_active, description, created_by)
    values (p_workspace_id, v_current_route.locale, v_current_route.path, p_new_path, 301, true, 'Automatic route migration 301 redirect', p_actor_id)
    on conflict (workspace_id, locale, source_path)
    do update set target_path = excluded.target_path, status_code = 301, updated_at = now();

    v_redirect_created := true;
  end if;

  update content_routes
  set
    path = p_new_path,
    title = coalesce(p_title, title),
    parent_route_id = v_target_parent_id,
    order_index = coalesce(p_order_index, order_index),
    updated_at = now()
  where id = p_route_id
  returning * into v_updated_route;

  -- Transactional platform audit logging inside transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'routing.route_updated', 'content_route', p_route_id,
    jsonb_build_object('path', p_new_path, 'redirectCreated', v_redirect_created)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'route', row_to_json(v_updated_route),
    'redirectCreated', v_redirect_created
  );
end;
$$;

revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from public;
revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from anon;
revoke execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) from authenticated;
grant execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) to service_role;
grant execute on function cms_update_route_path(uuid, uuid, uuid, text, text, uuid, integer, boolean) to postgres;

-- ============================================================================
-- 3. Phase 7: Transactional Audit Inside Taxonomy Terms Merge RPC
-- ============================================================================

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

  update taxonomy_terms
  set
    is_deprecated = true,
    deprecated_by_term_id = p_target_term_id,
    updated_at = now()
  where id = p_source_term_id;

  insert into taxonomy_term_aliases (workspace_id, term_id, alias)
  values (p_workspace_id, p_target_term_id, v_source.name)
  on conflict (term_id, alias) do nothing;

  insert into taxonomy_term_aliases (workspace_id, term_id, alias, locale)
  select p_workspace_id, p_target_term_id, alias, locale
  from taxonomy_term_aliases
  where term_id = p_source_term_id
  on conflict (term_id, alias) do nothing;

  -- Transactional platform audit logging inside transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'taxonomy.terms_merged', 'taxonomy_term', p_source_term_id,
    jsonb_build_object('source_term_id', p_source_term_id, 'target_term_id', p_target_term_id)
  )
  on conflict do nothing;

  return jsonb_build_object(
    'ok', true,
    'sourceTermId', p_source_term_id,
    'targetTermId', p_target_term_id
  );
end;
$$;

revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from public;
revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from anon;
revoke execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) to service_role;
grant execute on function cms_merge_taxonomy_terms(uuid, uuid, uuid, uuid) to postgres;

-- ============================================================================
-- 4. Phase 7: Transactional Audit Inside Navigation Menu Publish RPC
-- ============================================================================

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

  update navigation_menu_versions
  set state = 'archived'
  where workspace_id = p_workspace_id and menu_id = p_menu_id and state = 'published';

  update navigation_menu_versions
  set state = 'published'
  where id = v_target_version.id
  returning * into v_published;

  update navigation_menus
  set published_version_id = v_published.id, updated_at = now()
  where id = p_menu_id;

  -- Transactional platform audit logging inside transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'navigation.menu_published', 'navigation_menu', p_menu_id,
    jsonb_build_object('version_id', v_published.id, 'version_number', v_published.version_number)
  )
  on conflict do nothing;

  return row_to_json(v_published)::jsonb;
end;
$$;

revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from public;
revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from anon;
revoke execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) from authenticated;
grant execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) to service_role;
grant execute on function cms_publish_navigation_menu(uuid, uuid, uuid, integer) to postgres;

-- ============================================================================
-- 5. Phase 7: Transactional Audit Inside Media Replacement RPC
-- ============================================================================

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

  insert into asset_replacement_history (
    workspace_id, asset_id, replaced_by,
    old_storage_provider, old_storage_key, old_checksum, old_filename, old_mime_type, old_size_bytes, old_width, old_height,
    new_storage_provider, new_storage_key, new_checksum, new_filename, new_mime_type, new_size_bytes, new_width, new_height,
    reason
  ) values (
    p_workspace_id, p_asset_id, p_actor_id,
    v_current_asset.storage_provider, v_current_asset.storage_key, v_current_asset.checksum, v_current_asset.filename, v_current_asset.mime_type, v_current_asset.size_bytes, v_current_asset.width, v_current_asset.height,
    p_new_storage_provider, p_new_storage_key, p_new_checksum, p_new_filename, p_new_mime_type, p_new_size_bytes, p_new_width, p_new_height,
    p_reason
  )
  on conflict do nothing
  returning id into v_history_id;

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

  -- Transactional platform audit logging inside transaction
  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'media.asset_replaced', 'asset', p_asset_id,
    jsonb_build_object(
      'filename', p_new_filename,
      'size_bytes', p_new_size_bytes,
      'checksum', p_new_checksum,
      'replacement_id', v_history_id
    )
  )
  on conflict do nothing;

  return jsonb_build_object(
    'asset', row_to_json(v_updated_asset),
    'historyId', v_history_id
  );
end;
$$;

revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from public;
revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from anon;
revoke execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) from authenticated;
grant execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) to service_role;
grant execute on function cms_replace_asset_file(uuid, uuid, uuid, text, text, text, text, text, bigint, integer, integer, text) to postgres;

-- ============================================================================
-- 6. Cross-Workspace Composite Foreign Keys on content_relations
-- ============================================================================

do $$
begin
  -- 1. Ensure composite unique keys on target tables
  if not exists (select 1 from pg_constraint where conname = 'assets_id_workspace_unique') then
    alter table assets add constraint assets_id_workspace_unique unique (id, workspace_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'taxonomy_terms_id_workspace_unique') then
    alter table taxonomy_terms add constraint taxonomy_terms_id_workspace_unique unique (id, workspace_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_routes_id_workspace_unique') then
    alter table content_routes add constraint content_routes_id_workspace_unique unique (id, workspace_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'navigation_menus_id_workspace_unique') then
    alter table navigation_menus add constraint navigation_menus_id_workspace_unique unique (id, workspace_id);
  end if;

  -- 2. Add composite foreign keys on content_relations enforcing exact workspace match
  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_entry_workspace_fk') then
    alter table content_relations
      add constraint content_relations_source_entry_workspace_fk
      foreign key (source_entry_id, workspace_id) references content_entries(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_menu_workspace_fk') then
    alter table content_relations
      add constraint content_relations_source_menu_workspace_fk
      foreign key (source_menu_id, workspace_id) references navigation_menus(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_route_workspace_fk') then
    alter table content_relations
      add constraint content_relations_source_route_workspace_fk
      foreign key (source_route_id, workspace_id) references content_routes(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_entry_workspace_fk') then
    alter table content_relations
      add constraint content_relations_target_entry_workspace_fk
      foreign key (target_entry_id, workspace_id) references content_entries(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_asset_workspace_fk') then
    alter table content_relations
      add constraint content_relations_target_asset_workspace_fk
      foreign key (target_asset_id, workspace_id) references assets(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_term_workspace_fk') then
    alter table content_relations
      add constraint content_relations_target_term_workspace_fk
      foreign key (target_term_id, workspace_id) references taxonomy_terms(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_route_workspace_fk') then
    alter table content_relations
      add constraint content_relations_target_route_workspace_fk
      foreign key (target_route_id, workspace_id) references content_routes(id, workspace_id) on delete cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_menu_workspace_fk') then
    alter table content_relations
      add constraint content_relations_target_menu_workspace_fk
      foreign key (target_menu_id, workspace_id) references navigation_menus(id, workspace_id) on delete cascade;
  end if;
end $$;
