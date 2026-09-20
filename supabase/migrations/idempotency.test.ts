import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * There is no live Postgres in this environment to actually run these
 * migrations against (see docs/upgrade/MIGRATIONS.md), so "migration
 * idempotency" is verified statically: every migration must be safely
 * re-runnable, because a fresh self-hosted OSS deployment (and any
 * mistaken re-run against an already-migrated database) replays every file
 * in this directory from 0001 onward. This test parses each .sql file's
 * top-level statements and asserts the idempotent-by-construction rules the
 * project's migrations are supposed to follow.
 */

const MIGRATIONS_DIR = __dirname;

function sqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function stripDollarQuotedBlocks(sql: string): string {
  return sql.replace(/\$([a-zA-Z0-9_]*)\$[\s\S]*?\$\1\$/g, "''");
}

function statements(sql: string): string[] {
  return stripDollarQuotedBlocks(stripLineComments(sql))
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function firstLine(statement: string): string {
  return statement.split("\n")[0];
}

describe("migration files exist and are non-empty", () => {
  it("finds at least the migrations known at Phase 1 Milestone B", () => {
    const files = sqlFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        "0001_baseline.sql",
        "0002_backport_undocumented_columns.sql",
        "0003_rls_dead_tables.sql",
        "0004_rls_blog_and_metrics.sql",
        "0005_rls_content_tracking.sql",
        "0006_rls_admin_tables.sql",
        "0007_workspace_core.sql",
      ]),
    );
  });
});

describe.each(sqlFiles())("%s is safely re-runnable", (filename) => {
  const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf8");
  const stmts = statements(sql);

  it("guards every CREATE TABLE with IF NOT EXISTS", () => {
    const offenders = stmts.filter(
      (s) => /^create table\b/i.test(s) && !/if not exists/i.test(s),
    );
    expect(offenders.map(firstLine)).toEqual([]);
  });

  it("guards every CREATE INDEX with IF NOT EXISTS", () => {
    const offenders = stmts.filter(
      (s) => /^create index\b/i.test(s) && !/if not exists/i.test(s),
    );
    expect(offenders.map(firstLine)).toEqual([]);
  });

  it("guards every ALTER TABLE ... ADD COLUMN with IF NOT EXISTS", () => {
    const offenders = stmts.filter(
      (s) => /^alter table\b.*\badd column\b/i.test(s) && !/if not exists/i.test(s),
    );
    expect(offenders.map(firstLine)).toEqual([]);
  });

  it("guards every INSERT with ON CONFLICT", () => {
    const offenders = stmts.filter(
      (s) => /^insert into\b/i.test(s) && !/on conflict/i.test(s),
    );
    expect(offenders.map(firstLine)).toEqual([]);
  });

  it("never uses DROP TABLE or DROP COLUMN (no destructive statements in routine migrations)", () => {
    const offenders = stmts.filter(
      (s) => /^drop table\b/i.test(s) || /\bdrop column\b/i.test(s),
    );
    expect(offenders.map(firstLine)).toEqual([]);
  });

  it("precedes every CREATE POLICY with a matching DROP POLICY IF EXISTS (Postgres has no CREATE POLICY IF NOT EXISTS)", () => {
    const createPolicyStatements = stmts.filter((s) => /^create policy\b/i.test(s));
    for (const stmt of createPolicyStatements) {
      const nameMatch = stmt.match(/^create policy\s+"([^"]+)"/i);
      expect(nameMatch, `could not parse policy name from: ${firstLine(stmt)}`).not.toBeNull();
      const policyName = nameMatch![1];
      const hasDrop = stmts.some((s) =>
        new RegExp(`^drop policy if exists\\s+"${policyName}"`, "i").test(s),
      );
      expect(hasDrop, `missing "drop policy if exists \\"${policyName}\\"" before its CREATE POLICY`).toBe(true);
    }
  });
});
