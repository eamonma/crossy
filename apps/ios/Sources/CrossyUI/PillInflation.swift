// The tap-opened facts card's morph character. Scope: ONLY the tap-opened
// facts card (the time pill inflated) reads this; the drag-scrubbed melt, the
// camera's follow pan, and everything else on ChromeSettleCurve are untouched,
// because that curve is shared law (DESIGN.md §7, SP-i1) and this file
// deliberately does not go near it. (The share morph card that once shared
// this switch retired: share ships as the native menu, owner ruling
// 2026-07-11.)
//
// Three characters, one switch:
//
//   .metaball   THE SHIPPING DEFAULT on iOS 26+ (owner ruling 2026-07-11):
//               the system's own materialize swap inside a
//               GlassEffectContainer (the MorphLab variant-A recipe: unique
//               glassEffectIDs, spacing 40, Mail's timing). This is the goo
//               Mail's menu actually has: the glass shader blending two
//               shapes' fields, unreachable by tweening one crisp surface
//               (DESIGN.md §4 frame study). SP-i1 rejected the ID swap for
//               scrubbed morphs because it snaps mid-scrub; a tap has no
//               scrub, so the exception is legitimate (DESIGN.md §4, ratified
//               2026-07-11). Below 26 it falls back to .clean by the
//               #available gate at the surface.
//   .clean      the frame-interpolation law: one persistent surface, frame
//               and radius interpolating on the critically damped chrome
//               spring. The below-26 fallback, and reachable on 26 via
//               -gooClean for reference/regression.
//   .overshoot  the same one-surface walk on a SEPARATE underdamped curve
//               (a hair past the open frame, then settle). Open only; the
//               pour-back stays critically damped, because a dismissal that
//               bounces reads as indecision. Geometry rides the unclamped
//               blend (GlassMorph.frameUnclamped): anchored edges are fixed
//               points of the blend, so the pill's shared edges never move
//               and only the traveling edges breathe. Reachable via
//               -gooOvershoot for reference.
//
// The default is metaball; -gooClean / -gooOvershoot override it for
// reference and regression.

import CrossyDesign
import Foundation
import SwiftUI

/// The switch. A mutable static (not an AttributionSwitches constant) so the
/// app target can override the default from a launch argument (-gooClean /
/// -gooOvershoot) without a rebuild.
@MainActor
public enum PillInflation {
    public enum Character: Sendable, Equatable {
        case clean
        case overshoot
        case metaball
    }

    /// The shipping default (owner ruling 2026-07-11): metaball on iOS 26+,
    /// with the surface's #available gate falling back to the clean walk
    /// below 26 (there the character stays .metaball but the metaball surface
    /// is unavailable, so walkedSurface renders, which is .clean's geometry).
    public static var character: Character = .metaball

    /// Whether the walked geometry should ride the unclamped blend. False for
    /// .metaball too: there the system owns geometry outright.
    static var walksWithOvershoot: Bool { character == .overshoot }
}

/// The overshoot candidate's curve: an underdamped spring in closed form,
/// stepped by hand exactly like ChromeSettleCurve (the SP-i1 law: no animation
/// system ever owns morph progress). Same response as the chrome spring so the
/// open reads as the same instrument, damping below critical so the surface
/// breathes a hair (~4%) past its open frame and settles. Used ONLY by the
/// pill panels' open walk when PillInflation.character == .overshoot.
enum PillInflationCurve {
    /// Underdamped enough to read, damped enough to stay chrome: the peak
    /// overshoot is exp(-damping*pi/sqrt(1-damping^2)) ~= 3.8%.
    static let dampingFraction = 0.72

    private static var omega: Double { 2 * Double.pi / Motion.Springs.chromeResponse }
    private static var dampedRatio: Double { (1 - dampingFraction * dampingFraction).squareRoot() }

    /// x(t) = 1 - e^(-zwt)(cos(wd t) + (z/sqrt(1-z^2)) sin(wd t)); reports
    /// exactly 1 once the envelope is within a thousandth, so a walk
    /// terminates (the ChromeSettleCurve contract).
    static func fraction(at elapsed: TimeInterval) -> Double {
        guard elapsed > 0 else { return 0 }
        guard !isSettled(at: elapsed) else { return 1 }
        let decay = exp(-dampingFraction * omega * elapsed)
        let phase = omega * dampedRatio * elapsed
        return 1 - decay * (cos(phase) + dampingFraction / dampedRatio * sin(phase))
    }

    /// The envelope bound |x - 1| <= e^(-zwt)/sqrt(1-z^2) within a thousandth.
    static func isSettled(at elapsed: TimeInterval) -> Bool {
        exp(-dampingFraction * omega * elapsed) / dampedRatio < 0.001
    }
}

/// The metaball recipe, pinned once (MorphLab variant A; timings from the
/// owner's Mail frame study, DESIGN.md §4).
enum MetaballRecipe {
    /// Container spacing wide enough that the two shapes' fields fuse
    /// mid-swap. Never used by standing chrome (the cluster's blend stays
    /// below the fuse, SP-i1's caution); this container exists only for the
    /// panel's flight.
    static let containerSpacing: CGFloat = 40
    static let openDuration: TimeInterval = 0.35
    static let closeDuration: TimeInterval = 0.18
}

#if os(iOS)
    /// The metaball surface (the facts card's shipping morph on iOS 26+, owner
    /// ruling 2026-07-11): the panel is NOT one interpolating surface here. It
    /// is the system's materialize swap between a pill-shaped glass and the
    /// open panel, fields blending in flight (the Mail goo). The walked
    /// progress stays the panel's lifecycle clock (mount at > 0, unmount at 0,
    /// and the deflate cue on its way down); the system owns everything visual.
    /// Content rides the panel shape whole: the materialize transition is its
    /// fade, the browser-list rule's spirit by other means.
    ///
    /// The close-deflate gap (flagged on the first metaball run: the system's
    /// deflate ends at closeDuration ~0.18 s but the caller holds this view
    /// mounted until the walk's clock reaches 0 ~0.44 s, leaving an empty
    /// pill-shaped glass standing for the difference). The fix: the pill stub
    /// is the OPEN's materialize source ONLY. Once the panel has inflated, the
    /// close collapses toward NOTHING, not back to the stub, so the moment the
    /// deflate finishes there is no glass to linger. `phase` distinguishes the
    /// three states: the pre-open stub, the open panel, and the closed void.
    @available(iOS 26.0, *)
    @MainActor
    struct MetaballPanelSurface<PanelContent: View>: View {
        let morph: GlassMorph
        /// The walked progress (the lifecycle clock). A fall from 1 cues the
        /// deflate; the caller unmounts this view when it reaches 0.
        let progress: CGFloat
        let reduceMotion: Bool
        @ViewBuilder let panel: () -> PanelContent

        /// The surface's three states. `stub` is the pill glass the open
        /// materializes FROM; `open` is the panel; `closed` is the void the
        /// close materializes INTO (never the stub again, so no empty pill
        /// stands after the deflate).
        private enum Phase { case stub, open, closed }
        @State private var phase: Phase = .stub
        @Namespace private var glass

        var body: some View {
            GlassEffectContainer(spacing: MetaballRecipe.containerSpacing) {
                ZStack(alignment: .topLeading) {
                    switch phase {
                    case .open:
                        let shape = RoundedRectangle(
                            cornerRadius: morph.openCornerRadius, style: .continuous)
                        panel()
                            .frame(width: morph.open.width, height: morph.open.height)
                            .clipShape(shape)
                            .glassEffect(
                                .regular,
                                in: .rect(cornerRadius: morph.openCornerRadius))
                            .glassEffectID("panel", in: glass)
                            .contentShape(shape)
                            // The panel's inner blocker (DESIGN.md §4): only
                            // touches OUTSIDE a transient dismiss it.
                            .onTapGesture {}
                            .position(x: morph.open.midX, y: morph.open.midY)
                    case .stub:
                        // The pill-shaped stub the OPEN swap departs from:
                        // empty glass, because Mail's egg drops its content the
                        // moment it leaves the button. Present only before the
                        // first inflation, never on the way back.
                        Color.clear
                            .frame(width: morph.rest.width, height: morph.rest.height)
                            .glassEffect(
                                .regular,
                                in: .rect(cornerRadius: morph.restCornerRadius))
                            .glassEffectID("pill", in: glass)
                            .position(x: morph.rest.midX, y: morph.rest.midY)
                    case .closed:
                        // Nothing: the panel deflated into the void, so the
                        // instant the system finishes there is no pill-shaped
                        // glass to stand while the caller's walk clock runs out
                        // (the close-deflate gap, closed).
                        Color.clear
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .onAppear {
                guard !reduceMotion else {
                    phase = .open
                    return
                }
                withAnimation(.smooth(duration: MetaballRecipe.openDuration)) {
                    phase = .open
                }
            }
            .onChange(of: progress) { old, new in
                // The pour-back began (the walk stepping down): hand the
                // system its deflate toward the void. Reduce Motion cuts.
                guard new < old, phase == .open else { return }
                guard !reduceMotion else {
                    phase = .closed
                    return
                }
                withAnimation(.smooth(duration: MetaballRecipe.closeDuration)) {
                    phase = .closed
                }
            }
        }
    }
#endif
