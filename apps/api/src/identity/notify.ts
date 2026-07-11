// The cross-service membership signal (DESIGN.md §6). After the API commits a membership
// change (kick, role upgrade, abandon), it calls the session service so a live actor
// re-verifies and disconnects anyone no longer allowed, or executes an abandon. This helper
// wraps the injected notifier so a missing or failing notifier never throws into a route;
// the caller decides whether delivery was required.
//
// Delivery is not required for a kick or role change: the API-owned membership and denylist
// writes are already authoritative, so a kicked user is still refused at reconnect (denylist,
// PROTOCOL.md §2) even if the live disconnect never lands. It IS required for an abandon,
// which only the session actor can execute (it alone writes game_state, DESIGN.md §6), so the
// abandon route treats a `false` return as a fault.
import type { AppDeps, MembershipChange } from "../context";

/**
 * Signal a committed membership change to the session service. Returns `true` when the
 * notifier accepted it, `false` when no notifier is configured or the call failed (logged,
 * never thrown). Best-effort by design: the caller decides whether `false` is tolerable.
 */
export async function notifyMembership(
  deps: AppDeps,
  gameId: string,
  change: MembershipChange,
): Promise<boolean> {
  if (deps.membershipNotifier === undefined) return false;
  try {
    await deps.membershipNotifier.membershipChanged(gameId, change);
    return true;
  } catch (err) {
    console.error(
      `membership-changed notify failed for game ${gameId} (${change.change}):`,
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

/**
 * Signal that a Live Activity token just registered (PROTOCOL.md 12a), so the session hands the
 * fresh island the current authoritative frame. Fire-and-forget by design and never required: the
 * token upsert already committed, so a missing notifier or a failed call is logged and dropped, and
 * the TTL/debounce world keeps the activity current without the welcome. Returns nothing, since no
 * caller treats the outcome as a fault (unlike abandon).
 */
export async function notifyLiveActivityRegistered(
  deps: AppDeps,
  gameId: string,
  userId: string,
): Promise<void> {
  if (deps.membershipNotifier === undefined) return;
  try {
    await deps.membershipNotifier.liveActivityRegistered(gameId, userId);
  } catch (err) {
    console.error(
      `live-activity-registered notify failed for game ${gameId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
