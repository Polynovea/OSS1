# OSS acceptance record — 2026-09-21

This record captures a clean-install acceptance run against a new disposable managed Supabase project. Project identifiers, credentials, tokens and generated passwords are intentionally excluded.

## Installation and identity

- Applied migrations `0001` through `0064` from an empty project with `npm run db:migrate`.
- Re-ran the complete migration set and confirmed every migration was recognized as already applied with its recorded checksum.
- Created a new confirmed Supabase Auth identity through `npm run bootstrap:admin`.
- Confirmed the identity resolved as an active CMS `master`/owner.
- Confirmed a protected workspace-scoped API returned HTTP 200 for that owner.

## Live capability certification

The application ran against the disposable project while the real database, Auth, HTTP, SDK, CLI and worker certification suites executed.

- Phases 8–11: localization, workflow, releases, discoverability, durable delivery, search, analytics and content health passed.
- Phase 12: service tokens, stable API, SDK, CLI, schema delivery, import/export and OpenAPI passed.
- Phase 12.5: environments, connections, encrypted credentials, verification, SSRF controls, approvals, publishing bootstrap, diagnostics, backup/restore planning and API equivalence passed.
- Phase 12.75: deterministic operational intelligence, simulation, approval controls, ML evidence boundaries, execution proof and safe degraded behavior passed.
- Phase 13: governed agents, MCP authorization provenance, extension permissions, route/network constraints, secret-free handles and workspace isolation passed.
- Every suite reported removal of its disposable users, administrators and workspace fixtures with zero leakage.

## Production-mode proof

- Built all 115 application routes with the supported runtime configuration.
- Started the optimized Next.js production server successfully.
- Signed in through Supabase Auth after the application restart.
- Resolved the owner profile and a protected workspace-scoped API through the production server.

## Repeatable command

With a disposable Supabase project configured in `.env.local` and the application running at `http://localhost:3000`:

```bash
npm run certify:live
```

This acceptance record establishes technical release-candidate evidence. It does not replace operator-specific security hardening, backup rehearsal, storage-provider testing, public deployment monitoring or independent adopter feedback.
