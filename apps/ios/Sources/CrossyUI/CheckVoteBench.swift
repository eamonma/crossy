// The Bench (apps/ios Wave 15.5 UX): the vote's venue, a non-modal glass surface that rises to
// a partial rest on vote open and leaves the grid above fully interactive (play continues
// during a vote). It carries the proposal line on top, the elector chips across the middle
// (unvoted dimmed), and the two verbs full-width at the bottom, "Check it" primary. The
// proposer sees chips and no verbs; a non-elector reads only. It collapses by a swipe to a
// slim docked strip and re-rises on resolution, where it shows one calm recess line and
// withdraws. Modeled on the app's own ClueChrome idiom (a ZStack overlay with the established
// glass, D06), never a UIAlertController or a toast.
//
// No countdown digits live here: the ring is the only clock. No tally is shown to the room;
// only the proposer sees the post-fail "{approvals} of {needed}" line.

import CrossyDesign
import SwiftUI

@available(iOS 17.0, macOS 14.0, *)
public struct CheckVoteBench: View {
    private let model: CheckVoteBenchModel
    private let selfUserId: String?
    private let ground: GridGround
    private let reduceMotion: Bool
    /// When set, the vote has resolved: the Bench shows this one calm line (nil for a terminal
    /// close) and the caller withdraws it after the recess beat.
    private let recessLine: String?
    /// The proposer-only post-fail tally line, nil for the room and for a pass.
    private let proposerTally: String?
    private let colorFor: (String) -> Color
    private let initialFor: (String) -> String
    @Binding private var collapsed: Bool
    private let onApprove: () -> Void
    private let onReject: () -> Void

    public init(
        model: CheckVoteBenchModel,
        selfUserId: String?,
        ground: GridGround,
        reduceMotion: Bool,
        recessLine: String? = nil,
        proposerTally: String? = nil,
        collapsed: Binding<Bool>,
        colorFor: @escaping (String) -> Color,
        initialFor: @escaping (String) -> String,
        onApprove: @escaping () -> Void,
        onReject: @escaping () -> Void
    ) {
        self.model = model
        self.selfUserId = selfUserId
        self.ground = ground
        self.reduceMotion = reduceMotion
        self.recessLine = recessLine
        self.proposerTally = proposerTally
        self._collapsed = collapsed
        self.colorFor = colorFor
        self.initialFor = initialFor
        self.onApprove = onApprove
        self.onReject = onReject
    }

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }
    private var isResolved: Bool { recessLine != nil || proposerTally != nil }
    private var showsVerbs: Bool { !isResolved && model.showsVerbs(selfUserId: selfUserId) }

    public var body: some View {
        VStack(spacing: 0) {
            grip
            if collapsed && !isResolved {
                dockedStrip
            } else {
                VStack(spacing: 14) {
                    header
                    if !isResolved {
                        chipsRow
                    }
                    if showsVerbs {
                        verbs
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 18)
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .modifier(ChromeGlassSurface(cornerRadius: 26))
        .padding(.horizontal, 12)
        .gesture(collapseDrag)
        .animation(reduceMotion ? nil : .crossyChrome, value: collapsed)
        .animation(reduceMotion ? nil : .crossyChrome, value: isResolved)
        .accessibilityElement(children: .contain)
    }

    // MARK: - Pieces

    private var grip: some View {
        Capsule()
            .fill(ink.opacity(0.18))
            .frame(width: 36, height: 5)
            .padding(.top, 8)
            .padding(.bottom, 6)
            .accessibilityHidden(true)
    }

    private var header: some View {
        Group {
            if let recessLine {
                Text(recessLine)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(ink.opacity(0.8))
                    .accessibilityAddTraits(.updatesFrequently)
            } else {
                VStack(spacing: 4) {
                    Text(model.proposalLine)
                        .font(.headline)
                        .foregroundStyle(ink)
                        .multilineTextAlignment(.center)
                    if let proposerTally {
                        Text(proposerTally)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(gold)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var chipsRow: some View {
        HStack(spacing: 10) {
            ForEach(model.electors, id: \.userId) { chip in
                electorChip(chip)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)  // the header + verbs carry the spoken content
    }

    private func electorChip(_ chip: ElectorChip) -> some View {
        let voted = chip.ballot.hasVoted
        return ZStack {
            Circle()
                .fill(colorFor(chip.userId))
                .overlay(Circle().stroke(Color(rgb: ground.tokens.cell), lineWidth: 1.5))
            Text(initialFor(chip.userId))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
        }
        .frame(width: 34, height: 34)
        // Unvoted electors are dimmed; a filed ballot brightens to full.
        .opacity(voted ? 1 : 0.35)
        .overlay(alignment: .bottomTrailing) {
            if chip.ballot == .rejected {
                ballotBadge(system: "xmark", tint: ink.opacity(0.6))
            } else if chip.ballot == .approved {
                ballotBadge(system: "checkmark", tint: gold)
            }
        }
    }

    private func ballotBadge(system: String, tint: Color) -> some View {
        Image(systemName: system)
            .font(.system(size: 8, weight: .bold))
            .foregroundStyle(.white)
            .padding(3)
            .background(Circle().fill(tint))
            .accessibilityHidden(true)
    }

    private var verbs: some View {
        HStack(spacing: 12) {
            Button(action: onReject) {
                Text(CheckVoteCopy.reject)
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(ink)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(ink.opacity(0.08)))
            .accessibilityLabel(CheckVoteCopy.reject)

            Button(action: onApprove) {
                Text(CheckVoteCopy.approve)
                    .font(.body.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(gold))
            .accessibilityLabel(CheckVoteCopy.approve)
            .accessibilityAddTraits(.isButton)
        }
    }

    private var dockedStrip: some View {
        HStack(spacing: 8) {
            Circle().fill(colorFor(model.proposerId)).frame(width: 18, height: 18)
            Text(model.proposalLine)
                .font(.subheadline)
                .foregroundStyle(ink.opacity(0.85))
                .lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(ink.opacity(0.5))
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
        .contentShape(Rectangle())
        .onTapGesture { collapsed = false }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(model.proposalLine). Vote in progress.")
        .accessibilityAddTraits(.isButton)
    }

    /// Swipe down to dock to the slim strip, up to re-rise. A resolved Bench ignores the drag
    /// (it is withdrawing).
    private var collapseDrag: some Gesture {
        DragGesture(minimumDistance: 12)
            .onEnded { value in
                guard !isResolved else { return }
                if value.translation.height > 24 { collapsed = true }
                if value.translation.height < -24 { collapsed = false }
            }
    }
}
