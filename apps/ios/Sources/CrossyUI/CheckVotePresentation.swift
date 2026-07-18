// The check vote's presentation core (PROTOCOL.md §10, D32; apps/ios Wave 15.5 UX), pure and
// testable, so the exact copy, the viewer's role, the chip states, the solo suppression, and
// the recess line are asserted in XCTest without a running view. The Bench, the ring, and the
// hold-to-propose control read this; nothing here draws or animates. Copy is normative: the
// strings below are the spec verbatim, greppable and pinned by CheckVotePresentationTests.

import CrossyProtocol
import CrossyStore
import Foundation

/// The vote's copy, verbatim from the Wave 15.5 UX spec. No counts for the room (only the
/// proposer sees a tally); no countdown digits anywhere (the ring is the only clock).
public enum CheckVoteCopy {
    /// The proposal line on the Bench: "{name} wants to check the puzzle".
    public static func proposal(name: String) -> String { "\(name) wants to check the puzzle" }

    /// The two verbs, "Check it" primary.
    public static let approve = "Check it"
    public static let reject = "Keep solving"

    /// The pass reveal: "Checking…" during the breath, then "{n} to fix" as the marks wash in.
    public static let checking = "Checking\u{2026}"
    public static func toFix(_ count: Int) -> String { "\(count) to fix" }

    /// The recess lines, one calm line each. Terminal closes carry no line.
    public static let rejected = "The room keeps solving"
    public static let lapsed = "The vote lapsed"
    public static let gridChanged = "Vote ended, the grid changed"

    /// The proposer-only post-fail tally: "{approvals} of {needed}". Never shown to the room.
    public static func tally(approvals: Int, needed: Int) -> String { "\(approvals) of \(needed)" }

    /// The single recess line for a non-passing close, or nil when the close is silent
    /// (a terminal close, PROTOCOL.md §10). A passing close reveals through `toFix`, not here.
    public static func recessLine(
        outcome: CheckVoteOutcome, reason: CheckVoteCloseReason?
    ) -> String? {
        switch (outcome, reason) {
        case (.failed, .rejected): return rejected
        case (.failed, .expired): return lapsed
        case (.cancelled, .gridBroken): return gridChanged
        case (.cancelled, .terminal): return nil  // the game moved on; no line
        case (.passed, _): return nil  // revealed through the mark wash
        default: return nil
        }
    }
}

/// The viewer's relation to the open vote (PROTOCOL.md §10, D32): the proposer sees chips and
/// no verbs (their proposal already approved); an elector who has not voted sees the verbs; a
/// non-elector reads only.
public enum CheckVoteViewerRole: Equatable, Sendable {
    case proposer
    case elector
    case nonElector
}

/// One elector's ballot on the open vote, for the chip's dimming (unvoted is dimmed).
public enum ElectorBallot: Equatable, Sendable {
    case approved
    case rejected
    case unvoted

    public var hasVoted: Bool { self != .unvoted }
}

/// One elector chip in electorate (ascending) order: the userId to color with the identity
/// system and its ballot for dimming. No count is derived here (the room never sees a tally).
public struct ElectorChip: Equatable, Sendable {
    public let userId: String
    public let ballot: ElectorBallot

    public init(userId: String, ballot: ElectorBallot) {
        self.userId = userId
        self.ballot = ballot
    }
}

/// The Bench's presentation, derived purely from the open vote and the viewer's identity. The
/// SwiftUI Bench renders chips with the app's identity colors and the two verbs; this decides
/// what to show and to whom. `shouldPresent` is false for a solo electorate, so the auto-pass
/// never shows chrome for a frame (PROTOCOL.md §10, D32).
public struct CheckVoteBenchModel: Equatable, Sendable {
    public let proposerId: String
    public let proposerName: String
    public let electors: [ElectorChip]
    public let viewerRole: CheckVoteViewerRole
    public let voteSeq: Int

    public init(
        proposerId: String, proposerName: String, electors: [ElectorChip],
        viewerRole: CheckVoteViewerRole, voteSeq: Int
    ) {
        self.proposerId = proposerId
        self.proposerName = proposerName
        self.electors = electors
        self.viewerRole = viewerRole
        self.voteSeq = voteSeq
    }

    /// The proposal line for the header.
    public var proposalLine: String { CheckVoteCopy.proposal(name: proposerName) }

    /// Has the viewer already voted (proposer counts as voted; a non-elector never votes)?
    public var viewerHasVoted: Bool {
        switch viewerRole {
        case .proposer: return true
        case .nonElector: return false
        case .elector: return false  // resolved against the chip by the caller's selfUserId
        }
    }

    /// Present the two verbs? Only to an elector who has not yet cast a ballot. The proposer
    /// (chips, no verbs) and non-electors (read-only) never see them.
    public func showsVerbs(selfUserId: String?) -> Bool {
        guard viewerRole == .elector, let selfUserId else { return false }
        guard let chip = electors.first(where: { $0.userId == selfUserId }) else { return false }
        return !chip.ballot.hasVoted
    }

    /// Build the Bench model from the store's open vote and the viewer's identity, or nil when
    /// no vote is open. `nameFor` resolves a display name (roster lookup); it falls back to the
    /// raw id so a missing roster entry never blanks the line.
    public static func make(
        vote: CheckVoteState?, selfUserId: String?, nameFor: (String) -> String?
    ) -> CheckVoteBenchModel? {
        guard let vote else { return nil }
        let approvals = Set(vote.approvals)
        let rejections = Set(vote.rejections)
        let electors = vote.electorate.map { id -> ElectorChip in
            let ballot: ElectorBallot =
                approvals.contains(id) ? .approved : rejections.contains(id) ? .rejected : .unvoted
            return ElectorChip(userId: id, ballot: ballot)
        }
        let role: CheckVoteViewerRole = {
            if selfUserId == vote.by { return .proposer }
            if let selfUserId, vote.electorate.contains(selfUserId) { return .elector }
            return .nonElector
        }()
        return CheckVoteBenchModel(
            proposerId: vote.by,
            proposerName: nameFor(vote.by) ?? vote.by,
            electors: electors,
            viewerRole: role,
            voteSeq: vote.openedSeq)
    }

    /// Whether a vote should raise the Bench at all (PROTOCOL.md §10, D32; Wave 15.5 UX): only
    /// a live multiplayer vote does. A solo electorate auto-passes, so it shows no vote chrome.
    public static func shouldPresent(vote: CheckVoteState?) -> Bool {
        guard let vote else { return false }
        return !vote.isSolo
    }
}

/// The proposer's post-fail tally line, shown only to the proposer after a failed/lapsed close
/// (PROTOCOL.md §10, D32; Wave 15.5 UX). Nil for the room and for a passing/terminal close.
public enum CheckVoteTally {
    public static func line(
        for outcome: CheckVoteOutcome, viewerRole: CheckVoteViewerRole,
        approvals: Int, needed: Int
    ) -> String? {
        guard viewerRole == .proposer, outcome == .failed else { return nil }
        return CheckVoteCopy.tally(approvals: approvals, needed: needed)
    }
}

/// The haptic a close outcome plays (Wave 15.5): pass is the success pattern (timed to the mark
/// wash at the call site), fail and lapse are the two soft taps, a terminal cancel is silent
/// (the game moved on and owns its own moment).
public enum CheckVoteHaptics {
    public static func forClose(
        outcome: CheckVoteOutcome, reason: CheckVoteCloseReason?
    ) -> SolveHaptic? {
        switch (outcome, reason) {
        case (.passed, _): return .checkVotePassed
        case (.failed, _): return .checkVoteFailed
        case (.cancelled, .gridBroken): return .checkVoteFailed
        case (.cancelled, .terminal): return nil  // completion/abandon owns the beat
        default: return nil
        }
    }
}
