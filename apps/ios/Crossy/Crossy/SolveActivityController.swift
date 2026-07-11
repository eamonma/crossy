//
//  SolveActivityController.swift
//  Crossy
//
//  The Live Activity's adapter (roadmap I5a): feeds SolveActivityPolicy the
//  observed (scenePhase, status, anchor) transitions and executes its actions
//  against ActivityKit. Every decision lives in the policy, pinned headlessly in
//  CrossyUITests; everything ActivityKit-touching lives HERE, in the app target,
//  never in a package (SP-i3: the packages' tests build on macOS). The host
//  modifier attaches where the composition roots own the room (ContentView), so
//  the wiring is additive and the solve screen knows nothing about it.
//

import ActivityKit
import CrossyDesign
import CrossyProtocol
import CrossyStore
import CrossyUI
import SwiftUI
import UIKit

/// The two REST calls the push channel needs, behind a package-defined slot (AD-2): the
/// controller depends on this, never on `CrossyAPIClient`, so the ActivityKit adapter and
/// the real REST client meet only at the composition root. A room that has no REST (the
/// offline fixture, the harness) passes no sink, so the controller's registration is a
/// clean no-op and the island still starts and ends. Both calls are best-effort: the
/// register survives a lost POST as a frozen island, never a broken room, and the
/// unregister leans on the server's 12h TTL and 410 handling to cover a miss (§12a).
@MainActor
protocol LiveActivityTokenSink {
    /// `POST /games/{gameId}/live-activity-tokens` for one hex token (the registrar owns
    /// the path and the {token, environment} body).
    func registerLiveActivityToken(
        path: [String], _ body: LiveActivityTokenRegistration) async throws
    /// `DELETE /games/{gameId}/live-activity-tokens/{token}` (the registrar owns the path,
    /// token included).
    func unregisterLiveActivityToken(path: [String]) async throws
}

@MainActor
final class SolveActivityController {
    private var policy = SolveActivityPolicy()

    /// The push-token registration for this room: the REST sink (nil offline) and the
    /// pure registrar that hex-encodes, builds the two paths, and remembers the last
    /// token so the end path knows what to delete (CrossyProtocol). Both are set once the
    /// composition root threads the game id and REST access in; nil until then, so a
    /// start before wiring simply registers nothing.
    private var tokenSink: LiveActivityTokenSink?
    private var registrar: LiveActivityTokenRegistrar?

    /// The task streaming `pushTokenUpdates` for the current activity. Held so a new start
    /// (or an end) can cancel a prior stream rather than leak it. Nil when no activity is
    /// live.
    private var tokenTask: Task<Void, Never>?

    /// Bind this controller to a room's push-token registration. Threaded as data through
    /// the same `solveActivity` seam that hands over the store and room name (no
    /// singletons, no ambient URLs): a game id and a REST sink, or neither offline.
    func bind(gameId: String, sink: LiveActivityTokenSink) {
        // Rebinding the same game id keeps any token already registered so a re-observe
        // does not orphan a live registration; a different game id starts fresh.
        if registrar?.gameId != gameId {
            registrar = LiveActivityTokenRegistrar(gameId: gameId)
        }
        tokenSink = sink
    }

    /// Feed one observed state. The anchor parses here so the policy never
    /// starts on an unusable timestamp (D15: the island renders from the anchor
    /// or not at all).
    func observe(
        scenePhase: ScenePhase,
        status: GameStatus,
        kicked: Bool,
        firstFillAt: String?,
        roomName: String,
        participants: [Participant]
    ) {
        let anchor = firstFillAt.flatMap(AmbientClock.parse)
        let action = policy.observe(
            phase: mapPhase(scenePhase),
            status: mapStatus(status),
            kicked: kicked,
            hasFirstFill: anchor != nil)
        switch action {
        case .start:
            guard let anchor else { return }
            start(anchor: anchor, roomName: roomName, participants: participants)
        case .end:
            endAll()
        case .none:
            break
        }
    }

    /// Request at the .inactive transition, while the app is still effectively
    /// foreground (SP-i3). Gated on the user's per-app Live Activities switch.
    private func start(anchor: Date, roomName: String, participants: [Participant]) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let members = participants.map {
            RosterMember(
                userId: $0.userId, displayName: $0.displayName, wireColor: $0.color,
                isHost: $0.role == .host, isSpectator: $0.role == .spectator,
                connected: $0.connected)
        }
        // The room bar's own cluster order and cap (RosterList), colors resolved
        // to the dark ground once, at request time: the island is always black
        // glass (apps/ios/DESIGN.md section 8).
        let pucks = RosterList.cluster(members).pucks.map { member -> SolveActivityAttributes.Puck in
            let color = member.identity.darkGround
            return SolveActivityAttributes.Puck(
                initial: member.initial, red: color.red, green: color.green, blue: color.blue)
        }
        let attributes = SolveActivityAttributes(
            firstFillAt: anchor, roomName: roomName, pucks: pucks)
        // Zero local updates follow (D15): the server drives the island over APNs once it
        // has this activity's update token. A refused request (authorization raced off,
        // system cap) simply means no island this leave, never a broken room.
        guard let activity = try? Activity.request(
            attributes: attributes,
            content: .init(state: SolveActivityAttributes.ContentState(), staleDate: nil))
        else { return }
        streamPushToken(for: activity)
    }

    /// Stream the activity's APNs update token to the server (§12a). Each token arrives as
    /// `Data`; the registrar hex-encodes it and builds the POST, and the sink registers it
    /// (the server upserts, so a rotation re-registers cleanly). The stream may yield again
    /// on rotation, so this loops for the activity's life. Nothing happens without a sink
    /// (offline, harness): the loop starts but every register is a no-op.
    ///
    /// On device the token needs the aps-environment entitlement to yield at all; on
    /// simulator `pushTokenUpdates` never yields a real token, so this is a clean no-op
    /// there (the wiring compiles and the loop simply waits).
    private func streamPushToken(for activity: Activity<SolveActivityAttributes>) {
        tokenTask?.cancel()
        guard tokenSink != nil else { return }
        tokenTask = Task { [weak self] in
            for await tokenData in activity.pushTokenUpdates {
                let hex = LiveActivityTokenRegistrar.hexEncode(tokenData)
                await self?.register(hexToken: hex)
            }
        }
    }

    /// Register one hex token under a background task assertion (§12a step 3). The activity
    /// starts at the .inactive transition, so the app is heading into suspension as this
    /// runs; the assertion keeps the process alive long enough for the POST to land.
    /// Failure is log-and-drop: a missed registration is a frozen island, never a broken
    /// room.
    private func register(hexToken: String) async {
        guard let sink = tokenSink, var registrar else { return }
        let (path, body) = registrar.register(hexToken: hexToken)
        self.registrar = registrar
        let task = UIApplication.shared.beginBackgroundTask(withName: "live-activity-token")
        defer {
            if task != .invalid { UIApplication.shared.endBackgroundTask(task) }
        }
        do {
            try await sink.registerLiveActivityToken(path: path, body)
        } catch {
            print("[SolveActivity] token register failed: \(error)")
        }
    }

    /// One end path for both ending rules: a terminal room and a foreground
    /// return both sweep every activity of our kind, so an orphan a killed
    /// process left ticking dies on the next return too (D15: the activity
    /// outlives the app). The last-registered token is unregistered here too
    /// (§12a step 4), fire-and-forget: the server's 12h TTL and 410 handling
    /// cover a miss.
    private func endAll() {
        tokenTask?.cancel()
        tokenTask = nil
        unregisterToken()
        Task {
            for activity in Activity<SolveActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
    }

    /// Best-effort DELETE of the last-registered token for this game (§12a step 4).
    /// Nothing registered (a missed register, no sink, an already-run unregister) is a
    /// clean no-op: the registrar returns no path. Failure is dropped; the server's TTL
    /// and 410 handling cover it.
    private func unregisterToken() {
        guard let sink = tokenSink, let path = registrar?.unregister() else { return }
        Task {
            do {
                try await sink.unregisterLiveActivityToken(path: path)
            } catch {
                print("[SolveActivity] token unregister failed: \(error)")
            }
        }
    }

    private func mapPhase(_ phase: ScenePhase) -> SolveScenePhase {
        switch phase {
        case .active: return .active
        case .inactive: return .inactive
        case .background: return .background
        // An unknown phase is not effective foreground: never a request site.
        @unknown default: return .background
        }
    }

    /// The store's status as policy data (the SolveScreen mapping, restated at
    /// this boundary: protocol types stay in their ring, AD-2).
    private func mapStatus(_ status: GameStatus) -> RoomStatus {
        switch status {
        case .ongoing: return .ongoing
        case .completed: return .completed
        case .abandoned: return .abandoned
        }
    }
}

/// The push-token registration a room hands the island: the game id the two endpoints
/// key on and the REST sink that reaches them (§12a). The game id and REST access reach
/// the controller only through this, threaded as data on the same `solveActivity` seam
/// that carries the store; a room with no REST (the offline fixture, the harness) passes
/// nil, so registration is a clean no-op and the island still starts and ends.
@MainActor
struct LiveActivityRegistration {
    let gameId: String
    let sink: LiveActivityTokenSink
}

/// The island wiring for one room (I5a), attached by the composition roots:
/// observes scenePhase and the store's lifecycle facts, feeds the policy through
/// the controller. Self-contained and additive.
struct SolveActivityHost: ViewModifier {
    let store: GameStore
    let chrome: RoomChromeModel
    let roomName: String
    /// The push-token registration for this room, nil offline. Bound into the controller
    /// on appear so a start knows where to POST the token.
    let registration: LiveActivityRegistration?

    @Environment(\.scenePhase) private var scenePhase
    @State private var controller = SolveActivityController()

    func body(content: Content) -> some View {
        content
            // The appear observation lets a fresh policy sweep a stale island
            // even if the launch never replays a phase change (D15 orphans).
            .onAppear {
                bind()
                feed()
            }
            .onChange(of: scenePhase) { feed() }
            .onChange(of: store.status) { feed() }
            .onChange(of: store.firstFillAt) { feed() }
            .onChange(of: chrome.kicked) { feed() }
    }

    private func bind() {
        guard let registration else { return }
        controller.bind(gameId: registration.gameId, sink: registration.sink)
    }

    private func feed() {
        controller.observe(
            scenePhase: scenePhase,
            status: store.status,
            kicked: chrome.kicked,
            firstFillAt: store.firstFillAt,
            roomName: roomName,
            participants: store.participants)
    }
}

extension View {
    /// The Live Activity lifecycle for one room (roadmap I5a). `registration` carries the
    /// game id and REST sink for the push-token upload (§12a), nil for a room with no REST.
    func solveActivity(
        store: GameStore,
        chrome: RoomChromeModel,
        roomName: String,
        registration: LiveActivityRegistration? = nil
    ) -> some View {
        modifier(
            SolveActivityHost(
                store: store, chrome: chrome, roomName: roomName, registration: registration))
    }
}
