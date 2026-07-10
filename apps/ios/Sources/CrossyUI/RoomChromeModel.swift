// The chrome's own state: morph progresses and the reconnect deadline, one
// observable the room's overlays share. Kept apart from SelectionModel (the cursor)
// and GameStore (the wire) on purpose: chrome state is neither gameplay nor
// sequenced truth, and a composition root that owns the model can script it (the
// -i2bScript precedent drives screenshots through exactly this survivor of the
// view tree).
//
// The settle animators enforce the SP-i1 gesture discipline structurally: progress
// is the ONE source of geometry truth, stepped by hand here on release (an eased
// walk to 0 or 1, the chrome spring's duration, no overshoot per DESIGN.md §7), and
// never implicitly animated. So there is no second animation system to retarget
// mid-gesture (the spasm SP-i1 diagnosed), and a finger that catches the surface
// mid-settle reads the true current progress and scrubs on from there.

import CoreGraphics
import CrossyDesign
import Foundation
import Observation

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

    public init() {}

    public var isBrowserOpen: Bool { meltProgress > 0 }
    public var isRosterOpen: Bool { rosterProgress > 0 }

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

    public func rosterTouched() {
        rosterSettleTask?.cancel()
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

    /// The eased walk: cubic ease-out over the chrome response, stepped at display
    /// cadence. Returns nil when the change was a cut.
    private static func walk(
        from start: CGFloat, to target: CGFloat, animated: Bool,
        apply: @escaping @MainActor (CGFloat) -> Void
    ) -> Task<Void, Never>? {
        guard animated, abs(target - start) > 0.0005 else {
            apply(target)
            return nil
        }
        return Task { @MainActor in
            let duration = Motion.Springs.chromeResponse
            let began = Date.now
            while !Task.isCancelled {
                let t = min(Date.now.timeIntervalSince(began) / duration, 1)
                let eased = 1 - pow(1 - t, 3)
                apply(start + (target - start) * eased)
                if t >= 1 { return }
                try? await Task.sleep(for: .milliseconds(8))
            }
        }
    }
}
