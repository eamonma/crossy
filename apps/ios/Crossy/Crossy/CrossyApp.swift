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

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(pendingInvite)
                // Universal Links (applinks:crossy.me): the system Camera app's QR
                // banner and any tap on a crossy.me invite hand the app a browsing
                // activity carrying the web URL. InviteScan digests it to a code
                // exactly as it digests a scanned QR — the deep link and the scanner
                // share one parser — and the arrival flow honors it (at once when
                // signed in, held through sign-in otherwise, EXPERIENCE.md §3). A
                // crossy.me URL that names no room digests to nil and is ignored, so
                // the app just opens.
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL,
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
