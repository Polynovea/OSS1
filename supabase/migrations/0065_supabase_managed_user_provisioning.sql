-- Enable once after disabling public signups in Supabase Auth settings.
-- Opt-in: some installations share Auth with public-facing applications.
create table public.cms_auth_provisioning (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  workspace_slug text not null default 'polynovea'
);
alter table public.cms_auth_provisioning enable row level security;
revoke all on public.cms_auth_provisioning from public, anon, authenticated;
insert into public.cms_auth_provisioning (singleton) values (true);

create or replace function public.provision_managed_auth_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  target_workspace uuid;
  target_role uuid;
  profile_id uuid;
  member_id uuid;
  configured_slug text;
begin
  select workspace_slug into configured_slug
  from public.cms_auth_provisioning where singleton and enabled;
  if configured_slug is null then return new; end if;
  if new.email is null or btrim(new.email) = '' then return new; end if;

  select w.id, r.id into target_workspace, target_role
  from public.workspaces w
  join public.roles r on r.workspace_id = w.id and r.key = 'viewer' and r.is_system
  where w.slug = configured_slug and w.status = 'active';
  if target_role is null then
    raise exception 'CMS provisioning requires an active workspace and its viewer role';
  end if;

  -- Never trust user metadata for authorization, claim existing profiles by
  -- email, or automatically promote the first identity to owner.
  insert into public.admin_users (
    auth_user_id, username, email, display_name, role, is_active,
    surface_access, module_access, module_write_access, created_by
  ) values (
    new.id, 'user_' || replace(new.id::text, '-', ''), lower(new.email),
    split_part(new.email, '@', 1), 'viewer', true,
    array['cms', 'content'], array['*'], array[]::text[], 'supabase:auth-trigger'
  ) returning id into profile_id;

  insert into public.workspace_members (workspace_id, admin_user_id, status)
  values (target_workspace, profile_id, 'active') returning id into member_id;
  insert into public.member_roles (workspace_member_id, role_id)
  values (member_id, target_role);
  return new;
end;
$$;
revoke all on function public.provision_managed_auth_user() from public, anon, authenticated;

-- Standalone PostgreSQL may use an external identity service.
do $$
begin
  if to_regclass('auth.users') is not null then
    execute 'create trigger cms_managed_auth_user_created after insert on auth.users
      for each row execute function public.provision_managed_auth_user()';
  end if;
end;
$$;

update public.cms_runtime_state
set schema_migration = '0065', updated_at = now() where singleton = true;
