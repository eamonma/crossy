import Foundation
import XCTest

import CrossyProtocol

// The one opaque avatar field (PROTOCOL.md §4), decoded on every participant-carrying
// payload: the welcome/sync participant, the playerConnected notice (§6), and the
// GET /games/{id} member row (§12). The contract these tests defend:
//   present    a string decodes verbatim (opaque, never parsed)
//   null       reads as nil (first-class: the initial renders)
//   absent     reads as nil too (absent-tolerant, so a pre-avatar server still decodes)
//   non-string a present non-string is malformed (DecodingError), never silently nil
// The absent case is the load-bearing one: today's servers send no key, and the client
// must still decode them (the field lands server-side on origin/backend/avatars). The
// twin of packages/protocol's avatar codec tests; both pin the same four cases.

final class AvatarUrlDecodeTests: XCTestCase {
    private func participant(_ avatarJSON: String) -> Data {
        Data(
            """
            {"userId":"u1","displayName":"Ana"\(avatarJSON),"color":"#7F77DD","role":"host","connected":true}
            """.utf8)
    }

    private func playerConnected(_ avatarJSON: String) -> Data {
        Data(
            """
            {"type":"playerConnected","userId":"u2","displayName":"Bo"\(avatarJSON),"color":"#33AA88","role":"solver"}
            """.utf8)
    }

    private func member(_ avatarJSON: String) -> Data {
        Data(
            """
            {"userId":"u1","role":"host","joinedAt":"2026-07-08T12:00:00.000Z"\(avatarJSON)}
            """.utf8)
    }

    // MARK: - Present (§4: an opaque string decodes verbatim)

    func test_participantAvatarUrlPresentDecodesOpaqueString_PROTOCOL4() throws {
        let value = try JSONDecoder().decode(
            Participant.self, from: participant(#","avatarUrl":"https://cdn.example/a.png""#))
        XCTAssertEqual(value.avatarUrl, "https://cdn.example/a.png")
    }

    func test_playerConnectedAvatarUrlPresentDecodesOpaqueString_PROTOCOL6() throws {
        let value = try JSONDecoder().decode(
            PlayerConnectedMessage.self,
            from: playerConnected(#","avatarUrl":"https://cdn.example/b.png""#))
        XCTAssertEqual(value.avatarUrl, "https://cdn.example/b.png")
    }

    func test_memberAvatarUrlPresentDecodesOpaqueString_PROTOCOL12() throws {
        let value = try JSONDecoder().decode(
            GameView.Member.self, from: member(#","avatarUrl":"https://cdn.example/c.png""#))
        XCTAssertEqual(value.avatarUrl, "https://cdn.example/c.png")
    }

    // MARK: - Null (§4: null is first-class, reads as nil)

    func test_participantAvatarUrlNullReadsAsNil_PROTOCOL4() throws {
        let value = try JSONDecoder().decode(
            Participant.self, from: participant(#","avatarUrl":null"#))
        XCTAssertNil(value.avatarUrl)
    }

    func test_playerConnectedAvatarUrlNullReadsAsNil_PROTOCOL6() throws {
        let value = try JSONDecoder().decode(
            PlayerConnectedMessage.self, from: playerConnected(#","avatarUrl":null"#))
        XCTAssertNil(value.avatarUrl)
    }

    func test_memberAvatarUrlNullReadsAsNil_PROTOCOL12() throws {
        let value = try JSONDecoder().decode(GameView.Member.self, from: member(#","avatarUrl":null"#))
        XCTAssertNil(value.avatarUrl)
    }

    // MARK: - Absent (§4: absent-tolerant, so a pre-avatar server still decodes)

    func test_participantAvatarUrlAbsentReadsAsNil_PROTOCOL4() throws {
        let value = try JSONDecoder().decode(Participant.self, from: participant(""))
        XCTAssertNil(value.avatarUrl, "a pre-avatar participant must still decode")
    }

    func test_playerConnectedAvatarUrlAbsentReadsAsNil_PROTOCOL6() throws {
        let value = try JSONDecoder().decode(PlayerConnectedMessage.self, from: playerConnected(""))
        XCTAssertNil(value.avatarUrl, "a pre-avatar playerConnected must still decode")
    }

    func test_memberAvatarUrlAbsentReadsAsNil_PROTOCOL12() throws {
        let value = try JSONDecoder().decode(GameView.Member.self, from: member(""))
        XCTAssertNil(value.avatarUrl, "a pre-avatar member row must still decode")
    }

    // MARK: - Non-string (§4: a present non-string is malformed, never silent nil)

    func test_participantAvatarUrlNonStringIsMalformed_PROTOCOL4() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(Participant.self, from: participant(#","avatarUrl":42"#))
        ) { error in
            XCTAssertTrue(error is DecodingError, "a numeric avatarUrl is malformed, not nil")
        }
    }

    func test_playerConnectedAvatarUrlNonStringIsMalformed_PROTOCOL6() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(
                PlayerConnectedMessage.self, from: playerConnected(#","avatarUrl":true"#))
        ) { error in
            XCTAssertTrue(error is DecodingError, "a boolean avatarUrl is malformed, not nil")
        }
    }

    func test_memberAvatarUrlNonStringIsMalformed_PROTOCOL12() throws {
        XCTAssertThrowsError(
            try JSONDecoder().decode(GameView.Member.self, from: member(#","avatarUrl":["x"]"#))
        ) { error in
            XCTAssertTrue(error is DecodingError, "an array avatarUrl is malformed, not nil")
        }
    }

    // MARK: - Absent stays off the wire on re-encode (the omit-when-nil posture)

    func test_participantWithoutAvatarUrlStaysAbsentOnReencode_PROTOCOL4() throws {
        let value = try JSONDecoder().decode(Participant.self, from: participant(""))
        let reencoded = try JSONEncoder().encode(value)
        let keys = try XCTUnwrap(try jsonObject(reencoded) as? NSDictionary).allKeys
        XCTAssertFalse(
            keys.contains { $0 as? String == "avatarUrl" },
            "an absent avatarUrl must stay off the wire, never become null (§3, §4)")
    }

    func test_playerConnectedWithoutAvatarUrlStaysAbsentOnReencode_PROTOCOL6() throws {
        let value = try JSONDecoder().decode(PlayerConnectedMessage.self, from: playerConnected(""))
        let reencoded = try JSONEncoder().encode(value)
        let keys = try XCTUnwrap(try jsonObject(reencoded) as? NSDictionary).allKeys
        XCTAssertFalse(
            keys.contains { $0 as? String == "avatarUrl" },
            "an absent avatarUrl must stay off the wire, never become null (§3, §6)")
    }

    // MARK: - A present avatar survives the round trip (opaque, not reshaped)

    func test_participantAvatarUrlSurvivesRoundTrip_PROTOCOL4() throws {
        let value = try JSONDecoder().decode(
            Participant.self, from: participant(#","avatarUrl":"https://cdn.example/a.png""#))
        let reencoded = try JSONEncoder().encode(value)
        let round = try JSONDecoder().decode(Participant.self, from: reencoded)
        XCTAssertEqual(round.avatarUrl, "https://cdn.example/a.png")
    }
}
