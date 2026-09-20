-- OSS V1 release hardening: remove the pre-release identity-specific client
-- bootstrap policies from admin_users. First-admin provisioning is now a
-- server-only operation performed by `npm run bootstrap:admin` after the auth
-- identity exists. Ordinary browser sessions never write admin_users directly.

alter table admin_users enable row level security;

drop policy if exists "master_bootstrap_self_upsert_insert" on admin_users;
drop policy if exists "master_bootstrap_self_upsert_update" on admin_users;

-- Backfill/repair default-workspace membership for every legacy admin profile.
insert into workspace_members (workspace_id, admin_user_id, status)
select
  w.id,
  au.id,
  case when au.is_active then 'active' else 'suspended' end
from admin_users au
join workspaces w on w.slug = 'polynovea'
on conflict (workspace_id, admin_user_id)
do update set
  status = excluded.status,
  updated_at = now();

-- Keep the legacy global admin role aligned with the corresponding system role
-- in the seeded/default workspace. Custom non-system roles are preserved.
delete from member_roles mr
using workspace_members wm, roles r, workspaces w
where mr.workspace_member_id = wm.id
  and mr.role_id = r.id
  and r.workspace_id = w.id
  and wm.workspace_id = w.id
  and w.slug = 'polynovea'
  and r.is_system = true;

insert into member_roles (workspace_member_id, role_id)
select
  wm.id,
  r.id
from workspace_members wm
join admin_users au on au.id = wm.admin_user_id
join workspaces w on w.id = wm.workspace_id and w.slug = 'polynovea'
join roles r on r.workspace_id = w.id
  and r.key = case au.role
    when 'master' then 'owner'
    when 'admin' then 'admin'
    when 'editor' then 'editor'
    else 'viewer'
  end
on conflict do nothing;

update cms_runtime_state
set schema_migration = '0064', updated_at = now()
where singleton = true;
