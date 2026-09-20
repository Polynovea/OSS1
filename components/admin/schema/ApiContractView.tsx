"use client";

import type { CanonicalSchema, FieldDefinition } from "@/lib/schema/fields/types";

function exampleValue(field: FieldDefinition): unknown {
  switch (field.type) {
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "date":
      return "2026-01-01";
    case "datetime":
      return "2026-01-01T00:00:00.000Z";
    case "select":
      return field.validation?.options?.[0] ?? "string";
    case "multi_select":
      return field.validation?.options?.slice(0, 1) ?? ["string"];
    case "json":
      return {};
    case "media":
    case "file":
      return { assetId: "uuid", url: "string" };
    case "relation":
      return field.relation?.cardinality === "one_to_many" || field.relation?.cardinality === "many_to_many" ? ["uuid"] : "uuid";
    case "component":
      return {};
    case "repeater":
      return [];
    default:
      return "string";
  }
}

/**
 * A read-only preview of the generated record contract — not a live
 * OpenAPI document (that is Phase 12's Developer Platform work), but
 * enough for an engineer to see the exact shape this model's fields
 * compile to today. See V2 §13 Phase 2 ("API view").
 */
export default function ApiContractView({ schema, apiKey, modelId }: { schema: CanonicalSchema; apiKey: string; modelId: string }) {
  const example = Object.fromEntries(schema.fields.map((field) => [field.key, exampleValue(field)]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Endpoints</p>
        <div className="mt-2 space-y-1.5 font-mono text-xs text-fg-secondary">
          <p><span className="text-success">GET</span> /api/entries?modelId={modelId} <span className="ml-1 font-sans text-fg-muted">({apiKey})</span></p>
          <p><span className="text-success">GET</span> /api/entries/:id</p>
          <p><span className="text-warning">POST</span> /api/entries <span className="ml-1 font-sans text-fg-muted">{"{ modelId, data }"}</span></p>
          <p><span className="text-info">PUT</span> /api/entries/:id <span className="ml-1 font-sans text-fg-muted">{"{ data }"}</span></p>
        </div>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-fg-muted">Example record fields</p>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg border border-subtle bg-field p-4 text-xs text-fg-secondary">{JSON.stringify(example, null, 2)}</pre>
      </div>
      {schema.fields.some((f) => f.providerSpecific) && (
        <p className="rounded-lg border border-warning bg-warning-muted px-3 py-2 text-xs text-warning">
          One or more fields are marked provider-specific — their API representation may not be portable across every supported PostgreSQL host.
        </p>
      )}
    </div>
  );
}
