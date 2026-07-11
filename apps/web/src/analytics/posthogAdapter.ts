// The PostHog Analytics adapter: the only module in the repo that imports posthog-js
// (dependency-cruiser enforces the containment). The rest of the app depends on the
// Analytics port (types.ts), so the vendor stays swappable (the Identity port pattern,
// DESIGN.md section 8).
//
// INV-6 shapes the init. Session replay records the DOM and the board converges on the
// solution, so recording stays disabled, permanently. Autocapture and pageviews stay on:
// they lift interaction shape, not content, and the grid renders under ph-no-capture
// (CrosswordGrid.tsx) so nothing beneath it ever rides an event (ANALYTICS.md).
import posthog from "posthog-js";
import type { PostHog } from "posthog-js";
import type { Analytics, AnalyticsEvent, AnalyticsProperties } from "./types";

export interface PosthogAnalyticsDeps {
  token: string;
  /** The ingestion host from config; absent lets posthog-js pick its cloud default. */
  host?: string;
  /** Injectable for tests so the suite never initializes the real SDK or touches the network. */
  client?: PostHog;
}

/**
 * Analytics is best-effort by definition: no vendor fault (a blocked script, a broken
 * transport, an SDK bug) may ever surface into gameplay code, so every vendor call is
 * swallowed whole. Losing an analytics event is the accepted failure mode.
 */
function swallow(fn: () => void): void {
  try {
    fn();
  } catch {
    // Intentionally silent: see above.
  }
}

export function createPosthogAnalytics(deps: PosthogAnalyticsDeps): Analytics {
  const client = deps.client ?? posthog;
  swallow(() =>
    client.init(deps.token, {
      ...(deps.host !== undefined ? { api_host: deps.host } : {}),
      defaults: "2026-05-30",
      // INV-6: replay would record the grid DOM, which converges on the solution.
      disable_session_recording: true,
      autocapture: true,
      // The SPA routes by pushState (App.tsx), so pageviews ride history changes.
      capture_pageview: "history_change",
    }),
  );
  return {
    capture(event: AnalyticsEvent, properties?: AnalyticsProperties): void {
      swallow(() => client.capture(event, properties));
    },
    identify(userId: string, traits?: AnalyticsProperties): void {
      swallow(() => client.identify(userId, traits));
    },
    reset(): void {
      swallow(() => client.reset());
    },
  };
}
