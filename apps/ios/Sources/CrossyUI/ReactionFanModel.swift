// The reaction fan's grammar, pure (the CursorRelayThrottle discipline: decide here,
// gesture code only reports). Two ways in, one way out: HOLD-SLIDE-RELEASE (touch down
// opens, sliding highlights, release over an emoji fires, release elsewhere cancels)
// and TAP-TAP (release on the button opens a standing fan; a tap fires; ~3 s of idle
// or a tap away closes). Firing ALWAYS dismisses the fan (owner ruling from the web
// review). Exhaustive transition tests live in ReactionFanModelTests; the SwiftUI fan
// (ReactionFan.swift) translates touches into these calls and renders the phase.

import Foundation

public struct ReactionFanModel: Equatable, Sendable {
    public enum Phase: Equatable, Sendable {
        case closed
        /// A finger holds the button: the fan stands only as long as the touch does.
        case heldOpen
        /// Opened by a tap: the fan stands alone until a fire, a tap away, or idle.
        case tapOpen
    }

    /// What the caller does about one transition. `fire` carries the emoji to send;
    /// the fan is already closed by the time it returns (fire always dismisses).
    public enum Effect: Equatable, Sendable {
        case none
        case fire(String)
    }

    /// The tap-opened fan's idle life (owner spec: ~3 s).
    public static let tapOpenIdleSeconds: TimeInterval = 3

    public private(set) var phase: Phase = .closed
    /// The slot under the held finger, for the render's highlight; nil off the row.
    public private(set) var highlighted: Int?
    /// When the standing fan opened (or last mattered), the idle timeout's anchor.
    public private(set) var openedAt: TimeInterval?
    /// Whether the current hold began on an already-standing fan, so releasing on
    /// the button TOGGLES it closed instead of reopening it.
    private var holdBeganTapOpen = false

    /// The five slots this fan offers, in slot order: the holder's personal set (D25),
    /// defaulting to the protocol's default five for a surface with no store.
    public let emojis: [String]

    public init(emojis: [String] = ReactionPolicy.defaultSet) {
        self.emojis = emojis
    }

    public var isOpen: Bool { phase != .closed }

    // MARK: - Hold-slide-release

    /// The touch landed on the button. Opens the fan immediately (no long-press
    /// latency: the hold IS the open).
    public mutating func holdBegan() {
        holdBeganTapOpen = phase == .tapOpen
        phase = .heldOpen
        highlighted = nil
    }

    /// The held finger moved; `index` is the slot under it (nil off the row).
    public mutating func holdMoved(over index: Int?) {
        guard phase == .heldOpen else { return }
        highlighted = index.flatMap { emojis.indices.contains($0) ? $0 : nil }
    }

    /// The hold ended. Over an emoji: fire and dismiss. On the button: the tap
    /// fallback (open standing, or toggle an already-standing fan closed). Anywhere
    /// else: cancel.
    public mutating func holdEnded(
        over index: Int?, onButton: Bool, at now: TimeInterval
    ) -> Effect {
        guard phase == .heldOpen else { return .none }
        highlighted = nil
        if let index, emojis.indices.contains(index) {
            close()
            return .fire(emojis[index])
        }
        if onButton {
            if holdBeganTapOpen {
                close()
            } else {
                phase = .tapOpen
                openedAt = now
            }
            return .none
        }
        close()
        return .none
    }

    // MARK: - The standing (tap-opened) fan

    /// A tap on one emoji of the standing fan.
    public mutating func tapEmoji(at index: Int) -> Effect {
        guard phase == .tapOpen, emojis.indices.contains(index) else { return .none }
        close()
        return .fire(emojis[index])
    }

    /// A touch anywhere else while the fan stands (DESIGN.md §4: transient surfaces
    /// yield to intent; the touch still lands where it fell).
    public mutating func tapAway() {
        guard phase == .tapOpen else { return }
        close()
    }

    /// The idle timer fired. Validated against `openedAt` so a timer scheduled for a
    /// previous opening can never close a newer one.
    public mutating func idleExpired(at now: TimeInterval) {
        guard phase == .tapOpen, let openedAt,
            now - openedAt >= Self.tapOpenIdleSeconds
        else { return }
        close()
    }

    private mutating func close() {
        phase = .closed
        highlighted = nil
        openedAt = nil
        holdBeganTapOpen = false
    }
}

/// The open fan's geometry, pure so the hold-slide hit test and the render cannot
/// disagree: one horizontal capsule of `slotSize` squares (the 44 pt touch floor),
/// slid across by x alone. Values in points; the view maps gesture locations into the
/// capsule's own space before asking.
public enum ReactionFanLayout {
    public static let slotSize: Double = 44
    public static let slotSpacing: Double = 2
    public static let capsulePadding: Double = 6
    /// How far past the capsule a held finger still counts as "over the row":
    /// hold-slide is a coarse gesture and the thumb occludes the target.
    public static let holdSlack: Double = 18

    public static func width(count: Int) -> Double {
        guard count > 0 else { return 0 }
        return Double(count) * slotSize + Double(count - 1) * slotSpacing
            + capsulePadding * 2
    }

    public static var height: Double { slotSize + capsulePadding * 2 }

    /// A slot's center x, from the capsule's leading edge.
    public static func slotCenterX(index: Int, count: Int) -> Double {
        capsulePadding + Double(index) * (slotSize + slotSpacing) + slotSize / 2
    }

    /// The slot under a point in the capsule's space, with `holdSlack` of grace
    /// around the whole capsule; nil beyond it.
    public static func slot(atX x: Double, y: Double, count: Int) -> Int? {
        guard count > 0 else { return nil }
        guard y >= -holdSlack, y <= height + holdSlack else { return nil }
        guard x >= -holdSlack, x <= width(count: count) + holdSlack else { return nil }
        let inner = x - capsulePadding
        let pitch = slotSize + slotSpacing
        let index = Int((inner / pitch).rounded(.down))
        return min(max(index, 0), count - 1)
    }
}
