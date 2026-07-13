// The key deck presented as the system keyboard (ID-4; apps/ios/DESIGN.md §4).
// The deck is not a SwiftUI view in the board's layout; it is a real UIKit
// `inputView` on a hidden first responder, so iOS treats it as THE keyboard. Two
// behaviors then fall out of the system for free, the way the NYT crossword
// keyboard gets them, with no AVKit code on our side:
//
//   1. A FaceTime / Picture-in-Picture window keeps clear of the deck. The system
//      repositions a PiP off the published keyboard frame, and a custom inputView
//      publishes that frame exactly as the system keyboard does (UIKit posts the
//      same UIKeyboard* notifications for it).
//   2. The deck sits above the home indicator with the system's own spacing; the
//      board rises above it through SwiftUI's keyboard avoidance.
//
// The deck's geometry, material, and haptics stay KeyDeck's business (DeckLayout,
// KeyDeck); this file owns only the hosting: the bridge that feeds live room state
// in, the self-sizing input view, and the first-responder lifecycle.
//
// This UIKit seam lives in CrossyUI, next to the deck it presents, on purpose: it
// is the deck's own presentation (cohesive with KeyDeck and RebusField, both here),
// not a navigation seam like the pop-gesture / pinch-dismiss probes that reach into
// the nav controller and so live in the app target (AD-2). CrossyUI already imports
// UIKit conditionally for KeyDeck's haptics and glass. `SolveScreen` sees only
// `DeckKeyboardMount`; none of the input-view detail leaks past it.

#if canImport(UIKit)
    import CrossyDesign
    import SwiftUI
    import UIKit

    /// The live room state the hosted deck reads. The mount pushes fresh values
    /// here on every SwiftUI update, so the deck tracks the room from inside the
    /// input view (the ground through an appearance change, the rebus buffer as an
    /// entry opens) without re-creating the host.
    @MainActor
    final class DeckKeyboardBridge: ObservableObject {
        @Published var ground: GridGround
        @Published var rebusBuffer: String?
        var onPress: (DeckKey) -> Void

        init(
            ground: GridGround, rebusBuffer: String?,
            onPress: @escaping (DeckKey) -> Void
        ) {
            self.ground = ground
            self.rebusBuffer = rebusBuffer
            self.onPress = onPress
        }

        var isRebusActive: Bool { rebusBuffer != nil }
    }

    /// The deck's lift off the home indicator (owner on-device ruling): the gap
    /// between the bottom key row and the safe-area line, on top of the indicator
    /// inset the system already reserves below a keyboard-style input view. The
    /// rig's tight gap read bottom-stuck on the tall Max screen.
    private let deckBottomLift: CGFloat = 20

    /// The deck as it renders inside the input view: the rebus field surfacing above
    /// the deck while an entry is open (EXPERIENCE.md baseline), then the deck. The
    /// bottom lift raises the keys off the safe-area line; the canvas below reaches
    /// the screen edge through the host's backdrop, not this content.
    @MainActor
    private struct DeckKeyboardContent: View {
        @ObservedObject var bridge: DeckKeyboardBridge

        var body: some View {
            VStack(spacing: 10) {
                if let buffer = bridge.rebusBuffer {
                    RebusField(buffer: buffer, ground: bridge.ground)
                }
                KeyDeck(ground: bridge.ground, isRebusActive: bridge.isRebusActive) {
                    key in bridge.onPress(key)
                }
            }
            .padding(.horizontal, ChromeLayout.inset)
            .padding(.top, 10)
            .padding(.bottom, deckBottomLift)
            .frame(maxWidth: .infinity)
            .background(Color(rgb: bridge.ground.tokens.canvas))
        }
    }

    /// The first-responder view: it becomes first responder and hands the system the
    /// deck as its `inputView`. Self-sizing, so the hosted SwiftUI drives the keyboard
    /// height (and re-drives it when the rebus field opens).
    @MainActor
    final class DeckKeyboardHostView: UIView {
        let bridge: DeckKeyboardBridge

        private lazy var hosting: UIHostingController<DeckKeyboardContent> = {
            let controller = UIHostingController(
                rootView: DeckKeyboardContent(bridge: bridge))
            controller.view.backgroundColor = .clear
            controller.sizingOptions = [.intrinsicContentSize]
            return controller
        }()

        private let canvasBackdrop = UIView()

        private lazy var keyboardInputView: UIInputView = {
            let inputView = UIInputView(frame: .zero, inputViewStyle: .keyboard)
            inputView.translatesAutoresizingMaskIntoConstraints = false
            inputView.allowsSelfSizing = true

            // The canvas fills the ENTIRE input view, including the home-indicator
            // strip below the keys, so the deck's ground meets the screen edge (ID-4:
            // the deck over solid canvas). Without it the .keyboard style's own gray
            // backdrop shows through that strip as a bar under the deck. The keys
            // still stop at the safe area (the host bottom pins there); only the
            // ground reaches the edge.
            canvasBackdrop.translatesAutoresizingMaskIntoConstraints = false
            canvasBackdrop.backgroundColor = UIColor(
                Color(rgb: bridge.ground.tokens.canvas))
            inputView.addSubview(canvasBackdrop)

            let host = hosting.view!
            host.translatesAutoresizingMaskIntoConstraints = false
            inputView.addSubview(host)
            NSLayoutConstraint.activate([
                canvasBackdrop.leadingAnchor.constraint(
                    equalTo: inputView.leadingAnchor),
                canvasBackdrop.trailingAnchor.constraint(
                    equalTo: inputView.trailingAnchor),
                canvasBackdrop.topAnchor.constraint(equalTo: inputView.topAnchor),
                canvasBackdrop.bottomAnchor.constraint(
                    equalTo: inputView.bottomAnchor),
                host.leadingAnchor.constraint(equalTo: inputView.leadingAnchor),
                host.trailingAnchor.constraint(equalTo: inputView.trailingAnchor),
                host.topAnchor.constraint(equalTo: inputView.topAnchor),
                host.bottomAnchor.constraint(
                    equalTo: inputView.safeAreaLayoutGuide.bottomAnchor),
            ])
            return inputView
        }()

        init(bridge: DeckKeyboardBridge) {
            self.bridge = bridge
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("no coder") }

        override var canBecomeFirstResponder: Bool { true }
        override var inputView: UIView? { keyboardInputView }

        /// Track the ground through an appearance change (the backdrop strip color
        /// must follow light/dark like the rest of the canvas).
        func refreshColors() {
            canvasBackdrop.backgroundColor = UIColor(
                Color(rgb: bridge.ground.tokens.canvas))
        }

        /// The rebus field opening/closing changes the deck's height; re-present the
        /// (cached) input view so the system re-reads its self-sized height.
        func reloadIfPresenting() {
            if isFirstResponder { reloadInputViews() }
        }
    }

    /// The host view controller. It drives the first responder off the
    /// view-controller appearance lifecycle, NOT off SwiftUI state:
    ///
    ///   - It resigns on `viewWillDisappear`, which fires the instant a room pop
    ///     begins (the signal the pop-gesture and pinch-dismiss probes also lean on).
    ///     So the deck leaves WITH the room instead of flashing over the zoom-out
    ///     while `status` is still `.ongoing`.
    ///   - `wantsActive` still gates presence while the room is up, so a spectate
    ///     seat or a terminal status pulls the deck without a pop.
    ///
    /// Presence is asserted from the room's first frame (the mount is not gated on
    /// `opening`), so the deck presents during the room's appearance and the board
    /// arrives already inset; the clue bar then fades in place with the deck rather
    /// than sliding up after the fact.
    final class DeckKeyboardHostController: UIViewController {
        private let host: DeckKeyboardHostView
        private var isAppeared = false
        /// Re-asserts the first responder at a low cadence while the room is on
        /// screen. A one-shot `becomeFirstResponder` in `viewDidAppear` loses the
        /// "first push per process" race on some entry paths (the deep-link / QR
        /// plain push, cold launch): the window is not key yet, the call fails, and
        /// the deck never comes up. The pop-gesture and pinch-dismiss probes carry a
        /// heartbeat for the same reason; `syncResponder` is idempotent, so this
        /// no-ops the instant the responder sticks.
        private var responderHeartbeat: Timer?
        var wantsActive = false { didSet { syncResponder() } }

        init(bridge: DeckKeyboardBridge) {
            self.host = DeckKeyboardHostView(bridge: bridge)
            super.init(nibName: nil, bundle: nil)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("no coder") }

        override func loadView() { view = host }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            isAppeared = true
            syncResponder()
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            // A cancelled interactive swipe re-appears without a fresh willAppear, so
            // re-assert here: the deck comes back after a swipe that did not commit.
            isAppeared = true
            syncResponder()
            startHeartbeat()
        }

        override func viewWillDisappear(_ animated: Bool) {
            super.viewWillDisappear(animated)
            isAppeared = false
            stopHeartbeat()
            host.resignFirstResponder()
        }

        private func startHeartbeat() {
            responderHeartbeat?.invalidate()
            responderHeartbeat = Timer.scheduledTimer(
                withTimeInterval: 0.5, repeats: true
            ) { [weak self] _ in
                guard let self else { return }
                Task { @MainActor in self.syncResponder() }
            }
        }

        private func stopHeartbeat() {
            responderHeartbeat?.invalidate()
            responderHeartbeat = nil
        }

        private func syncResponder() {
            guard isAppeared else { return }
            if wantsActive, !host.isFirstResponder {
                host.becomeFirstResponder()
            } else if !wantsActive, host.isFirstResponder {
                host.resignFirstResponder()
            }
        }

        func refreshColors() { host.refreshColors() }
        func reloadIfPresenting() { host.reloadIfPresenting() }
    }

    /// The seam `SolveScreen` uses. Zero-size and non-interactive: it exists only to
    /// own the first responder and the deck. Everything above stays behind it.
    struct DeckKeyboardMount: UIViewControllerRepresentable {
        let ground: GridGround
        let rebusBuffer: String?
        let isActive: Bool
        let onPress: (DeckKey) -> Void

        func makeCoordinator() -> DeckKeyboardBridge {
            DeckKeyboardBridge(
                ground: ground, rebusBuffer: rebusBuffer, onPress: onPress)
        }

        func makeUIViewController(context: Context) -> DeckKeyboardHostController {
            DeckKeyboardHostController(bridge: context.coordinator)
        }

        func updateUIViewController(
            _ controller: DeckKeyboardHostController, context: Context
        ) {
            let bridge = context.coordinator
            bridge.ground = ground
            bridge.onPress = onPress
            controller.refreshColors()
            let rebusToggled = (bridge.rebusBuffer == nil) != (rebusBuffer == nil)
            bridge.rebusBuffer = rebusBuffer

            controller.wantsActive = isActive
            if isActive, rebusToggled {
                controller.reloadIfPresenting()
            }
        }
    }
#endif
