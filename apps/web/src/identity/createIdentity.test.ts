import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config/config";
import { createIdentity, shouldUseSupabase } from "./createIdentity";

const base: AppConfig = {
  supabaseUrl: "",
  supabasePublishableKey: "",
  apiBase: "",
  guestsEnabled: false,
};

describe("adapter selection", () => {
  it("uses Supabase only when both a URL and a key are present", () => {
    expect(shouldUseSupabase(base)).toBe(false);
    expect(
      shouldUseSupabase({ ...base, supabaseUrl: "https://api.crossy.me" }),
    ).toBe(false);
    expect(
      shouldUseSupabase({
        ...base,
        supabasePublishableKey: "sb_publishable_x",
      }),
    ).toBe(false);
    expect(
      shouldUseSupabase({
        ...base,
        supabaseUrl: "https://api.crossy.me",
        supabasePublishableKey: "sb_publishable_x",
      }),
    ).toBe(true);
  });

  it("falls back to the mock adapter with no credentials, honoring guestsEnabled", async () => {
    const disabled = createIdentity(base);
    expect((await disabled.signInGuest()).ok).toBe(false);

    const enabled = createIdentity({ ...base, guestsEnabled: true });
    expect((await enabled.signInGuest()).ok).toBe(true);
  });

  it("builds a working Identity when Supabase credentials are present", () => {
    const identity = createIdentity({
      ...base,
      supabaseUrl: "https://api.crossy.me",
      supabasePublishableKey: "sb_publishable_x",
    });
    expect(typeof identity.getAccessToken).toBe("function");
    expect(typeof identity.signInWithProvider).toBe("function");
    expect(identity.getSession()).toBeNull();
  });
});
