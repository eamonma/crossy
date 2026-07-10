// The shared ambient clock (ID-2, apps/ios/DESIGN.md §9): small, tabular, in the
// room bar; shared and social, not a whip. It derives entirely from wire facts: it
// reads 0:00 before the first fill (the timer starts at first fill, root DESIGN.md
// D15), ticks from `firstFillAt`, and freezes at `completedAt`. Timestamps arrive as
// ISO 8601 strings on the server's clock (PROTOCOL.md §3) and stay strings in the
// store; parsing and formatting live here where tests can pin them with an injected
// now. Width stability (the clock never jitters, DESIGN.md §6) is the render site's
// job via tabular numerals; this file keeps the digits minimal so there is little
// width to jitter.

import Foundation

public enum AmbientClock {
    /// Parse a wire timestamp: ISO 8601, fractional seconds tolerated (the JS
    /// server's toISOString carries milliseconds; fixtures often do not).
    public static func parse(_ timestamp: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: timestamp) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: timestamp)
    }

    /// Elapsed whole seconds for display. No first fill yet reads 0 (ID-2: before
    /// the first fill it reads 0:00 quietly); a completed game freezes at the
    /// completion instant; clock skew can never show a negative time.
    public static func elapsedSeconds(firstFillAt: Date?, completedAt: Date?, now: Date) -> Int {
        guard let origin = firstFillAt else { return 0 }
        let end = completedAt ?? now
        return max(0, Int(end.timeIntervalSince(origin)))
    }

    /// m:ss under an hour, h:mm:ss from there: a quiet timer, not a stopwatch
    /// (EXPERIENCE.md), so no leading zeros beyond what alignment needs and never
    /// sub-second digits.
    public static func display(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3600
        let minutes = (clamped % 3600) / 60
        let secs = clamped % 60
        if hours > 0 {
            return "\(hours):\(pad(minutes)):\(pad(secs))"
        }
        return "\(minutes):\(pad(secs))"
    }

    /// The one-call form the room bar uses: wire strings in, display out.
    public static func display(firstFillAt: String?, completedAt: String?, now: Date) -> String {
        display(
            seconds: elapsedSeconds(
                firstFillAt: firstFillAt.flatMap(parse),
                completedAt: completedAt.flatMap(parse),
                now: now))
    }

    private static func pad(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }
}
