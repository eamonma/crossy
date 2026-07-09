// Account deletion (DESIGN.md §8). Two operations, not one: removing the vendor identity is a
// Supabase admin (service_role) network call behind the injected `VendorIdentityPort`, and
// tombstoning the mirror row is a write to the API-owned `users` table (single writer, INV-7).
// The boundary decision that keeps deleteUser here, not on the shared `packages/auth` port, is
// recorded in that package: it is a rare admin mutation paired with an API-owned write, not the
// per-request verification the port exists for.
//
// The tombstone scrubs PII (display_name, avatar) and keeps the stable `user_id`, because
// `cell_events` is immutable and INV-1 replay plus INV-2 contiguity depend on the id surviving
// deletion. `cell_events.user_id` is ON DELETE NO ACTION and is never touched here, so the
// event log stays contiguous through deletion (DESIGN.md §9). Host succession (DESIGN.md §7)
// runs for every game the departing user hosts; a game with no eligible successor is
// auto-abandoned so it is never left unadministrable.
import { eq } from "drizzle-orm";
import { schema } from "@crossy/db";
import type { AppDeps } from "../context";
import { notifyMembership } from "./notify";
import { succeedHost } from "./succession";

export interface DeleteAccountResult {
  /** Games where a remaining solver was promoted to host. */
  readonly successions: number;
  /** Games auto-abandoned because no eligible successor remained (DESIGN.md §7). */
  readonly abandoned: readonly string[];
  /** Whether the vendor identity was deleted (false when no vendor port is configured; M3a). */
  readonly vendorDeleted: boolean;
}

/**
 * Delete `userId`'s account: succeed or auto-abandon every game they host, remove their
 * membership and denylist rows, tombstone the mirror row, then remove the vendor identity.
 * The DB writes are one transaction. Auto-abandons are signaled before the vendor call so a
 * vendor fault cannot strand an unadministrable game. A configured vendor port that throws
 * propagates, so the caller surfaces INTERNAL; an absent port (M3a local) is a skip.
 */
export async function deleteAccount(
  deps: AppDeps,
  userId: string,
): Promise<DeleteAccountResult> {
  // Games the user currently hosts, by the authoritative membership role (not games.created_by,
  // which stays the historical creator).
  const memberships = await deps.db
    .select({
      gameId: schema.memberships.gameId,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId));
  const hostGameIds = memberships
    .filter((m) => m.role === "host")
    .map((m) => m.gameId);

  const abandoned: string[] = [];
  let successions = 0;

  await deps.db.transaction(async (tx) => {
    for (const gameId of hostGameIds) {
      const successor = await succeedHost(tx, gameId, userId);
      if (successor === null) abandoned.push(gameId);
      else successions += 1;
    }
    // Remove the departing user's membership and denylist rows (DESIGN.md §8).
    await tx
      .delete(schema.memberships)
      .where(eq(schema.memberships.userId, userId));
    await tx
      .delete(schema.gameDenylist)
      .where(eq(schema.gameDenylist.userId, userId));
    // Tombstone: scrub PII, keep the stable id. cell_events is left untouched (DESIGN.md §9).
    await tx
      .update(schema.users)
      .set({ displayName: null, avatar: null })
      .where(eq(schema.users.userId, userId));
  });

  // Auto-abandon before the vendor call so a vendor fault cannot leave a game unadministrable.
  for (const gameId of abandoned) {
    await notifyMembership(deps, gameId, { change: "abandon", by: userId });
  }

  let vendorDeleted = false;
  if (deps.vendorIdentity !== undefined) {
    await deps.vendorIdentity.deleteUser(userId);
    vendorDeleted = true;
  }

  return { successions, abandoned, vendorDeleted };
}
