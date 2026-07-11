import Foundation
import XCTest

import CrossyProtocol

// The pure half of the Live Activity push-token upload (PROTOCOL.md §12a): hex encoding,
// the two endpoint paths, the environment pick, and the "which token is registered, what
// to delete" bookkeeping. The ActivityKit IO and the real POST/DELETE are the app
// target's adapter (SolveActivityController); these headless tests pin the data logic the
// adapter leans on so the encoding and paths never drift from the §12a contract.

final class LiveActivityTokenRegistrationTests: XCTestCase {
    private let gameId = "7d9f34a2-4b1e-4c3a-9d2f-8a6b5c4d3e2f"

    // MARK: - Hex encoding

    func test_hexEncode_isLowercaseTwoDigitsPerByte() {
        // The APNs update token arrives as Data; the server keys on the hex string, so
        // each byte is exactly two lowercase hex digits, no separators (§12a).
        let token = Data([0x00, 0x0f, 0xa9, 0xff, 0x10])
        XCTAssertEqual(LiveActivityTokenRegistrar.hexEncode(token), "000fa9ff10")
    }

    func test_hexEncode_emptyDataIsEmptyString() {
        XCTAssertEqual(LiveActivityTokenRegistrar.hexEncode(Data()), "")
    }

    func test_hexEncode_isAsciiOnlyAndLocaleStable_INV1() {
        // INV-1: casing and formatting are ASCII-only, so the string is byte-stable
        // across devices and locales. Every high nibble 0xA0..0xF0 encodes to a-f, never
        // an uppercase or locale-folded digit.
        let token = Data([0xab, 0xcd, 0xef])
        let hex = LiveActivityTokenRegistrar.hexEncode(token)
        XCTAssertEqual(hex, "abcdef")
        XCTAssertEqual(hex, hex.lowercased())
        XCTAssertTrue(hex.allSatisfy { $0.isASCII })
    }

    // MARK: - Environment pick

    func test_environmentCurrent_isSandboxUnderDebug() {
        // A Debug build's token only works against the sandbox APNs host; the server
        // routes per row (§12a). The pick is compile-time, so a test build (Debug) reads
        // sandbox and pins the DEBUG branch.
        #if DEBUG
            XCTAssertEqual(LiveActivityEnvironment.current, .sandbox)
        #else
            XCTAssertEqual(LiveActivityEnvironment.current, .production)
        #endif
    }

    func test_environmentRawValues_matchTheServerContract() {
        // The API validates `environment` against exactly { sandbox, production } and
        // rejects anything else as VALIDATION (§12a). The raw values are those strings.
        XCTAssertEqual(LiveActivityEnvironment.sandbox.rawValue, "sandbox")
        XCTAssertEqual(LiveActivityEnvironment.production.rawValue, "production")
    }

    // MARK: - Endpoint paths

    func test_registerPath_isTheGamesLiveActivityTokensRoute() {
        let registrar = LiveActivityTokenRegistrar(gameId: gameId)
        XCTAssertEqual(registrar.registerPath, ["games", gameId, "live-activity-tokens"])
    }

    func test_register_returnsThePathAndTheTypedBody() {
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        let call = registrar.register(hexToken: "deadbeef", environment: .production)
        XCTAssertEqual(call.path, ["games", gameId, "live-activity-tokens"])
        XCTAssertEqual(
            call.body,
            LiveActivityTokenRegistration(token: "deadbeef", environment: .production))
    }

    func test_unregisterPath_carriesTheTokenAsTheLastComponent() {
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        _ = registrar.register(hexToken: "deadbeef", environment: .sandbox)
        XCTAssertEqual(
            registrar.unregister(),
            ["games", gameId, "live-activity-tokens", "deadbeef"])
    }

    // MARK: - Bookkeeping (which token is registered, what to delete)

    func test_unregister_withNothingRegisteredIsNil() {
        // A missed register means nothing to delete: the end path is a clean no-op, never
        // a spurious DELETE (§12a step 4).
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        XCTAssertNil(registrar.unregister())
    }

    func test_register_tracksTheLastTokenForTheEndPath() {
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        _ = registrar.register(hexToken: "aaaa", environment: .sandbox)
        XCTAssertEqual(registrar.registeredToken, "aaaa")
    }

    func test_rotation_deletesTheLatestTokenNotAStaleOne() {
        // The stream can yield again on rotation; the server upserts, so the latest token
        // is the live one. The end path must delete that, not a token a rotation replaced.
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        _ = registrar.register(hexToken: "first", environment: .sandbox)
        _ = registrar.register(hexToken: "second", environment: .sandbox)
        XCTAssertEqual(registrar.registeredToken, "second")
        XCTAssertEqual(
            registrar.unregister(),
            ["games", gameId, "live-activity-tokens", "second"])
    }

    func test_unregister_clearsBookkeepingSoASecondSweepIsANoOp() {
        // A terminal room and a foreground return can both sweep; the second must not
        // repeat the DELETE.
        var registrar = LiveActivityTokenRegistrar(gameId: gameId)
        _ = registrar.register(hexToken: "aaaa", environment: .sandbox)
        XCTAssertNotNil(registrar.unregister())
        XCTAssertNil(registrar.registeredToken)
        XCTAssertNil(registrar.unregister())
    }

    // MARK: - Request body wire shape

    func test_registrationBody_encodesTokenAndEnvironment() throws {
        // The POST body is exactly { token, environment } (§12a); the server reads those
        // two keys and rejects a missing token or an out-of-set environment as VALIDATION.
        let body = LiveActivityTokenRegistration(token: "deadbeef", environment: .sandbox)
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body))
        let dictionary = try XCTUnwrap(object as? [String: String])
        XCTAssertEqual(dictionary, ["token": "deadbeef", "environment": "sandbox"])
    }
}
