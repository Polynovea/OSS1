"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { Check, GitPullRequest, Loader2, Plus, Save, Trash2 } from "lucide-react";

type Stage = { key: string; label: string; required_approvals: number; required_role_keys: string[] };
type Definition = { id: string; name: string; content_model_id: string | null; active: boolean; definition_json: { self_approval: boolean; approval_stages: Stage[] }; content_models?: { id: string; name: string; api_key: string } | null };
type Model = { id: string; name: string; api_key: string; settings_json?: { capability?: string } };
type Role = { key: string; name: string; description: string | null };

const emptyStage = (index: number): Stage => ({ key: `stage_${index + 1}`, label: `Approval ${index + 1}`, required_approvals: 1, required_role_keys: [] });

export default function WorkflowsPage() {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("Standard Editorial Review");
  const [contentModelId, setContentModelId] = useState("");
  const [selfApproval, setSelfApproval] = useState(false);
  const [active, setActive] = useState(true);
  const [stages, setStages] = useState<Stage[]>([emptyStage(0)]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/workflows");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load workflows");
      setDefinitions(body.data.definitions || []);
      setModels((body.data.models || []).filter((model: Model) => model.settings_json?.capability !== "data_only"));
      setRoles(body.data.roles || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load workflows"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const scopeLabel = useMemo(() => contentModelId ? models.find((model) => model.id === contentModelId)?.name || "Model" : "Workspace default", [contentModelId, models]);
  const reset = () => { setSelectedId(null); setName("Standard Editorial Review"); setContentModelId(""); setSelfApproval(false); setActive(true); setStages([emptyStage(0)]); setError(""); setNotice(""); };
  const edit = (definition: Definition) => { setSelectedId(definition.id); setName(definition.name); setContentModelId(definition.content_model_id || ""); setSelfApproval(Boolean(definition.definition_json?.self_approval)); setActive(definition.active); setStages(definition.definition_json?.approval_stages?.length ? definition.definition_json.approval_stages : [emptyStage(0)]); setNotice(""); setError(""); };
  const updateStage = (index: number, patch: Partial<Stage>) => setStages((current) => current.map((stage, i) => i === index ? { ...stage, ...patch } : stage));
  const removeStage = (index: number) => setStages((current) => current.length === 1 ? current : current.filter((_, i) => i !== index));

  const save = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/workflows", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selectedId, name, contentModelId: contentModelId || null, selfApproval, active, stages }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save workflow");
      setNotice(`Saved ${name} for ${scopeLabel}.`);
      await load();
      if (!selectedId && body.data?.id) setSelectedId(body.data.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save workflow"); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div><p className="ui-eyebrow">Content operations / Governance</p><h1 className="ui-page-title">Editorial Workflows</h1><p className="ui-page-description">Deterministic review stages, approval counts and role gates. No arbitrary process scripting.</p></div>
          <button type="button" onClick={reset} className="ui-btn ui-btn-secondary"><Plus size={14} />New workflow</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}
        {notice ? <div className="ui-alert ui-alert-success mt-5">{notice}</div> : null}

        {loading ? <div className="flex min-h-48 items-center justify-center text-fg-muted"><Loader2 className="animate-spin" /></div> : (
          <div className="grid gap-8 pt-6 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="xl:sticky xl:top-20 xl:self-start">
              <div className="mb-3 flex items-end justify-between"><div><h2 className="text-[13px] font-semibold text-fg-primary">Configured workflows</h2><p className="mt-1 text-[11px] text-fg-muted">{definitions.length} definitions</p></div></div>
              <div className="border-y border-subtle">
                {definitions.length === 0 ? <div className="py-8 text-sm text-fg-muted">No workflow definitions yet.</div> : definitions.map((definition) => <button key={definition.id} type="button" onClick={() => edit(definition)} className={`w-full border-b border-subtle px-2 py-3 text-left last:border-0 ${selectedId === definition.id ? "bg-surface-2" : "hover:bg-surface-2"}`}><div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium text-fg-primary">{definition.name}</span>{definition.active ? <Check size={13} className="text-success" /> : null}</div><p className="mt-1 text-[11px] text-fg-muted">{definition.content_models?.name || "Workspace default"} · {definition.definition_json?.approval_stages?.length || 1} stage(s)</p></button>)}
              </div>
            </aside>

            <main className="min-w-0">
              <section className="grid gap-5 md:grid-cols-2">
                <label><span className="text-[12px] font-medium text-fg-secondary">Workflow name</span><input value={name} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></label>
                <label><span className="text-[12px] font-medium text-fg-secondary">Scope</span><select value={contentModelId} onChange={(e) => setContentModelId(e.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="">Workspace default</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} ({model.api_key})</option>)}</select></label>
              </section>

              <section className="mt-6 flex flex-wrap gap-6 border-y border-subtle py-4"><label className="flex items-center gap-2 text-[12px] text-fg-secondary"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-primary" />Active definition</label><label className="flex items-center gap-2 text-[12px] text-fg-secondary"><input type="checkbox" checked={selfApproval} onChange={(e) => setSelfApproval(e.target.checked)} className="accent-primary" />Allow requester self-approval</label></section>

              <section className="ui-section">
                <div className="flex items-end justify-between gap-4"><div><h2 className="ui-section-title">Approval stages</h2><p className="ui-section-description">Each stage completes only after its approval threshold is met.</p></div><button type="button" disabled={stages.length >= 8} onClick={() => setStages((current) => [...current, emptyStage(current.length)])} className="ui-btn ui-btn-secondary disabled:opacity-40"><Plus size={12} />Stage</button></div>
                <div className="mt-5 space-y-6">{stages.map((stage, index) => <div key={`${stage.key}-${index}`} className="border-t border-subtle pt-5 first:border-t-0 first:pt-0"><div className="flex items-center justify-between"><span className="flex items-center gap-2 text-[12px] font-semibold text-review"><GitPullRequest size={13} />Stage {index + 1}</span><button type="button" disabled={stages.length === 1} onClick={() => removeStage(index)} className="rounded-lg p-1.5 text-icon-muted hover:bg-danger-muted hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button></div><div className="mt-4 grid gap-4 md:grid-cols-[1fr_160px]"><label><span className="text-[12px] font-medium text-fg-secondary">Label</span><input value={stage.label} onChange={(e) => updateStage(index,{ label:e.target.value,key:e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,"_") })} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></label><label><span className="text-[12px] font-medium text-fg-secondary">Approvals required</span><input type="number" min={1} max={10} value={stage.required_approvals} onChange={(e) => updateStage(index,{ required_approvals:Number(e.target.value) || 1 })} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></label></div><div className="mt-4"><p className="text-[11px] text-fg-muted">Allowed workspace roles · leave empty for any publishing-capable reviewer</p><div className="mt-2 flex flex-wrap gap-2">{roles.map((role) => <label key={role.key} title={role.description || role.name} className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] ${stage.required_role_keys.includes(role.key) ? "border-review bg-review-muted text-review" : "border-subtle text-fg-muted"}`}><input type="checkbox" className="sr-only" checked={stage.required_role_keys.includes(role.key)} onChange={(e) => updateStage(index,{ required_role_keys:e.target.checked ? [...stage.required_role_keys, role.key] : stage.required_role_keys.filter((key) => key !== role.key) })} />{role.name}</label>)}</div></div></div>)}</div>
              </section>

              <div className="flex justify-end border-t border-subtle pt-5"><button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="ui-btn ui-btn-primary disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save workflow</button></div>
            </main>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
