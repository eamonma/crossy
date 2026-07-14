// The auth service worker: runs the OAuth flow (the popup closes when the auth
// window takes focus, so launchWebAuthFlow cannot live there), owns every refresh
// (single-flight, so rotation never races between contexts), and keeps the session
// fresh across MV3 teardowns with chrome.alarms plus an on-demand check when the
// popup asks for a token. It also answers the inline pill's play request (D22):
// token, POST, new tab, all things a content script cannot do itself.

import { postPuzzle } from "./api";
import { runPkceAttempt } from "./auth/attempt";
import type { AuthCallbackRequest } from "./auth/callback";
import { AUTH_CALLBACK, PendingCaptures } from "./auth/callback";
import type { Provider } from "./auth/flow";
import type { AuthTarget } from "./auth/gotrue";
import { revokeSession } from "./auth/gotrue";
import type { AuthLauncher } from "./auth/launcher";
import { identityLauncher, tabRedirectLauncher } from "./auth/launcher";
import type {
  SignInReply,
  SilentSignInReply,
  TokenReply,
  WebIdentity,
  WebSignalRequest,
} from "./auth/messages";
import {
  AUTH_SIGN_IN,
  AUTH_SIGN_OUT,
  AUTH_SILENT_SIGN_IN,
  AUTH_TOKEN,
  AUTH_WEB_SIGNAL,
} from "./auth/messages";
import type { RefreshOutcome } from "./auth/refresh";
import { refreshStoredSession } from "./auth/refresh";
import { needsRefresh, refreshAlarmWhenMs } from "./auth/session";
import { SilentSignIn } from "./auth/silent";
import {
  chromeLocalArea,
  clearSession,
  loadSession,
  loadWebIdentity,
  saveWebIdentity,
} from "./auth/store";
import { buildEnvelope } from "./envelope";
import { PLAY_REQUEST } from "./pill/messages";
import type { PlayReply, PlayRequest } from "./pill/messages";
import { handlePlayRequest } from "./pill/play-handler";
import { AUTH_CALLBACK_URL, loadBases } from "./settings";

// Firefox exposes the promise-based API on `browser`; Chrome promisifies `chrome`
// itself in MV3. One shim, no polyfill dependency.
declare const browser: typeof chrome | undefined;
const ext = typeof browser === "undefined" ? chrome : browser;

const REFRESH_ALARM = "crossy/auth/refresh";
/** The dev-auth storage key from before this design; cleared on update. */
const LEGACY_SETTINGS_KEY = "settings";

// The fallback provider for a silent attempt when no web account is stashed to steer
// at. Discord keeps a live browser session across visits; Apple rarely does, and its
// interactive button stays for it. interactive:false resolves fast when the provider
// session is live and fails fast when it is not; the popup time-boxes its own wait.
const SILENT_PROVIDER: Provider = "discord";

const area = chromeLocalArea();

// The redirect capture differs by browser: Chrome and Firefox have identity, Safari does
// not, so Safari opens a tab to the hosted callback and awaits its report (auth/launcher.ts,
// auth/callback.ts). Everything downstream of the capture is byte-identical, so the
// extension keeps its own independent, rotating session on every browser. Chosen once at
// worker start; capability does not change at runtime.
const AUTH_TAB_TIMEOUT_MS = 5 * 60_000;
const pending = new PendingCaptures();

function selectLauncher(): AuthLauncher {
  const identity = (ext as typeof chrome).identity as
    typeof chrome.identity | undefined;
  if (
    identity !== undefined &&
    typeof identity.launchWebAuthFlow === "function" &&
    typeof identity.getRedirectURL === "function"
  ) {
    return identityLauncher(identity);
  }
  // Safari: no identity API. Mint the extension's own session via a hosted-callback tab.
  return tabRedirectLauncher({
    redirectUri: AUTH_CALLBACK_URL,
    pending,
    createTab: async (url) => (await ext.tabs.create({ url })).id,
    removeTab: async (tabId) => {
      try {
        await ext.tabs.remove(tabId);
      } catch {
        // The tab is already gone (closed, or navigated away); nothing to close.
      }
    },
    timeoutMs: AUTH_TAB_TIMEOUT_MS,
    startTimer: (ms, onFire) => {
      const handle = setTimeout(onFire, ms);
      return () => clearTimeout(handle);
    },
  });
}

const launcher = selectLauncher();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

async function authTarget(): Promise<AuthTarget> {
  const bases = await loadBases();
  return {
    authBaseUrl: bases.authBaseUrl,
    publishableKey: bases.publishableKey,
  };
}

function armAlarm(expiresAt: number): void {
  void ext.alarms.create(REFRESH_ALARM, {
    when: refreshAlarmWhenMs(expiresAt, nowSec()),
  });
}

// One refresh at a time per worker instance; every caller shares the outcome.
let inflightRefresh: Promise<RefreshOutcome> | null = null;

function singleFlightRefresh(): Promise<RefreshOutcome> {
  inflightRefresh ??= (async () => {
    try {
      return await refreshStoredSession({ target: await authTarget(), area });
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

async function runScheduledRefresh(): Promise<void> {
  const outcome = await singleFlightRefresh();
  if (outcome.ok) {
    armAlarm(outcome.session.expiresAt);
    return;
  }
  if (outcome.failure === "retry") {
    // Transient: keep the session, try again shortly. Never sign out on these.
    void ext.alarms.create(REFRESH_ALARM, { delayInMinutes: 1 });
  }
  // "signed_out" cleared storage in refreshStoredSession; "no_session" needs nothing.
}

function randomBytes(out: Uint8Array): void {
  crypto.getRandomValues(out);
}

// True while an interactive sign-in is mid-flight, so a concurrent silent attempt
// stands down: two OAuth flows racing to persist a session would clobber each other.
let interactiveInFlight = false;

async function signIn(provider: Provider): Promise<SignInReply> {
  interactiveInFlight = true;
  try {
    const result = await runPkceAttempt(provider, {
      target: await authTarget(),
      area,
      redirectUri: launcher.redirectUri,
      launch: (url) => launcher.capture(url, true),
      randomBytes,
      nowSec,
    });
    if (!result.ok) return { ok: false, reason: result.reason };
    armAlarm(result.session.expiresAt);
    return { ok: true };
  } finally {
    interactiveInFlight = false;
  }
}

/**
 * Sign in with no UI by running the normal PKCE flow with interactive:false, which
 * completes only when the provider (Discord) still has a live browser session. The
 * extension is signed OUT when this runs, so a failure has no session to lose: it
 * NEVER signs anything out and NEVER surfaces an error. It just resolves failed. This
 * is deliberately unlike the interactive flow's definitive-versus-transient handling,
 * which exists to decide when to drop an existing session.
 *
 * Single-flight and the stand-down guards (never while interactive is in flight, never
 * while already signed in) live in SilentSignIn; the attempt itself is here.
 */
const silent = new SilentSignIn({
  interactiveInFlight: () => interactiveInFlight,
  alreadySignedIn: async () => (await loadSession(area)) !== null,
  attempt: async () => {
    // Steer at the web account's provider when one is stashed, so a silent success
    // lands the SAME account the user plays as on the web; fall back to Discord.
    const web = await loadWebIdentity(area);
    const result = await runPkceAttempt(web?.provider ?? SILENT_PROVIDER, {
      target: await authTarget(),
      area,
      redirectUri: launcher.redirectUri,
      launch: (url) => launcher.capture(url, false),
      randomBytes,
      nowSec,
    });
    if (!result.ok) return { ok: false };
    armAlarm(result.session.expiresAt);
    return { ok: true };
  },
});

/**
 * The crossy.party content script's web-account report. Stash it (so the popup can
 * offer "continue as <name>" or warn on a mismatch), then, when an account is present,
 * drive a steered silent attempt. The attempt stands down when the extension is already
 * signed in or an interactive flow is running; on Firefox interactive:false throws and
 * it quietly fails, leaving the popup to offer the one-click connect.
 */
async function handleWebSignal(
  identity: WebIdentity | null,
): Promise<SilentSignInReply> {
  await saveWebIdentity(identity, area);
  if (identity === null) return { ok: false };
  return silent.run();
}

async function signOut(): Promise<void> {
  const session = await loadSession(area);
  if (session !== null) {
    // Best-effort revocation; local state clears regardless.
    await revokeSession(await authTarget(), session.accessToken);
  }
  await clearSession(area);
  await ext.alarms.clear(REFRESH_ALARM);
}

async function freshAccessToken(): Promise<TokenReply> {
  const session = await loadSession(area);
  if (session === null) return { ok: false, reason: "signed_out" };
  if (!needsRefresh(session.expiresAt, nowSec())) {
    return { ok: true, accessToken: session.accessToken };
  }
  const outcome = await singleFlightRefresh();
  if (outcome.ok) {
    armAlarm(outcome.session.expiresAt);
    return { ok: true, accessToken: outcome.session.accessToken };
  }
  return {
    ok: false,
    reason: outcome.failure === "retry" ? "network" : "signed_out",
  };
}

// The pill's play click, end to end (src/pill/play-handler.ts holds the decision
// tree). No permission request here: the worker has no user gesture, so a missing
// API-origin grant defers the solver to the popup instead.
async function playFromPill(request: PlayRequest): Promise<PlayReply> {
  const bases = await loadBases();
  return handlePlayRequest(buildEnvelope(request.format, request.document), {
    apiBaseUrl: bases.apiBaseUrl,
    containsOrigins: (origins) =>
      ext.permissions.contains({ origins: [...origins] }),
    freshAccessToken,
    postPuzzle,
    openTab: async (url) => {
      await ext.tabs.create({ url });
    },
  });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = (message as { type?: unknown } | null)?.type;
  if (type === AUTH_CALLBACK) {
    // The Safari callback page reporting the redirect it landed on. Route it to the tab's
    // waiter; the launcher resolves the capture and runPkceAttempt runs the exchange.
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      pending.deliver(tabId, (message as AuthCallbackRequest).url);
    }
    sendResponse({ ok: true });
    return false;
  }
  if (type === PLAY_REQUEST) {
    void playFromPill(message as PlayRequest).then(sendResponse);
    return true;
  }
  if (type === AUTH_SIGN_IN) {
    const { provider } = message as { provider: Provider };
    void signIn(provider).then(sendResponse);
    return true;
  }
  if (type === AUTH_SILENT_SIGN_IN) {
    void silent.run().then(sendResponse);
    return true;
  }
  if (type === AUTH_WEB_SIGNAL) {
    void handleWebSignal((message as WebSignalRequest).identity).then(
      sendResponse,
    );
    return true;
  }
  if (type === AUTH_SIGN_OUT) {
    void signOut().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (type === AUTH_TOKEN) {
    void freshAccessToken().then(sendResponse);
    return true;
  }
  return false;
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== REFRESH_ALARM) return;
  void runScheduledRefresh();
});

// A user who closes the Safari auth tab before it redirects cancels the capture: resolve
// the waiter undefined so the sign-in settles as a cancel instead of hanging to timeout.
// Any other tab has no capture pending, so this is a no-op there.
ext.tabs.onRemoved.addListener((tabId) => {
  pending.cancel(tabId);
});

async function rearm(): Promise<void> {
  const session = await loadSession(area);
  if (session === null) return;
  if (needsRefresh(session.expiresAt, nowSec())) {
    await runScheduledRefresh();
  } else {
    armAlarm(session.expiresAt);
  }
}

ext.runtime.onStartup.addListener(() => void rearm());
ext.runtime.onInstalled.addListener(() => {
  // The paste-token dev surface is gone; drop its stored credential.
  void chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
  void rearm();
});
