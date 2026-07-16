// The typed deep-link router (iOS CrossyApp.onOpenURL / onContinueUserActivity): one recognized
// URL becomes one route, everything else is null. Pure over the URL string (java.net.URI, never
// android.net.Uri) so its shape pins headlessly on the JVM; MainActivity extracts intent.data,
// hands the string here, and delivers the result into PendingLinks. The auth/callback OAuth lane is
// deliberately NOT a route here: it keeps its own untouched lane through OAuthRedirects, and this
// router returns null for it (its host `auth` is excluded from the invite branch below), so the two
// never collide.

package crossy.app

import crossy.ui.AuthConfirm
import crossy.ui.AuthConfirmLink
import crossy.ui.InviteScan
import java.net.URI

/** What a recognized deep link resolves to. Null (from [DeepLinkRouter.route]) means no route: an
 *  unrelated URL, or the auth/callback the OAuth lane owns. */
sealed interface DeepLinkRoute {
    /** crossy://game/<id>?code=..., or any invite shape InviteScan recognizes. */
    data class Invite(val code: String) : DeepLinkRoute

    /** crossy://auth/confirm (or the https App Links shape): a Supabase magic link. */
    data class MagicLink(val link: AuthConfirmLink) : DeepLinkRoute

    /** crossy://play/<puzzleId>: the Puzzles hand-off. */
    data class Play(val puzzleId: String) : DeepLinkRoute
}

object DeepLinkRouter {
    /** Classify [url]. The magic link is checked first so its /auth/confirm path never reaches the
     *  invite parser (iOS checks AuthConfirm before InviteScan); play is its own host; the invite
     *  parser sees everything else EXCEPT the auth host, whose /callback is the OAuth lane's and
     *  whose /confirm was already handled. */
    fun route(url: String): DeepLinkRoute? {
        AuthConfirm.parse(url)?.let { return DeepLinkRoute.MagicLink(it) }

        val uri = runCatching { URI(url) }.getOrNull()
        if (uri != null && uri.scheme == "crossy" && uri.host == "play") {
            // crossy://play/<puzzleId>: a host match is terminal (iOS `return`), so a play link
            // that names no puzzle simply digests to null rather than falling through to invite.
            val puzzleId = (uri.rawPath ?: "").split("/").firstOrNull { it.isNotEmpty() }
            return puzzleId?.let { DeepLinkRoute.Play(it) }
        }

        // The auth host is the OAuth lane's (crossy://auth/callback) and the confirm route's,
        // never an invite: exclude it so the callback never digests as a code (iOS guards host).
        if (uri != null && uri.host == "auth") return null

        return InviteScan.parse(url)?.let { DeepLinkRoute.Invite(it) }
    }
}
