//
//  ArrivalRootView.swift
//  Crossy
//
//  The end-to-end journey's spine (EXPERIENCE.md §2): signed out shows Welcome;
//  signed in shows Rooms; Join with a code opens a glass sheet that flows out of
//  the button (arrival notes, DESIGN.md §4); a joined or tapped room pushes the
//  room itself. Join success dismisses the sheet and makes the room the only pushed
//  element, so back from the room lands on Rooms, never on a stale code field. The
//  kicked exit (SolveScreen onExit) pops home the same way.
//

import CrossyUI
import SwiftUI

/// Everything the arrival flow can push. Join is a sheet now, not a push, so it is
/// no longer a route: the room is the only thing the join lands.
enum ArrivalRoute: Hashable {
    case room(gameId: String)
    /// The -i3Fixture composition's room: the loopback DemoRoom, no network.
    case fixtureRoom
}

struct ArrivalRootView: View {
    @State private var model = ArrivalModel.resolve()
    @State private var path: [ArrivalRoute] = []
    /// The join sheet's presentation state and its zoom namespace. The namespace
    /// lives here, not in RoomsScreen, because the sheet is presented from this
    /// hierarchy; the button downstream stamps itself as the matching source.
    @State private var showJoin = false
    /// The Account sheet's presentation (roadmap I3, thin settings). A tap-opened
    /// system sheet (the Mail-mechanism grammar, DESIGN.md §4).
    @State private var showSettings = false
    @Namespace private var joinZoom

    var body: some View {
        NavigationStack(path: $path) {
            root
                .navigationDestination(for: ArrivalRoute.self) { route in
                    destination(route)
                }
        }
        .sheet(isPresented: $showJoin) {
            joinSheet
        }
        .sheet(isPresented: $showSettings) {
            settingsSheet
        }
    }

    @ViewBuilder
    private var root: some View {
        if model.isSignedIn {
            RoomsScreen(
                loadPage: { before in await model.rooms.loadPage(before: before) },
                onOpenRoom: { room in path.append(roomRoute(for: room.gameId)) },
                onJoinWithCode: { showJoin = true },
                joinSheetSource: JoinSheetSource(namespace: joinZoom),
                selfIdentity: model.selfIdentity,
                onOpenSettings: { showSettings = true }
            )
            .toolbar(.hidden, for: .navigationBar)
        } else {
            WelcomeScreen(
                state: model.welcomeState,
                onContinueApple: { Task { await model.session.signInWithApple() } },
                onContinueDiscord: { Task { await model.session.signIn() } }
            )
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    /// The join surface: a glass sheet grown from the button, sized to one field.
    /// Success dismisses the sheet and makes the room the sole pushed element (the
    /// old push replaced the join route on the path; the sheet replaces that step
    /// exactly), so back from the room is Rooms, never a stale code field.
    private var joinSheet: some View {
        JoinCodeScreen { code in
            switch await model.rooms.join(code: code) {
            case .success(let gameId):
                showJoin = false
                path = [roomRoute(for: gameId)]
                return nil
            case .failure(let failure):
                return failure
            }
        }
        .presentationDetents([.fraction(JoinSheetPresentation.detentFraction)])
        .presentationDragIndicator(.visible)
        .joinSheetZoom(from: JoinSheetSource(namespace: joinZoom))
    }

    /// The Account surface (roadmap I3, thin settings): a tap-opened system sheet. Sign
    /// out and a confirmed delete both flip the session phase to signed out, so
    /// dismissing the sheet lands on Welcome (the root re-reads isSignedIn). A delete
    /// failure renders inline on the sheet and the sheet stays; only success dismisses.
    @ViewBuilder
    private var settingsSheet: some View {
        if let identity = model.selfIdentity {
            SettingsScreen(
                identity: identity,
                versionLabel: model.versionLabel,
                onSignOut: {
                    showSettings = false
                    Task { await model.session.signOut() }
                },
                onDeleteAccount: {
                    let failure = await model.session.deleteAccount()
                    if failure == nil { showSettings = false }
                    return failure
                })
        }
    }

    @ViewBuilder
    private func destination(_ route: ArrivalRoute) -> some View {
        switch route {
        case .room(let gameId):
            if let facts = model.liveRoomFacts {
                // Back and the kicked exit pop the same way: the room is the
                // only pushed element (join set the path to just the room, and
                // an opened card appended onto an empty path), so home is Rooms.
                RealRoomView(
                    room: RealRoom(
                        apiBaseURL: facts.apiBaseURL,
                        sessionBaseURL: facts.sessionBaseURL,
                        gameId: gameId,
                        tokenProvider: model.session.tokenProvider),
                    onBack: { path.removeAll() },
                    onExit: { path.removeAll() }
                )
                .toolbar(.hidden, for: .navigationBar)
            } else {
                // Unreachable: roomRoute(for:) only builds .room with live facts.
                DemoRoomView(onBack: { path.removeAll() })
                    .toolbar(.hidden, for: .navigationBar)
            }
        case .fixtureRoom:
            DemoRoomView(onBack: { path.removeAll() })
                .toolbar(.hidden, for: .navigationBar)
        }
    }

    private func roomRoute(for gameId: String) -> ArrivalRoute {
        model.liveRoomFacts == nil ? .fixtureRoom : .room(gameId: gameId)
    }
}
