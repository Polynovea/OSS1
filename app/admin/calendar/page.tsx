"use client";

import { FormEvent, useEffect, useState } from "react";
import AdminLayout from "@/components/admin/AdminLayout";
import { CalendarDays, Plus, RefreshCw } from "lucide-react";

type Event = { id: string; title: string; kind: string; starts_at: string; status: string };

function statusBadge(status: string) {
  if (["completed", "published"].includes(status)) return "ui-badge ui-badge-success";
  if (["cancelled", "failed"].includes(status)) return "ui-badge ui-badge-danger";
  return "ui-badge ui-badge-pending";
}

export default function CalendarPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("review_due");
  const [startsAt, setStartsAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/calendar");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEvents(body.data || []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load calendar"); }
    finally { setBusy(false); }
  };

  useEffect(() => { void load(); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/calendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, kind, startsAt: new Date(startsAt).toISOString() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setTitle(""); setStartsAt(""); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not schedule event"); }
    finally { setBusy(false); }
  };

  return (
    <AdminLayout>
      <div className="ui-page mx-auto max-w-5xl">
        <header className="ui-page-header">
          <div><p className="ui-eyebrow">Editorial operations</p><h1 className="ui-page-title">Calendar</h1><p className="ui-page-description">Review, approval, publish, release and expiry events in one operational timeline.</p></div>
          <CalendarDays className="text-icon-muted" size={20} />
        </header>

        {error ? <div className="ui-alert ui-alert-danger mt-5">{error}</div> : null}

        <section className="ui-section">
          <h2 className="ui-section-title">Schedule event</h2>
          <form onSubmit={submit} className="mt-4 grid gap-4 rounded-2xl bg-surface-1 p-5 md:grid-cols-[1fr_180px_220px_auto]">
            <label><span className="text-[12px] font-medium text-fg-secondary">Event</span><input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Review product launch" className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></label>
            <label><span className="text-[12px] font-medium text-fg-secondary">Type</span><select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm">{["draft_due","review_due","approval_due","publish","release","expiry","campaign"].map((value) => <option key={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
            <label><span className="text-[12px] font-medium text-fg-secondary">When</span><input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-2 w-full rounded-lg px-3 py-2.5 text-sm" /></label>
            <div className="flex items-end"><button disabled={busy} className="ui-btn ui-btn-primary w-full"><Plus size={13} />Schedule</button></div>
          </form>
        </section>

        <section className="ui-section">
          <div className="mb-4 flex items-end justify-between"><div><h2 className="ui-section-title">Upcoming timeline</h2><p className="ui-section-description">Editorial commitments ordered by their scheduled time.</p></div><span className="text-[12px] text-fg-muted">{events.length} events</span></div>
          {busy && !events.length ? <div className="py-12 text-center text-fg-muted"><RefreshCw className="mx-auto animate-spin" /></div> : events.length ? <div className="border-y border-subtle">{events.map((event) => <div key={event.id} className="ui-list-row py-4"><div className="w-1.5 self-stretch rounded-full bg-review-muted" /><div className="min-w-0 flex-1"><p className="font-semibold text-fg-primary">{event.title}</p><p className="mt-1 text-[12px] text-fg-muted">{event.kind.replaceAll("_", " ")} · {new Date(event.starts_at).toLocaleString()}</p></div><span className={statusBadge(event.status)}>{event.status}</span></div>)}</div> : <div className="ui-empty rounded-xl bg-surface-1"><p className="ui-empty-title">No editorial events scheduled</p><p className="ui-empty-copy">Add a review, approval, publishing or expiry event when the workflow needs a time-bound commitment.</p></div>}
        </section>
      </div>
    </AdminLayout>
  );
}
