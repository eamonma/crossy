// Self display identity (`GET /me`, `PATCH /me`; DESIGN.md name-onboarding §7, PROTOCOL.md
// §12). This lives in the identity module (R8): self display identity belongs with the
// module that already owns the `users` row via the JIT mirror and deletion. The API is the
// single writer of `users` (INV-7); this adds a second write path (the name edit) under the
// same writer.
//
// `GET /me` is the self-identity read that works before any game exists (onboarding runs
// before a first join). It returns the raw app-DB `display_name`, which MAY be null for an
// account that has not chosen one, so a client can detect the nameless state and prompt. The
// server computes the trigger (`needsName`), so the client holds no naming policy (R3).
//
// `PATCH /me` is the single write path for the name: it canonicalizes and validates per the
// shared spec (display-name.ts), then updates the one column. A malformed body is 400
// VALIDATION; a well-formed body whose name violates a rule is a named 422 (NAME_REQUIRED /
// NAME_TOO_LONG / NAME_INVALID). Idempotent on the canonical value.
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { schema } from "@crossy/db";
import type { AppDeps, ApiEnv } from "../context";
import { authMiddleware } from "../auth/middleware";
import { fail } from "../http/errors";
import { createRateLimiter, rateLimit } from "../http/rate-limit";
import { canonicalize, validate } from "./display-name";

/**
 * The self display-identity payload, shared by both routes so the client has one decoder and
 * one "adopt this profile" path. `displayName` is the raw app-DB value and may be null on
 * this surface only (the gameplay wire stays non-null; PROTOCOL.md §4). `needsName` is the
 * server-computed onboarding trigger, `!isAnonymous && displayName === null`.
 */
export interface MePayload {
  readonly userId: string;
  readonly displayName: string | null;
  readonly isAnonymous: boolean;
  readonly avatarUrl: string | null;
  readonly needsName: boolean;
}

/** SELECT the caller's display identity from `users` and shape the `/me` payload. The row
 * always exists: authMiddleware ran jitUpsertUser first, so there is no not-found here. */
async function readMe(deps: AppDeps, userId: string): Promise<MePayload> {
  const rows = await deps.db
    .select({
      displayName: schema.users.displayName,
      isAnonymous: schema.users.isAnonymous,
      avatar: schema.users.avatar,
    })
    .from(schema.users)
    .where(eq(schema.users.userId, userId));
  const row = rows[0];
  const displayName = row?.displayName ?? null;
  const isAnonymous = row?.isAnonymous ?? false;
  return {
    userId,
    displayName,
    isAnonymous,
    avatarUrl: row?.avatar ?? null,
    needsName: !isAnonymous && displayName === null,
  };
}

// Name-edit rate limit (DESIGN.md name-onboarding §7.2): 20 writes per 10 minutes per user.
// Names change rarely, so this is generous for a user fiddling in Settings and caps a script.
// Defense in depth behind Cloudflare's edge, the same posture as the join-by-code limiter.
const NAME_WRITE_LIMIT = 20;
const NAME_WRITE_WINDOW_MS = 10 * 60_000;

/** Build the `/me` identity routes: `GET /me` (self read) and `PATCH /me` (name write). */
export function meRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware(deps));

  // GET /me: self display identity. Errors: UNAUTHORIZED only (the row always exists).
  app.get("/", async (c) => {
    const identity = c.get("identity");
    return c.json(await readMe(deps, identity.userId));
  });

  // Keyed on the authenticated user (set by authMiddleware above), the same keying idiom the
  // join limiter uses (games/routes.ts), so a single account cannot hammer the name write.
  const limitNameWrites = rateLimit(
    createRateLimiter({
      limit: NAME_WRITE_LIMIT,
      windowMs: NAME_WRITE_WINDOW_MS,
    }),
    (c) => c.get("identity").userId,
  );

  // PATCH /me: write the caller's own display name. Idempotent on the canonical value.
  app.patch("/", limitNameWrites, async (c) => {
    const identity = c.get("identity");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }
    const raw = (body as { displayName?: unknown }).displayName;
    if (typeof raw !== "string") {
      return fail(
        c,
        "VALIDATION",
        "displayName is required and must be a string",
      );
    }

    const result = validate(canonicalize(raw));
    if (!result.ok) {
      return fail(c, result.code, nameErrorMessage(result.code));
    }

    await deps.db
      .update(schema.users)
      .set({ displayName: result.value })
      .where(eq(schema.users.userId, identity.userId));

    return c.json(await readMe(deps, identity.userId));
  });

  return app;
}

/** A short, stable message for each named name rejection (the client keys on the code). */
function nameErrorMessage(
  code: "NAME_REQUIRED" | "NAME_TOO_LONG" | "NAME_INVALID",
): string {
  switch (code) {
    case "NAME_REQUIRED":
      return "a display name is required";
    case "NAME_TOO_LONG":
      return "display name is too long";
    case "NAME_INVALID":
      return "display name has characters that are not allowed";
  }
}
