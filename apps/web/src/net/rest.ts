// REST callers on the core API, bearer-authenticated with the same tokens as the socket
// (PROTOCOL.md section 12). The game loader in LiveApp fetches inline; the writes a control needs
// live here so the UI calls one named function and reads a plain result, never a status code. The
// pattern mirrors the loader: `${apiBase}/games/...` with an Authorization bearer header, and a
// failure body of `{ error, message }` turned into a sentence for the app's error surface.

export type RestResult = { ok: true } | { ok: false; message: string };

/**
 * Kick a member: `DELETE /games/{id}/members/{userId}` (host only). The server removes the
 * membership, writes the denylist, and disconnects the live socket; the kicked client reacts to
 * its own `kicked` frame, which this never touches. A 403 is the server saying no (a non-host
 * caller, or a host targeting themselves), surfaced plainly. Any other failure reads as a generic
 * retry line, since the code is the API's contract, never something the host should see.
 */
export async function kickMember(opts: {
  apiBase: string;
  gameId: string;
  userId: string;
  token: string;
}): Promise<RestResult> {
  const res = await fetch(
    `${opts.apiBase}/games/${opts.gameId}/members/${opts.userId}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${opts.token}` },
    },
  );
  if (res.ok) return { ok: true };
  if (res.status === 403) {
    return { ok: false, message: "The server wouldn't remove them." };
  }
  return {
    ok: false,
    message: "We couldn't remove them. Give it another try.",
  };
}
