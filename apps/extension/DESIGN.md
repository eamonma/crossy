# Extension pairing handshake (proposal)

Status: proposal for the Wave 6.2 follow-up track. This slice ships dev-only auth: an
options page where a bearer token and API base URL are pasted into
`chrome.storage.local`. That is a developer tool, not the product. The web-side
counterpart is out of scope for this branch.

## Proposal

Pair through `externally_connectable` messaging with the crossy.party web app. The
manifest declares `"externally_connectable": {"matches": ["https://crossy.party/*"]}`,
so only that origin may open the channel; the browser enforces it before any code
runs. After an explicit "Connect the extension" click on crossy.party, the page calls
`chrome.runtime.sendMessage(EXTENSION_ID, {type: "crossy/pair", accessToken,
expiresAt})`. The extension's `onMessageExternal` listener checks `sender.origin`
against the same allowlist (defense in depth over the manifest gate), stores the
token, and replies with the paired state. The API base URL stops being user input:
a paired extension talks to the production API.

Why this channel: the sender origin is browser-verified, the token never rides the
page DOM or a broadcast `window.postMessage` that any script in the page could
listen to, and no content script needs to run on crossy.party in Chrome.

## Threat considerations

- **Who may message.** Exactly `https://crossy.party`. No wildcard subdomains, no
  crossy.me (it 301s to crossy.party and never serves the app). Dev builds may add
  localhost; store builds must not.
- **Token lifetime.** The extension holds only the short-lived access token, the
  same bearer the SPA uses (about an hour). Never the refresh token: extension
  storage is plaintext on disk, and a long-lived credential there widens theft. On a
  401 the extension marks itself unpaired and points the user at crossy.party.
- **Refresh.** Once paired, the web app may re-push a fresh access token on any
  visit while signed in; the first pairing is always an explicit click. Whether an
  hourly re-visit is acceptable or the push should be automatic is an open question
  below.
- **Revocation.** Expiry bounds exposure to the token lifetime. An "unpair" action
  in the options page clears storage; a `crossy/unpair` message from the web does
  the same. Server-side session revocation fails the token closed on the next
  request, since the API verifies per request.

## What the web side needs

- A "Connect the extension" affordance, behind a user click, full accounts only.
- The published extension id per browser build, shipped as config.
- A small module that sends `crossy/pair` with the current access token, treats a
  rejected `sendMessage` as "extension not installed", and shows the paired state.
- Optionally a token re-push on visits once paired, per the refresh question.

## Open questions

- Firefox has no `externally_connectable`. The counterpart there is a content
  script scoped to crossy.party relaying `window.postMessage` with strict
  `event.origin` checks and the same message shapes. Ship both from the start, or
  Chrome first?
- Automatic refresh push versus re-pairing when the token expires.
- Whether pairing deserves server-side visibility (a connected-devices list) or
  stays purely client-side.
