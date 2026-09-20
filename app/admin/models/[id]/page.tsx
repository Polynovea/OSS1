"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import CapabilitySelector from "@/components/admin/schema/CapabilitySelector";
import FieldEditor, { toFieldKey } from "@/components/admin/schema/FieldEditor";
import PermissionPolicyEditor from "@/components/admin/schema/PermissionPolicyEditor";
import ApiContractView from "@/components/admin/schema/ApiContractView";
import { AlertTriangle, ArrowLeft, Check, Clock3, Plus, RefreshCw, Save } from "lucide-react";
import { resolveModelCapability, stripDisallowedPermissions, type CanonicalSchema, type FieldDefinition, type ModelCapability, type ModelPermissionPolicy } from "@/lib/schema/fields/types";

interface Model { id: string; name: string; api_key: string; description: string | null; status: string; current_schema_version: number }
interface Version { id: string; version_number: number; schema_json: CanonicalSchema; change_summary: string | null; created_at: string }
interface DiffEntry { fieldKey: string; kind: string; classification: string; summary?: string; reason?: string }
interface SchemaDiff { overallClassification: string; entries: DiffEntry[] }
interface ExistingModel { id: string; name: string; api_key: string }
interface WorkspaceRole { key: string; name: string }
interface EnvironmentRow { id:string; key:string; name:string; kind:string; status:string; is_default?:boolean; deployed_schema_revision?:string|null }
interface DeploymentPlan { environmentId:string; classification:string; currentDeployment?:{schema_version:number;schema_hash:string;status:string;deployed_at:string}|null; requiresApproval:boolean; runId?:string; rollbackGuidance?:string; diff:SchemaDiff }

const emptyField = (): FieldDefinition => ({ key: "", label: "", type: "text", required: false, localized: false, unique: false });
const TABS = ["visual", "advanced", "migration", "api"] as const;
async function authenticatedFetch(input:RequestInfo|URL,init:RequestInit={}){const auth=await getAuthHeaders();if(!auth.Authorization)throw new Error("Admin session unavailable. Please sign in again.");const headers=new Headers(init.headers);for(const[k,v]of Object.entries(auth))headers.set(k,v);if(init.body&&!headers.has("content-type"))headers.set("content-type","application/json");return fetch(input,{...init,headers});}
type Tab = (typeof TABS)[number];

export default function ModelEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [model, setModel] = useState<Model | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [schema, setSchema] = useState<CanonicalSchema | null>(null);
  const [summary, setSummary] = useState("");
  const [diff, setDiff] = useState<SchemaDiff | null>(null);
  const [tab, setTab] = useState<Tab>("visual");
  const [otherModels, setOtherModels] = useState<ExistingModel[]>([]);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [environments,setEnvironments]=useState<EnvironmentRow[]>([]);
  const [environmentId,setEnvironmentId]=useState("");
  const [deploymentPlan,setDeploymentPlan]=useState<DeploymentPlan|null>(null);
  const [notice,setNotice]=useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [modelResponse, versionsResponse, modelsResponse, rolesResponse] = await Promise.all([
        fetch(`/api/models/${id}`),
        fetch(`/api/models/${id}/versions`),
        fetch("/api/models"),
        fetch("/api/workspace/roles"),
      ]);
      const [modelBody, versionsBody, modelsBody, rolesBody] = await Promise.all([
        modelResponse.json(), versionsResponse.json(), modelsResponse.json(), rolesResponse.json(),
      ]);
      if (!modelResponse.ok) throw new Error(modelBody.error || "Model not found");
      if (!versionsResponse.ok) throw new Error(versionsBody.error || "Could not load versions");
      const nextVersions = versionsBody.data || [];
      setModel(modelBody.data); setVersions(nextVersions); setSchema(nextVersions[0]?.schema_json || null);
      if (modelsResponse.ok) setOtherModels((modelsBody.data || []).filter((m: ExistingModel) => m.id !== id));
      if (rolesResponse.ok) setRoles(rolesBody.data || []);
      try{const envResponse=await authenticatedFetch("/api/environments");const envBody=await envResponse.json();if(envResponse.ok){const rows=envBody.data||[];setEnvironments(rows);setEnvironmentId(current=>current||rows.find((e:EnvironmentRow)=>e.kind==="development")?.id||rows.find((e:EnvironmentRow)=>e.is_default)?.id||rows[0]?.id||"");}}catch{}
    } catch (err) { setError(err instanceof Error ? err.message : "Could not load model"); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    setSchema((current) => current ? { ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...patch } : field) } : current);
    setDiff(null);
  }
  function moveField(index: number, direction: -1 | 1) {
    setSchema((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.fields.length) return current;
      const fields = [...current.fields];
      [fields[index], fields[target]] = [fields[target], fields[index]];
      return { ...current, fields };
    });
    setDiff(null);
  }
  function setCapability(capability: ModelCapability) {
    setSchema((current) => current ? { ...current, capability, permissions: stripDisallowedPermissions(capability, current.permissions ?? []) } : current);
    setDiff(null);
  }
  function setPermissions(permissions: ModelPermissionPolicy[]) {
    setSchema((current) => current ? { ...current, permissions } : current);
    setDiff(null);setDeploymentPlan(null);
  }

  async function validate(event: FormEvent) {
    event.preventDefault(); if (!schema) return;
    setBusy(true); setError("");
    try {
      if(environmentId){const response=await authenticatedFetch("/api/infrastructure",{method:"POST",body:JSON.stringify({operation:"schema_plan",environmentId,modelId:id,schema})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Validation failed");setDeploymentPlan(body.data);setDiff(body.data.diff);setTab("migration");}
      else{const response = await fetch(`/api/models/${id}/validate-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schema }) });const body = await response.json(); if (!response.ok) throw new Error(body.error || "Validation failed"); setDiff(body.data.diff); setTab("migration");}
    } catch (err) { setError(err instanceof Error ? err.message : "Validation failed"); }
    finally { setBusy(false); }
  }

  async function apply(acknowledgeUnsafe: boolean) {
    if (!schema) return; setBusy(true); setError("");
    try {
      if(environmentId){const response=await authenticatedFetch("/api/infrastructure",{method:"POST",body:JSON.stringify({operation:"schema_apply",environmentId,modelId:id,schema,changeSummary:summary,acknowledgeUnsafe})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Change was not applied");setNotice(`Schema promoted to ${environments.find(e=>e.id===environmentId)?.name||"environment"}.`);setDiff(null);setDeploymentPlan(null);setSummary("");await load();}
      else{const response = await fetch(`/api/models/${id}/apply-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ schema, changeSummary: summary, acknowledgeUnsafe }) });const body = await response.json();if (!response.ok) { if (response.status === 409 && body.data?.diff) setDiff(body.data.diff); throw new Error(body.error || "Change was not applied"); }setDiff(null); setSummary(""); await load();}
    } catch (err) { setError(err instanceof Error ? err.message : "Change was not applied"); }
    finally { setBusy(false); }
  }

  async function requestSchemaApproval(){if(!environmentId)return;setBusy(true);setError("");try{const response=await authenticatedFetch("/api/infrastructure",{method:"POST",body:JSON.stringify({operation:"approval_request",environmentId,approvalOperation:"schema_promote",entityType:"content_model",entityId:id,reason:summary||`Unsafe schema promotion for ${model?.api_key||id}`,request:{classification:diff?.overallClassification}})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not request approval");setNotice("Approval requested. A different authorized reviewer must approve it in Setup & Infrastructure before production apply.");}catch(err){setError(err instanceof Error?err.message:"Could not request approval");}finally{setBusy(false);}}

  if (loading) return <AdminLayout><div className="flex min-h-[60vh] items-center justify-center text-fg-muted"><RefreshCw className="animate-spin" /></div></AdminLayout>;
  if (!model || !schema) return <AdminLayout><div className="rounded-xl border border-danger bg-danger-muted p-5 text-danger">{error || "Model schema unavailable"}</div></AdminLayout>;

  const unsafe = diff && diff.overallClassification !== "SAFE";
  const noChanges = diff?.entries.length === 0;
  // Self-relations (e.g. Category -> parent Category) are valid — the schema/validation layer
  // already supports a relation field targeting the model it lives on, so the current model
  // belongs in its own target list, not just every OTHER model.
  const relationTargets = [{ apiKey: model.api_key, name: `${model.name} (this model)` }, ...otherModels.map((m) => ({ apiKey: m.api_key, name: m.name }))];
  const capability = resolveModelCapability(schema);

  return (
    <AdminLayout>
      <form onSubmit={validate} className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-subtle pb-5">
          <div className="flex items-center gap-4"><Link href="/admin/models" className="rounded-lg border border-subtle p-2 text-fg-muted hover:text-fg-primary"><ArrowLeft size={17} /></Link><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Schema studio / {model.api_key}</p><h1 className="mt-1 text-3xl font-extrabold">{schema.name}</h1></div></div>
          <div className="flex items-center gap-2"><span className="rounded-full border border-success bg-success-muted px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-success">v{model.current_schema_version} active</span><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"><Save size={14} /> Review changes</button></div>
        </header>
        {error && <div className="rounded-xl border border-danger bg-danger-muted px-4 py-3 text-sm text-danger">{error}</div>}{notice&&<div className="rounded-xl border border-success bg-success-muted px-4 py-3 text-sm text-success">{notice}</div>}

        <nav className="flex gap-1 border-b border-subtle">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wider ${tab === t ? "border-b-2 border-action text-action" : "text-fg-muted hover:text-fg-secondary"}`}>
              {t === "api" ? "API" : t}
            </button>
          ))}
        </nav>

        {tab === "visual" && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="flex flex-col gap-5">
              <div className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
                <div className="grid gap-3 md:grid-cols-2"><label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Display name<input value={schema.name} onChange={(e) => { setSchema({ ...schema, name: e.target.value }); setDiff(null); }} className="mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm normal-case tracking-normal text-fg-primary outline-none focus:border-action/50" /></label><label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Immutable API key<input readOnly value={schema.apiKey} className="mt-2 w-full rounded-lg border border-[#202025] bg-field px-3 py-2.5 font-mono text-sm normal-case tracking-normal text-fg-muted" /></label><label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted md:col-span-2">Model description<textarea value={schema.description ?? ""} onChange={(e) => { setSchema({ ...schema, description: e.target.value || undefined }); setDiff(null); }} rows={2} placeholder="Explain this model to the people who will use it" className="mt-2 w-full resize-none rounded-lg border border-default bg-field px-3 py-2.5 text-sm normal-case tracking-normal text-fg-primary outline-none focus:border-action/50" /></label></div>
              </div>

              <div className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-fg-muted">Capability</p>
                <CapabilitySelector value={capability} onChange={setCapability} />
              </div>

              <div className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
                <div className="mb-4 flex items-center justify-between"><div><h2 className="font-bold">Field architecture</h2><p className="mt-1 text-xs text-fg-muted">{schema.fields.length} registered fields</p></div><button type="button" onClick={() => { setSchema({ ...schema, fields: [...schema.fields, emptyField()] }); setDiff(null); }} className="inline-flex items-center gap-2 rounded-lg border border-action/20 px-3 py-2 text-xs font-bold text-action"><Plus size={14} /> Add field</button></div>
                <div className="space-y-3">
                  {schema.fields.map((field, index) => (
                    <FieldEditor
                      key={`${field.key}-${index}`}
                      field={field}
                      index={index}
                      total={schema.fields.length}
                      onChange={(patch) => updateField(index, patch)}
                      onRemove={() => { setSchema({ ...schema, fields: schema.fields.filter((_, i) => i !== index) }); setDiff(null); }}
                      onMove={(direction) => moveField(index, direction)}
                      relationTargets={relationTargets}
                      otherFieldKeys={schema.fields.filter((f) => f.key !== field.key).map((f) => f.key)}
                    />
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
                <p className="mb-1 text-lg font-bold">Role policy</p>
                <p className="mb-4 text-xs text-fg-muted">Optional intent for who may read/create/edit/publish/archive/delete this model's records.</p>
                <PermissionPolicyEditor policies={schema.permissions ?? []} onChange={setPermissions} roles={roles} capability={capability} />
              </div>
            </section>
            <aside className="flex flex-col gap-4">
              <div className="rounded-2xl border border-subtle bg-surface-1 p-5"><div className="flex items-center gap-2"><Clock3 size={14} className="text-action" /><h2 className="text-xs font-bold uppercase tracking-wider">Version history</h2></div><div className="mt-4 space-y-3">{versions.slice(0, 6).map((version) => <button type="button" key={version.id} onClick={() => { setSchema(version.schema_json); setDiff(null); }} className="w-full border-l border-default pl-3 text-left"><span className="block text-xs font-bold text-fg-secondary">Version {version.version_number}</span><span className="mt-0.5 block text-[10px] text-fg-muted">{version.change_summary || "No change summary"}</span></button>)}</div></div>
              <div className="rounded-2xl border border-subtle bg-surface-1 p-5"><label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Change summary<textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} placeholder="Why is this schema changing?" className="mt-2 w-full resize-none rounded-lg border border-default bg-field px-3 py-2.5 text-sm normal-case tracking-normal text-fg-primary outline-none" /></label></div>
            </aside>
          </div>
        )}

        {tab === "advanced" && (
          <section className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
            <p className="mb-3 text-xs font-bold uppercase tracking-wider text-fg-muted">Canonical schema (exact representation)</p>
            <pre className="max-h-[70vh] overflow-auto rounded-lg border border-subtle bg-field p-4 text-xs text-fg-secondary">{JSON.stringify(schema, null, 2)}</pre>
          </section>
        )}

        {tab === "migration" && (
          <section className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]"><label className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Target environment<select value={environmentId} onChange={(e)=>{setEnvironmentId(e.target.value);setDiff(null);setDeploymentPlan(null);}} className="mt-2 w-full rounded-lg border border-default bg-field px-3 py-2.5 text-sm normal-case tracking-normal text-fg-primary">{environments.length===0&&<option value="">Current workspace only</option>}{environments.map(env=><option key={env.id} value={env.id}>{env.name} · {env.kind} · {env.status}</option>)}</select></label>{deploymentPlan?.currentDeployment&&<div className="self-end rounded-lg border border-subtle bg-field px-3 py-2 text-[10px] text-fg-muted">Deployed v{deploymentPlan.currentDeployment.schema_version}</div>}</div>
            {!diff ? (
              <p className="text-sm text-fg-muted">Click "Review changes" to compute a migration preview before applying.</p>
            ) : (
              <div className={`rounded-2xl border p-5 ${unsafe ? "border-warning bg-warning-muted" : "border-success bg-success-muted"}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex gap-3">{unsafe ? <AlertTriangle className="text-warning" size={20} /> : <Check className="text-success" size={20} />}<div><h2 className="font-bold">{diff.overallClassification.replaceAll("_", " ")}</h2><p className="mt-1 text-xs text-fg-muted">Server-validated migration preview. Nothing has been applied yet.</p></div></div>
                  <div className="flex flex-wrap gap-2">{unsafe&&environments.find(e=>e.id===environmentId)?.kind==="production"&&<button type="button" disabled={busy} onClick={()=>void requestSchemaApproval()} className="rounded-lg border border-warning px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-warning">Request approval</button>}<button type="button" disabled={busy || noChanges} onClick={() => void apply(Boolean(unsafe))} className={`rounded-lg px-4 py-2.5 text-xs font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-50 ${unsafe ? "bg-warning-muted text-warning" : "bg-success-muted text-success"}`}>{noChanges ? "No changes to apply" : unsafe ? "Acknowledge & apply" : "Apply safe change"}</button></div>
                </div>
                {deploymentPlan?.rollbackGuidance&&<p className="mt-3 rounded-lg border border-subtle bg-field p-3 text-xs text-fg-muted"><strong className="text-fg-secondary">Rollback guidance:</strong> {deploymentPlan.rollbackGuidance}</p>}<div className="mt-4 space-y-2">{diff.entries.length === 0 ? <p className="text-sm text-fg-muted">No schema changes detected.</p> : diff.entries.map((entry, index) => <div key={`${entry.fieldKey}-${index}`} className="flex items-center justify-between gap-4 rounded-lg border border-subtle bg-field px-3 py-2 text-xs"><span className="font-mono text-fg-secondary">{entry.fieldKey}</span><span className="text-right text-fg-muted">{entry.reason || entry.summary}</span></div>)}</div>
              </div>
            )}
          </section>
        )}

        {tab === "api" && (
          <section className="rounded-2xl border border-subtle bg-surface-1 p-5 md:p-6">
            <ApiContractView schema={schema} apiKey={model.api_key} modelId={model.id} />
          </section>
        )}
      </form>
    </AdminLayout>
  );
}
