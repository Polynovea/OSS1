"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CheckCircle2, Database, Globe2, Plus, RefreshCw, Server, ShieldCheck } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type EnvironmentRow = {
  id: string;
  key: string;
  name: string;
  kind: string;
  status: string;
  is_default: boolean;
  cms_base_url: string | null;
  public_site_urls: string[];
  database_provider: string | null;
  storage_provider: string | null;
  runtime_provider: string | null;
  secret_provider_id: string | null;
  secretProviders: Array<{ id: string; provider_kind: string; name: string; status: string }>;
  components: Array<{ id: string; capability_key: string; component_key: string; state: string; provider: string | null }>;
  connectionSummary: { total: number; healthy: number; degraded: number };
};

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const auth = await getAuthHeaders();
  if (!auth.Authorization) throw new Error("Admin session is unavailable. Please sign in again.");
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(auth)) headers.set(key, value);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}

function statusBadge(status: string) {
  if (status === "ready") return "ui-badge ui-badge-success";
  if (status === "degraded" || status === "blocked") return "ui-badge ui-badge-danger";
  return "ui-badge ui-badge-warning";
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[12px] font-medium text-fg-secondary">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-4 text-fg-muted">{hint}</span> : null}
    </label>
  );
}

export default function EnvironmentsPage() {
  const [rows, setRows] = useState<EnvironmentRow[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await authFetch("/api/environments");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load environments");
      setRows(body.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load environments");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create");
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const fd = new FormData(form);
    try {
      const publicUrls = String(fd.get("publicSiteUrls") || "").split("\n").map((value) => value.trim()).filter(Boolean);
      const response = await authFetch("/api/environments", {
        method: "POST",
        body: JSON.stringify({
          key: fd.get("key"),
          name: fd.get("name"),
          kind: fd.get("kind"),
          isDefault: fd.get("isDefault") === "on",
          cmsBaseUrl: fd.get("cmsBaseUrl") || null,
          publicSiteUrls: publicUrls,
          databaseProvider: fd.get("databaseProvider") || null,
          storageProvider: fd.get("storageProvider") || null,
          runtimeProvider: fd.get("runtimeProvider") || null,
          secretProviderKind: fd.get("secretProviderKind"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create environment");
      form.reset();
      setNotice("Environment created with an isolated credential provider.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create environment");
    } finally {
      setBusy("");
    }
  }

  async function makeDefault(row: EnvironmentRow) {
    setBusy(row.id);
    try {
      const response = await authFetch(`/api/environments/${row.id}`, { method: "PATCH", body: JSON.stringify({ isDefault: true }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not update environment");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update environment");
    } finally {
      setBusy("");
    }
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow">Runtime boundaries</p>
            <h1 className="ui-page-title">Environments</h1>
            <p className="ui-page-description">Separate Local, Development, Staging and Production state. Credentials, deployment state and provider health stay environment-scoped.</p>
          </div>
          <button onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}
        {notice ? <div className="ui-alert ui-alert-success mt-5">{notice}</div> : null}

        <section className="ui-section">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="ui-section-title">Runtime inventory</h2>
              <p className="ui-section-description">An environment is a bounded operating context, not merely a label.</p>
            </div>
            <span className="text-[12px] text-fg-muted">{rows.length} configured</span>
          </div>

          {rows.length === 0 ? (
            <div className="ui-empty rounded-xl bg-surface-1">
              <Server className="mx-auto text-icon-muted" size={22} />
              <p className="ui-empty-title mt-3">No environment configured</p>
              <p className="ui-empty-copy">Create the first runtime boundary below to activate provisioning, deployment health and reconciliation.</p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {rows.map((row) => (
                <article key={row.id} className="ui-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Server className="text-icon-secondary" size={16} />
                        <h3 className="truncate text-[15px] font-semibold text-fg-primary">{row.name}</h3>
                        {row.is_default ? <span className="ui-badge ui-badge-review">Default</span> : null}
                      </div>
                      <p className="mt-1 text-[12px] text-fg-muted">{row.key} · {row.kind}</p>
                    </div>
                    <span className={statusBadge(row.status)}>{row.status}</span>
                  </div>

                  <dl className="mt-5 divide-y divide-[var(--border-subtle)] text-[12px]">
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-fg-muted">CMS URL</dt><dd className="m-0 max-w-[65%] truncate text-fg-secondary">{row.cms_base_url || "Not set"}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-fg-muted">Public site</dt><dd className="m-0 max-w-[65%] truncate text-fg-secondary">{row.public_site_urls?.[0] || "Not set"}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-fg-muted">Connections</dt><dd className="m-0 text-fg-secondary">{row.connectionSummary.healthy}/{row.connectionSummary.total} healthy</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-fg-muted">
                    <span className="rounded-lg bg-surface-2 px-2.5 py-1.5"><Database className="mr-1.5 inline" size={12} />{row.database_provider || "DB unbound"}</span>
                    <span className="rounded-lg bg-surface-2 px-2.5 py-1.5"><Globe2 className="mr-1.5 inline" size={12} />{row.runtime_provider || "Runtime unbound"}</span>
                    <span className="rounded-lg bg-surface-2 px-2.5 py-1.5"><ShieldCheck className="mr-1.5 inline" size={12} />{row.secretProviders?.[0]?.provider_kind || "No credential provider"}</span>
                  </div>

                  {row.components.length > 0 ? (
                    <div className="mt-5 border-t border-subtle pt-4">
                      <p className="text-[12px] font-medium text-fg-secondary">Deployment capabilities</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {row.components.map((component) => <span key={component.id} className="ui-badge ui-badge-pending">{component.component_key}: {component.state}</span>)}
                      </div>
                    </div>
                  ) : null}

                  {!row.is_default ? <button disabled={busy !== ""} onClick={() => void makeDefault(row)} className="ui-btn ui-btn-tertiary mt-4">Make default</button> : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="ui-section">
          <div className="mb-5 flex items-center gap-2">
            <Plus className="text-action" size={16} />
            <div><h2 className="ui-section-title">Create environment</h2><p className="ui-section-description">The environment and its credential-provider boundary are created atomically.</p></div>
          </div>

          <form onSubmit={create} className="grid gap-x-4 gap-y-5 rounded-2xl bg-surface-1 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Field label="Name"><input name="name" required placeholder="Production" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Key" hint="Stable machine-readable identifier."><input name="key" required placeholder="production" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Environment type"><select name="kind" defaultValue="development" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="local">Local</option><option value="development">Development</option><option value="staging">Staging</option><option value="production">Production</option><option value="custom">Custom</option></select></Field>
            <Field label="Credential provider"><select name="secretProviderKind" defaultValue="encrypted_postgres" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="encrypted_postgres">Encrypted PostgreSQL credentials</option><option value="environment">Environment-variable references</option></select></Field>
            <Field label="CMS base URL"><input name="cmsBaseUrl" placeholder="https://cms.example.com" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Public site URLs"><textarea name="publicSiteUrls" placeholder={'One URL per line\nhttps://example.com'} className="mt-2 min-h-24 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Database provider"><input name="databaseProvider" placeholder="supabase / postgres / rds" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Storage provider"><input name="storageProvider" placeholder="r2 / s3 / minio" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <Field label="Runtime provider"><input name="runtimeProvider" placeholder="vercel / ec2 / vm" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[12px] text-fg-secondary"><input type="checkbox" name="isDefault" className="accent-primary" /> Make this the default environment</label>
            <div className="flex items-end xl:col-span-2"><button disabled={busy !== ""} className="ui-btn ui-btn-primary w-full md:w-auto">{busy === "create" ? "Creating…" : "Create environment"}</button></div>
          </form>
        </section>

        <div className="ui-alert ui-alert-info mb-4"><CheckCircle2 className="mr-2 inline" size={14} />Environment records are not deployment claims. A runtime becomes <strong>ready</strong> only after provisioning and System Doctor certify its required components.</div>
      </div>
    </AdminLayout>
  );
}
