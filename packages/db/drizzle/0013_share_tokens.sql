-- Expand-only (DESIGN.md §9 single writer: API; §11 expand/contract). The public completion share
-- link (design/post-game/SHARE.md wave S2, PROTOCOL.md §12): a completed game mints an unguessable
-- token that fronts the public share page (`GET /s/{token}`) and its server-rendered OpenGraph card
-- (`GET /s/{token}/card.png`). API-owned: only a member mints one through bearer-authed REST, so the
-- API is the single writer (INV-7). No other service reads it: the public routes resolve the token
-- to a game under the API's own grant, then reuse the completed-game reads the analysis endpoint
-- already holds (`game_state.completed_at`, the analysis bundle). The session gets no grant.
--
-- The token is the natural key (one row per minted link), a 256-bit URL-safe secret minted in
-- application code (apps/api share/token.ts), so a re-mint returns the existing row's token rather
-- than a surrogate id. `revoked_at` is a nullable soft-delete: a revoked link resolves to a soft 404
-- without a row rewrite, and the partial unique index pins ONE active (non-revoked) token per game,
-- which is what makes the mint idempotent (mint-or-return-existing, SHARE.md S2). game_id cascades
-- with the game aggregate; created_by is ON DELETE NO ACTION (tombstoned, never cascaded, §8).
--
-- INV-6: the token carries no solution content and nothing letter-shaped is stored here; the card it
-- fronts is built from the letter-free analysis bundle (SHARE.md "No letters, ever").
--
-- This is additive: a new table, its two foreign keys, one partial unique index, the API write
-- grant, and the deny-all RLS tripwire, matching the shape 0007 built for live_activity_tokens. No
-- column is dropped, retyped, or renamed, so the expand-only guard passes.
CREATE TABLE IF NOT EXISTS "share_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"game_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- One ACTIVE token per game (SHARE.md S2 idempotent mint): the partial unique index constrains only
-- non-revoked rows, so a revoked link coexists with the fresh one that replaced it, and a concurrent
-- double-mint collapses to one active row rather than two live links.
CREATE UNIQUE INDEX IF NOT EXISTS "share_tokens_active_game_key" ON "share_tokens" USING btree ("game_id") WHERE revoked_at IS NULL;--> statement-breakpoint
-- The API is the single writer (INV-7): full DML, the same grant the other API-owned tables carry
-- (0001, 0007). The role already exists (0001 creates it idempotently); this only widens its surface
-- to the new table. No session grant: the session never reads or writes share links.
GRANT SELECT, INSERT, UPDATE, DELETE ON "share_tokens" TO "crossy_api";--> statement-breakpoint
-- Deny-all RLS tripwire (DESIGN.md §7), matching every other table: RLS on with zero policies, so a
-- non-BYPASSRLS connection reads nothing. The `authenticated` SELECT grant makes the tripwire a live
-- guarantee (RLS is what blocks it, not a missing privilege), as 0001 does for the original seven.
ALTER TABLE "share_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "share_tokens" TO "authenticated";
