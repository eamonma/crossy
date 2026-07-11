// The Live Activity push channel's token registration (PROTOCOL.md §12a). The iOS app
// starts a Live Activity when it backgrounds an ongoing room; ActivityKit then hands it
// a per-activity APNs update token, which the server needs to push content-state to that
// island. This file is the pure half of getting that token to the server and taking it
// back down: hex encoding, the environment pick, the two endpoint paths, and the "which
// token did I register, what do I delete" bookkeeping. The ActivityKit IO and the real
// REST call are the app target's thin adapter (SP-i3: the packages' tests build on
// macOS, so nothing ActivityKit-touching lives here).
//
// The registry is API-owned (single writer crossy_api, INV-7); this is only the client's
// side of the two endpoints (§12a table): POST /games/{gameId}/live-activity-tokens with
// { token, environment }, and DELETE /games/{gameId}/live-activity-tokens/{token}. Both
// answer 204, so neither carries a response body to decode.

import Foundation

/// Which APNs host minted the token (PROTOCOL.md §12a). A Debug build mints a token that
/// only works against the sandbox APNs host, so the server routes per row; sending the
/// wrong environment would push a live token to the host that never issued it. The raw
/// values are the exact strings the API validates against ({ sandbox, production }; an
/// `environment` outside that pair is VALIDATION), never locale-cased (INV-1).
public enum LiveActivityEnvironment: String, Sendable, Equatable, Codable {
    case sandbox
    case production

    /// The environment this build's tokens belong to. A Debug build's token is a sandbox
    /// token; a release build's is production. Resolved at compile time so the choice is
    /// the build's, never a runtime flag that could drift from the token's real origin.
    public static var current: LiveActivityEnvironment {
        #if DEBUG
            return .sandbox
        #else
            return .production
        #endif
    }
}

/// The `POST /games/{gameId}/live-activity-tokens` request body (PROTOCOL.md §12a): the
/// hex token and the environment that minted it. Upserted server-side on the token (its
/// primary key), so a re-register after a token rotation refreshes the row rather than
/// erroring.
public struct LiveActivityTokenRegistration: Sendable, Equatable, Codable {
    public let token: String
    public let environment: LiveActivityEnvironment

    public init(token: String, environment: LiveActivityEnvironment) {
        self.token = token
        self.environment = environment
    }
}

/// The pure path builder and bookkeeping for one room's token registration. It owns no
/// IO: it maps a raw ActivityKit token (`Data`) to the hex string the server keys on,
/// builds the two endpoint paths against a game id, and remembers the last token it
/// registered so the end path knows what to delete. The app-target adapter feeds it the
/// token bytes and executes the calls it returns against the real REST client.
///
/// Hex is lowercase, the conventional APNs token rendering; the server treats the token
/// as an opaque primary key, so any stable encoding round-trips, but pinning lowercase
/// keeps a rotated re-register hitting the same row and never a case-forked duplicate.
public struct LiveActivityTokenRegistrar: Sendable, Equatable {
    public let gameId: String
    /// The last token this registrar registered, hex-encoded. Nil before the first
    /// register and after an unregister. The end path deletes exactly this token, so a
    /// missed register (nothing to delete) is a clean no-op, never a spurious DELETE.
    public private(set) var registeredToken: String?

    public init(gameId: String, registeredToken: String? = nil) {
        self.gameId = gameId
        self.registeredToken = registeredToken
    }

    /// Lowercase-hex-encode raw ActivityKit token bytes. ASCII-only formatting (INV-1):
    /// each byte is two lowercase hex digits, no locale, no separators, so the string is
    /// byte-stable across devices and the server keys on it directly.
    public static func hexEncode(_ token: Data) -> String {
        var hex = ""
        hex.reserveCapacity(token.count * 2)
        for byte in token {
            hex.append(hexDigits[Int(byte >> 4)])
            hex.append(hexDigits[Int(byte & 0x0F)])
        }
        return hex
    }

    private static let hexDigits = Array("0123456789abcdef")

    /// The path components for `POST /games/{gameId}/live-activity-tokens`. Path only;
    /// the body is a `LiveActivityTokenRegistration`.
    public var registerPath: [String] {
        ["games", gameId, "live-activity-tokens"]
    }

    /// Record a freshly hex-encoded token as registered and return the register call to
    /// make: the path and the { token, environment } body. Re-registering on a token
    /// rotation is safe (the server upserts), so this always returns a call rather than
    /// suppressing a repeat; the caller re-POSTs and the row refreshes.
    public mutating func register(
        hexToken: String,
        environment: LiveActivityEnvironment = .current
    ) -> (path: [String], body: LiveActivityTokenRegistration) {
        registeredToken = hexToken
        return (
            registerPath,
            LiveActivityTokenRegistration(token: hexToken, environment: environment)
        )
    }

    /// The delete call for the currently registered token, or nil when nothing is
    /// registered (a missed register, or an already-run unregister). Path is
    /// `DELETE /games/{gameId}/live-activity-tokens/{token}`; the token rides the path,
    /// so it is percent-encoded by the URL builder like any component. Clears the
    /// bookkeeping, so a second end sweep is a no-op rather than a repeat DELETE.
    public mutating func unregister() -> [String]? {
        guard let token = registeredToken else { return nil }
        registeredToken = nil
        return ["games", gameId, "live-activity-tokens", token]
    }
}
