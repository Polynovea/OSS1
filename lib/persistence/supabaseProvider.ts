import { createServiceRoleClient } from "@/lib/admin/serviceRole";
import type { PersistenceFilter, PersistenceOrder, PersistenceProvider, PersistenceResult } from "@/lib/persistence/provider";

function applyFilters(query: any, filters: PersistenceFilter[] = []) {
  return filters.reduce((current, filter) => {
    if (filter.operator === "neq") return current.neq(filter.column, filter.value);
    if (filter.operator === "in") return current.in(filter.column, Array.isArray(filter.value) ? filter.value : []);
    if (filter.operator === "is") return current.is(filter.column, filter.value);
    return current.eq(filter.column, filter.value);
  }, query);
}

function result<T>(response: { data: T | null; error: { message: string } | null }): PersistenceResult<T> {
  return { data: response.data, error: response.error?.message ?? null };
}

/** The current supported application persistence adapter. */
export function getSupabasePersistenceProvider(): PersistenceProvider {
  const client = createServiceRoleClient();
  return {
    atomicMode: "rpc",
    async read<T>(input: { table: string; select?: string; filters?: PersistenceFilter[]; order?: PersistenceOrder[]; limit?: number; single?: boolean }) {
      const { table, select = "*", filters, order, limit, single } = input;
      let query: any = applyFilters(client.from(table).select(select), filters);
      for (const item of order ?? []) query = query.order(item.column, { ascending: item.ascending ?? true });
      if (limit) query = query.limit(limit);
      return result<T>(single ? await query.maybeSingle() : await query);
    },
    async insert<T>(input: { table: string; values: unknown; select?: string; single?: boolean }) {
      const { table, values, select = "*", single } = input;
      const query: any = client.from(table).insert(values as any).select(select);
      return result<T>(single ? await query.single() : await query);
    },
    async update<T>(input: { table: string; values: unknown; filters: PersistenceFilter[]; select?: string; single?: boolean }) {
      const { table, values, filters, select = "*", single } = input;
      const query: any = applyFilters(client.from(table).update(values as any).select(select), filters);
      return result<T>(single ? await query.single() : await query);
    },
    async remove(input: { table: string; filters: PersistenceFilter[] }) {
      const { table, filters } = input;
      const { error } = await applyFilters(client.from(table).delete(), filters);
      return { data: error ? null : true, error: error?.message ?? null };
    },
    async rpc<T>(name: string, args: Record<string, unknown>) {
      return result<T>(await client.rpc(name, args));
    },
  };
}
