// The deep-link router's shape (parity-deeplinks): one recognized URL becomes one route, the auth
// callback stays out of it (the OAuth lane owns that URI), and everything else is null. Pure over
// the string, so it pins headlessly on the JVM (testProdDebugUnitTest); the same classification the
// iOS CrossyApp onOpenURL/onContinueUserActivity handlers make.

package crossy.app

import crossy.ui.AuthConfirmLink
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class DeepLinkRouterTests {

    @Test
    fun `the custom-scheme invite digests to an Invite route`() {
        assertEquals(
            DeepLinkRoute.Invite("AB23CD45"),
            DeepLinkRouter.route("crossy://game/g-1?code=AB23CD45"),
        )
    }

    @Test
    fun `the crossy-scheme confirm digests to a MagicLink route`() {
        assertEquals(
            DeepLinkRoute.MagicLink(AuthConfirmLink(tokenHash = "abc123", type = "magiclink")),
            DeepLinkRouter.route("crossy://auth/confirm?token_hash=abc123&type=magiclink"),
        )
    }

    @Test
    fun `the https confirm shape digests to a MagicLink route (App Links readiness)`() {
        // The parser is ready for the day the owner points the email template at App Links; the
        // router carries that shape through with no change.
        assertEquals(
            DeepLinkRoute.MagicLink(AuthConfirmLink(tokenHash = "abc123", type = "email")),
            DeepLinkRouter.route("https://crossy.party/auth/confirm?token_hash=abc123&type=email"),
        )
    }

    @Test
    fun `the auth callback is not routed here, its OAuth lane owns it`() {
        // crossy://auth/callback stays with OAuthRedirects; the router returns null so the callback
        // never digests as an invite code (the two lanes never collide).
        assertNull(DeepLinkRouter.route("crossy://auth/callback?code=abc"))
    }

    @Test
    fun `crossy play digests to a Play route`() {
        assertEquals(
            DeepLinkRoute.Play("p-42"),
            DeepLinkRouter.route("crossy://play/p-42"),
        )
    }

    @Test
    fun `crossy play with no puzzle digests to null`() {
        // A host match is terminal (iOS `return`): a play link naming no puzzle is null, never a
        // fall-through to the invite parser.
        assertNull(DeepLinkRouter.route("crossy://play"))
        assertNull(DeepLinkRouter.route("crossy://play/"))
    }

    @Test
    fun `an unrelated URL digests to null`() {
        assertNull(DeepLinkRouter.route("https://crossy.party/about"))
        assertNull(DeepLinkRouter.route("not a url at all"))
    }
}
