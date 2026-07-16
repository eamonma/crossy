// The composition root's failure mapping (the copy pass): every REST failure a host catches becomes
// an ArrivalFailure keyed on the stable §12 code, and the screens render its one coded sentence. This
// pins CrossyApiError -> code -> sentence, including the null/offline path (network weather, no server
// verdict), and that the raw exception text never rides into the sentence. Pure JVM
// (testProdDebugUnitTest); the mapping is the `Throwable.arrivalFailure()` extension the hosts call.

package crossy.app

import crossy.api.CrossyApiError
import crossy.protocol.APIErrorEnvelope
import crossy.ui.ArrivalCopy
import crossy.ui.ArrivalFailure
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.IOException

class HostErrorMappingTests {

    private fun envelope(code: String) = APIErrorEnvelope(error = code, message = "server prose $code")

    @Test
    fun apiRejectionCarriesTheStableCodeIntoTheCodedSentence_PROTOCOL12() {
        val failure = CrossyApiError.Api(404, envelope("GAME_NOT_FOUND")).arrivalFailure()
        assertEquals("GAME_NOT_FOUND", failure.code)
        assertEquals("That code doesn't match any room.", failure.sentence)
    }

    @Test
    fun deniedMapsToTheFinalSentenceTheJoinScreenReads_PROTOCOL12() {
        val failure = CrossyApiError.Api(403, envelope("DENIED")).arrivalFailure()
        assertTrue(failure.isFinal, "DENIED is final: the join screen stops inviting a resubmit")
        assertEquals("The host removed you from this room.", failure.sentence)
    }

    @Test
    fun rateLimitedIsStillAnApiRejectionKeyedOnItsCode_PROTOCOL12() {
        val failure = CrossyApiError.RateLimited(retryAfterSeconds = 12.0, envelope("RATE_LIMITED"))
            .arrivalFailure()
        assertEquals("RATE_LIMITED", failure.code)
    }

    @Test
    fun transportWeatherIsTheNullOfflinePath_noServerVerdict() {
        val failure = CrossyApiError.Transport(IOException("no route")).arrivalFailure()
        assertNull(failure.code, "network weather has no §12 code")
        assertEquals(
            "Couldn't reach Crossy. Check your connection and try again.",
            failure.sentence,
        )
        assertEquals(ArrivalFailure.offline.sentence, failure.sentence)
    }

    @Test
    fun aTokenlessOrBrokenFrameFailureAlsoDegradesToOffline() {
        assertNull(CrossyApiError.TokenUnavailable(IllegalStateException()).arrivalFailure().code)
        assertNull(CrossyApiError.InvalidResponse(502).arrivalFailure().code)
        assertNull(CrossyApiError.DecodingFailed(200, IllegalStateException()).arrivalFailure().code)
    }

    @Test
    fun theRawServerProseNeverRidesIntoTheSentence_INV() {
        // An envelope carrying a code outside today's vocabulary still surfaces a plain sentence, and
        // neither the code nor the server's message prose ever renders.
        val failure = CrossyApiError.Api(400, envelope("SOME_FUTURE_CODE")).arrivalFailure()
        assertFalse(failure.sentence.contains("SOME_FUTURE_CODE"))
        assertFalse(failure.sentence.contains("server prose"))
        assertEquals("Something went wrong. Try again.", failure.sentence)
    }

    @Test
    fun theStartFailurePathKeysTheCardSentenceOnTheSameCode_PROTOCOL12() {
        // The Puzzles start path reads the code string off the API error, then ArrivalCopy.
        val code = CrossyApiError.Api(403, envelope("FULL_ACCOUNT_REQUIRED")).apiCodeString
        assertEquals("Starting a game needs a signed-in account.", ArrivalCopy.puzzleStartFailure(code))
    }
}
