"use client";

import { useState } from "react";

export default function PreviewButton({ entryId }: { entryId: string }) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPreview = async () => {
    setCreating(true); setError(null);
    try {
      const response = await fetch(`/api/entries/${entryId}/preview-token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresInHours: 24 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Could not create a preview link.");
      window.open(body.data.url, "_blank", "noopener,noreferrer");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create a preview link."); }
    finally { setCreating(false); }
  };

  return <section className="flex flex-wrap items-center gap-3 rounded-xl border border-action/15 bg-action/[0.035] px-4 py-3"><div className="mr-auto"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-action">Secure preview</p><p className="mt-1 text-xs text-fg-muted">Opens the current saved revision with a private 24-hour link.</p></div><button type="button" disabled={creating} onClick={createPreview} className="rounded-lg border border-action/35 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-action transition hover:bg-action-hover hover:text-on-primary disabled:cursor-wait disabled:opacity-50">{creating ? "Creating…" : "Open preview"}</button>{error && <p role="alert" className="w-full text-xs text-danger">{error}</p>}</section>;
}
