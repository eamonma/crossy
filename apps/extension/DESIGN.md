---
status: descriptive
---

# Crossy extension design

Auth: adopted (owner ruling, 2026-07-12); it replaced the earlier
`externally_connectable` pairing proposal, recorded under Rejected below, and
the paste-token dev surface is gone. Play surface: designed 2026-07-12, lands
with Wave 6.4.

## The auth design

The extension is a first-class Supabase auth client with its own session, not a
borrower of the web app's. Sign-in runs OAuth through the browser identity API,
against the same providers the web offers (Discord primary, Apple):

1. The popup's provider button hands off to the service worker (the popup closes
   when the auth window takes focus, so the flow cannot live there). The worker
   builds `{AUTH_BASE}/auth/v1/authorize` with `provider`, a PKCE S256
   `code_challenge`, and `redirect_to = identity.getRedirectURL()`, then calls
   `identity.launchWebAuthFlow`.
2. The captured redirect carries `?code=`, exchanged at
   `{AUTH_BASE}/auth/v1/token?grant_type=pkce` with the code verifier.
3. The `{access_token, refresh_token, expires_at, email, display name}` set lands in
   `chrome.storage.local` (local, never sync: a refresh token must not fan out
   across devices).

The flow is hand-rolled over fetch and WebCrypto (`src/auth/`); supabase-js stays
out of the bundle. Every GoTrue call sends the publishable key as `apikey`; it is
public by design, the same key the web client serves in `/config.json`.

**Refresh.** MV3 workers are ephemeral, so freshness has two legs: a
`chrome.alarms` alarm aimed five minutes before expiry, and an on-demand check
(any token request inside the sixty-second margin refreshes first). All refreshes
run in the worker, single-flight, so rotation never races between contexts.
Rotation safety: the new pair is persisted in one atomic `storage.set` before the
old one is forgotten. A refresh failure splits two ways and only one signs out:
400/401/403 from the grant is a definitive verdict on the credential (revoked,
already used, malformed), so the session clears and the popup returns to
signed-out; everything else (network down, 429, 5xx, a misconfigured base
answering 404) retries later and never signs out.

**Sign out.** `POST {AUTH_BASE}/auth/v1/logout?scope=local` best-effort with the
access token, then storage clears regardless. `scope=local` so only the
extension's session dies; the web app and other devices stay signed in.

**Bearer holder, not verifier.** Tokens minted under the `api.crossy.party` custom
domain carry the Supabase ref-domain issuer
(`https://qvnvokstvbarsxhufrja.supabase.co/auth/v1`). The extension never decodes
or validates claims, issuer included; it stores tokens and presents them.

**Silent sign-in.** If you are already signed into the web app, the extension signs
itself in with no click. The mechanism shares no tokens. It leans on the OAuth
provider (Discord primary) still holding a live session in the browser: the extension
runs its OWN normal PKCE flow with `interactive: false`, which completes with no
visible window when that provider session exists. On success the extension gets its
own independent, properly-rotating session, exactly as the interactive flow does; the
two flows run the same authorize URL, the same code exchange, the same atomic persist,
differing only in the `interactive` flag. On failure (no live provider session) it
stays signed out silently. This is safe because the extension is signed out when the
silent attempt runs: a failure has nothing to lose, so it never signs out and never
raises an error, unlike a refresh failure on an existing session. The attempt is
single-flighted and stands down while an interactive sign-in is in flight or a session
already exists, so at most one OAuth flow ever races to persist. Discord only; Apple
rarely keeps a silent session and its button stays.

Two triggers fire it. The popup, opening signed out, asks the worker for a silent
sign-in behind a quiet "checking" state and time-boxes the wait, dropping to the
provider buttons on failure or timeout; this needs no extra permission and works on
both browsers. The crossy.party content script is the automatic half: at
`document_idle` it reads `window.localStorage` for a live supabase-js session and
reports the web account to the worker. What crosses is the account's identity (the
Supabase user id, the OAuth provider, and a display name), never a token; the worker
stashes it and steers the silent attempt at that provider, so a success lands the SAME
account the user plays as on the web. Reading identity metadata rather than a bare
boolean is a deliberate, reviewed relaxation of the earlier "boolean only" rule: it
still never reads, forwards, or logs the web app's tokens. The coupling to supabase-js's
storage stays loose: an unrecognized shape, or a guest session with no steerable
provider, reports nothing and the popup trigger still covers sign-in.

Firefox cannot do the silent half. `identity.launchWebAuthFlow({interactive: false})`
there throws `Requires user interaction` for a provider redirect chain (it will not
follow `api.crossy.party` -> the provider -> back without a visible step), unlike
Chrome, so the silent attempt always fails; separately, the content script's host
permission is opt-in (all Firefox host permissions are). The extension does not pretend
otherwise: when the web app is signed in and the silent attempt does not complete, the
popup offers a one-click "Continue as \<name\>" at the web account's provider. That one
interactive sign-in mints the extension's own rotating session, which then refreshes
forever with no further `launchWebAuthFlow`, so the click is a one-time cost, not per
session. On Chrome the silent half still works.

Safari implements no `identity` API at all: no `launchWebAuthFlow`, no `getRedirectURL`,
and it refuses to redirect an OAuth provider to a custom-scheme (extension) URL, so it
cannot capture the redirect the way Chrome and Firefox do. The `webRequest.onBeforeRedirect`
capture trick is out too, unavailable to an MV3 non-persistent worker. So Safari runs the
same PKCE flow in a real tab: the worker builds the identical `/authorize` URL but points
`redirect_to` at a hosted https page it controls (`crossy.party/auth/ext/callback`,
settings.ts `AUTH_CALLBACK_URL`), opens it with `tabs.create`, and waits. GoTrue redirects
that tab to the callback carrying `?code=`; a content script on the callback page reports
the URL to the worker, which resolves the pending capture and runs the exact same code
exchange, atomic persist, and refresh arming as every other browser. The capture is the
only seam (`auth/launcher.ts` selects it by `identity` presence; `auth/callback.ts` pairs
the opened tab with the awaiting attempt). The callback page is deliberately inert and
loads no supabase-js, or the web app would detect and consume the single-use code first;
it never reads or forwards the code. The worker closes the tab once the code is captured;
a user who closes it first, or a five-minute timeout, settles the attempt as a cancel.
This is interactive only, like Firefox: a tab is always visible, so there is no silent
path, and the popup offers the same one-click "Continue as \<name\>" steered by the web
signal. Safari still mints the extension's OWN independent, rotating session; nothing is
borrowed from the web app's tokens. Owner setup: the callback URL must be in the Supabase
auth redirect allowlist, and the user grants crossy.party site access (Safari host
permissions are opt-in) for the callback content script to run.

This is web-to-extension only. Extension-to-web is deliberately not done: pushing the
extension's session back into the web origin would mean injecting tokens into
crossy.party's storage and sharing a refresh token across the two contexts, which
trips Supabase's rotation reuse detection. The independent-session property is the
whole point; a shared refresh token would break it.

**Account alignment.** The two sessions are separate by design, but they must resolve
to the SAME Supabase user, or a puzzle the extension ingests (owned by the extension's
account under `POST /puzzles` `created_by`) never appears in the web library (scoped to
the web account) the user plays from. The web signal carries the account id for exactly
this: the popup compares it against the extension's own `user.id` and, on a mismatch,
warns without blocking and offers a one-click switch to the web account. Steering the
silent and the "continue as" sign-in at the web account's provider keeps the two
aligned by construction in the common case; the id comparison is the backstop for the
rest (a different account under the same provider, say). The id is identity metadata,
not a credential, and never leaves the machine.

## Baked defaults

- `DEFAULT_API_BASE = https://rest.crossy.party` (the Crossy REST API)
- `DEFAULT_AUTH_BASE = https://api.crossy.party` (Supabase auth, GoTrue under
  `/auth/v1`)

These are different hosts, and the distinction bit in practice: pasting the auth
host as the API base yields Kong's "requested path is invalid". So the API base is
no longer user input. The options page is an advanced section for local stacks
only: API base, auth base, and publishable key overrides, empty by default. Host
permissions stay on demand (requested inside the click gesture) and cover the
defaults and any override alike.

## Rejected

- **Token relay from crossy.party** (`externally_connectable` messaging, or a
  content-script `postMessage` relay): relays are access-token-only, because
  sharing the refresh token between the SPA and the extension trips Supabase's
  rotation reuse detection. An access token dies about an hour after the last
  crossy.party visit, and the extension is used away from crossy.party by design;
  a credential that goes stale unless you keep visiting the site defeats the tool.
- **OAuth 2.1 dynamic client registration**: a registered client would buy
  per-client policy that nothing consumes today. Revisit only when a real consumer
  appears.

## Stable ids

**Chrome.** The manifest commits a `key` (public key only), pinning the unpacked
dev id to `kgnlalghkpkbnkagkhbccnocoacpcmem`. Generated with:

```sh
openssl genrsa -out crossy-ext-dev.pem 2048
# manifest "key":
openssl rsa -in crossy-ext-dev.pem -pubout -outform DER | openssl base64 -A
# extension id:
openssl rsa -in crossy-ext-dev.pem -pubout -outform DER \
  | shasum -a 256 | cut -c1-32 | tr '0-9a-f' 'a-p'
```

Only the public key is committed. Unpacked dev loads need nothing else: Chrome
derives the id from the manifest key. The Chrome Web Store assigns its own id at
first upload unless the first package carries the private key; whether the store
id should match the dev id is a packaging-wave call (ROADMAP Wave 6.4), and the
owner holds the `.pem` for that choice.

**Firefox.** `browser_specific_settings.gecko.id = "extension@crossy.party"`.
Chrome logs an unrecognized-key warning for this block and ignores it; nothing
breaks.

The background form does not share that tolerance: Chrome hard-rejects an MV3
manifest carrying `background.scripts` ("requires manifest version of 2 or
lower", observed on a real load 2026-07-12), while Firefox runs MV3 backgrounds
as event pages via exactly that key. One manifest cannot serve both. The
committed manifest and `dist/` are the Chrome form (`service_worker` only,
pinned by `manifest.test.ts`); `build:firefox` emits `dist-firefox/` with the
background swapped to `scripts` (`scripts/build-firefox.mjs`). The
`browser ?? chrome` shim in the code is unaffected either way. That transform
also drops the top-level `key` from the Firefox build: it pins the Chrome
unpacked dev id and means nothing to Firefox, which logged "Reading manifest:
Warning processing key" and ignored it. Stripping it stops the warning; the
Chrome `dist/` keeps `key` (both pinned by `manifest.test.ts`). The reverse
still holds, harmlessly: Chrome logs an unrecognized-key warning for the
`gecko` block and ignores it.

Two more Firefox laws, both observed on the first temporary load (2026-07-12):
`permissions.request` must be reached synchronously from the user input
handler, so no await may precede it in a click path and every origin a click
needs rides one request (`requestOriginPermissions`; the popup pre-resolves
bases at init for this reason). And Firefox treats all host permissions as
opt-in, including content-script match patterns, so puzzle-page detection is
dead until the user grants site access from the extensions button.

## Supabase redirect allowlist

The owner must add the identity redirect URLs to the Supabase auth URL allowlist:

- Chrome: `https://kgnlalghkpkbnkagkhbccnocoacpcmem.chromiumapp.org/`
- Firefox: `https://a9cefb33c7f1e3c38f826caa8834a8fc2b0fddd7.extensions.allizom.org/`
  (the host is the SHA-1 hex of the gecko id; confirm with
  `browser.identity.getRedirectURL()` in the extension console)
- Safari: `https://crossy.party/auth/ext/callback` (Safari has no identity redirect; the
  tab flow redirects here, a hosted inert page, settings.ts `AUTH_CALLBACK_URL`)

## Play surface (Wave 6.4)

The extension's job ends at ingest; play belongs to the web app (root DESIGN.md
section 7, D22). "Play in Crossy" anywhere in the extension means: extract,
POST /puzzles, open a new tab at the web app's play intent for the returned
puzzle id. Room creation UX exists once.

Two surfaces, one flow:

- **Popup, the invariant path.** The primary action on any supported page. It
  works wherever an adapter works, including inside AmuseLabs embeds, whatever
  the pill's state, site toggles, or a publisher redesign have done.
  Add-to-library stays as the quieter secondary action.
- **Inline pill, an enhancement.** Guardian and NYT top-level pages only.
  Shadow root (no CSS bleed in either direction), mounted adjacent to the
  puzzle, re-mounted via MutationObserver when the SPA re-renders, and shown
  only after the adapter produced a successful extraction, so the button never
  appears on a page we cannot ingest. Per-site toggle, default on. No publisher
  trademarks. AmuseLabs embeds are excluded: the content script lives inside
  the publisher's iframe, and a Crossy button there renders inside their
  player.

Permissions: content scripts cannot call `permissions.request`, and a
background request relayed from a page click carries no gesture in Firefox. So
the sign-in click requests every origin the product needs in one call (auth and
API bases; `requestOriginPermissions` already takes a list), and the pill never
prompts. If the API origin is missing at pill-click time anyway, the pill
defers to the popup path instead of failing silently.

Visual design: popup, options, and pill get a design pass to the product's
language (the iOS and web direction; the current popup is dev scaffolding, not
a spec). Icons (16/32/48/128) come from the committed CROSSY icon-generator
precedent and land with this pass.

## Open questions

- Whether signed-in extensions deserve server-side visibility (a connected-devices
  list) or stay purely client-side. Unchanged from the previous proposal.
- Store-build ids and allowlist entries for the published packages (Wave 6.4).
