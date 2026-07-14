//
//  ReactionLab.swift
//  Crossy
//
//  The Wave 7.5 motion rig (the MeltLab precedent): deterministic reaction states
//  over a REAL grid — the same CrossyGridView, sticker layer, and envelopes the room
//  ships, never a second renderer — so the owner judges the slap, the pile, the
//  coalesce pulse, and the fan on device with no teammates needed. Launch with
//  -reactionLab. The buttons below place stickers through the same ReactionModel
//  calls the wire uses; the fan is the shipping component firing at the tapped cell.
//
//  Scenes:
//    Single      one 🎉 lands at the selected cell (the entry slap: ~9% overshoot)
//    Pile of 4   four senders stack one cell (born-correct scatter; nothing moves)
//    Fifth       a fifth sender replaces the stalest sticker (exit fade, no pop)
//    Coalesce    the same sender repeats: the sticker pulses in place, timer refreshes
//    Any 🔥      an emoji outside the send set renders anyway (receive-any, §9)
//    Settle pair the #245 proof: a fresh sticker beside a pre-settled twin; after
//                1.2 s they must rest pixel-identically (watch the fresh one cross
//                its settle boundary with no snap)
//    Burst 8     eight rapid sends; the 5/s window accepts five (the counter shows)
//
//  Toggles: Reduce Motion preview (upright, fade-only), receive haptics (the
//  ReactionSettings default the room reads), the fan's standing/hold grammar.
//
//  Evidence only: nothing in the room composes through this screen.
//

import CrossyDesign
import CrossyProtocol
import CrossyStore
import CrossyUI
import SwiftUI

@MainActor
struct ReactionLab: View {
    @State private var store: GameStore
    @State private var reactions = ReactionModel()
    @State private var fan = ReactionFanModel()
    @State private var selection: GridSelection
    @State private var reduceMotionPreview = false
    @State private var receiveHaptics = ReactionSettings.receiveHapticsEnabled
    @State private var burstAccepted: Int?
    @State private var lastFired: String?
    private let puzzle: GridPuzzle
    @Environment(\.colorScheme) private var colorScheme

    init() {
        let fixture = DemoFixture.mini9()
        puzzle = fixture.puzzle
        _selection = State(initialValue: GridSelection(cell: 12, isAcross: true))
        let store = GameStore()
        store.receive(.welcome(fixture.welcome))
        _store = State(initialValue: store)
    }

    private var ground: GridGround {
        colorScheme == .dark ? .observatory : .studio
    }

    private var now: TimeInterval { Date().timeIntervalSinceReferenceDate }

    var body: some View {
        VStack(spacing: 0) {
            stage
                .frame(height: 360)
            controls
        }
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
    }

    // MARK: - The stage (the real grid, the real sticker layer)

    private var stage: some View {
        CrossyGridView(
            store: store, puzzle: puzzle, ground: ground,
            selection: selection,
            reactions: reactions,
            // The rig's Reduce Motion preview: the system value is the system's to
            // set, so the grid takes the simulation explicitly (lab-only hook).
            simulatesReduceMotion: reduceMotionPreview,
            onPlaceCursor: { cell in
                selection = GridSelection(cell: cell, isAcross: selection.isAcross)
            }
        )
        // The shipping fan, standing over the stage's corner: hold-slide-release
        // fires at the selected cell; a plain tap stands it open for tap-tap.
        .overlay(alignment: .bottomTrailing) {
            ReactionFan(fan: $fan, ground: ground) { emoji in
                fire(emoji)
            }
            .padding(.trailing, 14)
            .padding(.bottom, 12)
        }
    }

    private func fire(_ emoji: String) {
        lastFired = emoji
        guard
            reactions.send(
                userId: "you", emoji: emoji, cell: selection.cell, at: now)
        else { return }
        SolveHaptics.shared.play(.reactionSent)
    }

    // MARK: - The scenes

    private var controls: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                caption(
                    "Tap a cell to aim, then run a scene. Every sticker below goes "
                        + "through the shipping model and envelopes; nothing here is "
                        + "a mock.")

                scene("Single sticker", detail: "one 🎉: the entry slap, ~9% overshoot") {
                    reactions.receive(userId: "bee", emoji: "🎉", cell: selection.cell, at: now)
                }
                scene("Pile of four", detail: "four senders, one cell: seeded scatter, nothing moves") {
                    for user in ["bee", "ada", "gus", "kit"] {
                        reactions.receive(userId: user, emoji: "🎉", cell: selection.cell, at: now)
                    }
                }
                scene("Fifth replaces oldest", detail: "the stalest sticker exits; incumbents hold still") {
                    reactions.receive(userId: "mo", emoji: "👀", cell: selection.cell, at: now)
                }
                scene("Coalesce pulse", detail: "Bee repeats 🎉: a pulse in place, never a second sprite") {
                    reactions.receive(userId: "bee", emoji: "🎉", cell: selection.cell, at: now)
                }
                scene("Receive-any 🔥", detail: "outside the send set, rendered anyway (§9)") {
                    reactions.receive(userId: "bee", emoji: "🔥", cell: selection.cell, at: now)
                }
                scene(
                    "Settle pair",
                    detail: "a fresh sticker beside a twin born 1.5 s ago (already "
                        + "settled); after 1.2 s the pair must rest identically, and "
                        + "the fresh one must cross its settle boundary with no snap "
                        + "(the web #245 proof)"
                ) {
                    let left = max(0, selection.cell - 1)
                    reactions.receive(userId: "pair", emoji: "🫡", cell: left, at: now - 1.5)
                    reactions.receive(userId: "pair", emoji: "🫡", cell: selection.cell, at: now)
                }
                scene("Burst of eight", detail: burstDetail) {
                    var accepted = 0
                    for index in 0..<8 {
                        let cell = (selection.cell + index) % puzzle.cellCount
                        if puzzle.blocks.contains(cell) { continue }
                        if reactions.send(userId: "you", emoji: "🎉", cell: cell, at: now) {
                            accepted += 1
                        }
                    }
                    burstAccepted = accepted
                }
                scene("Clear the board", detail: "drop every sticker") {
                    reactions.removeAll()
                    burstAccepted = nil
                }

                toggles
            }
            .padding(16)
        }
    }

    private var burstDetail: String {
        if let burstAccepted {
            return "the 5/s window accepted \(burstAccepted) of 8"
        }
        return "eight rapid sends; the 5/s sliding window accepts five"
    }

    private var toggles: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $reduceMotionPreview) {
                labelText(
                    "Reduce Motion preview",
                    detail: "upright, fade-only; the pulse and the slap stand down")
            }
            Toggle(
                isOn: Binding(
                    get: { receiveHaptics },
                    set: { on in
                        receiveHaptics = on
                        ReactionSettings.receiveHapticsEnabled = on
                    })
            ) {
                labelText(
                    "Receive haptics",
                    detail: "the room's soft tap when a sticker lands near your word "
                        + "(defaults on; this writes the shipping setting)")
            }
            if let lastFired {
                Text(verbatim: "Fan fired \(lastFired) at cell \(selection.cell)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
            }
            caption(
                "Fan grammar: hold the button and slide up to an emoji, release to "
                    + "fire; release elsewhere cancels. A plain tap stands the fan "
                    + "open (tap an emoji, tap away, or wait ~3 s). Launch the demo "
                    + "room with -reactionFanDeckEdge for the alternate placement.")
        }
        .padding(.top, 6)
    }

    // MARK: - Furniture

    private func scene(
        _ title: String, detail: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            labelText(title, detail: detail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color(rgb: ground.tokens.ink).opacity(0.06)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func labelText(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
            Text(verbatim: detail)
                .font(.system(size: 12))
                .foregroundStyle(Color(rgb: ground.tokens.number))
        }
    }

    private func caption(_ text: String) -> some View {
        Text(verbatim: text)
            .font(.system(size: 12))
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .fixedSize(horizontal: false, vertical: true)
    }
}
