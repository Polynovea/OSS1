import { NextResponse } from "next/server";
import { hasSupabaseConfig, supabase, supabaseUrl } from "@/lib/supabase";
import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getOverviewTotals } from "@/lib/admin/ga4";
import { requirePlatformAccess } from "@/lib/platform/permissions";

const ts = () => new Date().toISOString();

// Tables that SHOULD exist in Supabase
const REQUIRED_TABLES = [
  "blog_posts",
  "live_metrics",
  "social_posts",
  "ad_campaigns",
];

export async function GET(req: Request) {
  const auth = await requirePlatformAccess(req, { permission: "infrastructure.diagnose" });
  if (auth.error) return auth.error;
  const results: Record<string, any> = {};

  // ── 1. Supabase connectivity ──────────────────────────────────────────────
  const supabaseChecks: Record<string, any> = {};
  let supabaseConnected = false;

  if (!hasSupabaseConfig) {
    supabaseChecks["connection_error"] = "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY";
  } else {
    try {
      // Simple ping — list tables via information_schema
      const { data: tableList, error: tableListErr } = await supabase
        .from("information_schema.tables" as any)
        .select("table_name")
        .eq("table_schema", "public")
        .limit(50);

      if (tableListErr) {
        // Fallback: just try to query each table directly
        supabaseConnected = true; // the client connected, table query might be restricted
      } else {
        supabaseConnected = true;
        const existingTables = (tableList || []).map((r: any) => r.table_name);
        supabaseChecks["existing_tables"] = existingTables;
      }
    } catch (err: any) {
      supabaseChecks["connection_error"] = err.message;
    }
  }

  // ── 2. Check each required table ─────────────────────────────────────────
  const tableStatus: Record<string, any> = {};

  for (const tbl of REQUIRED_TABLES) {
    if (!hasSupabaseConfig) {
      tableStatus[tbl] = {
        exists: false,
        error: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY",
        action: "SET SUPABASE ENV VARS",
      };
      continue;
    }

    try {
      const { data, error, count } = await supabase
        .from(tbl)
        .select("*", { count: "exact", head: false })
        .limit(1);

      if (error) {
        tableStatus[tbl] = {
          exists: false,
          error: error.message,
          code: error.code,
          action: error.code === "PGRST205"
            ? "MISSING — run migration.sql in Supabase SQL Editor"
            : `ERROR: ${error.message}`,
        };
      } else {
        // Count all rows
        const { count: rowCount } = await supabase
          .from(tbl)
          .select("*", { count: "exact", head: true });

        tableStatus[tbl] = {
          exists: true,
          row_count: rowCount ?? (data?.length ?? 0),
          sample: data?.[0] ? Object.keys(data[0]) : [],
          action: "OK",
        };
      }
    } catch (err: any) {
      tableStatus[tbl] = {
        exists: false,
        error: err.message,
        action: "MISSING — run migration.sql",
      };
    }
  }

  results["supabase"] = {
    config_present: hasSupabaseConfig,
    connected: supabaseConnected,
    ...supabaseChecks,
    tables: tableStatus,
    missing_tables: REQUIRED_TABLES.filter(t => !tableStatus[t]?.exists),
    all_tables_ok: REQUIRED_TABLES.every(t => tableStatus[t]?.exists),
  };

  // ── 3. Cloudflare R2 Storage ────────────────────────────────────────────────
  const r2Result: Record<string, any> = {
    credentials_set: !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY),
    bucket_name: process.env.R2_BUCKET_NAME ?? "media",
    account_id: process.env.R2_ACCOUNT_ID ?? null,
    public_url: process.env.R2_PUBLIC_URL ?? null,
    connected: false,
    bucket_exists: false,
    object_count: null,
    error: null,
  };

  try {
    const accountId = process.env.R2_ACCOUNT_ID!;
    const bucketName = process.env.R2_BUCKET_NAME ?? "media";
    const client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_S3_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });

    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    r2Result["bucket_exists"] = true;
    r2Result["connected"] = true;

    const listing = await client.send(new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 100 }));
    r2Result["object_count"] = listing.KeyCount ?? 0;
    r2Result["sample_objects"] = (listing.Contents ?? []).slice(0, 5).map((o) => o.Key);
    r2Result["action"] = "OK";
  } catch (err: any) {
    r2Result["error"] = err.message;
    r2Result["action"] = "CONNECTION FAILED — check R2_* env vars";
  }

  results["r2_storage"] = r2Result;

  // ── 4. Google Analytics 4 ────────────────────────────────────────────────────
  const ga4Result: Record<string, any> = {
    configured: Boolean(process.env.GA4_PROPERTY_ID && process.env.GA4_CLIENT_EMAIL && process.env.GA4_PRIVATE_KEY),
    connected: false,
    error: null,
  };

  try {
    const totals = await getOverviewTotals("7d");
    ga4Result["connected"] = true;
    ga4Result["sample_active_users_7d"] = totals.activeUsers;
    ga4Result["action"] = "OK";
  } catch (err: any) {
    ga4Result["error"] = err.message;
    ga4Result["action"] = "CONNECTION FAILED — check GA4_* env vars";
  }

  results["ga4"] = ga4Result;

  // ── 5. Summary ────────────────────────────────────────────────────────────
  const supabaseMissing = results["supabase"]["missing_tables"] as string[];
  results["summary"] = {
    supabase_ok: results["supabase"]["all_tables_ok"],
    r2_ok: r2Result["connected"],
    ga4_ok: ga4Result["connected"],
    missing_supabase_tables: supabaseMissing,
    needs_migration: supabaseMissing.length > 0,
    migration_file: "supabase/migration.sql — run in Supabase SQL Editor",
    timestamp: ts(),
  };

  return NextResponse.json(results, { status: 200 });
}
