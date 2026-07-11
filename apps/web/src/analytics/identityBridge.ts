// The identity-to-analytics bridge, wired once at boot (main.tsx) and never inside a
// component: the analytics distinctId tracks the identity session (always the
// provider-issued userId, ANALYTICS.md), and components see neither the vendor nor the
// bridge.
//
// Three wire cases, the same on every client so the vocabulary means one thing
// (ANALYTICS.md): a persisted session restoring identifies and captures nothing; an
// interactive sign-in completing identifies and captures signed_in; a sign-out resets.
// signed_in is double-gated, on cause === "signed_in" AND the observed no-session to
// session edge, so a vendor re-emission of SIGNED_IN against a standing session (the
// supabase tab-refocus quirk, supabaseAdapter.ts causeOf) can never re-capture.
import type { Identity } from "../identity";
import type { Analytics } from "./types";

export function bridgeIdentityToAnalytics(
  identity: Identity,
  analytics: Analytics,
): void {
  let prev = identity.getSession();
  // A session already standing when the bridge wires (a mock with an initial session)
  // is a restore by definition: identify it, capture nothing.
  if (prev !== null) {
    analytics.identify(prev.userId, { isAnonymous: prev.isAnonymous });
  }
  identity.onChange((session, cause) => {
    if (session === null) {
      analytics.reset();
      prev = null;
      return;
    }
    analytics.identify(session.userId, { isAnonymous: session.isAnonymous });
    if (cause === "signed_in" && prev === null) analytics.capture("signed_in");
    prev = session;
  });
}
