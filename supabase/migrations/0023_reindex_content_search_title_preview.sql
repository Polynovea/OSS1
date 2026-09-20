-- Phase 4 follow-up: make the record-library preview lead with a canonical
-- title when present. This refreshes only the derived search projection.

update content_search_documents d
set search_text = concat_ws(
  ' ',
  nullif(v.data_jsonb->>'title', ''),
  coalesce((select string_agg(value, ' ' order by key) from jsonb_each_text(v.data_jsonb) where key <> 'title'), '')
),
updated_at = e.updated_at
from content_entries e, content_entry_versions v
where e.id = d.entry_id
  and v.id = d.version_id;
