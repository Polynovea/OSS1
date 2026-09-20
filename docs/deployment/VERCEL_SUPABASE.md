# Vercel + Supabase deployment

Vercel + Supabase + Cloudflare R2 is a supported reference profile. It is not the only deployable compute platform, but Supabase Auth/PostgREST is currently required by the application runtime.

## Configure

1. Create a Supabase project, enable the required PostgreSQL extension (`pg_trgm`), and apply every ordered migration in `supabase/migrations/` using a transaction-aware database connection.
2. Configure Vercel with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` for browser use, and `SUPABASE_SERVICE_ROLE_KEY` only for server execution.
3. Add `DATABASE_URL` and a base64 32-byte `CMS_CONFIG_ENCRYPTION_KEY` to the persistent delivery-worker environment. Vercel request handlers must not be the only queue consumer.
4. Configure R2 variables only if enabling the R2 media adapter. Configure GA4 and destination credentials only when those integrations are enabled.
5. Deploy, then verify an authenticated workspace, RLS/actor isolation, a media upload, a preview, a workflow/release and a durable delivery job.

Use a separate persistent worker/container/VM process for `npm run worker:delivery`; it processes publication, scheduled-release, webhook, search, image, health and analytics jobs. Configure health monitoring for that process and its direct PostgreSQL connectivity.

## Security and rollback

Never expose database URLs, service-role keys, signing keys, encryption keys, R2 credentials or GA4 private keys in public environment variables. Store them in the platform secret store, rotate them through the governed connection/credential process, and retain access/audit evidence. Back up PostgreSQL before migrations; roll application and worker versions together where compatibility requires it, then verify migration state and durable-job health after rollback.

See [self-hosting and portability](../self-hosting/POSTGRESQL.md) for the exact support boundary. This guide does not certify a deployment merely because a build succeeds.
