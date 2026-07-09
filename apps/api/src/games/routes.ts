// Games module routes (PROTOCOL.md §12, DESIGN.md §7, §8). Create (full accounts only),
// join by invite code (any authenticated user, guests included), and the game view. The API
// is the single writer on games, memberships, and game_denylist (INV-7); it never touches the
// session-owned game_state or cell_events, so the live board is not part of this view (it
// arrives on the WebSocket `welcome`, PROTOCOL.md §2).
import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import { toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle, ServerPuzzle } from "@crossy/protocol";
import type { Role } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import { parseBefore, parseLimit } from "../http/pagination";
import { authMiddleware } from "../auth/middleware";
import { generateInviteCode } from "./invite-code";
import { notifyMembership } from "../identity/notify";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cap on a game's display name. 80 characters is generous for a room label ("Sunday
 * themeless with the crew") while bounding the column; an over-long name is capped here, not
 * refused (see `normalizeGameName`).
 */
const MAX_GAME_NAME = 80;

/**
 * Validate the optional `name` on game creation. The name is user content shown back verbatim
 * and is never normalized or compared, so the ASCII-only casing rule (INV-1) deliberately does
 * NOT apply: no lowercasing, no locale folding, the string is preserved as typed apart from a
 * whitespace trim. Absent, null, or empty-after-trim all mean "unnamed" (null). The only
 * rejection is a present value that is not a string; an over-long name is capped, not refused.
 */
function normalizeGameName(
  raw: unknown,
): { ok: true; name: string | null } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, name: null };
  if (typeof raw !== "string") return { ok: false };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, name: null };
  return { ok: true, name: trimmed.slice(0, MAX_GAME_NAME) };
}

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
  /** Optional room display name (user content); null for an unnamed game. INV-6-safe. */
  readonly name: string | null;
  /**
   * The invite code, returned only to members. Every member joined via this code, so it is
   * not a secret from them; the field is populated after the membership check below, so a
   * non-member (NOT_PARTICIPANT) or an unauthenticated caller (UNAUTHORIZED) never sees it.
   */
  readonly inviteCode: string;
  readonly puzzle: ClientPuzzle;
  readonly members: readonly {
    readonly userId: string;
    readonly role: Role;
    readonly joinedAt: string;
  }[];
  readonly session: { readonly ws: string };
}

/**
 * One row of `GET /games`: a game the caller is a member of, for the signed-in home list.
 *
 * Deliberately NO `status` field. A game's lifecycle status (ongoing, completed, abandoned)
 * lives in `game_state`, which is session-owned; the API holds no read grant on it (DESIGN.md
 * §7, §9), so it cannot honestly report completion from its own tables. Inventing an "ongoing"
 * status here would be a lie for every completed or abandoned game. When the Archive module's
 * planned read grant on `game_state` lands (DESIGN.md §9), a `status` field can be added
 * additively. For the same reason ordering is by `createdAt`, not true last-move activity,
 * which also lives in `game_state`.
 *
 * `puzzle` carries only INV-6-safe geometry (rows, cols) projected out of `puzzle_snapshot` in
 * SQL; the snapshot jsonb, which holds the solution, is never selected whole.
 */
interface GameSummary {
  readonly gameId: string;
  /** Optional room display name (user content); null for an unnamed game. */
  readonly name: string | null;
  /** The caller's own role in this game. */
  readonly role: Role;
  readonly createdAt: string;
  readonly createdBy: string;
  /** Total members (all roles), for the list card. */
  readonly memberCount: number;
  readonly puzzle: {
    readonly puzzleId: string;
    readonly rows: number;
    readonly cols: number;
  };
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
  name: string | null,
): Promise<{ gameId: string; inviteCode: string; name: string | null }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const inviteCode = generateInviteCode();
    try {
      return await db.transaction(async (tx) => {
        const game = await tx
          .insert(schema.games)
          .values({ puzzleId, puzzleSnapshot, inviteCode, createdBy, name })
          .returning({ gameId: schema.games.gameId });
        const gameId = game[0]!.gameId;
        await tx
          .insert(schema.memberships)
          .values({ gameId, userId: createdBy, role: "host" });
        return { gameId, inviteCode, name };
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
    // Optional display name: absent/null/empty is unnamed; a non-string is the only rejection.
    const nameResult = normalizeGameName((body as { name?: unknown }).name);
    if (!nameResult.ok) {
      return fail(c, "VALIDATION", "name must be a string");
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
      nameResult.name,
    );
    return c.json(
      {
        gameId: created.gameId,
        inviteCode: created.inviteCode,
        puzzleId,
        name: created.name,
        createdBy: identity.userId,
        role: "host" satisfies Role,
      },
      201,
    );
  });

  // GET /games: the caller's games, newest first. Visibility is the membership join
  // (`WHERE user_id = caller`), so a caller sees exactly the games they belong to and no
  // others; a game leaks to no one who is not a member. Any authenticated user, guests
  // included: a guest is a real member of games they joined (DESIGN.md §8), so this is not
  // gated to full accounts. Cursor pagination by `createdAt` (see GameSummary for why status
  // and activity ordering are out of reach here).
  app.get("/", async (c) => {
    const identity = c.get("identity");

    const limit = parseLimit(c.req.query("limit"));
    const beforeResult = parseBefore(c.req.query("before"));
    if (!beforeResult.ok) {
      return fail(c, "VALIDATION", "before must be an ISO 8601 timestamp");
    }
    const before = beforeResult.before;

    // INV-6: geometry is projected out of `puzzle_snapshot` in SQL (`->> 'rows'`/`'cols'`),
    // so the solution-bearing jsonb never enters the process. `memberCount` is a correlated
    // count, not a select-all of memberships. Order and cursor are both `createdAt`, with
    // `gameId` as a deterministic tiebreaker for rows sharing a timestamp.
    const rows = await deps.db
      .select({
        gameId: schema.games.gameId,
        name: schema.games.name,
        createdAt: schema.games.createdAt,
        createdBy: schema.games.createdBy,
        puzzleId: schema.games.puzzleId,
        role: schema.memberships.role,
        puzzleRows: sql<number>`(${schema.games.puzzleSnapshot} ->> 'rows')::int`,
        puzzleCols: sql<number>`(${schema.games.puzzleSnapshot} ->> 'cols')::int`,
        memberCount: sql<number>`(select count(*)::int from "memberships" mc where mc."game_id" = ${schema.games.gameId})`,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.games,
        eq(schema.games.gameId, schema.memberships.gameId),
      )
      .where(
        and(
          eq(schema.memberships.userId, identity.userId),
          before === null ? undefined : lt(schema.games.createdAt, before),
        ),
      )
      .orderBy(desc(schema.games.createdAt), desc(schema.games.gameId))
      .limit(limit);

    const games: GameSummary[] = rows.map((r) => ({
      gameId: r.gameId,
      name: r.name,
      role: r.role,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      memberCount: r.memberCount,
      puzzle: { puzzleId: r.puzzleId, rows: r.puzzleRows, cols: r.puzzleCols },
    }));
    return c.json({ games });
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
        name: schema.games.name,
        inviteCode: schema.games.inviteCode,
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

    // Membership gate: everything below is member-only. The invite code is added to the view
    // only past this point, so a non-member never receives it (they get NOT_PARTICIPANT here,
    // and an unauthenticated caller was already stopped by authMiddleware). Any role qualifies,
    // spectators included: every member joined via the code, so it is not a secret from them.
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
      name: game.name,
      inviteCode: game.inviteCode,
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
