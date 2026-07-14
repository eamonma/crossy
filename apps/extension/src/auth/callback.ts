// Safari sign-in redirect capture. Safari has no identity.launchWebAuthFlow and refuses
// to redirect an OAuth provider to a custom-scheme (extension) URL, so the redirect lands
// on a hosted https page whose content script hands the whole URL back to the worker
// (callback-content.ts). This registry pairs the tab the worker opened with the promise
// runPkceAttempt is awaiting: deliver() resolves it with the captured redirect (?code=),
// cancel() resolves it undefined (a user close or a timeout, read as a cancel). Keyed by
// tab id because the authorize -> provider -> GoTrue -> callback chain all runs in the one
// tab the worker opened, so its id is stable across the redirects.

export const AUTH_CALLBACK = "crossy/auth/callback" as const;

export interface AuthCallbackRequest {
  readonly type: typeof AUTH_CALLBACK;
  /** The full callback URL as loaded, carrying ?code= on success or ?error= on failure. */
  readonly url: string;
}

/**
 * The worker's set of in-flight tab captures. Pure and self-contained: the tabs API and
 * the timer live in background.ts, this only tracks which tab is awaiting which resolver.
 * A capture promise NEVER rejects; a failure to capture resolves undefined, which
 * runPkceAttempt reads as a cancel.
 */
export class PendingCaptures {
  private readonly waiters = new Map<
    number,
    (url: string | undefined) => void
  >();

  /**
   * Await the redirect for a tab. A second register for the same tab cancels the first
   * (its flow was abandoned), so at most one capture is ever pending per tab.
   */
  register(tabId: number): Promise<string | undefined> {
    this.settle(tabId, undefined);
    return new Promise((resolve) => {
      this.waiters.set(tabId, resolve);
    });
  }

  /** Resolve the tab's waiter with the captured redirect URL. False if none is pending. */
  deliver(tabId: number, url: string): boolean {
    return this.settle(tabId, url);
  }

  /** Resolve the tab's waiter as a cancel (undefined). False if none is pending. */
  cancel(tabId: number): boolean {
    return this.settle(tabId, undefined);
  }

  private settle(tabId: number, value: string | undefined): boolean {
    const resolve = this.waiters.get(tabId);
    if (resolve === undefined) return false;
    this.waiters.delete(tabId);
    resolve(value);
    return true;
  }
}
