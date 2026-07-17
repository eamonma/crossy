-- Expand-only (DESIGN.md §9 single writer: session; §11 expand/contract; INV-7). The room check
-- (D27, PROTOCOL.md §10) logs one row per accepted checkPuzzle: check_events(game_id, seq,
-- user_id, at, UNIQUE(game_id, seq)), the append-only twin of cell_events for a sequenced event
-- that sets no cell. Together the two logs plus the two terminal facts account for every consumed
-- seq, so replay stays deterministic (INV-1: wrongCells recomputes from the board and the solution
-- at replay). user_id lives ONLY here, never on the wire: the puzzleChecked event is neutral by
-- construction (PROTOCOL.md §6), and this row is what future scoring reads when it taxes checks.
-- Like cell_events: the composite primary key subsumes the UNIQUE, user_id is ON DELETE NO ACTION
-- (tombstoned, never cascaded, §8), game_id cascades with the game aggregate, and immutability is
-- encoded at the role layer (the session role gets INSERT + SELECT only, never UPDATE or DELETE).
--
-- This is additive: a new table, its two foreign keys, the session append-only grant, and the
-- deny-all RLS tripwire, matching the shape 0001 built for cell_events. No column is dropped,
-- retyped, or renamed, so the expand-only guard passes.
CREATE TABLE IF NOT EXISTS "check_events" (
	"game_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_events_game_id_seq_pk" PRIMARY KEY("game_id","seq"),
	CONSTRAINT "check_events_seq_positive" CHECK ("check_events"."seq" >= 1)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "check_events" ADD CONSTRAINT "check_events_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "check_events" ADD CONSTRAINT "check_events_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The session service is the single writer (INV-7), and the log is append-only at the grant
-- layer exactly like cell_events (0001): INSERT + SELECT, never UPDATE or DELETE. No API grant:
-- the API neither writes nor reads checks today (a future scoring read would be its own
-- SELECT-only expand, the 0005/0008 shape).
GRANT SELECT, INSERT ON "check_events" TO "crossy_session";--> statement-breakpoint
-- Deny-all RLS tripwire (DESIGN.md §7), matching every other table: RLS on with zero policies,
-- so a non-BYPASSRLS connection reads nothing. The `authenticated` SELECT grant makes the
-- tripwire a live guarantee (RLS is what blocks it, not a missing privilege), as 0001 does.
ALTER TABLE "check_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "check_events" TO "authenticated";
