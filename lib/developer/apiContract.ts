import { randomUUID } from "node:crypto";

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  rateLimit?: { limit: number; remaining: number; resetAt: string };
  pagination?: { limit: number; offset: number; returned: number };
}

export function apiSuccess(data: unknown, options: { status?: number; requestId?: string; rateLimit?: ApiMeta["rateLimit"]; pagination?: ApiMeta["pagination"] } = {}) {
  const requestId = options.requestId ?? randomUUID();
  const meta: ApiMeta = { requestId, timestamp: new Date().toISOString(), ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}), ...(options.pagination ? { pagination: options.pagination } : {}) };
  const headers = new Headers({ "content-type": "application/json", "x-request-id": requestId });
  if (options.rateLimit) {
    headers.set("x-ratelimit-limit", String(options.rateLimit.limit));
    headers.set("x-ratelimit-remaining", String(options.rateLimit.remaining));
    headers.set("x-ratelimit-reset", options.rateLimit.resetAt);
  }
  return Response.json({ data, meta }, { status: options.status ?? 200, headers });
}

export function apiError(code: string, message: string, status: number, options: { requestId?: string; details?: unknown; rateLimit?: ApiMeta["rateLimit"] } = {}) {
  const requestId = options.requestId ?? randomUUID();
  const headers = new Headers({ "content-type": "application/json", "x-request-id": requestId });
  if (options.rateLimit) {
    headers.set("x-ratelimit-limit", String(options.rateLimit.limit));
    headers.set("x-ratelimit-remaining", String(options.rateLimit.remaining));
    headers.set("x-ratelimit-reset", options.rateLimit.resetAt);
  }
  return Response.json({ error: { code, message, ...(options.details === undefined ? {} : { details: options.details }) }, meta: { requestId, timestamp: new Date().toISOString(), ...(options.rateLimit ? { rateLimit: options.rateLimit } : {}) } }, { status, headers });
}
