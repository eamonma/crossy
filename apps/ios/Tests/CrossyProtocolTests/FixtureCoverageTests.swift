import XCTest

// Strict on purpose (the vector runner's ethos: skipping silently is forbidden). Every
// checked-in fixture must be pinned by a snapshot test, and every pinned name must
// exist on disk; a fixture added without a test, or a test whose fixture went missing,
// fails here by set equality. Stray non-.json files throw in namesOnDisk.

final class FixtureCoverageTests: XCTestCase {
    /// Every wire fixture WireSnapshotTests pins (each name appears in exactly one
    /// pinClientFrame/pinServerFrame call there).
    private static let pinnedWire: Set<String> = [
        "hello", "hello-minimal",
        "placeLetter", "clearCell", "moveCursor", "react",
        "checkPuzzle", "heartbeat", "requestSync",
        "welcome", "sync", "sync-completed",
        "cellSet", "cellSet-clear", "cellSet-firstFill",
        "gameCompleted", "puzzleChecked", "gameAbandoned",
        "playerConnected", "playerDisconnected", "cursor", "reaction", "kicked",
        "error-nonfatal", "error-fatal",
    ]

    /// Every REST fixture RESTSnapshotTests pins.
    private static let pinnedRest: Set<String> = [
        "error-envelope",
        "puzzle-view", "puzzles-list",
        "create-game-request", "create-game-request-minimal", "create-game-response",
        "games-list", "join-request", "membership-response", "role-request",
        "kick-response", "abandon-response", "game-view",
        "share-link-response",
        "analysis-view", "analysis-view-null-moments",
        "delete-account-response",
    ]

    func test_everyCheckedInWireFixtureIsPinnedByASnapshotTest() throws {
        XCTAssertEqual(try FixtureLayout.namesOnDisk(.wire), Self.pinnedWire)
    }

    func test_everyCheckedInRESTFixtureIsPinnedByASnapshotTest() throws {
        XCTAssertEqual(try FixtureLayout.namesOnDisk(.rest), Self.pinnedRest)
    }
}
