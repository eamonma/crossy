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

import Foundation
import Observation

/// Client-side reaction policy: the v1 send set and the caps. Deliberately OUTSIDE the
/// codec (PROTOCOL.md §9: decoders enforce shape only, never set membership) and
/// outside the store (D24: the store holds nothing for reactions). The server's
/// published set governs what relays; this is the client's own send gate and render
/// budget.
public enum ReactionPolicy {
    /// The v1 reaction send set, exactly these five graphemes (PROTOCOL.md §9).
    /// Send-gated only: an inbound emoji outside this set still renders (receive-any).
    public static let sendSet: [String] = ["🎉", "🤔", "👀", "💀", "🫡"]

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
/// center, `leanDegrees`, `rotationDegrees`) is seeded at birth from the stable key
/// alone and immutable for the sticker's life (the born-correct rule); only the
/// timestamps move, and only through coalescing or eviction.
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

    // Born-correct placement, module units and degrees.
    public let offsetX: Double
    public let offsetY: Double
    public let leanDegrees: Double
    public let rotationDegrees: Double

    /// The one angle the renderer applies: lean and rotation compose.
    public var tiltDegrees: Double { leanDegrees + rotationDegrees }

    init(userId: String, emoji: String, cell: Int, at now: TimeInterval) {
        self.id = Self.key(userId: userId, emoji: emoji, cell: cell)
        self.userId = userId
        self.emoji = emoji
        self.cell = cell
        self.bornAt = now
        self.refreshedAt = now
        self.endsAt = now + ReactionPolicy.decaySeconds
        let seed = StickerSeed.hash(id)
        // A uniform scatter disc (sqrt keeps density even), generous but mostly
        // inside the 36-unit cell: bleed happens by tilt at the rim, never by aim.
        let angle = StickerSeed.unit(seed, lane: 0) * 2 * Double.pi
        let radius = StickerSeed.unit(seed, lane: 1).squareRoot() * Self.scatterRadiusUnits
        self.offsetX = cos(angle) * radius
        self.offsetY = sin(angle) * radius
        self.leanDegrees = (StickerSeed.unit(seed, lane: 2) * 2 - 1) * Self.maxLeanDegrees
        self.rotationDegrees =
            (StickerSeed.unit(seed, lane: 3) * 2 - 1) * Self.maxRotationDegrees
    }

    static func key(userId: String, emoji: String, cell: Int) -> String {
        "\(userId)|\(emoji)|\(cell)"
    }

    /// Scatter bound, module units from the cell center. With the 21-unit glyph in
    /// the 36-unit module this keeps every sticker mostly inside its cell.
    public static let scatterRadiusUnits: Double = 7
    public static let maxLeanDegrees: Double = 6
    public static let maxRotationDegrees: Double = 12
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

/// The sticker's motion, all of it closed-form over elapsed time so the Canvas
/// evaluates it per frame with no animation state (the FlashEnvelope pattern) and
/// tests pin the curve's character by sampling.
///
/// Entry is the web's slap: an underdamped spring from 0 with a single ~9% overshoot
/// and a snappy settle. Past `entrySettleSeconds` the spring is CLAMPED to exactly 1
/// (the residual there is ~1e-6, far below visual epsilon), so the resting transform
/// is bit-identical from settle through exit start — the no-post-entry-snap rule, and
/// the iOS mirror of the web's #245 settle-pop fix. Exit is a shrink+fade inside the
/// sticker's last quarter second. The coalesce pulse is a smooth bump that starts at
/// exactly 1, peaks fast, and is clamped back to exactly 1 once spent, so a pulse can
/// never leave a sticker off its resting transform either.
public enum StickerEnvelope {
    // Entry (the slap).
    public static let entryResponse: TimeInterval = 0.32
    /// Damping ratio 0.608: first (only visible) overshoot = exp(-πζ/√(1-ζ²)) ≈ 9%.
    public static let entryDampingRatio: Double = 0.608
    /// The settle horizon: beyond it scale is exactly 1. The clamp step is ~1e-6.
    public static let entrySettleSeconds: TimeInterval = 1.2
    /// A short fade-in so the spring never pops from nothing.
    public static let entryFadeSeconds: TimeInterval = 0.08

    // Exit (shrink+fade, inside the sticker's life).
    public static let exitSeconds: TimeInterval = 0.25
    public static let exitFinalScale: Double = 0.6

    // The coalesce pulse.
    public static let pulsePeak: Double = 0.16
    public static let pulsePeakAt: TimeInterval = 0.09
    /// Beyond this the pulse is exactly spent (residual ~1e-4 of the peak).
    public static let pulseSettleSeconds: TimeInterval = 0.8

    // Reduce Motion: upright, fade-only (owner spec).
    public static let reducedMotionFadeSeconds: TimeInterval = 0.2

    /// The entry spring: unit step response of an underdamped oscillator released at
    /// 0 with zero velocity, clamped to exactly 1 past the settle horizon.
    public static func entryScale(sinceBorn elapsed: TimeInterval) -> Double {
        if elapsed <= 0 { return 0 }
        if elapsed >= entrySettleSeconds { return 1 }
        let omega = 2 * Double.pi / entryResponse
        let zeta = entryDampingRatio
        let damped = omega * (1 - zeta * zeta).squareRoot()
        let decay = exp(-zeta * omega * elapsed)
        return 1 - decay * (cos(damped * elapsed) + (zeta * omega / damped) * sin(damped * elapsed))
    }

    /// The coalesce pulse's scale factor: 1 at t = 0, `1 + pulsePeak` at `pulsePeakAt`,
    /// smoothly spent (t/tp · e^(1 − t/tp) rises and decays with no corner), clamped
    /// to exactly 1 once settled.
    public static func pulseScale(sincePulse elapsed: TimeInterval) -> Double {
        if elapsed <= 0 || elapsed >= pulseSettleSeconds { return 1 }
        let normalized = elapsed / pulsePeakAt
        return 1 + pulsePeak * normalized * exp(1 - normalized)
    }

    /// The exit's shrink factor over the sticker's final `exitSeconds`; 1 before.
    public static func exitScale(untilEnd remaining: TimeInterval) -> Double {
        guard remaining < exitSeconds else { return 1 }
        let progress = 1 - max(0, remaining) / exitSeconds
        return 1 + (exitFinalScale - 1) * easeOut(progress)
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

    /// The whole opacity for one sticker at one instant: a quick fade in, full
    /// presence, and the exit fade out. Reduce Motion stretches only the fade-in.
    public static func opacity(
        _ sticker: ReactionSticker, at now: TimeInterval, reduceMotion: Bool
    ) -> Double {
        let fadeIn = reduceMotion ? reducedMotionFadeSeconds : entryFadeSeconds
        let entry = min(1, max(0, (now - sticker.bornAt) / fadeIn))
        let remaining = sticker.endsAt - now
        guard remaining < exitSeconds else { return entry }
        guard remaining > 0 else { return 0 }
        return entry * easeOut(remaining / exitSeconds)
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
}
