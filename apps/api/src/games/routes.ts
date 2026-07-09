// Games module routes (PROTOCOL.md §12, DESIGN.md §7, §8). Create (full accounts only),
// join by invite code (any authenticated user, guests included), and the game view. The API
// is the single writer on games, memberships, and game_denylist (INV-7); it never touches the
// session-owned game_state or cell_events, so the live board is not part of this view (it
// arrives on the WebSocket `welcome`, PROTOCOL.md §2).
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { schema } from "@crossy/db";
import { toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle, ServerPuzzle } from "@crossy/protocol";
import type { Role } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import { authMiddleware } from "../auth/middleware";
import { generateInviteCode } from "./invite-code";
import { notifyMembership } from "../identity/notify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A game's host row plus the caller's role in it, resolved in one read pair. */
interface GameAccess {
  readonly createdBy: string;
  /** The caller's role, or `null` when the caller is not a member. */
  readonly role: Role | null;
}

/**
 * Load the game and the caller's role. `null` means the game does not exist
 * (`GAME_NOT_FOUND`). Host-only actions (kick, abandon) check `role === "host"` against the
 * authoritative membership row, so a succession-promoted host is recognized (DESIGN.md §7),
 * not `games.created_by`, which stays the historical creator.
 */
async function loadGameAccess(
  db: Db,
  gameId: string,
  userId: string,
): Promise<GameAccess | null> {
  const game = await db
    .select({ createdBy: schema.games.createdBy })
    .from(schema.games)
    .where(eq(schema.games.gameId, gameId))
    .limit(1);
  if (game.length === 0) return null;
  const membership = await db
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.gameId, gameId),
        eq(schema.memberships.userId, userId),
      ),
    )
    .limit(1);
  return { createdBy: game[0]!.createdBy, role: membership[0]?.role ?? null };
}

/** The `GET /games/{id}` view. `puzzle` is `ClientPuzzle`: solution-stripped by type (INV-6). */
interface GameView {
  readonly gameId: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly puzzle: ClientPuzzle;
  readonly members: readonly {
    readonly userId: string;
    readonly role: Role;
    readonly joinedAt: string;
  }[];
  readonly session: { readonly ws: string };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

/**
 * Create a game and its host membership in one transaction, retrying on the rare invite-code
 * collision. The API does NOT create the game_state row: game_state is session-owned, and the
 * actor materializes it on first connect (DESIGN.md §6, §9). INV-7 holds structurally, since a
 * `crossy_api`-role connection has no grant to write game_state at all.
 */
async function createGameWithHost(
  db: Db,
  puzzleId: string,
  puzzleSnapshot: unknown,
  createdBy: string,
): Promise<{ gameId: string; inviteCode: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      return await db.transaction(async (tx) => {
        const game = await tx
          .insert(schema.games)
          .values({ puzzleId, puzzleSnapshot, inviteCode, createdBy })
          .returning({ gameId: schema.games.gameId });
        const gameId = game[0]!.gameId;
        await tx
          .insert(schema.memberships)
          .values({ gameId, userId: createdBy, role: "host" });
        return { gameId, inviteCode };
      });
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 4) continue;
      throw err;
    }
  }
  throw new Error("could not allocate a unique invite code");
}

export function gameRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware(deps));

  // POST /games: create a game from a puzzle. Full accounts only (DESIGN.md §8).
  app.post("/", async (c) => {
    const identity = c.get("identity");
    if (identity.isAnonymous) {
      return fail(
        c,
        "FULL_ACCOUNT_REQUIRED",
        "creating a game requires a full account",
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }
    const puzzleId = (body as { puzzleId?: unknown }).puzzleId;
    if (typeof puzzleId !== "string" || !UUID.test(puzzleId)) {
      return fail(c, "VALIDATION", "puzzleId is required");
    }

    const found = await deps.db
      .select({ data: schema.puzzles.data })
      .from(schema.puzzles)
      .where(eq(schema.puzzles.puzzleId, puzzleId))
      .limit(1);
    if (found.length === 0) {
      return fail(c, "PUZZLE_NOT_FOUND", "no such puzzle");
    }

    const created = await createGameWithHost(
      deps.db,
      puzzleId,
      found[0]!.data,
      identity.userId,
    );
    return c.json(
      {
        gameId: created.gameId,
        inviteCode: created.inviteCode,
        puzzleId,
        createdBy: identity.userId,
        role: "host" satisfies Role,
      },
      201,
    );
  });

  // POST /games/{id}/join: join by invite code. Any authenticated user, guests included.
  app.post("/:id/join", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }
    const code = (body as { code?: unknown }).code;
    if (typeof code !== "string") {
      return fail(c, "VALIDATION", "code is required");
    }

    const found = await deps.db
      .select({ inviteCode: schema.games.inviteCode })
      .from(schema.games)
      .where(eq(schema.games.gameId, gameId))
      .limit(1);
    if (found.length === 0) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }
    // The code is the capability; a mismatch is a forbidden join, not a 404 (which would
    // leak game existence to a probe that lacks the link).
    if (found[0]!.inviteCode !== code) {
      return fail(c, "DENIED", "invalid invite code");
    }

    // The denylist is checked at join (DESIGN.md §7): a kicked user still holds the link.
    const denied = await deps.db
      .select({ userId: schema.gameDenylist.userId })
      .from(schema.gameDenylist)
      .where(
        and(
          eq(schema.gameDenylist.gameId, gameId),
          eq(schema.gameDenylist.userId, identity.userId),
        ),
      )
      .limit(1);
    if (denied.length > 0) {
      return fail(c, "DENIED", "removed from this game");
    }

    // Join lands you as a spectator (DESIGN.md §8). Idempotent and non-demoting: a re-join
    // by an existing host or solver keeps their role (DESIGN.md §8: join is an upsert).
    await deps.db
      .insert(schema.memberships)
      .values({ gameId, userId: identity.userId, role: "spectator" })
      .onConflictDoNothing({
        target: [schema.memberships.gameId, schema.memberships.userId],
      });

    const membership = await deps.db
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.gameId, gameId),
          eq(schema.memberships.userId, identity.userId),
        ),
      )
      .limit(1);

    return c.json({
      gameId,
      userId: identity.userId,
      role: membership[0]!.role,
    });
  });

  // GET /games/{id}: the game view: solution-stripped puzzle, membership, session endpoint.
  app.get("/:id", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }

    const found = await deps.db
      .select({
        gameId: schema.games.gameId,
        puzzleSnapshot: schema.games.puzzleSnapshot,
        createdBy: schema.games.createdBy,
        createdAt: schema.games.createdAt,
      })
      .from(schema.games)
      .where(eq(schema.games.gameId, gameId))
      .limit(1);
    if (found.length === 0) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }
    const game = found[0]!;

    const members = await deps.db
      .select({
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        joinedAt: schema.memberships.joinedAt,
      })
      .from(schema.memberships)
      .where(eq(schema.memberships.gameId, gameId));

    if (!members.some((m) => m.userId === identity.userId)) {
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }

    // INV-6: project the server snapshot to its client shape. `puzzle` is typed
    // `ClientPuzzle`, so no solution can be attached; the type is the guarantee, not a strip.
    const puzzle: ClientPuzzle = toClientPuzzle(
      game.puzzleSnapshot as ServerPuzzle,
    );

    const view: GameView = {
      gameId: game.gameId,
      createdBy: game.createdBy,
      createdAt: game.createdAt.toISOString(),
      puzzle,
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt.toISOString(),
      })),
      session: { ws: `${deps.sessionWsBase}/games/${game.gameId}/ws` },
    };
    return c.json(view);
  });

  // POST /games/{id}/role: self-upgrade spectator to solver (PROTOCOL.md §12, DESIGN.md §8).
  // One action, idempotent: a solver or host re-calling it is a no-op that returns the current
  // role. The only transition is spectator -> solver; any other target role is a VALIDATION.
  app.post("/:id/role", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");

    // Body is optional; when present it may only ask for `solver` (the sole upgrade).
    let requested: unknown = "solver";
    const raw = await c.req.text();
    if (raw.length > 0) {
      try {
        requested = (JSON.parse(raw) as { role?: unknown }).role ?? "solver";
      } catch {
        return fail(c, "VALIDATION", "request body must be JSON");
      }
    }
    if (requested !== "solver") {
      return fail(c, "VALIDATION", "only an upgrade to solver is supported");
    }

    const access = await loadGameAccess(deps.db, gameId, identity.userId);
    if (access === null) return fail(c, "GAME_NOT_FOUND", "no such game");
    if (access.role === null) {
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }

    // Idempotent: only a spectator is promoted; solver and host are already at or above solver.
    if (access.role === "spectator") {
      await deps.db
        .update(schema.memberships)
        .set({ role: "solver" })
        .where(
          and(
            eq(schema.memberships.gameId, gameId),
            eq(schema.memberships.userId, identity.userId),
          ),
        );
      // A live spectator socket becomes a solver on re-verify (best-effort; the DB row is
      // authoritative and a reconnect reads the new role regardless).
      await notifyMembership(deps, gameId, {
        change: "role",
        userId: identity.userId,
      });
      return c.json({ gameId, userId: identity.userId, role: "solver" });
    }
    return c.json({ gameId, userId: identity.userId, role: access.role });
  });

  // DELETE /games/{id}/members/{userId}: kick (PROTOCOL.md §12, DESIGN.md §7). Host only; the
  // host MUST NOT target themselves. The removal and the denylist write are ONE transaction, so
  // a kicked user never lands in the half-state of "no membership yet not denied" (which would
  // read as NOT_PARTICIPANT instead of the informative DENIED). The API is the single writer on
  // memberships and the denylist (INV-7); the session only verifies (INV-8).
  app.delete("/:id/members/:userId", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    const targetId = c.req.param("userId");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");
    if (!UUID.test(targetId)) {
      return fail(
        c,
        "NOT_PARTICIPANT",
        "that user is not a member of this game",
      );
    }

    const access = await loadGameAccess(deps.db, gameId, identity.userId);
    if (access === null) return fail(c, "GAME_NOT_FOUND", "no such game");
    if (access.role === null) {
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }
    if (access.role !== "host") {
      return fail(c, "FORBIDDEN", "only the host can remove members");
    }
    if (targetId === identity.userId) {
      // DESIGN.md §7: the host cannot kick themselves; succession is the account-deletion path.
      return fail(c, "FORBIDDEN", "the host cannot remove themselves");
    }

    const target = await deps.db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.gameId, gameId),
          eq(schema.memberships.userId, targetId),
        ),
      )
      .limit(1);
    if (target.length === 0) {
      return fail(
        c,
        "NOT_PARTICIPANT",
        "that user is not a member of this game",
      );
    }

    // One transaction: drop the membership row and write the denylist (DESIGN.md §7).
    await deps.db.transaction(async (tx) => {
      await tx
        .delete(schema.memberships)
        .where(
          and(
            eq(schema.memberships.gameId, gameId),
            eq(schema.memberships.userId, targetId),
          ),
        );
      await tx
        .insert(schema.gameDenylist)
        .values({ gameId, userId: targetId })
        .onConflictDoNothing({
          target: [schema.gameDenylist.gameId, schema.gameDenylist.userId],
        });
    });

    // Disconnect a live socket now (best-effort). Even if this never lands, the denylist row
    // refuses the kicked user at their next connect (DENIED, PROTOCOL.md §2).
    await notifyMembership(deps, gameId, { change: "kick", userId: targetId });
    return c.json({ gameId, removed: targetId });
  });

  // POST /games/{id}/abandon: terminal state, executed via the session service (PROTOCOL.md
  // §12, DESIGN.md §6, §7). Host only. The API only authorizes; the actor emits and
  // synchronously flushes `gameAbandoned`, hydrating on demand if the game is passivated, and
  // no-ops if the game is already terminal (INV-4). Because only the actor can write game_state,
  // the notify is required: a failed delivery is a fault, not a degraded success.
  app.post("/:id/abandon", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");

    const access = await loadGameAccess(deps.db, gameId, identity.userId);
    if (access === null) return fail(c, "GAME_NOT_FOUND", "no such game");
    if (access.role === null) {
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }
    if (access.role !== "host") {
      return fail(c, "FORBIDDEN", "only the host can abandon the game");
    }

    const delivered = await notifyMembership(deps, gameId, {
      change: "abandon",
      by: identity.userId,
    });
    if (!delivered) {
      return fail(
        c,
        "INTERNAL",
        "could not reach the session service to abandon the game",
      );
    }
    return c.json({ gameId, status: "abandoned" });
  });

  return app;
}
