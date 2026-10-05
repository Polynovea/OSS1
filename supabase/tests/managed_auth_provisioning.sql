-- Run against a disposable Supabase database after migration 0065.
-- All test identities and setting changes are rolled back.
begin;
do $$
declare
  test_id uuid := gen_random_uuid();
  disabled_id uuid := gen_random_uuid();
  test_email text;
  actual_role text;
  matched integer;
begin
  test_email := test_id::text || '@provisioning.example';
  update public.cms_auth_provisioning set enabled = false where singleton;
  insert into auth.users (id, email) values (disabled_id, disabled_id::text || '@provisioning.example');
  if exists (select 1 from public.admin_users where auth_user_id = disabled_id) then
    raise exception 'Disabled provisioning created a profile';
  end if;

  update public.cms_auth_provisioning set enabled = true, workspace_slug = 'polynovea' where singleton;
  insert into auth.users (id, email, raw_user_meta_data)
  values (test_id, test_email, '{"role":"master","module_access":["*"],"module_write_access":["*"]}');
  select role into actual_role from public.admin_users where auth_user_id = test_id;
  if actual_role is distinct from 'viewer' then
    raise exception 'User metadata changed the default authorization';
  end if;
  select count(*) into matched
  from public.admin_users au
  join public.workspace_members wm on wm.admin_user_id = au.id
  join public.member_roles mr on mr.workspace_member_id = wm.id
  join public.roles r on r.id = mr.role_id
  where au.auth_user_id = test_id and au.is_active and wm.status = 'active'
    and r.key = 'viewer' and cardinality(au.module_write_access) = 0;
  if matched <> 1 then raise exception 'Incomplete viewer provisioning'; end if;

  -- An existing email must never be rebound to a different identity.
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), test_email);
    raise exception 'Duplicate profile email was accepted';
  exception when unique_violation then null;
  end;

  update public.cms_auth_provisioning set workspace_slug = test_id::text where singleton;
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'missing-' || test_email);
    raise exception 'Missing workspace was accepted';
  exception when raise_exception then
    if sqlerrm <> 'CMS provisioning requires an active workspace and its viewer role' then raise; end if;
  end;
  if exists (select 1 from auth.users where email = 'missing-' || test_email) then
    raise exception 'Failed provisioning left a partial Auth identity';
  end if;
end;
$$;
rollback;
