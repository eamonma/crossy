// The product analytics port: the ONLY module in this service that imports posthog-node
// (the repo-wide boundary rule pins the vendor to src/analytics). Everything else depends
// on the Analytics interface, so the vendor is swappable and tests inject a fake client,
// never the SDK (the same containment shape as the web Identity port, DESIGN.md §8).
//
// Posture: authoritative product events, counts and ids only. The property value type is
// flat primitives, so a board, cell list, or solution structurally cannot ride an event
// (INV-6: the type is the guarantee, not runtime stripping). capture() is fire-and-forget:
// it must never throw into a request handler, so a vendor fault is one log line. Absent
// POSTHOG_TOKEN the noop runs and the SDK is never constructed, so dev machines and CI
// behave identically with zero analytics network.
import { PostHog } from "posthog-node";

/** Default ingestion host (PostHog US cloud); POSTHOG_HOST overrides for EU or self-hosted. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

/**
 * Event properties are flat ids and counts. The value union deliberately excludes objects
 * and arrays, so board content cannot be attached even by mistake (INV-6).
 */
export type AnalyticsProperties = Readonly<
  Record<string, string | number | boolean | null>
>;

/** One product event. The v1 vocabulary is snake_case (room_created, ...). */
export interface AnalyticsEvent {
  /** The acting member's provider-issued userId; the roomId for room-level events. */
  readonly distinctId: string;
  readonly event: string;
  readonly properties?: AnalyticsProperties;
}

/** The port the service consumes. capture never throws; shutdown flushes, then closes. */
export interface Analytics {
  capture(event: AnalyticsEvent): void;
  /** Flush the buffered queue and close the client. Hooked into the signal handlers. */
  shutdown(): Promise<void>;
}

/**
 * The slice of the posthog-node client the adapter uses. Tests inject a fake of this shape,
 * so no test constructs the SDK or touches a network.
 */
export interface AnalyticsClient {
  capture(msg: {
    distinctId: string;
    event: string;
    properties?: Record<string, unknown>;
  }): void;
  shutdown(): Promise<void>;
}

export interface PosthogConfig {
  readonly token: string;
  readonly host: string;
}

/**
 * Read POSTHOG_TOKEN and POSTHOG_HOST into a config, or null when the token is absent. A
 * present-but-empty value counts as absent (the 12-factor unset convention server.ts uses).
 * Null selects the noop; the SDK is then never constructed.
 */
export function readPosthogConfig(
  env: NodeJS.ProcessEnv,
): PosthogConfig | null {
  const token = env["POSTHOG_TOKEN"];
  if (token === undefined || token === "") return null;
  const host = env["POSTHOG_HOST"];
  return {
    token,
    host: host === undefined || host === "" ? DEFAULT_POSTHOG_HOST : host,
  };
}

/** The no-op analytics: every hook does nothing. The inert path when POSTHOG_TOKEN is unset. */
export function createNoopAnalytics(): Analytics {
  return { capture: () => {}, shutdown: () => Promise.resolve() };
}

/**
 * The live adapter over ONE posthog-node client, constructed here and only here, once per
 * process (the composition root calls this once). `createClient` is injectable for tests;
 * production takes the default, which builds the real SDK client.
 */
export function createPosthogAnalytics(
  config: PosthogConfig,
  createClient: (config: PosthogConfig) => AnalyticsClient = ({
    token,
    host,
  }) => new PostHog(token, { host }),
): Analytics {
  const client = createClient(config);
  return {
    capture(event: AnalyticsEvent): void {
      // Fire-and-forget: the SDK buffers and flushes in the background. A synchronous fault
      // must never surface into the caller's path, so it is swallowed to a log line. The
      // line carries the event name only, never properties (INV-6-safe log).
      try {
        client.capture({
          distinctId: event.distinctId,
          event: event.event,
          ...(event.properties !== undefined
            ? { properties: event.properties }
            : {}),
        });
      } catch (error) {
        console.error(
          `analytics capture fault (${event.event}):`,
          error instanceof Error ? error.message : error,
        );
      }
    },
    async shutdown(): Promise<void> {
      // posthog-node's shutdown flushes the queue, then closes. Swallowed to a log line so
      // a flush fault on shutdown never aborts the rest of the shutdown sequence.
      try {
        await client.shutdown();
      } catch (error) {
        console.error(
          "analytics shutdown fault:",
          error instanceof Error ? error.message : error,
        );
      }
    },
  };
}
