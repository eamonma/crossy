// The completion share card (Wave 14.5): the analysis surface's "Share card"
// affordance. Tapping it mints the game's public share link (POST /games/{id}/share),
// fetches the SERVER-rendered card PNG for the current ground, and hands the system
// share sheet the image plus the share URL. The server card is the single visual
// source of truth (the same @crossy/share-card builder the web uses), so there is no
// native card renderer here (design/post-game/SHARE.md).
//
// AD-2 boundary: CrossyUI owns the affordance, the pure card-URL construction, and the
// fetch state machine, and reports the intent as a closure. The app target owns the
// REST mint, the URLSession PNG fetch, the UIImage, and the UIActivityViewController
// (ShareSheet), exactly as the invite share's Copy link / Share… rows already split
// (ShareMenuPill). This keeps CrossyUI importing only CrossyStore + CrossyDesign and
// free of UIKit.

import CrossyDesign
import Foundation
import Observation
import SwiftUI

/// The card PNG URL, built purely from the minted share URL and the current ground
/// (pinned in ShareCardTests). The contract (a sibling wave adds the server params):
/// `{shareUrl}/card.png?variant=portrait&ground={light|dark}`, where `shareUrl` is the
/// minted URL verbatim (e.g. `https://crossy.ing/s/{token}`). The endpoint is public
/// (no auth header) and immutable-cached: a completed game's card never changes.
public enum ShareCardLink {
    /// The `variant` the native share always requests: the portrait card, the shape a
    /// phone share sheet and a group-chat unfurl want (the web's own default is the
    /// landscape OpenGraph card; the app asks for portrait explicitly).
    public static let variant = "portrait"

    /// The ground query value: `light` on the Studio ground, `dark` on Observatory
    /// (the card is rendered to match the app's current appearance, ID-3). Keyed off
    /// `GridGround.isDark` so the two grounds map through one bit, never a code fork.
    public static func groundParameter(_ ground: GridGround) -> String {
        ground.isDark ? "dark" : "light"
    }

    /// The suggested filename for the PNG, used if a caller writes the image to a temp
    /// file before sharing (the system sheet otherwise names a bare UIImage generically).
    public static let filename = "crossy-card.png"

    /// The card PNG URL for a minted share URL on a given ground, or nil if the share
    /// URL cannot carry a path and query (it always can for a well-formed
    /// `https://.../s/{token}`; nil is the honest degrade rather than a force-unwrap).
    /// The card path is `card.png` appended to the share URL (`/s/{token}/card.png`),
    /// then the two query params. The token alphabet is URL-safe, so appending never
    /// needs escaping.
    public static func cardURL(shareUrl: URL, ground: GridGround) -> URL? {
        let withCard = shareUrl.appendingPathComponent("card.png")
        guard var components = URLComponents(url: withCard, resolvingAgainstBaseURL: false)
        else { return nil }
        components.queryItems = [
            URLQueryItem(name: "variant", value: variant),
            URLQueryItem(name: "ground", value: groundParameter(ground)),
        ]
        return components.url
    }
}

/// The share card affordance's fetch state machine (pinned in ShareCardTests): the thin
/// observable the analysis panel's button reads. The whole act (mint + PNG fetch +
/// UIImage + present) is injected as one async closure off the composition root, which
/// owns the REST ring and UIKit (AD-2); this type only sequences the button's states.
///
/// There is deliberately no separate "confirmed" phase: success opens the system share
/// sheet immediately, so the sheet IS the confirmation, and a checkmark behind it would
/// never be seen. Success returns the button to idle; a failure (mint 4xx, PNG fetch,
/// offline) resolves to a quiet, non-scolding `failed` the button shows as a re-tappable
/// retry, matching how the analysis fetch handles its own failure (AnalysisModel).
@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class ShareCardModel {
    /// The button's three states: at rest, minting/fetching, or a quiet failure that a
    /// re-tap retries.
    public enum Phase: Equatable, Sendable {
        case idle
        case busy
        case failed
    }

    public private(set) var phase: Phase = .idle

    @ObservationIgnored private var task: Task<Void, Never>?

    public init() {}

    /// Kick the share. `prepare` mints, fetches the PNG, builds the image, and presents
    /// the sheet (all app-target, AD-2), returning true once the sheet has the card in
    /// hand and false on any failure. A tap while already busy is ignored, so a double
    /// tap never mints twice; a re-tap after a failure retries from idle. Cancels any
    /// prior in-flight attempt so a stale result never overwrites a newer one.
    public func share(_ prepare: @MainActor @escaping () async -> Bool) {
        guard phase != .busy else { return }
        phase = .busy
        task?.cancel()
        task = Task { @MainActor [weak self] in
            let ok = await prepare()
            guard !Task.isCancelled else { return }
            self?.phase = ok ? .idle : .failed
        }
    }

    /// Clear a quiet failure back to idle (the surface calls this when it is re-entered,
    /// so a stale "try again" never greets a fresh open).
    public func clearFailure() {
        if phase == .failed { phase = .idle }
    }
}

/// The "Share card" affordance in the analysis header (Wave 14.5): a quiet capsule in
/// the panel's hairline vocabulary (the stat trio's stroke, the legend chip's capsule),
/// achromatic chrome (DESIGN.md §3), reporting its tap as a closure. Busy shows a
/// spinner and disables; a failure shows a re-tappable "Try again". Distinct from the
/// invite share (ShareMenuPill in RoomBar), which is untouched.
@available(iOS 17.0, macOS 14.0, *)
struct ShareCardButton: View {
    let ground: GridGround
    let phase: ShareCardModel.Phase
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                glyph
                Text(verbatim: label)
                    .font(.system(size: 11, weight: .semibold))
                    .tracking(0.6)
            }
            .foregroundStyle(Color(rgb: textToken))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .overlay(
                Capsule(style: .continuous)
                    .stroke(Color(rgb: ground.tokens.number).opacity(0.22), lineWidth: 1))
            .contentShape(Capsule(style: .continuous))
            .opacity(phase == .busy ? 0.7 : 1)
        }
        .buttonStyle(.plain)
        .disabled(phase == .busy)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityHint(
            Text(verbatim: "Creates a shareable image of this solve and opens the share sheet."))
    }

    @ViewBuilder
    private var glyph: some View {
        switch phase {
        case .idle:
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 11, weight: .semibold))
        case .busy:
            ProgressView()
                .controlSize(.mini)
        case .failed:
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
    }

    private var label: String {
        switch phase {
        case .idle: return "Share card"
        case .busy: return "Preparing\u{2026}"
        case .failed: return "Try again"
        }
    }

    /// Ink for the rest and busy labels, the muted number token for the quiet failure
    /// (non-scolding: it never turns red or shouts, DESIGN.md §3 keeps chrome achromatic).
    private var textToken: CrossyDesign.RGBColor {
        phase == .failed ? ground.tokens.number : ground.tokens.ink
    }

    private var accessibilityLabel: String {
        switch phase {
        case .idle: return "Share card"
        case .busy: return "Preparing the share card"
        case .failed: return "Couldn\u{2019}t create the card. Try again."
        }
    }
}
