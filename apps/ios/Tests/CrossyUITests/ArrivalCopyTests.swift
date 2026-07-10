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
        XCTAssertEqual(ArrivalCopy.joinWithCode, "Join with a code")
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
}
