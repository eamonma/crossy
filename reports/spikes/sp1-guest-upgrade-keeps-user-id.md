# SP1: Guest upgrade keeps `user_id`

**Question.** When a Supabase anonymous user is upgraded to a permanent account, by
setting email and password or by linking an OAuth identity, is `auth.users.id`
preserved? D09 keys all game state on `user_id` and assumes an in-place upgrade.

**Answer: yes, unconditionally, on every upgrade path.** Upgrade is an `UPDATE` of the
existing `auth.users` row, never a new row. Conflict cases fail closed with a 422 and
leave the anonymous user untouched; there is no path that mints a new id, merges
accounts, or moves an id. D09 survives as written.

Confidence: high. Documented behavior, confirmed in the gotrue source, and reproduced
locally for the email paths (23/23 checks). The OAuth `linkIdentity` path is
source-verified but not empirically run (needs a real provider); the code path is the
same `UPDATE` shape as the verified email path.

## What was tried

1. Docs and blog: [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous),
   [identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking),
   [error codes](https://supabase.com/docs/guides/auth/debugging/error-codes),
   [launch post](https://supabase.com/blog/anonymous-sign-ins). The blog states it
   directly: "After they have been converted, the user id remains the same, which
   means that any data associated with the user's id would be carried over."
2. gotrue source (supabase/auth, master as of 2026-07-08). Every conversion path flips
   the flag on the same row via `tx.UpdateOnly(user, "is_anonymous")`; the id column is
   never written:
   - `internal/api/identity.go` (`linkIdentityToUser`): adds an `auth.identities` row
     pointing at the current user, then `targetUser.IsAnonymous = false`. If the
     candidate identity exists anywhere it errors first: "Identity is already linked"
     (same user) or "Identity is already linked to another user" (code
     `identity_already_exists`).
   - `internal/api/user.go` (`updateUser`): email change on an anonymous user
     auto-confirms only when the server has mailer autoconfirm on; otherwise it goes
     through email-change verification. A duplicate email is rejected up front with
     `email_exists` before anything mutates.
   - `internal/api/verify.go`: on email-change verification, `user.IsAnonymous = false`
     on the same row.
3. Empirical: local stack via `npx supabase start` (CLI 2.109.1, gotrue v2.192.0,
   postgres 17.6), supabase-js 2.110.1, `enable_anonymous_sign_ins = true`. Two runs:
   autoconfirm on (local default) and `enable_confirmations = true` (production-like),
   driving the verification link through Mailpit. Scripts are throwaway per spike
   rules; reproduction is in the appendix.

## Empirical results

Autoconfirm path (15/15):

- `signInAnonymously` mints id `01c9364b-...`; JWT claim `is_anonymous: true`.
- `updateUser({email})` succeeds; same id; `is_anonymous` false immediately.
- The pre-upgrade JWT still carries `is_anonymous: true`; `refreshSession()` reissues
  with `is_anonymous: false` and the same `sub`.
- `updateUser({password})` after email: same id.
- Second anonymous user claiming the taken email: 422, code `email_exists`, "A user
  with this email address has already been registered". Its id and anonymous status
  are untouched.
- Password-only update on an anonymous user: 422 `validation_failed`, "Updating
  password of an anonymous user without an email or phone is not allowed".
- Admin ground truth: the original anon id owns the upgraded account; exactly one
  `auth.users` row holds the email.

Confirmation-required path (8/8), the shape production will have:

- `updateUser({email})` is accepted, user **stays anonymous** with `new_email` pending
  until the emailed link is clicked.
- Clicking the verify link flips `is_anonymous` to false on the **same id**
  (`ef4ebe39-...` before and after); the redirect fragment token has the same `sub`
  and `is_anonymous: false`.
- The device's original anonymous session still refreshes afterward and picks up the
  upgraded claims. No re-login, no session loss.

## Failure modes and handling

| Case | Behavior | Handling in Crossy |
| --- | --- | --- |
| Email already registered to another account | `updateUser` 422 `email_exists`; guest unchanged | This is a returning user, not an upgrade. Offer sign-in to the existing account. Supabase has no account merge; the docs' own guidance is "reassign entities tied to the anonymous user" yourself. See D09 note below. |
| OAuth identity already linked to another user | 422 `identity_already_exists`. On web the OAuth redirect carries the error in URL params; the `linkIdentity()` return itself resolves without one ([discussion #27061](https://github.com/orgs/supabase/discussions/27061)) | Same as above: treat as sign-in to the existing account. Client must parse the redirect error params; do not rely on the call's error object. |
| Manual linking disabled | `linkIdentity` fails, `manual_linking_disabled` | Config, not code: enable manual linking in project auth settings. Add to M3 environment checklist. |
| Password set before email verified | 422 `validation_failed` | Order the upgrade UI: email, verify, then password. Not applicable to OAuth. |
| Stale `is_anonymous` JWT after upgrade | Tokens minted pre-upgrade keep `is_anonymous: true` until refresh (verified) | Client calls `refreshSession()` right after upgrade. Server side, the auth port's `verify()` reports whatever the token says, so a just-upgraded guest may look anonymous for up to one token lifetime; the JIT upsert into `users` must tolerate `is_anonymous` flipping late. Any RLS or policy check on the claim has the same one-lifetime lag. |
| Native Apple linking on iOS | Web-redirect `linkIdentity` was the only option until supabase-swift v2.32.0 added `linkIdentityWithIdToken` ([issue #588](https://github.com/supabase/supabase-swift/issues/588), [PR #776](https://github.com/supabase/supabase-swift/pull/776), Sept 2025) | Pin supabase-swift >= 2.32.0 so guest upgrade uses the native Apple dialog. |
| Two guests request the same unclaimed email concurrently | First verify wins; the loser hits the unique constraint at verify time (`email_exists`) | Rare; surface as the collision case above. Not empirically tested. |

## Implication for D09 and M3

D09's axiom holds: everything keyed on `user_id` survives upgrade with zero data
motion, on both email and OAuth paths, including the production email-confirmation
flow. No redesign needed. No DESIGN.md change; SP1 checkbox ticked in ROADMAP.md.

Two things become explicit M3 scope rather than surprises:

1. **Collision is a product decision, not a merge.** A guest with history who owns the
   target email or OAuth identity elsewhere cannot be merged by Supabase. The clean
   option consistent with §8: sign them into the existing account and let the guest
   identity age out via the stale-guest job, with its `cell_events` attribution
   surviving as an opaque id (same rendering as a tombstoned user). Re-keying events
   is off the table; `cell_events` is immutable (INV-1).
2. **Upgrade completes at verification, not at request.** With confirmations on, the
   guest stays anonymous until the link is clicked, and existing JWTs lag one refresh
   behind. The M3 exit criterion "a guest upgrades, keeps history" should assert the
   post-refresh state.

## Appendix: reproduction

Local stack: `supabase init`; set `enable_anonymous_sign_ins = true` (and
`enable_confirmations = true` for the second run); `supabase start`. Script outline
(supabase-js, `persistSession: false`):

1. `signInAnonymously()`; record `user.id`; decode `access_token` claim.
2. `updateUser({ email })`. Autoconfirm run: assert same id, `is_anonymous` false.
   Confirmation run: assert still anonymous with `new_email` pending; poll Mailpit
   (`/api/v1/search?query=to:"<email>"`), extract the `/auth/v1/verify?...` link, GET
   it, then assert via `auth.admin.getUserById` that the same id is now permanent.
3. `refreshSession()`; assert same `sub`, `is_anonymous: false`.
4. Second anonymous client: `updateUser({ email: <taken> })`; assert 422
   `email_exists` and that the guest is untouched.
5. Third anonymous client: `updateUser({ password })`; assert 422 rejection.
