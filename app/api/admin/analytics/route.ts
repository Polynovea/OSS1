import { NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/admin/serverAccess";
import { getDbItems } from "@/lib/dbAdapter";
import {
  getOverviewTotals, getOverviewTrend, getTrafficSources, getDeviceBreakdown,
  getAllPages, getBlogPosts, type Ga4Range,
} from "@/lib/admin/ga4";

const ts = () => new Date().toISOString();
const VALID_RANGES: Ga4Range[] = ["7d", "28d", "90d"];

export async function GET(req: Request) {
  const auth = await requireAdminRequest(req, { requiredModule: "cms.metrics" });
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const section = searchParams.get("section") || "overview";
  const rangeParam = searchParams.get("range") || "28d";
  const range: Ga4Range = VALID_RANGES.includes(rangeParam as Ga4Range) ? (rangeParam as Ga4Range) : "28d";

  try {
    if (section === "overview") {
      const [totals, trend, sources, devices] = await Promise.all([
        getOverviewTotals(range),
        getOverviewTrend(range),
        getTrafficSources(range),
        getDeviceBreakdown(range),
      ]);
      return NextResponse.json({ success: true, data: { totals, trend, sources, devices }, error: null, timestamp: ts() });
    }

    if (section === "pages") {
      const pages = await getAllPages(range);
      return NextResponse.json({ success: true, data: { pages }, error: null, timestamp: ts() });
    }

    if (section === "blog") {
      const [gaRows, blogPostsResult] = await Promise.all([
        getBlogPosts(range),
        getDbItems("blog_posts"),
      ]);
      const bySlug = new Map((blogPostsResult.data || []).map((p: any) => [p.slug, p]));
      const posts = gaRows.map((r) => ({
        ...r,
        title: bySlug.get(r.slug)?.title ?? r.slug,
        status: bySlug.get(r.slug)?.status ?? null,
      }));
      return NextResponse.json({ success: true, data: { posts }, error: null, timestamp: ts() });
    }

    return NextResponse.json({ success: false, data: null, error: "Unknown section", timestamp: ts() }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ success: false, data: null, error: err.message || String(err), timestamp: ts() }, { status: 500 });
  }
}
