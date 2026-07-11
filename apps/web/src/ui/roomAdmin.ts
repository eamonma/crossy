// Host room-admin controls, the web port of the iOS facts-card operations (RoomFactsCard.swift)
// and roster kick (RosterMenu.swift). Two REST mutations the API already owns (PROTOCOL.md §12):
// `POST /games/{id}/abandon` (host-only end game) and `DELETE /games/{id}/members/{userId}`
// (host-only kick, never the host's own row). No new endpoint, no new wire field: this module
// only calls what CrossyAPIClient already calls on iOS.
//
// Pure gating first (host, not-self), mirroring RosterList.selfIsHost/canKick byte for byte in
// spirit so a host sees the same affordances on both platforms; the server enforces host-only
// and self-target regardless (FORBIDDEN), so this only decides what the UI offers.
import type { TokenSource } from "./homeData";

interface RoomMember {
  userId: string;
  role: "host" | "solver" | "spectator";
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

async function authHeaders(
  getToken: TokenSource,
): Promise<Record<string, string>> {
  const token = await getToken();
  if (token === null) throw new Error("signed out: no bearer to send");
  return { authorization: `Bearer ${token}` };
}

/**
 * End the game (host abandon, `POST /games/{id}/abandon`). Terminal state, executed via the
 * session service; a no-op if the game is already terminal (INV-4). Throws on any non-2xx
 * (including a non-host's FORBIDDEN) so the caller surfaces a failure rather than staying silent.
 */
export async function abandonGame(
  apiBase: string,
  getToken: TokenSource,
  gameId: string,
): Promise<void> {
  const res = await fetch(`${apiBase}/games/${gameId}/abandon`, {
    method: "POST",
    headers: await authHeaders(getToken),
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
  getToken: TokenSource,
  gameId: string,
  userId: string,
): Promise<void> {
  const res = await fetch(`${apiBase}/games/${gameId}/members/${userId}`, {
    method: "DELETE",
    headers: await authHeaders(getToken),
  });
  if (!res.ok) {
    throw new Error(`DELETE /games/${gameId}/members/${userId} ${res.status}`);
  }
}
