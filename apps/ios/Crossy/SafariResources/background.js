"use strict";
(() => {
  // src/api.ts
  async function postPuzzle(apiBaseUrl, token, envelope) {
    const response = await fetch(`${apiBaseUrl}/puzzles`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(envelope)
    });
    let body = null;
    try {
      body = await response.json();
    } catch {
    }
    if ((response.status === 201 || response.status === 200) && body !== null) {
      return { ok: true, puzzleId: body.puzzleId };
    }
    if (typeof body === "object" && body !== null && "error" in body) {
      const rejection = body;
      if (typeof rejection.error === "string") {
        return {
          ok: false,
          code: rejection.error,
          message: typeof rejection.message === "string" ? rejection.message : ""
        };
      }
    }
    return {
      ok: false,
      code: `HTTP_${response.status}`,
      message: "unexpected response from the API"
    };
  }

  // src/auth/flow.ts
  function buildAuthorizeUrl(authBaseUrl, provider, redirectUri, codeChallenge) {
    const params = new URLSearchParams({
      provider,
      redirect_to: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "s256"
    });
    return `${authBaseUrl}/auth/v1/authorize?${params.toString()}`;
  }
  function extractCode(redirectUrl) {
    let parsed;
    try {
      parsed = new URL(redirectUrl);
    } catch {
      return { ok: false, reason: "sign-in returned an unparseable redirect" };
    }
    const query = parsed.searchParams;
    const fragment = new URLSearchParams(parsed.hash.replace(/^#/, ""));
    const code = query.get("code");
    if (code !== null && code !== "") return { ok: true, code };
    const description = query.get("error_description") ?? fragment.get("error_description");
    const error = query.get("error") ?? fragment.get("error");
    if (description !== null && description !== "")
      return { ok: false, reason: description };
    if (error !== null && error !== "") return { ok: false, reason: error };
    return { ok: false, reason: "sign-in returned no code" };
  }

  // src/auth/gotrue.ts
  async function post(target, path, body, fetchFn, accessToken) {
    const headers = {
      apikey: target.publishableKey,
      "content-type": "application/json"
    };
    if (accessToken !== void 0)
      headers["authorization"] = `Bearer ${accessToken}`;
    let response;
    try {
      response = await fetchFn(`${target.authBaseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });
    } catch {
      return { ok: false, status: null };
    }
    if (!response.ok) return { ok: false, status: response.status };
    try {
      return { ok: true, body: await response.json() };
    } catch {
      return { ok: true, body: null };
    }
  }
  function exchangeCode(target, authCode, codeVerifier, fetchFn = fetch) {
    return post(
      target,
      "/auth/v1/token?grant_type=pkce",
      { auth_code: authCode, code_verifier: codeVerifier },
      fetchFn
    );
  }
  function refreshGrant(target, refreshToken, fetchFn = fetch) {
    return post(
      target,
      "/auth/v1/token?grant_type=refresh_token",
      { refresh_token: refreshToken },
      fetchFn
    );
  }
  async function revokeSession(target, accessToken, fetchFn = fetch) {
    await post(target, "/auth/v1/logout?scope=local", {}, fetchFn, accessToken);
  }

  // src/auth/pkce.ts
  var B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  function base64UrlEncode(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B64URL[b0 >> 2];
      out += B64URL[(b0 & 3) << 4 | (b1 ?? 0) >> 4];
      if (b1 !== void 0) out += B64URL[(b1 & 15) << 2 | (b2 ?? 0) >> 6];
      if (b2 !== void 0) out += B64URL[b2 & 63];
    }
    return out;
  }
  function generateVerifier(randomBytes2) {
    return base64UrlEncode(randomBytes2);
  }
  async function s256Challenge(verifier) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    );
    return base64UrlEncode(new Uint8Array(digest));
  }

  // src/auth/session.ts
  var REFRESH_MARGIN_SEC = 60;
  var ALARM_LEAD_SEC = 300;
  var ALARM_FLOOR_SEC = 30;
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
  function sessionFromTokenResponse(raw, nowSec2) {
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw;
    const accessToken = r["access_token"];
    const refreshToken = r["refresh_token"];
    if (typeof accessToken !== "string" || accessToken === "") return null;
    if (typeof refreshToken !== "string" || refreshToken === "") return null;
    let expiresAt;
    if (typeof r["expires_at"] === "number") {
      expiresAt = r["expires_at"];
    } else if (typeof r["expires_in"] === "number") {
      expiresAt = nowSec2 + r["expires_in"];
    } else {
      return null;
    }
    const user = typeof r["user"] === "object" && r["user"] !== null ? r["user"] : {};
    const email = typeof user["email"] === "string" ? user["email"] : null;
    const userId = typeof user["id"] === "string" ? user["id"] : null;
    return {
      accessToken,
      refreshToken,
      expiresAt,
      userId,
      email,
      displayName: displayNameOf(user)
    };
  }
  function needsRefresh(expiresAt, nowSec2, marginSec = REFRESH_MARGIN_SEC) {
    return expiresAt - nowSec2 <= marginSec;
  }
  function refreshAlarmWhenMs(expiresAt, nowSec2) {
    const target = Math.max(expiresAt - ALARM_LEAD_SEC, nowSec2 + ALARM_FLOOR_SEC);
    return target * 1e3;
  }
  function classifyRefreshFailure(status) {
    if (status === 400 || status === 401 || status === 403) return "signed_out";
    return "retry";
  }

  // src/auth/store.ts
  var SESSION_KEY = "authSession";
  var WEB_IDENTITY_KEY = "webIdentity";
  function chromeLocalArea() {
    return {
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
      remove: (key) => chrome.storage.local.remove(key)
    };
  }
  async function loadSession(area2) {
    const stored = await area2.get(SESSION_KEY);
    const raw = stored[SESSION_KEY];
    if (typeof raw !== "object" || raw === null) return null;
    const s = raw;
    if (typeof s.accessToken !== "string" || s.accessToken === "") return null;
    if (typeof s.refreshToken !== "string" || s.refreshToken === "") return null;
    if (typeof s.expiresAt !== "number") return null;
    return {
      accessToken: s.accessToken,
      refreshToken: s.refreshToken,
      expiresAt: s.expiresAt,
      userId: typeof s.userId === "string" ? s.userId : null,
      email: typeof s.email === "string" ? s.email : null,
      displayName: typeof s.displayName === "string" ? s.displayName : "Player"
    };
  }
  async function saveSession(session, area2) {
    await area2.set({ [SESSION_KEY]: session });
  }
  async function clearSession(area2) {
    await area2.remove(SESSION_KEY);
  }
  async function loadWebIdentity(area2) {
    const stored = await area2.get(WEB_IDENTITY_KEY);
    const raw = stored[WEB_IDENTITY_KEY];
    if (typeof raw !== "object" || raw === null) return null;
    const w = raw;
    if (typeof w.userId !== "string" || w.userId === "") return null;
    if (w.provider !== "discord" && w.provider !== "apple") return null;
    if (typeof w.displayName !== "string") return null;
    return { userId: w.userId, provider: w.provider, displayName: w.displayName };
  }
  async function saveWebIdentity(identity, area2) {
    if (identity === null) {
      await area2.remove(WEB_IDENTITY_KEY);
      return;
    }
    await area2.set({ [WEB_IDENTITY_KEY]: identity });
  }

  // src/auth/attempt.ts
  async function runPkceAttempt(provider, deps) {
    const bytes = new Uint8Array(32);
    deps.randomBytes(bytes);
    const verifier = generateVerifier(bytes);
    const challenge = await s256Challenge(verifier);
    const url = buildAuthorizeUrl(
      deps.target.authBaseUrl,
      provider,
      deps.redirectUri,
      challenge
    );
    let redirect;
    try {
      redirect = await deps.launch(url);
    } catch {
      return { ok: false, reason: "sign-in was cancelled" };
    }
    if (redirect === void 0) {
      return { ok: false, reason: "sign-in was cancelled" };
    }
    const extraction = extractCode(redirect);
    if (!extraction.ok) return { ok: false, reason: extraction.reason };
    const result = await exchangeCode(
      deps.target,
      extraction.code,
      verifier,
      deps.fetchFn
    );
    if (!result.ok) {
      return {
        ok: false,
        reason: result.status === null ? `could not reach ${deps.target.authBaseUrl}` : `token exchange failed (HTTP ${result.status})`
      };
    }
    const session = sessionFromTokenResponse(result.body, deps.nowSec());
    if (session === null) {
      return { ok: false, reason: "unexpected token response" };
    }
    await saveSession(session, deps.area);
    return { ok: true, session };
  }

  // src/auth/callback.ts
  var AUTH_CALLBACK = "crossy/auth/callback";
  var PendingCaptures = class {
    waiters = /* @__PURE__ */ new Map();
    /**
     * Await the redirect for a tab. A second register for the same tab cancels the first
     * (its flow was abandoned), so at most one capture is ever pending per tab.
     */
    register(tabId) {
      this.settle(tabId, void 0);
      return new Promise((resolve) => {
        this.waiters.set(tabId, resolve);
      });
    }
    /** Resolve the tab's waiter with the captured redirect URL. False if none is pending. */
    deliver(tabId, url) {
      return this.settle(tabId, url);
    }
    /** Resolve the tab's waiter as a cancel (undefined). False if none is pending. */
    cancel(tabId) {
      return this.settle(tabId, void 0);
    }
    settle(tabId, value) {
      const resolve = this.waiters.get(tabId);
      if (resolve === void 0) return false;
      this.waiters.delete(tabId);
      resolve(value);
      return true;
    }
  };

  // src/auth/launcher.ts
  function identityLauncher(identity) {
    return {
      redirectUri: identity.getRedirectURL(),
      capture: (url, interactive) => identity.launchWebAuthFlow({ url, interactive })
    };
  }
  function tabRedirectLauncher(deps) {
    return {
      redirectUri: deps.redirectUri,
      capture: async (authorizeUrl, interactive) => {
        if (!interactive) return void 0;
        const tabId = await deps.createTab(authorizeUrl);
        if (tabId === void 0) return void 0;
        const waiter = deps.pending.register(tabId);
        const cancelTimer = deps.startTimer(
          deps.timeoutMs,
          () => deps.pending.cancel(tabId)
        );
        try {
          return await waiter;
        } finally {
          cancelTimer();
          await deps.removeTab(tabId);
        }
      }
    };
  }

  // src/auth/messages.ts
  var AUTH_SIGN_IN = "crossy/auth/sign-in";
  var AUTH_SILENT_SIGN_IN = "crossy/auth/silent-sign-in";
  var AUTH_WEB_SIGNAL = "crossy/auth/web-signal";
  var AUTH_SIGN_OUT = "crossy/auth/sign-out";
  var AUTH_TOKEN = "crossy/auth/token";

  // src/auth/refresh.ts
  async function refreshStoredSession(deps) {
    const fetchFn = deps.fetchFn ?? fetch;
    const nowSec2 = deps.nowSec ?? (() => Math.floor(Date.now() / 1e3));
    const current = await loadSession(deps.area);
    if (current === null) return { ok: false, failure: "no_session" };
    const result = await refreshGrant(deps.target, current.refreshToken, fetchFn);
    if (!result.ok) {
      const failure = classifyRefreshFailure(result.status);
      if (failure === "signed_out") await clearSession(deps.area);
      return { ok: false, failure };
    }
    const next = sessionFromTokenResponse(result.body, nowSec2());
    if (next === null) {
      return { ok: false, failure: "retry" };
    }
    await saveSession(next, deps.area);
    return { ok: true, session: next };
  }

  // src/auth/silent.ts
  var SilentSignIn = class {
    constructor(deps) {
      this.deps = deps;
    }
    deps;
    inflight = null;
    run() {
      this.inflight ??= this.once().finally(() => {
        this.inflight = null;
      });
      return this.inflight;
    }
    async once() {
      try {
        if (this.deps.interactiveInFlight()) return { ok: false };
        if (await this.deps.alreadySignedIn()) return { ok: false };
        return await this.deps.attempt();
      } catch {
        return { ok: false };
      }
    }
  };

  // src/envelope.ts
  function buildEnvelope(format, document) {
    return { format, document };
  }

  // src/pill/messages.ts
  var PLAY_REQUEST = "crossy/play";

  // src/settings.ts
  var DEFAULT_API_BASE = "https://rest.crossy.party";
  var DEFAULT_AUTH_BASE = "https://api.crossy.party";
  var WEB_ORIGIN = "https://crossy.party";
  function playIntentUrl(puzzleId) {
    return `${WEB_ORIGIN}/puzzles?play=${encodeURIComponent(puzzleId)}`;
  }
  function appPlayUrl(puzzleId) {
    return `crossy://play/${encodeURIComponent(puzzleId)}`;
  }
  var AUTH_CALLBACK_URL = `${WEB_ORIGIN}/auth/ext/callback`;
  var DEFAULT_PUBLISHABLE_KEY = "sb_publishable_Ms9_XHXO1KwRAbtxM0JrSA_drJ0r7Pd";
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
  async function loadBases() {
    const overrides = await loadOverrides();
    return {
      apiBaseUrl: overrides.apiBaseUrl ?? DEFAULT_API_BASE,
      authBaseUrl: overrides.authBaseUrl ?? DEFAULT_AUTH_BASE,
      publishableKey: overrides.publishableKey ?? DEFAULT_PUBLISHABLE_KEY
    };
  }
  function originPattern(baseUrl) {
    const parsed = new URL(baseUrl);
    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  // src/pill/play-handler.ts
  async function handlePlayRequest(envelope, deps) {
    const granted = await deps.containsOrigins([originPattern(deps.apiBaseUrl)]);
    if (!granted) return { ok: false, reason: "no_permission" };
    const token = await deps.freshAccessToken();
    if (!token.ok) return { ok: false, reason: token.reason };
    let outcome;
    try {
      outcome = await deps.postPuzzle(
        deps.apiBaseUrl,
        token.accessToken,
        envelope
      );
    } catch {
      return { ok: false, reason: "network" };
    }
    if (!outcome.ok) {
      return {
        ok: false,
        reason: "rejected",
        code: outcome.code,
        message: outcome.message
      };
    }
    await deps.openTab(deps.playUrl(outcome.puzzleId));
    return { ok: true };
  }

  // src/background.ts
  var ext = typeof browser === "undefined" ? chrome : browser;
  var REFRESH_ALARM = "crossy/auth/refresh";
  var LEGACY_SETTINGS_KEY = "settings";
  var SILENT_PROVIDER = "discord";
  var area = chromeLocalArea();
  var AUTH_TAB_TIMEOUT_MS = 5 * 6e4;
  var pending = new PendingCaptures();
  function selectLauncher() {
    const identity = ext.identity;
    if (identity !== void 0 && typeof identity.launchWebAuthFlow === "function" && typeof identity.getRedirectURL === "function") {
      return identityLauncher(identity);
    }
    return tabRedirectLauncher({
      redirectUri: AUTH_CALLBACK_URL,
      pending,
      createTab: async (url) => (await ext.tabs.create({ url })).id,
      removeTab: async (tabId) => {
        try {
          await ext.tabs.remove(tabId);
        } catch {
        }
      },
      timeoutMs: AUTH_TAB_TIMEOUT_MS,
      startTimer: (ms, onFire) => {
        const handle = setTimeout(onFire, ms);
        return () => clearTimeout(handle);
      }
    });
  }
  var launcher = selectLauncher();
  function nowSec() {
    return Math.floor(Date.now() / 1e3);
  }
  async function authTarget() {
    const bases = await loadBases();
    return {
      authBaseUrl: bases.authBaseUrl,
      publishableKey: bases.publishableKey
    };
  }
  function armAlarm(expiresAt) {
    void ext.alarms.create(REFRESH_ALARM, {
      when: refreshAlarmWhenMs(expiresAt, nowSec())
    });
  }
  var inflightRefresh = null;
  function singleFlightRefresh() {
    inflightRefresh ??= (async () => {
      try {
        return await refreshStoredSession({ target: await authTarget(), area });
      } finally {
        inflightRefresh = null;
      }
    })();
    return inflightRefresh;
  }
  async function runScheduledRefresh() {
    const outcome = await singleFlightRefresh();
    if (outcome.ok) {
      armAlarm(outcome.session.expiresAt);
      return;
    }
    if (outcome.failure === "retry") {
      void ext.alarms.create(REFRESH_ALARM, { delayInMinutes: 1 });
    }
  }
  function randomBytes(out) {
    crypto.getRandomValues(out);
  }
  var interactiveInFlight = false;
  async function signIn(provider) {
    interactiveInFlight = true;
    try {
      const result = await runPkceAttempt(provider, {
        target: await authTarget(),
        area,
        redirectUri: launcher.redirectUri,
        launch: (url) => launcher.capture(url, true),
        randomBytes,
        nowSec
      });
      if (!result.ok) return { ok: false, reason: result.reason };
      armAlarm(result.session.expiresAt);
      return { ok: true };
    } finally {
      interactiveInFlight = false;
    }
  }
  var silent = new SilentSignIn({
    interactiveInFlight: () => interactiveInFlight,
    alreadySignedIn: async () => await loadSession(area) !== null,
    attempt: async () => {
      const web = await loadWebIdentity(area);
      const result = await runPkceAttempt(web?.provider ?? SILENT_PROVIDER, {
        target: await authTarget(),
        area,
        redirectUri: launcher.redirectUri,
        launch: (url) => launcher.capture(url, false),
        randomBytes,
        nowSec
      });
      if (!result.ok) return { ok: false };
      armAlarm(result.session.expiresAt);
      return { ok: true };
    }
  });
  async function handleWebSignal(identity) {
    await saveWebIdentity(identity, area);
    if (identity === null) return { ok: false };
    return silent.run();
  }
  async function signOut() {
    const session = await loadSession(area);
    if (session !== null) {
      await revokeSession(await authTarget(), session.accessToken);
    }
    await clearSession(area);
    await ext.alarms.clear(REFRESH_ALARM);
  }
  async function freshAccessToken() {
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
      reason: outcome.failure === "retry" ? "network" : "signed_out"
    };
  }
  var playUrl = /iP(hone|ad|od)/.test(navigator.userAgent) ? appPlayUrl : playIntentUrl;
  async function playFromPill(request) {
    const bases = await loadBases();
    return handlePlayRequest(buildEnvelope(request.format, request.document), {
      apiBaseUrl: bases.apiBaseUrl,
      containsOrigins: (origins) => ext.permissions.contains({ origins: [...origins] }),
      freshAccessToken,
      postPuzzle,
      playUrl,
      openTab: async (url) => {
        await ext.tabs.create({ url });
      }
    });
  }
  ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message?.type;
    if (type === AUTH_CALLBACK) {
      const tabId = sender.tab?.id;
      if (tabId !== void 0) {
        pending.deliver(tabId, message.url);
      }
      sendResponse({ ok: true });
      return false;
    }
    if (type === PLAY_REQUEST) {
      void playFromPill(message).then(sendResponse);
      return true;
    }
    if (type === AUTH_SIGN_IN) {
      const { provider } = message;
      void signIn(provider).then(sendResponse);
      return true;
    }
    if (type === AUTH_SILENT_SIGN_IN) {
      void silent.run().then(sendResponse);
      return true;
    }
    if (type === AUTH_WEB_SIGNAL) {
      void handleWebSignal(message.identity).then(
        sendResponse
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
  ext.tabs.onRemoved.addListener((tabId) => {
    pending.cancel(tabId);
  });
  async function rearm() {
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
    void chrome.storage.local.remove(LEGACY_SETTINGS_KEY);
    void rearm();
  });
})();
