---
status: normative
verified: 133db08
---

# Crossy Analytics

Normative. Product analytics ride PostHog. This document owns the event vocabulary, the
identity rule, the INV-6 posture, and the port standard. An event or property not
covered here does not ship; extending the vocabulary is a reviewed edit to this file.

## Event vocabulary v1

| Event             | Emitted by | When                                                                           |
| ----------------- | ---------- | ------------------------------------------------------------------------------ |
| `room_created`    | api        | a game is created                                                              |
| `room_joined`     | session    | a member's first live socket; a reconnect after a full disconnect counts again |
| `socket_closed`   | session    | a socket closes; skipped for a pre-handshake socket (no identity to key on)    |
| `solve_completed` | session    | the actor emits `gameCompleted`                                                |
| `room_abandoned`  | session    | a game reaches `abandoned`                                                     |
| `signed_in`       | clients    | an interactive sign-in completes (an OAuth return, a guest sign-in)            |
| `app_opened`      | clients    | boot, once per open                                                            |

Autocapture and pageviews run on the web client alongside this table; they lift
interaction shape, never content (see the INV-6 posture below).

## Identity

`distinctId` is always the provider-issued userId: the same UUID every foreign key
points at (DESIGN.md section 8), so analytics joins against the rest of the system
without a mapping table. Clients call `identify(userId, { isAnonymous })` when a session
lands and `reset()` on sign-out. A restored persisted session (app relaunch, page load
with a standing session) identifies without capturing `signed_in`; the event means the
same interactive act on every client. No email, display name, or other PII rides as a
trait.

## INV-6 posture

Solutions never leave the server, and an analytics event is a client payload like any
other. Events carry counts, ids, and status only; never letters, cells, coordinates, or
solutions. Session replay is disabled at init and stays off: replay records the DOM, and
the board DOM converges on the solution. The web grid renders under `ph-no-capture`
(CrosswordGrid.tsx), so autocapture can never lift board content even by accident. A
property that would break this posture does not ship, whatever its analytics value.

## The port standard

Every codebase consumes an Analytics port; the vendor SDK is confined to the adapter
directories (`apps/web/src/analytics`, the server equivalents
`apps/api/src/analytics` and `apps/session/src/analytics`, and on iOS
`Crossy/Analytics`). dependency-cruiser fails lint on a PostHog import anywhere else
(`posthog-sdk-only-in-analytics-adapters`); on iOS the boundary is the linker's: the
SDK links to the app target alone, so neither the widget nor the Swift packages can
import it. Absent or empty analytics config selects a no-op adapter, so dev, tests,
previews, and a deploy without a token never touch the vendor. On web and the services
the token arrives via env at container start (config.json on web), never baked into
the JS bundle; on iOS it is committed config (CrossyConfig.plist), the
publishable-key footing, since a phc token is write-only and public by design.
