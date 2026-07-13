// Host room-admin controls, the web port of the iOS facts-card operations (RoomFactsCard.swift)
// and roster kick (RosterMenu.swift). Two REST mutations the API already owns (PROTOCOL.md §12):
// `POST /games/{id}/abandon` (host-only end game) and `DELETE /games/{id}/members/{userId}`
// (host-only kick, never the host's own row). No new endpoint, no new wire field: this module
// only calls what CrossyAPIClient already calls on iOS.
//
// Pure gating first (host, not-self), mirroring RosterList.selfIsHost/canKick byte for byte in
// spirit so a host sees the same affordances on both platforms; the server enforces host-only
// and self-target regardless (FORBIDDEN), so this only decides what the UI offers.
import type { StackMember } from "./primitives";
import type { Bearer } from "../net/authedFetch";
import { authedFetch } from "../net/authedFetch";

interface RoomMember {
  userId: string;
  role: "host" | "solver" | "spectator";
}

/**
 * The Players panel split by presence (PROTOCOL.md §4: each `Participant` carries `connected`;
 * no wire change): the people here now lead, the away members gather below. Pure data in, pure
 * data out; the panel renders the two lists and skips the away heading when it is empty (no
 * ghost heading). Store order is preserved within each section (the caller already ordered self
 * first, PR #130), so the split only groups, never reshuffles.
 *
 * Away membership follows the AvatarStack display rule (primitives.tsx) byte for byte so the two
 * surfaces agree: a disconnected member joins the away section only when it holds host or solver,
 * or it is self. A disconnected spectator (a guest who wandered off, PROTOCOL.md §12 seats guests
 * as spectators) is dropped from both sections, never a permanent away ghost. Self is always kept,
 * connected or not, and self is always online here (the viewer is by definition present).
 */
export function partitionRoster(
  members: readonly StackMember[],
  selfUserId: string | null,
): { online: readonly StackMember[]; away: readonly StackMember[] } {
  const online: StackMember[] = [];
  const away: StackMember[] = [];
  for (const m of members) {
    const isSelf = m.userId === selfUserId;
    if (m.connected || isSelf) {
      online.push(m);
      continue;
    }
    // Disconnected and not self: away only when they hold a seat that persists as a ghost
    // (host or solver). A disconnected guest-spectator drops out entirely (AvatarStack's rule).
    if (m.role === "host" || m.role === "solver") away.push(m);
  }
  return { online, away };
}

/** Whether the local participant is the host: gates End game and the kick affordance. */
export function isHost(
  members: readonly RoomMember[],
  selfUserId: string | null,
): boolean {
  if (selfUserId === null) return false;
  return members.find((m) => m.userId === selfUserId)?.role === "host";
}

/** Whether the host may kick this member: everyone but the host's own row (the server refuses
 * a self-target with FORBIDDEN; the UI never offers it). */
export function canKick(
  member: RoomMember,
  selfUserId: string | null,
): boolean {
  if (selfUserId === null) return false;
  return member.userId !== selfUserId;
}

/**
 * End the game (host abandon, `POST /games/{id}/abandon`). Terminal state, executed via the
 * session service; a no-op if the game is already terminal (INV-4). Throws on any non-2xx
 * (including a non-host's FORBIDDEN) so the caller surfaces a failure rather than staying silent.
 */
export async function abandonGame(
  apiBase: string,
  bearer: Bearer,
  gameId: string,
): Promise<void> {
  const res = await authedFetch(bearer, `${apiBase}/games/${gameId}/abandon`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`POST /games/${gameId}/abandon ${res.status}`);
}

/**
 * Kick a member (host-only, `DELETE /games/{id}/members/{userId}`). Removes membership and
 * writes the denylist in one transaction server-side, then disconnects their live socket
 * best-effort; a kicked user's invite link stops working even if the disconnect never lands
 * (the denylist is checked at their next connect, PROTOCOL.md §2). Throws on any non-2xx.
 */
export async function kickMember(
  apiBase: string,
  bearer: Bearer,
  gameId: string,
  userId: string,
): Promise<void> {
  const res = await authedFetch(
    bearer,
    `${apiBase}/games/${gameId}/members/${userId}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(`DELETE /games/${gameId}/members/${userId} ${res.status}`);
  }
}
