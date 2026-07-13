//
//  ArrivalConfig.swift
//  Crossy
//
//  What the arrival flow (Welcome, Rooms, Join; roadmap I3) needs to dial: the two
//  service bases, the web origin (the privacy policy link), and the Supabase auth
//  facts, all from the committed CrossyConfig.plist (config as code, I0c), with the
//  CROSSY_IT_* launch/env facts overriding the bases so the same journey walks
//  against the local stack (the I1e harness pattern RoomConfig already speaks). The
//  auth slot resolves nil when the plist values are empty; the Welcome screen states
//  that honestly (EXPERIENCE.md §3), never a crash. The web origin never resolves
//  nil: an empty or unparsed slot falls back to the production origin.
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
    /// The marketing/web origin (today crossy.party): where the live web app and its
    /// static surfaces (the privacy policy at /privacy) are served. Falls back to
    /// the production origin when the plist slot is empty or unparsed, so a stale
    /// or partial build still opens the real policy rather than dead-ending.
    let webOrigin: URL
    /// nil when the plist auth slots are empty: the honest unconfigured state.
    let auth: SupabaseAuthConfiguration?
    /// nil when the plist token slot is empty: analytics off, makeAnalytics selects
    /// the noop (the auth slot's posture exactly). The token is public by design (a
    /// phc_ token is write-only), so it is committed like the publishable key.
    let analytics: AnalyticsConfiguration?
    /// The Turnstile site key the hidden captcha web view renders (public by design;
    /// see CrossyConfig.plist). nil when the plist slot is empty: the email leg then
    /// sends with no captcha token, which the calm send-failure copy states honestly
    /// if the project has captcha on. Overridable by the CROSSY_IT_TURNSTILE_KEY
    /// launch/env fact the other keys accept, so a harness build can point the widget
    /// at a test key (the always-passes 1x000... key) or clear it.
    let turnstileSiteKey: String?

    /// The production web origin, the fallback when no plist/launch-fact value
    /// resolves. Mirrors deploy/README.md's custom-domain cutover table.
    static let defaultWebOrigin = URL(string: "https://crossy.party")!

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

        let webRaw = LaunchFacts.value("CROSSY_IT_WEB_URL") ?? plist["WebOrigin"]
        let webOrigin = webRaw.flatMap { URL(string: $0) } ?? defaultWebOrigin

        // An empty plist slot reads as "no captcha" (nil), not an empty-string key the
        // widget would choke on: the launch fact already normalizes empty to nil, and
        // the plist side is normalized here for the same honest posture.
        let turnstileRaw = LaunchFacts.value("CROSSY_IT_TURNSTILE_KEY") ?? plist["TurnstileSiteKey"]
        let turnstileSiteKey = (turnstileRaw?.isEmpty == false) ? turnstileRaw : nil

        return ArrivalConfig(
            apiBaseURL: apiBaseURL,
            sessionBaseURL: sessionBaseURL,
            webOrigin: webOrigin,
            auth: SupabaseAuthConfiguration(
                supabaseURL: plist["SupabaseURL"],
                publishableKey: plist["SupabasePublishableKey"],
                redirect: redirect),
            analytics: AnalyticsConfiguration(
                projectToken: plist["PostHogProjectToken"],
                host: plist["PostHogHost"]),
            turnstileSiteKey: turnstileSiteKey)
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
