// The pill-inflation character prototype (owner ask 2026-07-11: make the
// tap-opened pill morphs feel gooier, judged on device before any law
// changes). Scope: ONLY the tap-opened pill panels (the facts card and the
// share card) change character here; the drag-scrubbed melt, the camera's
// follow pan, and everything else on ChromeSettleCurve are untouched, because
// that curve is shared law (DESIGN.md §7, SP-i1) and this file deliberately
// does not go near it.
//
// Three characters, one switch, so the owner accepts or rejects a treatment
// wholesale (the AttributionSwitches pattern; the app target flips it from a
// launch argument, -gooOvershoot / -gooMetaball):
//
//   .clean      the shipped law: one persistent surface, frame and radius
//               interpolating on the critically damped chrome spring.
//   .overshoot  the same one-surface walk on a SEPARATE underdamped curve
//               (a hair past the open frame, then settle). Open only; the
//               pour-back stays critically damped, because a dismissal that
//               bounces reads as indecision. Geometry rides the unclamped
//               blend (GlassMorph.frameUnclamped): anchored edges are fixed
//               points of the blend, so the pill's shared edges never move
//               and only the traveling edges breathe.
//   .metaball   iOS 26 only: the system's own materialize swap inside a
//               GlassEffectContainer (the MorphLab variant-A recipe: unique
//               glassEffectIDs, spacing 40, Mail's 0.35/0.18 timing). This is
//               the goo Mail's menu actually has: the glass shader blending
//               two shapes' fields, unreachable by tweening one crisp surface
//               (DESIGN.md §4 frame study). SP-i1 rejected the ID swap for
//               scrubbed morphs because it snaps mid-scrub; a tap has no
//               scrub, so the question is open again and only a device can
//               close it. Below 26 the character falls back to .clean.
//
// Nothing here runs unless the switch is flipped: the default is the law.

import CrossyDesign
import Foundation
import SwiftUI

/// The switch. A mutable static (not an AttributionSwitches constant) so the
/// app target can flip it from a launch argument and the owner can compare
/// characters on device without a rebuild per candidate.
@MainActor
public enum PillInflation {
    public enum Character: Sendable, Equatable {
        case clean
        case overshoot
        case metaball
    }

    public static var character: Character = .clean

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
    /// The metaball candidate's surface: the panel is NOT one interpolating
    /// surface here. It is the system's materialize swap between a pill-shaped
    /// glass and the open panel, fields blending in flight (the Mail goo). The
    /// walked progress stays the panel's lifecycle clock (mount at > 0, unmount
    /// at 0, and the deflate cue on its way down); the system owns everything
    /// visual. Content rides the panel shape whole: the materialize transition
    /// is its fade, the browser-list rule's spirit by other means.
    @available(iOS 26.0, *)
    @MainActor
    struct MetaballPanelSurface<PanelContent: View>: View {
        let morph: GlassMorph
        /// The walked progress (the lifecycle clock). A fall from 1 cues the
        /// deflate; the caller unmounts this view when it reaches 0.
        let progress: CGFloat
        let reduceMotion: Bool
        @ViewBuilder let panel: () -> PanelContent

        @State private var inflated = false
        @Namespace private var glass

        var body: some View {
            GlassEffectContainer(spacing: MetaballRecipe.containerSpacing) {
                ZStack(alignment: .topLeading) {
                    if inflated {
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
                    } else {
                        // The pill-shaped stub the swap departs from and
                        // returns to: empty glass, because Mail's egg drops
                        // its content the moment it leaves the button.
                        Color.clear
                            .frame(width: morph.rest.width, height: morph.rest.height)
                            .glassEffect(
                                .regular,
                                in: .rect(cornerRadius: morph.restCornerRadius))
                            .glassEffectID("pill", in: glass)
                            .position(x: morph.rest.midX, y: morph.rest.midY)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .onAppear {
                guard !reduceMotion else {
                    inflated = true
                    return
                }
                withAnimation(.smooth(duration: MetaballRecipe.openDuration)) {
                    inflated = true
                }
            }
            .onChange(of: progress) { old, new in
                // The pour-back began (the walk stepping down): hand the
                // system its deflate. Reduce Motion cuts, as everywhere.
                guard new < old, inflated else { return }
                guard !reduceMotion else {
                    inflated = false
                    return
                }
                withAnimation(.smooth(duration: MetaballRecipe.closeDuration)) {
                    inflated = false
                }
            }
        }
    }
#endif
