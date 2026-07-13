// Games module routes (PROTOCOL.md §12, DESIGN.md §7, §8). Create (full accounts only),
// join by invite code (any authenticated user, guests included), and the game view. The API
// is the single writer on games, memberships, and game_denylist (INV-7); it never WRITES the
// session-owned game_state or cell_events. It does hold a SELECT-only read grant on game_state
// (migration 0005), used by `GET /games` to report a game's completion (`completed_at`), a read
// of durable session-owned state that leaves single-writer intact (INV-7 governs writes). The
// live board is still not part of any view here: it arrives on the WebSocket `welcome`
// (PROTOCOL.md §2), and this module never selects the board column.
import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import { deriveMask, toClientPuzzle } from "@crossy/protocol";
import type { ClientPuzzle, Mask, ServerPuzzle } from "@crossy/protocol";
import type { Role } from "@crossy/protocol";
import type { AppDeps, ApiEnv } from "../context";
import type { Db } from "../db/client";
import { fail } from "../http/errors";
import { parseBefore, parseLimit } from "../http/pagination";
import { createRateLimiter, rateLimit } from "../http/rate-limit";
import { authMiddleware } from "../auth/middleware";
import { createGameWithHost } from "./create";
import { findGameByInviteCode } from "./lookup";
import {
  notifyLiveActivityRegistered,
  notifyMembership,
} from "../identity/notify";
import { gameAnalysis } from "../archive/analysis";

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

/**
 * The wire fallback for a member whose mirror row holds no display name (DESIGN.md §8): the
 * same string the session's participant payload sends (apps/session/src/server.ts), so the REST
 * member stack and the live roster read one value and cannot drift (PROTOCOL.md §4, §12).
 */
const FORMER_PARTICIPANT = "former participant";

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

/** The outcome of a join: refused by the denylist, or seated with the resulting role. */
type SeatResult =
  { readonly denied: true } | { readonly denied: false; readonly role: Role };

/**
 * Seat a caller in a game whose existence the caller already proved (by id + code, or by
 * resolving the invite code). This is the shared tail of both join paths, so join-by-id and
 * join-by-code have byte-identical semantics: the denylist is checked first and refuses a kicked
 * user with DENIED before any seat (DESIGN.md §7).
 *
 * A genuinely NEW membership seats a full account directly as `solver`, so a joiner can play at
 * once, and a guest as `spectator` (owner decision 2026-07-10; DESIGN.md §7, §8). Guests never
 * hold solver or host (owner decision 2026-07-09), so a guest keeps the one-tap upgrade path
 * (POST /games/{id}/role, refused FULL_ACCOUNT_REQUIRED for guests). The seat is an idempotent,
 * non-demoting upsert (`onConflictDoNothing`), so an EXISTING member keeps their role: a re-join
 * by a host or solver stays as-is, and a pre-existing spectator stays spectator (and still
 * upgrades via the self-upgrade endpoint). Only a new row gets the role-by-account seating. No
 * session notify: a fresh join has no live socket to update (unlike a role change or kick); the
 * joiner connects afterward and the session reads authoritative membership on `hello`.
 */
async function seatJoiner(
  db: Db,
  gameId: string,
  userId: string,
  isAnonymous: boolean,
): Promise<SeatResult> {
  const denied = await db
    .select({ userId: schema.gameDenylist.userId })
    .from(schema.gameDenylist)
    .where(
      and(
        eq(schema.gameDenylist.gameId, gameId),
        eq(schema.gameDenylist.userId, userId),
      ),
    )
    .limit(1);
  if (denied.length > 0) return { denied: true };

  // Full account seats solver (play at once); guest seats spectator (upgrade path). Existing
  // members keep their role via onConflictDoNothing (DESIGN.md §7, §8; owner decision 2026-07-10).
  const seatRole: Role = isAnonymous ? "spectator" : "solver";
  await db
    .insert(schema.memberships)
    .values({ gameId, userId, role: seatRole })
    .onConflictDoNothing({
      target: [schema.memberships.gameId, schema.memberships.userId],
    });

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
  return { denied: false, role: membership[0]!.role };
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
    /**
     * The opaque nullable avatar URL (PROTOCOL.md §4, §12): the same value the API resolved into
     * `users.avatar` and the session reads for the WebSocket participant payload, so the REST view
     * and the live roster cannot drift. Never an email; no client can derive one (INV-6 spirit).
     */
    readonly avatarUrl: string | null;
  }[];
  readonly session: { readonly ws: string };
}

/**
 * One row of `GET /games`: a game the caller is a member of, for the signed-in home list.
 *
 * `completedAt` reports completion, and only completion. It is the `game_state.completed_at`
 * timestamp, null while the game is ongoing (and null for an abandoned game, which never
 * completed). `game_state` is session-owned, but the API now holds a SELECT-only read grant on it
 * (migration 0005, the planned read expand DESIGN.md §9 records), so it reads this one fact
 * without ever writing the table: the session stays the single writer (INV-7 governs writes, not
 * reads). This is a read of the durable terminal timestamp, not a lifecycle claim the API owns:
 * a full `status` enum (ongoing/completed/abandoned) is a later additive extension, but the one
 * fact the home needs today is "is this game done", which `completed_at` answers directly. A
 * game with no `game_state` row yet (created but never connected, so the actor has not
 * materialized it) reads as ongoing, `completedAt` null, via the left join.
 *
 * `lastActivityAt` is `MAX(cell_events.at)` for the game, read from the session-owned event log
 * under the API's SELECT-only grant (migration 0008); it is null for a game no one has played. The
 * page is ORDERED by `COALESCE(lastActivityAt, createdAt)` DESC (creating a room is its first
 * activity, so a fresh unplayed game sorts by its creation time, not below every played game), so
 * the home reads by when a room was last touched, not by creation. The read is a bare timestamp
 * aggregate, never a cell `value`, so no solution leaves the server (INV-6), and it is read only,
 * so the session stays the single writer (INV-7). The page is still SELECTED and paginated by
 * `createdAt` (see the handler): activity moves, so ordering the whole paginated set by it would be
 * unstable; the stable `createdAt` cursor bounds the page and the coalesced key reorders only the
 * rows within it (PROTOCOL.md §12).
 *
 * `puzzle` carries only INV-6-safe geometry (rows, cols) projected out of `puzzle_snapshot` in
 * SQL; the snapshot jsonb, which holds the solution, is never selected whole. `puzzle.title` is
 * the puzzle's display title, read from the `puzzles` row (joined on `puzzle_id`, never from the
 * solution-bearing snapshot), null when the puzzle has none; it is display content, not a
 * solution (INV-6 untouched). `puzzle.mask` is the black-square silhouette (PROTOCOL.md §12),
 * derived from the block indices projected out of the snapshot (`-> 'blocks'`, a jsonb array of
 * integers); it carries the pattern only, no letters or numbering, so INV-6 stays intact. No
 * solution ever rides `completed_at`, a bare timestamp, so INV-6 is untouched there too.
 */
interface GameSummary {
  readonly gameId: string;
  /** Optional room display name (user content); null for an unnamed game. */
  readonly name: string | null;
  /** The caller's own role in this game. */
  readonly role: Role;
  readonly createdAt: string;
  readonly createdBy: string;
  /** Total members (all roles), for the list card; equals `members.length`. */
  readonly memberCount: number;
  /**
   * The full membership as display identity (PROTOCOL.md §12), ordered by join time ascending
   * (the first joiner leads, ties by userId), so the order is total and deterministic and a
   * client can open the room chrome or paint the card's avatar stack true without a second
   * fetch. `name` is the §4 display name resolved at the identity mirror, never null on the
   * wire (a null mirror reads as the same "former participant" the session sends, DESIGN.md
   * §8); `avatarUrl` is the same opaque nullable field as §4, never an email (INV-6 spirit);
   * `role` carries the solvers/spectators fact (a guest seats spectator; no guest flag on the
   * wire), so clients can apply the standing solvers-only display filters.
   */
  readonly members: readonly GameSummaryMember[];
  /**
   * The game's invite code, on every row under exactly the game view's rule (PROTOCOL.md §12):
   * members only, any role, since every member joined via it. The list is member-scoped by
   * construction (the membership join below), so a row structurally cannot reach a non-member
   * and the code never travels wider than `GET /games/{id}` already sends it.
   */
  readonly inviteCode: string;
  /**
   * When the game completed (the derived-timer end anchor, DESIGN.md §2), null while ongoing and
   * null for an abandoned game. Read from the session-owned `game_state` under the API's SELECT
   * grant (migration 0005); never written by the API (INV-7).
   */
  readonly completedAt: string | null;
  /**
   * When a host ended the game (`game_state.abandoned_at`, DESIGN.md §6), null unless it was
   * abandoned. The twin terminal timestamp to `completedAt`, and mutually exclusive with it: a
   * terminal game is completed or abandoned, never both (INV-4). A non-null value is the fact a
   * client shelves an ended game on, out of the live shelf it would otherwise sit in (both
   * timestamps null reads ongoing). Read from the session-owned `game_state` under the API's SELECT
   * grant (migration 0005), a bare timestamp so INV-6 is untouched; never written by the API (INV-7).
   */
  readonly abandonedAt: string | null;
  /**
   * The game's last activity: `MAX(cell_events.at)` (PROTOCOL.md §12), null for a game no one has
   * played yet. Read from the session-owned event log under the API's SELECT-only grant (migration
   * 0008); never written by the API (INV-7). The list page is ordered by `COALESCE(lastActivityAt,
   * createdAt)` DESC, so an unplayed game sorts by its creation time (creating a room is its first
   * activity), not below every played game. It is a bare timestamp aggregate, never a cell value,
   * so no solution leaves the server (INV-6).
   */
  readonly lastActivityAt: string | null;
  readonly puzzle: {
    readonly puzzleId: string;
    readonly rows: number;
    readonly cols: number;
    /** The puzzle's display title, null when it carried none. Display content, not a solution. */
    readonly title: string | null;
    /** The black-square silhouette, pattern only (PROTOCOL.md §12). No solution content. */
    readonly mask: Mask;
  };
}

/** One member on a `GET /games` row: display identity only (PROTOCOL.md §12). */
interface GameSummaryMember {
  readonly userId: string;
  /** The resolved §4 display name; never null on the wire (the tombstone fallback applies). */
  readonly name: string;
  /** The opaque nullable avatar URL (PROTOCOL.md §4, §12); never an email (INV-6 spirit). */
  readonly avatarUrl: string | null;
  readonly role: Role;
}

/**
 * Order one page of `GET /games` rows by when the game was last touched, most recent first
 * (PROTOCOL.md §12). The sort key is `COALESCE(lastActivityAt, createdAt)`: creating a room is its
 * first activity, so a freshly created game with no events yet sorts by its `createdAt`, right
 * where a room played at that same instant would sit, rather than below every played game. Ties on
 * the coalesced key fall back to `createdAt` DESC, then `gameId` DESC. That fallback chain matches
 * the SQL selection tiebreak, so the whole ordering is total and deterministic. Timestamps are ISO
 * 8601 UTC strings; compared by parsed epoch so a differing fractional-second precision cannot
 * mis-sort (a lexicographic compare would). The wire shape is unchanged: `lastActivityAt` stays
 * null for an unplayed game, and only this ordering coalesces it to `createdAt`.
 *
 * This reorders only the rows already SELECTED into the page by the stable `createdAt` cursor, so
 * it never touches pagination continuity: the moving activity key reshuffles within a page but
 * cannot move a game across page boundaries (PROTOCOL.md §12).
 */
function orderByActivity(a: GameSummary, b: GameSummary): number {
  // COALESCE(lastActivityAt, createdAt): a never-played game keys on its creation time.
  const keyA = Date.parse(a.lastActivityAt ?? a.createdAt);
  const keyB = Date.parse(b.lastActivityAt ?? b.createdAt);
  if (keyA !== keyB) return keyB - keyA; // more recently touched first
  // Tie on the coalesced key: fall back to createdAt DESC, then gameId DESC.
  const createdA = Date.parse(a.createdAt);
  const createdB = Date.parse(b.createdAt);
  if (createdA !== createdB) return createdB - createdA;
  return a.gameId < b.gameId ? 1 : a.gameId > b.gameId ? -1 : 0;
}

/**
 * Join-by-code rate limit (defense in depth; Cloudflare's edge rules are the primary limiter). A
 * user may make `JOIN_LIMIT_PER_WINDOW` join attempts per `JOIN_WINDOW_MS` across both join
 * endpoints combined. Generous by design: the code space is 32^8 and joins are authenticated, so
 * this caps flood and the valid-vs-invalid oracle, not brute force (PROTOCOL.md §12).
 */
const JOIN_LIMIT_PER_WINDOW = 30;
const JOIN_WINDOW_MS = 60_000;

export function gameRoutes(deps: AppDeps): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use("*", authMiddleware(deps));

  // One limiter shared by both join endpoints, keyed by the authenticated user, so a single account
  // cannot hammer the invite-code index whichever endpoint it hits. The user is set by
  // authMiddleware above, so it is present in this route-level middleware.
  const limitJoinsByUser = rateLimit(
    createRateLimiter({
      limit: JOIN_LIMIT_PER_WINDOW,
      windowMs: JOIN_WINDOW_MS,
    }),
    (c) => c.get("identity").userId,
  );

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
    // room_created, at the moment the game and its host membership are committed. The
    // creator is the acting member (full account, gated above). Ids only: roomId and
    // puzzleId, never the snapshot, cells, or solution content (INV-6). Fire-and-forget;
    // capture never throws into the handler.
    deps.analytics?.capture({
      distinctId: identity.userId,
      event: "room_created",
      properties: { roomId: created.gameId, puzzleId },
    });
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

  // GET /games: the caller's games, most-recently-active first within the page (PROTOCOL.md §12).
  // Visibility is the membership join (`WHERE user_id = caller`), so a caller sees exactly the
  // games they belong to and no others; a game leaks to no one who is not a member. Any
  // authenticated user, guests included: a guest is a real member of games they joined (DESIGN.md
  // §8), so this is not gated to full accounts.
  //
  // The ordering tension the design resolves (PROTOCOL.md §12): last activity is a MOVING key, so
  // ordering the whole paginated set by it would let a game jump pages between requests. So the
  // page is SELECTED and paginated by the stable `createdAt` DESC cursor (unchanged), and the rows
  // of that page are REORDERED by activity for display. The bounded first page the home shows is
  // fully activity-ordered; deep pagination below the fold stays stable on `createdAt`. Because
  // the shown last row is then not the page's oldest `createdAt`, the response also returns a
  // server-computed `nextBefore` (the page-minimum `createdAt`), the cursor a client MUST page by.
  app.get("/", async (c) => {
    const identity = c.get("identity");

    const limit = parseLimit(c.req.query("limit"));
    const beforeResult = parseBefore(c.req.query("before"));
    if (!beforeResult.ok) {
      return fail(c, "VALIDATION", "before must be an ISO 8601 timestamp");
    }
    const before = beforeResult.before;

    // INV-6: geometry is projected out of `puzzle_snapshot` in SQL (`->> 'rows'`/`'cols'`),
    // so the solution-bearing jsonb never enters the process. `blocks` is the other pattern-only
    // field, projected the same way (`-> 'blocks'`, a jsonb array of integer cell indices) to feed
    // the mask; the mask is derived below (deriveMask), never the solution. The puzzle `title` is
    // read from the joined `puzzles` row (a single named column, never the solution-bearing
    // `data`); the join is on `games.puzzle_id`, which is NOT NULL and ON DELETE RESTRICT, so the
    // inner join drops no game. `memberCount` is a correlated count, not a select-all of
    // memberships.
    // `completedAt` is the session-owned `game_state.completed_at`, read under the API's SELECT
    // grant (migration 0005); it is a LEFT join, so a game whose actor never materialized its
    // `game_state` row (created but never connected) still lists, reading ongoing (completedAt
    // null). Only the one terminal timestamp is selected, never the board or the rest of the row.
    // `lastActivityAt` is `MAX(cell_events.at)` for the game, a correlated subquery under the API's
    // SELECT grant on cell_events (migration 0008); it reads only the timestamp, never a cell
    // `value` (INV-6), and never writes (INV-7). Null for a game with no events.
    // `members` is the row's member stack (PROTOCOL.md §12): one correlated jsonb_agg per row (the
    // memberCount shape, not an N+1 and not a second round trip), joining the API-owned users
    // mirror for the resolved display name and avatar, ordered by join time (first joiner first,
    // ties by user_id) so the order is total and deterministic. It selects display columns only:
    // never an email (the mirror stores none), never solution content (INV-6 untouched).
    // SELECTION order and cursor are `createdAt` DESC (with `gameId` as a deterministic tiebreaker
    // for shared timestamps), which the LIMIT slices into a stable page; the activity reorder for
    // display happens after, in JS, over exactly this page's rows.
    const rows = await deps.db
      .select({
        gameId: schema.games.gameId,
        name: schema.games.name,
        createdAt: schema.games.createdAt,
        createdBy: schema.games.createdBy,
        // Member-only by construction: every selected row is a game the caller belongs to (the
        // membership WHERE below), the exact visibility rule GET /games/{id} applies to its own
        // inviteCode (PROTOCOL.md §12), so this reaches no one the view would refuse.
        inviteCode: schema.games.inviteCode,
        puzzleId: schema.games.puzzleId,
        role: schema.memberships.role,
        puzzleRows: sql<number>`(${schema.games.puzzleSnapshot} ->> 'rows')::int`,
        puzzleCols: sql<number>`(${schema.games.puzzleSnapshot} ->> 'cols')::int`,
        puzzleBlocks: sql<number[]>`${schema.games.puzzleSnapshot} -> 'blocks'`,
        puzzleTitle: schema.puzzles.title,
        completedAt: schema.gameState.completedAt,
        // The twin terminal timestamp, read from the same session-owned game_state row under the
        // same SELECT grant (migration 0005): null unless a host ended the game, and mutually
        // exclusive with completed_at (INV-4). Only the two terminal timestamps are selected, never
        // the board or status enum. A bare timestamp, so INV-6 is untouched.
        abandonedAt: schema.gameState.abandonedAt,
        // MAX(at) as an ISO 8601 UTC string, formatted in SQL so it matches Date.toISOString()
        // exactly (millisecond precision, trailing `Z`). A scalar aggregate subquery loses the
        // timestamptz OID node-postgres needs to auto-parse it to a Date, so it would otherwise
        // arrive as Postgres's own text format; formatting here keeps the value an ISO string
        // end to end and null when the game has no events. It reads only `at`, never `value`
        // (INV-6). The UTC cast pins the zone so the string is zone-independent of the server.
        lastActivityAt: sql<
          string | null
        >`(select to_char((max(ce."at") at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from "cell_events" ce where ce."game_id" = ${schema.games.gameId})`,
        memberCount: sql<number>`(select count(*)::int from "memberships" mc where mc."game_id" = ${schema.games.gameId})`,
        // The member stack (see the comment above). coalesce folds the impossible empty case
        // (the caller is always a member) to [] rather than SQL NULL, keeping the type honest.
        // The name coalesce is the §4 tombstone fallback, bound as a parameter, not inlined.
        members: sql<GameSummaryMember[]>`(
          select coalesce(jsonb_agg(jsonb_build_object(
            'userId', ms."user_id",
            'name', coalesce(us."display_name", ${FORMER_PARTICIPANT}),
            'avatarUrl', us."avatar",
            'role', ms."role"
          ) order by ms."joined_at", ms."user_id"), '[]'::jsonb)
          from "memberships" ms
          join "users" us on us."user_id" = ms."user_id"
          where ms."game_id" = ${schema.games.gameId})`,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.games,
        eq(schema.games.gameId, schema.memberships.gameId),
      )
      .innerJoin(
        schema.puzzles,
        eq(schema.puzzles.puzzleId, schema.games.puzzleId),
      )
      .leftJoin(
        schema.gameState,
        eq(schema.gameState.gameId, schema.games.gameId),
      )
      .where(
        and(
          eq(schema.memberships.userId, identity.userId),
          before === null ? undefined : lt(schema.games.createdAt, before),
        ),
      )
      .orderBy(desc(schema.games.createdAt), desc(schema.games.gameId))
      .limit(limit);

    // The next cursor is the page-minimum `createdAt` under the SELECTION order (createdAt DESC),
    // which is the last SQL row before the activity reorder. Null when the page did not fill to
    // `limit`: a short page is the end of the list, so there is no next page (PROTOCOL.md §12).
    const nextBefore =
      rows.length === limit
        ? rows[rows.length - 1]!.createdAt.toISOString()
        : null;

    const games: GameSummary[] = rows.map((r) => ({
      gameId: r.gameId,
      name: r.name,
      role: r.role,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      memberCount: r.memberCount,
      // The join-ordered member stack and the member-only invite code (PROTOCOL.md §12).
      members: r.members,
      inviteCode: r.inviteCode,
      // `completed_at` is null while ongoing, and null when no game_state row exists yet (the
      // left join): both read as "not done" on the home. Present only for a completed game.
      completedAt: r.completedAt === null ? null : r.completedAt.toISOString(),
      // `abandoned_at` is null while ongoing, null when no game_state row exists yet (the left
      // join), and set only when a host ended the game: the fact the ended shelf gathers on.
      abandonedAt: r.abandonedAt === null ? null : r.abandonedAt.toISOString(),
      // `MAX(cell_events.at)` as an ISO 8601 UTC string (formatted in SQL), null for an unplayed
      // game. Drives the activity reorder below.
      lastActivityAt: r.lastActivityAt,
      puzzle: {
        puzzleId: r.puzzleId,
        rows: r.puzzleRows,
        cols: r.puzzleCols,
        title: r.puzzleTitle,
        // The pattern-only silhouette, derived from geometry and block indices (PROTOCOL.md §12).
        mask: deriveMask({
          rows: r.puzzleRows,
          cols: r.puzzleCols,
          blocks: r.puzzleBlocks ?? [],
        }),
      },
    }));

    // Reorder THIS page (only) by display key `COALESCE(lastActivityAt, createdAt)` DESC, most
    // recent first; a fresh unplayed game keys on its createdAt (creating a room is its first
    // activity), so it is not banished below every played game. Ties fall back to `createdAt` DESC,
    // then `gameId` DESC, so the order is total and deterministic and matches the SQL selection
    // tiebreak. The cursor was already fixed from the selection order above, so this reorder never
    // affects pagination continuity (PROTOCOL.md §12).
    games.sort(orderByActivity);

    return c.json({ games, nextBefore });
  });

  // POST /games/join: join by invite code alone, no gameId. For a phone user who holds only the
  // code (web invite links carry both gameId and code; a hand-typed or read-aloud code does not).
  // Any authenticated user, guests included. Resolves the game by its unique invite code, then
  // seats the caller with the exact same semantics as POST /games/{id}/join (`seatJoiner`): a full
  // account lands as solver, a guest as spectator, an existing member keeps their role. The
  // response is that endpoint's shape plus the resolved `gameId`, which the caller needs to GET
  // the view and open the WebSocket.
  app.post("/join", limitJoinsByUser, async (c) => {
    const identity = c.get("identity");

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

    // Resolution is the shared invite-code lookup (games/lookup.ts): trim + ASCII-uppercase
    // (INV-1), then a single-row probe of the `games_invite_code_key` UNIQUE index. Shared with
    // GET /g/{code} so every code-holding path normalizes identically.
    const found = await findGameByInviteCode(deps.db, code);
    // A code that resolves to no game is genuinely not found: unlike the id-based join (where a
    // mismatched code is DENIED to avoid leaking that a known gameId exists), here the code IS the
    // lookup key, so there is no existence to protect. Reuse GAME_NOT_FOUND (no new code).
    if (found === null) {
      return fail(c, "GAME_NOT_FOUND", "no game with that code");
    }
    const gameId = found.gameId;

    const seated = await seatJoiner(
      deps.db,
      gameId,
      identity.userId,
      identity.isAnonymous,
    );
    if (seated.denied) {
      return fail(c, "DENIED", "removed from this game");
    }
    return c.json({ gameId, userId: identity.userId, role: seated.role });
  });

  // POST /games/{id}/join: join by invite code. Any authenticated user, guests included. A full
  // account is seated directly as solver (play at once), a guest as spectator (DESIGN.md §7, §8).
  app.post("/:id/join", limitJoinsByUser, async (c) => {
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

    const seated = await seatJoiner(
      deps.db,
      gameId,
      identity.userId,
      identity.isAnonymous,
    );
    if (seated.denied) {
      return fail(c, "DENIED", "removed from this game");
    }
    return c.json({ gameId, userId: identity.userId, role: seated.role });
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

    // Join users for the avatar URL only (INV-6-safe display field). The inner join on user_id
    // drops no member row: every membership references a users row that the JIT upsert has
    // materialized. avatar is the resolved URL, never an email (the port hashed it), so this view
    // exposes no email.
    const members = await deps.db
      .select({
        userId: schema.memberships.userId,
        role: schema.memberships.role,
        joinedAt: schema.memberships.joinedAt,
        avatarUrl: schema.users.avatar,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.users,
        eq(schema.users.userId, schema.memberships.userId),
      )
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
        avatarUrl: m.avatarUrl,
      })),
      session: { ws: `${deps.sessionWsBase}/games/${game.gameId}/ws` },
    };
    return c.json(view);
  });

  // GET /games/{id}/analysis: the post-game analysis bundle (design/post-game/ANALYSIS.md, the
  // Archive read model, DESIGN.md §7, §9). The whole completed surface in one fetch: `owners`
  // (the mosaic's first-correct map), `momentum` (the room's tempo), and `moments` (the three
  // named beats), all computed on read from the event log over one seq-ordered trace. This
  // REPLACES /attribution (a breaking replace: the attribution mount was never released). The
  // response carries userIds, cells, and numbers only, so it is INV-6-safe by construction, the
  // tier-1.5 profile: timing on top of attribution, never a letter (the client already holds the
  // roster from the game view; this never repeats names or colors).
  //
  // Auth is the game-view path's, reused verbatim: a viewer who can see the room. The invite code
  // and the puzzle are not part of this payload, so there is nothing member-only to protect beyond
  // "you can see this room"; the same membership gate the view applies is the right policy, no new
  // one invented.
  //
  // Gated to COMPLETED games only, returning GAME_NOT_FOUND (404) and computing nothing otherwise.
  // The trace for an ONGOING game leaks solving progress (which cells are locked in correct is a
  // heat map of what the room has finished), and an ABANDONED-game recap is a deferred product
  // decision. A completed game is immutable (INV-4: terminal status, append-only log frozen), so
  // this read is stable: compute it at any later time and get the same bundle.
  app.get("/:id/analysis", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }

    // Membership gate, byte-identical to the game view: load the members and require the caller
    // among them. A non-member is NOT_PARTICIPANT; an unauthenticated caller was already stopped
    // by authMiddleware. Any role qualifies, spectators included, exactly as the view allows.
    const members = await deps.db
      .select({ userId: schema.memberships.userId })
      .from(schema.memberships)
      .where(eq(schema.memberships.gameId, gameId));
    if (!members.some((m) => m.userId === identity.userId)) {
      // A game the caller cannot see (non-member) and a game that does not exist both surface as
      // "not a member" here without a prior existence probe: same as the view, a non-member never
      // learns whether the gameId is real. GAME_NOT_FOUND is reserved for the terminal gate below.
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }

    // Completion gate: read the session-owned `game_state.completed_at` under the API's SELECT-only
    // grant (migration 0005), the same read `GET /games` uses. A game that is not completed
    // (ongoing, abandoned, or with no game_state row yet) returns GAME_NOT_FOUND and computes
    // nothing: the attribution surface exists only once a game is done and the input can no longer
    // change. `completed_at` is a bare timestamp, never a cell value (INV-6).
    const state = await deps.db
      .select({ completedAt: schema.gameState.completedAt })
      .from(schema.gameState)
      .where(eq(schema.gameState.gameId, gameId))
      .limit(1);
    if (state.length === 0 || state[0]!.completedAt === null) {
      return fail(c, "GAME_NOT_FOUND", "no such completed game");
    }

    // The game exists and is completed; compute the analysis bundle on read. `gameAnalysis`
    // returns null only for an unknown gameId, which the membership gate already excluded, so a
    // null here is an internal inconsistency; treat it as not found rather than 500 a member.
    const view = await gameAnalysis(deps.db, gameId);
    if (view === null) {
      return fail(c, "GAME_NOT_FOUND", "no such game");
    }

    // INV-6: the response is the analysis bundle (userIds, cells, times), serialized through a
    // type that has no field for a solution value or a raw event, so no solution content can ride
    // this payload.
    return c.json(view);
  });

  // POST /games/{id}/role: self-upgrade spectator to solver (PROTOCOL.md §12, DESIGN.md §8).
  // One action, idempotent: a solver or host re-calling it is a no-op that returns the current
  // role. The only transition is spectator -> solver; any other target role is a VALIDATION.
  app.post("/:id/role", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");

    // Guests spectate but never hold the solver (or host) role: joining as a solver requires a
    // named account (owner decision 2026-07-09, DESIGN.md §8). Gate before any write, mirroring
    // the create gate on POST /games, so an anonymous caller is refused FULL_ACCOUNT_REQUIRED
    // (403) before the promotion UPDATE runs; the open spectator join stays unchanged for guests.
    if (identity.isAnonymous) {
      return fail(
        c,
        "FULL_ACCOUNT_REQUIRED",
        "joining as a solver requires a full account",
      );
    }

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

  // POST /games/{gameId}/live-activity-tokens: register an ActivityKit per-activity update token
  // for the Live Activity push channel (PROTOCOL.md "Live Activity push"). Bearer auth; the caller
  // MUST be a member of the game, the same gate as the other member endpoints (a non-member is
  // NOT_PARTICIPANT). The API is the single writer of live_activity_tokens (INV-7); the session's
  // emitter reads them under a SELECT grant (migration 0007). Upsert on token conflict, so a
  // re-registration after an app restart refreshes the row (user, game, environment, created_at)
  // rather than erroring. Rows are short-lived: a lock-screen Live Activity caps at 12h, so the
  // emitter filters by created_at rather than trusting a sweeper (none is required). 204 on success.
  app.post("/:id/live-activity-tokens", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return fail(c, "VALIDATION", "request body must be JSON");
    }
    const token = (body as { token?: unknown }).token;
    if (typeof token !== "string" || token.length === 0) {
      return fail(c, "VALIDATION", "token is required");
    }
    const environment = (body as { environment?: unknown }).environment;
    if (environment !== "sandbox" && environment !== "production") {
      return fail(
        c,
        "VALIDATION",
        "environment must be 'sandbox' or 'production'",
      );
    }

    // Membership gate, the same one the member endpoints use: a non-member is NOT_PARTICIPANT,
    // an unknown game GAME_NOT_FOUND. Any role qualifies, since any member can hold a live
    // activity for the room they backgrounded.
    const access = await loadGameAccess(deps.db, gameId, identity.userId);
    if (access === null) return fail(c, "GAME_NOT_FOUND", "no such game");
    if (access.role === null) {
      return fail(c, "NOT_PARTICIPANT", "not a member of this game");
    }

    // Upsert on the token primary key: a re-registration updates the owning user, game, and
    // environment, and refreshes created_at so the TTL window restarts from the latest register.
    await deps.db
      .insert(schema.liveActivityTokens)
      .values({
        token,
        userId: identity.userId,
        gameId,
        apnsEnvironment: environment,
      })
      .onConflictDoUpdate({
        target: schema.liveActivityTokens.token,
        set: {
          userId: identity.userId,
          gameId,
          apnsEnvironment: environment,
          createdAt: sql`now()`,
        },
      });

    // Welcome push (PROTOCOL.md 12a): now that the token row stands, signal the session over the
    // same internal channel the kick flow uses, so the emitter hands this member's fresh island the
    // current authoritative frame at once. Fire-and-forget and log-and-drop: the registration has
    // already succeeded and the response is 204 regardless, so a failed or absent notice degrades
    // only to the pre-existing TTL/debounce behavior, never to a failed registration.
    await notifyLiveActivityRegistered(deps, gameId, identity.userId);
    return c.body(null, 204);
  });

  // DELETE /games/{gameId}/live-activity-tokens/{token}: unregister a token (the app stopped its
  // Live Activity). Bearer auth; idempotent (204 even when the row is already gone). A caller may
  // delete only rows whose user_id is their own, so the delete is scoped by both token and
  // user_id: another user's token is never touched, and a missing row is a silent no-op. The gameId
  // in the path is not re-validated against the row: the token is globally unique (its primary key),
  // and the user_id scope is the authorization, so a well-formed idempotent delete never leaks
  // whether the token existed. 204 always (on a match, a miss, or another user's token).
  app.delete("/:id/live-activity-tokens/:token", async (c) => {
    const identity = c.get("identity");
    const gameId = c.req.param("id");
    const token = c.req.param("token");
    if (!UUID.test(gameId)) return fail(c, "GAME_NOT_FOUND", "no such game");

    await deps.db
      .delete(schema.liveActivityTokens)
      .where(
        and(
          eq(schema.liveActivityTokens.token, token),
          eq(schema.liveActivityTokens.userId, identity.userId),
        ),
      );
    return c.body(null, 204);
  });

  return app;
}
