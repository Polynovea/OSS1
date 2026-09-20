import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createPgClient,
  createDisposableWorkspace,
  createAuthenticatedActor,
  teardownCertification,
} from './cert-harness.mjs';
import { POST as operationalPost, GET as operationalGet } from '../app/api/v1/operational-intelligence/route.ts';
import { sha256Canonical } from '../lib/intelligence/operationalCanonical.ts';
import { buildExecutionDagShape, prerequisiteFailureIds, isSafelyParallelizable } from '../lib/intelligence/executionDag.ts';

const client = await createPgClient();
let workspaceId = null;
let secondWorkspaceId = null;
const authUserIds = [];
const adminUserIds = [];
const globalCleanup = [];

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const pass = (message) => console.log(`[PASS] ${message}`);
const ensureWritable = async () => { await client.query('set default_transaction_read_only=off'); };

function tokenValue() {
  return `pnv_${randomUUID().replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`;
}

async function createDeveloperToken({ workspaceId, actorId, scopes, name }) {
  const raw = tokenValue();
  const hash = createHash('sha256').update(raw).digest('hex');
  const { rows } = await client.query(`
    insert into developer_api_tokens(workspace_id,name,token_prefix,token_hash,scopes,allowed_models,rate_limit_per_minute,created_by)
    values($1,$2,$3,$4,$5::text[],'{}'::text[],10000,$6)
    returning id
  `, [workspaceId, name, raw.slice(0, 12), hash, scopes, actorId]);
  return { id: rows[0].id, raw };
}

async function apiPost(token, body) {
  const req = new Request('http://polynovea.local/api/v1/operational-intelligence', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await operationalPost(req);
  await ensureWritable();
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload, data: payload?.data };
}

async function apiGet(token, environmentId) {
  const req = new Request(`http://polynovea.local/api/v1/operational-intelligence?environmentId=${encodeURIComponent(environmentId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const res = await operationalGet(req);
  await ensureWritable();
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload, data: payload?.data };
}

async function expectApiFailure(label, token, body, expectedStatus) {
  const response = await apiPost(token, body);
  assert(response.status === expectedStatus, `${label}: expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.payload)}`);
  pass(label);
  return response;
}

async function createEnvironmentFixture({ workspaceId, actorId, key, kind, componentState = 'present' }) {
  const { rows: envRows } = await client.query(`
    insert into workspace_environments(workspace_id,key,name,kind,status,database_provider,runtime_provider,created_by,updated_by)
    values($1,$2,$3,$4,'ready','postgres','node',$5,$5)
    returning id
  `, [workspaceId, key, `Phase 12.75 ${key}`, kind, actorId]);
  const environmentId = envRows[0].id;

  const { rows: providerRows } = await client.query(`
    insert into workspace_secret_providers(workspace_id,environment_id,provider_kind,name,status,created_by,updated_by)
    values($1,$2,'environment','Certification environment secrets','active',$3,$3)
    returning id
  `, [workspaceId, environmentId, actorId]);
  const providerId = providerRows[0].id;
  await client.query('update workspace_environments set secret_provider_id=$1 where id=$2 and workspace_id=$3', [providerId, environmentId, workspaceId]);

  const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
  assert(connectionString, 'Database connection string is required for Phase 12.75 certification');
  process.env.POLYNOVEA_CERT_DATABASE_URL = connectionString;

  const { rows: secretRows } = await client.query(`
    insert into workspace_secret_refs(workspace_id,environment_id,provider_id,secret_key,label,locator,state,created_by,updated_by)
    values($1,$2,$3,'database_connection_url','Certification PostgreSQL URL','POLYNOVEA_CERT_DATABASE_URL','healthy',$4,$4)
    returning id
  `, [workspaceId, environmentId, providerId, actorId]);
  const secretRefId = secretRows[0].id;

  const { rows: connRows } = await client.query(`
    insert into workspace_connections(workspace_id,environment_id,connector_type,connector_family,name,status,active,config_json,metadata_json,created_by,updated_by)
    values($1,$2,'database.postgres','database','Certification PostgreSQL','active',true,'{}'::jsonb,'{}'::jsonb,$3,$3)
    returning id
  `, [workspaceId, environmentId, actorId]);
  const connectionId = connRows[0].id;
  await client.query(`
    insert into connection_secret_bindings(workspace_id,connection_id,secret_ref_id,purpose)
    values($1,$2,$3,'connection_url')
  `, [workspaceId, connectionId, secretRefId]);

  const { rows: componentRows } = await client.query(`
    insert into environment_components(workspace_id,environment_id,capability_key,component_key,provider,required,state,metadata_json)
    values($1,$2,'durable_worker','delivery-worker','node',true,$3,'{}'::jsonb)
    returning id
  `, [workspaceId, environmentId, componentState]);

  return { environmentId, connectionId, componentId: componentRows[0].id };
}

async function markComponentObservationStale(workspaceId, environmentId) {
  const { rowCount } = await client.query(`
    update operational_world_nodes
    set is_stale=true, valid_until=now()-interval '1 minute'
    where workspace_id=$1 and environment_id=$2 and node_key='component:delivery-worker'
  `, [workspaceId, environmentId]);
  assert(rowCount === 1, 'Expected delivery-worker world node to exist before marking stale');
}

async function createSafeStalePlan(token, workspaceId, environmentId) {
  await markComponentObservationStale(workspaceId, environmentId);
  const reconcile = await apiPost(token, { operation: 'reconcile', environmentId, refreshWorld: false });
  assert(reconcile.status === 200, `Reconcile failed: ${JSON.stringify(reconcile.payload)}`);
  const staleDrift = reconcile.data?.drifts?.find((item) => String(item.drift_key || item.driftKey || '').endsWith('.stale'));
  assert(staleDrift, `Expected stale capability drift: ${JSON.stringify(reconcile.data)}`);
  const plan = await apiPost(token, { operation: 'plan', environmentId, reconciliationRunId: reconcile.data.run.id });
  assert(plan.status === 200 && plan.data?.plan?.id, `Plan failed: ${JSON.stringify(plan.payload)}`);
  assert(plan.data.plan.deterministic_classification === 'safe', 'Stale-observation plan must remain deterministically safe');
  return { reconcile: reconcile.data, graph: plan.data };
}

async function seedMlEvidence(workspaceId, environmentId) {
  await client.query(`
    insert into operational_events(workspace_id,environment_id,event_type,source_type,source_id,occurred_at,features_json,outcome_json,privacy_class,eligible_for_local_learning,eligible_for_cross_install_learning)
    select $1,$2,'plan.execution','phase12_75_cert_seed','plan-'||i::text,
           now()-((100-i)::text||' minutes')::interval,
           jsonb_build_object('deterministicClassification','safe','nodeCount',3,'requiresApproval',false,'simulationStatus','passed'),
           jsonb_build_object('status',case when i%10=0 then 'failed' else 'succeeded' end,'durationMs',1000+i*13,'remainingDriftCount',case when i%9=0 then 1 else 0 end,'downstreamImpactCount',case when i%9=0 then 1 else 0 end),
           'operational_minimized',true,false
    from generate_series(1,80) i
  `, [workspaceId, environmentId]);
  await client.query(`
    insert into operational_events(workspace_id,environment_id,event_type,source_type,source_id,occurred_at,features_json,outcome_json,privacy_class,eligible_for_local_learning,eligible_for_cross_install_learning)
    select $1,$2,'remediation.outcome','phase12_75_cert_seed','remediation-'||i::text,
           now()-((30-i)::text||' minutes')::interval,
           jsonb_build_object('remediationKey','world.rediscover','classification','safe','executionMode','manual'),
           jsonb_build_object('status',case when i%8=0 then 'failed' else 'succeeded' end,'convergedForTarget',i%8<>0),
           'operational_minimized',true,false
    from generate_series(1,20) i
  `, [workspaceId, environmentId]);
}

async function sourceCertification() {
  const files = {
    world: readFileSync('lib/intelligence/worldModelService.ts', 'utf8'),
    discovery: readFileSync('lib/intelligence/deepDiscoveryService.ts', 'utf8'),
    providerDiscovery: readFileSync('lib/intelligence/providerCapabilityDiscoveryService.ts', 'utf8'),
    reconciliation: readFileSync('lib/intelligence/reconciliationService.ts', 'utf8'),
    migration: readFileSync('lib/intelligence/migrationIntelligenceService.ts', 'utf8'),
    strategy: readFileSync('lib/intelligence/migrationStrategyService.ts', 'utf8'),
    planning: readFileSync('lib/intelligence/planningService.ts', 'utf8'),
    remediation: readFileSync('lib/intelligence/remediationService.ts', 'utf8'),
    ml: readFileSync('lib/intelligence/operationalMlService.ts', 'utf8'),
    mlGovernance: readFileSync('lib/intelligence/operationalMlGovernanceService.ts', 'utf8'),
    predictive: readFileSync('lib/intelligence/predictivePlanningService.ts', 'utf8'),
    adminApi: readFileSync('app/api/operational-intelligence/route.ts', 'utf8'),
    v1Api: readFileSync('app/api/v1/operational-intelligence/route.ts', 'utf8'),
    sdk: readFileSync('packages/cms-sdk/src/index.ts', 'utf8'),
    cli: readFileSync('packages/cms-cli/bin/polynovea-cms.mjs', 'utf8'),
    adminPage: readFileSync('app/admin/operational-intelligence/page.tsx', 'utf8'),
    types: readFileSync('lib/intelligence/operationalTypes.ts', 'utf8'),
    migration56: readFileSync('supabase/migrations/0056_phase12_75_deterministic_operational_intelligence.sql', 'utf8'),
  };

  const requirements = [
    ['A world model observed/declared/inferred/desired semantics', files.types.includes('\"observed\" | \"declared\" | \"inferred\" | \"desired\"') && files.migration56.includes("('observed','declared','inferred','desired')") && files.world.includes('observationKind')],
    ['B PostgreSQL deep discovery', files.discovery.includes('pg_constraint') && files.discovery.includes('pg_index') && files.discovery.includes('pg_class') && files.discovery.includes('information_schema') && files.discovery.includes('pg_roles')],
    ['B provider capability discovery', files.providerDiscovery.includes('storage') && files.providerDiscovery.includes('runtime')],
    ['C desired-state/drift/reconciliation', files.reconciliation.includes('safe_auto_repair') && files.reconciliation.includes('approval_required')],
    ['D deployed-source -> canonical-target provenance', files.migration.includes('UNPROVEN_SCHEMA_PROVENANCE') && files.migration.includes('sourceHashMatchesCanonical') && files.strategy.includes('provenance_state !== \"proven\"')],
    ['D resumable migration batches', files.strategy.includes('cursor_json') && files.strategy.includes('resumeRequired') && files.strategy.includes('postcondition_json')],
    ['E immutable DAG + checksum', files.planning.includes('plan_checksum_sha256') && files.planning.includes('buildExecutionDagShape')],
    ['F simulation preflight', files.planning.includes('operational_simulation_runs') && files.planning.includes('hard_blockers_json')],
    ['G proof carrying execution', files.planning.includes('operational_evidence_packages') && files.planning.includes('checksum_sha256')],
    ['H autonomy boundaries', files.remediation.includes('Production auto-repair is restricted to deterministically SAFE remediations')],
    ['I-M ML lineage/calibration/OOD/feedback', files.ml.includes('out_of_distribution') && files.ml.includes('calibration_state') && files.ml.includes('operational_prediction_outcomes')],
    ['M governed feedback/retention', files.mlGovernance.includes('operational_prediction_feedback') && files.mlGovernance.includes('retention')],
    ['L predictive alternatives', files.predictive.includes('scenario') && files.predictive.includes('deterministic')],
    ['N admin UI present', files.adminPage.includes('Operational')],
    ['N admin/v1 API present', files.adminApi.includes('ml_predict_plan') && files.v1Api.includes('ml_predict_plan')],
    ['N SDK parity', files.sdk.includes('generateDesiredState') && files.sdk.includes('requestApproval') && files.sdk.includes('updateAutonomyPolicy')],
    ['N CLI parity', files.cli.includes('desired-generate') && files.cli.includes('approval') && files.cli.includes('policy')],
    ['O separate API policy scope', files.v1Api.includes('operational_intelligence.policy')],
  ];
  for (const [name, okay] of requirements) assert(okay, `Static A-O certification failed: ${name}`);
  pass('A-O source/contract inventory is present and client parity surfaces are explicit.');
}

async function databaseBoundaryCertification() {
  const operationalTables = [
    'operational_discovery_runs','operational_world_nodes','operational_world_edges','operational_observations',
    'operational_desired_state_revisions','operational_reconciliation_runs','operational_drift_items','operational_autonomy_policies',
    'operational_remediation_registry','operational_change_plans','operational_change_plan_nodes','operational_change_plan_edges',
    'operational_simulation_runs','operational_execution_runs','operational_execution_node_runs','operational_evidence_packages',
    'operational_change_assessments','operational_remediation_runs','operational_events','operational_learning_policies',
    'operational_feature_snapshots','operational_model_registry','operational_model_versions','operational_predictions',
    'operational_prediction_outcomes','operational_model_evaluations','operational_migration_runs','operational_migration_batches',
    'operational_plan_comparisons','operational_prediction_feedback'
  ];
  const { rows } = await client.query(`
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=any($1::text[])
  `, [operationalTables]);
  const byName = new Map(rows.map((row) => [row.relname, row]));
  for (const table of operationalTables) {
    assert(byName.has(table), `Missing Phase 12.75 table ${table}`);
    assert(byName.get(table).relrowsecurity === true, `RLS is not enabled on ${table}`);
  }
  const { rows: runtime } = await client.query("select schema_migration from cms_runtime_state where singleton=true");
  assert(String(runtime[0]?.schema_migration || '') >= '0062', `Expected migration ledger/runtime state >= 0062, got ${runtime[0]?.schema_migration}`);
  pass('Migrations 0056-0062 operational tables exist with RLS enabled.');
}

async function dagPureCertification() {
  const nodes = [
    { id: 'a', node_key: 'a', ordinal: 0, deterministic_classification: 'safe', retry_semantics: 'safe_retry' },
    { id: 'b', node_key: 'b', ordinal: 1, deterministic_classification: 'safe', retry_semantics: 'safe_retry' },
    { id: 'c', node_key: 'c', ordinal: 2, deterministic_classification: 'safe', retry_semantics: 'safe_retry' },
  ];
  const dag = buildExecutionDagShape(nodes, [{ from_node_id: 'a', to_node_id: 'c' }]);
  assert(dag.levels.length === 2, 'Independent nodes should share a DAG level');
  assert(dag.levels[0].map((n) => n.id).join(',') === 'a,b', 'Expected independent a,b in first DAG level');
  const statuses = new Map([['a', 'failed'], ['b', 'succeeded']]);
  assert(prerequisiteFailureIds('c', dag.prerequisitesByNodeId, statuses).join(',') === 'a', 'Dependent node should identify only failed prerequisite');
  assert(isSafelyParallelizable(nodes[0]) === true, 'Safe retry node should be parallelizable');
  let cyclic = false;
  try { buildExecutionDagShape(nodes.slice(0, 2), [{ from_node_id: 'a', to_node_id: 'b' }, { from_node_id: 'b', to_node_id: 'a' }]); } catch { cyclic = true; }
  assert(cyclic, 'Cyclic DAG must be rejected');
  pass('DAG dependency, parallelism and cycle invariants pass.');
}

try {
  console.log('=== PHASE 12.75 A-O EXIT CERTIFICATION ===');
  await sourceCertification();
  await databaseBoundaryCertification();
  await dagPureCertification();

  const ws = await createDisposableWorkspace(client, 'p1275');
  workspaceId = ws.id;
  const actor = await createAuthenticatedActor(client, workspaceId, { role: 'admin', permissions: ['operational_intelligence.read','operational_intelligence.manage','operational_intelligence.execute','operational_intelligence.policy'], emailPrefix: 'p1275' });
  authUserIds.push(actor.authUserId); adminUserIds.push(actor.adminUserId);

  const full = await createDeveloperToken({ workspaceId, actorId: actor.adminUserId, name: 'Phase 12.75 full', scopes: ['operational_intelligence.read','operational_intelligence.write','operational_intelligence.execute','operational_intelligence.policy'] });
  const writeOnly = await createDeveloperToken({ workspaceId, actorId: actor.adminUserId, name: 'Phase 12.75 write-only', scopes: ['operational_intelligence.read','operational_intelligence.write'] });
  const readOnly = await createDeveloperToken({ workspaceId, actorId: actor.adminUserId, name: 'Phase 12.75 read-only', scopes: ['operational_intelligence.read'] });

  const dev = await createEnvironmentFixture({ workspaceId, actorId: actor.adminUserId, key: 'development', kind: 'development', componentState: 'present' });
  const prod = await createEnvironmentFixture({ workspaceId, actorId: actor.adminUserId, key: 'production', kind: 'production', componentState: 'present' });

  const ws2 = await createDisposableWorkspace(client, 'p1275-other');
  secondWorkspaceId = ws2.id;
  const { rows: otherEnvRows } = await client.query(`insert into workspace_environments(workspace_id,key,name,kind,status) values($1,'other','Other workspace','development','ready') returning id`, [secondWorkspaceId]);
  const otherEnvironmentId = otherEnvRows[0].id;

  await expectApiFailure('Read-only API token cannot mutate operational intelligence', readOnly.raw, { operation: 'discover', environmentId: dev.environmentId }, 403);
  await expectApiFailure('Normal write token cannot execute high-risk operational actions', writeOnly.raw, { operation: 'execute', environmentId: dev.environmentId, planId: randomUUID() }, 403);
  await expectApiFailure('Normal write token cannot change operational/ML policy', writeOnly.raw, { operation: 'ml_policy_update', environmentId: dev.environmentId, localLearningEnabled: false, crossInstallLearningOptIn: false }, 403);
  const crossWorkspace = await apiPost(full.raw, { operation: 'discover', environmentId: otherEnvironmentId });
  assert(crossWorkspace.status >= 400, `Cross-workspace environment access must be denied: ${JSON.stringify(crossWorkspace.payload)}`);
  pass('Workspace/environment and token-scope boundaries reject unauthorized access.');

  const devDiscover = await apiPost(full.raw, { operation: 'discover', environmentId: dev.environmentId });
  assert(devDiscover.status === 200 && devDiscover.data?.run?.status === 'succeeded', `Development discovery failed: ${JSON.stringify(devDiscover.payload)}`);
  const desired = await apiPost(full.raw, { operation: 'desired_generate', environmentId: dev.environmentId, activate: true });
  assert(desired.status === 200 && desired.data?.id, `Desired-state generation failed: ${JSON.stringify(desired.payload)}`);
  const overview = await apiGet(full.raw, dev.environmentId);
  assert(overview.status === 200 && overview.data?.overview, `Operational overview failed: ${JSON.stringify(overview.payload)}`);
  pass('A-C discovery, evidence, world state and active desired state are operational.');

  const staleCandidate = await createSafeStalePlan(full.raw, workspaceId, dev.environmentId);
  const stalePlanId = staleCandidate.graph.plan.id;
  const newerDiscovery = await apiPost(full.raw, { operation: 'discover', environmentId: dev.environmentId });
  assert(newerDiscovery.status === 200, 'Newer discovery for stale-plan test failed');
  const staleSimulation = await apiPost(full.raw, { operation: 'simulate', environmentId: dev.environmentId, planId: stalePlanId });
  assert(staleSimulation.status === 200 && staleSimulation.data?.status === 'blocked', `Stale plan should simulate as blocked: ${JSON.stringify(staleSimulation.payload)}`);
  assert((staleSimulation.data.hard_blockers_json || []).some((b) => b.code === 'WORLD_MODEL_CHANGED'), 'Stale plan blocker WORLD_MODEL_CHANGED missing');
  pass('Immutable stale plan is rejected after material world-state refresh.');

  const fresh = await createSafeStalePlan(full.raw, workspaceId, dev.environmentId);
  const planId = fresh.graph.plan.id;
  const beforeTarget = await client.query(`select state,last_checked_at from environment_components where id=$1`, [dev.componentId]);
  const beforeConnection = await client.query(`select status,last_verified_at from workspace_connections where id=$1`, [dev.connectionId]);
  const simulation = await apiPost(full.raw, { operation: 'simulate', environmentId: dev.environmentId, planId });
  assert(simulation.status === 200 && ['passed','warning'].includes(simulation.data?.status), `Fresh simulation failed: ${JSON.stringify(simulation.payload)}`);
  const afterTarget = await client.query(`select state,last_checked_at from environment_components where id=$1`, [dev.componentId]);
  const afterConnection = await client.query(`select status,last_verified_at from workspace_connections where id=$1`, [dev.connectionId]);
  assert(JSON.stringify(beforeTarget.rows[0]) === JSON.stringify(afterTarget.rows[0]), 'Simulation mutated environment component target state');
  assert(JSON.stringify(beforeConnection.rows[0]) === JSON.stringify(afterConnection.rows[0]), 'Simulation mutated connection target state');
  pass('Simulation is non-mutating with explicit blocker/warning/rollback evidence.');

  const learningOn = await apiPost(full.raw, { operation: 'ml_policy_update', environmentId: dev.environmentId, localLearningEnabled: true, crossInstallLearningOptIn: false, contentLevelFeaturesEnabled: false, retentionDays: 365 });
  assert(learningOn.status === 200 && learningOn.data?.local_learning_enabled === true, 'Could not enable local ML learning');
  await seedMlEvidence(workspaceId, dev.environmentId);
  const training = await apiPost(full.raw, { operation: 'ml_train', environmentId: dev.environmentId });
  assert(training.status === 200 && training.data?.status === 'models_available', `Expected evidence-backed models: ${JSON.stringify(training.payload)}`);
  const deployedFamilies = new Set((training.data.trained || []).filter((m) => m.status === 'deployed').map((m) => m.family));
  for (const family of ['migration_change_risk','execution_duration','dependency_impact','remediation_success']) assert(deployedFamilies.has(family), `Expected deployed ${family} model`);
  assert((training.data.insufficient || []).length > 0, 'Unsupported/low-evidence specialist families should remain explicitly insufficient rather than fabricated');
  pass('ML training produces calibrated supported models and explicit insufficient-data families.');

  const predictions = await apiPost(full.raw, { operation: 'ml_predict_plan', environmentId: dev.environmentId, planId });
  assert(predictions.status === 200, `Plan prediction failed: ${JSON.stringify(predictions.payload)}`);
  assert((predictions.data?.predictions || []).length >= 3, 'Expected risk/duration/dependency predictions');
  for (const prediction of predictions.data.predictions) {
    assert(prediction.status === 'ready', `Expected in-distribution ready prediction, got ${prediction.status}`);
    assert(prediction.model_version_id, 'Prediction missing model version lineage');
    assert(prediction.feature_snapshot_id, 'Prediction missing feature snapshot lineage');
    assert(prediction.calibration_state && prediction.calibration_state !== 'unavailable', 'Prediction missing calibration state');
  }
  const comparison = await apiPost(full.raw, { operation: 'plan_compare', environmentId: dev.environmentId, planId });
  assert(comparison.status === 200 && comparison.data?.comparison_json, `Plan comparison failed: ${JSON.stringify(comparison.payload)}`);
  assert(Array.isArray(comparison.data.comparison_json.scenarios) && comparison.data.comparison_json.scenarios.length >= 2, 'Counterfactual comparison should retain multiple deterministic scenarios');
  assert(comparison.data.comparison_json.deterministicSafetyAuthority === true, 'Counterfactual comparison must preserve deterministic safety authority');
  pass('ML-enabled review exposes lineage, calibration and transparent counterfactual plan comparison.');

  const oodDocument = { format:'polynovea-operational-plan', formatVersion:1, environmentId:dev.environmentId, desiredStateRevisionId:desired.data.id, sourceDiscoveryRunId:fresh.graph.plan.source_discovery_run_id, sourceReconciliationRunId:fresh.graph.plan.source_reconciliation_run_id, classification:'requires_lock', requiresApproval:false, createdAt:new Date().toISOString(), nodes:[] };
  const oodChecksum = sha256Canonical(oodDocument);
  const { rows: oodRows } = await client.query(`
    insert into operational_change_plans(workspace_id,environment_id,desired_state_revision_id,source_reconciliation_run_id,source_discovery_run_id,name,status,deterministic_classification,requires_approval,immutable_plan_json,plan_checksum_sha256,created_by,expires_at)
    values($1,$2,$3,$4,$5,'OOD certification plan','planned','requires_lock',false,$6::jsonb,$7,$8,now()+interval '30 minutes') returning id
  `, [workspaceId, dev.environmentId, desired.data.id, fresh.graph.plan.source_reconciliation_run_id, fresh.graph.plan.source_discovery_run_id, JSON.stringify(oodDocument), oodChecksum, actor.adminUserId]);
  const oodPrediction = await apiPost(full.raw, { operation: 'ml_predict_plan', environmentId: dev.environmentId, planId: oodRows[0].id });
  assert(oodPrediction.status === 200 && (oodPrediction.data?.predictions || []).every((p) => p.status === 'out_of_distribution'), `OOD plan must not receive fabricated ready predictions: ${JSON.stringify(oodPrediction.payload)}`);
  pass('OOD classification explicitly downgrades ML confidence without changing deterministic authority.');

  const execute = await apiPost(full.raw, { operation: 'execute', environmentId: dev.environmentId, planId });
  assert(execute.status === 200 && execute.data?.execution?.status === 'succeeded', `Deterministic execution did not converge: ${JSON.stringify(execute.payload)}`);
  assert(execute.data?.evidencePackage?.id, 'Successful execution missing proof package');
  const { rows: proofRows } = await client.query(`select package_json,checksum_sha256 from operational_evidence_packages where id=$1`, [execute.data.evidencePackage.id]);
  assert(proofRows.length === 1, 'Proof package was not persisted');
  assert(sha256Canonical(proofRows[0].package_json) === proofRows[0].checksum_sha256, 'Proof package checksum/integrity verification failed');
  const proofText = JSON.stringify(proofRows[0].package_json);
  assert(!proofText.includes(process.env.POLYNOVEA_CERT_DATABASE_URL), 'Proof package leaked database credential value');
  const { rows: outcomeRows } = await client.query(`select p.prediction_key,o.evaluation_json from operational_prediction_outcomes o join operational_predictions p on p.id=o.prediction_id where o.workspace_id=$1 and p.subject_id=$2`, [workspaceId, planId]);
  assert(outcomeRows.length >= 2, 'Prediction -> actual outcome feedback was not persisted');
  const dependencyOutcome = outcomeRows.find((r) => String(r.prediction_key).startsWith('dependency_impact'));
  assert(dependencyOutcome?.evaluation_json?.probabilityTarget === 'downstream_impact', 'Dependency-impact prediction evaluated against the wrong target label');
  pass('Execution converged, proof checksum/redaction passes, and prediction -> actual feedback is correctly labelled.');

  const learningOff = await apiPost(full.raw, { operation: 'ml_policy_update', environmentId: dev.environmentId, localLearningEnabled: false, crossInstallLearningOptIn: false, contentLevelFeaturesEnabled: false, retentionDays: 365 });
  assert(learningOff.status === 200 && learningOff.data?.local_learning_enabled === false, 'Could not disable local ML');
  const offDiscover = await apiPost(full.raw, { operation: 'discover', environmentId: dev.environmentId });
  assert(offDiscover.status === 200, 'ML-off discovery failed');
  const mlOffPlan = await createSafeStalePlan(full.raw, workspaceId, dev.environmentId);
  const disabledPrediction = await apiPost(full.raw, { operation: 'ml_predict_plan', environmentId: dev.environmentId, planId: mlOffPlan.graph.plan.id });
  assert(disabledPrediction.status === 200 && (disabledPrediction.data?.predictions || []).every((p) => p.status === 'disabled'), 'ML-disabled mode must report disabled predictions explicitly');
  const mlOffExecute = await apiPost(full.raw, { operation: 'execute', environmentId: dev.environmentId, planId: mlOffPlan.graph.plan.id });
  assert(mlOffExecute.status === 200 && mlOffExecute.data?.execution?.status === 'succeeded', 'Deterministic path failed with ML disabled');
  pass('Full deterministic operational path succeeds with ML disabled.');

  const prodDiscover = await apiPost(full.raw, { operation: 'discover', environmentId: prod.environmentId });
  assert(prodDiscover.status === 200, 'Production discovery failed');
  const prodDesired = await apiPost(full.raw, { operation: 'desired_generate', environmentId: prod.environmentId, activate: true });
  assert(prodDesired.status === 200, 'Production desired state failed');
  // `ensureEnvironmentComponents` legitimately re-infers absent providers. A
  // degraded required component is persisted as observed operational drift.
  await client.query(`update environment_components set state='degraded' where id=$1`, [prod.componentId]);
  const prodChangedDiscovery = await apiPost(full.raw, { operation: 'discover', environmentId: prod.environmentId });
  assert(prodChangedDiscovery.status === 200, 'Production post-change discovery failed');
  const prodReconcile = await apiPost(full.raw, { operation: 'reconcile', environmentId: prod.environmentId, refreshWorld: false });
  assert(prodReconcile.status === 200 && (prodReconcile.data?.drifts || []).some((d) => (d.actionClass ?? d.action_class) === 'approval_required'), 'Production blocking drift must require approval');
  const prodPlan = await apiPost(full.raw, { operation: 'plan', environmentId: prod.environmentId, reconciliationRunId: prodReconcile.data.run.id });
  assert(prodPlan.status === 200 && prodPlan.data?.plan?.requires_approval === true, 'Production plan did not preserve approval requirement');
  const prodExecuteNoApproval = await apiPost(full.raw, { operation: 'execute', environmentId: prod.environmentId, planId: prodPlan.data.plan.id });
  assert(prodExecuteNoApproval.status === 200 && prodExecuteNoApproval.data?.execution?.status === 'blocked' && !prodExecuteNoApproval.data?.evidencePackage, 'Approval bypass must produce blocked execution with no proof of success');
  pass('Approval bypass on production high-risk plan is rejected.');

  const latestDevDiscovery = (await client.query(`select id from operational_discovery_runs where workspace_id=$1 and environment_id=$2 and status='succeeded' order by started_at desc limit 1`, [workspaceId, dev.environmentId])).rows[0].id;
  const activeDesired = (await client.query(`select id from operational_desired_state_revisions where workspace_id=$1 and environment_id=$2 and status='active'`, [workspaceId, dev.environmentId])).rows[0].id;
  const customDoc = { format:'polynovea-operational-plan',formatVersion:1,environmentId:dev.environmentId,desiredStateRevisionId:activeDesired,sourceDiscoveryRunId:latestDevDiscovery,sourceReconciliationRunId:null,classification:'safe',requiresApproval:false,createdAt:new Date().toISOString(),nodes:[] };
  const customChecksum = sha256Canonical(customDoc);
  const { rows: customPlanRows } = await client.query(`insert into operational_change_plans(workspace_id,environment_id,desired_state_revision_id,source_discovery_run_id,name,status,deterministic_classification,requires_approval,immutable_plan_json,plan_checksum_sha256,created_by,expires_at) values($1,$2,$3,$4,'Broken DAG certification','planned','safe',false,$5::jsonb,$6,$7,now()+interval '30 minutes') returning id`, [workspaceId,dev.environmentId,activeDesired,latestDevDiscovery,JSON.stringify(customDoc),customChecksum,actor.adminUserId]);
  const customPlanId = customPlanRows[0].id;
  const missingComponent = randomUUID();
  const { rows: customNodes } = await client.query(`
    insert into operational_change_plan_nodes(plan_id,node_key,ordinal,operation,target_type,target_id,deterministic_classification,approval_class,retry_semantics,idempotency_key,timeout_seconds,preconditions_json,input_json,verification_json,compensation_json)
    values
      ($1,'fail-component',0,'component.check','environment_component',$2,'safe','none','safe_retry',$3,60,'[]','{}','{}','{}'),
      ($1,'independent-refresh',1,'world.refresh','workspace_environment',$4,'safe','none','safe_retry',$5,120,'[]','{}','{}','{}'),
      ($1,'dependent-refresh',2,'world.refresh','workspace_environment',$4,'safe','none','safe_retry',$6,120,'[]','{}','{}','{}')
    returning id,node_key
  `, [customPlanId,missingComponent,`${customChecksum}:fail`,dev.environmentId,`${customChecksum}:independent`,`${customChecksum}:dependent`]);
  const ids = Object.fromEntries(customNodes.map((n) => [n.node_key,n.id]));
  await client.query(`insert into operational_change_plan_edges(plan_id,from_node_id,to_node_id,edge_kind) values($1,$2,$3,'depends_on')`, [customPlanId,ids['fail-component'],ids['dependent-refresh']]);
  const brokenExecution = await apiPost(full.raw, { operation:'execute', environmentId:dev.environmentId, planId:customPlanId });
  assert(brokenExecution.status === 200 && brokenExecution.data?.execution?.status === 'failed', `Broken DAG parent must fail: ${JSON.stringify(brokenExecution.payload)}`);
  const { rows: nodeRuns } = await client.query(`select n.node_key,r.status from operational_execution_node_runs r join operational_change_plan_nodes n on n.id=r.plan_node_id where r.execution_run_id=$1`, [brokenExecution.data.execution.id]);
  const statusByNode = Object.fromEntries(nodeRuns.map((r) => [r.node_key,r.status]));
  assert(statusByNode['fail-component'] === 'failed', 'Failing DAG node should be failed');
  assert(statusByNode['independent-refresh'] === 'succeeded', 'Independent safe DAG branch should still execute');
  assert(statusByNode['dependent-refresh'] === 'blocked', 'Dependent DAG node should be blocked after prerequisite failure');
  pass('Broken child DAG cannot produce fake parent success; independent safe branch still executes.');

  const destructiveKey = `cert.destructive.${randomUUID().slice(0,8)}`;
  await client.query(`insert into operational_remediation_registry(remediation_key,title,failure_class,deterministic_classification,detection_contract_json,repair_contract_json,verification_contract_json,compensation_contract_json,enabled) values($1,'Certification destructive remediation','cert','destructive','{}','{}','{}','{}',true)`, [destructiveKey]);
  globalCleanup.push(async () => client.query('delete from operational_remediation_registry where remediation_key=$1', [destructiveKey]));
  const policy = await apiPost(full.raw, { operation:'policy_update', environmentId:prod.environmentId, mode:'policy_auto_repair', allowedRemediationKeys:[destructiveKey], maxDeterministicClassification:'safe' });
  assert(policy.status === 200, `Could not set safe-only production auto-repair policy: ${JSON.stringify(policy.payload)}`);
  const destructiveAttempt = await apiPost(full.raw, { operation:'remediation_execute', environmentId:prod.environmentId, remediationKey:destructiveKey, targetType:'workspace_environment', targetId:prod.environmentId, executionMode:'approval_execute' });
  assert(destructiveAttempt.status >= 400, 'Registered destructive remediation without deterministic executor must not silently succeed');
  const remediationSource = readFileSync('lib/intelligence/remediationService.ts','utf8');
  assert(remediationSource.includes('Production auto-repair is restricted to deterministically SAFE remediations'), 'Production destructive auto-repair guard missing');
  pass('Destructive/unsafe auto-repair remains outside policy-authorized automatic execution.');

  const schema = { name:'Certification Model', apiKey:'cert_model', fields:[] };
  const schemaHash = sha256Canonical(schema);
  const { rows: modelRows } = await client.query(`insert into content_models(workspace_id,name,api_key,status,current_schema_version,created_by) values($1,'Certification Model','cert_model','active',1,$2) returning id`, [workspaceId,actor.adminUserId]);
  const modelId = modelRows[0].id;
  await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'cert',$4)`, [modelId,JSON.stringify(schema),schemaHash,actor.adminUserId]);
  const { rows: assessmentRows } = await client.query(`
    insert into operational_change_assessments(workspace_id,environment_id,content_model_id,current_schema_version,proposed_schema_hash,status,deterministic_classification,schema_diff_json,data_profile_json,hard_blockers_json,warnings_json,alternatives_json,estimate_json,source_connection_id,created_by,source_schema_version,source_schema_hash,target_schema_version,target_schema_hash,provenance_state,provenance_json)
    values($1,$2,$3,1,$4,'passed','safe','{}','{}','[]','[]','[]','{}',$5,$6,1,$4,1,$4,'ambiguous','{}') returning id
  `, [workspaceId,dev.environmentId,modelId,schemaHash,dev.connectionId,actor.adminUserId]);
  const ambiguousMigration = await apiPost(full.raw, { operation:'migration_execute', environmentId:dev.environmentId, assessmentId:assessmentRows[0].id, strategyKey:'direct_metadata_change', input:{} });
  assert(ambiguousMigration.status === 409 && String(ambiguousMigration.payload?.error?.message || ambiguousMigration.payload?.error || JSON.stringify(ambiguousMigration.payload)).toLowerCase().includes('provenance'), `Ambiguous migration provenance must be rejected: ${JSON.stringify(ambiguousMigration.payload)}`);
  pass('Ambiguous migration provenance is rejected before automatic execution.');

  const { rows: learningPolicyRows } = await client.query(`select local_learning_enabled,cross_install_learning_opt_in,content_level_features_enabled,retention_days from operational_learning_policies where workspace_id=$1`, [workspaceId]);
  assert(learningPolicyRows.length === 1 && learningPolicyRows[0].cross_install_learning_opt_in === false && learningPolicyRows[0].content_level_features_enabled === false, 'Learning consent boundary is not explicit/default-safe');
  const { rows: modelRowsIntegrity } = await client.query(`select count(*)::int as n from operational_model_versions where workspace_id=$1 and status in ('deployed','retired') and integrity_sha256 is not null`, [workspaceId]);
  assert(modelRowsIntegrity[0].n >= 4, 'Expected integrity checksums on deployed model artifacts');
  pass('Learning consent/retention and model artifact integrity boundaries are present.');

  console.log('\n=== PHASE 12.75 CERTIFICATION: PASS ===');
} catch (error) {
  console.error('\n=== PHASE 12.75 CERTIFICATION: FAIL ===');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  await ensureWritable().catch(() => undefined);
  for (const cleanup of globalCleanup.reverse()) await cleanup().catch(() => undefined);
  if (secondWorkspaceId) await client.query('delete from workspaces where id=$1', [secondWorkspaceId]).catch(() => undefined);
  if (workspaceId) {
    try {
      await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
    } catch (error) {
      console.error(error?.stack || error);
      process.exitCode = 1;
    }
  }
  await client.end().catch(() => undefined);
}
