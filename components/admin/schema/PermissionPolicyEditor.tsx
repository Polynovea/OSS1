"use client";

import { Plus, Trash2 } from "lucide-react";
import { MODEL_OPERATIONS, type ModelCapability, type ModelOperation, type ModelPermissionPolicy } from "@/lib/schema/fields/types";

interface WorkspaceRole {
  key: string;
  name: string;
}

interface PermissionPolicyEditorProps {
  policies: ModelPermissionPolicy[];
  onChange: (policies: ModelPermissionPolicy[]) => void;
  roles: WorkspaceRole[];
  capability: ModelCapability;
}

/**
 * Schema-level policy intent (ADR-016) — not itself an enforcement point.
 * Mirrors the server's structural rule here so an author sees the
 * constraint before submit rather than after a 400.
 */
export default function PermissionPolicyEditor({ policies, onChange, roles, capability }: PermissionPolicyEditorProps) {
  const usedRoles = new Set(policies.map((p) => p.role));
  const availableRoles = roles.filter((r) => !usedRoles.has(r.key));

  function addPolicy() {
    const nextRole = availableRoles[0]?.key ?? roles[0]?.key;
    if (!nextRole) return;
    onChange([...policies, { role: nextRole, operations: ["read"] }]);
  }

  function updatePolicy(index: number, patch: Partial<ModelPermissionPolicy>) {
    onChange(policies.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  }

  function toggleOperation(index: number, operation: ModelOperation, checked: boolean) {
    const policy = policies[index];
    const operations = checked ? [...policy.operations, operation] : policy.operations.filter((op) => op !== operation);
    updatePolicy(index, { operations });
  }

  return (
    <div className="flex flex-col gap-3">
      {policies.length === 0 && <p className="text-xs text-fg-muted">No role policy configured — access is governed only by the workspace's default schema/entry permissions.</p>}
      {policies.map((policy, index) => (
        <div key={index} className="rounded-xl border border-subtle bg-field p-4">
          <div className="flex items-center justify-between gap-3">
            <select
              value={policy.role}
              onChange={(e) => updatePolicy(index, { role: e.target.value })}
              className="rounded-lg border border-default bg-field px-3 py-2 text-sm text-fg-primary outline-none focus:border-action/50"
            >
              <option value={policy.role}>{roles.find((r) => r.key === policy.role)?.name ?? policy.role}</option>
              {availableRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
            <button type="button" onClick={() => onChange(policies.filter((_, i) => i !== index))} className="rounded-lg p-2 text-fg-muted hover:bg-danger-muted hover:text-danger" aria-label="Remove role policy">
              <Trash2 size={15} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-4">
            {MODEL_OPERATIONS.map((operation) => {
              const disabled = operation === "publish" && capability === "data_only";
              return (
                <label key={operation} className={`flex items-center gap-2 text-xs font-medium capitalize ${disabled ? "text-fg-muted" : "text-fg-secondary"}`} title={disabled ? "Publishing does not apply to data-only models" : undefined}>
                  <input
                    type="checkbox"
                    checked={policy.operations.includes(operation)}
                    disabled={disabled}
                    onChange={(e) => toggleOperation(index, operation, e.target.checked)}
                    className="accent-[#E6D3A3]"
                  />
                  {operation}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={addPolicy}
        disabled={roles.length === 0 || availableRoles.length === 0}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-action/20 px-3 py-2 text-xs font-bold text-action disabled:opacity-40"
      >
        <Plus size={14} /> Add role policy
      </button>
    </div>
  );
}
