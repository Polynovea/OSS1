"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import CapabilitySelector from "@/components/admin/schema/CapabilitySelector";
import FieldEditor, { toFieldKey } from "@/components/admin/schema/FieldEditor";
import PermissionPolicyEditor from "@/components/admin/schema/PermissionPolicyEditor";
import { ArrowLeft, Check, Plus } from "lucide-react";
import { stripDisallowedPermissions, type CanonicalSchema, type FieldDefinition, type ModelCapability, type ModelPermissionPolicy } from "@/lib/schema/fields/types";
import { MODEL_TEMPLATES } from "@/lib/schema/templates";

interface ExistingModel { id: string; name: string; api_key: string }
interface WorkspaceRole { key: string; name: string }

const emptyField = (): FieldDefinition => ({ key: "", label: "", type: "text", required: false, localized: false, unique: false });
type CreateMode = "blank" | "template" | "clone";

export default function NewModelPage() {
  const router = useRouter();
  const [mode, setMode] = useState<CreateMode>("blank");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [description, setDescription] = useState("");
  const [capability, setCapability] = useState<ModelCapability>("content_enabled");
  const [fields, setFields] = useState<FieldDefinition[]>([emptyField()]);
  const [permissions, setPermissions] = useState<ModelPermissionPolicy[]>([]);
  const [existingModels, setExistingModels] = useState<ExistingModel[]>([]);
  const [roles, setRoles] = useState<WorkspaceRole[]>([]);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const [modelsRes, rolesRes] = await Promise.all([fetch("/api/models"), fetch("/api/workspace/roles")]);
      const [modelsBody, rolesBody] = await Promise.all([modelsRes.json(), rolesRes.json()]);
      if (modelsRes.ok) setExistingModels(modelsBody.data || []);
      if (rolesRes.ok) setRoles(rolesBody.data || []);
    })();
  }, []);

  function changeCapability(next: ModelCapability) {
    setCapability(next);
    setPermissions((current) => stripDisallowedPermissions(next, current));
  }

  function applyTemplate(templateKey: string) {
    const template = MODEL_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    setCapability(template.schema.capability ?? "content_enabled");
    setFields(template.schema.fields.map((f) => ({ ...f })));
    setPermissions(template.schema.permissions ? [...template.schema.permissions] : []);
  }

  const applyClone = useCallback(async (modelId: string) => {
    if (!modelId) return;
    const response = await fetch(`/api/models/${modelId}/versions`);
    const body = await response.json();
    if (!response.ok) { setError(body.error || "Could not load model to clone"); return; }
    const latest: { schema_json: CanonicalSchema } | undefined = body.data?.[0];
    if (!latest) return;
    setCapability(latest.schema_json.capability ?? "content_enabled");
    setFields(latest.schema_json.fields.map((f) => ({ ...f })));
    setPermissions(latest.schema_json.permissions ? [...latest.schema_json.permissions] : []);
  }, []);

  function updateField(index: number, patch: Partial<FieldDefinition>) {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }
  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const schema = { name, apiKey, description, capability, fields, permissions: permissions.length ? permissions : undefined };
      const response = await fetch("/api/models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, schema }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create model");
      router.push(`/admin/models/${body.data.model.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create model");
    } finally {
      setSaving(false);
    }
  }

  // Self-relations (e.g. Category -> parent Category) are valid, so the model being created
  // belongs in its own target list once it has a usable apiKey — not excluded like a name
  // collision would need to be.
  const relationTargets = [
    ...(apiKey ? [{ apiKey, name: `${name || apiKey} (this model)` }] : []),
    ...existingModels.map((m) => ({ apiKey: m.api_key, name: m.name })).filter((t) => t.apiKey !== apiKey),
  ];

  return (
    <AdminLayout>
      <form onSubmit={submit} className="mx-auto flex max-w-5xl flex-col gap-6">
        <header className="flex items-center justify-between border-b border-subtle pb-5">
          <div className="flex items-center gap-4">
            <Link href="/admin/models" className="rounded-lg border border-subtle p-2 text-fg-muted hover:text-fg-primary"><ArrowLeft size={17} /></Link>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Schema studio / New</p><h1 className="mt-1 text-3xl font-extrabold">CREATE MODEL</h1></div>
          </div>
          <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"><Check size={15} />{saving ? "Creating…" : "Create model"}</button>
        </header>
        {error && <div className="rounded-xl border border-danger bg-danger-muted px-4 py-3 text-sm text-danger">{error}</div>}

        <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
          <p className="text-xs font-bold uppercase tracking-wider text-fg-muted">Start from</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["blank", "template", "clone"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider ${mode === m ? "ui-btn ui-btn-primary" : "border border-subtle text-fg-secondary hover:text-fg-primary"}`}>
                {m === "blank" ? "Blank" : m === "template" ? "Template" : "Clone existing"}
              </button>
            ))}
          </div>
          {mode === "template" && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {MODEL_TEMPLATES.map((template) => (
                <button key={template.key} type="button" onClick={() => applyTemplate(template.key)} className="rounded-lg border border-subtle p-3 text-left hover:border-action/40">
                  <p className="text-sm font-bold text-fg-primary">{template.label}</p>
                  <p className="mt-1 text-xs text-fg-muted">{template.description}</p>
                </button>
              ))}
            </div>
          )}
          {mode === "clone" && (
            <div className="mt-4">
              <select
                value={cloneSourceId}
                onChange={(e) => { setCloneSourceId(e.target.value); void applyClone(e.target.value); }}
                className="w-full rounded-lg border border-default bg-field px-3.5 py-3 text-sm text-fg-primary outline-none"
              >
                <option value="">Select a model to clone fields from…</option>
                {existingModels.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.api_key})</option>)}
              </select>
            </div>
          )}
        </section>

        <section className="grid gap-4 rounded-2xl border border-subtle bg-surface-1 p-6 md:grid-cols-2">
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">Model name<input required value={name} onChange={(e) => { setName(e.target.value); if (!apiKey || apiKey === toFieldKey(name)) setApiKey(toFieldKey(e.target.value)); }} placeholder="Blog Post" className="mt-2 w-full rounded-lg border border-default bg-field px-3.5 py-3 text-sm font-medium normal-case tracking-normal text-fg-primary outline-none focus:border-action/50" /></label>
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted">API key<input required pattern="[a-z][a-z0-9_]*" value={apiKey} onChange={(e) => setApiKey(toFieldKey(e.target.value))} placeholder="blog_post" className="mt-2 w-full rounded-lg border border-default bg-field px-3.5 py-3 font-mono text-sm font-medium normal-case tracking-normal text-action outline-none focus:border-action/50" /></label>
          <label className="text-xs font-bold uppercase tracking-wider text-fg-muted md:col-span-2">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-2 w-full resize-none rounded-lg border border-default bg-field px-3.5 py-3 text-sm font-medium normal-case tracking-normal text-fg-primary outline-none focus:border-action/50" /></label>
        </section>

        <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-fg-muted">Capability</p>
          <CapabilitySelector value={capability} onChange={changeCapability} />
        </section>

        <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
          <div className="mb-5 flex items-center justify-between"><div><h2 className="text-lg font-bold">Fields</h2><p className="mt-1 text-xs text-fg-muted">This is your data model. Field order becomes the editor form order.</p></div><button type="button" onClick={() => setFields((v) => [...v, emptyField()])} className="inline-flex items-center gap-2 rounded-lg border border-action/20 px-3 py-2 text-xs font-bold text-action"><Plus size={14} /> Add field</button></div>
          <div className="space-y-3">
            {fields.map((field, index) => (
              <FieldEditor
                key={index}
                field={field}
                index={index}
                total={fields.length}
                onChange={(patch) => updateField(index, patch)}
                onRemove={() => setFields((v) => v.filter((_, i) => i !== index))}
                onMove={(direction) => moveField(index, direction)}
                relationTargets={relationTargets}
                otherFieldKeys={fields.filter((f) => f.key !== field.key).map((f) => f.key)}
              />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-subtle bg-surface-1 p-6">
          <p className="mb-1 text-lg font-bold">Role policy</p>
          <p className="mb-4 text-xs text-fg-muted">Optional intent for who may read/create/edit/publish/archive/delete this model's records — compiled into platform permissions later.</p>
          <PermissionPolicyEditor policies={permissions} onChange={setPermissions} roles={roles} capability={capability} />
        </section>
      </form>
    </AdminLayout>
  );
}
