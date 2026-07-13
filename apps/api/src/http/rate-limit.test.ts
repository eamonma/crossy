// Rate limiter tests (http/rate-limit.ts). The fixed-window counter and the Hono middleware wrapper
// are proven with an injected clock, so no test waits on a real timer. The wiring onto the join and
// code-resolution routes is exercised where those routes live; here the limiter is tested in
// isolation, which is where its window arithmetic and the 429 envelope belong.
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { ApiEnv } from "../context";
import { clientIp, createRateLimiter, rateLimit } from "./rate-limit";

describe("createRateLimiter (fixed window)", () => {
  it("allows up to `limit` per window, then refuses with the seconds until reset", () => {
    const t = 0;
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => t,
    });
    expect(limiter.check("k")).toEqual({ ok: true });
    expect(limiter.check("k")).toEqual({ ok: true });
    // Third within the window is refused; the window opened at t=0 and lasts 1000ms.
    expect(limiter.check("k")).toEqual({ ok: false, retryAfterSec: 1 });
  });

  it("resets once the window elapses", () => {
    let t = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => t,
    });
    expect(limiter.check("k").ok).toBe(true);
    expect(limiter.check("k").ok).toBe(false);
    t = 1000; // window boundary reached
    expect(limiter.check("k").ok).toBe(true);
  });

  it("keys independently, so one caller's flood does not limit another", () => {
    const t = 0;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      now: () => t,
    });
    expect(limiter.check("a").ok).toBe(true);
    expect(limiter.check("a").ok).toBe(false);
    expect(limiter.check("b").ok).toBe(true); // a's exhausted window does not touch b
  });
});

describe("rateLimit middleware (429 + Retry-After envelope)", () => {
  it("passes the first `limit` requests, then returns RATE_LIMITED with Retry-After", async () => {
    let t = 0;
    const app = new Hono<ApiEnv>();
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      now: () => t,
    });
    app.get(
      "/x",
      rateLimit(limiter, () => "k"),
      (c) => c.text("ok"),
    );

    expect((await app.request("/x")).status).toBe(200);
    expect((await app.request("/x")).status).toBe(200);
    const limited = await app.request("/x");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("1");
    expect(await limited.json()).toEqual({
      error: "RATE_LIMITED",
      message: "too many requests; slow down",
    });

    t = 1000; // next window
    expect((await app.request("/x")).status).toBe(200);
  });
});

describe("clientIp", () => {
  it("prefers CF-Connecting-IP, then the first X-Forwarded-For hop, then 'unknown'", async () => {
    const app = new Hono<ApiEnv>();
    app.get("/ip", (c) => c.text(clientIp(c)));

    const cf = await app.request("/ip", {
      headers: { "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" },
    });
    expect(await cf.text()).toBe("9.9.9.9");

    const xff = await app.request("/ip", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(await xff.text()).toBe("1.1.1.1");

    const none = await app.request("/ip");
    expect(await none.text()).toBe("unknown");
  });
});
