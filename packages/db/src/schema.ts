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
  uniqueIndex,
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
  // The resolved avatar URL (DESIGN.md §8): a provider metadata avatar, else a Gravatar URL from
  // the account email, else null. Written by the API's identity mirror (single writer, INV-7),
  // read by the session for the participant payload (PROTOCOL.md §4) under the expanded column
  // grant. It is a resolved URL, never an email: the Gravatar hash is computed API-side, so this
  // column exposes no email to any reader (INV-6 spirit). Scrubbed to null on tombstone (§8).
  avatar: text("avatar"),
  // The user's personal reaction set: the five emoji their client offers to send (PROTOCOL.md
  // §9, §12; DESIGN.md D25). Written by the API's `PATCH /me` under the same single writer as the
  // name (INV-7); the session never reads it, since a `react` carries the grapheme itself. Stored
  // as a jsonb string array, the schema's idiom for a small string array (matching
  // `game_state.recent_command_ids`). Nullable with no default and no backfill: null means the
  // five defaults (PROTOCOL.md §9) and is the state of every existing and new account until it
  // chooses otherwise. Byte-exact: the graphemes are stored as given, never normalized (a
  // variation selector or skin-tone modifier is significant). Not PII, so it is NOT scrubbed on
  // tombstone (unlike display_name and avatar), and it carries no solution content (INV-6).
  reactionSet: jsonb("reaction_set").$type<string[]>(),
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
    // Display metadata parsed from the XWord Info document at ingestion (title, author).
    // Nullable, no default, no backfill: existing puzzles predate the columns and read as
    // untitled/anonymous. These are display content shown back verbatim, never normalized or
    // compared, so the ASCII-only casing rule (INV-1) deliberately does not apply and there is
    // no CHECK; they are NOT solutions, so INV-6 is untouched. Trimming, entity decoding, and
    // the length cap live in the ingestion ACL (the single writer), not in the column. Kept off
    // the ServerPuzzle/ClientPuzzle model on purpose: they serve the signed-in home lists, not
    // the solve screen, so they are api row-shape fields, not wire puzzle facts.
    title: text("title"),
    author: text("author"),
    // Uploader (the authenticated caller on `POST /puzzles`), so a user can list their own
    // uploads (the signed-in home surface). Expand-only and nullable: existing rows predate
    // the column and read as unowned; new ingests populate it. ON DELETE NO ACTION mirrors
    // `games.created_by` (§8): users are tombstoned, never hard-deleted, so the id survives.
    createdBy: uuid("created_by").references(() => users.userId, {
      onDelete: "no action",
    }),
    // Per-account content digest for ingest dedup (DESIGN.md D23, PROTOCOL.md §12). A sha256
    // over the whole translated ServerPuzzle in canonical form (apps/api/src/puzzles/digest.ts).
    // Nullable and expand-only: existing rows predate the column and read as un-digested, so
    // dedup is forward-only. INV-6: the digest is solution-derived, a solution oracle, so it is
    // server-only, never selected into a client payload (the GET /puzzles column list omits it).
    contentDigest: text("content_digest"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Serves `GET /puzzles`: the caller's uploads, newest first
    // (`WHERE created_by = $1 ORDER BY created_at DESC`). Composite so the filter and the
    // ordering are one index scan; Postgres reads it backward for the DESC order.
    index("puzzles_created_by_created_at_idx").on(t.createdBy, t.createdAt),
    // Dedup mechanism itself (D23): a re-post of the same content by the same account collapses
    // to the existing row via `ON CONFLICT (created_by, content_digest) DO NOTHING`. PARTIAL on
    // `content_digest IS NOT NULL` so it constrains only new digested rows and never collides
    // the un-digested history. Per-account scope: a hit means "you already added this", never a
    // cross-account fact (DESIGN.md D21 posture).
    uniqueIndex("puzzles_created_by_content_digest_key")
      .on(t.createdBy, t.contentDigest)
      .where(sql`content_digest IS NOT NULL`),
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
 *
 * Read-coupling (DESIGN.md §9): the API holds a SELECT-only grant on this table
 * (migration 0005) so `GET /games` can report a game's completion (`completed_at`) on the
 * signed-in home. That is the planned read expand §9 records; it grants read only, so the
 * session stays the single writer (INV-7 governs writes, not reads). The API reads
 * `completed_at`, never the board or the rest of the row.
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
 *
 * Read-coupling (DESIGN.md §9): the API holds a SELECT-only grant on this table
 * (migration 0008) so `GET /games` can order the signed-in home's rooms by most recent
 * activity, `MAX(at)` per game (PROTOCOL.md §12). That is the next step of the planned read
 * expand §9 records (the Archive module extending the read coupling to cell_events), brought
 * forward for the activity ordering; it grants read only, so the session stays the single
 * writer (INV-7 governs writes, not reads). The API reads `MAX(at)` (a bare timestamp), never
 * `value`, so no cell content leaves the server (INV-6). The composite primary key
 * `(game_id, seq)` covers the per-game `MAX(at)` scan; the report notes a `(game_id, at)`
 * index if the aggregate ever needs it, unnecessary at friends scale.
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

/**
 * `check_events` (writer: session). The append-only room-check log (DESIGN.md §9, D27):
 * one row per accepted `checkPuzzle`, exactly the shape §9 names,
 * `(game_id, seq, user_id, at, UNIQUE(game_id, seq))`. The twin of `cell_events` for a
 * sequenced event that sets no cell: a `puzzleChecked` consumes a `seq`, so it lands in
 * its own log rather than widening `cell_events` with a cell-less row shape; together the
 * two logs plus the two terminal facts account for every consumed `seq` (INV-1 replay).
 *
 * `user_id` lives ONLY here, never on the wire: the `puzzleChecked` event is neutral by
 * construction (PROTOCOL.md §6; D27), and this row is what future scoring reads when it
 * taxes checks. Like `cell_events`, the composite primary key `(game_id, seq)` subsumes
 * the UNIQUE, `user_id` is ON DELETE NO ACTION (tombstoned, never cascaded, §8), the
 * session role holds INSERT + SELECT only (append-only at the grant layer, see the
 * migration), and a check never makes its sender a `participantCount` participant.
 */
export const checkEvents = pgTable(
  "check_events",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    // Per-game sequence, assigned only by the actor, shared with cell_events (INV-2).
    seq: bigint("seq", { mode: "number" }).notNull(),
    // The acting member, server-side only; never on the wire (PROTOCOL.md §6, D27).
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    // Server-timestamped fact (§2); the actor supplies it as data (INV-9).
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.seq] }),
    check("check_events_seq_positive", sql`${t.seq} >= 1`),
  ],
);

/**
 * `live_activity_tokens` (writer: API). The ActivityKit per-activity update tokens the emitter
 * pushes ContentState to (PROTOCOL.md "Live Activity push"). API-owned: the iOS client registers
 * and unregisters tokens through bearer-authed REST, so the single writer is `crossy_api` (INV-7).
 * The session's emitter (a later slice) reads them under a SELECT grant, the same read-coupling
 * shape §9 already blesses for the completion read (0005) and the avatar read (0006).
 *
 * The token is the natural key (one row per live activity), so re-registration after an app
 * restart is an upsert on the primary key. `apns_environment` records which APNs host minted the
 * token: a Debug build mints a sandbox token, so the emitter must hit `api.sandbox.push.apple.com`
 * for it and `api.push.apple.com` for a production token, never the wrong host.
 *
 * TTL posture (PROTOCOL.md "Live Activity push"): a lock-screen Live Activity caps at 12h, so a
 * token older than that is dead. Rows are short-lived by nature; the reader filters by a
 * `created_at` window rather than trusting the table to be swept, so no sweeper job is required
 * for correctness. The `game_id` index serves the emitter's read, "all live tokens for this game".
 */
export const liveActivityTokens = pgTable(
  "live_activity_tokens",
  {
    // The ActivityKit per-activity update token (hex). Natural key: one row per live activity,
    // so re-registration is an upsert on conflict (DESIGN.md §9 upsert idiom).
    token: text("token").primaryKey(),
    // The registering user. ON DELETE NO ACTION for the same tombstone reason as the other
    // user_id FKs (§8): users are tombstoned, never hard-deleted.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    // The game whose activity this token updates. ON DELETE CASCADE: the token belongs to the
    // game aggregate, so it dies with the game (matching cell_events / memberships game_id).
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    // Which APNs host minted the token, so the emitter targets the matching host. The CHECK
    // pins the two-value domain as defense in depth; the API validates the request body too.
    apnsEnvironment: text("apns_environment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "live_activity_tokens_environment",
      sql`${t.apnsEnvironment} IN ('sandbox', 'production')`,
    ),
    // The emitter's read is "all tokens for this game" (`WHERE game_id = $1`), filtered by the
    // created_at TTL window; this index makes it a direct scan.
    index("live_activity_tokens_game_id_idx").on(t.gameId),
  ],
);

/**
 * `share_tokens` (writer: API). The public completion share link (design/post-game/SHARE.md wave
 * S2, PROTOCOL.md §12). A completed game mints an unguessable token that fronts the public share
 * page (`/s/{token}`) and its server-rendered OpenGraph card. API-owned: only a member can mint one
 * through bearer-authed REST, so the single writer is `crossy_api` (INV-7). No service reads it but
 * the API: the public routes resolve the token to a `game_id` under the API's own grant, then reuse
 * the same completed-game reads (`game_state.completed_at`, the analysis bundle) the analysis
 * endpoint already holds. The session never touches it, so no read-coupling grant is added.
 *
 * The `token` is the natural key: a 256-bit URL-safe secret (apps/api share/token.ts), so it cannot
 * be guessed and never needs a surrogate id. `game_id` is ON DELETE CASCADE (the link belongs to the
 * game aggregate, matching `live_activity_tokens`); `created_by` is ON DELETE NO ACTION for the same
 * tombstone reason as every other `user_id` FK (§8). `revoked_at` is a nullable soft-delete: a
 * revoked link resolves to a soft 404 without a row rewrite, so the mint path can tell "active" from
 * "dead". The partial unique index pins ONE active (non-revoked) token per game, which is what makes
 * the mint idempotent: mint-or-return-existing collapses a re-POST to the same row (SHARE.md S2).
 *
 * INV-6: the token carries no solution content, and nothing letter-shaped is stored here; the card
 * the token fronts is built from the letter-free analysis bundle (SHARE.md "No letters, ever").
 * This is additive: a new table, its two foreign keys, one partial unique index, the API write
 * grant, and the deny-all RLS tripwire, matching the shape 0007 built for `live_activity_tokens`.
 * No column is dropped, retyped, or renamed, so the expand-only guard passes.
 */
export const shareTokens = pgTable(
  "share_tokens",
  {
    // The unguessable, URL-safe share secret (256-bit base64url, apps/api share/token.ts). Natural
    // key: one row per minted link, so an idempotent re-mint returns the existing row's token.
    token: text("token").primaryKey(),
    // The completed game this link shares. ON DELETE CASCADE: the token belongs to the game
    // aggregate, so it dies with the game (matching live_activity_tokens / cell_events game_id).
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.gameId, { onDelete: "cascade" }),
    // The member who minted the link. ON DELETE NO ACTION for the same tombstone reason as every
    // other user_id FK (§8): users are tombstoned, never hard-deleted.
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.userId, { onDelete: "no action" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Soft revoke: a non-null timestamp retires the link (resolves to a soft 404) without deleting
    // the row. Nullable, no default: an active link has never been revoked.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    // One ACTIVE token per game (SHARE.md S2 idempotent mint): the partial unique index constrains
    // only non-revoked rows, so a revoked link can coexist with the fresh one that replaced it.
    uniqueIndex("share_tokens_active_game_key")
      .on(t.gameId)
      .where(sql`revoked_at IS NULL`),
  ],
);
