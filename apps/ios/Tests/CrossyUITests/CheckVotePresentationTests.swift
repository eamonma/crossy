// The check vote's presentation core (PROTOCOL.md §10, D32; apps/ios Wave 15.5 UX). The copy
// is normative, so every string is pinned here verbatim; the role derivation, chip states,
// solo suppression, recess line, proposer tally, and close haptic are asserted without a view.

import CrossyProtocol
import CrossyStore
import XCTest

@testable import CrossyUI

final class CheckVotePresentationTests: XCTestCase {

    private func vote(
        openedSeq: Int = 31, by: String = "u1", electorate: [String] = ["u1", "u2", "u3"],
        approvals: [String] = ["u1"], rejections: [String] = [], needed: Int = 2,
        expiresAt: String = "2026-07-07T00:00:30Z"
    ) -> CheckVoteState {
        CheckVoteState(
            openedSeq: openedSeq, by: by, electorate: electorate, approvals: approvals,
            rejections: rejections, needed: needed, expiresAt: expiresAt)
    }

    // MARK: - Copy, verbatim (Wave 15.5 UX spec)

    func test_copyIsVerbatim_D32() {
        XCTAssertEqual(CheckVoteCopy.proposal(name: "Ada"), "Ada wants to check the puzzle")
        XCTAssertEqual(CheckVoteCopy.approve, "Check it")
        XCTAssertEqual(CheckVoteCopy.reject, "Keep solving")
        XCTAssertEqual(CheckVoteCopy.checking, "Checking\u{2026}")
        XCTAssertEqual(CheckVoteCopy.toFix(3), "3 to fix")
        XCTAssertEqual(CheckVoteCopy.rejected, "The room keeps solving")
        XCTAssertEqual(CheckVoteCopy.lapsed, "The vote lapsed")
        XCTAssertEqual(CheckVoteCopy.gridChanged, "Vote ended, the grid changed")
        XCTAssertEqual(CheckVoteCopy.tally(approvals: 1, needed: 2), "1 of 2")
    }

    func test_recessLinePerCloseReason_D32() {
        XCTAssertEqual(CheckVoteCopy.recessLine(outcome: .failed, reason: .rejected), "The room keeps solving")
        XCTAssertEqual(CheckVoteCopy.recessLine(outcome: .failed, reason: .expired), "The vote lapsed")
        XCTAssertEqual(
            CheckVoteCopy.recessLine(outcome: .cancelled, reason: .gridBroken),
            "Vote ended, the grid changed")
        XCTAssertNil(
            CheckVoteCopy.recessLine(outcome: .cancelled, reason: .terminal),
            "a terminal close carries no line")
        XCTAssertNil(
            CheckVoteCopy.recessLine(outcome: .passed, reason: nil),
            "a pass reveals through the mark wash, not a recess line")
    }

    // MARK: - Role derivation (PROTOCOL.md §10, D32)

    func test_proposerSeesChipsNoVerbs_D32() {
        let model = CheckVoteBenchModel.make(vote: vote(), selfUserId: "u1", nameFor: { _ in "Ada" })!
        XCTAssertEqual(model.viewerRole, .proposer)
        XCTAssertFalse(model.showsVerbs(selfUserId: "u1"), "the proposer already approved: no verbs")
        XCTAssertEqual(model.proposalLine, "Ada wants to check the puzzle")
    }

    func test_unvotedElectorSeesVerbs_D32() {
        let model = CheckVoteBenchModel.make(vote: vote(), selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertEqual(model.viewerRole, .elector)
        XCTAssertTrue(model.showsVerbs(selfUserId: "u2"))
    }

    func test_votedElectorLosesVerbs_D32() {
        let v = vote(approvals: ["u1"], rejections: ["u2"])
        let model = CheckVoteBenchModel.make(vote: v, selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertFalse(model.showsVerbs(selfUserId: "u2"), "one immutable ballot: no more verbs")
    }

    func test_nonElectorReadsOnly_D32() {
        let model = CheckVoteBenchModel.make(vote: vote(), selfUserId: "u9", nameFor: { _ in nil })!
        XCTAssertEqual(model.viewerRole, .nonElector)
        XCTAssertFalse(model.showsVerbs(selfUserId: "u9"))
    }

    func test_proposerNameFallsBackToIdWhenRosterMisses_D32() {
        let model = CheckVoteBenchModel.make(vote: vote(by: "u1"), selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertEqual(model.proposalLine, "u1 wants to check the puzzle")
    }

    // MARK: - Chip states, electorate order, dimming (Wave 15.5 UX)

    func test_chipsFollowElectorateOrderWithBallots_D32() {
        let v = vote(electorate: ["u1", "u2", "u3"], approvals: ["u1"], rejections: ["u3"])
        let model = CheckVoteBenchModel.make(vote: v, selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertEqual(model.electors.map(\.userId), ["u1", "u2", "u3"])
        XCTAssertEqual(model.electors.map(\.ballot), [.approved, .unvoted, .rejected])
        XCTAssertFalse(model.electors[1].ballot.hasVoted, "an unvoted chip is dimmed")
        XCTAssertTrue(model.electors[0].ballot.hasVoted)
    }

    // MARK: - Solo suppression (PROTOCOL.md §10, D32)

    func test_soloVoteShowsNoBench_D32() {
        XCTAssertFalse(
            CheckVoteBenchModel.shouldPresent(vote: vote(electorate: ["u1"], needed: 1)),
            "a solo electorate auto-passes: no chrome for a frame")
    }

    func test_multiplayerVoteShowsBench_D32() {
        XCTAssertTrue(CheckVoteBenchModel.shouldPresent(vote: vote()))
    }

    func test_noVoteShowsNoBench_D32() {
        XCTAssertFalse(CheckVoteBenchModel.shouldPresent(vote: nil))
        XCTAssertNil(CheckVoteBenchModel.make(vote: nil, selfUserId: "u1", nameFor: { _ in nil }))
    }

    // MARK: - Proposer-only tally (Wave 15.5 UX)

    func test_tallyShownOnlyToProposerAfterFail_D32() {
        XCTAssertEqual(
            CheckVoteTally.line(for: .failed, viewerRole: .proposer, approvals: 1, needed: 2),
            "1 of 2")
        XCTAssertNil(
            CheckVoteTally.line(for: .failed, viewerRole: .elector, approvals: 1, needed: 2),
            "the room never sees a count")
        XCTAssertNil(
            CheckVoteTally.line(for: .passed, viewerRole: .proposer, approvals: 2, needed: 2),
            "a pass has no fail tally")
    }

    // MARK: - Close haptics (Wave 15.5)

    func test_closeHaptics_D32() {
        XCTAssertEqual(CheckVoteHaptics.forClose(outcome: .passed, reason: nil), .checkVotePassed)
        XCTAssertEqual(CheckVoteHaptics.forClose(outcome: .failed, reason: .rejected), .checkVoteFailed)
        XCTAssertEqual(CheckVoteHaptics.forClose(outcome: .failed, reason: .expired), .checkVoteFailed)
        XCTAssertEqual(
            CheckVoteHaptics.forClose(outcome: .cancelled, reason: .gridBroken), .checkVoteFailed)
        XCTAssertNil(
            CheckVoteHaptics.forClose(outcome: .cancelled, reason: .terminal),
            "the completion or abandon owns the terminal beat")
    }
}
