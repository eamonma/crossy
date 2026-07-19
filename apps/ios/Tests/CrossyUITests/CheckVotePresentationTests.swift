// The check vote's presentation core (PROTOCOL.md §10, D32; Wave 15.10 card rulings). The copy
// is normative, so every string is pinned here verbatim; the role derivation, chip states,
// solo suppression, the close act (resolution line + proposer tally as ONE value), the card's
// dismissal policy, the landing haptic, and the VoiceOver announcements are asserted without
// a view.

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

    // MARK: - Copy, verbatim (design/check-vote/UX.md U1)

    func test_copyIsVerbatim_D32() {
        XCTAssertEqual(CheckVoteCopy.proposal(name: "Ada"), "Ada wants to check the puzzle")
        XCTAssertEqual(CheckVoteCopy.waiting, "Waiting for the room")
        XCTAssertEqual(CheckVoteCopy.fallbackProposer, "A teammate")
        XCTAssertEqual(CheckVoteCopy.fallbackElector, "Player")
        XCTAssertEqual(CheckVoteCopy.approve, "Check it")
        XCTAssertEqual(CheckVoteCopy.reject, "Keep solving")
        XCTAssertEqual(CheckVoteCopy.checking, "Checking\u{2026}")
        XCTAssertEqual(CheckVoteCopy.toFix(3), "3 to fix")
        XCTAssertEqual(CheckVoteCopy.rejected, "The room keeps solving")
        XCTAssertEqual(CheckVoteCopy.lapsed, "The vote lapsed")
        XCTAssertEqual(CheckVoteCopy.gridChanged, "Vote ended, the grid changed")
        XCTAssertEqual(CheckVoteCopy.tally(approvals: 1, needed: 2), "1 of 2")
    }

    // "Checking…" is the single ellipsis character on every platform, never three periods.
    func test_checkingUsesTheSingleEllipsisCharacter_U1() {
        XCTAssertTrue(CheckVoteCopy.checking.hasSuffix("\u{2026}"))
        XCTAssertFalse(CheckVoteCopy.checking.contains("..."))
    }

    func test_recessLinePerCloseReason_D32() {
        XCTAssertEqual(
            CheckVoteCopy.recessLine(outcome: .failed, reason: .rejected),
            "The room keeps solving")
        XCTAssertEqual(
            CheckVoteCopy.recessLine(outcome: .failed, reason: .expired), "The vote lapsed")
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

    func test_proposerSeesNoVerbs_D32() {
        let model = CheckVoteCardModel.make(vote: vote(), selfUserId: "u1", nameFor: { _ in "Ada" })!
        XCTAssertEqual(model.viewerRole, .proposer)
        XCTAssertFalse(model.showsVerbs(selfUserId: "u1"), "the proposer already approved: no verbs")
    }

    // The proposer never reads their own name back (owner ruling 2026-07-18): their line is
    // the wait itself.
    func test_proposerLineIsWaitingForTheRoom_U1() {
        let proposer = CheckVoteCardModel.make(vote: vote(), selfUserId: "u1", nameFor: { _ in "Ada" })!
        XCTAssertEqual(proposer.proposalLine, "Waiting for the room")
        let elector = CheckVoteCardModel.make(vote: vote(), selfUserId: "u2", nameFor: { _ in "Ada" })!
        XCTAssertEqual(elector.proposalLine, "Ada wants to check the puzzle")
    }

    func test_unvotedElectorSeesVerbs_D32() {
        let model = CheckVoteCardModel.make(vote: vote(), selfUserId: "u2", nameFor: { _ in "Ada" })!
        XCTAssertEqual(model.viewerRole, .elector)
        XCTAssertTrue(model.showsVerbs(selfUserId: "u2"))
    }

    func test_votedElectorLosesVerbs_D32() {
        let v = vote(approvals: ["u1"], rejections: ["u2"])
        let model = CheckVoteCardModel.make(vote: v, selfUserId: "u2", nameFor: { _ in "Ada" })!
        XCTAssertFalse(model.showsVerbs(selfUserId: "u2"), "one immutable ballot: no more verbs")
    }

    func test_nonElectorReadsOnly_D32() {
        let model = CheckVoteCardModel.make(vote: vote(), selfUserId: "u9", nameFor: { _ in "Ada" })!
        XCTAssertEqual(model.viewerRole, .nonElector)
        XCTAssertFalse(model.showsVerbs(selfUserId: "u9"))
    }

    // A departed or unknown proposer reads as a neutral teammate, never the raw userId
    // (owner ruling 2026-07-18: a raw user id never renders).
    func test_departedProposerReadsAsATeammate_U1() {
        let model = CheckVoteCardModel.make(vote: vote(by: "u1"), selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertEqual(model.proposalLine, "A teammate wants to check the puzzle")
    }

    // MARK: - Chip states, electorate order, dimming (U5: faces, not numbers)

    func test_chipsFollowElectorateOrderWithBallots_D32() {
        let v = vote(electorate: ["u1", "u2", "u3"], approvals: ["u1"], rejections: ["u3"])
        let model = CheckVoteCardModel.make(vote: v, selfUserId: "u2", nameFor: { _ in nil })!
        XCTAssertEqual(model.electors.map(\.userId), ["u1", "u2", "u3"])
        XCTAssertEqual(model.electors.map(\.ballot), [.approved, .unvoted, .rejected])
        XCTAssertFalse(model.electors[1].ballot.hasVoted, "an unvoted chip is dimmed")
        XCTAssertTrue(model.electors[0].ballot.hasVoted)
    }

    // MARK: - Solo suppression (PROTOCOL.md §10, D32)

    func test_soloVoteShowsNoCard_D32() {
        XCTAssertFalse(
            CheckVoteCardModel.shouldPresent(vote: vote(electorate: ["u1"], needed: 1)),
            "a solo electorate auto-passes: no chrome for a frame")
    }

    func test_multiplayerVoteShowsCard_D32() {
        XCTAssertTrue(CheckVoteCardModel.shouldPresent(vote: vote()))
    }

    func test_noVoteShowsNoCard_D32() {
        XCTAssertFalse(CheckVoteCardModel.shouldPresent(vote: nil))
        XCTAssertNil(CheckVoteCardModel.make(vote: nil, selfUserId: "u1", nameFor: { _ in nil }))
    }

    // MARK: - The close act (Wave 15.10): the line and the tally are ONE value

    // A failed close carries the calm line AND the proposer's tally together. Main's if/else
    // rendered the line OR the tally, shadowing the tally into dead code; the act is one
    // value the view renders whole, so the bug cannot re-enter.
    func test_failedCloseCarriesLineAndProposerTallyTogether_U5() {
        let act = CheckVoteCloseAct.forClose(
            outcome: .failed, reason: .rejected, viewerRole: .proposer, approvals: 1, needed: 2)
        XCTAssertEqual(
            act,
            .resolution(CheckVoteResolution(line: "The room keeps solving", tally: "1 of 2")))
    }

    func test_electorAndReaderSeeNoTally_U5() {
        for role in [CheckVoteViewerRole.elector, .nonElector] {
            let act = CheckVoteCloseAct.forClose(
                outcome: .failed, reason: .rejected, viewerRole: role, approvals: 1, needed: 2)
            XCTAssertEqual(
                act,
                .resolution(CheckVoteResolution(line: "The room keeps solving", tally: nil)),
                "no tallies render for the room")
        }
    }

    func test_lapsedCloseCarriesProposerTallyToo_U5() {
        let act = CheckVoteCloseAct.forClose(
            outcome: .failed, reason: .expired, viewerRole: .proposer, approvals: 1, needed: 2)
        XCTAssertEqual(
            act, .resolution(CheckVoteResolution(line: "The vote lapsed", tally: "1 of 2")))
    }

    func test_gridBrokenCloseCarriesNoTally_U1() {
        let act = CheckVoteCloseAct.forClose(
            outcome: .cancelled, reason: .gridBroken, viewerRole: .proposer, approvals: 1,
            needed: 2)
        XCTAssertEqual(
            act,
            .resolution(CheckVoteResolution(line: "Vote ended, the grid changed", tally: nil)),
            "the tally belongs to a failed close alone")
    }

    func test_passedCloseResolvesToChecking_U6() {
        let act = CheckVoteCloseAct.forClose(
            outcome: .passed, reason: nil, viewerRole: .elector, approvals: 2, needed: 2)
        XCTAssertEqual(act, .checking, "the card resolves to Checking… and yields to the wash")
    }

    func test_terminalCloseIsSilent_U1() {
        let act = CheckVoteCloseAct.forClose(
            outcome: .cancelled, reason: .terminal, viewerRole: .proposer, approvals: 1,
            needed: 2)
        XCTAssertEqual(act, CheckVoteAct.none, "completion or abandon supersedes; silence")
    }

    // MARK: - The card's dismissal policy (Wave 15.10 design decision)

    // The wire has no vote-cancel, so a blocking card with no verb could hold its viewer the
    // whole 30 s timebox. The elector's ballot is the exit and their card never dismisses;
    // everyone without a castable ballot (proposer, non-elector, an elector who already
    // voted — a rejoin can land there) can put the card away.
    func test_electorWithOpenBallotCannotDismiss_U2() {
        XCTAssertFalse(CheckVoteCardPolicy.isDismissible(role: .elector, hasOpenBallot: true))
    }

    func test_everyoneWithoutABallotCanDismiss_U2() {
        XCTAssertTrue(CheckVoteCardPolicy.isDismissible(role: .proposer, hasOpenBallot: false))
        XCTAssertTrue(CheckVoteCardPolicy.isDismissible(role: .nonElector, hasOpenBallot: false))
        XCTAssertTrue(
            CheckVoteCardPolicy.isDismissible(role: .elector, hasOpenBallot: false),
            "a rejoin can land an elector who already voted; they are never held")
    }

    // MARK: - Close haptics (U9)

    func test_closeHaptics_D32() {
        XCTAssertEqual(CheckVoteHaptics.forClose(outcome: .passed, reason: nil), .checkVotePassed)
        XCTAssertEqual(
            CheckVoteHaptics.forClose(outcome: .failed, reason: .rejected), .checkVoteFailed)
        XCTAssertEqual(
            CheckVoteHaptics.forClose(outcome: .failed, reason: .expired), .checkVoteFailed)
        XCTAssertEqual(
            CheckVoteHaptics.forClose(outcome: .cancelled, reason: .gridBroken), .checkVoteFailed)
        XCTAssertNil(
            CheckVoteHaptics.forClose(outcome: .cancelled, reason: .terminal),
            "the completion or abandon owns the terminal beat")
    }

    // The landing haptic (Wave 15.10 fix): the success fanfare belongs ONLY to a pass with a
    // real vote standing. Main played .checkVotePassed for every attributed check, a solo
    // check included; a solo check marking your own errors keeps the soft checkLanded thud,
    // as does a bare rollout check.
    func test_soloCheckKeepsTheQuietThud_D32() {
        XCTAssertEqual(
            CheckVoteHaptics.forPuzzleChecked(attributed: true, voteStood: false),
            .checkLanded, "a solo pass is your own act, not a room ceremony")
        XCTAssertEqual(
            CheckVoteHaptics.forPuzzleChecked(attributed: false, voteStood: false),
            .checkLanded)
        XCTAssertEqual(
            CheckVoteHaptics.forPuzzleChecked(attributed: true, voteStood: true),
            .checkVotePassed)
    }

    // MARK: - VoiceOver announcements (U10; main posted none)

    func test_openAnnouncementPerRole_U10() {
        let elector = CheckVoteCardModel.make(vote: vote(), selfUserId: "u2", nameFor: { _ in "Ada" })!
        XCTAssertEqual(
            CheckVoteAnnouncement.opened(model: elector),
            "Ada wants to check the puzzle. Actions available.")
        let proposer = CheckVoteCardModel.make(vote: vote(), selfUserId: "u1", nameFor: { _ in "Ada" })!
        XCTAssertEqual(
            CheckVoteAnnouncement.opened(model: proposer),
            "Check proposed. Waiting for the room.")
        let reader = CheckVoteCardModel.make(vote: vote(), selfUserId: "u9", nameFor: { _ in "Ada" })!
        XCTAssertEqual(
            CheckVoteAnnouncement.opened(model: reader),
            "Ada wants to check the puzzle.", "a non-elector hears no actions offer")
    }

    func test_closeAnnouncementJoinsLineAndTally_U10() {
        XCTAssertEqual(
            CheckVoteAnnouncement.closed(
                CheckVoteResolution(line: "The room keeps solving", tally: "1 of 2")),
            "The room keeps solving. 1 of 2.")
        XCTAssertEqual(
            CheckVoteAnnouncement.closed(
                CheckVoteResolution(line: "The vote lapsed", tally: nil)),
            "The vote lapsed.")
    }

    func test_toFixAnnouncement_U10() {
        XCTAssertEqual(CheckVoteAnnouncement.toFix(3), "3 to fix.")
    }
}
