# Managed Supabase deployment

This is the supported production-oriented path for running Polynovea CMS with a managed Supabase project and a Node.js application host.

## 1. Provision the backend

Create a Supabase project backed by PostgreSQL 15 or newer. In the SQL editor, enable the `pg_trgm` extension if it is not already available. Record the project URL, anonymous key, service-role key, and direct database connection string.

For migration work, use the direct session-mode database connection rather than a transaction pooler. Restrict the service-role key and database credentials to server-side environments.

## 2. Configure Polynovea

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

Generate `CMS_CONFIG_ENCRYPTION_KEY` as a cryptographically random 32-byte value. Do not prefix server-only secrets with `NEXT_PUBLIC_`.

## 3. Apply and verify the database

```bash
npm run db:migrate
npm test -- lib/infrastructure/databaseProvisioning.test.ts
```

Migrations are ordered and tracked. Back up an existing database before upgrades and never rewrite a migration already applied to a shared environment.

## 4. Bootstrap the owner

Supply the initial password through the environment so it is not retained in shell history:

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

The command creates a missing confirmed GoTrue identity, or reuses an existing identity without changing its password. It then creates or repairs the CMS master profile, default-workspace membership, and owner role.

## 5. Build and operate

Run the release gates before deployment:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Deploy the Next.js output to a Node.js 22+ host with the same environment values. Run `npm run worker:delivery` as a separate long-lived process using the same server-side configuration. Terminate TLS at the platform or reverse proxy, configure backups and log retention, and rotate bootstrap credentials after first sign-in.

For upgrades, back up the database, deploy the new application build, apply the repository's pending migrations, and verify the health and login paths before directing production traffic to the new release.
