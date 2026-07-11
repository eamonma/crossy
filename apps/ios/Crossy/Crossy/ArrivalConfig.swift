//
//  ArrivalConfig.swift
//  Crossy
//
//  What the arrival flow (Welcome, Rooms, Join; roadmap I3) needs to dial: the two
//  service bases and the Supabase auth facts, all from the committed CrossyConfig.plist
//  (config as code, I0c), with the CROSSY_IT_* launch/env facts overriding the bases so
//  the same journey walks against the local stack (the I1e harness pattern RoomConfig
//  already speaks). The auth slot resolves nil when the plist values are empty; the
//  Welcome screen states that honestly (EXPERIENCE.md §3), never a crash.
//

import CrossyAPI
import Foundation

/// Launch-argument and environment lookup, the RoomConfig convention (`-KEY value`
/// wins over an inherited env var) shared by everything the arrival flow resolves.
enum LaunchFacts {
    static func value(
        _ key: String,
        arguments: [String] = ProcessInfo.processInfo.arguments,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> String? {
        if let index = arguments.firstIndex(of: "-\(key)"),
            arguments.indices.contains(index + 1),
            !arguments[index + 1].isEmpty
        {
            return arguments[index + 1]
        }
        let fromEnv = environment[key]
        return (fromEnv?.isEmpty == false) ? fromEnv : nil
    }

    static func flag(
        _ name: String, arguments: [String] = ProcessInfo.processInfo.arguments
    ) -> Bool {
        arguments.contains("-\(name)")
    }
}

struct ArrivalConfig {
    /// The OAuth callback the web sheet intercepts. A custom scheme needs no
    /// Info.plist registration for ASWebAuthenticationSession; Supabase's redirect
    /// allowlist must carry it (owner dashboard action, noted at I3a).
    static let redirect = "crossy://auth/callback"

    let apiBaseURL: URL
    let sessionBaseURL: URL
    /// nil when the plist auth slots are empty: the honest unconfigured state.
    let auth: SupabaseAuthConfiguration?

    /// Resolve from the bundled plist, letting CROSSY_IT_API_URL / CROSSY_IT_WS_BASE
    /// override the bases (the harness and device walks point Rooms at the local
    /// stack this way). Returns nil only when no usable base URL exists anywhere,
    /// which a committed plist makes unreachable in practice.
    static func load(bundle: Bundle = .main) -> ArrivalConfig? {
        let plist = plistValues(bundle: bundle)
        let apiRaw = LaunchFacts.value("CROSSY_IT_API_URL") ?? plist["APIBase"]
        let wsRaw = LaunchFacts.value("CROSSY_IT_WS_BASE") ?? plist["SessionWSBase"]
        guard
            let apiRaw, let wsRaw,
            let apiBaseURL = URL(string: apiRaw), apiBaseURL.host != nil,
            let sessionBaseURL = URL(string: wsRaw), sessionBaseURL.host != nil
        else { return nil }

        return ArrivalConfig(
            apiBaseURL: apiBaseURL,
            sessionBaseURL: sessionBaseURL,
            auth: SupabaseAuthConfiguration(
                supabaseURL: plist["SupabaseURL"],
                publishableKey: plist["SupabasePublishableKey"],
                redirect: redirect))
    }

    private static func plistValues(bundle: Bundle) -> [String: String] {
        guard
            let url = bundle.url(forResource: "CrossyConfig", withExtension: "plist"),
            let data = try? Data(contentsOf: url),
            let raw = try? PropertyListSerialization.propertyList(
                from: data, options: [], format: nil),
            let values = raw as? [String: String]
        else { return [:] }
        return values
    }
}
