// The share card (owner ask 2026-07-11): a dedicated round share pill in the
// room bar's cluster, inflating into the room's invite surface. One morph, the
// facts card's exact grammar (DESIGN.md §4, the Mail-button rule: the panel is
// the pill reshaped, top and trailing edges shared, growing leftward over the
// pill's own footprint), never a sheet, never a popover, never a Menu.
//
// The card's hierarchy, decided and argued in docs/design/share-surface.md:
//
//   ambient    the invite code as the headline (the read-aloud channel: the
//              code was designed to be spoken on a call, so the card displays
//              it large; COPYING the bare code stays on the facts card)
//   secondary  the QR, the card's body (the in-person channel: opening the
//              card IS the act: you show your phone, no further tap). Ink on
//              paper, dark-on-light in BOTH grounds, because a scannable code
//              is content, not chrome; the glass around it stays achromatic.
//   primary    Copy link, the first action row (the group-chat channel, the
//              product's honest social space; one tap, inline "Link copied"
//              feedback, the card stays open)
//   tertiary   Share…, the last row (everything else, the system's sheet; the
//              card closes because the system surface takes the stage)
//
// Copy derivations and geometry are pure and pinned (ShareCardTests); the QR
// matrix is vector-pinned against the web's own generator (InviteQRTests).

import CrossyDesign
import SwiftUI

/// The share card's pure geometry (the FactsCardLayout pattern): fixed-height
/// slots so the morph's open frame is arithmetic, never font metrics. The
/// panel height is one constant: the card always carries the code block, the
/// QR slot, and both action rows.
enum ShareCardLayout {
    static let panelMaxWidth: CGFloat = 300
    static let verticalPadding: CGFloat = 20
    static let contentInset: CGFloat = 20
    static let labelHeight: CGFloat = 16
    static let rowGap: CGFloat = 6
    /// The invite code as the headline: the read-aloud register.
    static let codeFontSize: CGFloat = 28
    static let codeHeight: CGFloat = 36
    static let detailHeight: CGFloat = 16
    /// The QR block: air above, then the paper tile (matrix plus quiet zone).
    static let qrAirAbove: CGFloat = 16
    static let qrTileSide: CGFloat = 164
    /// The tile's quiet zone (the spec asks for clear margin around the
    /// modules; the paper tile provides it, the matrix stays borderless).
    static let qrQuietZone: CGFloat = 12
    static let qrTileCornerRadius: CGFloat = 12
    /// The action rows (the facts card's operations grammar): air, a
    /// one-point hairline, air, fixed-height rows.
    static let operationsAirAbove: CGFloat = 12
    static let dividerHeight: CGFloat = 1
    static let operationsAirBelow: CGFloat = 4
    static let operationRowHeight: CGFloat = 40
    static let operationRows = 2

    static func panelHeight() -> CGFloat {
        verticalPadding * 2 + labelHeight + rowGap + codeHeight + rowGap + detailHeight
            + qrAirAbove + qrTileSide
            + operationsAirAbove + dividerHeight + operationsAirBelow
            + operationRowHeight * CGFloat(operationRows)
    }

    static func contentWidth(openWidth: CGFloat) -> CGFloat {
        max(0, openWidth - contentInset * 2)
    }

    /// The open card's width: the Mail-button rule held strictly. The
    /// trailing edge is the pill's own (the panel covers the spot it grew
    /// from), so the width is whatever fits between the bar's leading edge
    /// and the pill, capped at the card's maximum. Unlike the facts card's
    /// clamp, the trailing edge NEVER slides past the pill: the pills
    /// standing to the share pill's right stay unburied on narrow layouts.
    static func panelWidth(barMinX: CGFloat, pillMaxX: CGFloat) -> CGFloat {
        max(0, min(panelMaxWidth, pillMaxX - barMinX))
    }
}

/// The card's words, derived once as plain strings (the RoomFactsContent
/// pattern): the quiet label, the code as the headline, and the lexicon's
/// invite line (EXPERIENCE.md §5) as the detail.
public struct ShareCardContent: Equatable, Sendable {
    public let label: String
    public let code: String
    public let detail: String

    public static func make(code: String) -> ShareCardContent {
        ShareCardContent(
            label: "Invite",
            code: code,
            detail: "Anyone with this code can join")
    }
}

/// The QR as paper: the pure matrix drawn in a Canvas, dark modules on a light
/// tile in BOTH grounds (a scannable code is dark-on-light, the projector's
/// rule, apps/web PartyView), Studio's paper tokens fixed so Observatory never
/// darkens it. Module edges snap to pixels so adjacent modules tile without
/// seams. Content, not chrome: the glass around the tile stays achromatic.
@available(iOS 17.0, macOS 14.0, *)
struct QRTile: View {
    let matrix: QRMatrix?

    var body: some View {
        RoundedRectangle(
            cornerRadius: ShareCardLayout.qrTileCornerRadius, style: .continuous
        )
        .fill(Color(rgb: GridGround.studio.tokens.cell))
        .frame(width: ShareCardLayout.qrTileSide, height: ShareCardLayout.qrTileSide)
        .overlay {
            if let matrix {
                Canvas { context, size in
                    let count = matrix.size
                    guard count > 0 else { return }
                    let side = size.width
                    var path = Path()
                    for y in 0..<count {
                        for x in 0..<count where matrix.modules[y][x] {
                            let minX = (CGFloat(x) * side / CGFloat(count)).rounded()
                            let maxX = (CGFloat(x + 1) * side / CGFloat(count)).rounded()
                            let minY = (CGFloat(y) * side / CGFloat(count)).rounded()
                            let maxY = (CGFloat(y + 1) * side / CGFloat(count)).rounded()
                            path.addRect(
                                CGRect(
                                    x: minX, y: minY,
                                    width: maxX - minX, height: maxY - minY))
                        }
                    }
                    context.fill(path, with: .color(Color(rgb: GridGround.studio.tokens.ink)))
                }
                .padding(ShareCardLayout.qrQuietZone)
            }
        }
        .accessibilityLabel(Text(verbatim: "QR code to join this game"))
    }
}

/// The card as one morphing glass surface, the facts card's sibling: it reads
/// chrome.shareProgress, interpolates frame and radius from its GlassMorph,
/// and fades content in late as one block (the browser-list rule). Chrome
/// stays achromatic (§3); the QR is the one dark-on-paper element, content by
/// right. The inflation prototype's characters apply here exactly as on the
/// facts card (PillInflation, owner-gated).
@available(iOS 18.0, macOS 14.0, *)
@MainActor
struct SharePanel: View {
    let ground: GridGround
    let morph: GlassMorph
    let content: ShareCardContent
    /// The link every channel carries (ShareInvite.url, byte-matched to the
    /// web's buildShareUrl): the copy row's payload and the QR's data.
    let shareUrlString: String
    let chrome: RoomChromeModel
    /// Write the link to the pasteboard (the composition root owns the
    /// platform clipboard, AD-2; the row only reports the intent).
    let onCopyLink: () -> Void
    /// Hand the link to the system share surface (UIActivityViewController in
    /// the app target; the row only reports the intent).
    let onShare: () -> Void

    @State private var qr: QRMatrix?
    @State private var copied = false
    @State private var copyReset: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var quiet: Color { Color(rgb: ground.tokens.number) }

    var body: some View {
        surface
            // The matrix is pure math, computed once per link, never per
            // frame of the morph.
            .task(id: shareUrlString) { qr = InviteQR.matrix(for: shareUrlString) }
    }

    @ViewBuilder
    private var surface: some View {
        #if os(iOS)
            if #available(iOS 26.0, *), PillInflation.character == .metaball {
                MetaballPanelSurface(
                    morph: morph, progress: chrome.shareProgress,
                    reduceMotion: reduceMotion
                ) {
                    rows
                }
            } else {
                walkedSurface
            }
        #else
            walkedSurface
        #endif
    }

    /// The law's surface (and the overshoot candidate's, which only swaps the
    /// blend for the unclamped one): a single persistent glass whose frame and
    /// radius are functions of the walked progress, SP-i1's grammar.
    private var walkedSurface: some View {
        let progress = chrome.shareProgress
        let overshoots = PillInflation.walksWithOvershoot
        let frame =
            overshoots ? morph.frameUnclamped(at: progress) : morph.frame(at: progress)
        let radius =
            overshoots
            ? morph.cornerRadiusUnclamped(at: progress) : morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        return rows
            .opacity(GlassMorphContent.listOpacity(at: progress))
            .frame(width: frame.width, height: frame.height, alignment: .topLeading)
            .clipShape(shape)
            .modifier(ChromeGlassSurface(cornerRadius: radius))
            .contentShape(shape)
            // The inner blocker (DESIGN.md §4): only touches OUTSIDE a
            // transient dismiss it.
            .onTapGesture {}
            .position(x: frame.midX, y: frame.midY)
    }

    // MARK: The card's one content block (rigid rows against the OPEN width)

    private var rows: some View {
        let width = ShareCardLayout.contentWidth(openWidth: morph.open.width)
        return VStack(alignment: .leading, spacing: 0) {
            header(width: width)
            Color.clear.frame(height: ShareCardLayout.qrAirAbove)
            QRTile(matrix: qr)
                .frame(width: width)
            operationBlock(width: width)
        }
        .padding(.vertical, ShareCardLayout.verticalPadding)
        .padding(.horizontal, ShareCardLayout.contentInset)
    }

    /// The invite's spoken form: the code as the headline (the read-aloud
    /// alphabet was designed for a call), the lexicon's one line beneath it.
    private func header(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(verbatim: content.label)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(quiet)
                .lineLimit(1)
                .frame(
                    width: width, height: ShareCardLayout.labelHeight,
                    alignment: .leading)
            Color.clear.frame(height: ShareCardLayout.rowGap)
            Text(verbatim: content.code)
                .font(.system(
                    size: ShareCardLayout.codeFontSize, weight: .semibold,
                    design: .monospaced))
                .tracking(1.5)
                .foregroundStyle(ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(
                    width: width, height: ShareCardLayout.codeHeight,
                    alignment: .leading)
            Color.clear.frame(height: ShareCardLayout.rowGap)
            Text(verbatim: content.detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(quiet)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(
                    width: width, height: ShareCardLayout.detailHeight,
                    alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            Text(verbatim: "\(content.label), code \(content.code), \(content.detail)"))
    }

    // MARK: The action rows (primary first, the system's catch-all last)

    private func operationBlock(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Color.clear.frame(height: ShareCardLayout.operationsAirAbove)
            // The deterministic one-point hairline (the facts card's rule):
            // the panel's open height is pinned arithmetic.
            Rectangle()
                .fill(quiet.opacity(0.28))
                .frame(width: width, height: ShareCardLayout.dividerHeight)
            Color.clear.frame(height: ShareCardLayout.operationsAirBelow)
            operationRow(
                copied ? "Link copied" : "Copy link",
                systemImage: copied ? "checkmark" : "link",
                width: width, action: copyLink)
            operationRow(
                "Share…", systemImage: "square.and.arrow.up",
                width: width, action: share)
        }
    }

    /// Copy keeps the card open: the inline feedback answers the tap, and the
    /// card may still have work to do (showing the QR to the person beside
    /// you). Contrast the facts card's copy row, which closes because the
    /// card's job there ended with the copy.
    private func copyLink() {
        onCopyLink()
        copied = true
        copyReset?.cancel()
        copyReset = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.6))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }

    /// Share… closes the card: the system sheet takes the stage, and two
    /// share surfaces standing at once is one too many.
    private func share() {
        onShare()
        chrome.settleShare(open: false, animated: !reduceMotion)
    }

    private func operationRow(
        _ title: String, systemImage: String, width: CGFloat,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 15))
                    .frame(width: 22)
                Text(verbatim: title)
                    .font(.system(size: 15, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(ink)
            .frame(width: width, height: ShareCardLayout.operationRowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
