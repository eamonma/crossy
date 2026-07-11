// Bearer authentication middleware (DESIGN.md §8, PROTOCOL.md §12). Every REST route is
// bearer-authenticated with the same provider tokens the WebSocket uses. Verification goes
// through the injected `AuthPort` only; this file never imports `jose`. On success it mirrors
// the identity into `users` (JIT upsert) and stashes it on the request context.
import { createMiddleware } from "hono/factory";
import type { AppDeps, ApiEnv } from "../context";
import { fail } from "../http/errors";
import { seedStarterGame } from "../starter/seed";
import { jitUpsertUser } from "./jit-upsert";

const BEARER = /^Bearer (.+)$/;

/** Build the auth middleware bound to the app's ports. */
export function authMiddleware(deps: AppDeps) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = BEARER.exec(header);
    if (match === null) {
      return fail(c, "UNAUTHORIZED", "missing or malformed bearer token");
    }
    const result = await deps.authPort.verify(match[1]!);
    if (!result.ok) {
      return fail(c, "UNAUTHORIZED", `token rejected: ${result.reason}`);
    }
    // Materialize the identity mirror before any handler writes a row that references it.
    const mirror = await jitUpsertUser(deps.db, result.identity);
    // First sight of a full account: seed a solo starter game they host, so the signed-in home
    // is never empty (owner decision 2026-07-11). Guests are excluded, they cannot hold host
    // (DESIGN.md §8). Best effort: a seed failure logs and is swallowed so it never blocks auth.
    if (
      deps.starterSeedEnabled &&
      mirror.created &&
      !result.identity.isAnonymous
    ) {
      try {
        await seedStarterGame(deps.db, result.identity.userId);
      } catch (err) {
        console.error("starter game seed failed:", err);
      }
    }
    c.set("identity", result.identity);
    await next();
  });
}
