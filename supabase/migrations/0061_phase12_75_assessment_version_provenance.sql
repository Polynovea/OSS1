-- Phase 12.75 — pin data-aware assessments to observed source deployment -> canonical target.
-- `current_schema_version` is retained for backward compatibility; new code uses the explicit fields.

alter table operational_change_assessments add column if not exists source_schema_version integer;
alter table operational_change_assessments add column if not exists source_schema_hash text;
alter table operational_change_assessments add column if not exists target_schema_version integer;
alter table operational_change_assessments add column if not exists target_schema_hash text;
alter table operational_change_assessments add column if not exists source_deployment_id uuid references environment_schema_deployments(id) on delete set null;
alter table operational_change_assessments add column if not exists provenance_state text not null default 'unverified' check(provenance_state in ('proven','unverified','ambiguous','missing'));
alter table operational_change_assessments add column if not exists provenance_json jsonb not null default '{}'::jsonb;

update operational_change_assessments
set source_schema_version = coalesce(source_schema_version,current_schema_version),
    target_schema_hash = coalesce(target_schema_hash,proposed_schema_hash)
where source_schema_version is null or target_schema_hash is null;

create index if not exists operational_change_assessments_target_idx
  on operational_change_assessments(workspace_id,environment_id,content_model_id,target_schema_version,created_at desc);
