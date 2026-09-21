# Development quickstart

Run the Polynovea application and worker directly with Node.js while using a managed Supabase project for PostgreSQL, Auth and the data API.

## Requirements

- Node.js 22 or newer
- a Supabase project with PostgreSQL 15 or newer
- a direct session-mode database connection string

## Install and configure

```bash
git clone https://github.com/Polynovea/OSS1.git
cd OSS1
npm ci
cp .env.example .env.local
```

Set these values in `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL
CMS_CONFIG_ENCRYPTION_KEY
```

Enable `pg_trgm` in the Supabase SQL editor. Generate `CMS_CONFIG_ENCRYPTION_KEY` from 32 cryptographically random bytes, and keep every server-only value out of `NEXT_PUBLIC_*` variables.

## Initialize the database

```bash
npm run db:migrate
```

The migration runner applies numbered migrations in order and records their checksums. Use a fresh project for evaluation. Back up any existing installation before upgrading it.

## Create the first owner

macOS or Linux:

```bash
export POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD='choose-a-strong-password'
npm run bootstrap:admin -- --email=owner@example.com --username=owner --display-name="Site Owner"
unset POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD
```

PowerShell:

```powershell
$env:POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD = "choose-a-strong-password"
npm run bootstrap:admin -- --email=owner@example.com --username=owner --display-name="Site Owner"
Remove-Item Env:POLYNOVEA_BOOTSTRAP_ADMIN_PASSWORD
```

The command creates a confirmed auth identity when one does not exist, then creates or repairs the auditable CMS owner profile and default-workspace membership.

## Create starter content

After starting the application, create an idempotent starter Article model and welcome draft through the authenticated CMS API:

```bash
npm run seed:starter
```

The command uses the bootstrap owner defaults from `.env.local`. You can instead pass `--email`, `--password` and `--url` explicitly. Re-running it reuses the existing starter model and entry.

## Run the application

In one terminal:

```bash
npm run dev
```

Open `http://localhost:3000` and sign in with the owner credentials.

In a second terminal, run the durable worker when evaluating publishing, scheduled releases, webhooks, indexing, image processing, health checks or analytics sync:

```bash
npm run worker:delivery
```

## Verify before deployment

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

For a production-oriented sequence, environment hardening and upgrade guidance, continue with the [managed Supabase deployment guide](MANAGED_SUPABASE.md).
