// Host succession (DESIGN.md §7). When a host is tombstoned or deletes their account, the
// host role passes to the earliest-joined remaining solver; if none remains the game is
// auto-abandoned by the caller, so a game is never left unadministrable. This runs inside the
// deletion transaction (single writer on memberships, INV-7).
import { and, asc, eq, ne } from "drizzle-orm";
import { schema } from "@crossy/db";
import type { DbTx } from "../db/client";

/**
 * Promote the earliest-joined remaining solver of `gameId` to host, excluding the departing
 * user. Returns the new host's userId, or `null` when no solver remains (the caller then
 * auto-abandons the game). `games.created_by` is deliberately not updated: it is the
 * historical creator, while the authoritative host is the membership role.
 */
export async function succeedHost(
  tx: DbTx,
  gameId: string,
  departingUserId: string,
): Promise<string | null> {
  const candidate = await tx
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.gameId, gameId),
        eq(schema.memberships.role, "solver"),
        ne(schema.memberships.userId, departingUserId),
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
