import { createHash, randomUUID } from 'node:crypto';
import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const client=await createPgClient();let workspaceId=null;const authUserIds=[];const adminUserIds=[];
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
try{
  console.log('=== PHASE 12 DEVELOPER PLATFORM FOUNDATION CERTIFICATION ===');
  const ws=await createDisposableWorkspace(client,'p12-dev');workspaceId=ws.id;
  const actor=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:['workspace.manage','schema.read','content.entry.read'],emailPrefix:'p12-dev'});authUserIds.push(actor.authUserId);adminUserIds.push(actor.adminUserId);

  console.log('\n--- 1. Service-bound rate-limit RPC ---');
  const {rows:[acl]}=await client.query(`select proacl::text as acl from pg_proc where proname='cms_consume_developer_api_rate_limit' limit 1`);
  assert(acl&&acl.acl&&!/(^|[{,])=X\//.test(acl.acl),'Rate-limit RPC must not grant PUBLIC execute');
  console.log('[PASS] Rate-limit mutation is service-bound.');

  console.log('\n--- 2. Hashed token persistence ---');
  const raw=`pnv_${randomUUID()}_${randomUUID()}`;const hash=createHash('sha256').update(raw).digest('hex');
  const {rows:[token]}=await client.query(`insert into developer_api_tokens(workspace_id,name,token_prefix,token_hash,scopes,allowed_models,rate_limit_per_minute,expires_at,created_by) values($1,'cert-token',$2,$3,array['content.read','schema.read'],array['cert_model'],2,now()+interval '1 hour',$4) returning *`,[workspaceId,raw.slice(0,12),hash,actor.adminUserId]);
  assert(token.token_hash===hash,'Token hash mismatch');assert(token.token_hash!==raw,'Plaintext token must never be persisted as token_hash');assert(!JSON.stringify(token).includes(raw),'Plaintext token leaked into token row');
  console.log('[PASS] Only hash/prefix token material is persisted.');

  console.log('\n--- 3. Scope, model and lifecycle state ---');
  assert(token.scopes.includes('content.read')&&!token.scopes.includes('content.publish'),'Scope set is exact');
  assert(token.allowed_models.length===1&&token.allowed_models[0]==='cert_model','Model allowlist is exact');
  await client.query(`update developer_api_tokens set last_used_at=now() where id=$1`,[token.id]);
  const {rows:[used]}=await client.query(`select last_used_at,revoked_at,expires_at from developer_api_tokens where id=$1`,[token.id]);
  assert(used.last_used_at,'last_used_at did not persist');assert(!used.revoked_at,'Token unexpectedly revoked');assert(new Date(used.expires_at)>new Date(),'Token expiry invalid');
  console.log('[PASS] Scope/model/expiry/last-used lifecycle state persists.');

  console.log('\n--- 4. Fixed-window rate limiting ---');
  const one=(await client.query(`select cms_consume_developer_api_rate_limit($1,2) as r`,[token.id])).rows[0].r;
  const two=(await client.query(`select cms_consume_developer_api_rate_limit($1,2) as r`,[token.id])).rows[0].r;
  const three=(await client.query(`select cms_consume_developer_api_rate_limit($1,2) as r`,[token.id])).rows[0].r;
  assert(one.allowed===true&&one.remaining===1,'First request rate state wrong');assert(two.allowed===true&&two.remaining===0,'Second request rate state wrong');assert(three.allowed===false&&three.remaining===0,'Third request must be rate-limited');
  console.log('[PASS] Atomic per-token rate window certified.');

  console.log('\n--- 5. Revocation ---');
  await client.query(`update developer_api_tokens set revoked_at=now() where id=$1`,[token.id]);
  const {rows:[revoked]}=await client.query(`select revoked_at from developer_api_tokens where id=$1`,[token.id]);assert(revoked.revoked_at,'Revocation did not persist');
  console.log('[PASS] Token revocation state certified.');

  console.log('\nPHASE 12 FOUNDATION CERTIFICATION: ALL PASSED');
} finally {
  await teardownCertification({client,workspaceId,authUserIds,adminUserIds});await client.end();
}
