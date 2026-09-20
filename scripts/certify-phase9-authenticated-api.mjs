import { createPgClient, createDisposableWorkspace, createAuthenticatedActor, teardownCertification } from './cert-harness.mjs';

const client=await createPgClient();
const BASE_URL=process.env.CMS_CERT_BASE_URL||'http://localhost:3000';
let workspaceId=null;const authUserIds=[];const adminUserIds=[];
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function fetchJson(path,init={}){const response=await fetch(`${BASE_URL}${path}`,init);let body=null;try{body=await response.json()}catch{}return{response,body}}
async function createModel(actorId){const api=`p9_http_${Date.now()}`;const schema={name:'P9 API Page',apiKey:api,capability:'publishable',fields:[{key:'title',label:'Title',type:'text',required:true,localized:false,unique:false},{key:'meta_description',label:'Meta description',type:'long_text',required:false,localized:false,unique:false}],permissions:[]};const {rows:[m]}=await client.query(`insert into content_models(workspace_id,name,api_key,status,current_schema_version,settings_json,created_by) values($1,'P9 API Page',$2,'active',1,'{"capability":"publishable"}'::jsonb,$3) returning id`,[workspaceId,api,actorId]);await client.query(`insert into content_model_versions(content_model_id,version_number,schema_json,schema_hash,change_summary,created_by) values($1,1,$2::jsonb,$3,'p9 http',$4)`,[m.id,JSON.stringify(schema),`p9-${Date.now()}`,actorId]);return m.id;}
async function createEntry(modelId,actorId){const {rows:[e]}=await client.query(`insert into content_entries(workspace_id,content_model_id,status,created_by,updated_by) values($1,$2,'approved',$3,$3) returning id`,[workspaceId,modelId,actorId]);const {rows:[v]}=await client.query(`insert into content_entry_versions(entry_id,model_schema_version,version_number,data_jsonb,locale,state,created_by,change_summary) values($1,1,1,$2::jsonb,'en','approved',$3,'p9 http') returning id`,[e.id,JSON.stringify({title:'Phase 9 API entry',meta_description:'A sufficiently descriptive Phase 9 API certification page for assurance checks.'}),actorId]);await client.query(`update content_entries set current_draft_version_id=$2 where id=$1`,[e.id,v.id]);return{entryId:e.id,versionId:v.id};}
try{
 console.log('=== PHASE 9 AUTHENTICATED APPLICATION API CERTIFICATION ===');
 const ws=await createDisposableWorkspace(client,'p9-http');workspaceId=ws.id;
 const admin=await createAuthenticatedActor(client,workspaceId,{role:'admin',permissions:['workspace.manage','content.entry.read','routing.read','routing.manage'],emailPrefix:'p9-http-admin'});
 const viewer=await createAuthenticatedActor(client,workspaceId,{role:'viewer',permissions:['content.entry.read','routing.read'],emailPrefix:'p9-http-viewer'});
 for(const a of [admin,viewer]){authUserIds.push(a.authUserId);adminUserIds.push(a.adminUserId)}
 await client.query(`insert into workspace_locales(workspace_id,locale,enabled,required,is_default) values($1,'en',true,true,true) on conflict(workspace_id,locale) do update set enabled=true,required=true,is_default=true`,[workspaceId]);

 console.log('\n--- 1. Real HTTP authorization boundary ---');
 let r=await fetchJson('/api/web-quality',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({siteBaseUrl:'https://example.test'})});assert(r.response.status===401,`Expected 401, got ${r.response.status}`);
 r=await fetchJson('/api/web-quality',{method:'PUT',headers:viewer.headers,body:JSON.stringify({siteBaseUrl:'https://example.test'})});assert(r.response.status===403,`Expected 403, got ${r.response.status}`);
 console.log('[PASS] Web Quality mutation enforces real 401/403 boundaries.');

 console.log('\n--- 2. Web Quality policy + robots/sitemap/audit APIs ---');
 r=await fetchJson('/api/web-quality',{method:'PUT',headers:admin.headers,body:JSON.stringify({siteBaseUrl:'https://example.test',siteName:'P9 Cert',robotsEnabled:true,sitemapEnabled:true,requireCanonicalRoute:true,requireSocialCard:false,requireSchemaOrg:false,aiCrawlerPolicy:{default:'allow',GPTBot:'disallow'},mediaBudget:{maxImageBytes:2097152,lcpWarningBytes:786432,minLcpWidth:1200},settings:{warnNoindexOnCanonical:true}})});assert(r.response.status===200&&r.body?.success,`Policy save failed ${JSON.stringify(r.body)}`);
 const policy=await fetchJson('/api/web-quality',{headers:viewer.headers});assert(policy.response.status===200&&policy.body?.data?.site_base_url==='https://example.test','Policy readback failed');
 const robots=await fetchJson('/api/web-quality/robots',{headers:viewer.headers});assert(robots.response.status===200&&robots.body?.data?.text?.includes('GPTBot'),'robots output missing AI crawler policy');
 const sitemap0=await fetchJson('/api/web-quality/sitemap',{headers:viewer.headers});assert(sitemap0.response.status===200,'sitemap endpoint failed');
 const audit=await fetchJson('/api/web-quality/audit',{headers:viewer.headers});assert(audit.response.status===200&&audit.body?.success,'site audit endpoint failed');
 console.log('[PASS] Policy, robots, sitemap and site audit APIs certified.');

 console.log('\n--- 3. Route discoverability + canonical preflight integration ---');
 const modelId=await createModel(admin.adminUserId);const entry=await createEntry(modelId,admin.adminUserId);
 let pre=await fetchJson(`/api/entries/${entry.entryId}/preflight`,{headers:viewer.headers});assert(pre.response.status===200&&pre.body?.success,'preflight endpoint failed');assert(pre.body.data.results.some(x=>x.rule_id==='destination.canonical_route'&&x.status==='fail'),'missing canonical route was not a blocker');
 const {rows:[route]}=await client.query(`insert into content_routes(workspace_id,entry_id,locale,path,title,is_canonical,status) values($1,$2,'en','/phase9-http','P9 HTTP',true,'active') returning id`,[workspaceId,entry.entryId]);
 r=await fetchJson(`/api/routes/${route.id}/discoverability`,{method:'PUT',headers:viewer.headers,body:JSON.stringify({indexingPolicy:'noindex',sitemapIncluded:true})});assert(r.response.status===403,`Expected routing.manage 403, got ${r.response.status}`);
 r=await fetchJson(`/api/routes/${route.id}/discoverability`,{method:'PUT',headers:admin.headers,body:JSON.stringify({indexingPolicy:'noindex',sitemapIncluded:true,sitemapPriority:0.5,sitemapChangefreq:'weekly'})});assert(r.response.status===200&&r.body?.success,'discoverability update failed');
 pre=await fetchJson(`/api/entries/${entry.entryId}/preflight`,{headers:viewer.headers});assert(pre.response.status===200,'preflight after route failed');assert(pre.body.data.results.some(x=>x.rule_id==='destination.canonical_route'&&x.status==='pass'),'canonical route did not satisfy destination rule');assert(pre.body.data.results.some(x=>x.rule_id==='seo.noindex_sitemap_conflict'&&x.status==='fail'),'noindex+sitemap conflict was not surfaced');
 r=await fetchJson(`/api/routes/${route.id}/discoverability`,{method:'PUT',headers:admin.headers,body:JSON.stringify({indexingPolicy:'index',sitemapIncluded:true,sitemapPriority:0.5,sitemapChangefreq:'weekly'})});assert(r.response.status===200,'discoverability repair failed');
 console.log('[PASS] Route-level indexing policy feeds canonical entry preflight and permission checks.');

 console.log('\n--- 4. Impact graph API ---');
 const impact=await fetchJson(`/api/entries/${entry.entryId}/impact`,{headers:viewer.headers});assert(impact.response.status===200&&impact.body?.success,'impact endpoint failed');assert(Array.isArray(impact.body.data?.destinations),'impact destinations missing');assert(impact.body.data.destinations.some(d=>d.path==='/phase9-http'),'canonical destination absent from impact graph');
 console.log('[PASS] Rich impact graph is exposed through the authenticated application boundary.');

 console.log('\nPHASE 9 AUTHENTICATED APPLICATION API CERTIFICATION: ALL PASSED');
}finally{
 if(workspaceId){await client.query('delete from content_entries where workspace_id=$1',[workspaceId]).catch(()=>{});await client.query('delete from content_models where workspace_id=$1',[workspaceId]).catch(()=>{});}
 await teardownCertification({client,workspaceId,authUserIds,adminUserIds});await client.end();
}
