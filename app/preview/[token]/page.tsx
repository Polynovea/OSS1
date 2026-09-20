import { notFound } from "next/navigation";
import {
  getReleasePreview,
  resolvePreviewToken,
} from "@/lib/content/previewService";
import {
  isRichTextDocument,
  richTextPlainText,
} from "@/lib/content/richText";
import { isExperienceDocument } from "@/lib/experience/blockRegistry";
import ExperienceRenderer from "@/components/experience/ExperienceRenderer";
import type { ExperienceDocument } from "@/lib/experience/types";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ viewport?: string }>;
};

const widths: Record<string, string> = {
  mobile: "max-w-[390px]",
  tablet: "max-w-[768px]",
  desktop: "max-w-6xl",
};

function EntryPreview({
  data,
  title,
}: {
  data: Record<string, unknown>;
  title?: string;
}) {
  // Check if there are any experience documents in the payload
  const experienceEntries = Object.entries(data || {}).filter(
    ([, value]) => isExperienceDocument(value) && value.blocks.length > 0
  );

  const regularEntries = Object.entries(data || {}).filter(
    ([, value]) => !isExperienceDocument(value)
  );

  return (
    <article className="border-b border-white/10 pb-12 last:border-0">
      {title && (
        <div className="mb-8 border-b border-white/5 pb-4">
          <h2 className="font-headline text-2xl font-bold text-white">
            {title}
          </h2>
        </div>
      )}

      {/* Render experience blocks if present */}
      {experienceEntries.length > 0 && (
        <div className="mb-12 rounded-2xl overflow-hidden border border-white/10 shadow-2xl">
          {experienceEntries.map(([fieldKey, expDoc]) => (
            <ExperienceRenderer
              key={fieldKey}
              document={expDoc as ExperienceDocument}
            />
          ))}
        </div>
      )}

      {/* Render standard/fallback fields */}
      {regularEntries.length > 0 && (
        <div className="space-y-6 pt-4">
          {regularEntries.map(([key, value]) => (
            <section key={key} className="mb-6">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                {key}
              </p>
              {isRichTextDocument(value) ? (
                <div className="whitespace-pre-wrap text-base leading-7 text-zinc-200">
                  {richTextPlainText(value)}
                </div>
              ) : typeof value === "string" && /^https?:\/\/.+\.(jpg|jpeg|png|webp|avif|gif|svg)$/i.test(value) ? (
                <img
                  src={value}
                  alt={key}
                  className="max-h-[480px] rounded-xl object-cover border border-white/10"
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-6 text-zinc-300">
                  {typeof value === "string"
                    ? value
                    : JSON.stringify(value, null, 2)}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  );
}

export default async function PreviewPage({ params, searchParams }: Params) {
  const { token } = await params;
  const { viewport = "desktop" } = await searchParams;
  const preview = await resolvePreviewToken(token);

  if (!preview) notFound();

  const width = widths[viewport] ?? widths.desktop;

  const switcher = (
    <nav
      aria-label="Preview viewport"
      className="flex gap-1 rounded-lg border border-white/10 bg-black/30 p-1"
    >
      {Object.keys(widths).map((mode) => (
        <a
          key={mode}
          href={`/preview/${token}?viewport=${mode}`}
          className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
            mode === viewport
              ? "bg-[#e6d3a3] text-black"
              : "text-zinc-500 hover:text-zinc-200"
          }`}
        >
          {mode}
        </a>
      ))}
    </nav>
  );

  if (preview.release_id) {
    const release = await getReleasePreview(
      preview.workspace_id,
      preview.release_id
    );
    if (!release) notFound();
    const items = (release.release_items || []) as unknown as Array<{
      content_entry_versions: {
        data_jsonb: Record<string, unknown>;
        content_entries: { content_models: { name: string } | null } | null;
      } | null;
    }>;

    return (
      <main className="min-h-screen bg-[#0a0a0a] px-6 py-12 text-zinc-100">
        <div className={`mx-auto transition-all ${width}`}>
          <div className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b border-[#e6d3a3]/20 pb-5">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#e6d3a3]">
                Secure release preview
              </p>
              <h1 className="mt-2 font-headline text-3xl font-bold">
                {release.name}
              </h1>
              <p className="mt-2 text-xs text-zinc-600">
                Expires {new Date(preview.expires_at).toLocaleString()}
              </p>
            </div>
            {switcher}
          </div>
          {items.map(
            (item, index) =>
              item.content_entry_versions && (
                <EntryPreview
                  key={index}
                  data={item.content_entry_versions.data_jsonb}
                  title={
                    item.content_entry_versions.content_entries?.content_models
                      ?.name
                  }
                />
              )
          )}
        </div>
      </main>
    );
  }

  const data = (preview.content_entry_versions?.data_jsonb || {}) as Record<
    string,
    unknown
  >;
  const model = Array.isArray(preview.content_entries)
    ? preview.content_entries[0]?.content_models
    : preview.content_entries?.content_models;

  return (
    <main className="min-h-screen bg-[#0a0a0a] px-6 py-12 text-zinc-100">
      <div className={`mx-auto transition-all ${width}`}>
        <div className="mb-10 flex flex-wrap items-start justify-between gap-4 border-b border-[#e6d3a3]/20 pb-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#e6d3a3]">
              Secure draft preview · {model?.name || "Content"}
            </p>
            <p className="mt-2 text-xs text-zinc-600">
              Expires {new Date(preview.expires_at).toLocaleString()}
            </p>
          </div>
          {switcher}
        </div>
        <EntryPreview data={data} />
      </div>
    </main>
  );
}
