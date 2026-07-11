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
    /// The clue bar wraps long clues to this many lines (owner ruling
    /// 2026-07-10, the ClueFitLab verdict: three lines, the bar breathes).
    /// Three carries the worst honest clue on the narrowest phone; past the
    /// cap the ellipsis returns.
    static let clueLineCap = 3
    /// Air above and below a wrapped clue block. One line comes to less than
    /// the standing bar and floors at barHeight, so a short clue's bar is
    /// pixel-identical to the fixed bar it replaced.
    static let clueAirPadding: CGFloat = 13
    /// The bar's chevron slot; the layout twin (ClueBarSizer) reserves the
    /// same span so the slot and the pinned row wrap at one width.
    static let clueChevronWidth: CGFloat = 36
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

/// The feather (the full-bleed ruling, owner ask 2026-07-10): the clue bar
/// floats over live board content now, so a wash of the ground's canvas fades
/// up from beneath the glass, legibility with no hard edge. Both grounds ride
/// the same numbers through their canvas token (ID-3).
enum ClueFeather {
    /// How far above the bar's top edge the wash fades to nothing.
    static let extent: CGFloat = 40
    /// The wash behind the glass bar itself: strong enough that ink on glass
    /// never fights a block cell, short of opaque so the bleed stays honest.
    static let barAlpha: Double = 0.88
    /// The soft knee partway up the fade, so the ramp reads as a feather
    /// rather than a linear wedge.
    static let kneeAlpha: Double = 0.32
    static let kneeLocation: CGFloat = 0.55
}

extension GridOcclusion {
    /// The STANDING cover for the camera's clamp: the room bar above, the
    /// one-line clue bar plus feather below. The bottom is built from constants
    /// on purpose (the bar HEIGHT, never the live slot), so the clamp is a
    /// fixed fact and clue length can never move the board.
    static func standing(board: CGRect?, roomBar: CGRect?) -> GridOcclusion {
        guard let board else { return .none }
        return GridOcclusion(
            top: max(0, (roomBar?.maxY ?? board.minY) - board.minY),
            bottom: ChromeLayout.barHeight + ClueFeather.extent)
    }

    /// The LIVE cover the selected cell must escape: the wrapped bar's actual
    /// slot plus feather. Feeds only the camera's follow (GridCamera.following
    /// keepClear), so a breathing bar rescues the one occluded cell and moves
    /// nothing else.
    static func keepClear(board: CGRect?, roomBar: CGRect?, clueSlot: CGRect?) -> GridOcclusion {
        guard let board else { return .none }
        let standing = standing(board: board, roomBar: roomBar)
        guard let clueSlot else { return standing }
        return GridOcclusion(
            top: standing.top,
            bottom: max(standing.bottom, board.maxY - clueSlot.minY + ClueFeather.extent))
    }
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
    /// The full-bleed board itself: the camera's occlusion insets are the
    /// chrome frames converted into the board's own space, so the board
    /// reports where layout actually put it (never a hard-coded safe-area
    /// guess).
    case board
    /// The time pill, whole: the facts card's rest surface (the time pill is
    /// the room's facts, owner ruling 2026-07-10; at completion the card is
    /// the stats card, ID-2). The clock-glyph sub-frame it once reported went
    /// with the retired rider (redesign 2026-07-11).
    case timePill
    /// The back button (owner ruling 2026-07-10, replacing the retired
    /// leading pill): no morph rests on it, but a panel that eclipses it must
    /// know its frame (PanelEclipse).
    case backButton
    /// The share pill (owner ask 2026-07-11): the share card's rest surface,
    /// the facts morph's exact grammar on a second pill.
    case sharePill
}

/// DESIGN.md §4, the Mail-button rule's corollary: a panel covers its own pill
/// by right, and any OTHER standing pill it happens to eclipse yields for the
/// panel's life. Glass over glass refracts the buried pill's content through
/// the panel's surface (the -stress mockups caught the leading pill's name
/// mirrored inside the stats card's top edge), so an eclipsed pill hands off
/// exactly like a morph rest and returns on dismissal.
enum PanelEclipse {
    /// A hairline graze is not an eclipse: the pill insets before the test so
    /// pills that merely abut the panel's edge stay standing.
    static func eclipses(panel: CGRect, pill: CGRect) -> Bool {
        panel.intersects(pill.insetBy(dx: 4, dy: 4))
    }
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
