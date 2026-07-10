// AASA route tests (apps/ios/ROADMAP.md SP-i4; apps/ios/EXPERIENCE.md section 4). Driven
// through the real composed app (`buildApp`), so what is proven is the wiring Apple's CDN
// depends on: the exact public path, no auth, no redirect, Content-Type application/json.
// No infrastructure: the route reads only injected config, so the db is a stub that throws
// on any touch, and auth is the in-memory fake (never consulted; no bearer is sent).
import { describe, expect, it } from "vitest";
import { createFakeAuthProvider } from "@crossy/auth";
import type { Hono } from "hono";
import { buildApp } from "../app";
import type { ApiEnv } from "../context";
import type { Db } from "../db/client";

const AASA_PATH = "/.well-known/apple-app-site-association";
const APP_ID = "TEAMID1234.com.example.crossy";

// The AASA route holds no database read; any touch is a test failure, not a hang.
const dbStub = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(`AASA suite touched the db (${String(prop)})`);
    },
  },
) as Db;

async function makeApp(appleAppId?: string): Promise<Hono<ApiEnv>> {
  const auth = await createFakeAuthProvider();
  return buildApp({
    db: dbStub,
    authPort: auth,
    sessionWsBase: "wss://session.crossy.test",
    ...(appleAppId !== undefined ? { appleAppId } : {}),
  });
}

describe("GET /.well-known/apple-app-site-association (SP-i4)", () => {
  it("fails closed with 404 when no app identifier is configured", async () => {
    const app = await makeApp();
    const res = await app.request(AASA_PATH);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("fails closed with 404 on an empty app identifier (never publishes a blank appID)", async () => {
    const app = await makeApp("");
    const res = await app.request(AASA_PATH);
    expect(res.status).toBe(404);
  });

  it("serves the modern components format scoped to /g/* when configured", async () => {
    const app = await makeApp(APP_ID);
    const res = await app.request(AASA_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      applinks: {
        details: [{ appIDs: [APP_ID], components: [{ "/": "/g/*" }] }],
      },
    });
  });

  it("answers unauthenticated with Content-Type application/json (Apple's CDN sends no bearer)", async () => {
    // No authorization header on the request: a 401 here would mean auth middleware leaked
    // onto the well-known path.
    const app = await makeApp(APP_ID);
    const res = await app.request(AASA_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("claims only /g/* — no other path component appears in the association", async () => {
    const app = await makeApp(APP_ID);
    const res = await app.request(AASA_PATH);
    const body = (await res.json()) as {
      applinks: { details: { components: Record<string, string>[] }[] };
    };
    const components = body.applinks.details.flatMap((d) => d.components);
    expect(components).toEqual([{ "/": "/g/*" }]);
  });
});
