// PKCE derivation (RFC 7636), pinned by the RFC's own appendix B vector so the implementation
// cannot drift: the pair Supabase would see is the pair the RFC specifies. Twin of apps/ios
// PKCETests.swift. The browser flow that spends these values is out of AAD-3 scope; the helpers
// are pinned now so the native-provider track inherits them proven.

package crossy.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class PkceTests {
    // RFC 7636 appendix B: the worked example's verifier and its S256 challenge.
    private val rfcVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private val rfcChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    @Test
    fun theS256ChallengeMatchesTheRFC7636AppendixBVector() {
        assertEquals(rfcChallenge, Pkce.challenge(rfcVerifier))
    }

    @Test
    fun theVerifierFromKnownBytesIsBase64UrlWithoutPadding() {
        // The RFC's appendix B octet sequence encodes to its verifier exactly.
        val octets = byteArrayOf(
            116, 24, -33, -76, -105, -103, -32, 37, 79, -6, 96, 125, -40, -83,
            -69, -70, 22, -44, 37, 77, 105, -42, -65, -16, 91, 88, 5, 88, 83,
            -124, -115, 121,
        )
        assertEquals(rfcVerifier, Pkce.verifier(octets))
    }

    @Test
    fun freshVerifiersAreRFCLengthUnreservedAndUnique() {
        // 32 random bytes encode to 43 characters, the RFC minimum; base64url output stays inside
        // the unreserved set (no +, /, or = ever).
        val unreserved =
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".toSet()
        val seen = mutableSetOf<String>()
        repeat(32) {
            val verifier = Pkce.verifier()
            assertEquals(43, verifier.length)
            assertTrue(verifier.all { it in unreserved })
            seen.add(verifier)
        }
        assertEquals(32, seen.size, "verifiers are entropy, never repeated")
    }
}
