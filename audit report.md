# Codebase Audit Report

Audit date: 2 October 2026  

## 1. Audit Scope

The audit covered:

- Application source, APIs, services, authentication, authorization, and workspace isolation.
- Media upload, storage, deletion, and presigned upload behavior.
- Database migrations, row-level security, privileged functions, and migration controls.
- Developer API, tokens, previews, rate limiting, MCP, extensions, integrations, webhooks, and outbound requests.
- Frontend accessibility and automated test coverage.
- Dependencies, configuration, CI, releases, deployment, workers, backups, restoration, and operational documentation.
- All 42 Markdown files and their consistency with inspected code and configuration.
- Local installation, static checks, tests, builds, SDK/CLI checks, dependency audits, and HTTP smoke tests.

The audit used source and configuration inspection, documentation comparison, targeted searches, Git inspection, registry advisory checks, and local execution. Findings are marked **Confirmed**, **Potential**, or **Unverified** according to the available evidence.

## 2. Work Completed

### Review

- Markdown encoding, fence balance, and relative links passed validation.
- Documentation claims were compared with source, scripts, manifests, workflows, and configuration.
- Security-sensitive paths were checked for authorization, credential handling, uploads, deletion, error disclosure, outbound requests, and privileged database behavior.
- No hardcoded credential value or evidence of active compromise was found.

### Local verification

| Check | Result |
| --- | --- |
| Root dependency installation | Passed; 563 packages installed from the lockfile. |
| Example dependency installation | Passed; 28 packages installed. |
| TypeScript | Passed. |
| ESLint | Passed with zero warnings. |
| Unit tests | Passed: 37 files passed, 1 skipped; 627 tests passed, 2 skipped. |
| Main production build | Passed; 115 static pages generated. |
| SDK build | Passed. |
| Example typecheck/build | Passed; 4 static pages generated. |
| CLI and seed help | Passed. |
| `git diff --check` | Passed. |
| Root production dependency audit | Failed: 2 high-severity vulnerable packages. |
| Example dependency audit | Passed: 0 vulnerabilities. |
| Local production server | Started successfully. |
| HTTP smoke checks | Root redirected, `/admin` returned 200, and protected endpoints returned 401 without credentials. |
| Browser automation | Environment-blocked: helper failed twice with Windows error 3. |

The first sandboxed test attempt hit `spawn EPERM`; the permitted rerun passed. Node is `22.12.0`; one lint dependency declares `22.13.0` or newer for Node 22. Lint still passed.

## 3. Findings

### High severity

#### SEC-002 — Arbitrary storage-key deletion

**Confirmed.** `DELETE /api/upload` accepts a client-provided key and sends it to the storage provider without proving that it belongs to the caller's workspace or a workspace-owned asset. An actor with `media.upload` and knowledge of another object's key could delete it.

Evidence: `app/api/upload/route.ts:33-42`; `lib/media/storageProvider.ts:141-143`, `:181-184`.

#### DEP-001 — Vulnerable production dependencies

**Confirmed by the registry audit on 2 October 2026.**

- `@grpc/grpc-js@1.14.4`, through `google-gax`.
- `undici@7.29.0`, through `cheerio`.

Both were reported as high severity with fixes available. Exploitability depends on whether affected code and configurations are exercised.

### Medium severity

| ID | Finding | Status |
| --- | --- | --- |
| SEC-003 | Administrator sessions resolve profiles by mutable email although `auth_user_id` is stored. | Potential exploit; design confirmed |
| SEC-004 | Presigned uploads lack content-length and quota enforcement. | Confirmed |
| SEC-005 | Many APIs return raw service, database, or provider errors. | Confirmed |
| SEC-006 | DNS validation and connection resolution are separate, leaving a rebinding window. | Potential |
| BE-001 | Schema-run history ignores query errors and returns an empty success. | Confirmed |
| A11Y-001 | Shared modal and login controls lack required semantics and focus behavior. | Confirmed |
| TEST-002 | No component/browser E2E suite covers critical authenticated workflows. | Confirmed gap |
| DEVOPS-001 | Some supply-chain inputs are not pinned or integrity-verified. | Potential |

### Low severity

| ID | Finding | Status |
| --- | --- | --- |
| OPS-003 | Cache revalidation silently ignores failures and lacks an explicit timeout. | Confirmed |
| TEST-001 | The media test checks a local array instead of production validation code. | Confirmed |
| DOC-002 | Package documentation omits some runtime/setup prerequisites. | Confirmed |
| DOC-003 | The storage ADR describes an implemented provider interface as deferred. | Confirmed |
| DOC-004 | Historical identity ADR text remains ambiguous after supersession. | Confirmed |
| DOC-005 | The documented design-token migration remains incomplete. | Confirmed |

No Critical finding was identified.

## 4. Controls Verified

Source and configuration review confirmed:

- Server-side session validation and workspace permission checks.
- Hashed, scoped, expiring, revocable, and rate-limited developer tokens.
- Hashed, expiring, and revocable preview tokens.
- AES-256-GCM protection for sensitive connection values.
- Direct-upload MIME, extension, size, and content-signature checks.
- Workspace-prefixed generated upload keys.
- Row-level security and workspace-scoped database relationships.
- Restricted privileged functions with hardened search paths.
- Migration ordering and checksum validation.
- CI and release gates for installation, static checks, tests, builds, audits, database provisioning, versioning, and secret scanning.

These checks prove that controls exist in the audited revision. They do not prove deployed configuration or behavior.

## 5. Items Not Executed

No `.env.local` or disposable service environment was available. The audit did not execute:

- Live database provisioning, migrations, rollback, or restoration.
- Authenticated browser workflows or administrator bootstrap.
- Worker processing, retries, dead-letter handling, or replay.
- Operations against a configured storage provider.
- Webhook delivery and signature verification.
- Live analytics, MCP, extensions, or external integrations.
- Backup creation and restoration.
- Deployment or production traffic verification.

No production environment or external account was accessed.

## 6. Assessment

The audited revision installs, typechecks, lints, tests, builds, starts, and responds on localhost. The executed checks passed except for the two high-severity dependency advisories.

The revision should not be treated as production-ready until the cross-workspace media deletion defect and vulnerable dependencies are fixed. The medium-severity findings also remain open.

End-to-end readiness remains unverified for databases, authenticated workflows, workers, providers, integrations, backups, restoration, and deployment because no disposable configured environment was available. Dependency advisories are current as of 2 October 2026 and may change.
