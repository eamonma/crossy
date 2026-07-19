// The check vote's presentation core (PROTOCOL.md §10, D32; Wave 15.10 card rulings), pure and
// testable, so the exact copy, the viewer's role, the chip states, the solo suppression, the
// close act, the card's dismissal policy, and the announcements are asserted in XCTest without
// a running view. The card, the status capsule, and the hold-to-propose control read this;
// nothing here draws or animates. Copy is normative: the strings below are the spec verbatim,
// greppable and pinned by CheckVotePresentationTests.

import CrossyProtocol
import CrossyStore
import Foundation

/// The vote's copy, verbatim from the owner-ratified UX contract (design/check-vote/UX.md U1,
/// amended 2026-07-18). No counts for the room (only the proposer sees a tally); no clock
/// renders anywhere (the chips settling are the only live signal; the timebox is felt only as
/// the lapse line).
public enum CheckVoteCopy {
    /// The proposal line everyone but the proposer reads: "{name} wants to check the puzzle".
    public static func proposal(name: String) -> String { "\(name) wants to check the puzzle" }

    /// The PROPOSER's own line (owner ruling 2026-07-18): never a self-echo, never a
    /// second-person contortion; their line is the wait itself.
    public static let waiting = "Waiting for the room"

    /// The neutral stand-in for a departed or unknown proposer (a raw userId never renders).
    public static let fallbackProposer = "A teammate"
    /// The neutral stand-in for a chip whose roster entry is gone.
    public static let fallbackElector = "Player"

    /// The two verbs, "Check it" primary.
    public static let approve = "Check it"
    public static let reject = "Keep solving"

    /// The pass reveal: "Checking…" (single ellipsis character) through the breath and the
    /// wash, then "{n} to fix" lands last.
    public static let checking = "Checking\u{2026}"
    public static func toFix(_ count: Int) -> String { "\(count) to fix" }

    /// The close lines, one calm line each. Terminal closes carry no line.
    public static let rejected = "The room keeps solving"
    public static let lapsed = "The vote lapsed"
    public static let gridChanged = "Vote ended, the grid changed"

    /// The proposer-only post-fail tally: "{approvals} of {needed}". Never shown to the room.
    public static func tally(approvals: Int, needed: Int) -> String { "\(approvals) of \(needed)" }

    /// The single close line for a non-passing close, or nil when the close is silent
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

/// The viewer's relation to the open vote (PROTOCOL.md §10, D32): the proposer sees pucks and
/// no verbs (their proposal already approved); an elector who has not voted sees the verbs; a
/// non-elector reads only.
public enum CheckVoteViewerRole: Equatable, Sendable {
    case proposer
    case elector
    case nonElector
}

/// One elector's ballot on the open vote, for the puck's settling (unvoted is dimmed).
public enum ElectorBallot: Equatable, Sendable {
    case approved
    case rejected
    case unvoted

    public var hasVoted: Bool { self != .unvoted }
}

/// One elector puck in electorate (ascending) order: the userId to resolve against the roster
/// identity system, and its ballot for the settle. No count is derived here (the room never
/// sees a tally, U5).
public struct ElectorChip: Equatable, Sendable {
    public let userId: String
    public let ballot: ElectorBallot

    public init(userId: String, ballot: ElectorBallot) {
        self.userId = userId
        self.ballot = ballot
    }
}

/// The card's presentation, derived purely from the open vote and the viewer's identity. The
/// SwiftUI card renders pucks with the app's identity system and the two verbs; this decides
/// what to show and to whom. `shouldPresent` is false for a solo electorate, so the auto-pass
/// never shows chrome for a frame (PROTOCOL.md §10, D32).
public struct CheckVoteCardModel: Equatable, Sendable {
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

    /// The card's headline. The proposer reads the wait, never their own name back (owner
    /// ruling 2026-07-18); everyone else reads the attributed question.
    public var proposalLine: String {
        viewerRole == .proposer
            ? CheckVoteCopy.waiting : CheckVoteCopy.proposal(name: proposerName)
    }

    /// Present the two verbs? Only to an elector who has not yet cast a ballot. The proposer
    /// (pucks, no verbs) and non-electors (read-only) never see them.
    public func showsVerbs(selfUserId: String?) -> Bool {
        guard viewerRole == .elector, let selfUserId else { return false }
        guard let chip = electors.first(where: { $0.userId == selfUserId }) else { return false }
        return !chip.ballot.hasVoted
    }

    /// Build the card model from the store's open vote and the viewer's identity, or nil when
    /// no vote is open. `nameFor` resolves a display name (roster lookup); a missing roster
    /// entry falls back to the neutral "A teammate", never the raw userId (owner ruling
    /// 2026-07-18).
    public static func make(
        vote: CheckVoteState?, selfUserId: String?, nameFor: (String) -> String?
    ) -> CheckVoteCardModel? {
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
        return CheckVoteCardModel(
            proposerId: vote.by,
            proposerName: nameFor(vote.by) ?? CheckVoteCopy.fallbackProposer,
            electors: electors,
            viewerRole: role,
            voteSeq: vote.openedSeq)
    }

    /// Whether a vote should present the card at all (PROTOCOL.md §10, D32): only a live
    /// multiplayer vote does. A solo electorate auto-passes, so it shows no vote chrome.
    public static func shouldPresent(vote: CheckVoteState?) -> Bool {
        guard let vote else { return false }
        return !vote.isSolo
    }
}

/// A close's resolution as ONE value: the calm line and the proposer-only tally render
/// together or not at all. (Main rendered them through an if/else that shadowed the tally
/// into dead code; making them one struct closes that class of bug.)
public struct CheckVoteResolution: Equatable, Sendable {
    public let line: String
    /// The proposer's "{approvals} of {needed}", failed closes only; nil for the room.
    public let tally: String?

    public init(line: String, tally: String?) {
        self.line = line
        self.tally = tally
    }
}

/// What the vote surface plays after the store's beats, pure so the beat sequence is testable:
/// nothing (idle or terminal-silent), an in-card resolution, the pass's "Checking…" hold, or
/// the landed count.
public enum CheckVoteAct: Equatable, Sendable {
    case none
    /// The close line (and the proposer's tally) standing in the card for the ~2.5 s recess.
    case resolution(CheckVoteResolution)
    /// A pass closed: the card has condensed to the status capsule reading "Checking…" while
    /// the breath and the mark wash play on the board (U6).
    case checking
    /// The reveal's landing: "{n} to fix", last (U6).
    case revealed(Int)
}

/// The close beat's staging (PROTOCOL.md §10; U1, U6, U7): a pass holds "Checking…" awaiting
/// `puzzleChecked`; a fail or lapse stages the one calm line plus the proposer's tally; a
/// grid-broken cancel stages its line alone; a terminal close stages silence.
public enum CheckVoteCloseAct {
    public static func forClose(
        outcome: CheckVoteOutcome, reason: CheckVoteCloseReason?,
        viewerRole: CheckVoteViewerRole, approvals: Int, needed: Int
    ) -> CheckVoteAct {
        if outcome == .passed { return .checking }
        guard let line = CheckVoteCopy.recessLine(outcome: outcome, reason: reason) else {
            return .none  // terminal: completion or abandon supersedes
        }
        let tally =
            viewerRole == .proposer && outcome == .failed
            ? CheckVoteCopy.tally(approvals: approvals, needed: needed) : nil
        return .resolution(CheckVoteResolution(line: line, tally: tally))
    }
}

/// The card's dismissal policy (Wave 15.10 design decision, flagged for the owner): the wire
/// has no vote-cancel, so a blocking card with no verb could hold its viewer the whole 30 s
/// timebox. The elector's ballot is the exit and their card never dismisses; everyone without
/// a castable ballot (the proposer, a non-elector, an elector who already voted — a rejoin can
/// land there) may put the card away and return to the board. The vote stays live in the
/// store; the resolution re-presents for its recess.
public enum CheckVoteCardPolicy {
    public static func isDismissible(role: CheckVoteViewerRole, hasOpenBallot: Bool) -> Bool {
        !(role == .elector && hasOpenBallot)
    }
}

/// The haptic a close outcome plays (U9): pass is the success pattern (timed to the mark wash
/// at the call site), fail and lapse are the two soft taps, a terminal cancel is silent (the
/// game moved on and owns its own moment).
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

    /// The haptic for a landing `puzzleChecked` (Wave 15.10 fix): the success fanfare belongs
    /// only to a pass where a REAL vote stood (the U6 ceremony); a solo check marking your own
    /// errors, and a bare rollout check, keep the soft checkLanded thud.
    public static func forPuzzleChecked(attributed: Bool, voteStood: Bool) -> SolveHaptic {
        attributed && voteStood ? .checkVotePassed : .checkLanded
    }
}

/// The VoiceOver announcements (U10): posted politely at the vote's beats so a screen-reader
/// solver hears the room's motion without focus theft. Pure strings, pinned; the posting side
/// effect lives with the view.
public enum CheckVoteAnnouncement {
    /// The open announcement, per viewer role: an elector hears the question and that actions
    /// exist; the proposer hears their proposal confirmed; a non-elector hears the question
    /// alone (no actions to offer).
    public static func opened(model: CheckVoteCardModel) -> String {
        switch model.viewerRole {
        case .proposer:
            return "Check proposed. \(CheckVoteCopy.waiting)."
        case .elector:
            return "\(CheckVoteCopy.proposal(name: model.proposerName)). Actions available."
        case .nonElector:
            return "\(CheckVoteCopy.proposal(name: model.proposerName))."
        }
    }

    /// The close announcement: the resolution's line, joined with the proposer's tally when it
    /// stands.
    public static func closed(_ resolution: CheckVoteResolution) -> String {
        let parts = [resolution.line, resolution.tally].compactMap { $0 }
        return parts.map { "\($0)." }.joined(separator: " ")
    }

    /// The reveal's landing count.
    public static func toFix(_ count: Int) -> String { "\(CheckVoteCopy.toFix(count))." }
}
