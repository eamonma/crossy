// Adapter selection. The Supabase adapter runs only when the config carries both a Supabase
// URL and a publishable key; otherwise (Vite dev with nothing set, the e2e static client, a
// misconfigured deploy) the mock adapter runs so the app shell never depends on a live vendor.
import type { AppConfig } from "../config/config";
import { createMockIdentity } from "./mockAdapter";
import { createSupabaseIdentity } from "./supabaseAdapter";
import type { Identity } from "./types";

/** True when the config has real Supabase credentials, so the Supabase adapter should run. */
export function shouldUseSupabase(config: AppConfig): boolean {
  return config.supabaseUrl !== "" && config.supabasePublishableKey !== "";
}

export function createIdentity(config: AppConfig): Identity {
  if (shouldUseSupabase(config)) {
    return createSupabaseIdentity({
      supabaseUrl: config.supabaseUrl,
      publishableKey: config.supabasePublishableKey,
      apiBase: config.apiBase,
      guestsEnabled: config.guestsEnabled,
    });
  }
  return createMockIdentity({ guestsEnabled: config.guestsEnabled });
}
