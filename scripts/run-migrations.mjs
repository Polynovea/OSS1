// Ordered PostgreSQL migration runner for installation and controlled upgrades.
// Connects directly using DATABASE_URL from .env.local or the process environment.
//
// Usage: node scripts/run-migrations.mjs --all
//    or: node scripts/run-migrations.mjs <file1.sql> [file2.sql ...]
//
// Applied migration files are immutable. Each successful file is recorded in
// public.polynovea_migration_ledger with its SHA-256 checksum. Re-running an
// identical applied migration is a no-op; a checksum mismatch fails closed.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const LEDGER_TABLE = "polynovea_migration_ledger";

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let content = "";
  try {
    content = readFileSync(envPath, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function checksum(value) {
  return createHash("sha256").update(value).digest("hex");
}

function migrationId(filename) {
  return path.basename(filename).match(/^(\d{4})/)?.[1] ?? path.basename(filename);
}

loadEnvLocal();

const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!connectionString) {
  console.error("No Database_URL / DATABASE_URL found in .env.local or the process environment");
  process.exit(1);
}

const requested = process.argv.slice(2);
const files = requested.length === 1 && requested[0] === "--all"
  ? readdirSync(path.resolve(process.cwd(), "supabase/migrations"))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort()
      .map((name) => path.join("supabase", "migrations", name))
  : requested;

if (files.length === 0) {
  console.error("Usage: node scripts/run-migrations.mjs --all | <file1.sql> [file2.sql ...]");
  process.exit(1);
}

const url = new URL(connectionString);
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
const client = new Client({ connectionString, ssl: local ? undefined : { rejectUnauthorized: false } });

async function ensureLedger() {
  const { rows: [state] } = await client.query(`
    select
      to_regclass('public.${LEDGER_TABLE}') is not null as ledger_exists,
      to_regclass('public.workspaces') is not null as core_exists
  `);

  if (!state.ledger_exists && state.core_exists) {
    throw new Error(
      "This database already contains Polynovea core tables but has no migration ledger. " +
      "Automatic adoption is blocked because applied migration provenance cannot be proven.",
    );
  }

  await client.query(`create table if not exists public.${LEDGER_TABLE}(
    filename text primary key,
    checksum_sha256 text not null,
    migration_id text not null,
    applied_at timestamptz not null default now()
  )`);
}

async function main() {
  await client.connect();
  console.log("Connected.\n");
  await ensureLedger();

  for (const file of files) {
    const filename = path.basename(file);
    const id = migrationId(filename);
    const sql = readFileSync(file, "utf8");
    const hash = checksum(sql);
    const { rows: [recorded] } = await client.query(
      `select checksum_sha256 from public.${LEDGER_TABLE} where filename=$1`,
      [filename],
    );

    if (recorded) {
      if (recorded.checksum_sha256 !== hash) {
        throw new Error(`Applied migration checksum mismatch: ${filename}. Applied migrations are immutable.`);
      }
      console.log(`=== ${file} ... already applied`);
      continue;
    }

    process.stdout.write(`=== ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `insert into public.${LEDGER_TABLE}(filename,checksum_sha256,migration_id) values($1,$2,$3)`,
        [filename, hash, id],
      );
      await client.query("COMMIT");
      console.log("OK");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.log("FAILED");
      throw err;
    }
  }

  const latest = files.map((file) => migrationId(file)).sort().at(-1);
  if (latest) {
    await client.query(
      "update cms_runtime_state set schema_migration=$1,updated_at=now() where singleton=true",
      [latest],
    ).catch(() => {});
  }

  await client.end();
  console.log("\nAll requested migrations are reconciled successfully.");
}

main().catch(async (err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : String(err));
  await client.end().catch(() => {});
  process.exit(1);
});
