"use strict";
(() => {
  // src/pill/toggle.ts
  var PILL_DISABLED_KEY = "pillDisabled";
  var SITES = ["guardian", "nyt"];
  function parsePillDisabled(raw) {
    if (typeof raw !== "object" || raw === null) return {};
    const disabled = {};
    for (const site of SITES) {
      if (raw[site] === true) disabled[site] = true;
    }
    return disabled;
  }
  async function loadPillDisabled() {
    const stored = await chrome.storage.local.get(PILL_DISABLED_KEY);
    return parsePillDisabled(stored[PILL_DISABLED_KEY]);
  }
  async function setPillDisabled(site, disabled) {
    const current = await loadPillDisabled();
    const next = { ...current };
    if (disabled) next[site] = true;
    else delete next[site];
    await chrome.storage.local.set({ [PILL_DISABLED_KEY]: next });
  }

  // src/settings.ts
  var DEFAULT_API_BASE = "https://rest.crossy.party";
  var DEFAULT_AUTH_BASE = "https://api.crossy.party";
  var WEB_ORIGIN = "https://crossy.party";
  var AUTH_CALLBACK_URL = `${WEB_ORIGIN}/auth/ext/callback`;
  var OVERRIDES_KEY = "overrides";
  async function loadOverrides() {
    const stored = await chrome.storage.local.get(OVERRIDES_KEY);
    const raw = stored[OVERRIDES_KEY];
    if (typeof raw !== "object" || raw === null) return {};
    const { apiBaseUrl, authBaseUrl, publishableKey } = raw;
    const overrides = {};
    if (typeof apiBaseUrl === "string" && apiBaseUrl !== "")
      overrides.apiBaseUrl = apiBaseUrl;
    if (typeof authBaseUrl === "string" && authBaseUrl !== "")
      overrides.authBaseUrl = authBaseUrl;
    if (typeof publishableKey === "string" && publishableKey !== "")
      overrides.publishableKey = publishableKey;
    return overrides;
  }
  async function saveOverrides(overrides) {
    await chrome.storage.local.set({ [OVERRIDES_KEY]: overrides });
  }
  async function clearOverrides() {
    await chrome.storage.local.remove(OVERRIDES_KEY);
  }
  function normalizeBaseUrl(input) {
    const trimmed = input.trim();
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return trimmed.replace(/\/+$/, "");
  }
  function originPattern(baseUrl) {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }
  function requestOriginPermissions(baseUrls) {
    const origins = baseUrls.map(originPattern);
    return chrome.permissions.request({ origins });
  }

  // src/options.ts
  var apiBaseUrlEl = document.getElementById("apiBaseUrl");
  var authBaseUrlEl = document.getElementById(
    "authBaseUrl"
  );
  var publishableKeyEl = document.getElementById(
    "publishableKey"
  );
  var saveEl = document.getElementById("save");
  var resetEl = document.getElementById("reset");
  var statusEl = document.getElementById("status");
  async function init() {
    const overrides = await loadOverrides();
    apiBaseUrlEl.value = overrides.apiBaseUrl ?? "";
    authBaseUrlEl.value = overrides.authBaseUrl ?? "";
    publishableKeyEl.value = overrides.publishableKey ?? "";
    apiBaseUrlEl.placeholder = DEFAULT_API_BASE;
    authBaseUrlEl.placeholder = DEFAULT_AUTH_BASE;
  }
  saveEl.addEventListener("click", () => {
    const overrides = {};
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
    const toRequest = [overrides.apiBaseUrl, overrides.authBaseUrl].filter(
      (base) => base !== void 0
    );
    void (async () => {
      const granted = toRequest.length === 0 || await requestOriginPermissions(toRequest);
      await saveOverrides(overrides);
      statusEl.textContent = granted ? "Saved." : "Saved, but a host permission was declined; you will be asked again on use.";
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
  var pillGuardianEl = document.getElementById(
    "pillGuardian"
  );
  var pillNytEl = document.getElementById("pillNyt");
  async function initPillToggles() {
    const disabled = await loadPillDisabled();
    pillGuardianEl.checked = disabled.guardian !== true;
    pillNytEl.checked = disabled.nyt !== true;
  }
  pillGuardianEl.addEventListener("change", () => {
    void setPillDisabled("guardian", !pillGuardianEl.checked);
  });
  pillNytEl.addEventListener("change", () => {
    void setPillDisabled("nyt", !pillNytEl.checked);
  });
  void initPillToggles();
})();
