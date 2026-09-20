import { createHash, randomUUID } from 'node:crypto';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';
import { POST as operationalPost, GET as operationalGet } from '../app/api/v1/operational-intelligence/route.ts';
import { sha256Canonical } from '../lib/intelligence/operationalCanonical.ts';

export const assert = (condition, message) => { if (!condition) throw new Error(message); };
export const pass = (message) => console.log(`[PASS] ${message}`);
export { sha256Canonical, randomUUID };

export async function createCertContext(prefix = 'p1275') {
  const client = await createPgClient();
  await client.query('set default_transaction_read_only=off');
  const ws = await createDisposableWorkspace(client, prefix);
  const actor = await createAuthenticatedActor(client, ws.id, {
    role: 'admin',
    permissions: ['operational_intelligence.read','operational_intelligence.manage','operational_intelligence.execute','operational_intelligence.policy'],
    emailPrefix: prefix,
  });
  return { client, workspaceId: ws.id, actor, authUserIds: [actor.authUserId], adminUserIds: [actor.adminUserId], globalCleanup: [], secondWorkspaceId: null };
}

export async function ensureWritable(client) {
  await client.query('set default_transaction_read_only=off');
}

function tokenValue() {
  return `pnv_${randomUUID().replaceAll('-', '')}_${randomUUID().replaceAll('-', '')}`;
}

export async function createDeveloperToken(ctx, { scopes, name }) {
  const raw = tokenValue();
  const hash = createHash('sha256').update(raw).digest('hex');
  const { rows } = await ctx.client.query(`
    insert into developer_api_tokens(workspace_id,name,token_prefix,token_hash,scopes,allowed_models,rate_limit_per_minute,created_by)
    values($1,$2,$3,$4,$5::text[],'{}'::text[],10000,$6)
    returning id
  `, [ctx.workspaceId, name, raw.slice(0, 12), hash, scopes, ctx.actor.adminUserId]);
  return { id: rows[0].id, raw };
}

export async function apiPost(ctx, token, body) {
  const req = new Request('http://polynovea.local/api/v1/operational-intelligence', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await operationalPost(req);
  await ensureWritable(ctx.client).catch(() => undefined);
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload, data: payload?.data };
}

export async function apiGet(ctx, token, environmentId) {
  const req = new Request(`http://polynovea.local/api/v1/operational-intelligence?environmentId=${encodeURIComponent(environmentId)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const res = await operationalGet(req);
  await ensureWritable(ctx.client).catch(() => undefined);
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload, data: payload?.data };
}

export async function expectApiFailure(ctx, label, token, body, expectedStatus) {
  const response = await apiPost(ctx, token, body);
  assert(response.status === expectedStatus, `${label}: expected HTTP ${expectedStatus}, got ${response.status}: ${JSON.stringify(response.payload)}`);
  pass(label);
  return response;
}

export async function createEnvironmentFixture(ctx, { key, kind, componentState = 'present' }) {
  const { client, workspaceId, actor } = ctx;
  const { rows: envRows } = await client.query(`
    insert into workspace_environments(workspace_id,key,name,kind,status,database_provider,runtime_provider,created_by,updated_by)
    values($1,$2,$3,$4,'ready','postgres','node',$5,$5)
    returning id
  `, [workspaceId, key, `Phase 12.75 ${key}`, kind, actor.adminUserId]);
  const environmentId = envRows[0].id;
  const { rows: providerRows } = await client.query(`
    insert into workspace_secret_providers(workspace_id,environment_id,provider_kind,name,status,created_by,updated_by)
    values($1,$2,'environment','Certification environment secrets','active',$3,$3)
    returning id
  `, [workspaceId, environmentId, actor.adminUserId]);
  const providerId = providerRows[0].id;
  await client.query('update workspace_environments set secret_provider_id=$1 where id=$2 and workspace_id=$3', [providerId, environmentId, workspaceId]);
  const connectionString = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
  assert(connectionString, 'Database connection string is required for Phase 12.75 certification');
  process.env.POLYNOVEA_CERT_DATABASE_URL = connectionString;
  const { rows: secretRows } = await client.query(`
    insert into workspace_secret_refs(workspace_id,environment_id,provider_id,secret_key,label,locator,state,created_by,updated_by)
    values($1,$2,$3,'database_connection_url','Certification PostgreSQL URL','POLYNOVEA_CERT_DATABASE_URL','healthy',$4,$4)
    returning id
  `, [workspaceId, environmentId, providerId, actor.adminUserId]);
  const { rows: connRows } = await client.query(`
    insert into workspace_connections(workspace_id,environment_id,connector_type,connector_family,name,status,active,config_json,metadata_json,created_by,updated_by)
    values($1,$2,'database.postgres','database','Certification PostgreSQL','active',true,'{}'::jsonb,'{}'::jsonb,$3,$3)
    returning id
  `, [workspaceId, environmentId, actor.adminUserId]);
  const connectionId = connRows[0].id;
  await client.query(`insert into connection_secret_bindings(workspace_id,connection_id,secret_ref_id,purpose) values($1,$2,$3,'connection_url')`, [workspaceId, connectionId, secretRows[0].id]);
  const { rows: componentRows } = await client.query(`
    insert into environment_components(workspace_id,environment_id,capability_key,component_key,provider,required,state,metadata_json)
    values($1,$2,'durable_worker','delivery-worker','node',true,$3,'{}'::jsonb)
    returning id
  `, [workspaceId, environmentId, componentState]);
  return { environmentId, connectionId, componentId: componentRows[0].id };
}

export async function markComponentObservationStale(ctx, environmentId) {
  const { rowCount } = await ctx.client.query(`
    update operational_world_nodes set is_stale=true, valid_until=now()-interval '1 minute'
    where workspace_id=$1 and environment_id=$2 and node_key='component:delivery-worker'
  `, [ctx.workspaceId, environmentId]);
  assert(rowCount === 1, 'Expected delivery-worker world node to exist before marking stale');
}

export async function createSafeStalePlan(ctx, token, environmentId) {
  await markComponentObservationStale(ctx, environmentId);
  const reconcile = await apiPost(ctx, token, { operation: 'reconcile', environmentId, refreshWorld: false });
  assert(reconcile.status === 200, `Reconcile failed: ${JSON.stringify(reconcile.payload)}`);
  const staleDrift = reconcile.data?.drifts?.find((item) => String(item.drift_key || item.driftKey || '').endsWith('.stale'));
  assert(staleDrift, `Expected stale capability drift: ${JSON.stringify(reconcile.data)}`);
  const plan = await apiPost(ctx, token, { operation: 'plan', environmentId, reconciliationRunId: reconcile.data.run.id });
  assert(plan.status === 200 && plan.data?.plan?.id, `Plan failed: ${JSON.stringify(plan.payload)}`);
  assert(plan.data.plan.deterministic_classification === 'safe', 'Stale-observation plan must remain deterministically safe');
  return { reconcile: reconcile.data, graph: plan.data };
}

export async function seedMlEvidence(ctx, environmentId) {
  const { client, workspaceId } = ctx;
  await client.query(`
    insert into operational_events(workspace_id,environment_id,event_type,source_type,source_id,occurred_at,features_json,outcome_json,privacy_class,eligible_for_local_learning,eligible_for_cross_install_learning)
    select $1,$2,'plan.execution','phase12_75_cert_seed','plan-'||i::text,
           now()-((100-i)::text||' minutes')::interval,
           jsonb_build_object('deterministicClassification','safe','nodeCount',3,'requiresApproval',false,'simulationStatus','passed'),
           jsonb_build_object('status',case when i%10=0 then 'failed' else 'succeeded' end,'durationMs',1000+i*13,'remainingDriftCount',case when i%9=0 then 1 else 0 end,'downstreamImpactCount',case when i%9=0 then 1 else 0 end),
           'operational_minimized',true,false from generate_series(1,80) i
  `, [workspaceId, environmentId]);
  await client.query(`
    insert into operational_events(workspace_id,environment_id,event_type,source_type,source_id,occurred_at,features_json,outcome_json,privacy_class,eligible_for_local_learning,eligible_for_cross_install_learning)
    select $1,$2,'remediation.outcome','phase12_75_cert_seed','remediation-'||i::text,
           now()-((30-i)::text||' minutes')::interval,
           jsonb_build_object('remediationKey','world.rediscover','classification','safe','executionMode','manual'),
           jsonb_build_object('status',case when i%8=0 then 'failed' else 'succeeded' end,'convergedForTarget',i%8<>0),
           'operational_minimized',true,false from generate_series(1,20) i
  `, [workspaceId, environmentId]);
}

export async function cleanupContext(ctx) {
  if (!ctx) return;
  await ensureWritable(ctx.client).catch(() => undefined);
  for (const cleanup of ctx.globalCleanup.reverse()) await cleanup().catch(() => undefined);
  if (ctx.secondWorkspaceId) await ctx.client.query('delete from workspaces where id=$1', [ctx.secondWorkspaceId]).catch(() => undefined);
  try {
    await teardownCertification({ client: ctx.client, workspaceId: ctx.workspaceId, authUserIds: ctx.authUserIds, adminUserIds: ctx.adminUserIds });
  } finally {
    await ctx.client.end().catch(() => undefined);
  }
}
