// The JWKS auth adapter (SP2). It verifies access tokens against an in-memory JWKS that a
// background timer refreshes; no synchronous network fetch ever sits on the verify path.
// An unknown `kid` fails closed and schedules exactly one debounced out-of-band refresh.
// Nothing here is vendor-specific: it is a generic asymmetric-JWKS verifier (issuer +
// /.well-known/jwks.json), pointed at Supabase's GoTrue in production purely by config.
// All config is passed in (12-factor: no ambient reads), and the JWKS-fetching function
// is a dependency so tests inject a local one and the zero-network property stays
// testable. The service wires a real `fetch`; this file never imports one.

import { createLocalJWKSet } from "jose";
import type { JSONWebKeySet } from "jose";
import {
  DEFAULT_ALGORITHMS,
  DEFAULT_ANONYMOUS_CLAIM,
  DEFAULT_AUDIENCE,
  DEFAULT_CLOCK_TOLERANCE_SEC,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_UNKNOWN_KID_DEBOUNCE_MS,
} from "./port";
import type { AuthPort, VerifyResult } from "./port";
import { verifyToken } from "./verify-core";

/** A cancellable timer handle, so the injected scheduler need not leak a platform type. */
export interface TimerHandle {
  cancel(): void;
}

/** The timer surface the adapter needs. Injected so tests drive refresh deterministically. */
export interface Scheduler {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  setInterval(fn: () => void, ms: number): TimerHandle;
}

const defaultScheduler: Scheduler = {
  setTimeout(fn, ms) {
    const h = setTimeout(fn, ms);
    h.unref?.();
    return { cancel: () => clearTimeout(h) };
  },
  setInterval(fn, ms) {
    const h = setInterval(fn, ms);
    h.unref?.();
    return { cancel: () => clearInterval(h) };
  },
};

export interface JwksAuthConfig {
  /** The token issuer, exact-matched against `iss`. The JWKS URL derives from it (SP2). */
  readonly issuer: string;
  /**
   * Fetches the JWK Set from the given URL. The service passes a `fetch` wrapper; tests
   * pass a local function. The adapter never fetches on the verify path.
   */
  readonly fetchJwks: (jwksUri: string) => Promise<JSONWebKeySet>;
  /** Expected audience. Defaults to `authenticated` (GoTrue's convention). */
  readonly audience?: string;
  /**
   * The claim name carrying the anonymity flag. Defaults to `is_anonymous` (GoTrue's
   * convention). Overridable so a different issuer can name it otherwise.
   */
  readonly anonymousClaim?: string;
  /** Asymmetric algorithm allowlist. Defaults to ES256/RS256/EdDSA (HS256 refused). */
  readonly algorithms?: readonly string[];
  /** Clock-skew tolerance in seconds. Defaults to 10. */
  readonly clockToleranceSec?: number;
  /** Background refresh interval in ms. Defaults to 300000. */
  readonly refreshIntervalMs?: number;
  /** Debounce window in ms for the unknown-`kid` refresh. Defaults to 10000. */
  readonly unknownKidRefreshDebounceMs?: number;
  /** Injected clock (12-factor). Defaults to the wall clock. */
  readonly now?: () => Date;
  /** Injected timers. Defaults to Node's global timers. */
  readonly scheduler?: Scheduler;
  /** Override the derived JWKS URL. Defaults to `${issuer}/.well-known/jwks.json`. */
  readonly jwksUri?: string;
}

export interface JwksAuthPort extends AuthPort {
  /** Start the background refresh timer. Idempotent. Call once after construction. */
  start(): void;
  /** Stop the background timer and cancel any pending debounced refresh. */
  stop(): void;
  /** Fetch and atomically swap the key set now. Keeps the last-good set on failure. */
  refreshNow(): Promise<void>;
}

/** Derive the JWKS URL from an issuer, tolerant of a trailing slash (SP2). */
export function deriveJwksUri(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
}

/**
 * Construct the JWKS auth port. Performs the boot JWKS fetch (SP2 step 1), so a
 * rejected initial fetch rejects construction — a service cannot verify without keys.
 * Subsequent refresh failures are swallowed and the last-good set is retained.
 */
export async function createJwksAuthPort(
  config: JwksAuthConfig,
): Promise<JwksAuthPort> {
  const audience = config.audience ?? DEFAULT_AUDIENCE;
  const anonymousClaim = config.anonymousClaim ?? DEFAULT_ANONYMOUS_CLAIM;
  const algorithms = config.algorithms ?? DEFAULT_ALGORITHMS;
  const clockToleranceSec =
    config.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
  const refreshIntervalMs =
    config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const debounceMs =
    config.unknownKidRefreshDebounceMs ?? DEFAULT_UNKNOWN_KID_DEBOUNCE_MS;
  const now = config.now ?? (() => new Date());
  const scheduler = config.scheduler ?? defaultScheduler;
  const jwksUri = config.jwksUri ?? deriveJwksUri(config.issuer);

  const coreConfig = {
    issuer: config.issuer,
    audience,
    algorithms,
    clockToleranceSec,
    now,
    anonymousClaim,
  };

  // The in-memory resolver. `verify` reads this binding at call time, so a refresh swap
  // is picked up on the next verify with no locking and no per-request fetch.
  let resolver: ReturnType<typeof createLocalJWKSet>;

  async function load(): Promise<void> {
    const jwks = await config.fetchJwks(jwksUri);
    resolver = createLocalJWKSet(jwks);
  }

  // Boot fetch (SP2 step 1): propagate failure so construction fails loudly.
  await load();

  let intervalHandle: TimerHandle | null = null;
  let debounceHandle: TimerHandle | null = null;

  async function refreshNow(): Promise<void> {
    try {
      await load();
    } catch {
      // Keep the last-good set (SP2): a fetch failure is never a reason to reject tokens.
    }
  }

  function scheduleDebouncedRefresh(): void {
    if (debounceHandle !== null) return; // coalesce a burst into exactly one refresh
    debounceHandle = scheduler.setTimeout(() => {
      debounceHandle = null;
      void refreshNow();
    }, debounceMs);
  }

  return {
    async verify(token: string): Promise<VerifyResult> {
      const result = await verifyToken(resolver, token, coreConfig);
      // Unknown `kid`: fail closed (already reflected in `result`) and trigger one
      // out-of-band refresh so a freshly rotated key lands within the debounce window.
      if (result.ok === false && result.reason === "unknown-key") {
        scheduleDebouncedRefresh();
      }
      return result;
    },
    start(): void {
      if (intervalHandle !== null) return;
      intervalHandle = scheduler.setInterval(() => {
        void refreshNow();
      }, refreshIntervalMs);
    },
    stop(): void {
      intervalHandle?.cancel();
      intervalHandle = null;
      debounceHandle?.cancel();
      debounceHandle = null;
    },
    refreshNow,
  };
}
