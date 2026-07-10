import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The Crossy data model (DESIGN.md §9). The schema is the written domain model: these
 * seven tables and their column semantics come verbatim from §9's ownership matrix,
 * with §5 and §8 governing the identity/tombstone rules on foreign keys. This package
 * is a pure contract — no business logic, no service code — so both services build
 * against one schema while single-writer-per-table (INV-7) governs writes and is
 * enforced at the Postgres role layer (see the migration, not here).
 *
 * Physical-detail choices DESIGN.md §9 leaves open are noted inline; the wave report
 * collects them. Where §9 names a column or constraint, it is reproduced exactly.
 */

// Roles a participant can hold in a game (DESIGN.md §2, §8). Modeled as a Postgres
// enum so an illegal role is a write error, not a silent string.
export const membershipRole = pgEnum("membership_role", [
  "host",
  "solver",
  "spectator",
]);

// A game's lifecycle status (DESIGN.md §2). `ongoing` at creation; `completed` and
// `abandoned` are the terminal states that freeze the board (INV-4).
export const gameStatus = pgEnum("game_status", [
  "ongoing",
  "completed",
  "abandoned",
]);

/**
 * `users` (writer: API). Identity mirror populated by a just-in-time upsert on the
 * first authenticated request (DESIGN.md §8). Keyed by the same UUID the provider
 * issues — no default here, the API supplies the provider `sub`. Deletion is a
 * tombstone: `deleteUser` and the stale-guest job scrub PII (display_name, avatar)
 * but retain the stable `user_id`, because `cell_events` is immutable and INV-1
 * replay depends on the id surviving (§8). PII columns are therefore nullable so a
 * tombstone can null them in place; a null `display_name` renders as
 * "former participant".
 */
export const users = pgTable("users", {
  // Provider-issued UUID (the token's `sub`); every FK in the schema points here (§8).
  userId: uuid("user_id").primaryKey(),
  // PII, scrubbed to null on tombstone (§8).
  displayName: text("display_name"),
  avatar: text("avatar"),
  // Auth method is an attribute of identity (§8); guests are `true`.
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  // Physical detail (DESIGN.md §9 silent): needed by the stale-anonymous reclaim job
  // (§8) to age guests, and as an audit anchor.
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * `puzzles` (writer: API). The internal puzzle model produced by the ingestion ACL
 * (DESIGN.md §7). Holds solutions and never leaves the server; client payloads use the
 * `ClientPuzzle` type instead (INV-6, enforced structurally in packages/protocol, not
 * by runtime stripping).
 *
 * Physical detail (DESIGN.md §9 silent): §9 names "internal puzzle model including
 * solutions (jsonb), features, source metadata". Modeled as three jsonb columns rather
 * than one blob so features and provenance are queryable without decoding the full
 * model. The schema stays format-agnostic (no import of the protocol types) to keep
 * this package a standalone contract.
 */
export const puzzles = pgTable(
  "puzzles",
  {
    puzzleId: uuid("puzzle_id").primaryKey().defaultRandom(),
    // The internal ServerPuzzle model: layout, numbers, circles, clues, and solutions.
    data: jsonb("data").notNull(),
    // Detected features (rebus, circles, image clues, ...) from the ingestion ACL (§7).
    features: jsonb("features")
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Source metadata (upload vs URL, original filename/URL). Nullable: not every
    // ingest path carries provenance.
    source: jsonb("source"),
    // Uploader (the authenticated caller on `POST /puzzles`), so a user can list their own
    // uploads (the signed-in home surface). Expand-only and nullable: existing rows predate
    // the column and read as unowned; new ingests populate it. ON DELETE NO ACTION mirrors
    // `games.created_by` (§8): users are tombstoned, never hard-deleted, so the id survives.
    createdBy: uuid("created_by").references(() => users.userId, {
      onDelete: "no action",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Serves `GET /puzzles`: the caller's uploads, newest first
    // (`WHERE created_by = $1 ORDER BY created_at DESC`). Composite so the filter and the
    // ordering are one index scan; Postgres reads it backward for the DESC order.
    index("puzzles_created_by_created_at_idx").on(t.createdBy, t.createdAt),
  ],
);

/**
 * `games` (writer: API). Session identity (DESIGN.md §9). `puzzle_snapshot`
 * denormalizes the puzzle at creation so a live game is self-contained: puzzle edits
 * or deletions cannot corrupt a game in flight, and the actor hydrates from this row
 * plus `game_state` (§9). The snapshot carries solutions because the server-side
 * comparator needs them on the completion path (§6); it is server-only.
 */
export const games = pgTable(
  "games",
  {
    gameId: uuid("game_id").primaryKey().defaultRandom(),
    // Catalog pointer. NOT NULL session identity (§9). ON DELETE RESTRICT: the
    // snapshot decouples runtime, so a referenced puzzle simply cannot be hard-deleted
    // out from under a game; v4 lists no puzzle-deletion feature. (Alternative
    // recorded in the report: ON DELETE SET NULL to permit puzzle GC.)
    puzzleId: uuid("puzzle_id")
      .notNull()
      .references(() => puzzles.puzzleId, { onDelete: "restrict" }),
    // Self-contained denormalized ServerPuzzle snapshot (§9).
    puzzleSnapshot: jsonb("puzzle_snapshot").notNull(),
    // Optional room display name, user content the creator supplies. Nullable: absent means
    // an unnamed game. It is shown back verbatim and is never normalized or compared, so the
    // ASCII-only casing rule (INV-1) deliberately does not apply to it; there is no CHECK.
    // Trimming and the length cap live in API code (the single writer), not in the column.
    name: text("name"),
    // Capability code, `/g/{code}`: 8 chars from the unambiguous alphabet (§7). The
    // CHECK encodes that format as defense in depth; generation lives in API code.
    inviteCode: text("invite_code").notNull(),
    // Creator; full accounts only (§7). ON DELETE NO ACTION: users are tombstoned,
    // never hard-deleted (§8), and host succession handles a tombstoned creator (§7).
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("games_invite_code_key").on(t.inviteCode),
    check(
      "games_invite_code_format",
      sql`${t.inviteCode} ~ '^[2-9A-HJ-NP-Z]{8}$'`,
    ),
  ],
);

/**
 * `memberships` (writer: API). A user's role in a game (DESIGN.md §9). Join and role
 * change are upserts, so the natural key `(game_id, user_id)` is the primary key
 * (subsuming §9's `UNIQUE(game_id, user_id)`). On tombstone the API removes a user's
 * membership rows (§8); that is an application write, and `user_id` is ON DELETE NO
 * ACTION because users are never hard-deleted.
 */
export const memberships = pgTable(
  "memberships",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    role: membershipRole("role").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.userId] }),
    // Serves `GET /games`: the caller's memberships (`WHERE user_id = $1`). The primary key
    // leads with `game_id`, so a lookup by `user_id` alone cannot use it; this index makes
    // "my games" a direct scan rather than a full table sweep.
    index("memberships_user_id_idx").on(t.userId),
  ],
);

/**
 * `game_denylist` (writer: API). Kicked users, per game (DESIGN.md §7, §9). The
 * invite code is a capability a kicked user still holds, so kick writes here and the
 * list is checked at join and at connect (§7). `user_id` is ON DELETE NO ACTION for
 * the same tombstone reason as `memberships`.
 *
 * Physical detail (DESIGN.md §9 silent): `kicked_at` added for audit/ordering.
 */
export const gameDenylist = pgTable(
  "game_denylist",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    kickedAt: timestamp("kicked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.userId] })],
);

/**
 * `game_state` (writer: session). The mutable play state (DESIGN.md §9). One row per
 * game, keyed by `game_id` (1:1 with `games`); this is the split-by-writer sibling of
 * `games`, not a split by access pattern (§9). The actor is the single writer: it
 * hydrates from this row plus `games`, and the snapshot flushes together with events
 * in one transaction (§6). Only the actor may write it (§6).
 *
 * `recent_command_ids` is the bounded ring of the last K applied `commandId`s that
 * makes dedup survive passivation and crash (§6, §9); modeled as a jsonb array so the
 * actor manages the ring in application code.
 */
export const gameState = pgTable("game_state", {
  gameId: uuid("game_id")
    .primaryKey()
    .references(() => games.gameId, { onDelete: "cascade" }),
  status: gameStatus("status").notNull().default("ongoing"),
  // Board snapshot: per-cell {v, by} array (PROTOCOL.md §3). Empty at creation.
  board: jsonb("board")
    .notNull()
    .default(sql`'[]'::jsonb`),
  // Last sequence applied (§6). bigint (mode: number) — a monotonic counter; physical
  // detail, integer would suffice at friends scale but bigint costs nothing and
  // matches "sequence number" intent.
  lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
  // Timer anchors, both server-timestamped and derived-never-stored downstream (§2).
  firstFillAt: timestamp("first_fill_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  abandonedAt: timestamp("abandoned_at", { withTimezone: true }),
  // Completion stats (participantCount etc.), non-null only when completed
  // (PROTOCOL.md §3); default empty object.
  stats: jsonb("stats")
    .notNull()
    .default(sql`'{}'::jsonb`),
  recentCommandIds: jsonb("recent_command_ids")
    .notNull()
    .default(sql`'[]'::jsonb`),
});

/**
 * `cell_events` (writer: session). The append-only event log (DESIGN.md §9). Exactly
 * the shape §9 names: `(game_id, seq, cell, user_id, value, at, UNIQUE(game_id, seq))`.
 * The composite primary key `(game_id, seq)` subsumes that UNIQUE and gives the
 * per-game read path (completion `participantCount`, §6; replay, §9) its index for
 * free.
 *
 * Immutability (§9) is encoded at the role layer: the session role is granted only
 * INSERT and SELECT here, never UPDATE or DELETE (see the migration). `user_id` is ON
 * DELETE NO ACTION and tombstoned, never cascaded (§8, §9), so the log stays
 * contiguous through user deletion and INV-1 replay survives it. Contiguous `seq`
 * from 1 (INV-2) is an actor invariant; the schema enforces uniqueness and the `>= 1`
 * floor, not contiguity (a gap-free sequence is not expressible as a simple
 * constraint — noted in the report).
 */
export const cellEvents = pgTable(
  "cell_events",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    // Per-game sequence, assigned only by the actor, contiguous from 1 (INV-2).
    seq: bigint("seq", { mode: "number" }).notNull(),
    // 0-based row-major grid index (PROTOCOL.md §3).
    cell: integer("cell").notNull(),
    // Attribution. NEVER a cascading FK (§8, §9): a tombstoned user's id survives here
    // as an opaque, PII-free id so replay stays deterministic (INV-1).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    // Normalized value `^[A-Z0-9]{1,10}$`, or null for a clear (PROTOCOL.md §3, §5).
    // The CHECK is defense in depth; the engine normalizes and validates at the
    // boundary.
    value: text("value"),
    // Server-timestamped fact (§2); the actor supplies it as data (INV-9). Default is
    // a safety net, not the source of truth.
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.seq] }),
    check("cell_events_seq_positive", sql`${t.seq} >= 1`),
    check("cell_events_cell_nonneg", sql`${t.cell} >= 0`),
    check(
      "cell_events_value_charset",
      sql`${t.value} IS NULL OR ${t.value} ~ '^[A-Z0-9]{1,10}$'`,
    ),
  ],
);
