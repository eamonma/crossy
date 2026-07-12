//
//  ZoomPinchDismissDisabler.swift
//  Crossy
//
//  Disabling the zoom transition's pinch-to-close (owner ruling 2026-07-12). A
//  `.navigationTransition(.zoom)` push installs a private _UITransformGestureRecognizer
//  on the pushed hosting view: a pinch anywhere in the room dismisses it. That fights
//  the board's own pinch-zoom at the camera floor (a pinch-in meaning "zoom out"
//  instead leaves the room), so the room always disables it. It is a conflict, not a
//  preference, so there is no toggle. The leading-edge pop (the way home, edge-pop
//  gutter) and the swipe-down dismiss are untouched.
//
//  There is no public API for this recognizer, so the probe finds it by class name on
//  the pushed view controller's view. Matching a private class by name is brittle by
//  nature: a name the runtime no longer vends is simply not found, so the pinch keeps
//  its system default. The feature degrades to "system behavior," never to a crash.
//
//  App target on purpose (AD-2): a UIKit seam. CrossyUI stays UIKit-free.
//

import SwiftUI
import UIKit

/// The private pinch-dismiss recognizer the zoom transition installs (device census,
/// session 6b00bc71).
private let pinchDismissRecognizerName = "_UITransformGestureRecognizer"

/// Attach inside a zoom-pushed room (RoomNavBarChrome does); the probe reaches the
/// pushed view controller through the responder chain and disables the pinch dismiss on
/// every landing beat.
struct ZoomPinchDismissDisabler: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> ZoomPinchDismissProbe {
        ZoomPinchDismissProbe()
    }

    func updateUIViewController(_ probe: ZoomPinchDismissProbe, context: Context) {}
}

final class ZoomPinchDismissProbe: UIViewController {
    private var heartbeat: Timer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        disablePinchDismiss()
        // SwiftUI can reinstall the recognizer off its own schedule, so re-assert the
        // disable at a low cadence while the room is on screen.
        heartbeat?.invalidate()
        heartbeat = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self else { return }
            Task { @MainActor in self.disablePinchDismiss() }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        heartbeat?.invalidate()
        heartbeat = nil
    }

    /// Walk the pushed view controller's view subtree (the census found the recognizer
    /// on its top HostingView) and disable the pinch dismiss.
    private func disablePinchDismiss() {
        guard let host = navigationController?.topViewController?.view else { return }
        walk(host) { recognizer in
            if String(describing: type(of: recognizer)) == pinchDismissRecognizerName {
                recognizer.isEnabled = false
            }
        }
    }

    private func walk(_ view: UIView, _ body: (UIGestureRecognizer) -> Void, depth: Int = 0) {
        for recognizer in view.gestureRecognizers ?? [] { body(recognizer) }
        guard depth < 4 else { return }
        for sub in view.subviews { walk(sub, body, depth: depth + 1) }
    }
}
