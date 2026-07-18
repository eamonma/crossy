//
//  ShareSheet.swift
//  Crossy
//
//  The system share sheet. CrossyUI reports the intent (the invite menu's "Share…"
//  row, ShareMenuPill's onShare; the analysis panel's "Share card", ShareCardModel)
//  as a plain closure and stays free of UIKit (AD-2: CrossyUI depends only on
//  CrossyStore/CrossyDesign); the app target owns UIActivityViewController, exactly as
//  it already owns the pasteboard write for Copy link.
//
//  Two payloads ride this one presenter. The invite share sends ShareInvite.url alone
//  (the same link the menu's QR sheet encodes and its Copy link row carries). The
//  completion share card (Wave 14.5) sends the SERVER-rendered card image plus the
//  minted share URL, with the puzzle title as the mail subject.
//

import SwiftUI
import UIKit

/// A thin UIViewControllerRepresentable around UIActivityViewController, presented via
/// `.sheet`. Nothing here decides the payload; it only presents the activity items the
/// composition root hands it.
struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    init(activityItems: [Any]) {
        self.activityItems = activityItems
    }

    /// The invite payload: the shareable URL alone.
    init(url: URL) {
        self.activityItems = [url]
    }

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

/// The completion share card's presented payload (Wave 14.5): the SERVER-rendered card
/// image and the minted share URL, the two activity items the sheet carries, plus the
/// optional puzzle title for the mail subject. Identifiable so `.sheet(item:)` re-presents
/// on a fresh mint rather than reusing a stale controller.
struct ShareCardPayload: Identifiable {
    let id = UUID()
    let image: UIImage
    let url: URL
    /// The puzzle title (GameView.puzzleTitle), used as the subject line where a share
    /// target has one (mail); nil when the document carried no title.
    let subject: String?
}

/// Supplies the share URL as an activity item and the puzzle title as the whole share's
/// subject (a plain [image, url] array cannot carry a subject; UIActivityItemSource can).
/// The image is a separate item, so a photo-shaped target takes the card and a link-shaped
/// one takes the URL.
final class ShareCardURLItemSource: NSObject, UIActivityItemSource {
    let url: URL
    let subject: String?

    init(url: URL, subject: String?) {
        self.url = url
        self.subject = subject
    }

    func activityViewControllerPlaceholderItem(_ controller: UIActivityViewController) -> Any {
        url
    }

    func activityViewController(
        _ controller: UIActivityViewController, itemForActivityType type: UIActivity.ActivityType?
    ) -> Any? {
        url
    }

    func activityViewController(
        _ controller: UIActivityViewController, subjectForActivityType type: UIActivity.ActivityType?
    ) -> String {
        subject ?? ""
    }
}

extension View {
    /// Presents the system share sheet for `url` whenever it is non-nil, clearing it on
    /// dismissal so a repeat tap on "Share…" re-presents rather than reusing a stale
    /// controller.
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

    /// Presents the completion share card sheet for a minted payload (the image plus the
    /// share URL, subject-tagged with the title). `.sheet(item:)` clears the payload on
    /// dismissal, so a canceled sheet leaves no stale controller and a fresh mint
    /// re-presents. Canceling the sheet is not a failure (the user simply chose not to
    /// share), so nothing is reported back on dismiss.
    func shareCardSheet(payload: Binding<ShareCardPayload?>) -> some View {
        sheet(item: payload) { card in
            ShareSheet(activityItems: [
                card.image,
                ShareCardURLItemSource(url: card.url, subject: card.subject),
            ])
        }
    }
}
