import XCTest

import CrossyProtocol

// The §11 error-code table and the protocol version, pinned verbatim, twinning
// packages/protocol/src/errors.test.ts and version.test.ts.

final class WireErrorTableTests: XCTestCase {
    // The §11 table: code -> fatality. `INTERNAL` is varies (fatal:true means reconnect).
    private static let table: [String: Fatality] = [
        "UNAUTHORIZED": .always,
        "NOT_PARTICIPANT": .always,
        "DENIED": .always,
        "GAME_NOT_FOUND": .always,
        "PROTOCOL_VERSION_UNSUPPORTED": .always,
        "GAME_NOT_ONGOING": .never,
        "INVALID_CELL": .never,
        "INVALID_VALUE": .never,
        "ROLE_FORBIDDEN": .never,
        "RATE_LIMITED": .never,
        "UNKNOWN_TYPE": .never,
        "INTERNAL": .varies,
    ]

    func test_listsExactlyTheTwelveSection11Codes() throws {
        XCTAssertEqual(
            Set(ErrorCode.allCases.map(\.rawValue)),
            Set(Self.table.keys))
    }

    func test_classifiesFatalityPerTheSection11Table() throws {
        for code in ErrorCode.allCases {
            XCTAssertEqual(
                code.fatality, Self.table[code.rawValue],
                "\(code.rawValue) fatality must match PROTOCOL.md §11")
        }
    }

    func test_protocolVersionIs1PerTheChangelog() throws {
        // PROTOCOL.md §2, §14 changelog: v1, 2026-07-07, initial.
        XCTAssertEqual(ProtocolVersion.current, 1)
    }
}
