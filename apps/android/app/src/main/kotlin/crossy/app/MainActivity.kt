// The composition root's entry point: build the shared HTTP client, the session/API wiring, and
// the room transport factory once, then hand them to CrossyApp. Adapters are wired here and nowhere
// else (ARCHITECTURE.md: ":app wires everything"). Nothing else of substance lives in this class.

package crossy.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import crossy.api.TurnstileMintPolicy
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val http = OkHttpClient()
        // The captcha minter is a hidden WebView owned here by the app target (WebKit is not in :ui
        // or :api, AAD-2; the twin of iOS's app-target TurnstileProvider). Built only when this build
        // carries a site key; the pure policy wraps it with the timeout/retry/error mapping. Empty
        // site key = no policy = the plain pre-captcha send. The WebView attaches lazily on first
        // mint (after setContent), so building the minter here is safe.
        val siteKey = AppConfig.turnstileSiteKey()
        val turnstile =
            if (siteKey.isNotEmpty()) TurnstileMintPolicy(WebViewTurnstileMinter(this, siteKey)) else null
        val session = AppSession(AppConfig.urls(), AppConfig.supabase(), http, turnstile)
        val factory = ScriptedRoomTransportFactory()
        setContent {
            CrossyApp(session = session, factory = factory)
        }
    }
}
