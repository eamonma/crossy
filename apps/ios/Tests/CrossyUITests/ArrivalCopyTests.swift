import XCTest

@testable import CrossyUI

// The arrival copy contract (EXPERIENCE.md §5): lexicon sentences verbatim, errors
// keyed on stable codes only (PROTOCOL.md §12), one human sentence each, never raw
// codes on screen, never prose keyed on message text.

final class ArrivalCopyTests: XCTestCase {
    func test_theLexiconSentencesAreVerbatim_EXPERIENCE5() {
        // The §5 table is the contract; these strings may not drift.
        XCTAssertEqual(
            ArrivalCopy.sentence(forCode: "GAME_NOT_FOUND"),
            "That code doesn't match any room.")
        XCTAssertEqual(
            ArrivalCopy.sentence(forCode: "DENIED"),
            "The host removed you from this room.")
        XCTAssertEqual(ArrivalCopy.roomsTitle, "Rooms")
        // The trailing shelf's quiet caps label, the same word the web shelf uses (Home.tsx).
        XCTAssertEqual(ArrivalCopy.roomsSolvedSection, "Solved")
        XCTAssertEqual(ArrivalCopy.joinAffordance, "Join")
        XCTAssertEqual(ArrivalCopy.joinTitle, "Join a room")
        XCTAssertEqual(ArrivalCopy.continueWithDiscord, "Continue with Discord")
    }

    func test_everyKnownCodeGetsOneSentenceAndNeverShowsTheRawCode() {
        let codes = [
            "GAME_NOT_FOUND", "DENIED", "UNAUTHORIZED", "FULL_ACCOUNT_REQUIRED",
            "VALIDATION", "INTERNAL", "NOT_PARTICIPANT", "FORBIDDEN",
        ]
        for code in codes {
            let sentence = ArrivalCopy.sentence(forCode: code)
            XCTAssertFalse(sentence.isEmpty)
            XCTAssertFalse(
                sentence.contains(code),
                "no raw codes on screen (§12 posture): \(code)")
        }
    }

    func test_anUnknownFutureCodeDegradesToThePlainFallback() {
        // §12 names codeless rejections that may gain codes later; an unknown code
        // reads as one plain sentence, never a crash, never the code itself.
        let sentence = ArrivalCopy.sentence(forCode: "BARRED")
        XCTAssertEqual(sentence, "Something went wrong. Try again.")
    }

    func test_networkWeatherHasItsOwnSentenceDistinctFromServerVerdicts() {
        let offline = ArrivalFailure.offline
        XCTAssertNil(offline.code)
        XCTAssertFalse(offline.sentence.isEmpty)
        XCTAssertNotEqual(offline.sentence, ArrivalCopy.sentence(forCode: "INTERNAL"))
    }

    func test_deniedIsFinalAndNothingElseIs_EXPERIENCEJoin() {
        // EXPERIENCE.md §3: DENIED is honest and final; every other failure invites
        // another try.
        XCTAssertTrue(ArrivalFailure(code: "DENIED").isFinal)
        XCTAssertFalse(ArrivalFailure(code: "GAME_NOT_FOUND").isFinal)
        XCTAssertFalse(ArrivalFailure.offline.isFinal)
    }

    func test_theStartGameActionMatchesTheWebGalleryWords() {
        // The library's one action starts a fresh game (POST /games); the web gallery
        // uses "New game" / "Starting...", so the app's words match.
        XCTAssertEqual(ArrivalCopy.puzzleStartGame, "New game")
        XCTAssertEqual(ArrivalCopy.puzzleStarting, "Starting")
    }

    func test_theContinueAnotherWayCopyIsPresentAndSubordinateInVoice_I3b() {
        // The tertiary affordance and the sheet it opens (roadmap I3b): the strings
        // exist and read plainly, the two rows name the two secondary methods.
        XCTAssertEqual(ArrivalCopy.continueAnotherWay, "Continue another way")
        XCTAssertFalse(ArrivalCopy.continueSheetTitle.isEmpty)
        XCTAssertEqual(ArrivalCopy.continueRowEmail, "Email")
        XCTAssertEqual(ArrivalCopy.continueRowHisbaan, "Hisbaan")
    }

    func test_theCodeEntryHintNamesTheAddressTheCodeWentTo_I3b() {
        // The code step tells the person where the code went, so a mistyped address is
        // obvious before they hunt an inbox that never got one.
        let hint = ArrivalCopy.codeEntryHint(email: "ada@example.com")
        XCTAssertTrue(hint.contains("ada@example.com"))
    }

    func test_theResendCountdownNamesTheRemainingSeconds_I3b() {
        // The cooldown reads as a live count, so the resend affordance is honest about
        // when it returns.
        XCTAssertTrue(ArrivalCopy.codeResendCountdown(seconds: 12).contains("12"))
    }

    func test_theEmailErrorsSayWhatToDoWithoutServerProse_I3b() {
        // Same voice as the arrival errors: a plain sentence with a remedy, never the
        // server's own words.
        XCTAssertFalse(ArrivalCopy.emailSendFailed.isEmpty)
        XCTAssertFalse(ArrivalCopy.codeVerifyFailed.isEmpty)
    }

    func test_theEmailOTPCodeLengthIsEightAndTheCopyAgrees_I3b() {
        // Supabase's OTP is 8 digits; the one length constant, the field prompt, and the
        // hint copy must all agree so the entry never rejects a valid code or misleads.
        XCTAssertEqual(ArrivalCopy.emailOTPCodeLength, 8)
        // The field prompt is a run of placeholder digits exactly the OTP length, so the
        // person sees how many to type.
        XCTAssertEqual(ArrivalCopy.codeFieldPrompt.count, ArrivalCopy.emailOTPCodeLength)
        XCTAssertTrue(ArrivalCopy.codeFieldPrompt.allSatisfy { $0.isNumber })
        // The send hint states the length in words; it must say "eight", never a stale
        // "six".
        XCTAssertTrue(ArrivalCopy.emailEntryHint.contains("eight-digit"))
        XCTAssertFalse(ArrivalCopy.emailEntryHint.contains("six"))
    }

    func test_startFailureIsOneSentencePerCodeAndNeverShowsTheRawCode() {
        // A failed start reads inline on the card, keyed on the §12 code, same posture
        // as the join and delete errors: say what happened, offer a retry, no raw code.
        let codes = [
            "FULL_ACCOUNT_REQUIRED", "UNAUTHORIZED", "PUZZLE_NOT_FOUND", "INTERNAL",
        ]
        for code in codes {
            let sentence = ArrivalCopy.puzzleStartFailure(forCode: code)
            XCTAssertFalse(sentence.isEmpty)
            XCTAssertFalse(
                sentence.contains(code),
                "no raw codes on screen (§12 posture): \(code)")
        }
        // Network weather and an unknown future code both read as plain, honest lines.
        XCTAssertFalse(ArrivalCopy.puzzleStartFailure(forCode: nil).isEmpty)
        XCTAssertEqual(
            ArrivalCopy.puzzleStartFailure(forCode: "BARRED"),
            "Couldn't start the game. Try again.")
    }

    // MARK: - Display name (onboarding + Settings editor; docs/design/name-onboarding.md §14.1)

    func test_theDisplayNameCopyMatchesTheAuthoritativeTable_14_1() {
        XCTAssertEqual(ArrivalCopy.displayNameTitle, "What should we call you?")
        XCTAssertEqual(
            ArrivalCopy.displayNameOnboardingHint,
            "This is how you show up in a room. You can change it later.")
        XCTAssertEqual(ArrivalCopy.displayNameFieldPrompt, "Your name")
        XCTAssertEqual(ArrivalCopy.displayNameSave, "Continue")
        XCTAssertEqual(ArrivalCopy.settingsNameTitle, "Name")
        XCTAssertEqual(ArrivalCopy.settingsNameSubtitle, "How you show up in a room")
        XCTAssertEqual(ArrivalCopy.settingsNameSave, "Save")
        XCTAssertEqual(ArrivalCopy.settingsNameCancel, "Cancel")
    }

    func test_displayNameErrorIsOneSentencePerCode_includingRateLimit_R9() {
        // The onboarding + Settings share one error map; the RATE_LIMITED sentence is on
        // BOTH surfaces (R9). Each code reads plainly and never shows the raw code.
        let expected: [String: String] = [
            "NAME_REQUIRED": "Add a name so people know who you are.",
            "NAME_TOO_LONG": "That name is too long. Keep it to 40 characters.",
            "NAME_INVALID":
                "That name has characters we can't use. Try letters, numbers, or emoji.",
            "RATE_LIMITED": "Too many changes just now. Wait a moment, then try again.",
        ]
        for (code, sentence) in expected {
            XCTAssertEqual(ArrivalCopy.displayNameError(forCode: code), sentence)
            XCTAssertFalse(
                ArrivalCopy.displayNameError(forCode: code).contains(code),
                "no raw codes on screen (§12 posture): \(code)")
        }
        // Network weather (nil) and an unknown code degrade to plain, distinct sentences.
        XCTAssertFalse(ArrivalCopy.displayNameError(forCode: nil).isEmpty)
        XCTAssertEqual(
            ArrivalCopy.displayNameError(forCode: "BARRED"),
            "Couldn't save your name. Try again.")
    }

    func test_theDisplayNameCopyHasNoEmDashes() {
        // House style: no em dashes in prose.
        let copy = [
            ArrivalCopy.displayNameTitle, ArrivalCopy.displayNameOnboardingHint,
            ArrivalCopy.displayNameFieldPrompt, ArrivalCopy.displayNameSave,
            ArrivalCopy.settingsNameSubtitle,
            ArrivalCopy.displayNameError(forCode: nil),
            ArrivalCopy.displayNameError(forCode: "NAME_REQUIRED"),
            ArrivalCopy.displayNameError(forCode: "NAME_TOO_LONG"),
            ArrivalCopy.displayNameError(forCode: "NAME_INVALID"),
            ArrivalCopy.displayNameError(forCode: "RATE_LIMITED"),
        ]
        for line in copy {
            XCTAssertFalse(line.contains("—"), "no em dashes: \(line)")
        }
    }

    // MARK: - Reactions (Wave 8.5; PROTOCOL.md §12, D25)

    func test_theReactionSetCopyMatchesTheSettingsSurface_D25() {
        XCTAssertEqual(ArrivalCopy.settingsReactionsSection, "Reactions")
        XCTAssertEqual(ArrivalCopy.settingsReactionSetTitle, "Your five")
        XCTAssertEqual(
            ArrivalCopy.settingsReactionSetSubtitle, "What the reaction fan offers")
        XCTAssertEqual(ArrivalCopy.settingsReactionSetReset, "Use the defaults")
        XCTAssertEqual(ArrivalCopy.settingsReactionRule, "One emoji fills a slot.")
    }

    func test_reactionSetErrorIsOneSentencePerCode_neverTheRawCode_PROTOCOL12() {
        // The Settings editor's one error map (the displayNameError posture): each
        // stable code reads plainly, no raw codes on screen.
        let expected: [String: String] = [
            "REACTION_SET_LENGTH": "A set is exactly five emoji.",
            "REACTION_SET_INVALID": "One emoji fills a slot.",
            "REACTION_SET_DUPLICATE": "Each slot needs its own emoji.",
            "RATE_LIMITED": "Too many changes just now. Wait a moment, then try again.",
        ]
        for (code, sentence) in expected {
            XCTAssertEqual(ArrivalCopy.reactionSetError(forCode: code), sentence)
            XCTAssertFalse(
                ArrivalCopy.reactionSetError(forCode: code).contains(code),
                "no raw codes on screen (§12 posture): \(code)")
        }
        // Network weather (nil) and an unknown code degrade to plain sentences.
        XCTAssertFalse(ArrivalCopy.reactionSetError(forCode: nil).isEmpty)
        XCTAssertEqual(
            ArrivalCopy.reactionSetError(forCode: "BARRED"),
            "Couldn't save your reactions. Try again.")
    }
}
