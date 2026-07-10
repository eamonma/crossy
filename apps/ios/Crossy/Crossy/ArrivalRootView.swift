//
//  ArrivalRootView.swift
//  Crossy
//
//  The end-to-end journey's spine (EXPERIENCE.md §2): signed out shows Welcome;
//  signed in shows Rooms; Join with a code pushes its screen; a joined or tapped
//  room pushes the room itself. Join success replaces the join screen in the path,
//  so back from the room lands on Rooms, never on a stale code field. The kicked
//  exit (SolveScreen onExit) pops home the same way.
//

import CrossyUI
import SwiftUI

/// Everything the arrival flow can push.
enum ArrivalRoute: Hashable {
    case join
    case room(gameId: String)
    /// The -i3Fixture composition's room: the loopback DemoRoom, no network.
    case fixtureRoom
}

struct ArrivalRootView: View {
    @State private var model = ArrivalModel.resolve()
    @State private var path: [ArrivalRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            root
                .navigationDestination(for: ArrivalRoute.self) { route in
                    destination(route)
                }
        }
    }

    @ViewBuilder
    private var root: some View {
        if model.isSignedIn {
            RoomsScreen(
                loadPage: { before in await model.rooms.loadPage(before: before) },
                onOpenRoom: { room in path.append(roomRoute(for: room.gameId)) },
                onJoinWithCode: { path.append(.join) }
            )
            .toolbar(.hidden, for: .navigationBar)
        } else {
            WelcomeScreen(state: model.welcomeState) {
                Task { await model.session.signIn() }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    @ViewBuilder
    private func destination(_ route: ArrivalRoute) -> some View {
        switch route {
        case .join:
            JoinCodeScreen { code in
                switch await model.rooms.join(code: code) {
                case .success(let gameId):
                    // Replace the join screen so back from the room is Rooms.
                    path = [roomRoute(for: gameId)]
                    return nil
                case .failure(let failure):
                    return failure
                }
            }
        case .room(let gameId):
            if let facts = model.liveRoomFacts {
                RealRoomView(
                    room: RealRoom(
                        apiBaseURL: facts.apiBaseURL,
                        sessionBaseURL: facts.sessionBaseURL,
                        gameId: gameId,
                        tokenProvider: model.session.tokenProvider),
                    onExit: { path.removeAll() }
                )
                .toolbar(.hidden, for: .navigationBar)
            } else {
                // Unreachable: roomRoute(for:) only builds .room with live facts.
                DemoRoomView()
                    .toolbar(.hidden, for: .navigationBar)
            }
        case .fixtureRoom:
            DemoRoomView()
                .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func roomRoute(for gameId: String) -> ArrivalRoute {
        model.liveRoomFacts == nil ? .fixtureRoom : .room(gameId: gameId)
    }
}
