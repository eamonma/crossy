// Content script on crossy.party (manifest match; Firefox opt-in, DESIGN.md). At
// document_idle it makes one best-effort read of the web app's account and reports it
// to the worker: the identity (user id, provider, display name) when the web app is
// signed in with a steerable provider, or null when it is signed out. The worker
// stashes it so the popup can offer "continue as <name>" or warn on a mismatch, and
// steers a silent sign-in at the same account when the extension is itself signed out.
//
// This never reads, forwards, or logs the web session's tokens. Only the account's
// non-secret identity crosses to the worker. The extension mints its OWN session via
// its OWN PKCE flow off the back of this hint; it never borrows the web app's tokens.

import { AUTH_WEB_SIGNAL } from "../auth/messages";
import { readWebIdentity } from "./detect";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// Fire and forget: the worker stashes the identity and no-ops any steered attempt when
// already signed in or mid-flight (background.ts). Nothing to render on the page, so a
// messaging error is swallowed.
void chrome.runtime
  .sendMessage({
    type: AUTH_WEB_SIGNAL,
    identity: readWebIdentity(window.localStorage, nowSec()),
  })
  .catch(() => undefined);
