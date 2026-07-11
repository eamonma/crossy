// Adapter selection. The PostHog adapter runs only when the config carries a token;
// otherwise (Vite dev with nothing set, the e2e static client, a deploy without analytics)
// the no-op adapter runs so the app shell never depends on a live vendor. Dev defaults to
// the no-op on purpose: the token arrives via service env at container start
// (nginx/default.conf.template), never from .env.development.
import type { AppConfig } from "../config/config";
import { createNoopAnalytics } from "./noopAdapter";
import { createPosthogAnalytics } from "./posthogAdapter";
import type { Analytics } from "./types";

/** True when the config has a PostHog token, so the PostHog adapter should run. */
export function shouldUsePosthog(config: AppConfig): boolean {
  return config.posthogToken !== undefined && config.posthogToken !== "";
}

export function createAnalytics(config: AppConfig): Analytics {
  const token = config.posthogToken;
  if (token === undefined || token === "") return createNoopAnalytics();
  const host = config.posthogHost;
  return createPosthogAnalytics(
    host !== undefined ? { token, host } : { token },
  );
}
