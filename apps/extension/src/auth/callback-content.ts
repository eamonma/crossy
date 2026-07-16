// Content script on the Safari sign-in callback page (manifest match, the pinned redirect
// path only). It reads the whole URL GoTrue redirected to (carrying ?code= on success or
// ?error= on failure) and hands it to the worker, which resolves the pending capture and
// runs the PKCE exchange (callback.ts, background.ts). It never reads, exchanges, or logs
// the code itself; the single-use code is spent by the worker. Chrome and Firefox never
// navigate here (they capture via identity), so this is dead weight there, harmless.

import { AUTH_CALLBACK } from "./callback";

void chrome.runtime
  .sendMessage({ type: AUTH_CALLBACK, url: window.location.href })
  .catch(() => undefined);
