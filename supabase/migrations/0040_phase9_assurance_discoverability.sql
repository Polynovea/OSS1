-- Migration 0040: Phase 9 — Assurance and Discoverability
-- Adds workspace Web Quality policy, route discoverability controls, and expands
-- the unified dependency graph to redirects, localization links and release targets.

-- ============================================================================
-- 1. Workspace Web Quality policy
-- ============================================================================

create table if not exists web_quality_policies (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  site_base_url text,
  site_name text,
  title_suffix text,
  robots_enabled boolean not null default true,
  sitemap_enabled boolean not null default true,
  require_canonical_route boolean not null default true,
  require_social_card boolean not null default false,
  require_schema_org boolean not null default false,
  ai_crawler_policy jsonb not null default '{"default":"allow"}'::jsonb,
  media_budget_json jsonb not null default '{"maxImageBytes":2097152,"lcpWarningBytes":786432,"minLcpWidth":1200,"preferredImageFormats":["image/avif","image/webp"]}'::jsonb,
  settings_json jsonb not null default '{"warnNoindexOnCanonical":true,"requireHreflangForRequiredLocales":true}'::jsonb,
  updated_by uuid references admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (site_base_url is null or site_base_url ~ '^https?://[^[:space:]]+$'),
  check (jsonb_typeof(ai_crawler_policy) = 'object'),
  check (jsonb_typeof(media_budget_json) = 'object'),
  check (jsonb_typeof(settings_json) = 'object')
);
alter table web_quality_policies enable row level security;

insert into web_quality_policies (workspace_id, site_name)
select id, name from workspaces
on conflict (workspace_id) do nothing;

-- ============================================================================
-- 2. Route-level discoverability controls
-- ============================================================================

alter table content_routes
  add column if not exists indexing_policy text not null default 'inherit',
  add column if not exists sitemap_included boolean not null default true,
  add column if not exists sitemap_priority numeric(2,1),
  add column if not exists sitemap_changefreq text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_routes_indexing_policy_check') then
    alter table content_routes add constraint content_routes_indexing_policy_check
      check (indexing_policy in ('inherit','index','noindex'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_routes_sitemap_priority_check') then
    alter table content_routes add constraint content_routes_sitemap_priority_check
      check (sitemap_priority is null or (sitemap_priority >= 0 and sitemap_priority <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_routes_sitemap_changefreq_check') then
    alter table content_routes add constraint content_routes_sitemap_changefreq_check
      check (sitemap_changefreq is null or sitemap_changefreq in ('always','hourly','daily','weekly','monthly','yearly','never'));
  end if;
end $$;

create index if not exists content_routes_discoverability_idx
  on content_routes(workspace_id, locale, status, indexing_policy, sitemap_included);

-- ============================================================================
-- 3. Expand dependency graph source origins
-- ============================================================================

alter table content_relations
  add column if not exists source_redirect_id uuid,
  add column if not exists source_translation_id uuid,
  add column if not exists source_release_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_entry_translations_id_workspace_unique') then
    alter table content_entry_translations add constraint content_entry_translations_id_workspace_unique unique (id, workspace_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entry_translations_source_workspace_fk') then
    alter table content_entry_translations add constraint content_entry_translations_source_workspace_fk
      foreign key (source_entry_id, workspace_id) references content_entries(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entry_translations_target_workspace_fk') then
    alter table content_entry_translations add constraint content_entry_translations_target_workspace_fk
      foreign key (translated_entry_id, workspace_id) references content_entries(id, workspace_id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_entry_translations_not_self_check') then
    alter table content_entry_translations add constraint content_entry_translations_not_self_check
      check (translated_entry_id is null or translated_entry_id <> source_entry_id);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_redirect_workspace_fk') then
    alter table content_relations add constraint content_relations_source_redirect_workspace_fk
      foreign key (source_redirect_id, workspace_id) references content_redirects(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_translation_workspace_fk') then
    alter table content_relations add constraint content_relations_source_translation_workspace_fk
      foreign key (source_translation_id, workspace_id) references content_entry_translations(id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'content_relations_source_release_workspace_fk') then
    alter table content_relations add constraint content_relations_source_release_workspace_fk
      foreign key (source_release_id, workspace_id) references releases(id, workspace_id) on delete cascade;
  end if;
end $$;

alter table content_relations drop constraint if exists content_relations_source_check;
alter table content_relations add constraint content_relations_source_check check (
  (
    case when source_entry_id is not null then 1 else 0 end +
    case when source_menu_id is not null then 1 else 0 end +
    case when source_route_id is not null then 1 else 0 end +
    case when source_redirect_id is not null then 1 else 0 end +
    case when source_translation_id is not null then 1 else 0 end +
    case when source_release_id is not null then 1 else 0 end
  ) = 1
  and (
    (source_entry_id is not null and source_version_id is not null and source_field_key is not null)
    or (source_entry_id is null and source_version_id is null)
  )
);

create index if not exists content_relations_source_redirect_idx
  on content_relations(workspace_id, source_redirect_id) where source_redirect_id is not null;
create index if not exists content_relations_source_translation_idx
  on content_relations(workspace_id, source_translation_id) where source_translation_id is not null;
create index if not exists content_relations_source_release_idx
  on content_relations(workspace_id, source_release_id) where source_release_id is not null;

-- ============================================================================
-- 4. Hardened atomic graph replacement for all managed source types
-- ============================================================================

create or replace function cms_replace_source_relations(
  p_workspace_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_relations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rel jsonb;
  v_target_type text;
begin
  if p_relations is null then p_relations := '[]'::jsonb; end if;
  if jsonb_typeof(p_relations) <> 'array' then
    raise exception 'relations must be a JSON array' using errcode = '22023';
  end if;

  if p_source_type = 'menu' then
    if not exists (select 1 from navigation_menus where id = p_source_id and workspace_id = p_workspace_id) then raise exception 'Menu source not found' using errcode = 'P0002'; end if;
    delete from content_relations where workspace_id = p_workspace_id and source_menu_id = p_source_id;
  elsif p_source_type = 'route' then
    if not exists (select 1 from content_routes where id = p_source_id and workspace_id = p_workspace_id) then raise exception 'Route source not found' using errcode = 'P0002'; end if;
    delete from content_relations where workspace_id = p_workspace_id and source_route_id = p_source_id;
  elsif p_source_type = 'redirect' then
    if not exists (select 1 from content_redirects where id = p_source_id and workspace_id = p_workspace_id) then raise exception 'Redirect source not found' using errcode = 'P0002'; end if;
    delete from content_relations where workspace_id = p_workspace_id and source_redirect_id = p_source_id;
  elsif p_source_type = 'translation' then
    if not exists (select 1 from content_entry_translations where id = p_source_id and workspace_id = p_workspace_id) then raise exception 'Translation source not found' using errcode = 'P0002'; end if;
    delete from content_relations where workspace_id = p_workspace_id and source_translation_id = p_source_id;
  elsif p_source_type = 'release' then
    if not exists (select 1 from releases where id = p_source_id and workspace_id = p_workspace_id) then raise exception 'Release source not found' using errcode = 'P0002'; end if;
    delete from content_relations where workspace_id = p_workspace_id and source_release_id = p_source_id;
  else
    raise exception 'Unsupported source type: %', p_source_type using errcode = '22023';
  end if;

  for v_rel in select * from jsonb_array_elements(p_relations) loop
    v_target_type := coalesce(v_rel->>'target_entity_type',
      case
        when nullif(v_rel->>'target_entry_id','') is not null then 'entry'
        when nullif(v_rel->>'target_asset_id','') is not null then 'asset'
        when nullif(v_rel->>'target_term_id','') is not null then 'term'
        when nullif(v_rel->>'target_route_id','') is not null then 'route'
        when nullif(v_rel->>'target_menu_id','') is not null then 'menu'
        else null
      end);
    if v_target_type is null then raise exception 'Relation target is required' using errcode = '22023'; end if;

    insert into content_relations (
      workspace_id, source_menu_id, source_route_id, source_redirect_id, source_translation_id, source_release_id,
      source_entity_type, source_field_key, target_entity_type, relation_type,
      target_entry_id, target_asset_id, target_term_id, target_route_id, target_menu_id
    ) values (
      p_workspace_id,
      case when p_source_type = 'menu' then p_source_id else null end,
      case when p_source_type = 'route' then p_source_id else null end,
      case when p_source_type = 'redirect' then p_source_id else null end,
      case when p_source_type = 'translation' then p_source_id else null end,
      case when p_source_type = 'release' then p_source_id else null end,
      p_source_type,
      nullif(v_rel->>'source_field_key',''),
      v_target_type,
      coalesce(nullif(v_rel->>'relation_type',''), p_source_type || '_' || v_target_type),
      nullif(v_rel->>'target_entry_id','')::uuid,
      nullif(v_rel->>'target_asset_id','')::uuid,
      nullif(v_rel->>'target_term_id','')::uuid,
      nullif(v_rel->>'target_route_id','')::uuid,
      nullif(v_rel->>'target_menu_id','')::uuid
    );
  end loop;

  return jsonb_build_object('success', true, 'sourceType', p_source_type, 'relationCount', jsonb_array_length(p_relations));
end;
$$;

-- ============================================================================
-- 5. Automatic dependency graph synchronization for redirect/localization/release
-- ============================================================================

create or replace function cms_refresh_redirect_dependencies(p_workspace_id uuid, p_redirect_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_redirect record;
begin
  delete from content_relations where workspace_id = p_workspace_id and source_redirect_id = p_redirect_id;
  select * into v_redirect from content_redirects where id = p_redirect_id and workspace_id = p_workspace_id;
  if not found or not v_redirect.is_active or v_redirect.target_path ~ '^https?://' then return; end if;

  insert into content_relations (
    workspace_id, source_redirect_id, source_entity_type, target_entity_type, relation_type, target_route_id
  )
  select p_workspace_id, p_redirect_id, 'redirect', 'route', 'redirect_target', cr.id
  from content_routes cr
  where cr.workspace_id = p_workspace_id
    and cr.path = v_redirect.target_path
    and cr.status <> 'archived'
    and (v_redirect.locale is null or cr.locale = v_redirect.locale)
  on conflict do nothing;
end;
$$;

create or replace function cms_redirect_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from content_relations where workspace_id = old.workspace_id and source_redirect_id = old.id;
    return old;
  end if;
  perform cms_refresh_redirect_dependencies(new.workspace_id, new.id);
  return new;
end;
$$;

drop trigger if exists trg_redirect_dependency_graph on content_redirects;
create trigger trg_redirect_dependency_graph
after insert or update of target_path, locale, is_active on content_redirects
for each row execute function cms_redirect_dependency_trigger();

drop trigger if exists trg_redirect_dependency_graph_delete on content_redirects;
create trigger trg_redirect_dependency_graph_delete
after delete on content_redirects
for each row execute function cms_redirect_dependency_trigger();

create or replace function cms_refresh_translation_dependencies(p_workspace_id uuid, p_translation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_translation record;
begin
  delete from content_relations where workspace_id = p_workspace_id and source_translation_id = p_translation_id;
  select * into v_translation from content_entry_translations where id = p_translation_id and workspace_id = p_workspace_id;
  if not found then return; end if;

  insert into content_relations (workspace_id, source_translation_id, source_entity_type, target_entity_type, relation_type, target_entry_id)
  values (p_workspace_id, p_translation_id, 'translation', 'entry', 'translation_source', v_translation.source_entry_id);

  if v_translation.translated_entry_id is not null then
    insert into content_relations (workspace_id, source_translation_id, source_entity_type, target_entity_type, relation_type, target_entry_id)
    values (p_workspace_id, p_translation_id, 'translation', 'entry', 'translation_target', v_translation.translated_entry_id);
  end if;
end;
$$;

create or replace function cms_translation_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    delete from content_relations where workspace_id = old.workspace_id and source_translation_id = old.id;
    return old;
  end if;
  perform cms_refresh_translation_dependencies(new.workspace_id, new.id);
  return new;
end;
$$;

drop trigger if exists trg_translation_dependency_graph on content_entry_translations;
create trigger trg_translation_dependency_graph
after insert or update of source_entry_id, translated_entry_id, locale on content_entry_translations
for each row execute function cms_translation_dependency_trigger();

drop trigger if exists trg_translation_dependency_graph_delete on content_entry_translations;
create trigger trg_translation_dependency_graph_delete
after delete on content_entry_translations
for each row execute function cms_translation_dependency_trigger();

create or replace function cms_refresh_release_dependencies(p_release_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id from releases where id = p_release_id;
  if v_workspace_id is null then return; end if;
  delete from content_relations where workspace_id = v_workspace_id and source_release_id = p_release_id;

  insert into content_relations (workspace_id, source_release_id, source_entity_type, target_entity_type, relation_type, target_entry_id)
  select distinct v_workspace_id, p_release_id, 'release', 'entry', 'release_entry', ri.entry_id
  from release_items ri where ri.release_id = p_release_id;

  insert into content_relations (workspace_id, source_release_id, source_entity_type, target_entity_type, relation_type, target_route_id)
  select distinct v_workspace_id, p_release_id, 'release', 'route', 'release_destination', cr.id
  from release_items ri
  join content_routes cr on cr.workspace_id = v_workspace_id and cr.entry_id = ri.entry_id and cr.is_canonical = true and cr.status <> 'archived'
  join release_locale_targets rlt on rlt.release_id = p_release_id and rlt.locale = cr.locale
  where ri.release_id = p_release_id;
end;
$$;

create or replace function cms_release_dependency_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform cms_refresh_release_dependencies(coalesce(new.release_id, old.release_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_release_item_dependency_graph on release_items;
create trigger trg_release_item_dependency_graph
after insert or update or delete on release_items
for each row execute function cms_release_dependency_trigger();

drop trigger if exists trg_release_locale_dependency_graph on release_locale_targets;
create trigger trg_release_locale_dependency_graph
after insert or update or delete on release_locale_targets
for each row execute function cms_release_dependency_trigger();

-- ============================================================================
-- 6. Atomic Web Quality and route discoverability mutation
-- ============================================================================

create or replace function cms_upsert_web_quality_policy(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_site_base_url text,
  p_site_name text,
  p_title_suffix text,
  p_robots_enabled boolean,
  p_sitemap_enabled boolean,
  p_require_canonical_route boolean,
  p_require_social_card boolean,
  p_require_schema_org boolean,
  p_ai_crawler_policy jsonb,
  p_media_budget jsonb,
  p_settings jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row web_quality_policies%rowtype;
  v_base text;
begin
  if not exists (select 1 from workspaces where id = p_workspace_id and status = 'active') then raise exception 'Workspace not found' using errcode = 'P0002'; end if;
  v_base := nullif(rtrim(btrim(coalesce(p_site_base_url,'')), '/'), '');
  if v_base is not null and v_base !~ '^https?://[^[:space:]]+$' then raise exception 'siteBaseUrl must be an http(s) URL' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_ai_crawler_policy,'{}'::jsonb)) <> 'object' then raise exception 'aiCrawlerPolicy must be an object' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_media_budget,'{}'::jsonb)) <> 'object' then raise exception 'mediaBudget must be an object' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_settings,'{}'::jsonb)) <> 'object' then raise exception 'settings must be an object' using errcode = '22023'; end if;

  insert into web_quality_policies (
    workspace_id, site_base_url, site_name, title_suffix, robots_enabled, sitemap_enabled,
    require_canonical_route, require_social_card, require_schema_org, ai_crawler_policy,
    media_budget_json, settings_json, updated_by, updated_at
  ) values (
    p_workspace_id, v_base, nullif(btrim(coalesce(p_site_name,'')),''), nullif(btrim(coalesce(p_title_suffix,'')),''),
    coalesce(p_robots_enabled,true), coalesce(p_sitemap_enabled,true), coalesce(p_require_canonical_route,true),
    coalesce(p_require_social_card,false), coalesce(p_require_schema_org,false), coalesce(p_ai_crawler_policy,'{"default":"allow"}'::jsonb),
    coalesce(p_media_budget,'{}'::jsonb), coalesce(p_settings,'{}'::jsonb), p_actor_id, clock_timestamp()
  )
  on conflict (workspace_id) do update set
    site_base_url = excluded.site_base_url,
    site_name = excluded.site_name,
    title_suffix = excluded.title_suffix,
    robots_enabled = excluded.robots_enabled,
    sitemap_enabled = excluded.sitemap_enabled,
    require_canonical_route = excluded.require_canonical_route,
    require_social_card = excluded.require_social_card,
    require_schema_org = excluded.require_schema_org,
    ai_crawler_policy = excluded.ai_crawler_policy,
    media_budget_json = excluded.media_budget_json,
    settings_json = excluded.settings_json,
    updated_by = excluded.updated_by,
    updated_at = clock_timestamp()
  returning * into v_row;

  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'assurance.web_quality_policy_saved', 'workspace', p_workspace_id::text,
    jsonb_build_object('siteBaseUrl',v_row.site_base_url,'robotsEnabled',v_row.robots_enabled,'sitemapEnabled',v_row.sitemap_enabled));
  return row_to_json(v_row)::jsonb;
end;
$$;

create or replace function cms_update_route_discoverability(
  p_workspace_id uuid,
  p_actor_id uuid,
  p_route_id uuid,
  p_indexing_policy text,
  p_sitemap_included boolean,
  p_sitemap_priority numeric,
  p_sitemap_changefreq text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row content_routes%rowtype;
begin
  if p_indexing_policy not in ('inherit','index','noindex') then raise exception 'Invalid indexing policy' using errcode = '22023'; end if;
  if p_sitemap_priority is not null and (p_sitemap_priority < 0 or p_sitemap_priority > 1) then raise exception 'Sitemap priority must be between 0 and 1' using errcode = '22023'; end if;
  if p_sitemap_changefreq is not null and p_sitemap_changefreq not in ('always','hourly','daily','weekly','monthly','yearly','never') then raise exception 'Invalid sitemap change frequency' using errcode = '22023'; end if;

  update content_routes set
    indexing_policy = p_indexing_policy,
    sitemap_included = coalesce(p_sitemap_included,true),
    sitemap_priority = p_sitemap_priority,
    sitemap_changefreq = p_sitemap_changefreq,
    updated_at = clock_timestamp()
  where id = p_route_id and workspace_id = p_workspace_id
  returning * into v_row;
  if not found then raise exception 'Route not found' using errcode = 'P0002'; end if;

  insert into platform_audit_events (workspace_id, actor_admin_user_id, action, entity_type, entity_id, metadata_json)
  values (p_workspace_id, p_actor_id, 'assurance.route_discoverability_updated', 'route', p_route_id::text,
    jsonb_build_object('indexingPolicy',v_row.indexing_policy,'sitemapIncluded',v_row.sitemap_included,'sitemapPriority',v_row.sitemap_priority,'sitemapChangefreq',v_row.sitemap_changefreq));
  return row_to_json(v_row)::jsonb;
end;
$$;

-- ============================================================================
-- 7. Backfill dependency origins for existing managed entities
-- ============================================================================

do $$
declare r record;
begin
  for r in select workspace_id, id from content_redirects loop perform cms_refresh_redirect_dependencies(r.workspace_id, r.id); end loop;
  for r in select workspace_id, id from content_entry_translations loop perform cms_refresh_translation_dependencies(r.workspace_id, r.id); end loop;
  for r in select id from releases loop perform cms_refresh_release_dependencies(r.id); end loop;
end $$;

-- ============================================================================
-- 8. Service-bound execution privileges
-- ============================================================================

revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from public;
revoke execute on function cms_upsert_web_quality_policy(uuid, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, jsonb, jsonb, jsonb) from public;
revoke execute on function cms_update_route_discoverability(uuid, uuid, uuid, text, boolean, numeric, text) from public;
revoke execute on function cms_refresh_redirect_dependencies(uuid, uuid) from public;
revoke execute on function cms_refresh_translation_dependencies(uuid, uuid) from public;
revoke execute on function cms_refresh_release_dependencies(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname='anon') then
    revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from anon;
    revoke execute on function cms_upsert_web_quality_policy(uuid, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, jsonb, jsonb, jsonb) from anon;
    revoke execute on function cms_update_route_discoverability(uuid, uuid, uuid, text, boolean, numeric, text) from anon;
    revoke execute on function cms_refresh_redirect_dependencies(uuid, uuid) from anon;
    revoke execute on function cms_refresh_translation_dependencies(uuid, uuid) from anon;
    revoke execute on function cms_refresh_release_dependencies(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname='authenticated') then
    revoke execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) from authenticated;
    revoke execute on function cms_upsert_web_quality_policy(uuid, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, jsonb, jsonb, jsonb) from authenticated;
    revoke execute on function cms_update_route_discoverability(uuid, uuid, uuid, text, boolean, numeric, text) from authenticated;
    revoke execute on function cms_refresh_redirect_dependencies(uuid, uuid) from authenticated;
    revoke execute on function cms_refresh_translation_dependencies(uuid, uuid) from authenticated;
    revoke execute on function cms_refresh_release_dependencies(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname='service_role') then
    grant execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) to service_role;
    grant execute on function cms_upsert_web_quality_policy(uuid, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, jsonb, jsonb, jsonb) to service_role;
    grant execute on function cms_update_route_discoverability(uuid, uuid, uuid, text, boolean, numeric, text) to service_role;
    grant execute on function cms_refresh_redirect_dependencies(uuid, uuid) to service_role;
    grant execute on function cms_refresh_translation_dependencies(uuid, uuid) to service_role;
    grant execute on function cms_refresh_release_dependencies(uuid) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname='postgres') then
    grant execute on function cms_replace_source_relations(uuid, text, uuid, jsonb) to postgres;
    grant execute on function cms_upsert_web_quality_policy(uuid, uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, jsonb, jsonb, jsonb) to postgres;
    grant execute on function cms_update_route_discoverability(uuid, uuid, uuid, text, boolean, numeric, text) to postgres;
    grant execute on function cms_refresh_redirect_dependencies(uuid, uuid) to postgres;
    grant execute on function cms_refresh_translation_dependencies(uuid, uuid) to postgres;
    grant execute on function cms_refresh_release_dependencies(uuid) to postgres;
  end if;
end $$;
