// The island's lifecycle policy (roadmap I5a; EXPERIENCE.md §4: the Live Activity
// starts on backgrounding an ongoing room). A pure fold over observed (scenePhase,
// status, anchor) states, the CelebrationGate pattern: the app target's controller
// feeds observations and executes the returned action against ActivityKit; nothing
// here touches ActivityKit, so every rule pins headlessly on macOS. The rules,
// each pinned by a test:
//
// - Start only on the transition out of the foreground, at .inactive: ActivityKit
//   requires effective foreground at request time (SP-i3), so waiting for
//   .background is too late.
// - No anchor, no activity: before the first fill there is no timer origin (root
//   DESIGN.md D15), and ID-2 keeps the pre-fill 0:00 off the island.
// - End on a terminal room (completed, abandoned, kicked): the room is over.
// - Foreground return ends whatever is up: the room bar is back (DESIGN.md §8,
//   the island is the room bar condensed), and the same end sweeps any stale
//   activity a killed process left ticking (the activity outlives the app, D15).

/// The scene phase as the policy reads it, plain data at the view boundary (the
/// RoomStatus pattern: SwiftUI's ScenePhase stays in the app target).
public enum SolveScenePhase: Equatable, Sendable {
    case active
    case inactive
    case background
}

/// What the controller should do against ActivityKit after one observation.
public enum SolveActivityAction: Equatable, Sendable {
    /// Request the activity now, while the app is still effectively foreground.
    case start
    /// End every activity of the app's kind, immediately.
    case end
    case none
}

public struct SolveActivityPolicy: Equatable, Sendable {
    private var phase: SolveScenePhase?
    private var started = false

    public init() {}

    /// Feed one observed state; returns the action it implies. Repeated identical
    /// observations are idempotent (several onChange observers read one store).
    public mutating func observe(
        phase newPhase: SolveScenePhase,
        status: RoomStatus,
        kicked: Bool,
        hasFirstFill: Bool
    ) -> SolveActivityAction {
        let previous = phase
        phase = newPhase
        let ongoing = status == .ongoing && !kicked

        // A terminal room takes the island down ONLY when the scene is effectively
        // foreground: the room bar is back and owns the moment. Backgrounded, the
        // island belongs to the push channel — the server's alerting update carries
        // the announcement and its end retires the frame (PROTOCOL.md 12a). This rule
        // predates the push track and used to fire "wherever the scene is": a trivial
        // solve completed while the token upload's background assertion kept the
        // process (and its socket) alive briefly, gameCompleted arrived over that
        // warm socket, and the island died the instant the room finished, swallowing
        // the announcement (owner device report 2026-07-11 late). The foreground
        // return below still sweeps, so a backgrounded terminal island the server
        // somehow never ended dies on the next return anyway.
        if !ongoing, started {
            guard newPhase == .active else { return .none }
            started = false
            return .end
        }

        switch newPhase {
        case .inactive:
            // Leaving the foreground: .active to .inactive is the one moment a
            // request is both wanted and allowed (effective foreground, SP-i3).
            guard previous == .active, ongoing, hasFirstFill, !started else { return .none }
            started = true
            return .start
        case .active:
            // Foreground return: the room bar is back, so the island retires; the
            // same end sweeps whatever a previous process life left behind, which
            // is why the first-ever .active observation ends too.
            if previous == .active { return .none }
            started = false
            return .end
        case .background:
            // Too late to request (no effective foreground); the .inactive
            // transition already had its chance.
            return .none
        }
    }
}
