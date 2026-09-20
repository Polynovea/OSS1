#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function loadLocalEnv() {
  if (!existsSync(".env.local")) return;
  for (const raw of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function parseArgs(argv) {
  const args = {};
  for (const value of argv) {
    if (!value.startsWith("--")) continue;
    const [key, ...rest] = value.slice(2).split("=");
    args[key] = rest.join("=");
  }
  return args;
}

function defaultUsername(email) {
  const local = email.split("@")[0] || "owner";
  const normalized = local.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return (normalized || "owner").slice(0, 40);
}

async function findAuthUserByEmail(client, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) break;
  }
  return null;
}

loadLocalEnv();
const args = parseArgs(process.argv.slice(2));
if (Object.prototype.hasOwnProperty.call(args, "help")) {
  console.log('Usage: npm run bootstrap:admin -- --email=owner@example.com [--username=owner] [--display-name="Owner"] [--workspace=polynovea]');
  console.log("Create the auth identity first; this command binds it to the auditable CMS master/owner profile.");
  process.exit(0);
}
const email = String(args.email || process.env.POLYNOVEA_BOOTSTRAP_ADMIN_EMAIL || "").trim().toLowerCase();
const username = String(args.username || process.env.POLYNOVEA_BOOTSTRAP_ADMIN_USERNAME || defaultUsername(email)).trim().toLowerCase();
const displayName = String(args["display-name"] || process.env.POLYNOVEA_BOOTSTRAP_ADMIN_DISPLAY_NAME || username).trim();
const workspaceSlug = String(args.workspace || process.env.POLYNOVEA_DEFAULT_WORKSPACE_SLUG || "polynovea").trim().toLowerCase();

if (!email || !email.includes("@")) {
  console.error("Usage: npm run bootstrap:admin -- --email=owner@example.com [--username=owner] [--display-name=\"Owner\"]");
  process.exit(2);
}
if (!/^[a-z0-9._-]{3,40}$/i.test(username)) {
  console.error("Bootstrap username must be 3-40 characters using letters, numbers, dot, underscore, or hyphen.");
  process.exit(2);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!supabaseUrl || !serviceRoleKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required. Put them in .env.local or the process environment.");
  process.exit(2);
}

const client = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

try {
  const authUser = await findAuthUserByEmail(client, email);
  if (!authUser) {
    throw new Error(`No Supabase Auth user exists for ${email}. Create that identity in the configured auth service first, then rerun bootstrap:admin.`);
  }

  const { data: existing, error: existingError } = await client
    .from("admin_users")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (existingError) throw existingError;

  let adminUser;
  if (existing) {
    const { data, error } = await client
      .from("admin_users")
      .update({
        auth_user_id: authUser.id,
        username,
        display_name: displayName,
        role: "master",
        is_active: true,
        surface_access: ["cms", "content"],
        module_access: ["*"],
        module_write_access: ["*"],
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    adminUser = data;
  } else {
    const { data, error } = await client
      .from("admin_users")
      .insert({
        auth_user_id: authUser.id,
        username,
        email,
        display_name: displayName,
        role: "master",
        is_active: true,
        surface_access: ["cms", "content"],
        module_access: ["*"],
        module_write_access: ["*"],
        created_by: "bootstrap:admin",
      })
      .select("*")
      .single();
    if (error) throw error;
    adminUser = data;
  }

  const { data: workspace, error: workspaceError } = await client
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .single();
  if (workspaceError || !workspace) {
    throw workspaceError || new Error(`Workspace '${workspaceSlug}' does not exist. Apply migrations before bootstrapping the first admin.`);
  }

  const { data: member, error: memberError } = await client
    .from("workspace_members")
    .upsert(
      { workspace_id: workspace.id, admin_user_id: adminUser.id, status: "active", updated_at: new Date().toISOString() },
      { onConflict: "workspace_id,admin_user_id" },
    )
    .select("id")
    .single();
  if (memberError || !member) throw memberError || new Error("Failed to create workspace membership.");

  const { data: ownerRole, error: roleError } = await client
    .from("roles")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("key", "owner")
    .single();
  if (roleError || !ownerRole) throw roleError || new Error("Default owner role is missing. Apply workspace migrations first.");

  const { data: systemRoles, error: systemRoleError } = await client
    .from("roles")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("is_system", true);
  if (systemRoleError) throw systemRoleError;

  const systemRoleIds = (systemRoles || []).map((role) => role.id);
  if (systemRoleIds.length) {
    const { error } = await client
      .from("member_roles")
      .delete()
      .eq("workspace_member_id", member.id)
      .in("role_id", systemRoleIds);
    if (error) throw error;
  }

  const { error: memberRoleError } = await client
    .from("member_roles")
    .upsert({ workspace_member_id: member.id, role_id: ownerRole.id }, { onConflict: "workspace_member_id,role_id" });
  if (memberRoleError) throw memberRoleError;

  console.log(`Bootstrap complete: ${email} is the active master/owner for workspace '${workspaceSlug}'.`);
} catch (error) {
  console.error(`Bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
