-- Phase 1, Milestone B — Workspace + Entity backend.
--
-- Establishes the generic ownership/authorization boundary (ADR-001) and
-- the subordinate Entity concept (brand/site/client/etc.), seeded with
-- Polynovea's own workspace and one "Polynovea" entity — no fake/client
-- venue entities (the venue product is a separate, future redesign).
--
-- admin_users is NOT touched or removed. It keeps resolving Supabase
-- sessions to a legacy profile exactly as today (lib/admin/serverAccess.ts).
-- This migration adds a *parallel* workspace-membership layer on top of it,
-- consumed only by new code (lib/platform/*) — every existing route and
-- permission check is unaffected.
--
-- Every table below gets RLS enabled with no policy (default-deny) in this
-- same migration, matching the standard established in Milestone A
-- (ADR-002) — nothing about Milestone B should reopen the anon-key-bypass
-- gap that was just closed. No browser code calls any of these tables
-- directly; all access goes through lib/platform/*, server-side, via the
-- service-role client, exactly like every other generic table in this app.

create table if not exists workspaces (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  slug text not null unique,
  status text not null check (status in ('active', 'suspended')) default 'active',
  default_locale text not null default 'en',
  timezone text not null default 'UTC',
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists entities (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  type text not null check (type in ('brand', 'site', 'client', 'publication', 'project', 'other')) default 'brand',
  status text not null check (status in ('active', 'archived')) default 'active',
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, slug)
);

create table if not exists roles (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, key)
);

create table if not exists permissions (
  key text primary key,
  description text not null,
  created_at timestamptz default now()
);

create table if not exists role_permissions (
  role_id uuid not null references roles(id) on delete cascade,
  permission_key text not null references permissions(key) on delete cascade,
  created_at timestamptz default now(),
  primary key (role_id, permission_key)
);

create table if not exists workspace_members (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  admin_user_id uuid not null references admin_users(id) on delete cascade,
  status text not null check (status in ('active', 'invited', 'suspended')) default 'active',
  joined_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, admin_user_id)
);

create table if not exists member_roles (
  workspace_member_id uuid not null references workspace_members(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (workspace_member_id, role_id)
);

create index if not exists entities_workspace_idx on entities(workspace_id);
create index if not exists roles_workspace_idx on roles(workspace_id);
create index if not exists workspace_members_workspace_idx on workspace_members(workspace_id);
create index if not exists workspace_members_admin_user_idx on workspace_members(admin_user_id);
create index if not exists member_roles_role_idx on member_roles(role_id);

alter table workspaces enable row level security;
alter table entities enable row level security;
alter table roles enable row level security;
alter table permissions enable row level security;
alter table role_permissions enable row level security;
alter table workspace_members enable row level security;
alter table member_roles enable row level security;

-- ── Compatibility path: entity_id alongside the existing entity text column ─
-- Per the locked decision (ADR-001), the historical `entity` text column on
-- these two tables is NOT the workspace/security boundary and is left
-- exactly as-is. This adds the forward-compatible FK, unused by application
-- code yet — no backfill of venue-based entities (out of scope, see
-- docs/upgrade/CURRENT_ARCHITECTURE.md on the decommissioned venue lookup).
alter table social_posts add column if not exists entity_id uuid references entities(id);
alter table ad_campaigns add column if not exists entity_id uuid references entities(id);

-- ── Seed: Polynovea workspace + entity ──────────────────────────────────────
insert into workspaces (name, slug)
values ('Polynovea', 'polynovea')
on conflict (slug) do nothing;

insert into entities (workspace_id, name, slug, type)
select w.id, 'Polynovea', 'polynovea', 'brand'
from workspaces w
where w.slug = 'polynovea'
on conflict (workspace_id, slug) do nothing;

-- ── Seed: permission catalog ─────────────────────────────────────────────────
insert into permissions (key, description) values
  ('workspace.read',        'View workspace settings and membership'),
  ('workspace.manage',      'Manage workspace settings, membership, and ownership'),
  ('content.model.read',    'View content model definitions'),
  ('content.model.manage',  'Create, edit, and version content models'),
  ('content.entry.read',    'View content entries'),
  ('content.entry.create',  'Create new content entries'),
  ('content.entry.edit',    'Edit content entries'),
  ('content.entry.publish', 'Publish content entries'),
  ('content.entry.archive', 'Archive content entries'),
  ('content.entry.delete',  'Delete content entries'),
  ('media.read',            'View media assets'),
  ('media.upload',          'Upload media assets'),
  ('media.manage',          'Edit or delete any media asset'),
  ('schema.read',           'View schema/model definitions and versions'),
  ('schema.manage',         'Create, modify, and apply schema changes'),
  ('users.read',            'View workspace members and roles'),
  ('users.manage',          'Invite, remove, or change roles of workspace members')
on conflict (key) do nothing;

-- ── Seed: default roles for the Polynovea workspace ─────────────────────────
insert into roles (workspace_id, key, name, description, is_system)
select w.id, r.key, r.name, r.description, true
from workspaces w
cross join (values
  ('owner',  'Owner',  'Full control, including workspace management'),
  ('admin',  'Admin',  'Full content/schema/media/user control, excluding workspace management'),
  ('editor', 'Editor', 'Create, edit, and publish content — cannot archive, delete, or manage schema/users'),
  ('viewer', 'Viewer', 'Read-only access')
) as r(key, name, description)
where w.slug = 'polynovea'
on conflict (workspace_id, key) do nothing;

-- ── Seed: role → permission mapping ─────────────────────────────────────────
insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join workspaces w on w.id = r.workspace_id and w.slug = 'polynovea'
cross join permissions p
where r.key = 'owner'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join workspaces w on w.id = r.workspace_id and w.slug = 'polynovea'
cross join permissions p
where r.key = 'admin' and p.key <> 'workspace.manage'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join workspaces w on w.id = r.workspace_id and w.slug = 'polynovea'
cross join (values
  ('workspace.read'), ('content.model.read'), ('content.entry.read'),
  ('content.entry.create'), ('content.entry.edit'), ('content.entry.publish'),
  ('media.read'), ('media.upload'), ('schema.read')
) as p(key)
where r.key = 'editor'
on conflict do nothing;

insert into role_permissions (role_id, permission_key)
select r.id, p.key
from roles r
join workspaces w on w.id = r.workspace_id and w.slug = 'polynovea'
cross join (values
  ('workspace.read'), ('content.model.read'), ('content.entry.read'),
  ('media.read'), ('schema.read')
) as p(key)
where r.key = 'viewer'
on conflict do nothing;

-- ── Backfill: map existing admin_users into workspace_members + member_roles ─
-- Note: server-side code always bypasses admin_users for the hardcoded
-- master account (lib/admin/constants.ts MASTER_EMAIL), regardless of
-- whether a row exists for it — see lib/admin/access.ts and
-- lib/platform/permissions.ts. admin_users is, and has always been, the
-- real mechanism controlling CMS access; a row for the master email has
-- existed since the CMS was first built, and this backfill maps it to
-- 'owner' via the case branch below like any other row. Either way,
-- master's actual access is granted by the code-level bypass, not by this
-- table. See docs/adr/ADR-013-cms-actor-vs-external-identity.md.
insert into workspace_members (workspace_id, admin_user_id, status)
select w.id, au.id, case when au.is_active then 'active' else 'suspended' end
from admin_users au
join workspaces w on w.slug = 'polynovea'
on conflict (workspace_id, admin_user_id) do nothing;

insert into member_roles (workspace_member_id, role_id)
select wm.id, r.id
from workspace_members wm
join admin_users au on au.id = wm.admin_user_id
join roles r on r.workspace_id = wm.workspace_id
  and r.key = case au.role
    when 'master' then 'owner'
    when 'admin' then 'admin'
    when 'editor' then 'editor'
    else 'viewer'
  end
on conflict do nothing;

-- Manual verification checklist:
--
-- 1. Confirm one workspace exists: select * from workspaces; -- 1 row, slug='polynovea'
-- 2. Confirm one entity exists: select * from entities; -- 1 row, slug='polynovea'
-- 3. Confirm 17 permissions, 4 roles, and role_permissions counts match the
--    mapping above (owner=17, admin=16, editor=9, viewer=5).
-- 4. Confirm every row in admin_users has a matching workspace_members row
--    (except none is expected for the hardcoded master account, which has
--    no admin_users row):
--      select count(*) from admin_users;
--      select count(*) from workspace_members;  -- should match
-- 5. Confirm every admin_users role mapped to the correct role key via
--    member_roles — spot check a couple of known accounts.
-- 6. Existing CMS/Content Tracking screens should be completely unaffected
--    — nothing in the current application queries these new tables yet.
