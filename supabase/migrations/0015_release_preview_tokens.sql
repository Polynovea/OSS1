-- A preview may represent one draft version or a pinned release bundle.
alter table preview_tokens alter column entry_version_id drop not null;
alter table preview_tokens add column if not exists release_id uuid references releases(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'preview_tokens_target_check') then
    alter table preview_tokens add constraint preview_tokens_target_check check (
      (entry_version_id is not null and release_id is null) or
      (entry_version_id is null and release_id is not null)
    );
  end if;
end $$;
create index if not exists preview_tokens_release_idx on preview_tokens(release_id) where release_id is not null;
