//
//  ArrivalRootView.swift
//  Crossy
//
//  The end-to-end journey's spine (EXPERIENCE.md §2): signed out shows Welcome;
//  signed in shows the shell — the system tab bar carrying the three stable places
//  (Rooms, Puzzles, Settings), mirroring the web's destinations. The bar is the
//  system's: Liquid Glass on iOS 26+ by adoption, the plain material bar on the 18
//  floor, never a hand-built imitation (DESIGN.md §4). Join with a code opens a
//  glass sheet that flows out of the button (arrival notes, DESIGN.md §4); a joined
//  or tapped room pushes inside the Rooms tab and hides the bar — the board and
//  deck own the whole screen (the full-bleed ruling). Join success dismisses the
//  sheet and makes the room the only pushed element, so back from the room lands on
//  Rooms, never on a stale code field. The kicked exit (SolveScreen onExit) pops
//  home the same way.
//

import CrossyDesign
import CrossyUI
import SwiftUI

/// Everything the arrival flow can push. Join is a sheet now, not a push, so it is
/// no longer a route: the room is the only thing the join lands.
enum ArrivalRoute: Hashable {
    case room(gameId: String)
    /// The -i3Fixture composition's room: the loopback DemoRoom, no network.
    case fixtureRoom
}

/// The signed-in shell's three places. `-i3Tab puzzles|settings` selects the
/// starting tab (fixture demos and screenshots of a specific place; absent or
/// unrecognized lands on Rooms, the home).
enum ShellTab: Hashable {
    case rooms, puzzles, settings

    static var launchSelection: ShellTab {
        switch LaunchFacts.value("i3Tab") {
        case "puzzles": return .puzzles
        case "settings": return .settings
        default: return .rooms
        }
    }
}

struct ArrivalRootView: View {
    @State private var model = ArrivalModel.resolve()
    @State private var path: [ArrivalRoute] = []
    /// The join sheet's presentation state and its zoom namespace. The namespace
    /// lives here, not in RoomsScreen, because the sheet is presented from this
    /// hierarchy; the button downstream stamps itself as the matching source.
    /// `-i3Join` opens it at launch (fixture demos and screenshots of the panel).
    @State private var showJoin = LaunchFacts.flag("i3Join")
    /// The camera's standing on this device, resolved when the join sheet rises
    /// (CameraScanAuthority; the simulator resolves denied, the panel keeps its
    /// typed path).
    @State private var joinScan: JoinScanState = .probing
    /// A Universal Link's code, when a direct join failed: the join sheet opens
    /// pre-filled with it (code-only, no camera probe) so the reason is one tap
    /// away. Empty for a hand-tapped Join, which gets the camera-first panel.
    @State private var deepLinkPrefill = ""
    @State private var tab: ShellTab = .launchSelection
    @Namespace private var joinZoom
    @Environment(\.colorScheme) private var colorScheme
    /// The invite a Universal Link delivered (CrossyApp set it via InviteScan).
    @Environment(PendingInvite.self) private var pendingInvite

    var body: some View {
        Group {
            if model.isSignedIn {
                signedInShell
            } else {
                WelcomeScreen(
                    state: model.welcomeState,
                    onContinueApple: { Task { await model.session.signInWithApple() } },
                    onContinueDiscord: { Task { await model.session.signIn() } }
                )
            }
        }
        .sheet(isPresented: $showJoin) {
            joinSheet
        }
        // A cold launch straight from an invite link, already signed in: the code
        // is set before this view's observers register, so honor it once on appear.
        .task { honorPendingInvite() }
        // A link arriving while the app runs.
        .onChange(of: pendingInvite.code) { honorPendingInvite() }
        .onChange(of: model.isSignedIn) { _, signedIn in
            if signedIn {
                // Sign-in completed: honor an invite that was held while signed out
                // (the held-invite promise, EXPERIENCE.md §3).
                honorPendingInvite()
            } else {
                // Sign-out or deletion drops the shell; a stale pushed room or a
                // live join sheet must not greet the next sign-in.
                path.removeAll()
                showJoin = false
            }
        }
        // The pre-fill is a one-shot for a failed deep link; a later hand-tapped
        // Join must open the camera-first panel, never a stale code.
        .onChange(of: showJoin) { _, open in
            if !open { deepLinkPrefill = "" }
        }
    }

    /// Honor a Universal Link's invite code. Signed in: join at once and push the
    /// room — the QR's whole point, scan the projector and land in the room. A rare
    /// failure (the room ended, or the host removed you) opens the join panel
    /// pre-filled with the code, so the reason is one tap away and never silent.
    /// Signed out: the code stays pending until sign-in flips (this runs again on
    /// that edge). Cleared on consumption, so it fires exactly once.
    private func honorPendingInvite() {
        guard model.isSignedIn, let code = pendingInvite.code else { return }
        pendingInvite.code = nil
        Task {
            switch await model.rooms.join(code: code) {
            case .success(let gameId):
                showJoin = false
                path = [roomRoute(for: gameId)]
            case .failure:
                deepLinkPrefill = code
                showJoin = true
            }
        }
    }

    /// The signed-in shell: three tabs, named by their places. Only the Rooms tab
    /// navigates (rooms push inside it); Puzzles and Settings are single pages.
    private var signedInShell: some View {
        TabView(selection: $tab) {
            Tab(ArrivalCopy.roomsTitle, systemImage: "house", value: ShellTab.rooms) {
                NavigationStack(path: $path) {
                    RoomsScreen(
                        loadPage: { before in await model.rooms.loadPage(before: before) },
                        onOpenRoom: { room in path.append(roomRoute(for: room.gameId)) },
                        onJoinWithCode: { showJoin = true },
                        joinSheetSource: JoinSheetSource(namespace: joinZoom)
                    )
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationDestination(for: ArrivalRoute.self) { route in
                        destination(route)
                    }
                }
                // The room owns the whole screen (the full-bleed ruling), so the bar
                // hides while anything is pushed. Keyed off the path, NOT attached to
                // the pushed room: a destination's preference flips only when the pop
                // transaction completes, materializing the bar in one frame (owner
                // device report 2026-07-10); the path empties at the start of the
                // pop, so the bar rides the same animation the room leaves by.
                .toolbar(path.isEmpty ? .visible : .hidden, for: .tabBar)
            }
            Tab(ArrivalCopy.puzzlesTitle, systemImage: "squareshape.split.3x3", value: ShellTab.puzzles) {
                PuzzlesScreen(
                    loadPage: { before in await model.puzzles.loadPage(before: before) })
            }
            Tab(ArrivalCopy.settingsTitle, systemImage: "gearshape", value: ShellTab.settings) {
                settingsTab
            }
        }
        // The selected tab wears ink, not the system blue: chrome stays achromatic
        // (people and the destructive tone are the only color, DESIGN.md §1).
        .tint(Color(rgb: ground.tokens.ink))
    }

    /// The join surface: a glass sheet grown from the Join capsule, camera-first
    /// with the typed path always beneath (DESIGN.md §4). Success dismisses the
    /// sheet and makes the room the sole pushed element (the old push replaced
    /// the join route on the path; the sheet replaces that step exactly), so back
    /// from the room is Rooms, never a stale code field. The camera's standing
    /// resolves as the sheet rises; scanning works in every composition (a
    /// payload is digested locally), the fixture just stubs where the join goes.
    private var joinSheet: some View {
        // A failed deep link opens this pre-filled and code-only (scanState .none):
        // a tapped invite must never trigger a camera prompt. A hand-tapped Join is
        // the camera-first panel.
        let prefilled = !deepLinkPrefill.isEmpty
        return JoinCodeScreen(
            scanState: prefilled ? .none : joinScan,
            initialCode: deepLinkPrefill,
            onJoin: { code in
                switch await model.rooms.join(code: code) {
                case .success(let gameId):
                    showJoin = false
                    path = [roomRoute(for: gameId)]
                    return nil
                case .failure(let failure):
                    return failure
                }
            }
        ) { onScan in
            CameraScanView(onScan: onScan)
        }
        .presentationDetents([
            .fraction(
                prefilled
                    ? JoinSheetPresentation.detentFraction
                    : JoinSheetPresentation.scanDetentFraction)
        ])
        .presentationDragIndicator(.visible)
        .joinSheetZoom(from: JoinSheetSource(namespace: joinZoom))
        .task {
            // The pre-filled failure card scans nothing, so it never probes the
            // camera (no permission prompt on a tapped link).
            guard !prefilled else { return }
            joinScan = .probing
            joinScan = await CameraScanAuthority.resolve() ? .live : .denied
        }
    }

    /// The Settings tab (roadmap I3, thin settings). Sign out and a confirmed delete
    /// both flip the session phase to signed out, so the shell itself swaps to
    /// Welcome; a delete failure renders inline on the screen and stays retryable.
    /// The harness identity (an injected token) carries no display facts, so its tab
    /// is a quiet canvas rather than an invented person.
    @ViewBuilder
    private var settingsTab: some View {
        if let identity = model.selfIdentity {
            SettingsScreen(
                identity: identity,
                versionLabel: model.versionLabel,
                onSignOut: {
                    Task { await model.session.signOut() }
                },
                onDeleteAccount: {
                    await model.session.deleteAccount()
                })
        } else {
            Color(rgb: ground.tokens.canvas).ignoresSafeArea()
        }
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
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
