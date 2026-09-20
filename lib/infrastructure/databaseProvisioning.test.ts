import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const baseConnectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
const describeWithDatabase = baseConnectionString ? describe : describe.skip;

let targetConnectionString = "";
const connectionId = randomUUID();

class QueryChain implements PromiseLike<{ data: unknown[]; error: null }> {
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  then<TResult1 = { data: unknown[]; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: unknown[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [{ id: connectionId, connector_type: "database.postgres", name: "Disposable target", status: "active", active: true, created_at: new Date().toISOString() }], error: null }).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/admin/serviceRole", () => ({ createServiceRoleClient: () => ({ from: () => new QueryChain() }) }));
vi.mock("@/lib/infrastructure/credentialProvider", () => ({
  resolveConnectionCredentials: async () => ({ connection_url: targetConnectionString }),
  redactCredentials: (message: string) => message.split(targetConnectionString).join("[REDACTED]"),
}));

const { runDatabaseProvisioning } = await import("@/lib/infrastructure/databaseProvisioning");

const { Client } = pg;
const databaseName = `p125_${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
let root: pg.Client;

function urlForDatabase(name: string) {
  const url = new URL(baseConnectionString!);
  url.pathname = `/${name}`;
  return url.toString();
}

describeWithDatabase("Phase 12.5 database provisioning", () => {
  beforeAll(async () => {
    root = new Client({ connectionString: baseConnectionString!, ssl: { rejectUnauthorized: false } });
    await root.connect();
    if (!/^[a-z0-9_]+$/.test(databaseName)) throw new Error("Unsafe certification database name");
    await root.query(`create database "${databaseName}"`);
    targetConnectionString = urlForDatabase(databaseName);
  }, 30_000);

  afterAll(async () => {
    if (root) {
      await root.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()`, [databaseName]).catch(() => undefined);
      await root.query(`drop database if exists "${databaseName}"`).catch(() => undefined);
      await root.end().catch(() => undefined);
    }
  }, 30_000);

  it("initializes a fresh PostgreSQL database with the real ordered migration set and is idempotent", async () => {
    const initialized = await runDatabaseProvisioning({ workspaceId: randomUUID(), environmentId: randomUUID(), operation: "initialize" });
    expect(initialized.supported).toBe(true);
    expect(initialized.ready).toBe(true);
    expect(initialized.migration.pending).toEqual([]);
    expect(initialized.migration.checksumMismatches).toEqual([]);

    const target = new Client({ connectionString: targetConnectionString, ssl: { rejectUnauthorized: false } });
    await target.connect();
    const expectedFiles = readdirSync("supabase/migrations").filter(name => /^\d{4}_.+\.sql$/.test(name)).sort();
    const ledger = await target.query("select filename,checksum_sha256,migration_id from public.polynovea_migration_ledger order by filename");
    expect(ledger.rows.map(row => row.filename)).toEqual(expectedFiles);
    const core = await target.query("select to_regclass('public.workspaces') as workspaces,to_regclass('public.content_models') as models,to_regclass('public.delivery_jobs') as jobs,to_regclass('public.workspace_environments') as environments");
    expect(core.rows[0]).toMatchObject({ workspaces: "workspaces", models: "content_models", jobs: "delivery_jobs", environments: "workspace_environments" });
    await target.end();

    const second = await runDatabaseProvisioning({ workspaceId: randomUUID(), environmentId: randomUUID(), operation: "upgrade" });
    expect(second.ready).toBe(true);
    expect(second.migration.pending).toEqual([]);
    expect(second.migration.checksumMismatches).toEqual([]);
  }, 180_000);

  it("detects applied migration checksum drift and refuses to report the target ready", async () => {
    const target = new Client({ connectionString: targetConnectionString, ssl: { rejectUnauthorized: false } });
    await target.connect();
    const first = await target.query("select filename from public.polynovea_migration_ledger order by filename limit 1");
    await target.query("update public.polynovea_migration_ledger set checksum_sha256=$2 where filename=$1", [first.rows[0].filename, "0".repeat(64)]);
    await target.end();

    const drift = await runDatabaseProvisioning({ workspaceId: randomUUID(), environmentId: randomUUID(), operation: "preflight" });
    expect(drift.ready).toBe(false);
    expect(drift.migration.checksumMismatches.length).toBeGreaterThan(0);
    expect(drift.checks.find(check => check.key === "cms.migrations")?.status).toBe("failed");
  }, 60_000);
});
