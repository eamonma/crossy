//
//  ArrivalModel.swift
//  Crossy
//
//  The arrival flow's composition (roadmap I3; AD-2: the app target is the
//  composition root, so the seams meet HERE). Three backends behind two small
//  protocols, resolved once at launch:
//
//    real      the committed config: AuthSession (Discord through Supabase, Keychain,
//              silent refresh) + CrossyAPIClient against production bases
//    injected  CROSSY_IT_TOKEN without a game id: the harness identity walks Rooms
//              against the local stack (real REST, no web-auth leg)
//    fixture   -i3Fixture: no network at all; instant sign-in, canned rooms, the
//              loopback DemoRoom behind every card (the owner walks the whole
//              journey on a device with nothing running)
//
//  The screens stay in CrossyUI and see plain models and closures only; the REST
//  twins and CrossyAPIError are digested to RoomsPage / ArrivalFailure here (the
//  RoomMapping precedent).
//

import CrossyAPI
import CrossyProtocol
import CrossyUI
import Foundation
import Observation

// MARK: - The seams

/// The auth side of arrival: a phase the routing reads, the sign-in intents the
/// Welcome screen fires, and the Account screen's identity reads and destructive
/// intents (sign out, delete). Implementations wrap an @Observable, so phase and
/// identity reads track in SwiftUI.
@MainActor
protocol ArrivalSessioning: AnyObject {
    var phase: AuthPhase { get }
    var tokenProvider: any BearerTokenProviding { get }
    /// The signed-in user id, for the Account screen's puck and roster color (display
    /// only; the token is the identity authority, DESIGN.md §8). nil before sign-in.
    var userId: String? { get }
    /// Which provider minted the standing session, for the Account screen's line; nil
    /// when none is remembered (a pre-marker session, or the harness).
    var authProvider: AuthProvider? { get }
    func signIn() async
    func signInWithApple() async
    /// The secondary methods behind "Continue another way" (roadmap I3b). Hisbaan rides
    /// the same ASWebAuth leg Discord does (a custom OIDC provider); the email pair is
    /// the two-step OTP grant, and completeMagicLink finishes a magic link a Universal
    /// Link delivered. All drive the same signed-in phase the primary buttons do, so the
    /// routing stays provider-blind. The two email calls surface errors so the sheet can
    /// render the inline reason; the send call does not change the phase (AuthSession
    /// contract).
    func continueWithHisbaan() async
    func sendEmailOTP(email: String) async throws
    func verifyEmailOTP(email: String, code: String) async throws
    func completeMagicLink(tokenHash: String, type: String) async throws
    func signOut() async
    /// Delete the account: the server-side `DELETE /account` then the local token
    /// purge. nil on success (routing lands at Welcome), a digested failure otherwise
    /// (the Account screen renders it inline, retryable). No local state is dropped
    /// unless the server confirmed the tombstone.
    func deleteAccount() async -> ArrivalFailure?
}

/// The rooms side: one page of cards, one join. Failures arrive pre-digested to the
/// stable-code shape the screens render (ArrivalFailure).
@MainActor
protocol RoomsProviding {
    func loadPage(before: String?) async -> Result<RoomsPage, ArrivalFailure>
    /// Join by code; success is the resolved gameId (PROTOCOL.md §12 /games/join).
    func join(code: String) async -> Result<String, ArrivalFailure>
}

/// The puzzles side: one page of the caller's uploads, plus starting a fresh game
/// from one (`POST /games`; the replay-without-reupload path the empty state points
/// at). Success is the created gameId, so the root pushes the room exactly as an
/// opened room card does.
@MainActor
protocol PuzzlesProviding {
    func loadPage(before: String?) async -> Result<PuzzlesPage, ArrivalFailure>
    func startGame(puzzleId: String) async -> Result<String, ArrivalFailure>
}

// MARK: - Real backend

/// The production session: AuthSession behind the protocol. Phase and identity reads
/// land on the @Observable AuthSession, so routing and the Account screen update
/// without forwarding. The API client rides here too, so account deletion is the
/// server call plus the local purge in one intent.
@MainActor
final class RealArrivalSession: ArrivalSessioning {
    private let auth: AuthSession
    private let api: CrossyAPIClient

    init(auth: AuthSession, api: CrossyAPIClient) {
        self.auth = auth
        self.api = api
        auth.restore()
    }

    var phase: AuthPhase { auth.phase }
    var tokenProvider: any BearerTokenProviding { auth }
    var userId: String? { auth.userId }
    var authProvider: AuthProvider? { auth.provider }
    func signIn() async { await auth.signIn(provider: .discord) }
    func signInWithApple() async { await auth.signInWithApple() }
    // The secondary methods forward straight to AuthSession (roadmap I3b): hisbaan is the
    // same web leg with its own provider value, the email pair is the OTP grant, and the
    // magic-link finisher is the link-verify grant. Each already drives the machine, so
    // these are pure passthroughs.
    func continueWithHisbaan() async { await auth.signIn(provider: .hisbaan) }
    func sendEmailOTP(email: String) async throws { try await auth.sendEmailOTP(email: email) }
    func verifyEmailOTP(email: String, code: String) async throws {
        try await auth.verifyEmailOTP(email: email, code: code)
    }
    func completeMagicLink(tokenHash: String, type: String) async throws {
        try await auth.completeMagicLink(tokenHash: tokenHash, type: type)
    }
    func signOut() async { await auth.signOut() }

    /// `DELETE /account` first; only on the server's confirmation do we purge local
    /// tokens (AuthSession.purgeForAccountDeletion), which drops the phase to signed
    /// out so routing lands at Welcome. A server or network failure leaves the session
    /// standing and returns the digested code for the inline sentence.
    func deleteAccount() async -> ArrivalFailure? {
        do {
            _ = try await api.deleteAccount()
            auth.purgeForAccountDeletion()
            return nil
        } catch {
            return ArrivalFailure(digesting: error)
        }
    }
}

/// The harness identity: an injected token is a standing session (the CROSSY_IT_*
/// pattern); Welcome never shows because the phase is signed in from launch.
@MainActor
final class InjectedArrivalSession: ArrivalSessioning {
    private let token: String

    init(token: String) {
        self.token = token
    }

    var phase: AuthPhase { .signedIn }
    var tokenProvider: any BearerTokenProviding { FixedBearerToken(token: token) }
    // The harness identity carries no display facts (it is a raw injected token), so
    // the Account affordance stays hidden on this path (RoomsScreen renders the puck
    // only when the composition supplies an identity).
    var userId: String? { nil }
    var authProvider: AuthProvider? { nil }
    func signIn() async {}
    func signInWithApple() async {}
    // The harness identity is already signed in from launch (Welcome never shows), so the
    // sign-in intents are no-ops, the secondary methods with them.
    func continueWithHisbaan() async {}
    func sendEmailOTP(email: String) async throws {}
    func verifyEmailOTP(email: String, code: String) async throws {}
    func completeMagicLink(tokenHash: String, type: String) async throws {}
    func signOut() async {}
    func deleteAccount() async -> ArrivalFailure? { nil }
}

/// Real rooms over the section 12 client. Mapping and error digestion only; the
/// client owns the wire.
@MainActor
struct RealRooms: RoomsProviding {
    let api: CrossyAPIClient

    func loadPage(before: String?) async -> Result<RoomsPage, ArrivalFailure> {
        do {
            let page = try await api.listGames(before: before)
            return .success(
                RoomsPage(
                    rooms: page.rows.map { summary in
                        RoomCardModel(
                            gameId: summary.gameId,
                            name: summary.name,
                            puzzleTitle: summary.puzzle.title,
                            rows: summary.puzzle.rows,
                            cols: summary.puzzle.cols,
                            // The puzzle's black-square silhouette (PROTOCOL.md §12), painted
                            // as the card's face. Empty from an older server (§14) falls back
                            // to the bare geometry lattice.
                            mask: summary.puzzle.mask,
                            memberCount: summary.memberCount,
                            createdBy: summary.createdBy,
                            createdAt: summary.createdAt,
                            completedAt: summary.completedAt,
                            lastActivityAt: summary.lastActivityAt,
                            // The row's member stack, digested to the UI's own shape
                            // (PROTOCOL.md section 12): identity as the server resolved
                            // it, the seat folded to the two flags the room layer reads.
                            // Empty from an older server (section 14); memberCount stays
                            // the honest total either way.
                            members: summary.members.map { member in
                                RoomCardMember(
                                    userId: member.userId,
                                    name: member.name,
                                    avatarUrl: member.avatarUrl,
                                    isHost: member.role == .host,
                                    isSpectator: member.role == .spectator)
                            },
                            // The member-only invite code (PROTOCOL.md section 12): the
                            // seeded-birth share pill is born from it, so the share
                            // payload exists pre-REST. Nil from an older server (section
                            // 14) leaves the seeded room shareless until REST lands the
                            // code, the same as an unseeded arrival.
                            inviteCode: summary.inviteCode)
                    },
                    nextBefore: page.nextBefore))
        } catch {
            return .failure(ArrivalFailure(digesting: error))
        }
    }

    func join(code: String) async -> Result<String, ArrivalFailure> {
        do {
            let membership = try await api.joinGame(code: code)
            return .success(membership.gameId)
        } catch {
            return .failure(ArrivalFailure(digesting: error))
        }
    }
}

/// Real puzzles over the section 12 client, the RealRooms shape exactly: mapping and
/// error digestion only.
@MainActor
struct RealPuzzles: PuzzlesProviding {
    let api: CrossyAPIClient

    func loadPage(before: String?) async -> Result<PuzzlesPage, ArrivalFailure> {
        do {
            let page = try await api.listPuzzles(before: before)
            return .success(
                PuzzlesPage(
                    puzzles: page.rows.map { summary in
                        PuzzleCardModel(
                            puzzleId: summary.puzzleId,
                            title: summary.title,
                            author: summary.author,
                            rows: summary.rows,
                            cols: summary.cols)
                    },
                    nextBefore: page.nextBefore))
        } catch {
            return .failure(ArrivalFailure(digesting: error))
        }
    }

    /// `POST /games` with the puzzleId alone (no name): the puzzle library's start is
    /// unnamed by default, exactly as the web gallery's "New game" is. The created
    /// gameId opens the room; the invite code is not needed here (the room view reads
    /// it back for the host, GameView.inviteCode, §12).
    func startGame(puzzleId: String) async -> Result<String, ArrivalFailure> {
        do {
            let created = try await api.createGame(CreateGameRequest(puzzleId: puzzleId))
            return .success(created.gameId)
        } catch {
            return .failure(ArrivalFailure(digesting: error))
        }
    }
}

extension ArrivalFailure {
    /// CrossyAPIError to the screens' shape: the stable code when the server spoke
    /// (§12), nil for network weather, and the closest honest code otherwise. A
    /// missing session token reads as UNAUTHORIZED (its sentence says sign in
    /// again, which is exactly the remedy).
    init(digesting error: any Error) {
        guard let apiError = error as? CrossyAPIError else {
            self.init(code: "INTERNAL")
            return
        }
        switch apiError {
        case .api(_, let envelope):
            self.init(code: envelope.error)
        case .transport:
            self.init(code: nil)
        case .tokenUnavailable:
            self.init(code: "UNAUTHORIZED")
        case .invalidResponse, .decodingFailed:
            self.init(code: "INTERNAL")
        }
    }
}

// MARK: - Fixture backend (-i3Fixture)

/// The fixture verify's rejection, so the "Continue another way" sheet's inline
/// verify-failure copy is walkable offline (any code but the fixed fixture OTP throws).
private struct FixtureVerifyError: Error {}

/// The device-walk session: sign-in succeeds after a beat (long enough to see the
/// authenticating state, short enough to feel instant), no network, no Keychain. It
/// carries a fake identity so the Account screen is reachable and demo-able offline,
/// and remembers which button signed in so the provider line reads honestly on either
/// path.
@MainActor
@Observable
final class FixtureArrivalSession: ArrivalSessioning {
    /// A stable fake user id, so the Account puck resolves one deterministic roster
    /// color across the walk.
    static let fixtureUserId = "fixture-user-01"

    private(set) var phase: AuthPhase = .signedOut
    private(set) var userId: String?
    private(set) var authProvider: AuthProvider?

    /// `signedIn` starts the walk inside the shell (-i3SignedIn beside -i3Fixture):
    /// screenshots and demos of the tabs without a hand on Welcome first.
    init(signedIn: Bool = false) {
        if signedIn {
            phase = .signedIn
            userId = Self.fixtureUserId
            authProvider = .discord
        }
    }

    var tokenProvider: any BearerTokenProviding { FixedBearerToken(token: "fixture-token") }

    /// The fixed OTP the fixture verify accepts, so the device walk exercises the whole
    /// email leg offline: any other code lands the calm verify-failure copy, this one
    /// signs in.
    static let fixtureOTP = "123456"

    func signIn() async { await beat(provider: .discord) }

    /// The -i3Fixture device walk exercises both Welcome buttons; Apple takes the same
    /// beat as Discord, so the authenticating state and the tapped-button spinner show
    /// identically on either path.
    func signInWithApple() async { await beat(provider: .apple) }

    /// Hisbaan takes the same beat as the primary buttons (it is the same web leg in the
    /// real path), so the sheet's hand-off and the Welcome spinner are walkable offline.
    func continueWithHisbaan() async { await beat(provider: .hisbaan) }

    /// Sending the code is a no-op that succeeds after a short beat (long enough to see
    /// the "Send code" spinner), so the sheet advances to the code pane with no network.
    func sendEmailOTP(email: String) async throws {
        try? await Task.sleep(for: .milliseconds(400))
    }

    /// Verify accepts the fixed fixture code and signs in (the beat mirrors the primary
    /// buttons so the spinner shows); any other code throws, so the sheet's inline
    /// verify-failure copy is walkable on device.
    func verifyEmailOTP(email: String, code: String) async throws {
        guard code == Self.fixtureOTP else {
            try? await Task.sleep(for: .milliseconds(300))
            throw FixtureVerifyError()
        }
        await beat(provider: .emailOTP)
    }

    /// A magic link the fixture never receives (no Universal Link in the offline walk),
    /// so this simply signs in with the email marker, keeping the seam total.
    func completeMagicLink(tokenHash: String, type: String) async throws {
        await beat(provider: .emailOTP)
    }

    private func beat(provider: AuthProvider) async {
        phase = .authenticating
        try? await Task.sleep(for: .milliseconds(600))
        userId = Self.fixtureUserId
        authProvider = provider
        phase = .signedIn
    }

    func signOut() async {
        phase = .signedOut
        userId = nil
        authProvider = nil
    }

    /// The stubbed delete: succeed after a beat (long enough to see the spinner), then
    /// land at Welcome exactly as the real path does on the server's confirmation.
    func deleteAccount() async -> ArrivalFailure? {
        try? await Task.sleep(for: .milliseconds(600))
        phase = .signedOut
        userId = nil
        authProvider = nil
        return nil
    }
}

/// Canned rooms for the fixture walk: three geometries, believable people counts.
/// Every card opens the loopback room; a join with the all-twos code reads the
/// GAME_NOT_FOUND sentence (so the failure copy is walkable on device), any other
/// complete code lands in the loopback room.
@MainActor
struct FixtureRooms: RoomsProviding {
    static let notFoundCode = "22222222"

    func loadPage(before: String?) async -> Result<RoomsPage, ArrivalFailure> {
        guard before == nil else {
            return .success(RoomsPage(rooms: [], nextBefore: nil))
        }
        // Member stacks mirror each room's memberCount (the wire consistency PROTOCOL.md
        // section 12 pins). Avatar URLs stay nil: the fixture walk is no-network, and nil
        // is the honest first-class value the initial-puck fallback renders.
        return .success(
            RoomsPage(
                rooms: [
                    RoomCardModel(
                        gameId: "fixture-tuesday", name: "Tuesday evening",
                        puzzleTitle: "A door left ajar", rows: 9, cols: 9,
                        // A believable 9x9 silhouette (180-symmetric), so the fixture walk
                        // renders a real face, not a bare lattice.
                        mask: [
                            "...##....", "....#....", "....#....", "##.....#.", "...#.#...",
                            ".#.....##", "....#....", "....#....", "....##...",
                        ],
                        memberCount: 3, createdBy: "you",
                        createdAt: "2026-07-06T19:00:00.000Z",
                        completedAt: nil,
                        lastActivityAt: "2026-07-09T21:14:00.000Z",
                        members: [
                            RoomCardMember(
                                userId: "you", name: "You", avatarUrl: nil,
                                isHost: true, isSpectator: false),
                            RoomCardMember(
                                userId: "bee", name: "Bee", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                            RoomCardMember(
                                userId: "guest-1", name: "Guest", avatarUrl: nil,
                                isHost: false, isSpectator: true),
                        ],
                        // A believable code so the seeded share pill has a live payload
                        // in the fixture walk (the goo capture shows a working share).
                        inviteCode: "TUESDAY1"),
                    // One solved room, so the trailing "Solved" section is judgeable in the
                    // fixture walk (-i3Fixture -i3SignedIn): a real completedAt gathers it into
                    // the shelf and dims its silhouette. The others stay live above it.
                    RoomCardModel(
                        gameId: "fixture-themeless", name: nil,
                        puzzleTitle: "Themeless Saturday", rows: 15, cols: 15,
                        // A believable 15x15 silhouette (180-symmetric); solved, so the shelf
                        // dims it, the muted-silhouette echo of the web's `Silhouette muted`.
                        mask: [
                            "....#.....#....", "....#.....#....", "....#.....#....",
                            "##.....#.....##", ".....##.....#..", "...#.......#...",
                            "###.....##.....", "....#.....#....", ".....##.....###",
                            "...#.......#...", "..#.....##.....", "##.....#.....##",
                            "....#.....#....", "....#.....#....", "....#.....#....",
                        ],
                        memberCount: 2, createdBy: "bee",
                        createdAt: "2026-07-04T11:00:00.000Z",
                        completedAt: "2026-07-08T15:07:00.000Z",
                        lastActivityAt: "2026-07-08T15:02:00.000Z",
                        members: [
                            RoomCardMember(
                                userId: "bee", name: "Bee", avatarUrl: nil,
                                isHost: true, isSpectator: false),
                            RoomCardMember(
                                userId: "you", name: "You", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                        ],
                        inviteCode: "SATURDAY"),
                    RoomCardModel(
                        gameId: "fixture-stumper", name: "Sunday call",
                        puzzleTitle: "The Stumper", rows: 21, cols: 21,
                        // A believable 21x21 Sunday silhouette (180-symmetric).
                        mask: [
                            ".....#.....#....#....", ".....#.....#....#....",
                            ".....#.....#....#....", "##......#.....#....##",
                            "......##.....#....#..", "....#.....#.....#....",
                            "...#.....#.....#.....", "##.....#....#.....#..",
                            ".....#.....#.....#...", "....#.....#.....#....",
                            "##.....#.....#.....##", "....#.....#.....#....",
                            "...#.....#.....#.....", "..#.....#....#.....##",
                            ".....#.....#.....#...", "....#.....#.....#....",
                            "..#....#.....##......", "##....#.....#......##",
                            "....#....#.....#.....", "....#....#.....#.....",
                            "....#....#.....#....",
                        ],
                        memberCount: 6, createdBy: "ada",
                        createdAt: "2026-07-05T09:00:00.000Z",
                        completedAt: nil,
                        lastActivityAt: nil,
                        members: [
                            RoomCardMember(
                                userId: "ada", name: "Ada", avatarUrl: nil,
                                isHost: true, isSpectator: false),
                            RoomCardMember(
                                userId: "you", name: "You", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                            RoomCardMember(
                                userId: "bee", name: "Bee", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                            RoomCardMember(
                                userId: "june", name: "June", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                            RoomCardMember(
                                userId: "rosei", name: "R. Osei", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                            RoomCardMember(
                                userId: "guest-2", name: "Guest", avatarUrl: nil,
                                isHost: false, isSpectator: true),
                        ],
                        inviteCode: "STUMPER7"),
                    // Two more live rooms so the fixture walk fills the featured 2x2 wall
                    // (four live rooms), with real size variety across the faces: a 13x13,
                    // a 5x5 mini, the 9x9 above, and the 21x21 Sunday.
                    RoomCardModel(
                        gameId: "fixture-wednesday", name: "Wednesday crossword",
                        puzzleTitle: "Crossed wires", rows: 13, cols: 13,
                        // A believable 13x13 silhouette (180-symmetric).
                        mask: [
                            "....#....#...", "....#....#...", "....#....#...",
                            "##.....#.....", ".....#.....#.", "...#.....#...",
                            "##....#....##", "...#.....#...", ".#.....#.....",
                            ".....#.....##", "...#....#....", "...#....#....",
                            "...#....#....",
                        ],
                        memberCount: 2, createdBy: "you",
                        createdAt: "2026-07-10T08:00:00.000Z",
                        completedAt: nil,
                        lastActivityAt: "2026-07-11T20:30:00.000Z",
                        members: [
                            RoomCardMember(
                                userId: "you", name: "You", avatarUrl: nil,
                                isHost: true, isSpectator: false),
                            RoomCardMember(
                                userId: "bee", name: "Bee", avatarUrl: nil,
                                isHost: false, isSpectator: false),
                        ],
                        inviteCode: "WEDNES13"),
                    RoomCardModel(
                        gameId: "fixture-mini", name: "Coffee mini",
                        puzzleTitle: "Monday mini", rows: 5, cols: 5,
                        // A believable 5x5 mini silhouette (180-symmetric).
                        mask: ["..#..", ".....", "#...#", ".....", "..#.."],
                        memberCount: 1, createdBy: "you",
                        createdAt: "2026-07-10T07:45:00.000Z",
                        completedAt: nil,
                        lastActivityAt: "2026-07-10T22:05:00.000Z",
                        members: [
                            RoomCardMember(
                                userId: "you", name: "You", avatarUrl: nil,
                                isHost: true, isSpectator: false)
                        ],
                        inviteCode: "MINI0005"),
                ],
                nextBefore: nil))
    }

    func join(code: String) async -> Result<String, ArrivalFailure> {
        try? await Task.sleep(for: .milliseconds(400))
        if code == Self.notFoundCode {
            return .failure(ArrivalFailure(code: "GAME_NOT_FOUND"))
        }
        return .success("fixture-joined")
    }
}

/// Canned puzzles for the fixture walk: the rooms' own titles plus one untitled
/// upload, so the geometry-fallback headline is walkable on device.
@MainActor
struct FixturePuzzles: PuzzlesProviding {
    func loadPage(before: String?) async -> Result<PuzzlesPage, ArrivalFailure> {
        guard before == nil else {
            return .success(PuzzlesPage(puzzles: [], nextBefore: nil))
        }
        return .success(
            PuzzlesPage(
                puzzles: [
                    PuzzleCardModel(
                        puzzleId: "fixture-ajar", title: "A door left ajar",
                        author: "June Park", rows: 9, cols: 9),
                    PuzzleCardModel(
                        puzzleId: "fixture-themeless", title: "Themeless Saturday",
                        author: "R. Osei", rows: 15, cols: 15),
                    PuzzleCardModel(
                        puzzleId: "fixture-stumper", title: "The Stumper",
                        author: nil, rows: 21, cols: 21),
                    PuzzleCardModel(
                        puzzleId: "fixture-untitled", title: nil,
                        author: nil, rows: 5, cols: 5),
                ],
                nextBefore: nil))
    }

    /// The stubbed start: a beat (long enough to see the card's "Starting" state),
    /// then a created gameId that opens the loopback room, the same landing the
    /// fixture join takes. No network, no create.
    func startGame(puzzleId: String) async -> Result<String, ArrivalFailure> {
        try? await Task.sleep(for: .milliseconds(400))
        return .success("fixture-created")
    }
}

// MARK: - The model

/// One resolved arrival composition. Routing state (the navigation path) stays in
/// the view; this object holds the seams and the facts rooms open with.
@MainActor
final class ArrivalModel {
    let session: any ArrivalSessioning
    let rooms: any RoomsProviding
    let puzzles: any PuzzlesProviding
    /// nil in the fixture composition: cards open the loopback room, not RealRoom.
    let liveRoomFacts: (apiBaseURL: URL, sessionBaseURL: URL)?
    let authConfigured: Bool
    /// The legal pages Welcome and Settings open in the in-app Safari sheet. The
    /// screens only signal intent (onOpenLegal); this model supplies the URLs.
    /// Always real URLs, even in the fixture and unconfigured compositions
    /// (ArrivalConfig.defaultWebOrigin), so the legal affordances never depend on
    /// the auth/session seam being live.
    let privacyURL: URL
    let termsURL: URL

    private init(
        session: any ArrivalSessioning,
        rooms: any RoomsProviding,
        puzzles: any PuzzlesProviding,
        liveRoomFacts: (apiBaseURL: URL, sessionBaseURL: URL)?,
        authConfigured: Bool,
        privacyURL: URL = ArrivalConfig.defaultWebOrigin.appending(path: "privacy"),
        termsURL: URL = ArrivalConfig.defaultWebOrigin.appending(path: "terms")
    ) {
        self.session = session
        self.rooms = rooms
        self.puzzles = puzzles
        self.liveRoomFacts = liveRoomFacts
        self.authConfigured = authConfigured
        self.privacyURL = privacyURL
        self.termsURL = termsURL
    }

    /// The launch-time resolution described in the header comment.
    static func resolve() -> ArrivalModel {
        if LaunchFacts.flag("i3Fixture") {
            return ArrivalModel(
                session: FixtureArrivalSession(signedIn: LaunchFacts.flag("i3SignedIn")),
                rooms: FixtureRooms(),
                puzzles: FixturePuzzles(),
                liveRoomFacts: nil,
                authConfigured: true)
        }

        guard let config = ArrivalConfig.load() else {
            // No usable bases anywhere: behave as an unconfigured build (one plain
            // sentence on Welcome) rather than crash. Unreachable with the
            // committed plist.
            return ArrivalModel(
                session: FixtureArrivalSession(),
                rooms: FixtureRooms(),
                puzzles: FixturePuzzles(),
                liveRoomFacts: nil,
                authConfigured: false)
        }

        let session: any ArrivalSessioning
        let configured: Bool
        if let token = LaunchFacts.value("CROSSY_IT_TOKEN") {
            session = InjectedArrivalSession(token: token)
            configured = true
        } else if let auth = config.auth {
            // The AuthSession is built first so it can be both the session seam and
            // the API client's token provider; the API client then rides the session
            // (account deletion is the server call plus the local purge in one intent).
            let authSession = AuthSession(
                client: SupabaseAuthClient(configuration: auth),
                web: WebAuthenticationPresenter(),
                apple: AppleSignInPresenter(),
                keychain: SystemKeychain())
            session = RealArrivalSession(
                auth: authSession,
                api: CrossyAPIClient(
                    baseURL: config.apiBaseURL, tokenProvider: authSession))
            configured = true
        } else {
            // Auth slots empty, no injected token: Welcome states it plainly.
            session = FixtureArrivalSession()
            configured = false
        }

        // One client (a value) behind both list seams; the session's own client for
        // deletion was built above and rides the auth branch.
        let api = CrossyAPIClient(
            baseURL: config.apiBaseURL, tokenProvider: session.tokenProvider)
        return ArrivalModel(
            session: session,
            rooms: RealRooms(api: api),
            puzzles: RealPuzzles(api: api),
            liveRoomFacts: (config.apiBaseURL, config.sessionBaseURL),
            authConfigured: configured,
            privacyURL: config.webOrigin.appending(path: "privacy"),
            termsURL: config.webOrigin.appending(path: "terms"))
    }

    /// The Welcome screen's state, mapped from the session phase and the config.
    var welcomeState: WelcomeState {
        guard authConfigured else { return .unconfigured }
        switch session.phase {
        case .authenticating:
            return .authenticating
        case .failed:
            return .failed
        case .signedOut, .signedIn, .refreshing:
            return .ready
        }
    }

    var isSignedIn: Bool {
        switch session.phase {
        case .signedIn, .refreshing:
            return true
        case .signedOut, .authenticating, .failed:
            return false
        }
    }

    /// The signed-in person for the Settings tab, mapped from what the session
    /// already holds. nil when there is no user id to show (the harness path, or
    /// before sign-in), which leaves the tab a quiet canvas. Display name is not
    /// persisted yet (auth state carries only the id and the provider), so it is nil
    /// here and the puck falls back to its colored initial.
    var selfIdentity: AccountIdentity? {
        guard let userId = session.userId else { return nil }
        return AccountIdentity(
            userId: userId,
            displayName: nil,
            providerLabel: providerLabel(session.authProvider))
    }

    /// The provider line the Account screen shows, or the plain fallback when none is
    /// remembered.
    private func providerLabel(_ provider: AuthProvider?) -> String {
        switch provider {
        case .discord: return ArrivalCopy.providerDiscord
        case .apple: return ArrivalCopy.providerApple
        case .hisbaan: return ArrivalCopy.providerHisbaan
        case .emailOTP: return ArrivalCopy.providerEmail
        case nil: return ArrivalCopy.providerUnknown
        }
    }

    /// The quiet version footer: "{short} ({build})" from the bundle, nil when either
    /// is absent (previews, an incomplete Info.plist). Read from Bundle.main, not any
    /// banned Info.plist edit.
    var versionLabel: String? {
        let info = Bundle.main.infoDictionary
        guard let short = info?["CFBundleShortVersionString"] as? String else { return nil }
        if let build = info?["CFBundleVersion"] as? String, !build.isEmpty {
            return "\(short) (\(build))"
        }
        return short
    }
}
