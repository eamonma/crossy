//
//  SafariSheet.swift
//  Crossy
//
//  The in-app reader for the legal pages (Privacy Policy, Terms of Service).
//  CrossyUI reports the intent (the footer buttons' onOpenLegal) as a plain
//  closure and stays free of UIKit (AD-2: the app target owns the view
//  controller, the ShareSheet/CameraScan precedent); this file maps that
//  intent to the model's URLs and presents them. An in-app
//  SFSafariViewController sheet keeps the person in the flow (App Review
//  guideline 5.1.1 expects the policy reachable without leaving the app), and
//  the system chrome carries its own Done button and Safari reader controls,
//  so it is no dead end. SFSafariViewController shares no state with the app
//  (its cookies and history are Safari's, never ours) and needs no delegate
//  here: Done dismisses the sheet on its own.
//

import SafariServices
import SwiftUI

/// One legal page staged for presentation: the Identifiable item
/// `.sheet(item:)` needs, carrying the URL the model resolved from the
/// web origin (the URL itself is the identity).
struct LegalSheetItem: Identifiable {
    let url: URL
    var id: URL { url }
}

/// A thin UIViewControllerRepresentable around SFSafariViewController,
/// defaults only (system tint, the standard Done button). Present with
/// `.ignoresSafeArea()` so the Safari chrome fills the sheet.
struct SafariSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
