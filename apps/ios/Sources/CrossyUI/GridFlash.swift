// The conflict flash (PROTOCOL.md §8, D02; apps/ios/DESIGN.md §7): roughly 300 ms in
// the writer's color when a visible value changes under you, sharp attack and long
// decay, never a linear fade. The store detects the trigger (GameStore.onConflictFlash);
// this file owns the envelope math and the in-flight bookkeeping. Color in motion is
// ID-1 scope: recording is gated behind AttributionSwitches.colorInMotionEnabled, so
// muting the switch silences the flash at the source.

import CrossyDesign
import Foundation

/// One flash in flight over a cell.
public struct GridFlash: Equatable, Sendable {
    public let color: RGBColor
    /// Reference-date seconds at trigger time; elapsed time is computed against the
    /// render clock (TimelineView), never stored.
    public let startedAt: TimeInterval

    public init(color: RGBColor, startedAt: TimeInterval) {
        self.color = color
        self.startedAt = startedAt
    }
}

/// The flash envelope: linear attack to full tint over 50 ms, then a 250 ms
/// cubic-bezier ease-out decay to clear (Motion.Flash constants and control points).
public enum FlashEnvelope {
    public static let duration = Motion.Flash.duration

    /// Opacity of the writer's color `elapsed` seconds after the trigger, in [0, 1].
    public static func opacity(elapsed: TimeInterval) -> Double {
        if elapsed <= 0 { return 0 }
        if elapsed < Motion.Flash.attackDuration {
            return elapsed / Motion.Flash.attackDuration
        }
        let decayed = (elapsed - Motion.Flash.attackDuration) / Motion.Flash.decayDuration
        if decayed >= 1 { return 0 }
        return 1 - easedDecay(decayed)
    }

    /// The decay easing: cubic bezier through Motion.Flash's control points, solved
    /// for progress by bisection (x(t) is monotonic for control x in [0, 1]).
    static func easedDecay(_ progress: Double) -> Double {
        let p1 = Motion.Flash.decayControlPoint1
        let p2 = Motion.Flash.decayControlPoint2
        var low = 0.0
        var high = 1.0
        for _ in 0..<24 {
            let mid = (low + high) / 2
            if bezier(mid, p1.x, p2.x) < progress { low = mid } else { high = mid }
        }
        let t = (low + high) / 2
        return bezier(t, p1.y, p2.y)
    }

    private static func bezier(_ t: Double, _ c1: Double, _ c2: Double) -> Double {
        let u = 1 - t
        return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t
    }
}

/// Active flashes by cell. A value type held as view state; a new flash on a cell
/// replaces the one in flight (the latest writer wins, like the event that caused it).
public struct FlashBook: Equatable, Sendable {
    public private(set) var flashes: [Int: GridFlash] = [:]

    public init() {}

    public var isEmpty: Bool { flashes.isEmpty }

    /// Record a flash trigger. ID-1: color in motion is muteable by a single
    /// constant, so a muted switch drops the trigger here at the source; the default
    /// argument reads the real switch and tests pass both states explicitly.
    public mutating func record(
        cell: Int,
        color: RGBColor,
        at now: TimeInterval,
        colorInMotionEnabled: Bool = AttributionSwitches.colorInMotionEnabled
    ) {
        guard colorInMotionEnabled else { return }
        flashes[cell] = GridFlash(color: color, startedAt: now)
    }

    /// Drop every flash whose envelope has fully decayed.
    public mutating func sweep(at now: TimeInterval) {
        flashes = flashes.filter { now - $0.value.startedAt < FlashEnvelope.duration }
    }

    /// The overlay opacity for a cell, nil when nothing is in flight there.
    public func opacity(cell: Int, at now: TimeInterval) -> Double? {
        guard let flash = flashes[cell] else { return nil }
        let value = FlashEnvelope.opacity(elapsed: now - flash.startedAt)
        return value > 0 ? value : nil
    }
}
