//
//  RoomMapping.swift
//  Crossy
//
//  The solution-stripped ClientPuzzle-to-render-shape mapping. This lives in the
//  composition root by the pinned ruling: CrossyUI keeps importing only CrossyStore
//  and CrossyDesign (AD-2), so the map from the CrossyProtocol REST twin to CrossyUI's
//  GridPuzzle/ClueBook cannot live in the view ring, and it must not go in a package
//  that would put CrossyProtocol on CrossyUI's import list. The app target sees both,
//  so it owns the translation, exactly as DemoRoom owns its fixture's numbering scan.
//
//  INV-6 rides through untouched: the input is ClientPuzzle (no solution field, by
//  type), and GridPuzzle/ClueBook define no solution-shaped field, so nothing here can
//  carry a solution even by accident.
//

import CrossyProtocol
import CrossyStore
import CrossyUI
import Foundation

enum RoomMapping {
    /// Map a `GameView`'s solution-stripped puzzle to the room's render shapes.
    static func map(_ view: GameView) -> (puzzle: GridPuzzle, clues: ClueBook) {
        map(view.puzzle)
    }

    /// The REST view's membership as the store's roster seed (the app target owns the
    /// protocol-to-store translation, AD-2). The view carries the ROSTER, not presence:
    /// a `Member` names who belongs (`userId`, `role`, `avatarUrl`), but liveness is the
    /// socket's to report, so each seeded participant holds the not-yet-heard-from state
    /// (`connected: false`) until the `welcome` speaks the live roster (GameStore
    /// .seedRoster). The `displayName` and `color` the wire's `Participant` carries are
    /// the welcome's to supply (the REST membership row does not carry them); the seed
    /// leaves them blank, so a puck stands at true count and register from frame one and
    /// its initial and color land the instant the welcome rebuilds the roster. An empty
    /// wire color still resolves to a stable per-user color (GridPresence.rosterColor's
    /// hash fallback), so a seeded puck is never colorless.
    static func roster(_ view: GameView) -> [Participant] {
        view.members.map {
            Participant(
                userId: $0.userId, displayName: "", avatarUrl: $0.avatarUrl,
                color: "", role: $0.role, connected: false)
        }
    }

    /// The ClientPuzzle mapping proper. Clue numbering derives from the clue starts
    /// the document already carries (each clue's first cell numbers, and an across and
    /// a down clue starting in the same cell share the number by crossword
    /// construction, GridPuzzle.numbering's rule). Cells are the clues' own
    /// `cellIndices` in reading order; the jump target is the first.
    static func map(_ puzzle: ClientPuzzle) -> (puzzle: GridPuzzle, clues: ClueBook) {
        let across = puzzle.clues.across
        let down = puzzle.clues.down

        var starts: [(number: Int, cell: Int)] = []
        for clue in across + down {
            if let first = clue.cellIndices.first {
                starts.append((clue.number, first))
            }
        }

        let grid = GridPuzzle(
            rows: puzzle.rows,
            cols: puzzle.cols,
            blocks: Set(puzzle.blocks),
            circles: Set(puzzle.circles),
            shadedCircles: Set(puzzle.shadedCircles ?? []),
            numbers: GridPuzzle.numbering(from: starts))

        let book = ClueBook(
            across: across.map { entry($0, isAcross: true) },
            down: down.map { entry($0, isAcross: false) })

        return (grid, book)
    }

    /// One wire clue to its render entry, threading the clue-formatting runs through
    /// (owner ruling 2026-07-12). The wire `ClueRun`s map to CrossyUI's `ClueTextRun`s,
    /// unknown style strings dropped by `ClueTextRun(text:wireStyles:)` (forward
    /// compatibility). A clue with no runs keeps `runs: nil`, so its bar and browser rows
    /// render plain, exactly as before this wave. The runs' text concatenates to `$0.text`
    /// (the server's guarantee), so `text` stays the fallback the entry always carries.
    private static func entry(_ clue: Clue, isAcross: Bool) -> ClueEntry {
        ClueEntry(
            number: clue.number, text: clue.text, cells: clue.cellIndices, isAcross: isAcross,
            runs: clue.runs?.map { ClueTextRun(text: $0.t, wireStyles: $0.s) })
    }

    /// The WebSocket dial URL for this game (PROTOCOL.md §2:
    /// `wss://{session-host}/games/{gameId}/ws`). The server hands the endpoint back on
    /// the view (`session.ws`), so that is authoritative and used verbatim when it
    /// parses as an absolute ws/wss URL. The injected session base is the fallback used
    /// only if the server's endpoint is unusable, constructing the §2 path from it, so
    /// the configured base never silently overrides the server's own answer.
    static func socketURL(from view: GameView, sessionBaseURL: URL) -> URL? {
        if let served = URL(string: view.session.ws), isWebSocketURL(served) {
            return served
        }
        return sessionBaseURL
            .appendingPathComponent("games")
            .appendingPathComponent(view.gameId)
            .appendingPathComponent("ws")
    }

    private static func isWebSocketURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        return (scheme == "ws" || scheme == "wss") && url.host != nil
    }
}
