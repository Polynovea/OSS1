import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { redactCredentials, resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";

const { Client } = pg;
const MIN_POSTGRES_MAJOR = 15;
const MIGRATION_DIR = path.resolve(process.cwd(), "supabase/migrations");
const LEDGER_TABLE = "polynovea_migration_ledger";

export interface DatabaseProvisioningCheck {
  key: string;
  status: "passed" | "warning" | "failed";
  message: string;
  evidence?: Record<string, unknown>;
}

export interface DatabaseProvisioningResult {
  supported: boolean;
  ready: boolean;
  provider: string;
  connectionId: string | null;
  checks: DatabaseProvisioningCheck[];
  migration: { latestAvailable: string | null; latestApplied: string | null; pending: string[]; checksumMismatches: string[] };
  instructions?: string | null;
}

function migrationId(filename: string) { return filename.match(/^(\d{4})/)?.[1] ?? filename; }
function checksum(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function migrationFiles() {
  const files = (await readdir(MIGRATION_DIR)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  return Promise.all(files.map(async (filename) => {
    const sql = await readFile(path.join(MIGRATION_DIR, filename), "utf8");
    return { filename, id: migrationId(filename), sql, checksum: checksum(sql) };
  }));
}

async function connect(connectionString: string) {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const client = new Client({ connectionString, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  await client.connect();
  return client;
}

export async function probePostgresUrl(connectionString: string) {
  const client = await connect(connectionString);
  try {
    const { rows:[version] } = await client.query("select current_setting('server_version_num')::int as version_num,current_setting('server_version') as version,current_database() as database,current_user as db_user");
    const { rows:[ssl] } = await client.query("select coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as ssl");
    const major = Math.floor(Number(version.version_num) / 10000);
    return { major, version: version.version, database: version.database, user: version.db_user, ssl: Boolean(ssl?.ssl) };
  } finally { await client.end(); }
}

async function findDatabaseConnection(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data, error } = await db.from("workspace_connections")
    .select("id,connector_type,name,status,active,created_at")
    .eq("workspace_id", workspaceId).eq("environment_id", environmentId).eq("connector_family", "database")
    .eq("active", true).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const connection = (data ?? []).find((row) => ["database.postgres", "database.supabase"].includes(row.connector_type)) ?? null;
  if (!connection) return { connection: null, connectionString: null, credentials: {} as Record<string,string> };
  const credentials = await resolveConnectionCredentials(workspaceId, connection.id);
  return { connection, connectionString: credentials.connection_url ?? null, credentials };
}

async function bootstrapCompatibility(client: pg.Client) {
  await client.query(`create extension if not exists pgcrypto`);
  await client.query(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    if not exists(select 1 from pg_roles where rolname='postgres') then create role postgres nologin; end if;
  end $$`);
  await client.query(`create schema if not exists auth`);
  await client.query(`create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$`);
  await client.query(`create table if not exists public.${LEDGER_TABLE}(
    filename text primary key,
    checksum_sha256 text not null,
    migration_id text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function inspectTarget(client: pg.Client, files: Awaited<ReturnType<typeof migrationFiles>>) {
  const checks: DatabaseProvisioningCheck[] = [];
  const { rows:[version] } = await client.query("select current_setting('server_version_num')::int as version_num,current_setting('server_version') as version,current_database() as database,current_user as db_user");
  const major = Math.floor(Number(version.version_num) / 10000);
  checks.push({ key:"postgres.version", status: major >= MIN_POSTGRES_MAJOR ? "passed" : "failed", message:`PostgreSQL ${version.version} detected; Polynovea requires ${MIN_POSTGRES_MAJOR}+.`, evidence:{major,database:version.database} });
  const { rows:[ssl] } = await client.query("select coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as ssl");
  checks.push({ key:"postgres.tls", status: ssl?.ssl ? "passed" : "warning", message: ssl?.ssl ? "Database connection is using TLS." : "Database session is not using TLS; this is acceptable only for a trusted local/private runtime." });
  const { rows:[cap] } = await client.query("select has_schema_privilege(current_user,'public','CREATE') as can_create,exists(select 1 from pg_extension where extname='pgcrypto') as pgcrypto");
  checks.push({ key:"postgres.create", status: cap?.can_create ? "passed" : "failed", message: cap?.can_create ? "Database user can create CMS schema objects." : "Database user lacks CREATE privilege in public schema." });
  checks.push({ key:"postgres.pgcrypto", status: cap?.pgcrypto ? "passed" : "warning", message: cap?.pgcrypto ? "pgcrypto capability is present." : "pgcrypto is missing; Initialize/Upgrade will attempt to install it." });
  const { rows:[ledgerExists] } = await client.query("select to_regclass('public.polynovea_migration_ledger') is not null as exists");
  let applied: Array<{filename:string;checksum_sha256:string;migration_id:string}> = [];
  if (ledgerExists?.exists) ({ rows: applied } = await client.query(`select filename,checksum_sha256,migration_id from public.${LEDGER_TABLE} order by filename`));
  const byName = new Map(applied.map((row) => [row.filename,row]));
  const mismatches = files.filter((f) => byName.has(f.filename) && byName.get(f.filename)!.checksum_sha256 !== f.checksum).map((f) => f.filename);
  const pending = files.filter((f) => !byName.has(f.filename)).map((f) => f.filename);
  const latestApplied = applied.at(-1)?.migration_id ?? null;
  const core = await client.query("select to_regclass('public.workspaces') is not null as workspaces,to_regclass('public.content_models') is not null as models,to_regclass('public.delivery_jobs') is not null as jobs,to_regclass('public.workspace_environments') is not null as environments");
  const corePresent = Boolean(core.rows[0]?.workspaces && core.rows[0]?.models && core.rows[0]?.jobs && core.rows[0]?.environments);
  checks.push({ key:"cms.migrations", status: mismatches.length ? "failed" : pending.length ? "warning" : "passed", message: mismatches.length ? `${mismatches.length} applied migration checksum(s) differ from this release.` : pending.length ? `${pending.length} Polynovea migration(s) are pending.` : "Database migration ledger matches this release.", evidence:{latestApplied,pending:pending.length,mismatches:mismatches.length} });
  checks.push({ key:"cms.core_objects", status: corePresent ? "passed" : "warning", message: corePresent ? "Core Polynovea CMS database objects are present." : "Core CMS objects are not fully initialized yet." });
  return { checks, pending, mismatches, latestApplied, corePresent, major };
}

async function applyPending(client: pg.Client, files: Awaited<ReturnType<typeof migrationFiles>>, pending: string[]) {
  await bootstrapCompatibility(client);
  const pendingSet = new Set(pending);
  const applied: string[] = [];
  for (const file of files) {
    if (!pendingSet.has(file.filename)) continue;
    await client.query("begin");
    try {
      await client.query(file.sql);
      await client.query(`insert into public.${LEDGER_TABLE}(filename,checksum_sha256,migration_id) values($1,$2,$3) on conflict(filename) do nothing`, [file.filename,file.checksum,file.id]);
      await client.query("commit");
      applied.push(file.filename);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw Object.assign(new Error(`Migration ${file.filename} failed: ${error instanceof Error ? error.message : String(error)}`), { migration: file.filename });
    }
  }
  const latest = files.at(-1)?.id ?? "unknown";
  await client.query("update cms_runtime_state set schema_migration=$1,updated_at=now() where singleton=true", [latest]).catch(() => {});
  return applied;
}

export async function runDatabaseProvisioning(params:{workspaceId:string;environmentId:string;operation:"preflight"|"initialize"|"upgrade"|"verify"|"repair"}) : Promise<DatabaseProvisioningResult> {
  const files = await migrationFiles();
  const latestAvailable = files.at(-1)?.id ?? null;
  let discovered: Awaited<ReturnType<typeof findDatabaseConnection>>;
  try { discovered = await findDatabaseConnection(params.workspaceId, params.environmentId); }
  catch (error) { return { supported:false,ready:false,provider:"unknown",connectionId:null,checks:[{key:"database.connection",status:"failed",message:error instanceof Error?error.message:"Could not resolve database connection"}],migration:{latestAvailable,latestApplied:null,pending:files.map(f=>f.filename),checksumMismatches:[]},instructions:"Create and verify a Database connection for this environment first." }; }
  const provider = discovered.connection?.connector_type ?? "unconfigured";
  if (!discovered.connection) return { supported:false,ready:false,provider,connectionId:null,checks:[{key:"database.connection",status:"failed",message:"No PostgreSQL/Supabase database connection is configured for this environment."}],migration:{latestAvailable,latestApplied:null,pending:files.map(f=>f.filename),checksumMismatches:[]},instructions:"Open Connections and add an Existing PostgreSQL or Supabase database connection." };
  if (!discovered.connectionString) return { supported:false,ready:false,provider,connectionId:discovered.connection.id,checks:[{key:"database.connection_url",status:"failed",message:"This database connection does not include a direct PostgreSQL connection URL, so database-level initialization cannot run automatically."}],migration:{latestAvailable,latestApplied:null,pending:files.map(f=>f.filename),checksumMismatches:[]},instructions: provider === "database.supabase" ? "Add the Supabase direct/pooler PostgreSQL connection URL to this connection, then rerun Preflight. API keys alone can verify the Supabase REST project but cannot apply database migrations." : "Add a PostgreSQL connection URL credential, then rerun Preflight." };
  let client: pg.Client | null = null;
  try {
    client = await connect(discovered.connectionString);
    let inspection = await inspectTarget(client, files);
    if (inspection.major < MIN_POSTGRES_MAJOR || inspection.mismatches.length) return {supported:true,ready:false,provider,connectionId:discovered.connection.id,checks:inspection.checks,migration:{latestAvailable,latestApplied:inspection.latestApplied,pending:inspection.pending,checksumMismatches:inspection.mismatches}};
    if (["initialize","upgrade","repair"].includes(params.operation)) {
      const ledger = await client.query("select to_regclass('public.polynovea_migration_ledger') is not null as exists");
      const hasCore = await client.query("select to_regclass('public.workspaces') is not null as exists");
      if (!ledger.rows[0]?.exists && hasCore.rows[0]?.exists) throw new Error("Target already contains Polynovea-like core tables but has no migration ledger. Automatic adoption is blocked to avoid guessing schema history.");
      await applyPending(client, files, inspection.pending);
      inspection = await inspectTarget(client, files);
    }
    const requiredPassed = inspection.checks.filter(c=>["postgres.version","postgres.create","cms.migrations","cms.core_objects"].includes(c.key)).every(c=>c.status==="passed");
    return { supported:true,ready:requiredPassed,provider,connectionId:discovered.connection.id,checks:inspection.checks,migration:{latestAvailable,latestApplied:inspection.latestApplied,pending:inspection.pending,checksumMismatches:inspection.mismatches} };
  } catch (error) {
    const safe = redactCredentials(error instanceof Error?error.message:String(error), discovered.credentials);
    return { supported:true,ready:false,provider,connectionId:discovered.connection.id,checks:[{key:"database.operation",status:"failed",message:safe}],migration:{latestAvailable,latestApplied:null,pending:files.map(f=>f.filename),checksumMismatches:[]},instructions:"Fix the reported database capability/permission issue and retry the same provisioning operation; failed runs are recorded and resumable." };
  } finally { if (client) await client.end().catch(()=>{}); }
}
