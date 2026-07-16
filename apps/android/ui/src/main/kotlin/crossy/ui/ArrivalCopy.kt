// Arrival copy (EXPERIENCE.md §5, ID-5): plain and warm, controls that say what happens, errors
// that say what went wrong and what to do, without apology. Twin of apps/ios ArrivalCopy.swift,
// sentence for sentence. Lexicon sentences are verbatim contract; everything else here follows
// their voice. Errors key on the stable §12 code STRING (PROTOCOL.md §12), one human sentence per
// code: :ui does not import :api (AAD-2), and the codes are strings on the wire anyway, so the
// composition root passes the code through and the raw string never reaches the screen. The
// existing displayNameErrorCopy/reactionSetErrorCopy helpers predate this file and fold into it
// when their screens next move; new surfaces read this object.

package crossy.ui

/** A failed arrival call as the screens consume it: the stable code when the server spoke, null
 *  when the network never answered. The sentence derives from the code alone, never from server
 *  prose. */
data class ArrivalFailure(val code: String?) {
    /** DENIED is honest and final (EXPERIENCE.md §3 Join): the denylist does not change on retry,
     *  so the join screen stops inviting one. */
    val isFinal: Boolean get() = code == "DENIED"

    val sentence: String get() = ArrivalCopy.sentence(code)

    companion object {
        /** Network weather: no server verdict, retrying can help. */
        val offline = ArrivalFailure(code = null)
    }
}

/** The legal page a footer button asks for. Screens signal this intent through `onOpenLegal` and
 *  never hold URLs (AAD-2); the composition root maps it to the web origin's live page and
 *  presents a Custom Tab. */
enum class LegalPage { PRIVACY, TERMS }

object ArrivalCopy {
    // Welcome (EXPERIENCE.md §3: wordmark, one line, one button)

    /** The one line that says what this is. */
    const val welcomeLine = "Crosswords you solve together."
    const val continueWithApple = "Continue with Apple"
    const val continueWithDiscord = "Continue with Discord"
    const val continueWithHisbaan = "Continue with Hisbaan"
    const val continueWithEmail = "Continue with email"

    // "Continue another way" sheet (roadmap I3b)

    const val continueAnotherWay = "Continue another way"
    const val continueSheetTitle = "Another way in"
    const val continueRowEmail = "Email"
    const val continueRowHisbaan = "Hisbaan"
    const val emailEntryTitle = "Sign in with email"
    const val emailFieldPrompt = "you@example.com"
    const val emailEntryHint = "We'll send an eight-digit code to your inbox."
    const val emailSendCode = "Send code"

    /** The OTP length Supabase is configured for (8 digits). One constant the field cap, the
     *  Verify gate, and the field prompt all read, so the entry can never drift from the server's
     *  length; the copy above ("eight-digit") states it in words. */
    const val emailOTPCodeLength = 8

    const val codeEntryTitle = "Enter the code"
    fun codeEntryHint(email: String): String = "We sent a code to $email. Enter it to sign in."
    const val codeFieldPrompt = "00000000"
    const val codeVerify = "Verify"
    const val codeResend = "Resend code"
    const val codeResending = "Sending a new code"
    fun codeResendCountdown(seconds: Int): String = "Resend code in ${seconds}s"

    /** Calm error copy for the two steps (same voice as the arrival errors: say what happened,
     *  offer the retry, no apology). The server prose never reaches the screen. */
    const val emailSendFailed = "Couldn't send the code. Check the address and try again."
    const val codeVerifyFailed = "That code didn't work. Check it and try again, or resend."

    /** Auth failure returns here with a plain retry, never a dead end. */
    const val signInFailed = "Sign-in didn't finish. Try again."
    const val signInUnconfigured = "This build isn't set up for sign-in yet."
    const val privacyPolicy = "Privacy"
    const val termsOfService = "Terms"

    // Rooms (lexicon: home is Rooms)

    const val roomsTitle = "Rooms"
    /** The empty state is an invitation, not a void: one line, then the standing actions carry
     *  the rest. */
    const val roomsEmpty = "No rooms yet. Join a friend's room with a code."
    const val roomsSolvedSection = "Solved"
    const val roomsEndedSection = "Ended"

    // Join (the top affordance and its camera-first panel)

    const val joinAffordance = "Join"
    const val joinTitle = "Join a room"
    const val joinTypeInstead = "or type the code"
    /** The camera refused or absent: one plain sentence in the viewport, the field still beneath
     *  it (never a dead end). */
    const val joinScanDenied = "The camera's off for Crossy. Type the code, or turn it on in Settings."
    const val joinAction = "Join"

    // Puzzles (the library tab)

    const val puzzlesTitle = "Puzzles"
    const val puzzlesEmpty = "No puzzles yet. Upload one on the web and it shows up here."
    const val puzzleStartGame = "New game"
    const val puzzleStarting = "Starting"

    /** A failed start stays on the list and lets the card recover; the one line reads inline,
     *  keyed on the §12 code. */
    fun puzzleStartFailure(code: String?): String = when (code) {
        null -> "Couldn't reach Crossy to start the game. Try again."
        "FULL_ACCOUNT_REQUIRED" -> "Starting a game needs a signed-in account."
        "UNAUTHORIZED" -> "Your sign-in expired. Sign in again, then start the game."
        "PUZZLE_NOT_FOUND" -> "That puzzle is no longer available."
        else -> "Couldn't start the game. Try again."
    }

    // Settings (roadmap I3: thin v1, three things and a quiet footer)

    const val settingsTitle = "Settings"
    const val settingsNoName = "Signed in"
    const val signOutAction = "Sign out"
    const val deleteAccountAction = "Delete account"

    // Display name (onboarding + the Settings editor; §14.1, stable keys)

    const val displayNameTitle = "What should we call you?"
    const val displayNameOnboardingHint = "This is how you show up in a room. You can change it later."
    const val displayNameFieldPrompt = "Your name"
    const val displayNameSave = "Continue"
    const val settingsNameTitle = "Name"
    const val settingsNameSubtitle = "How you show up in a room"
    const val settingsNameSave = "Save"
    const val settingsNameCancel = "Cancel"

    /** One human sentence per display-name failure, keyed on the stable §12 code. null is network
     *  weather (nothing was judged). The RATE_LIMITED sentence is included on BOTH surfaces (R9).
     *  The raw code never renders. */
    fun displayNameError(code: String?): String = when (code) {
        null -> "Couldn't reach Crossy. Check your connection and try again."
        "NAME_REQUIRED" -> "Add a name so people know who you are."
        "NAME_TOO_LONG" -> "That name is too long. Keep it to 40 characters."
        "NAME_INVALID" -> "That name has characters we can't use. Try letters, numbers, or emoji."
        "RATE_LIMITED" -> "Too many changes just now. Wait a moment, then try again."
        "UNAUTHORIZED" -> "Your sign-in expired. Sign in again, then set your name."
        else -> "Couldn't save your name. Try again."
    }

    // Solving preferences (personal-settings slice 1)

    const val settingsSolvingSection = "Solving"
    const val settingsSkipFilledTitle = "Skip filled squares"
    const val settingsSkipFilledSubtitle = "While typing within a word"
    const val settingsEndOfWordTitle = "At the end of a word"
    const val settingsEndOfWordSubtitle = "Once the word is full"
    const val settingsEndOfWordNextClue = "Next clue"
    const val settingsEndOfWordFirstBlank = "First blank"

    // Reactions (Wave 8.5; PROTOCOL.md §9, D25)

    const val settingsReactionsSection = "Reactions"
    const val settingsReactionSetTitle = "Your five"
    const val settingsReactionSetSubtitle = "What the reaction fan offers"
    const val settingsReactionSetReset = "Use the defaults"
    const val settingsReactionFieldPrompt = "Any emoji"
    const val settingsReactionFieldLabel = "Choose any emoji"
    const val settingsReactionRule = "One emoji fills a slot."

    /** One human sentence per reaction-set failure, keyed on the stable §12 code. The named 422s
     *  are the server's authority: local gating catches most first, but the sentence must stand
     *  when the server rules. */
    fun reactionSetError(code: String?): String = when (code) {
        null -> "Couldn't reach Crossy. Check your connection and try again."
        "REACTION_SET_LENGTH" -> "A set is exactly five emoji."
        "REACTION_SET_INVALID" -> "One emoji fills a slot."
        "REACTION_SET_DUPLICATE" -> "Each slot needs its own emoji."
        "RATE_LIMITED" -> "Too many changes just now. Wait a moment, then try again."
        "UNAUTHORIZED" -> "Your sign-in expired. Sign in again, then pick your five."
        else -> "Couldn't save your reactions. Try again."
    }

    /** The provider line beneath the name, or the fallback when none is remembered. */
    const val providerDiscord = "Discord"
    const val providerApple = "Apple"
    const val providerHisbaan = "Hisbaan"
    const val providerEmail = "Email"
    const val providerUnknown = "Signed in"

    /** The two-beat confirmation body (roadmap I3): the consequence stated plainly, so the
     *  destructive action is never a surprise. */
    const val deleteAccountConfirmTitle = "Delete your account?"
    const val deleteAccountConfirmBody =
        "Your account is removed. Games you host pass to another solver, or end if you " +
            "are the last one. Your past answers stay in those rooms, credited to a former " +
            "participant with no name."
    const val deleteAccountConfirmAction = "Delete account"
    const val deleteAccountCancelAction = "Keep my account"

    /** The inline delete-failure sentence, keyed on the stable §12 code. */
    fun deleteFailure(code: String?): String = when (code) {
        null -> "Couldn't reach Crossy to delete your account. Try again."
        "UNAUTHORIZED" -> "Your sign-in expired. Sign in again, then delete your account."
        else -> "Couldn't delete your account. Try again."
    }

    // Errors, keyed on stable codes only (PROTOCOL.md §12)

    /** One human sentence per §12 code. An unknown code (the vocabulary grows, §12 says so)
     *  degrades to the plain fallback; the raw code never renders. */
    fun sentence(code: String?): String = when (code) {
        null -> "Couldn't reach Crossy. Check your connection and try again."
        // Lexicon verbatim: join failure.
        "GAME_NOT_FOUND" -> "That code doesn't match any room."
        // Lexicon verbatim: kicked; on a join the denylist is the only cause.
        "DENIED" -> "The host removed you from this room."
        "UNAUTHORIZED" -> "Your sign-in expired. Sign in again."
        "FULL_ACCOUNT_REQUIRED" -> "This needs a signed-in account."
        "VALIDATION" -> "That isn't a code Crossy recognizes."
        else -> "Something went wrong. Try again."
    }
}
