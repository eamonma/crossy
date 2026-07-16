// The PendingLinks holder's consume-once discipline (parity-deeplinks), the OAuthRedirects twin: a
// delivery is spent exactly once, and a delivery that superseded another is never dropped by a late
// consume of the stale one (the id key). Pure JVM (testProdDebugUnitTest); the compose state is
// read directly, no recomposition needed.

package crossy.app

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class PendingLinksTests {

    @Test
    fun `an invite is delivered, observed, and consumed exactly once`() {
        val links = PendingLinks()
        assertNull(links.invite)

        links.deliverInvite("AB23CD45")
        val held = links.invite
        assertEquals("AB23CD45", held?.code)

        links.consumeInvite(held!!)
        assertNull(links.invite, "consuming the standing invite clears it")
    }

    @Test
    fun `a superseding invite is not dropped by a late consume of the stale one`() {
        val links = PendingLinks()
        links.deliverInvite("AB23CD45")
        val stale = links.invite!!
        links.deliverInvite("EF67GH89")
        val fresh = links.invite!!

        // A stale delivery raced in behind the fresh one: consuming it must not drop the fresh one.
        links.consumeInvite(stale)
        assertEquals(fresh, links.invite, "the fresh invite survives a stale consume")

        links.consumeInvite(fresh)
        assertNull(links.invite)
    }

    @Test
    fun `magic link and play carry their own independent slots`() {
        val links = PendingLinks()
        links.deliverMagicLink("hash-1", "magiclink")
        links.deliverPlay("p-1")

        assertEquals("hash-1", links.magicLink?.tokenHash)
        assertEquals("magiclink", links.magicLink?.type)
        assertEquals("p-1", links.play?.puzzleId)

        // Consuming one leaves the other standing (the three flows are honored independently).
        links.consumeMagicLink(links.magicLink!!)
        assertNull(links.magicLink)
        assertEquals("p-1", links.play?.puzzleId)

        links.consumePlay(links.play!!)
        assertNull(links.play)
    }
}
