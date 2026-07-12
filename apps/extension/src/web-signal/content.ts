// Content script on crossy.party (manifest match; Firefox opt-in, DESIGN.md). At
// document_idle it makes one best-effort read: does the web app hold a live Supabase
// session? If so it asks the worker to try a silent sign-in, which the worker runs
// only when the extension is itself signed out. This is the "automatic" half of
// web-to-extension SSO; the popup trigger is the invariant half.
//
// The signal that crosses to the worker is a single boolean. This script never reads,
// forwards, or logs the web session's tokens. The extension mints its OWN session via
// its OWN PKCE flow off the back of this hint; it never borrows the web app's tokens.

import { AUTH_SILENT_SIGN_IN } from "../auth/messages";
import { webSessionPresent } from "./detect";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

if (webSessionPresent(window.localStorage, nowSec())) {
  // Fire and forget: the worker no-ops when already signed in or mid-flight, and a
  // failed silent attempt has no session to lose (background.ts). Nothing to render
  // on the page, so any messaging error is swallowed.
  void chrome.runtime
    .sendMessage({ type: AUTH_SILENT_SIGN_IN })
    .catch(() => undefined);
}
