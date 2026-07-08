# SP2: Local JWT verification

**Question.** Can the API and session service verify Supabase access tokens with zero
per-request network calls? Pin the JWKS shape, key rotation, and the anonymous claim.
This blocks Wave 1.1g (the auth port: Supabase adapter plus in-memory fake).

**Answer: yes.** A project created today signs user access tokens with **asymmetric
ES256** and publishes the public key at a JWKS endpoint. A verifier loads that JWKS
once, refreshes it on a background timer, and verifies every token in memory. No
network call sits on the request path. The `sub` and `is_anonymous` claims the auth
port needs are present and behave as SP1 assumed. D05's "JWTs verified locally" holds
without change; SP2 fills in the how.

Confidence: **high** on everything reproduced locally (default algorithm, JWKS shape,
claims, rotation overlap, offline verification, zero network). **High-documented** on
the hosted-only facts (new-project default date, edge cache TTLs, EdDSA status), which
are stated in Supabase's own docs and match the local stack's behavior but were not run
against a hosted project.

## HS256 versus asymmetric: the current reality

The old mental model (Supabase signs everything with one shared HS256 secret, no JWKS)
is out of date. Two token families now coexist:

- **User session tokens** (what `signInAnonymously`, OAuth, and email sign-in mint, and
  the only thing the auth port ever sees) are signed with **ES256** by default. On the
  local stack the Supabase CLI auto-generates an ES256 key on `supabase start` even
  with no signing-key config; `GOTRUE_JWT_KEYS` is populated automatically. On hosted,
  **all new projects default to asymmetric JWTs as of 2025-10-01**; older projects
  opt in and the switch is non-breaking.
- **Static API keys** (`anon`, `service_role`) are still legacy **HS256** JWTs signed
  with the shared `JWT_SECRET`. These are Supabase-gateway credentials. Our services do
  not sit behind the Supabase gateway (D05 demotes Supabase to Postgres plus Auth), so
  the auth port never verifies these. It should **pin the asymmetric algorithms and
  refuse HS256 outright**, which also closes the alg-confusion downgrade (a forged
  HS256 token signed with a known/leaked secret must not verify).

So the local stack exposes both modes at once: ES256 for the tokens we care about,
HS256 for keys we do not. Both paths were verified empirically below.

## Supported algorithms

ES256 (P-256, Supabase's recommended default), RS256 (RSA-2048), and EdDSA (Ed25519,
documented as "coming soon" with limited runtime support). The CLI's
`supabase gen signing-key` offers ES256 and RS256 only. Design the verifier's allowlist
as `["ES256","RS256","EdDSA"]` so an operator can rotate algorithm without a code
change, but expect ES256 in practice.

## JWKS shape and endpoint

- URL: `${issuer}/.well-known/jwks.json`, i.e. local
  `http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`, hosted
  `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json`. The bare
  `/auth/v1/jwks` path is **404**; use the `.well-known` path.
- Document is a standard RFC 7517 JWK Set. An ES256 entry, verbatim from the local
  stack:

  ```json
  {"keys":[{"alg":"ES256","crv":"P-256","ext":true,"key_ops":["verify"],
    "kid":"b81269f1-21d8-4f2e-b719-c2240a840d90","kty":"EC","use":"sig",
    "x":"M5Sjqn5zwC9Kl1zVfUUGvv9boQjCGd45G8sdopBExB4",
    "y":"P6IXMvA2WYXSHSOMTBH2jsw_9rrzGy89FjPf6oOsIxQ"}]}
  ```

  `kid` is a random UUID. RS256 entries carry `kty:"RSA"` with `n`/`e` instead of the
  EC `crv`/`x`/`y`. Every published key is `use:"sig"` with `key_ops:["verify"]` (public
  halves cannot sign), so a verifier trusts any key in the set and never has to reason
  about which one is "current."

## Key rotation

Model (hosted docs, reproduced locally): keys move through **standby -> current ->
previously-used -> revoked**. A standby key is **published in the JWKS before it ever
signs a token**. Rotation flips the current key to sign new tokens; the old key stays
in the JWKS and keeps verifying until it is explicitly revoked. Non-expired tokens and
the `anon`/`service_role` keys survive rotation.

Reproduced on the local stack by configuring `signing_keys_path` with two ES256 keys
(new key as signer, old key demoted to `key_ops:["verify"]`):

- The JWKS advertised **both** kids after rotation.
- New tokens were signed with the new kid (gotrue signs with the first key whose private
  `key_ops` includes `sign`; the ordered array in the signing-keys file is the control).
- A single post-rotation JWKS verified **both** a pre-rotation token (old kid) and a
  post-rotation token (new kid) offline, zero network. This is the overlap guarantee the
  design depends on.

The safety consequence for the verifier: because standby keys appear in the JWKS ahead
of use, any background refresh whose interval is shorter than the operator's standby
window already holds the new key before the first token signed by it arrives. That is
what makes zero synchronous fetches safe across a rotation.

**Caching (hosted):** the JWKS endpoint is edge-cached ~10 min, and Supabase client
libraries cache in memory another ~10 min, so a rotation can take up to ~20 min to fully
propagate. Our refresh interval should sit comfortably under the standby window (minutes,
not seconds) and treat a fetch failure as "keep the last good set," never as a reason to
block or reject.

**Unknown `kid`:** fail the request closed (reject the token) and schedule an
out-of-band, debounced refresh so a freshly rotated key is picked up within one interval.
Never fetch synchronously on the request path. With a background poller this case should
not arise in normal operation; it is the belt-and-suspenders path for a rotation faster
than the poll interval. Verified locally that `jose`'s local key set raises
`ERR_JWKS_NO_MATCHING_KEY` on an unknown `kid` with no network attempt.

## Claims the auth port needs

From a locally minted anonymous access token (ES256), decoded claims:

```json
{ "iss": "http://127.0.0.1:54341/auth/v1", "sub": "bc12aac8-...-c8ff53ab97cf",
  "aud": "authenticated", "exp": 1783497278, "iat": 1783493678,
  "role": "authenticated", "aal": "aal1",
  "amr": [{"method":"anonymous","timestamp":1783493678}],
  "session_id": "effc263a-...", "is_anonymous": true }
```

What to validate:

- **Signature** against the JWKS, with the algorithm allowlist above (never HS256).
- **`iss`** equals the configured issuer exactly. This is the one value that differs
  between local and hosted, so it is a config knob (see below).
- **`aud`** equals `"authenticated"`.
- **`exp`** (and `nbf` if present) with a small clock-skew tolerance (~10 s). `jose`
  enforces these when given `issuer`/`audience` options.
- Map **`sub`** to `user_id` (a UUID string) and **`is_anonymous`** to `isAnonymous`,
  defaulting to `false` when the claim is absent (permanent users may omit it).

The auth port's `verify(token) -> {sub, isAnonymous}` (DESIGN.md §8) is satisfied by
`sub` and `is_anonymous` directly. Note the SP1 caveat still applies: a just-upgraded
guest carries `is_anonymous:true` for up to one token lifetime until `refreshSession()`,
so the JIT upsert into `users` (INV-7, API-owned) must tolerate the flag flipping late.

## Recommended verification design for 1.1g

**Library: `jose`** (v6). Zero dependencies, Node-native WebCrypto, supports
ES256/RS256/EdDSA, ships `createLocalJWKSet` and `jwtVerify` with issuer/audience/exp
enforcement. Used throughout this spike.

**Caching and refresh.** Do **not** wire `createRemoteJWKSet` straight onto the request
path: it fetches on a cache miss (including an unknown `kid`), which puts a synchronous
network call on verification exactly when a rotation happens. Instead:

1. On boot, fetch the JWKS once and build a `createLocalJWKSet(doc)`.
2. Run a background timer (every few minutes, with jitter) that refetches and atomically
   swaps the in-memory key set. On fetch failure, keep the previous set.
3. `verify()` runs entirely against the in-memory set. Always synchronous, always zero
   network.

**Rotation handling.** Covered by the background swap; standby keys land before they
sign. On an unexpected unknown `kid`, reject and trigger a debounced immediate refresh.

**Claim checks.** As listed above: signature with an asymmetric-only alg allowlist,
`iss` exact match, `aud === "authenticated"`, `exp`/`nbf` with ~10 s skew, extract
`sub` and `is_anonymous`.

**Config knobs (local versus hosted).**

| Knob | Local | Hosted |
| --- | --- | --- |
| `issuer` | `http://127.0.0.1:54321/auth/v1` | `https://<project-ref>.supabase.co/auth/v1` |
| JWKS URL | derived: `${issuer}/.well-known/jwks.json` | derived |
| `audience` | `authenticated` | `authenticated` |
| `algorithms` | `["ES256","RS256","EdDSA"]` | same |
| refresh interval | e.g. 300 s (jittered) | same |
| clock skew | ~10 s | same |

Everything is derivable from a single `issuer` value plus the audience; make `issuer`
the primary config input and derive the JWKS URL from it.

**In-memory fake (for tests).** The port's fake generates its own ES256 keypair with
`jose.generateKeyPair`, signs test tokens (including `is_anonymous`, custom `sub`, and
expiry), and exposes the matching JWKS to the same `createLocalJWKSet` verifier. Tests
run with no Docker and no network, mirroring the real adapter's code path. Test names
cite the invariant they defend (the identity ACL in DESIGN.md §7/§8).

## Impact on DESIGN.md

No change required. D05 already commits to "JWTs verified locally," and DESIGN.md §8's
"verify JWTs locally against the provider's published keys; no network call per request"
is confirmed exactly. SP2 only sharpens the mechanism (asymmetric ES256 via JWKS, a
periodic background refresh rather than a per-request fetch, HS256 refused for user
tokens). That detail is 1.1g implementation guidance, not a design decision, so it lives
in this report rather than in the canonical doc.

## Appendix: reproduction

Throwaway per spike rules; scripts live in scratch and are not committed. Environment:
Supabase CLI 2.109.1, gotrue v2.192.0, `jose` 6.2.3, Node 24, Docker. Ports remapped to
5434x to coexist with an unrelated local stack.

1. `supabase init`; set `enable_anonymous_sign_ins = true`; `supabase start` (db + kong
   + gotrue only).
2. `GET /auth/v1/.well-known/jwks.json` returns one ES256 key though no signing key was
   configured (CLI auto-generates `GOTRUE_JWT_KEYS`). `POST /auth/v1/signup` with `{}`
   mints an anonymous session; the access token header is `{"alg":"ES256","kid":...}`
   and `is_anonymous:true`.
3. `verify.mjs`: fetch JWKS once, then hard-disable `fetch`, then verify offline with
   `createLocalJWKSet`. Passed: ES256 token against the JWKS (sub, is_anonymous, iss,
   aud, exp, role), tamper rejection, unknown-`kid` rejection without network, and the
   legacy HS256 anon key against the shared secret. Network calls at verify time: 0.
4. Rotation: `supabase gen signing-key --algorithm ES256`; write
   `signing_keys.json` as `[newKey(sign), oldKey(verify-only)]`; set `signing_keys_path`;
   restart. JWKS advertised both kids; new tokens used the new kid; `verify_rotation.mjs`
   verified a pre-rotation and a post-rotation token against the one post-rotation JWKS,
   offline, network calls: 0.
