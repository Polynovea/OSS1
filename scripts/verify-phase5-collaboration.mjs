import { readFileSync } from "node:fs";
import pg from "pg";
for (const line of readFileSync(".env.local", "utf8").split("\n")) { const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/); if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }
const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!connectionString) throw new Error("Missing database connection string");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
const tables = ["workflow_definitions", "workflow_instances", "workflow_actions", "releases", "release_items", "content_search_documents", "content_assignments", "content_comments", "content_comment_mentions", "content_entry_watchers", "editorial_notifications", "editorial_calendar_events"];
const indexes = ["workflow_active_entry_idx", "releases_workspace_status_idx", "content_search_documents_workspace_idx", "content_assignments_assignee_queue_idx", "content_assignments_entry_idx", "content_comments_entry_thread_idx", "content_comment_mentions_recipient_idx", "editorial_notifications_inbox_idx", "editorial_calendar_events_workspace_range_idx", "editorial_calendar_events_entry_idx"];
const result = await client.query("select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname = any($1::text[]) order by c.relname", [tables]);
const indexResult = await client.query("select indexname from pg_indexes where schemaname='public' and indexname = any($1::text[]) order by indexname", [indexes]);
await client.end();
const tableState = Object.fromEntries(result.rows.map((row) => [row.table_name, row.rls_enabled]));
const actualIndexes = indexResult.rows.map((row) => row.indexname);
const missingTables = tables.filter((name) => !Object.hasOwn(tableState, name));
const missingIndexes = indexes.filter((name) => !actualIndexes.includes(name));
console.log(JSON.stringify({ tables: tableState, indexes: actualIndexes, missingTables, missingIndexes, ok: missingTables.length === 0 && missingIndexes.length === 0 && Object.values(tableState).every(Boolean) }));
if (missingTables.length || missingIndexes.length || !Object.values(tableState).every(Boolean)) process.exit(1);
