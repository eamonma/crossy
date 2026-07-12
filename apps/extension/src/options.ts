// Options page: advanced dev overrides only. The extension is production-configured
// out of the box (settings.ts bakes the API base, auth base, and publishable key);
// this page exists to point a dev build at a local stack. Saving requests the
// optional host permission for each overridden origin (on demand, inside the click
// gesture, never at install).

import {
  clearOverrides,
  DEFAULT_API_BASE,
  DEFAULT_AUTH_BASE,
  ensureOriginPermission,
  loadOverrides,
  normalizeBaseUrl,
  saveOverrides,
} from "./settings";
import type { Overrides } from "./settings";

const apiBaseUrlEl = document.getElementById("apiBaseUrl") as HTMLInputElement;
const authBaseUrlEl = document.getElementById(
  "authBaseUrl",
) as HTMLInputElement;
const publishableKeyEl = document.getElementById(
  "publishableKey",
) as HTMLInputElement;
const saveEl = document.getElementById("save") as HTMLButtonElement;
const resetEl = document.getElementById("reset") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

async function init(): Promise<void> {
  const overrides = await loadOverrides();
  apiBaseUrlEl.value = overrides.apiBaseUrl ?? "";
  authBaseUrlEl.value = overrides.authBaseUrl ?? "";
  publishableKeyEl.value = overrides.publishableKey ?? "";
  apiBaseUrlEl.placeholder = DEFAULT_API_BASE;
  authBaseUrlEl.placeholder = DEFAULT_AUTH_BASE;
}

saveEl.addEventListener("click", () => {
  const overrides: {
    apiBaseUrl?: string;
    authBaseUrl?: string;
    publishableKey?: string;
  } = {};

  if (apiBaseUrlEl.value.trim() !== "") {
    const normalized = normalizeBaseUrl(apiBaseUrlEl.value);
    if (normalized === null) {
      statusEl.textContent = "The API base override must be an http(s) URL.";
      return;
    }
    overrides.apiBaseUrl = normalized;
  }
  if (authBaseUrlEl.value.trim() !== "") {
    const normalized = normalizeBaseUrl(authBaseUrlEl.value);
    if (normalized === null) {
      statusEl.textContent = "The auth base override must be an http(s) URL.";
      return;
    }
    overrides.authBaseUrl = normalized;
  }
  if (publishableKeyEl.value.trim() !== "") {
    overrides.publishableKey = publishableKeyEl.value.trim();
  }

  void (async () => {
    // Request host permissions first: the requests must stay inside the gesture.
    let granted = true;
    for (const base of [overrides.apiBaseUrl, overrides.authBaseUrl]) {
      if (base !== undefined) {
        granted = (await ensureOriginPermission(base)) && granted;
      }
    }
    await saveOverrides(overrides as Overrides);
    statusEl.textContent = granted
      ? "Saved."
      : "Saved, but a host permission was declined; you will be asked again on use.";
  })();
});

resetEl.addEventListener("click", () => {
  void (async () => {
    await clearOverrides();
    await init();
    statusEl.textContent = "Reset to production defaults.";
  })();
});

void init();
