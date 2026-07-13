// The composition root's entry point: build the shared HTTP client, the session/API wiring, and
// the room transport factory once, then hand them to CrossyApp. Adapters are wired here and nowhere
// else (ARCHITECTURE.md: ":app wires everything"). Nothing else of substance lives in this class.

package crossy.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import okhttp3.OkHttpClient

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val http = OkHttpClient()
        val session = AppSession(AppConfig.urls(), AppConfig.supabase(), http)
        val factory = ScriptedRoomTransportFactory()
        setContent {
            CrossyApp(session = session, factory = factory)
        }
    }
}
