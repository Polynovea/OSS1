/** Canonical persistence contract. Service boundaries consume operations, not
 * a provider SDK. PostgreSQL adapters can implement transactions directly;
 * the Supabase/PostgREST adapter uses audited PostgreSQL RPCs for atomic work. */
export type PersistenceFilter = { column: string; operator?: "eq" | "neq" | "in" | "is"; value: unknown };
export type PersistenceOrder = { column: string; ascending?: boolean };
export type PersistenceResult<T> = { data: T | null; error: string | null };

export interface PersistenceProvider {
  read<T>(input: { table: string; select?: string; filters?: PersistenceFilter[]; order?: PersistenceOrder[]; limit?: number; single?: boolean }): Promise<PersistenceResult<T>>;
  insert<T>(input: { table: string; values: unknown; select?: string; single?: boolean }): Promise<PersistenceResult<T>>;
  update<T>(input: { table: string; values: unknown; filters: PersistenceFilter[]; select?: string; single?: boolean }): Promise<PersistenceResult<T>>;
  remove(input: { table: string; filters: PersistenceFilter[] }): Promise<PersistenceResult<true>>;
  rpc<T>(name: string, args: Record<string, unknown>): Promise<PersistenceResult<T>>;
  /** Explicitly reports which atomic mechanism a service may use. */
  readonly atomicMode: "transaction" | "rpc";
}
