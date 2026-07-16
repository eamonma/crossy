// Pins the copy contract against apps/ios ArrivalCopy.swift: the lexicon-verbatim sentences, the
// code-keyed maps' behavior on unknown codes (degrade, never render the raw code), and the DENIED
// finality rule the join screen reads (EXPERIENCE.md §3, PROTOCOL.md §12).

package crossy.ui

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ArrivalCopyTests {
    @Test
    fun lexiconSentencesAreVerbatim() {
        // Verbatim contract with the lexicon (and the iOS twin, sentence for sentence).
        assertEquals("That code doesn't match any room.", ArrivalCopy.sentence("GAME_NOT_FOUND"))
        assertEquals("The host removed you from this room.", ArrivalCopy.sentence("DENIED"))
        assertEquals("Crosswords you solve together.", ArrivalCopy.welcomeLine)
    }

    @Test
    fun unknownCodesDegradeAndNeverRenderTheRawCode() {
        val sentence = ArrivalCopy.sentence("SOME_FUTURE_CODE")
        assertEquals("Something went wrong. Try again.", sentence)
        assertFalse(sentence.contains("SOME_FUTURE_CODE"))
        assertFalse(ArrivalCopy.displayNameError("X_UNKNOWN").contains("X_UNKNOWN"))
        assertFalse(ArrivalCopy.reactionSetError("X_UNKNOWN").contains("X_UNKNOWN"))
        assertFalse(ArrivalCopy.puzzleStartFailure("X_UNKNOWN").contains("X_UNKNOWN"))
        assertFalse(ArrivalCopy.deleteFailure("X_UNKNOWN").contains("X_UNKNOWN"))
    }

    @Test
    fun nullCodeIsNetworkWeatherWithARetryInvitation() {
        assertEquals(
            "Couldn't reach Crossy. Check your connection and try again.",
            ArrivalFailure.offline.sentence,
        )
    }

    @Test
    fun deniedIsFinalAndNothingElseIs() {
        assertTrue(ArrivalFailure("DENIED").isFinal)
        assertFalse(ArrivalFailure("GAME_NOT_FOUND").isFinal)
        assertFalse(ArrivalFailure.offline.isFinal)
    }

    @Test
    fun otpLengthMatchesTheServerConfiguredEightDigits() {
        assertEquals(8, ArrivalCopy.emailOTPCodeLength)
        assertEquals(8, ArrivalCopy.codeFieldPrompt.length)
    }
}
