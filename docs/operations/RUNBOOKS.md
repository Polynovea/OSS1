# Operations runbooks

These runbooks apply to the supported Supabase/PostgREST-compatible runtime. Record the workspace, environment, actor, correlation ID and safe evidence for every production action. Never paste credentials, tokens, decrypted connection configuration or content payloads into tickets.

## Worker stopped or queue growing

1. Confirm the persistent `npm run worker:delivery` process is healthy and has `DATABASE_URL` plus `CMS_CONFIG_ENCRYPTION_KEY`.
2. Use Delivery Operations to inspect queued/retrying jobs, attempt history and destination health. Do not run delivery inside a request handler.
3. Restore worker connectivity or credentials, then let eligible retrying jobs run. Replay a dead-letter job only after identifying the cause and confirming idempotency.
4. Verify a new attempt and destination-health event are recorded. Escalate if leases are stale or a queue cannot be claimed.

## Failed delivery or dead letter

1. Inspect the job’s correlation ID, response-safe metadata, last error and previous attempts.
2. Check whether the destination is disabled, its URL/credentials changed, or its signing-secret rotation is incomplete.
3. Fix the destination through governed connection/publication-target controls. Do not edit encrypted values or job rows directly.
4. Replay from Delivery Operations; verify the new job retains replay lineage and the old job remains immutable evidence.

## Failed migration or schema drift

1. Stop before applying later migrations. Capture the failing numbered migration, database error and migration ledger state.
2. Take or verify a backup. Do not edit a previously applied migration or manually mark it applied.
3. Use the schema/environment planning and migration-history interfaces to inspect prerequisites, locks and destructive classification.
4. Apply a corrective additive migration only after review, then verify the postcondition and audit evidence. Restore-over-existing requires explicit high-risk approval.

## Backup and restore

1. For the packaged local runtime, use `node scripts/local-runtime.mjs backup --directory=<runtime-dir>`.
2. Store backups encrypted outside the application host and test restore into an isolated environment.
3. Restore only through the guarded local-runtime command or approved environment workflow. Verify login, workspace access, migration level, worker health and a representative published item afterward.

## Credential rotation or degraded connection

1. Use the connection/secret rotation flow; do not put secrets in browser variables or source files.
2. Verify the connection using its disposable probe. A probe must clean up its test object/data.
3. For a delivery signing secret, rotate it, distribute the replacement to the destination, then verify a signed test delivery before retiring the old secret.
4. If a connection is degraded, disable unsafe automated work, capture the safe error evidence and restore only after verification succeeds.

## Upgrade recovery

1. Read the application/worker/extension compatibility state and migration plan before upgrading.
2. Back up first, apply migrations in order, and upgrade compatible application and worker versions together.
3. Verify the migration ledger, worker queues, authenticated workspace access, media storage and one governed delivery.
4. If verification fails, stop dependent upgrades and use the documented rollback/compensation path. A successful process exit alone is not upgrade proof.
