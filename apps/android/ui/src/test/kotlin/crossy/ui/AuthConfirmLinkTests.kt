// The magic-link digest's contract (roadmap I3b), ported vector-for-vector from the iOS twin
// (AuthConfirmLinkTests.swift): only the /auth/confirm route with BOTH token_hash and type present
// digests to a link; every other URL (a /game invite, a bare open, a half-formed query, a stray
// /auth/confirmed) digests to null, so the deep-link router tells a magic link from an invite and
// routes each to its own seam. The Android parser additionally accepts the crossy-scheme shape the
// custom-scheme route wears (crossy://auth/confirm), so both cases are pinned here.

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class AuthConfirmLinkTests {

    // The https shape (the iOS Universal Link path), pinned to the iOS cases.
    @Test
    fun `I3b the confirm path with both values digests to the link`() {
        assertEquals(
            AuthConfirmLink(tokenHash = "abc123", type = "magiclink"),
            AuthConfirm.parse("https://crossy.party/auth/confirm?token_hash=abc123&type=magiclink"),
        )
    }

    @Test
    fun `I3b the values pass through verbatim, they are opaque server tokens`() {
        // token_hash and type are GoTrue's own, never normalized (INV-1 casing has no bearing): a
        // mixed-case type and a hash with URL-safe punctuation both survive, and query order does
        // not matter.
        assertEquals(
            AuthConfirmLink(tokenHash = "aB-_9x", type = "Recovery"),
            AuthConfirm.parse("https://crossy.party/auth/confirm?type=Recovery&token_hash=aB-_9x"),
        )
    }

    @Test
    fun `I3b a percent-encoded value decodes for the verify grant`() {
        // The decoded query value arrives ready for verify; a literal plus is left as a plus, never
        // folded to a space (an opaque token is never mangled).
        assertEquals(
            AuthConfirmLink(tokenHash = "a+b=c", type = "email"),
            AuthConfirm.parse("https://crossy.party/auth/confirm?token_hash=a%2Bb%3Dc&type=email"),
        )
    }

    @Test
    fun `I3b a half-formed query digests to null`() {
        // Either value missing, or present but empty, is not a completable link.
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirm?token_hash=abc"))
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirm?type=magiclink"))
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirm?token_hash=&type=magiclink"))
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirm?token_hash=abc&type="))
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirm"))
    }

    @Test
    fun `I3b an invite path is not a magic link, so the router falls through`() {
        // The invite paths carry no confirm digest, so the router falls through to InviteScan (the
        // two seams never collide on one URL).
        assertNull(AuthConfirm.parse("https://crossy.party/game/g-1?code=AB23CD45"))
        assertNull(AuthConfirm.parse("https://crossy.party/g/AB23CD45"))
        assertNull(AuthConfirm.parse("https://crossy.party/"))
        // A path that merely starts with the confirm segment is not it (a stray /auth/confirmed
        // page never triggers a verify).
        assertNull(AuthConfirm.parse("https://crossy.party/auth/confirmed?token_hash=abc&type=email"))
    }

    // The crossy-scheme shape (the custom-scheme route the manifest registers now): host `auth`,
    // path `/confirm`. Distinct from crossy://auth/callback, which carries no confirm digest.
    @Test
    fun `I3b the crossy-scheme confirm shape digests to the link`() {
        assertEquals(
            AuthConfirmLink(tokenHash = "abc123", type = "magiclink"),
            AuthConfirm.parse("crossy://auth/confirm?token_hash=abc123&type=magiclink"),
        )
    }

    @Test
    fun `I3b the crossy-scheme auth callback is not a magic link`() {
        // The OAuth callback owns the /callback path; it is never a confirm digest, so the two
        // crossy://auth lanes never collide.
        assertNull(AuthConfirm.parse("crossy://auth/callback?code=xyz"))
    }
}
