import { describe, expect, it } from "vitest";
import { getSupabaseBrowserConfig } from "./supabase";

describe("getSupabaseBrowserConfig", () => {
  it("does not select an endpoint when public configuration is absent", () => {
    expect(getSupabaseBrowserConfig({})).toBeNull();
    expect(getSupabaseBrowserConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://db.example.test" })).toBeNull();
  });

  it("returns only explicitly configured browser values", () => {
    expect(getSupabaseBrowserConfig({
      NEXT_PUBLIC_SUPABASE_URL: " https://db.example.test ",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: " public-key ",
    })).toEqual({ url: "https://db.example.test", anonKey: "public-key" });
  });
});
