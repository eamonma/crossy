// Invite host tests (PROTOCOL.md §12 "Invite links"). Driven through the real composed app
// (`buildApp`), so what is proven is the host-scoped wiring: the invite host owns its own two
// endpoints, the core API host is untouched, and a malformed code is bounced without ever touching
// the database. The DB-backed paths (a real code resolving to a game, the two-audience response)
// live in the integration suite (api.test.ts), which has a Postgres and can mint invite codes; here
// the db is a stub that throws on any touch, so the shape-gate's "no DB probe" claim is enforced.
import { describe, expect, it } from "vitest";
import { createFakeAuthProvider } from "@crossy/auth";
import type { Hono } from "hono";
import { buildApp } from "../app";
import type { ApiEnv } from "../context";
import type { Db } from "../db/client";

const INVITE_HOST = "crossy.ing";
const WEB_ORIGIN = "https://crossy.party";
const APP_ID = "TEAMID1234.com.example.crossy";
const AASA_PATH = "/.well-known/apple-app-site-association";

// The invite host holds no database read on any path this suite exercises (AASA, host fall-through,
// and the pre-DB shape-gate); any touch is a test failure, not a hang.
const dbStub = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`invite-host suite touched the db (${String(prop)})`);
    },
  },
) as Db;

async function makeApp(opts: {
  inviteHost?: string;
  webOrigin?: string;
  appleAppId?: string;
}): Promise<Hono<ApiEnv>> {
  const auth = await createFakeAuthProvider();
  return buildApp({
    db: dbStub,
    authPort: auth,
    sessionWsBase: "wss://session.crossy.test",
    ...(opts.inviteHost !== undefined ? { inviteHost: opts.inviteHost } : {}),
    ...(opts.webOrigin !== undefined ? { webOrigin: opts.webOrigin } : {}),
    ...(opts.appleAppId !== undefined ? { appleAppId: opts.appleAppId } : {}),
  });
}

const enabled = { inviteHost: INVITE_HOST, webOrigin: WEB_ORIGIN };

describe("invite host: AASA (PROTOCOL.md §12; universal links)", () => {
  it("claims the whole host (/*) when an app identifier is configured", async () => {
    const app = await makeApp({ ...enabled, appleAppId: APP_ID });
    const res = await app.request(`https://${INVITE_HOST}${AASA_PATH}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({
      applinks: {
        details: [{ appIDs: [APP_ID], components: [{ "/": "/*" }] }],
      },
    });
  });

  it("fails closed with 404 when no app identifier is configured", async () => {
    const app = await makeApp(enabled);
    const res = await app.request(`https://${INVITE_HOST}${AASA_PATH}`);
    expect(res.status).toBe(404);
  });
});

describe("invite host: GET /{code} pre-DB behavior (PROTOCOL.md §12; INV-6)", () => {
  it("bounces a malformed code to the web home WITHOUT probing the db (shape-gate)", async () => {
    const app = await makeApp(enabled);
    // "not-a-code" normalizes to too-short/illegal, so it fails the shape-gate; the dbStub throws
    // if the handler ever reaches a lookup, so a pass here proves the gate short-circuits first.
    const res = await app.request(`https://${INVITE_HOST}/not-a-code`, {
      headers: { "sec-fetch-mode": "navigate" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB_ORIGIN}/`);
  });

  it("bounces the bare root (no code) to the web home", async () => {
    const app = await makeApp(enabled);
    const res = await app.request(`https://${INVITE_HOST}/`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB_ORIGIN}/`);
  });

  it("bounces a non-GET on the invite host to the web home", async () => {
    const app = await makeApp(enabled);
    const res = await app.request(`https://${INVITE_HOST}/ABCD2345`, {
      method: "POST",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${WEB_ORIGIN}/`);
  });
});

describe("invite host: host-scoping (the core API host is untouched)", () => {
  it("passes a core-host request straight through (GET /health still answers)", async () => {
    const app = await makeApp(enabled);
    const res = await app.request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("does NOT treat a core-host /{code}-shaped path as an invite link (404, not a redirect)", async () => {
    const app = await makeApp(enabled);
    const res = await app.request("http://localhost/ABCD2345");
    // No such route on the core API host, so a plain 404; the invite host's redirect behavior is
    // scoped to its own hostname and never leaks onto the API.
    expect(res.status).toBe(404);
  });

  it("leaves the core AASA claiming /g/* (the invite middleware does not hijack it)", async () => {
    const app = await makeApp({ ...enabled, appleAppId: APP_ID });
    const res = await app.request(`http://localhost${AASA_PATH}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      applinks: { details: { components: Record<string, string>[] }[] };
    };
    expect(body.applinks.details.flatMap((d) => d.components)).toEqual([
      { "/": "/g/*" },
    ]);
  });

  it("is a no-op when inviteHost is unset: an invite-host path falls through to the core API", async () => {
    const app = await makeApp({ webOrigin: WEB_ORIGIN }); // no inviteHost
    const res = await app.request(`https://${INVITE_HOST}/ABCD2345`);
    expect(res.status).toBe(404); // core API has no such route; no redirect
  });
});
