// Completion and the terminal states (roadmap I2d). The celebration is the mosaic
// (apps/ios/DESIGN.md §8): on the store's transition to completed, every letter
// tints to its writer's color, holds for a breath, then settles back to ink; the
// simple form is tint, hold, settle (EXPERIENCE.md §6). It fires on the status
// TRANSITION as the store exposes it, exactly once (INV-3): never on render, never
// again on a reconnect into an already-completed game (a welcome snapshot of a
// completed game shows the terminal state without replaying the celebration). The
// gate is a pure fold over observed store states so exactly-once pins headlessly;
// the model is the thin observable the solve screen drives from onChange.

import CrossyDesign
import CrossyStore
import Foundation
import Observation

/// The room's lifecycle as the render layer reads it, mapped from the store's
/// status at the view boundary (the RosterMember pattern: CrossyUI names its own
/// plain types, protocol types stay in their ring per ARCHITECTURE.md AD-2).
public enum RoomStatus: Equatable, Sendable {
    case ongoing
    case completed
    case abandoned
}

/// The exactly-once celebration derivation (INV-3). A pure fold over observed
/// (status, live) pairs: the celebration fires on the one observation where the
/// status turns completed AFTER the store has exposed a live ongoing board. A
/// store that was never live-and-ongoing (a fresh connection whose first snapshot
/// is already terminal) shows the terminal state and never celebrates; a store
/// that already fired never fires again, whatever reconnects follow. The store
/// applies snapshots atomically, so the view never observes a transient
/// ongoing-live pair inside a welcome-into-completed.
public struct CelebrationGate: Equatable, Sendable {
    private var wasLiveOngoing = false
    private var fired = false

    public init() {}

    /// Feed one observed store state; returns true exactly when the celebration
    /// fires. Idempotent for repeated identical observations.
    public mutating func observe(status: RoomStatus, live: Bool) -> Bool {
        if status == .ongoing {
            if live { wasLiveOngoing = true }
            return false
        }
        guard status == .completed, wasLiveOngoing, !fired else { return false }
        fired = true
        return true
    }
}

/// The mosaic's clock (DESIGN.md §8: tint, hold, settle). Pure math over elapsed
/// seconds, the FlashEnvelope pattern. The rise is the celebration response from
/// the motion grammar (§7: celebration is the register allowed to breathe); hold
/// and settle are starting values for the I2e device tuning pass. The whole
/// envelope is an opacity crossfade, which is already the §7 reduced-motion form,
/// so Reduce Motion changes nothing here (it mutes the clarity beat instead,
/// CompletionModel).
public enum MosaicEnvelope {
    /// The tint: ink to the writers' colors.
    public static let riseDuration: TimeInterval = Motion.Springs.celebrationResponse
    /// The hold: one breath at full tint.
    public static let holdDuration: TimeInterval = 1.6
    /// The settle: back to ink, a slow exhale, longer than the rise.
    public static let settleDuration: TimeInterval = 0.9

    public static var duration: TimeInterval {
        riseDuration + holdDuration + settleDuration
    }

    /// The clarity beat's window (DESIGN.md §4, §8): standing glass clears through
    /// the tint and the hold, then refrosts across the settle, as the stats arrive.
    public static var clarityDuration: TimeInterval {
        riseDuration + holdDuration
    }

    /// Tint intensity `elapsed` seconds after the trigger, in [0, 1]: an ease-out
    /// rise, a flat hold, an ease-in-out settle, zero outside the envelope.
    public static func intensity(elapsed: TimeInterval) -> Double {
        if elapsed <= 0 { return 0 }
        if elapsed < riseDuration {
            let t = elapsed / riseDuration
            return 1 - pow(1 - t, 3)
        }
        if elapsed < riseDuration + holdDuration { return 1 }
        let t = (elapsed - riseDuration - holdDuration) / settleDuration
        if t >= 1 { return 0 }
        // Ease-in-out: the settle leaves the hold as gently as it lands on ink.
        let eased = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        return 1 - eased
    }

    public static func isClarified(elapsed: TimeInterval) -> Bool {
        elapsed >= 0 && elapsed < clarityDuration
    }
}

/// The mosaic's palette: writer attribution to roster color, one entry per cell
/// that holds a sequenced letter with a writer. Derived entirely from the event
/// log's `by` attribution (DESIGN.md §8), never from the optimistic overlay; a
/// cleared cell keeps its clearer as `by` with no value and must not tint. ID-1:
/// the completion mosaic is muteable by a single constant; a muted switch derives
/// nothing, so no draw pass can leak a tint.
public enum GridMosaic {
    /// The paper wash under the tinted glyph, scaled by the envelope's intensity.
    /// Louder than the teammate wash (0.12): the mosaic is the celebration.
    public static let washAlpha: Double = 0.30

    /// Colors by cell. `writers` maps a cell to the userId whose letter it holds
    /// (sequenced state only); slotting follows the presence rule: the wire color
    /// is authoritative, the user-id hash is the fallback, and the local player
    /// tints like everyone else (the mosaic is the whole room's fingerprint).
    public static func colors(
        writers: [Int: String],
        participants: [GridPresence.ParticipantInput],
        ground: GridGround,
        completionMosaicEnabled: Bool = AttributionSwitches.completionMosaicEnabled
    ) -> [Int: RGBColor] {
        guard completionMosaicEnabled else { return [:] }
        let roster = Dictionary(
            participants.map { ($0.userId, $0) },
            uniquingKeysWith: { first, _ in first })
        var colors: [Int: RGBColor] = [:]
        for (cell, by) in writers {
            let identity = GridPresence.rosterColor(
                wireColor: roster[by]?.color ?? "", userId: by)
            colors[cell] = ground.rosterColor(identity)
        }
        return colors
    }
}

/// The completion confetti (owner ask 2026-07-11, amending §8's no-confetti
/// line): a restrained drift over the board in the room's roster colors, riding
/// the celebration's one instant beside the mosaic. It lives between paper and
/// glass (the §1 law: people between), never blocks a touch, and is skipped
/// entirely under Reduce Motion (the summary still lands; there is no reduced
/// equivalent because a static confetto is just litter). The field is pure math,
/// deterministically seeded, so the whole drift pins headlessly: the view only
/// evaluates poses against elapsed time. Deliberately quieter than the web's
/// drift; the mosaic stays the iOS headline.
public struct ConfettiFleck: Equatable, Sendable {
    /// Spawn x in unit stage width.
    public let unitX: Double
    /// Seconds after the trigger before this fleck enters.
    public let delay: TimeInterval
    /// Seconds this fleck takes to cross the stage.
    public let fall: TimeInterval
    /// Sway amplitude in unit stage width.
    public let sway: Double
    /// Sway angular rate, radians per second.
    public let swayRate: Double
    /// Sway phase offset, radians.
    public let phase: Double
    /// Spin rate, radians per second (signed).
    public let spin: Double
    /// Long edge, points.
    public let size: Double
    /// Index into the field's palette.
    public let colorIndex: Int
}

/// One fleck's render state at an instant, in unit stage coordinates.
public struct ConfettiPose: Equatable, Sendable {
    public let unitX: Double
    public let unitY: Double
    public let rotation: Double
    public let alpha: Double
}

/// The drift's constants and per-fleck kinematics. Analytic over elapsed time
/// (no per-frame integration), the MosaicEnvelope discipline: a dropped frame
/// costs smoothness, never trajectory.
public enum ConfettiEnvelope {
    public static let fleckCount = 90
    /// Spawn stagger window.
    public static let maxDelay: TimeInterval = 0.5
    public static let fallMin: TimeInterval = 1.7
    public static let fallMax: TimeInterval = 2.4
    /// The whole drift is over by here; the overlay unmounts on this clock.
    public static var duration: TimeInterval { maxDelay + fallMax }

    /// Pose `elapsed` seconds after the trigger, nil while the fleck has not
    /// entered or after it has finished. Enters just above the stage (unitY < 0),
    /// exits just below (unitY > 1), fades in fast and out over its last fifth.
    public static func pose(_ fleck: ConfettiFleck, elapsed: TimeInterval) -> ConfettiPose? {
        let t = elapsed - fleck.delay
        // The end check tolerates one ulp of float noise (a caller reconstructing
        // delay + fall lands a hair past fall); p clamps so the exit pose is exact.
        guard t >= 0, t <= fleck.fall + 1e-9 else { return nil }
        let p = min(1, t / fleck.fall)
        // Ease-in fall: gathering speed reads as gravity without integration.
        let unitY = -0.06 + 1.14 * (0.55 * p + 0.45 * p * p)
        let unitX = fleck.unitX + fleck.sway * sin(fleck.swayRate * t + fleck.phase)
        let alpha = min(1, t / 0.2) * max(0, min(1, (1 - p) / 0.2))
        return ConfettiPose(
            unitX: unitX, unitY: unitY,
            rotation: fleck.phase + fleck.spin * t,
            alpha: alpha)
    }
}

/// The confetti field: flecks plus their palette, built once per celebration.
/// Colors come from the room's roster (the people are the only color, §1); the
/// caller maps participants through the ground's roster table. An empty palette
/// yields an empty field, so a room with no one to color simply does not drift.
public struct ConfettiField: Equatable, Sendable {
    public let flecks: [ConfettiFleck]
    public let colors: [RGBColor]

    public init(flecks: [ConfettiFleck], colors: [RGBColor]) {
        self.flecks = flecks
        self.colors = colors
    }

    /// SplitMix64: tiny, deterministic, and pure (no Foundation randomness), so
    /// the same seed always builds the same drift and tests pin real values.
    private struct SplitMix64 {
        var state: UInt64
        mutating func next() -> UInt64 {
            state &+= 0x9E37_79B9_7F4A_7C15
            var z = state
            z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
            z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
            return z ^ (z >> 31)
        }
        /// Uniform in [0, 1).
        mutating func unit() -> Double {
            Double(next() >> 11) * (1.0 / 9_007_199_254_740_992.0)
        }
        mutating func range(_ lo: Double, _ hi: Double) -> Double {
            lo + unit() * (hi - lo)
        }
    }

    public static func make(colors: [RGBColor], seed: UInt64 = 0xC0FE_1D0) -> ConfettiField {
        guard !colors.isEmpty else { return ConfettiField(flecks: [], colors: []) }
        var rng = SplitMix64(state: seed)
        let flecks = (0..<ConfettiEnvelope.fleckCount).map { i in
            ConfettiFleck(
                unitX: rng.range(-0.02, 1.02),
                delay: rng.range(0, ConfettiEnvelope.maxDelay),
                fall: rng.range(ConfettiEnvelope.fallMin, ConfettiEnvelope.fallMax),
                sway: rng.range(0.008, 0.035),
                swayRate: rng.range(1.6, 3.4),
                phase: rng.range(0, 2 * Double.pi),
                spin: rng.range(-3, 3),
                size: rng.range(5, 9),
                colorIndex: i % colors.count)
        }
        return ConfettiField(flecks: flecks, colors: colors)
    }
}

/// One mosaic in flight: the palette and the trigger instant, snapshotted in the
/// view body (the GridFrame pattern) and consumed by the Canvas draw pass against
/// the render clock.
public struct MosaicWash: Equatable, Sendable {
    public let colors: [Int: RGBColor]
    /// Reference-date seconds at the celebration trigger.
    public let startedAt: TimeInterval

    public init(colors: [Int: RGBColor], startedAt: TimeInterval) {
        self.colors = colors
        self.startedAt = startedAt
    }
}

/// The completion beat's owner: the gate and the mosaic clock live here, apart
/// from chrome morphs (RoomChromeModel) and gameplay (GameStore). The solve
/// screen feeds it store transitions from onChange, never from render (INV-3).
/// The facts card's presentation moved to RoomChromeModel with the card itself
/// (owner ruling 2026-07-10: the room summons it mid-solve too); the
/// celebration's one instant below is what opens it at completion.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class CompletionModel {
    /// Non-nil while the mosaic plays; the grid's timeline runs against it.
    public private(set) var mosaicStartedAt: TimeInterval?

    /// The §4 clarity beat: true through the tint and the hold on iOS 26 glass
    /// (the fallback below 26 stays inert; §8 names no fallback).
    public private(set) var isClarityBeat = false

    /// The celebration's instant, set on the gate's one firing (INV-3) whatever
    /// the mosaic switch says: one-shot riders (the §7 completion haptic, the
    /// stats card's arrival with the celebration, owner ruling 2026-07-10)
    /// observe this, never the muteable mosaic clock (ID-1).
    public private(set) var celebrationFiredAt: TimeInterval?

    /// Non-nil while the confetti drifts (owner ask 2026-07-11); the overlay
    /// mounts against it and its Canvas runs on this instant. A rider on the
    /// gate's one firing like the haptic, so it plays with the mosaic muted
    /// (ID-1's switch governs attribution tint, not the party) but never under
    /// Reduce Motion, where the drift is skipped whole.
    public private(set) var confettiStartedAt: TimeInterval?

    @ObservationIgnored private var gate = CelebrationGate()
    @ObservationIgnored private var celebrationTask: Task<Void, Never>?
    @ObservationIgnored private var confettiTask: Task<Void, Never>?

    public init() {}

    /// Feed one observed store state (status mapped at the view boundary, live is
    /// sync == .live). Fires the celebration exactly once per the gate (INV-3).
    /// Reduce Motion keeps the mosaic (a pure crossfade, the §7 equivalent) and
    /// mutes the clarity beat; a muted mosaic switch (ID-1) skips straight to the
    /// stats card.
    public func observe(
        status: RoomStatus,
        live: Bool,
        reduceMotion: Bool = false,
        mosaicEnabled: Bool = AttributionSwitches.completionMosaicEnabled,
        confettiEnabled: Bool = AttributionSwitches.completionConfettiEnabled,
        now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard gate.observe(status: status, live: live) else { return }
        // The stats arrive WITH the celebration (owner ruling 2026-07-10,
        // amending the earlier settle-then-stats staging): the card morphs
        // from the clock while the mosaic plays behind it, summoned off this
        // instant by the solve screen. A muted mosaic (ID-1) reduces the
        // celebration to the card alone.
        celebrationFiredAt = now
        // The confetti rides the same instant (owner ask 2026-07-11), skipped
        // whole under Reduce Motion; the timed nil unmounts the overlay so the
        // finished room settles back to paper and glass.
        if confettiEnabled && !reduceMotion {
            confettiStartedAt = now
            confettiTask?.cancel()
            confettiTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(ConfettiEnvelope.duration))
                guard !Task.isCancelled else { return }
                self?.confettiStartedAt = nil
            }
        }
        guard mosaicEnabled else { return }
        mosaicStartedAt = now
        isClarityBeat = !reduceMotion
        celebrationTask?.cancel()
        celebrationTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(MosaicEnvelope.clarityDuration))
            guard !Task.isCancelled else { return }
            self?.isClarityBeat = false
            try? await Task.sleep(
                for: .seconds(MosaicEnvelope.duration - MosaicEnvelope.clarityDuration))
            guard !Task.isCancelled else { return }
            self?.mosaicStartedAt = nil
        }
    }
}

/// The terminal pour-back's trigger (DESIGN.md §4: transient panels yield to
/// intent, and the room's own moments count as intent): fires exactly on an
/// observed transition from ongoing into a terminal status, when the solve
/// screen pours back the melt and the roster (the stats card then owns the
/// completion stage). A pure fold, the CelebrationGate pattern: a reconnect
/// whose first observation is already terminal fires nothing (there was no
/// open room on screen to pour back), and repeated terminal observations (two
/// onChange observers read one store) never refire.
public struct TerminalPourBackGate: Equatable, Sendable {
    private var last: RoomStatus?

    public init() {}

    /// Feed one observed status; true exactly when an ongoing room turned
    /// terminal.
    public mutating func observe(_ status: RoomStatus) -> Bool {
        defer { last = status }
        return status != .ongoing && last == .ongoing
    }
}

/// Terminal-state facts the room renders: the ID-5 lexicon sentences
/// (EXPERIENCE.md §5, verbatim) and the frozen-deck rule. The store already
/// refuses mutations after a terminal status (InputActions pins it); this is the
/// rendered truth: the deck retires, selection stays for browsing, navigation
/// stays live.
public enum RoomTerminal {
    /// EXPERIENCE.md lexicon: completion.
    public static let completedNotice = "Solved together"
    /// EXPERIENCE.md lexicon: abandoned.
    public static let abandonedNotice = "The host ended this game"
    /// EXPERIENCE.md lexicon: kicked, the one honest sentence.
    public static let kickedNotice = "The host removed you from this room"
    /// The kicked exit's affordance: home is Rooms (lexicon), so the way out says
    /// so plainly (ID-5: controls that say what happens).
    public static let kickedExitWord = "Back to Rooms"

    /// The deck leaves the room on a terminal status; taps and swipes stay live.
    public static func deckRetired(status: RoomStatus) -> Bool {
        status != .ongoing
    }
}
