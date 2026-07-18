-- Expand-only (DESIGN.md §9 single writer: session; §11 expand/contract; INV-7). The attributed
-- check vote (D32, PROTOCOL.md §10) logs one row per vote lifecycle event: check_vote_events(
-- game_id, seq, kind, user_id, approve, vote_seq, electorate, outcome, reason, at,
-- UNIQUE(game_id, seq)), the append-only twin of check_events one level up. Each vote event
-- (checkVoteOpened, checkVoteCast, checkVoteClosed) consumes a seq but sets no cell, so it lands
-- here rather than widening cell_events; together the logs plus the two terminal facts account for
-- every consumed seq, so replay stays deterministic (INV-1). kind is opened/cast/closed; user_id is
-- the proposer on opened, the voter on cast, NULL on closed; vote_seq is the opening event's seq,
-- the vote's identity every row of one vote joins on; electorate is the frozen ascending userId
-- array on the opened row (jsonb); outcome and reason are set on the closed row. Like cell_events
-- and check_events: the composite primary key subsumes the UNIQUE, user_id is ON DELETE NO ACTION
-- (tombstoned, never cascaded, §8), game_id cascades with the game aggregate, and immutability is
-- encoded at the role layer (the session role gets INSERT + SELECT only, never UPDATE or DELETE).
--
-- This is additive: a new table, its two foreign keys, the session append-only grant, and the
-- deny-all RLS tripwire, matching the shape 0012 built for check_events. No column is dropped,
-- retyped, or renamed, so the expand-only guard passes.
CREATE TABLE IF NOT EXISTS "check_vote_events" (
	"game_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"approve" boolean,
	"vote_seq" bigint NOT NULL,
	"electorate" jsonb,
	"outcome" text,
	"reason" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_vote_events_game_id_seq_pk" PRIMARY KEY("game_id","seq"),
	CONSTRAINT "check_vote_events_seq_positive" CHECK ("check_vote_events"."seq" >= 1),
	CONSTRAINT "check_vote_events_kind" CHECK ("check_vote_events"."kind" IN ('opened', 'cast', 'closed'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "check_vote_events" ADD CONSTRAINT "check_vote_events_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "check_vote_events" ADD CONSTRAINT "check_vote_events_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- The session service is the single writer (INV-7), and the log is append-only at the grant layer
-- exactly like check_events (0012) and cell_events (0001): INSERT + SELECT, never UPDATE or DELETE.
-- No API grant: the API neither writes nor reads votes today (a future scoring read would be its own
-- SELECT-only expand, the 0005/0008 shape).
GRANT SELECT, INSERT ON "check_vote_events" TO "crossy_session";--> statement-breakpoint
-- Deny-all RLS tripwire (DESIGN.md §7), matching every other table: RLS on with zero policies, so a
-- non-BYPASSRLS connection reads nothing. The `authenticated` SELECT grant makes the tripwire a live
-- guarantee (RLS is what blocks it, not a missing privilege), as 0012 does.
ALTER TABLE "check_vote_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "check_vote_events" TO "authenticated";
