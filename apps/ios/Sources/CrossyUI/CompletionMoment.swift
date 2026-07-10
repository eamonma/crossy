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

/// The completion beat's owner: the gate, the mosaic clock, the stats card's
/// presentation, and the kicked exit's flag live here, apart from chrome morphs
/// (RoomChromeModel) and gameplay (GameStore). The solve screen feeds it store
/// transitions from onChange, never from render (INV-3).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class CompletionModel {
    /// Non-nil while the mosaic plays; the grid's timeline runs against it.
    public private(set) var mosaicStartedAt: TimeInterval?

    /// The §4 clarity beat: true through the tint and the hold on iOS 26 glass
    /// (the fallback below 26 stays inert; §8 names no fallback).
    public private(set) var isClarityBeat = false

    /// The stats card (EXPERIENCE.md Completed): auto-presents as the mosaic
    /// settles; dismissible back to the frozen room; re-presentable from the
    /// completed zone.
    public var isStatsOpen = false

    @ObservationIgnored private var gate = CelebrationGate()
    @ObservationIgnored private var celebrationTask: Task<Void, Never>?

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
        now: TimeInterval = Date.now.timeIntervalSinceReferenceDate
    ) {
        guard gate.observe(status: status, live: live) else { return }
        guard mosaicEnabled else {
            isStatsOpen = true
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
            self?.mosaicStartedAt = nil
            self?.isStatsOpen = true
        }
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

/// The stats card's content (EXPERIENCE.md Completed: solve time, entries,
/// solvers, from `gameCompleted.stats`), derived once as plain strings so the
/// card renders no arithmetic. The time prefers the server's stat and falls back
/// to the ambient clock's frozen value (ID-2: the timer becomes the headline only
/// at completion); the detail line carries whatever stats exist and vanishes when
/// none do.
public struct StatsCardContent: Equatable, Sendable {
    public let time: String
    public let detail: String?

    public init(time: String, detail: String?) {
        self.time = time
        self.detail = detail
    }

    public static func make(
        solveTimeSeconds: Int?,
        totalEvents: Int?,
        participantCount: Int?,
        firstFillAt: String?,
        completedAt: String?
    ) -> StatsCardContent {
        let seconds =
            solveTimeSeconds
            ?? AmbientClock.elapsedSeconds(
                firstFillAt: firstFillAt.flatMap(AmbientClock.parse),
                completedAt: completedAt.flatMap(AmbientClock.parse),
                now: completedAt.flatMap(AmbientClock.parse) ?? Date.now)
        var parts: [String] = []
        if let totalEvents {
            parts.append(totalEvents == 1 ? "1 entry" : "\(totalEvents) entries")
        }
        if let participantCount {
            parts.append(participantCount == 1 ? "1 solver" : "\(participantCount) solvers")
        }
        return StatsCardContent(
            time: AmbientClock.display(seconds: seconds),
            detail: parts.isEmpty ? nil : parts.joined(separator: " · "))
    }
}
