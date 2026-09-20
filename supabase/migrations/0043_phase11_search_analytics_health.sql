-- Migration 0043: Phase 11 — Search, Analytics and Content Health
-- Production-ranked PostgreSQL search, saved searches, analytics connector freshness,
-- materialized health findings, and remediation work queues.

-- ==========================================================================
-- 1. Ranked PostgreSQL Search
-- ==========================================================================

alter table content_search_documents
  add column if not exists search_vector tsvector
  generated always as (to_tsvector('simple', coalesce(search_text, ''))) stored;

create index if not exists content_search_documents_search_vector_idx
  on content_search_documents using gin (search_vector);

create index if not exists content_search_documents_updated_idx
  on content_search_documents(workspace_id, updated_at desc);

create table if not exists content_saved_searches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  owner_id uuid not null references admin_users(id) on delete cascade,
  name text not null,
  query_json jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, owner_id, name)
);

create index if not exists content_saved_searches_workspace_idx
  on content_saved_searches(workspace_id, owner_id, updated_at desc);

alter table content_saved_searches enable row level security;

create or replace function cms_search_content_ranked(
  p_workspace_id uuid,
  p_query text default null,
  p_model_id uuid default null,
  p_status text default null,
  p_locale text default null,
  p_author_id uuid default null,
  p_updated_from timestamptz default null,
  p_updated_to timestamptz default null,
  p_term_id uuid default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  entry_id uuid,
  workspace_id uuid,
  version_id uuid,
  content_model_id uuid,
  locale text,
  status text,
  author_id uuid,
  search_text text,
  updated_at timestamptz,
  rank real,
  similarity real
)
language sql
security definer
set search_path = public, pg_temp
as $$
  with input as (
    select
      nullif(trim(coalesce(p_query, '')), '') as q,
      case when nullif(trim(coalesce(p_query, '')), '') is null
        then null::tsquery
        else websearch_to_tsquery('simple', trim(p_query))
      end as tsq
  )
  select
    d.entry_id,
    d.workspace_id,
    d.version_id,
    d.content_model_id,
    d.locale,
    d.status,
    d.author_id,
    d.search_text,
    d.updated_at,
    case when input.tsq is null then 0::real else ts_rank_cd(d.search_vector, input.tsq)::real end as rank,
    case when input.q is null then 0::real else similarity(d.search_text, input.q)::real end as similarity
  from content_search_documents d
  cross join input
  where d.workspace_id = p_workspace_id
    and (p_model_id is null or d.content_model_id = p_model_id)
    and (p_status is null or d.status = p_status)
    and (p_locale is null or d.locale = p_locale)
    and (p_author_id is null or d.author_id = p_author_id)
    and (p_updated_from is null or d.updated_at >= p_updated_from)
    and (p_updated_to is null or d.updated_at <= p_updated_to)
    and (
      p_term_id is null
      or exists (
        select 1
        from content_relations r
        where r.workspace_id = p_workspace_id
          and r.source_entry_id = d.entry_id
          and r.source_version_id = d.version_id
          and r.target_term_id = p_term_id
      )
    )
    and (
      input.q is null
      or d.search_vector @@ input.tsq
      or d.search_text % input.q
      or d.search_text ilike '%' || input.q || '%'
    )
  order by
    case when input.q is null then 0 else greatest(
      case when input.tsq is null then 0 else ts_rank_cd(d.search_vector, input.tsq) end,
      similarity(d.search_text, input.q)
    ) end desc,
    d.updated_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke execute on function cms_search_content_ranked(uuid,text,uuid,text,text,uuid,timestamptz,timestamptz,uuid,integer,integer) from public;
revoke execute on function cms_search_content_ranked(uuid,text,uuid,text,text,uuid,timestamptz,timestamptz,uuid,integer,integer) from anon;
revoke execute on function cms_search_content_ranked(uuid,text,uuid,text,text,uuid,timestamptz,timestamptz,uuid,integer,integer) from authenticated;
grant execute on function cms_search_content_ranked(uuid,text,uuid,text,text,uuid,timestamptz,timestamptz,uuid,integer,integer) to service_role;
grant execute on function cms_search_content_ranked(uuid,text,uuid,text,text,uuid,timestamptz,timestamptz,uuid,integer,integer) to postgres;

-- ==========================================================================
-- 2. Analytics Connector + Freshness State
-- ==========================================================================

create table if not exists analytics_connectors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null check (provider in ('ga4')),
  name text not null,
  credential_mode text not null default 'environment' check (credential_mode in ('environment','encrypted')),
  config_json_encrypted text,
  active boolean not null default true,
  created_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, name)
);

create table if not exists analytics_sync_state (
  connector_id uuid primary key references analytics_connectors(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  status text not null default 'never_synced' check (status in ('never_synced','queued','running','fresh','stale','failed')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  fresh_through date,
  last_error text,
  correlation_id uuid,
  updated_at timestamptz not null default now()
);

create index if not exists analytics_sync_state_workspace_idx
  on analytics_sync_state(workspace_id, status, updated_at desc);

alter table analytics_connectors enable row level security;
alter table analytics_sync_state enable row level security;

-- Snapshot provenance/freshness. Existing snapshots remain valid historical data.
alter table content_analytics_snapshots
  add column if not exists connector_id uuid references analytics_connectors(id) on delete set null,
  add column if not exists sync_correlation_id uuid,
  add column if not exists data_fresh_through date;

create index if not exists content_analytics_snapshots_connector_idx
  on content_analytics_snapshots(workspace_id, connector_id, captured_at desc);

-- ==========================================================================
-- 3. Materialized Content Health + Remediation Queue
-- ==========================================================================

create table if not exists content_health_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  entity_type text not null check (entity_type in ('entry','asset')),
  entity_id uuid not null,
  finding_code text not null,
  severity text not null check (severity in ('info','warning','blocking')),
  state text not null default 'open' check (state in ('open','acknowledged','resolved','dismissed')),
  fingerprint text not null,
  title text not null,
  detail text,
  evidence_json jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, fingerprint)
);

create index if not exists content_health_findings_workspace_state_idx
  on content_health_findings(workspace_id, state, severity, last_detected_at desc);
create index if not exists content_health_findings_entity_idx
  on content_health_findings(workspace_id, entity_type, entity_id);

create table if not exists content_remediation_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  finding_id uuid references content_health_findings(id) on delete set null,
  entity_type text not null check (entity_type in ('entry','asset')),
  entity_id uuid not null,
  title text not null,
  status text not null default 'open' check (status in ('open','in_progress','done','dismissed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references admin_users(id) on delete set null,
  due_at timestamptz,
  resolution_note text,
  created_by uuid references admin_users(id) on delete set null,
  completed_by uuid references admin_users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_remediation_tasks_workspace_idx
  on content_remediation_tasks(workspace_id, status, priority, due_at);
create index if not exists content_remediation_tasks_assignee_idx
  on content_remediation_tasks(workspace_id, assigned_to, status);

alter table content_health_findings enable row level security;
alter table content_remediation_tasks enable row level security;

-- Atomic finding upsert used by health scans.
create or replace function cms_upsert_health_finding(
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_finding_code text,
  p_severity text,
  p_fingerprint text,
  p_title text,
  p_detail text default null,
  p_evidence jsonb default '{}'::jsonb
)
returns content_health_findings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row content_health_findings%rowtype;
begin
  if p_entity_type not in ('entry','asset') then
    raise exception 'Unsupported health entity type: %', p_entity_type using errcode = '22023';
  end if;
  if p_severity not in ('info','warning','blocking') then
    raise exception 'Unsupported health severity: %', p_severity using errcode = '22023';
  end if;

  insert into content_health_findings (
    workspace_id, entity_type, entity_id, finding_code, severity, state,
    fingerprint, title, detail, evidence_json, first_detected_at, last_detected_at, updated_at
  ) values (
    p_workspace_id, p_entity_type, p_entity_id, p_finding_code, p_severity, 'open',
    p_fingerprint, p_title, p_detail, coalesce(p_evidence, '{}'::jsonb), now(), now(), now()
  )
  on conflict (workspace_id, fingerprint) do update set
    severity = excluded.severity,
    title = excluded.title,
    detail = excluded.detail,
    evidence_json = excluded.evidence_json,
    state = case when content_health_findings.state in ('resolved','dismissed') then 'open' else content_health_findings.state end,
    resolved_at = null,
    last_detected_at = now(),
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function cms_upsert_health_finding(uuid,text,uuid,text,text,text,text,text,jsonb) from public;
revoke execute on function cms_upsert_health_finding(uuid,text,uuid,text,text,text,text,text,jsonb) from anon;
revoke execute on function cms_upsert_health_finding(uuid,text,uuid,text,text,text,text,text,jsonb) from authenticated;
grant execute on function cms_upsert_health_finding(uuid,text,uuid,text,text,text,text,text,jsonb) to service_role;
grant execute on function cms_upsert_health_finding(uuid,text,uuid,text,text,text,text,text,jsonb) to postgres;

-- Permissions are intentionally service-bound; application APIs enforce actor permissions/model policy.
