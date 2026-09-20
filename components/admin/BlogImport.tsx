"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { getAccessToken } from "@/lib/admin/authCheck";
import { showToast } from "./Toast";

export interface BlogDraft {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
}

interface BlogImportProps {
  onImport: (draft: BlogDraft) => void;
}

const ACCEPT = ".docx,.md,.markdown,.html,.htm";

export default function BlogImport({ onImport }: BlogImportProps) {
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const token = await getAccessToken();
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/content/blog-posts/import", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Import failed");
      onImport(json.data as BlogDraft);
      showToast(`Imported "${file.name}" — review the fields below before saving.`, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Import failed", "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
        Import from File
      </label>
      <button
        type="button"
        onClick={() => !importing && inputRef.current?.click()}
        disabled={importing}
        className="flex items-center justify-center gap-2 w-full border border-dashed border-outline rounded-lg py-4 text-fg-muted hover:border-primary hover:text-primary transition-colors disabled:cursor-not-allowed text-xs font-body text-center px-3"
      >
        {importing ? (
          <>
            <Loader2 size={15} className="animate-spin shrink-0" />
            Importing...
          </>
        ) : (
          <>
            <FileUp size={15} strokeWidth={1.5} className="shrink-0" />
            Click to import .docx, .md, or .html — fills title, excerpt &amp; content below
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
