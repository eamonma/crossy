-- Starter-seed features backfill (DESIGN.md §8 signup path; PROTOCOL.md §12 `GET /puzzles`).
-- The signup starter seed (apps/api starter/seed) inserted the starter puzzle without a
-- `features` value, so rows landed on the column default `'{}'::jsonb`. `GET /puzzles`
-- returns `features` verbatim, and the iOS twin (CrossyProtocol.PuzzleFeatures) decodes
-- rebus/circles/shadedCircles as required keys, so one empty object failed the decode of
-- the caller's entire puzzles page. The seed now states the starter's real flags (one
-- circled cell, no rebus); this backfills the rows written before the fix.
--
-- Scope: ingestion (the only other writer; the API is the single writer on puzzles,
-- INV-7) always writes detected features, so `'{}'` identifies seeded rows exactly;
-- title/author narrow it to the starter for safety. A handful of rows, equality
-- predicates, idempotent: safe to ride the pipeline (allowlisted with this reasoning in
-- deploy/migration-guard.mjs). Data-only; the column default's removal is a later
-- contract-phase migration, once no deployed writer can lean on it.
UPDATE "puzzles"
   SET "features" = '{"rebus":false,"circles":true,"shadedCircles":false}'::jsonb
 WHERE "features" = '{}'::jsonb
   AND "title" = 'Warm-up'
   AND "author" = 'Crossy';
