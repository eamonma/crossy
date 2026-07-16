// The composition root's entry point: build the shared HTTP client, the session/API wiring, and
// the room transport factory once, then hand them to CrossyApp. Adapters are wired here and nowhere
// else (ARCHITECTURE.md: ":app wires everything"). This is also where every deep link lands: the
// crossy://auth/callback OAuth redirect re-enters through onNewIntent (singleTask, the warm return)
// or through the launch intent (a cold start after the tab outlived the app), and either way the
// URI is delivered into OAuthRedirects exactly once per intent. The other routes (the invite, the
// magic-link confirm, the play hand-off) ride the same once-per-intent discipline through
// DeepLinkRouter into PendingLinks; the two lanes never collide (the router excludes the auth host).

package crossy.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import crossy.api.TurnstileMintPolicy
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    /** The OAuth callback hand-off into compose. Lives with the activity so both intent entry
     *  points can deliver into the one holder the sign-in host observes. */
    private val redirects = OAuthRedirects()

    /** The other deep links' hand-off into compose (invite, magic link, play): the OAuthRedirects
     *  twin, delivered into by the same two intent entry points and observed by the signed-in shell. */
    private val pendingLinks = PendingLinks()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Edge-to-edge with contrast-aware system bar icons (dark-on-light, light-on-dark); the
        // safe-area shell in CrossyApp keeps content out from under the bars.
        enableEdgeToEdge()
        val http = OkHttpClient()
        // The captcha minter is a hidden WebView owned here by the app target (WebKit is not in :ui
        // or :api, AAD-2; the twin of iOS's app-target TurnstileProvider). Built only when this build
        // carries a site key; the pure policy wraps it with the timeout/retry/error mapping. Empty
        // site key = no policy = the plain pre-captcha send. The WebView attaches lazily on first
        // mint (after setContent), so building the minter here is safe.
        val siteKey = AppConfig.turnstileSiteKey()
        val turnstile =
            if (siteKey.isNotEmpty()) TurnstileMintPolicy(WebViewTurnstileMinter(this, siteKey)) else null
        // The Keystore-backed store is built here (platform storage is a :app concern, AAD-2) and
        // injected, so :api stays free of Android storage types. restore() then rehydrates any
        // persisted (or refreshable) session before the first frame, so a returning user lands in
        // Rooms with no sign-in; it is synchronous and network-free, the twin of iOS restoring from
        // the Keychain at ArrivalModel init.
        val session =
            AppSession(AppConfig.urls(), AppConfig.supabase(), http, turnstile, KeystoreTokenStore(this))
        session.restore()
        val factory = ScriptedRoomTransportFactory()
        // The cold-start half of every deep-link return: the URI arrived as this launch's intent.
        // Guarded on a fresh instance state so a recreation (rotation) never re-digests the same
        // intent: once per intent, not once per onCreate.
        if (savedInstanceState == null) dispatchDeepLink(intent)
        setContent {
            CrossyApp(session = session, factory = factory, redirects = redirects, pendingLinks = pendingLinks)
        }
    }

    /** The warm return: singleTask routes the deep-link VIEW intent into the standing instance. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        dispatchDeepLink(intent)
    }

    /** Route one intent's URI. The OAuth callback keeps its own untouched lane into [redirects];
     *  every other recognized route (invite, magic link, play) goes through [DeepLinkRouter] into
     *  [pendingLinks]. Both are once-per-intent (the onCreate/onNewIntent guards above). Never logs
     *  the URI: an invite carries a code, a magic link carries a token (type-only logging, the
     *  standing policy). */
    private fun dispatchDeepLink(intent: Intent?) {
        deliverAuthRedirect(intent)
        deliverPendingLink(intent)
    }

    /** Deliver an OAuth callback URI into [redirects], and nothing else: the launcher intent has
     *  no data, and the shape check keeps any future crossy:// route from riding the auth lane. */
    private fun deliverAuthRedirect(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.scheme == "crossy" && uri.host == "auth" && uri.path == "/callback") {
            redirects.deliver(uri.toString())
        }
    }

    /** Deliver the non-auth-callback routes into [pendingLinks]. DeepLinkRouter classifies the URI
     *  string (pure, JVM-tested) and returns null for the callback (its lane above) and any
     *  unrelated URL, so nothing here touches the auth lane. */
    private fun deliverPendingLink(intent: Intent?) {
        val uri = intent?.data ?: return
        when (val route = DeepLinkRouter.route(uri.toString())) {
            is DeepLinkRoute.Invite -> pendingLinks.deliverInvite(route.code)
            is DeepLinkRoute.MagicLink -> pendingLinks.deliverMagicLink(route.link.tokenHash, route.link.type)
            is DeepLinkRoute.Play -> pendingLinks.deliverPlay(route.puzzleId)
            null -> Unit
        }
    }
}
