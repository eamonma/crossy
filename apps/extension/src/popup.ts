// Action popup, three honest states. Signed out: one button per provider; the click
// requests the auth-origin permission (inside the gesture) and hands the flow to the
// service worker, because this popup closes when the auth window takes focus. Signed
// in: the identity line, sign out, and the ingest flow. Every rejection is surfaced
// verbatim (PROTOCOL.md section 12), never rewritten.

import { postPuzzle } from "./api";
import type { Provider } from "./auth/flow";
import type { SignInReply, TokenReply } from "./auth/messages";
import { AUTH_SIGN_IN, AUTH_SIGN_OUT, AUTH_TOKEN } from "./auth/messages";
import { chromeLocalArea, loadSession, SESSION_KEY } from "./auth/store";
import { buildEnvelope } from "./envelope";
import { EXTRACT_REQUEST } from "./messaging";
import type { ExtractResponse } from "./messaging";
import { ensureOriginPermission, loadBases } from "./settings";

const WEB_LIBRARY_URL = "https://crossy.party/puzzles";

const identityEl = document.getElementById("identity") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;

const PROVIDERS: ReadonlyArray<{ provider: Provider; label: string }> = [
  { provider: "discord", label: "Sign in with Discord" },
  { provider: "apple", label: "Sign in with Apple" },
];

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

function renderSignedOut(): void {
  identityEl.textContent = "";
  statusEl.textContent = "Sign in to add puzzles to your Crossy library.";
  resultEl.textContent = "";
  const buttons = PROVIDERS.map(({ provider, label }) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", () => {
      void (async () => {
        // The permission request must stay inside the click gesture.
        const bases = await loadBases();
        await ensureOriginPermission(bases.authBaseUrl);
        statusEl.textContent =
          "Finish signing in in the window that opened, then reopen this popup.";
        const reply = (await chrome.runtime.sendMessage({
          type: AUTH_SIGN_IN,
          provider,
        })) as SignInReply;
        // If this popup survived the auth window (platform-dependent), react here;
        // otherwise the reopened popup reads the stored session.
        if (reply.ok) {
          void init();
        } else {
          statusEl.textContent = `Sign-in failed: ${reply.reason}`;
        }
      })();
    });
    return button;
  });
  actionsEl.replaceChildren(...buttons);
}

function renderIngest(extraction: ExtractResponse & { ok: true }): void {
  statusEl.textContent = "Crossword found.";
  const button = document.createElement("button");
  button.textContent = "Add to Crossy";
  button.addEventListener("click", () => {
    button.disabled = true;
    resultEl.textContent = "Adding.";
    void (async () => {
      const bases = await loadBases();
      await ensureOriginPermission(bases.apiBaseUrl);
      const token = (await chrome.runtime.sendMessage({
        type: AUTH_TOKEN,
      })) as TokenReply;
      if (!token.ok) {
        if (token.reason === "signed_out") {
          renderSignedOut();
          statusEl.textContent = "Your session ended. Sign in again.";
        } else {
          resultEl.textContent =
            "Could not refresh your session. Check your connection and try again.";
          button.disabled = false;
        }
        return;
      }
      let outcome;
      try {
        outcome = await postPuzzle(
          bases.apiBaseUrl,
          token.accessToken,
          buildEnvelope(extraction.format, extraction.document),
        );
      } catch {
        resultEl.textContent = `NETWORK: could not reach ${bases.apiBaseUrl}`;
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

async function renderSignedIn(who: {
  displayName: string;
  email: string | null;
}): Promise<void> {
  const signOut = document.createElement("button");
  signOut.textContent = "Sign out";
  signOut.addEventListener("click", () => {
    signOut.disabled = true;
    void (async () => {
      await chrome.runtime.sendMessage({ type: AUTH_SIGN_OUT });
      renderSignedOut();
    })();
  });
  const label =
    who.email !== null && who.email !== who.displayName
      ? `${who.displayName} (${who.email})`
      : who.displayName;
  identityEl.replaceChildren(`Signed in as ${label} `, signOut);

  const extraction = await extractFromActiveTab();
  if (extraction === null) {
    statusEl.textContent = "Not a supported puzzle page.";
    actionsEl.replaceChildren();
    return;
  }
  if (!extraction.ok) {
    statusEl.textContent = extraction.reason;
    actionsEl.replaceChildren();
    return;
  }
  renderIngest(extraction);
}

async function init(): Promise<void> {
  const session = await loadSession(chromeLocalArea());
  if (session === null) {
    renderSignedOut();
    return;
  }
  await renderSignedIn({
    displayName: session.displayName,
    email: session.email,
  });
}

// Re-render if the session lands or leaves while the popup is open (sign-in
// completing on platforms that keep the popup alive, sign-out elsewhere).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && SESSION_KEY in changes) void init();
});

void init();
