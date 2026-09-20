# Security Policy

## Supported versions

Security fixes are developed against the current maintained release line. Before a public release exists, `main` is the only supported development line. After releases begin, the repository release notes will state any additional supported branches.

## Reporting a vulnerability

**Do not disclose suspected vulnerabilities, credentials, private tenant data, or exploit details in a public issue.**

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository where available. Include only what maintainers need to reproduce and assess the problem:

- affected commit or release;
- affected component or endpoint;
- impact and realistic attack preconditions;
- minimal reproduction steps;
- whether credentials or customer data may have been exposed;
- a safe way to contact you for follow-up.

If private vulnerability reporting is temporarily unavailable, contact the repository owner privately before publishing technical details.

Maintainers should acknowledge a credible report, reproduce it in an isolated environment, classify severity, prepare a fix and coordinated disclosure, and avoid exposing reporter information unnecessarily.

## Secret handling

Self-hosters and contributors must protect:

- `.env.local` and other local environment files;
- `SUPABASE_SERVICE_ROLE_KEY`;
- direct PostgreSQL connection URLs;
- `CMS_CONFIG_ENCRYPTION_KEY`;
- webhook/delivery signing keys;
- storage credentials;
- analytics/service-account private keys;
- API, MCP and extension tokens.

Secrets must not appear in client bundles, public environment variables, extension manifests, committed MCP configuration, logs, screenshots, fixtures, audit payloads, provenance/evidence snapshots, issues or pull requests.

Use `.env.example` only as a variable-name/template reference. Never commit populated production values.

## Security architecture

The OSS V1 security model relies on layered controls:

1. Supabase/GoTrue-compatible authentication establishes identity.
2. `admin_users` provides the auditable CMS profile.
3. Workspace membership and roles resolve the CMS actor.
4. Server-side permission checks authorize every protected operation.
5. PostgreSQL RLS is defence in depth, not a substitute for server authorization.
6. Service-role credentials remain server-only.
7. Developer/API/agent tokens are scoped, revocable and workspace-bound.
8. High-risk schema, publication, agent and infrastructure operations retain deterministic policy, approval and audit boundaries.

The initial owner is provisioned server-side with `npm run bootstrap:admin`; browser identities cannot self-promote into `admin_users` or the `master` role.

## Deployment checklist

Before exposing a deployment publicly, verify at minimum:

- all ordered migrations are applied and the migration ledger has no checksum mismatch;
- RLS and negative cross-workspace tests pass;
- service-role/database/encryption credentials are server-only;
- admin bootstrap is complete and no unprovisioned auth user can access CMS APIs;
- API/SDK/CLI tokens are least-privilege, revocable and expiring where applicable;
- preview tokens expire and cannot cross workspaces;
- webhook signatures and replay/idempotency protections are enabled;
- upload size/type/storage policy is enforced;
- durable workers are authenticated to the intended database and preserve workspace context;
- extension network access remains brokered and constrained;
- logs/audit/evidence are redacted;
- backups and an isolated restore rehearsal exist;
- `npm audit --omit=dev`, CI and secret scanning are clean.

## Dependency and supply-chain policy

`npm ci` with the committed lockfile is the supported installation path. Dependency updates must pass type-check, lint, tests, production build, SDK build, CLI smoke test and production dependency audit. Release automation performs the same core gates and secret scanning runs on full Git history.

## Scope note

A supported build is not automatically a secure deployment. Operators remain responsible for secure host configuration, TLS, database/network access, secret storage, provider IAM, backups, monitoring, and timely upgrades.
