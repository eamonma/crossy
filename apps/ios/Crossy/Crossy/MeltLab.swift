//
//  MeltLab.swift
//  Crossy
//
//  The drag-scrubbed melt's recheck rig, round one. MorphLab settled the
//  tap-opened pill panels (the Mail mechanism won; the roster rides a system
//  Menu). This rig works the other half of the morph grammar, the melt, where
//  SP-i1's law governs (DESIGN.md section 4): ONE persistent glass surface,
//  the finger writes raw progress with animations suppressed, the one
//  animation runs on release. The room's real melt is ClueChrome and nothing
//  here touches it; the question is what the surface WEARS mid-scrub, so one
//  fake clue bar melts into one fake browser and a switcher re-dresses the
//  same geometry. Re-scrubbing under each treatment is the point: honest A/B
//  by finger.
//
//  The reference timings are the Mail frame study (MorphLab's header, 60 fps):
//  ~380 ms open, ~180 ms close, content gone by 133 ms, content resolving
//  through blur at 250 ms, soft mid-flight edges from two shapes' fields
//  merging. The treatments:
//
//  Control  production exactly: symmetric settle on the chrome spring's
//           critically damped walk (ChromeSettleCurve's math, replicated
//           here), list fading in per GlassMorphContent (start 0.55).
//  A        Mail's timing asymmetry: the open settles at ~0.38 s, the pour
//           back at ~0.18 s. Only the walk's response changes.
//  B        content resolves through blur on the way up (Mail at 250 ms); on
//           the pour back the list is gone almost immediately (Mail's content
//           vanishes by 133 ms, before the glass has meaningfully moved). The
//           pinned row stays crisp: it is alive at both ends.
//  C        interactive glass while the surface is at rest, plain regular
//           once scrubbing begins. Two things to watch on device, noted at
//           the treatment below.
//  D        the exploratory one: TWO persistent shapes in one container at
//           spacing 40, above the metaball fuse threshold (SP-i1's caution,
//           DESIGN.md section 10: spacing 24 melted the deck's keys into wavy
//           rows), so the field fuse the Mail frames proved unreachable by
//           tweening one crisp rect happens under the finger. It may look
//           terrible; the device rules, not us.
//
//  Verdicts come from the device only; the simulator renders the glass blend
//  linearly and lies about goo.
//
//  Evidence only: nothing in the room composes through this screen.
//

import CrossyUI
import Observation
import QuartzCore
import SwiftUI

// MARK: - The treatments

private enum MeltVariant: String, CaseIterable, Identifiable {
    case control = "Control"
    case asymmetric = "A"
    case blurResolve = "B"
    case interactive = "C"
    case goo = "D"

    var id: String { rawValue }

    var caption: String {
        switch self {
        case .control: return "Control — production: symmetric settle, list fades in at 0.55"
        case .asymmetric: return "A — Mail's asymmetry: open 0.38 s, pour back 0.18 s"
        case .blurResolve: return "B — list resolves through blur; the pour back drops it at once"
        case .interactive: return "C — interactive glass at rest, regular once scrubbing"
        case .goo: return "D — two shapes, container blend at spacing 40 (the goo)"
        }
    }

    /// The settle walk's response by direction. Control (and B, C, D) keep the
    /// production chrome response both ways (Motion.Springs.chromeResponse,
    /// 0.30 s, replicated so CrossyUI stays untouched). A takes Mail's
    /// measured asymmetry and changes nothing else.
    func settleResponse(open: Bool) -> TimeInterval {
        switch self {
        case .asymmetric: return open ? 0.38 : 0.18
        default: return 0.30
        }
    }
}

/// ChromeLayout's numbers, replicated: the lab imports only CrossyUI's public
/// morph math, and the layout constants are internal there.
private enum MeltLabLayout {
    static let barHeight: CGFloat = 52
    static let inset: CGFloat = 12
    static var barCornerRadius: CGFloat { barHeight / 2 }
    static let panelCornerRadius: CGFloat = 24
    /// The open panel's top edge, below the switcher, so treatments swap while
    /// the browser stands.
    static let openTop: CGFloat = 96
}

// MARK: - The lab

struct MeltLab: View {
    @State private var variant: MeltVariant

    /// Scripted entry (the presentBrowser precedent in RoomChromeModel:
    /// screenshots land a state with no gesture): `-meltLabVariant D` starts
    /// the switcher on a treatment, `-meltLabProgress 0.55` parks the surface
    /// mid-melt so a screenshot can show intermediate geometry. Feel verdicts
    /// still come from a finger; these exist for scripts only.
    init() {
        let arguments = ProcessInfo.processInfo.arguments
        var start: MeltVariant = .control
        if let flag = arguments.firstIndex(of: "-meltLabVariant"),
            arguments.indices.contains(flag + 1),
            let scripted = MeltVariant(rawValue: arguments[flag + 1])
        {
            start = scripted
        }
        _variant = State(initialValue: start)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.96, green: 0.95, blue: 0.93).ignoresSafeArea()

            VStack(alignment: .leading, spacing: 12) {
                ForEach(0..<20, id: \.self) { row in
                    Text(verbatim: "Across \(row + 1) — the quiet between clues")
                        .font(.system(size: 15))
                        .foregroundStyle(.black.opacity(0.72))
                }
            }
            .padding(20)
            .padding(.top, 76)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if #available(iOS 26.0, *) {
                MeltStage(variant: variant)
            } else {
                Text(verbatim: "needs iOS 26 glass")
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 24)
            }

            switcher
        }
    }

    /// Plain achromatic buttons on paper, deliberately NOT glass: the switcher
    /// must never join the experiment it steers.
    private var switcher: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                ForEach(MeltVariant.allCases) { candidate in
                    Button {
                        variant = candidate
                    } label: {
                        Text(verbatim: candidate.rawValue)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(
                                variant == candidate
                                    ? Color(red: 0.96, green: 0.95, blue: 0.93)
                                    : .black.opacity(0.75)
                            )
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .background(
                                Capsule().fill(
                                    variant == candidate
                                        ? Color.black.opacity(0.8)
                                        : Color.black.opacity(0.06))
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
            Text(verbatim: variant.caption)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.top, 8)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - The one surface

@available(iOS 26.0, *)
private struct MeltStage: View {
    let variant: MeltVariant

    @State private var model = MeltLabModel()
    @State private var dragBase: CGFloat = 0
    @State private var isDragActive = false
    @State private var clueIndex = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let rest = CGRect(
                x: MeltLabLayout.inset,
                y: size.height - MeltLabLayout.barHeight,
                width: size.width - 2 * MeltLabLayout.inset,
                height: MeltLabLayout.barHeight)
            let open = CGRect(
                x: MeltLabLayout.inset,
                y: MeltLabLayout.openTop,
                width: size.width - 2 * MeltLabLayout.inset,
                height: size.height - MeltLabLayout.openTop)
            let morph = GlassMorph(
                rest: rest, open: open,
                restCornerRadius: MeltLabLayout.barCornerRadius,
                openCornerRadius: MeltLabLayout.panelCornerRadius)

            // Switching treatments re-dresses the SAME surface state: progress
            // survives the swap, so an open browser can be compared open. The
            // swap itself is a cut (D changes structure, so glass
            // re-instantiates); the rig compares scrubs, never switches.
            if variant == .goo {
                gooSurface(morph: morph)
            } else {
                singleSurface(morph: morph)
            }
        }
        .task {
            // The scripted mid-melt park (screenshots only; see MeltLab.init).
            let arguments = ProcessInfo.processInfo.arguments
            if let flag = arguments.firstIndex(of: "-meltLabProgress"),
                arguments.indices.contains(flag + 1),
                let parked = Double(arguments[flag + 1])
            {
                model.progress = CGFloat(min(max(parked, 0), 1))
                model.direction = .opening
            }
        }
    }

    // MARK: Control, A, B, C (one persistent surface, ClueChrome's shape)

    @ViewBuilder
    private func singleSurface(morph: GlassMorph) -> some View {
        let progress = model.progress
        let frame = morph.frame(at: progress)
        let radius = morph.cornerRadius(at: progress)
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)

        ZStack(alignment: .top) {
            browserList(bottomInset: 14)
                .opacity(listOpacity(at: progress))
                .blur(radius: listBlur(at: progress))
                .allowsHitTesting(progress >= 1)
                .padding(.top, MeltLabLayout.barHeight)
            pinnedRow(morph: morph)
        }
        .frame(width: frame.width, height: frame.height, alignment: .top)
        .clipShape(shape)
        .glassEffect(surfaceGlass, in: shape)
        .contentShape(shape)
        .position(x: frame.midX, y: frame.midY)
    }

    /// C's treatment: interactive glass while at rest, plain regular the
    /// moment scrubbing begins or the surface stands open. Two honest watch
    /// items for the device run:
    /// - the known ecosystem bug where interactive glass responds with a
    ///   capsule regardless of the declared rect. At rest this bar IS a
    ///   capsule (radius is half the height), so the bug cannot show in the
    ///   resting shape; if it reproduces it shows in the press response's
    ///   highlight, or in any frame where interactive lingers past rest.
    /// - whether the system's press response (scale, glint) fights the
    ///   finger-owned scrub geometry in the frames between touch down and the
    ///   swap to regular, and whether the swap itself pops the material.
    private var surfaceGlass: Glass {
        if variant == .interactive, model.progress < 0.001, !model.isDragging {
            return .regular.interactive()
        }
        return .regular
    }

    // MARK: B's content math (the Mail frame study, mapped onto progress)

    /// B holds direction state because Mail's asymmetry is temporal and a
    /// scrubbed axis is not: opacity is a function of progress AND heading.
    /// The seam is honest: flipping direction mid-scrub pops the list between
    /// ramps, because Mail never scrubs. Constants, read off the frames:
    /// content visible-but-blurred from 0.30 of the open (Mail ~mid-flight),
    /// fully opaque by 0.65 (~250 ms of 380), blur gone by 0.95 (~300 ms,
    /// near-crisp before arrival); on the pour back the list is gone by the
    /// time progress dips to 0.85 (content out before the glass has
    /// meaningfully moved).
    private static let resolveFadeStart: CGFloat = 0.30
    private static let resolveFadeFull: CGFloat = 0.65
    private static let resolveBlurMax: CGFloat = 18
    private static let resolveBlurGone: CGFloat = 0.95
    private static let pourFadeGone: CGFloat = 0.85

    private func listOpacity(at progress: CGFloat) -> CGFloat {
        guard variant == .blurResolve else {
            return GlassMorphContent.listOpacity(at: progress)
        }
        switch model.direction {
        case .opening:
            guard progress > Self.resolveFadeStart else { return 0 }
            return min(
                (progress - Self.resolveFadeStart)
                    / (Self.resolveFadeFull - Self.resolveFadeStart), 1)
        case .closing:
            return min(max((progress - Self.pourFadeGone) / (1 - Self.pourFadeGone), 0), 1)
        }
    }

    private func listBlur(at progress: CGFloat) -> CGFloat {
        guard variant == .blurResolve else { return 0 }
        let resolved = min(
            max(
                (progress - Self.resolveFadeStart)
                    / (Self.resolveBlurGone - Self.resolveFadeStart), 0), 1)
        return Self.resolveBlurMax * (1 - resolved)
    }

    // MARK: D, the container-blend goo (two persistent shapes)

    /// Spacing ABOVE the metaball fuse threshold on purpose. SP-i1's caution
    /// (DESIGN.md section 10): container spacing fuses adjacent glass, 24
    /// melted the deck's keys into wavy rows, and the pill cluster holds 6 to
    /// stay discrete. 40 is the deliberate opposite: the two shapes' fields
    /// merge, which is the whole experiment.
    private static let gooBlend: CGFloat = 40

    /// The egg's journey, keyed to Mail's frames: the panel shape rises out of
    /// the bar as a featureless egg (133 to 167 ms), hovers with a stretched
    /// neck, then inflates into the panel and re-fuses (250 to 300 ms). The
    /// detach leg ends at this progress, so the fuse moment sits mid-scrub and
    /// reads back and forth under the finger.
    private static let gooDetachEnd: CGFloat = 0.45

    /// The egg's hover gap above the bar: inside the 40 pt blend radius, so at
    /// the apex the neck holds instead of snapping and the finger owns it.
    private static let gooHoverGap: CGFloat = 30

    @ViewBuilder
    private func gooSurface(morph: GlassMorph) -> some View {
        let progress = model.progress
        let rest = morph.rest
        let open = morph.open

        // Both shapes exist at all times (no insertion, no removal, no
        // glassEffectID swap: SP-i1, the swap snaps). At rest the nascent
        // panel hides inside the bar; at open it overlaps the bar and the
        // container fuses them into one reading. The legs are two GlassMorph
        // values, so the real math drives every edge.
        let k0 = rest.insetBy(dx: 10, dy: 8)
        let eggSize = CGSize(width: 88, height: 48)
        let k1 = CGRect(
            x: rest.midX - eggSize.width / 2,
            y: rest.minY - Self.gooHoverGap - eggSize.height,
            width: eggSize.width, height: eggSize.height)
        let eggLeg = GlassMorph(
            rest: k0, open: k1,
            restCornerRadius: k0.height / 2, openCornerRadius: eggSize.height / 2)
        let inflateLeg = GlassMorph(
            rest: k1, open: open,
            restCornerRadius: eggSize.height / 2,
            openCornerRadius: MeltLabLayout.panelCornerRadius)

        let detached = progress < Self.gooDetachEnd
        let leg = detached ? eggLeg : inflateLeg
        let legProgress =
            detached
            ? progress / Self.gooDetachEnd
            : (progress - Self.gooDetachEnd) / (1 - Self.gooDetachEnd)
        let panelFrame = leg.frame(at: legProgress)
        let panelRadius = leg.cornerRadius(at: legProgress)

        ZStack {
            GlassEffectContainer(spacing: Self.gooBlend) {
                ZStack {
                    Color.clear
                        .frame(width: panelFrame.width, height: panelFrame.height)
                        .glassEffect(
                            .regular,
                            in: .rect(cornerRadius: panelRadius, style: .continuous)
                        )
                        .position(x: panelFrame.midX, y: panelFrame.midY)
                    // The bar stands: in D the pinned row stays at the bottom
                    // and the open browser reads bottom-pinned, unlike the
                    // production melt where the row rides the top edge. That
                    // asymmetry is the price of two persistent shapes; noted
                    // so the device verdict weighs it.
                    pinnedRow(morph: morph)
                        .frame(width: rest.width, height: rest.height)
                        .glassEffect(
                            .regular,
                            in: .rect(
                                cornerRadius: morph.restCornerRadius, style: .continuous)
                        )
                        .position(x: rest.midX, y: rest.midY)
                }
            }
            // The list rides the panel shape: laid out at the open rect so it
            // never reflows mid-scrub, masked to the panel's current shape,
            // fading in late per production's ramp.
            browserList(bottomInset: MeltLabLayout.barHeight + 14)
                .frame(width: open.width, height: open.height, alignment: .top)
                .opacity(GlassMorphContent.listOpacity(at: progress))
                .allowsHitTesting(progress >= 1)
                .position(x: open.midX, y: open.midY)
                .mask {
                    RoundedRectangle(cornerRadius: panelRadius, style: .continuous)
                        .frame(width: panelFrame.width, height: panelFrame.height)
                        .position(x: panelFrame.midX, y: panelFrame.midY)
                }
        }
    }

    // MARK: The pinned row (alive at both ends, crisp under every treatment)

    private func pinnedRow(morph: GlassMorph) -> some View {
        HStack(spacing: 0) {
            chevron("chevron.left") {
                clueIndex = (clueIndex + fakeClues.count - 1) % fakeClues.count
            }
            Button {
                settle(open: model.progress < 0.5)
            } label: {
                HStack(spacing: 8) {
                    Text(verbatim: fakeClues[clueIndex].tag)
                        .font(.system(size: 12, weight: .semibold))
                        .tracking(0.8)
                        .monospacedDigit()
                        .foregroundStyle(.black.opacity(0.45))
                    Text(verbatim: fakeClues[clueIndex].text)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.black.opacity(0.85))
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            chevron("chevron.right") {
                clueIndex = (clueIndex + 1) % fakeClues.count
            }
        }
        .padding(.horizontal, 10)
        .frame(height: MeltLabLayout.barHeight)
        .contentShape(Rectangle())
        // High priority or the row's buttons win the touch and the melt never
        // scrubs (ClueChrome's finding, owner device 2026-07-10).
        .highPriorityGesture(meltDrag(morph: morph))
    }

    private func chevron(_ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.black.opacity(0.85))
                .frame(width: 36, height: 40)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: The browser list (~20 fake rows)

    private func browserList(bottomInset: CGFloat) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                listSection(title: "Across", rows: fakeAcross)
                listSection(title: "Down", rows: fakeDown)
            }
            .padding(.bottom, bottomInset)
        }
        .scrollIndicators(.hidden)
    }

    @ViewBuilder
    private func listSection(title: String, rows: [(Int, String)]) -> some View {
        Text(verbatim: title.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(.black.opacity(0.45))
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 4)
        ForEach(rows, id: \.0) { row in
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: "\(row.0)")
                    .font(.system(size: 13, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(.black.opacity(0.45))
                    .frame(width: 26, alignment: .trailing)
                Text(verbatim: row.1)
                    .font(.system(size: 14))
                    .foregroundStyle(.black.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
    }

    // MARK: The gesture (ClueChrome's discipline, verbatim)

    /// Global space, and nothing else: the local space belongs to the very
    /// view this drag resizes, so a still finger reads a changing translation
    /// as the surface grows and the melt oscillates (owner device finding
    /// 2026-07-10). Finger down writes raw progress inside a nil-animation
    /// Transaction (SP-i1); the one animation runs on release.
    private func meltDrag(morph: GlassMorph) -> some Gesture {
        DragGesture(minimumDistance: 12, coordinateSpace: .global)
            .onChanged { value in
                if !isDragActive {
                    isDragActive = true
                    // A finger catching a settle mid-flight owns progress from
                    // wherever the surface actually is.
                    model.touched()
                    dragBase = model.progress
                    model.isDragging = true
                }
                let next = morph.progress(
                    draggedBy: value.translation.height, from: dragBase)
                var transaction = Transaction()
                transaction.animation = nil
                withTransaction(transaction) {
                    if next != model.progress {
                        model.direction = next > model.progress ? .opening : .closing
                    }
                    model.progress = next
                }
            }
            .onEnded { value in
                isDragActive = false
                model.isDragging = false
                settle(
                    open: GlassSettle.settlesOpen(
                        progress: model.progress,
                        upwardVelocity: -value.velocity.height))
            }
    }

    /// The one animation, on release or tap. Reduce Motion cuts, production's
    /// rule (DESIGN.md section 7 taken to its limit for a geometry morph).
    private func settle(open: Bool) {
        model.settle(
            open: open,
            response: variant.settleResponse(open: open),
            animated: !reduceMotion)
    }
}

// MARK: - The lab's model (RoomChromeModel's walk, response as an input)

/// Progress is the ONE source of geometry truth, stepped by hand on release
/// (SP-i1: no SwiftUI animation ever owns it), exactly RoomChromeModel's
/// structure with the response parameterized so variant A can bend the two
/// directions apart.
@MainActor
@Observable
private final class MeltLabModel {
    var progress: CGFloat = 0
    var isDragging = false
    /// Which way the surface is headed, for B's asymmetric content: Mail's
    /// asymmetry is temporal, a scrubbed axis is not, so opacity needs a
    /// heading. A scrub downward drops the list exactly like a pour back.
    var direction: Direction = .closing

    enum Direction { case opening, closing }

    @ObservationIgnored private var settleTask: Task<Void, Never>?

    /// A finger touched the melt: whatever settle was in flight stops and the
    /// finger owns progress from wherever the surface actually is.
    func touched() {
        settleTask?.cancel()
    }

    func settle(open: Bool, response: TimeInterval, animated: Bool) {
        settleTask?.cancel()
        direction = open ? .opening : .closing
        let start = progress
        let target: CGFloat = open ? 1 : 0
        guard animated, abs(target - start) > 0.0005 else {
            progress = target
            return
        }
        settleTask = Task { @MainActor [weak self] in
            let began = Date.now
            let ticker = MeltFrameTicker()
            defer { ticker.stop() }
            for await _ in ticker.frames() {
                if Task.isCancelled { return }
                let fraction = MeltSettleCurve.fraction(
                    at: Date.now.timeIntervalSince(began), response: response)
                guard let self else { return }
                if fraction >= 1 {
                    self.progress = target
                    return
                }
                self.progress = start + (target - start) * CGFloat(fraction)
            }
        }
    }
}

/// ChromeSettleCurve with the response as a parameter: the critically damped
/// spring x(t) = 1 - e^(-wt)(1 + wt), w = 2 pi / response, solved in closed
/// form and stepped by hand. Reports 1 once within a thousandth so a walk
/// terminates.
private enum MeltSettleCurve {
    static func fraction(at elapsed: TimeInterval, response: TimeInterval) -> Double {
        guard elapsed > 0 else { return 0 }
        let t = 2 * Double.pi / response * elapsed
        let fraction = 1 - exp(-t) * (1 + t)
        return fraction >= 0.999 ? 1 : fraction
    }
}

/// RoomChromeModel's FrameTicker, replicated: CADisplayLink bridged to an
/// AsyncStream so a walk steps once per real display frame. A slept interval
/// is not frame-synced, and its jitter against the display read as lag on the
/// owner's device (finding 2026-07-10); a timing lab cannot afford that noise.
@MainActor
private final class MeltFrameTicker: NSObject {
    private var link: CADisplayLink?
    private var continuation: AsyncStream<Void>.Continuation?

    func frames() -> AsyncStream<Void> {
        AsyncStream { continuation in
            self.continuation = continuation
            let link = CADisplayLink(target: self, selector: #selector(tick))
            link.add(to: .main, forMode: .common)
            self.link = link
        }
    }

    @objc private func tick() {
        continuation?.yield()
    }

    /// The link retains its target; invalidating breaks the cycle. Callers
    /// pair every `frames()` with a `stop()` (the walk's `defer`).
    func stop() {
        link?.invalidate()
        link = nil
        continuation?.finish()
        continuation = nil
    }
}

// MARK: - Fake room furniture

private let fakeClues: [(tag: String, text: String)] = [
    ("14A", "The quiet between clues"),
    ("25A", "A bar that pours back"),
    ("7D", "Fields merging, soft edged"),
]

private let fakeAcross: [(Int, String)] = [
    (1, "Panton's plastic classic"),
    (5, "Quiet on the wire"),
    (9, "Egg mid flight"),
    (14, "The quiet between clues"),
    (17, "Frosted, standing"),
    (21, "Paper under glass"),
    (25, "A bar that pours back"),
    (28, "Two thumbs of chrome"),
    (31, "Soft edged mid flight"),
    (34, "The finger owns it"),
]

private let fakeDown: [(Int, String)] = [
    (2, "Ink at rest"),
    (3, "A neck that holds"),
    (4, "Capsule register"),
    (6, "The chrome spring"),
    (7, "Fields merging"),
    (8, "One surface, one law"),
    (10, "Blur, resolving"),
    (11, "Pour back, gone at once"),
    (12, "The fuse threshold"),
    (13, "Goo under the finger"),
]
