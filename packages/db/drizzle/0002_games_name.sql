-- Expand-only: add the optional room display name to games (DESIGN.md §9 single writer:
-- API). Nullable, no default, no backfill; existing games read as unnamed. It is user
-- content shown back verbatim, never normalized or compared, so no CHECK and INV-1 casing
-- does not apply. The session service reads games but not this column, so no reader migration.
ALTER TABLE "games" ADD COLUMN "name" text;