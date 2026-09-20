import pg from "pg";
import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { redactCredentials, resolveConnectionCredentials } from "@/lib/infrastructure/credentialProvider";
import type { OperationalWorldEdgeSeed, OperationalWorldNodeSeed } from "@/lib/intelligence/operationalTypes";

const { Client } = pg;

export interface DeepPostgresDiscovery {
  supported: boolean;
  connectionId: string | null;
  provider: string | null;
  database: {
    version: string | null;
    major: number | null;
    database: string | null;
    user: string | null;
    ssl: boolean | null;
    canCreatePublic: boolean | null;
    extensions: string[];
    currentMigration: string | null;
  };
  inventory: {
    tables: Array<{ name: string; rowEstimate: number; totalBytes: number; rlsEnabled: boolean; rlsForced: boolean }>;
    columns: Array<{ table: string; name: string; dataType: string; nullable: boolean; defaultExpression: string | null }>;
    primaryKeys: Array<{ table: string; name: string; columns: string[] }>;
    foreignKeys: Array<{ table: string; name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }>;
    indexes: Array<{ table: string; name: string; unique: boolean; primary: boolean; valid: boolean; definition: string }>;
    constraints: Array<{ table: string; name: string; type: string; definition: string }>;
    functions: Array<{ schema: string; name: string; identityArguments: string; returnType: string; securityDefiner: boolean }>;
    roles: Array<{ name: string; canLogin: boolean; superuser: boolean; bypassRls: boolean }>;
  };
  capabilityStates: Record<string, "supported" | "present" | "missing" | "degraded" | "unverified" | "unsupported">;
  safeEvidence: Record<string, unknown>;
  nodes: OperationalWorldNodeSeed[];
  edges: OperationalWorldEdgeSeed[];
}

async function resolveDatabase(workspaceId: string, environmentId: string) {
  const db = createServiceRoleClient();
  const { data, error } = await db.from("workspace_connections")
    .select("id,connector_type,status,active,created_at")
    .eq("workspace_id", workspaceId)
    .eq("environment_id", environmentId)
    .eq("connector_family", "database")
    .eq("active", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const connection = (data ?? []).find((row) => ["database.postgres", "database.supabase"].includes(row.connector_type) && row.status === "active") ?? null;
  if (!connection) return { connection: null, connectionString: null, credentials: {} as Record<string, string> };
  const credentials = await resolveConnectionCredentials(workspaceId, connection.id);
  return { connection, connectionString: credentials.connection_url ?? null, credentials };
}

async function connectReadOnly(connectionString: string) {
  const url = new URL(connectionString);
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const client = new Client({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000,
    query_timeout: 20_000,
    application_name: "polynovea-operational-discovery",
  });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  await client.query("set lock_timeout = '2s'");
  return client;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export async function discoverPostgresOperationalState(params: { workspaceId: string; environmentId: string }): Promise<DeepPostgresDiscovery> {
  const resolved = await resolveDatabase(params.workspaceId, params.environmentId);
  if (!resolved.connection || !resolved.connectionString) {
    return {
      supported: false,
      connectionId: resolved.connection?.id ?? null,
      provider: resolved.connection?.connector_type ?? null,
      database: { version: null, major: null, database: null, user: null, ssl: null, canCreatePublic: null, extensions: [], currentMigration: null },
      inventory: { tables: [], columns: [], primaryKeys: [], foreignKeys: [], indexes: [], constraints: [], functions: [], roles: [] },
      capabilityStates: { postgres: resolved.connection ? "unverified" : "missing", schema_introspection: "missing" },
      safeEvidence: { reason: resolved.connection ? "direct_connection_url_missing" : "active_database_connection_missing" },
      nodes: [],
      edges: [],
    };
  }

  let client: pg.Client | null = null;
  try {
    client = await connectReadOnly(resolved.connectionString);
    const [identity, tls, capability, extensions, migration, tables, columns, pks, fks, indexes, constraints, functions, roles] = await Promise.all([
      client.query("select current_setting('server_version_num')::int as version_num,current_setting('server_version') as version,current_database() as database,current_user as db_user"),
      client.query("select coalesce((select ssl from pg_stat_ssl where pid=pg_backend_pid()),false) as ssl"),
      client.query("select has_schema_privilege(current_user,'public','CREATE') as can_create"),
      client.query("select extname from pg_extension order by extname"),
      client.query("select to_regclass('public.polynovea_migration_ledger') is not null as present"),
      client.query(`select c.relname as name,greatest(c.reltuples,0)::bigint as row_estimate,pg_total_relation_size(c.oid)::bigint as total_bytes,c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`),
      client.query(`select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position`),
      client.query(`select tc.table_name,tc.constraint_name,array_agg(kcu.column_name order by kcu.ordinal_position) as columns from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.constraint_schema=tc.constraint_schema and kcu.table_name=tc.table_name where tc.table_schema='public' and tc.constraint_type='PRIMARY KEY' group by tc.table_name,tc.constraint_name order by tc.table_name,tc.constraint_name`),
      client.query(`select tc.table_name,tc.constraint_name,array_agg(kcu.column_name order by kcu.ordinal_position) as columns,ccu.table_name as referenced_table,array_agg(ccu.column_name order by kcu.ordinal_position) as referenced_columns from information_schema.table_constraints tc join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name and kcu.constraint_schema=tc.constraint_schema join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name and ccu.constraint_schema=tc.constraint_schema where tc.table_schema='public' and tc.constraint_type='FOREIGN KEY' group by tc.table_name,tc.constraint_name,ccu.table_name order by tc.table_name,tc.constraint_name`),
      client.query(`select tbl.relname as table_name,idx.relname as index_name,i.indisunique as is_unique,i.indisprimary as is_primary,i.indisvalid as is_valid,pg_get_indexdef(idx.oid) as definition from pg_index i join pg_class idx on idx.oid=i.indexrelid join pg_class tbl on tbl.oid=i.indrelid join pg_namespace n on n.oid=tbl.relnamespace where n.nspname='public' order by tbl.relname,idx.relname`),
      client.query(`select c.relname as table_name,con.conname as constraint_name,con.contype as constraint_type,pg_get_constraintdef(con.oid,true) as definition from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,con.conname`),
      client.query(`select n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,pg_get_function_result(p.oid) as return_type,p.prosecdef as security_definer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth') order by n.nspname,p.proname`),
      client.query(`select rolname,rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role','postgres',current_user) order by rolname`),
    ]);

    let currentMigration: string | null = null;
    if (migration.rows[0]?.present) currentMigration = String((await client.query("select migration_id from public.polynovea_migration_ledger order by filename desc limit 1")).rows[0]?.migration_id ?? "") || null;

    const versionNum = Number(identity.rows[0]?.version_num ?? 0);
    const tableInventory = tables.rows.map((row) => ({ name: String(row.name), rowEstimate: Number(row.row_estimate ?? 0), totalBytes: Number(row.total_bytes ?? 0), rlsEnabled: Boolean(row.rls_enabled), rlsForced: Boolean(row.rls_forced) }));
    const columnInventory = columns.rows.map((row) => ({ table: String(row.table_name), name: String(row.column_name), dataType: String(row.data_type), nullable: row.is_nullable === "YES", defaultExpression: row.column_default == null ? null : String(row.column_default) }));
    const primaryKeys = pks.rows.map((row) => ({ table: String(row.table_name), name: String(row.constraint_name), columns: stringArray(row.columns) }));
    const foreignKeys = fks.rows.map((row) => ({ table: String(row.table_name), name: String(row.constraint_name), columns: stringArray(row.columns), referencedTable: String(row.referenced_table), referencedColumns: stringArray(row.referenced_columns) }));
    const indexInventory = indexes.rows.map((row) => ({ table: String(row.table_name), name: String(row.index_name), unique: Boolean(row.is_unique), primary: Boolean(row.is_primary), valid: Boolean(row.is_valid), definition: String(row.definition) }));
    const constraintInventory = constraints.rows.map((row) => ({ table: String(row.table_name), name: String(row.constraint_name), type: String(row.constraint_type), definition: String(row.definition) }));
    const functionInventory = functions.rows.map((row) => ({ schema: String(row.schema_name), name: String(row.function_name), identityArguments: String(row.identity_arguments ?? ""), returnType: String(row.return_type ?? ""), securityDefiner: Boolean(row.security_definer) }));
    const roleInventory = roles.rows.map((row) => ({ name: String(row.rolname), canLogin: Boolean(row.rolcanlogin), superuser: Boolean(row.rolsuper), bypassRls: Boolean(row.rolbypassrls) }));
    const extensionsList = extensions.rows.map((row) => String(row.extname));
    const allPublicTablesRls = tableInventory.filter((table) => !table.name.startsWith("polynovea_migration_ledger")).every((table) => table.rlsEnabled);
    const invalidIndexes = indexInventory.filter((index) => !index.valid).length;

    const databaseKey = `connection:${resolved.connection.id}`;
    const nodes: OperationalWorldNodeSeed[] = [];
    const edges: OperationalWorldEdgeSeed[] = [];
    for (const table of tableInventory) {
      const tableKey = `database-table:${table.name}`;
      nodes.push({
        nodeKey: tableKey,
        nodeType: "other",
        displayName: `public.${table.name}`,
        state: table.rlsEnabled ? "present" : "degraded",
        provider: "postgresql",
        capabilityKey: "database_table",
        sourceEntityType: "postgres_table",
        sourceEntityId: table.name,
        sourceType: "postgres_catalog",
        sourceRef: table.name,
        attributes: { rowEstimate: table.rowEstimate, totalBytes: table.totalBytes, rlsEnabled: table.rlsEnabled, rlsForced: table.rlsForced, columnCount: columnInventory.filter((column) => column.table === table.name).length, indexCount: indexInventory.filter((index) => index.table === table.name).length },
        evidence: { source: "pg_catalog", observedWithoutRowPayloads: true },
        observationKind: "observed",
      });
      edges.push({ fromNodeKey: databaseKey, toNodeKey: tableKey, relationship: "stores_in", sourceType: "postgres_catalog", sourceRef: table.name, observationKind: "observed" });
    }
    for (const fk of foreignKeys) {
      edges.push({
        fromNodeKey: `database-table:${fk.table}`,
        toNodeKey: `database-table:${fk.referencedTable}`,
        relationship: "depends_on",
        sourceType: "postgres_catalog",
        sourceRef: fk.name,
        attributes: { constraint: fk.name, columns: fk.columns, referencedColumns: fk.referencedColumns },
        observationKind: "observed",
      });
    }

    return {
      supported: true,
      connectionId: resolved.connection.id,
      provider: resolved.connection.connector_type,
      database: {
        version: String(identity.rows[0]?.version ?? ""),
        major: Math.floor(versionNum / 10000),
        database: String(identity.rows[0]?.database ?? ""),
        user: String(identity.rows[0]?.db_user ?? ""),
        ssl: Boolean(tls.rows[0]?.ssl),
        canCreatePublic: Boolean(capability.rows[0]?.can_create),
        extensions: extensionsList,
        currentMigration,
      },
      inventory: { tables: tableInventory, columns: columnInventory, primaryKeys, foreignKeys, indexes: indexInventory, constraints: constraintInventory, functions: functionInventory, roles: roleInventory },
      capabilityStates: {
        postgres: "present",
        schema_introspection: "present",
        tls: tls.rows[0]?.ssl ? "present" : "degraded",
        rls: allPublicTablesRls ? "present" : "degraded",
        indexes: invalidIndexes === 0 ? "present" : "degraded",
        migration_ledger: migration.rows[0]?.present ? "present" : "missing",
      },
      safeEvidence: {
        inventoryCounts: { tables: tableInventory.length, columns: columnInventory.length, primaryKeys: primaryKeys.length, foreignKeys: foreignKeys.length, indexes: indexInventory.length, constraints: constraintInventory.length, functions: functionInventory.length, roles: roleInventory.length },
        allPublicTablesRls,
        invalidIndexes,
        rawContentInspected: false,
        credentialsPersisted: false,
      },
      nodes,
      edges,
    };
  } catch (error) {
    const message = redactCredentials(error instanceof Error ? error.message : String(error), resolved.credentials);
    throw Object.assign(new Error(message), { status: Number((error as any)?.status) || 400 });
  } finally {
    if (client) await client.end().catch(() => undefined);
  }
}
