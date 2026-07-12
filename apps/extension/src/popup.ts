// Action popup. Signed out: one button per provider; the click requests both host
// origins (inside the gesture) and hands the flow to the service worker, because
// this popup closes when the auth window takes focus. Signed in on a supported
// page: Play in Crossy leads (ingest, then open the web app's play intent in a new
// tab), Add to library is the quieter path (result line plus a library link).
// Every rejection is surfaced verbatim (PROTOCOL.md section 12), never rewritten.

import { postPuzzle } from "./api";
import type { Provider } from "./auth/flow";
import type {
  SignInReply,
  SilentSignInReply,
  TokenReply,
} from "./auth/messages";
import {
  AUTH_SIGN_IN,
  AUTH_SIGN_OUT,
  AUTH_SILENT_SIGN_IN,
  AUTH_TOKEN,
} from "./auth/messages";
import { chromeLocalArea, loadSession, SESSION_KEY } from "./auth/store";
import { silentSignInThenRender } from "./popup-silent";
import { buildEnvelope } from "./envelope";
import { EXTRACT_REQUEST } from "./messaging";
import type { ExtractResponse } from "./messaging";
import {
  loadBases,
  playIntentUrl,
  requestOriginPermissions,
  WEB_LIBRARY_URL,
} from "./settings";
import type { Bases } from "./settings";

// Resolved once at init so click handlers never await before their permission
// request (Firefox drops the gesture after any await; settings.ts).
let bases: Bases;

const identityEl = document.getElementById("identity") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;

const PROVIDERS: ReadonlyArray<{
  provider: Provider;
  label: string;
  tone: "primary" | "quiet";
}> = [
  { provider: "discord", label: "Sign in with Discord", tone: "primary" },
  { provider: "apple", label: "Sign in with Apple", tone: "quiet" },
];

// The silent attempt is time-boxed in the popup too, so a hung worker request still
// drops to the provider buttons promptly rather than sitting on the checking state.
const SILENT_TIMEOUT_MS = 4000;

function showResult(text: string, isError: boolean): void {
  resultEl.classList.toggle("error", isError);
  resultEl.textContent = text;
}

/** The quiet transient state while a silent sign-in runs: status text, no buttons. */
function renderChecking(): void {
  identityEl.textContent = "";
  statusEl.textContent = "Checking your Crossy sign-in...";
  showResult("", false);
  actionsEl.replaceChildren();
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

function renderSignedOut(): void {
  identityEl.textContent = "";
  statusEl.textContent = "Sign in to add puzzles to your Crossy library.";
  showResult("", false);
  const buttons = PROVIDERS.map(({ provider, label, tone }) => {
    const button = document.createElement("button");
    button.className = tone;
    button.textContent = label;
    button.addEventListener("click", () => {
      void (async () => {
        // First await, nothing before it: Firefox requires permissions.request
        // synchronously inside the gesture (settings.ts; bases pre-resolved).
        // Both origins ride this one request so the ingest path is already
        // granted by the time it is needed.
        const granted = await requestOriginPermissions([
          bases.authBaseUrl,
          bases.apiBaseUrl,
        ]);
        if (!granted) {
          statusEl.textContent =
            "Crossy needs permission to reach its servers to sign you in.";
          return;
        }
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

type IngestRun =
  | { readonly ok: true; readonly puzzleId: string }
  | {
      readonly ok: false;
      readonly sessionEnded: boolean;
      readonly line: string;
    };

// Callers reach this synchronously from their click handler, so the permission
// request inside stays the gesture's first await (Firefox law; settings.ts). It is
// a silent fallback: sign-in already asked for this origin, and request resolves
// without prompting when it is granted.
async function ingest(
  extraction: ExtractResponse & { ok: true },
): Promise<IngestRun> {
  const granted = await requestOriginPermissions([bases.apiBaseUrl]);
  if (!granted) {
    return {
      ok: false,
      sessionEnded: false,
      line: "Crossy needs permission to reach the API to add this puzzle.",
    };
  }
  const token = (await chrome.runtime.sendMessage({
    type: AUTH_TOKEN,
  })) as TokenReply;
  if (!token.ok) {
    if (token.reason === "signed_out") {
      return { ok: false, sessionEnded: true, line: "" };
    }
    return {
      ok: false,
      sessionEnded: false,
      line: "Could not refresh your session. Check your connection and try again.",
    };
  }
  let outcome;
  try {
    outcome = await postPuzzle(
      bases.apiBaseUrl,
      token.accessToken,
      buildEnvelope(extraction.format, extraction.document),
    );
  } catch {
    return {
      ok: false,
      sessionEnded: false,
      line: `NETWORK: could not reach ${bases.apiBaseUrl}`,
    };
  }
  if (outcome.ok) return { ok: true, puzzleId: outcome.puzzleId };
  // The named rejection, verbatim (PROTOCOL.md section 12).
  return {
    ok: false,
    sessionEnded: false,
    line: `${outcome.code}: ${outcome.message}`,
  };
}

function renderIngest(extraction: ExtractResponse & { ok: true }): void {
  statusEl.textContent = "Crossword found on this page.";
  const play = document.createElement("button");
  play.className = "primary";
  play.textContent = "Play in Crossy";
  const add = document.createElement("button");
  add.className = "quiet";
  add.textContent = "Add to library";
  const setBusy = (busy: boolean): void => {
    play.disabled = busy;
    add.disabled = busy;
  };
  const fail = (run: IngestRun & { ok: false }): void => {
    if (run.sessionEnded) {
      renderSignedOut();
      statusEl.textContent = "Your session ended. Sign in again.";
      return;
    }
    showResult(run.line, true);
    setBusy(false);
  };

  play.addEventListener("click", () => {
    setBusy(true);
    showResult("Opening in Crossy.", false);
    void (async () => {
      // No await before ingest: its permission request opens the gesture.
      const run = await ingest(extraction);
      if (!run.ok) {
        fail(run);
        return;
      }
      await chrome.tabs.create({ url: playIntentUrl(run.puzzleId) });
      window.close();
    })();
  });

  add.addEventListener("click", () => {
    setBusy(true);
    showResult("Adding.", false);
    void (async () => {
      // No await before ingest: its permission request opens the gesture.
      const run = await ingest(extraction);
      if (!run.ok) {
        fail(run);
        return;
      }
      const link = document.createElement("a");
      link.href = WEB_LIBRARY_URL;
      link.target = "_blank";
      link.textContent = "Open your library";
      resultEl.classList.remove("error");
      resultEl.replaceChildren(`Added puzzle ${run.puzzleId}. `, link);
    })();
  });

  actionsEl.replaceChildren(play, add);
}

async function renderSignedIn(who: {
  displayName: string;
  email: string | null;
}): Promise<void> {
  const signOut = document.createElement("button");
  signOut.className = "linklike";
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
  const name = document.createElement("span");
  name.textContent = `Signed in as ${label}`;
  identityEl.replaceChildren(name, signOut);

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

// Set while a silent attempt runs so the storage.onChanged listener does not re-enter
// init and double-render underneath it; the silent flow calls init itself on success.
let silentInFlight = false;

async function init(): Promise<void> {
  bases = await loadBases();
  const session = await loadSession(chromeLocalArea());
  if (session !== null) {
    await renderSignedIn({
      displayName: session.displayName,
      email: session.email,
    });
    return;
  }
  // Signed out: try a silent sign-in before committing to the buttons. On success
  // the worker has persisted a session and onSignedIn re-runs init into signed-in;
  // on failure or timeout onSignedOut paints the normal provider buttons.
  silentInFlight = true;
  await silentSignInThenRender({
    requestSilent: () =>
      chrome.runtime.sendMessage({
        type: AUTH_SILENT_SIGN_IN,
      }) as Promise<SilentSignInReply>,
    showChecking: renderChecking,
    onSignedIn: () => {
      silentInFlight = false;
      void init();
    },
    onSignedOut: () => {
      silentInFlight = false;
      renderSignedOut();
    },
    timeoutMs: SILENT_TIMEOUT_MS,
  });
}

// Re-render if the session lands or leaves while the popup is open (sign-in
// completing on platforms that keep the popup alive, sign-out elsewhere). While a
// silent attempt runs, the session it persists is the attempt's own business: it
// calls init itself on success, so skip re-entry here to avoid a double render.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (silentInFlight) return;
  if (areaName === "local" && SESSION_KEY in changes) void init();
});

void init();
