// The island's presentation math (push track, phase 2a): the pure arithmetic behind the
// Live Activity's progress ring, ticked meter, and frozen solve time. Nothing here
// touches ActivityKit, SwiftUI, or a clock; counts and a frozen interval go in,
// render-ready numbers come out, and CrossyProtocolTests pins every rule headlessly on
// macOS (the SolveActivityPolicy discipline).
//
// It lives here rather than in CrossyUI, where similar pure UI math (AmbientClock)
// lives, because the widget extension is its one real consumer and CrossyProtocol is
// the one package product the widget links: the math sits beside the payload it
// interprets, defined once, visible to the widget and to the headless tests alike.

import Foundation

public enum IslandPresentation {
    /// The progress fraction, clamped to `0...1`. `total <= 0` means no progress to
    /// show (the pre-push empty state, or a payload without a grid): the caller reads
    /// `nil` and hides the meter and ring entirely, rather than drawing a zero arc that
    /// would read as "empty grid" instead of "no data". A `filled` past `total` (a race
    /// between a completion and the count) clamps to full.
    public static func fraction(filled: Int, total: Int) -> Double? {
        guard total > 0 else { return nil }
        let raw = Double(filled) / Double(total)
        return min(1, max(0, raw))
    }

    /// The nine interior tick fractions of the meter, at the tenths (0.1 ... 0.9). The
    /// detents the quantized advances land against; the ends carry no tick because the
    /// track's own edges mark 0 and 1.
    public static let tickFractions: [Double] = (1...9).map { Double($0) / 10 }

    /// The frozen solve time, formatted (owner ruling 2026-07-11): MM:SS under an hour,
    /// H:MM at or past it. Never three sections — H:MM:SS is forbidden, so a long solve
    /// drops its seconds rather than growing a third field. A negative interval (clock
    /// skew between the completion stamp and the anchor) floors at zero. This renders
    /// STATICALLY: the terminal island shows a frozen string, never a live timer.
    public static func frozenSolveTime(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3600
        if hours > 0 {
            let minutes = (clamped % 3600) / 60
            return "\(hours):\(pad(minutes))"
        }
        let minutes = clamped / 60
        let secs = clamped % 60
        return "\(minutes):\(pad(secs))"
    }

    /// The frozen interval in whole seconds between two instants, floored at zero. The
    /// terminal flip computes `completedAt - firstFillAt` here and formats it with
    /// `frozenSolveTime`; a nil completion (an abandoned room never completed) has no
    /// frozen time and the caller keeps the live-computed elapsed instead.
    public static func frozenSeconds(from firstFillAt: Date, to completedAt: Date) -> Int {
        max(0, Int(completedAt.timeIntervalSince(firstFillAt)))
    }

    /// How the live island renders elapsed time for a room of a given age (owner rulings
    /// 2026-07-11: the ninety-hour question, days only past a day, and never three
    /// sections). The clock's meaningfulness decays with age, so the register coarsens
    /// instead of growing digits: under an hour the native timer ticks; an hour to a day
    /// reads H:MM statically, re-derived on every push render; a day to a week reads in
    /// days; past a week the room is a place, not a race: the infinity mark.
    ///
    /// Ticking stops at the hour deliberately. The auto-updating timer reserves layout
    /// width for the WIDEST string its range can show, so a range crossing an hour
    /// reserves the forbidden H:MM:SS form and the capped label ellipsizes instead of
    /// rendering (owner device report 2026-07-11: the time shown as an ellipsis). Bounded
    /// to the room's first hour, the reservation is exactly "59:59" and always fits.
    public enum ElapsedRegister: Equatable, Sendable {
        /// Under an hour old: the native ticking timer, MM:SS. The caller bounds the
        /// timer's range to the anchor's first hour so the reservation stays MM:SS-wide.
        case ticking
        /// An hour to a week old: a static coarse reading, "1:14" (H:MM) under a day,
        /// "3 d" past it. Re-derived on every push render; between pushes it stands,
        /// which at these scales is honest (and stale weather covers real gaps).
        case coarse(String)
        /// A week or older: the infinity mark.
        case infinity
    }

    public static func elapsedRegister(ageSeconds: Int) -> ElapsedRegister {
        let hour = 3600
        let day = 86_400
        if ageSeconds < hour { return .ticking }
        if ageSeconds >= 7 * day { return .infinity }
        if ageSeconds >= day {
            // Days only (owner ruling 2026-07-11): past a day the hours are noise too.
            return .coarse("\(ageSeconds / day) d")
        }
        // H:MM, the frozen-time form (never three sections): the hour band's static read.
        return .coarse(frozenSolveTime(seconds: ageSeconds))
    }

    private static func pad(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }
}
