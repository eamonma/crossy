//
//  CrossyApp.swift
//  Crossy
//
//  Created by Eamon Ma on 2026-07-10.
//

import CrossyUI
import Foundation
import SwiftUI

@main
struct CrossyApp: App {
    /// The one invite a Universal Link delivered, waiting for the arrival flow to
    /// honor it (the environment carries it down to ArrivalRootView).
    @State private var pendingInvite = PendingInvite()

    /// The one magic link a Universal Link delivered (roadmap I3b), waiting for the
    /// arrival flow to complete it against the session. Its own channel, distinct from
    /// the invite, because it drives sign-in rather than a room join (the environment
    /// carries it down to ArrivalRootView, the PendingInvite precedent).
    @State private var pendingMagicLink = PendingMagicLink()

    /// The analytics port, built once from the committed config (Analytics/). The
    /// noop when the token slot is empty or the composition is a rig (previews,
    /// labs, demo room, fixture, harness), so the capture below is safe to fire
    /// unconditionally.
    private let analytics: any Analytics

    init() {
        analytics = makeAnalytics(config: ArrivalConfig.load())
        // Once per cold launch: the App is instantiated exactly once per process,
        // so this never repeats on a foreground resume.
        analytics.capture("app_opened")
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(pendingInvite)
                .environment(pendingMagicLink)
                .environment(\.analytics, analytics)
                // Universal Links (applinks:crossy.party): the system Camera app's QR
                // banner and any tap on a crossy.party invite hand the app a browsing
                // activity carrying the web URL. InviteScan digests it to a code
                // exactly as it digests a scanned QR — the deep link and the scanner
                // share one parser — and the arrival flow honors it (at once when
                // signed in, held through sign-in otherwise, EXPERIENCE.md §3). A
                // crossy.party URL that names no room digests to nil and is ignored, so
                // the app just opens.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    // The magic link (roadmap I3b, AASA /auth/confirm*): a Supabase email
                    // link lands here as a browsing activity carrying token_hash and type.
                    // AuthConfirm digests exactly that path (distinct from the invite's
                    // /game and /g paths), and the arrival flow completes it against the
                    // session. Checked first so the invite parser never sees it; a match
                    // is terminal here. This is the https Universal Link path only; the
                    // crossy://auth/callback ASWebAuth callback is a different scheme the
                    // sign-in session owns (and onOpenURL still ignores).
                    if let link = AuthConfirm.link(fromURL: url) {
                        pendingMagicLink.link = link
                        return
                    }
                    guard let code = InviteScan.code(fromPayload: url.absoluteString)
                    else { return }
                    pendingInvite.code = code
                }
                // Custom scheme (crossy://game/<id>?code=...): the web invite gate's "Open in the
                // Crossy app" button, for taps that never became a Universal Link (a same-domain
                // Safari tap, an in-app browser). It digests through the exact same parser as the
                // QR and Universal Link paths, so the arrival flow honors it identically. The auth
                // host is the sign-in session's own callback (ASWebAuthenticationSession owns it),
                // so it is skipped here; the guard also fends off the theoretical case where the OS
                // routes that callback to onOpenURL instead of the session.
                .onOpenURL { url in
                    guard url.host != "auth",
                        let code = InviteScan.code(fromPayload: url.absoluteString)
                    else { return }
                    pendingInvite.code = code
                }
        }
    }
}

/// The pending invite code a Universal Link delivered, cleared the moment the
/// arrival flow consumes it (so it fires exactly once).
@MainActor
@Observable
final class PendingInvite {
    var code: String?
}

/// The pending magic link a Universal Link delivered (roadmap I3b), cleared the moment
/// the arrival flow completes it against the session (so it fires exactly once). The
/// PendingInvite twin, on its own channel because it drives sign-in, not a room join.
@MainActor
@Observable
final class PendingMagicLink {
    var link: AuthConfirmLink?
}
