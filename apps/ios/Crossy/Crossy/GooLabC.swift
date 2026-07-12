//
//  GooLabC.swift
//  Crossy
//
//  Variant C, the distance law. How far apart can two shapes be and still fuse?
//  §10 already pins a fuse threshold for the standing deck (SP-i1: container
//  spacing 24 fused adjacent keys into wavy rows; the cluster's 6 stays
//  separate). That finding is about STANDING glass at rest. This variant
//  extends it to the traveling morph: as the Join-shaped traveler moves toward
//  the time pill and the container's spacing is swept, where does the metaball
//  stop blending the two fields and degrade to a plain crossfade?
//
//  The rig: two glass shapes in one GlassEffectContainer. The left shape is
//  fixed; the right shape's distance from it is a slider (0 pt abutting to a
//  full screen-width apart). Container spacing is a stepper (6 / 12 / 24 / 40 /
//  80). At each (distance, spacing) pair the owner reads whether the two shapes
//  show a fused neck (the metaball bridge) or stand as two discrete pills. A
//  "melt" button animates the right shape from far to abutting so the fuse
//  forming/breaking is visible in motion, not just at rest.
//
//  The law we expect to record: fusion is a function of the GAP between shape
//  edges versus the container SPACING; when edge-gap exceeds roughly the
//  spacing the field bridge cannot span and the pair reads as two objects (a
//  crossfade, not a melt). The device sets the exact number.
//
//  Evidence only.
//

import SwiftUI

struct DistanceLawLab: View {
    /// The right shape's edge-to-edge gap from the left shape, in points.
    @State private var gap: CGFloat = 40
    /// The container's blend spacing.
    @State private var spacing: CGFloat = 40
    /// Whether the right shape is animating between far and near (so the fuse
    /// forms/breaks in motion).
    @State private var near = false

    private let spacings: [CGFloat] = [6, 12, 24, 40, 80]
    private let shapeSize: CGFloat = 56

    var body: some View {
        if #available(iOS 26.0, *) {
            ZStack(alignment: .top) {
                sweep
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                VStack {
                    Spacer()
                    ribbon
                }
            }
        } else {
            Text(verbatim: "needs iOS 26 glass")
        }
    }

    @available(iOS 26.0, *)
    private var sweep: some View {
        let liveGap = near ? min(gap, 8) : gap
        return GlassEffectContainer(spacing: spacing) {
            HStack(spacing: liveGap) {
                RoundedRectangle(cornerRadius: shapeSize / 2, style: .continuous)
                    .fill(.clear)
                    .frame(width: shapeSize, height: shapeSize)
                    .glassEffect(.regular, in: .rect(cornerRadius: shapeSize / 2))
                RoundedRectangle(cornerRadius: shapeSize / 2, style: .continuous)
                    .fill(.clear)
                    .frame(width: shapeSize, height: shapeSize)
                    .glassEffect(.regular, in: .rect(cornerRadius: shapeSize / 2))
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 120)
        .animation(.smooth(duration: 0.5), value: near)
        .animation(.smooth(duration: 0.3), value: gap)
    }

    private var ribbon: some View {
        GooRibbon(
            title: "C — distance law · gap \(Int(gap)) pt · spacing \(Int(spacing))",
            detail: near
                ? "Right shape pulled near. Does a fused neck bridge the pair, or do they stay two pills?"
                : "Two shapes, edge gap \(Int(gap)) pt. Sweep gap and spacing; find where the metaball stops blending."
        ) {
            VStack(spacing: 8) {
                HStack(spacing: 8) {
                    Text(verbatim: "gap")
                        .font(.system(size: 12, weight: .semibold))
                    Slider(value: $gap, in: 0...220, step: 2)
                    Text(verbatim: "\(Int(gap))")
                        .font(.system(size: 12, weight: .medium).monospacedDigit())
                        .frame(width: 30)
                }
                HStack(spacing: 8) {
                    Text(verbatim: "spacing")
                        .font(.system(size: 12, weight: .semibold))
                    ForEach(spacings, id: \.self) { s in
                        Button("\(Int(s))") { spacing = s }
                            .buttonStyle(.bordered)
                            .tint(spacing == s ? .primary : .secondary)
                            .font(.system(size: 12, weight: .medium))
                    }
                    Button(near ? "far" : "melt near") { near.toggle() }
                        .buttonStyle(.borderedProminent)
                        .font(.system(size: 12, weight: .semibold))
                }
            }
        }
    }
}
