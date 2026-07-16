// The persistent TokenStore, in the composition root because platform storage is a `:app` concern
// (AAD-2, the same rule that keeps the Turnstile WebView out of `:api`; AD-4's Keystore track). It
// is the twin of iOS SystemKeychain: it persists what the Keychain does (the session blob, the
// provider marker) plus the pending PKCE verifier Android needs across process death, and the auth
// session restores from it at cold start exactly as iOS restores from the Keychain at ArrivalModel
// init.
//
// Storage choice: a raw Android Keystore AES-256-GCM key wrapping the values in a private
// SharedPreferences file, NOT androidx.security EncryptedSharedPreferences. That artifact
// (security-crypto) is deprecated and drags in Tink; minSdk 29 has first-class Keystore AES-GCM, so
// the framework primitives do the same job with no third-party surface and no deprecated dependency
// to inherit. The key lives in the AndroidKeyStore (hardware-backed where the device offers it),
// never in the process or the prefs file; the prefs hold only IV+ciphertext.
//
// AfterFirstUnlock parity: the key carries no setUserAuthenticationRequired, so a background
// silent refresh can read the session before any foreground unlock, matching the iOS
// kSecAttrAccessibleAfterFirstUnlock choice.
//
// Never logs token material (existing policy): a decrypt failure logs by type only, then fails
// closed (returns null and drops the corrupt slot) so a rotated/invalidated key can never crash
// launch, it just lands the calm sign-in.

package crossy.app

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import crossy.api.AuthProvider
import crossy.api.PendingOAuth
import crossy.api.SupabaseSession
import crossy.api.TokenStore
import crossy.protocol.ProtocolJson
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class KeystoreTokenStore(context: Context) : TokenStore {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)

    override fun read(): SupabaseSession? =
        decode(SESSION_KEY) { ProtocolJson.decodeFromString(SupabaseSession.serializer(), it) }

    override fun write(session: SupabaseSession) {
        encode(SESSION_KEY, ProtocolJson.encodeToString(SupabaseSession.serializer(), session))
    }

    override fun clear() {
        prefs.edit().remove(SESSION_KEY).apply()
    }

    override fun readProvider(): AuthProvider? =
        decode(PROVIDER_KEY) { runCatching { AuthProvider.valueOf(it) }.getOrNull() }

    override fun writeProvider(provider: AuthProvider) {
        encode(PROVIDER_KEY, provider.name)
    }

    override fun clearProvider() {
        prefs.edit().remove(PROVIDER_KEY).apply()
    }

    override fun readPendingOAuth(): PendingOAuth? =
        decode(PENDING_KEY) { ProtocolJson.decodeFromString(PendingOAuth.serializer(), it) }

    override fun writePendingOAuth(pending: PendingOAuth) {
        encode(PENDING_KEY, ProtocolJson.encodeToString(PendingOAuth.serializer(), pending))
    }

    override fun clearPendingOAuth() {
        prefs.edit().remove(PENDING_KEY).apply()
    }

    /** Encrypt [plaintext] under the Keystore key and store IV+ciphertext at [key]. A failure drops
     *  the slot rather than leaving a half-written value; it is logged by type, never by content. */
    private fun encode(key: String, plaintext: String) {
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val ciphertext = cipher.doFinal(plaintext.encodeToByteArray())
            val packed = cipher.iv + ciphertext // IV is 12 bytes for GCM; prepended for decrypt.
            prefs.edit().putString(key, Base64.encodeToString(packed, Base64.NO_WRAP)).apply()
        } catch (e: Exception) {
            android.util.Log.w(LOG_TAG, "token store write failed for a slot: ${e::class.simpleName}")
            prefs.edit().remove(key).apply()
        }
    }

    /** Read IV+ciphertext at [key], decrypt, and map the plaintext with [parse]. Any failure (no
     *  value, a rotated/invalidated key, a corrupt frame) fails closed: the slot is dropped and null
     *  returned, so a stale ciphertext can never brick launch. */
    private fun <T> decode(key: String, parse: (String) -> T?): T? {
        val stored = prefs.getString(key, null) ?: return null
        return try {
            val packed = Base64.decode(stored, Base64.NO_WRAP)
            val iv = packed.copyOfRange(0, GCM_IV_BYTES)
            val ciphertext = packed.copyOfRange(GCM_IV_BYTES, packed.size)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            parse(String(cipher.doFinal(ciphertext), Charsets.UTF_8))
        } catch (e: Exception) {
            android.util.Log.w(LOG_TAG, "token store read failed for a slot: ${e::class.simpleName}")
            prefs.edit().remove(key).apply()
            null
        }
    }

    /** The AES-256-GCM key from the AndroidKeyStore, generated once and reused. The key material
     *  never leaves the Keystore; only the cipher handle does. */
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val PREFS_FILE = "crossy.auth.store"
        const val KEY_ALIAS = "crossy.auth.key.v1"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_IV_BYTES = 12
        const val GCM_TAG_BITS = 128
        const val SESSION_KEY = "session.v1"
        const val PROVIDER_KEY = "provider.v1"
        const val PENDING_KEY = "pending.v1"
        const val LOG_TAG = "CrossyAuth"
    }
}
