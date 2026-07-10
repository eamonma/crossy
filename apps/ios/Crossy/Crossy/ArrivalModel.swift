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

/// The auth side of arrival: a phase the routing reads and the two intents the
/// Welcome screen and (later) the Account screen fire. Implementations wrap an
/// @Observable, so phase reads track in SwiftUI.
@MainActor
protocol ArrivalSessioning: AnyObject {
    var phase: AuthPhase { get }
    var tokenProvider: any BearerTokenProviding { get }
    func signIn() async
    func signOut() async
}

/// The rooms side: one page of cards, one join. Failures arrive pre-digested to the
/// stable-code shape the screens render (ArrivalFailure).
@MainActor
protocol RoomsProviding {
    func loadPage(before: String?) async -> Result<RoomsPage, ArrivalFailure>
    /// Join by code; success is the resolved gameId (PROTOCOL.md §12 /games/join).
    func join(code: String) async -> Result<String, ArrivalFailure>
}

// MARK: - Real backend

/// The production session: AuthSession behind the protocol. Phase reads land on the
/// @Observable AuthSession, so routing updates flow without forwarding.
@MainActor
final class RealArrivalSession: ArrivalSessioning {
    private let auth: AuthSession

    init(auth: AuthSession) {
        self.auth = auth
        auth.restore()
    }

    var phase: AuthPhase { auth.phase }
    var tokenProvider: any BearerTokenProviding { auth }
    func signIn() async { await auth.signIn() }
    func signOut() async { await auth.signOut() }
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
    func signIn() async {}
    func signOut() async {}
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
                            memberCount: summary.memberCount,
                            createdBy: summary.createdBy)
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

/// The device-walk session: sign-in succeeds after a beat (long enough to see the
/// authenticating state, short enough to feel instant), no network, no Keychain.
@MainActor
@Observable
final class FixtureArrivalSession: ArrivalSessioning {
    private(set) var phase: AuthPhase = .signedOut

    var tokenProvider: any BearerTokenProviding { FixedBearerToken(token: "fixture-token") }

    func signIn() async {
        phase = .authenticating
        try? await Task.sleep(for: .milliseconds(600))
        phase = .signedIn
    }

    func signOut() async {
        phase = .signedOut
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
        return .success(
            RoomsPage(
                rooms: [
                    RoomCardModel(
                        gameId: "fixture-tuesday", name: "Tuesday evening",
                        puzzleTitle: "A door left ajar", rows: 9, cols: 9,
                        memberCount: 3, createdBy: "you"),
                    RoomCardModel(
                        gameId: "fixture-themeless", name: nil,
                        puzzleTitle: "Themeless Saturday", rows: 15, cols: 15,
                        memberCount: 2, createdBy: "bee"),
                    RoomCardModel(
                        gameId: "fixture-stumper", name: "Sunday call",
                        puzzleTitle: "The Stumper", rows: 21, cols: 21,
                        memberCount: 6, createdBy: "ada"),
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

// MARK: - The model

/// One resolved arrival composition. Routing state (the navigation path) stays in
/// the view; this object holds the seams and the facts rooms open with.
@MainActor
final class ArrivalModel {
    let session: any ArrivalSessioning
    let rooms: any RoomsProviding
    /// nil in the fixture composition: cards open the loopback room, not RealRoom.
    let liveRoomFacts: (apiBaseURL: URL, sessionBaseURL: URL)?
    let authConfigured: Bool

    private init(
        session: any ArrivalSessioning,
        rooms: any RoomsProviding,
        liveRoomFacts: (apiBaseURL: URL, sessionBaseURL: URL)?,
        authConfigured: Bool
    ) {
        self.session = session
        self.rooms = rooms
        self.liveRoomFacts = liveRoomFacts
        self.authConfigured = authConfigured
    }

    /// The launch-time resolution described in the header comment.
    static func resolve() -> ArrivalModel {
        if LaunchFacts.flag("i3Fixture") {
            return ArrivalModel(
                session: FixtureArrivalSession(),
                rooms: FixtureRooms(),
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
                liveRoomFacts: nil,
                authConfigured: false)
        }

        let session: any ArrivalSessioning
        let configured: Bool
        if let token = LaunchFacts.value("CROSSY_IT_TOKEN") {
            session = InjectedArrivalSession(token: token)
            configured = true
        } else if let auth = config.auth {
            session = RealArrivalSession(
                auth: AuthSession(
                    client: SupabaseAuthClient(configuration: auth),
                    web: WebAuthenticationPresenter(),
                    keychain: SystemKeychain()))
            configured = true
        } else {
            // Auth slots empty, no injected token: Welcome states it plainly.
            session = FixtureArrivalSession()
            configured = false
        }

        return ArrivalModel(
            session: session,
            rooms: RealRooms(
                api: CrossyAPIClient(
                    baseURL: config.apiBaseURL, tokenProvider: session.tokenProvider)),
            liveRoomFacts: (config.apiBaseURL, config.sessionBaseURL),
            authConfigured: configured)
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
}
