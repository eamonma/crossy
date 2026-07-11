// The REST arrival proof (roadmap I3): against the real local stack the I1e harness
// boots (apps/ios/scripts/integration.ts, ports 8890-8892), a cold identity lists an
// empty Rooms page, joins by invite code, and sees the game listed with the shape
// the cards render. Same integration tag as StackIntegrationTests: absent the
// CROSSY_IT_* facts every test skips, so a plain `swift test` (and CI, no Docker)
// stays green with no services.

import CrossyAPI
import CrossyProtocol
import Foundation
import XCTest

/// The facts this suite needs. Token C is minted by the harness and never joined
/// there, so the cold arrival path is walked here, start to finish.
private struct RESTFacts {
    let apiURL: URL
    let gameId: String
    let inviteCode: String
    let tokenA: String
    let tokenC: String

    static func fromEnvironment() -> RESTFacts? {
        let env = ProcessInfo.processInfo.environment
        guard
            let apiRaw = env["CROSSY_IT_API_URL"], let apiURL = URL(string: apiRaw),
            let gameId = env["CROSSY_IT_GAME_ID"], !gameId.isEmpty,
            let inviteCode = env["CROSSY_IT_INVITE_CODE"], !inviteCode.isEmpty,
            let tokenA = env["CROSSY_IT_TOKEN_A"], !tokenA.isEmpty,
            let tokenC = env["CROSSY_IT_TOKEN_C"], !tokenC.isEmpty
        else { return nil }
        return RESTFacts(
            apiURL: apiURL, gameId: gameId, inviteCode: inviteCode,
            tokenA: tokenA, tokenC: tokenC)
    }
}

private struct EnvToken: BearerTokenProviding {
    let token: String
    func currentToken() async throws -> String { token }
}

final class StackRESTIntegrationTests: XCTestCase {
    private func facts() throws -> RESTFacts {
        guard let facts = RESTFacts.fromEnvironment() else {
            throw XCTSkip(
                "CROSSY_IT_* connection facts absent; run `corepack pnpm test:ios-integration` "
                    + "(apps/ios/scripts/integration.ts boots the stack and re-runs this suite)")
        }
        return facts
    }

    private func client(_ facts: RESTFacts, token: String) -> CrossyAPIClient {
        CrossyAPIClient(baseURL: facts.apiURL, tokenProvider: EnvToken(token: token))
    }

    // The arrival journey's REST half (EXPERIENCE.md §2 moments 3 and 6): a cold
    // identity's home is empty, the read-aloud code seats it as a solver
    // (PROTOCOL.md §12 /games/join, owner decision 2026-07-10), and the game then
    // lists with the card fields. Lowercase entry resolves too (INV-1: the lookup
    // uppercases ASCII-only server-side).
    func test_aColdIdentityJoinsByCodeAndSeesTheRoomListed_PROTOCOL12() async throws {
        let facts = try facts()
        let c = client(facts, token: facts.tokenC)

        let before = try await c.listGames()
        XCTAssertTrue(before.rows.isEmpty, "a cold identity belongs to no rooms yet")
        XCTAssertNil(before.nextBefore, "an empty page ends iteration")

        // Join with the code lowercased: the server owns normalization (INV-1,
        // ASCII-only uppercase), the client sends what was typed.
        let lowercased = facts.inviteCode.lowercased()
        let membership = try await c.joinGame(code: lowercased)
        XCTAssertEqual(membership.gameId, facts.gameId, "the code resolved the game")
        XCTAssertEqual(membership.role, .solver, "a full account seats as a solver at once")

        let after = try await c.listGames()
        XCTAssertEqual(after.rows.count, 1)
        let row = try XCTUnwrap(after.rows.first)
        XCTAssertEqual(row.gameId, facts.gameId)
        XCTAssertEqual(row.role, .solver)
        XCTAssertGreaterThanOrEqual(row.memberCount, 3, "A, B, and now C")
        XCTAssertEqual(row.puzzle.rows, 5, "the card's geometry fingerprint facts")
        XCTAssertEqual(row.puzzle.cols, 5)

        // The §12 cursor contract end to end: a limit-1 page hands back the last
        // row's createdAt, and the page strictly before it is empty (one game).
        let page = try await c.listGames(limit: 1)
        XCTAssertEqual(page.rows.count, 1)
        XCTAssertEqual(page.nextBefore, page.rows.last?.createdAt)
        let next = try await c.listGames(limit: 1, before: page.nextBefore)
        XCTAssertTrue(next.rows.isEmpty, "iteration ends on the empty page")

        // Idempotent, non-demoting re-join (§12): the same code again is fine.
        let again = try await c.joinGame(code: facts.inviteCode)
        XCTAssertEqual(again.role, .solver)
        XCTAssertEqual(again.userId, membership.userId)
    }

    // The join screen's failure vocabulary against the real API: a well-formed code
    // matching no game is GAME_NOT_FOUND (the copy layer's lexicon sentence keys on
    // exactly this string, EXPERIENCE.md §5).
    func test_aWrongCodeIsGameNotFoundByStableCode_PROTOCOL12() async throws {
        let facts = try facts()
        let a = client(facts, token: facts.tokenA)

        // Valid format (eight alphabet characters), astronomically unlikely to
        // exist; the harness seeds exactly one game per run.
        let code = facts.inviteCode == "22222222" ? "33333333" : "22222222"
        do {
            _ = try await a.joinGame(code: code)
            XCTFail("a code matching no game must refuse")
        } catch let error as CrossyAPIError {
            XCTAssertEqual(error.apiCode, .gameNotFound)
            XCTAssertEqual(error.apiCodeString, "GAME_NOT_FOUND")
        }
    }
}
