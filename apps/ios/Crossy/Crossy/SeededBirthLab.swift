//
//  SeededBirthLab.swift
//  Crossy
//
//  The seeded-birth evidence rig (DESIGN.md §4, the seeded-birth rule, §12).
//  Evidence only: nothing in the room composes through this screen.
//
//  The live path proves the goo only against a running backend (a card tap seeds the
//  room, RealRoomView withholds SolveScreen until REST lands, and the #132 zoom push
//  goos the standing pills). The offline sim cannot reach it, and the -i3Fixture cards
//  open the loopback DemoRoom (which mounts SolveScreen instantly), so this rig stands
//  the SEEDED WITHHOLDING frame directly for a still capture: the RoomOpening quiet
//  canvas under a RoomOpeningToolbarHost fed a TRUE seed (a card-like member stack with
//  a host, a solver, and a guest-spectator, plus an invite code), through the exact
//  same RoomOpeningSeed → RosterMenu → RosterList.cluster path a live seeded room uses.
//
//  So the capture proves what the offline walk cannot: the withholding frame ALREADY
//  shows OUR back button, the identity-true players pill (the host and the solver, the
//  guest-spectator FILTERED OUT by the solvers-only rule, never a hollow puck), and the
//  share pill (its menu payload complete from the seeded code), while the timer is
//  ABSENT (welcome-gated). The welcome then inserts only the timer alongside the same
//  standing players and share (the full-bar capture from the DemoRoom shows that beat).
//

import CrossyDesign
import CrossyUI
import SwiftUI

/// The seeded-birth rig (DESIGN.md §4, §12). Reached by `-seededBirthLab`. Stands the
/// withholding room's seeded bar so the identity-true players and share pills, standing
/// before any board or welcome, are capturable offline.
struct SeededBirthLab: View {
    @Environment(\.colorScheme) private var colorScheme

    private var ground: GridGround { colorScheme == .dark ? .observatory : .studio }

    /// A card-like member stack: a host, a solver, and a guest-spectator, each
    /// not-yet-heard-from (`connected: false`, the seed's liveness). The solvers-only
    /// pill filter (RosterList.cluster) drops the spectator, so the pill shows two
    /// pucks, identity-true, never a hollow one.
    private var seedMembers: [RosterMember] {
        [
            RosterMember(
                userId: "ada", displayName: "Ada", wireColor: "",
                avatarUrl: nil, isHost: true, isSpectator: false, connected: false),
            RosterMember(
                userId: "bee", displayName: "Bee", wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: false, connected: false),
            RosterMember(
                userId: "guest", displayName: "Guest", wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: true, connected: false),
        ]
    }

    /// The seeded trailing cluster (the same RoomOpeningSeed the composition root
    /// builds): identity-true players and a share pill from a live invite code.
    private var seed: RoomOpeningSeed {
        let url = ShareInvite.url(gameId: "lab-room", code: "SEEDED01")
        return RoomOpeningSeed(
            members: seedMembers,
            selfUserId: nil,
            shareCode: "SEEDED01",
            shareUrlString: url?.absoluteString)
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                // The withholding frame: the quiet canvas (the RoomOpening ground) under
                // the seeded bar, the exact composition RealRoomView carries pre-board.
                Color(rgb: ground.tokens.canvas)
                    .ignoresSafeArea()
                    .modifier(
                        RoomOpeningToolbarHost(ground: ground, seed: seed, onBack: {}))
                    .modifier(RoomNavBarChrome())

                Text(
                    verbatim:
                        "withholding, seeded: back + players (host, solver) + share standing, "
                        + "guest-spectator filtered, timer absent (welcome-gated)")
                    .font(.system(size: 12, weight: .medium).monospaced())
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(8)
                    .background(.black.opacity(0.7), in: RoundedRectangle(cornerRadius: 8))
                    .padding(16)
            }
        }
    }
}
