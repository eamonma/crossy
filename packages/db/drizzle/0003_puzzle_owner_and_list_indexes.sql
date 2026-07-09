-- Expand-only (DESIGN.md §9 single writer: API; §11 expand/contract). Two list surfaces for
-- the signed-in home (Games and Puzzles):
--   1. puzzles.created_by records the uploader so `GET /puzzles` can list a caller's own
--      uploads. Nullable, no default, no backfill: existing puzzles predate the column and
--      read as unowned. ON DELETE NO ACTION matches games.created_by (users are tombstoned,
--      never hard-deleted, §8). The table-level GRANT already covers the new column, so no
--      role migration is needed. The session service does not read puzzles, so no reader.
--   2. Two indexes for the list queries: memberships(user_id) for `GET /games`
--      (WHERE user_id = $1), puzzles(created_by, created_at) for `GET /puzzles`
--      (WHERE created_by = $1 ORDER BY created_at DESC).
ALTER TABLE "puzzles" ADD COLUMN "created_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "puzzles" ADD CONSTRAINT "puzzles_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "puzzles_created_by_created_at_idx" ON "puzzles" USING btree ("created_by","created_at");