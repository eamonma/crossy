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
import { canonicalize, validate as validateName } from "./display-name";
import { validate as validateReactionSet } from "./reaction-set";

/**
 * The self display-identity payload, shared by both routes so the client has one decoder and
 * one "adopt this profile" path. `displayName` is the raw app-DB value and may be null on
 * this surface only (the gameplay wire stays non-null; PROTOCOL.md §4). `needsName` is the
 * server-computed onboarding trigger, `!isAnonymous && displayName === null`. `reactionSet` is
 * the caller's five reaction emoji in slot order, or null for the default five (PROTOCOL.md §9,
 * §12); null is the state of every account until it configures a set.
 */
export interface MePayload {
  readonly userId: string;
  readonly displayName: string | null;
  readonly isAnonymous: boolean;
  readonly avatarUrl: string | null;
  readonly needsName: boolean;
  readonly reactionSet: readonly string[] | null;
}

/** SELECT the caller's display identity from `users` and shape the `/me` payload. The row
 * always exists: authMiddleware ran jitUpsertUser first, so there is no not-found here. */
async function readMe(deps: AppDeps, userId: string): Promise<MePayload> {
  const rows = await deps.db
    .select({
      displayName: schema.users.displayName,
      isAnonymous: schema.users.isAnonymous,
      avatar: schema.users.avatar,
      reactionSet: schema.users.reactionSet,
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
    reactionSet: row?.reactionSet ?? null,
  };
}

// Profile-edit rate limit (DESIGN.md name-onboarding §7.2): 20 writes per 10 minutes per user. The
// one limiter covers the whole `PATCH /me` profile patch (name and reaction set); both change rarely,
// so this is generous for a user fiddling in Settings and caps a script. Defense in depth behind
// Cloudflare's edge, the same posture as the join-by-code limiter.
const PROFILE_WRITE_LIMIT = 20;
const PROFILE_WRITE_WINDOW_MS = 10 * 60_000;

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
  // join limiter uses (games/routes.ts), so a single account cannot hammer the profile write.
  const limitProfileWrites = rateLimit(
    createRateLimiter({
      limit: PROFILE_WRITE_LIMIT,
      windowMs: PROFILE_WRITE_WINDOW_MS,
    }),
    (c) => c.get("identity").userId,
  );

  // PATCH /me: a partial profile patch, `{ displayName?, reactionSet? }`. Each present field
  // validates and writes independently; an absent field is untouched. A body with neither field is
  // 400 VALIDATION (nothing to patch). Wrong field types are the 400 VALIDATION lane; a well-formed
  // field that violates a domain rule is its named 422. The name path is byte-for-byte the prior
  // behavior (canonicalize + validate, idempotent on the canonical value).
  app.patch("/", limitProfileWrites, async (c) => {
    const identity = c.get("identity");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }
    if (typeof body !== "object" || body === null) {
      return fail(c, "VALIDATION", "request body must be a JSON object");
    }

    const patch = body as { displayName?: unknown; reactionSet?: unknown };
    const hasDisplayName = "displayName" in patch;
    const hasReactionSet = "reactionSet" in patch;
    if (!hasDisplayName && !hasReactionSet) {
      return fail(c, "VALIDATION", "provide displayName or reactionSet");
    }

    // Build the update column-set from the present fields, validating each independently. Both
    // validations run before any write, so a rejected field never lands a partial write.
    const update: { displayName?: string; reactionSet?: string[] | null } = {};

    if (hasDisplayName) {
      const raw = patch.displayName;
      if (typeof raw !== "string") {
        return fail(c, "VALIDATION", "displayName must be a string");
      }
      const result = validateName(canonicalize(raw));
      if (!result.ok) {
        return fail(c, result.code, nameErrorMessage(result.code));
      }
      update.displayName = result.value;
    }

    if (hasReactionSet) {
      const parsed = asReactionSetInput(patch.reactionSet);
      if (!parsed.ok) return fail(c, "VALIDATION", parsed.message);
      const result = validateReactionSet(parsed.value);
      if (!result.ok) {
        return fail(c, result.code, reactionSetErrorMessage(result.code));
      }
      // Byte-exact: the validated graphemes are stored as given, never normalized. null resets to
      // the defaults (the column back to null); a set is copied into a mutable array for the column.
      update.reactionSet = result.value === null ? null : [...result.value];
    }

    await deps.db
      .update(schema.users)
      .set(update)
      .where(eq(schema.users.userId, identity.userId));

    return c.json(await readMe(deps, identity.userId));
  });

  return app;
}

/**
 * Narrow a raw `reactionSet` patch field to the shape `validate` accepts (null or a string array),
 * or fail into the 400 VALIDATION lane. This is the wire-type guard, kept out of the domain validator
 * exactly as the display-name path keeps its `typeof raw !== "string"` check in the route: a value
 * that is neither null nor an array of strings is a malformed body, not a named 422.
 */
function asReactionSetInput(
  raw: unknown,
):
  | { readonly ok: true; readonly value: readonly string[] | null }
  | { readonly ok: false; readonly message: string } {
  const message = "reactionSet must be null or an array of strings";
  if (raw === null) return { ok: true, value: null };
  if (!Array.isArray(raw) || !raw.every((e) => typeof e === "string")) {
    return { ok: false, message };
  }
  return { ok: true, value: raw as string[] };
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

/** A short, stable message for each named reaction-set rejection (the client keys on the code). */
function reactionSetErrorMessage(
  code:
    "REACTION_SET_LENGTH" | "REACTION_SET_INVALID" | "REACTION_SET_DUPLICATE",
): string {
  switch (code) {
    case "REACTION_SET_LENGTH":
      return "a reaction set must have exactly five emoji";
    case "REACTION_SET_INVALID":
      return "each reaction must be a single emoji";
    case "REACTION_SET_DUPLICATE":
      return "reaction emoji must be distinct";
  }
}
