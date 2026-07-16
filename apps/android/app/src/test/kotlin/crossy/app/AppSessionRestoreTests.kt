// The composition-root half of session restore (AAD-2): AppSession.restore() must seed the bearer
// delegate and the self id exactly as completeOAuth does, so a persisted session routes straight to
// Rooms with no sign-in. These run pure on the JVM (testProdDebugUnitTest): the store is injected
// in-memory, so no Keystore and no device are involved. The Keystore encryption itself is framework
// -backed and exercised on-device, not here; what this pins is the wiring the restore path depends
// on. Twin of iOS RealArrivalSession init calling auth.restore() at ArrivalModel construction.

package crossy.app

import crossy.api.AuthProvider
import crossy.api.InMemoryTokenStore
import crossy.api.SupabaseConfig
import crossy.api.SupabaseSession
import crossy.api.TokenStore
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AppSessionRestoreTests {
    private fun appSession(store: TokenStore): AppSession =
        AppSession(
            AppUrls("http://localhost/".toHttpUrl(), "ws://localhost/"),
            SupabaseConfig(
                authBaseUrl = "http://localhost/auth/v1".toHttpUrl(),
                apiKey = "sb_publishable_test",
                issuer = "https://ref.supabase.co/auth/v1",
            ),
            OkHttpClient(),
            turnstile = null,
            tokenStore = store,
        )

    @Test
    fun restore_seedsTheBearerAndSelfIdFromAPersistedSession() {
        val store = InMemoryTokenStore().apply {
            write(SupabaseSession("access-tok", "refresh-tok", 4_102_444_800.0, "user-9"))
            writeProvider(AuthProvider.DISCORD)
        }
        val session = appSession(store)

        session.restore()

        assertTrue(session.isSignedIn, "a restored session is signed in with no sign-in leg")
        assertEquals("user-9", session.selfUserId, "the self id is seeded exactly as completeOAuth does")
    }

    @Test
    fun restore_anExpiredSessionStillSeedsTheBearer() {
        // Expiry is the refresh leg's problem, not restore's: an already-expired session still lands
        // signed in, so the returning user reaches Rooms and the first token use refreshes.
        val store = InMemoryTokenStore().apply {
            write(SupabaseSession("stale-tok", "refresh-tok", 1_000.0, "user-9"))
        }
        val session = appSession(store)

        session.restore()

        assertTrue(session.isSignedIn, "an expired-but-refreshable session still restores")
        assertEquals("user-9", session.selfUserId)
    }

    @Test
    fun restore_withAnEmptyStoreStaysSignedOut() {
        val session = appSession(InMemoryTokenStore())

        session.restore()

        assertFalse(session.isSignedIn, "nothing persisted, nothing restored")
        assertNull(session.selfUserId)
    }
}
