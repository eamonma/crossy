// The worker side of the pill's play click (D22): check the API-origin grant,
// mint a fresh token through the existing session path, POST the envelope, open
// the play intent. Dependencies are injected so the decision tree tests pure.
//
// Permission law: a content script cannot call permissions.request, and a message
// handler in the worker holds no user gesture, so this path only ever CHECKS the
// grant (permissions.contains). A missing grant answers "no_permission" and the
// pill defers to the toolbar popup, the invariant path, whose click can request.

import type { IngestOutcome } from "../api";
import type { TokenReply } from "../auth/messages";
import type { Envelope } from "../envelope";
import { originPattern } from "../settings";
import type { PlayReply } from "./messages";

export interface PlayDeps {
  readonly apiBaseUrl: string;
  readonly containsOrigins: (origins: readonly string[]) => Promise<boolean>;
  readonly freshAccessToken: () => Promise<TokenReply>;
  readonly postPuzzle: (
    apiBaseUrl: string,
    token: string,
    envelope: Envelope,
  ) => Promise<IngestOutcome>;
  /** Where "Play in Crossy" lands: the web intent, or the app scheme on iOS. Injected so
   * the platform choice lives in the worker and this decision tree stays pure. */
  readonly playUrl: (puzzleId: string) => string;
  readonly openTab: (url: string) => Promise<void>;
}

export async function handlePlayRequest(
  envelope: Envelope,
  deps: PlayDeps,
): Promise<PlayReply> {
  const granted = await deps.containsOrigins([originPattern(deps.apiBaseUrl)]);
  if (!granted) return { ok: false, reason: "no_permission" };

  const token = await deps.freshAccessToken();
  if (!token.ok) return { ok: false, reason: token.reason };

  let outcome: IngestOutcome;
  try {
    outcome = await deps.postPuzzle(
      deps.apiBaseUrl,
      token.accessToken,
      envelope,
    );
  } catch {
    return { ok: false, reason: "network" };
  }
  if (!outcome.ok) {
    // The named rejection, verbatim (PROTOCOL.md section 12).
    return {
      ok: false,
      reason: "rejected",
      code: outcome.code,
      message: outcome.message,
    };
  }
  await deps.openTab(deps.playUrl(outcome.puzzleId));
  return { ok: true };
}
