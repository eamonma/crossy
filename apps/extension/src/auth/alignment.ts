// The alignment decision: is the extension's own account the same as the crossy.party
// web account, and if not, what should the popup do about it? Pure, so it is tested
// without any chrome stubs. The extension and the web app hold separate sessions by
// design; they are ALIGNED when they resolve to the same Supabase user. A puzzle the
// extension ingests is owned by the extension's account (POST /puzzles created_by), and
// the web library is scoped to the web account, so a mismatch means ingested puzzles
// never appear where the user plays. This computes which of four popup states to show.

import type { Provider } from "./flow";
import type { WebIdentity } from "./messages";

export type AlignmentState =
  /** Signed out, no steerable web account: the plain provider buttons. */
  | { readonly kind: "signed-out" }
  /** Signed out, but the web app is signed in: offer one-click "continue as <name>". */
  | {
      readonly kind: "connect";
      readonly provider: Provider;
      readonly name: string;
    }
  /** Signed in, and either matching the web account or with no web account to compare. */
  | { readonly kind: "aligned" }
  /** Signed in as a DIFFERENT account than the web app: warn and offer to switch. */
  | {
      readonly kind: "mismatch";
      readonly provider: Provider;
      readonly name: string;
    };

/**
 * Decide the popup's alignment state from the extension's own session (its userId, or
 * null when signed out) and the last-known web account (or null). A mismatch is only
 * asserted when BOTH ids are known and differ: an unknown extension userId (a refresh
 * response can omit the user object) never fabricates a false warning.
 */
export function alignmentState(
  session: { readonly userId: string | null } | null,
  web: WebIdentity | null,
): AlignmentState {
  if (session === null) {
    return web === null
      ? { kind: "signed-out" }
      : { kind: "connect", provider: web.provider, name: web.displayName };
  }
  if (web === null) return { kind: "aligned" };
  if (session.userId !== null && session.userId !== web.userId) {
    return { kind: "mismatch", provider: web.provider, name: web.displayName };
  }
  return { kind: "aligned" };
}
