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

    /// The TAPPED CARD's member stack as the store's roster seed (the seeded-birth
    /// rule, DESIGN.md §4, §12): a card-tap arrival records the row's true members and
    /// seeds the store at construction, BEFORE the REST fetch, so the players pill
    /// stands identity-true from the push's first frame and the goo plays on live
    /// data. Unlike the REST-view seed above, the list row carries the resolved
    /// `name`, so this seed carries the TRUE display name (and avatarUrl and role) from
    /// the wire, not a blank waiting for the welcome. Liveness is still the socket's to
    /// report, so each seeded participant holds `connected: false` (not-yet-heard-from,
    /// the same register an away member carries); the `welcome` stays the authority and
    /// rebuilds `participants` wholesale when it lands, and GameStore.seedRoster gates
    /// to `connecting`, so this can never overwrite real presence. `color` is blank (the
    /// list row carries no roster color; GridPresence.rosterColor's hash fallback
    /// resolves a stable per-user color from the id, so a seeded puck is never
    /// colorless). The role folds back from the card's two flags: host, then spectator,
    /// else solver, so the solvers-only pill filter (RosterList.cluster) applies to the
    /// seed identically and a spectator seat seeds the store but never widens the pill.
    static func roster(cardMembers: [RoomCardMember]) -> [Participant] {
        cardMembers.map { member in
            let role: Role = member.isHost ? .host : (member.isSpectator ? .spectator : .solver)
            return Participant(
                userId: member.userId, displayName: member.name,
                avatarUrl: member.avatarUrl, color: "", role: role, connected: false)
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
            across: across.map {
                ClueEntry(number: $0.number, text: $0.text, cells: $0.cellIndices, isAcross: true)
            },
            down: down.map {
                ClueEntry(number: $0.number, text: $0.text, cells: $0.cellIndices, isAcross: false)
            })

        return (grid, book)
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
