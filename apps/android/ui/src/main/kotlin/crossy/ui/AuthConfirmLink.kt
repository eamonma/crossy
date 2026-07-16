// The magic-link callback's digest (roadmap I3b), the pure JVM-testable twin of iOS CrossyUI's
// AuthConfirm (AuthConfirmLink.swift). A Supabase email magic link lands on the app carrying a
// `/auth/confirm` path with `token_hash` and `type`, the two values `POST {auth}/verify` needs to
// complete the link (SupabaseAuthClient verifyEmailLink). This digests that one shape to those two
// values, or null for any other URL, so the deep-link router can tell a magic link from a
// `/game/<id>` invite and route each to its own seam.
//
// It parses BOTH shapes the link can wear: the custom-scheme form the crossy invite route already
// owns (`crossy://auth/confirm?...`, host `auth`, path `/confirm`), and the https App Links form
// (`https://{host}/auth/confirm?...`, path `/auth/confirm`). Pointing Supabase's email template at
// the crossy scheme is the owner's server-side switch, so the https shape is ready here for the day
// App Links land (that manifest verification is owner-gated, PARITY.md), no further parser change.
//
// The parser stays here beside InviteScan (the deep-link parsers live in :ui, tested headless on
// the JVM via java.net.URI, never android.net.Uri) rather than in the app target.

package crossy.ui

import java.net.URI
import java.net.URLDecoder

/** The two values a magic-link callback carries, ready for `completeMagicLink` (iOS AuthConfirmLink). */
data class AuthConfirmLink(
    /** The one-time hash the verify grant exchanges for a session. */
    val tokenHash: String,
    /** The link's own type, passed to verify verbatim (`magiclink`, `email`, `recovery`, ...);
     *  GoTrue owns the vocabulary, so nothing here validates it beyond non-empty. */
    val type: String,
)

/** The magic-link digest (iOS `AuthConfirm`). Matches only the `/auth/confirm` route with BOTH
 *  `token_hash` and `type` present and non-empty; any other path (a `/game/<id>` invite, a bare
 *  open, a stray `/auth/confirmed`) or a half-formed query digests to null, so the caller falls
 *  through to the invite parser or ignores the link. The values pass through verbatim (they are
 *  opaque server tokens, not normalized like an invite code, INV-1 has no bearing here). */
object AuthConfirm {
    /** The magic-link values a URL carries, or null. */
    fun parse(url: String): AuthConfirmLink? {
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (!isConfirmRoute(uri)) return null

        val items = queryItems(uri.rawQuery)
        val tokenHash = items["token_hash"]
        val type = items["type"]
        if (tokenHash.isNullOrEmpty() || type.isNullOrEmpty()) return null
        return AuthConfirmLink(tokenHash = tokenHash, type = type)
    }

    /** Is this the `/auth/confirm` route, in either shape? The custom-scheme form carries the
     *  first segment in the authority (`crossy://auth/confirm`, host `auth`, one path segment
     *  `confirm`); the https form carries both in the path (`/auth/confirm`). An exact segment
     *  match, so `/auth/confirmed` (a stray page) is never it. */
    private fun isConfirmRoute(uri: URI): Boolean {
        val segments = (uri.rawPath ?: "").split("/").filter { it.isNotEmpty() }
        val customScheme = uri.scheme == "crossy" && uri.host == "auth" && segments == listOf("confirm")
        val httpsShape = segments == listOf("auth", "confirm")
        return customScheme || httpsShape
    }

    /** The query as a name -> decoded-value map, first value winning. Percent-decoded the way iOS
     *  URLComponents.queryItems hands values back (a `%2B` becomes `+`), but a literal `+` survives
     *  as `+` rather than folding to a space, so an opaque token is never mangled. */
    private fun queryItems(rawQuery: String?): Map<String, String> {
        val query = rawQuery ?: return emptyMap()
        val items = LinkedHashMap<String, String>()
        for (pair in query.split("&")) {
            if (pair.isEmpty()) continue
            val parts = pair.split("=", limit = 2)
            val name = decode(parts[0])
            if (name in items) continue
            items[name] = if (parts.size == 2) decode(parts[1]) else ""
        }
        return items
    }

    private fun decode(value: String): String =
        runCatching { URLDecoder.decode(value.replace("+", "%2B"), "UTF-8") }.getOrDefault(value)
}
