// The chrome's own state: morph progresses and the reconnect deadline, one
// observable the room's overlays share. Kept apart from SelectionModel (the cursor)
// and GameStore (the wire) on purpose: chrome state is neither gameplay nor
// sequenced truth, and a composition root that owns the model can script it (the
// -i2bScript precedent drives screenshots through exactly this survivor of the
// view tree).
//
// The settle animators enforce the SP-i1 gesture discipline structurally: progress
// is the ONE source of geometry truth, stepped by hand here on release (the chrome
// spring's own critically damped curve, ChromeSettleCurve, no overshoot per
// DESIGN.md §7), and never implicitly animated. So there is no second animation
// system to retarget mid-gesture (the spasm SP-i1 diagnosed), and a finger that
// catches the surface mid-settle reads the true current progress and scrubs on
// from there.

import CoreGraphics
import CrossyDesign
import Foundation
import Observation

#if os(iOS)
    import QuartzCore
#endif

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class RoomChromeModel {
    /// The clue bar's melt: 0 is the standing bar, 1 the open browser.
    public var meltProgress: CGFloat = 0

    /// True while a finger scrubs the melt (gesture bookkeeping for the views).
    public var isMeltDragging = false

    /// The roster morph: 0 is the puck cluster at rest, 1 the open panel.
    public var rosterProgress: CGFloat = 0

    /// The stats morph (ID-2: the timer becomes the headline only at
    /// completion, so the headline comes FROM the timer): 0 is the room bar's
    /// frozen clock, 1 the open stats card.
    public var statsProgress: CGFloat = 0

    /// When the reconnect adapter will dial next, for the quiet countdown
    /// (DESIGN.md §8). Set by the composition root; nil renders the bare word.
    public var reconnectRetryAt: Date?

    /// The kicked exit (EXPERIENCE.md Kicked): true replaces the room with its
    /// terminal screen and the one honest sentence. Set by the composition root
    /// when the transport surfaces the `kicked` notice; the store deliberately
    /// ignores the frame (PROTOCOL.md §6: it is followed by close 1008), so like
    /// the reconnect deadline this is the root's fact to set, not the store's.
    public var kicked = false

    @ObservationIgnored private var meltSettleTask: Task<Void, Never>?
    @ObservationIgnored private var rosterSettleTask: Task<Void, Never>?
    @ObservationIgnored private var statsSettleTask: Task<Void, Never>?

    public init() {}

    public var isBrowserOpen: Bool { meltProgress > 0 }
    public var isRosterOpen: Bool { rosterProgress > 0 }
    public var isStatsOpen: Bool { statsProgress > 0 }

    // MARK: Settling (the one animation, on release)

    /// A finger touched the melt: whatever settle was in flight stops and the
    /// finger owns progress from wherever the surface actually is.
    public func meltTouched() {
        meltSettleTask?.cancel()
    }

    /// Settle the melt open or pour it back. `animated: false` cuts (Reduce
    /// Motion, scripted screenshots).
    public func settleMelt(open: Bool, animated: Bool = true) {
        meltSettleTask?.cancel()
        meltSettleTask = Self.walk(
            from: meltProgress, to: open ? 1 : 0, animated: animated
        ) { [weak self] value in
            self?.meltProgress = value
        }
    }

    /// The melt's forced pour-back (DESIGN.md §4: transient panels yield to
    /// intent, so another panel's opening or a terminal status pours the melt
    /// back). Never while a finger scrubs it: the finger owns progress (the
    /// SP-i1 discipline), so a dragged melt keeps its surface and the release
    /// settles it wherever the finger sends it.
    public func pourBackMeltUnlessDragging(animated: Bool = true) {
        guard !isMeltDragging else { return }
        settleMelt(open: false, animated: animated)
    }

    public func rosterTouched() {
        rosterSettleTask?.cancel()
    }

    public func settleStats(open: Bool, animated: Bool = true) {
        statsSettleTask?.cancel()
        statsSettleTask = Self.walk(
            from: statsProgress, to: open ? 1 : 0, animated: animated
        ) { [weak self] value in
            self?.statsProgress = value
        }
    }

    public func settleRoster(open: Bool, animated: Bool = true) {
        rosterSettleTask?.cancel()
        rosterSettleTask = Self.walk(
            from: rosterProgress, to: open ? 1 : 0, animated: animated
        ) { [weak self] value in
            self?.rosterProgress = value
        }
    }

    /// Scripted entry points (screenshots, deep links): land a panel with no
    /// gesture and no walk.
    public func presentBrowser() {
        rosterSettleTask?.cancel()
        meltSettleTask?.cancel()
        rosterProgress = 0
        meltProgress = 1
    }

    public func presentRoster() {
        rosterSettleTask?.cancel()
        meltSettleTask?.cancel()
        meltProgress = 0
        rosterProgress = 1
    }

    /// The settle walk: the chrome spring's own curve (ChromeSettleCurve), one
    /// application per display frame. iOS awaits real frames through
    /// CADisplayLink; a slept interval is not frame-synced, and its jitter
    /// against the display read as lag on the owner's device (finding
    /// 2026-07-10). The macOS test build keeps the fine-sleep loop, which only
    /// tests ever see. Returns nil when the change was a cut.
    private static func walk(
        from start: CGFloat, to target: CGFloat, animated: Bool,
        apply: @escaping @MainActor (CGFloat) -> Void
    ) -> Task<Void, Never>? {
        guard animated, abs(target - start) > 0.0005 else {
            apply(target)
            return nil
        }
        return Task { @MainActor in
            let began = Date.now
            #if os(iOS)
                let ticker = FrameTicker()
                defer { ticker.stop() }
                for await _ in ticker.frames() {
                    if Task.isCancelled { return }
                    if step(began: began, start: start, target: target, apply: apply) {
                        return
                    }
                }
            #else
                while !Task.isCancelled {
                    if step(began: began, start: start, target: target, apply: apply) {
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(8))
                }
            #endif
        }
    }

    /// One spring application; true when the walk has arrived (which snaps the
    /// last fraction of a point so progress ends exactly at its endpoint).
    private static func step(
        began: Date, start: CGFloat, target: CGFloat,
        apply: @MainActor (CGFloat) -> Void
    ) -> Bool {
        let fraction = ChromeSettleCurve.fraction(at: Date.now.timeIntervalSince(began))
        if fraction >= 1 {
            apply(target)
            return true
        }
        apply(start + (target - start) * CGFloat(fraction))
        return false
    }
}

/// The settle's curve: the chrome spring itself (DESIGN.md §7; response
/// Motion.Springs.chromeResponse, damping 1 so nothing overshoots), solved in
/// closed form and stepped by hand. A cubic ease-out read wrong on the owner's
/// device (2026-07-10): it stops instead of settling. This is the exact curve
/// `Animation.crossyChrome` would draw, without an animation system ever owning
/// progress (the SP-i1 law).
enum ChromeSettleCurve {
    /// Critically damped spring: x(t) = 1 - e^(-wt)(1 + wt), w = 2pi/response.
    /// Reports 1 once within a thousandth, so a walk terminates.
    static func fraction(at elapsed: TimeInterval) -> Double {
        guard elapsed > 0 else { return 0 }
        let t = 2 * Double.pi / Motion.Springs.chromeResponse * elapsed
        let fraction = 1 - exp(-t) * (1 + t)
        return fraction >= 0.999 ? 1 : fraction
    }
}

#if os(iOS)
    /// CADisplayLink bridged to an AsyncStream: each yield is one real display
    /// frame, ProMotion included, so a walk steps exactly once per frame.
    @MainActor
    private final class FrameTicker: NSObject {
        private var link: CADisplayLink?
        private var continuation: AsyncStream<Void>.Continuation?

        func frames() -> AsyncStream<Void> {
            AsyncStream { continuation in
                self.continuation = continuation
                let link = CADisplayLink(target: self, selector: #selector(tick))
                link.add(to: .main, forMode: .common)
                self.link = link
            }
        }

        @objc private func tick() {
            continuation?.yield()
        }

        /// The link retains its target; invalidating breaks the cycle. Callers
        /// pair every `frames()` with a `stop()` (the walk's `defer`).
        func stop() {
            link?.invalidate()
            link = nil
            continuation?.finish()
            continuation = nil
        }
    }
#endif
