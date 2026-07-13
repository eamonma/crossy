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
}
