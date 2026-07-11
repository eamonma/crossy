// The share menu variant (-shareMenu, owner comparison 2026-07-11): the share
// pill as a system Menu label, so the open inherits the presentation system's
// own liquid-glass melt (WWDC25 session 323: menus flow out of the glass
// controls that present them). The third candidate beside the morph card (the
// law) and the goo prototypes (PillInflation): where those tween or swap OUR
// glass, this hands the whole flight to the system, the only party that can
// draw Mail's actual melt, the verdict the players pill already earned
// ("exactly what i want", RosterMenu). Nothing here runs unless the switch is
// flipped: the default is the card.
//
// The RosterMenu discipline, copied whole: the pill stands OUTSIDE any
// GlassEffectContainer (a Menu inside a container breaks its morph on 26.1,
// ecosystem finding); on 26 the label rides the system glass button style,
// below 26 the same Menu presents plainly from the pill's fallback material
// (the §4 one-fallback rule).
//
// The rows reuse the card's intents unchanged (AD-2: CrossyUI reports, the
// app target owns the pasteboard and UIActivityViewController). Copy link is
// primary; it forgoes the card's inline "Link copied", because a menu cannot
// restyle a row live, and that is fine. Share… hands to the system sheet.
// Show QR code stages a small SwiftUI sheet, because a menu cannot render a
// scannable code inline (the tile has a size floor); the sheet is pure
// SwiftUI, so the presentation stays wholly in CrossyUI. The titled section
// carries the invite code, so the read-aloud channel, the card's headline
// (EXPERIENCE.md §5), stays visible in the menu form too.

import CrossyDesign
import SwiftUI

/// The mechanism switch (the PillInflation pattern): a mutable static the app
/// target flips from the -shareMenu launch argument, so the owner compares
/// the card and the menu on device without a rebuild. The default is the
/// card, the shipped law; the menu is a comparison candidate awaiting an
/// owner ruling.
@MainActor
public enum ShareSurface {
    public enum Mechanism: Sendable, Equatable {
        case card
        case menu
    }

    public static var mechanism: Mechanism = .card
}

/// The menu's row set, pure and pinned (ShareMenuTests): the card's three
/// intents as menu rows, Copy link keeping the primary slot (the group chat
/// is the product's honest social space, docs/design/share-surface.md), then
/// the system's catch-all, then the QR's stage. The QR loses its zero-tap
/// rank here by the menu's nature: every channel costs one row.
enum ShareMenuList {
    enum Row: CaseIterable, Hashable, Sendable {
        case copyLink
        case share
        case showQR
    }

    static let rows: [Row] = [.copyLink, .share, .showQR]

    static func title(_ row: Row) -> String {
        switch row {
        case .copyLink: return "Copy link"
        case .share: return "Share…"
        case .showQR: return "Show QR code"
        }
    }

    static func symbol(_ row: Row) -> String {
        switch row {
        case .copyLink: return "link"
        case .share: return "square.and.arrow.up"
        case .showQR: return "qrcode"
        }
    }

    /// The titled section's text: the invite code verbatim, the read-aloud
    /// headline the card carries (the code's alphabet was designed to be
    /// spoken on a call), so the spoken channel survives the menu form.
    static func sectionHeader(code: String) -> String { code }
}

/// The share pill as a Menu label (the RosterMenu mechanism). Standing
/// OUTSIDE the cluster's GlassEffectContainer is the caller's law (RoomBar
/// places it beside the players pill); this view only mirrors the label
/// discipline: bare content sized for the system glass button on 26, the
/// full pill geometry on the fallback.
@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct ShareMenuPill: View {
    let ground: GridGround
    /// The read-aloud code (the titled section) and the link every row
    /// carries (the QR's payload; the copy and share intents already close
    /// over it in the composition root).
    let code: String
    let urlString: String
    /// Write the link to the pasteboard (the app target owns the platform
    /// clipboard, AD-2; the row only reports the intent).
    let onCopyLink: () -> Void
    /// Hand the link to the system share surface (UIActivityViewController
    /// in the app target; the row only reports the intent).
    let onShare: () -> Void

    /// The QR's stage (the kickTarget pattern next door in RosterMenu): a
    /// Menu row cannot present its own sheet (the menu dismisses on tap), so
    /// the row stages the intent and the sheet fires on the pill itself.
    @State private var qrPresented = false

    var body: some View {
        Group {
            #if os(iOS)
                if #available(iOS 26.0, *) {
                    // The verified recipe (RosterMenu): a plain label in the
                    // system's glass button style; the menu morphs out of the
                    // control. The pill's own ChromeGlassSurface would stand
                    // glass the presentation does not know.
                    menu.buttonStyle(.glass)
                } else {
                    fallbackMenu
                }
            #else
                fallbackMenu
            #endif
        }
        .accessibilityLabel(Text(verbatim: "Invite someone"))
        // Pure SwiftUI, so the QR's presentation stays in CrossyUI (AD-2:
        // no UIKit here; the pasteboard and activity sheet still ride the
        // app target through the closures above).
        .sheet(isPresented: $qrPresented) {
            ShareQRSheet(ground: ground, code: code, urlString: urlString)
        }
    }

    /// The system glass button pads and shapes its own capsule (RosterMenu's
    /// measured discipline, 26.5 sim): the bare glyph carries just enough
    /// frame that content plus the style's ~7 pt sides meets the register.
    private var menu: some View {
        Menu {
            rows
        } label: {
            glyph
                .frame(
                    width: ChromeLayout.pillHeight - 14,
                    height: ChromeLayout.pillHeight - 14)
        }
    }

    /// Below 26 (and the macOS test build) the same Menu presents the
    /// system's plain menu from the pill's fallback material: one mechanism,
    /// the §4 one-fallback rule. This branch draws its own circle, so the
    /// label carries the pill's full geometry (the share pill's own).
    private var fallbackMenu: some View {
        Menu {
            rows
        } label: {
            glyph
                .frame(width: ChromeLayout.pillHeight, height: ChromeLayout.pillHeight)
                .contentShape(Circle())
                .modifier(
                    ChromeGlassSurface(cornerRadius: ChromeLayout.pillCornerRadius))
        }
        .buttonStyle(.plain)
    }

    /// The share glyph exactly as the card variant's pill draws it: ink,
    /// never a color (§3), a hair of lift to center the boxed weight.
    private var glyph: some View {
        Image(systemName: "square.and.arrow.up")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .offset(y: -1)
    }

    // MARK: The rows (the pinned list, the code as the section's title)

    private var rows: some View {
        Section {
            ForEach(ShareMenuList.rows, id: \.self) { row in
                Button {
                    act(on: row)
                } label: {
                    Label(
                        ShareMenuList.title(row),
                        systemImage: ShareMenuList.symbol(row))
                }
            }
        } header: {
            // The read-aloud channel (the card's headline): the titled
            // section keeps the code visible while the menu stands.
            Text(verbatim: ShareMenuList.sectionHeader(code: code))
        }
    }

    private func act(on row: ShareMenuList.Row) {
        switch row {
        case .copyLink: onCopyLink()
        case .share: onShare()
        case .showQR: qrPresented = true
        }
    }
}

/// The QR sheet's pure geometry (the ShareCardLayout pattern): the detent
/// height is slot arithmetic, never font metrics. The tile is the card's own
/// (ShareCardLayout.qrTileSide with its quiet zone), so the sheet shows the
/// exact register the owner already judged on the card.
enum ShareQRSheetLayout {
    static let verticalPadding: CGFloat = 28
    static let codeHeight: CGFloat = 36
    static let gap: CGFloat = 20

    static var height: CGFloat {
        verticalPadding * 2 + codeHeight + gap + ShareCardLayout.qrTileSide
    }
}

/// The QR's stage for the menu variant: a small system sheet carrying the
/// same tile the share card shows (QRTile: the pure InviteQR matrix, ink on
/// Studio paper in BOTH grounds, quiet zone intact), the code as its headline
/// so the read-aloud channel rides along. You show your phone; the sheet is
/// the whole act.
@available(iOS 17.0, macOS 14.0, *)
struct ShareQRSheet: View {
    let ground: GridGround
    let code: String
    let urlString: String

    @State private var qr: QRMatrix?

    var body: some View {
        sheetBody
            #if os(iOS)
                .presentationDetents([.height(ShareQRSheetLayout.height)])
                .presentationDragIndicator(.visible)
            #endif
    }

    private var sheetBody: some View {
        VStack(spacing: 0) {
            Text(verbatim: code)
                .font(
                    .system(
                        size: ShareCardLayout.codeFontSize, weight: .semibold,
                        design: .monospaced)
                )
                .tracking(1.5)
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .frame(height: ShareQRSheetLayout.codeHeight)
            Color.clear.frame(height: ShareQRSheetLayout.gap)
            QRTile(matrix: qr)
        }
        .padding(.vertical, ShareQRSheetLayout.verticalPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(rgb: ground.tokens.canvas).ignoresSafeArea())
        // The matrix is pure math, computed once per link (SharePanel's
        // rule), never per frame.
        .task(id: urlString) { qr = InviteQR.matrix(for: urlString) }
    }
}
