/**
 * Real Certification Test Harness.
 *
 * Provides:
 * - Real Supabase Auth user creation & JWT token acquisition
 * - Real Workspace scoping (x-workspace-id header & DB isolation)
 * - Real Cleanup with 0 leakage guarantees (deletes auth users, admin_users, and workspace)
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

// Load environment variables from .env.local
for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
  const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  throw new Error("Missing Supabase configuration in .env.local");
}

export const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
export const anonClient = createClient(SUPABASE_URL, ANON_KEY);

export async function createPgClient() {
  const connectionString =
    process.env.Database_URL ||
    process.env.DATABASE_URL ||
    process.env.database_url;
  if (!connectionString) throw new Error("Missing database connection string");
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

export async function createDisposableWorkspace(client, prefix = "cert") {
  const slug = `${prefix}-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const { rows } = await client.query(`
    insert into workspaces (name, slug)
    values ($1, $2)
    returning id, name, slug
  `, [`Disposable Workspace ${slug}`, slug]);
  return rows[0];
}

export async function createAuthenticatedActor(client, workspaceId, {
  role = "editor",
  permissions = [],
  emailPrefix = "cert-actor",
} = {}) {
  const email = `${emailPrefix}-${Date.now()}-${randomUUID().slice(0, 6)}@polynovea.local`;
  const password = `P@ss-${Date.now()}-${randomUUID().slice(0, 8)}!`;

  // 1. Create real Supabase Auth user
  const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !createData.user) {
    throw new Error(`Failed to create auth user: ${createError?.message}`);
  }
  const authUserId = createData.user.id;

  // 2. Sign in via anon client to get real JWT access token
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.session) {
    await adminClient.auth.admin.deleteUser(authUserId);
    throw new Error(`Failed to sign in auth user: ${signInError?.message}`);
  }
  const token = signInData.session.access_token;

  // 3. Insert matching admin_users record (role must be in master, admin, editor, viewer)
  const validAdminRoles = ["master", "admin", "editor", "viewer"];
  const dbAdminRole = validAdminRoles.includes(role) ? role : "editor";
  const { rows: adminRows } = await client.query(`
    insert into admin_users (auth_user_id, username, email, display_name, role, is_active, surface_access, module_access, module_write_access)
    values ($1, $2, $3, $4, $5, true, array['cms'], array['*'], array['*'])
    returning id, email
  `, [authUserId, email, email, `Cert User ${email}`, dbAdminRole]);
  const adminUserId = adminRows[0].id;

  // 4. Add to workspace_members
  const { rows: memberRows } = await client.query(`
    insert into workspace_members (workspace_id, admin_user_id, status)
    values ($1, $2, 'active')
    returning id
  `, [workspaceId, adminUserId]);
  const memberId = memberRows[0].id;

  // 5. If specific permissions requested, create role and assign
  if (permissions.length > 0) {
    const roleKey = `role_${Date.now().toString().slice(-6)}_${randomUUID().slice(0, 4)}`;
    const { rows: roleRows } = await client.query(`
      insert into roles (workspace_id, key, name, is_system)
      values ($1, $2, 'Cert Custom Role', false)
      returning id
    `, [workspaceId, roleKey]);
    const roleId = roleRows[0].id;

    for (const perm of permissions) {
      await client.query(`
        insert into role_permissions (role_id, permission_key)
        values ($1, $2)
        on conflict do nothing
      `, [roleId, perm]);
    }

    await client.query(`
      insert into member_roles (workspace_member_id, role_id)
      values ($1, $2)
      on conflict do nothing
    `, [memberId, roleId]);
  }

  return {
    authUserId,
    adminUserId,
    email,
    token,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-workspace-id": workspaceId,
      "Content-Type": "application/json",
    },
  };
}

export async function teardownCertification({
  client,
  workspaceId,
  authUserIds = [],
  adminUserIds = [],
}) {
  const leaks = [];

  // 1. Release bundles and publication targets hold restrictive references.
  // Clear workspace-owned releases and targets first so those references cannot
  // block deletion of the disposable workspace.
  if (workspaceId) {
    try {
      await client.query(
        "delete from publication_jobs where target_id in (select id from publication_targets where workspace_id = $1) or workspace_id = $1",
        [workspaceId]
      );
      await client.query("delete from delivery_jobs where workspace_id = $1", [workspaceId]);
      await client.query("delete from website_connection_bindings where workspace_id = $1", [workspaceId]);
      await client.query("delete from publication_targets where workspace_id = $1", [workspaceId]);
      await client.query("delete from analytics_connectors where workspace_id = $1", [workspaceId]);
      await client.query("delete from workspace_connections where workspace_id = $1", [workspaceId]);
      await client.query("delete from releases where workspace_id = $1", [workspaceId]);
    } catch (err) {
      leaks.push({ type: "workspace_governance_references", id: workspaceId, error: err.message });
    }
  }

  // 2. Delete workspace (remaining workspace-owned data cascades normally).
  if (workspaceId) {
    try {
      await client.query("delete from workspaces where id = $1", [workspaceId]);
    } catch (err) {
      leaks.push({ type: "workspace", id: workspaceId, error: err.message });
    }
  }

  // 3. Delete admin_users records (now safe since foreign keys on workspace content are gone)
  for (const aid of adminUserIds) {
    try {
      await client.query("delete from admin_users where id = $1", [aid]);
    } catch (err) {
      leaks.push({ type: "admin_user", id: aid, error: err.message });
    }
  }

  // 4. Delete Supabase Auth users
  for (const uid of authUserIds) {
    try {
      await adminClient.auth.admin.deleteUser(uid);
    } catch (err) {
      leaks.push({ type: "auth_user", id: uid, error: err.message });
    }
  }

  if (leaks.length > 0) {
    console.error("\n[FATAL TEARDOWN LEAKAGE DETECTED]:", JSON.stringify(leaks, null, 2));
    throw new Error(`Certification teardown failed! ${leaks.length} fixtures leaked.`);
  }

  console.log("[TEARDOWN] All disposable auth users, admin users, and workspace destroyed. 0 fixtures leaked.");
}
