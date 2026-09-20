-- Phase 7 — Unified CMS Dependency & Impact Graph Edges.
--
-- Extends content_relations to support routes, assets, terms, and menus across Phases 7–9.

alter table content_relations
  add column if not exists source_entity_type text not null default 'entry',
  add column if not exists target_entity_type text not null default 'entry',
  add column if not exists target_term_id uuid references taxonomy_terms(id) on delete cascade,
  add column if not exists target_route_id uuid references content_routes(id) on delete cascade,
  add column if not exists target_menu_id uuid references navigation_menus(id) on delete cascade;

-- Ensure foreign key from target_asset_id to assets exists
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'content_relations_target_asset_fk') then
    alter table content_relations
      add constraint content_relations_target_asset_fk
      foreign key (target_asset_id) references assets(id) on delete cascade;
  end if;
end $$;

create index if not exists content_relations_target_asset_idx
  on content_relations(workspace_id, target_asset_id) where target_asset_id is not null;
create index if not exists content_relations_target_term_idx
  on content_relations(workspace_id, target_term_id) where target_term_id is not null;
create index if not exists content_relations_target_route_idx
  on content_relations(workspace_id, target_route_id) where target_route_id is not null;
create index if not exists content_relations_target_menu_idx
  on content_relations(workspace_id, target_menu_id) where target_menu_id is not null;
