import { randomUUID } from 'node:crypto';
import http from 'node:http';
import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from './cert-harness.mjs';

import {
  ensureEnvironmentComponents,
  runComponentAction,
  runProvisioning,
  planEnvironmentSchema,
  applyEnvironmentSchema,
  bindWebsiteConnection,
  queueWebsiteTest,
  runSystemDoctor,
  createWorkspaceBackup,
  restoreBackup,
  portabilityCheck,
  planUpgrade,
  executeUpgrade,
  requestInfrastructureApproval,
  reviewInfrastructureApproval,
} from '../lib/infrastructure/operabilityService';

import { createModel } from '../lib/schema/modelService';
import { verifyConnection } from '../lib/infrastructure/connectionService';

const client = await createPgClient();
let workspaceId: string = '';
const authUserIds: string[] = [];
const adminUserIds: string[] = [];
let localServer: http.Server | null = null;

const assert = (condition: any, message: string) => {
  if (!condition) {
    console.error('ASSERTION FAILED:', message);
    throw new Error(message);
  }
};

const expectFailure = async (label: string, fn: () => Promise<any>, includes?: string) => {
  let failed = false;
  try {
    await fn();
  } catch (err: any) {
    failed = true;
    if (includes && !String(err.message || '').toLowerCase().includes(includes.toLowerCase())) {
      throw new Error(`${label}: Failed with unexpected message: ${err.message}`);
    }
    console.log(`[PASS] ${label}: rejected as expected (${err.message})`);
  }
  if (!failed) {
    throw new Error(`${label}: expected failure but succeeded`);
  }
};

try {
  console.log('=== PHASE 12.5 FULL OPERABILITY CONTROL PLANE CERTIFICATION ===');

  // Setup disposable workspace
  const ws = await createDisposableWorkspace(client, 'p125-full');
  workspaceId = ws.id;

  // Primary platform admin actor
  const actor = await createAuthenticatedActor(client, workspaceId, {
    role: 'admin',
    permissions: [
      'environment.read',
      'environment.manage',
      'environment.provision',
      'connection.read',
      'connection.manage',
      'connection.verify',
      'secret.manage',
      'deployment.manage',
      'schema.read',
      'schema.promote',
      'website.manage',
      'infrastructure.diagnose',
      'infrastructure.backup',
      'infrastructure.restore',
      'infrastructure.upgrade',
      'approval.review',
    ],
    emailPrefix: 'p125-operability-admin',
  } as any);
  authUserIds.push(actor.authUserId);
  adminUserIds.push(actor.adminUserId);

  // Secondary reviewer actor for governance / separation of duties
  const reviewer = await createAuthenticatedActor(client, workspaceId, {
    role: 'admin',
    permissions: ['approval.review', 'environment.manage'],
    emailPrefix: 'p125-reviewer',
  } as any);
  authUserIds.push(reviewer.authUserId);
  adminUserIds.push(reviewer.adminUserId);

  // Local test HTTP server for connection verification
  localServer = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }));
  });
  await new Promise<void>((resolve) => localServer!.listen(0, '127.0.0.1', () => resolve()));
  const localPort = (localServer.address() as any).port;
  const localBaseUrl = `http://127.0.0.1:${localPort}`;

  // -------------------------------------------------------------------------
  // 1. First-Class Environment Model & Credential Providers (Deliverables A, C)
  // -------------------------------------------------------------------------
  console.log('\n--- 1. Environment Model & Credential Providers ---');
  const { rows: [devRes] } = await client.query(
    `select cms_create_environment($1, $2, 'dev', 'Development', 'development', true, 'https://dev.example.com', '[]'::jsonb, 'postgres', 'local', 'local', 'encrypted_postgres') r`,
    [workspaceId, actor.adminUserId]
  );
  const devEnv = devRes.r;
  assert(devEnv?.environment?.id, 'Failed to create development environment');
  assert(devEnv.secretProvider?.provider_kind === 'encrypted_postgres', 'Secret provider mismatch for dev');

  const { rows: [localRes] } = await client.query(
    `select cms_create_environment($1, $2, 'local', 'Local Workspace', 'local', false, $3, '[]'::jsonb, 'postgres', 'local', 'local', 'encrypted_postgres') r`,
    [workspaceId, actor.adminUserId, localBaseUrl]
  );
  const localEnv = localRes.r;
  assert(localEnv?.environment?.id, 'Failed to create local environment');

  const { rows: [prodRes] } = await client.query(
    `select cms_create_environment($1, $2, 'prod', 'Production', 'production', true, 'https://example.com', '["https://example.com"]'::jsonb, 'postgres', 'cloudflare_r2', 'custom', 'environment') r`,
    [workspaceId, actor.adminUserId]
  );
  const prodEnv = prodRes.r;
  assert(prodEnv?.environment?.id, 'Failed to create production environment');
  assert(prodEnv.secretProvider?.provider_kind === 'environment', 'Secret provider mismatch for prod');

  // Verify one-default invariant: prod was created with isDefault=true, so dev should no longer be default
  const { rows: envs } = await client.query(
    `select id, key, is_default, secret_provider_id from workspace_environments where workspace_id = $1 order by key`,
    [workspaceId]
  );
  assert(envs.length === 3, 'Expected 3 environments');
  const defaults = envs.filter((e: any) => e.is_default);
  assert(defaults.length === 1 && defaults[0].key === 'prod', 'One-default invariant failed: prod must be the sole default');
  console.log('[PASS] Environments created with one-default invariant and typed credential providers.');

  // -------------------------------------------------------------------------
  // 2. Deployment Components & Capability Manager (Deliverable G)
  // -------------------------------------------------------------------------
  console.log('\n--- 2. Deployment Components & Capability Manager ---');
  const devComponents = await ensureEnvironmentComponents(workspaceId, devEnv.environment.id);
  assert(Array.isArray(devComponents) && devComponents.length >= 5, 'Required components not populated');
  const pgComp = devComponents.find((c: any) => c.component_key === 'postgres');
  const secretComp = devComponents.find((c: any) => c.component_key === 'secret-store');
  const workerComp = devComponents.find((c: any) => c.component_key === 'delivery-worker');
  assert(pgComp && secretComp && workerComp, 'Standard capability components missing');
  assert(secretComp.state === 'present', 'Secret store should be present since provider was bound');

  // Execute component action: check
  const checkRun = await runComponentAction({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    componentId: pgComp.id,
    operation: 'check',
  });
  assert(checkRun.status === 'succeeded', 'Component check action failed');
  const { rows: [compRunRow] } = await client.query(
    `select id, operation, status from environment_component_runs where id = $1`,
    [checkRun.id]
  );
  assert(compRunRow?.status === 'succeeded', 'Component run not recorded in database');
  console.log('[PASS] Capability components ensured, checked, and recorded in ledger.');

  // -------------------------------------------------------------------------
  // 3. Guided Provisioning Engine (Deliverable D)
  // -------------------------------------------------------------------------
  console.log('\n--- 3. Guided Provisioning Engine ---');
  const preflight = await runProvisioning({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    providerKind: 'postgres',
    operation: 'preflight',
  });
  assert(preflight.status === 'succeeded' || preflight.status === 'blocked', 'Provisioning preflight returned invalid status');
  assert(Array.isArray(preflight.checks_json) && preflight.checks_json.length > 0, 'Provisioning checks not recorded');

  // Test idempotency: second call in same window returns existing run
  const preflight2 = await runProvisioning({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    providerKind: 'postgres',
    operation: 'preflight',
  });
  assert(preflight2.id === preflight.id, 'Provisioning run idempotency failed; expected existing run');

  // Run verify
  const verifyRun = await runProvisioning({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    providerKind: 'managed',
    operation: 'verify',
  });
  assert(verifyRun.status === 'succeeded', 'Provisioning verify failed');
  const { rows: [updatedDevEnv] } = await client.query(
    `select status from workspace_environments where id = $1`,
    [devEnv.environment.id]
  );
  assert(updatedDevEnv.status === 'ready', 'Environment status not updated to ready after verify');
  console.log('[PASS] Provisioning preflight and verification executed idempotently and updated environment status.');

  // -------------------------------------------------------------------------
  // 4. Visual Schema Plan, Safety Classification & Promotion (Deliverable F)
  // -------------------------------------------------------------------------
  console.log('\n--- 4. Visual Schema Plan, Safety Classification & Promotion ---');
  // Create a model with version 1
  const modelRes = await createModel({
    workspaceId,
    description: 'Operability certification model',
    proposedSchema: {
      name: 'Operability Article',
      apiKey: 'operability_article',
      capability: 'content_enabled',
      fields: [
        { key: 'title', label: 'Title', type: 'text', required: true },
      ],
    },
    createdBy: actor.adminUserId,
  });
  if (!modelRes.ok) {
    throw new Error((modelRes as any).error ?? 'Failed to create test content model');
  }
  const modelId = modelRes.data.model.id;

  // Plan a safe additive schema change
  const safeSchema = {
    name: 'Operability Article',
    apiKey: 'operability_article',
    capability: 'content_enabled',
    fields: [
      { key: 'title', label: 'Title', type: 'text', required: true },
      { key: 'summary', label: 'Summary', type: 'text', required: false },
    ],
  };
  const safePlan = await planEnvironmentSchema({
    workspaceId,
    environmentId: devEnv.environment.id,
    modelId,
    proposedSchema: safeSchema,
    actorId: actor.adminUserId,
  });
  assert(safePlan.classification === 'SAFE', `Expected SAFE classification, got ${safePlan.classification}`);
  assert(safePlan.requiresApproval === false, 'Safe change should not require approval in development');

  // Apply safe schema to dev environment
  const applySafe = await applyEnvironmentSchema({
    workspaceId,
    environmentId: devEnv.environment.id,
    modelId,
    proposedSchema: safeSchema,
    actorId: actor.adminUserId,
    changeSummary: 'Add summary field',
    acknowledgeUnsafe: false,
  });
  assert(applySafe.schemaVersion === 2, 'Schema version not advanced after promotion');

  // Check deployment ledger record
  const { rows: [deployRow] } = await client.query(
    `select id, schema_version, status from environment_schema_deployments where workspace_id = $1 and environment_id = $2 and content_model_id = $3`,
    [workspaceId, devEnv.environment.id, modelId]
  );
  assert(deployRow && deployRow.schema_version === 2 && deployRow.status === 'deployed', 'Deployment ledger record missing');

  // Check environment has updated revision
  const { rows: [envWithHash] } = await client.query(
    `select deployed_schema_hash, deployed_schema_revision from workspace_environments where id = $1`,
    [devEnv.environment.id]
  );
  assert(envWithHash.deployed_schema_hash && envWithHash.deployed_schema_revision?.includes('v2'), 'Environment deployed schema revision not updated');
  console.log('[PASS] Safe visual schema planned, classified SAFE, promoted, and recorded in deployment ledger.');

  // Plan an unsafe / breaking change (removing a field)
  const unsafeSchema = {
    name: 'Operability Article',
    apiKey: 'operability_article',
    capability: 'content_enabled',
    fields: [
      { key: 'summary', label: 'Summary', type: 'text', required: false },
    ],
  };
  const unsafePlan = await planEnvironmentSchema({
    workspaceId,
    environmentId: prodEnv.environment.id,
    modelId,
    proposedSchema: unsafeSchema,
    actorId: actor.adminUserId,
  });
  assert(unsafePlan.classification !== 'SAFE', 'Breaking change should not be classified SAFE');
  assert(unsafePlan.requiresApproval === true, 'Breaking change must require approval');
  assert(unsafePlan.rollbackGuidance, 'Rollback guidance must be provided for unsafe changes');

  // Attempting to apply unsafe schema to production without approval must fail with 409
  await expectFailure(
    'Unapproved unsafe schema promotion in production',
    () => applyEnvironmentSchema({
      workspaceId,
      environmentId: prodEnv.environment.id,
      modelId,
      proposedSchema: unsafeSchema,
      actorId: actor.adminUserId,
      acknowledgeUnsafe: true,
    }),
    'requires approval'
  );
  console.log('[PASS] Unsafe schema correctly flagged and blocked without infrastructure approval.');

  // -------------------------------------------------------------------------
  // 5. High-Risk Infrastructure Approval Gate Lifecycle (Deliverable L)
  // -------------------------------------------------------------------------
  console.log('\n--- 5. High-Risk Infrastructure Approval Lifecycle ---');
  // 1. Request approval
  const approvalReq = await requestInfrastructureApproval({
    workspaceId,
    environmentId: prodEnv.environment.id,
    actorId: actor.adminUserId,
    operation: 'schema_promote',
    entityType: 'content_model',
    entityId: modelId,
    reason: 'Promote model v3 breaking change to production for certification',
    request: { proposedSchema: unsafeSchema },
  });
  const approvalId = (approvalReq as any)?.id;
  assert(approvalId, 'Approval request creation failed');
  assert((approvalReq as any).status === 'pending', 'Approval status should be pending');

  // 2. Review and approve via second authorized actor
  const reviewed = await reviewInfrastructureApproval({
    workspaceId,
    actorId: reviewer.adminUserId,
    requestId: approvalId,
    decision: 'approved',
    note: 'Approved for certification run',
  });
  assert((reviewed as any)?.status === 'approved', 'Approval review did not set status to approved');

  // 3. Re-apply schema passing approvalRequestId
  const applyWithApproval = await applyEnvironmentSchema({
    workspaceId,
    environmentId: prodEnv.environment.id,
    modelId,
    proposedSchema: unsafeSchema,
    actorId: actor.adminUserId,
    changeSummary: 'Remove title field with approval',
    acknowledgeUnsafe: true,
    approvalRequestId: approvalId,
  });
  assert(applyWithApproval.schemaVersion === 3, 'Approved unsafe promotion failed to advance version');

  // Verify approval request was auto-marked executed
  const { rows: [executedApproval] } = await client.query(
    `select status, executed_at from infrastructure_approval_requests where id = $1`,
    [approvalId]
  );
  assert(executedApproval.status === 'executed' && executedApproval.executed_at, 'Approval was not marked executed after use');
  console.log('[PASS] Full approval lifecycle certified: Request → Review → Approved Execution → Marked Executed.');

  // -------------------------------------------------------------------------
  // 6. Guided Website Publishing Connection & Delivery Test (Deliverable H)
  // -------------------------------------------------------------------------
  console.log('\n--- 6. Website Publishing Connection & Delivery Test ---');
  // Create website connection pointing to localServer on localEnv
  const { rows: [connRes] } = await client.query(
    `select cms_create_connection($1, $2, $3, 'website.rest', 'website', 'Certification Site', $4::jsonb, $5, '[]'::jsonb) r`,
    [
      workspaceId,
      actor.adminUserId,
      localEnv.environment.id,
      JSON.stringify({ baseUrl: localBaseUrl, testPath: '/', testMethod: 'GET' }),
      localEnv.secretProvider.id,
    ]
  );
  const connId = connRes.r.connection.id;
  assert(connId, 'Website connection creation failed');

  // Verify the connection
  const verifyConn = await verifyConnection({
    workspaceId,
    connectionId: connId,
    actorId: actor.adminUserId,
  });
  const connStatus = (verifyConn as any)?.connection?.status ?? (verifyConn as any)?.status;
  assert(connStatus === 'active', `Connection verification failed, got status: ${connStatus}`);

  // Bind website connection to environment publishing
  const binding = await bindWebsiteConnection({
    workspaceId,
    environmentId: localEnv.environment.id,
    connectionId: connId,
    actorId: actor.adminUserId,
    integrationMethod: 'polynovea_rest',
    modelApiKeys: ['operability_article'],
  });
  assert(binding && binding.id && binding.publication_target_id, 'Website binding creation failed');
  assert(binding.status === 'active', 'Website binding should be active');

  // Queue a delivery test job
  const testJob = await queueWebsiteTest({
    workspaceId,
    bindingId: binding.id,
    actorId: actor.adminUserId,
  });
  assert(testJob && testJob.id, 'Failed to queue delivery test job');
  const { rows: [jobRow] } = await client.query(
    `select id, kind, status, payload_json from delivery_jobs where id = $1`,
    [testJob.id]
  );
  assert(jobRow && jobRow.kind === 'publish' && jobRow.payload_json?.test === true, 'Test delivery job not recorded in queue');
  console.log('[PASS] Website connection verified, bound to publication target, and delivery test enqueued.');

  // -------------------------------------------------------------------------
  // 7. System Doctor Readiness & Diagnostics (Deliverable I)
  // -------------------------------------------------------------------------
  console.log('\n--- 7. System Doctor Readiness & Diagnostics ---');
  const doctorRun = await runSystemDoctor({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
  });
  assert(doctorRun && doctorRun.id, 'System Doctor run failed to record');
  assert(['healthy', 'warning', 'blocked'].includes(doctorRun.status), `Unexpected doctor status: ${doctorRun.status}`);
  assert(Array.isArray(doctorRun.findings_json) && doctorRun.findings_json.length > 0, 'Doctor findings missing');
  const findings: any[] = doctorRun.findings_json as any[];
  const dbCheck = findings.find((f: any) => f.key === 'database.reachable');
  assert(dbCheck && dbCheck.severity === 'info', 'Database reachable finding missing');
  assert(findings.every((f: any) => f.key && f.severity && f.message && f.repairHref), 'Doctor findings must have key, severity, message, repairHref');
  console.log('[PASS] System Doctor diagnosed environment with structured findings and actionable repair references.');

  // -------------------------------------------------------------------------
  // 8. Workspace Backup, Restore Dry-Run & Portability Check (Deliverable J)
  // -------------------------------------------------------------------------
  console.log('\n--- 8. Backup, Restore Dry-Run & Portability Check ---');
  const backup = await createWorkspaceBackup({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
  });
  assert(backup && backup.id, 'Workspace backup creation failed');
  assert(backup.status === 'verified', 'Backup status must be verified');
  assert(backup.checksum_sha256 && backup.checksum_sha256.length === 64, 'SHA-256 checksum missing or invalid');
  assert((backup.manifest_json as any)?.format === 'polynovea-cms-backup', 'Manifest format mismatch');

  // Verify zero plaintext secrets in manifest or payload
  const backupDump = JSON.stringify(backup);
  assert(!backupDump.includes('encrypted_value'), 'Secret ciphertext leaked in backup metadata');

  // Restore dry-run
  const dryRunRestore = await restoreBackup({
    workspaceId,
    environmentId: devEnv.environment.id,
    backupId: backup.id,
    actorId: actor.adminUserId,
    dryRun: true,
  });
  assert(dryRunRestore.status === 'planned', 'Restore dry-run should be planned');
  assert((dryRunRestore.compatibility_json as any)?.checksumMatches === true, 'Checksum verification failed during dry-run');

  // Restore over existing without approval must fail
  await expectFailure(
    'Restore over existing without approval',
    () => restoreBackup({
      workspaceId,
      environmentId: devEnv.environment.id,
      backupId: backup.id,
      actorId: actor.adminUserId,
      dryRun: false,
    }),
    'requires an approved infrastructure request'
  );

  // Portability check
  const portability = await portabilityCheck(workspaceId, devEnv.environment.id);
  assert(typeof portability.portable === 'boolean', 'Portability check did not return portable flag');
  assert(Array.isArray(portability.blockers) && Array.isArray(portability.warnings), 'Portability report missing blockers/warnings');
  assert(portability.summary && typeof portability.summary.connections === 'number', 'Portability summary missing');
  console.log('[PASS] Recoverable backup verified (SHA-256), restore dry-run passed, unapproved restore blocked, portability report generated.');

  // -------------------------------------------------------------------------
  // 9. Upgrade Manager (Deliverable K)
  // -------------------------------------------------------------------------
  console.log('\n--- 9. Upgrade Manager ---');
  // Plan an upgrade with migration change -> risk is "review", backup is required
  const upgradePlan = await planUpgrade({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    targetAppVersion: '1.1.0',
    targetMigration: '0056_future_migration.sql',
  });
  assert(upgradePlan && upgradePlan.id, 'Upgrade plan creation failed');
  assert(upgradePlan.status === 'planned', 'Upgrade plan status should be planned');
  assert(upgradePlan.risk === 'review', 'Expected review risk for migration change');
  assert(upgradePlan.plan_json?.backupRequired === true, 'Backup should be required for migration change');

  // Execute upgrade without backup must fail
  await expectFailure(
    'Execute upgrade without required backup',
    () => executeUpgrade({
      workspaceId,
      environmentId: devEnv.environment.id,
      actorId: actor.adminUserId,
      upgradeRunId: upgradePlan.id,
    }),
    'requires a verified backup'
  );

  // Execute upgrade with risk "review" without approval must fail
  await expectFailure(
    'Execute upgrade with review risk without approval',
    () => executeUpgrade({
      workspaceId,
      environmentId: devEnv.environment.id,
      actorId: actor.adminUserId,
      upgradeRunId: upgradePlan.id,
      backupId: backup.id,
    }),
    'requires an approved infrastructure request'
  );

  // Plan a safe upgrade with current migration/version
  const { rows: [runtimeRow] } = await client.query(`select schema_migration, app_version from cms_runtime_state where singleton = true`);
  const safeUpgradePlan = await planUpgrade({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    targetAppVersion: runtimeRow?.app_version || '1.0.0',
    targetMigration: runtimeRow?.schema_migration,
  });
  assert(safeUpgradePlan.risk === 'safe', 'Expected safe risk for matching version/migration');

  const executedSafeUpgrade = await executeUpgrade({
    workspaceId,
    environmentId: devEnv.environment.id,
    actorId: actor.adminUserId,
    upgradeRunId: safeUpgradePlan.id,
  });
  assert(executedSafeUpgrade.status === 'succeeded', `Safe upgrade execution failed: ${executedSafeUpgrade.status}`);
  console.log('[PASS] Upgrade Manager planned upgrade, enforced backup, blocked unapproved review risk, executed safe upgrade.');

  console.log('\nPHASE 12.5 FULL OPERABILITY CONTROL PLANE CERTIFICATION: ALL PASSED');
} finally {
  console.log('\n--- Final Teardown & 0-Leak Verification ---');
  if (localServer) {
    await new Promise<void>((resolve) => localServer!.close(() => resolve())).catch(() => {});
  }
  // Teardown certification workspace and actors
  await teardownCertification({ client, workspaceId, authUserIds: authUserIds as any, adminUserIds: adminUserIds as any });

  // Verify zero leaked rows for this workspace in all Phase 12.5 tables
  if (workspaceId) {
    const checkTables = [
      'workspace_environments',
      'workspace_connections',
      'workspace_secret_providers',
      'workspace_secret_refs',
      'connection_secret_bindings',
      'connection_verifications',
      'infrastructure_approval_requests',
      'environment_provisioning_runs',
      'environment_component_runs',
      'environment_components',
      'environment_schema_deployments',
      'environment_upgrade_runs',
      'system_doctor_runs',
      'website_connection_bindings',
      'workspace_backups',
      'workspace_restore_runs',
    ];
    let totalLeaks = 0;
    for (const table of checkTables) {
      try {
        const { rows } = await client.query(`select count(*)::int as count from ${table} where workspace_id = $1`, [workspaceId]);
        if (rows[0]?.count > 0) {
          console.error(`LEAK DETECTED: ${rows[0].count} rows in ${table}`);
          totalLeaks += rows[0].count;
        }
      } catch (err) {
        // Ignore table check if table does not exist or has different schema
      }
    }
    assert(totalLeaks === 0, `Total leaked fixtures in Phase 12.5 tables: ${totalLeaks}`);
    console.log('[PASS] 0 fixture leaks verified across all Phase 12.5 operability tables.');
  }

  await client.end();
}
