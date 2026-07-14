// One seam over "run the OAuth flow and hand back the captured redirect URL", so the
// attempt (attempt.ts) stays identical across browsers. Chrome and Firefox use
// identity.launchWebAuthFlow; Safari has no identity API at all, so it opens a real tab to
// the hosted callback and waits for that page's content script to report the code
// (callback.ts). runPkceAttempt only ever sees redirectUri plus a launch that resolves a
// URL string or undefined; it never knows which browser it is on. The extension keeps its
// OWN independent, rotating session on every browser; only the redirect capture differs.

import type { PendingCaptures } from "./callback";

export interface AuthLauncher {
  /** redirect_to for the authorize URL: identity.getRedirectURL() or the hosted page. */
  readonly redirectUri: string;
  /**
   * Run the flow and resolve the captured redirect URL, or undefined on a cancel. A
   * silent (interactive:false) attempt must complete with no visible UI or resolve
   * undefined; a launcher with no silent capability resolves undefined without opening
   * anything.
   */
  capture(
    authorizeUrl: string,
    interactive: boolean,
  ): Promise<string | undefined>;
}

/** The slice of the WebExtensions identity API the launcher needs. */
export interface IdentityLike {
  getRedirectURL(): string;
  launchWebAuthFlow(details: {
    url: string;
    interactive: boolean;
  }): Promise<string | undefined>;
}

/** Chrome and Firefox: the identity flow, unchanged. Silent works on Chrome; on Firefox
 * interactive:false throws and the attempt reads it as a quiet failure, as before. */
export function identityLauncher(identity: IdentityLike): AuthLauncher {
  return {
    redirectUri: identity.getRedirectURL(),
    capture: (url, interactive) =>
      identity.launchWebAuthFlow({ url, interactive }),
  };
}

/** The browser primitives the tab launcher drives, injected so the launcher stays pure. */
export interface TabLauncherDeps {
  readonly redirectUri: string;
  readonly pending: PendingCaptures;
  /** Open the authorize URL in a new tab; resolve its id, or undefined if none came back. */
  createTab(url: string): Promise<number | undefined>;
  /** Best-effort close the auth tab once the capture settles. */
  removeTab(tabId: number): Promise<void>;
  /** How long to wait for the redirect before giving up (read as a cancel). */
  readonly timeoutMs: number;
  /** Injected one-shot timer; returns a canceller. setTimeout in the worker. */
  startTimer(ms: number, onFire: () => void): () => void;
}

/**
 * Safari: interactive only. Open the authorize URL in a tab, await the callback page's
 * report keyed by that tab, then close the tab. interactive:false resolves undefined at
 * once: a tab is always visible, so there is no silent path. Safari behaves like Firefox
 * here, and the popup offers the one-click "continue as <name>" instead.
 */
export function tabRedirectLauncher(deps: TabLauncherDeps): AuthLauncher {
  return {
    redirectUri: deps.redirectUri,
    capture: async (authorizeUrl, interactive) => {
      if (!interactive) return undefined;
      const tabId = await deps.createTab(authorizeUrl);
      if (tabId === undefined) return undefined;
      // Register after create: the tab has only just opened, and the authorize ->
      // provider -> GoTrue -> callback chain needs a user gesture, so the report cannot
      // land before this waiter is in place.
      const waiter = deps.pending.register(tabId);
      const cancelTimer = deps.startTimer(deps.timeoutMs, () =>
        deps.pending.cancel(tabId),
      );
      try {
        return await waiter;
      } finally {
        cancelTimer();
        await deps.removeTab(tabId);
      }
    },
  };
}
