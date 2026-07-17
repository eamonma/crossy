---
status: descriptive
verified: 133db08
---

# Display name onboarding and the Settings nickname editor

Status: SHIPPED via PR #236 (commit 5a8c7ff; API cec72cf, web 78b5c6c, iOS 30e3af6).
The R1 JIT upsert shipped verbatim (`apps/api/src/auth/jit-upsert.ts:57-61`); the module
landed in `apps/api/src/identity/` per R8's redirect, not the `apps/api/src/profile/` the
sections below name.
Author: DESIGN. Precedence: `vectors/` > `PROTOCOL.md` > this doc > any implementation.

## 0. Post-review revisions (authoritative; overrides the sections below where they conflict)

An adversarial review found one critical defect and several real gaps. These resolutions
are authoritative. Where a later section conflicts, this section wins.

**R1 (was Critical). The JIT mirror clobbers a chosen name; fix it in the upsert, not with
prose.** `apps/api/src/auth/jit-upsert.ts:51` writes
`display_name = coalesce(excluded.display_name, users.display_name)`, so the incoming
token's provider name (Discord `user_name`, Apple `full_name` persisted in `user_metadata`
by `SupabaseAuth.updateUserFullName`, any OIDC name claim) OVERWRITES the stored value on
every authenticated request (`middleware.ts:26` runs the upsert per request). Section 7.2
bullet (d) is exactly backwards and is struck. The fix is a conditional on-conflict
expression:

```sql
display_name = CASE
  -- guest -> permanent upgrade: drop the "Guest" default, adopt the provider name or null
  WHEN "users".is_anonymous AND NOT excluded.is_anonymous THEN excluded.display_name
  -- established row: the app DB value wins; a token name only FILLS a null
  ELSE coalesce("users".display_name, excluded.display_name)
END
```

SET expressions read the pre-update row, so `"users".is_anonymous` is the OLD value; the
upgrade branch fires only on the first post-upgrade token (monotonic `is_anonymous` makes
later stale-guest tokens take the ELSE, which keeps the adopted name). `avatar` is
unchanged (avatars are provider-resolved, not user-editable, section 3 non-goal). Result:
a user-chosen name is never overwritten; a provider name still SEEDS a null row and still
adopts on upgrade. This makes "app DB is the single source of truth" actually true.

- **Behavior change to own in tests.** `apps/api/src/api.test.ts:354` ("propagates a
  changed provider display name on the next request") still holds for a row whose name is
  still provider-owned (never PATCHed): a provider rename propagates only while the app-DB
  value has not diverged. Amend/retarget that test to assert the new contract: a provider
  name change does NOT overwrite an app-DB name the user set via `PATCH /me`. Add a test:
  "PATCH /me name survives a later request whose token carries a different provider name
  (INV-7, user owns the name)". `api.test.ts:337` (a metadata-less token never clobbers a
  known name) still passes and now covers all tokens.

**R2 (was High 2). No `"Guest"` sentinel.** Because the upgrade branch of R1 drops `"Guest"`
to the provider name or null, a nameless PERMANENT account is always `display_name IS NULL`.
So the nameless trigger is simply `!isAnonymous && display_name IS NULL`. Delete every
`name === "Guest"` nameless check (sections 4 case 4, 9.1, 11.1, 15). A permanent user may
now safely choose the literal name "Guest"; they are not re-onboarded. Guests (anonymous)
keep the `"Guest"` render label and are never prompted (join-only). The editor is for
permanent accounts only in v1.

**R3 (was Medium). Server computes the trigger; the client holds no policy.** `GET /me`
returns an explicit `needsName: boolean` = `!isAnonymous && display_name IS NULL`, alongside
`displayName` (still `string | null`, for the live preview and prefill). The client shows
onboarding iff `needsName`. This removes the client-side sentinel/derivation logic and keeps
the naming policy in one place (the identity service).

**R4 (was High 3). Required, but never a hard lockout.** Onboarding stays required and is
presented over the shell, but it must not wall the app behind a mandatory write with no
escape. Submit is resilient: on network/5xx, auto-retry with backoff; on `429`, honor
`Retry-After` and show the rate-limit copy (added to BOTH onboarding error maps, section 14);
never sign out (INV-11). After bounded retries fail, allow "Continue": adopt the confirmed
name locally, dismiss, and flush a single pending `PATCH /me` on the next foreground or next
authed request; re-present onboarding only if a fresh `GET /me` still reports `needsName`.
The name is authoritative only once the server confirms; a brand-new user has no room yet,
so the transient unsynced window is invisible to others and self-heals. A `NAME_*` 422 is
not a lockout (the prefill is always valid, so the user can revert with one tap).

**R5 (was Medium 4). One web representation of the name.** Collapse the two stores. The
Supabase adapter, on `load()`/`onChange`, populates `IdentitySession.displayName` from
`GET /me` and that is the only value any UI renders. `displayNameOf`'s token-metadata
derivation and its `"Player"` literal are removed from the DISPLAY path entirely; the
derived value may only arm the trigger hint, never render. Pre-`/me`, a permanent user shows
a neutral placeholder (an empty puck/initial), not a synthesized name. The adapter's
profile-load is the single reconciliation point.

**R6 (was Medium 5). Share the spec constants; do not inline in three places.** The
max-grapheme constant and the disallowed-scalar ranges live in `packages/protocol`
(exported), imported by the API validator and the web sanitizer. iOS re-declares them
(no TS import) but is pinned by the shared vector. The vector pins the authoritative
`canonicalize`+`validate` path; add cases that also exercise the edge `sanitize` filter
(disallowed-scalar stripping, grapheme cap without trim/collapse) so the per-keystroke
function cannot drift from the submit function.

**R7 (was Medium 6). The server's grapheme count is authoritative.** `Intl.Segmenter`
(Node 24, confirmed) and Swift `String.count` may differ from a browser's ICU on exotic new
emoji/flags. The client cap is a courtesy; a client that counts fewer simply sees a server
`NAME_TOO_LONG` 422, an acceptable degradation. State this in section 5. Add vector cases
for a regional-indicator flag and a multi-ZWJ family emoji so runner behavior is visible;
runtime ICU skew is a documented residual, not a guarantee. 40 keeps a generous margin.

**R8 (was Low 7). `/me` lives in the identity module, for cohesion.** Do NOT add a new
top-level `apps/api/src/profile/` module. Self display identity belongs with the existing
identity module (`apps/api/src/identity/`, which already owns the self `users` row via
deletion and the JIT mirror concern; DESIGN.md section 7 "Identity and membership" is one
module). Add `GET /me` and `PATCH /me` as an identity-module route group (mounted
`app.route("/me", meRoutes(deps))` in `app.ts`), with the name spec as its own cohesive file
(`apps/api/src/identity/display-name.ts`) and service methods (`readMe`, `setDisplayName`).
Everywhere the sections below say `apps/api/src/profile/...`, read `apps/api/src/identity/...`.
The web/iOS client seams stay as specified (a clean port method / client method), and the
web data-access file is `apps/web/src/profile/` (client-side grouping is fine; the server
cohesion is the point).

**R9 (was Low 8 / Nit 9).** Add `RATE_LIMITED`/`rate_limited` copy to the onboarding error
maps (section 14), not just Settings. Names are rendered only as escaped text (React text
nodes / SwiftUI `Text(verbatim:)`); never interpolate a display name into an unescaped sink.
The `/g/{code}` unfurl HTML must keep escaping any future host-name it embeds (out of scope
here; flagged for the Phase-2 OG card).

**Upheld from section 18 (unchanged):** `GET /me` + `PATCH /me` over reusing `/games`;
app-DB-only (no metadata write-through) with rationale (d) struck per R1; 1-40 graphemes
(server authoritative, R7); block-list, INV-1 does not apply; `null` reaches the client only
on `/me`; keep `"former participant"` for tombstoned only, no active-null session branch.

**Migration note.** R1 changes only the on-conflict expression in `jit-upsert.ts` (no schema
change) so section 16 "no field migration" still holds. There is NO new column. Section 17's
PR-2 must include the `jit-upsert.ts` change and the `api.test.ts:354` amendment.

## 1. Problem

Every user must always have a display name. Today many do not. `users.display_name`
is nullable (`packages/db/src/schema.ts`), the JIT mirror writes `null` for a permanent
account whose token carries no metadata name (`apps/api/src/auth/jit-upsert.ts`), and the
wire type demands a non-null string (`packages/protocol/src/messages.ts`
`PlayerConnectedMessage.displayName: string`, `packages/protocol/src/board.ts`
`Participant.displayName: string`). The session papers over the gap with the string
`"former participant"` (`apps/session/src/server.ts` `FORMER_PARTICIPANT`, line 81), a
fallback meant for tombstoned (deleted) accounts. A live nameless user rendering as
"former participant" is a defect, not a design.

The web client hides the gap a second way: `displayNameOf` in
`apps/web/src/identity/supabaseAdapter.ts` synthesizes a name client-side from token
metadata and, failing that, substitutes the literal `"Player"`. So the web session never
reports "nameless," and it reads a name the server does not know. This is a second source
of truth for display identity, and it is wrong. iOS had the mirror-image gap:
`AccountIdentity.displayName` was `String?` and `AuthSession` exposed no name at all
(the `SettingsScreen.swift` KNOWN GAP comment this feature filled).

This feature closes both gaps. It gives every nameless arrival a fast, beautiful
onboarding step that lands a real name in the app DB, and it adds a nickname editor in
Settings on both platforms. The app DB `users.display_name` becomes the single source of
truth clients read, replacing the client-side metadata derivation.

## 2. Goals

- Every account holds a non-empty `users.display_name` after its first session.
- Onboard a name the moment an authenticated user is found nameless, on iOS and web.
- A nickname editor in Settings on iOS and web, reading and writing the same source.
- One cohesive profile module: its own API route module, one clean client port method per
  platform, decoupled from games, puzzles, and deletion.
- Beautiful and idiomatic to each design system. No slop.
- App DB is authoritative. No client-side name synthesis as a display source.

## 3. Non-goals

- No name uniqueness. Two users may share a name (they are told apart by color and id).
- No profanity filter, no moderation queue. Out of scope; revisit if abuse appears.
- No avatar upload. Avatars stay provider-resolved (`avatar` column, DESIGN.md section 8).
- No `/me` for anything beyond self display identity in v1 (email is not surfaced to the
  client; see the endpoint rationale).
- No protocol version bump. Everything here is additive REST plus additive copy.
- No schema migration for the field: `display_name` already exists and is nullable.

## 4. Nameless entry cases

Enumerated against the code. Every case lands the same way: a permanent (non-anonymous)
`users` row whose `display_name` is `null` after `jitUpsertUser`. The trigger is uniform;
the causes differ.

1. **Email OTP / magic-link sign-up.** GoTrue mints the identity from the email alone; the
   access token carries no `user_metadata` name claim, so `verify` resolves
   `displayName: null` (`packages/auth/src/verify-core.ts`, name-key list exhausted) and
   the mirror writes `null` (not anonymous, so no `"Guest"` default). Confirmed the flow
   exists post-#230 (`sendEmailOtp` / `verifyEmailOtp` / `verifyEmailLink` on the Identity
   port, `apps/web/src/identity/types.ts`; `ContinueAnotherWaySheet` on iOS).
2. **Apple re-signup after deletion.** Apple returns the full name only on the first
   consent. A user who deleted their account (`DELETE /account`) and signs in with Apple
   again gets a token with no name claim, so `displayName: null`. (Apple also uses a
   private-relay email whose local part is random junk, so the email local-part fallback
   is useless here, by design.)
3. **Hisbaan OIDC, or any provider whose token omits a name.** `verify` reads the name from
   `full_name`, `name`, `user_name`, `preferred_username` in order (`DEFAULT_NAME_KEYS`,
   `packages/auth/src/port.ts`). A provider that populates none yields `displayName: null`.
4. **Guest upgrade without a provider name.** A guest's mirror row holds `"Guest"` (the
   anonymous default). When the guest links a full identity (Apple/Discord/OIDC/email), the
   account becomes permanent; if that provider carried no name, the coalesce keeps the old
   `"Guest"` string. We treat a still-`"Guest"` permanent account as nameless and prompt
   (see section 11, "Guest default").
5. **Any future login path yielding null/empty.** The trigger keys on the server's own
   answer (`GET /me`), not on a per-provider guess, so a new path costs nothing here.

Non-cases (already named, no prompt): a Discord sign-in (`full_name` present), an Apple
first-consent (name present), a guest who stays a guest (`"Guest"` is a fine guest label;
guests are join-only and never host, DESIGN.md section 8).

## 5. Name semantics (one shared spec)

The server enforces this exactly; both clients sanitize at the edge so a well-behaved
client never sees a surprise rejection. This spec is pinned by
`vectors/identity/display-name.json` (section 8) so the API validator, the web sanitizer,
and the iOS sanitizer cannot drift.

The name is user content shown back verbatim. It is never normalized for comparison and
never uppercased: **INV-1 (ASCII-only casing) does not apply.** INV-1 governs cell values
only (DESIGN.md lines 115, 262). Provider names already carry Unicode (Francois with the
cedilla, Wang in Han). We keep them.

**Canonicalization (applied by the server on write, in this order):**

1. **Unicode NFC** normalize. So one visual name has one byte form regardless of how the
   client composed it (precomposed vs combining).
2. **Trim** leading and trailing whitespace, where whitespace is the Unicode
   White_Space set.
3. **Collapse** any internal run of whitespace to a single ASCII space `U+0020`. A name is
   a label, not a layout.

**Validation (on the canonicalized value):**

- **Length.** Measured in **extended grapheme clusters** (user-perceived characters), not
  code points and not UTF-16 units. Bounds: **min 1, max 40 graphemes.** Rationale: 40 is
  generous for a display label (longer than any real first-and-last name, roomy for a
  handle) while bounding the column and the roster chip; 1 forbids the empty name, which is
  the whole point. Grapheme counting means a family emoji or a flag counts as one, so a
  user is not silently cut mid-glyph. (Implementation: `Intl.Segmenter` grapheme mode on
  the server and web; `String.count` on Swift, which is grapheme-based by default.)
- **Disallowed characters (reject, do not strip):**
  - Control characters: the C0 and C1 ranges (`U+0000`-`U+001F`, `U+007F`-`U+009F`),
    including newline and tab. A name is one line.
  - Zero-width and invisible formatters: `U+200B`-`U+200D` (ZWSP/ZWNJ/ZWJ standalone at the
    string level is disallowed **except** where a ZWJ sits inside a valid emoji grapheme
    cluster; the grapheme segmenter keeps emoji ZWJ sequences intact, so the check is "no
    lone zero-width outside an emoji cluster"), `U+FEFF` (BOM), `U+2060` (word joiner).
  - Bidi overrides: `U+202A`-`U+202E`, `U+2066`-`U+2069`. These can spoof a name's visible
    order; reject them. Plain RTL script (Arabic, Hebrew) is fine and rendered by the OS.
- **Allowed:** every other Unicode letter, mark, number, punctuation, symbol, and emoji.
  This is a block-list, not an allow-list: we name what breaks rendering or spoofs, and
  permit the rest.

**No uniqueness.** Duplicates are allowed.

**Empty-after-canonicalization is a rejection**, code `NAME_REQUIRED`. A whitespace-only or
all-stripped name never becomes a stored empty string.

**Prefill / default so onboarding is fast and never leaves anyone nameless.** The
onboarding form is pre-populated with a suggested name the user can accept with one tap:

1. If the token carried a usable metadata name (it will not, in the nameless cases, but the
   client has it cheaply), use it.
2. Else the email local part, unless the email is an Apple private-relay address
   (`APPLE_PRIVATE_RELAY_SUFFIX`, already special-cased in `supabaseAdapter.ts`), whose
   local part is random junk.
3. Else a friendly generated name from a small curated adjective+noun word list keyed
   deterministically off `user_id` (so the same user sees the same suggestion every time,
   and it is stable across a reopened form). Example shape: "Quiet Comet", "Amber Vireo".
   The word list lives client-side; it is a suggestion, never authoritative, so it needs no
   vector. The generated suggestion always passes the validation spec by construction.

The prefill is a suggestion in an editable field, not a silent write. The user confirms.

## 6. Architecture, module boundary, layering, data flow

### 6.1 Module boundary and cohesion

This ships as one cohesive **profile** module per surface, decoupled from games, puzzles,
and account-deletion:

- **API:** a new `apps/api/src/profile/` module (`routes.ts`, `service.ts`). It owns the
  `GET /me` read and the display-name write, mounted at `/me` in `app.ts`. It shares only
  the cross-cutting seams every module already shares: `authMiddleware`, `fail`/`errors`,
  the rate limiter, the `Db` handle. It does not import the games or identity-deletion
  modules and they do not import it.
- **Shared normative ground:** `packages/protocol` and `vectors/` gain the name spec and
  the endpoint's shapes. No new package; the name is a REST payload, not a wire message.
- **Web client:** the `Identity` port (`apps/web/src/identity/types.ts`) gains two methods,
  `loadProfile()` and `setDisplayName(name)`. The Supabase adapter implements them by
  calling the core API through the existing `authedFetch` seam (`apps/web/src/net/
authedFetch.ts`), not through Supabase PostgREST. A small `apps/web/src/profile/`
  data-access file (mirroring `apps/web/src/ui/roomAdmin.ts`) holds the two fetch calls; the
  adapter delegates to it so the port stays a thin, testable seam.
- **iOS client:** `CrossyAPIClient` (`apps/ios/Sources/CrossyAPI/CrossyAPIClient.swift`)
  gains `getMe()` and `updateDisplayName(_:)`, exactly like its existing `deleteAccount()`
  and `game(_:)` methods (same `Endpoint`, Bearer, 401-retry machinery). The UI reads the
  result through the composition root into `AccountIdentity` and a new onboarding view.

### 6.2 Layering (dependencies point inward only)

```
        packages/engine  (imports NOTHING, INV-9; untouched here)
              ^
   packages/protocol (name spec constants + REST shapes)   packages/auth (untouched)
              ^                                                   ^
   apps/api/src/profile ---> packages/db (users table), @crossy/auth (Identity)
              ^
   apps/web (Identity port + adapter)      apps/ios (CrossyAPIClient + UI)
```

- Apps import packages; packages never import apps; apps never import each other. The
  profile API module imports `@crossy/db` and `@crossy/auth` (both inner). The clients
  import `@crossy/protocol` for the shared length/spec constants if they choose (optional;
  the sanitizers may inline the same values, pinned by the shared vector either way).
- `packages/engine` is untouched. Stated for completeness: INV-9 holds.
- **INV-6 (solutions never leave the server):** names are display data, not solutions. The
  profile module never touches puzzles or `game_state`. INV-6 is not in play; stated so a
  reviewer need not re-derive it.
- **INV-7 (single writer per table):** the API is the sole writer of `users` (already
  true, `jit-upsert.ts`). This feature adds a second API write path to the same table under
  the same writer. The session keeps its SELECT-only grant on `users.display_name`
  (INV-7 line 268); nothing about the read grant changes.

### 6.3 Data flow

**Onboarding (first nameless session):**

```
sign-in completes (OAuth return / OTP verify / magic-link confirm)
   -> client has a session (userId, isAnonymous), token metadata name is absent
   -> client calls GET /me
        -> API: authMiddleware runs jitUpsertUser (mirror row exists), returns identity
        -> profile service SELECTs users.display_name for the caller
        -> 200 { userId, displayName: null, isAnonymous, avatarUrl }
   -> client sees displayName === null (and not anonymous)  ==> NAMELESS
   -> present onboarding (prefilled suggestion)
   -> user confirms name N
   -> client canonicalizes+validates N at the edge, calls PATCH /me { displayName: N }
        -> API canonicalizes+validates N (authoritative), UPDATE users SET display_name
        -> 200 { userId, displayName: <canonical N>, isAnonymous, avatarUrl }
   -> client stores the canonical name in local session state, dismisses onboarding
   -> other clients converge on the next welcome/participant payload (session reads users)
```

**Settings edit (later):**

```
open Settings -> GET /me -> render current name in the identity row
   edit -> PATCH /me { displayName } -> 200 canonical name -> update local state
```

**Why `GET /me` and not "reuse the games self-member":** onboarding happens before any game
exists. A brand-new email sign-up has zero memberships, so `GET /games` returns an empty
list and carries no self identity. `GET /me` is the self-identity surface that works with
zero games. (This supersedes the earlier "reuse GET /games self member, no /me" ruling; the
owner approved `/me` for this feature.)

**Detecting "needs a name" without a second source of truth.** The client may read its own
session's local name state as a _trigger hint_ (the token's metadata name is absent, or the
web adapter's derived name is the generic fallback), but it must not treat that local guess
as the display value. The authoritative "are you nameless" answer is `GET /me`. So the flow
is: cheap local hint arms the check, `GET /me` confirms, and from that point the app DB
value (via `/me` and via participant payloads) is the only name the UI shows. This is the
line between "a local trigger" (allowed) and "a second source of display truth" (forbidden).

## 7. API contract

New module `apps/api/src/profile/`, mounted `app.route("/me", profileRoutes(deps))` in
`apps/api/src/app.ts`. Both routes are bearer-authenticated with `authMiddleware(deps)`, the
same middleware every other module installs; the write is rate-limited.

### 7.1 `GET /me`

Self display identity. Works with zero games. The read the onboarding trigger confirms
against and the Settings editor loads from.

Request: `GET /me`, `Authorization: Bearer <token>`, no body.

Response `200`:

```json
{
  "userId": "a1b2c3d4-0001-4a1a-8b2b-000000000001",
  "displayName": null,
  "isAnonymous": false,
  "avatarUrl": null
}
```

- `userId`: the caller's id (the token `sub`, mirrored). Always present.
- `displayName`: the app-DB value, `string | null`. **This endpoint returns the raw DB
  value, including `null`**, because the client needs to detect nameless. This is the one
  place `null` crosses the wire on purpose; it never crosses on the gameplay wire (that
  stays non-null per section 4 of the protocol). A tombstoned caller cannot reach here
  (they stopped authenticating); if one did, they see their own `null` and would be
  re-prompted, which is harmless.
- `isAnonymous`: mirrors the identity flag, so the client can apply the guest-default rule
  (a `"Guest"` permanent account, or an anonymous account, is handled per section 11).
- `avatarUrl`: the resolved avatar (`users.avatar`), for the live puck preview. Same opaque
  nullable field as protocol section 4.

Errors: `UNAUTHORIZED` (401) only. There is no not-found: `authMiddleware` runs
`jitUpsertUser` first, so the caller's row always exists by the time the handler runs.

Email is deliberately not returned. `/me` is display identity, not account admin. Keeping
email off the payload keeps the surface small and avoids a new PII egress to review.

### 7.2 `PATCH /me`

Write the caller's own display name. Additive, idempotent on the canonical value.

Request:

```
PATCH /me
Authorization: Bearer <token>
Content-Type: application/json

{ "displayName": "  Ada   Lovelace " }
```

Response `200` (the canonical stored value, so the client adopts exactly what the server
kept):

```json
{
  "userId": "a1b2c3d4-0001-4a1a-8b2b-000000000001",
  "displayName": "Ada Lovelace",
  "isAnonymous": false,
  "avatarUrl": null
}
```

The response shape equals `GET /me` so the client has one decoder and one "adopt this
profile" path.

Semantics: the server canonicalizes and validates per section 5, then
`UPDATE users SET display_name = $1 WHERE user_id = $caller`. `PATCH` with a single
`displayName` field; a `PATCH` chosen over `PUT /me/display-name` because the resource is
the caller's profile and the operation is a partial update of one field, leaving room for a
future additive field (a pronoun, a status) without a new route. The write is idempotent:
sending the same canonical name twice yields the same 200.

**Error codes** (added to `apps/api/src/http/errors.ts` `ApiErrorCode`, all stable strings;
body is the standard `{ error, message }`):

| code            | HTTP | when                                                                      |
| --------------- | ---- | ------------------------------------------------------------------------- |
| `NAME_REQUIRED` | 422  | empty after canonicalization (whitespace-only, or all-stripped)           |
| `NAME_TOO_LONG` | 422  | over 40 graphemes after canonicalization                                  |
| `NAME_INVALID`  | 422  | contains a disallowed character (control, lone zero-width, bidi override) |
| `VALIDATION`    | 400  | body is not an object, or `displayName` is absent or not a string         |
| `UNAUTHORIZED`  | 401  | bad or missing bearer                                                     |
| `RATE_LIMITED`  | 429  | write window spent (below); carries `Retry-After`                         |

The three `NAME_*` codes are 422 (Unprocessable Content), matching the ingestion precedent
in `errors.ts`: the body is well-formed JSON (that would be 400 `VALIDATION`) but the value
violates a domain rule the user can read and fix. 400 `VALIDATION` is reserved for a
malformed body (missing field, wrong type). This split lets the client show a field-level
inline error for the `NAME_*` codes and a generic failure for `VALIDATION`.

**Rate limit.** Gate `PATCH /me` with the existing limiter
(`apps/api/src/http/rate-limit.ts`, `createRateLimiter` + `rateLimit` middleware), keyed on
`user_id`. Suggested budget: **20 writes per 10 minutes per user.** Names change rarely;
this is generous for a user fiddling in Settings and caps a script. `GET /me` is not rate
limited beyond the shared auth cost.

**Write-through to Supabase user_metadata: NO (app-DB-only), with one deliberate exception
already in place.** The decision:

- The app DB `users.display_name` is authoritative. `PATCH /me` writes only that column.
  The client adopts the 200 response. Other clients converge via the session reading
  `users` on the next welcome/participant payload. This is the whole propagation path and it
  needs nothing from Supabase.
- We do **not** best-effort mirror the name back into Supabase `user_metadata`. Reasons:
  (a) it would reintroduce a second store of the name, the exact thing this feature removes;
  (b) `user_metadata` only affects future tokens, and the next token does not need to carry
  the name because the client reads the name from `/me` and participant payloads, never from
  the token, after this feature lands; (c) the mirror write is a `service_role` admin call
  (`PUT /auth/v1/admin/users/{id}`, the same credential `supabase-admin.ts` uses for
  deletion), a privileged network round-trip we would run on every name edit for no user
  benefit; (d) the coalesce in `jit-upsert.ts` means a metadata name would never overwrite a
  chosen app-DB name anyway, so even if a future token carried it, it changes nothing.
- The one existing exception is iOS's `SupabaseAuth.updateUserFullName` (writes GoTrue
  `/user` `data.full_name`), used today for Apple first-consent. We do **not** call it from
  the new name-edit path. It stays where it is (capturing the Apple-provided name at sign-in
  so the very first mirror carries something), but the app-DB write via `PATCH /me` is what
  the feature relies on. After onboarding, the app-DB name is authoritative regardless of
  what `full_name` holds.

This keeps one writer of the display name that the app reads: the API, on `users`.

### 7.3 The session fallback wording (active-null vs tombstoned)

`apps/session/src/server.ts` currently maps any null `display_name` to `"former
participant"` (`buildBoardPayload` line 584, `buildPlayerConnected` line 612;
`apps/api/src/games/routes.ts` shares the constant). After this feature, an **active**
account should never reach the session with a null name (onboarding fills it). But the
fallback must stay for genuinely tombstoned accounts (deleted users whose events survive,
DESIGN.md section 8). We keep the fallback and keep the wording `"former participant"` for
the tombstoned case, because that is who it is for.

We do **not** need to distinguish active-null from tombstoned-null at the session, because
after this feature an active user is never null. The residual risk is a legacy prod account
that predates onboarding and has not signed in since (section 12 handles this: they get
prompted on next sign-in). Until then such an account would render "former participant" in a
room, the same as today, which is a rare pre-existing state, not a new defect. We
deliberately do not add a session-side "active but nameless" branch: it would encode a state
the onboarding flow exists to make impossible, and the session has no clean signal (an
account can be null because it is tombstoned or because it is pre-onboarding legacy; the
session cannot tell without a new column, which is not worth it). The right fix is to name
the legacy account, which the sign-in prompt does.

## 8. PROTOCOL.md and vectors changes

### 8.1 PROTOCOL.md section 12 (REST companion)

Add two rows to the section 12 route table:

| Route       | Who                  | Behavior                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /me`   | authenticated (self) | the caller's display identity `{userId, displayName, isAnonymous, avatarUrl}`; `displayName` is the app-DB value and MAY be null (the only place null crosses, so a client can detect a nameless account and onboard); works with zero games                                                                                                                                  |
| `PATCH /me` | authenticated (self) | `{displayName}` sets the caller's display name; the server NFC-normalizes, trims, collapses internal whitespace, validates (1-40 graphemes, no control/zero-width/bidi-override, INV-1 casing does NOT apply), and returns the canonical `{userId, displayName, isAnonymous, avatarUrl}`; rejects `NAME_REQUIRED`/`NAME_TOO_LONG`/`NAME_INVALID` (422); rate-limited per user |

Add prose after the invite-links block:

> **Display name (`GET /me`, `PATCH /me`).** Every account carries a non-null display name
> once onboarded. `GET /me` is the self-identity read that works before any game exists (an
> onboarding surface runs before a first join); it returns the raw app-DB `display_name`,
> which may be null for an account that has not chosen one yet, so a client can detect the
> nameless state and prompt. `PATCH /me` is the single write path for the name (the JIT
> mirror only fills a name it is given and never overwrites a chosen one, so an edit cannot
> ride the mirror). The name is user content shown back verbatim: it is never uppercased or
> folded (INV-1 casing is cell-values only), and it carries no solution content (INV-6
> untouched). The server canonicalizes (Unicode NFC, trim, collapse internal whitespace) and
> validates (1 to 40 grapheme clusters; rejects control characters, lone zero-width
> formatters, and bidi overrides; allows every other letter, mark, number, symbol, and
> emoji, so Unicode names like a cedilla-bearing given name or a Han name are preserved); it
> enforces no uniqueness. A well-formed body whose name violates a rule returns a named 422
> (`NAME_REQUIRED`, `NAME_TOO_LONG`, `NAME_INVALID`); a malformed body is 400 `VALIDATION`.
> Both routes are additive and bump no version (section 14). The wire display name in section
> 4 stays non-null: the session substitutes `"former participant"` only for a tombstoned
> account whose name was scrubbed (DESIGN.md section 8), a case onboarding does not touch.

Add the three `NAME_*` codes to the REST error vocabulary table in section 12.

### 8.2 Vectors (written before implementation, CLAUDE.md house rule)

Vectors are normative JSON, one file per behavior cluster, kebab-case, a bare array of
cases, prettier-formatted (`vectors/README.md`). The name spec is a pure string function
(canonicalize + validate), so it is vector-shaped and both runners (vitest and XCTest) pin
it identically.

New file **`vectors/identity/display-name.json`**: an array of cases, each

```json
{
  "name": "collapses internal whitespace and trims (INV-1 casing does not apply)",
  "input": "  Ada   Lovelace ",
  "then": { "ok": true, "value": "Ada Lovelace" }
}
```

and for a rejection

```json
{
  "name": "rejects a name that is whitespace only",
  "input": "   ",
  "then": { "ok": false, "code": "NAME_REQUIRED" }
}
```

Cases to pin (at least):

- trim + internal-whitespace collapse (the example above).
- casing preserved: `"ada"` stays `"ada"`, `"ADA"` stays `"ADA"` (INV-1 does not fold names).
- Unicode preserved: a cedilla given name and a Han name pass with `ok:true` and byte-equal
  value after NFC; a decomposed form (`e` + combining acute) normalizes to the precomposed
  NFC value.
- grapheme length: a 40-grapheme name passes; a 41-grapheme name is `NAME_TOO_LONG`; a
  single emoji (including a multi-codepoint ZWJ family emoji) counts as 1 grapheme and passes.
- disallowed: a name containing `U+0000`, a newline, a tab -> `NAME_INVALID`; a lone `U+200B`
  or a `U+202E` bidi override -> `NAME_INVALID`; an emoji whose internal ZWJ is part of a
  valid cluster -> `ok:true` (the ZWJ check does not fire inside a grapheme).
- empty string -> `NAME_REQUIRED`.
- exactly 1 grapheme -> `ok:true` (the min boundary).

The vector README for `vectors/identity/` gains a short paragraph naming
`display-name.json` and its two consumers: the API validator
(`apps/api/src/profile/name.ts`) and the client sanitizers
(`apps/web/src/profile/name.ts`, `apps/ios/Sources/CrossyUI/DisplayNameEntry.swift`), each
pinned by a local test that runs the vector.

No existing vector changes. No frozen suite, no version bump.

## 9. iOS onboarding UI spec

### 9.1 Where it fires

After sign-in completes and the shell would show the signed-in tabs
(`WelcomeScreen`/shell watches `AuthSession.phase`; on `.signedIn` the shell swaps in). The
composition root, on entering the signed-in shell, calls `CrossyAPIClient.getMe()`. If the
result is nameless (`displayName == nil`, or `isAnonymous == false` and the name equals the
`"Guest"` sentinel), it presents the onboarding as a **sheet over the shell**, not a step in
the pre-auth `WelcomeScreen` NavigationStack. Rationale: onboarding is post-auth (the user
is already in), the shell is the natural host, and a sheet is dismissable-by-completion
without unwinding the auth stack. It gates the shell content behind a light scrim until a
name lands, so the goal (always a name) holds.

Trigger gating obeys INV-11 (DESIGN.md line 272): the sheet is armed by a true signed-in
session, never by a transient token/HTTP failure. If `getMe()` fails transiently, retry with
backoff; do not sign the user out and do not block forever (see edge cases).

### 9.2 Form

A dedicated sheet, `DisplayNameOnboardingSheet`, presented with
`.presentationDetents([.medium])` and `.presentationDragIndicator(.hidden)` (this one is not
casually dismissable; see skippable). A single `NavigationStack` is unnecessary (one step).

Layout, top to bottom, on the current `Ground` (Studio/Observatory), using `GroundTokens`:

- **Title**: `ArrivalCopy.displayNameTitle` ("What should we call you?"),
  `.font(.system(size: 22, weight: .semibold))`, `ground.tokens.ink`.
- **Subtitle**: `ArrivalCopy.displayNameOnboardingHint` ("This is how you show up in a
  room. You can change it later."), size 15, `ground.tokens.number`.
- **Live preview**: a `RosterPuckView(member:ground:diameter:)` at diameter 64, built from
  a `RosterMember` with the caller's `userId` (so the color is real and stable), the current
  field text as `displayName`, and the real `avatarUrl` if any. The puck's `initial`
  recomputes from the field as the user types (`GridPresence.initial(of:)`), so the preview
  is live. Centered above the field.
- **Field**: a glass-surfaced text field. Wrap a `TextField` in `ChromeGlassSurface(cornerRadius: 14)`
  so it reads as chrome material (iOS 26 `.glassEffect`, `.regularMaterial` fallback). Prefilled
  with the suggestion (section 5). `.textInputAutocapitalization(.words)`,
  `.submitLabel(.done)`, `@FocusState` focused on appear. Bound through the
  `DisplayNameEntry` sanitizer (section 9.4) so the field never holds a value the server
  would reject for shape (it still trims/collapses on submit server-side).
- **Inline error**: below the field, size 13, an error tone (a red drawn from the ground's
  palette). Text keyed on the stable code via `ArrivalCopy.displayNameError(forCode:)`
  (mirrors the existing `deleteFailure(forCode:)` pattern). Empty when no error.
- **Submit**: a glass capsule button (the primary-action material,
  `ChromeGlassSurface` capsule per `ChromeGlass.swift`), label
  `ArrivalCopy.displayNameSave` ("Continue"), full width, height `ChromeLayout.barHeight`
  (52). Shows the inline `ProgressView` spinner (the existing capsule spinner pattern) while
  the `PATCH /me` is in flight. Disabled when the sanitized field is empty.

On submit: sanitize+validate at the edge; if it passes, call
`CrossyAPIClient.updateDisplayName(sanitized)`. On 200, store the canonical name into the
session-derived `AccountIdentity`, dismiss the sheet, reveal the shell. On a `NAME_*` 422,
show the inline error keyed on the code and keep the sheet open. On a transient failure,
show a retry-tone error and keep the sheet.

### 9.3 Skippable?

**Not skippable, but never a dead end.** The goal is always a name. The sheet has no
"Skip". It cannot be swiped away (`.interactiveDismissDisabled(true)`, drag indicator
hidden). But because the field is prefilled with a valid suggestion, "not skippable" costs
the user one tap on Continue, not a forced act of naming themselves. This satisfies both the
product goal (always a name) and the taste bar (no friction): the fast path is accept-the-
suggestion.

### 9.4 `DisplayNameEntry` sanitizer

New `apps/ios/Sources/CrossyUI/DisplayNameEntry.swift`, mirroring `InviteCodeEntry`:

```swift
public enum DisplayNameEntry {
    public static let maxGraphemes = 40

    /// Edge sanitize: strip disallowed scalars, cap at maxGraphemes. Does NOT trim or
    /// collapse internal whitespace (the field must let the user type spaces); the server
    /// and `canonicalize` do trim/collapse. NFC is applied on submit, not per keystroke.
    public static func sanitize(_ raw: String) -> String { /* filter + cap */ }

    /// Full canonicalize for submit: NFC, trim, collapse internal whitespace.
    public static func canonicalize(_ raw: String) -> String { /* ... */ }

    /// A name ready to submit: canonicalized value is 1...maxGraphemes graphemes and
    /// contains no disallowed scalar.
    public static func isComplete(_ raw: String) -> Bool { /* ... */ }
}
```

`sanitize` filters control chars, lone zero-width, and bidi overrides per section 5, and
caps at 40 graphemes using `String.count` (grapheme-based). It is pinned to
`vectors/identity/display-name.json` by a test in `apps/ios/Tests/CrossyUITests` (the Swift
runner already consumes vectors via XCTest).

## 10. iOS Settings editor UI spec

`apps/ios/Sources/CrossyUI/SettingsScreen.swift`, the `AccountIdentity` card. Preserve the
paper-card-on-ground grammar and the identity row's puck+name+provider structure.

**Interaction: inline edit in place, not a separate sheet.** Tapping the identity card (or a
small pencil affordance on its trailing edge) flips the name line from a `Text` to a
`TextField` in the same card, keeping the live `RosterPuckView` to its left. This preserves
the card grammar (same 14pt padding, same `cardBackground()`), and the puck already updates
live from the edited name, so the card is its own preview. A sheet would duplicate the card
chrome for one field; inline is lighter and idiomatic to a settings row.

Editing state:

- The name `Text(verbatim: identity.displayName ?? ArrivalCopy.settingsNoName)` becomes a
  `TextField` bound to a draft string seeded from the current name, sanitized through
  `DisplayNameEntry.sanitize`.
- Trailing controls: a **Save** glass capsule (compact) and a **Cancel** ghost button.
  Save shows the capsule spinner during `PATCH /me`. Cancel restores the draft and exits
  edit mode.
- On 200: adopt the canonical name into `AccountIdentity`, exit edit mode, and animate the
  puck initial if it changed (respect Reduce Motion; see a11y).
- On a `NAME_*` 422: show an inline error line under the field (size 13, error tone), keyed
  via `ArrivalCopy.displayNameError(forCode:)`. On transient failure: a retry-tone error;
  keep the draft.

The card fills the KNOWN GAP: once `display_name` is persisted, `AccountIdentity.displayName`
is non-nil for a named user and the puck initial resolves from a real name instead of empty.

`AccountIdentity` gains no new field; the composition root now sources `displayName` from
`GET /me` (via the client) rather than leaving it nil.

## 11. Web onboarding UI spec

### 11.1 Where it fires

Two entry points, one handler:

- **OAuth / guest-upgrade return** and **OTP verify**: the session lands through
  `identity.onChange` with cause `"signed_in"` (`apps/web/src/App.tsx` line 108-111
  re-renders on change).
- **Magic-link confirm**: `apps/web/src/ui/AuthConfirm.tsx` verifies the link, then
  `navigate(homeHref(params))` on a verified session (line 66).

On a `"signed_in"` (or `"restored"` at boot when a legacy account is nameless) session, the
app root calls `identity.loadProfile()` (backed by `GET /me`). If the profile is nameless
(`displayName === null`, or `isAnonymous === false` and the name is the `"Guest"` sentinel),
it opens the onboarding dialog. The check runs in the signed-in shell before rendering Home,
so a first-ever email sign-up sees the dialog immediately.

INV-11 applies: arm the dialog only on a real session (`getSession() !== null`), never on a
transient token failure. A failed `loadProfile()` retries; it does not sign out.

### 11.2 Form

A **Radix `Dialog`** (`apps/web/src/components/ui/dialog.tsx`), not a routed step: onboarding
is a one-field interrupt, the modal pattern the app already uses for
`ContinueAnotherWay`. Mirror the `otpModalMachine` transition-function style with a tiny
`onboardingMachine.ts` (states: `entry` with `error`, `saving`, done-closes). The dialog is
not casually dismissable (no close button, `onOpenChange` ignores an outside click while
nameless; see edge cases).

`DialogContent className="sm:max-w-sm"`, containing:

- `DialogHeader` -> `DialogTitle` ("What should we call you?", `font-display`) +
  `DialogDescription` ("This is how you show up in a room. You can change it later.",
  `text-2 text-muted-foreground`).
- **Live preview**: an `Avatar size="lg"` with `AvatarFallback className="bg-gold-4
text-gold-11"` whose initial is `draft.slice(0,1).toUpperCase()`, layered with
  `AvatarImage` when `avatarUrl` is set. Centered. It updates as the user types (same as the
  `AuthBar` initial derivation).
- **Field**: `Input` (32px, `aria-invalid` on error) prefilled with the suggestion
  (section 5), `aria-label="Display name"`, `maxLength` a generous UTF-16 guard (say 80;
  the real bound is 40 graphemes, enforced by the sanitizer and server). Bound through the
  web `sanitizeDisplayName` (section 13) so the field stays clean.
- **Inline error**: below the input, `text-1 text-danger-text role="alert"`, text keyed on
  the stable code via a `displayNameErrorOf(code)` map (mirrors `emailOtpReasonOf`).
- **Submit**: `DialogFooter` with a single `Button variant="inverse" size="lg"
className="w-full"` (the strong ink CTA, the sign-in material) labeled "Continue".
  Disabled when the sanitized draft is empty. Shows a spinner / disabled state during
  `setDisplayName`.

On submit: sanitize+validate at the edge, then `identity.setDisplayName(draft)`. On success
the adapter updates the in-memory session name and fires `onChange("refreshed")`, the dialog
closes, Home renders. On a `NAME_*` reason, set the inline error. On transient failure, a
retry-tone error.

### 11.3 Skippable?

Same ruling as iOS: **not skippable, never a dead end.** No skip control; the dialog is not
outside-click-dismissable while the account is nameless. The prefilled valid suggestion
makes the fast path a single click on Continue.

## 12. Web Settings editor UI spec

`apps/web/src/ui/Settings.tsx`, the `AccountGroup` identity row (read-only today). Preserve
the `SettingRow` / `Group` grammar (label | description | right-aligned control, dashed
`Divider` between rows).

**Interaction: inline edit in the identity row.** The identity block (avatar + name +
account-type) gains a trailing **Edit** control (`Button variant="ghost" size="sm"`). In
edit mode the name line becomes an `Input` seeded from the current name, with **Save**
(`Button variant="inverse" size="sm"`) and **Cancel** (`Button variant="ghost" size="sm"`)
to its right, and the `Avatar` fallback initial updates live from the draft. This keeps the
row grammar (it is still one row with a right-aligned control cluster) and reuses the
`SettingRow` `error` slot (`text-1 text-danger-text role="alert"`) for validation failures.

Data: on entering Settings, `identity.loadProfile()` populates the current name (so Settings
reads the app-DB truth, not the `displayNameOf` derivation). Save calls
`identity.setDisplayName(draft)`; on success adopt the canonical name and exit edit mode; on
`NAME_*` show the row error; on transient failure a retry-tone error, keep the draft.

**Retiring the second source.** After this feature, `displayNameOf`'s job narrows:
`IdentitySession.displayName` should reflect the app-DB name once known. The clean move is
to have the adapter, on `load()` / first `getSession()`, best-effort populate the session
name from `GET /me` and thereafter treat the app-DB value as the display name; the token-
metadata derivation stays only as the pre-`/me` bootstrap value and the onboarding trigger
hint, never as the post-onboarding display source. `displayNameOf`'s `"Player"` fallback
stops being a _display_ value and becomes only a transient bootstrap string that the nameless
check overrides by opening onboarding. (Concretely: keep `IdentitySession.displayName:
string` non-null for existing callers, but the value is the `/me` name once loaded.)

## 13. Web `sanitizeDisplayName`

New `apps/web/src/profile/name.ts` exporting `sanitizeDisplayName(raw): string`,
`canonicalizeDisplayName(raw): string`, and `isCompleteDisplayName(raw): boolean`, using
`Intl.Segmenter` (grapheme mode) for the length cap and the section-5 block-list for
disallowed scalars. Pinned to `vectors/identity/display-name.json` by
`apps/web/src/profile/name.test.ts`. The server's `apps/api/src/profile/name.ts` runs the
same logic against the same vector, so client and server agree.

## 14. Copy tables (stable keys)

### 14.1 iOS (`apps/ios/Sources/CrossyUI/ArrivalCopy.swift`, add as `public static let` /

`static func`)

| key                          | value                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| `displayNameTitle`           | "What should we call you?"                                    |
| `displayNameOnboardingHint`  | "This is how you show up in a room. You can change it later." |
| `displayNameFieldPrompt`     | "Your name"                                                   |
| `displayNameSave`            | "Continue"                                                    |
| `settingsNameTitle`          | "Name"                                                        |
| `settingsNameSubtitle`       | "How you show up in a room"                                   |
| `settingsNameSave`           | "Save"                                                        |
| `settingsNameCancel`         | "Cancel"                                                      |
| `displayNameError(forCode:)` | code-keyed (below)                                            |

`displayNameError(forCode:)` returns:

| code            | sentence                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `nil` (offline) | "Couldn't reach Crossy. Check your connection and try again."            |
| `NAME_REQUIRED` | "Add a name so people know who you are."                                 |
| `NAME_TOO_LONG` | "That name is too long. Keep it to 40 characters."                       |
| `NAME_INVALID`  | "That name has characters we can't use. Try letters, numbers, or emoji." |
| `UNAUTHORIZED`  | "Your sign-in expired. Sign in again, then set your name."               |
| default         | "Couldn't save your name. Try again."                                    |

`settingsNoName` stays ("Signed in") as the pre-onboarding fallback; after onboarding a
named user never shows it.

### 14.2 Web (co-located with the onboarding component and Settings, mirroring

`emailOtpReasonOf`)

| key / usage                   | value                                                         |
| ----------------------------- | ------------------------------------------------------------- |
| onboarding title              | "What should we call you?"                                    |
| onboarding description        | "This is how you show up in a room. You can change it later." |
| field placeholder             | "Your name"                                                   |
| submit label                  | "Continue"                                                    |
| settings row label            | "Name"                                                        |
| settings row description      | "How you show up in a room"                                   |
| settings save / cancel / edit | "Save" / "Cancel" / "Edit"                                    |

`displayNameErrorOf(reason)`:

| reason          | sentence                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `NAME_REQUIRED` | "Add a name so people know who you are."                                 |
| `NAME_TOO_LONG` | "That name is too long. Keep it to 40 characters."                       |
| `NAME_INVALID`  | "That name has characters we can't use. Try letters, numbers, or emoji." |
| `rate_limited`  | "Too many changes just now. Wait a moment, then try again."              |
| `network`       | "That didn't go through. Check your connection and try again."           |
| `unknown`       | "Couldn't save your name. Try again."                                    |

Tone matches the existing calm one-sentence `GuestSignIn` / `emailOtpReasonOf` copy.

## 15. Edge cases and accessibility

- **Dismissing onboarding.** Not dismissable while nameless (iOS
  `.interactiveDismissDisabled(true)`; web dialog ignores outside-click). The prefilled
  valid suggestion means the user is one tap from done, so "cannot dismiss" is not a trap. If
  the process is backgrounded/reloaded before submit, the trigger re-fires on next entry
  (the account is still nameless per `GET /me`), so nobody escapes nameless by closing the
  app.
- **Offline / failed write + retry.** The submit call surfaces a retry-tone error and keeps
  the form open with the draft intact. No optimistic local write: the name is not "set" until
  the server returns the canonical value. The iOS client already has 401-retry in
  `CrossyAPIClient`; the web path uses `authedFetch`'s built-in 401 refresh-and-retry. A
  transient failure is never a sign-out (INV-11).
- **Duplicate names.** Allowed by spec. No check, no warning. Color + id disambiguate.
- **Very long / emoji / RTL / whitespace-only.** Long: capped at 40 graphemes (sanitizer
  stops input; server rejects `NAME_TOO_LONG` as a backstop). Emoji: allowed, one ZWJ family
  emoji counts as one grapheme. RTL: plain RTL scripts render natively; bidi _override_
  controls are rejected (`NAME_INVALID`). Whitespace-only: canonicalizes to empty ->
  `NAME_REQUIRED`.
- **Reduce Motion.** The puck-initial change and any dialog/sheet transition respect
  `accessibilityReduceMotion` (iOS) and `prefers-reduced-motion` (web): swap the value with
  no cross-fade / no spring when reduced. No essential information is conveyed by motion.
- **Full a11y.** iOS: the field has a `.accessibilityLabel` from `ArrivalCopy`, the puck
  preview is `.accessibilityHidden(true)` (decorative; the name is announced by the field),
  the error line is announced (post the error to VoiceOver via
  `.accessibilityValue`/an announcement on change), Save/Cancel are labeled buttons, focus
  moves to the field on present. Web: `Input` gets `aria-label="Display name"` and
  `aria-invalid` on error; the error node is `role="alert"` so it is announced; focus moves
  into the dialog on open (Radix handles focus trap and restore); Continue is a real
  `button` with an accessible name; the live avatar preview is `aria-hidden`.
- **Tombstoned "former participant" vs active-null.** Section 7.3: keep "former participant"
  for tombstoned accounts; an active account is never null after onboarding, so it never
  shows that string. No new session branch.
- **Concurrent edits from two devices.** Last write wins; the API `UPDATE` is a single
  authoritative write on one column. Each device's 200 returns the canonical value it just
  set. The other device converges on its next `GET /me` (open Settings) or its next welcome
  payload (join a room). No locking, no conflict UI: a name is not worth CAS. This is
  consistent with the mirror's existing last-writer-wins posture.
- **Guest with "Guest" default.** A pure guest keeps `"Guest"` and is not prompted (guests
  are join-only, never host; `"Guest"` is a fine label). At the moment a guest **upgrades**
  to a full account, the account becomes permanent; the client re-runs `GET /me`, and if the
  name is still the `"Guest"` sentinel (the upgrade provider carried none), it is treated as
  nameless and onboarded. So the "prompt on upgrade" case is exactly case 4 of section 4.
- **The nameless-legacy prod account** (predates onboarding, has not signed in since): it
  shows "former participant" in rooms until its owner next signs in, at which point
  `GET /me` reports null and onboarding fires. No backfill job needed (section 16).

## 16. Rollout

- **No field migration.** `users.display_name` already exists and is nullable
  (`packages/db/src/schema.ts`). Validation lives in the API layer
  (`apps/api/src/profile/name.ts`), not a DB `CHECK`, so the rule can evolve (adjust the
  block-list, the length) without a migration and without risking existing rows that predate
  the rule. This matches the ground-truth preference; a `CHECK` would also fight the
  tombstone path, which deliberately nulls the column.
- **Existing prod nameless users** get a name by being prompted on their next sign-in: the
  trigger keys on `GET /me` reporting null, which is exactly their state. No batch job, no
  data migration. If we later want to sweep them, that is an optional follow-up, not a gate.
- **Protocol version.** Both routes are additive REST; the wire messages are unchanged
  (section 4 `displayName` stays non-null). Additive REST bumps no version (PROTOCOL.md
  section 14, confirmed by the invite-link precedent). No frozen suite, no vector-family
  bump. An older client that never calls `/me` keeps working; it simply never onboards
  (acceptable, since the clients ship this together and there is no third-party client).
- **Single-writer / expand-contract.** No schema change, so expand/contract is trivially
  satisfied: the only change is a second API write path to a column the API already owns
  (INV-7 intact). The session's read grant is unchanged.

## 17. Implementation plan (PR-sized, layer-ordered)

Vectors and protocol first, then API, then the shared client contract, then each platform.
Each unit is one PR with green checks (main is golden). Every added test cites the invariant
it defends.

### PR 1 - Spec: vectors + PROTOCOL.md + this doc

- Files: `vectors/identity/display-name.json` (new), `vectors/identity/README.md` (append
  the paragraph), `PROTOCOL.md` (section 12 two rows + prose + three error codes),
  `docs/design/name-onboarding.md` (this doc).
- Tests: a vector shape-validation lands with the runner discovery (the engine runner
  shape-validates `vectors/identity/*`); the behavior tests arrive with PR 2/4/5 that
  implement the function. Cite INV-1 (casing does NOT apply to names) and INV-7 in the
  vector case names where relevant.

### PR 2 - API profile module

- Files: `apps/api/src/profile/name.ts` (canonicalize + validate, the spec),
  `apps/api/src/profile/service.ts` (`readMe`, `writeDisplayName` over `Db`),
  `apps/api/src/profile/routes.ts` (`GET /me`, `PATCH /me`, auth + rate limit),
  `apps/api/src/http/errors.ts` (add `NAME_REQUIRED`/`NAME_TOO_LONG`/`NAME_INVALID` + statuses),
  `apps/api/src/app.ts` (`app.route("/me", profileRoutes(deps))`).
- Tests: `apps/api/src/profile/name.test.ts` runs `vectors/identity/display-name.json`
  (cite INV-1: names are not ASCII-folded). `apps/api/src/profile/routes.test.ts`: `GET /me`
  returns null for a nameless mint and the name after a write; `PATCH /me` canonicalizes
  (trim/collapse/NFC), enforces bounds and the block-list with the right 422 codes, rejects a
  malformed body with 400 `VALIDATION`, is idempotent, and is rate-limited (cite INV-7:
  single writer of `users`). Use the auth fake's nameless mint (`userMetadata` omitted ->
  `displayName: null`).

### PR 3 - iOS client seam

- Files: `apps/ios/Sources/CrossyAPI/CrossyAPIClient.swift` (add `getMe()` and
  `updateDisplayName(_:)` via `Endpoint(method:path:body:)`, decode a `MeResponse`),
  a `MeResponse`/profile model, `apps/ios/Sources/CrossyUI/DisplayNameEntry.swift` (sanitizer).
- Tests: `CrossyAPIClientTests` for the two calls (Bearer header, 401-retry path, decode);
  `DisplayNameEntryTests` runs `vectors/identity/display-name.json` (cite INV-1). No UI yet.

### PR 4 - iOS UI (onboarding + Settings editor)

- Files: `apps/ios/Sources/CrossyUI/DisplayNameOnboardingSheet.swift` (new),
  `apps/ios/Sources/CrossyUI/SettingsScreen.swift` (inline editor in the `AccountIdentity`
  card; `AccountIdentity.displayName` now sourced from `/me` via the composition root),
  `apps/ios/Sources/CrossyUI/ArrivalCopy.swift` (copy table 14.1), the composition root
  (trigger `getMe()` on entering the signed-in shell, present the sheet when nameless).
- Tests: a view-model test for the onboarding state (nameless -> present; success ->
  dismiss; `NAME_*` -> inline error) and the Settings edit state; snapshot/preview coverage
  as the app already does. Cite INV-11 (present only on a true session).

### PR 5 - Web client seam + UI (onboarding + Settings editor)

- Files: `apps/web/src/profile/name.ts` (sanitize/canonicalize, `Intl.Segmenter`),
  `apps/web/src/profile/api.ts` (`getMe`, `setDisplayName` over `authedFetch`),
  `apps/web/src/identity/types.ts` (add `loadProfile()` + `setDisplayName()` to the port +
  a `UserProfile` type), `apps/web/src/identity/supabaseAdapter.ts` and `mockAdapter.ts`
  (implement the two methods; adopt the `/me` name into the session on load; narrow
  `displayNameOf` to a bootstrap/trigger role), `apps/web/src/ui/DisplayNameOnboarding.tsx`
  (new dialog) + `onboardingMachine.ts`, `apps/web/src/ui/Settings.tsx` (inline editor in
  the identity row), the app root (trigger `loadProfile()` on `signed_in`/`restored`, open
  the dialog when nameless).
- Tests: `apps/web/src/profile/name.test.ts` runs the vector (cite INV-1);
  `onboardingMachine.test.ts` for the state transitions; adapter tests for `loadProfile`/
  `setDisplayName` (401-retry, canonical adoption); a Settings edit test. Cite INV-11 where
  the trigger gates on a real session.

Order note: PR 3 and PR 5's seam can proceed in parallel after PR 2 lands (both depend only
on the shipped endpoint + vector). PR 4 and PR 5's UI depend on their own seams. The spec
(PR 1) blocks everything, per the house rule that vectors precede implementations.

## 18. Decisions log (the contestable calls, with rationale)

- **`GET /me` + `PATCH /me`** (not "reuse GET /games self member"): onboarding runs before
  any game, so the self surface must work with zero memberships. Owner approved `/me` for
  this feature. `PATCH` (partial update of the profile) over `PUT /me/display-name` to leave
  room for a future additive profile field without a new route.
- **App-DB-only, no metadata write-through**: writing the name back into Supabase
  `user_metadata` would reintroduce the second store this feature removes, costs a
  `service_role` round-trip per edit, and buys nothing because the client reads the name from
  `/me` and participant payloads, not from tokens. The iOS Apple-first-consent
  `updateUserFullName` stays only as sign-in-time name capture, not the edit path.
- **Length 1-40 graphemes**: graphemes (not code points/UTF-16) so emoji and combined
  glyphs are never cut mid-character; 40 is generous for a label while bounding the column
  and the roster chip.
- **Block-list, not allow-list; INV-1 does not apply**: names are display content, so we
  preserve Unicode letters/marks/numbers/symbols/emoji and only reject what breaks rendering
  or spoofs order (control chars, lone zero-width, bidi overrides). ASCII-casing (INV-1) is
  cell-values only.
- **`null` crosses on `GET /me` only**: the one deliberate place the name is nullable on the
  wire, so a client can detect nameless. The gameplay wire (section 4) stays non-null.
- **Not skippable, prefilled default**: the product goal is "always a name," so no skip; but
  a deterministic valid suggestion makes the fast path a single tap, so "required" is not
  friction. Guest stays "Guest" until upgrade, then is treated as nameless.
- **Keep "former participant" for tombstoned only; no active-null session branch**: after
  onboarding an active account is never null, so the session needs no new state; adding one
  would encode a condition the feature exists to prevent.
