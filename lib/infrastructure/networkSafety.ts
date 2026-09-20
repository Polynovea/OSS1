import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { EnvironmentKind } from "@/lib/infrastructure/types";

function privateIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((x) => Number.isNaN(x))) return false;
  const [a,b] = parts;
  return a===10 || a===127 || a===0 || (a===169&&b===254) || (a===172&&b>=16&&b<=31) || (a===192&&b===168) || (a===100&&b>=64&&b<=127);
}

function privateIpv6(ip: string) {
  const value=ip.toLowerCase();
  return value==="::1" || value==="::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd");
}

export async function assertSafeOutboundUrl(raw: string, environmentKind: EnvironmentKind, options: { allowHttpLocal?: boolean } = {}) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Connection URL is invalid"); }
  const localAllowed = environmentKind === "local" && options.allowHttpLocal === true;
  if (url.username || url.password) throw new Error("Credentials must not be embedded in connection URLs");
  if (url.protocol !== "https:" && !(localAllowed && url.protocol === "http:")) throw new Error(localAllowed ? "Connection URL must use HTTPS or local HTTP" : "Connection URL must use HTTPS");
  const host=url.hostname.toLowerCase();
  const explicitLocal=host==="localhost" || host.endsWith(".localhost") || host.endsWith(".local");
  if (explicitLocal && !localAllowed) throw new Error("Loopback/private destinations are allowed only for Local environments");
  if (explicitLocal) return url;
  const version=isIP(host);
  if (version===4 && privateIpv4(host) && !localAllowed) throw new Error("Private network destinations are not allowed for this environment");
  if (version===6 && privateIpv6(host) && !localAllowed) throw new Error("Private network destinations are not allowed for this environment");
  if (!version) {
    try {
      const addresses=await lookup(host,{all:true,verbatim:true});
      for(const address of addresses){
        if ((address.family===4&&privateIpv4(address.address))||(address.family===6&&privateIpv6(address.address))) {
          if(!localAllowed) throw new Error("Connection hostname resolves to a private network address");
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("private network")) throw error;
      throw new Error("Connection hostname could not be resolved");
    }
  }
  return url;
}

export async function safeFetch(raw: string, environmentKind: EnvironmentKind, init: RequestInit = {}, maxRedirects = 2): Promise<Response> {
  let current = await assertSafeOutboundUrl(raw, environmentKind, { allowHttpLocal: true });
  for (let hop=0; hop<=maxRedirects; hop++) {
    const response=await fetch(current,{...init,redirect:"manual"});
    if (![301,302,303,307,308].includes(response.status)) return response;
    const location=response.headers.get("location");
    if (!location) return response;
    if (hop===maxRedirects) throw new Error("Connection verification exceeded the redirect limit");
    current=await assertSafeOutboundUrl(new URL(location,current).toString(),environmentKind,{allowHttpLocal:true});
  }
  throw new Error("Connection verification failed");
}
