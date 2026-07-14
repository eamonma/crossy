// Ephemeral emoji reactions, the client's entire memory of them (PROTOCOL.md §9; root
// DESIGN.md D24): a transient sticker book BESIDE the store, never inside it. The
// store's part is one stateless send and one fan-out callback (GameStore.react /
// onReaction); everything a sticker is — its five-second life, its placement, its
// coalescing, the send set and the 5/s client cap — lives here, so a snapshot or
// resync is provably unable to touch a sticker (no store state exists to reconcile).
// Receive-any, send-gated (§9): `receive` renders any well-formed emoji; only `send`
// consults the set, and the caller gates on it. Time arrives as data (the FlashBook
// pattern), so tests pin every rule without a clock.
//
// Born-correct placement (the web review's shipped-bug list, and PR #245's settle-pop
// lesson): a sticker's offset, lean, and rotation are derived ONCE at creation, seeded
// only from its own stable key — never from sibling count or pile index — and never
// change while it lives. Incumbents in a pile hold still when a newcomer lands, and
// the resting transform is identical from entry-spring settle through exit-fade start
// (StickerEnvelope clamps the settle boundary, so there is no post-entry snap).

import CrossyProtocol
import Foundation
import Observation

/// Client-side reaction policy: the default send set and the caps. Deliberately OUTSIDE
/// the codec (PROTOCOL.md §9: decoders enforce shape only, never set membership) and
/// outside the store (D24: the store holds nothing for reactions). The send set is a
/// per-user preference now (D25, ReactionSetStore); this holds the defaults and the
/// client's own rate and render budgets.
public enum ReactionPolicy {
    /// The DEFAULT personal send set, exactly these five graphemes in slot order
    /// (PROTOCOL.md §9; D25: 🔥 🤔 🐐 💀 😭, the Phase 7 five retired). What a null
    /// `/me` `reactionSet` means, and what every send surface offers until an account
    /// chooses its own five. Send-side only: an inbound emoji outside any set still
    /// renders (receive-any, §9).
    public static let defaultSet: [String] = ReactionSetSpec.defaultSet

    /// A sticker's whole life (PROTOCOL.md §9's ~5 seconds). The one decay constant;
    /// everything else derives from it.
    public static let reactionDecay: Duration = .seconds(5)

    /// `reactionDecay` as the TimeInterval the envelope math runs on.
    public static var decaySeconds: TimeInterval {
        Double(reactionDecay.components.seconds)
            + Double(reactionDecay.components.attoseconds) * 1e-18
    }

    /// The client send cap (PROTOCOL.md §5, §9: at most 5/s, server MAY drop excess
    /// silently; the client simply never over-sends). A sliding window, not a bucket.
    public static let maxSendsPerSecond = 5

    /// The sliding window the send cap counts within.
    public static let sendWindowSeconds: TimeInterval = 1

    /// Render budget per cell: the newest sticker replaces the oldest once a pile
    /// holds this many (owner spec; the replaced one leaves through the exit fade).
    public static let maxVisiblePerCell = 4
}

/// The receive-haptic switch (owner spec: a received sticker on or near your active
/// word taps softly; defaults ON, toggleable in the ReactionLab). UserDefaults-backed
/// so the lab's toggle survives relaunch; the default-true fallback reads an unset key
/// as ON.
public enum ReactionSettings {
    static let receiveHapticsKey = "crossy.reactions.receiveHaptics"

    public static var receiveHapticsEnabled: Bool {
        get { UserDefaults.standard.object(forKey: receiveHapticsKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: receiveHapticsKey) }
    }
}

/// One live sticker. Placement (`offsetX`/`offsetY` in module units from the cell
/// origin, `tiltDegrees`) is seeded at birth from the stable key alone and immutable
/// for the sticker's life (the born-correct rule); only the timestamps move, and only
/// through coalescing or eviction. Geometry mirrors the web layer's owner retune
/// (2026-07-14, apps/web ReactionStickers.tsx): anchored near-center with a slight
/// lower-left bias, a square jitter of at most 8 units per axis, and a tilt whose
/// magnitude is always 8 to 12 degrees, never near-upright.
public struct ReactionSticker: Identifiable, Equatable, Sendable {
    /// The coalesce identity: same sender + emoji + cell is the same sticker
    /// (PROTOCOL.md §9's client guidance: repeats coalesce, never stack sprites).
    public let id: String
    public let userId: String
    public let emoji: String
    public let cell: Int
    /// Birth: drives the entry spring, never changes (a coalesce must not replay
    /// the entry, only pulse in place).
    public let bornAt: TimeInterval
    /// The latest coalesce, driving the pulse; equals `bornAt` until one lands.
    public internal(set) var refreshedAt: TimeInterval
    /// When the sticker is gone. Coalescing pushes it out; pile eviction pulls it in.
    public internal(set) var endsAt: TimeInterval

    // Born-correct placement: the anchor from the CELL ORIGIN, module units, jitter
    // already folded in; and the static tilt.
    public let offsetX: Double
    public let offsetY: Double
    public let tiltDegrees: Double

    init(userId: String, emoji: String, cell: Int, at now: TimeInterval) {
        self.id = Self.key(userId: userId, emoji: emoji, cell: cell)
        self.userId = userId
        self.emoji = emoji
        self.cell = cell
        self.bornAt = now
        self.refreshedAt = now
        self.endsAt = now + ReactionPolicy.decaySeconds
        let seed = StickerSeed.hash(id)
        self.offsetX =
            Self.anchorXUnits + (StickerSeed.unit(seed, lane: 0) * 2 - 1) * Self.scatterUnits
        self.offsetY =
            Self.anchorYUnits + (StickerSeed.unit(seed, lane: 1) * 2 - 1) * Self.scatterUnits
        // Tilt magnitude 8..12, sign by its own lane: every sticker leans a little,
        // none lies flat (the web retune's character).
        let magnitude =
            Self.minTiltDegrees
            + StickerSeed.unit(seed, lane: 2) * (Self.maxTiltDegrees - Self.minTiltDegrees)
        self.tiltDegrees = StickerSeed.unit(seed, lane: 3) < 0.5 ? -magnitude : magnitude
    }

    static func key(userId: String, emoji: String, cell: Int) -> String {
        "\(userId)|\(emoji)|\(cell)"
    }

    /// The anchor in the 36-unit module: near-centered with a slight lower-left
    /// bias (the web's 17,20), so the glyph reads seated rather than pinned.
    public static let anchorXUnits: Double = 17
    public static let anchorYUnits: Double = 20
    /// Square jitter per axis, module units. With the 23-unit glyph this keeps a
    /// sticker mostly inside its cell (bleed is possible by z-order, not a goal).
    public static let scatterUnits: Double = 8
    public static let minTiltDegrees: Double = 8
    public static let maxTiltDegrees: Double = 12
}

/// Deterministic placement seeding: FNV-1a over the sticker's key bytes, mixed per
/// lane. Deliberately NOT `Hasher` (its seed is randomized per process; a sticker's
/// placement must be reproducible so tests pin it and re-creation lands identically).
/// ASCII-agnostic byte hashing, no locale anywhere (INV-1).
enum StickerSeed {
    static func hash(_ key: String) -> UInt64 {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in key.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x0000_0100_0000_01b3
        }
        return hash
    }

    /// A stable value in [0, 1) for one lane of one seed (splitmix-style finalizer).
    static func unit(_ seed: UInt64, lane: UInt64) -> Double {
        var x = seed ^ (lane &* 0x9e37_79b9_7f4a_7c15)
        x ^= x >> 33
        x = x &* 0xff51_afd7_ed55_8ccd
        x ^= x >> 33
        return Double(x >> 11) / Double(1 << 53)
    }
}

/// The sticker book: every reaction currently on the board, local echoes included.
/// `@Observable` so the grid and the fan read it directly; a value-in/value-out core
/// (explicit `at` everywhere) so CrossyUITests pins the semantics with no clock.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class ReactionModel {
    /// Live stickers in arrival order (piles stack oldest-under-newest by z).
    public private(set) var stickers: [ReactionSticker] = []

    /// Bumped on every mutation, coalesce refreshes included, so a hosting view can
    /// key sweep scheduling on it (`onChange` never fires twice for one value).
    public private(set) var revision = 0

    /// Accepted local send instants inside the sliding window (the 5/s cap).
    @ObservationIgnored private var sentAt: [TimeInterval] = []

    public init() {}

    public var isEmpty: Bool { stickers.isEmpty }

    /// The soonest instant a sweep could retire something; nil with no stickers.
    public var nextExpiry: TimeInterval? { stickers.map(\.endsAt).min() }

    /// An inbound `reaction` notice (PROTOCOL.md §6, §9). Receive-any: no set check,
    /// no rate check (the server already capped each sender); only the pile cap and
    /// coalescing shape what renders.
    public func receive(userId: String, emoji: String, cell: Int, at now: TimeInterval) {
        place(userId: userId, emoji: emoji, cell: cell, at: now)
    }

    /// A local send attempt: the 5/s sliding-window cap decides, and an accepted
    /// send echoes locally at once (the server never echoes a react back, §9, so the
    /// sender's own sticker exists only here). Returns whether the caller should put
    /// the frame on the wire; a capped attempt sends nothing and echoes nothing.
    @discardableResult
    public func send(userId: String, emoji: String, cell: Int, at now: TimeInterval) -> Bool {
        sentAt.removeAll { now - $0 >= ReactionPolicy.sendWindowSeconds }
        guard sentAt.count < ReactionPolicy.maxSendsPerSecond else { return false }
        sentAt.append(now)
        place(userId: userId, emoji: emoji, cell: cell, at: now)
        return true
    }

    /// Retire everything past its end. Idempotent; the hosting view schedules calls
    /// off `nextExpiry` (the FlashBook sweep pattern).
    public func sweep(at now: TimeInterval) {
        let before = stickers.count
        stickers.removeAll { $0.endsAt <= now }
        if stickers.count != before { revision += 1 }
    }

    /// Drop everything at once (the lab's reset; a room teardown needs nothing, the
    /// model dies with the screen).
    public func removeAll() {
        guard !stickers.isEmpty else { return }
        stickers.removeAll()
        revision += 1
    }

    // MARK: - The one placement path

    private func place(userId: String, emoji: String, cell: Int, at now: TimeInterval) {
        let key = ReactionSticker.key(userId: userId, emoji: emoji, cell: cell)

        // Coalesce (§9 client guidance): the same sender repeating the same emoji at
        // the same cell pulses the live sticker in place and refreshes its timer.
        // Never a new sprite, and never a replayed entry: bornAt holds.
        if let index = stickers.firstIndex(where: { $0.id == key && $0.endsAt > now }) {
            stickers[index].refreshedAt = now
            stickers[index].endsAt = now + ReactionPolicy.decaySeconds
            revision += 1
            return
        }

        // An EXPIRED same-key sticker the sweep has not yet retired leaves first:
        // the book never holds two stickers with one identity (the render layer's
        // ForEach keys on it).
        stickers.removeAll { $0.id == key }

        // Pile cap: with maxVisiblePerCell already standing in this cell, the
        // stalest incumbent (oldest refresh) starts its exit now — replaced, not
        // popped, so the departure still reads as motion. Nothing else in the pile
        // moves (the born-correct rule: incumbents hold still).
        let standing = stickers.indices.filter {
            stickers[$0].cell == cell && stickers[$0].endsAt > now
        }
        if standing.count >= ReactionPolicy.maxVisiblePerCell {
            let evict = standing.min {
                stickers[$0].refreshedAt < stickers[$1].refreshedAt
            }
            if let evict {
                stickers[evict].endsAt = min(
                    stickers[evict].endsAt, now + StickerEnvelope.exitSeconds)
            }
        }

        stickers.append(ReactionSticker(userId: userId, emoji: emoji, cell: cell, at: now))
        revision += 1
    }
}

/// The sticker's motion contract, one set of constants with closed-form curves as the
/// pinned specification. The SHIPPING renderer (ReactionStickerLayer) does not sample
/// these per frame: it builds SwiftUI spring and keyframe animations FROM these exact
/// constants, so Core Animation transforms each glyph's one rasterized layer and the
/// content is never re-rendered mid-flight (the owner's entry-shake finding
/// 2026-07-14, the transform-not-repaint lesson both platforms converged on; the
/// web's twin fix is #247). The closed forms remain normative: tests sample them to
/// pin the character, and they are the reference for any future sampled use.
///
/// The numbers are the web layer's, measured from styles.css so the two clients share
/// one slap: entry springs scale 0.3 to 1 (easing overshoot ~9.4%, which renders as a
/// ~6.6% scale peak over the 0.7 step) with opacity riding the same spring, clamped;
/// exit shrinks to 0.7 and fades over the final 380 ms of the 5 s life; the coalesce
/// pulse rises to 1.16 at 45% of its 300 ms and returns to exactly 1. Past
/// `entrySettleSeconds` the closed form is CLAMPED to exactly 1 (residual ~7e-5,
/// below visual epsilon), so the resting transform is bit-identical from settle
/// through exit start; SwiftUI's spring ends at the model value 1 exactly, giving the
/// shipped render the same guarantee by construction.
public enum StickerEnvelope {
    // Entry (the slap; the web spring's fitted parameters: peak at ~147 ms,
    // easing overshoot ~9.4%).
    public static let entryResponse: TimeInterval = 0.235
    public static let entryDampingRatio: Double = 0.60
    /// Where the entry starts: the web's sticker-in keyframe.
    public static let entryFromScale: Double = 0.3
    /// The settle horizon for the CLOSED FORM: beyond it the sampled scale is
    /// exactly 1 (the clamp step is ~7e-5 of the 0.7 step, invisible).
    public static let entrySettleSeconds: TimeInterval = 0.6

    // Exit (shrink+fade inside the sticker's life; the web's sticker-out).
    public static let exitSeconds: TimeInterval = 0.38
    public static let exitFinalScale: Double = 0.7

    // The coalesce pulse (the web's sticker-repulse: 300 ms, peak 1.16 at 45%).
    public static let pulsePeak: Double = 0.16
    public static let pulseSeconds: TimeInterval = 0.3
    public static let pulsePeakAt: TimeInterval = 0.135

    // Reduce Motion: upright, fade-only (owner spec; the web's fade pair).
    public static let reducedMotionFadeInSeconds: TimeInterval = 0.18

    /// The entry spring's unit step response (underdamped, released at rest),
    /// clamped to exactly 1 past the settle horizon. Scale and opacity both ride it.
    /// The horizon comparison absorbs float dust (an instant computed as `t - born`
    /// can land a few ulps under the literal), which is the clamp's whole job.
    static func entryUnit(_ elapsed: TimeInterval) -> Double {
        if elapsed <= 0 { return 0 }
        if elapsed >= entrySettleSeconds - 1e-9 { return 1 }
        let omega = 2 * Double.pi / entryResponse
        let zeta = entryDampingRatio
        let damped = omega * (1 - zeta * zeta).squareRoot()
        let decay = exp(-zeta * omega * elapsed)
        return 1 - decay * (cos(damped * elapsed) + (zeta * omega / damped) * sin(damped * elapsed))
    }

    /// The entry scale: 0.3 springing to 1, so the rendered overshoot is the easing
    /// overshoot scaled by the 0.7 step (~1.066 at the peak).
    public static func entryScale(sinceBorn elapsed: TimeInterval) -> Double {
        entryFromScale + (1 - entryFromScale) * entryUnit(elapsed)
    }

    /// The entry opacity: the same spring, clamped at 1 exactly as CSS clamps an
    /// overshooting opacity.
    public static func entryOpacity(sinceBorn elapsed: TimeInterval) -> Double {
        min(1, max(0, entryUnit(elapsed)))
    }

    /// The coalesce pulse: 1 to 1.16 over the first 135 ms, back to exactly 1 at
    /// 300 ms, each leg eased out (the CSS timing function applies per segment).
    public static func pulseScale(sincePulse elapsed: TimeInterval) -> Double {
        if elapsed <= 0 || elapsed >= pulseSeconds - 1e-9 { return 1 }
        if elapsed < pulsePeakAt {
            return 1 + pulsePeak * easeOut(elapsed / pulsePeakAt)
        }
        let fall = (elapsed - pulsePeakAt) / (pulseSeconds - pulsePeakAt)
        return 1 + pulsePeak * (1 - easeOut(fall))
    }

    /// The exit's shrink factor over the sticker's final `exitSeconds`; 1 before.
    public static func exitScale(untilEnd remaining: TimeInterval) -> Double {
        guard remaining < exitSeconds else { return 1 }
        let progress = 1 - max(0, remaining) / exitSeconds
        return 1 + (exitFinalScale - 1) * easeInOut(progress)
    }

    /// The whole scale for one sticker at one instant. Reduce Motion renders at rest:
    /// scale 1 always (fade-only entry and exit, no spring, no pulse, no shrink).
    public static func scale(
        _ sticker: ReactionSticker, at now: TimeInterval, reduceMotion: Bool
    ) -> Double {
        if reduceMotion { return 1 }
        var value = entryScale(sinceBorn: now - sticker.bornAt)
        if sticker.refreshedAt > sticker.bornAt {
            value *= pulseScale(sincePulse: now - sticker.refreshedAt)
        }
        return value * exitScale(untilEnd: sticker.endsAt - now)
    }

    /// The whole opacity for one sticker at one instant. Reduce Motion swaps the
    /// spring fade for the web's plain 180 ms ease.
    public static func opacity(
        _ sticker: ReactionSticker, at now: TimeInterval, reduceMotion: Bool
    ) -> Double {
        let entry =
            reduceMotion
            ? min(1, max(0, (now - sticker.bornAt) / reducedMotionFadeInSeconds))
            : entryOpacity(sinceBorn: now - sticker.bornAt)
        let remaining = sticker.endsAt - now
        guard remaining < exitSeconds else { return entry }
        guard remaining > 0 else { return 0 }
        return entry * (remaining / exitSeconds)
    }

    /// The tilt the renderer applies: the born-correct angle, or upright under
    /// Reduce Motion (owner spec).
    public static func tiltDegrees(_ sticker: ReactionSticker, reduceMotion: Bool) -> Double {
        reduceMotion ? 0 : sticker.tiltDegrees
    }

    private static func easeOut(_ t: Double) -> Double {
        let clamped = min(1, max(0, t))
        return 1 - (1 - clamped) * (1 - clamped) * (1 - clamped)
    }

    private static func easeInOut(_ t: Double) -> Double {
        let clamped = min(1, max(0, t))
        return clamped * clamped * (3 - 2 * clamped)
    }
}
