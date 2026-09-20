"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, MessageSquare, Send, Undo2 } from "lucide-react";

type Stage = { key: string; label: string; required_approvals: number; required_role_keys: string[] };
type Workflow = {
  id: string;
  current_state: string;
  current_stage?: number;
  workflow_actions?: Array<{ id: string; action: string; comment: string | null; created_at?: string }>;
  workflow_stage_approvals?: Array<{ id: string; stage_index: number; actor_id: string }>;
  workflow_definitions?: { id: string; name: string; definition_json: { self_approval?: boolean; approval_stages?: Stage[] } } | null;
};

export default function WorkflowPanel({ entryId, onChanged }: { entryId: string; onChanged: () => void }) {
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [status, setStatus] = useState("draft");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const res = await fetch(`/api/entries/${entryId}/workflow`);
      const body = await res.json();
      if (res.ok) { setWorkflow(body.data.workflow); setStatus(body.data.entryStatus || "draft"); }
    } catch { /* sidebar remains usable */ }
  };
  useEffect(() => { if (entryId) void load(); }, [entryId]);

  const action = async (next: "submit" | "approve" | "request_changes") => {
    setBusy(true); setError("");
    try {
      const res = await fetch(`/api/entries/${entryId}/workflow`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: next, comment }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || "Workflow action failed");
      setComment(""); await load(); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Workflow action failed"); }
    finally { setBusy(false); }
  };

  const definition = workflow?.workflow_definitions;
  const stages = definition?.definition_json?.approval_stages?.length ? definition.definition_json.approval_stages : [{ key: "editorial", label: "Editorial approval", required_approvals: 1, required_role_keys: [] }];
  const stageIndex = Math.min(workflow?.current_stage ?? 0, Math.max(0, stages.length - 1));
  const currentStage = stages[stageIndex];
  const stageApprovals = useMemo(() => (workflow?.workflow_stage_approvals || []).filter((item)=>item.stage_index===stageIndex).length, [workflow, stageIndex]);
  const reviewing = workflow?.current_state === "in_review";
  const title = reviewing ? currentStage.label : status === "approved" ? "Approved for publication" : status === "published" ? "Published" : "Draft workspace";

  return <section className="rounded-2xl border border-action/20 bg-action/[0.035] p-5">
    <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-action">Editorial gate</p><h2 className="mt-1 text-base font-bold text-fg-primary">{title}</h2>{definition?.name&&<p className="mt-1 text-[10px] text-fg-muted">{definition.name}</p>}</div>{busy&&<Loader2 size={16} className="animate-spin text-action"/>}</div>
    {reviewing ? <div className="mt-3 rounded-lg border border-subtle bg-field p-3"><div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-fg-muted"><span>Stage {stageIndex+1} of {stages.length}</span><span>{stageApprovals}/{currentStage.required_approvals} approvals</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-action" style={{width:`${Math.min(100,Math.round((stageApprovals/currentStage.required_approvals)*100))}%`}}/></div>{currentStage.required_role_keys?.length?<p className="mt-2 text-[10px] text-fg-muted">Role gate: {currentStage.required_role_keys.join(", ")}</p>:null}</div> : null}
    <p className="mt-3 text-xs leading-5 text-fg-muted">{reviewing?"A publishing-capable reviewer who satisfies this stage's role gate must make the decision.":status==="approved"?"The approved draft can now be added to a controlled release or published.":"Submit this draft when it is ready for independent review."}</p>
    <textarea value={comment} onChange={(event)=>setComment(event.target.value)} rows={2} placeholder="Optional note to the reviewer" className="mt-4 w-full resize-none rounded-lg border border-subtle bg-field px-3 py-2 text-xs text-fg-primary outline-none focus:border-action/45"/>
    {status==="draft"&&!reviewing&&<button type="button" disabled={busy} onClick={()=>void action("submit")} className="mt-3 inline-flex items-center gap-2 rounded-lg ui-btn ui-btn-primary disabled:opacity-50"><Send size={13}/> Submit for review</button>}
    {reviewing&&<div className="mt-3 flex gap-2"><button type="button" disabled={busy} onClick={()=>void action("approve")} className="inline-flex items-center gap-1.5 rounded-lg bg-success-muted text-success disabled:opacity-50"><Check size={13}/> Approve stage</button><button type="button" disabled={busy} onClick={()=>void action("request_changes")} className="inline-flex items-center gap-1.5 rounded-lg border border-warning px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-warning disabled:opacity-50"><Undo2 size={13}/> Changes</button></div>}
    {error&&<p className="mt-3 text-xs text-danger">{error}</p>}
    {workflow?.workflow_actions?.length?<div className="mt-5 border-t border-subtle pt-4">{[...workflow.workflow_actions].sort((a,b)=>String(b.created_at||"").localeCompare(String(a.created_at||""))).slice(0,6).map((item)=><div key={item.id} className="mb-2 flex gap-2 text-[10px]"><MessageSquare size={11} className="mt-0.5 shrink-0 text-fg-muted"/><span className="text-fg-muted"><strong className="font-semibold text-fg-secondary">{item.action.replaceAll("_"," ")}</strong>{item.comment?` — ${item.comment}`:""}</span></div>)}</div>:null}
  </section>;
}
