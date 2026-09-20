import { describe, expect, it } from "vitest";
import {
  CONNECTOR_REGISTRY,
  getConnectorDefinition,
  listConnectorDefinitions,
  validateConnectorConfiguration,
} from "@/lib/infrastructure/connectorRegistry";

describe("connectorRegistry", () => {
  it("registers core connector definitions across all supported families", () => {
    const list = listConnectorDefinitions();
    expect(list.length).toBeGreaterThanOrEqual(8);

    const families = new Set(list.map((c) => c.family));
    expect(families.has("analytics")).toBe(true);
    expect(families.has("website")).toBe(true);
    expect(families.has("database")).toBe(true);
    expect(families.has("storage")).toBe(true);
    expect(families.has("webhook")).toBe(true);
    expect(families.has("ai")).toBe(true);
  });

  it("retrieves connector definition by type", () => {
    const ga4 = getConnectorDefinition("analytics.ga4");
    expect(ga4).not.toBeNull();
    expect(ga4?.family).toBe("analytics");
    expect(ga4?.label).toBe("Google Analytics 4");

    const unknown = getConnectorDefinition("nonexistent.type");
    expect(unknown).toBeNull();
  });

  it("validates connector configuration and required credentials", () => {
    // Missing required field
    expect(() =>
      validateConnectorConfiguration("analytics.ga4", {}, [])
    ).toThrow("GA4 Property ID is required");

    // Missing required credentials
    expect(() =>
      validateConnectorConfiguration("analytics.ga4", { propertyId: "12345" }, ["client_email"])
    ).toThrow("Service Account Private Key is required");

    // Valid configuration
    const valid = validateConnectorConfiguration(
      "analytics.ga4",
      { propertyId: "12345" },
      ["client_email", "private_key"]
    );
    expect(valid.type).toBe("analytics.ga4");
  });

  it("validates URL fields on website and webhook connectors", () => {
    expect(() =>
      validateConnectorConfiguration("website.rest", { baseUrl: "invalid-url" }, [])
    ).toThrow("Base URL must be a valid URL");

    const valid = validateConnectorConfiguration(
      "website.rest",
      { baseUrl: "https://example.com" },
      []
    );
    expect(valid.type).toBe("website.rest");
  });

  it("rejects unknown connector types", () => {
    expect(() =>
      validateConnectorConfiguration("foo.bar", {}, [])
    ).toThrow("Unsupported connector type");
  });
});
