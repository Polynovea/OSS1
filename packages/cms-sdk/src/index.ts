export type CmsRequestOptions = { signal?: AbortSignal; requestId?: string };
export type SchemaBundle = { format:"polynovea-cms-schema-bundle"; formatVersion:1; environment?:string|null; generatedAt:string; models:Array<{apiKey:string;name:string;version:number;schemaHash:string;schema:Record<string,unknown>;description?:string|null;icon?:string|null}> };
export class PolynoveaCmsError extends Error { constructor(public status:number,public code:string,message:string,public details?:unknown,public requestId?:string){super(message);this.name="PolynoveaCmsError";} }

export class PolynoveaCMS {
  readonly baseUrl:string; readonly token:string;
  constructor(options:{baseUrl:string;token:string}){this.baseUrl=options.baseUrl.replace(/\/$/,"");this.token=options.token;}
  private async request<T>(path:string,init:RequestInit={},options:CmsRequestOptions={}):Promise<T>{const headers=new Headers(init.headers);headers.set("authorization",`Bearer ${this.token}`);if(options.requestId)headers.set("x-request-id",options.requestId);if(init.body&&!(init.body instanceof FormData)&&!headers.has("content-type"))headers.set("content-type","application/json");const response=await fetch(`${this.baseUrl}${path}`,{...init,headers,signal:options.signal});const body=await response.json().catch(()=>null);if(!response.ok){const err=body?.error??{};throw new PolynoveaCmsError(response.status,String(err.code??"HTTP_ERROR"),String(err.message??response.statusText),err.details,body?.meta?.requestId);}return body?.data as T;}
  private json(method:string,body:unknown):RequestInit{return{method,body:JSON.stringify(body)};}

  readonly published={
    list:<T=unknown>(model:string,query:{locale?:string;limit?:number;offset?:number}={})=>{const p=new URLSearchParams();if(query.locale)p.set("locale",query.locale);if(query.limit)p.set("limit",String(query.limit));if(query.offset)p.set("offset",String(query.offset));return this.request<T[]>(`/api/v1/content/${encodeURIComponent(model)}?${p}`);},
    get:<T=unknown>(model:string,id:string)=>this.request<T>(`/api/v1/content/${encodeURIComponent(model)}/${encodeURIComponent(id)}`),
  };
  readonly models={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/models"),
    create:<T=unknown>(schema:Record<string,unknown>,options:{description?:string;icon?:string}={})=>this.request<T>("/api/v1/models",this.json("POST",{schema,...options})),
    pull:<T=SchemaBundle>(apiKey:string)=>this.request<T>(`/api/v1/models/${encodeURIComponent(apiKey)}`),
    diff:<T=unknown>(apiKey:string,schema:Record<string,unknown>)=>this.request<T>(`/api/v1/models/${encodeURIComponent(apiKey)}/diff`,this.json("POST",{schema})),
    push:<T=unknown>(apiKey:string,schema:Record<string,unknown>,options:{acknowledgeUnsafe?:boolean;approvalNote?:string;description?:string;icon?:string}={})=>this.request<T>(`/api/v1/models/${encodeURIComponent(apiKey)}`,this.json("PUT",{schema,...options})),
  };
  readonly entries={
    list:<T=unknown>(query:{model?:string;status?:string;locale?:string;limit?:number;offset?:number}={})=>{const p=new URLSearchParams();for(const[k,v]of Object.entries(query))if(v!==undefined)p.set(k,String(v));return this.request<T[]>(`/api/v1/entries?${p}`);},
    get:<T=unknown>(id:string)=>this.request<T>(`/api/v1/entries/${encodeURIComponent(id)}`),
    create:<T=unknown>(model:string,data:Record<string,unknown>,options:{locale?:string;changeSummary?:string}={})=>this.request<T>("/api/v1/entries",this.json("POST",{model,data,...options})),
    update:<T=unknown>(id:string,data:Record<string,unknown>,options:{locale?:string;changeSummary?:string;expectedVersionNumber?:number}={})=>this.request<T>(`/api/v1/entries/${encodeURIComponent(id)}`,this.json("PUT",{data,...options})),
    workflow:<T=unknown>(id:string,action:"submit"|"approve"|"request_changes",comment?:string)=>this.request<T>(`/api/v1/entries/${encodeURIComponent(id)}/workflow`,this.json("POST",{action,comment})),
    publish:<T=unknown>(id:string)=>this.request<T>(`/api/v1/entries/${encodeURIComponent(id)}/publish`,{method:"POST"}),
  };
  readonly releases={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/releases"),
    get:<T=unknown>(id:string)=>this.request<T>(`/api/v1/releases/${encodeURIComponent(id)}`),
    create:<T=unknown>(input:{name:string;description?:string;itemVersionIds:string[];locales?:string[]})=>this.request<T>("/api/v1/releases",this.json("POST",input)),
    transition:<T=unknown>(id:string,input:{action:"approve"|"request_changes"|"schedule"|"cancel";scheduledFor?:string;comment?:string})=>this.request<T>(`/api/v1/releases/${encodeURIComponent(id)}/transition`,this.json("POST",input)),
    publish:<T=unknown>(id:string)=>this.request<T>(`/api/v1/releases/${encodeURIComponent(id)}/publish`,{method:"POST"}),
  };
  readonly media={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/media"),
    upload:<T=unknown>(file:File,options:{folder?:string;altText?:string;caption?:string}={})=>{const form=new FormData();form.set("file",file);for(const[k,v]of Object.entries(options))if(v!==undefined)form.set(k,v);return this.request<T>("/api/v1/media",{method:"POST",body:form});},
  };
  readonly schema={
    bundle:<T=SchemaBundle>(environment?:string)=>this.request<T>(`/api/v1/schema/bundle${environment?`?environment=${encodeURIComponent(environment)}`:""}`),
    dryRun:<T=unknown>(bundle:SchemaBundle,targetEnvironment?:string)=>this.request<T>("/api/v1/schema/promote",this.json("POST",{bundle,dryRun:true,targetEnvironment})),
    promote:<T=unknown>(bundle:SchemaBundle,options:{acknowledgeUnsafe?:boolean;approvalNote?:string;targetEnvironment?:string}={})=>this.request<T>("/api/v1/schema/promote",this.json("POST",{bundle,dryRun:false,...options})),
    runs:<T=unknown>()=>this.request<T[]>("/api/v1/schema/runs"),
  };
  readonly imports={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/imports"),
    dryRun:<T=unknown>(input:{model:string;format:"json"|"csv"|"markdown"|"wordpress";content:unknown;mapping?:Record<string,string>;locale?:string;sourceName?:string})=>this.request<T>("/api/v1/imports",this.json("POST",{...input,commit:false})),
    commit:<T=unknown>(input:{model:string;format:"json"|"csv"|"markdown"|"wordpress";content:unknown;mapping?:Record<string,string>;locale?:string;sourceName?:string;continueOnError?:boolean})=>this.request<T>("/api/v1/imports",this.json("POST",{...input,commit:true})),
  };
  readonly environments={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/environments"),
    get:<T=unknown>(id:string)=>this.request<T>(`/api/v1/environments/${encodeURIComponent(id)}`),
    create:<T=unknown>(input:{key:string;name:string;kind:"local"|"development"|"staging"|"production"|"custom";isDefault?:boolean;cmsBaseUrl?:string|null;publicSiteUrls?:string[];databaseProvider?:string|null;storageProvider?:string|null;runtimeProvider?:string|null;secretProviderKind?:string})=>this.request<T>("/api/v1/environments",this.json("POST",input)),
    update:<T=unknown>(id:string,input:Record<string,unknown>)=>this.request<T>(`/api/v1/environments/${encodeURIComponent(id)}`,this.json("PATCH",input)),
  };
  readonly connections={
    list:<T=unknown>()=>this.request<T[]>("/api/v1/connections"),
    catalog:<T=unknown>()=>this.request<T[]>("/api/v1/connections?catalog=1"),
    create:<T=unknown>(input:{environmentId:string;connectorType:string;name:string;config?:Record<string,unknown>;secretProviderId?:string|null;credentials?:Array<{purpose:string;value?:string|null;locator?:string|null}>})=>this.request<T>("/api/v1/connections",this.json("POST",input)),
    verify:<T=unknown>(id:string)=>this.request<T>(`/api/v1/connections/${encodeURIComponent(id)}/verify`,{method:"POST"}),
    rotateCredential:<T=unknown>(id:string,input:{purpose:string;value?:string|null;locator?:string|null;approvalRequestId?:string|null})=>this.request<T>(`/api/v1/connections/${encodeURIComponent(id)}/credentials`,this.json("POST",input)),
  };
  readonly operationalIntelligence={
    overview:<T=unknown>(environmentId?:string)=>this.request<T>(`/api/v1/operational-intelligence${environmentId?`?environmentId=${encodeURIComponent(environmentId)}`:""}`),
    operate:<T=unknown>(operation:string,input:Record<string,unknown>)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation,...input})),
    discover:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"discover",environmentId})),
    generateDesiredState:<T=unknown>(environmentId:string,activate=true,changeNote?:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"desired_generate",environmentId,activate,changeNote})),
    createDesiredState:<T=unknown>(environmentId:string,desired:Record<string,unknown>,activate=false,changeNote?:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"desired_create",environmentId,desired,activate,changeNote})),
    activateDesiredState:<T=unknown>(environmentId:string,revisionId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"desired_activate",environmentId,revisionId})),
    reconcile:<T=unknown>(environmentId:string,desiredStateRevisionId?:string|null)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"reconcile",environmentId,desiredStateRevisionId})),
    plan:<T=unknown>(environmentId:string,input:{desiredStateRevisionId?:string|null;reconciliationRunId?:string|null;name?:string|null}={})=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"plan",environmentId,...input})),
    simulate:<T=unknown>(environmentId:string,planId:string,approvalRequestId?:string|null)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"simulate",environmentId,planId,approvalRequestId})),
    assessSchemaChange:<T=unknown>(environmentId:string,modelId:string,schema?:Record<string,unknown>)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"assess_schema_change",environmentId,modelId,schema})),
    executeMigration:<T=unknown>(environmentId:string,assessmentId:string,strategyKey:string,input:Record<string,unknown>={},maxBatches?:number)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"migration_execute",environmentId,assessmentId,strategyKey,input,maxBatches})),
    comparePlan:<T=unknown>(environmentId:string,planId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"plan_compare",environmentId,planId})),
    selectScenario:<T=unknown>(environmentId:string,comparisonId:string,scenarioKey:string,reason?:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"plan_select",environmentId,comparisonId,scenarioKey,reason})),
    predictPlan:<T=unknown>(environmentId:string,planId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_predict_plan",environmentId,planId})),
    predictRemediation:<T=unknown>(environmentId:string,remediationKey:string,subjectId?:string|null)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_predict_remediation",environmentId,remediationKey,subjectId})),
    train:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_train",environmentId})),
    remediate:<T=unknown>(environmentId:string,remediationKey:string,input:{targetType?:string;targetId?:string|null;sourceDriftItemId?:string|null;executionMode?:"manual"|"approval_execute";desiredStateRevisionId?:string|null}={})=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"remediation_execute",environmentId,remediationKey,...input})),
    requestApproval:<T=unknown>(environmentId:string,planId:string,reason?:string,planChecksum?:string|null)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"approval_request",environmentId,planId,reason,planChecksum})),
    execute:<T=unknown>(environmentId:string,planId:string,approvalRequestId?:string|null)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"execute",environmentId,planId,approvalRequestId})),
    autoRepair:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"auto_repair",environmentId})),
    updateAutonomyPolicy:<T=unknown>(environmentId:string,input:{mode:"diagnose_only"|"recommend"|"approval_execute"|"policy_auto_repair";allowedRemediationKeys?:string[];maxDeterministicClassification?:"safe"|"requires_lock"|"requires_backfill";settings?:Record<string,unknown>})=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"policy_update",environmentId,...input})),
    updateLearningPolicy:<T=unknown>(environmentId:string,input:{localLearningEnabled:boolean;crossInstallLearningOptIn:boolean;contentLevelFeaturesEnabled?:boolean;retentionDays?:number})=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_policy_update",environmentId,...input})),
    feedback:<T=unknown>(environmentId:string,predictionId:string,feedbackType:"accepted"|"rejected"|"corrected"|"overridden",input:{correctedLabel?:string;reason?:string;metadata?:Record<string,unknown>}={})=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_feedback",environmentId,predictionId,feedbackType,...input})),
    evaluateOnline:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_evaluate_online",environmentId})),
    enforceRetention:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/operational-intelligence",this.json("POST",{operation:"ml_retention_enforce",environmentId})),
  };
  readonly infrastructure={
    overview:<T=unknown>(environmentId?:string)=>this.request<T>(`/api/v1/infrastructure${environmentId?`?environmentId=${encodeURIComponent(environmentId)}`:""}`),
    operate:<T=unknown>(operation:string,input:Record<string,unknown>={})=>this.request<T>("/api/v1/infrastructure",this.json("POST",{operation,...input})),
    doctor:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/infrastructure",this.json("POST",{operation:"doctor",environmentId})),
    provision:<T=unknown>(environmentId:string,providerKind:"managed"|"postgres"|"supabase"|"local",provisionOperation:"preflight"|"initialize"|"upgrade"|"verify"|"repair"="preflight")=>this.request<T>("/api/v1/infrastructure",this.json("POST",{operation:"provision",environmentId,providerKind,provisionOperation})),
    backup:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/infrastructure",this.json("POST",{operation:"backup",environmentId})),
    portability:<T=unknown>(environmentId:string)=>this.request<T>("/api/v1/infrastructure",this.json("POST",{operation:"portability",environmentId})),
  };
  exportWorkspace=<T=unknown>()=>this.request<T>("/api/v1/export");
  openApi=<T=unknown>()=>this.request<T>("/api/v1/openapi.json");
}
