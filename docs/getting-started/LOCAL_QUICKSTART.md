# Local quickstart

This path evaluates and develops Polynovea CMS without cloud accounts.

## Requirements

- Node.js 22 or newer
- Docker Desktop, or Docker Engine with the Compose plugin
- ports `3210` and `54321` available

## Start the complete environment

```bash
git clone https://github.com/Polynovea/OSS1.git
cd OSS1
npm ci
npm run local:setup -- --email=owner@example.com --password=change-me-now
```

The setup command generates local secrets, builds and starts PostgreSQL, PostgREST, GoTrue, the CMS and worker, creates the supplied identity and owner membership, and seeds a demonstration model and entry. Open `http://localhost:3210` when it completes.

Generated secrets and database files live under `.polynovea-local/` and are excluded from Git. Use a strong unique password outside disposable evaluation.

## Lifecycle commands

Set the safety switch before direct lifecycle operations:

```bash
export POLYNOVEA_LOCAL_RUNTIME_CONTROL=1
```

PowerShell:

```powershell
$env:POLYNOVEA_LOCAL_RUNTIME_CONTROL="1"
```

Then use:

```bash
npm run local:runtime -- status --directory=.polynovea-local
npm run local:runtime -- backup --directory=.polynovea-local
npm run local:runtime -- upgrade --directory=.polynovea-local
npm run local:runtime -- stop --directory=.polynovea-local
```

Backups are written below `.polynovea-local/backups`. Restore accepts only files from that directory.

## Options

- `--no-demo` creates an empty workspace.
- `--directory=/absolute/path` changes the runtime-data location.
- Set `POLYNOVEA_LOCAL_APP_PORT` and `POLYNOVEA_LOCAL_SUPABASE_PORT` before first setup to change ports.

The setup is repeatable: rerunning it reuses the generated runtime configuration and repairs the owner binding without duplicating demo content.

## Troubleshooting

- Confirm Docker is running with `docker version` and `docker compose version`.
- Inspect services with `docker compose --env-file .polynovea-local/runtime.env -f deploy/local/docker-compose.yml ps`.
- Add `logs cms`, `logs auth`, or `logs db` to that Compose command to inspect a service.
- To start over, stop the stack and remove `.polynovea-local` only after confirming that it contains no content or backups you need.
