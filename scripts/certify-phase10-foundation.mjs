import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const client = await createPgClient();
const second = await createPgClient();
let workspaceId = null;
let otherWorkspaceId = null;
const authUserIds = [];
const adminUserIds = [];

const assert = (value, message) => { if (!value) throw new Error(message); };
async function expectReject(label, fn) {
  try { await fn(); } catch (error) { console.log(`[PASS] ${label}: rejected as expected (${error.message})`); return; }
  throw new Error(`${label}: expected rejection`);
}

try {
  console.log('=== PHASE 10 DELIVERY CONTROL PLANE FOUNDATION CERTIFICATION ===');
  const ws = await createDisposableWorkspace(client, 'p10-foundation');
  workspaceId = ws.id;
  const other = await createDisposableWorkspace(client, 'p10-other');
  otherWorkspaceId = other.id;
  const actor = await createAuthenticatedActor(client, workspaceId, {
    role: 'admin',
    permissions: ['content.entry.read', 'content.entry.publish', 'workspace.manage'],
    emailPrefix: 'p10-foundation',
  });
  authUserIds.push(actor.authUserId);
  adminUserIds.push(actor.adminUserId);

  console.log('\n--- 1. RPC privilege boundary ---');
  const names = ['cms_enqueue_delivery_job','cms_claim_delivery_jobs','cms_complete_delivery_job','cms_fail_delivery_job','cms_replay_delivery_job','cms_cancel_delivery_job','cms_record_destination_health'];
  const { rows: acls } = await client.query(`select proname, proacl::text from pg_proc where proname = any($1::text[])`, [names]);
  assert(acls.length === names.length, 'Missing one or more Phase 10 RPCs');
  for (const row of acls) {
    const acl = String(row.proacl || '');
    assert(!/(^|[,{])=X\//.test(acl), `${row.proname} grants PUBLIC execute`);
    assert(!acl.includes('anon=X'), `${row.proname} grants anon execute`);
    assert(!acl.includes('authenticated=X'), `${row.proname} grants authenticated execute`);
  }
  console.log('[PASS] Phase 10 RPCs are service-bound.');

  console.log('\n--- 2. Idempotent enqueue + exclusive lease ---');
  const enqueue = async (key, maxAttempts=3) => (await client.query(
    `select cms_enqueue_delivery_job($1,$2,'health_scan',$3,'{}'::jsonb,'{}'::jsonb,now(),100,$4,'default',null) as job`,
    [workspaceId, actor.adminUserId, key, maxAttempts]
  )).rows[0].job;
  const job = await enqueue('p10:lease');
  const duplicate = await enqueue('p10:lease');
  assert(job.id === duplicate.id, 'Idempotent enqueue created a duplicate job');
  const { rows: firstClaim } = await client.query(`select * from cms_claim_delivery_jobs('worker-a',1,60,'default',array['health_scan'])`);
  assert(firstClaim.length === 1 && firstClaim[0].id === job.id, 'worker-a did not claim expected job');
  const { rows: secondClaim } = await second.query(`select * from cms_claim_delivery_jobs('worker-b',1,60,'default',array['health_scan'])`);
  assert(secondClaim.length === 0, 'worker-b double-claimed leased job');
  await expectReject('Wrong worker completion', () => second.query(`select cms_complete_delivery_job($1,'worker-b','{}'::jsonb,12)`, [job.id]));
  await client.query(`select cms_complete_delivery_job($1,'worker-a','{"statusCode":200}'::jsonb,12)`, [job.id]);
  const { rows: completed } = await client.query(`select status,attempt_count from delivery_jobs where id=$1`, [job.id]);
  assert(completed[0].status === 'succeeded' && completed[0].attempt_count === 1, 'Successful completion state is incorrect');
  console.log('[PASS] Enqueue is idempotent and leases prevent double ownership.');

  console.log('\n--- 3. Retry -> dead letter -> replay ---');
  const retryJob = await enqueue('p10:retry', 2);
  const { rows: claim1 } = await client.query(`select * from cms_claim_delivery_jobs('worker-a',1,60,'default',array['health_scan'])`);
  assert(claim1[0]?.id === retryJob.id, 'retry job first claim failed');
  await client.query(`select cms_fail_delivery_job($1,'worker-a','HTTP_503','Unavailable','{"statusCode":503}'::jsonb,50,1)`, [retryJob.id]);
  await client.query(`update delivery_jobs set run_after=now()-interval '1 second' where id=$1`, [retryJob.id]);
  const { rows: retrying } = await client.query(`select status,attempt_count from delivery_jobs where id=$1`, [retryJob.id]);
  assert(retrying[0].status === 'retrying' && retrying[0].attempt_count === 1, 'First failure did not schedule retry');
  const { rows: claim2 } = await client.query(`select * from cms_claim_delivery_jobs('worker-a',1,60,'default',array['health_scan'])`);
  assert(claim2[0]?.id === retryJob.id && claim2[0].attempt_count === 2, 'Retry claim did not increment attempt');
  await client.query(`select cms_fail_delivery_job($1,'worker-a','HTTP_503','Still unavailable','{}'::jsonb,70,1)`, [retryJob.id]);
  const { rows: dead } = await client.query(`select * from delivery_jobs where id=$1`, [retryJob.id]);
  assert(dead[0].status === 'dead_letter' && dead[0].completed_at, 'Max attempts did not dead-letter the job');
  const { rows: attempts } = await client.query(`select attempt_number,outcome from delivery_job_attempts where job_id=$1 order by attempt_number`, [retryJob.id]);
  assert(attempts.length === 2 && attempts[0].outcome === 'retrying' && attempts[1].outcome === 'dead_letter', 'Attempt history is incomplete');
  const replay = (await client.query(`select cms_replay_delivery_job($1,$2,$3) as job`, [workspaceId, actor.adminUserId, retryJob.id])).rows[0].job;
  assert(replay.status === 'queued' && replay.replay_of_job_id === retryJob.id && replay.correlation_id === retryJob.correlation_id, 'Replay did not preserve lineage/correlation');
  console.log('[PASS] Retry/dead-letter transitions and replay lineage certified.');

  console.log('\n--- 4. Cancellation ---');
  const cancelJob = await enqueue('p10:cancel');
  await client.query(`select cms_cancel_delivery_job($1,$2,$3)`, [workspaceId, actor.adminUserId, cancelJob.id]);
  const { rows: cancelled } = await client.query(`select status,completed_at from delivery_jobs where id=$1`, [cancelJob.id]);
  assert(cancelled[0].status === 'cancelled' && cancelled[0].completed_at, 'Cancellation did not create terminal state');
  console.log('[PASS] Queued job cancellation certified.');

  console.log('\n--- 5. Destination health + workspace isolation ---');
  const { rows: targets } = await client.query(`insert into publication_targets(workspace_id,name,target_type,config_json_encrypted,active,created_by) values($1,'Cert target','custom_http','opaque',true,$2) returning id`, [workspaceId, actor.adminUserId]);
  const targetId = targets[0].id;
  for (let i=0;i<5;i++) await client.query(`select cms_record_destination_health($1,'publication_target',$2,false,25,'HTTP_500','failure',false)`, [workspaceId,targetId]);
  let health = (await client.query(`select health_state,consecutive_failures from delivery_destination_health where workspace_id=$1 and destination_id=$2`, [workspaceId,targetId])).rows[0];
  assert(health.health_state === 'unhealthy' && health.consecutive_failures === 5, 'Destination did not become unhealthy after repeated failures');
  await client.query(`select cms_record_destination_health($1,'publication_target',$2,true,10,null,null,false)`, [workspaceId,targetId]);
  health = (await client.query(`select health_state,consecutive_failures from delivery_destination_health where workspace_id=$1 and destination_id=$2`, [workspaceId,targetId])).rows[0];
  assert(health.health_state === 'healthy' && health.consecutive_failures === 0, 'Destination health did not recover after success');
  await expectReject('Cross-workspace destination health injection', () => client.query(`select cms_record_destination_health($1,'publication_target',$2,true,10,null,null,false)`, [otherWorkspaceId,targetId]));
  console.log('[PASS] Destination health degradation/recovery and workspace isolation certified.');

  console.log('\nPHASE 10 FOUNDATION CERTIFICATION: ALL PASSED');
} finally {
  if (otherWorkspaceId) await client.query('delete from workspaces where id=$1', [otherWorkspaceId]).catch(() => {});
  if (workspaceId) await teardownCertification({ client, workspaceId, authUserIds, adminUserIds });
  await second.end();
  await client.end();
}
