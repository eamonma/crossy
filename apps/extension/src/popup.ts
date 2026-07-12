// Action popup: the minimum honest surface. On a detected puzzle page it offers
// "Add to Crossy", posts the {format, document} envelope, and reports the outcome:
// the created puzzleId with a link to the library on success, or the named rejection
// code and message verbatim (PROTOCOL.md section 12).

import { postPuzzle } from "./api";
import { buildEnvelope } from "./envelope";
import { EXTRACT_REQUEST } from "./messaging";
import type { ExtractResponse } from "./messaging";
import { ensureOriginPermission, loadSettings } from "./settings";

const WEB_LIBRARY_URL = "https://crossy.party/puzzles";

const statusEl = document.getElementById("status") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;

function offerOptions(): void {
  const button = document.createElement("button");
  button.textContent = "Open options";
  button.addEventListener("click", () => void chrome.runtime.openOptionsPage());
  actionsEl.replaceChildren(button);
}

async function extractFromActiveTab(): Promise<ExtractResponse | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  try {
    return (await chrome.tabs.sendMessage(tab.id, {
      type: EXTRACT_REQUEST,
    })) as ExtractResponse;
  } catch {
    // No content script in this tab: not a supported puzzle page.
    return null;
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings();
  if (settings === null) {
    statusEl.textContent =
      "Set the API base URL and bearer token in the extension options first.";
    offerOptions();
    return;
  }

  const extraction = await extractFromActiveTab();
  if (extraction === null) {
    statusEl.textContent = "Not a supported puzzle page.";
    return;
  }
  if (!extraction.ok) {
    statusEl.textContent = extraction.reason;
    return;
  }

  statusEl.textContent = "Crossword found.";
  const button = document.createElement("button");
  button.textContent = "Add to Crossy";
  button.addEventListener("click", () => {
    button.disabled = true;
    resultEl.textContent = "Adding.";
    void (async () => {
      await ensureOriginPermission(settings.apiBaseUrl);
      let outcome;
      try {
        outcome = await postPuzzle(
          settings.apiBaseUrl,
          settings.token,
          buildEnvelope(extraction.format, extraction.document),
        );
      } catch {
        resultEl.textContent = `NETWORK: could not reach ${settings.apiBaseUrl}`;
        button.disabled = false;
        return;
      }
      if (outcome.ok) {
        const link = document.createElement("a");
        link.href = WEB_LIBRARY_URL;
        link.target = "_blank";
        link.textContent = "Open your library";
        resultEl.replaceChildren(`Added puzzle ${outcome.puzzleId}. `, link);
      } else {
        // The named rejection, verbatim (PROTOCOL.md section 12).
        resultEl.textContent = `${outcome.code}: ${outcome.message}`;
        button.disabled = false;
      }
    })();
  });
  actionsEl.replaceChildren(button);
}

void init();
