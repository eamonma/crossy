// The secure token store behind its own tiny port (ARCHITECTURE.md AAD-1: secure storage arrives
// via a port; AD-4: no persistence beyond the session store in v1). AuthSession reads and writes
// one session through this seam, so tests run in memory while the Keystore-backed implementation
// lands in `:app` later (the composition root's job, not a dependency here).
//
// Where iOS `KeychainStoring` is byte-oriented (AuthSession does its own JSON), this port is
// session-typed: the in-memory impl just holds the value, and the `:app` Keystore impl serializes
// and encrypts SupabaseSession (which is `@Serializable` for exactly that). This keeps `:api`
// JVM-pure and free of Android storage types.

package crossy.api

import java.util.concurrent.atomic.AtomicReference

/** One session slot. Persisting a null-eligible session is a `clear`; there is one session at a
 *  time (one signed-in identity), so the port is deliberately not a general key/value store. */
public interface TokenStore {
    /** The stored session, or null when none exists. */
    public fun read(): SupabaseSession?

    /** Create or replace the stored session. */
    public fun write(session: SupabaseSession)

    /** Remove the stored session; clearing an empty store is not an error. */
    public fun clear()
}

/** The in-memory implementation for tests and previews: same contract, no Keystore, no
 *  persistence beyond the process. */
public class InMemoryTokenStore : TokenStore {
    private val slot = AtomicReference<SupabaseSession?>(null)

    override fun read(): SupabaseSession? = slot.get()

    override fun write(session: SupabaseSession) {
        slot.set(session)
    }

    override fun clear() {
        slot.set(null)
    }
}
