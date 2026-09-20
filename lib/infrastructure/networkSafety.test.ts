import { describe, expect, it } from "vitest";
import { assertSafeOutboundUrl } from "@/lib/infrastructure/networkSafety";

describe("assertSafeOutboundUrl", () => {
  it("rejects invalid URLs", async () => {
    await expect(assertSafeOutboundUrl("not-a-url", "production")).rejects.toThrow("Connection URL is invalid");
  });

  it("rejects embedded credentials", async () => {
    await expect(assertSafeOutboundUrl("https://user:pass@api.example.com", "production")).rejects.toThrow("Credentials must not be embedded");
  });

  it("rejects HTTP URLs for non-local environments", async () => {
    await expect(assertSafeOutboundUrl("http://api.example.com", "production")).rejects.toThrow("Connection URL must use HTTPS");
    await expect(assertSafeOutboundUrl("http://api.example.com", "staging")).rejects.toThrow("Connection URL must use HTTPS");
    await expect(assertSafeOutboundUrl("http://api.example.com", "development")).rejects.toThrow("Connection URL must use HTTPS");
  });

  it("allows HTTP for local environments when allowHttpLocal is true", async () => {
    const url = await assertSafeOutboundUrl("http://localhost:3000/health", "local", { allowHttpLocal: true });
    expect(url.toString()).toBe("http://localhost:3000/health");
  });

  it("rejects loopback/localhost for non-local environments", async () => {
    await expect(assertSafeOutboundUrl("https://localhost:8443", "production")).rejects.toThrow("Loopback/private destinations are allowed only for Local environments");
    await expect(assertSafeOutboundUrl("https://sub.localhost:8443", "staging")).rejects.toThrow("Loopback/private destinations are allowed only for Local environments");
    await expect(assertSafeOutboundUrl("https://site.local:8443", "development")).rejects.toThrow("Loopback/private destinations are allowed only for Local environments");
  });

  it("rejects private IPv4 addresses for non-local environments", async () => {
    const privateIps = [
      "https://127.0.0.1:8443",
      "https://10.0.0.1:8443",
      "https://192.168.1.1:8443",
      "https://172.16.0.1:8443",
      "https://172.31.255.255:8443",
      "https://169.254.169.254:8443",
      "https://100.64.0.1:8443",
      "https://0.0.0.0:8443",
    ];
    for (const ip of privateIps) {
      await expect(assertSafeOutboundUrl(ip, "production")).rejects.toThrow("Private network destinations are not allowed");
    }
  });

  it("rejects private IPv6 addresses for non-local environments", async () => {
    const privateIpv6 = [
      "https://[::1]:8443",
      "https://[fe80::1]:8443",
      "https://[fc00::1]:8443",
      "https://[fd00::1]:8443",
    ];
    for (const ip of privateIpv6) {
      await expect(assertSafeOutboundUrl(ip, "production")).rejects.toThrow(/private network/i);
    }
  });

  it("accepts valid public HTTPS URLs for production", async () => {
    const url = await assertSafeOutboundUrl("https://analyticsdata.googleapis.com/v1beta", "production");
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("analyticsdata.googleapis.com");
  });
});
