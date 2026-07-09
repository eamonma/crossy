-- Expand-only (DESIGN.md §9 single writer: API; §11 expand/contract). Persist the puzzle
-- display metadata the ingestion ACL parses (title, author) so the signed-in home lists can
-- show it. Both nullable, no default, no backfill: existing puzzles predate the columns and
-- read as untitled/anonymous. They are display content shown back verbatim, never normalized or
-- compared, so INV-1 casing does not apply and there is no CHECK; they are not solutions, so
-- INV-6 is untouched. The table-level GRANT already covers new columns, so no role migration is
-- needed, and the session service does not read puzzles, so there is no reader migration.
ALTER TABLE "puzzles" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "puzzles" ADD COLUMN "author" text;