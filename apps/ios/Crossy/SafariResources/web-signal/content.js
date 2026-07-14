"use strict";
(() => {
  // src/auth/messages.ts
  var AUTH_WEB_SIGNAL = "crossy/auth/web-signal";

  // src/auth/session.ts
  var APPLE_PRIVATE_RELAY_SUFFIX = "@privaterelay.appleid.com";
  function displayNameOf(user) {
    const meta = typeof user["user_metadata"] === "object" && user["user_metadata"] !== null ? user["user_metadata"] : {};
    for (const key of ["full_name", "name", "user_name", "preferred_username"]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim() !== "") return value;
    }
    const email = typeof user["email"] === "string" ? user["email"] : "";
    if (email !== "" && !email.endsWith(APPLE_PRIVATE_RELAY_SUFFIX)) {
      const local = email.split("@")[0];
      if (local !== void 0 && local !== "") return local;
    }
    return "Player";
  }

  // src/web-signal/detect.ts
  var SUPABASE_AUTH_KEY = /^sb-.*-auth-token$/;
  function steerableProvider(user) {
    const appMeta = typeof user["app_metadata"] === "object" && user["app_metadata"] !== null ? user["app_metadata"] : {};
    const provider = appMeta["provider"];
    return provider === "discord" || provider === "apple" ? provider : null;
  }
  function readWebIdentity(storage, nowSec2) {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key === null || !SUPABASE_AUTH_KEY.test(key)) continue;
      const raw = storage.getItem(key);
      if (raw === null) continue;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null) continue;
      const record = parsed;
      const expiresAt = record["expires_at"];
      if (typeof expiresAt !== "number" || expiresAt <= nowSec2) continue;
      const user = typeof record["user"] === "object" && record["user"] !== null ? record["user"] : null;
      if (user === null) continue;
      const userId = user["id"];
      if (typeof userId !== "string" || userId === "") continue;
      const provider = steerableProvider(user);
      if (provider === null) continue;
      return { userId, provider, displayName: displayNameOf(user) };
    }
    return null;
  }

  // src/web-signal/content.ts
  function nowSec() {
    return Math.floor(Date.now() / 1e3);
  }
  void chrome.runtime.sendMessage({
    type: AUTH_WEB_SIGNAL,
    identity: readWebIdentity(window.localStorage, nowSec())
  }).catch(() => void 0);
})();
