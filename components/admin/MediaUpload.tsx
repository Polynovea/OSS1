"use client";

import { useState, useRef } from "react";
import { Upload, X, Loader2, Image as ImageIcon, Film } from "lucide-react";
import { getAuthHeaders } from "@/lib/admin/authCheck";
import { showToast } from "./Toast";

type MediaType = "image" | "video" | "both";

interface MediaUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  folder?: string;
  accept?: MediaType;
  label?: string;
}

const ACCEPT_MAP: Record<MediaType, string> = {
  image: "image/jpeg,image/png,image/webp,image/gif",
  video: "video/mp4,video/webm,video/quicktime",
  both: "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime",
};

const TYPE_HINT: Record<MediaType, string> = {
  image: "JPG, PNG, WebP, GIF · max 50 MB",
  video: "MP4, WebM, MOV · max 500 MB",
  both: "Images or video",
};

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov)/i.test(url.split("?")[0]);
}

export default function MediaUpload({
  value,
  onChange,
  folder = "general",
  accept = "image",
  label = "Media",
}: MediaUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setProgress(0);
    try {
      const headers = await getAuthHeaders();
      const sasRes = await fetch("/api/upload/sas", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ folder, filename: file.name, contentType: file.type }),
      });
      const sasJson = await sasRes.json();
      if (!sasJson.success) throw new Error(sasJson.error || "Failed to get upload URL");

      const { uploadUrl, readUrl } = sasJson.data;

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("x-ms-blob-type", "BlockBlob");
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      onChange(readUrl);
      showToast("Uploaded successfully.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const Icon = accept === "video" ? Film : accept === "both" ? Upload : ImageIcon;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-body text-[10px] font-bold text-on-surface-variant tracking-wider uppercase pl-1">
        {label}
      </label>

      {value ? (
        <div className="relative rounded-lg overflow-hidden border border-outline bg-surface-variant/20 group">
          {isVideoUrl(value) ? (
            <video src={value} controls className="w-full max-h-52 object-contain bg-black" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Preview" className="w-full max-h-52 object-cover" />
          )}
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-danger-muted transition-colors opacity-0 group-hover:opacity-100"
            title="Remove"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => !uploading && inputRef.current?.click()}
          disabled={uploading}
          className="flex flex-col items-center justify-center gap-2 w-full border border-dashed border-outline rounded-lg py-7 text-fg-muted hover:border-primary hover:text-primary transition-colors disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span className="font-body text-xs">{progress > 0 ? `${progress}%` : "Uploading..."}</span>
              {progress > 0 && (
                <div className="w-32 h-1 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <Icon size={18} strokeWidth={1.5} />
              <span className="font-body text-xs">
                Click to upload {accept === "both" ? "image or video" : accept}
              </span>
              <span className="font-body text-[10px] text-fg-muted">{TYPE_HINT[accept]}</span>
            </>
          )}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_MAP[accept]}
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
