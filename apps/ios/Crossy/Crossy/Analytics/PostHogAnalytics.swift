//
//  PostHogAnalytics.swift
//  Crossy
//
//  The one file in the repo that imports PostHog (supabaseAdapter.ts's posture: the
//  vendor lives here and nowhere else). The SDK is linked to the app target only —
//  never the widget, never the apps/ios/Sources packages — so the linker enforces
//  what this comment promises.
//

import Foundation
import PostHog

/// PostHog behind the Analytics port. Configuration stays minimal and INV-6 safe:
/// lifecycle events on, everything that could carry view content off.
final class PostHogAnalytics: Analytics {
    init(configuration: AnalyticsConfiguration) {
        let config = PostHogConfig(
            projectToken: configuration.projectToken,
            host: configuration.host ?? PostHogConfig.defaultHost)
        config.captureApplicationLifecycleEvents = true
        // Off by declaration, not by trust in defaults: screen views and surveys
        // default on in this SDK, and every knob here reads or draws view content
        // (screen names, tapped labels, rendered pixels), which INV-6 keeps out of
        // analytics. Session replay stays off, stated even though its default is off.
        config.captureScreenViews = false
        config.captureElementInteractions = false
        config.sessionReplay = false
        config.surveys = false
        PostHogSDK.shared.setup(config)
    }

    func capture(_ event: String, properties: [String: Any]?) {
        PostHogSDK.shared.capture(event, properties: properties)
    }

    func identify(userId: String) {
        PostHogSDK.shared.identify(userId)
    }

    func reset() {
        PostHogSDK.shared.reset()
    }
}
