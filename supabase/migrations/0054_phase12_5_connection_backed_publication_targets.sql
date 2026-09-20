-- Phase 12.5 closure: publication destinations may reference a typed Connection directly.
-- This avoids duplicating website credentials/configuration into the legacy encrypted target blob.

alter table publication_targets add column if not exists connection_id uuid;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='publication_targets_connection_workspace_fk') then
    alter table publication_targets add constraint publication_targets_connection_workspace_fk
      foreign key(connection_id,workspace_id) references workspace_connections(id,workspace_id) on delete restrict;
  end if;
end $$;

create index if not exists publication_targets_connection_idx
  on publication_targets(workspace_id,connection_id) where connection_id is not null;

comment on column publication_targets.connection_id is
  'Phase 12.5 typed Connection backing this publication target. When set, delivery resolves safe config and credentials from the Connection/credential-provider control plane rather than duplicating secrets.';
