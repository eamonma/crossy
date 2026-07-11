// The no-op Analytics adapter: what tests and token-less environments get (Vite dev with
// nothing set, the e2e static client, a deploy without analytics). It runs the same port
// the app consumes, so callers never branch on whether analytics is live; capture,
// identify, and reset land nowhere by design.
import type { Analytics } from "./types";

export function createNoopAnalytics(): Analytics {
  return {
    capture(): void {
      // No-op: no token, no vendor, nothing recorded.
    },
    identify(): void {
      // No-op.
    },
    reset(): void {
      // No-op.
    },
  };
}
