// The silent sign-in single-flight and its stand-down guards, factored out of the
// worker so the concurrency rules are testable without a chrome-stubbed background.
// The worker owns a SilentSignIn and calls run(); it also reports whether an
// interactive sign-in is in flight, and supplies the attempt itself. The rules:
//
//   - never run two silent attempts at once (single-flight; a second run() shares
//     the first's promise),
//   - never run while an interactive sign-in is in flight (it would race to persist),
//   - never run while already signed in (there is a session; nothing to attempt).
//
// A stood-down or failed run resolves { ok: false }. It NEVER signs out and NEVER
// throws: the extension was signed out before the attempt, so a failure loses nothing.

import type { SilentSignInReply } from "./messages";

export interface SilentDeps {
  /** True while the interactive button flow is mid-flight in this worker. */
  readonly interactiveInFlight: () => boolean;
  /** True when a session is already stored (loadSession(area) !== null). */
  readonly alreadySignedIn: () => Promise<boolean>;
  /**
   * Run one interactive:false PKCE attempt and, on success, arm the alarm. Resolves
   * ok on a persisted session, failed otherwise. This is where runPkceAttempt lives.
   */
  readonly attempt: () => Promise<SilentSignInReply>;
}

/** Holds the in-flight silent attempt so concurrent callers share one flow. */
export class SilentSignIn {
  private inflight: Promise<SilentSignInReply> | null = null;

  constructor(private readonly deps: SilentDeps) {}

  run(): Promise<SilentSignInReply> {
    this.inflight ??= this.once().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async once(): Promise<SilentSignInReply> {
    try {
      if (this.deps.interactiveInFlight()) return { ok: false };
      if (await this.deps.alreadySignedIn()) return { ok: false };
      return await this.deps.attempt();
    } catch {
      // Belt and suspenders: any unexpected throw is still a silent non-event.
      return { ok: false };
    }
  }
}
