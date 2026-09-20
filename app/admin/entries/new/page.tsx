"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AdminLayout from "@/components/admin/AdminLayout";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { ArrowLeft, Boxes, Plus } from "lucide-react";

type Model = { id: string; name: string; api_key: string; description: string | null };
export default function NewEntryPage() {
  const router = useRouter(); const [models, setModels] = useState<Model[]>([]); const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch("/api/models", { headers });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        setModels(body.data || []);
      } catch (err: any) {
        setError(err.message || "Could not load models");
      }
    }
    void load();
  }, []);
  return <AdminLayout><div className="mx-auto max-w-4xl"><header className="flex items-center gap-4 border-b border-subtle pb-5"><Link href="/admin/entries" className="rounded-lg border border-subtle p-2 text-fg-muted"><ArrowLeft size={17} /></Link><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Content library / New</p><h1 className="mt-1 text-3xl font-extrabold">CHOOSE A MODEL</h1></div></header>{error && <div className="mt-6 rounded-xl border border-danger p-4 text-danger">{error}</div>}<div className="mt-7 grid gap-4 md:grid-cols-2">{models.map((model) => <button key={model.id} onClick={() => router.push(`/admin/entries/new/${model.id}`)} className="group rounded-2xl border border-subtle bg-surface-1 p-6 text-left transition-all hover:-translate-y-0.5 hover:border-action/35"><Boxes size={20} className="text-action" /><h2 className="mt-6 text-lg font-bold text-fg-primary">{model.name}</h2><code className="mt-1 block text-xs text-action/70">{model.api_key}</code><p className="mt-3 text-sm text-fg-muted">{model.description || "Create a structured entry."}</p><span className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-action">Use this model <Plus size={14} /></span></button>)}</div></div></AdminLayout>;
}
