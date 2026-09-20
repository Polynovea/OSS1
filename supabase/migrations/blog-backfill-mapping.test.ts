import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 4 (Blog Consumer Certification) requires "a repeatable parity script
 * and integration tests for ... field/count reconciliation" (V2 §13). The
 * live-count/mismatch half of that is `scripts/verify-blog-backfill.mjs`,
 * which needs a real Postgres connection and so cannot run in this test
 * suite (see idempotency.test.ts's note on why migrations are tested
 * statically here). This file covers the half that CAN be checked
 * statically and would otherwise silently drift: that
 * 0010_blog_compatibility_backfill.sql's field mapping still carries every
 * field the plan promises to preserve (V2 §13 Phase 4: "titles, slugs,
 * excerpts, body, author, cover image, status, published date"), so an
 * unreviewed edit to the migration can't quietly drop one.
 */

const migrationPath = join(__dirname, "0010_blog_compatibility_backfill.sql");
const sql = readFileSync(migrationPath, "utf8");

describe("0010_blog_compatibility_backfill.sql field mapping", () => {
  it("maps every legacy blog_posts column the plan promises to preserve", () => {
    const requiredMappings: Array<[sourceColumn: string, targetKey: string]> = [
      ["post.title", "'title'"],
      ["post.slug", "'slug'"],
      ["post.excerpt", "'excerpt'"],
      ["post.content", "'body'"], // legacy `content` -> generic `body`, per ADR/plan naming
      ["post.author", "'author'"],
      ["post.cover_image", "'cover_image'"],
      ["post.published_at", "'published_at'"],
    ];
    for (const [source, target] of requiredMappings) {
      expect(sql, `expected jsonb_build_object to map ${target} from ${source}`).toMatch(
        new RegExp(`${target}\\s*,\\s*${source.replace(".", "\\.")}`),
      );
    }
  });

  it("derives entry status from the legacy post's published status", () => {
    expect(sql).toMatch(/post\.status\s*=\s*'published'/);
  });

  it("is ledger-driven (idempotent replay skips already-migrated rows)", () => {
    expect(sql).toMatch(/left join legacy_content_migrations l[\s\S]*where l\.source_id is null/i);
  });

  it("declares the compatibility schema's canonical field set to match the same seven fields", () => {
    for (const key of ["title", "slug", "excerpt", "body", "author", "cover_image", "published_at"]) {
      expect(sql, `expected schema_json to declare field "${key}"`).toMatch(new RegExp(`"key"\\s*:\\s*"${key}"`));
    }
  });
});
