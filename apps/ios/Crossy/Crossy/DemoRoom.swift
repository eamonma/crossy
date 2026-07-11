//
//  DemoRoom.swift
//  Crossy
//
//  The fixture room the solve screen runs against with no network, wired exactly
//  as the real room will be (ARCHITECTURE.md §7: the store is pure over an
//  injected transport, so the room runs anywhere). The app target is the
//  composition root (AD-2), so the wiring lives here: a welcome fixture, a
//  loopback transport that echoes every mutation as its sequenced cellSet (echo
//  clears the overlay, INV-10), and a GameStore consuming it through the one
//  mailbox. I2c grew the chrome around this shape; I3 swaps only the transport.
//
//  Launch-argument scripts (the SP-i2 precedent; simctl cannot synthesize touch):
//    -i2bScript             type DAS into 1-Across (-i2bRebus opens the field)
//    -i2cScript             Bee's cursor patrols the board (presence, glints)
//    -i2cBrowser            land the clue browser open
//    -i2cWord 2             advance the selection two words from 1-Across (the
//                           wrapped-clue-bar evidence; simctl cannot tap)
//    -i2cClueCycle          walk the across words on a loop so the bar cycles
//                           one, two, and three lines (the full-bleed proof:
//                           the bar breathes, the board never moves)
//    -i2cMelt 0.5           hold the melt at a progress (intermediate evidence)
//    -i2cFacts              land the room-facts card open (the time pill,
//                           inflated; simctl cannot tap, the presentBrowser
//                           pattern). Mid-solve the card carries the §12
//                           operations (redesign 2026-07-11, the popover
//                           retired); -i2cSpectator drops the host's end-game
//    (share ships as the native menu, owner ruling 2026-07-11: the share pill
//     presents a system Menu, so it cannot be scripted open; tap it on device)
//    -gooMetaball           the facts card's SHIPPING DEFAULT on iOS 26 (the
//                           system's materialize swap in a GlassEffectContainer,
//                           the MorphLab variant-A goo); reachable as an
//                           explicit no-op. Below 26 the clean melt renders
//    -gooClean              override the default: the facts card opens on the
//                           clean frame-interpolation walk (the below-26 law)
//    -gooOvershoot          override the default: the facts card opens on the
//                           underdamped inflation curve, a hair past the frame
//                           and back; all compose with any -i2*/-demoRoom launch
//    -i2eSealedPill         complete the room, then pour the stats card back
//                           so the sealed terminal pill stands alone (the
//                           redesign's terminal register; simctl cannot tap)
//    -i2cRoster             land the roster panel open
//    -i2cWeather resyncing  force the breathing-dot state (a gapped event)
//    -i2cWeather reconnecting  force the dimmed room with the quiet countdown
//    -i2cSpectator          seat the local player as a spectator (Watching)
//    -i2dComplete           the room finishes the puzzle; gameCompleted follows
//                           (the mosaic plays, then the stats card)
//    -i2dAbandoned          the host ends the game (frozen board, one-line notice)
//    -i2dKicked             the kicked notice, then the terminal exit screen
//    -stress                extremes for chrome mockups (owner ask 2026-07-10):
//                           eleven people with long names, a room name that must
//                           truncate, an hours-old clock; composes with any -i2*
//

import CrossyProtocol
import CrossyStore
import CrossyUI
import Foundation

// MARK: - The room

@MainActor
final class DemoRoom {
    let store = GameStore()
    let puzzle: GridPuzzle
    let clues: ClueBook
    let roomName: String
    // The facts card's render params (SolveScreen): the wire carries no puzzle
    // metadata yet, so the fixture supplies plausible values; the wire hookup
    // is a follow-on.
    let puzzleTitle: String
    let puzzleAuthor: String
    let puzzleDate: String
    // The facts card's copy row needs an invite code in hand (PROTOCOL.md
    // §12: the room view carries it to any member). The fixture supplies a
    // read-aloud eight-character code so the row renders offline.
    let inviteCode = "TIDECOVE"
    // A fixture id so the share card (ShareInvite.url) also renders offline;
    // the demo transport never dials a real backend, so this id names nothing
    // real, exactly as the fixture's invite code does.
    let gameId = "demo-room"
    let selection: SelectionModel
    let chrome = RoomChromeModel()
    private let transport: LoopbackTransport

    init() {
        let arguments = ProcessInfo.processInfo.arguments
        let spectating = arguments.contains("-i2cSpectator")
        let stress = arguments.contains("-stress")
        let fixture = DemoFixture.mini9(
            selfRole: spectating ? .spectator : .host, stress: stress)
        // Long enough that the facts card's label must truncate honestly
        // (-stress).
        roomName =
            stress
            ? "The Sunday Extravaganza and Occasional Tuesday Society"
            : "Tuesday evening"
        puzzleTitle =
            stress
            ? "The Omnibus of Considerable Length and Unreasonable Ambition"
            : "Midsummer Crossings"
        puzzleAuthor = stress ? "Wilhelmina Geraldine Fitzwilliam" : "Wren Ellery"
        puzzleDate = "July 8, 2026"
        puzzle = fixture.puzzle
        clues = fixture.clues
        transport = LoopbackTransport(welcome: fixture.welcome)
        selection = SelectionModel(store: store, puzzle: puzzle)
    }

    /// Connect (the welcome arrives through the stream like every other frame) and
    /// run the store's mailbox until the transport closes.
    func run() async {
        try? await transport.connect()
        async let mailbox: Void = store.run(transport)
        await script()
        await mailbox
    }

    private func script() async {
        let arguments = ProcessInfo.processInfo.arguments
        try? await Task.sleep(for: .milliseconds(400))  // let the welcome land

        if let index = arguments.firstIndex(of: "-i2cWord"),
            arguments.indices.contains(index + 1),
            let steps = Int(arguments[index + 1])
        {
            // Land the bar on a chosen word with no gesture (the presentBrowser
            // precedent): the wrapped bar's evidence needs the long fixture
            // clues selected, and simctl cannot tap.
            for _ in 0..<max(steps, 0) {
                selection.swipe(.nextWord)
            }
        }

        if arguments.contains("-i2bScript") {
            // The cursor opens on 1-Across (first playable, across); type the real
            // opening letters of DASH so the scripted fill lands correct on the grid.
            for character in "DAS" {
                selection.press(.letter(character))
                try? await Task.sleep(for: .milliseconds(120))
            }
            if arguments.contains("-i2bRebus") {
                selection.press(.rebus)
                for character in "HEART" {
                    selection.press(.letter(character))
                    try? await Task.sleep(for: .milliseconds(80))
                }
            }
        }

        if let index = arguments.firstIndex(of: "-i2cWeather") {
            let state = arguments.indices.contains(index + 1) ? arguments[index + 1] : ""
            switch state {
            case "resyncing":
                // A gapped seq: the store sends requestSync and holds resyncing
                // (the loopback never answers one, exactly what we want here).
                await transport.deliver(
                    .cellSet(
                        CellSetMessage(
                            seq: store.seq + 5, cell: 18, value: "N",
                            by: "bee", commandId: "demo-gap", at: DemoFixture.isoNow())))
            case "reconnecting":
                // The transport drop path, minus the socket: the store dims the
                // room; the countdown deadline is the composition root's to set
                // (in production the session adapter schedules the dial).
                store.connectionLost()
                chrome.reconnectRetryAt = Date.now.addingTimeInterval(9)
            default:
                break
            }
        }

        if arguments.contains("-i2cBrowser") {
            chrome.presentBrowser()
        }
        if arguments.contains("-i2cFacts") {
            // The one facts surface (redesign 2026-07-11): mid-solve the card
            // lands open with the §12 operation rows; the -i2eFactsPopover
            // flag retired with the popover it raised.
            chrome.presentFacts()
        }
        // (-i2fShare retired with the share morph card: share is a system
        // Menu now, and a system presentation cannot be scripted open, the
        // same reasoning that retired -i2cRoster.)
        if let index = arguments.firstIndex(of: "-i2cMelt"),
            arguments.indices.contains(index + 1),
            let progress = Double(arguments[index + 1])
        {
            // A held mid-melt frame: the SP-i1 evidence pattern (live glass at
            // intermediate geometry), since simctl cannot scrub a finger.
            chrome.meltProgress = min(max(progress, 0), 1)
        }
        // (-i2cRoster retired with the custom roster panel: the roster is a
        // system Menu now, and a system presentation cannot be scripted.)

        if arguments.contains("-i2cScript") {
            // Bee patrols: up her column (2-Down, ARGUE), then back down and across
            // her own word (7-Across, SOUND: cells 15-19), so presence marks move on
            // the board and her glint crosses the clue bar when she enters the word
            // it shows.
            let patrol = [17, 12, 7, 2, 7, 12, 17, 18, 19, 18, 17]
            for cell in patrol {
                await transport.deliver(
                    .cursor(CursorMessage(userId: "bee", cell: cell, direction: .across)))
                try? await Task.sleep(for: .milliseconds(900))
            }
        }

        if arguments.contains("-i2dComplete") || arguments.contains("-i2eSealedPill") {
            // The room finishes the puzzle: every empty playable cell fills as a
            // sequenced cellSet attributed by region (you, Bee, Ada), then the
            // server notices completion (INV-3: the event drives the store's one
            // transition; the celebration derives from it, never from render).
            try? await Task.sleep(for: .milliseconds(400))
            var seq = store.seq
            for cell in 0..<puzzle.cellCount
            where !puzzle.blocks.contains(cell) && store.renderValue(cell) == nil {
                // Each empty cell fills with its real solution letter, attributed by
                // region (you up top, Bee the middle band, Ada the foot), so the room
                // finishes on the verified fill, not filler.
                guard let value = DemoFixture.miniSolution[cell] else { continue }
                let row = cell / puzzle.cols
                let by = row < 2 ? "you" : row < 3 ? "bee" : "ada"
                seq += 1
                await transport.deliver(
                    .cellSet(
                        CellSetMessage(
                            seq: seq, cell: cell, value: value,
                            by: by, commandId: "demo-i2d-\(cell)",
                            at: DemoFixture.isoNow())))
            }
            try? await Task.sleep(for: .milliseconds(1600))
            seq += 1
            // Stats as the actor would stamp them: solveTimeSeconds from the same
            // timestamps the ambient clock reads, so the frozen bar clock and the
            // card's headline agree (PROTOCOL.md §6).
            let origin =
                store.firstFillAt.flatMap { try? Date($0, strategy: .iso8601) } ?? Date()
            await transport.deliver(
                .gameCompleted(
                    GameCompletedMessage(
                        seq: seq, at: DemoFixture.isoNow(),
                        stats: Stats(
                            solveTimeSeconds: max(0, Int(Date().timeIntervalSince(origin))),
                            totalEvents: arguments.contains("-stress") ? 1284 : 143,
                            participantCount: store.participants.count))))
            if arguments.contains("-i2eSealedPill") {
                // The terminal pill at rest (redesign 2026-07-11): let the
                // mosaic and the auto-summoned stats card play out, then pour
                // the card back without a walk so the sealed pill stands for
                // a screenshot (simctl cannot tap the card away).
                try? await Task.sleep(for: .milliseconds(3400))
                chrome.settleFacts(open: false, animated: false)
            }
        }

        if arguments.contains("-i2dAbandoned") {
            // The host ends the game: the board freezes with the one-line notice.
            try? await Task.sleep(for: .milliseconds(600))
            await transport.deliver(
                .gameAbandoned(
                    GameAbandonedMessage(
                        seq: store.seq + 1, at: DemoFixture.isoNow(), by: "you")))
        }

        if arguments.contains("-i2dKicked") {
            // The wire notice (the store deliberately ignores the frame; the 1008
            // close follows in production), then the rendering flag, exactly as
            // the I3 session driver will set it (RoomChromeModel.kicked).
            try? await Task.sleep(for: .milliseconds(800))
            await transport.deliver(.kicked(KickedMessage(reason: "kicked")))
            chrome.kicked = true
        }

        if arguments.contains("-i2cClueCycle") {
            // The breathing proof (the full-bleed ruling, owner ask 2026-07-10):
            // the selection walks the across words on a loop, so the bar cycles
            // one, two, and three lines while the board holds still under it.
            // A hand on the device and a screenshot pair read the same fact:
            // clue length never moves the grid. Last, because it never returns;
            // it composes with the one-shot scripts above.
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(1400))
                selection.swipe(.nextWord)
            }
        }
    }
}

// MARK: - The fixture

enum DemoFixture {
    /// An original, fully-solvable 5x5 mini (two symmetric corner blocks), one
    /// teammate mid-solve (Bee wrote the start of 7-Across and parks her cursor in
    /// it), one away member so the roster shows presence, and everything else open
    /// for typing. The grid is fully checked: every white cell sits in both an across
    /// and a down word, and it solves to a real, verified fill (`miniSolution`). Wire
    /// colors are roster values (apps/ios/DESIGN.md §3); the wire is authoritative
    /// for slotting.
    ///
    /// Solution (# is a block):
    ///     # D A S H
    ///     F O R C E
    ///     A N G E L
    ///     S O U N D
    ///     T R E E #
    static func mini9(selfRole: Role = .host, stress: Bool = false) -> (puzzle: GridPuzzle, clues: ClueBook, welcome: WelcomeMessage) {
        let rows = 5
        let cols = 5
        let blocks: Set<Int> = [0, 24]  // 180-degree symmetric corners

        // Standard numbering scan: a playable cell numbers when it starts an
        // across or a down run (the ingested-clue mapping arrives with I3).
        var starts: [(number: Int, cell: Int)] = []
        var acrossRuns: [(number: Int, cells: [Int])] = []
        var downRuns: [(number: Int, cells: [Int])] = []
        var next = 1
        for cell in 0..<(rows * cols) where !blocks.contains(cell) {
            let row = cell / cols
            let col = cell % cols
            let startsAcross = col == 0 || blocks.contains(cell - 1)
            let startsDown = row == 0 || blocks.contains(cell - cols)
            guard startsAcross || startsDown else { continue }
            starts.append((next, cell))
            if startsAcross {
                var run: [Int] = []
                var cursor = cell
                while cursor / cols == row, !blocks.contains(cursor) {
                    run.append(cursor)
                    cursor += 1
                    if cursor % cols == 0 { break }
                }
                acrossRuns.append((next, run))
            }
            if startsDown {
                var run: [Int] = []
                var cursor = cell
                while cursor < rows * cols, !blocks.contains(cursor) {
                    run.append(cursor)
                    cursor += cols
                }
                downRuns.append((next, run))
            }
            next += 1
        }

        let puzzle = GridPuzzle(
            rows: rows, cols: cols,
            blocks: blocks,
            circles: [12],  // the center cell (the G at the heart of the grid)
            numbers: GridPuzzle.numbering(from: starts))

        let clues = ClueBook(
            across: zip(acrossRuns, acrossTexts).map { run, text in
                ClueEntry(number: run.number, text: text, cells: run.cells, isAcross: true)
            },
            down: zip(downRuns, downTexts).map { run, text in
                ClueEntry(number: run.number, text: text, cells: run.cells, isAcross: false)
            })

        // Bee's opening: the first three letters of 7-Across (SOUND -> S, O, U), the
        // correct letters of the real solution. Her cursor parks on the next cell.
        let fills: [Int: String] = [15: "S", 16: "O", 17: "U"]
        let cells: [CrossyProtocol.Cell] = (0..<(rows * cols)).map { cell in
            guard let value = fills[cell] else { return Cell(v: nil, by: nil) }
            return Cell(v: value, by: "bee")
        }

        let welcome = WelcomeMessage(
            protocolVersion: 1,
            selfIdentity: WelcomeMessage.SelfIdentity(userId: "you", role: selfRole),
            board: Board(
                seq: fills.count,
                status: .ongoing,
                // A believable ambient clock (ID-2): the room's first fill landed
                // a little over twelve minutes ago; under -stress, hours ago, so
                // the clock and the stats headline carry an hours-wide time.
                firstFillAt: iso(secondsAgo: stress ? 11_954 : 754),
                completedAt: nil,
                abandonedAt: nil,
                cells: cells,
                participants: participants(selfRole: selfRole, stress: stress),
                cursors: [Cursor(userId: "bee", cell: 18, direction: .across)],
                recentCommandIds: [],
                stats: nil))
        return (puzzle, clues, welcome)
    }

    /// The room's people. The plain trio matches I2's screenshots; -stress is
    /// the extremes pass (owner ask 2026-07-10): eleven people, long Discord
    /// names that must truncate in roster rows, a mix of connection states, so
    /// the pills' overflow count, the panel's height clamp, and every name slot
    /// get exercised before real rooms do it in production.
    private static func participants(selfRole: Role, stress: Bool) -> [Participant] {
        // Two members carry a fixture avatar (a bundled data URL, no network), so the
        // loopback room proves the layering offline: Bee is connected, so her image
        // draws over the initial at full strength, and Ada is away, so hers draws
        // under the same 0.35 dim the puck applies (PROTOCOL.md §4: the image inherits
        // the ring and the away dim). You keeps a null avatar, so its puck stays the
        // initial, the null-first-class case beside the two images.
        let core = [
            Participant(
                userId: "you", displayName: "You", avatarUrl: nil, color: "#6F66D4",
                role: selfRole, connected: true),
            Participant(
                userId: "bee", displayName: "Bee", avatarUrl: fixtureAvatarBee,
                color: "#17917F",
                role: selfRole == .host ? .solver : .host, connected: true),
            Participant(
                userId: "ada", displayName: "Ada", avatarUrl: fixtureAvatarAda,
                color: "#DE5722",
                role: .solver, connected: false),
        ]
        guard stress else { return core }
        let extras: [(String, String, String, Bool)] = [
            ("bartholomew", "bartholomew-the-unhurried", "#4C8DE8", true),
            ("anastasia", "Anastasia Wintergreen-Bellweather III", "#C2498D", true),
            ("gus", "gus", "#7A9B3E", false),
            ("percy", "PercyPuzzlesProfessionally", "#D9A036", true),
            ("mo", "mo & the marginalia", "#5B5F97", true),
            ("henrietta", "henrietta.of.the.long.crossings", "#3FA7A3", false),
            ("kit", "Kit", "#B0563A", true),
            ("wilhelmina", "wilhelmina_geraldine_fitzwilliam", "#8A6FC8", true),
        ]
        return core
            + extras.map {
                Participant(
                    userId: $0.0, displayName: $0.1, color: $0.2,
                    role: .solver, connected: $0.3)
            }
    }

    // MARK: Fixture avatars (bundled data URLs, not network fetches)

    /// Two small PNGs inlined as `data:` URLs, so the loopback room renders real
    /// avatar images with no server and no network (the same opaque-url path a
    /// production https url takes through URLSession, PROTOCOL.md §4). Distinct from
    /// the plain-color initial pucks on purpose, so a device screenshot proves the
    /// image layered over the initial rather than the initial alone. Bee is a cool
    /// geometric mark; Ada a warm two-tone disc.
    private static let fixtureAvatarBee =
        "data:image/png;base64,"
        + "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAAD4/042AAACg0lEQVRoBe1ZOUsDURCemKDEQoMHhoBBbTQaQRQRSy9QtLKwsLCw1MbO32Angq2FhYWCnSgI/gAlIigGGxUFiXgQLZRIPPIFEjYaZea93Y2BHViSze77jnnH7ry4WgZnPqmIo6SItaelOwYK3YNODxS6BzxWCTjeXsiBbh+Zzzk368QZQmZlUhWn6HvA1DlQ2RSg6lADVTT4fyS0Y3acni9j9BC9pKfzmx/XVX/QN+Ai8neHKNjfReU1vl91+BoDhCPY10kv93G62otQ7CBKpPkio2XAW+uj0OQQVdTX/So83wUYbZkYoEBvmKJru/R6F893G+s35TlQ1RykrrkJsXijKhgHBrBUQ8kACMPTo+QpK1XlzbYDBrBUTYgNYNi0Tg1TidudFaH7BVjABLY0ZAZSExZj3ozMfxcKTGBTikMSIgNYbaQTViIG2OCQhMgAlkqrQ8rBNoCH1F/rvFnGwAEubrAN4AlrV0i42AbyvR5YZUjCxTZgx/DJJETCxTbg8ZZl8C3/lHCxDViuWpGAbSD5mlCkkDeTcLEN4BXYrpBwsQ2gGLErJFxsAyim7AoJF9sAykBJ16qaBYek5GQbgCCUgVaHlENkADXs8/WtZR6Ana6TBQwiAyjAUcMmE28CCt6twAS2tMiXGUhpQQF+urpDH+/vPGWMu4AFTJXiXmwAeh7PruhkZcuUnkDmgQVMlVAykDERWVzXmhMY88BQFQ8dWvtC6PLDpQ3WxpYxu1gq/8XGVlpUamLH9qPpI2drsa3eqJniFzf/dGvRIBMPoOxDaKzHcIXoaHkz59ysE+U5YJYAXRzHgG4Gddu7nH/qdVOo2d6ZA5oJ1G7u9IB2CjUBvgCsasbF2M4EWAAAAABJRU5ErkJggg=="
    private static let fixtureAvatarAda =
        "data:image/png;base64,"
        + "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAADhlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAAqACAAQAAAABAAAAMKADAAQAAAABAAAAMAAAAAD4/042AAADVUlEQVRoBe1YbUsUURg9M7vjrrujub6QYGBaKlHmlygoev8QFES/NCIo8EPvFBR9MYtQSxMSDF9203HddXZmmzNZLKHeO/deXYTOp2Xuc895zt17n3nuWP78/ToOMexDnHucetqkgSAI8PHDDD5NTGNu9jvW17yYvq3dxcDgMZweG8aZs0NIpVLGZC1TW2hyYgqPHjzDynJpz+S6ujtw5951jI6N7BknO6htIAzrePzwOV48eSurGcddvXkBt+9eg21bieb9G6x9BlSSZxI0zLm60DLAbZN05RsT5lxy6EDZAA8s97wuyEEuVSgbYLURHViZpMhBLlUoG2CpNAUdLmUDrPOmoMOlbODPS8qECR0uZQMmEjfBoWyA7YEp6HApG2BvYwo6XMoG2JiZgg6XsgF2lWzMdEEOcqlC2QBbYnaVuiCHTnutdR9gS8yukj1NTy6D4x0uet0sCq0tcFscOPbv9fHDEN6Wj+LmFha9Cr6VPCyVq/Fc3bZaq50Oo6Q2pmexMjmFTD3ZzbRqWegaHUF+eBB2ZFYVSgbq0YoycS9KvO7XVLXjeZaThrttxNr+x5IQJjYQbJRRfP0e/nIxiY4w1ukuoHDpHFL5nDC2MSDRIfaLP7E8/tJ48kyICxJzRxpJIG2gtr6B1advEFaqSfgTxZKbGtSShZSBenThKL56h7C6JcurHEcNalFTBlIGvM9fUCutyfAZiaEWNWUgNBD6UamUJJMRlI2hJrVFEBqozC9ol0pREjuNszxTWwSxgYUfIo59G69IaAsNsHQ2CzUJbaGB/SybooUJJEq20IBIpNnjQgN2NtO0HFMS2kIDTuFI0wykJbSFBrJ9R5tmQEZbbKC/D2x5DxrUzEbaIggN2I6D/KmTIh7j49SktghCAyRwI7J0R7uIy9g4tagpAykDVnSBL1w+DzvTIsOpFUMNalFTBlIGSJRuy6PzxkXsZ1klNzWoJQtpAyRkSe2+dQW8/pkGOWNuidLZqJ34TszJh/pS3+ien1XKM3Mof51H4JUbh4S/U24OuRP9yA0NHPxnlZ2y81dLqC4uxZfz2rqHYLPy9x7Bmp5qzUZ72423X6a3B06n/mdJ5mHsDcWETCW10wLt9izRId6NpJnP/xto5upT+xcTfkuxPz1lPgAAAABJRU5ErkJggg=="

    static func isoNow() -> String {
        Date().ISO8601Format()
    }

    private static func iso(secondsAgo: TimeInterval) -> String {
        Date(timeIntervalSinceNow: -secondsAgo).ISO8601Format()
    }

    /// The verified solution by cell (the demo's local answer key, fixture data only,
    /// never a field on GridPuzzle or the wire ClientPuzzle, so INV-6 holds). The
    /// completion script writes these exact letters, so the room finishes on the real
    /// fill rather than filler.
    ///     # D A S H
    ///     F O R C E
    ///     A N G E L
    ///     S O U N D
    ///     T R E E #
    static let miniSolution: [Int: String] = [
        1: "D", 2: "A", 3: "S", 4: "H", 5: "F",
        6: "O", 7: "R", 8: "C", 9: "E", 10: "A",
        11: "N", 12: "G", 13: "E", 14: "L", 15: "S",
        16: "O", 17: "U", 18: "N", 19: "D", 20: "T",
        21: "R", 22: "E", 23: "E",
    ]

    /// Fixture clue prose, warm and plain (ID-5), one per run in scan order. The
    /// answers, across then down: DASH, FORCE, ANGEL, SOUND, TREE / DONOR, ARGUE,
    /// SCENE, HELD, FAST. One across clue runs long on purpose (the ClueFitLab
    /// corpus's honest lengths): the bar must still wrap it and a fixture screenshot
    /// must land on it (-i2cWord, -i2cClueCycle).
    private static let acrossTexts = [
        "Quick run for the door",  // DASH
        "Push with everything you have",  // FORCE
        "The one who leaves the porch light on and waits up",  // ANGEL
        "What a full room makes",  // SOUND
        "It holds the swing and the shade all summer",  // TREE
    ]

    private static let downTexts = [
        "Giver, no strings",  // DONOR
        "Talk in circles at the dinner table",  // ARGUE
        "The part of the play you remember after",  // SCENE
        "Kept close a good while",  // HELD
        "Quick, or going without breakfast",  // FAST
    ]
}

// MARK: - The loopback transport

/// The scripted transport (ARCHITECTURE.md §7): yields the welcome on connect and
/// echoes every mutation as the next sequenced cellSet, so the optimistic overlay
/// clears through the same path production will use. Ephemeral frames (moveCursor,
/// heartbeat) vanish exactly as a serverless room would swallow them; requestSync
/// never fires because the loopback cannot gap, except when a demo script gaps it
/// on purpose. `deliver` lets scripts speak as the room (teammate cursors, forced
/// gaps).
actor LoopbackTransport: Transport {
    nonisolated let inbound: AsyncStream<ServerMessage>
    private let deliveries: AsyncStream<ServerMessage>.Continuation

    private let welcome: WelcomeMessage
    private let selfUserId: String
    private var seq: Int
    private var firstFillAt: String?

    init(welcome: WelcomeMessage) {
        self.welcome = welcome
        self.selfUserId = welcome.selfIdentity.userId
        self.seq = welcome.board.seq
        self.firstFillAt = welcome.board.firstFillAt
        (inbound, deliveries) = AsyncStream.makeStream()
    }

    func connect() async throws {
        deliveries.yield(.welcome(welcome))
    }

    /// A scripted frame from "the room": teammate cursors, forced gaps.
    func deliver(_ message: ServerMessage) {
        deliveries.yield(message)
    }

    func send(_ message: ClientMessage) async {
        switch message {
        case .placeLetter(let place):
            seq += 1
            var establishing: String?
            if firstFillAt == nil {
                firstFillAt = Self.now()
                establishing = firstFillAt
            }
            deliveries.yield(
                .cellSet(
                    CellSetMessage(
                        seq: seq, cell: place.cell, value: place.value,
                        by: selfUserId, commandId: place.commandId, at: Self.now(),
                        firstFillAt: establishing)))
        case .clearCell(let clear):
            seq += 1
            deliveries.yield(
                .cellSet(
                    CellSetMessage(
                        seq: seq, cell: clear.cell, value: nil,
                        by: selfUserId, commandId: clear.commandId, at: Self.now())))
        case .hello, .moveCursor, .checkRequest, .heartbeat, .requestSync:
            break
        }
    }

    func close() async {
        deliveries.finish()
    }

    private static func now() -> String {
        Date().ISO8601Format()
    }
}
