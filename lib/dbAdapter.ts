import { getSupabasePersistenceProvider } from "@/lib/persistence/supabaseProvider";

type TableName = "blog_posts" | "live_metrics" | "social_posts" | "ad_campaigns";

function orderColumn(table: TableName): string {
  if (table === "blog_posts") return "published_at";
  return "id";
}

export async function getDbItems(table: TableName) {
  const { data, error } = await getSupabasePersistenceProvider().read<any[]>({ table, order: [{ column: orderColumn(table), ascending: false }] });
  if (error) return { data: [], error };
  return { data: data ?? [], error: null };
}

export async function insertDbItem(table: TableName, item: any) {
  const { data, error } = await getSupabasePersistenceProvider().insert<any>({ table, values: item, single: true });
  if (error) return { data: null, error };
  return { data, error: null };
}

export async function updateDbItem(table: TableName, id: string | number, item: any) {
  const { data, error } = await getSupabasePersistenceProvider().update<any>({ table, values: item, filters: [{ column: "id", value: id }], single: true });
  if (error) return { data: null, error };
  return { data, error: null };
}

export async function getDbItem(table: TableName, id: string | number) {
  const { data, error } = await getSupabasePersistenceProvider().read<any>({ table, filters: [{ column: "id", value: id }], single: true });
  if (error) return { data: null, error };
  return { data: data ?? null, error: null };
}

export async function getDbItemByField(table: TableName, field: string, value: string) {
  const { data, error } = await getSupabasePersistenceProvider().read<any>({ table, filters: [{ column: field, value }], single: true });
  if (error) return { data: null, error };
  return { data: data ?? null, error: null };
}

export async function deleteDbItem(table: TableName, id: string | number) {
  const { error } = await getSupabasePersistenceProvider().remove({ table, filters: [{ column: "id", value: id }] });
  if (error) return { success: false, error };
  return { success: true, error: null };
}

export async function bulkUpsertMetrics(body: any[]) {
  const provider = getSupabasePersistenceProvider();
  const { error: deleteError } = await provider.remove({ table: "live_metrics", filters: [{ column: "id", operator: "neq", value: 0 }] });
  if (deleteError) return { data: null, error: deleteError };

  // Rows with an id (edited existing metrics) and rows without one (newly added
  // metrics) must be inserted in separate calls — a single batch insert with a
  // mix of the two sends an explicit NULL for "id" on the id-less rows instead
  // of letting the column's default apply, which violates the NOT NULL constraint.
  const withId = body.filter((row) => row.id != null);
  const withoutId = body.filter((row) => row.id == null).map(({ id, ...rest }) => rest);

  const results: any[] = [];
  if (withId.length) {
    const { data, error } = await provider.insert<any[]>({ table: "live_metrics", values: withId });
    if (error) return { data: null, error };
    results.push(...(data ?? []));
  }
  if (withoutId.length) {
    const { data, error } = await provider.insert<any[]>({ table: "live_metrics", values: withoutId });
    if (error) return { data: null, error };
    results.push(...(data ?? []));
  }

  return { data: results, error: null };
}
