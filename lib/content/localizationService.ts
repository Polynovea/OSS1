import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { getEntry } from "@/lib/content/entryService";
import { logPlatformEvent } from "@/lib/platform/audit";

export type LocalizationStatus = "current" | "stale" | "missing" | "draft" | "in_review" | "needs_review";

export interface WorkspaceLocaleRow {
  id: string;
  workspace_id: string;
  locale: string;
  enabled: boolean;
  required: boolean;
  is_default: boolean;
  fallback_locale: string | null;
  created_at: string;
}

export interface LocalizationStatusRow {
  locale: string;
  required: boolean;
  isDefault: boolean;
  fallbackLocale: string | null;
  status: LocalizationStatus;
  sourceLocale: string;
  translatedEntryId: string | null;
  translatedVersionId: string | null;
  translatedEntryStatus: string | null;
  reviewedAt: string | null;
  staleAt: string | null;
  createUrl: string | null;
}

export async function listLocales(workspaceId: string, includeDisabled = true): Promise<WorkspaceLocaleRow[]> {
  let query = createServiceRoleClient()
    .from("workspace_locales")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("is_default", { ascending: false })
    .order("locale");
  if (!includeDisabled) query = query.eq("enabled", true);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceLocaleRow[];
}

export async function configureLocale(params: {
  workspaceId: string;
  actorId: string;
  locale: string;
  enabled?: boolean;
  required?: boolean;
  isDefault?: boolean;
  fallbackLocale?: string | null;
}) {
  if (!/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(params.locale)) {
    throw new Error("Use a BCP-47 locale such as en, en-IN, or hi");
  }
  if (params.fallbackLocale && !/^[a-z]{2,3}(-[A-Z]{2})?$/i.test(params.fallbackLocale)) {
    throw new Error("Fallback must be a BCP-47 locale such as en, en-IN, or hi");
  }
  const { data, error } = await createServiceRoleClient().rpc("cms_configure_locale", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorId,
    p_locale: params.locale,
    p_enabled: params.enabled ?? true,
    p_required: params.required ?? false,
    p_is_default: params.isDefault ?? false,
    p_fallback_locale: params.fallbackLocale ?? null,
  });
  if (error || !data) throw new Error(error?.message || "Could not configure locale");
  return data;
}

export async function setTranslation(params: {
  workspaceId: string;
  actorId: string;
  sourceEntryId: string;
  locale: string;
  translatedEntryId?: string | null;
  markReviewed?: boolean;
}) {
  const source = await getEntry(params.workspaceId, params.sourceEntryId);
  if (!source?.current_draft_version_id) throw new Error("Source entry draft not found");
  if (params.translatedEntryId === source.id) throw new Error("A source entry cannot be its own translation");

  const locale = (await listLocales(params.workspaceId)).find((item) => item.locale === params.locale && item.enabled);
  if (!locale) throw new Error("Locale is not enabled in this workspace");

  let translated = null;
  if (params.translatedEntryId) {
    translated = await getEntry(params.workspaceId, params.translatedEntryId);
    if (!translated) throw new Error("Translated entry not found in workspace");
    if (translated.content_model_id !== source.content_model_id) {
      throw new Error("A translation must use the same content model as its source entry");
    }
    if (!translated.current_draft_version_id && !translated.published_version_id) {
      throw new Error("Translated entry has no content version");
    }
    const versionId = translated.current_draft_version_id ?? translated.published_version_id!;
    const { data: translatedVersion } = await createServiceRoleClient()
      .from("content_entry_versions")
      .select("locale")
      .eq("id", versionId)
      .eq("entry_id", translated.id)
      .maybeSingle();
    if (!translatedVersion || translatedVersion.locale !== params.locale) {
      throw new Error(`Translated entry must be authored in locale ${params.locale}`);
    }
  }

  const now = new Date().toISOString();
  const markReviewed = Boolean(params.translatedEntryId && (params.markReviewed ?? true));
  const { data, error } = await createServiceRoleClient()
    .from("content_entry_translations")
    .upsert(
      {
        workspace_id: params.workspaceId,
        source_entry_id: source.id,
        locale: params.locale,
        translated_entry_id: params.translatedEntryId ?? null,
        source_version_id: params.translatedEntryId ? source.current_draft_version_id : null,
        reviewed_at: markReviewed ? now : null,
        stale_at: null,
        updated_at: now,
      },
      { onConflict: "source_entry_id,locale" }
    )
    .select()
    .single();
  if (error) throw new Error(error.message);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: params.translatedEntryId ? "localization.translation_linked" : "localization.translation_unlinked",
    entityType: "content_entry",
    entityId: source.id,
    metadata: { locale: params.locale, translatedEntryId: params.translatedEntryId ?? null, reviewed: markReviewed },
  });
  return data;
}

export async function reviewTranslation(params: {
  workspaceId: string;
  actorId: string;
  sourceEntryId: string;
  locale: string;
}) {
  const source = await getEntry(params.workspaceId, params.sourceEntryId);
  if (!source?.current_draft_version_id) throw new Error("Source entry draft not found");
  const db = createServiceRoleClient();
  const { data: relation } = await db
    .from("content_entry_translations")
    .select("id, translated_entry_id")
    .eq("workspace_id", params.workspaceId)
    .eq("source_entry_id", source.id)
    .eq("locale", params.locale)
    .maybeSingle();
  if (!relation?.translated_entry_id) throw new Error("Translation is not linked");
  const translated = await getEntry(params.workspaceId, relation.translated_entry_id);
  if (!translated || !["approved", "published"].includes(translated.status)) {
    throw new Error("Translation must pass editorial approval before it can be marked current");
  }

  const now = new Date().toISOString();
  const { data, error } = await db
    .from("content_entry_translations")
    .update({ source_version_id: source.current_draft_version_id, reviewed_at: now, stale_at: null, updated_at: now })
    .eq("id", relation.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorId,
    action: "localization.translation_reviewed",
    entityType: "content_entry",
    entityId: source.id,
    metadata: { locale: params.locale, translatedEntryId: relation.translated_entry_id, sourceVersionId: source.current_draft_version_id },
  });
  return data;
}

export async function getLocalizationStatus(workspaceId: string, sourceEntryId: string): Promise<LocalizationStatusRow[] | null> {
  const source = await getEntry(workspaceId, sourceEntryId);
  if (!source?.current_draft_version_id) return null;
  const db = createServiceRoleClient();
  const [{ data: sourceVersion }, locales, translationsRes] = await Promise.all([
    db.from("content_entry_versions").select("locale").eq("id", source.current_draft_version_id).maybeSingle(),
    listLocales(workspaceId, false),
    db.from("content_entry_translations").select("*").eq("workspace_id", workspaceId).eq("source_entry_id", source.id),
  ]);
  const sourceLocale = sourceVersion?.locale ?? "en";
  const translations = translationsRes.data ?? [];
  const translatedIds = translations.map((item) => item.translated_entry_id).filter((id): id is string => Boolean(id));
  const { data: translatedEntries } = translatedIds.length
    ? await db.from("content_entries").select("id,status,current_draft_version_id,published_version_id").eq("workspace_id", workspaceId).in("id", translatedIds)
    : { data: [] as Array<{ id: string; status: string; current_draft_version_id: string | null; published_version_id: string | null }> };
  const byId = new Map((translatedEntries ?? []).map((item) => [item.id, item]));

  return locales.map((locale): LocalizationStatusRow => {
    if (locale.locale === sourceLocale) {
      return {
        locale: locale.locale,
        required: locale.required,
        isDefault: locale.is_default,
        fallbackLocale: locale.fallback_locale,
        status: "current",
        sourceLocale,
        translatedEntryId: source.id,
        translatedVersionId: source.current_draft_version_id,
        translatedEntryStatus: source.status,
        reviewedAt: null,
        staleAt: null,
        createUrl: null,
      };
    }

    const relation = translations.find((item) => item.locale === locale.locale);
    const target = relation?.translated_entry_id ? byId.get(relation.translated_entry_id) : null;
    const stale = Boolean(relation?.stale_at || (relation?.source_version_id && relation.source_version_id !== source.current_draft_version_id));
    let status: LocalizationStatus;
    if (!relation?.translated_entry_id || !target) status = "missing";
    else if (stale) status = "stale";
    else if (target.status === "in_review") status = "in_review";
    else if (["approved", "published"].includes(target.status) && relation.reviewed_at) status = "current";
    else if (["approved", "published"].includes(target.status)) status = "needs_review";
    else status = "draft";

    return {
      locale: locale.locale,
      required: locale.required,
      isDefault: locale.is_default,
      fallbackLocale: locale.fallback_locale,
      status,
      sourceLocale,
      translatedEntryId: relation?.translated_entry_id ?? null,
      translatedVersionId: target?.current_draft_version_id ?? target?.published_version_id ?? null,
      translatedEntryStatus: target?.status ?? null,
      reviewedAt: relation?.reviewed_at ?? null,
      staleAt: relation?.stale_at ?? null,
      createUrl: status === "missing" ? `/admin/entries/new/${source.content_model_id}?locale=${encodeURIComponent(locale.locale)}&translationOf=${source.id}` : null,
    };
  });
}

export async function markTranslationsStale(workspaceId: string, sourceEntryId: string) {
  const source = await getEntry(workspaceId, sourceEntryId);
  if (!source?.current_draft_version_id) return;
  const now = new Date().toISOString();
  await createServiceRoleClient()
    .from("content_entry_translations")
    .update({ stale_at: now, updated_at: now })
    .eq("workspace_id", workspaceId)
    .eq("source_entry_id", sourceEntryId)
    .neq("source_version_id", source.current_draft_version_id);
}

export async function resolveLocaleFallback(workspaceId: string, requestedLocale: string): Promise<string[]> {
  const locales = await listLocales(workspaceId, false);
  const byLocale = new Map(locales.map((item) => [item.locale, item]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = requestedLocale;
  while (cursor && !seen.has(cursor) && chain.length < 16) {
    seen.add(cursor);
    const row = byLocale.get(cursor);
    if (!row) break;
    chain.push(cursor);
    cursor = row.fallback_locale;
  }
  return chain;
}
