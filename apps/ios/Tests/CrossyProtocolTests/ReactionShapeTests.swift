import Foundation
import XCTest

import CrossyProtocol

// Emoji reactions: shape only, receive-any (PROTOCOL.md §5, §6, §9). Twinned
// case-for-case from the reactions describe block in packages/protocol/src/codec.test.ts:
// the decoders enforce a non-empty string of at most 32 UTF-8 bytes and NEVER set
// membership, which is session-service policy, so an emoji outside the v1 set decodes
// in both directions and the published set can widen without a version bump (§14).

final class ReactionShapeTests: XCTestCase {
    // MARK: - Receive-any, send-gated (§9)

    func test_decodesAReactWhoseEmojiIsOutsideTheV1Set_receiveAny_PROTOCOL9() throws {
        // The codec checks shape, not set membership; gating is the sender's policy.
        let frame = Data(#"{"type":"react","emoji":"🔥","cell":3}"#.utf8)
        let decoded = try JSONDecoder().decode(ClientMessage.self, from: frame)
        XCTAssertEqual(decoded, .react(ReactMessage(emoji: "🔥", cell: 3)))
    }

    func test_decodesAReactionWhoseEmojiIsOutsideTheV1Set_receiveAny_PROTOCOL9() throws {
        // A receiver MUST NOT reject an unknown emoji (receive-any, send-gated, §9).
        let frame = Data(#"{"type":"reaction","userId":"u2","emoji":"🦀","cell":3}"#.utf8)
        let decoded = try JSONDecoder().decode(ServerMessage.self, from: frame)
        XCTAssertEqual(decoded, .reaction(ReactionMessage(userId: "u2", emoji: "🦀", cell: 3)))
    }

    // MARK: - Forward compatibility (§3)

    func test_ignoresUnknownExtraFieldsOnReactAndReaction_PROTOCOL3() throws {
        let react = Data(
            #"{"type":"react","emoji":"🎉","cell":3,"futureField":{"nested":true}}"#.utf8)
        let decodedReact = try JSONDecoder().decode(ClientMessage.self, from: react)
        XCTAssertEqual(decodedReact, .react(ReactMessage(emoji: "🎉", cell: 3)))
        let reencodedReact = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(decodedReact)) as? NSDictionary)
        XCTAssertNil(reencodedReact["futureField"])
        XCTAssertEqual(
            Set(reencodedReact.allKeys.compactMap { $0 as? String }),
            ["type", "emoji", "cell"])

        let reaction = Data(
            #"{"type":"reaction","userId":"u2","emoji":"🎉","cell":3,"futureField":1}"#.utf8)
        let decodedReaction = try JSONDecoder().decode(ServerMessage.self, from: reaction)
        XCTAssertEqual(
            decodedReaction, .reaction(ReactionMessage(userId: "u2", emoji: "🎉", cell: 3)))
        let reencodedReaction = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(decodedReaction)) as? NSDictionary)
        XCTAssertNil(reencodedReaction["futureField"])
    }

    // MARK: - Malformed frames (§5, §11 drop-and-log posture)

    func test_rejectsAReactMissingEmojiAsMalformed_PROTOCOL5() {
        let frame = Data(#"{"type":"react","cell":3}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ClientMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError, "missing emoji is malformed, got \(error)")
        }
    }

    func test_rejectsAReactionWithAMistypedCellAsMalformed_PROTOCOL6() {
        let frame = Data(#"{"type":"reaction","userId":"u2","emoji":"🎉","cell":"3"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError, "a string cell is malformed, got \(error)")
        }
    }

    // MARK: - The 32-byte shape rule (§9)

    func test_rejectsAnEmptyEmojiAsMalformed_PROTOCOL9() {
        let frame = Data(#"{"type":"react","emoji":"","cell":3}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ClientMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError, "empty emoji is malformed, got \(error)")
        }
    }

    func test_rejectsAnEmojiOver32UTF8BytesAsMalformed_PROTOCOL9() {
        // Nine 🎉 graphemes are 36 UTF-8 bytes (4 each), past the 32-byte shape cap.
        let frame = Data(
            #"{"type":"react","emoji":"\#(String(repeating: "🎉", count: 9))","cell":3}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ClientMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError, "36 bytes is malformed, got \(error)")
        }
    }

    func test_acceptsAnEmojiExactlyAtThe32UTF8ByteCap_PROTOCOL9() throws {
        // Eight 🎉 graphemes are exactly 32 UTF-8 bytes, the inclusive boundary.
        let emoji = String(repeating: "🎉", count: 8)
        let frame = Data(#"{"type":"react","emoji":"\#(emoji)","cell":3}"#.utf8)
        let decoded = try JSONDecoder().decode(ClientMessage.self, from: frame)
        XCTAssertEqual(decoded, .react(ReactMessage(emoji: emoji, cell: 3)))
    }

    func test_reactionDecoderAppliesTheSameShapeRule_PROTOCOL9() {
        // The inbound notice enforces shape exactly as the outbound command does:
        // one rule, both directions (the codec's single asEmoji).
        let empty = Data(#"{"type":"reaction","userId":"u2","emoji":"","cell":3}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: empty))
        let oversize = Data(
            #"{"type":"reaction","userId":"u2","emoji":"\#(String(repeating: "🎉", count: 9))","cell":3}"#
                .utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: oversize))
    }
}
