#!/usr/bin/env node
/**
 * Phase 10 durable delivery worker.
 *
 * Runs independently of Next/Vercel. It claims PostgreSQL-backed delivery_jobs
 * with SKIP LOCKED leases. The adapters below explicitly handle publication,
 * scheduled releases, webhooks, search, media, health scans and analytics.
 * Unsupported job kinds remain queued rather than being falsely consumed.
 */
import { createDecipheriv, createHash, createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import pg from "pg";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

if (existsSync(".env.local")) {
  for (const raw of readFileSync(".env.local", "utf8").split("\n")) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['\"]|['\"]$/g, "");
  }
}

const DATABASE_URL = process.env.Database_URL || process.env.DATABASE_URL || process.env.database_url;
if (!DATABASE_URL) throw new Error("DATABASE_URL (or Database_URL) is required");

const workerId = process.env.DELIVERY_WORKER_ID || `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const pollMs = Math.max(250, Number(process.env.DELIVERY_WORKER_POLL_MS || 1500));
const batchSize = Math.min(25, Math.max(1, Number(process.env.DELIVERY_WORKER_BATCH_SIZE || 8)));
const leaseSeconds = Math.min(600, Math.max(30, Number(process.env.DELIVERY_WORKER_LEASE_SECONDS || 90)));
const once = process.argv.includes("--once");
const maintenanceEnabled = !process.argv.includes("--no-maintenance") && process.env.DELIVERY_WORKER_MAINTENANCE !== "0";
const SUPPORTED_KINDS = ["publish", "scheduled_release", "webhook", "search_index", "image_processing", "health_scan", "analytics_sync"];
const queueArg = process.argv.find((arg) => arg.startsWith("--queues="));
const SUPPORTED_QUEUES = ((queueArg ? queueArg.slice("--queues=".length) : null) || process.env.DELIVERY_WORKER_QUEUES || "default,intelligence,media").split(",").map((value) => value.trim()).filter(Boolean);
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => { stopping = true; });
}

function encryptionKey() {
  const value = process.env.CMS_CONFIG_ENCRYPTION_KEY;
  if (!value) throw new Error("CMS_CONFIG_ENCRYPTION_KEY is required by the delivery worker");
  const buffer = Buffer.from(value, "base64");
  if (buffer.length !== 32) throw new Error("CMS_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return buffer;
}

function decryptConfig(value) {
  const buffer = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
}

async function resolveWorkerConnectionCredentials(client, workspaceId, connectionId) {
  const { rows } = await client.query(`
    select b.purpose, s.locator, s.encrypted_value, p.provider_kind, p.status as provider_status
    from connection_secret_bindings b
    join workspace_secret_refs s on s.id=b.secret_ref_id and s.workspace_id=b.workspace_id
    join workspace_secret_providers p on p.id=s.provider_id and p.workspace_id=s.workspace_id
    where b.workspace_id=$1 and b.connection_id=$2
  `, [workspaceId, connectionId]);
  const result = {};
  for (const row of rows) {
    if (row.provider_status !== "active") throw new Error("Connection credential provider is unavailable");
    if (row.provider_kind === "environment") {
      const value = process.env[row.locator]; if (!value) throw new Error(`Environment credential ${row.locator} is not configured`); result[row.purpose] = value;
    } else if (row.provider_kind === "encrypted_postgres") {
      if (!row.encrypted_value) throw new Error("Encrypted connection credential is missing"); result[row.purpose] = decryptConfig(row.encrypted_value).value;
    } else throw new Error(`Credential provider ${row.provider_kind} is not supported by this worker runtime`);
  }
  return result;
}

async function resolvePublicationTargetConfig(client, workspaceId, target) {
  if (!target.connection_id) {
    const config = decryptConfig(target.config_json_encrypted);
    return { config, signingSecret: config.signingSecret || process.env.CMS_DELIVERY_SIGNING_SECRET || null, connectionBacked: false };
  }
  const { rows:[connection] } = await client.query(`select id,connector_type,connector_family,config_json,active,status from workspace_connections where id=$1 and workspace_id=$2`, [target.connection_id, workspaceId]);
  if (!connection || !connection.active || connection.status !== 'active') throw new Error('Connection-backed publication destination is unavailable or unverified');
  const credentials = await resolveWorkerConnectionCredentials(client, workspaceId, connection.id);
  const cfg = connection.config_json || {};
  const url = String(cfg.publishUrl || cfg.baseUrl || cfg.endpointUrl || '');
  if (!url) throw new Error('Connection-backed publication destination has no publish URL');
  const headers = {};
  if (credentials.bearer_token) headers.authorization = `Bearer ${credentials.bearer_token}`;
  if (credentials.api_key) headers[String(cfg.apiKeyHeader || 'x-api-key').toLowerCase()] = credentials.api_key;
  return { config:{url,headers}, signingSecret:credentials.signing_secret || process.env.CMS_DELIVERY_SIGNING_SECRET || null, connectionBacked:true };
}

function elapsed(startedAt) {
  return Math.max(0, Date.now() - startedAt);
}

async function recordHealth(client, { workspaceId, kind, destinationId, success, latencyMs, errorCode = null, errorMessage = null, disabled = false }) {
  await client.query(
    "select cms_record_destination_health($1,$2,$3,$4,$5,$6,$7,$8)",
    [workspaceId, kind, destinationId, success, latencyMs, errorCode, errorMessage, disabled]
  );
}

async function completeJob(client, job, responseMetadata, latencyMs) {
  await client.query("select cms_complete_delivery_job($1,$2,$3::jsonb,$4)", [job.id, workerId, JSON.stringify(responseMetadata || {}), latencyMs]);
}

async function failJob(client, job, errorCode, errorMessage, responseMetadata, latencyMs, retryAfterSeconds = null) {
  await client.query(
    "select cms_fail_delivery_job($1,$2,$3,$4,$5::jsonb,$6,$7)",
    [job.id, workerId, errorCode, String(errorMessage || "Delivery failed").slice(0, 2000), JSON.stringify(responseMetadata || {}), latencyMs, retryAfterSeconds]
  );
}

async function dispatchWebsiteTest(client, job) {
  const bindingId = job.payload_json?.websiteBindingId;
  if (!bindingId) throw new Error("website test payload is missing websiteBindingId");
  const { rows } = await client.query(`
    select wcb.*, pt.config_json_encrypted, pt.connection_id, pt.target_type, pt.active as target_active
    from website_connection_bindings wcb
    join publication_targets pt on pt.id = wcb.publication_target_id
    where wcb.id=$1 and wcb.workspace_id=$2
  `, [bindingId, job.workspace_id]);
  const binding = rows[0];
  if (!binding || !binding.target_active) throw new Error("website test binding or publication target is unavailable");
  const startedAt = Date.now();
  try {
    const resolved = await resolvePublicationTargetConfig(client, job.workspace_id, binding);
    const config = resolved.config;
    const payload = JSON.stringify({ event: "publication.test", bindingId, environmentId: binding.environment_id, correlationId: job.correlation_id, sentAt: new Date().toISOString() });
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": job.idempotency_key,
        "x-polynovea-correlation-id": job.correlation_id,
        "x-polynovea-delivery-job": job.id,
        ...(resolved.signingSecret ? { "x-polynovea-signature": `sha256=${createHmac("sha256", resolved.signingSecret).update(payload).digest("hex")}` } : {}),
        ...(config.headers || {}),
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Website test returned HTTP ${response.status}`);
    await client.query(`update website_connection_bindings set status='active',last_error=null,last_test_at=now(),updated_at=now() where id=$1`, [bindingId]);
    return completeJob(client, job, { bindingId, statusCode: response.status, outcome: "website_test_passed", connectionBacked: resolved.connectionBacked }, elapsed(startedAt));
  } catch (error) {
    await client.query(`update website_connection_bindings set status='failed',last_error=$2,last_test_at=now(),updated_at=now() where id=$1`, [bindingId, String(error?.message || error).slice(0, 2000)]);
    throw error;
  }
}
async function dispatchPublish(client, job) {
  if (job.payload_json?.test && job.payload_json?.websiteBindingId) return dispatchWebsiteTest(client, job);
  const publicationJobId = job.payload_json?.publicationJobId;
  if (!publicationJobId) throw new Error("publish job payload is missing publicationJobId");
  const { rows } = await client.query(`
    select pj.*, pt.config_json_encrypted, pt.connection_id, pt.target_type, pt.active as target_active
    from publication_jobs pj
    join publication_targets pt on pt.id = pj.target_id
    where pj.id = $1 and pj.workspace_id = $2
  `, [publicationJobId, job.workspace_id]);
  const legacy = rows[0];
  if (!legacy) throw new Error("publication projection job not found");
  if (!legacy.target_active) throw new Error("publication target is disabled");

  const startedAt = Date.now();
  await client.query(`
    update publication_jobs
    set status='running', attempt_count=$2, started_at=coalesce(started_at,now()), updated_at=now()
    where id=$1
  `, [legacy.id, job.attempt_count]);

  try {
    const resolved = await resolvePublicationTargetConfig(client, job.workspace_id, legacy);
    const config = resolved.config;
    if (!resolved.signingSecret) throw new Error("Publication target signing secret is not configured");
    const payload = JSON.stringify({
      event: "publication.requested",
      publicationJobId: legacy.id,
      entryId: legacy.entry_id,
      versionId: legacy.version_id,
      releaseId: legacy.release_id,
      correlationId: job.correlation_id,
    });
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": legacy.idempotency_key,
        "x-polynovea-correlation-id": job.correlation_id,
        "x-polynovea-delivery-job": job.id,
        "x-polynovea-publication-job": legacy.id,
        "x-polynovea-signature": `sha256=${createHmac("sha256", resolved.signingSecret).update(payload).digest("hex")}`,
        ...(config.headers || {}),
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const latencyMs = elapsed(startedAt);
    const metadata = { statusCode: response.status, contentType: response.headers.get("content-type") || null };
    if (!response.ok) {
      const terminal = job.attempt_count >= job.max_attempts;
      await client.query(`
        insert into publication_delivery_logs(job_id,attempt_number,status_code,outcome,detail)
        values($1,$2,$3,$4,$5)
      `, [legacy.id, job.attempt_count, response.status, terminal ? "failed" : "retrying", `Destination returned ${response.status}`]);
      await client.query(`
        update publication_jobs
        set status=$2, next_attempt_at=case when $2='retrying' then now()+interval '30 seconds' else null end,
            last_error=$3, updated_at=now()
        where id=$1
      `, [legacy.id, terminal ? "failed" : "retrying", `Destination returned ${response.status}`]);
      await recordHealth(client, { workspaceId: job.workspace_id, kind: "publication_target", destinationId: legacy.target_id, success: false, latencyMs, errorCode: `HTTP_${response.status}`, errorMessage: `Destination returned ${response.status}` });
      await failJob(client, job, `HTTP_${response.status}`, `Destination returned ${response.status}`, metadata, latencyMs);
      return;
    }

    await client.query(`
      insert into publication_delivery_logs(job_id,attempt_number,status_code,outcome)
      values($1,$2,$3,'succeeded')
    `, [legacy.id, job.attempt_count, response.status]);
    await client.query(`
      update publication_jobs
      set status='succeeded', completed_at=now(), next_attempt_at=null, last_error=null, updated_at=now()
      where id=$1
    `, [legacy.id]);
    await recordHealth(client, { workspaceId: job.workspace_id, kind: "publication_target", destinationId: legacy.target_id, success: true, latencyMs });
    await completeJob(client, job, metadata, latencyMs);
  } catch (error) {
    const latencyMs = elapsed(startedAt);
    const message = error instanceof Error ? error.message : "Publication delivery failed";
    const terminal = job.attempt_count >= job.max_attempts;
    await client.query(`
      insert into publication_delivery_logs(job_id,attempt_number,outcome,detail)
      values($1,$2,$3,$4)
    `, [legacy.id, job.attempt_count, terminal ? "failed" : "retrying", message]);
    await client.query(`
      update publication_jobs set status=$2,last_error=$3,updated_at=now() where id=$1
    `, [legacy.id, terminal ? "failed" : "retrying", message]);
    await recordHealth(client, { workspaceId: job.workspace_id, kind: "publication_target", destinationId: legacy.target_id, success: false, latencyMs, errorCode: "NETWORK_ERROR", errorMessage: message });
    await failJob(client, job, "NETWORK_ERROR", message, {}, latencyMs);
  }
}

async function dispatchWebhook(client, job) {
  const deliveryId = job.payload_json?.webhookDeliveryId;
  if (!deliveryId) throw new Error("webhook job payload is missing webhookDeliveryId");
  const { rows } = await client.query(`
    select wd.*, ws.workspace_id, ws.endpoint_url, ws.signing_secret_encrypted, ws.active as subscription_active
    from webhook_deliveries wd
    join webhook_subscriptions ws on ws.id = wd.subscription_id
    where wd.id = $1 and ws.workspace_id = $2
  `, [deliveryId, job.workspace_id]);
  const delivery = rows[0];
  if (!delivery) throw new Error("webhook delivery projection not found");
  if (!delivery.subscription_active) throw new Error("webhook subscription is disabled");

  const startedAt = Date.now();
  const payload = JSON.stringify({
    id: delivery.event_id,
    type: delivery.event_type,
    occurredAt: new Date().toISOString(),
    data: delivery.payload_json,
  });
  await client.query("update webhook_deliveries set status='running',attempt_count=$2 where id=$1", [delivery.id, job.attempt_count]);

  try {
    const { secret } = decryptConfig(delivery.signing_secret_encrypted);
    const response = await fetch(delivery.endpoint_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-polynovea-event": delivery.event_type,
        "x-polynovea-delivery": delivery.id,
        "x-polynovea-correlation-id": job.correlation_id,
        "x-polynovea-signature": `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    const latencyMs = elapsed(startedAt);
    const metadata = { statusCode: response.status, contentType: response.headers.get("content-type") || null };
    if (!response.ok) {
      const terminal = job.attempt_count >= job.max_attempts;
      await client.query(`
        update webhook_deliveries
        set status=$2,response_status=$3,last_error=$4,next_attempt_at=case when $2='queued' then now()+interval '30 seconds' else null end
        where id=$1
      `, [delivery.id, terminal ? "failed" : "queued", response.status, `Endpoint returned ${response.status}`]);
      await client.query(`update webhook_subscriptions set consecutive_failures=$2,active=$3,updated_at=now() where id=$1`, [delivery.subscription_id, job.attempt_count, !terminal]);
      await recordHealth(client, { workspaceId: job.workspace_id, kind: "webhook_subscription", destinationId: delivery.subscription_id, success: false, latencyMs, errorCode: `HTTP_${response.status}`, errorMessage: `Endpoint returned ${response.status}`, disabled: terminal });
      await failJob(client, job, `HTTP_${response.status}`, `Endpoint returned ${response.status}`, metadata, latencyMs);
      return;
    }

    await client.query(`
      update webhook_deliveries
      set status='succeeded',response_status=$2,completed_at=now(),next_attempt_at=null,last_error=null
      where id=$1
    `, [delivery.id, response.status]);
    await client.query("update webhook_subscriptions set consecutive_failures=0,updated_at=now() where id=$1", [delivery.subscription_id]);
    await recordHealth(client, { workspaceId: job.workspace_id, kind: "webhook_subscription", destinationId: delivery.subscription_id, success: true, latencyMs });
    await completeJob(client, job, metadata, latencyMs);
  } catch (error) {
    const latencyMs = elapsed(startedAt);
    const message = error instanceof Error ? error.message : "Webhook delivery failed";
    const terminal = job.attempt_count >= job.max_attempts;
    await client.query(`update webhook_deliveries set status=$2,last_error=$3 where id=$1`, [delivery.id, terminal ? "failed" : "queued", message]);
    await client.query(`update webhook_subscriptions set consecutive_failures=$2,active=$3,updated_at=now() where id=$1`, [delivery.subscription_id, job.attempt_count, !terminal]);
    await recordHealth(client, { workspaceId: job.workspace_id, kind: "webhook_subscription", destinationId: delivery.subscription_id, success: false, latencyMs, errorCode: "NETWORK_ERROR", errorMessage: message, disabled: terminal });
    await failJob(client, job, "NETWORK_ERROR", message, {}, latencyMs);
  }
}

function flattenSearchText(value, out = []) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) flattenSearchText(item, out);
  else if (value && typeof value === "object") for (const item of Object.values(value)) flattenSearchText(item, out);
  return out;
}

async function dispatchScheduledRelease(client, job) {
  const releaseId = job.payload_json?.releaseId;
  if (!releaseId) throw new Error("scheduled_release payload is missing releaseId");
  const { rows } = await client.query("select id,status,scheduled_for,created_by,approved_by,updated_by from releases where id=$1 and workspace_id=$2", [releaseId, job.workspace_id]);
  const release = rows[0];
  if (!release) return completeJob(client, job, { skipped: true, reason: "release_missing" }, 0);
  if (release.status !== "scheduled") return completeJob(client, job, { skipped: true, reason: `release_${release.status}` }, 0);
  if (release.scheduled_for && new Date(release.scheduled_for).getTime() > Date.now()) {
    const seconds = Math.max(15, Math.ceil((new Date(release.scheduled_for).getTime() - Date.now()) / 1000));
    return failJob(client, job, "NOT_DUE", "Scheduled release is not due yet", { scheduledFor: release.scheduled_for }, 0, seconds);
  }
  const actorId = job.payload_json?.actorId || release.updated_by || release.approved_by || release.created_by || null;
  const startedAt = Date.now();
  const { rows: resultRows } = await client.query("select cms_publish_release($1,$2,$3) as result", [job.workspace_id, actorId, releaseId]);
  await completeJob(client, job, { releaseId, result: resultRows[0]?.result ?? null }, elapsed(startedAt));
}

async function dispatchSearchIndex(client, job) {
  const entryId = job.payload_json?.entryId;
  if (!entryId) throw new Error("search_index payload is missing entryId");
  const startedAt = Date.now();
  const { rows } = await client.query(`
    select e.id,e.workspace_id,e.content_model_id,e.status,e.created_by,e.current_draft_version_id,e.published_version_id,
           v.id as version_id,v.locale,v.data_jsonb
    from content_entries e
    left join lateral (
      select * from content_entry_versions v
      where v.entry_id=e.id and v.id=coalesce($3::uuid,e.published_version_id,e.current_draft_version_id)
      limit 1
    ) v on true
    where e.id=$1 and e.workspace_id=$2
  `, [entryId, job.workspace_id, job.payload_json?.versionId || null]);
  const row = rows[0];
  if (!row || !row.version_id) return completeJob(client, job, { skipped: true, reason: "entry_or_version_missing", entryId }, elapsed(startedAt));
  const searchText = flattenSearchText(row.data_jsonb || {}).join(" ").replace(/\s+/g, " ").trim();
  await client.query(`
    insert into content_search_documents(entry_id,workspace_id,version_id,content_model_id,locale,status,author_id,search_text,updated_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,now())
    on conflict(entry_id) do update set version_id=excluded.version_id,content_model_id=excluded.content_model_id,
      locale=excluded.locale,status=excluded.status,author_id=excluded.author_id,search_text=excluded.search_text,updated_at=now()
  `, [row.id,row.workspace_id,row.version_id,row.content_model_id,row.locale,row.status,row.created_by,searchText]);
  await completeJob(client, job, { entryId, versionId: row.version_id, characters: searchText.length }, elapsed(startedAt));
}

function extractImageDimensions(buffer, mimeType) {
  try {
    if (mimeType === "image/png" && buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString("ascii",1,4) === "PNG") return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    if (mimeType === "image/gif" && buffer.length >= 10 && buffer.toString("ascii",0,3) === "GIF") return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && buffer[0] === 0xff && buffer[1] === 0xd8) {
      let offset=2; while(offset < buffer.length-8){ if(buffer[offset]!==0xff){offset++;continue;} const marker=buffer[offset+1]; if([0xc0,0xc1,0xc2].includes(marker)) return {height:buffer.readUInt16BE(offset+5),width:buffer.readUInt16BE(offset+7)}; const len=buffer.readUInt16BE(offset+2); if(!len)break; offset += 2+len; }
    }
    if (mimeType === "image/webp" && buffer.length >= 30 && buffer.toString("ascii",0,4)==="RIFF" && buffer.toString("ascii",8,12)==="WEBP") {
      const format=buffer.toString("ascii",12,16); if(format==="VP8 ") return {width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff};
      if(format==="VP8L" && buffer.length>=25){const b0=buffer[21],b1=buffer[22],b2=buffer[23],b3=buffer[24];return {width:1+(((b1&0x3f)<<8)|b0),height:1+(((b3&0x0f)<<10)|(b2<<2)|((b1&0xc0)>>6))};}
    }
  } catch {}
  return { width: null, height: null };
}

async function streamToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  const chunks=[]; for await (const chunk of body) chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk)); return Buffer.concat(chunks);
}

function r2Client() {
  const accountId=process.env.R2_ACCOUNT_ID;
  const endpoint=process.env.R2_S3_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null);
  const accessKeyId=process.env.R2_ACCESS_KEY_ID, secretAccessKey=process.env.R2_SECRET_ACCESS_KEY;
  if(!endpoint||!accessKeyId||!secretAccessKey) throw new Error("R2 worker credentials are not configured");
  return new S3Client({region:"auto",endpoint,credentials:{accessKeyId,secretAccessKey}});
}

async function dispatchImageProcessing(client, job) {
  const assetId=job.payload_json?.assetId; if(!assetId) throw new Error("image_processing payload is missing assetId");
  const startedAt=Date.now(); const {rows}=await client.query("select * from assets where id=$1 and workspace_id=$2",[assetId,job.workspace_id]); const asset=rows[0];
  if(!asset||asset.archived_at) return completeJob(client,job,{skipped:true,reason:"asset_missing_or_archived",assetId},elapsed(startedAt));
  if(!String(asset.mime_type).startsWith("image/")) return completeJob(client,job,{skipped:true,reason:"not_image",assetId},elapsed(startedAt));
  let width=asset.width??null,height=asset.height??null;
  if((!width||!height) && asset.storage_provider==="r2") {
    const response=await r2Client().send(new GetObjectCommand({Bucket:process.env.R2_BUCKET_NAME||"media",Key:asset.storage_key}));
    const buffer=await streamToBuffer(response.Body); ({width,height}=extractImageDimensions(buffer,asset.mime_type));
  }
  const processing={status:"ready",processedAt:new Date().toISOString(),workerId,width:width??null,height:height??null,dimensionsDetected:Boolean(width&&height)};
  await client.query("update assets set width=coalesce($2,width),height=coalesce($3,height),metadata_json=coalesce(metadata_json,'{}'::jsonb)||jsonb_build_object('processing',$4::jsonb) where id=$1",[assetId,width,height,JSON.stringify(processing)]);
  await completeJob(client,job,{assetId,width:width??null,height:height??null,mimeType:asset.mime_type},elapsed(startedAt));
}

const workerFindingCodes=["missing_owner","review_never_completed","review_overdue","expired","localization_stale","unused_asset","dependency_risk","performance_decline"];
const findingFingerprint=(entityType,entityId,code)=>createHash("sha256").update(`${entityType}:${entityId}:${code}`,"utf8").digest("hex");
async function upsertWorkerFinding(client,workspaceId,entityType,entityId,code,severity,title,detail=null,evidence={}){
  const fp=findingFingerprint(entityType,entityId,code);
  await client.query("select cms_upsert_health_finding($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",[workspaceId,entityType,entityId,code,severity,fp,title,detail,JSON.stringify(evidence)]);
  return fp;
}

async function dispatchHealthScan(client,job){
  const startedAt=Date.now(), detected=new Set();
  const {rows:entries}=await client.query(`select e.id,e.status,p.owner_id,p.last_reviewed_at,p.review_cadence_days,p.expires_at from content_entries e left join content_health_profiles p on p.entry_id=e.id where e.workspace_id=$1 and e.status<>'archived'`,[job.workspace_id]);
  const now=Date.now();
  for(const e of entries){
    if(!e.owner_id)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"missing_owner","warning","Content has no owner","Assign an accountable owner."));
    if(e.review_cadence_days){if(!e.last_reviewed_at)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"review_never_completed","warning","Review cadence exists but no review is recorded",null,{cadenceDays:e.review_cadence_days}));else if(new Date(e.last_reviewed_at).getTime()+Number(e.review_cadence_days)*86400000<now)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"review_overdue","warning","Content review is overdue",null,{lastReviewedAt:e.last_reviewed_at,cadenceDays:e.review_cadence_days}));}
    if(e.expires_at&&new Date(e.expires_at).getTime()<now)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"expired","blocking","Content has expired",null,{expiresAt:e.expires_at}));
    const {rows:stale}=await client.query(`select 1 from content_entry_translations t where t.workspace_id=$1 and t.source_entry_id=$2 and (t.stale_at is not null or t.translated_entry_id is null) limit 1`,[job.workspace_id,e.id]);
    if(stale.length)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"localization_stale","warning","Translation readiness needs attention"));
    const {rows:deps}=await client.query(`select count(*)::int c from content_relations where workspace_id=$1 and target_entry_id=$2`,[job.workspace_id,e.id]);
    if(deps[0]?.c>0)detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"dependency_risk","info","Content has an active dependency blast radius",null,{dependents:deps[0].c}));
    const {rows:perf}=await client.query(`select metrics_json->>'comparisonWindow' win,page_views,engagement_seconds,data_fresh_through from content_analytics_snapshots where workspace_id=$1 and entry_id=$2 and source='ga4' and metrics_json->>'comparisonWindow' in ('current_28d','previous_28d') order by period_end desc`,[job.workspace_id,e.id]);
    const cur=perf.find(x=>x.win==="current_28d"),prev=perf.find(x=>x.win==="previous_28d"); if(cur&&prev){const pv=Number(prev.page_views||0),cv=Number(cur.page_views||0),pe=Number(prev.engagement_seconds||0),ce=Number(cur.engagement_seconds||0);const pd=pv?((cv-pv)/pv)*100:null,ed=pe?((ce-pe)/pe)*100:null;if((pd!==null&&pd<=-25)||(ed!==null&&ed<=-25))detected.add(await upsertWorkerFinding(client,job.workspace_id,"entry",e.id,"performance_decline","warning","Observed performance declined","Observational comparison; not proof of causality.",{pageViewsPct:pd,engagementPct:ed,freshThrough:cur.data_fresh_through}));}
  }
  const {rows:unused}=await client.query(`select a.id,a.filename,a.mime_type from assets a where a.workspace_id=$1 and a.archived_at is null and not exists(select 1 from content_relations r where r.workspace_id=a.workspace_id and r.target_asset_id=a.id)`,[job.workspace_id]);
  for(const a of unused)detected.add(await upsertWorkerFinding(client,job.workspace_id,"asset",a.id,"unused_asset","info","Media asset is unused",a.filename,{filename:a.filename,mimeType:a.mime_type}));
  const {rows:open}=await client.query(`select id,fingerprint from content_health_findings where workspace_id=$1 and finding_code=any($2::text[]) and state in ('open','acknowledged')`,[job.workspace_id,workerFindingCodes]);
  const resolveIds=open.filter(x=>!detected.has(x.fingerprint)).map(x=>x.id); if(resolveIds.length)await client.query(`update content_health_findings set state='resolved',resolved_at=now(),updated_at=now() where workspace_id=$1 and id=any($2::uuid[])`,[job.workspace_id,resolveIds]);
  await completeJob(client,job,{entries:entries.length,unusedAssets:unused.length,findingsDetected:detected.size,resolved:resolveIds.length},elapsed(startedAt));
}

let ga4WorkerClient=null;
function normalizeGa4PrivateKey(raw){let key=String(raw||"").trim();if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1).trim();return key.replace(/\\n/g,"\n").replace(/\r\n/g,"\n");}
function getGa4WorkerClient(){if(!ga4WorkerClient){if(!process.env.GA4_CLIENT_EMAIL||!process.env.GA4_PRIVATE_KEY)throw new Error("GA4_CLIENT_EMAIL / GA4_PRIVATE_KEY are not configured");ga4WorkerClient=new BetaAnalyticsDataClient({credentials:{client_email:process.env.GA4_CLIENT_EMAIL,private_key:normalizeGa4PrivateKey(process.env.GA4_PRIVATE_KEY)}});}return ga4WorkerClient;}
const isoDate=(d)=>d.toISOString().slice(0,10);function analyticsPeriod(days,offset=0){const end=new Date(Date.now()-(1+offset)*86400000);const start=new Date(end.getTime()-(days-1)*86400000);return{start:isoDate(start),end:isoDate(end)}}
async function ga4PagesWith(client,propertyId,startDate,endDate){const [response]=await client.runReport({property:`properties/${propertyId}`,dateRanges:[{startDate,endDate}],dimensions:[{name:"pagePath"},{name:"pageTitle"}],metrics:[{name:"screenPageViews"},{name:"activeUsers"},{name:"userEngagementDuration"},{name:"sessions"}],limit:10000});const dims=(response.dimensionHeaders||[]).map(x=>x.name||"");const mets=(response.metricHeaders||[]).map(x=>x.name||"");return(response.rows||[]).map(row=>{const o={};(row.dimensionValues||[]).forEach((v,i)=>o[dims[i]]=v.value||"");(row.metricValues||[]).forEach((v,i)=>o[mets[i]]=v.value||"");return{path:o.pagePath||"",title:o.pageTitle||"",pageViews:Number(o.screenPageViews||0),users:Number(o.activeUsers||0),engagementSeconds:Number(o.userEngagementDuration||0),sessions:Number(o.sessions||0)}})}
async function ga4Pages(startDate,endDate){const propertyId=process.env.GA4_PROPERTY_ID;if(!propertyId)throw new Error("GA4_PROPERTY_ID is not configured");return ga4PagesWith(getGa4WorkerClient(),propertyId,startDate,endDate);}

async function dispatchAnalyticsSync(client,job){
  const connectorId=job.payload_json?.connectorId;if(!connectorId)throw new Error("analytics_sync payload is missing connectorId");const startedAt=Date.now();
  const {rows:[connector]}=await client.query(`select * from analytics_connectors where id=$1 and workspace_id=$2 and provider='ga4' and active=true`,[connectorId,job.workspace_id]);if(!connector)return completeJob(client,job,{skipped:true,reason:"connector_missing_or_inactive"},elapsed(startedAt));
  await client.query(`insert into analytics_sync_state(connector_id,workspace_id,status,last_attempt_at,correlation_id,last_error,updated_at) values($1,$2,'running',now(),$3,null,now()) on conflict(connector_id) do update set status='running',last_attempt_at=now(),correlation_id=$3,last_error=null,updated_at=now()`,[connectorId,job.workspace_id,job.correlation_id]);
  try{
    let fetchPages=ga4Pages;
    if(connector.connection_id){
      const {rows:[connection]}=await client.query(`select id,config_json,status,active from workspace_connections where id=$1 and workspace_id=$2`,[connector.connection_id,job.workspace_id]);
      if(!connection?.active||connection.status==='disabled')throw new Error('Linked GA4 connection is disabled or unavailable');
      const credentials=await resolveWorkerConnectionCredentials(client,job.workspace_id,connection.id);const propertyId=String(connection.config_json?.propertyId||'').trim();
      if(!propertyId||!credentials.client_email||!credentials.private_key)throw new Error('Linked GA4 connection is missing required configuration or credentials');
      const scopedClient=new BetaAnalyticsDataClient({credentials:{client_email:credentials.client_email,private_key:normalizeGa4PrivateKey(credentials.private_key)}});
      fetchPages=(a,b)=>ga4PagesWith(scopedClient,propertyId,a,b);
    }
    const current=analyticsPeriod(28),previous=analyticsPeriod(28,28);const [curPages,prevPages,{rows:routes}]=await Promise.all([fetchPages(current.start,current.end),fetchPages(previous.start,previous.end),client.query(`select r.path,r.entry_id,e.published_version_id from content_routes r join content_entries e on e.id=r.entry_id and e.workspace_id=r.workspace_id where r.workspace_id=$1 and r.is_canonical=true and r.status='active' and r.entry_id is not null`,[job.workspace_id])]);
    const map=(pages)=>new Map(pages.map(p=>[(p.path.replace(/\?.*$/,'').replace(/\/$/,'')||'/'),p]));const cm=map(curPages),pm=map(prevPages);let written=0;
    for(const r of routes){const path=r.path.replace(/\/$/,'')||'/';for(const period of [{range:current,page:cm.get(path),label:'current_28d'},{range:previous,page:pm.get(path),label:'previous_28d'}]){const p=period.page;await client.query(`insert into content_analytics_snapshots(workspace_id,entry_id,version_id,destination_url,source,period_start,period_end,page_views,users_count,engagement_seconds,conversions,metrics_json,connector_id,sync_correlation_id,data_fresh_through,captured_at) values($1,$2,$3,$4,'ga4',$5,$6,$7,$8,$9,null,$10::jsonb,$11,$12,$13,now()) on conflict(workspace_id,entry_id,version_id,source,period_start,period_end) do update set destination_url=excluded.destination_url,page_views=excluded.page_views,users_count=excluded.users_count,engagement_seconds=excluded.engagement_seconds,metrics_json=excluded.metrics_json,connector_id=excluded.connector_id,sync_correlation_id=excluded.sync_correlation_id,data_fresh_through=excluded.data_fresh_through,captured_at=now()`,[job.workspace_id,r.entry_id,r.published_version_id,path,period.range.start,period.range.end,p?.pageViews||0,p?.users||0,p?.engagementSeconds||0,JSON.stringify({sessions:p?.sessions||0,pageTitle:p?.title||null,comparisonWindow:period.label,interpretation:'observational'}),connectorId,job.correlation_id,current.end]);written++;}}
    await client.query(`update analytics_sync_state set status='fresh',last_success_at=now(),fresh_through=$2,correlation_id=$3,last_error=null,updated_at=now() where connector_id=$1`,[connectorId,current.end,job.correlation_id]);await completeJob(client,job,{connectorId,freshThrough:current.end,routes:routes.length,snapshotsWritten:written,connectionId:connector.connection_id||null},elapsed(startedAt));
  }catch(error){const message=error instanceof Error?error.message:'GA4 synchronization failed';await client.query(`update analytics_sync_state set status='failed',last_error=$2,correlation_id=$3,updated_at=now() where connector_id=$1`,[connectorId,message,job.correlation_id]);throw error;}
}async function processJob(client, job) {
  try {
    if (job.kind === "publish") return await dispatchPublish(client, job);
    if (job.kind === "scheduled_release") return await dispatchScheduledRelease(client, job);
    if (job.kind === "webhook") return await dispatchWebhook(client, job);
    if (job.kind === "search_index") return await dispatchSearchIndex(client, job);
    if (job.kind === "image_processing") return await dispatchImageProcessing(client, job);
    if (job.kind === "health_scan") return await dispatchHealthScan(client, job);
    if (job.kind === "analytics_sync") return await dispatchAnalyticsSync(client, job);
    throw new Error(`Worker adapter not implemented for ${job.kind}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Worker adapter failed";
    await failJob(client, job, "ADAPTER_ERROR", message, {}, 0, 60);
  }
}

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`[delivery-worker] started ${workerId}; adapters=${SUPPORTED_KINDS.join(",")}; queues=${SUPPORTED_QUEUES.join(",")}`);
let lastMaintenanceSeed = 0;

try {
  while (!stopping) {
    if (maintenanceEnabled && Date.now() - lastMaintenanceSeed > 3_600_000) {
      await client.query("select cms_age_analytics_freshness()").catch((error) => console.error("[delivery-worker] freshness aging failed", error.message));
      await client.query("select cms_enqueue_daily_maintenance_jobs()").catch((error) => console.error("[delivery-worker] maintenance enqueue failed", error.message));
      lastMaintenanceSeed = Date.now();
    }
    const jobs = [];
    for (const queueName of SUPPORTED_QUEUES) {
      const remaining = Math.max(0, batchSize - jobs.length);
      if (!remaining) break;
      const claimed = await client.query(
        "select * from cms_claim_delivery_jobs($1,$2,$3,$4,$5::text[])",
        [workerId, remaining, leaseSeconds, queueName, SUPPORTED_KINDS]
      );
      jobs.push(...claimed.rows);
    }
    if (jobs.length === 0) {
      if (once) break;
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      continue;
    }
    for (const job of jobs) {
      if (stopping) break;
      await processJob(client, job);
    }
    if (once) break;
  }
} finally {
  await client.end();
  console.log(`[delivery-worker] stopped ${workerId}`);
}
