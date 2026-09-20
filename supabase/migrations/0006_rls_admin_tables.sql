-- Enable row-level security for the administrator profile and audit tables.
--
-- Browser roles receive no direct table policies. Administrator profiles,
-- membership, roles, and audit records are managed exclusively by authorized
-- server routes using server-only credentials. Initial owner provisioning is
-- performed by `npm run bootstrap:admin`.

alter table admin_activity_log enable row level security;
alter table admin_users enable row level security;

-- Remove policy names used by pre-release builds if they are present on a
-- database that is being reconciled manually.
drop policy if exists "master_bootstrap_self_upsert_insert" on admin_users;
drop policy if exists "master_bootstrap_self_upsert_update" on admin_users;
