package crossy.protocol

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

// Strict on purpose (the vector runner's ethos: skipping silently is forbidden). Every checked-in
// fixture must be pinned by a snapshot test, and every pinned name must exist on disk; a fixture
// added without a test, or a test whose fixture went missing, fails here by set equality. Stray
// non-.json files throw in namesOnDisk. Twin of apps/ios FixtureCoverageTests.swift.

class FixtureCoverageTests {
    // Every wire fixture WireSnapshotTests pins (each appears in exactly one pin*Frame call there).
    private val pinnedWire = setOf(
        "hello", "hello-minimal",
        "placeLetter", "clearCell", "moveCursor", "react", "checkPuzzle", "heartbeat", "requestSync",
        "welcome", "sync", "sync-completed",
        "cellSet", "cellSet-clear", "cellSet-firstFill",
        "gameCompleted", "puzzleChecked", "gameAbandoned",
        "playerConnected", "playerDisconnected", "cursor", "reaction", "kicked",
        "error-nonfatal", "error-fatal",
    )

    // Every REST fixture RestSnapshotTests pins.
    private val pinnedRest = setOf(
        "error-envelope",
        "puzzle-view", "puzzles-list",
        "create-game-request", "create-game-request-minimal", "create-game-response",
        "games-list", "join-request", "membership-response", "role-request",
        "kick-response", "abandon-response", "game-view",
        "analysis-view", "analysis-view-null-moments",
        "delete-account-response",
        "me-response",
    )

    @Test
    fun everyCheckedInWireFixtureIsPinnedByASnapshotTest() {
        assertEquals(pinnedWire, Fixtures.namesOnDisk(FixtureGroup.WIRE))
    }

    @Test
    fun everyCheckedInRESTFixtureIsPinnedByASnapshotTest() {
        assertEquals(pinnedRest, Fixtures.namesOnDisk(FixtureGroup.REST))
    }
}
