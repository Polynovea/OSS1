/**
 * REAL HTTP API & Application-Path Certification for Phase 2: Visual Database Studio.
 *
 * Exercises the actual Next.js API Route Handlers via real HTTP traffic:
 * - POST http://localhost:3000/api/models (Unauthenticated -> HTTP 401)
 * - POST http://localhost:3000/api/models (Unauthorized missing schema.manage -> HTTP 403)
 * - POST http://localhost:3000/api/models (Customer data_only model creation -> HTTP 201)
 * - POST http://localhost:3000/api/models (Project content_enabled model with relation -> HTTP 201)
 * - GET  http://localhost:3000/api/models/:id (Model & field projection inspection -> HTTP 200)
 * - POST http://localhost:3000/api/models/:id/diff (Schema diff calculation -> HTTP 200)
 * - POST http://localhost:3000/api/models/:id/apply-change (Safe schema change apply -> HTTP 200)
 * - Guaranteed teardown of disposable workspace, auth users, and admin_users.
 */
import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from "./cert-harness.mjs";

const client = await createPgClient();
let workspaceId = null;
const authUserIds = [];
const adminUserIds = [];

const BASE_URL = process.env.CMS_CERT_BASE_URL || "http://localhost:3000";

try {
  console.log("=== PHASE 2: REAL APPLICATION HTTP API CERTIFICATION ===");

  // 1. Create isolated disposable workspace
  const ws = await createDisposableWorkspace(client, "p2-studio");
  workspaceId = ws.id;
  console.log(`[SETUP] Isolated disposable workspace: ${workspaceId} (${ws.slug})`);

  // 2. Create unprivileged actor (no schema permissions)
  const unauthActor = await createAuthenticatedActor(client, workspaceId, {
    role: "viewer",
    permissions: [],
    emailPrefix: "p2-unauth",
  });
  authUserIds.push(unauthActor.authUserId);
  adminUserIds.push(unauthActor.adminUserId);

  // 3. Create authorized schema manager actor
  const managerActor = await createAuthenticatedActor(client, workspaceId, {
    role: "admin",
    permissions: ["schema.read", "schema.manage"],
    emailPrefix: "p2-manager",
  });
  authUserIds.push(managerActor.authUserId);
  adminUserIds.push(managerActor.adminUserId);

  // ── A. Permission & Security Boundary Tests ──────────────────────────────
  console.log("\n--- A. HTTP Authorization Enforcement ---");

  // A1. Unauthenticated Request -> HTTP 401
  const noAuthRes = await fetch(`${BASE_URL}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description: "Hacker attempt" }),
  });
  console.log(`[HTTP] POST /api/models (No Token) -> Status: ${noAuthRes.status} (Expected: 401)`);
  if (noAuthRes.status !== 401) {
    throw new Error(`Security violation: Expected HTTP 401 without token, got ${noAuthRes.status}`);
  }

  // A2. Unauthorized Actor -> HTTP 403
  const forbiddenRes = await fetch(`${BASE_URL}/api/models`, {
    method: "POST",
    headers: unauthActor.headers,
    body: JSON.stringify({
      schema: {
        name: "Test",
        apiKey: "test",
        capability: "data_only",
        fields: [{ key: "f1", label: "F1", type: "text", required: true, localized: false, unique: false }],
      },
    }),
  });
  console.log(`[HTTP] POST /api/models (Missing schema.manage) -> Status: ${forbiddenRes.status} (Expected: 403)`);
  if (forbiddenRes.status !== 403) {
    throw new Error(`Security violation: Expected HTTP 403 for unauthorized actor, got ${forbiddenRes.status}`);
  }

  // ── B. Model Creation via HTTP API ───────────────────────────────────────
  console.log("\n--- B. Model Creation via HTTP API ---");

  // B1. Create Customer data_only model
  const customerApiKey = `customer_${Date.now().toString().slice(-4)}`;
  const customerSchema = {
    name: "Customer",
    apiKey: customerApiKey,
    description: "Customer data model",
    capability: "data_only",
    fields: [
      { key: "name", label: "Customer Name", type: "text", required: true, localized: false, unique: false },
      { key: "email", label: "Email", type: "email", required: true, localized: false, unique: true },
      { key: "tax_id", label: "Tax Identifier", type: "text", required: false, localized: false, unique: true },
    ],
  };

  const createCustomerRes = await fetch(`${BASE_URL}/api/models`, {
    method: "POST",
    headers: managerActor.headers,
    body: JSON.stringify({
      description: "Customer data model",
      schema: customerSchema,
    }),
  });
  const customerJson = await createCustomerRes.json();
  console.log(`[HTTP] POST /api/models (Customer) -> Status: ${createCustomerRes.status} (Expected: 201)`);
  if (createCustomerRes.status !== 201 || !customerJson.success) {
    throw new Error(`Failed to create Customer model via HTTP: ${JSON.stringify(customerJson)}`);
  }
  const customerModel = customerJson.data.model;
  console.log(`Customer Model Created via HTTP: ID ${customerModel.id}, Version 1`);

  // B2. Create Project content_enabled model with relationship to Customer
  const projectApiKey = `project_${Date.now().toString().slice(-4)}`;
  const projectSchema = {
    name: "Project",
    apiKey: projectApiKey,
    description: "Project model with relationship",
    capability: "content_enabled",
    fields: [
      { key: "title", label: "Project Title", type: "text", required: true, localized: false, unique: false },
      { key: "slug", label: "Project Slug", type: "slug", required: true, localized: false, unique: true },
      {
        key: "customer",
        label: "Assigned Customer",
        type: "relation",
        required: true,
        localized: false,
        unique: false,
        relation: {
          targetModelApiKey: customerApiKey,
          cardinality: "many_to_one",
          onDelete: "block",
        },
      },
    ],
  };

  const createProjectRes = await fetch(`${BASE_URL}/api/models`, {
    method: "POST",
    headers: managerActor.headers,
    body: JSON.stringify({
      description: "Project model with relationship",
      schema: projectSchema,
    }),
  });
  const projectJson = await createProjectRes.json();
  console.log(`[HTTP] POST /api/models (Project) -> Status: ${createProjectRes.status} (Expected: 201)`);
  if (createProjectRes.status !== 201 || !projectJson.success) {
    throw new Error(`Failed to create Project model via HTTP: ${JSON.stringify(projectJson)}`);
  }
  const projectModel = projectJson.data.model;
  console.log(`Project Model Created via HTTP: ID ${projectModel.id}, Version 1`);

  // ── C. Model Retrieval & Field Projection Inspection ─────────────────────
  console.log("\n--- C. Model Inspection & Field Projections ---");

  const getModelRes = await fetch(`${BASE_URL}/api/models/${projectModel.id}`, {
    method: "GET",
    headers: managerActor.headers,
  });
  const getModelJson = await getModelRes.json();
  console.log(`[HTTP] GET /api/models/${projectModel.id} -> Status: ${getModelRes.status} (Expected: 200)`);
  if (getModelRes.status !== 200 || !getModelJson.success) {
    throw new Error(`Failed to inspect model: ${JSON.stringify(getModelJson)}`);
  }
  const inspected = getModelJson.data;
  console.log(`Model Verified: ${inspected.name}, current_schema_version: ${inspected.current_schema_version}`);

  // ── D. Schema Diff & Safe Version Migration ──────────────────────────────
  console.log("\n--- D. Schema Diff Calculation & Safe Version Migration ---");

  const updatedProjectSchema = {
    ...projectSchema,
    fields: [
      ...projectSchema.fields,
      { key: "budget", label: "Budget", type: "number", required: false, localized: false, unique: false, defaultValue: 0 },
    ],
  };

  // Validation & Diff calculation ahead of apply
  const validateRes = await fetch(`${BASE_URL}/api/models/${projectModel.id}/validate-change`, {
    method: "POST",
    headers: managerActor.headers,
    body: JSON.stringify({
      schema: updatedProjectSchema,
    }),
  });
  const validateJson = await validateRes.json();
  console.log(`[HTTP] POST /api/models/:id/validate-change -> Status: ${validateRes.status} (Expected: 200)`);
  if (validateRes.status !== 200 || !validateJson.success) {
    throw new Error(`Failed to validate change: ${JSON.stringify(validateJson)}`);
  }
  console.log(`Schema Diff Classification: ${validateJson.data.diff.overallClassification} (Expected: SAFE)`);
  if (validateJson.data.diff.overallClassification !== "SAFE") {
    throw new Error(`Expected SAFE diff, got: ${validateJson.data.diff.overallClassification}`);
  }

  // Apply safe change
  const applyRes = await fetch(`${BASE_URL}/api/models/${projectModel.id}/apply-change`, {
    method: "POST",
    headers: managerActor.headers,
    body: JSON.stringify({
      schema: updatedProjectSchema,
      changeSummary: "Added optional budget field",
      acknowledgeUnsafe: false,
    }),
  });
  const applyJson = await applyRes.json();
  console.log(`[HTTP] POST /api/models/:id/apply-change -> Status: ${applyRes.status} (Expected: 201)`);
  if ((applyRes.status !== 200 && applyRes.status !== 201) || !applyJson.success) {
    throw new Error(`Failed to apply schema change: ${JSON.stringify(applyJson)}`);
  }
  console.log(`Safe Schema Migration Applied via HTTP: New Version ${applyJson.data.version.version_number}`);
  if (applyJson.data.version.version_number !== 2) {
    throw new Error(`Expected version 2, got: ${applyJson.data.version.version_number}`);
  }

  // Verify historical diff between persisted versions 1 and 2
  const diffRes = await fetch(`${BASE_URL}/api/models/${projectModel.id}/diff?from=1&to=2`, {
    method: "GET",
    headers: managerActor.headers,
  });
  const diffJson = await diffRes.json();
  console.log(`[HTTP] GET /api/models/:id/diff?from=1&to=2 -> Status: ${diffRes.status} (Expected: 200)`);
  if (diffRes.status !== 200 || !diffJson.success) {
    throw new Error(`Failed to GET diff: ${JSON.stringify(diffJson)}`);
  }
  console.log(`Persisted Version Diff Confirmed: ${diffJson.data.overallClassification}`);

  console.log("\n==================================================");
  console.log("PHASE 2 HTTP API APPLICATION CERTIFICATION: ALL PASSED");
  console.log("==================================================");
} catch (err) {
  console.error("\n[FATAL CERTIFICATION FAILURE]:", err);
  process.exitCode = 1;
} finally {
  console.log("\n[CLEANUP] Executing guaranteed teardown...");
  await teardownCertification({
    client,
    workspaceId,
    authUserIds,
    adminUserIds,
  });
  await client.end();
}
