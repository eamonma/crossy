// The chrome's one material (apps/ios/DESIGN.md §4): frosted glass for standing
// pieces, rendered by a single modifier so every surface gates identically. iOS 26+
// wears `glassEffect(.regular)` in an interpolating rounded rect (SP-i1: live glass
// at every intermediate geometry); 18 through 25 wear the system's regular blur
// material at the same geometry and motion, one fallback for all chrome, never a
// second design system (KeyDeck's gating pattern; macOS test builds compile the
// fallback and never name a glass symbol). Chrome never tints (the never-list):
// nothing here takes a color.

import CoreGraphics
import CrossyDesign
import SwiftUI

/// Fixed chrome geometry. Bars share the capsule register (Panton contribution,
/// DESIGN.md §5; the room bar must condense into the island later, so its shape is
/// the island's); panels relax to a softer corner as they grow.
enum ChromeLayout {
    /// Standing bar height: comfortable at arm's length, two thumbs of chrome.
    static let barHeight: CGFloat = 52
    /// The horizontal inset every chrome piece and the deck share.
    static let inset: CGFloat = 12
    /// A capsule's radius at bar height.
    static var barCornerRadius: CGFloat { barHeight / 2 }
    /// The room bar's pills (owner ruling 2026-07-10: a cluster of glass pills,
    /// not one bar): the compact-toolbar register, smaller than a standing bar.
    static let pillHeight: CGFloat = 44
    /// A capsule's radius at pill height.
    static var pillCornerRadius: CGFloat { pillHeight / 2 }
    /// Air between pills in the cluster.
    static let pillGap: CGFloat = 8
    /// The cluster's GlassEffectContainer spacing. SP-i1's caution (DESIGN.md
    /// §10): container spacing metaball-fuses adjacent glass, and 24 melted the
    /// deck's keys into wavy rows. The deck's 6 is the hardware-proven discrete
    /// value at 6 pt gaps; the pills sit farther apart than the keys did, so 6
    /// keeps the cluster three separate objects at rest.
    static let pillClusterBlend: CGFloat = 6
    /// Open panels (the browser, the roster).
    static let panelCornerRadius: CGFloat = 24
    /// Air between the room bar and an open panel's top edge.
    static let panelTopGap: CGFloat = 8
    /// The named coordinate space every chrome frame is measured in.
    static let roomSpace = "crossy.room"
}

/// The chrome spring (DESIGN.md §7): small, no overshoot. The ONE animation a morph
/// runs, on release or on a tap, never while a finger is down.
extension Animation {
    static var crossyChrome: Animation {
        .spring(
            response: Motion.Springs.chromeResponse,
            dampingFraction: Motion.Springs.chromeDampingFraction)
    }
}

/// The clarity beat (apps/ios/DESIGN.md §4, §8): during the mosaic all standing
/// glass momentarily clears, then refrosts as the stats arrive. An environment
/// flag so every ChromeGlassSurface clarifies together with no call-site changes.
/// iOS 26 glass only: §8 names no fallback, so the 18-25 blur material stays
/// inert (never faked with opacity tricks).
private struct ChromeClarifiedKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    var chromeClarified: Bool {
        get { self[ChromeClarifiedKey.self] }
        set { self[ChromeClarifiedKey.self] = newValue }
    }
}

/// Frosted standing glass at an interpolating corner radius, with the §4 fallback.
/// During the clarity beat the register swaps to clear (§4: clear is the glass
/// for events, and completion is the one scripted moment standing chrome joins).
struct ChromeGlassSurface: ViewModifier {
    let cornerRadius: CGFloat

    @Environment(\.chromeClarified) private var clarified

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                content
                    .glassEffect(clarified ? .clear : .regular, in: shape)
                    .animation(.crossyChrome, value: clarified)
            } else {
                fallback(content)
            }
        #else
            fallback(content)
        #endif
    }

    private func fallback(_ content: Content) -> some View {
        content.background(shape.fill(.regularMaterial))
    }
}

// MARK: - Frame plumbing

/// The chrome pieces whose room-space frames the solve screen needs: the melt's
/// rest and travel are functions of where layout actually put the bar and the
/// room bar, never of hard-coded numbers.
enum ChromePiece: Hashable {
    case roomBar
    case clueBarSlot
    /// The players pill, whole: the roster morph's rest surface (DESIGN.md §4:
    /// the players pill inflates into the roster sheet), so the panel is always
    /// the pill reshaped, never new glass conjured over old.
    case playersPill
    /// One cluster puck's frame, by userId: the roster morph's riders launch
    /// from where layout actually put each person (DESIGN.md §4: content rides
    /// the morph), never from arithmetic about the cluster's innards.
    case puck(String)
    /// The time pill, whole: the stats morph's rest surface (ID-2, the timer
    /// becomes the headline at completion; the pill centers its clock, so the
    /// rider's launch point is the pill's own center).
    case timePill
}

struct ChromeFramesKey: PreferenceKey {
    static let defaultValue: [ChromePiece: CGRect] = [:]

    static func reduce(value: inout [ChromePiece: CGRect], nextValue: () -> [ChromePiece: CGRect]) {
        value.merge(nextValue()) { _, next in next }
    }
}

extension View {
    /// Report this view's frame in the room's coordinate space.
    func reportChromeFrame(_ piece: ChromePiece) -> some View {
        background(
            GeometryReader { proxy in
                Color.clear.preference(
                    key: ChromeFramesKey.self,
                    value: [piece: proxy.frame(in: .named(ChromeLayout.roomSpace))])
            })
    }
}
