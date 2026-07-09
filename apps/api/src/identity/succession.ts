// Host succession (DESIGN.md §7). When a host is tombstoned or deletes their account, the
// host role passes to the earliest-joined remaining solver; if none remains the game is
// auto-abandoned by the caller, so a game is never left unadministrable. This runs inside the
// deletion transaction (single writer on memberships, INV-7).
import { and, asc, eq, ne } from "drizzle-orm";
import { schema } from "@crossy/db";
import type { DbTx } from "../db/client";

/**
 * Promote the earliest-joined remaining solver of `gameId` to host, excluding the departing
 * user. Returns the new host's userId, or `null` when no eligible solver remains (the caller
 * then auto-abandons the game). `games.created_by` is deliberately not updated: it is the
 * historical creator, while the authoritative host is the membership role.
 *
 * Guests never inherit the host role (owner decision 2026-07-09, DESIGN.md §8). The candidate
 * join to `users` filtering `is_anonymous = false` is defense in depth: no anonymous user can
 * be a solver in the first place, since the sole solver upgrade (POST /games/{id}/role) is
 * full-account gated and join only ever seats a spectator, so this filter changes nothing for
 * valid data. It encodes the "no guest host" rule structurally at the promotion site rather
 * than resting on that upstream invariant, and it fails safe: a game whose only remaining
 * solver were somehow a guest is auto-abandoned, never handed to the guest.
 */
export async function succeedHost(
  tx: DbTx,
  gameId: string,
  departingUserId: string,
): Promise<string | null> {
  const candidate = await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.userId, schema.memberships.userId))
    .where(
      and(
        eq(schema.memberships.gameId, gameId),
        eq(schema.memberships.role, "solver"),
        ne(schema.memberships.userId, departingUserId),
        eq(schema.users.isAnonymous, false),
      ),
    )
    .orderBy(asc(schema.memberships.joinedAt))
    .limit(1);
  if (candidate.length === 0) return null;

  const successor = candidate[0]!.userId;
  await tx
    .update(schema.memberships)
    .set({ role: "host" })
    .where(
      and(
        eq(schema.memberships.gameId, gameId),
        eq(schema.memberships.userId, successor),
      ),
    );
  return successor;
}
