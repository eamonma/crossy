import Foundation
import XCTest

import CrossyProtocol

// Parse posture (PROTOCOL.md §3, §5, §11, §14), twinned from the posture cases in
// packages/protocol/src/codec.test.ts: unknown fields are ignored, a
// recognizable-but-unknown `type` is a distinct outcome from a malformed frame, and
// version negotiation is business logic, not decoding.

final class WirePostureTests: XCTestCase {
    func test_unknownClientCommandTypeThrowsUnknownType() throws {
        // §5: the server answers UNKNOWN_TYPE; the decode outcome must be
        // distinguishable from malformed so it can.
        let frame = Data(#"{"type":"frobnicate","commandId":"c9"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ClientMessage.self, from: frame)) { error in
            XCTAssertEqual(error as? WireDecodingError, .unknownType("frobnicate"))
        }
    }

    func test_unknownServerNoticeTypeThrowsUnknownType() throws {
        // §3: the client ignores and logs an unknown notice; it needs the same
        // distinguishable outcome.
        let frame = Data(#"{"type":"sparkle","glitter":true}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: frame)) { error in
            XCTAssertEqual(error as? WireDecodingError, .unknownType("sparkle"))
        }
    }

    func test_unknownFieldsAreIgnoredAndDroppedOnReencode() throws {
        // §3, §14 forward compatibility: decode copies only known fields, exactly as
        // the TS decoders build a fresh object.
        let frame = Data(
            #"""
            {"type":"cellSet","seq":1,"cell":0,"value":"A","by":"u1",
             "commandId":"c1","at":"2026-07-07T00:00:00Z","futureField":{"nested":true}}
            """#.utf8)
        let decoded = try JSONDecoder().decode(ServerMessage.self, from: frame)
        let reencoded = try XCTUnwrap(
            try jsonObject(JSONEncoder().encode(decoded)) as? NSDictionary)
        XCTAssertNil(reencoded["futureField"])
        XCTAssertEqual(
            Set(reencoded.allKeys.compactMap { $0 as? String }),
            ["type", "seq", "cell", "value", "by", "commandId", "at"])
    }

    func test_malformedFramesThrowDecodingErrorNotUnknownType() throws {
        // §11: a frame with no usable `type` is malformed (drop-and-log posture), a
        // different failure from unknown_type. Mirrors the TS malformed cases.
        let malformed = ["42", #""string""#, "null", "[]", "{}", #"{"type":7}"#]
        for raw in malformed {
            XCTAssertThrowsError(
                try JSONDecoder().decode(ClientMessage.self, from: Data(raw.utf8)),
                "frame \(raw) must fail to decode"
            ) { error in
                XCTAssertTrue(
                    error is DecodingError,
                    "frame \(raw) must be malformed (DecodingError), got \(error)")
            }
        }
    }

    func test_missingRequiredFieldIsMalformed() throws {
        let frame = Data(#"{"type":"placeLetter","commandId":"c1","cell":0}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ClientMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError, "missing `value` must be malformed")
        }
    }

    func test_cellSetValueKeyIsRequiredEvenThoughNullable() throws {
        // §6: `value` is nullable-and-present. A cellSet with no `value` key at all is
        // malformed, matching the TS asNullableString, not silently nil.
        let frame = Data(
            #"{"type":"cellSet","seq":1,"cell":0,"by":"u1","commandId":"c1","at":"t"}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError)
        }
    }

    func test_helloForAFutureVersionStillDecodes() throws {
        // §2, §14: any integer protocolVersion decodes cleanly; mapping an unsupported
        // one to PROTOCOL_VERSION_UNSUPPORTED is the server's negotiation, not the codec's.
        let frame = Data(#"{"type":"hello","protocolVersion":999,"token":"jwt"}"#.utf8)
        let decoded = try JSONDecoder().decode(ClientMessage.self, from: frame)
        guard case .hello(let hello) = decoded else {
            return XCTFail("expected a hello, got \(decoded.type)")
        }
        XCTAssertEqual(hello.protocolVersion, 999)
    }

    func test_unknownErrorCodeIsMalformed() throws {
        // §11 twin of the TS asErrorCode: the code vocabulary is closed per protocol
        // version (a new code is a §14 concern), so "NONSENSE" is malformed.
        let frame = Data(#"{"type":"error","code":"NONSENSE","message":"x","fatal":false}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(ServerMessage.self, from: frame)) { error in
            XCTAssertTrue(error is DecodingError)
        }
    }

    func test_asciiOnlyWireEnums_INV1() throws {
        // INV-1: every enum raw value this module compares against the wire is plain
        // ASCII, so no locale-aware transform can be involved in matching them.
        let rawValues =
            Role.allCases.map(\.rawValue)
            + Direction.allCases.map(\.rawValue)
            + GameStatus.allCases.map(\.rawValue)
            + ErrorCode.allCases.map(\.rawValue)
            + APIErrorCode.allCases.map(\.rawValue)
        for raw in rawValues {
            XCTAssertTrue(raw.utf8.allSatisfy { $0 < 0x80 }, "\(raw) must be ASCII")
        }
    }
}
