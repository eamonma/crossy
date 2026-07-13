// Application-level rate limiting for the invite/join code paths (defense in depth). The PRIMARY
// limiter is Cloudflare's edge rate-limiting rules on the same hosts (owner infra); this in-process
// limiter is a backstop so a flood that slips past the edge, or a deploy without the edge rules yet,
// still cannot hammer the code-resolution index unbounded. It is a fixed-window counter kept in
// memory: single-writer, ~1 instance today (DESIGN.md §9), so a per-instance map is sufficient; a
// horizontally scaled api would move this to a shared store, which is why the store is created per
// limiter (one Map per call site) rather than a module global.
//
// The threat is flood and DB load, not brute force: the code space is 32^8 (~1.1e12) and the join
// paths are authenticated, so enumeration is already infeasible (PROTOCOL.md §12). Limits are
// therefore generous; they exist to cap abuse and the valid-vs-invalid oracle, not to gate normal
// use. The clock is injectable so the limiter is unit-tested without a real timer.
import type { Context, MiddlewareHandler } from "hono";
import type { ApiEnv } from "../context";
import { fail } from "./errors";

/** Above this many tracked keys, a new-window insert first drops expired buckets to bound memory. */
const SWEEP_THRESHOLD = 10_000;

/** The outcome of a rate-limit check: allowed, or refused with the seconds until the window resets. */
export type RateLimitResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterSec: number };

export interface RateLimiter {
  /** Count one request against `key`; `ok:false` means the window is exhausted (do not serve). */
  check(key: string): RateLimitResult;
}

/**
 * Create a fixed-window rate limiter. `limit` requests are allowed per `windowMs`; the window is
 * per key and starts on that key's first request in the window. `now` is injectable for tests
 * (defaults to `Date.now`). The bucket map is this limiter's own, so two call sites do not share
 * counters unless they share one limiter instance.
 */
export function createRateLimiter(opts: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const clock = opts.now ?? ((): number => Date.now());
  return {
    check(key: string): RateLimitResult {
      const now = clock();
      let bucket = buckets.get(key);
      if (bucket === undefined || now >= bucket.resetAt) {
        if (buckets.size > SWEEP_THRESHOLD) {
          for (const [k, v] of buckets) {
            if (now >= v.resetAt) buckets.delete(k);
          }
        }
        bucket = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= opts.limit) {
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }
      bucket.count += 1;
      return { ok: true };
    },
  };
}

/**
 * The best-effort client IP for per-IP limiting on the public code paths. Behind Cloudflare and the
 * Railway edge, the real client is in `CF-Connecting-IP`, else the first hop of `X-Forwarded-For`.
 * A request with neither (in-process tests, an odd proxy) shares the `"unknown"` bucket, which only
 * makes the limit stricter for that unattributed traffic, never looser for a real client.
 */
export function clientIp(c: Context<ApiEnv>): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf !== undefined && cf !== "") return cf;
  const xff = c.req.header("x-forwarded-for");
  if (xff !== undefined && xff !== "") return xff.split(",")[0]!.trim();
  return "unknown";
}

/**
 * A Hono middleware that refuses a request with `429` + `Retry-After` (the JSON error envelope,
 * `RATE_LIMITED`) once `key(c)` has spent its window, and otherwise passes through. For the JSON
 * API routes (join by code); the HTML code paths (the invite host, the unfurl) call `limiter.check`
 * inline so they can answer with a plain-text 429 rather than the JSON envelope.
 */
export function rateLimit(
  limiter: RateLimiter,
  key: (c: Context<ApiEnv>) => string,
): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const result = limiter.check(key(c));
    if (!result.ok) {
      c.header("retry-after", String(result.retryAfterSec));
      return fail(c, "RATE_LIMITED", "too many requests; slow down");
    }
    return next();
  };
}
