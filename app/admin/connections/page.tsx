"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CheckCircle2, KeyRound, Plug, RefreshCw, RotateCw, ShieldAlert, TestTube2 } from "lucide-react";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";

type Provider = { id: string; provider_kind: string; name: string; status: string };
type Environment = { id: string; key: string; name: string; kind: string; status: string; secret_provider_id: string | null; secretProviders: Provider[] };
type ConfigField = { key: string; label: string; type: string; required?: boolean; placeholder?: string; description?: string; options?: string[] };
type CredentialField = { purpose: string; label: string; required?: boolean; defaultEnvironmentVariable?: string; multiline?: boolean; description?: string };
type CatalogItem = { type: string; family: string; label: string; description: string; configFields: ConfigField[]; credentials: CredentialField[] };
type SecretView = { id: string; purpose: string; label: string; state: string; providerKind: string; locator?: string; maskedHint: string | null; lastVerifiedAt: string | null; rotatedAt: string | null };
type VerificationCheck = { key?: string; label?: string; status?: string; message?: string };
type Connection = {
  id: string;
  environment_id: string;
  connector_type: string;
  connector_family: string;
  name: string;
  status: string;
  active: boolean;
  config_json: Record<string, unknown>;
  last_verified_at: string | null;
  last_success_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  environment?: { id: string; key: string; name: string; kind: string; status: string } | null;
  secrets: SecretView[];
  latestVerification?: { status: string; checks_json: VerificationCheck[]; safe_evidence_json: Record<string, unknown>; duration_ms: number | null; verified_at: string } | null;
};

async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const auth = await getAuthHeaders();
  if (!auth.Authorization) throw new Error("Admin session is unavailable. Please sign in again.");
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(auth)) headers.set(key, value);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}

const fmt = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

function statusBadge(status: string) {
  if (["active", "passed", "healthy", "verified"].includes(status)) return "ui-badge ui-badge-success";
  if (["failed", "degraded", "revoked"].includes(status)) return "ui-badge ui-badge-danger";
  if (["verifying", "configured", "unverified"].includes(status)) return "ui-badge ui-badge-warning";
  return "ui-badge ui-badge-pending";
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

export default function ConnectionsPage() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [environmentId, setEnvironmentId] = useState("");
  const [connectorType, setConnectorType] = useState("");
  const [providerId, setProviderId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rotateId, setRotateId] = useState("");
  const [rotatePurpose, setRotatePurpose] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [environmentResponse, catalogResponse, connectionResponse] = await Promise.all([
        authFetch("/api/environments"),
        authFetch("/api/connections/catalog"),
        authFetch("/api/connections"),
      ]);
      const [environmentBody, catalogBody, connectionBody] = await Promise.all([
        environmentResponse.json(),
        catalogResponse.json(),
        connectionResponse.json(),
      ]);
      if (!environmentResponse.ok) throw new Error(environmentBody.error || "Could not load environments");
      if (!catalogResponse.ok) throw new Error(catalogBody.error || "Could not load connector catalog");
      if (!connectionResponse.ok) throw new Error(connectionBody.error || "Could not load connections");
      setEnvironments(environmentBody.data ?? []);
      setCatalog(catalogBody.data ?? []);
      setConnections(connectionBody.data ?? []);
      setEnvironmentId((current) => current || (environmentBody.data?.[0]?.id ?? ""));
      setConnectorType((current) => current || (catalogBody.data?.[0]?.type ?? ""));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load connections");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectedEnvironment = useMemo(() => environments.find((environment) => environment.id === environmentId) ?? null, [environments, environmentId]);
  const selectedDefinition = useMemo(() => catalog.find((item) => item.type === connectorType) ?? null, [catalog, connectorType]);

  useEffect(() => {
    if (!selectedEnvironment) return;
    const candidate = selectedEnvironment.secretProviders?.find((provider) => provider.id === selectedEnvironment.secret_provider_id)
      || selectedEnvironment.secretProviders?.find((provider) => provider.status === "active");
    setProviderId(candidate?.id ?? "");
  }, [selectedEnvironment]);

  const selectedProvider = selectedEnvironment?.secretProviders?.find((provider) => provider.id === providerId) ?? null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDefinition || !selectedEnvironment || !selectedProvider) return;
    setBusy("create");
    setError("");
    setNotice("");
    const form = event.currentTarget;
    const fd = new FormData(form);
    try {
      const config: Record<string, unknown> = {};
      for (const field of selectedDefinition.configFields) {
        const value = String(fd.get(`config:${field.key}`) || "").trim();
        if (value) config[field.key] = field.type === "number" ? Number(value) : value;
      }
      const credentials = selectedDefinition.credentials
        .map((field) => {
          const raw = String(fd.get(`cred:${field.purpose}`) || "");
          return selectedProvider.provider_kind === "environment"
            ? { purpose: field.purpose, locator: raw.trim() || field.defaultEnvironmentVariable || "" }
            : { purpose: field.purpose, value: raw };
        })
        .filter((item) => selectedProvider.provider_kind === "environment" ? Boolean("locator" in item && item.locator) : Boolean("value" in item && item.value?.trim()));

      const response = await authFetch("/api/connections", {
        method: "POST",
        body: JSON.stringify({ environmentId: selectedEnvironment.id, connectorType: selectedDefinition.type, name: fd.get("name"), config, secretProviderId: selectedProvider.id, credentials }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not create connection");
      for (const element of Array.from(form.elements)) {
        if (element instanceof HTMLInputElement && (element.type === "password" || element.name.startsWith("cred:"))) element.value = "";
      }
      setNotice("Connection created. Run Verify to establish live health.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create connection");
    } finally {
      setBusy("");
    }
  }

  async function verify(id: string) {
    setBusy(`verify:${id}`);
    setError("");
    setNotice("");
    try {
      const response = await authFetch(`/api/connections/${id}/verify`, { method: "POST", body: "{}" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Verification failed");
      setNotice("Connection verification completed and health state was recorded.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Verification failed");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function rotate(event: FormEvent<HTMLFormElement>, connection: Connection) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const purpose = String(fd.get("purpose") || "");
    const secret = connection.secrets.find((item) => item.purpose === purpose);
    if (!secret) return;
    setBusy(`rotate:${connection.id}`);
    setError("");
    try {
      const payload = secret.providerKind === "environment"
        ? { purpose, locator: String(fd.get("credential") || "") }
        : { purpose, value: String(fd.get("credential") || "") };
      const response = await authFetch(`/api/connections/${connection.id}/credentials`, { method: "POST", body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not rotate credential");
      const input = event.currentTarget.elements.namedItem("credential");
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) input.value = "";
      setRotateId("");
      setNotice("Credential reference rotated. Re-verify the connection before relying on it.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rotate credential");
    } finally {
      setBusy("");
    }
  }

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-7xl">
        <header className="ui-page-header">
          <div>
            <p className="ui-eyebrow">External services</p>
            <h1 className="ui-page-title">Connections</h1>
            <p className="ui-page-description">Typed provider connections with environment-scoped credentials, safe verification and auditable health. Credential values are write-only and never returned.</p>
          </div>
          <button onClick={() => void load()} className="ui-btn ui-btn-secondary"><RefreshCw size={14} /> Refresh</button>
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5"><ShieldAlert className="mr-2 inline" size={14} />{error}</div> : null}
        {notice ? <div className="ui-alert ui-alert-success mt-5"><CheckCircle2 className="mr-2 inline" size={14} />{notice}</div> : null}

        <section className="ui-section">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div><h2 className="ui-section-title">Connection inventory</h2><p className="ui-section-description">Health belongs to the connection itself, not the form used to configure it.</p></div>
            <span className="text-[12px] text-fg-muted">{connections.length} configured</span>
          </div>

          {connections.length === 0 ? (
            <div className="ui-empty rounded-xl bg-surface-1"><Plug className="mx-auto text-icon-muted" size={22} /><p className="ui-empty-title mt-3">No connections configured</p><p className="ui-empty-copy">Create the first typed connection below. It will remain untrusted until live verification succeeds.</p></div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {connections.map((connection) => (
                <article key={connection.id} className="ui-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2"><Plug className="text-icon-secondary" size={16} /><h3 className="truncate text-[15px] font-semibold text-fg-primary">{connection.name}</h3></div>
                      <p className="mt-1 text-[12px] text-fg-muted">{connection.connector_type} · {connection.environment?.name || "Environment unavailable"}</p>
                    </div>
                    <span className={statusBadge(connection.status)}>{connection.status}</span>
                  </div>

                  <dl className="mt-5 divide-y divide-[var(--border-subtle)] text-[12px]">
                    <div className="flex justify-between gap-4 py-2.5"><dt className="text-fg-muted">Last verified</dt><dd className="m-0 text-right text-fg-secondary">{fmt(connection.last_verified_at)}</dd></div>
                    <div className="flex justify-between gap-4 py-2.5"><dt className="text-fg-muted">Last success</dt><dd className="m-0 text-right text-fg-secondary">{fmt(connection.last_success_at)}</dd></div>
                    <div className="flex justify-between gap-4 py-2.5"><dt className="text-fg-muted">Credentials</dt><dd className="m-0 text-right text-fg-secondary">{connection.secrets.length}</dd></div>
                  </dl>

                  {connection.secrets.length ? <div className="mt-4 flex flex-wrap gap-2">{connection.secrets.map((secret) => <span key={secret.id} className={statusBadge(secret.state)}>{secret.purpose}: {secret.maskedHint || secret.state}</span>)}</div> : null}

                  {connection.last_error_message ? <div className="ui-alert ui-alert-danger mt-4"><strong>{connection.last_error_code || "Connection error"}</strong><div className="mt-1 text-[11px]">{connection.last_error_message}</div></div> : null}

                  {connection.latestVerification?.checks_json?.length ? (
                    <div className="mt-4 border-t border-subtle pt-3">
                      <p className="mb-1.5 text-[12px] font-medium text-fg-secondary">Verification evidence</p>
                      {connection.latestVerification.checks_json.map((check, index) => (
                        <div key={check.key || index} className="ui-list-row min-h-0 py-2 text-[11px]">
                          <Activity size={12} className="text-icon-muted" />
                          <span className={check.status === "failed" ? "text-danger" : check.status === "warning" ? "text-warning" : "text-success"}>{check.label || check.key}</span>
                          <span className="min-w-0 flex-1 truncate text-fg-muted">{check.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button disabled={busy !== ""} onClick={() => void verify(connection.id)} className="ui-btn ui-btn-secondary"><TestTube2 size={13} />{busy === `verify:${connection.id}` ? "Verifying…" : "Verify"}</button>
                    {connection.secrets.length ? <button onClick={() => { setRotateId(rotateId === connection.id ? "" : connection.id); setRotatePurpose(connection.secrets[0]?.purpose || ""); }} className="ui-btn ui-btn-tertiary"><RotateCw size={13} />Rotate credential</button> : null}
                  </div>

                  {rotateId === connection.id ? (
                    <form onSubmit={(event) => void rotate(event, connection)} className="mt-4 grid gap-3 rounded-xl bg-surface-2 p-4 sm:grid-cols-[180px_1fr_auto]">
                      <select name="purpose" value={rotatePurpose} onChange={(event) => setRotatePurpose(event.target.value)} className="rounded-lg px-2.5 py-2 text-xs">{connection.secrets.map((secret) => <option key={secret.id} value={secret.purpose}>{secret.label}</option>)}</select>
                      {connection.secrets.find((secret) => secret.purpose === rotatePurpose)?.providerKind === "environment"
                        ? <input name="credential" required placeholder="ENV_VARIABLE_NAME" className="rounded-lg px-3 py-2 text-xs" />
                        : <textarea name="credential" required placeholder="New credential value" className="min-h-10 rounded-lg px-3 py-2 text-xs" />}
                      <button disabled={busy !== ""} className="ui-btn ui-btn-primary"><RotateCw size={13} />Rotate</button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="ui-section">
          <div className="mb-5"><h2 className="ui-section-title">Add connection</h2><p className="ui-section-description">The connector registry defines valid configuration and credential fields; arbitrary secret keys are not accepted.</p></div>

          {environments.length === 0 ? (
            <div className="ui-alert ui-alert-warning">Create an environment first. Connections cannot exist outside an environment boundary.</div>
          ) : (
            <form onSubmit={create} className="space-y-6 rounded-2xl bg-surface-1 p-5">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Field label="Environment"><select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name} ({environment.kind})</option>)}</select></Field>
                <Field label="Connector"><select value={connectorType} onChange={(event) => setConnectorType(event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">{catalog.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></Field>
                <Field label="Credential provider"><select value={providerId} onChange={(event) => setProviderId(event.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">{selectedEnvironment?.secretProviders?.filter((provider) => provider.status === "active").map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></Field>
                <Field label="Connection name"><input name="name" required placeholder={selectedDefinition?.label || "Connection name"} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
              </div>

              {selectedDefinition ? (
                <div className="grid gap-8 border-t border-subtle pt-6 lg:grid-cols-2">
                  <div>
                    <h3 className="text-[14px] font-semibold text-fg-primary">Configuration</h3>
                    <p className="mt-1 text-[12px] leading-5 text-fg-muted">{selectedDefinition.description}</p>
                    <div className="mt-4 grid gap-4">
                      {selectedDefinition.configFields.map((field) => field.type === "select" ? (
                        <Field key={field.key} label={field.label} hint={field.description}><select name={`config:${field.key}`} required={field.required} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm"><option value="">Select…</option>{field.options?.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>
                      ) : (
                        <Field key={field.key} label={field.label} hint={field.description}><input name={`config:${field.key}`} type={field.type === "number" ? "number" : field.type === "url" ? "url" : "text"} required={field.required} placeholder={field.placeholder} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></Field>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="flex items-center gap-2 text-[14px] font-semibold text-fg-primary"><KeyRound size={14} className="text-icon-secondary" />Credentials</h3>
                    <p className="mt-1 text-[12px] leading-5 text-fg-muted">Provider: {selectedProvider?.provider_kind || "none"}. Values are write-only after submission.</p>
                    <div className="mt-4 grid gap-4">
                      {selectedDefinition.credentials.map((field) => (
                        <Field key={field.purpose} label={`${field.label}${field.required ? " *" : ""}`} hint={field.description}>
                          {selectedProvider?.provider_kind === "environment"
                            ? <input name={`cred:${field.purpose}`} required={field.required && !field.defaultEnvironmentVariable} defaultValue={field.defaultEnvironmentVariable || ""} placeholder={field.defaultEnvironmentVariable || "ENV_VARIABLE_NAME"} autoComplete="off" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" />
                            : field.multiline
                              ? <textarea name={`cred:${field.purpose}`} required={field.required} autoComplete="off" placeholder="Enter once; stored encrypted" className="mt-2 min-h-24 w-full rounded-lg px-3 py-2.5 text-sm" />
                              : <input name={`cred:${field.purpose}`} type="password" required={field.required} autoComplete="new-password" placeholder="Enter once; stored encrypted" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" />}
                        </Field>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              <button disabled={busy !== "" || !selectedProvider} className="ui-btn ui-btn-primary"><KeyRound size={14} />{busy === "create" ? "Creating…" : "Create connection"}</button>
            </form>
          )}
        </section>
      </div>
    </AdminLayout>
  );
}
