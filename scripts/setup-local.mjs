#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map((value) => {
    const [key, ...rest] = value.slice(2).split("=");
    return [key, rest.join("=")];
  }));
}

function parseEnv(content) {
  const values = {};
  for (const raw of content.split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return values;
}

async function runRuntime(command, directory) {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/local-runtime.mjs", command, `--directory=${directory}`], {
    cwd: process.cwd(),
    env: { ...process.env, POLYNOVEA_LOCAL_RUNTIME_CONTROL: "1" },
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`${label} did not become ready within ${Math.round(timeoutMs / 1000)} seconds`);
}

async function request(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.msg || body?.message || body?.error || `${response.status} ${response.statusText}`);
  return body;
}

const args = parseArgs(process.argv.slice(2));
if (args.help !== undefined) {
  console.log("Usage: npm run local:setup -- --email=owner@example.com --password=change-me-now [--directory=/path] [--no-demo]");
  process.exit(0);
}

const email = String(args.email || "").trim().toLowerCase();
const password = String(args.password || process.env.POLYNOVEA_LOCAL_OWNER_PASSWORD || "");
const directory = path.resolve(args.directory || path.join(process.cwd(), ".polynovea-local"));
const includeDemo = args["no-demo"] === undefined;
if (!email.includes("@")) throw new Error("--email is required");
if (password.length < 8) throw new Error("--password must contain at least 8 characters");

const initialized = await runRuntime("init", directory);
await runRuntime("start", directory);
const env = parseEnv(await readFile(initialized.envFile, "utf8"));
const supabaseUrl = `http://localhost:${env.POLYNOVEA_SUPABASE_PORT}`;
const appUrl = `http://localhost:${env.POLYNOVEA_APP_PORT}`;
await waitFor(`${supabaseUrl}/auth/v1/health`, "Authentication service");
await waitFor(appUrl, "CMS application");

try {
  await request(`${supabaseUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
} catch (error) {
  if (!String(error).toLowerCase().includes("already")) throw error;
}

const composeArgs = ["compose", "--env-file", initialized.envFile, "-f", path.resolve("deploy/local/docker-compose.yml"), "exec", "-T", "cms", "npm", "run", "bootstrap:admin", "--", `--email=${email}`];
await execFileAsync("docker", composeArgs, { cwd: process.cwd(), windowsHide: true, maxBuffer: 10 * 1024 * 1024 });

if (includeDemo) {
  const session = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: env.ANON_KEY, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const headers = { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" };
  const models = await request(`${appUrl}/api/models`, { headers });
  if (!(models.data || []).some((model) => model.api_key === "demo_article")) {
    await request(`${appUrl}/api/models`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        description: "Starter publishable model created by local setup.",
        icon: "FileText",
        schema: {
          apiKey: "demo_article",
          name: "Demo Article",
          capability: "publishable",
          fields: [
            { key: "title", label: "Title", type: "text", required: true, localized: false, unique: false, index: true },
            { key: "slug", label: "Slug", type: "slug", required: true, localized: false, unique: true, generatedFrom: "title" },
            { key: "summary", label: "Summary", type: "long_text", required: false, localized: false, unique: false },
          ],
        },
      }),
    });
  }
  const entries = await request(`${appUrl}/api/entries?model=demo_article&limit=100`, { headers });
  if (!(entries.data || []).some((entry) => entry.data_json?.slug === "welcome-to-polynovea")) {
    await request(`${appUrl}/api/entries`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "demo_article",
        data: {
          title: "Welcome to Polynovea",
          slug: "welcome-to-polynovea",
          summary: "This starter entry proves that your local content model and record engine are ready.",
        },
        changeSummary: "Created by local setup",
      }),
    });
  }
}

console.log(`Polynovea CMS is ready at ${appUrl}`);
console.log(`Sign in with ${email}. Runtime data: ${directory}`);
