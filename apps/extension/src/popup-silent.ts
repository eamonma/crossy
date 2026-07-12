// The popup's signed-out silent-sign-in trigger, as pure orchestration so it tests
// without a DOM rig (the popup itself has no test harness; its logic is exercised
// here). When the popup opens signed out, it asks the worker for a silent sign-in and
// shows a quiet "checking" state meanwhile. On success it re-runs init (the worker has
// persisted a session, so init reads signed-in). On failure or timeout it falls back
// to the provider buttons. The attempt is time-boxed so a hung request still yields
// the buttons promptly.

import type { SilentSignInReply } from "./auth/messages";

export interface SilentTriggerDeps {
  /** Ask the worker to try a silent sign-in (AUTH_SILENT_SIGN_IN round-trip). */
  readonly requestSilent: () => Promise<SilentSignInReply>;
  /** Paint the quiet transient state: status text, no buttons. */
  readonly showChecking: () => void;
  /** Success path: re-run init so the stored session renders signed-in. */
  readonly onSignedIn: () => void;
  /** Failure/timeout path: render the normal provider buttons. */
  readonly onSignedOut: () => void;
  /** Cap on the attempt; resolves the race with a failed reply. */
  readonly timeoutMs: number;
  /** setTimeout, injectable for deterministic tests. */
  readonly setTimeoutFn?: typeof setTimeout;
}

/** Resolve to a failed silent reply after ms, so a hung request cannot hang the UI. */
function failAfter(
  ms: number,
  setTimeoutFn: typeof setTimeout,
): Promise<SilentSignInReply> {
  return new Promise((resolve) => {
    setTimeoutFn(() => resolve({ ok: false }), ms);
  });
}

/**
 * Run the silent attempt behind the checking state and render the outcome. A rejected
 * request (worker unreachable) and a timeout both land as signed-out, never as an
 * error: the extension had no session to begin with, so there is nothing to report.
 */
export async function silentSignInThenRender(
  deps: SilentTriggerDeps,
): Promise<void> {
  const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
  deps.showChecking();
  let reply: SilentSignInReply;
  try {
    reply = await Promise.race([
      deps.requestSilent(),
      failAfter(deps.timeoutMs, setTimeoutFn),
    ]);
  } catch {
    reply = { ok: false };
  }
  if (reply.ok) deps.onSignedIn();
  else deps.onSignedOut();
}
