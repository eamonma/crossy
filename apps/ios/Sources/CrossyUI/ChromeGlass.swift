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
    /// Still the register the below-26 Menu labels render in (RosterMenu /
    /// ShareMenuPill fallback material); on 26 the system bar shapes its own items.
    static let pillHeight: CGFloat = 44
    /// A capsule's radius at pill height.
    static var pillCornerRadius: CGFloat { pillHeight / 2 }
    // pillGap and pillClusterBlend retired with the hand-drawn cluster (the
    // toolbar-adoption ruling, DESIGN.md §4): the system nav bar owns the item
    // spacing now, and a ToolbarSpacer splits each trailing pill. The metaball
    // facts card keeps its own container spacing (MetaballRecipe), which was
    // never the cluster's blend.
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
    /// one-line clue bar plus feather below. BOTH edges are built from constants
    /// on purpose (DESIGN.md §2, the standing-inset law): the top is the system
    /// bar's height (the room container's top safe-area inset, the band the board
    /// bleeds under, constant-built and never a reported bar-item frame), and the
    /// bottom is the bar HEIGHT plus feather. So neither clue length NOR the pill's
    /// arrival can move the board: the grid's top edge is at its final position on
    /// its first rendered frame and never moves (the owner device regression,
    /// 2026-07-12, where the grid loaded high and dropped as the pill materialized,
    /// closed at the root, the inset no longer waiting on any onGeometryChange).
    static func standing(board: CGRect?, topInset: CGFloat) -> GridOcclusion {
        guard board != nil else { return .none }
        return GridOcclusion(
            top: max(0, topInset),
            bottom: ChromeLayout.barHeight + ClueFeather.extent)
    }

    /// The LIVE cover the selected cell must escape: the wrapped bar's actual
    /// slot plus feather. Feeds only the camera's follow (GridCamera.following
    /// keepClear), so a breathing bar rescues the one occluded cell and moves
    /// nothing else. The standing top rides the same constant band (never a
    /// reported frame), so the follow's ceiling holds still across the arrival too.
    static func keepClear(board: CGRect?, topInset: CGFloat, clueSlot: CGRect?) -> GridOcclusion {
        guard let board else { return .none }
        let standing = standing(board: board, topInset: topInset)
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
    // The share pill's frame retired with the share morph card (owner ruling
    // 2026-07-11: share ships as the native menu). A Menu label presents
    // itself, so it needs no morph geometry and reports no frame.
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

    /// Report a system-bar item's GLOBAL frame through an ACTION CLOSURE (the
    /// toolbar-adoption ruling, DESIGN.md §4). A ToolbarItem is hosted by UIKit's
    /// navigation bar, a hierarchy apart from the room's, so a SwiftUI preference
    /// set inside the item never flows back to the room's preference chain (the
    /// integration trap: the first cut used a preference and the facts card never
    /// opened, the pill's frame never arriving). `.onGeometryChange`'s action runs
    /// regardless of preference propagation, so the item hands its global frame
    /// straight to the solve screen's sink, which converts it into room space
    /// against the room's own global origin (BarItemFrames.inRoomSpace). The facts
    /// card still launches from the pill's true frame, only measured differently.
    /// `.onGeometryChange` is iOS 18 / macOS 15; the macOS test host (14) and any
    /// older floor take the inert path (the room never renders on macOS; tests are
    /// pure), the KeyDeck gating discipline.
    @ViewBuilder
    func reportBarItemFrame(
        _ piece: ChromePiece, into sink: @escaping (ChromePiece, CGRect) -> Void
    ) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *) {
                onGeometryChange(for: CGRect.self) { proxy in
                    proxy.frame(in: .global)
                } action: { newFrame in
                    sink(piece, newFrame)
                }
            } else {
                self
            }
        #else
            self
        #endif
    }
}

/// Reads the room container's TOP SAFE-AREA INSET, the system bar's standing
/// height (DESIGN.md §2, the constant-built board inset, SLICE C). Under the
/// visible, transparent nav bar the container's top safe-area inset IS the bar's
/// bottom edge, exactly the band the full-bleed board bleeds under, so this is the
/// grid's standing top occlusion, constant-built from the container's own layout
/// and never a welcome-gated bar-item frame. The container reports it before the
/// first paint (it is layout, not an item that arrives with the room's data), so
/// the board's top edge is final on frame one and never moves when the pill lands.
/// `.onGeometryChange` is iOS 18 / macOS 15; the macOS test host (14) and any older
/// floor take the inert path (the room never renders on macOS; tests read the pure
/// GridOcclusion seam directly), the reportBarItemFrame gating discipline.
@available(iOS 17.0, macOS 14.0, *)
struct RoomTopInsetReader: ViewModifier {
    let onChange: (CGFloat) -> Void

    func body(content: Content) -> some View {
        #if os(iOS)
            if #available(iOS 18.0, *) {
                content.onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.safeAreaInsets.top
                } action: { top in
                    onChange(top)
                }
            } else {
                content
            }
        #else
            content
        #endif
    }
}

/// Converts the bar items' global frames into the room's coordinate space (the
/// toolbar-adoption ruling, DESIGN.md §4). Pure so it is pinned in tests: the
/// facts card's rest geometry depends on it, so a wrong offset would launch the
/// card from the wrong place. A nil room origin (not yet measured) yields
/// nothing, so the morph withholds until the geometry is real.
enum BarItemFrames {
    /// One item's global frame minus the room's global origin. The room space's
    /// origin IS the room ZStack's global frame origin (the coordinate space is
    /// named on that ZStack), so subtracting it maps global → room space.
    static func inRoomSpace(_ global: CGRect, roomOrigin: CGPoint) -> CGRect {
        global.offsetBy(dx: -roomOrigin.x, dy: -roomOrigin.y)
    }

    /// Convert a whole set of bar-item globals into room space at once.
    static func inRoomSpace(_ globals: [ChromePiece: CGRect], roomOrigin: CGPoint?)
        -> [ChromePiece: CGRect]
    {
        guard let roomOrigin else { return [:] }
        return globals.mapValues { inRoomSpace($0, roomOrigin: roomOrigin) }
    }

    /// The synthesized `roomBar` rect (the toolbar-adoption ruling, DESIGN.md §4;
    /// the standing-inset law, DESIGN.md §2). The hand-drawn bar retired, so the
    /// bar's room-space rect is derived from the bar items' converted frames: it
    /// spans the board's width (inset like every chrome piece) at the bar's row,
    /// so `standing.top` measures from the board's bled top edge down to the bar's
    /// bottom exactly as the reported bar did.
    ///
    /// The vertical band is ANCHORED ON THE BACK BUTTON, which stands in the bar
    /// row from frame one (never gated on the welcome), so the band is IDENTICAL
    /// before and after the time pill arrives and the board cannot move by even a
    /// point when the pill materializes (§2: insets are constant-built, clue
    /// length and now pill arrival can never move the board; the empty-pre-welcome
    /// hole this closes moved the grid on the owner's device, 2026-07-12). The
    /// time pill NEVER creates or resizes the band; it only extends the horizontal
    /// clamp the facts card reads (minX/maxX are board-derived, so in practice the
    /// pill changes nothing here, but the rect exists from frame one for the melt
    /// and occlusion regardless). When only the pill's frame exists (a defensive
    /// path, the back button always reports first in the real bar) the band falls
    /// back to it. nil until an anchor and the board land, so the morphs withhold
    /// cleanly.
    static func synthesizedRoomBar(from merged: [ChromePiece: CGRect], inset: CGFloat)
        -> CGRect?
    {
        let anchor = merged[.backButton] ?? merged[.timePill]
        guard let anchor, let board = merged[.board] else { return nil }
        let minX = board.minX + inset
        let maxX = board.maxX - inset
        // The band is the anchor's row alone. The back button is the anchor
        // whenever it exists, so the band's top and bottom are constant across the
        // welcome (the board never moves); the pill does not widen the band.
        return CGRect(
            x: minX, y: anchor.minY,
            width: max(0, maxX - minX), height: anchor.height)
    }
}

/// The room's own global origin, reported so the bar items' global frames convert
/// into room space. A preference (reported inside the room hierarchy, so it does
/// cross back, unlike the toolbar items): one value, not a per-piece map.
struct RoomOriginKey: PreferenceKey {
    static let defaultValue: CGPoint? = nil

    static func reduce(value: inout CGPoint?, nextValue: () -> CGPoint?) {
        if let next = nextValue() { value = next }
    }
}
