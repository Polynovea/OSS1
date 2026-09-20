import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line.includes("=") && !line.trim().startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, "")]; }));
const connectionString = env.Database_URL || env.DATABASE_URL;
if (!connectionString) throw new Error("Database_URL/DATABASE_URL missing");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(`
  with counts as (
    select (select count(*)::int from blog_posts) as source_count,
           (select count(*)::int from legacy_content_migrations where source_table = 'blog_posts') as ledger_count,
           (select count(*)::int from content_entries e join content_models m on m.id=e.content_model_id where m.api_key = 'blog_post') as generic_count,
           (select count(*)::int from content_search_documents d join content_models m on m.id=d.content_model_id where m.api_key = 'blog_post') as search_count
  ), mismatches as (
    select count(*)::int as mismatch_count
    from blog_posts b
    join legacy_content_migrations l on l.source_id=b.id and l.source_table='blog_posts'
    join content_entries ce on ce.id=l.content_entry_id
    join content_entry_versions ev on ev.id=ce.current_draft_version_id
    where b.slug is distinct from ev.data_jsonb->>'slug'
       or b.title is distinct from ev.data_jsonb->>'title'
       or b.excerpt is distinct from ev.data_jsonb->>'excerpt'
       or b.content is distinct from ev.data_jsonb->>'body'
       or b.author is distinct from ev.data_jsonb->>'author'
       or b.cover_image is distinct from ev.data_jsonb->>'cover_image'
       or b.published_at::text is distinct from nullif(ev.data_jsonb->>'published_at', '')::timestamptz::text
       or b.status is distinct from ce.status
  ) select * from counts cross join mismatches;
`);
await client.end();
const result = rows[0];
console.log(JSON.stringify(result));
if (result.source_count !== result.ledger_count || result.source_count !== result.generic_count || result.source_count !== result.search_count || result.mismatch_count !== 0) process.exitCode = 2;
