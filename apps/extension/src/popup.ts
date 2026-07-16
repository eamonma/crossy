// Action popup. Signed out: one button per provider; the click requests both host
// origins (inside the gesture) and hands the flow to the service worker, because
// this popup closes when the auth window takes focus. Signed in on a supported
// page: Play in Crossy is the sole action (ingest, then open the web app's play
// intent in a new tab). On a page whose on-page pill this solver has hidden, a
// quiet footer line offers to show it again, in either auth state.
// Every rejection is surfaced verbatim (PROTOCOL.md section 12), never rewritten.

import { postPuzzle } from "./api";
import type { AlignmentState } from "./auth/alignment";
import { alignmentState } from "./auth/alignment";
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
import {
  chromeLocalArea,
  loadSession,
  loadWebIdentity,
  SESSION_KEY,
} from "./auth/store";
import { silentSignInThenRender } from "./popup-silent";
import { buildEnvelope } from "./envelope";
import { EXTRACT_REQUEST } from "./messaging";
import type { ExtractResponse } from "./messaging";
import {
  loadPillDisabled,
  pillReSummonSite,
  setPillDisabled,
} from "./pill/toggle";
import type { PillSite } from "./pill/toggle";
import {
  hasPuzzleSitePermissions,
  loadBases,
  requestOriginPermissions,
  requestPuzzleSitePermissions,
  selectPlayUrl,
} from "./settings";
import type { Bases } from "./settings";

// Resolved once at init so click handlers never await before their permission
// request (Firefox drops the gesture after any await; settings.ts).
let bases: Bases;

const identityEl = document.getElementById("identity") as HTMLParagraphElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const actionsEl = document.getElementById("actions") as HTMLDivElement;
const resultEl = document.getElementById("result") as HTMLParagraphElement;
const pillNoteEl = document.getElementById("pill-note") as HTMLParagraphElement;
const siteAccessEl = document.getElementById(
  "site-access",
) as HTMLParagraphElement;
const alignNoteEl = document.getElementById(
  "align-note",
) as HTMLParagraphElement;

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
  alignNoteEl.replaceChildren();
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

// The interactive sign-in gesture, shared by the provider buttons, the "continue as
// <name>" connect button, and the mismatch "switch" button. It requests both origins
// synchronously (Firefox drops the gesture after any await; settings.ts), optionally
// signs the current session out first (the account switch), then hands the flow to the
// worker. The popup closes when the auth window takes focus, so on that path the
// reopened popup reads the stored session; where it survives, init runs here.
function startSignIn(provider: Provider, signOutFirst: boolean): void {
  void (async () => {
    const granted = await requestOriginPermissions([
      bases.authBaseUrl,
      bases.apiBaseUrl,
    ]);
    if (!granted) {
      statusEl.textContent =
        "Crossy needs permission to reach its servers to sign you in.";
      return;
    }
    if (signOutFirst) {
      await chrome.runtime.sendMessage({ type: AUTH_SIGN_OUT });
    }
    statusEl.textContent =
      "Finish signing in in the window that opened, then reopen this popup.";
    const reply = (await chrome.runtime.sendMessage({
      type: AUTH_SIGN_IN,
      provider,
    })) as SignInReply;
    if (reply.ok) {
      void init();
    } else {
      statusEl.textContent = `Sign-in failed: ${reply.reason}`;
    }
  })();
}

function signInButton(
  label: string,
  tone: string,
  provider: Provider,
  signOutFirst = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = tone;
  button.textContent = label;
  // The click stays a gesture: startSignIn's first await is the permission request.
  button.addEventListener("click", () => startSignIn(provider, signOutFirst));
  return button;
}

function renderSignedOut(): void {
  identityEl.textContent = "";
  statusEl.textContent = "Sign in to add puzzles to your Crossy library.";
  showResult("", false);
  alignNoteEl.replaceChildren();
  const buttons = PROVIDERS.map(({ provider, label, tone }) =>
    signInButton(label, tone, provider),
  );
  actionsEl.replaceChildren(...buttons);
}

// Signed out, but crossy.party is signed in: offer a one-click "continue as <name>"
// at the web account's provider (so the extension lands the SAME account), with a
// quiet path back to the full provider list.
function renderConnect(
  state: Extract<AlignmentState, { kind: "connect" }>,
): void {
  identityEl.textContent = "";
  statusEl.textContent = `You're signed in to Crossy on the web as ${state.name}.`;
  showResult("", false);
  alignNoteEl.replaceChildren();
  const cont = signInButton(
    `Continue as ${state.name}`,
    "primary",
    state.provider,
  );
  const other = document.createElement("button");
  other.className = "linklike";
  other.textContent = "Use a different account";
  other.addEventListener("click", () => renderSignedOut());
  actionsEl.replaceChildren(cont, other);
}

// Signed in as a DIFFERENT account than crossy.party: warn (non-blocking; ingest still
// works) and offer a one-click switch to the web account. Empty in every aligned state.
function renderAlignNote(state: AlignmentState): void {
  if (state.kind !== "mismatch") {
    alignNoteEl.replaceChildren();
    return;
  }
  alignNoteEl.className = "align-warn";
  const warn = document.createElement("span");
  warn.textContent = `crossy.party is signed in as ${state.name}, a different account. Puzzles you add here will not appear in that library.`;
  const swtch = signInButton(
    `Switch to ${state.name}`,
    "linklike",
    state.provider,
    true,
  );
  alignNoteEl.replaceChildren(warn, swtch);
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
  const setBusy = (busy: boolean): void => {
    play.disabled = busy;
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
      // Deep-link the app on iOS (the extension lives inside it), web intent elsewhere;
      // the same selection the pill uses, so the two surfaces never diverge (settings.ts).
      await chrome.tabs.create({
        url: selectPlayUrl(navigator.userAgent)(run.puzzleId),
      });
      window.close();
    })();
  });

  actionsEl.replaceChildren(play);
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

async function activeTabUrl(): Promise<string | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

// The re-summon line: on a pill site whose on-page button this solver has hidden,
// offer to show it. About page UI, not auth, so it runs in either state. Nothing
// renders off a pill site or where the pill is already showing (pillReSummonSite).
async function renderPillNote(): Promise<void> {
  const url = await activeTabUrl();
  const site =
    url === null ? null : pillReSummonSite(url, await loadPillDisabled());
  if (site === null) {
    pillNoteEl.replaceChildren();
    return;
  }
  const text = document.createElement("span");
  text.textContent = "On-page button hidden here.";
  const show = document.createElement("button");
  show.className = "linklike";
  show.textContent = "Show it";
  show.addEventListener("click", () => {
    show.disabled = true;
    void showAgain(site);
  });
  pillNoteEl.replaceChildren(text, show);
}

async function showAgain(site: PillSite): Promise<void> {
  await setPillDisabled(site, false);
  // The pill mounts at page load, so a reload is the honest instruction.
  pillNoteEl.replaceChildren("Shown. Reload the page to see it.");
}

// The site-access offer: whenever host access to the crossword sites is not yet held, one
// tap grants every crossword origin (PUZZLE_SITE_ORIGINS) so the extractor can inject.
// Self-hiding, so it needs no browser sniff: a user who already granted access (including a
// broad "every website" grant) never sees it, and Safari, which withholds access until
// asked, does. Page-capability UI, not auth, so it runs on every init in either state (the
// renderPillNote precedent).
async function renderSiteAccess(): Promise<void> {
  let held: boolean;
  try {
    held = await hasPuzzleSitePermissions();
  } catch {
    // A browser that rejects the contains query still deserves the offer.
    held = false;
  }
  if (held) {
    siteAccessEl.replaceChildren();
    return;
  }
  const text = document.createElement("span");
  text.textContent = "Let Crossy read crossword sites to add puzzles.";
  const turnOn = document.createElement("button");
  turnOn.className = "linklike";
  turnOn.textContent = "Turn on";
  turnOn.addEventListener("click", () => {
    turnOn.disabled = true;
    void (async () => {
      // No await before the request: it opens the gesture (Firefox law; settings.ts).
      const granted = await requestPuzzleSitePermissions();
      if (granted) {
        // Declared content scripts mount at page load, so an already-open puzzle page
        // needs a reload before the extractor is there; that is the honest instruction.
        siteAccessEl.replaceChildren(
          "Access on. Reload the crossword page to add it.",
        );
        return;
      }
      // Denied or dismissed: keep the offer, retryable, with a nudge toward the grant.
      text.textContent =
        "Still off. Allow Crossy for these sites, then tap again.";
      turnOn.disabled = false;
    })();
  });
  siteAccessEl.replaceChildren(text, turnOn);
}

async function init(): Promise<void> {
  bases = await loadBases();
  // The pill note and the site-access offer are page-capability UI, not auth, so they
  // render on every init in either state, outside the silent flow's control path below.
  await renderPillNote();
  await renderSiteAccess();
  const area = chromeLocalArea();
  const session = await loadSession(area);
  const state = alignmentState(session, await loadWebIdentity(area));
  if (session !== null) {
    await renderSignedIn({
      displayName: session.displayName,
      email: session.email,
    });
    // Warn (non-blocking) when this account differs from the crossy.party account.
    renderAlignNote(state);
    return;
  }
  // Signed out: try a silent sign-in (steered at the web account) before committing to
  // any buttons. On success the worker persists a session and onSignedIn re-runs init
  // into signed-in; on failure or timeout, offer "continue as <name>" when the web app
  // is signed in, otherwise the plain provider buttons.
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
      if (state.kind === "connect") renderConnect(state);
      else renderSignedOut();
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
