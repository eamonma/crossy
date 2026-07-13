// The morph grammar's geometry (apps/ios/DESIGN.md §4, as amended by SP-i1): a morph
// is ONE persistent glass surface whose frame and corner radius interpolate with
// gesture progress. Never two views swapped under glassEffectID (SP-i1: the ID swap
// snaps instead of scrubbing), never a system sheet (SP-i5: grow-then-swap, not the
// melt). This is the law for DRAG-SCRUBBED morphs (the melt) and the stats card;
// tap-opened pill presentations ride the system instead (RosterMenu, the Mail
// mechanism, owner ruling 2026-07-10). Everything here is pure math so the
// interpolation is pinned in tests; the gesture discipline (finger-tracked while
// down, animated only on release) lives at the gesture site in ClueChrome.

import CoreGraphics

/// One glass surface's two shapes and the interpolation between them. `rest` is the
/// standing chrome (the clue bar, the frozen clock); `open` is the panel it melts
/// into. Progress 0 is rest, 1 is open, always clamped.
public struct GlassMorph: Equatable, Sendable {
    public let rest: CGRect
    public let open: CGRect
    public let restCornerRadius: CGFloat
    public let openCornerRadius: CGFloat

    public init(rest: CGRect, open: CGRect, restCornerRadius: CGFloat, openCornerRadius: CGFloat) {
        self.rest = rest
        self.open = open
        self.restCornerRadius = restCornerRadius
        self.openCornerRadius = openCornerRadius
    }

    /// Linear interpolation with the parameter clamped to [0, 1]: a morph never
    /// overshoots its endpoints geometrically, whatever the driving spring does.
    public static func lerp(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat {
        let clamped = min(max(t, 0), 1)
        return a + (b - a) * clamped
    }

    /// The surface's frame at a progress: every edge interpolates independently, so
    /// a bottom-anchored melt (the clue bar: shared maxY, top edge travels) and a
    /// free inflation (the stats card: all four edges travel) are one rule.
    public func frame(at progress: CGFloat) -> CGRect {
        let minX = Self.lerp(rest.minX, open.minX, progress)
        let minY = Self.lerp(rest.minY, open.minY, progress)
        let maxX = Self.lerp(rest.maxX, open.maxX, progress)
        let maxY = Self.lerp(rest.maxY, open.maxY, progress)
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    public func cornerRadius(at progress: CGFloat) -> CGFloat {
        Self.lerp(restCornerRadius, openCornerRadius, progress)
    }

    // MARK: Unclamped geometry (the overshoot blend)

    /// The same blend WITHOUT the clamp, for an overshoot walk: a progress that
    /// breathes a hair past 1 carries the surface past its open frame and
    /// settles back. Anchored edges (rest == open) are fixed points of the
    /// blend, so a panel's shared pill edges never move whatever the spring
    /// does; only the traveling edges breathe. Drag-scrubbed morphs never
    /// call this: the law's clamp (`frame(at:)`, SP-i1) stands untouched. (The
    /// pill inflation that drove this retired with the facts morph, 2026-07-12;
    /// the blend stays as a tested geometry utility.)
    public func frameUnclamped(at progress: CGFloat) -> CGRect {
        let minX = Self.lerpUnclamped(rest.minX, open.minX, progress)
        let minY = Self.lerpUnclamped(rest.minY, open.minY, progress)
        let maxX = Self.lerpUnclamped(rest.maxX, open.maxX, progress)
        let maxY = Self.lerpUnclamped(rest.maxY, open.maxY, progress)
        return CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
    }

    public func cornerRadiusUnclamped(at progress: CGFloat) -> CGFloat {
        // A breath past the endpoints must still be a drawable radius.
        max(0, Self.lerpUnclamped(restCornerRadius, openCornerRadius, progress))
    }

    static func lerpUnclamped(_ a: CGFloat, _ b: CGFloat, _ t: CGFloat) -> CGFloat {
        a + (b - a) * t
    }

    /// The finger's travel budget: how far the surface's top edge moves across the
    /// whole morph. The melt maps drag distance to progress 1:1 against this, so
    /// geometry tracks the finger directly (the SP-i1 discipline), never a scaled
    /// or eased ghost of it.
    public var topEdgeTravel: CGFloat {
        rest.minY - open.minY
    }

    /// Progress for a drag: `base` is the progress where the finger went down and
    /// `translationY` the gesture's vertical translation (negative is up). Clamped;
    /// a degenerate zero-travel morph holds its base rather than dividing by zero.
    public func progress(draggedBy translationY: CGFloat, from base: CGFloat) -> CGFloat {
        guard topEdgeTravel > 0 else { return min(max(base, 0), 1) }
        return min(max(base + (-translationY) / topEdgeTravel, 0), 1)
    }
}

/// The release rule: while the finger is down geometry tracks it; the ONE animation
/// runs on release, settling open or pouring back (the SP-i1 gesture discipline).
/// A flick beats position: a fast upward release opens from low progress and a fast
/// downward one pours back from high, which is how every system sheet feels.
public enum GlassSettle {
    /// Below this progress a still release pours back; at or above it settles open.
    public static let openThreshold: CGFloat = 0.5

    /// The flick: past this vertical speed (points per second) the direction of
    /// travel decides, wherever the finger stopped.
    public static let flickPointsPerSecond: CGFloat = 350

    /// `upwardVelocity` is positive when the finger was moving up at release
    /// (the negation of a DragGesture's predicted vertical velocity).
    public static func settlesOpen(progress: CGFloat, upwardVelocity: CGFloat) -> Bool {
        if upwardVelocity >= flickPointsPerSecond { return true }
        if upwardVelocity <= -flickPointsPerSecond { return false }
        return progress >= openThreshold
    }
}

/// The open browser's swipe-down dismissal (owner ask 2026-07-10): sheet grammar
/// on the melt. With the panel fully open a downward drag anywhere scrubs the
/// melt back under the finger (SP-i1: the finger owns progress), resolved
/// against the scrolling clue list the way system sheets resolve it: the drag
/// takes the surface only when the list rests at its top; otherwise the list
/// scrolls. The pinned row keeps its own bidirectional drag, so this rule
/// stands down there. Pure, so the arbitration is pinned headlessly; the
/// gesture site carries no judgment of its own.
public enum PanelDismiss {
    /// A drag must commit this far down before the surface takes it, so a
    /// wobbling touch on a row still reads as a tap or a scroll.
    public static let takeoverDistance: CGFloat = 12

    /// Whether a drag beginning on the open browser takes the melt.
    /// `progress` is the melt's progress at touch (only a fully open panel
    /// dismisses this way; mid-settle surfaces belong to the row's drag),
    /// `startY`/`headerMaxY` locate the touch against the pinned row (the row
    /// owns its own drag, this rule yields to it), `listAtTop` is the clue
    /// list's resting fact, and `translation` the drag so far.
    public static func takes(
        progress: CGFloat, startY: CGFloat, headerMaxY: CGFloat,
        listAtTop: Bool, translation: CGSize
    ) -> Bool {
        guard progress >= 1 else { return false }
        guard startY > headerMaxY else { return false }
        guard listAtTop else { return false }
        // Downward and vertical-dominant, past the commit distance: anything
        // else is the list's scroll or a row's tap.
        guard translation.height >= takeoverDistance else { return false }
        return translation.height > abs(translation.width)
    }
}

/// Content opacity inside a morphing surface. The clue bar's row rides the surface
/// (it IS the pinned row, so it never fades); the browser list below it fades in
/// late so mid-drag the surface reads as clean glass, and fades out early on the
/// pour back for the same reason in reverse.
public enum GlassMorphContent {
    /// The list is invisible until this progress, then ramps linearly to full at 1.
    public static let listFadeStart: CGFloat = 0.55

    public static func listOpacity(at progress: CGFloat) -> CGFloat {
        guard progress > listFadeStart else { return 0 }
        return min((progress - listFadeStart) / (1 - listFadeStart), 1)
    }
}
