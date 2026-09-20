import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import { logPlatformEvent } from "@/lib/platform/audit";

export interface TaxonomyRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  hierarchical: boolean;
  model_restrictions: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface TaxonomyTermRow {
  id: string;
  workspace_id: string;
  taxonomy_id: string;
  parent_term_id: string | null;
  name: string;
  slug: string;
  description: string | null;
  order_index: number;
  is_deprecated: boolean;
  deprecated_by_term_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  localizations?: { locale: string; label: string; description: string | null }[];
  aliases?: { alias: string; locale: string | null }[];
  children?: TaxonomyTermRow[];
}

export interface TermUsageSummary {
  termId: string;
  usageCount: number;
  entries: { entryId: string; versionId: string }[];
}

export async function listTaxonomies(workspaceId: string): Promise<TaxonomyRow[]> {
  const { data } = await createServiceRoleClient()
    .from("taxonomies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true });
  return (data as TaxonomyRow[]) ?? [];
}

export async function getTaxonomy(workspaceId: string, id: string): Promise<TaxonomyRow | null> {
  const { data } = await createServiceRoleClient()
    .from("taxonomies")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  return (data as TaxonomyRow) ?? null;
}

export async function createTaxonomy(params: {
  workspaceId: string;
  actorAdminUserId: string;
  name: string;
  slug: string;
  description?: string | null;
  hierarchical?: boolean;
  modelRestrictions?: string[] | null;
}): Promise<TaxonomyRow> {
  const db = createServiceRoleClient();
  const slug = params.slug.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-");
  const { data, error } = await db
    .from("taxonomies")
    .insert({
      workspace_id: params.workspaceId,
      name: params.name.trim(),
      slug,
      description: params.description?.trim() || null,
      hierarchical: params.hierarchical ?? false,
      model_restrictions: params.modelRestrictions && params.modelRestrictions.length ? params.modelRestrictions : null,
    })
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not create taxonomy");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "taxonomy.created",
    entityType: "taxonomy",
    entityId: data.id,
    metadata: { name: data.name, slug: data.slug },
  });

  return data as TaxonomyRow;
}

export async function updateTaxonomy(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
  name?: string;
  description?: string | null;
  modelRestrictions?: string[] | null;
}): Promise<TaxonomyRow> {
  const db = createServiceRoleClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) updates.name = params.name.trim();
  if (params.description !== undefined) updates.description = params.description?.trim() || null;
  if (params.modelRestrictions !== undefined) updates.model_restrictions = params.modelRestrictions;

  const { data, error } = await db
    .from("taxonomies")
    .update(updates)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id)
    .select()
    .single();

  if (error || !data) throw new Error(error?.message || "Could not update taxonomy");

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "taxonomy.updated",
    entityType: "taxonomy",
    entityId: data.id,
    metadata: updates,
  });

  return data as TaxonomyRow;
}

export async function deleteTaxonomy(params: {
  workspaceId: string;
  actorAdminUserId: string;
  id: string;
}): Promise<{ ok: true }> {
  const db = createServiceRoleClient();
  const { error } = await db
    .from("taxonomies")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.id);

  if (error) throw new Error(error.message);

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "taxonomy.deleted",
    entityType: "taxonomy",
    entityId: params.id,
    metadata: {},
  });

  return { ok: true };
}

// ── Terms & Hierarchy ────────────────────────────────────────────────────────

export async function listTerms(workspaceId: string, taxonomyId: string): Promise<TaxonomyTermRow[]> {
  const db = createServiceRoleClient();
  const [termsRes, locRes, aliasRes] = await Promise.all([
    db
      .from("taxonomy_terms")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("taxonomy_id", taxonomyId)
      .order("order_index", { ascending: true })
      .order("name", { ascending: true }),
    db.from("taxonomy_term_localizations").select("*").eq("workspace_id", workspaceId),
    db.from("taxonomy_term_aliases").select("*").eq("workspace_id", workspaceId),
  ]);

  const terms = (termsRes.data as TaxonomyTermRow[]) ?? [];
  const localizations = (locRes.data as { term_id: string; locale: string; label: string; description: string | null }[]) ?? [];
  const aliases = (aliasRes.data as { term_id: string; alias: string; locale: string | null }[]) ?? [];

  const termMap = new Map<string, TaxonomyTermRow>();
  for (const t of terms) {
    t.localizations = localizations.filter((l) => l.term_id === t.id);
    t.aliases = aliases.filter((a) => a.term_id === t.id);
    t.children = [];
    termMap.set(t.id, t);
  }

  const rootTerms: TaxonomyTermRow[] = [];
  for (const t of terms) {
    if (t.parent_term_id && termMap.has(t.parent_term_id)) {
      termMap.get(t.parent_term_id)!.children!.push(t);
    } else {
      rootTerms.push(t);
    }
  }

  return rootTerms;
}

export async function getTerm(workspaceId: string, termId: string): Promise<TaxonomyTermRow | null> {
  const db = createServiceRoleClient();
  const { data: term } = await db
    .from("taxonomy_terms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", termId)
    .maybeSingle();

  if (!term) return null;

  const [locRes, aliasRes] = await Promise.all([
    db.from("taxonomy_term_localizations").select("*").eq("workspace_id", workspaceId).eq("term_id", termId),
    db.from("taxonomy_term_aliases").select("*").eq("workspace_id", workspaceId).eq("term_id", termId),
  ]);

  return {
    ...(term as TaxonomyTermRow),
    localizations: locRes.data ?? [],
    aliases: aliasRes.data ?? [],
  };
}

export async function createTerm(params: {
  workspaceId: string;
  actorAdminUserId: string;
  taxonomyId: string;
  parentTermId?: string | null;
  name: string;
  slug: string;
  description?: string | null;
  orderIndex?: number;
  localizations?: { locale: string; label: string; description?: string | null }[];
  aliases?: { alias: string; locale?: string | null }[];
}): Promise<TaxonomyTermRow> {
  const db = createServiceRoleClient();
  const slug = params.slug.toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "-");

  const { data: term, error } = await db
    .from("taxonomy_terms")
    .insert({
      workspace_id: params.workspaceId,
      taxonomy_id: params.taxonomyId,
      parent_term_id: params.parentTermId || null,
      name: params.name.trim(),
      slug,
      description: params.description?.trim() || null,
      order_index: params.orderIndex ?? 0,
    })
    .select()
    .single();

  if (error || !term) throw new Error(error?.message || "Could not create taxonomy term");

  if (params.localizations && params.localizations.length) {
    await db.from("taxonomy_term_localizations").insert(
      params.localizations.map((l) => ({
        workspace_id: params.workspaceId,
        term_id: term.id,
        locale: l.locale,
        label: l.label,
        description: l.description || null,
      }))
    );
  }

  if (params.aliases && params.aliases.length) {
    await db.from("taxonomy_term_aliases").insert(
      params.aliases.map((a) => ({
        workspace_id: params.workspaceId,
        term_id: term.id,
        alias: a.alias.trim(),
        locale: a.locale || null,
      }))
    );
  }

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "taxonomy.term.created",
    entityType: "taxonomy_term",
    entityId: term.id,
    metadata: { taxonomyId: params.taxonomyId, name: term.name, slug: term.slug },
  });

  return (await getTerm(params.workspaceId, term.id))!;
}

export async function updateTerm(params: {
  workspaceId: string;
  actorAdminUserId: string;
  termId: string;
  name?: string;
  description?: string | null;
  parentTermId?: string | null;
  orderIndex?: number;
  localizations?: { locale: string; label: string; description?: string | null }[];
  aliases?: { alias: string; locale?: string | null }[];
}): Promise<TaxonomyTermRow> {
  const db = createServiceRoleClient();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (params.name !== undefined) updates.name = params.name.trim();
  if (params.description !== undefined) updates.description = params.description?.trim() || null;
  if (params.parentTermId !== undefined) updates.parent_term_id = params.parentTermId;
  if (params.orderIndex !== undefined) updates.order_index = params.orderIndex;

  const { data: term, error } = await db
    .from("taxonomy_terms")
    .update(updates)
    .eq("workspace_id", params.workspaceId)
    .eq("id", params.termId)
    .select()
    .single();

  if (error || !term) throw new Error(error?.message || "Could not update taxonomy term");

  if (params.localizations !== undefined) {
    await db.from("taxonomy_term_localizations").delete().eq("term_id", params.termId);
    if (params.localizations.length) {
      await db.from("taxonomy_term_localizations").insert(
        params.localizations.map((l) => ({
          workspace_id: params.workspaceId,
          term_id: params.termId,
          locale: l.locale,
          label: l.label,
          description: l.description || null,
        }))
      );
    }
  }

  if (params.aliases !== undefined) {
    await db.from("taxonomy_term_aliases").delete().eq("term_id", params.termId);
    if (params.aliases.length) {
      await db.from("taxonomy_term_aliases").insert(
        params.aliases.map((a) => ({
          workspace_id: params.workspaceId,
          term_id: params.termId,
          alias: a.alias.trim(),
          locale: a.locale || null,
        }))
      );
    }
  }

  await logPlatformEvent({
    workspaceId: params.workspaceId,
    actorAdminUserId: params.actorAdminUserId,
    action: "taxonomy.term.updated",
    entityType: "taxonomy_term",
    entityId: term.id,
    metadata: updates,
  });

  return (await getTerm(params.workspaceId, term.id))!;
}

/**
 * Atomic Term Merge:
 * Merges sourceTerm into targetTerm:
 * 1. Checks that source and target terms belong to the same taxonomy.
 * 2. Re-points all active draft version term assignments from source to target.
 * 3. Does NOT rewrite historical immutable version term assignments.
 * 4. Marks source term is_deprecated = true and deprecated_by_term_id = targetTermId.
 * 5. Copies source term aliases to target term.
 * 6. Logs platform audit event.
 */
export async function mergeTerms(params: {
  workspaceId: string;
  actorAdminUserId: string;
  sourceTermId: string;
  targetTermId: string;
}): Promise<{ ok: true; sourceTermId: string; targetTermId: string }> {
  if (params.sourceTermId === params.targetTermId) {
    throw new Error("Cannot merge a term into itself");
  }

  const db = createServiceRoleClient();
  const { data, error } = await db.rpc("cms_merge_taxonomy_terms", {
    p_workspace_id: params.workspaceId,
    p_actor_id: params.actorAdminUserId,
    p_source_term_id: params.sourceTermId,
    p_target_term_id: params.targetTermId,
  });

  if (error) throw new Error(error.message);

  return { ok: true, sourceTermId: params.sourceTermId, targetTermId: params.targetTermId };
}

// ── Version-Aware Term Assignments ──────────────────────────────────────────

export async function assignVersionTerms(params: {
  workspaceId: string;
  entryId: string;
  versionId: string;
  termIds: string[];
}): Promise<void> {
  const db = createServiceRoleClient();
  await db
    .from("content_entry_version_terms")
    .delete()
    .eq("workspace_id", params.workspaceId)
    .eq("version_id", params.versionId);

  if (params.termIds.length === 0) return;

  const rows = params.termIds.map((termId) => ({
    workspace_id: params.workspaceId,
    entry_id: params.entryId,
    version_id: params.versionId,
    term_id: termId,
  }));

  const { error } = await db.from("content_entry_version_terms").insert(rows);
  if (error) throw new Error(error.message);
}

export async function getVersionTerms(workspaceId: string, versionId: string): Promise<TaxonomyTermRow[]> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("content_entry_version_terms")
    .select("term_id, taxonomy_terms(*)")
    .eq("workspace_id", workspaceId)
    .eq("version_id", versionId);

  return (data ?? []).map((row: any) => row.taxonomy_terms).filter(Boolean);
}

export async function getTermUsage(workspaceId: string, termId: string): Promise<TermUsageSummary> {
  const db = createServiceRoleClient();
  const { data } = await db
    .from("content_entry_version_terms")
    .select("entry_id, version_id")
    .eq("workspace_id", workspaceId)
    .eq("term_id", termId);

  const entries = (data ?? []).map((row) => ({
    entryId: row.entry_id,
    versionId: row.version_id,
  }));

  return {
    termId,
    usageCount: entries.length,
    entries,
  };
}
