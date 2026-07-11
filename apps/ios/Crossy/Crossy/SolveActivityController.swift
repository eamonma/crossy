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

    /// The room's shared avatar cache (nil offline / harness): the island snapshot reads
    /// ALREADY-RESOLVED images from it at start and never triggers a fetch (backgrounding is
    /// no time for the network). The composition root hands the SAME instance it gives
    /// SolveScreen, so the island writes the very images the room already fetched.
    private var avatarCache: AvatarImageCache?

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

    /// Bind the room's shared avatar cache for the island snapshot (the same instance
    /// SolveScreen renders from). Nil offline: the island then carries userIds but writes no
    /// images, so every puck stays initials, the floor.
    func bind(avatarCache: AvatarImageCache?) {
        self.avatarCache = avatarCache
    }

    /// Feed one observed state. The anchor parses here so the policy never
    /// starts on an unusable timestamp (D15: the island renders from the anchor
    /// or not at all). The board counts (`filled`, `total`) and each participant's
    /// live `connected` flag ride along so a start can be BORN LIVE: the island
    /// requests carrying the room's real state, not an empty content-state that
    /// waits up to ~20s for the first push (PROTOCOL.md §12a). `total` is grid
    /// geometry (playable cells, blocks excluded), read off the puzzle at the
    /// composition root; `filled` is the store's confirmed count. All data, no
    /// store reference reaches here.
    func observe(
        scenePhase: ScenePhase,
        status: GameStatus,
        kicked: Bool,
        firstFillAt: String?,
        completedAt: String?,
        roomName: String,
        participants: [Participant],
        filled: Int,
        total: Int
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
            start(
                anchor: anchor, roomName: roomName, participants: participants,
                filled: filled, total: total, status: status, completedAt: completedAt)
        case .end:
            endAll()
        case .none:
            break
        }
    }

    /// Request at the .inactive transition, while the app is still effectively
    /// foreground (SP-i3). Gated on the user's per-app Live Activities switch.
    private func start(
        anchor: Date, roomName: String, participants: [Participant],
        filled: Int, total: Int, status: GameStatus, completedAt: String?
    ) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let members = participants.map {
            RosterMember(
                userId: $0.userId, displayName: $0.displayName, wireColor: $0.color,
                avatarUrl: $0.avatarUrl,
                isHost: $0.role == .host, isSpectator: $0.role == .spectator,
                connected: $0.connected)
        }
        // The room bar's own cluster order and cap (RosterList), colors resolved
        // to the dark ground once, at request time: the island is always black
        // glass (apps/ios/DESIGN.md section 8). The SAME cluster feeds both the
        // immutable attributes fallback (initial + color) and the born-live
        // content-state (which adds each member's live `connected`).
        let cluster = RosterList.cluster(members).pucks
        let pucks = cluster.map { member -> SolveActivityAttributes.Puck in
            let color = member.identity.darkGround
            return SolveActivityAttributes.Puck(
                initial: member.initial, red: color.red, green: color.green, blue: color.blue,
                userId: member.userId)
        }
        let attributes = SolveActivityAttributes(
            firstFillAt: anchor, roomName: roomName, pucks: pucks)
        // The avatar pucks (owner ask 2026-07-11): snapshot each cluster member's
        // ALREADY-RESOLVED avatar image from the room's cache (never a fetch, backgrounding
        // is no time for the network) and write it to the shared App Group container keyed by
        // userId, so the widget reads it synchronously and layers it over the colored initial.
        // A member whose image has not resolved simply gets no file and stays initials, the
        // floor. No container (no entitlement yet) is a clean no-op.
        snapshotAvatars(for: cluster)
        // Born live (PROTOCOL.md §12a): the island starts carrying the room's real state
        // at the moment of backgrounding, so it renders live data at zero seconds instead
        // of an empty content-state waiting up to ~20s for the first push. The server
        // takes over over APNs once it has this activity's token; this is just frame one.
        // The builder maps the SAME cluster (presence order, cap, dark ground) plus each
        // member's live `connected`, and the confirmed counts, to the payload the emitter
        // pushes, so frame one and push two speak the identical shape.
        let bornLive = IslandContentState.bornLive(
            cluster: cluster.map {
                let color = $0.identity.darkGround
                return IslandContentState.ClusterMember(
                    initial: $0.initial, red: Int(color.red), green: Int(color.green),
                    blue: Int(color.blue), connected: $0.connected, userId: $0.userId)
            },
            filled: filled,
            total: total,
            status: mapIslandStatus(status),
            completedAt: completedAt)
        // Zero local updates follow (D15): the server drives the island over APNs once it
        // has this activity's update token. A refused request (authorization raced off,
        // system cap) simply means no island this leave, never a broken room.
        //
        // pushType .token is LOAD-BEARING: without it ActivityKit mints a local-only
        // activity whose pushTokenUpdates never yields, silently, and the server can
        // never reach the island (found live 2026-07-11: a healthy-looking island, an
        // empty token registry, and not one error line anywhere).
        guard let activity = try? Activity.request(
            attributes: attributes,
            content: .init(state: bornLive, staleDate: nil),
            pushType: .token)
        else { return }
        streamPushToken(for: activity)
    }

    /// Write each cluster member's already-resolved avatar to the shared container, keyed by
    /// userId, and prune files for members no longer in the cluster (owner ask 2026-07-11).
    ///
    /// Threading: the cache is @MainActor and this runs on main. The cheap part (reading each
    /// resolved UIImage out of the cache) happens here on main; the expensive part (downscale,
    /// PNG encode, atomic write, directory prune) hops OFF main. `start` fires at the
    /// `.inactive` transition, right as the app heads into suspension, so keeping the
    /// downscale of up to four images off the main actor keeps the request path snappy. The
    /// snapshotted UIImages are immutable value snapshots safe to draw from another thread;
    /// the store is a plain value over a file URL, holding no actor state. A missing container
    /// (no entitlement) makes every write and prune a clean no-op, so the island stays
    /// initials exactly like today.
    private func snapshotAvatars(for cluster: [RosterMember]) {
        // Read resolved images on main (the cache is @MainActor). A member with no avatar url,
        // or one whose image has not resolved yet, contributes nothing: that puck stays
        // initials. No fetch is ever kicked here.
        let resolved: [(userId: String, image: PlatformImage)] = cluster.compactMap { member in
            guard let url = member.avatarUrl,
                let image = avatarCache?.resolvedPlatformImage(for: url)
            else { return nil }
            return (member.userId, image)
        }
        let clusterUserIds = cluster.map(\.userId)
        // Even with no resolved images, hop off-main to prune stale files (a member who left
        // between two starts) so the container never keeps an avatar for someone off the crew.
        Task.detached(priority: .utility) {
            let store = IslandAvatarStore()
            for entry in resolved {
                store.write(image: entry.image, for: entry.userId)
            }
            store.prune(keeping: clusterUserIds)
        }
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

    /// The store's status as the content-state carries it (PROTOCOL.md §12a). The policy
    /// only ever hands `.start` for an ongoing room, so frame one is ongoing in practice;
    /// this maps the real status regardless so the born-live payload never assumes.
    private func mapIslandStatus(_ status: GameStatus) -> IslandStatus {
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
    /// The grid's playable-cell count (cells minus blocks), the born-live frame's `total`
    /// (PROTOCOL.md §12a). Read off the puzzle at the composition root because the store
    /// never holds geometry; this agrees with the server's BoardFacts total so frame one
    /// and the first push report the same denominator. The fixture path passes its own
    /// puzzle's count unchanged.
    let total: Int
    /// The push-token registration for this room, nil offline. Bound into the controller
    /// on appear so a start knows where to POST the token.
    let registration: LiveActivityRegistration?
    /// The room's shared avatar cache, so the island snapshot writes the images the room
    /// already resolved (nil when a composition root drives no live pucks).
    let avatarCache: AvatarImageCache?

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
        controller.bind(avatarCache: avatarCache)
        guard let registration else { return }
        controller.bind(gameId: registration.gameId, sink: registration.sink)
    }

    private func feed() {
        controller.observe(
            scenePhase: scenePhase,
            status: store.status,
            kicked: chrome.kicked,
            firstFillAt: store.firstFillAt,
            completedAt: store.completedAt,
            roomName: roomName,
            participants: store.participants,
            filled: store.filledCount,
            total: total)
    }
}

extension View {
    /// The Live Activity lifecycle for one room (roadmap I5a). `total` is the puzzle's
    /// playable-cell count, the born-live frame's denominator (§12a). `registration`
    /// carries the game id and REST sink for the push-token upload (§12a), nil for a room
    /// with no REST. `avatarCache` is the room's shared image cache: pass the SAME instance
    /// given to SolveScreen so the island snapshot writes the images the room already
    /// resolved (nil writes no avatars, the island stays initials).
    func solveActivity(
        store: GameStore,
        chrome: RoomChromeModel,
        roomName: String,
        total: Int,
        registration: LiveActivityRegistration? = nil,
        avatarCache: AvatarImageCache? = nil
    ) -> some View {
        modifier(
            SolveActivityHost(
                store: store, chrome: chrome, roomName: roomName, total: total,
                registration: registration, avatarCache: avatarCache))
    }
}
