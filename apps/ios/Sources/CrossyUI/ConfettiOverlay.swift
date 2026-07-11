// The completion confetti's render pass (owner ask 2026-07-11). One Canvas over
// the board, driven by TimelineView against the celebration's instant; every
// trajectory is ConfettiEnvelope's pure math, so this view owns no state and no
// physics, just paint. It mounts only while CompletionModel.confettiStartedAt is
// non-nil (the model nils it when the drift ends, and never sets it under Reduce
// Motion), sits between paper and glass in the solve screen's stack (§1: people
// between), and never takes a touch.

import CrossyDesign
import SwiftUI

@available(iOS 18.0, macOS 14.0, *)
struct ConfettiOverlay: View {
    let field: ConfettiField
    /// Reference-date seconds at the celebration trigger.
    let startedAt: TimeInterval

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let elapsed =
                    timeline.date.timeIntervalSinceReferenceDate - startedAt
                guard elapsed >= 0, elapsed <= ConfettiEnvelope.duration else { return }
                for fleck in field.flecks {
                    guard let pose = ConfettiEnvelope.pose(fleck, elapsed: elapsed)
                    else { continue }
                    var layer = context
                    layer.translateBy(
                        x: pose.unitX * size.width, y: pose.unitY * size.height)
                    layer.rotate(by: .radians(pose.rotation))
                    layer.opacity = pose.alpha
                    let rect = CGRect(
                        x: -fleck.size / 2, y: -fleck.size * 0.3,
                        width: fleck.size, height: fleck.size * 0.6)
                    layer.fill(
                        Path(rect),
                        with: .color(Color(rgb: field.colors[fleck.colorIndex])))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .ignoresSafeArea()
    }
}
