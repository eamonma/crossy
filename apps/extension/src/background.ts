// The auth service worker: runs the OAuth flow (the popup closes when the auth
// window takes focus, so launchWebAuthFlow cannot live there), owns every refresh
// (single-flight, so rotation never races between contexts), and keeps the session
// fresh across MV3 teardowns with chrome.alarms plus an on-demand check when the
// popup asks for a token.

import type { Provider } from "./auth/flow";
import { buildAuthorizeUrl, extractCode } from "./auth/flow";
import type { AuthTarget } from "./auth/gotrue";
import { exchangeCode, revokeSession } from "./auth/gotrue";
import type { SignInReply, TokenReply } from "./auth/messages";
import { AUTH_SIGN_IN, AUTH_SIGN_OUT, AUTH_TOKEN } from "./auth/messages";
import { generateVerifier, s256Challenge } from "./auth/pkce";
import type { RefreshOutcome } from "./auth/refresh";
import { refreshStoredSession } from "./auth/refresh";
import {
  needsRefresh,
  refreshAlarmWhenMs,
  sessionFromTokenResponse,
} from "./auth/session";
import {
  chromeLocalArea,
  clearSession,
  loadSession,
  saveSession,
} from "./auth/store";
import { loadBases } from "./settings";

// Firefox exposes the promise-based API on `browser`; Chrome promisifies `chrome`
// itself in MV3. One shim, no polyfill dependency.
declare const browser: typeof chrome | undefined;
const ext = typeof browser === "undefined" ? chrome : browser;

const REFRESH_ALARM = "crossy/auth/refresh";
/** The dev-auth storage key from before this design; cleared on update. */
const LEGACY_SETTINGS_KEY = "settings";

const area = chromeLocalArea();

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

async function signIn(provider: Provider): Promise<SignInReply> {
  const target = await authTarget();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = generateVerifier(bytes);
  const challenge = await s256Challenge(verifier);
  const redirectUri = ext.identity.getRedirectURL();
  const url = buildAuthorizeUrl(
    target.authBaseUrl,
    provider,
    redirectUri,
    challenge,
  );

  let redirect: string | undefined;
  try {
    redirect = await ext.identity.launchWebAuthFlow({ url, interactive: true });
  } catch {
    return { ok: false, reason: "sign-in was cancelled" };
  }
  if (redirect === undefined) {
    return { ok: false, reason: "sign-in was cancelled" };
  }

  const extraction = extractCode(redirect);
  if (!extraction.ok) return { ok: false, reason: extraction.reason };

  const result = await exchangeCode(target, extraction.code, verifier);
  if (!result.ok) {
    return {
      ok: false,
      reason:
        result.status === null
          ? `could not reach ${target.authBaseUrl}`
          : `token exchange failed (HTTP ${result.status})`,
    };
  }
  const session = sessionFromTokenResponse(result.body, nowSec());
  if (session === null) {
    return { ok: false, reason: "unexpected token response" };
  }
  await saveSession(session, area);
  armAlarm(session.expiresAt);
  return { ok: true };
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

ext.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = (message as { type?: unknown } | null)?.type;
  if (type === AUTH_SIGN_IN) {
    const { provider } = message as { provider: Provider };
    void signIn(provider).then(sendResponse);
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
