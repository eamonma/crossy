// Options page: v1-dev auth. Paste an API base URL and a bearer token; saving also
// requests the optional host permission for exactly that origin (on demand, inside
// the click gesture, never at install).

import {
  ensureOriginPermission,
  loadSettings,
  normalizeBaseUrl,
  saveSettings,
} from "./settings";

const apiBaseUrlEl = document.getElementById("apiBaseUrl") as HTMLInputElement;
const tokenEl = document.getElementById("token") as HTMLInputElement;
const saveEl = document.getElementById("save") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

async function init(): Promise<void> {
  const settings = await loadSettings();
  if (settings !== null) {
    apiBaseUrlEl.value = settings.apiBaseUrl;
    tokenEl.value = settings.token;
  }
}

saveEl.addEventListener("click", () => {
  const apiBaseUrl = normalizeBaseUrl(apiBaseUrlEl.value);
  const token = tokenEl.value.trim();
  if (apiBaseUrl === null) {
    statusEl.textContent = "The API base URL must be an http(s) URL.";
    return;
  }
  if (token === "") {
    statusEl.textContent = "Paste a bearer token.";
    return;
  }
  void (async () => {
    // Request the host permission first: the request must stay inside the gesture.
    const granted = await ensureOriginPermission(apiBaseUrl);
    await saveSettings({ apiBaseUrl, token });
    statusEl.textContent = granted
      ? "Saved. Host permission granted."
      : "Saved, but the host permission was declined; you will be asked again when adding a puzzle.";
  })();
});

void init();
