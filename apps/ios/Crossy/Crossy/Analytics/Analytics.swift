//
//  Analytics.swift
//  Crossy
//
//  The product-analytics port: the vendor confined to one adapter behind a port the
//  app owns, unconfigured selects the noop (the apps/web/src/identity pattern on the
//  Swift side). Only PostHogAnalytics.swift imports the vendor, and the SDK is linked
//  to the app target alone, so the widget cannot reach it even by accident.
//
//  INV-6 posture: events carry counts, ids, and status, never letters, cells,
//  coordinates, or solutions. Board content is not analytics material.
//

import Foundation
import SwiftUI

/// The three verbs the app says about usage. Event names are shared vocabulary with
/// web and server (app_opened, signed_in: exactly these snake_case strings), so one
/// funnel reads across clients.
protocol Analytics {
    /// One named event, with optional INV-6-safe properties (counts, ids, status).
    func capture(_ event: String, properties: [String: Any]?)
    /// Bind subsequent events to the signed-in user id (the same id the roster
    /// speaks; display facts stay out, DESIGN.md §8).
    func identify(userId: String)
    /// Forget the identity: sign-out, deletion, or a terminal refresh refusal.
    func reset()
}

extension Analytics {
    func capture(_ event: String) { capture(event, properties: nil) }
}

/// The committed PostHog facts (CrossyConfig.plist). nil when the token slot is
/// absent or empty: the honest analytics-off state, SupabaseAuthConfiguration's
/// posture.
struct AnalyticsConfiguration: Sendable, Equatable {
    /// The write-only phc_ project token, public by design and committed.
    let projectToken: String
    /// The ingestion host; nil when the slot is empty (the adapter's default stands).
    let host: String?

    init?(projectToken: String?, host: String?) {
        guard let projectToken, !projectToken.isEmpty else { return nil }
        self.projectToken = projectToken
        self.host = (host?.isEmpty == false) ? host : nil
    }
}

/// Adapter selection, the createIdentity pattern: config in, port out. The noop when
/// the token slot is empty and for every composition that would only emit noise —
/// previews, the lab rigs, the demo room and its -i2* scripts, the fixture walk, the
/// CROSSY_IT_* harness. Gated here at creation, so no call site carries an if.
func makeAnalytics(config: ArrivalConfig?) -> any Analytics {
    guard let configuration = config?.analytics, !quietComposition() else {
        return NoopAnalytics()
    }
    return PostHogAnalytics(configuration: configuration)
}

/// True for the compositions that never speak to a vendor: Xcode previews, the
/// evidence rigs (-morphLab, -meltLab, -islandLab, -pillArrivalLab, -seededBirthLab),
/// the offline demo room (-demoRoom and the -i2* scripts that imply it), the
/// -i3Fixture walk, and the harness identity (CROSSY_IT_TOKEN). These are all
/// launch-time facts, so the selection is made once.
private func quietComposition() -> Bool {
    if ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1" {
        return true
    }
    let rigs = [
        "morphLab", "meltLab", "islandLab", "pillArrivalLab", "seededBirthLab",
        "demoRoom", "i3Fixture",
    ]
    if rigs.contains(where: { LaunchFacts.flag($0) }) { return true }
    if ProcessInfo.processInfo.arguments.contains(where: { $0.hasPrefix("-i2") }) {
        return true
    }
    return LaunchFacts.value("CROSSY_IT_TOKEN") != nil
}

extension EnvironmentValues {
    /// The app's analytics, threaded the way PendingInvite is. The default is the
    /// noop, so previews and any hierarchy CrossyApp never dressed stay silent by
    /// construction.
    @Entry var analytics: any Analytics = NoopAnalytics()
}
