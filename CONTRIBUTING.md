# Contributing to Polynovea CMS

Thank you for helping improve Polynovea CMS. Keep contributions focused, reviewable and safe for existing installations.

## Development setup

Prerequisites:

- Node.js 22+
- npm
- a supported Supabase/PostgREST-compatible backend when exercising authenticated/database flows

Install exactly from the lockfile:

```bash
npm ci
```

Copy `.env.example` to `.env.local` only when local runtime credentials are required. Never commit populated secrets or production data.

## Before opening a pull request

Run the same core gates used by CI:

```bash
npx tsc --noEmit
npm run lint
npm test
npm run build
npm run sdk:build
npm run cms -- --help
git diff --check
npm audit --omit=dev
```

Authenticated certification scripts require a configured supported runtime and should use isolated/disposable fixtures. The default `npm test` run does not load `.env.local` and skips the database-provisioning certification when `DATABASE_URL` is absent. To run that certification explicitly, export `DATABASE_URL` for a PostgreSQL role that can create and drop a disposable database, then run `npx vitest run lib/infrastructure/databaseProvisioning.test.ts`.

For a disposable fully configured Supabase project, start the application with `npm run dev` in one terminal and run `npm run certify:live` in another. The suite exercises authenticated database, HTTP, SDK, CLI, worker, operational-intelligence, MCP and extension boundaries and requires zero leaked certification fixtures.

## Change discipline

- Keep unrelated changes out of the pull request.
- Do not reset or rewrite migration history to make a change easier.
- Preserve server-side authorization as the authoritative access boundary.
- Do not move service-role/database/secret material into browser code.
- Keep deterministic safety/approval rules authoritative over ML or agent suggestions.
- Add or update tests for behavioural changes and negative authorization cases.
- Update user/operator documentation when behaviour, setup, runtime support or limitations change.

## Database migrations

Migrations under `supabase/migrations/` are ordered and append-only once shared/applied.

For a new migration:

- use the next numeric migration ID;
- make the change safe to apply once and safe to reason about on upgrade;
- do not edit an already-applied migration to change deployed behaviour;
- preserve/advance `cms_runtime_state.schema_migration` where applicable;
- include indexes/constraints/RLS/audit consequences in review;
- add negative isolation tests when ownership or authorization changes;
- verify fresh-install and upgrade paths when the migration affects existing structures.

New workspace-owned tables must define the ownership boundary explicitly and must not rely on browser filtering for isolation.

## API and authorization changes

Protected routes must resolve authenticated identity server-side and apply the appropriate workspace/module/permission checks. UI hiding is convenience only and never a security control.

If adding a token, agent, extension or machine-to-machine capability, define scopes, revocation, workspace binding, audit/provenance and failure behaviour before exposing the action.

## SDK, CLI and MCP changes

Keep public contracts versionable and backward-compatible where practical. When API shape changes, update the relevant OpenAPI/SDK/CLI/MCP representation and tests together.

## Documentation

Prefer current architecture and public operator documentation over historical implementation handoffs. Historical ADRs may retain context, but amendments must clearly identify superseded behaviour.

## Security reports

Do not file exploitable security issues publicly. Follow [SECURITY.md](SECURITY.md) and use the repository's private vulnerability-reporting flow where available.

## Pull request expectations

A useful pull request explains:

- the problem being solved;
- the chosen approach and important alternatives;
- data/migration impact;
- security/authorization impact;
- tests/certifications performed;
- any rollout, compatibility or follow-up considerations.

By contributing, you agree that your contribution is provided under the repository's MIT License.
