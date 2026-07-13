//
//  InteractivePopEnabler.swift
//  Crossy
//
//  Re-enabling the left-edge swipe-back on a plain room push (owner report 2026-07-13:
//  a game opened from Puzzles could not be swiped back to the list). The room hides the
//  system back button for its own chrome (RoomNavBarChrome's navigationBarBackButtonHidden,
//  and the Puzzles list hides the whole nav bar), and UIKit disables the
//  interactivePopGestureRecognizer whenever the back button or bar is hidden. The Rooms
//  tab dodges this because its .navigationTransition(.zoom) push re-establishes the pop;
//  the Puzzles tab is a plain push, so nothing re-enables it and the leading-edge swipe
//  does nothing.
//
//  This probe re-enables the recognizer and installs a permissive delegate that allows
//  the pop whenever the stack has something to pop to. The board's camera pan cannot
//  steal the swipe: the grid already leaves a 24pt leading edge-pop gutter with no drag
//  (CrossyGridView), so the leading edge belongs to the system pop.
//
//  App target on purpose (AD-2): a UIKit seam, CrossyUI stays UIKit-free. The pattern
//  mirrors ZoomPinchDismissDisabler: a transparent, non-interactive probe reaches the
//  pushed view controller through the responder chain and re-asserts on a low-cadence
//  heartbeat, because SwiftUI can reset the recognizer off its own schedule. The
//  original delegate is captured and restored on the way out, so the root list keeps its
//  own behavior. It degrades to the system default (no swipe), never to a crash.
//

import SwiftUI
import UIKit

struct InteractivePopEnabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> InteractivePopProbe {
        InteractivePopProbe()
    }

    func updateUIViewController(_ probe: InteractivePopProbe, context: Context) {}
}

final class InteractivePopProbe: UIViewController, UIGestureRecognizerDelegate {
    private var heartbeat: Timer?
    /// The recognizer's own delegate before we borrow it (a private UIKit transition
    /// object, retained by the navigation controller), restored on the way out so other
    /// screens keep the standard pop arbitration. Weak: the nav controller owns it.
    private weak var originalDelegate: (any UIGestureRecognizerDelegate)?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        enablePop()
        // SwiftUI can reset the recognizer off its own schedule, so re-assert the enable
        // at a low cadence while the room is on screen (the ZoomPinchDismissDisabler
        // heartbeat pattern).
        heartbeat?.invalidate()
        heartbeat = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.enablePop() }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        heartbeat?.invalidate()
        heartbeat = nil
        if let gesture = navigationController?.interactivePopGestureRecognizer,
            gesture.delegate === self
        {
            gesture.delegate = originalDelegate
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        heartbeat?.invalidate()
        heartbeat = nil
    }

    private func enablePop() {
        guard let gesture = navigationController?.interactivePopGestureRecognizer else { return }
        if gesture.delegate !== self {
            if originalDelegate == nil { originalDelegate = gesture.delegate }
            gesture.delegate = self
        }
        gesture.isEnabled = true
    }

    // Allow the edge pop whenever the stack has somewhere to pop to (the room over its
    // list). Without this the hidden back button leaves the system delegate refusing the
    // gesture, and count > 1 keeps a swipe on the root list from trying to pop nothing.
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        (navigationController?.viewControllers.count ?? 0) > 1
    }

    // The board's camera pan lives inside the grid past the leading gutter, so the two
    // never share a touch; keep them exclusive rather than simultaneous.
    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        false
    }
}
