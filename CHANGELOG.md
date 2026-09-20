# Changelog

## Unreleased

- Removed the identity-specific master-account runtime bypass; every administrator now requires an auditable profile, workspace membership and role assignment.
- Added a server-only `bootstrap:admin` command and migration `0064` to retire the legacy client bootstrap policies safely.
- Admin create/update flows now keep default-workspace membership and system roles synchronized.
- Added a checksum-ledger-aware `db:migrate` command for fresh installs and controlled upgrades.
- Made Docker/Compose explicitly optional; the documented OSS V1 path is Node.js plus a supported Supabase/PostgREST-compatible backend.
- Governed agent identity, provenance and constrained extension foundations.
- Governed MCP transport package.
- Supabase browser configuration now fails explicitly when absent; it no longer contains a Polynovea project fallback.
- Delivery Operations UI now lists every worker job kind, and publication delivery resolves its configured signing secret correctly.
- Expanded README, self-hosting, contribution and security documentation; direct generic PostgreSQL runtime support is explicitly deferred.
- CI/release gates now include the production build, SDK build, CLI smoke test and `git diff --check` in addition to type-check, lint, tests, audit and secret scanning.

## Release status

Release engineering and repository certification evidence exist, but no version tag, package publication, deployment or public OSS release has been performed.
