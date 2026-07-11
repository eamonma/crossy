-- Expand-only (DESIGN.md §9 single writer: API; §11 expand/contract). The Live Activity push
-- channel (PROTOCOL.md "Live Activity push") lets the server mutate a running iOS Live Activity's
-- ContentState over APNs. It needs a registry of the ActivityKit per-activity update tokens: the
-- iOS client registers a token through bearer-authed REST, so the API is the single writer
-- (INV-7), and the session's emitter (a later slice) reads them under a SELECT grant. This mirrors
-- the read-coupling §9 already blesses (0005 completion read, 0006 avatar read), in the same
-- direction as those: an API-owned table the session reads.
--
-- The token is the natural key (one row per live activity), so re-registration after an app
-- restart is an upsert on the primary key. apns_environment records which APNs host minted the
-- token (a Debug build mints a sandbox token), so the emitter targets the matching host. The
-- game_id index serves the emitter's read, "all live tokens for this game", filtered by a
-- created_at TTL window: a lock-screen Live Activity caps at 12h, so a stale token is dead and the
-- reader filters by created_at rather than trusting a sweeper (none is required for correctness).
--
-- This is additive: a new table, its two foreign keys, one index, a two-value CHECK, the API write
-- grant, the session read grant, and the deny-all RLS tripwire, matching the shape 0001 built for
-- the original seven tables. No column is dropped, retyped, or renamed, so the expand-only guard
-- passes.
CREATE TABLE IF NOT EXISTS "live_activity_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"apns_environment" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "live_activity_tokens_environment" CHECK ("live_activity_tokens"."apns_environment" IN ('sandbox', 'production'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_activity_tokens" ADD CONSTRAINT "live_activity_tokens_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "live_activity_tokens" ADD CONSTRAINT "live_activity_tokens_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "live_activity_tokens_game_id_idx" ON "live_activity_tokens" USING btree ("game_id");--> statement-breakpoint
-- The API is the single writer (INV-7): full DML, the same grant the other five API-owned tables
-- carry (0001). The role already exists (0001 creates it idempotently); this only widens its
-- surface to the new table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "live_activity_tokens" TO "crossy_api";--> statement-breakpoint
-- Session read-coupling (DESIGN.md §9): the emitter reads all live tokens for a game to push its
-- ContentState. SELECT only, so single-writer holds (INV-7 governs writes, not reads); this is the
-- published cross-service read contract widening to one new table, the exact expand §9 anticipates.
GRANT SELECT ON "live_activity_tokens" TO "crossy_session";--> statement-breakpoint
-- Deny-all RLS tripwire (DESIGN.md §7), matching every other table: RLS on with zero policies, so
-- a non-BYPASSRLS connection reads nothing. The `authenticated` SELECT grant makes the tripwire a
-- live guarantee (RLS is what blocks it, not a missing privilege), as 0001 does for the seven.
ALTER TABLE "live_activity_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "live_activity_tokens" TO "authenticated";
