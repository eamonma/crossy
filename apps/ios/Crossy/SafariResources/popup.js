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

  // src/auth/alignment.ts
  function alignmentState(session, web) {
    if (session === null) {
      return web === null ? { kind: "signed-out" } : { kind: "connect", provider: web.provider, name: web.displayName };
    }
    if (web === null) return { kind: "aligned" };
    if (session.userId !== null && session.userId !== web.userId) {
      return { kind: "mismatch", provider: web.provider, name: web.displayName };
    }
    return { kind: "aligned" };
  }

  // src/auth/messages.ts
  var AUTH_SIGN_IN = "crossy/auth/sign-in";
  var AUTH_SILENT_SIGN_IN = "crossy/auth/silent-sign-in";
  var AUTH_SIGN_OUT = "crossy/auth/sign-out";
  var AUTH_TOKEN = "crossy/auth/token";

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
  async function loadSession(area) {
    const stored = await area.get(SESSION_KEY);
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
  async function loadWebIdentity(area) {
    const stored = await area.get(WEB_IDENTITY_KEY);
    const raw = stored[WEB_IDENTITY_KEY];
    if (typeof raw !== "object" || raw === null) return null;
    const w = raw;
    if (typeof w.userId !== "string" || w.userId === "") return null;
    if (w.provider !== "discord" && w.provider !== "apple") return null;
    if (typeof w.displayName !== "string") return null;
    return { userId: w.userId, provider: w.provider, displayName: w.displayName };
  }

  // src/popup-silent.ts
  function failAfter(ms, setTimeoutFn) {
    return new Promise((resolve) => {
      setTimeoutFn(() => resolve({ ok: false }), ms);
    });
  }
  async function silentSignInThenRender(deps) {
    const setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    deps.showChecking();
    let reply;
    try {
      reply = await Promise.race([
        deps.requestSilent(),
        failAfter(deps.timeoutMs, setTimeoutFn)
      ]);
    } catch {
      reply = { ok: false };
    }
    if (reply.ok) deps.onSignedIn();
    else deps.onSignedOut();
  }

  // src/envelope.ts
  function buildEnvelope(format, document2) {
    return { format, document: document2 };
  }

  // src/messaging.ts
  var EXTRACT_REQUEST = "crossy/extract";

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
  function pillSiteForUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname;
    if ((host === "www.theguardian.com" || host === "theguardian.com") && parsed.pathname.startsWith("/crosswords/")) {
      return "guardian";
    }
    if (host === "www.nytimes.com" && parsed.pathname.startsWith("/crosswords/game/")) {
      return "nyt";
    }
    return null;
  }
  function pillReSummonSite(url, disabled) {
    const site = pillSiteForUrl(url);
    if (site === null || disabled[site] !== true) return null;
    return site;
  }

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
  function selectPlayUrl(userAgent) {
    return /iP(hone|ad|od)/.test(userAgent) ? appPlayUrl : playIntentUrl;
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
  function requestOriginPermissions(baseUrls) {
    const origins = baseUrls.map(originPattern);
    return chrome.permissions.request({ origins });
  }
  var PUZZLE_SITE_ORIGINS = [
    "https://www.nytimes.com/*",
    "https://www.theguardian.com/*",
    "https://theguardian.com/*",
    "https://*.amuselabs.com/*"
  ];
  function requestPuzzleSitePermissions() {
    return chrome.permissions.request({ origins: [...PUZZLE_SITE_ORIGINS] });
  }
  function hasPuzzleSitePermissions() {
    return chrome.permissions.contains({ origins: [...PUZZLE_SITE_ORIGINS] });
  }

  // src/popup.ts
  var bases;
  var identityEl = document.getElementById("identity");
  var statusEl = document.getElementById("status");
  var actionsEl = document.getElementById("actions");
  var resultEl = document.getElementById("result");
  var pillNoteEl = document.getElementById("pill-note");
  var siteAccessEl = document.getElementById(
    "site-access"
  );
  var alignNoteEl = document.getElementById(
    "align-note"
  );
  var PROVIDERS = [
    { provider: "discord", label: "Sign in with Discord", tone: "primary" },
    { provider: "apple", label: "Sign in with Apple", tone: "quiet" }
  ];
  var SILENT_TIMEOUT_MS = 4e3;
  function showResult(text, isError) {
    resultEl.classList.toggle("error", isError);
    resultEl.textContent = text;
  }
  function renderChecking() {
    identityEl.textContent = "";
    statusEl.textContent = "Checking your Crossy sign-in...";
    showResult("", false);
    alignNoteEl.replaceChildren();
    actionsEl.replaceChildren();
  }
  async function extractFromActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;
    try {
      return await chrome.tabs.sendMessage(tab.id, {
        type: EXTRACT_REQUEST
      });
    } catch {
      return null;
    }
  }
  function startSignIn(provider, signOutFirst) {
    void (async () => {
      const granted = await requestOriginPermissions([
        bases.authBaseUrl,
        bases.apiBaseUrl
      ]);
      if (!granted) {
        statusEl.textContent = "Crossy needs permission to reach its servers to sign you in.";
        return;
      }
      if (signOutFirst) {
        await chrome.runtime.sendMessage({ type: AUTH_SIGN_OUT });
      }
      statusEl.textContent = "Finish signing in in the window that opened, then reopen this popup.";
      const reply = await chrome.runtime.sendMessage({
        type: AUTH_SIGN_IN,
        provider
      });
      if (reply.ok) {
        void init();
      } else {
        statusEl.textContent = `Sign-in failed: ${reply.reason}`;
      }
    })();
  }
  function signInButton(label, tone, provider, signOutFirst = false) {
    const button = document.createElement("button");
    button.className = tone;
    button.textContent = label;
    button.addEventListener("click", () => startSignIn(provider, signOutFirst));
    return button;
  }
  function renderSignedOut() {
    identityEl.textContent = "";
    statusEl.textContent = "Sign in to add puzzles to your Crossy library.";
    showResult("", false);
    alignNoteEl.replaceChildren();
    const buttons = PROVIDERS.map(
      ({ provider, label, tone }) => signInButton(label, tone, provider)
    );
    actionsEl.replaceChildren(...buttons);
  }
  function renderConnect(state) {
    identityEl.textContent = "";
    statusEl.textContent = `You're signed in to Crossy on the web as ${state.name}.`;
    showResult("", false);
    alignNoteEl.replaceChildren();
    const cont = signInButton(
      `Continue as ${state.name}`,
      "primary",
      state.provider
    );
    const other = document.createElement("button");
    other.className = "linklike";
    other.textContent = "Use a different account";
    other.addEventListener("click", () => renderSignedOut());
    actionsEl.replaceChildren(cont, other);
  }
  function renderAlignNote(state) {
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
      true
    );
    alignNoteEl.replaceChildren(warn, swtch);
  }
  async function ingest(extraction) {
    const granted = await requestOriginPermissions([bases.apiBaseUrl]);
    if (!granted) {
      return {
        ok: false,
        sessionEnded: false,
        line: "Crossy needs permission to reach the API to add this puzzle."
      };
    }
    const token = await chrome.runtime.sendMessage({
      type: AUTH_TOKEN
    });
    if (!token.ok) {
      if (token.reason === "signed_out") {
        return { ok: false, sessionEnded: true, line: "" };
      }
      return {
        ok: false,
        sessionEnded: false,
        line: "Could not refresh your session. Check your connection and try again."
      };
    }
    let outcome;
    try {
      outcome = await postPuzzle(
        bases.apiBaseUrl,
        token.accessToken,
        buildEnvelope(extraction.format, extraction.document)
      );
    } catch {
      return {
        ok: false,
        sessionEnded: false,
        line: `NETWORK: could not reach ${bases.apiBaseUrl}`
      };
    }
    if (outcome.ok) return { ok: true, puzzleId: outcome.puzzleId };
    return {
      ok: false,
      sessionEnded: false,
      line: `${outcome.code}: ${outcome.message}`
    };
  }
  function renderIngest(extraction) {
    statusEl.textContent = "Crossword found on this page.";
    const play = document.createElement("button");
    play.className = "primary";
    play.textContent = "Play in Crossy";
    const setBusy = (busy) => {
      play.disabled = busy;
    };
    const fail = (run) => {
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
        const run = await ingest(extraction);
        if (!run.ok) {
          fail(run);
          return;
        }
        await chrome.tabs.create({
          url: selectPlayUrl(navigator.userAgent)(run.puzzleId)
        });
        window.close();
      })();
    });
    actionsEl.replaceChildren(play);
  }
  async function renderSignedIn(who) {
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
    const label = who.email !== null && who.email !== who.displayName ? `${who.displayName} (${who.email})` : who.displayName;
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
  var silentInFlight = false;
  async function activeTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url ?? null;
  }
  async function renderPillNote() {
    const url = await activeTabUrl();
    const site = url === null ? null : pillReSummonSite(url, await loadPillDisabled());
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
  async function showAgain(site) {
    await setPillDisabled(site, false);
    pillNoteEl.replaceChildren("Shown. Reload the page to see it.");
  }
  async function renderSiteAccess() {
    let held;
    try {
      held = await hasPuzzleSitePermissions();
    } catch {
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
        const granted = await requestPuzzleSitePermissions();
        if (granted) {
          siteAccessEl.replaceChildren(
            "Access on. Reload the crossword page to add it."
          );
          return;
        }
        text.textContent = "Still off. Allow Crossy for these sites, then tap again.";
        turnOn.disabled = false;
      })();
    });
    siteAccessEl.replaceChildren(text, turnOn);
  }
  async function init() {
    bases = await loadBases();
    await renderPillNote();
    await renderSiteAccess();
    const area = chromeLocalArea();
    const session = await loadSession(area);
    const state = alignmentState(session, await loadWebIdentity(area));
    if (session !== null) {
      await renderSignedIn({
        displayName: session.displayName,
        email: session.email
      });
      renderAlignNote(state);
      return;
    }
    silentInFlight = true;
    await silentSignInThenRender({
      requestSilent: () => chrome.runtime.sendMessage({
        type: AUTH_SILENT_SIGN_IN
      }),
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
      timeoutMs: SILENT_TIMEOUT_MS
    });
  }
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (silentInFlight) return;
    if (areaName === "local" && SESSION_KEY in changes) void init();
  });
  void init();
})();
