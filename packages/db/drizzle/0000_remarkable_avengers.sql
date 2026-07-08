CREATE TABLE IF NOT EXISTS "_scaffold_marker" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
