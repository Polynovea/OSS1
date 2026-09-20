import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const collaboration = readFileSync("supabase/migrations/0019_editorial_collaboration.sql", "utf8");
const calendar = readFileSync("supabase/migrations/0020_editorial_calendar.sql", "utf8");

describe("Phase 5 collaboration and calendar migrations", () => {
  it("keeps every collaboration table workspace-scoped and RLS default-deny", () => {
    for (const table of ["content_assignments", "content_comments", "content_comment_mentions", "content_entry_watchers", "editorial_notifications"]) {
      expect(collaboration).toContain(`create table if not exists ${table}`);
      expect(collaboration).toContain(`alter table ${table} enable row level security`);
    }
    expect(collaboration).toContain("workspace_id uuid not null references workspaces(id) on delete cascade");
  });

  it("protects assignment queues, comment threading, and notification inboxes with indexes", () => {
    for (const index of ["content_assignments_assignee_queue_idx", "content_comments_entry_thread_idx", "editorial_notifications_inbox_idx"]) expect(collaboration).toContain(index);
    expect(collaboration).toContain("unique (entry_id, assigned_to_admin_user_id, role)");
    expect(collaboration).toContain("parent_comment_id uuid references content_comments(id) on delete cascade");
  });

  it("requires valid calendar ranges and keeps calendar events workspace-isolated", () => {
    expect(calendar).toContain("workspace_id uuid not null references workspaces(id) on delete cascade");
    expect(calendar).toContain("check (ends_at is null or ends_at >= starts_at)");
    expect(calendar).toContain("editorial_calendar_events_workspace_range_idx");
    expect(calendar).toContain("alter table editorial_calendar_events enable row level security");
  });
});
