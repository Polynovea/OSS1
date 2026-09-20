-- Phase 1, Milestone F — Blog compatibility model and backfill.
--
-- This migration is intentionally additive. blog_posts remains authoritative
-- for the existing Blog UI until parity is verified and that UI is switched.
-- The ledger makes the copy idempotent and gives verification a durable
-- source-to-generic-entry mapping. Apply only after 0008 and 0009.

create table if not exists legacy_content_migrations (
  source_table text not null,
  source_id uuid not null,
  content_entry_id uuid not null references content_entries(id) on delete cascade,
  migrated_at timestamptz not null default now(),
  primary key (source_table, source_id),
  unique (content_entry_id)
);
alter table legacy_content_migrations enable row level security;

do $$
declare
  workspace_uuid uuid;
  model_uuid uuid;
  entry_uuid uuid;
  version_uuid uuid;
  post record;
  initial_state text;
begin
  select id into workspace_uuid from workspaces where slug = 'polynovea';
  if workspace_uuid is null then raise exception 'Polynovea workspace not found; apply 0007 first'; end if;

  select id into model_uuid from content_models where workspace_id = workspace_uuid and api_key = 'blog_post';
  if model_uuid is null then
    insert into content_models (workspace_id, name, api_key, description, status, current_schema_version)
    values (workspace_uuid, 'Blog Post', 'blog_post', 'Compatibility model for legacy Polynovea blog posts', 'active', 1)
    returning id into model_uuid;
    insert into content_model_versions (content_model_id, version_number, schema_json, schema_hash, change_summary)
    values (
      model_uuid, 1,
      '{"name":"Blog Post","apiKey":"blog_post","description":"Compatibility model for existing blog posts","fields":[
        {"key":"title","label":"Title","type":"text","required":true,"localized":false,"unique":false},
        {"key":"slug","label":"Slug","type":"slug","required":true,"localized":false,"unique":true},
        {"key":"excerpt","label":"Excerpt","type":"long_text","required":false,"localized":false,"unique":false},
        {"key":"body","label":"Body","type":"markdown","required":false,"localized":false,"unique":false},
        {"key":"author","label":"Author","type":"text","required":false,"localized":false,"unique":false},
        {"key":"cover_image","label":"Cover Image","type":"url","required":false,"localized":false,"unique":false},
        {"key":"published_at","label":"Published At","type":"datetime","required":false,"localized":false,"unique":false}
      ]}'::jsonb,
      'a78e2e8290b64f46de746bf1b5054f4f9b1aae869d5faabdfd4c107ef6ef3d3c', 'Initial legacy Blog compatibility schema'
    ) on conflict do nothing;
    insert into content_fields (content_model_id, field_key, label, field_type, position, configuration_json) values
      (model_uuid, 'title', 'Title', 'text', 0, '{"required":true}'::jsonb),
      (model_uuid, 'slug', 'Slug', 'slug', 1, '{"required":true,"unique":true}'::jsonb),
      (model_uuid, 'excerpt', 'Excerpt', 'long_text', 2, '{}'::jsonb),
      (model_uuid, 'body', 'Body', 'markdown', 3, '{}'::jsonb),
      (model_uuid, 'author', 'Author', 'text', 4, '{}'::jsonb),
      (model_uuid, 'cover_image', 'Cover Image', 'url', 5, '{}'::jsonb),
      (model_uuid, 'published_at', 'Published At', 'datetime', 6, '{}'::jsonb)
    on conflict do nothing;
  end if;

  for post in select b.* from blog_posts b left join legacy_content_migrations l on l.source_table = 'blog_posts' and l.source_id = b.id where l.source_id is null loop
    initial_state := case when post.status = 'published' then 'published' else 'draft' end;
    insert into content_entries (workspace_id, content_model_id, status, created_at, updated_at)
    values (workspace_uuid, model_uuid, initial_state, coalesce(post.created_at, now()), coalesce(post.updated_at, now())) on conflict do nothing returning id into entry_uuid;
    insert into content_entry_versions (entry_id, model_schema_version, version_number, data_jsonb, locale, state, created_at, change_summary)
    values (entry_uuid, 1, 1, jsonb_strip_nulls(jsonb_build_object(
      'title', post.title, 'slug', post.slug, 'excerpt', post.excerpt, 'body', post.content,
      'author', post.author, 'cover_image', post.cover_image, 'published_at', post.published_at
    )), 'en', initial_state, coalesce(post.updated_at, now()), 'Imported from legacy blog_posts') on conflict do nothing returning id into version_uuid;
    update content_entries set current_draft_version_id = version_uuid, published_version_id = case when initial_state = 'published' then version_uuid else null end where id = entry_uuid;
    insert into legacy_content_migrations (source_table, source_id, content_entry_id) values ('blog_posts', post.id, entry_uuid) on conflict do nothing;
  end loop;
end $$;

-- Post-apply verification (run manually before switching the Blog UI):
-- select count(*) from blog_posts;
-- select count(*) from legacy_content_migrations where source_table = 'blog_posts';
-- select b.id, b.slug, e.data_jsonb->>'slug' as generic_slug from blog_posts b
-- join legacy_content_migrations l on l.source_id = b.id and l.source_table = 'blog_posts'
-- join content_entry_versions e on e.id = (select current_draft_version_id from content_entries where id = l.content_entry_id)
-- where b.slug is distinct from e.data_jsonb->>'slug';
