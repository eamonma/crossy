//
//  RoomConfig.swift
//  Crossy
//
//  What the RealRoom needs to dial a live stack: the two base URLs, the game to open,
//  and the injected token (the CROSSY_IT_* pattern the I1e harness already speaks,
//  apps/ios/scripts/integration.ts). Resolved from launch arguments and the
//  environment at startup, exactly as DemoRoom reads its -i2* scripts. A fresh clone
//  with no configuration returns nil, so ContentView lands in DemoRoom (the launch-arg
//  precedent: the room you get with no config is the offline fixture).
//
//  I2 wires this against the local stack with an injected token. I3 replaces the token
//  with the Keychain session and the base URLs with the committed production config
//  (CrossyConfig.plist); RoomConfig itself is the seam that stops moving.
//

import Foundation

/// The facts a live room needs. Base URLs are the REST origin and the WebSocket origin;
/// the game id names the room; the token is the bearer identity for both REST and the
/// hello handshake (PROTOCOL.md §2, §12).
struct RoomConfig: Sendable, Equatable {
    var apiBaseURL: URL
    var sessionBaseURL: URL
    var gameId: String
    var token: String

    /// Resolve from launch arguments first, then the environment (the harness injects
    /// either; arguments win so a scheme override beats an inherited env var). Returns
    /// nil unless every required fact is present and the URLs parse, so a partial or
    /// absent configuration cleanly falls back to DemoRoom rather than half-dialing.
    ///
    /// Keys mirror integration.ts's CROSSY_IT_* facts so one harness configures both
    /// the swift-test round trip and this app:
    ///   CROSSY_IT_API_URL   the REST base (http://127.0.0.1:889x)
    ///   CROSSY_IT_WS_BASE   the WebSocket base (ws://127.0.0.1:889x)
    ///   CROSSY_IT_GAME_ID   the seeded game
    ///   CROSSY_IT_TOKEN     the injected bearer (a single identity for the app)
    static func resolve(
        arguments: [String] = ProcessInfo.processInfo.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> RoomConfig? {
        func value(_ key: String) -> String? {
            if let fromArg = argumentValue(key, in: arguments) { return fromArg }
            let fromEnv = environment[key]
            return (fromEnv?.isEmpty == false) ? fromEnv : nil
        }

        guard let apiRaw = value("CROSSY_IT_API_URL"),
            let wsRaw = value("CROSSY_IT_WS_BASE"),
            let gameId = value("CROSSY_IT_GAME_ID"),
            let token = value("CROSSY_IT_TOKEN"),
            let apiURL = URL(string: apiRaw),
            let sessionURL = URL(string: wsRaw)
        else { return nil }

        return RoomConfig(
            apiBaseURL: apiURL, sessionBaseURL: sessionURL, gameId: gameId, token: token)
    }

    /// A launch argument as `-KEY value` (the DemoRoom -i2* convention, extended to
    /// take a following value). Nil when the flag is absent or has no value.
    private static func argumentValue(_ key: String, in arguments: [String]) -> String? {
        guard let index = arguments.firstIndex(of: "-\(key)"),
            arguments.indices.contains(index + 1)
        else { return nil }
        let candidate = arguments[index + 1]
        return candidate.isEmpty ? nil : candidate
    }
}
