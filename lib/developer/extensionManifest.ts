import { z } from "zod";
import { sha256Canonical } from "@/lib/intelligence/operationalCanonical";

const identifier = z.string().min(2).max(128).regex(/^[a-z0-9][a-z0-9._-]+$/);
const permissionKey = z.string().min(3).max(160).regex(/^[a-z0-9][a-z0-9._:-]+$/);
const semver = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[+-][0-9A-Za-z.-]+)?$/);

const routeSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1).max(300),
  permission: permissionKey.optional(),
});

const fieldSchema = z.object({
  key: identifier,
  type: identifier,
  configSchema: z.record(z.unknown()),
});

const adminExtensionSchema = z.object({
  key: identifier,
  slot: z.enum(["dashboard_panel", "entry_panel", "sidebar", "settings_panel"]),
  route: z.string().min(1).max(300).optional(),
});

const networkRequirementSchema = z.object({
  origin: z.string().min(1).max(500),
  methods: z.array(z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"])).min(1).max(5).default(["GET"]),
});

const requestedConnectionSchema = z.object({
  connectorFamily: identifier,
  connectorTypes: z.array(identifier).max(32).default([]),
  scopes: z.array(permissionKey).min(1).max(64),
});

export const extensionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  extensionKey: identifier,
  name: z.string().trim().min(1).max(160),
  version: semver,
  publisher: z.string().trim().min(1).max(200).optional(),
  compatibleCoreVersions: z.array(z.string().trim().min(1).max(80)).min(1).max(32),
  permissions: z.array(permissionKey).max(128).default([]),
  routes: z.array(routeSchema).max(64).default([]),
  events: z.object({
    subscribe: z.array(permissionKey).max(128).default([]),
    emit: z.array(permissionKey).max(128).default([]),
  }).default({ subscribe: [], emit: [] }),
  fields: z.array(fieldSchema).max(64).default([]),
  adminExtensions: z.array(adminExtensionSchema).max(64).default([]),
  networkRequirements: z.array(networkRequirementSchema).max(64).default([]),
  requiredCapabilities: z.array(identifier).max(128).default([]),
  requestedConnections: z.array(requestedConnectionSchema).max(64).default([]),
}).strict();

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

function validateExactOrigin(origin: string) {
  if (origin.includes("*")) throw new Error("Extension network declarations cannot contain wildcards");
  let url: URL;
  try { url = new URL(origin); }
  catch { throw new Error(`Extension network origin is invalid: ${origin}`); }

  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`Extension network origin must use HTTPS (HTTP is allowed only for localhost): ${origin}`);
  }
  if (url.username || url.password) throw new Error("Extension network declarations cannot embed credentials");
  if (url.pathname !== "/" || url.search || url.hash) throw new Error(`Extension network requirement must declare an exact origin, not a path/query: ${origin}`);
  return url.origin;
}

export function parseExtensionManifest(input: unknown): { manifest: ExtensionManifest; sha256: string } {
  const manifest = extensionManifestSchema.parse(input);
  const routePrefix = `/extensions/${manifest.extensionKey}`;

  for (const route of manifest.routes) {
    if (!route.path.startsWith(`${routePrefix}/`) && route.path !== routePrefix) {
      throw new Error(`Extension route must remain inside ${routePrefix}`);
    }
    if (route.path.includes("..") || route.path.includes("//")) throw new Error(`Extension route is not canonical: ${route.path}`);
  }

  for (const eventName of manifest.events.emit) {
    if (!eventName.startsWith(`extension.${manifest.extensionKey}.`)) {
      throw new Error(`Extension emitted event must be namespaced as extension.${manifest.extensionKey}.*`);
    }
  }

  const seenOrigins = new Set<string>();
  for (const requirement of manifest.networkRequirements) {
    const exactOrigin = validateExactOrigin(requirement.origin);
    if (seenOrigins.has(exactOrigin)) throw new Error(`Duplicate extension network origin: ${exactOrigin}`);
    seenOrigins.add(exactOrigin);
  }

  const uniquePermissions = new Set(manifest.permissions);
  if (uniquePermissions.size !== manifest.permissions.length) throw new Error("Extension permissions must be unique");
  for (const route of manifest.routes) {
    if (route.permission && !uniquePermissions.has(route.permission)) {
      throw new Error(`Route permission ${route.permission} must be declared in manifest permissions`);
    }
  }

  return { manifest, sha256: sha256Canonical(manifest) };
}

export function requestedExtensionPrivileges(manifest: ExtensionManifest) {
  return {
    permissions: [...manifest.permissions],
    networkOrigins: manifest.networkRequirements.map((item) => new URL(item.origin).origin),
    requestedConnections: manifest.requestedConnections.map((item) => ({
      connectorFamily: item.connectorFamily,
      connectorTypes: [...item.connectorTypes],
      scopes: [...item.scopes],
    })),
  };
}

function numericVersion(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
}

/** Deliberately small, deterministic compatibility surface: exact, >=, ^ and ~. */
export function isCoreVersionCompatible(coreVersion: string, declarations: string[]) {
  const core = numericVersion(coreVersion);
  if (!core) return false;
  return declarations.some((declaration) => {
    const source = declaration.trim();
    const operator = source.match(/^(>=|\^|~)?/)?.[1] ?? "";
    const expected = numericVersion(source.replace(/^(>=|\^|~)/, ""));
    if (!expected) return false;
    const comparison = core[0] - expected[0] || core[1] - expected[1] || core[2] - expected[2];
    if (operator === ">=") return comparison >= 0;
    if (operator === "^") return core[0] === expected[0] && comparison >= 0;
    if (operator === "~") return core[0] === expected[0] && core[1] === expected[1] && comparison >= 0;
    return comparison === 0;
  });
}
