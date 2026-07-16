// The post-game analysis surface's data, as the render layer reads it (the
// RosterMember pattern, ARCHITECTURE.md AD-2: CrossyUI names its own plain types,
// and the protocol twins stay in their ring). The composition root fetches
// `GET /games/{id}/analysis` through CrossyAPI and maps its `AnalysisView` into
// these before the room ever sees it, so CrossyUI keeps importing only CrossyStore
// and CrossyDesign.
//
// The bundle is first-correct truth (design/post-game/ANALYSIS.md, engine
// `solveTrace`): `owners` is who solved each cell FIRST, the same attribution the
// web mosaic and legend paint, distinct from the live event log's last-writer
// `by`. It carries userIds, cells, and numbers only, never a letter (INV-6): the
// server strips the trace to this shape, and this type has nowhere to hold a
// solution value by construction.

import Foundation
import Observation

/// The analysis bundle for one completed game, render-ready. Times are relative
/// seconds from the solve's start (design/post-game/ANALYSIS.md); `owners` maps a
/// cell index to the userId who first got it right.
public struct RoomAnalysis: Equatable, Sendable {
    /// Cell index to first-correct writer's userId. The mosaic's colors and the
    /// legend's roster both read this.
    public let owners: [Int: String]
    public let momentum: RoomMomentum
    /// The room's longest pause and the burst that broke it, or nil when the trace
    /// is too short to have a gap (fewer than two fills).
    public let turningPoint: RoomTurningPoint?
    /// The solver superlatives, in the wire's ladder-rank order
    /// (design/post-game/TITLES.md): at most one per solver, empty for a solo solve
    /// (the solo rule) or an older API that predates titles.
    public let titles: [RoomTitle]

    public init(
        owners: [Int: String],
        momentum: RoomMomentum,
        turningPoint: RoomTurningPoint?,
        titles: [RoomTitle]
    ) {
        self.owners = owners
        self.momentum = momentum
        self.turningPoint = turningPoint
        self.titles = titles
    }

    /// Distinct solvers who own at least one square (the stat trio's "Solvers").
    public var solverCount: Int { Set(owners.values).count }

    /// Total squares with a first-correct owner (the stat trio's "Squares").
    public var entryCount: Int { owners.count }

    /// The solve span as `M:SS` (the stat trio's "Time"): the momentum duration,
    /// the reach from the first fill to the last (design/post-game/ANALYSIS.md),
    /// which is what the web panel labels Time.
    public var durationLabel: String { CrossyUI.formatMSS(momentum.durationSeconds) }
}

/// A seconds count as `M:SS`, or `H:MM:SS` past an hour, matching the web's
/// formatMSS (apps/web/src/ui/analysisReadout.ts) byte for byte: seconds floored,
/// the seconds and (when hours show) minutes fields zero-padded, negatives and
/// non-finite input clamped to "0:00" so a degenerate span never reads "NaN:NaN".
/// The one CrossyUI moment formatter, so the Analysis header (RoomAnalysis) and the
/// solver-title claims (TitleLadder) render the same span identically, and both
/// agree with the web digit for digit. Pure so it pins headlessly.
func formatMSS(_ seconds: Double) -> String {
    let safe = seconds.isFinite ? seconds : 0
    let total = max(0, Int(safe.rounded(.down)))
    let hours = total / 3600
    let minutes = (total % 3600) / 60
    let secs = total % 60
    let pad = { (n: Int) in String(format: "%02d", n) }
    return hours > 0 ? "\(hours):\(pad(minutes)):\(pad(secs))" : "\(minutes):\(pad(secs))"
}

/// The solving-tempo ribbon's data: a fixed-length, peak-normalized intensity
/// series and the span it covers (engine `momentum`, design/post-game/ANALYSIS.md).
public struct RoomMomentum: Equatable, Sendable {
    /// The solve span in seconds (0 for an empty or instant solve).
    public let durationSeconds: Double
    /// 40 samples in [0, 1], each a bucket's fill count over the busiest bucket's
    /// (engine constant `MOMENTUM_SAMPLES`). All zero when nothing was filled.
    public let samples: [Double]

    public init(durationSeconds: Double, samples: [Double]) {
        self.durationSeconds = durationSeconds
        self.samples = samples
    }

    /// True when any bucket carried a fill: the ribbon has a shape to draw, rather
    /// than the flat quiet line a short solve leaves.
    public var hasSignal: Bool { samples.contains { $0 > 0 } }
}

/// One solver superlative (design/post-game/TITLES.md): the wire's award, carried
/// verbatim. `key` is the lowercase-kebab ladder key ("saboteur"); the display table
/// (TitleLadder) decides what it knows, so an unknown key from a grown ladder is
/// skipped at render, never dropped here (forward compatibility, PROTOCOL.md §12).
public struct RoomTitle: Equatable, Sendable {
    public let userId: String
    /// The pinned lowercase-kebab title key, verbatim from the wire.
    public let key: String
    /// The rung's own count (overwrites, whole seconds, squares), or nil for a rung
    /// that cites none. Never a letter (INV-6).
    public let evidence: Int?

    public init(userId: String, key: String, evidence: Int?) {
        self.userId = userId
        self.key = key
        self.evidence = evidence
    }
}

/// The room's longest pause and the burst that ended it (engine `TurningPoint`):
/// the ribbon shades the stall span and marks where solving picked back up.
public struct RoomTurningPoint: Equatable, Sendable {
    /// The largest gap between consecutive fills, in seconds.
    public let stallSeconds: Double
    /// The relative time, in seconds, of the fill that ended the gap.
    public let breakSeconds: Double
    /// Fills within the 30-second window after the break (engine `BURST_WINDOW_MS`).
    public let burst: Int

    public init(stallSeconds: Double, breakSeconds: Double, burst: Int) {
        self.stallSeconds = stallSeconds
        self.breakSeconds = breakSeconds
        self.burst = burst
    }
}

/// The analysis fetch's state machine, the thin observable the solve screen drives.
/// The bundle is fetched exactly once per completed room, off an injected async
/// closure (the composition root closes over the REST client and game id, keeping
/// CrossyUI out of the REST ring). A completion can be observed over the socket a
/// beat before the session has flushed `completed_at` to Postgres, so the endpoint
/// 404s for a short window right after a live finish; the load retries a few times
/// before it calls the game `absent` (the web client's completion-race guard,
/// apps/web completionAttribution).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class AnalysisModel {
    /// The fetch's four states: not yet asked, in flight, resolved, or given up
    /// (a 404 past the retries, or a genuine absence).
    public enum Phase: Equatable, Sendable {
        case idle
        case loading
        case ready(RoomAnalysis)
        case absent
    }

    public private(set) var phase: Phase = .idle

    @ObservationIgnored private var task: Task<Void, Never>?

    public init() {}

    /// The resolved bundle, or nil until it lands.
    public var bundle: RoomAnalysis? {
        if case let .ready(bundle) = phase { return bundle }
        return nil
    }

    /// Kick the one fetch for this room. Idempotent: a second call while a fetch is
    /// in flight or already resolved is a no-op, so both the completion edge and a
    /// tab-open can ask without racing. `fetch` returns nil on any failure (a 404,
    /// transport weather, a decode fault); the retries cover the completion race,
    /// after which `absent` stands.
    public func load(
        tries: Int = 3,
        delay: Duration = .milliseconds(700),
        _ fetch: @escaping () async -> RoomAnalysis?
    ) {
        guard case .idle = phase else { return }
        phase = .loading
        task?.cancel()
        task = Task { @MainActor [weak self] in
            for attempt in 0..<max(1, tries) {
                if Task.isCancelled { return }
                if let bundle = await fetch() {
                    guard !Task.isCancelled else { return }
                    self?.phase = .ready(bundle)
                    return
                }
                if attempt < tries - 1 {
                    try? await Task.sleep(for: delay)
                }
            }
            guard !Task.isCancelled else { return }
            self?.phase = .absent
        }
    }
}
