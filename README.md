# Polynovea CMS

Polynovea CMS is an open-source, workspace-scoped content and data operations platform for structured content, visual schema modelling, editorial workflow, releases, delivery operations, discoverability and content health. It includes a browser admin, scoped developer API, TypeScript SDK, CLI, MCP transport and governed extensions.

## Supported OSS V1 runtime

The supported OSS V1 application profile is:

- Node.js 20+
- PostgreSQL 15+
- PostgREST-compatible data API
- GoTrue-compatible Supabase Auth
- persistent delivery worker
- optional S3-compatible media storage

The application service and browser-authentication layers currently use Supabase/PostgREST semantics. A bare PostgreSQL server by itself is therefore **not** a supported application runtime yet. Vercel + Supabase is the reference deployment profile, but any Node host can run the Next.js application when connected to a supported Supabase-compatible backend.

Docker is **optional packaging only**. It is not required to install, develop, certify or deploy OSS V1.

See [PostgreSQL and self-hosting](docs/self-hosting/POSTGRESQL.md) for the exact portability boundary.

## Five-minute local evaluation

The fastest evaluation path uses Docker Desktop or Docker Engine with Compose. It creates an isolated PostgreSQL, PostgREST, GoTrue, CMS and delivery-worker stack; creates the first owner; and seeds a demonstration content model and entry.

```bash
npm ci
npm run local:setup -- --email=owner@example.com --password=change-me-now
```

Open `http://localhost:3210` and sign in with those credentials. Runtime data and generated secrets are stored under `.polynovea-local/`, which is ignored by Git. Use a strong, unique password outside disposable local evaluation.

Useful lifecycle commands:

```bash
$env:POLYNOVEA_LOCAL_RUNTIME_CONTROL="1" # PowerShell
npm run local:runtime -- status --directory=.polynovea-local
npm run local:runtime -- backup --directory=.polynovea-local
npm run local:runtime -- stop --directory=.polynovea-local
```

On macOS/Linux, use `export POLYNOVEA_LOCAL_RUNTIME_CONTROL=1`. Pass `--no-demo` to `local:setup` for an empty workspace. See the [complete local quickstart](docs/getting-started/LOCAL_QUICKSTART.md).

## Managed Supabase quick start

### 1. Prerequisites

Install Node.js 20+ and provision a supported Supabase-compatible backend. For the simplest path, create a Supabase project with PostgreSQL 15+ and enable `pg_trgm`.

### 2. Install dependencies

```bash
npm ci
```

### 3. Configure the environment

Copy `.env.example` to `.env.local` and set at minimum:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
CMS_CONFIG_ENCRYPTION_KEY
```

`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, encryption keys and integration credentials are server-only. Never expose them through `NEXT_PUBLIC_*` variables.

### 4. Apply the ordered schema

Against a fresh supported database:

```bash
npm run db:migrate
```

The migration runner applies the numbered files in `supabase/migrations/` in order and stops on the first failure. Back up an existing installation before applying upgrade migrations; never edit a migration that has already been applied to a shared or production database.

### 5. Create the first administrator

Create and bind the first CMS owner with the server-only bootstrap command. Prefer the environment variable form so the password is not retained in shell history:

```bash
POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-password' npm run bootstrap:admin -- --email=owner@example.com --username=owner --display-name="Site Owner"
```

PowerShell users can set `$env:POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD` before running the command. If that auth identity already exists, the password is not changed and may be omitted. The bootstrap command requires the configured service-role key and creates or repairs the auditable `admin_users` profile, default-workspace membership and `owner` role assignment. There is no hardcoded master-email bypass in the runtime. See the [managed Supabase guide](docs/getting-started/MANAGED_SUPABASE.md) for the complete deployment sequence.

### 6. Start the application

Development:

```bash
npm run dev
```

Production-style local run:

```bash
npm run build
npm start
```

### 7. Run the durable worker

Run the worker as a persistent process when using publishing, scheduled releases, webhooks, indexing, image processing, health checks or analytics sync:

```bash
npm run worker:delivery
```

The worker requires `DATABASE_URL` and any credentials needed by the enabled adapters.

## Local container profile

`deploy/local/` and the local-runtime scripts provide a reproducible Supabase-compatible evaluation and development profile. Managed Supabase remains the reference production path; the container profile is intended for local evaluation, development, backup/restore exercises and contribution testing.

## Architecture and security

Browser requests go through Next.js route handlers. Server routes resolve an authenticated CMS actor, enforce workspace membership and permissions, call the service layer and write audit evidence. The server-only service role may bypass database RLS; browser clients never receive it.

See:

- [Current architecture](docs/upgrade/CURRENT_ARCHITECTURE.md)
- [Security policy](SECURITY.md)
- [Migration discipline](docs/upgrade/MIGRATIONS.md)
- [Self-hosting / portability](docs/self-hosting/POSTGRESQL.md)

Media uses an S3-compatible storage seam; the supplied reference adapter is configured with R2 variables. Configure storage before enabling media uploads.

## Developer interfaces

- `/api/v1` exposes scoped integration endpoints; use a workspace API token with the least scopes required.
- `packages/cms-sdk` contains the TypeScript SDK; build it with `npm run sdk:build`.
- `npm run cms -- --help` describes CLI commands for entries, workflows, releases, media, schema delivery, environments, connections, intelligence and exports.
- `packages/cms-mcp` is a governed MCP client. It follows normal scopes, approvals, workspace isolation and audit rules; it is not a privileged backdoor.
- Extensions declare permissions, routes, event names and allowed network origins. A workspace administrator must approve them before activation. See [extension manifests](docs/extensions/MANIFEST.md).

## Release checks

Run:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
npm run sdk:build
npm run cms -- --help
git diff --check
npm audit --omit=dev
```

Authenticated live certification additionally requires a configured supported runtime.

The database-provisioning certification is intentionally skipped by the default hermetic test run. To exercise it, provide `DATABASE_URL` in the process environment and run:

```bash
npx vitest run lib/infrastructure/databaseProvisioning.test.ts
```

The configured PostgreSQL role must be allowed to create and drop the disposable certification database. The test never loads `.env.local` automatically.

## Current limitations

- non-Supabase authentication is future portability work;
- a direct generic-PostgreSQL application adapter is not certified for V1;
- the R2 adapter is the first-class supplied media adapter; other S3-compatible providers may require configuration/adapter work;
- the local Docker profile is intended for evaluation and development; production operators should use a supported managed or self-hosted Supabase-compatible deployment and an external worker process.

## Headless delivery

Polynovea is a headless CMS and content-operations control plane. It does not impose a public-site theme. Published content is consumed through scoped `/api/v1/content/*` endpoints or the TypeScript SDK. A minimal Next.js consumer is included in [`examples/nextjs-site`](examples/nextjs-site).

## Project documentation

Read [operations runbooks](docs/operations/RUNBOOKS.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [SECURITY.md](SECURITY.md), [SUPPORT.md](SUPPORT.md), and [ROADMAP.md](ROADMAP.md) before operating a public instance.
