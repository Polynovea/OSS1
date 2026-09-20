import { BetaAnalyticsDataClient } from "@google-analytics/data";

export type Ga4Range = "7d" | "28d" | "90d";

let client: BetaAnalyticsDataClient | null = null;

function normalizePrivateKey(key: string): string {
  let k = key.trim();
  // A stray pair of wrapping quotes (copied along with the .env.local-style
  // value, which is quoted, instead of the raw multi-line PEM) breaks parsing
  // outright — the string wouldn't start with "-----BEGIN..." at all.
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1).trim();
  }
  // Environment variable UIs are inconsistent about how they store multi-line
  // secrets: some preserve real newlines, others require literal "\n" escapes
  // that only become real newlines via dotenv parsing (which only runs
  // locally, not on Vercel). Normalize both cases to real newlines, and
  // normalize CRLF in case a Windows clipboard round-trip introduced any.
  k = k.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  return k;
}

function getClient(): BetaAnalyticsDataClient {
  if (!client) {
    const clientEmail = process.env.GA4_CLIENT_EMAIL;
    const rawPrivateKey = process.env.GA4_PRIVATE_KEY;
    if (!clientEmail || !rawPrivateKey) {
      throw new Error("GA4_CLIENT_EMAIL / GA4_PRIVATE_KEY are not configured");
    }
    client = new BetaAnalyticsDataClient({
      credentials: { client_email: clientEmail, private_key: normalizePrivateKey(rawPrivateKey) },
    });
  }
  return client;
}

function getPropertyPath(): string {
  const propertyId = process.env.GA4_PROPERTY_ID;
  if (!propertyId) throw new Error("GA4_PROPERTY_ID is not configured");
  return `properties/${propertyId}`;
}

function dateRangeFor(range: Ga4Range) {
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 28;
  return [{ startDate: `${days}daysAgo`, endDate: "today" }];
}

function rowsToObjects(response: {
  dimensionHeaders?: { name?: string | null }[] | null;
  metricHeaders?: { name?: string | null }[] | null;
  rows?: { dimensionValues?: { value?: string | null }[] | null; metricValues?: { value?: string | null }[] | null }[] | null;
}): Record<string, string>[] {
  const dimHeaders = (response.dimensionHeaders || []).map((h) => h.name ?? "");
  const metHeaders = (response.metricHeaders || []).map((h) => h.name ?? "");
  return (response.rows || []).map((row) => {
    const obj: Record<string, string> = {};
    (row.dimensionValues || []).forEach((v, i) => { obj[dimHeaders[i]] = v.value ?? ""; });
    (row.metricValues || []).forEach((v, i) => { obj[metHeaders[i]] = v.value ?? ""; });
    return obj;
  });
}

export async function getOverviewTotals(range: Ga4Range) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    metrics: [
      { name: "activeUsers" }, { name: "newUsers" }, { name: "sessions" },
      { name: "screenPageViews" }, { name: "engagementRate" },
      { name: "averageSessionDuration" }, { name: "bounceRate" },
    ],
  });
  const row = rowsToObjects(response)[0] || {};
  return {
    activeUsers: Number(row.activeUsers || 0),
    newUsers: Number(row.newUsers || 0),
    sessions: Number(row.sessions || 0),
    pageViews: Number(row.screenPageViews || 0),
    engagementRate: Number(row.engagementRate || 0),
    avgSessionDuration: Number(row.averageSessionDuration || 0),
    bounceRate: Number(row.bounceRate || 0),
  };
}

export async function getOverviewTrend(range: Ga4Range) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    dimensions: [{ name: "date" }],
    metrics: [{ name: "activeUsers" }, { name: "sessions" }, { name: "screenPageViews" }],
    orderBys: [{ dimension: { dimensionName: "date" } }],
  });
  return rowsToObjects(response).map((r) => ({
    date: r.date,
    activeUsers: Number(r.activeUsers || 0),
    sessions: Number(r.sessions || 0),
    pageViews: Number(r.screenPageViews || 0),
  }));
}

export async function getTrafficSources(range: Ga4Range) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }, { name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });
  return rowsToObjects(response).map((r) => ({
    channel: r.sessionDefaultChannelGroup || "(unassigned)",
    sessions: Number(r.sessions || 0),
    users: Number(r.activeUsers || 0),
  }));
}

export async function getDeviceBreakdown(range: Ga4Range) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    dimensions: [{ name: "deviceCategory" }],
    metrics: [{ name: "activeUsers" }, { name: "sessions" }],
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
  });
  return rowsToObjects(response).map((r) => ({
    device: r.deviceCategory || "(unknown)",
    users: Number(r.activeUsers || 0),
    sessions: Number(r.sessions || 0),
  }));
}

export async function getAllPages(range: Ga4Range, limit = 50) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "activeUsers" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  return rowsToObjects(response).map((r) => ({
    path: r.pagePath,
    title: r.pageTitle,
    pageViews: Number(r.screenPageViews || 0),
    avgEngagementTime: Number(r.averageSessionDuration || 0),
    users: Number(r.activeUsers || 0),
  }));
}

export async function getBlogPosts(range: Ga4Range) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: dateRangeFor(range),
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "activeUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH", value: "/blog/" },
      },
    },
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: 100,
  });
  return rowsToObjects(response).map((r) => {
    const path = r.pagePath || "";
    const slug = path.replace(/^\/blog\//, "").replace(/\/$/, "");
    return {
      path,
      slug,
      pageViews: Number(r.screenPageViews || 0),
      avgEngagementTime: Number(r.averageSessionDuration || 0),
      users: Number(r.activeUsers || 0),
    };
  });
}


/**
 * Phase 11 content-intelligence query. Unlike the dashboard helpers above,
 * this accepts absolute GA4 date ranges so snapshots can be compared without
 * pretending the data is live or causally attributable to a content change.
 */
export async function getPagesForPeriod(startDate: string, endDate: string, limit = 10000) {
  const [response] = await getClient().runReport({
    property: getPropertyPath(),
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "activeUsers" },
      { name: "userEngagementDuration" },
      { name: "sessions" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  return rowsToObjects(response).map((r) => ({
    path: r.pagePath || "",
    title: r.pageTitle || "",
    pageViews: Number(r.screenPageViews || 0),
    users: Number(r.activeUsers || 0),
    engagementSeconds: Number(r.userEngagementDuration || 0),
    sessions: Number(r.sessions || 0),
  }));
}

/**
 * Phase 12.5 connection-backed GA4 query. This keeps the legacy environment
 * variable path working while allowing each workspace/environment to supply
 * its own verified GA4 credentials through the Connections Hub.
 */
export async function getPagesForPeriodWithCredentials(
  credentials: { propertyId: string; clientEmail: string; privateKey: string },
  startDate: string,
  endDate: string,
  limit = 10000,
) {
  const scopedClient = new BetaAnalyticsDataClient({
    credentials: {
      client_email: credentials.clientEmail,
      private_key: normalizePrivateKey(credentials.privateKey),
    },
  });
  const [response] = await scopedClient.runReport({
    property: `properties/${credentials.propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "userEngagementDuration" }, { name: "sessions" }],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit,
  });
  return rowsToObjects(response).map((r) => ({ path: r.pagePath || "", title: r.pageTitle || "", pageViews: Number(r.screenPageViews || 0), users: Number(r.activeUsers || 0), engagementSeconds: Number(r.userEngagementDuration || 0), sessions: Number(r.sessions || 0) }));
}
