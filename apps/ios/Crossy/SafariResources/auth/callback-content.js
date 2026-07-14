"use strict";
(() => {
  // src/auth/callback.ts
  var AUTH_CALLBACK = "crossy/auth/callback";

  // src/auth/callback-content.ts
  void chrome.runtime.sendMessage({ type: AUTH_CALLBACK, url: window.location.href }).catch(() => void 0);
})();
