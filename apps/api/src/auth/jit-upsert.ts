// Just-in-time identity mirror (DESIGN.md §8). The provider owns authentication; we own a
// `users` row keyed by the same UUID, materialized on the first authenticated request. The
// API is the single writer on `users` (INV-7), so this is the only place the row is born.
import { sql } from "drizzle-orm";
import { schema } from "@crossy/db";
import type { Identity } from "@crossy/auth";
import type { Db } from "../db/client";

/**
 * Upsert the identity into `users`. `is_anonymous` is monotonic: a user becomes permanent
 * once any token presents `is_anonymous:false` and never reverts, so the one-token-lifetime
 * lag after a guest upgrade (SP1, where a still-valid pre-upgrade token reads `true`) cannot
 * flip an already-permanent user back to a guest. Display name and avatar are left as the
 * provider supplies them later; this slice mirrors only the two claims `verify` resolves.
 */
export async function jitUpsertUser(db: Db, identity: Identity): Promise<void> {
  await db
    .insert(schema.users)
    .values({ userId: identity.userId, isAnonymous: identity.isAnonymous })
    .onConflictDoUpdate({
      target: schema.users.userId,
      set: {
        isAnonymous: sql`${schema.users.isAnonymous} and excluded.is_anonymous`,
      },
    });
}
