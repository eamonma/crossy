// The Analytics port barrel. The app imports the port and the factory from here; only files
// inside src/analytics import posthog-js (dependency-cruiser enforces it).
export type { Analytics, AnalyticsEvent, AnalyticsProperties } from "./types";
export { createAnalytics, shouldUsePosthog } from "./createAnalytics";
export { createNoopAnalytics } from "./noopAdapter";
export { bridgeIdentityToAnalytics } from "./identityBridge";
