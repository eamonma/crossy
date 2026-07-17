// Completion and the terminal states (roadmap I2d). The celebration is the mosaic
// (apps/ios/DESIGN.md §8): on the store's transition to completed, every letter
// tints to its writer's color, holds for a breath, then the letters settle back to
// ink while the crisp color melts into a BLURRED field that stands (ratified
// 2026-07-17, the wash-blur study) — the completed board keeps the room's
// fingerprint as a soft color field under the ink, the web reveal arc's settled
// record (ContributionMosaic). It fires on the status TRANSITION as the store
// exposes it,
// exactly once (INV-3): never on render, never again on a reconnect into an
// already-completed game (a welcome snapshot of a completed game shows the terminal
// state — which wears the settled field once first-correct owners land, without
// replaying the celebration). The gate is a pure fold over observed store states so
// exactly-once pins headlessly; the model is the thin observable the solve screen
// drives from onChange.

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

    /// The GLYPH tint's intensity `elapsed` seconds after the trigger, in [0, 1]:
    /// an ease-out rise, a flat hold, an ease-in-out settle back to zero (the
    /// letters return to ink). The crisp paper wash under them rides this SAME
    /// envelope (one clock, one melt): on the settle the hard cells let go with
    /// the letters' return while the blurred field breathes in (`fieldIntensity`).
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

    /// The blurred field's melt (ratified 2026-07-17, the wash-blur study): the
    /// settle's crossfade partner starts this beat after the crisp cells begin
    /// letting go (web parity: the 120 ms transition delay).
    public static let fieldDelay: TimeInterval = 0.12
    /// The field's fade, an ease-out (web parity: 900 ms
    /// cubic-bezier(0.22, 0.61, 0.36, 1)).
    public static let fieldFadeDuration: TimeInterval = 0.9

    /// The blurred FIELD's intensity: zero through the tint and the hold, an
    /// ease-out rise across the settle (the melt), then 1 forever. The settled
    /// record is the field now — the web reveal arc still ends standing, never
    /// back at plain ink, and an envelope that ended at zero was the mosaic
    /// flash-then-disappear bug: the room's fingerprint erased itself ~3 s
    /// after it appeared. The fade's tail runs `fieldDelay` past the envelope's
    /// landing; the settled draw pass paints the exact resting weight, so the
    /// pause frame lands it (the isolation-fade discipline).
    public static func fieldIntensity(elapsed: TimeInterval) -> Double {
        let t = (elapsed - riseDuration - holdDuration - fieldDelay) / fieldFadeDuration
        if t <= 0 { return 0 }
        if t >= 1 { return 1 }
        return 1 - pow(1 - t, 3)
    }

    public static func isClarified(elapsed: TimeInterval) -> Bool {
        elapsed >= 0 && elapsed < clarityDuration
    }
}

/// The isolation filter's value (web legend parity: the analysis legend rows
/// toggle the same dim on the web mosaic): which solver the settled record
/// isolates, who it isolated before, and the toggle's instant — enough for the
/// draw pass to crossfade between the two dims statelessly. Pure presentation
/// over the standing MosaicWash; it never touches the celebration (INV-3) or
/// the wash's own clock.
public struct MosaicIsolation: Equatable, Sendable {
    /// The isolated solver's userId, or nil while a clear fades back to the
    /// full multi-color wash.
    public let solverId: String?
    /// The previous value, the crossfade's from-side (nil = the full wash).
    public let previousSolverId: String?
    /// Reference-date seconds at the toggle.
    public let changedAt: TimeInterval

    public init(solverId: String?, previousSolverId: String?, changedAt: TimeInterval) {
        self.solverId = solverId
        self.previousSolverId = previousSolverId
        self.changedAt = changedAt
    }
}

/// The mosaic's palette: writer attribution to roster color, one entry per cell
/// that holds a sequenced letter with a writer. Derived entirely from the event
/// log's `by` attribution (DESIGN.md §8), never from the optimistic overlay; a
/// cleared cell keeps its clearer as `by` with no value and must not tint. ID-1:
/// the completion mosaic is muteable by a single constant; a muted switch derives
/// nothing, so no draw pass can leak a tint.
public enum GridMosaic {
    /// The BLOOM's crisp wash under the tinted glyph, scaled by the envelope's
    /// intensity. Louder than the teammate wash (0.12): the mosaic is the
    /// celebration. The bloom's weight only — the settle melts it into the
    /// blurred field at `settledAlpha`. Web parity: this crisp 0.3 stays the
    /// time-gated replay's per-cell weight (mosaicReveal.ts WASH_ALPHA).
    public static let washAlpha: Double = 0.30

    /// The settled record's weight (ratified 2026-07-17 with the blur tokens
    /// below, 0.5 on all three platforms): the blurred field's alpha over the
    /// paper, and the crisp spotlight's an isolation returns. A NEW constant
    /// beside `washAlpha` on purpose, so the replay weight never moves with it.
    public static let settledAlpha: Double = 0.5

    /// The field's gaussian radius as a fraction of the cell module (ratified
    /// 2026-07-17: 20/36 of the cell, ~0.56x). ONE constant expressed as the
    /// fraction, so the blur scales with the cell in points everywhere.
    public static let fieldBlurFraction: Double = 20.0 / 36.0

    /// The field's radius in module units (GridModule.unit is the 36-unit cell).
    public static var fieldBlurRadius: CGFloat {
        GridModule.unit * fieldBlurFraction
    }

    /// Edge cells' tint rects extend outward this many radii past the frame
    /// before blurring (edge saturation): the layer clips back to the board,
    /// and past ~1.5 radii the gaussian's missing tail is sub-perceptual, so
    /// the field holds full strength at the frame instead of fading into it.
    public static let fieldOverscanFactor: Double = 1.5

    /// The overscan in module units.
    public static var fieldOverscan: CGFloat {
        fieldBlurRadius * fieldOverscanFactor
    }

    /// The blurred field's tint rect for a cell: the full cell module, with
    /// edge cells extended outward past the frame by the overscan. Pure
    /// geometry, so the edge saturation pins headlessly.
    public static func fieldRect(_ cell: Int, rows: Int, cols: Int) -> CGRect {
        var rect = GridModule.cellRect(cell, cols: cols)
        let row = cell / cols
        let col = cell % cols
        if col == 0 {
            rect.origin.x -= fieldOverscan
            rect.size.width += fieldOverscan
        }
        if col == cols - 1 { rect.size.width += fieldOverscan }
        if row == 0 {
            rect.origin.y -= fieldOverscan
            rect.size.height += fieldOverscan
        }
        if row == rows - 1 { rect.size.height += fieldOverscan }
        return rect
    }

    /// The isolation dim's floor: the fraction of the settled weight a
    /// non-isolated cell keeps. The tint composites as alpha OVER the paper, so
    /// a lower alpha IS a step toward the ground color on both grounds by
    /// construction — the dimmed hands recess into paper while the isolated one
    /// holds the settled weight. Dimmed, never erased: the record stays
    /// traceable.
    public static let isolationDim: Double = 0.18

    /// The isolation crossfade: fast and quiet (a filter, not a celebration),
    /// and already the §7 reduced-motion form (a pure opacity crossfade).
    public static let isolationFadeDuration: TimeInterval = 0.25

    /// The blurred field's opacity multiplier under the isolation filter: the
    /// field carries the record only while no solver is isolated (a blurred
    /// single hand has no shape to read), so a toggle crossfades it against
    /// the crisp spotlight, on the same quiet clock both ways.
    public static func fieldMultiplier(
        isolation: MosaicIsolation?, elapsed: TimeInterval
    ) -> Double {
        guard let isolation else { return 1 }
        return crossfade(
            from: isolation.previousSolverId == nil ? 1 : 0,
            to: isolation.solverId == nil ? 1 : 0,
            elapsed: elapsed)
    }

    /// The crisp spotlight's per-cell multiplier over the settled weight,
    /// `elapsed` seconds after the toggle: the isolated solver's cells hold the
    /// full settled weight, every other hand rests at the dim floor, and no
    /// isolation is zero (the blurred field carries the full record instead).
    /// Pure math, so the filter pins headlessly and any frame past the fade (a
    /// paused timeline's frozen date included) draws the exact target.
    public static func spotlightMultiplier(
        owner: String, isolation: MosaicIsolation?, elapsed: TimeInterval
    ) -> Double {
        guard let isolation else { return 0 }
        return crossfade(
            from: spotlightTarget(owner: owner, solverId: isolation.previousSolverId),
            to: spotlightTarget(owner: owner, solverId: isolation.solverId),
            elapsed: elapsed)
    }

    /// One side's resting spotlight: nothing at the full record (the field
    /// owns it), the settled weight for the isolated solver's own hand, the
    /// dim floor for everyone else's.
    private static func spotlightTarget(owner: String, solverId: String?) -> Double {
        guard let solverId else { return 0 }
        return owner == solverId ? 1 : isolationDim
    }

    /// One ease-in-out crossfade over the fade's window: the filter leaves one
    /// value as gently as it lands on the other. Shared by the field and the
    /// spotlight so the two layers cross on exactly the same clock.
    private static func crossfade(
        from: Double, to: Double, elapsed: TimeInterval
    ) -> Double {
        if from == to { return to }
        if elapsed <= 0 { return from }
        let t = elapsed / isolationFadeDuration
        if t >= 1 { return to }
        let eased = t < 0.5 ? 4 * t * t * t : 1 - pow(-2 * t + 2, 3) / 2
        return from + (to - from) * eased
    }

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
    /// Cell to the writer whose hand it is — the same map `colors` derives from,
    /// carried alongside because the isolation filter keys per cell on the
    /// OWNER, not the color (two solvers can share a roster slot's color).
    public let writers: [Int: String]
    /// Reference-date seconds at the celebration trigger.
    public let startedAt: TimeInterval
    /// True once the envelope has landed (or when the record stands without
    /// ever blooming, the reconnect-into-completed path): the draw pass paints
    /// the standing record (the blurred field at the settled weight, glyph 0)
    /// with no clock, and the grid's timeline pauses — a settled mosaic costs
    /// no frames.
    public let settled: Bool
    /// The isolation filter over the settled record (CompletionModel.isolation),
    /// or nil at the full multi-color field.
    public let isolation: MosaicIsolation?

    public init(
        colors: [Int: RGBColor], writers: [Int: String] = [:],
        startedAt: TimeInterval, settled: Bool = false,
        isolation: MosaicIsolation? = nil
    ) {
        self.colors = colors
        self.writers = writers
        self.startedAt = startedAt
        self.settled = settled
        self.isolation = isolation
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
    /// Non-nil from the bloom's start on, forever: the settle lands on the
    /// standing blurred field (MosaicEnvelope.fieldIntensity), never back on
    /// plain ink, so the completed board keeps the room's fingerprint. The
    /// grid's timeline runs against it only while `mosaicSettled` is false.
    public private(set) var mosaicStartedAt: TimeInterval?

    /// True once the envelope has landed (or immediately, for a stand without a
    /// bloom): the wash is a constant now, so the grid's timeline pauses.
    public private(set) var mosaicSettled = false

    /// The isolation filter's one truth: a tapped legend row isolates that
    /// solver on the settled record; nil is the full multi-color record. The
    /// analysis panel's rows and the grid's draw pass both read this, so a
    /// toggle is a value change, never a re-render of the wash arc.
    public private(set) var isolation: MosaicIsolation?

    /// The isolated solver, or nil at the full wash (the legend rows' selected
    /// state).
    public var isolatedSolverId: String? { isolation?.solverId }

    /// The §4 clarity beat: true through the tint and the hold on iOS 26 glass
    /// (the fallback below 26 stays inert; §8 names no fallback).
    public private(set) var isClarityBeat = false

    /// The celebration's instant, set on the gate's one firing (INV-3) whatever
    /// the mosaic switch says: one-shot riders observe this (the §7 completion
    /// haptic, and the confetti below). The analysis panel's summon rides
    /// `summonToken` instead, after the bloom settles (owner ruling 2026-07-13).
    public private(set) var celebrationFiredAt: TimeInterval?

    /// Non-nil while the confetti drifts (owner ask 2026-07-11); the overlay
    /// mounts against it and its Canvas runs on this instant. A rider on the
    /// gate's one firing like the haptic, so it plays with the mosaic muted
    /// (ID-1's switch governs attribution tint, not the party) but never under
    /// Reduce Motion, where the drift is skipped whole.
    public private(set) var confettiStartedAt: TimeInterval?

    /// Bumped once when the completion mosaic's settle lands on the live path
    /// (owner ruling 2026-07-13): the solve screen melts the analysis panel open
    /// off this, so the panel arrives AFTER the bloom, never during it. Monotonic,
    /// so a re-render never re-summons.
    public private(set) var summonToken: Int = 0

    @ObservationIgnored private var gate = CelebrationGate()
    @ObservationIgnored private var celebrationTask: Task<Void, Never>?
    @ObservationIgnored private var confettiTask: Task<Void, Never>?
    /// The mosaic arms exactly once per completion (the ready or the absent
    /// branch, whichever the solve screen reaches first), so the bloom never
    /// doubles and the summon fires at most once.
    @ObservationIgnored private var mosaicArmed = false

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
        confettiEnabled: Bool = AttributionSwitches.completionConfettiEnabled,
        now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard gate.observe(status: status, live: live) else { return }
        celebrationFiredAt = now
        // The confetti rides the gate's instant (owner ask 2026-07-11), skipped
        // whole under Reduce Motion; the timed nil unmounts the overlay so the
        // finished room settles back to paper and glass. The haptic rides it too
        // (the solve screen's onChange). Both are the instant the room lands.
        if confettiEnabled && !reduceMotion {
            confettiStartedAt = now
            confettiTask?.cancel()
            confettiTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(ConfettiEnvelope.duration))
                guard !Task.isCancelled else { return }
                self?.confettiStartedAt = nil
            }
        }
        // The mosaic no longer starts here (owner ruling 2026-07-13): the bloom
        // paints FIRST-CORRECT owners, which the GET /analysis fetch carries, not
        // the live event log's last writer. So the solve screen starts it through
        // `startMosaic` once the bundle lands (or the last-writer fallback stands
        // when the fetch is absent). The gate's instant is the haptic and the
        // confetti; the color comes a beat later, exactly as on the web.
    }

    /// Start the completion mosaic once its colors are known: tint, hold, then
    /// the letters settle back to ink while the crisp color melts into the
    /// standing blurred field (MosaicEnvelope).
    /// Deferred from the gate on purpose (owner
    /// ruling 2026-07-13): the bloom is first-correct truth from GET /analysis, so
    /// it waits for the bundle rather than flashing the live last-writer log; the
    /// last-writer fallback stands only when the fetch is absent (or no fetch is
    /// wired). Idempotent (armed once), so the solve screen may call it from either
    /// the ready or the absent branch without a double bloom. `summonOnSettle` arms
    /// the one analysis-panel summon for the instant the settle lands (the live
    /// path); the fallback passes false so a bloom with no bundle never summons.
    public func startMosaic(
        summonOnSettle: Bool,
        reduceMotion: Bool = false,
        mosaicEnabled: Bool = AttributionSwitches.completionMosaicEnabled,
        now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard !mosaicArmed else { return }
        mosaicArmed = true
        guard mosaicEnabled else {
            // Muted mosaic (ID-1): no bloom to wait on, so the summon, if armed,
            // lands at once rather than never (a muted switch must not swallow it).
            if summonOnSettle { summonToken += 1 }
            return
        }
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
            self?.settleMosaic(summonOnSettle: summonOnSettle)
        }
    }

    /// The settle's landing: the mosaic STANDS (the flash-then-disappear fix —
    /// `mosaicStartedAt` is never nilled, the wash stays as the completed board's
    /// record) and the timeline may pause. The panel arrives after the bloom,
    /// never during it (owner ruling 2026-07-13): the settle landing is the
    /// summon's cue on the live path. Internal so the fold pins headlessly
    /// without riding the envelope's real ~3 s.
    func settleMosaic(summonOnSettle: Bool) {
        mosaicSettled = true
        if summonOnSettle { summonToken += 1 }
    }

    /// Toggle isolation from a legend row: the same solver clears back to the
    /// full wash, another switches to them. Isolation exists only on the
    /// SETTLED wash — a bloom in flight ignores the tap outright (the one
    /// arming and the celebration gate are untouchable, INV-3), and an
    /// unsettled room has no standing record to filter. A pure presentation
    /// value: nothing here moves the gate, the arming, the clock, or the
    /// summon.
    public func toggleIsolation(
        _ userId: String, now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard mosaicSettled else { return }
        let current = isolation?.solverId
        isolation = MosaicIsolation(
            solverId: current == userId ? nil : userId,
            previousSolverId: current,
            changedAt: now)
    }

    /// Stand the settled record without a celebration: the reconnect-into-completed
    /// path. INV-3 holds — no bloom, no clarity beat, no haptic, no confetti, no
    /// summon replays; this is terminal-state RENDERING, not a celebration. The
    /// completed board wears the first-correct fingerprint the moment the
    /// analysis bundle lands, instead of reverting to plain ink forever (the
    /// flash-then-disappear bug's revisit half). Shares the one arming with
    /// `startMosaic`, so a stand can never follow a bloom or vice versa.
    public func standMosaic(
        mosaicEnabled: Bool = AttributionSwitches.completionMosaicEnabled,
        now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard !mosaicArmed else { return }
        mosaicArmed = true
        guard mosaicEnabled else { return }
        // Born past its own envelope: any clock that reads it sees the settled
        // form; `settled` is what the draw pass actually keys on.
        mosaicStartedAt = now - MosaicEnvelope.duration
        mosaicSettled = true
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
