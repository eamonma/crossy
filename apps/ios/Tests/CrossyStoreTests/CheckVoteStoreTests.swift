// The check-vote store behaviors (PROTOCOL.md §4, §6, §10; D32), the Wave 15.5 twin of the
// room-check store tests above. The vote events are sequenced, so they ride the §7 seq gate
// exactly like cellSet and puzzleChecked; the open vote rides every snapshot, so a reconnect
// mid-vote reconstructs it wholesale; the remaining time clamps to the timebox; a solo
// electorate auto-passes with no lingering vote; and a bare puzzleChecked in the server
// rollout window applies marks with no vote state. The four non-fatal rejections are handled
// by the generic error path (they carry no overlay entry). Mirrors the web store's vote suite.

import CrossyProtocol
import CrossyStore
import Foundation
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class CheckVoteStoreTests: XCTestCase {

    // MARK: - Fixtures

    private func board(
        seq: Int = 0,
        status: GameStatus = .ongoing,
        cells: [Cell]? = nil,
        checkedWrongCells: [Int] = [],
        checkCount: Int = 0,
        checkVote: BoardCheckVote? = nil,
        recentCommandIds: [String] = []
    ) -> Board {
        Board(
            seq: seq, status: status, firstFillAt: nil, completedAt: nil, abandonedAt: nil,
            cells: cells ?? Array(repeating: Cell(v: nil, by: nil), count: 20),
            checkedWrongCells: checkedWrongCells, checkCount: checkCount, checkVote: checkVote,
            participants: [], cursors: [], recentCommandIds: recentCommandIds, stats: nil)
    }

    private func welcome(_ board: Board, userId: String = "me") -> ServerMessage {
        .welcome(
            WelcomeMessage(
                protocolVersion: 1,
                selfIdentity: WelcomeMessage.SelfIdentity(userId: userId, role: .solver),
                board: board))
    }

    private func makeLiveStore(_ welcomeBoard: Board? = nil, userId: String = "me") -> GameStore {
        let store = GameStore()
        store.receive(welcome(welcomeBoard ?? board(), userId: userId))
        return store
    }

    private func opened(
        seq: Int, by: String = "u1", electorate: [String] = ["u1", "u2", "u3"], needed: Int = 2,
        expiresAt: String = "2026-07-07T00:00:30Z", commandId: String = "c1"
    ) -> ServerMessage {
        .checkVoteOpened(
            CheckVoteOpenedMessage(
                seq: seq, by: by, electorate: electorate, needed: needed, expiresAt: expiresAt,
                commandId: commandId, at: "2026-07-07T00:00:00Z"))
    }

    private func cast(
        seq: Int, voteSeq: Int, by: String, approve: Bool, commandId: String = "c2"
    ) -> ServerMessage {
        .checkVoteCast(
            CheckVoteCastMessage(
                seq: seq, voteSeq: voteSeq, by: by, approve: approve, commandId: commandId,
                at: "2026-07-07T00:00:05Z"))
    }

    private func closed(
        seq: Int, voteSeq: Int, outcome: CheckVoteOutcome, reason: CheckVoteCloseReason? = nil
    ) -> ServerMessage {
        .checkVoteClosed(
            CheckVoteClosedMessage(
                seq: seq, voteSeq: voteSeq, outcome: outcome, reason: reason,
                at: "2026-07-07T00:00:06Z"))
    }

    private func puzzleChecked(
        seq: Int, wrongCells: [Int], checkCount: Int, by: String? = "u1", commandId: String = "c1"
    ) -> ServerMessage {
        .puzzleChecked(
            PuzzleCheckedMessage(
                seq: seq, wrongCells: wrongCells, checkCount: checkCount, by: by,
                commandId: commandId, at: "2026-07-07T00:00:06Z"))
    }

    private func date(_ text: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: text)!
    }

    // MARK: - Sequenced application (PROTOCOL.md §6, §7, §10)

    func test_checkVoteOpenedCreatesVoteUnderTheSeqGate_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, needed: 2))
        let vote = try! XCTUnwrap(store.checkVote)
        XCTAssertEqual(vote.openedSeq, 31)
        XCTAssertEqual(vote.by, "u1")
        XCTAssertEqual(vote.approvals, ["u1"], "approvals open as [proposer] (the proposal is their approval)")
        XCTAssertEqual(vote.rejections, [])
        XCTAssertEqual(vote.needed, 2)
        XCTAssertEqual(vote.electorate, ["u1", "u2", "u3"])
        XCTAssertEqual(store.seq, 31, "an opened vote consumes a seq exactly as cellSet")
    }

    func test_checkVoteCastFilesTheBallotAscending_PROTOCOL10_INV1() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, electorate: ["u1", "u2", "u3"], needed: 2))
        store.receive(cast(seq: 32, voteSeq: 31, by: "u3", approve: false))
        let vote = try! XCTUnwrap(store.checkVote)
        XCTAssertEqual(vote.rejections, ["u3"])
        XCTAssertEqual(vote.approvals, ["u1"])
        XCTAssertEqual(store.seq, 32)
    }

    func test_ballotsStayAscendingAcrossManyVoters_INV1() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, electorate: ["u1", "u2", "u3", "u4", "u5"], needed: 3))
        store.receive(cast(seq: 32, voteSeq: 31, by: "u4", approve: true))
        store.receive(cast(seq: 33, voteSeq: 31, by: "u2", approve: true))
        let vote = try! XCTUnwrap(store.checkVote)
        XCTAssertEqual(vote.approvals, ["u1", "u2", "u4"], "approvals sorted ascending, not insertion order")
    }

    func test_checkVoteClosedClearsTheOpenVote_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31))
        store.receive(closed(seq: 32, voteSeq: 31, outcome: .failed, reason: .rejected))
        XCTAssertNil(store.checkVote, "a close clears the vote whatever the outcome")
        XCTAssertEqual(store.seq, 32)
    }

    func test_passingCloseThenPuzzleCheckedLeavesNoVoteAndAppliesMarks_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, electorate: ["u1", "u2", "u3"], needed: 2))
        store.receive(cast(seq: 32, voteSeq: 31, by: "u2", approve: true))
        store.receive(closed(seq: 33, voteSeq: 31, outcome: .passed))
        store.receive(puzzleChecked(seq: 34, wrongCells: [0, 2], checkCount: 1, by: "u1"))
        XCTAssertNil(store.checkVote)
        XCTAssertEqual(store.checkedWrong, [0, 2])
        XCTAssertEqual(store.checkCount, 1)
        XCTAssertEqual(store.seq, 34)
    }

    func test_aGappedVoteEventSendsRequestSyncAndDoesNotApply_PROTOCOL7() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 33, needed: 2))  // gap: expected 31
        XCTAssertNil(store.checkVote, "a gapped event is not applied")
        XCTAssertEqual(store.sync, .resyncing)
        XCTAssertEqual(store.seq, 30)
    }

    func test_aStaleVoteEventIsDiscarded_PROTOCOL7() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31))
        store.receive(cast(seq: 29, voteSeq: 31, by: "u2", approve: true))  // stale
        let vote = try! XCTUnwrap(store.checkVote)
        XCTAssertEqual(vote.approvals, ["u1"], "a stale ballot changes nothing")
        XCTAssertEqual(store.seq, 31)
    }

    // MARK: - Snapshot reconstruction (PROTOCOL.md §4, §7)

    private func boardVote(
        openedSeq: Int = 31, by: String = "u1", electorate: [String] = ["u1", "u2", "u3"],
        approvals: [String] = ["u1"], rejections: [String] = [], needed: Int = 2,
        expiresAt: String = "2026-07-07T00:00:30Z"
    ) -> BoardCheckVote {
        BoardCheckVote(
            openedSeq: openedSeq, by: by, electorate: electorate, approvals: approvals,
            rejections: rejections, needed: needed, expiresAt: expiresAt)
    }

    func test_reconnectMidVoteReconstructsTheWholeVote_PROTOCOL4() {
        let store = makeLiveStore()  // no vote
        store.receive(
            .sync(
                SyncMessage(
                    board: board(
                        seq: 40,
                        checkVote: boardVote(
                            openedSeq: 31, approvals: ["u1", "u2"], rejections: ["u3"], needed: 3,
                            expiresAt: "2026-07-07T00:00:30Z")))))
        let vote = try! XCTUnwrap(store.checkVote, "a snapshot mid-vote heals the whole vote")
        XCTAssertEqual(vote.openedSeq, 31)
        XCTAssertEqual(vote.approvals, ["u1", "u2"])
        XCTAssertEqual(vote.rejections, ["u3"])
        XCTAssertEqual(vote.needed, 3)
        XCTAssertEqual(vote.expiresAt, "2026-07-07T00:00:30Z", "expiresAt rides the snapshot")
    }

    func test_snapshotWithNoVoteClearsAStaleLocalVoteWholesale_PROTOCOL4() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31))
        XCTAssertNotNil(store.checkVote)
        store.receive(.sync(SyncMessage(board: board(seq: 40, checkVote: nil))))
        XCTAssertNil(store.checkVote, "the snapshot replaces sequenced state wholesale, vote included")
    }

    // MARK: - Remaining time clamp (PROTOCOL.md §10; a store fact — no client clock renders)

    func test_remainingTimeClampsToTheTimebox_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, expiresAt: "2026-07-07T00:00:30Z"))
        XCTAssertEqual(store.checkVoteRemaining(asOf: date("2026-07-07T00:00:00Z")), 30)
        XCTAssertEqual(store.checkVoteRemaining(asOf: date("2026-07-07T00:00:20Z")), 10)
        XCTAssertEqual(
            store.checkVoteRemaining(asOf: date("2026-07-07T00:00:45Z")), 0,
            "an already-lapsed vote reads as 0, never negative")
    }

    func test_remainingTimeClampsAboveToThirtySeconds_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31, expiresAt: "2026-07-07T00:02:00Z"))  // 120 s ahead
        XCTAssertEqual(
            store.checkVoteRemaining(asOf: date("2026-07-07T00:00:00Z")), 30,
            "a skewed far-future expiry never shows an over-long ring")
    }

    func test_remainingTimeIsNilWithNoOpenVote_PROTOCOL10() {
        let store = makeLiveStore()
        XCTAssertNil(store.checkVoteRemaining(asOf: date("2026-07-07T00:00:00Z")))
    }

    // MARK: - Solo suppression (PROTOCOL.md §10, D32; Wave 15.5 UX)

    func test_soloElectorateAutoPassesLeavingNoVoteChrome_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 9), userId: "u1")
        // The auto-pass triple, same command processing.
        store.receive(opened(seq: 10, by: "u1", electorate: ["u1"], needed: 1, commandId: "c1"))
        XCTAssertEqual(store.checkVote?.isSolo, true, "a solo electorate is flagged so the UI shows no chrome")
        store.receive(closed(seq: 11, voteSeq: 10, outcome: .passed))
        store.receive(puzzleChecked(seq: 12, wrongCells: [0, 2], checkCount: 1, by: "u1"))
        XCTAssertNil(store.checkVote, "after the auto-pass no vote lingers")
        XCTAssertEqual(store.checkedWrong, [0, 2])
        XCTAssertEqual(store.checkCount, 1)
    }

    // MARK: - Bare puzzleChecked tolerance (PROTOCOL.md rollout window)

    func test_barePuzzleCheckedWithNoOpenVoteAppliesMarks_PROTOCOL10() {
        let store = makeLiveStore(board(seq: 3))
        store.receive(puzzleChecked(seq: 4, wrongCells: [1, 4], checkCount: 1, by: nil))
        XCTAssertNil(store.checkVote, "no vote UI for a bare check")
        XCTAssertEqual(store.checkedWrong, [1, 4])
        XCTAssertEqual(store.checkCount, 1)
    }

    // MARK: - The castCheckVote intent (PROTOCOL.md §5, §10)

    func test_castCheckVoteEmitsTheBallotFrame_PROTOCOL5() {
        let store = makeLiveStore(board(seq: 30))
        store.receive(opened(seq: 31))
        store.castCheckVote(voteSeq: 31, approve: true, commandId: "ballot-1")
        XCTAssertEqual(
            store.outbox.last,
            .castCheckVote(CastCheckVoteMessage(commandId: "ballot-1", voteSeq: 31, approve: true)))
        XCTAssertTrue(store.overlay.isEmpty, "a ballot is not a cell write: no overlay entry")
    }

    func test_castCheckVoteRefusedBeforeWelcomeAndAfterTerminal_INV4() {
        let cold = GameStore()
        cold.castCheckVote(voteSeq: 1, approve: true)
        XCTAssertTrue(cold.outbox.isEmpty, "no ballot before authoritative state")

        let done = makeLiveStore(board(status: .completed))
        done.castCheckVote(voteSeq: 1, approve: true)
        XCTAssertTrue(done.outbox.isEmpty, "no ballot after a terminal status")
    }

    // MARK: - The four non-fatal rejections are handled quietly (PROTOCOL.md §11)

    func test_nonFatalVoteRejectionsRecordAndDoNotDisrupt_PROTOCOL11() {
        for code in [ErrorCode.noVoteOpen, .notElector, .alreadyVoted, .votePending] {
            let store = makeLiveStore(board(seq: 30))
            store.receive(opened(seq: 31))
            let before = store.checkVote
            store.receive(
                .error(ErrorMessage(code: code, message: "no", fatal: false, commandId: "ballot-x")))
            XCTAssertEqual(store.lastRejection?.code, code, "the rejection is surfaced quietly")
            XCTAssertEqual(store.sync, .live, "\(code.rawValue) is non-fatal: the connection stays live")
            XCTAssertEqual(store.checkVote, before, "a non-fatal vote rejection does not disturb the open vote")
        }
    }

    // MARK: - Beat callbacks fire only under the seq gate (PROTOCOL.md §7)

    func test_voteBeatsFireOnLiveTransitionButNotOnSnapshotHealing_PROTOCOL7() {
        let store = makeLiveStore(board(seq: 30))
        var openedBeats = 0
        store.onCheckVoteOpened = { _ in openedBeats += 1 }
        store.receive(opened(seq: 31))
        XCTAssertEqual(openedBeats, 1, "a live opened fires the beat")

        // A reconnect welcome carrying an open vote is history healing, not a live beat.
        store.receive(
            .sync(SyncMessage(board: board(seq: 40, checkVote: boardVote(openedSeq: 41)))))
        XCTAssertEqual(openedBeats, 1, "snapshot healing stays silent")
        XCTAssertEqual(store.checkVote?.openedSeq, 41, "but the state still heals")
    }
}
