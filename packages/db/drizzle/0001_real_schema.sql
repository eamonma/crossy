CREATE TYPE "public"."game_status" AS ENUM('ongoing', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('host', 'solver', 'spectator');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cell_events" (
	"game_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"cell" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cell_events_game_id_seq_pk" PRIMARY KEY("game_id","seq"),
	CONSTRAINT "cell_events_seq_positive" CHECK ("cell_events"."seq" >= 1),
	CONSTRAINT "cell_events_cell_nonneg" CHECK ("cell_events"."cell" >= 0),
	CONSTRAINT "cell_events_value_charset" CHECK ("cell_events"."value" IS NULL OR "cell_events"."value" ~ '^[A-Z0-9]{1,10}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_denylist" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kicked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_denylist_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_state" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"status" "game_status" DEFAULT 'ongoing' NOT NULL,
	"board" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"first_fill_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recent_command_ids" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "games" (
	"game_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"puzzle_id" uuid NOT NULL,
	"puzzle_snapshot" jsonb NOT NULL,
	"invite_code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_invite_code_key" UNIQUE("invite_code"),
	CONSTRAINT "games_invite_code_format" CHECK ("games"."invite_code" ~ '^[2-9A-HJ-NP-Z]{8}$')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "memberships" (
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_game_id_user_id_pk" PRIMARY KEY("game_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "puzzles" (
	"puzzle_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data" jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar" text,
	"is_anonymous" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "_scaffold_marker" CASCADE;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cell_events" ADD CONSTRAINT "cell_events_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cell_events" ADD CONSTRAINT "cell_events_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_denylist" ADD CONSTRAINT "game_denylist_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_denylist" ADD CONSTRAINT "game_denylist_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "game_state" ADD CONSTRAINT "game_state_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_puzzle_id_puzzles_puzzle_id_fk" FOREIGN KEY ("puzzle_id") REFERENCES "public"."puzzles"("puzzle_id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "games" ADD CONSTRAINT "games_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_game_id_games_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("game_id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- ==========================================================================
-- Least-privilege service roles + deny-all RLS tripwire (DESIGN.md §7, §9; INV-7).
-- Appended by hand to the Drizzle-generated table DDL above: Drizzle Kit models roles,
-- grants, and RLS incompletely, so this authoritative surface is expressed as raw SQL.
-- The differ never sees it (the snapshot tracks only table structure), so future
-- `generate` runs will not clobber or duplicate it.
-- ==========================================================================
--> statement-breakpoint
-- Roles are cluster-level, so create them idempotently: on a shared cluster (e.g.
-- Supabase) `authenticated` already exists. Service roles are NOLOGIN here — the
-- privilege surface is the contract, and deployment provisions login out of band
-- (ALTER ROLE ... LOGIN PASSWORD, or a login role GRANTed this one), keeping secrets
-- out of the committed migration. Service roles carry BYPASSRLS: they necessarily
-- bypass the deny-all tripwire, which is not their defense (DESIGN.md §7).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crossy_api') THEN
    CREATE ROLE "crossy_api" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crossy_session') THEN
    CREATE ROLE "crossy_session" NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE "authenticated" NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
ALTER ROLE "crossy_api" BYPASSRLS;--> statement-breakpoint
ALTER ROLE "crossy_session" BYPASSRLS;--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "crossy_api", "crossy_session", "authenticated";--> statement-breakpoint
-- API service owns five tables (DESIGN.md §9): full DML on each, and nothing on the
-- session-owned tables (game_state, cell_events) — single writer per table (INV-7).
GRANT SELECT, INSERT, UPDATE, DELETE ON "users" TO "crossy_api";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "puzzles" TO "crossy_api";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "games" TO "crossy_api";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO "crossy_api";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "game_denylist" TO "crossy_api";--> statement-breakpoint
-- Session service owns two tables (DESIGN.md §9). game_state: full DML. cell_events is
-- the append-only, immutable event log (§9), so INSERT + SELECT only — no UPDATE or
-- DELETE grant is the physical encoding of that immutability.
GRANT SELECT, INSERT, UPDATE, DELETE ON "game_state" TO "crossy_session";--> statement-breakpoint
GRANT SELECT, INSERT ON "cell_events" TO "crossy_session";--> statement-breakpoint
-- Session read-coupling — the published cross-service contract (DESIGN.md §9): the
-- session reads games (incl. puzzle_snapshot), memberships, game_denylist, and from
-- users the display name only. The column grant excludes avatar and is_anonymous;
-- user_id is included as the join key, not as PII.
GRANT SELECT ON "games" TO "crossy_session";--> statement-breakpoint
GRANT SELECT ON "memberships" TO "crossy_session";--> statement-breakpoint
GRANT SELECT ON "game_denylist" TO "crossy_session";--> statement-breakpoint
GRANT SELECT ("user_id", "display_name") ON "users" TO "crossy_session";--> statement-breakpoint
-- Deny-all RLS tripwire (DESIGN.md §7): RLS enabled with zero policies on every table,
-- so any connection not on a BYPASSRLS service role reads nothing. It guards a future
-- Supabase `authenticated`/PostgREST path; no feature depends on it.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "puzzles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "games" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "game_denylist" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "game_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cell_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The tripwire is only a live guarantee if a subject role holds a table grant yet
-- still reads nothing. Grant the `authenticated` path read access so deny-all RLS is
-- demonstrably what blocks it, not a missing privilege (see the tripwire test).
GRANT SELECT ON "users" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "puzzles" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "games" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "memberships" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "game_denylist" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "game_state" TO "authenticated";--> statement-breakpoint
GRANT SELECT ON "cell_events" TO "authenticated";
