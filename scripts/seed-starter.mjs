#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map((value) => {
    const [key, ...rest] = value.slice(2).split("=");
    return [key, rest.join("=")];
  }));
}

async function apiRequest(baseUrl, path, token, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || body?.message || `${response.status} ${response.statusText}`);
  return body?.data;
}

loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
if (Object.prototype.hasOwnProperty.call(args, "help")) {
  console.log("Usage: npm run seed:starter -- [--url=http://localhost:3000] [--email=owner@example.com] [--password=owner-password]");
  console.log("The command is idempotent and creates a starter Article model and draft welcome entry through the authenticated CMS API.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
const appUrl = String(args.url || process.env.POLYNOVEA_CMS_URL || "http://localhost:3000").replace(/\/$/, "");
const email = String(args.email || process.env.POLYNOVEA_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(args.password || process.env.POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD || "");
if (!supabaseUrl || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
if (!email || password.length < 8) throw new Error("Supply the bootstrap owner email and password through arguments or POLYNOVEA_BOOTSTRAP_ADMIN_* variables.");

const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: login, error: loginError } = await auth.auth.signInWithPassword({ email, password });
if (loginError || !login.session) throw loginError || new Error("Owner sign-in did not return a session.");
const token = login.session.access_token;

const models = await apiRequest(appUrl, "/api/models", token);
let model = (models || []).find((candidate) => candidate.api_key === "starter_article");
let modelCreated = false;
if (!model) {
  const created = await apiRequest(appUrl, "/api/models", token, {
    method: "POST",
    body: JSON.stringify({
      description: "Starter publishable article model created by the OSS onboarding command.",
      icon: "FileText",
      schema: {
        apiKey: "starter_article",
        name: "Starter Article",
        capability: "publishable",
        fields: [
          { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false, index: true },
          { key: "slug", label: "Slug", type: "slug", required: true, localized: false, unique: true, generatedFrom: "title" },
          { key: "summary", label: "Summary", type: "long_text", required: false, localized: false, unique: false },
          { key: "body", label: "Body", type: "rich_text", required: false, localized: false, unique: false },
        ],
      },
    }),
  });
  model = created?.model || created;
  modelCreated = true;
}

if (!model?.id) throw new Error("Starter model creation did not return a model identifier.");

const entries = await apiRequest(appUrl, `/api/entries?modelId=${encodeURIComponent(model.id)}`, token);
let entry = (entries || []).find((candidate) => candidate.data?.slug === "welcome-to-polynovea");
let entryCreated = false;
if (!entry) {
  const created = await apiRequest(appUrl, "/api/entries", token, {
    method: "POST",
    body: JSON.stringify({
      modelId: model.id,
      data: {
        title: "Welcome to Polynovea",
        slug: "welcome-to-polynovea",
        summary: "Your first structured entry is ready to edit, review and publish.",
        body: {
          type: "document",
          version: 1,
          content: [
            { type: "heading", level: 2, text: "Your CMS is ready" },
            { type: "paragraph", text: "Use this entry to explore the editorial workflow, preview, releases and the scoped delivery API." },
          ],
        },
      },
      changeSummary: "Created by the OSS starter-content command",
    }),
  });
  entry = created?.entry || created;
  entryCreated = true;
}

if (!entry?.id) throw new Error("Starter entry creation did not return an entry identifier.");

console.log(JSON.stringify({
  model: { id: model.id, apiKey: "starter_article", created: modelCreated },
  entry: { id: entry.id, slug: "welcome-to-polynovea", created: entryCreated, status: entry.status },
  next: `${appUrl}/admin/entries/${entry.id}`,
}, null, 2));
