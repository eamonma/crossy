//
//  ShareSheet.swift
//  Crossy
//
//  The system share sheet for the room invite. CrossyUI reports the intent
//  (the share menu's "Share…" row, ShareMenuPill's onShare) as a plain closure
//  and stays free of UIKit (AD-2: CrossyUI depends only on
//  CrossyStore/CrossyDesign); the app target owns UIActivityViewController,
//  exactly as it already owns the pasteboard write for Copy link. The shared
//  payload is ShareInvite.url, the same link the menu's QR sheet encodes and
//  its Copy link row carries.
//

import SwiftUI
import UIKit

/// A thin UIViewControllerRepresentable around UIActivityViewController,
/// presented via `.sheet` from a `@State` URL the composition root sets on
/// "Share…". Nothing here decides the payload; it only presents it.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

extension View {
    /// Presents the system share sheet for `url` whenever it is non-nil,
    /// clearing it on dismissal so a repeat tap on "Share…" re-presents
    /// rather than reusing a stale controller.
    func shareInviteSheet(url: Binding<URL?>) -> some View {
        sheet(
            isPresented: Binding(
                get: { url.wrappedValue != nil },
                set: { presented in if !presented { url.wrappedValue = nil } })
        ) {
            if let shareURL = url.wrappedValue {
                ShareSheet(url: shareURL)
            }
        }
    }
}
