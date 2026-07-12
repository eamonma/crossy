//
//  GooLab.swift
//  Crossy
//
//  The persistent-glass-chrome-layer spike (SP-i6). One question, owner's
//  words: can the Rooms screen's Join capsule GOO into the room header's pill
//  cluster (back button + time pill) when a room opens? The goo is Apple's
//  glass shader blending two shapes' fields (the Mail-menu finding, DESIGN.md
//  §4), and that fusion only happens between SIBLINGS of ONE
//  GlassEffectContainer in ONE hierarchy. A room open is a NavigationStack
//  push, so the two production screens live in two hierarchies and cannot goo
//  today.
//
//  The candidate this lab tests: a PERSISTENT CHROME LAYER mounted ABOVE the
//  screen swap, owning both endpoint shapes in one container, swapping its
//  children when the "route" changes so the system melts one into the other.
//  This is the ratified tap-open exception (DESIGN.md §4, 2026-07-11): the
//  facts card already rides the system's metaball materialize on 26+; SP-i1's
//  glassEffectID ban is scoped to DRAG-scrubbed morphs, and a navigation tap
//  is not a scrub.
//
//  Four variants, one selector (-gooLab A|B|C|D), routed like -morphLab:
//
//  A  the near swap. One GlassEffectContainer; a tap swaps a fake rooms list
//     for a fake room underneath while, inside the container, the Join-capsule
//     child is removed and the back-pill + time-pill children are inserted.
//     matchedGeometry vs materialize, a toggle. Do near shapes goo?
//  B  the traveling melt. The capsule TRAVELS from Join's top-trailing spot to
//     the back button's top-leading spot while the time pill materializes out
//     of it mid-flight. Two mechanisms A/B'd: one persistent glass element
//     whose frame+shape animate (the SP-i1 single-surface law, extended to a
//     tap), vs a glassEffectID matched swap across the same distance (allowed
//     here: tap-driven, never scrubbed). Which reads as Mail-quality goo?
//  C  the distance law. Sweep travel distance / container spacing and record
//     where the metaball stops blending and degrades to a crossfade. §10 pins
//     a fuse threshold for the deck keys (spacing 24 fused them, cluster 6
//     stays separate); this extends that finding to a traveling morph.
//  D  the real-seam rehearsal. The same chrome layer mounted OVER an actual
//     NavigationStack push (a fixture list pushing a fixture room), the swap
//     fired on path-change commit (the tab-bar timing: the path empties/fills
//     at the transition's start). navigationTransition(.zoom) ON and OFF
//     underneath (PR #132's mechanism); an interactive back-swipe against the
//     commit-driven chrome swap.
//
//  All four are TAP-driven, so SP-i1's melt law (finger writes raw progress)
//  does not govern them; the system owns the blend. Verdicts come from the
//  DEVICE only: the simulator renders the glass blend linearly and lies about
//  goo (MorphLab's standing caveat). Evidence only; nothing in the room
//  composes through this screen.
//

import CrossyUI
import SwiftUI

// MARK: - The register (production chrome vocabulary, replicated)

/// ChromeLayout's numbers, replicated here (they are internal to CrossyUI, the
/// MeltLab precedent). The feel must transfer, so the lab cluster is the real
/// register: pill height 44, gap 8, cluster blend 6 (below the fuse, so the two
/// standing pills read as separate objects at rest), panel corner 24. The Join
/// capsule is the arrival grammar (RoomsScreen.joinAffordance): height 40,
/// corner 20, qrcode.viewfinder + "Join".
enum GooLayout {
    static let pillHeight: CGFloat = 44
    static var pillCorner: CGFloat { pillHeight / 2 }
    static let pillGap: CGFloat = 8
    /// The cluster's own blend, below the metaball fuse (ChromeLayout.pillClusterBlend).
    static let clusterBlend: CGFloat = 6
    static let panelCorner: CGFloat = 24
    /// The Join capsule's own geometry (RoomsScreen).
    static let joinHeight: CGFloat = 40
    static let joinCorner: CGFloat = 20
    /// Where the chrome layer sits below the safe-area top: the room bar's own
    /// resting inset (the cluster stands here in the real room).
    static let chromeTop: CGFloat = 8
    static let sideInset: CGFloat = 16
}

enum GooTiming {
    /// Mail's measured open/close (MorphLab's frame study; MetaballRecipe).
    static let open: TimeInterval = 0.35
    static let close: TimeInterval = 0.18
}

// MARK: - A HUD ribbon shared by every variant

/// A small caption + toggle ribbon at the bottom of each lab, so the owner can
/// read what mechanism is live and flip its one axis by hand (the MeltLab
/// switcher precedent). Achromatic, out of the way, never glass (it must not
/// enter the goo it describes).
struct GooRibbon<Controls: View>: View {
    let title: String
    let detail: String
    @ViewBuilder let controls: () -> Controls

    var body: some View {
        VStack(spacing: 8) {
            controls()
            VStack(spacing: 2) {
                Text(verbatim: title)
                    .font(.system(size: 12, weight: .semibold))
                Text(verbatim: detail)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(.white.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}

/// The two glass transitions the lab A/Bs, named for the ribbon.
enum GooTransition: String, CaseIterable, Identifiable {
    case matchedGeometry = "matchedGeometry"
    case materialize = "materialize"
    var id: String { rawValue }
}

// MARK: - The selector

enum GooVariant: String, CaseIterable, Identifiable {
    case a = "A"
    case b = "B"
    case c = "C"
    case d = "D"

    var id: String { rawValue }

    static func resolve() -> GooVariant {
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-gooLab"),
            args.indices.contains(i + 1),
            let v = GooVariant(rawValue: args[i + 1].uppercased())
        {
            return v
        }
        return .a
    }
}

// MARK: - The lab root

struct GooLab: View {
    private let variant = GooVariant.resolve()

    var body: some View {
        Group {
            switch variant {
            case .a: NearSwapLab()
            case .b: TravelingMeltLab()
            case .c: DistanceLawLab()
            case .d: RealSeamLab()
            }
        }
        .background(GooPaper().ignoresSafeArea())
    }
}

// MARK: - Shared fixture content (the paper below the chrome)

/// A fake "rooms list" and a fake "room board": plain paper so the chrome layer
/// is the only glass on screen and the goo has nothing to fight. The board is a
/// coarse grid so a room reads as a room at a glance.
struct GooPaper: View {
    var body: some View {
        Color(red: 0.949, green: 0.945, blue: 0.925)
    }
}

struct FakeRoomsList: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: "Rooms")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
                    .padding(.top, 60)
                ForEach(0..<8, id: \.self) { i in
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(.white)
                        .frame(height: 76)
                        .overlay(alignment: .leading) {
                            Text(verbatim: ["Sunday quiet", "Tuesday themeless",
                                "The Wednesday", "Friday crew", "Saturday stumper",
                                "Mini break", "Late shift", "Morning solve"][i])
                                .font(.system(size: 17, weight: .medium))
                                .foregroundStyle(.black.opacity(0.8))
                                .padding(.leading, 18)
                        }
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 40)
        }
    }
}

struct FakeRoomBoard: View {
    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height) - 48
            let cells = 5
            let cell = side / CGFloat(cells)
            VStack(spacing: 0) {
                ForEach(0..<cells, id: \.self) { r in
                    HStack(spacing: 0) {
                        ForEach(0..<cells, id: \.self) { c in
                            Rectangle()
                                .fill((r + c).isMultiple(of: 3) ? .black : .white)
                                .frame(width: cell, height: cell)
                                .overlay(Rectangle().stroke(.black.opacity(0.12), lineWidth: 0.5))
                        }
                    }
                }
            }
            .frame(width: side, height: side)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
    }
}

// MARK: - The endpoint shapes (production register)

/// The Join capsule, the arrival grammar (RoomsScreen.joinAffordance). Its own
/// glass, its own geometry, so the goo's departing shape is the real one.
struct GooJoinCapsule: View {
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 16, weight: .semibold))
            Text(verbatim: "Join")
                .font(.system(size: 15, weight: .semibold))
        }
        .foregroundStyle(.black.opacity(0.85))
        .padding(.horizontal, 16)
        .frame(height: GooLayout.joinHeight)
    }
}

/// The room bar's back button (RoomBar.backButton): circular standing glass in
/// the compact-toolbar register, the chevron ink.
struct GooBackButton: View {
    var body: some View {
        Image(systemName: "chevron.backward")
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(.black.opacity(0.85))
            .frame(width: GooLayout.pillHeight, height: GooLayout.pillHeight)
    }
}

/// The time pill (RoomBar.timePill): weather dot beside the ambient clock. The
/// cluster's second member (the players/share pills stand outside the container
/// in production, a Menu breaks a container morph on 26.1, so the lab cluster is
/// back button + time pill only, matching production's container membership).
struct GooTimePill: View {
    var body: some View {
        HStack(spacing: 6) {
            Circle().fill(.black.opacity(0.7)).frame(width: 7, height: 7)
            Text(verbatim: "4:12")
                .font(.system(size: 13, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(.black.opacity(0.55))
        }
        .padding(.horizontal, 12)
        .frame(height: GooLayout.pillHeight)
    }
}
