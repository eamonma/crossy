import Foundation
import XCTest

import CrossyProtocol

// The reaction set on the /me pair (PROTOCOL.md §12; D25): `GET /me` carries
// `reactionSet` as five graphemes or an explicit null (the defaults), `PATCH /me`
// takes the same field where null is the RESET command (so the request encodes the
// key always, never omits it), and the three named 422s ride the §12 error envelope.
// Inline frames, the ReactionShapeTests idiom: no fixture, the wire shapes are small.

final class ReactionSetRESTTests: XCTestCase {
    // MARK: - GET /me: reactionSet (§12)

    func test_meDecodesANullReactionSetAsNil_theDefaults_PROTOCOL12() throws {
        let body = Data(
            #"""
            {"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,
             "needsName":false,"reactionSet":null}
            """#.utf8)
        let me = try JSONDecoder().decode(MeResponse.self, from: body)
        XCTAssertNil(me.reactionSet, "null means the default five (§9)")
    }

    func test_meDecodesAChosenReactionSetInSlotOrder_PROTOCOL12() throws {
        let body = Data(
            #"""
            {"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,
             "needsName":false,"reactionSet":["🦆","👍🏽","❤️‍🔥","🇨🇦","🫶"]}
            """#.utf8)
        let me = try JSONDecoder().decode(MeResponse.self, from: body)
        XCTAssertEqual(me.reactionSet, ["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"])
    }

    func test_meToleratesAnAbsentReactionSetKey_additive_PROTOCOL14() throws {
        // An older server that predates the field: absent reads as nil, the same
        // defaults a null means, so the client renders correctly against both.
        let body = Data(
            #"""
            {"userId":"u1","displayName":"Ada","isAnonymous":false,"avatarUrl":null,
             "needsName":false}
            """#.utf8)
        let me = try JSONDecoder().decode(MeResponse.self, from: body)
        XCTAssertNil(me.reactionSet)
    }

    // MARK: - PATCH /me: the request writes the key always (§12)

    func test_updateRequestEncodesTheFiveInSlotOrder_PROTOCOL12() throws {
        let body = try JSONEncoder().encode(
            UpdateReactionSetRequest(reactionSet: ["🔥", "🤔", "🐐", "💀", "😭"]))
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(object["reactionSet"] as? [String], ["🔥", "🤔", "🐐", "💀", "😭"])
    }

    func test_updateRequestEncodesNilAsExplicitNull_theReset_PROTOCOL12() throws {
        // null is the reset command, never an omission: an omitted key would read as
        // "nothing to update" (400 VALIDATION on an otherwise empty patch).
        let body = try JSONEncoder().encode(UpdateReactionSetRequest(reactionSet: nil))
        let object = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertTrue(object.keys.contains("reactionSet"), "the key is always written")
        XCTAssertTrue(object["reactionSet"] is NSNull, "explicit null, the reset")
    }

    func test_updateRequestRoundTripsBothShapes_PROTOCOL12() throws {
        for request in [
            UpdateReactionSetRequest(reactionSet: nil),
            UpdateReactionSetRequest(reactionSet: ["🔥", "🤔", "🐐", "💀", "😭"]),
        ] {
            let decoded = try JSONDecoder().decode(
                UpdateReactionSetRequest.self, from: try JSONEncoder().encode(request))
            XCTAssertEqual(decoded, request)
        }
    }

    // MARK: - The named 422s ride the §12 vocabulary

    func test_reactionSetCodesAreInTheTypedVocabularyAt422_PROTOCOL12() throws {
        for (code, wire) in [
            (APIErrorCode.reactionSetLength, "REACTION_SET_LENGTH"),
            (APIErrorCode.reactionSetInvalid, "REACTION_SET_INVALID"),
            (APIErrorCode.reactionSetDuplicate, "REACTION_SET_DUPLICATE"),
        ] {
            XCTAssertEqual(code.rawValue, wire)
            XCTAssertEqual(code.httpStatus, 422)
            let envelope = try JSONDecoder().decode(
                APIErrorEnvelope.self,
                from: Data(#"{"error":"\#(wire)","message":"x"}"#.utf8))
            XCTAssertEqual(envelope.code, code, "the envelope's typed view resolves it")
        }
    }
}
