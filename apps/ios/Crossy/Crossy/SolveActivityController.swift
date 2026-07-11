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

@MainActor
final class SolveActivityController {
    private var policy = SolveActivityPolicy()

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
        // Zero updates follow (D15); a refused request (authorization raced off,
        // system cap) simply means no island this leave, never a broken room.
        _ = try? Activity.request(
            attributes: attributes,
            content: .init(state: SolveActivityAttributes.ContentState(), staleDate: nil))
    }

    /// One end path for both ending rules: a terminal room and a foreground
    /// return both sweep every activity of our kind, so an orphan a killed
    /// process left ticking dies on the next return too (D15: the activity
    /// outlives the app).
    private func endAll() {
        Task {
            for activity in Activity<SolveActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
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

/// The island wiring for one room (I5a), attached by the composition roots:
/// observes scenePhase and the store's lifecycle facts, feeds the policy through
/// the controller. Self-contained and additive.
struct SolveActivityHost: ViewModifier {
    let store: GameStore
    let chrome: RoomChromeModel
    let roomName: String

    @Environment(\.scenePhase) private var scenePhase
    @State private var controller = SolveActivityController()

    func body(content: Content) -> some View {
        content
            // The appear observation lets a fresh policy sweep a stale island
            // even if the launch never replays a phase change (D15 orphans).
            .onAppear(perform: feed)
            .onChange(of: scenePhase) { feed() }
            .onChange(of: store.status) { feed() }
            .onChange(of: store.firstFillAt) { feed() }
            .onChange(of: chrome.kicked) { feed() }
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
    /// The Live Activity lifecycle for one room (roadmap I5a).
    func solveActivity(store: GameStore, chrome: RoomChromeModel, roomName: String) -> some View {
        modifier(SolveActivityHost(store: store, chrome: chrome, roomName: roomName))
    }
}
