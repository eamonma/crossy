import Foundation
import XCTest

import CrossyProtocol

// INV-6: solutions never leave the server, enforced structurally by the client puzzle
// type, never by runtime stripping. The Swift twin is stricter than the TS package: it
// defines no ServerPuzzle and no Solution type at all, so this suite proves the
// property three ways: the types' own stored properties (reflection), every serialized
// payload's keys, and a decode golden showing a solution-bearing document cannot even
// be represented. Twin of packages/protocol/src/inv6-no-solution-leak.test.ts.

final class INV6NoSolutionTests: XCTestCase {
    /// Fails if any label contains "solution" after ASCII-only lowercasing (INV-1: no
    /// locale-aware transform even inside a guard test).
    private func assertNoSolutionLabel(
        _ labels: [String], in what: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        for label in labels {
            let folded = String(
                decoding: label.utf8.map { $0 >= 0x41 && $0 <= 0x5A ? $0 + 0x20 : $0 },
                as: UTF8.self)
            XCTAssertFalse(
                folded.contains("solution"),
                "\(what) carries a solution-named member \"\(label)\" (INV-6)",
                file: file, line: line)
        }
    }

    func test_noClientFacingTypeCarriesASolutionStoredProperty_INV6() throws {
        // Reflection sweep over fully-populated decoded values of every payload family:
        // the wire messages (welcome carries the board), the game view (carries the
        // puzzle), and both list rows. A stored property named like a solution anywhere
        // in the object graph fails.
        for name in try FixtureLayout.namesOnDisk(.wire) {
            let data = try fixtureData(.wire, name)
            let value: Any
            if name.hasPrefix("hello") || ["placeLetter", "clearCell", "moveCursor", "react", "checkPuzzle", "heartbeat", "requestSync"].contains(name) {
                value = try JSONDecoder().decode(ClientMessage.self, from: data)
            } else {
                value = try JSONDecoder().decode(ServerMessage.self, from: data)
            }
            assertNoSolutionLabel(allStoredPropertyLabels(of: value), in: "wire/\(name)")
        }
        let gameView = try JSONDecoder().decode(GameView.self, from: fixtureData(.rest, "game-view"))
        assertNoSolutionLabel(allStoredPropertyLabels(of: gameView), in: "GameView")
        let puzzleView = try JSONDecoder().decode(
            PuzzleView.self, from: fixtureData(.rest, "puzzle-view"))
        assertNoSolutionLabel(allStoredPropertyLabels(of: puzzleView), in: "PuzzleView")
        let games = try JSONDecoder().decode(
            GamesListResponse.self, from: fixtureData(.rest, "games-list"))
        assertNoSolutionLabel(allStoredPropertyLabels(of: games), in: "GamesListResponse")
        let puzzles = try JSONDecoder().decode(
            PuzzlesListResponse.self, from: fixtureData(.rest, "puzzles-list"))
        assertNoSolutionLabel(allStoredPropertyLabels(of: puzzles), in: "PuzzlesListResponse")
    }

    func test_aSolutionBearingDocumentCannotBeRepresented_INV6() throws {
        // The twin of toClientPuzzle's golden, made structural: hand ClientPuzzle a
        // server-shaped document WITH a solution; the type has nowhere to put it, so
        // re-encoding proves the solution is gone by construction, not by stripping.
        let serverShaped = Data(
            #"""
            {
              "rows": 1,
              "cols": 2,
              "blocks": [1],
              "circles": [],
              "clues": {
                "across": [{ "number": 1, "text": "Feline pet", "cellIndices": [0] }],
                "down": []
              },
              "solution": ["CAT", null]
            }
            """#.utf8)
        let decoded = try JSONDecoder().decode(ClientPuzzle.self, from: serverShaped)
        let reencoded = try JSONEncoder().encode(decoded)
        let json = String(decoding: reencoded, as: UTF8.self)
        XCTAssertFalse(json.contains("solution"))
        XCTAssertFalse(json.contains("CAT"))
        XCTAssertTrue(json.contains("Feline pet"), "the client shape keeps geometry and clues")
    }

    func test_noSerializedClientPayloadContainsASolutionKey_INV6() throws {
        // Serialization golden over every checked-in fixture, re-encoded through the
        // typed twins where the INV-6 surface lives: no JSON object key anywhere may be
        // solution-named. (Values are user-visible content like error codes, e.g.
        // AMBIGUOUS_SOLUTION, and are not keys.)
        let gameView = try JSONDecoder().decode(GameView.self, from: fixtureData(.rest, "game-view"))
        let welcome = try JSONDecoder().decode(
            ServerMessage.self, from: fixtureData(.wire, "welcome"))
        for (what, value) in [("GameView", try JSONEncoder().encode(gameView)),
                              ("welcome", try JSONEncoder().encode(welcome))] {
            let keys = allJSONKeys(in: try JSONSerialization.jsonObject(with: value))
            assertNoSolutionLabel(keys, in: what)
        }
    }
}
