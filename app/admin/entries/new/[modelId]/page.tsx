"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import EntryForm from "@/components/admin/EntryForm";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { CanonicalSchema } from "@/lib/schema/fields/types";

export default function CreateEntryPage() {
  const { modelId } = useParams<{ modelId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = searchParams.get("locale") || undefined;
  const translationOf = searchParams.get("translationOf") || undefined;
  const [schema, setSchema] = useState<CanonicalSchema | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const [modelRes, versionsRes] = await Promise.all([
        fetch(`/api/models/${modelId}`, { headers }),
        fetch(`/api/models/${modelId}/versions`, { headers }),
      ]);
      const [model, versions] = await Promise.all([modelRes.json(), versionsRes.json()]);
      if (!modelRes.ok || !versionsRes.ok) throw new Error(model.error || versions.error);
      setName(model.data.name);
      setSchema(versions.data?.[0]?.schema_json || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load model");
    }
  }, [modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (data: Record<string, unknown>, changeSummary: string) => {
    const headers = await getAuthHeaders();
    const res = await fetch("/api/entries", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ modelId, data, changeSummary, locale }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Could not create entry");
      return;
    }

    const newEntryId = body.data.entry.id as string;
    if (translationOf && locale) {
      const linkRes = await fetch(`/api/entries/${translationOf}/localization`, {
        method: "PUT",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ locale, translatedEntryId: newEntryId, markReviewed: false }),
      });
      const linkBody = await linkRes.json();
      if (!linkRes.ok) {
        setError(`Translation draft was created, but linking it failed: ${linkBody.error || "Unknown error"}`);
        router.push(`/admin/entries/${newEntryId}`);
        return;
      }
    }
    router.push(`/admin/entries/${newEntryId}`);
  };

  return (
    <AdminLayout>
      <div className="mx-auto max-w-7xl">
        <header className="mb-7 flex items-center gap-4 border-b border-subtle pb-5">
          <Link href="/admin/entries/new" className="rounded-lg border border-subtle p-2 text-fg-muted hover:text-fg-primary transition-colors">
            <ArrowLeft size={17} />
          </Link>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">
              Content library / {locale ? `${locale} translation draft` : "Draft"}
            </p>
            <h1 className="mt-1 text-3xl font-extrabold text-fg-primary">NEW {name.toUpperCase()}</h1>
          </div>
        </header>

        {error && <div className="mb-5 rounded-xl border border-danger bg-danger-muted p-4 text-sm text-danger">{error}</div>}

        {schema ? (
          <EntryForm
            schema={schema}
            onSubmit={create}
            submitLabel={locale ? `Create ${locale} translation` : "Create draft"}
            storageKey={`entry:new:${modelId}${locale ? `:${locale}` : ""}`}
          />
        ) : (
          <div className="flex min-h-40 items-center justify-center text-fg-muted"><RefreshCw className="animate-spin" /></div>
        )}
      </div>
    </AdminLayout>
  );
}
