// The internal membership-changed handler (DESIGN.md §6, INV-8). The API is the single writer
// on memberships and the denylist; when it commits a change it signals the session here so a
// live actor enforces the new authoritative state. The session verifies, never mutates:
//
//  - The request body is only a hint. For a kick or role change the session re-reads
//    membership and the denylist from Postgres and acts on that, so a leaked bearer cannot
//    assert a membership fact; its blast radius stays a forced re-verification or disconnect.
//  - Kick or role change touches only the LIVE actor's connected sockets: denied users are
//    disconnected, the rest have their cached role refreshed. A passivated game has no live
//    actor, so this is a no-op (the denylist plus connect-time re-verify enforce it at the
//    next connect, PROTOCOL.md §2), which is why this path never hydrates.
//  - Abandon hydrates the actor on demand (only the actor may write game_state) and abandons
//    it, which emits and synchronously flushes gameAbandoned; a no-op on a terminal game
//    (INV-4).
import type { Pool } from "pg";
import type { ActorRegistry } from "./registry";
import { findRole, isDenied } from "./repo";

/** The membership-changed request body (DESIGN.md §6). Every field is a hint, never authority. */
export interface MembershipChangedBody {
  readonly change: "kick" | "role" | "abandon";
  readonly userId?: string;
  readonly by?: string;
}

export interface InternalDeps {
  readonly pool: Pool;
  readonly registry: ActorRegistry;
}

/** Parse and validate the request body into a `MembershipChangedBody`, or `null` if malformed. */
export function parseMembershipChangedBody(
  raw: unknown,
): MembershipChangedBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const change = (raw as { change?: unknown }).change;
  if (change !== "kick" && change !== "role" && change !== "abandon") {
    return null;
  }
  const userId = (raw as { userId?: unknown }).userId;
  const by = (raw as { by?: unknown }).by;
  return {
    change,
    ...(typeof userId === "string" ? { userId } : {}),
    ...(typeof by === "string" ? { by } : {}),
  };
}

/**
 * Apply a membership change signaled by the API. The session re-reads authoritative state and
 * enforces it on live sockets; it never mutates membership (INV-8).
 */
export async function applyMembershipChange(
  deps: InternalDeps,
  gameId: string,
  body: MembershipChangedBody,
): Promise<void> {
  if (body.change === "abandon") {
    // Hydrate on demand so a passivated game can still be abandoned (only the actor writes
    // game_state). Abandon is a no-op on a terminal game (INV-4).
    const actor = await deps.registry.getOrHydrate(gameId);
    if (actor !== null) await actor.abandon(body.by ?? "");
    return;
  }

  // Kick or role change: re-verify the live actor's connected users. No live actor means a
  // passivated game, which the denylist plus connect-time re-verify already enforce.
  const actor = await deps.registry.getIfLive(gameId);
  if (actor === null) return;
  for (const userId of actor.connectedUserIds()) {
    if (await isDenied(deps.pool, gameId, userId)) {
      actor.disconnectUser(userId, "removed from this game");
      continue;
    }
    const role = await findRole(deps.pool, gameId, userId);
    if (role === null) actor.disconnectUser(userId, "no longer a member");
    else actor.setUserRole(userId, role);
  }
}
