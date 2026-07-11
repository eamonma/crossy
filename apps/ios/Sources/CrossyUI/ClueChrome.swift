// The clue bar and the clue browser as ONE glass surface (owner ruling 2026-07-10;
// SP-i1's melt): the bar's frame and corner radius interpolate with gesture
// progress into the browser panel and pour back down. The gesture discipline is the
// point (SP-i1's prototype spasmed because implicit animations retargeted per
// tick): while the finger is down, geometry tracks the finger DIRECTLY through
// GlassMorph with animations suppressed; the one animation runs on release, settle
// up or pour back (GlassSettle). No glassEffectID swap anywhere (it snaps), no
// system sheet (SP-i5: grow-then-swap, and it dims the room inert; this panel is a
// custom overlay and the grid stays live behind it).
//
// The bar's row IS the browser's pinned row: it rides the surface's top edge
// through the whole morph, so the melt needs no crossfade of the bar itself, only
// the list fading in beneath (GlassMorphContent). Chrome emphasis is achromatic
// (DESIGN.md §3); the one color the surface ever carries is a presence glint, a
// person passing beneath.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
@MainActor
struct ClueChrome: View {
    let ground: GridGround
    let morph: GlassMorph
    let current: ClueEntry?
    let acrossRows: [ClueBrowserList.Row]
    let downRows: [ClueBrowserList.Row]
    /// Teammates whose cursors sit under the bar's clue right now (glint inputs).
    let glintMarks: [PresenceMark]
    let chrome: RoomChromeModel
    /// Transient panels yield to intent (DESIGN.md §4): any touch on the clue
    /// chrome is intent, so the room dismisses an open roster or stats card
    /// through this while the touch still lands here. Fired by the surface's
    /// simultaneous tap and by the melt drag's first tick.
    let onDismissTransients: () -> Void
    let onPrevious: () -> Void
    let onNext: () -> Void
    let onJump: (ClueEntry) -> Void

    @State private var dragBase: CGFloat = 0
    @State private var isDragActive = false
    /// The swipe-down dismissal (sheet grammar): true while a downward drag on
    /// the open panel owns the melt. The list freezes for the takeover's life
    /// so surface and scroll never fight over one finger.
    @State private var dismissTakeover = false
    @State private var dismissBase: CGFloat = 0
    /// The drag's translation at takeover, subtracted out so the scrub starts
    /// at the finger with no jump (the decision distance never moves glass).
    @State private var dismissBaseTranslation: CGFloat = 0
    /// Whether the clue list rests at its top (ScrollGeometry, iOS 18+): the
    /// system-sheet arbitration fact. Opens true because the list opens at its
    /// top; on the macOS test host (no scroll geometry below 15) it simply
    /// stays true, and no gesture runs headlessly anyway.
    @State private var listAtTop = true
    @State private var glint: GlintEvent?
    @State private var glintKey = 0
    @State private var glintSeen: Set<String> = []
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct GlintEvent: Equatable {
        let key: Int
        let color: CrossyDesign.RGBColor
    }

    var body: some View {
        let progress = chrome.meltProgress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        ZStack(alignment: .top) {
            browserList
                .opacity(GlassMorphContent.listOpacity(at: progress))
                .allowsHitTesting(progress >= 1)
                // The rest height IS the pinned row's height (the slot sizes
                // to ClueBarSizer), so the list clears the row at any wrap.
                .padding(.top, morph.rest.height)
            pinnedRow(open: progress > 0.5)
        }
        .frame(width: frame.width, height: frame.height, alignment: .top)
        .clipShape(shape)
        .modifier(ChromeGlassSurface(cornerRadius: radius))
        .overlay {
            if let glint, progress < 0.1 {
                GlintSweep(color: glint.color, reduceMotion: reduceMotion)
                    .clipShape(shape)
                    .allowsHitTesting(false)
            }
        }
        .contentShape(shape)
        // Simultaneous, so the chevrons, the toggle, and the browser's rows
        // all keep firing while an open roster or stats card yields (DESIGN.md
        // §4: the touch dismisses AND lands, never one or the other).
        .simultaneousGesture(TapGesture().onEnded { onDismissTransients() })
        // The swipe-down dismissal (owner ask 2026-07-10): simultaneous, so
        // the list's scroll and the rows' taps stay live until the takeover
        // rule fires; PanelDismiss then arbitrates exactly as system sheets
        // do (drag anywhere while the list rests at its top; otherwise the
        // list scrolls, and a pull that runs the list into its top hands the
        // surface over mid-gesture).
        .simultaneousGesture(dismissDrag)
        .position(x: frame.midX, y: frame.midY)
        .onChange(of: glintMarks.map(\.userId)) { _, ids in
            glintChanged(ids)
        }
        .task(id: glint?.key) {
            guard glint != nil else { return }
            try? await Task.sleep(for: .milliseconds(750))
            glint = nil
        }
    }

    // MARK: The pinned row (the bar)

    private func pinnedRow(open: Bool) -> some View {
        HStack(spacing: 0) {
            chevron("chevron.left", label: "Previous clue", action: onPrevious)
            Button(action: toggle) {
                ClueBarLabel(ground: ground, current: current)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: open ? "Hide clues" : "Show all clues"))
            chevron("chevron.right", label: "Next clue", action: onNext)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: ChromeLayout.barHeight)
        // The row owns its natural height even while the melting surface's
        // frame is still travelling toward it: a new line reveals as the bar
        // grows instead of reflowing against the old height.
        .fixedSize(horizontal: false, vertical: true)
        .contentShape(Rectangle())
        // High priority or the row's buttons win the touch and the melt never
        // scrubs (a plain .gesture ranks BELOW child gestures; owner device
        // finding 2026-07-10). The 12 pt floor keeps taps flowing to the
        // buttons, and the row alone carries the drag so the open browser's
        // list scrolls freely beneath it.
        .highPriorityGesture(meltDrag)
    }

    private func chevron(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color(rgb: ground.tokens.ink))
                .frame(width: ChromeLayout.clueChevronWidth, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }

    // MARK: The browser list

    private var browserList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                section(title: "Across", rows: acrossRows)
                section(title: "Down", rows: downRows)
            }
            .padding(.bottom, 14)
        }
        .scrollIndicators(.hidden)
        // The takeover freezes the list (isScrollEnabled off cancels a live
        // pan), so once the surface owns the finger the scroll never fights it.
        .scrollDisabled(dismissTakeover)
        .modifier(ListTopReporter(listAtTop: $listAtTop))
    }

    @ViewBuilder
    private func section(title: String, rows: [ClueBrowserList.Row]) -> some View {
        Text(verbatim: title.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Color(rgb: ground.tokens.number))
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 4)
        ForEach(rows) { row in
            browserRow(row)
        }
    }

    private func browserRow(_ row: ClueBrowserList.Row) -> some View {
        Button {
            onJump(row.clue)
            settle(open: false)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: "\(row.clue.number)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .frame(width: 26, alignment: .trailing)
                Text(verbatim: row.clue.text)
                    .font(.system(size: 14, weight: row.isCurrent ? .semibold : .regular))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                // Achromatic emphasis (DESIGN.md §3): the current word leans on
                // weight and a quiet ink wash, the crossing word on half of one.
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color(rgb: ground.tokens.ink).opacity(
                        row.isCurrent ? 0.10 : row.isCrossing ? 0.05 : 0))
                    .padding(.horizontal, 8)
            )
            .opacity(row.isDimmed ? 0.4 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(row.clue.tag), \(row.clue.text)"))
    }

    // MARK: The gesture (the discipline)

    private var meltDrag: some Gesture {
        // Global space, and nothing else: the default .local space belongs to
        // the very view this drag resizes, so a still finger reads a changing
        // translation as the surface grows and the melt oscillates (the spasm
        // the owner hit on device, 2026-07-10; distinct from SP-i1's animation
        // retargeting). Only translation deltas and velocity are consumed, so
        // global is safe under any safe-area or layout inset.
        DragGesture(minimumDistance: 12, coordinateSpace: .global)
            .onChanged { value in
                if !isDragActive {
                    isDragActive = true
                    // A finger catching a settle mid-flight owns progress from
                    // wherever the surface actually is.
                    chrome.meltTouched()
                    dragBase = chrome.meltProgress
                    chrome.isMeltDragging = true
                    // The drag's first tick is intent (DESIGN.md §4): an open
                    // roster or stats card pours back as the finger takes the
                    // surface, so panels stay mutually exclusive.
                    onDismissTransients()
                }
                // Finger down: geometry tracks the finger directly. Animations are
                // suppressed on the interpolating property, so nothing can retarget
                // mid-gesture (the SP-i1 failure mode).
                var transaction = Transaction()
                transaction.animation = nil
                withTransaction(transaction) {
                    chrome.meltProgress = morph.progress(
                        draggedBy: value.translation.height, from: dragBase)
                }
            }
            .onEnded { value in
                isDragActive = false
                chrome.isMeltDragging = false
                settle(
                    open: GlassSettle.settlesOpen(
                        progress: chrome.meltProgress,
                        upwardVelocity: -value.velocity.height))
            }
    }

    /// The swipe-down dismissal's drag (owner ask 2026-07-10, the sheet
    /// grammar). Same disciplines as the melt drag above: the room's named
    /// space, never .local (this drag resizes the very surface it rides, and a
    /// local-space still finger would read the moving frame as translation and
    /// spasm; the named ancestor never resizes, and it is the space the chrome
    /// frames are reported in, so the start location classifies against the
    /// pinned row directly); raw writes in a nil-animation transaction while
    /// the finger is down (SP-i1); the one animation on release. The takeover
    /// rule itself is pure (PanelDismiss): only a fully open panel, only below
    /// the pinned row (the row keeps its own bidirectional drag), only while
    /// the list rests at its top, only pulling down. Until it fires the drag
    /// is a bystander, so the list scrolls exactly as before, and a pull that
    /// runs the list into its top takes the surface mid-gesture, which is how
    /// system sheets hand off.
    private var dismissDrag: some Gesture {
        DragGesture(
            minimumDistance: PanelDismiss.takeoverDistance,
            coordinateSpace: .named(ChromeLayout.roomSpace)
        )
        .onChanged { value in
            if !dismissTakeover {
                guard
                    PanelDismiss.takes(
                        progress: chrome.meltProgress,
                        startY: value.startLocation.y,
                        headerMaxY: morph.open.minY + morph.rest.height,
                        listAtTop: listAtTop,
                        translation: value.translation)
                else { return }
                dismissTakeover = true
                chrome.meltTouched()
                chrome.isMeltDragging = true
                dismissBase = chrome.meltProgress
                dismissBaseTranslation = value.translation.height
                // The takeover is intent (DESIGN.md §4): any open card pours
                // back as the finger takes the surface.
                onDismissTransients()
            }
            var transaction = Transaction()
            transaction.animation = nil
            withTransaction(transaction) {
                chrome.meltProgress = morph.progress(
                    draggedBy: value.translation.height - dismissBaseTranslation,
                    from: dismissBase)
            }
        }
        .onEnded { value in
            guard dismissTakeover else { return }
            dismissTakeover = false
            chrome.isMeltDragging = false
            settle(
                open: GlassSettle.settlesOpen(
                    progress: chrome.meltProgress,
                    upwardVelocity: -value.velocity.height))
        }
    }

    /// The one animation, on release or tap: settle up or pour back, the model's
    /// hand-stepped walk so progress stays the single geometry truth (no SwiftUI
    /// animation ever touches it). Reduce Motion takes the crossfade-not-movement
    /// rule (DESIGN.md §7) to its limit for a geometry morph: a cut.
    private func settle(open: Bool) {
        chrome.settleMelt(open: open, animated: !reduceMotion)
    }

    private func toggle() {
        settle(open: chrome.meltProgress < 0.5)
    }

    // MARK: The glint

    /// A teammate's cursor slid under the bar's clue: one brief specular in their
    /// color (DESIGN.md §4). Fires on entry only, so a parked cursor glints once.
    private func glintChanged(_ ids: [String]) {
        let now = Set(ids)
        let entered = now.subtracting(glintSeen)
        glintSeen = now
        guard let comer = entered.sorted().first,
            let mark = glintMarks.first(where: { $0.userId == comer })
        else { return }
        glintKey += 1
        glint = GlintEvent(key: glintKey, color: mark.color)
    }
}

// MARK: - The list's resting fact

/// Reports whether the clue list rests at its top, the swipe-down arbitration
/// fact (PanelDismiss). ScrollGeometry arrived with iOS 18/macOS 15; below
/// that floor the fact holds its initial value, which only the macOS 14 test
/// host ever sees (SolveScreen itself is iOS 18+), and no gesture runs
/// headlessly there.
@available(iOS 17.0, macOS 14.0, *)
private struct ListTopReporter: ViewModifier {
    @Binding var listAtTop: Bool

    func body(content: Content) -> some View {
        if #available(iOS 18.0, macOS 15.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y <= geometry.contentInsets.top + 1
            } action: { _, atTop in
                listAtTop = atTop
            }
        } else {
            content
        }
    }
}

// MARK: - The bar's words (one dress, worn twice)

/// The clue bar's words: the tag riding the clue's first line, the clue
/// wrapping to at most three lines (owner ruling 2026-07-10, the ClueFitLab
/// verdict: the bar breathes rather than elides; past the cap the ellipsis
/// returns for the pathological clue on the narrowest phone). One view worn
/// by both the pinned row and the layout slot's twin (ClueBarSizer), so the
/// slot's height and the row's height cannot diverge.
@available(iOS 17.0, macOS 14.0, *)
struct ClueBarLabel: View {
    let ground: GridGround
    let current: ClueEntry?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let current {
                Text(verbatim: current.tag)
                    .font(.system(size: 12, weight: .semibold))
                    .tracking(0.8)
                    .monospacedDigit()
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                Text(verbatim: current.text)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.ink))
                    .lineLimit(ChromeLayout.clueLineCap)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text(verbatim: "No word here")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(rgb: ground.tokens.number))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, ChromeLayout.clueAirPadding)
    }
}

/// The clue bar's layout twin: the same words at the same insets, invisible
/// and inert, floating where the bar rests (the full-bleed ruling: the slot
/// no longer sits in the room's layout, it rides the board's bottom edge, so
/// a wrapping clue grows the slot upward and the board never moves). The slot
/// takes exactly the height the pinned row will render at, and the melting
/// surface still only borrows the geometry (SolveScreen's slot comment).
/// Hidden, so it draws nothing and reads to no one; the real words live on
/// the glass.
@available(iOS 17.0, macOS 14.0, *)
struct ClueBarSizer: View {
    let ground: GridGround
    let current: ClueEntry?

    var body: some View {
        ClueBarLabel(ground: ground, current: current)
            .padding(.horizontal, ChromeLayout.clueChevronWidth)
            .padding(.horizontal, 10)
            .frame(minHeight: ChromeLayout.barHeight)
            .hidden()
            .accessibilityHidden(true)
    }
}

// MARK: - The specular sweep

/// The glint: a soft band of the player's color crossing the glass once. Subtle
/// and cheap: one gradient, one animation, gone in under a second. Reduce Motion
/// swaps the sweep for a still fade (DESIGN.md §7).
@available(iOS 17.0, macOS 14.0, *)
private struct GlintSweep: View {
    let color: CrossyDesign.RGBColor
    let reduceMotion: Bool

    @State private var phase: CGFloat = -0.45
    @State private var still: Double = 0

    var body: some View {
        GeometryReader { proxy in
            if reduceMotion {
                Color(rgb: color)
                    .opacity(still)
                    .onAppear {
                        withAnimation(.easeIn(duration: 0.2)) { still = 0.16 }
                        withAnimation(.easeOut(duration: 0.45).delay(0.25)) { still = 0 }
                    }
            } else {
                LinearGradient(
                    colors: [
                        Color(rgb: color).opacity(0),
                        Color(rgb: color).opacity(0.30),
                        Color(rgb: color).opacity(0),
                    ],
                    startPoint: .leading, endPoint: .trailing
                )
                .frame(width: proxy.size.width * 0.45)
                .offset(x: proxy.size.width * phase)
                .onAppear {
                    withAnimation(.easeOut(duration: 0.65)) { phase = 1.0 }
                }
            }
        }
    }
}
