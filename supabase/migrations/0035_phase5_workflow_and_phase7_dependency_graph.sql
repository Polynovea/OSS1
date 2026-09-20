-- Migration 0035: Phase 5 Atomic Workflow Transitions & Phase 7 Unified Generic Dependency Graph

-- ============================================================================
-- 1. Phase 5: Atomic Editorial Workflow RPC
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
  -- 1. Fetch entry with workspace scoping
  select id, workspace_id, content_model_id, status, current_draft_version_id, created_by
  into v_entry
  from content_entries
  where workspace_id = p_workspace_id and id = p_entry_id;

  if not found or v_entry.current_draft_version_id is null then
    raise exception 'Entry with a draft is required' using errcode = 'P0002';
  end if;

  -- 2. Fetch latest workflow instance
  select * into v_instance
  from workflow_instances
  where entry_id = p_entry_id
  order by started_at desc
  limit 1;

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

    -- Insert action log
    insert into workflow_actions (
      workflow_instance_id, actor_id, action, from_state, to_state, comment
    ) values (
      v_instance.id, p_actor_id, v_target_state, 'in_review', v_target_state, p_comment
    )
    on conflict do nothing;

    -- Complete workflow instance
    update workflow_instances
    set current_state = v_target_state, completed_at = clock_timestamp()
    where id = v_instance.id;

    -- Atomically advance entry status
    update content_entries
    set status = v_entry_status, updated_by = p_actor_id, updated_at = clock_timestamp()
    where id = v_entry.id;

    -- Atomically record audit event
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

-- Security hardening for workflow RPC
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from public;
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from anon;
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from authenticated;
grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to postgres;

-- ============================================================================
-- 2. Phase 7: Unified Generic Source/Target Dependency Graph
-- ============================================================================

-- Drop NOT NULL constraints from entry-specific origin columns to permit non-entry origins (menus, routes)
alter table content_relations alter column source_entry_id drop not null;
alter table content_relations alter column source_version_id drop not null;
alter table content_relations alter column source_field_key drop not null;

-- Enforce exactly one valid source origin per edge
alter table content_relations drop constraint if exists content_relations_source_check;
alter table content_relations add constraint content_relations_source_check check (
  (
    case when source_entry_id is not null then 1 else 0 end +
    case when source_menu_id is not null then 1 else 0 end +
    case when source_route_id is not null then 1 else 0 end
  ) = 1
  and (
    (source_entry_id is not null and source_version_id is not null and source_field_key is not null)
    or (source_entry_id is null)
  )
);

-- Enforce exactly one valid target entity per edge
alter table content_relations drop constraint if exists content_relations_target_check;
alter table content_relations add constraint content_relations_target_check check (
  (
    case when target_entry_id is not null then 1 else 0 end +
    case when target_asset_id is not null then 1 else 0 end +
    case when target_term_id is not null then 1 else 0 end +
    case when target_route_id is not null then 1 else 0 end +
    case when target_menu_id is not null then 1 else 0 end
  ) = 1
);

-- Performance indexes for non-entry source dependencies
create index if not exists content_relations_source_menu_idx
  on content_relations(workspace_id, source_menu_id) where source_menu_id is not null;
create index if not exists content_relations_source_route_idx
  on content_relations(workspace_id, source_route_id) where source_route_id is not null;
