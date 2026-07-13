// The live loader's INV-11 gate decision, extracted pure so the invariant is testable under the
// node vitest env (the loader in LiveApp.tsx owns React and the fetch; this owns the rule, the
// same split completionAttribution.ts keeps from CompletedMosaic.tsx).
//
// INV-11 (DESIGN.md): "Sessions outlive access tokens. Sign-in surfaces render only when the
// identity port's session is null (a true sign-out), never on a transient token, HTTP, or
// transport failure." The sign-in gate is therefore a true sign-out only. A 401 that survives the
// refresh-and-retry seam while a session still stands, or a transport failure, is not a sign-out:
// it surfaces as a recoverable error, never the gate.

/**
 * True iff the live loader should show the sign-in gate: no `?token=` override (the smoke and
 * dogfood ride a fixed token, so they never gate) AND no session. `hasSession` is
 * `identity.getSession() !== null`; the identity port is authoritative on whether the user is
 * signed out (INV-11), so a lost token on a standing session yields false here.
 */
export function isSignedOut(
  tokenParam: string | null,
  hasSession: boolean,
): boolean {
  return tokenParam === null && !hasSession;
}
