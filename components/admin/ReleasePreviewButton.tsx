"use client";

import { useState } from "react";

export default function ReleasePreviewButton({ releaseId }: { releaseId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = async () => { setBusy(true); setError(null); try { const response = await fetch(`/api/releases/${releaseId}/preview-token`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); const body = await response.json(); if (!response.ok) throw new Error(body?.error ?? "Could not create preview."); window.open(body.data.url, "_blank", "noopener,noreferrer"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create preview."); } finally { setBusy(false); } };
  return <span className="inline-flex flex-col items-end gap-1"><button type="button" onClick={() => void preview()} disabled={busy} className="rounded-lg border border-action/30 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-action transition hover:bg-action-hover hover:text-on-primary disabled:opacity-50">{busy ? "Creating…" : "Preview"}</button>{error && <span role="alert" className="max-w-44 text-right text-[10px] text-danger">{error}</span>}</span>;
}
