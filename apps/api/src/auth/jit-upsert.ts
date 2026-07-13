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
 * flip an already-permanent user back to a guest.
 *
 * `display_name` mirrors the name the token carries (DESIGN.md §8): the provider metadata name
 * when present, else `"Guest"` for an anonymous user, else null. On conflict the app-DB name is
 * authoritative and a token name only seeds a null or is adopted on the guest -> permanent
 * upgrade (DESIGN.md name-onboarding R1): the guest-upgrade branch drops the `"Guest"` default and
 * adopts the provider name (or null, which arms onboarding); the established-row branch keeps the
 * app-DB value and lets a token name FILL a null only. A provider rename no longer overwrites a
 * name a user set via `PATCH /me` (INV-7, the user owns the name). SET reads the pre-update row,
 * so `users.is_anonymous` is the OLD value and the upgrade branch fires only on the first
 * post-upgrade token; monotonic `is_anonymous` sends later stale-guest tokens down the ELSE, which
 * keeps the adopted name.
 *
 * `avatar` mirrors the avatar the auth port already resolved (DESIGN.md §8): the provider metadata
 * avatar, else a Gravatar URL derived server-side from the email, else null. Resolution is the
 * port's, so this is the same single-writer mirror as the name and never sees the email (the port
 * hashed it and never returned it, INV-6 spirit). It uses the same `coalesce` on conflict, so a
 * token that momentarily omits the avatar (a lagging refresh) never clobbers one we already know,
 * while a changed avatar propagates on the next request. The value the session reads from
 * `users.avatar` is exactly what surfaces on the participant payload (PROTOCOL.md §4).
 *
 * The soft-delete tombstone (see identity/deletion.ts) nulls `display_name` and `avatar`; in
 * practice they stay null because a deleted user stops authenticating, so nothing re-runs this
 * upsert for them. If a tombstoned user ever re-authenticates, re-mirroring here is the deliberate
 * reactivation of that account, not a leak.
 */
export async function jitUpsertUser(
  db: Db,
  identity: Identity,
): Promise<{ created: boolean }> {
  const displayName =
    identity.displayName ?? (identity.isAnonymous ? "Guest" : null);
  const rows = await db
    .insert(schema.users)
    .values({
      userId: identity.userId,
      isAnonymous: identity.isAnonymous,
      displayName,
      avatar: identity.avatarUrl,
    })
    .onConflictDoUpdate({
      target: schema.users.userId,
      set: {
        isAnonymous: sql`${schema.users.isAnonymous} and excluded.is_anonymous`,
        displayName: sql`CASE
          WHEN ${schema.users.isAnonymous} AND NOT excluded.is_anonymous THEN excluded.display_name
          ELSE coalesce(${schema.users.displayName}, excluded.display_name)
        END`,
        avatar: sql`coalesce(excluded.avatar, ${schema.users.avatar})`,
      },
    })
    // xmax = 0 on the RETURNING row means this call inserted the user (a first sighting), not
    // updated an existing one: the once-per-user signal the signup starter-seed keys on.
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return { created: rows[0]?.inserted ?? false };
}
