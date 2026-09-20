-- Migration 0038: Phase 8 — Content Operations and Localization
-- Additive governance layer for configurable editorial workflows, coordinated
-- multi-locale releases, scheduling, assignments/notifications, and rollback plans.

-- ============================================================================
-- 1. Locale policy and translation lifecycle
-- ============================================================================

alter table workspace_locales add column if not exists fallback_locale text;

-- Ensure every workspace has its declared default locale represented in the
-- locale registry before we enforce fallback references.
insert into workspace_locales (workspace_id, locale, enabled, required, is_default)
select id, default_locale, true, true, true
from workspaces
on conflict (workspace_id, locale) do update
set enabled = true,
    is_default = true;

create unique index if not exists workspace_locales_one_default_idx
  on workspace_locales(workspace_id)
  where is_default = true;

create index if not exists workspace_locales_fallback_idx
  on workspace_locales(workspace_id, fallback_locale)
  where fallback_locale is not null;

-- Self-referencing fallback integrity. The existing unique(workspace_id, locale)
-- constraint is the referenced key.
do $$
begin
  alter table workspace_locales
    add constraint workspace_locales_fallback_fk
    foreign key (workspace_id, fallback_locale)
    references workspace_locales(workspace_id, locale)
    on update cascade on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table workspace_locales
    add constraint workspace_locales_no_self_fallback_check
    check (fallback_locale is null or fallback_locale <> locale);
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 2. Workflow configuration and multi-stage approval evidence
-- ============================================================================

alter table workflow_instances add column if not exists current_stage integer not null default 0;

create table if not exists workflow_stage_approvals (
  id uuid default gen_random_uuid() primary key,
  workflow_instance_id uuid not null references workflow_instances(id) on delete cascade,
  stage_index integer not null check (stage_index >= 0),
  actor_id uuid not null references admin_users(id) on delete restrict,
  comment text,
  created_at timestamptz not null default now(),
  unique (workflow_instance_id, stage_index, actor_id)
);
create index if not exists workflow_stage_approvals_instance_idx
  on workflow_stage_approvals(workflow_instance_id, stage_index, created_at);
alter table workflow_stage_approvals enable row level security;

-- ============================================================================
-- 3. Release governance, locale targets, assignments, history, rollback plan
-- ============================================================================

alter table releases add column if not exists updated_by uuid references admin_users(id) on delete set null;
alter table releases add column if not exists status_reason text;
alter table releases add column if not exists execution_started_at timestamptz;
alter table releases add column if not exists cancelled_at timestamptz;
alter table releases add column if not exists rollback_of_release_id uuid references releases(id) on delete set null;

create unique index if not exists releases_id_workspace_idx on releases(id, workspace_id);

create table if not exists release_locale_targets (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null,
  workspace_id uuid not null,
  locale text not null,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  unique (release_id, locale),
  foreign key (release_id, workspace_id) references releases(id, workspace_id) on delete cascade,
  foreign key (workspace_id, locale) references workspace_locales(workspace_id, locale) on delete restrict
);

create table if not exists release_approvals (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null,
  workspace_id uuid not null,
  actor_admin_user_id uuid references admin_users(id) on delete set null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  comment text,
  created_at timestamptz not null default now(),
  foreign key (release_id, workspace_id) references releases(id, workspace_id) on delete cascade
);

create table if not exists release_assignments (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null,
  workspace_id uuid not null,
  assigned_to_admin_user_id uuid not null references admin_users(id) on delete cascade,
  assigned_by_admin_user_id uuid references admin_users(id) on delete set null,
  role text not null check (role in ('reviewer', 'approver', 'publisher')),
  status text not null check (status in ('active', 'completed', 'cancelled')) default 'active',
  due_at timestamptz,
  note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (release_id, assigned_to_admin_user_id, role),
  foreign key (release_id, workspace_id) references releases(id, workspace_id) on delete cascade
);

create table if not exists release_history (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null,
  workspace_id uuid not null,
  actor_admin_user_id uuid references admin_users(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  detail_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (release_id, workspace_id) references releases(id, workspace_id) on delete cascade
);

create table if not exists release_rollback_items (
  id uuid default gen_random_uuid() primary key,
  release_id uuid not null,
  workspace_id uuid not null,
  entry_id uuid not null references content_entries(id) on delete restrict,
  target_version_id uuid not null references content_entry_versions(id) on delete restrict,
  previous_published_version_id uuid references content_entry_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (release_id, entry_id),
  foreign key (release_id, workspace_id) references releases(id, workspace_id) on delete cascade
);

create index if not exists release_locale_targets_release_idx on release_locale_targets(release_id, required, locale);
create index if not exists release_approvals_release_idx on release_approvals(release_id, created_at desc);
create index if not exists release_assignments_queue_idx on release_assignments(workspace_id, assigned_to_admin_user_id, status, due_at);
create index if not exists release_history_release_idx on release_history(release_id, created_at desc);
create index if not exists release_rollback_items_release_idx on release_rollback_items(release_id, entry_id);

alter table release_locale_targets enable row level security;
alter table release_approvals enable row level security;
alter table release_assignments enable row level security;
alter table release_history enable row level security;
alter table release_rollback_items enable row level security;

-- Notifications can now point at release work as well as entry work.
alter table editorial_notifications add column if not exists release_id uuid references releases(id) on delete cascade;
alter table editorial_notifications drop constraint if exists editorial_notifications_kind_check;
alter table editorial_notifications
  add constraint editorial_notifications_kind_check
  check (kind in ('assignment', 'mention', 'comment_reply', 'workflow', 'due_soon', 'release'));
create index if not exists editorial_notifications_release_idx
  on editorial_notifications(release_id, created_at desc)
  where release_id is not null;

-- ============================================================================
-- 4. Atomic locale configuration
-- ============================================================================

create or replace function cms_configure_locale(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_locale text,
  p_enabled boolean default true,
  p_required boolean default false,
  p_is_default boolean default false,
  p_fallback_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row workspace_locales%rowtype;
  v_cycle boolean := false;
begin
  if p_locale is null or btrim(p_locale) = '' then
    raise exception 'Locale is required' using errcode = '22023';
  end if;
  if not exists (select 1 from workspaces where id = p_workspace_id and status = 'active') then
    raise exception 'Workspace not found' using errcode = 'P0002';
  end if;
  if p_fallback_locale = p_locale then
    raise exception 'A locale cannot fall back to itself' using errcode = '22023';
  end if;
  if p_fallback_locale is not null and not exists (
    select 1 from workspace_locales
    where workspace_id = p_workspace_id and locale = p_fallback_locale and enabled = true
  ) then
    raise exception 'Fallback locale must be enabled in this workspace' using errcode = 'P0002';
  end if;

  -- Reject cycles such as de -> fr -> de before writing the new edge.
  if p_fallback_locale is not null then
    with recursive chain(locale, fallback_locale, depth) as (
      select wl.locale, wl.fallback_locale, 1
      from workspace_locales wl
      where wl.workspace_id = p_workspace_id and wl.locale = p_fallback_locale
      union all
      select wl.locale, wl.fallback_locale, c.depth + 1
      from chain c
      join workspace_locales wl
        on wl.workspace_id = p_workspace_id and wl.locale = c.fallback_locale
      where c.fallback_locale is not null and c.depth < 32
    )
    select exists(select 1 from chain where locale = p_locale or fallback_locale = p_locale)
      into v_cycle;
    if v_cycle then
      raise exception 'Locale fallback would create a cycle' using errcode = 'P0003';
    end if;
  end if;

  if coalesce(p_enabled, true) = false and exists (
    select 1 from workspace_locales
    where workspace_id = p_workspace_id and locale = p_locale and is_default = true
  ) then
    raise exception 'The default locale cannot be disabled' using errcode = 'P0003';
  end if;
  if coalesce(p_enabled, true) = false and exists (
    select 1 from workspace_locales
    where workspace_id = p_workspace_id and fallback_locale = p_locale and locale <> p_locale
  ) then
    raise exception 'This locale is used as a fallback by another locale' using errcode = 'P0003';
  end if;

  if p_is_default then
    update workspace_locales set is_default = false where workspace_id = p_workspace_id;
    update workspaces
      set default_locale = p_locale, updated_at = clock_timestamp()
      where id = p_workspace_id;
  end if;

  insert into workspace_locales (workspace_id, locale, enabled, required, is_default, fallback_locale)
  values (
    p_workspace_id,
    p_locale,
    case when p_is_default then true else coalesce(p_enabled, true) end,
    coalesce(p_required, false),
    coalesce(p_is_default, false),
    p_fallback_locale
  )
  on conflict (workspace_id, locale) do update
  set enabled = excluded.enabled,
      required = excluded.required,
      is_default = excluded.is_default,
      fallback_locale = excluded.fallback_locale
  returning * into v_row;

  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'localization.locale_configured', 'workspace_locale', p_locale,
    jsonb_build_object(
      'enabled', v_row.enabled,
      'required', v_row.required,
      'isDefault', v_row.is_default,
      'fallbackLocale', v_row.fallback_locale
    )
  );

  return row_to_json(v_row)::jsonb;
end;
$$;

-- ============================================================================
-- 5. Atomic workflow definition mutation
-- ============================================================================

create or replace function cms_upsert_workflow_definition(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_definition_id uuid,
  p_name text,
  p_content_model_id uuid,
  p_definition jsonb,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_row workflow_definitions%rowtype;
begin
  if p_name is null or char_length(btrim(p_name)) < 1 then
    raise exception 'Workflow name is required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_definition) <> 'object' then
    raise exception 'Workflow definition must be a JSON object' using errcode = '22023';
  end if;
  if p_content_model_id is not null and not exists (
    select 1 from content_models where id = p_content_model_id and workspace_id = p_workspace_id
  ) then
    raise exception 'Content model not found in workspace' using errcode = 'P0002';
  end if;

  -- One active definition per scope. Model-specific definitions override the
  -- workspace default in cms_transition_workflow.
  if coalesce(p_active, true) then
    update workflow_definitions
      set active = false, updated_at = clock_timestamp()
      where workspace_id = p_workspace_id
        and active = true
        and ((p_content_model_id is null and content_model_id is null)
          or content_model_id = p_content_model_id)
        and (p_definition_id is null or id <> p_definition_id);
  end if;

  if p_definition_id is null then
    insert into workflow_definitions (workspace_id, name, content_model_id, definition_json, active)
    values (p_workspace_id, btrim(p_name), p_content_model_id, p_definition, coalesce(p_active, true))
    returning * into v_row;
  else
    update workflow_definitions
      set name = btrim(p_name),
          content_model_id = p_content_model_id,
          definition_json = p_definition,
          active = coalesce(p_active, true),
          updated_at = clock_timestamp()
      where id = p_definition_id and workspace_id = p_workspace_id
      returning * into v_row;
    if not found then
      raise exception 'Workflow definition not found' using errcode = 'P0002';
    end if;
  end if;

  insert into platform_audit_events (
    workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
  ) values (
    p_workspace_id, p_actor_id, 'workflow.definition_saved', 'workflow_definition', v_row.id::text,
    jsonb_build_object('name', v_row.name, 'contentModelId', v_row.content_model_id, 'active', v_row.active)
  );

  return row_to_json(v_row)::jsonb;
end;
$$;

-- ============================================================================
-- 6. Constrained configurable editorial workflow transitions
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
  v_stages jsonb;
  v_stage jsonb;
  v_stage_count integer;
  v_required_approvals integer;
  v_approval_count integer;
  v_stage_approval_id uuid;
  v_required_roles jsonb;
  v_self_approval boolean;
begin
  select id, workspace_id, content_model_id, status, current_draft_version_id, created_by
    into v_entry
    from content_entries
    where workspace_id = p_workspace_id and id = p_entry_id
    for update;

  if not found or v_entry.current_draft_version_id is null then
    raise exception 'Entry with a draft is required' using errcode = 'P0002';
  end if;

  select * into v_instance
    from workflow_instances
    where entry_id = p_entry_id
    order by started_at desc
    limit 1
    for update;

  if p_action = 'submit' then
    if v_entry.status not in ('draft', 'approved') then
      raise exception 'Only a draft can be submitted for review' using errcode = 'P0003';
    end if;
    if v_instance.id is not null and v_instance.completed_at is null then
      raise exception 'An active review already exists' using errcode = 'P0003';
    end if;

    select * into v_def
      from workflow_definitions
      where workspace_id = p_workspace_id
        and active = true
        and (content_model_id = v_entry.content_model_id or content_model_id is null)
      order by (content_model_id = v_entry.content_model_id) desc, updated_at desc
      limit 1;
    if v_def.id is null then
      raise exception 'No active workflow definition' using errcode = 'P0002';
    end if;

    insert into workflow_instances (
      entry_id, version_id, workflow_definition_id, current_state, current_stage, started_by
    ) values (
      v_entry.id, v_entry.current_draft_version_id, v_def.id, 'in_review', 0, p_actor_id
    ) returning id into v_new_instance_id;

    insert into workflow_actions (
      workflow_instance_id, actor_id, action, from_state, to_state, comment
    ) values (
      v_new_instance_id, p_actor_id, 'submitted', 'draft', 'in_review', p_comment
    );

    update content_entries
      set status = 'in_review', updated_by = p_actor_id, updated_at = clock_timestamp()
      where id = v_entry.id;

    insert into editorial_notifications (
      workspace_id, recipient_admin_user_id, entry_id, kind, payload_json
    )
    select distinct p_workspace_id, ca.assigned_to_admin_user_id, p_entry_id, 'workflow',
      jsonb_build_object('action', 'review_requested', 'workflowInstanceId', v_new_instance_id)
    from content_assignments ca
    where ca.workspace_id = p_workspace_id
      and ca.entry_id = p_entry_id
      and ca.status = 'active'
      and ca.role in ('reviewer', 'approver')
      and ca.assigned_to_admin_user_id <> p_actor_id;

    insert into platform_audit_events (
      workspace_id, actor_admin_user_id, action, entity_type, entity_id,
      metadata_json
    ) values (
      p_workspace_id, p_actor_id, 'workflow.review_submitted', 'content_entry', v_entry.id::text,
      jsonb_build_object('workflowDefinitionId', v_def.id, 'workflowInstanceId', v_new_instance_id)
    );

    return jsonb_build_object('success', true, 'instance_id', v_new_instance_id, 'state', 'in_review', 'stage', 0);

  elsif p_action in ('approve', 'request_changes') then
    if v_instance.id is null or v_instance.completed_at is not null or v_instance.current_state <> 'in_review' then
      raise exception 'No review awaiting action' using errcode = 'P0003';
    end if;
    if not p_can_publish then
      raise exception 'Publishing permission is required for review decisions' using errcode = '40301';
    end if;

    select * into v_def from workflow_definitions where id = v_instance.workflow_definition_id;
    if v_def.id is null then
      raise exception 'Workflow definition not found' using errcode = 'P0002';
    end if;

    v_self_approval := lower(coalesce(v_def.definition_json->>'self_approval', 'false')) = 'true';
    if p_action = 'approve' and not v_self_approval
      and (v_instance.started_by = p_actor_id or v_entry.created_by = p_actor_id) then
      raise exception 'A requester cannot approve their own review' using errcode = '40300';
    end if;

    if p_action = 'request_changes' then
      update workflow_instances
        set current_state = 'changes_requested', completed_at = clock_timestamp()
        where id = v_instance.id and current_state = 'in_review' and completed_at is null;
      if not found then
        raise exception 'Workflow state conflict: review has already been decided or completed' using errcode = 'P0003';
      end if;

      insert into workflow_actions (
        workflow_instance_id, actor_id, action, from_state, to_state, comment
      ) values (
        v_instance.id, p_actor_id, 'changes_requested', 'in_review', 'changes_requested', p_comment
      );
      update content_entries
        set status = 'draft', updated_by = p_actor_id, updated_at = clock_timestamp()
        where id = v_entry.id;

      if v_instance.started_by is not null and v_instance.started_by <> p_actor_id then
        insert into editorial_notifications (workspace_id, recipient_admin_user_id, entry_id, kind, payload_json)
        values (p_workspace_id, v_instance.started_by, p_entry_id, 'workflow', jsonb_build_object('action', 'changes_requested'));
      end if;

      insert into platform_audit_events (
        workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
      ) values (
        p_workspace_id, p_actor_id, 'workflow.changes_requested', 'content_entry', v_entry.id::text,
        jsonb_build_object('workflowInstanceId', v_instance.id, 'stage', v_instance.current_stage)
      );
      return jsonb_build_object('success', true, 'instance_id', v_instance.id, 'state', 'changes_requested');
    end if;

    -- Approval path. Missing/empty approval_stages intentionally degrades to
    -- the historical one-stage workflow so all existing definitions remain valid.
    v_stages := v_def.definition_json->'approval_stages';
    if jsonb_typeof(v_stages) <> 'array' or jsonb_array_length(v_stages) = 0 then
      v_stages := '[{"key":"editorial","label":"Editorial approval","required_approvals":1,"required_role_keys":[]}]'::jsonb;
    end if;
    v_stage_count := jsonb_array_length(v_stages);
    if v_instance.current_stage >= v_stage_count then
      raise exception 'Workflow stage is out of range' using errcode = 'P0003';
    end if;

    v_stage := v_stages->v_instance.current_stage;
    begin
      v_required_approvals := greatest(1, coalesce((v_stage->>'required_approvals')::integer, 1));
    exception when invalid_text_representation then
      raise exception 'required_approvals must be an integer' using errcode = '22023';
    end;
    v_required_roles := coalesce(v_stage->'required_role_keys', '[]'::jsonb);
    if jsonb_typeof(v_required_roles) <> 'array' then
      raise exception 'required_role_keys must be an array' using errcode = '22023';
    end if;

    if jsonb_array_length(v_required_roles) > 0 and not exists (
      select 1
      from workspace_members wm
      join member_roles mr on mr.workspace_member_id = wm.id
      join roles r on r.id = mr.role_id
      where wm.workspace_id = p_workspace_id
        and wm.admin_user_id = p_actor_id
        and wm.status = 'active'
        and r.key in (select jsonb_array_elements_text(v_required_roles))
    ) then
      raise exception 'The current approval stage requires a different workspace role' using errcode = '40302';
    end if;

    insert into workflow_stage_approvals (
      workflow_instance_id, stage_index, actor_id, comment
    ) values (
      v_instance.id, v_instance.current_stage, p_actor_id, p_comment
    )
    on conflict (workflow_instance_id, stage_index, actor_id) do nothing
    returning id into v_stage_approval_id;
    if v_stage_approval_id is null then
      raise exception 'This reviewer has already approved the current stage' using errcode = 'P0003';
    end if;

    select count(*) into v_approval_count
      from workflow_stage_approvals
      where workflow_instance_id = v_instance.id and stage_index = v_instance.current_stage;

    if v_approval_count < v_required_approvals then
      insert into workflow_actions (
        workflow_instance_id, actor_id, action, from_state, to_state, comment
      ) values (
        v_instance.id, p_actor_id, 'approved', 'in_review', 'in_review', p_comment
      );
      insert into platform_audit_events (
        workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
      ) values (
        p_workspace_id, p_actor_id, 'workflow.stage_approval_recorded', 'content_entry', v_entry.id::text,
        jsonb_build_object('workflowInstanceId', v_instance.id, 'stage', v_instance.current_stage, 'approvalCount', v_approval_count, 'requiredApprovals', v_required_approvals)
      );
      return jsonb_build_object('success', true, 'instance_id', v_instance.id, 'state', 'in_review', 'stage', v_instance.current_stage, 'approval_count', v_approval_count, 'required_approvals', v_required_approvals);
    end if;

    if v_instance.current_stage + 1 < v_stage_count then
      update workflow_instances
        set current_stage = current_stage + 1
        where id = v_instance.id and current_state = 'in_review' and completed_at is null;
      if not found then
        raise exception 'Workflow state conflict: review has already been decided or completed' using errcode = 'P0003';
      end if;
      insert into workflow_actions (
        workflow_instance_id, actor_id, action, from_state, to_state, comment
      ) values (
        v_instance.id, p_actor_id, 'approved', 'in_review', 'in_review', p_comment
      );
      insert into platform_audit_events (
        workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
      ) values (
        p_workspace_id, p_actor_id, 'workflow.stage_approved', 'content_entry', v_entry.id::text,
        jsonb_build_object('workflowInstanceId', v_instance.id, 'completedStage', v_instance.current_stage, 'nextStage', v_instance.current_stage + 1)
      );
      return jsonb_build_object('success', true, 'instance_id', v_instance.id, 'state', 'in_review', 'stage', v_instance.current_stage + 1);
    end if;

    update workflow_instances
      set current_state = 'approved', completed_at = clock_timestamp()
      where id = v_instance.id and current_state = 'in_review' and completed_at is null;
    if not found then
      raise exception 'Workflow state conflict: review has already been decided or completed' using errcode = 'P0003';
    end if;

    insert into workflow_actions (
      workflow_instance_id, actor_id, action, from_state, to_state, comment
    ) values (
      v_instance.id, p_actor_id, 'approved', 'in_review', 'approved', p_comment
    );
    update content_entries
      set status = 'approved', updated_by = p_actor_id, updated_at = clock_timestamp()
      where id = v_entry.id;

    if v_instance.started_by is not null and v_instance.started_by <> p_actor_id then
      insert into editorial_notifications (workspace_id, recipient_admin_user_id, entry_id, kind, payload_json)
      values (p_workspace_id, v_instance.started_by, p_entry_id, 'workflow', jsonb_build_object('action', 'approved'));
    end if;

    insert into platform_audit_events (
      workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json
    ) values (
      p_workspace_id, p_actor_id, 'workflow.approved', 'content_entry', v_entry.id::text,
      jsonb_build_object('workflowInstanceId', v_instance.id, 'stages', v_stage_count)
    );
    return jsonb_build_object('success', true, 'instance_id', v_instance.id, 'state', 'approved', 'stage', v_instance.current_stage);
  else
    raise exception 'Unsupported workflow action: %', p_action using errcode = '22023';
  end if;
end;
$$;

-- ============================================================================
-- 7. Atomic release creation/item/locale mutation
-- ============================================================================

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

  -- Required locales are invariant: they can never be silently omitted from
  -- a coordinated release, even when the caller supplies an explicit subset.
  insert into release_locale_targets (release_id, workspace_id, locale, required)
  select v_release.id, p_workspace_id, locale, required
  from workspace_locales
  where workspace_id = p_workspace_id and enabled = true and required = true
  on conflict (release_id, locale) do nothing;

  -- Add the explicit selection; if none is supplied, inherit all enabled locales.
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

create or replace function cms_replace_release_items(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_release_id uuid,
  p_item_version_ids jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release releases%rowtype;
  v_expected integer;
  v_actual integer;
begin
  select * into v_release from releases where id = p_release_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Release not found' using errcode = 'P0002'; end if;
  if v_release.status <> 'draft' then raise exception 'Only draft releases can change items' using errcode = 'P0003'; end if;
  if jsonb_typeof(p_item_version_ids) <> 'array' or jsonb_array_length(p_item_version_ids) = 0 then
    raise exception 'A release needs at least one approved entry version' using errcode = '22023';
  end if;

  select count(distinct value::uuid) into v_expected from jsonb_array_elements_text(p_item_version_ids);
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

  delete from release_items where release_id = p_release_id;
  insert into release_items (release_id, entry_id, entry_version_id)
  select p_release_id, cev.entry_id, cev.id
  from content_entry_versions cev
  where cev.id in (select distinct value::uuid from jsonb_array_elements_text(p_item_version_ids));

  update releases set updated_by = p_actor_id, updated_at = clock_timestamp() where id = p_release_id;
  insert into release_history (release_id, workspace_id, actor_admin_user_id, action, from_status, to_status, detail_json)
  values (p_release_id, p_workspace_id, p_actor_id, 'items_replaced', 'draft', 'draft', jsonb_build_object('itemCount', v_expected));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.items_replaced', 'release', p_release_id::text, jsonb_build_object('itemCount', v_expected));
  return jsonb_build_object('release_id', p_release_id, 'item_count', v_expected);
end;
$$;

create or replace function cms_set_release_locales(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_release_id uuid,
  p_locales jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release releases%rowtype;
  v_locale text;
  v_count integer := 0;
begin
  select * into v_release from releases where id = p_release_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Release not found' using errcode = 'P0002'; end if;
  if v_release.status <> 'draft' then raise exception 'Only draft releases can change locale targets' using errcode = 'P0003'; end if;
  if jsonb_typeof(p_locales) <> 'array' then raise exception 'locales must be an array' using errcode = '22023'; end if;

  -- Required workspace locales can never be silently removed from a coordinated release.
  delete from release_locale_targets where release_id = p_release_id;
  insert into release_locale_targets (release_id, workspace_id, locale, required)
  select p_release_id, p_workspace_id, locale, required
  from workspace_locales
  where workspace_id = p_workspace_id and enabled = true and required = true
  on conflict (release_id, locale) do nothing;

  for v_locale in select distinct value from jsonb_array_elements_text(p_locales)
  loop
    if not exists (select 1 from workspace_locales where workspace_id = p_workspace_id and locale = v_locale and enabled = true) then
      raise exception 'Locale % is not enabled in this workspace', v_locale using errcode = 'P0002';
    end if;
    insert into release_locale_targets (release_id, workspace_id, locale, required)
    select p_release_id, p_workspace_id, locale, required
    from workspace_locales
    where workspace_id = p_workspace_id and locale = v_locale
    on conflict (release_id, locale) do nothing;
  end loop;

  select count(*) into v_count from release_locale_targets where release_id = p_release_id;
  update releases set updated_by = p_actor_id, updated_at = clock_timestamp() where id = p_release_id;
  insert into release_history (release_id, workspace_id, actor_admin_user_id, action, from_status, to_status, detail_json)
  values (p_release_id, p_workspace_id, p_actor_id, 'locales_updated', 'draft', 'draft', jsonb_build_object('localeCount', v_count));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.locales_updated', 'release', p_release_id::text, jsonb_build_object('localeCount', v_count));
  return jsonb_build_object('release_id', p_release_id, 'locale_count', v_count);
end;
$$;

-- ============================================================================
-- 8. Release approval, scheduling, cancellation, rollback snapshot
-- ============================================================================

create or replace function cms_transition_release(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_release_id uuid,
  p_action text,
  p_scheduled_for timestamptz default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release releases%rowtype;
  v_from text;
  v_to text;
begin
  select * into v_release from releases where id = p_release_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Release not found' using errcode = 'P0002'; end if;
  v_from := v_release.status;

  if p_action = 'approve' then
    if v_release.status <> 'draft' then raise exception 'Only a draft release can be approved' using errcode = 'P0003'; end if;
    if not exists (select 1 from release_items where release_id = p_release_id) then
      raise exception 'Release has no items' using errcode = 'P0003';
    end if;
    v_to := 'approved';
    update releases set status = v_to, approved_by = p_actor_id, approved_at = clock_timestamp(), updated_by = p_actor_id, updated_at = clock_timestamp(), status_reason = null where id = p_release_id;
    insert into release_approvals (release_id, workspace_id, actor_admin_user_id, decision, comment)
    values (p_release_id, p_workspace_id, p_actor_id, 'approved', nullif(btrim(coalesce(p_comment, '')), ''));

    delete from release_rollback_items where release_id = p_release_id;
    insert into release_rollback_items (release_id, workspace_id, entry_id, target_version_id, previous_published_version_id)
    select p_release_id, p_workspace_id, ri.entry_id, ri.entry_version_id, ce.published_version_id
    from release_items ri
    join content_entries ce on ce.id = ri.entry_id
    where ri.release_id = p_release_id;

  elsif p_action = 'request_changes' then
    if v_release.status not in ('approved', 'scheduled') then raise exception 'Only an approved or scheduled release can be returned to draft' using errcode = 'P0003'; end if;
    v_to := 'draft';
    update releases set status = v_to, approved_by = null, approved_at = null, scheduled_for = null, updated_by = p_actor_id, updated_at = clock_timestamp(), status_reason = nullif(btrim(coalesce(p_comment, '')), '') where id = p_release_id;
    update editorial_calendar_events set status = 'cancelled', updated_at = clock_timestamp() where release_id = p_release_id and kind = 'release' and status = 'scheduled';
    insert into release_approvals (release_id, workspace_id, actor_admin_user_id, decision, comment)
    values (p_release_id, p_workspace_id, p_actor_id, 'changes_requested', nullif(btrim(coalesce(p_comment, '')), ''));

  elsif p_action = 'schedule' then
    if v_release.status not in ('approved', 'scheduled') then raise exception 'Release must be approved before scheduling' using errcode = 'P0003'; end if;
    if p_scheduled_for is null or p_scheduled_for <= clock_timestamp() then raise exception 'scheduledFor must be in the future' using errcode = '22023'; end if;
    v_to := 'scheduled';
    update releases set status = v_to, scheduled_for = p_scheduled_for, updated_by = p_actor_id, updated_at = clock_timestamp(), status_reason = null where id = p_release_id;
    update editorial_calendar_events
      set starts_at = p_scheduled_for, title = v_release.name, updated_at = clock_timestamp()
      where release_id = p_release_id and kind = 'release' and status = 'scheduled';
    if not found then
      insert into editorial_calendar_events (workspace_id, release_id, kind, title, starts_at, created_by)
      values (p_workspace_id, p_release_id, 'release', v_release.name, p_scheduled_for, p_actor_id);
    end if;

  elsif p_action = 'cancel' then
    if v_release.status in ('published', 'cancelled') then raise exception 'Published or cancelled releases cannot be cancelled again' using errcode = 'P0003'; end if;
    v_to := 'cancelled';
    update releases set status = v_to, cancelled_at = clock_timestamp(), updated_by = p_actor_id, updated_at = clock_timestamp(), status_reason = nullif(btrim(coalesce(p_comment, '')), '') where id = p_release_id;
    update editorial_calendar_events set status = 'cancelled', updated_at = clock_timestamp() where release_id = p_release_id and kind = 'release' and status = 'scheduled';
  else
    raise exception 'Unsupported release action: %', p_action using errcode = '22023';
  end if;

  insert into release_history (release_id, workspace_id, actor_admin_user_id, action, from_status, to_status, detail_json)
  values (p_release_id, p_workspace_id, p_actor_id, p_action, v_from, v_to, jsonb_build_object('comment', p_comment, 'scheduledFor', p_scheduled_for));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.' || p_action, 'release', p_release_id::text, jsonb_build_object('fromStatus', v_from, 'toStatus', v_to, 'scheduledFor', p_scheduled_for));

  -- Notify release assignees about the state change.
  insert into editorial_notifications (workspace_id, recipient_admin_user_id, release_id, kind, payload_json)
  select p_workspace_id, assigned_to_admin_user_id, p_release_id, 'release',
    jsonb_build_object('action', p_action, 'fromStatus', v_from, 'toStatus', v_to, 'scheduledFor', p_scheduled_for)
  from release_assignments
  where release_id = p_release_id and status = 'active' and assigned_to_admin_user_id <> p_actor_id;

  return jsonb_build_object('release_id', p_release_id, 'status', v_to, 'scheduled_for', p_scheduled_for);
end;
$$;

-- ============================================================================
-- 9. Pinned-version release execution
-- ============================================================================

create or replace function cms_publish_release(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_release releases%rowtype;
  v_item record;
  v_entry record;
  v_model record;
  v_count integer := 0;
  v_from text;
begin
  select * into v_release from releases where id = p_release_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'Release not found' using errcode = 'P0002'; end if;
  if v_release.status not in ('approved', 'scheduled') then raise exception 'Release must be approved before publication' using errcode = 'P0003'; end if;
  if v_release.status = 'scheduled' and (v_release.scheduled_for is null or v_release.scheduled_for > clock_timestamp()) then
    raise exception 'Scheduled release is not due yet' using errcode = 'P0003';
  end if;
  if not exists (select 1 from release_items where release_id = p_release_id) then raise exception 'Release has no items' using errcode = 'P0003'; end if;

  v_from := v_release.status;
  update releases set status = 'publishing', execution_started_at = clock_timestamp(), updated_by = p_actor_id, updated_at = clock_timestamp() where id = p_release_id;

  for v_item in
    select ri.id as release_item_id, ri.entry_id, ri.entry_version_id
    from release_items ri
    where ri.release_id = p_release_id
    order by ri.created_at, ri.id
  loop
    select * into v_entry
      from content_entries
      where id = v_item.entry_id and workspace_id = p_workspace_id
      for update;
    if not found then raise exception 'Release entry % not found in workspace', v_item.entry_id using errcode = 'P0002'; end if;
    if v_entry.current_draft_version_id is distinct from v_item.entry_version_id or v_entry.status <> 'approved' then
      raise exception 'Release item % drifted after approval; rebuild or re-approve the release', v_item.entry_id using errcode = 'P0003';
    end if;
    if not exists (select 1 from content_entry_versions where id = v_item.entry_version_id and entry_id = v_item.entry_id) then
      raise exception 'Pinned version does not belong to release entry' using errcode = 'P0003';
    end if;

    select * into v_model from content_models where id = v_entry.content_model_id and workspace_id = p_workspace_id;
    if not found or coalesce(v_model.settings_json->>'capability', 'publishable') = 'data_only' then
      raise exception 'Release contains a non-publishable content model' using errcode = 'P0003';
    end if;

    update content_entry_versions set state = 'archived'
      where entry_id = v_item.entry_id and state = 'published' and id <> v_item.entry_version_id;
    update content_entry_versions set state = 'published' where id = v_item.entry_version_id;
    update content_entries
      set status = 'published', published_version_id = v_item.entry_version_id, updated_by = p_actor_id, updated_at = clock_timestamp()
      where id = v_item.entry_id;
    update content_search_documents
      set status = 'published', version_id = v_item.entry_version_id, updated_at = clock_timestamp()
      where entry_id = v_item.entry_id;
    update release_items
      set delivery_status = 'published', delivery_error = null
      where id = v_item.release_item_id;

    insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
    values (p_workspace_id, p_actor_id, 'content.entry.published_via_release', 'content_entry', v_item.entry_id::text, jsonb_build_object('releaseId', p_release_id, 'publishedVersionId', v_item.entry_version_id));
    v_count := v_count + 1;
  end loop;

  update releases
    set status = 'published', published_at = clock_timestamp(), updated_by = p_actor_id, updated_at = clock_timestamp(), status_reason = null
    where id = p_release_id;
  update editorial_calendar_events set status = 'completed', updated_at = clock_timestamp()
    where release_id = p_release_id and kind = 'release' and status = 'scheduled';
  update release_assignments set status = 'completed', completed_at = clock_timestamp(), updated_at = clock_timestamp()
    where release_id = p_release_id and status = 'active';

  insert into release_history (release_id, workspace_id, actor_admin_user_id, action, from_status, to_status, detail_json)
  values (p_release_id, p_workspace_id, p_actor_id, 'published', v_from, 'published', jsonb_build_object('itemCount', v_count));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.published', 'release', p_release_id::text, jsonb_build_object('itemCount', v_count));

  return jsonb_build_object('release_id', p_release_id, 'status', 'published', 'published_items', v_count);
end;
$$;

-- ============================================================================
-- 10. Release assignment + notification mutation
-- ============================================================================

create or replace function cms_assign_release(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_release_id uuid,
  p_assignee_id uuid,
  p_role text,
  p_due_at timestamptz default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_assignment release_assignments%rowtype;
begin
  if p_role not in ('reviewer', 'approver', 'publisher') then raise exception 'Invalid release assignment role' using errcode = '22023'; end if;
  if not exists (select 1 from releases where id = p_release_id and workspace_id = p_workspace_id) then raise exception 'Release not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from workspace_members where workspace_id = p_workspace_id and admin_user_id = p_assignee_id and status = 'active') then raise exception 'Assignee is not an active workspace member' using errcode = 'P0002'; end if;

  insert into release_assignments (release_id, workspace_id, assigned_to_admin_user_id, assigned_by_admin_user_id, role, due_at, note, status, updated_at)
  values (p_release_id, p_workspace_id, p_assignee_id, p_actor_id, p_role, p_due_at, nullif(btrim(coalesce(p_note, '')), ''), 'active', clock_timestamp())
  on conflict (release_id, assigned_to_admin_user_id, role) do update
  set assigned_by_admin_user_id = excluded.assigned_by_admin_user_id,
      due_at = excluded.due_at,
      note = excluded.note,
      status = 'active',
      completed_at = null,
      updated_at = clock_timestamp()
  returning * into v_assignment;

  insert into editorial_notifications (workspace_id, recipient_admin_user_id, release_id, kind, payload_json)
  values (p_workspace_id, p_assignee_id, p_release_id, 'release', jsonb_build_object('action', 'assignment', 'role', p_role, 'dueAt', p_due_at));
  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'release.assigned', 'release', p_release_id::text, jsonb_build_object('assigneeId', p_assignee_id, 'role', p_role, 'dueAt', p_due_at));

  return row_to_json(v_assignment)::jsonb;
end;
$$;

-- ============================================================================
-- 11. Execution privileges — service boundary only
-- ============================================================================

revoke execute on function cms_configure_locale(uuid, uuid, text, boolean, boolean, boolean, text) from public;
revoke execute on function cms_upsert_workflow_definition(uuid, uuid, uuid, text, uuid, jsonb, boolean) from public;
revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from public;
revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from public;
revoke execute on function cms_replace_release_items(uuid, uuid, uuid, jsonb) from public;
revoke execute on function cms_set_release_locales(uuid, uuid, uuid, jsonb) from public;
revoke execute on function cms_transition_release(uuid, uuid, uuid, text, timestamptz, text) from public;
revoke execute on function cms_publish_release(uuid, uuid, uuid) from public;
revoke execute on function cms_assign_release(uuid, uuid, uuid, uuid, text, timestamptz, text) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function cms_configure_locale(uuid, uuid, text, boolean, boolean, boolean, text) from anon;
    revoke execute on function cms_upsert_workflow_definition(uuid, uuid, uuid, text, uuid, jsonb, boolean) from anon;
    revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from anon;
    revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from anon;
    revoke execute on function cms_replace_release_items(uuid, uuid, uuid, jsonb) from anon;
    revoke execute on function cms_set_release_locales(uuid, uuid, uuid, jsonb) from anon;
    revoke execute on function cms_transition_release(uuid, uuid, uuid, text, timestamptz, text) from anon;
    revoke execute on function cms_publish_release(uuid, uuid, uuid) from anon;
    revoke execute on function cms_assign_release(uuid, uuid, uuid, uuid, text, timestamptz, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function cms_configure_locale(uuid, uuid, text, boolean, boolean, boolean, text) from authenticated;
    revoke execute on function cms_upsert_workflow_definition(uuid, uuid, uuid, text, uuid, jsonb, boolean) from authenticated;
    revoke execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) from authenticated;
    revoke execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) from authenticated;
    revoke execute on function cms_replace_release_items(uuid, uuid, uuid, jsonb) from authenticated;
    revoke execute on function cms_set_release_locales(uuid, uuid, uuid, jsonb) from authenticated;
    revoke execute on function cms_transition_release(uuid, uuid, uuid, text, timestamptz, text) from authenticated;
    revoke execute on function cms_publish_release(uuid, uuid, uuid) from authenticated;
    revoke execute on function cms_assign_release(uuid, uuid, uuid, uuid, text, timestamptz, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function cms_configure_locale(uuid, uuid, text, boolean, boolean, boolean, text) to service_role;
    grant execute on function cms_upsert_workflow_definition(uuid, uuid, uuid, text, uuid, jsonb, boolean) to service_role;
    grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to service_role;
    grant execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) to service_role;
    grant execute on function cms_replace_release_items(uuid, uuid, uuid, jsonb) to service_role;
    grant execute on function cms_set_release_locales(uuid, uuid, uuid, jsonb) to service_role;
    grant execute on function cms_transition_release(uuid, uuid, uuid, text, timestamptz, text) to service_role;
    grant execute on function cms_publish_release(uuid, uuid, uuid) to service_role;
    grant execute on function cms_assign_release(uuid, uuid, uuid, uuid, text, timestamptz, text) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    grant execute on function cms_configure_locale(uuid, uuid, text, boolean, boolean, boolean, text) to postgres;
    grant execute on function cms_upsert_workflow_definition(uuid, uuid, uuid, text, uuid, jsonb, boolean) to postgres;
    grant execute on function cms_transition_workflow(uuid, uuid, uuid, text, text, boolean) to postgres;
    grant execute on function cms_create_release(uuid, uuid, text, text, jsonb, jsonb) to postgres;
    grant execute on function cms_replace_release_items(uuid, uuid, uuid, jsonb) to postgres;
    grant execute on function cms_set_release_locales(uuid, uuid, uuid, jsonb) to postgres;
    grant execute on function cms_transition_release(uuid, uuid, uuid, text, timestamptz, text) to postgres;
    grant execute on function cms_publish_release(uuid, uuid, uuid) to postgres;
    grant execute on function cms_assign_release(uuid, uuid, uuid, uuid, text, timestamptz, text) to postgres;
  end if;
end $$;
