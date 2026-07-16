-- Expand-only (DESIGN.md §9 single writer: API; §11 expand/contract; INV-7). Persist each user's
-- personal reaction set, the five emoji their client offers to send (PROTOCOL.md §9, §12; DESIGN.md
-- D25). A jsonb string array, the schema's idiom for a small string array (game_state.recent_command_ids).
-- Nullable, no default, no backfill: existing and new rows read null, which means the five defaults
-- (PROTOCOL.md §9), so no row needs a write to render the defaults. Byte-exact: graphemes are stored
-- as given, never normalized, and they are not solutions, so INV-6 is untouched. The API owns users
-- (single writer), so the table-level GRANT already covers the new column and no role migration is
-- needed; the session service does not read it (a react carries the grapheme itself), so there is no
-- reader migration either.
ALTER TABLE "users" ADD COLUMN "reaction_set" jsonb;
