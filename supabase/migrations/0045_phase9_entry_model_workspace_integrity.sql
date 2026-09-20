-- Phase 9 closure hardening: content entries must never bind to a model
-- owned by another workspace. The original FK covered model id only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM content_entries e
    JOIN content_models m ON m.id = e.content_model_id
    WHERE e.workspace_id <> m.workspace_id
  ) THEN
    RAISE EXCEPTION 'Cannot enforce entry/model workspace integrity: cross-workspace bindings exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS content_models_workspace_id_id_uq
  ON content_models(workspace_id, id);

ALTER TABLE content_entries
  DROP CONSTRAINT IF EXISTS content_entries_workspace_model_fk;

ALTER TABLE content_entries
  ADD CONSTRAINT content_entries_workspace_model_fk
  FOREIGN KEY (workspace_id, content_model_id)
  REFERENCES content_models(workspace_id, id)
  ON UPDATE CASCADE
  ON DELETE RESTRICT;
