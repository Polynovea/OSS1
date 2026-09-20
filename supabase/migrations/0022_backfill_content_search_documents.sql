-- Phase 4 — index generic entries that existed before the search projection
-- was introduced in 0017. This is additive/idempotent and never touches
-- legacy source tables such as blog_posts.

insert into content_search_documents (
  entry_id, workspace_id, version_id, content_model_id, locale, status,
  author_id, search_text, updated_at
)
select
  e.id, e.workspace_id, v.id, e.content_model_id, v.locale, e.status,
  e.created_by,
  coalesce((select string_agg(value, ' ' order by key) from jsonb_each_text(v.data_jsonb)), ''),
  e.updated_at
from content_entries e
join content_entry_versions v on v.id = coalesce(e.published_version_id, e.current_draft_version_id)
on conflict (entry_id) do update set
  version_id = excluded.version_id,
  content_model_id = excluded.content_model_id,
  locale = excluded.locale,
  status = excluded.status,
  author_id = excluded.author_id,
  search_text = excluded.search_text,
  updated_at = excluded.updated_at;
