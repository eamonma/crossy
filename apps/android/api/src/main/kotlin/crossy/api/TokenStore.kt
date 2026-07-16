// The secure token store behind its own tiny port (ARCHITECTURE.md AAD-1: secure storage arrives
// via a port; AD-4: the Keystore-backed persistence lands in `:app`, not here). AuthSession reads
// and writes its standing session, its provider marker, and its one pending OAuth attempt through
// this seam, so tests run in memory while the Keystore impl lives in the composition root.
//
// Where iOS `KeychainStoring` is byte-oriented (AuthSession does its own JSON) with one blob per
// account, this port is typed: the in-memory impl just holds the values, and the `:app` Keystore
// impl serializes and encrypts them (SupabaseSession and PendingOAuth are `@Serializable` for
// exactly that). This keeps `:api` JVM-pure and free of Android storage types.
//
// The provider marker and the pending verifier are separate slots from the session, the iOS
// separate-keychain-account shape: the session schema stays untouched, a token-only restore still
// stands, and a cold OAuth return can recover the verifier the in-memory attempt lost to process
// death. All three are default no-ops on the port so a preview/fake need only carry the session;
// InMemoryTokenStore and the Keystore impl carry all three.

package crossy.api

import java.util.concurrent.atomic.AtomicReference

/** One session slot plus the provider marker and the pending OAuth attempt. Persisting a session is
 *  a `write`, dropping it a `clear`; there is one session at a time (one signed-in identity), so the
 *  port is deliberately not a general key/value store. */
public interface TokenStore {
    /** The stored session, or null when none exists. */
    public fun read(): SupabaseSession?

    /** Create or replace the stored session. */
    public fun write(session: SupabaseSession)

    /** Remove the stored session; clearing an empty store is not an error. This drops the session
     *  alone (the terminal-refresh path leaves the provider marker standing, the iOS shape); the
     *  full sign-out purge also calls [clearProvider] and [clearPendingOAuth]. */
    public fun clear()

    /** The persisted provider marker, or null when none was written (a pre-marker session, or an
     *  unreadable value from a future build): the session then restores nameless rather than
     *  misreporting a provider. Default null so a minimal fake need not carry it. */
    public fun readProvider(): AuthProvider? = null

    /** Remember which provider minted the standing session. Best-effort at the impl: a failed write
     *  costs the provider name after a relaunch, never the sign-in. */
    public fun writeProvider(provider: AuthProvider) {}

    /** Drop the provider marker; part of the sign-out / account-deletion purge. */
    public fun clearProvider() {}

    /** The persisted pending OAuth attempt, or null when none is outstanding. Read only as the
     *  cold-return fallback: a warm completion still spends the in-memory attempt, so this recovers
     *  the verifier only when process death took the in-memory one (the deliberate divergence from
     *  iOS, whose in-process web sheet never leaves the app). Default null for minimal fakes. */
    public fun readPendingOAuth(): PendingOAuth? = null

    /** Persist the pending OAuth attempt (provider + verifier) so a cold return can complete it. */
    public fun writePendingOAuth(pending: PendingOAuth) {}

    /** Drop the pending OAuth attempt; every completion attempt spends it, and the purge clears it. */
    public fun clearPendingOAuth() {}
}

/** The in-memory implementation for tests and previews: same contract, no Keystore, no persistence
 *  beyond the process. Carries all three slots so the OAuth cold-return and sign-out paths are
 *  drivable headlessly. */
public class InMemoryTokenStore : TokenStore {
    private val slot = AtomicReference<SupabaseSession?>(null)
    private val providerSlot = AtomicReference<AuthProvider?>(null)
    private val pendingSlot = AtomicReference<PendingOAuth?>(null)

    override fun read(): SupabaseSession? = slot.get()

    override fun write(session: SupabaseSession) {
        slot.set(session)
    }

    override fun clear() {
        slot.set(null)
    }

    override fun readProvider(): AuthProvider? = providerSlot.get()

    override fun writeProvider(provider: AuthProvider) {
        providerSlot.set(provider)
    }

    override fun clearProvider() {
        providerSlot.set(null)
    }

    override fun readPendingOAuth(): PendingOAuth? = pendingSlot.get()

    override fun writePendingOAuth(pending: PendingOAuth) {
        pendingSlot.set(pending)
    }

    override fun clearPendingOAuth() {
        pendingSlot.set(null)
    }
}
