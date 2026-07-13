// PKCE (RFC 7636), the pure verifier/challenge derivation. Twin of apps/ios PKCE.swift.
// The derivation is pure over injected bytes so the RFC's appendix B vector pins it
// headlessly; only the default verifier() reaches for the system CSPRNG. S256 only: the
// plain method exists in the RFC for clients that cannot hash, which we are not.
//
// AAD-3 scope: the browser leg that spends these values (authorize URL, code exchange)
// is deliberately unimplemented on this side tonight (no web-based PKCE flow). These
// helpers ride along ready for the native-provider track that lands the flow later.

package crossy.api

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

public object Pkce {
    private val urlEncoder = Base64.getUrlEncoder().withoutPadding()

    /**
     * A code verifier from the given entropy: base64url without padding, so every character
     * is in the RFC 7636 unreserved set. 32 bytes encode to 43 characters, the RFC minimum
     * and the conventional choice.
     */
    public fun verifier(bytes: ByteArray): String = urlEncoder.encodeToString(bytes)

    /** A fresh random verifier (32 bytes from the system CSPRNG). Only the unimplemented
     *  browser leg calls this; the pure helpers above are what the RFC vector pins. */
    public fun verifier(): String {
        val bytes = ByteArray(32)
        SecureRandom().nextBytes(bytes)
        return verifier(bytes)
    }

    /**
     * The S256 challenge: base64url(SHA-256(ASCII(verifier))), no padding (RFC 7636 §4.2).
     * Verifiers are base64url output, ASCII by construction, so the UTF-8 bytes are the ASCII
     * bytes the RFC names.
     */
    public fun challenge(verifier: String): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(verifier.encodeToByteArray())
        return urlEncoder.encodeToString(digest)
    }
}
