// The vote's venue, STRIP-FIRST (owner ruling, Wave 15.8; UX.md U2, U8): the vote OPENS as
// a docked strip — one glass row carrying the proposal line and the two verbs inline — that
// never covers the key deck and never leaks a touch to it. The strip docks in the band
// between the clue bar and the deck (the rebus field's own slot: over solid canvas, ID-4),
// so the deck's keys never move under live thumbs and a solver mid-word loses no keystroke.
// A tap expands it to the full Bench: a non-modal glass sheet with the elector chips as real
// roster pucks (the app's one participant mark) and the verbs full width; a downward drag
// folds it back to the strip. The resolution always reads in the strip: one calm recess
// line, the proposer's "{approvals} of {needed}" beside it.
//
// Hit-testing is explicit everywhere (the Wave 15.8 audit: iOS 26 glassEffect is not
// hit-testable and the deck fires at touch-down): every surface carries a .contentShape,
// the verbs' fills live INSIDE their Buttons, and the Bench claims its own touches with a
// no-op tap so nothing falls through the glass to the keys. An opaque canvas backing under
// the Bench keeps key glyphs from bleeding through the material.
//
// No countdown digits live here: the ring is the only clock. No tally shows mid-vote; only
// the proposer's post-fail line carries a count.
//
// REFERENCE CONSTANTS (Android copies this look):
//   strip height        52 pt (the bar register), capsule (radius 26), horizontal inset 12
//   strip padding       16 pt leading/trailing inside the glass
//   strip proposer puck 24 pt; strip elector pucks 20 pt at 4 pt spacing
//   strip verbs         34 pt tall capsules, 14 pt horizontal padding, footnote semibold
//   bench corner        26 pt continuous; content padding 20 H / 18 bottom
//   bench chips         36 pt pucks, 10 pt spacing, wrapping in rows of six
//   bench verbs         44 pt min height, radius 14 continuous
//   backing             the ground's canvas at 0.94 under the glass (the opaque feather)
//   motion              every arrival/expansion/withdrawal rides .crossyChrome (the room's
//                       one spring, Motion.Springs.chromeResponse/chromeDampingFraction);
//                       the strip inserts .move(.bottom)+.opacity; Reduce Motion cuts

import CrossyDesign
import SwiftUI

// MARK: - Shared pieces

/// A chip's member for the roster pucks: the live roster entry when it exists, a neutral
/// "Player" stand-in when the elector has departed (never the raw userId; Wave 15.8 fix).
/// The stand-in keeps a stable hash color through RosterMember.identity's fallback.
enum CheckVoteChipMember {
    static func resolve(
        userId: String, memberFor: (String) -> RosterMember?
    ) -> RosterMember {
        memberFor(userId)
            ?? RosterMember(
                userId: userId, displayName: CheckVoteCopy.fallbackElector, wireColor: "",
                avatarUrl: nil, isHost: false, isSpectator: false, connected: true)
    }
}

/// The ballot badge riding a chip's corner: gold check for an approval, quiet x for a no.
@available(iOS 17.0, macOS 14.0, *)
private struct BallotBadge: View {
    let ballot: ElectorBallot
    let ground: GridGround

    var body: some View {
        if ballot.hasVoted {
            Image(systemName: ballot == .approved ? "checkmark" : "xmark")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(.white)
                .padding(3)
                .background(
                    Circle().fill(
                        ballot == .approved
                            ? Color(rgb: AnalysisPalette.gold(ground))
                            : Color(rgb: ground.tokens.ink).opacity(0.6)))
                .accessibilityHidden(true)
        }
    }
}

// MARK: - The docked strip

/// The strip: the vote's opening posture and its resolution surface. One row, never over
/// the deck (it stands in the layout band above it), everything hit-claimed.
@available(iOS 17.0, macOS 14.0, *)
public struct CheckVoteStrip: View {
    private let model: CheckVoteBenchModel
    private let selfUserId: String?
    private let ground: GridGround
    private let reduceMotion: Bool
    /// When set, the vote has resolved: the strip shows this calm line (plus the proposer's
    /// tally) and the caller withdraws it after the recess beat.
    private let recessLine: String?
    private let proposerTally: String?
    private let memberFor: (String) -> RosterMember?
    private let onExpand: () -> Void
    private let onApprove: () -> Void
    private let onReject: () -> Void

    /// The strip's fixed height: the bar register (ChromeLayout.barHeight).
    public static let height: CGFloat = 52

    public init(
        model: CheckVoteBenchModel,
        selfUserId: String?,
        ground: GridGround,
        reduceMotion: Bool,
        recessLine: String? = nil,
        proposerTally: String? = nil,
        memberFor: @escaping (String) -> RosterMember?,
        onExpand: @escaping () -> Void,
        onApprove: @escaping () -> Void,
        onReject: @escaping () -> Void
    ) {
        self.model = model
        self.selfUserId = selfUserId
        self.ground = ground
        self.reduceMotion = reduceMotion
        self.recessLine = recessLine
        self.proposerTally = proposerTally
        self.memberFor = memberFor
        self.onExpand = onExpand
        self.onApprove = onApprove
        self.onReject = onReject
    }

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }
    private var isResolved: Bool { recessLine != nil || proposerTally != nil }
    private var showsVerbs: Bool { !isResolved && model.showsVerbs(selfUserId: selfUserId) }

    public var body: some View {
        HStack(spacing: 10) {
            if isResolved {
                recessRow
            } else {
                liveRow
            }
        }
        .padding(.horizontal, 16)
        .frame(height: Self.height)
        .frame(maxWidth: .infinity)
        .modifier(ChromeGlassSurface(cornerRadius: Self.height / 2))
        // The opaque backing (the strip's feather): canvas under the glass so nothing
        // beneath ever bleeds through the material, even mid-transition.
        .background(
            Capsule().fill(Color(rgb: ground.tokens.canvas).opacity(0.94)))
        // The glass claims every touch (iOS 26 glassEffect is not hit-testable alone).
        .contentShape(Capsule())
        .onTapGesture {
            guard !isResolved else { return }
            onExpand()
        }
        .padding(.horizontal, ChromeLayout.inset)
        .accessibilityElement(children: .contain)
    }

    /// The live row: proposer puck, the line, then the verbs (an unvoted elector) or the
    /// elector pucks filling in (everyone else watches the faces, U5).
    @ViewBuilder private var liveRow: some View {
        RosterPuckView(
            member: CheckVoteChipMember.resolve(userId: model.proposerId, memberFor: memberFor),
            ground: ground, diameter: 24)
        Text(model.proposalLine)
            .font(.footnote.weight(.medium))
            .foregroundStyle(ink)
            .lineLimit(1)
            .truncationMode(.tail)
            .layoutPriority(-1)
        Spacer(minLength: 6)
        if showsVerbs {
            stripVerb(CheckVoteCopy.reject, prominent: false, action: onReject)
            stripVerb(CheckVoteCopy.approve, prominent: true, action: onApprove)
        } else {
            electorPucks
            Image(systemName: "chevron.up")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ink.opacity(0.45))
                .accessibilityHidden(true)
        }
    }

    /// The resolution row: the calm line, the proposer's tally beside it in gold (the
    /// audit's dead-code fix: the tally renders WITH the line, never shadowed by it).
    @ViewBuilder private var recessRow: some View {
        if let recessLine {
            Text(recessLine)
                .font(.footnote.weight(.medium))
                .foregroundStyle(ink.opacity(0.85))
                .lineLimit(1)
        }
        if let proposerTally {
            Text(proposerTally)
                .font(.footnote.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(gold)
        }
        Spacer(minLength: 0)
    }

    /// The elector pucks in the strip: 20 pt faces, settled bright, unvoted dimmed (U5).
    private var electorPucks: some View {
        HStack(spacing: 4) {
            ForEach(model.electors, id: \.userId) { chip in
                RosterPuckView(
                    member: CheckVoteChipMember.resolve(
                        userId: chip.userId, memberFor: memberFor),
                    ground: ground, diameter: 20)
                    .opacity(chip.ballot.hasVoted ? 1 : 0.35)
            }
        }
        .accessibilityHidden(true)
    }

    /// A strip verb: the fill lives INSIDE the Button and the shape is the hit area
    /// (the audit's transparent-hit-area fix).
    private func stripVerb(
        _ title: String, prominent: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(prominent ? .semibold : .medium))
                .foregroundStyle(prominent ? .white : ink)
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(
                    Capsule().fill(prominent ? AnyShapeStyle(gold) : AnyShapeStyle(ink.opacity(0.08))))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(title)
    }
}

// MARK: - The expanded Bench

/// The Bench: the strip's expansion. Chips as real roster pucks (wrapping past six), the
/// verbs full width, height following content. It overlays the deck only because the
/// solver asked it to; a downward drag folds it back to the strip.
@available(iOS 17.0, macOS 14.0, *)
public struct CheckVoteBench: View {
    private let model: CheckVoteBenchModel
    private let selfUserId: String?
    private let ground: GridGround
    private let reduceMotion: Bool
    private let memberFor: (String) -> RosterMember?
    private let onCollapse: () -> Void
    private let onApprove: () -> Void
    private let onReject: () -> Void

    /// Chips wrap past six to a new row (Wave 15.8: the old single row collided).
    public static let chipsPerRow = 6

    public init(
        model: CheckVoteBenchModel,
        selfUserId: String?,
        ground: GridGround,
        reduceMotion: Bool,
        memberFor: @escaping (String) -> RosterMember?,
        onCollapse: @escaping () -> Void,
        onApprove: @escaping () -> Void,
        onReject: @escaping () -> Void
    ) {
        self.model = model
        self.selfUserId = selfUserId
        self.ground = ground
        self.reduceMotion = reduceMotion
        self.memberFor = memberFor
        self.onCollapse = onCollapse
        self.onApprove = onApprove
        self.onReject = onReject
    }

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }
    private var showsVerbs: Bool { model.showsVerbs(selfUserId: selfUserId) }

    public var body: some View {
        VStack(spacing: 0) {
            grip
            VStack(spacing: 14) {
                header
                chipRows
                if showsVerbs {
                    verbs
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 18)
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity)
        .modifier(ChromeGlassSurface(cornerRadius: 26))
        // The opaque feather: canvas under the glass so the deck's key glyphs never
        // bleed through the material (the Wave 15.8 audit).
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color(rgb: ground.tokens.canvas).opacity(0.94)))
        // The Bench claims its whole surface: shape first, then a no-op tap so the glass
        // owns every touch that is not a verb (glassEffect alone is not hit-testable).
        .contentShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .onTapGesture {}
        .padding(.horizontal, ChromeLayout.inset)
        .gesture(collapseDrag)
        .accessibilityElement(children: .contain)
    }

    private var grip: some View {
        Capsule()
            .fill(ink.opacity(0.18))
            .frame(width: 36, height: 5)
            .padding(.top, 8)
            .padding(.bottom, 6)
            .accessibilityHidden(true)
    }

    /// VoiceOver reads the header first, then the verbs; the chips are decorative (the
    /// announcements carry the motion of the room).
    private var header: some View {
        Text(model.proposalLine)
            .font(.headline)
            .foregroundStyle(ink)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
    }

    /// The elector chips as real roster pucks (avatar over colored initial, the app's one
    /// participant mark), wrapping in rows of six. Unvoted dimmed; ballots badge the corner.
    private var chipRows: some View {
        let rows = stride(from: 0, to: model.electors.count, by: Self.chipsPerRow).map {
            Array(model.electors[$0..<min($0 + Self.chipsPerRow, model.electors.count)])
        }
        return VStack(spacing: 10) {
            ForEach(0..<rows.count, id: \.self) { index in
                HStack(spacing: 10) {
                    ForEach(rows[index], id: \.userId) { chip in
                        electorChip(chip)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)  // the header + verbs carry the spoken content
    }

    private func electorChip(_ chip: ElectorChip) -> some View {
        RosterPuckView(
            member: CheckVoteChipMember.resolve(userId: chip.userId, memberFor: memberFor),
            ground: ground, diameter: 36)
            // Unvoted electors are dimmed; a filed ballot brightens to full (U5).
            .opacity(chip.ballot.hasVoted ? 1 : 0.35)
            .overlay(alignment: .bottomTrailing) {
                BallotBadge(ballot: chip.ballot, ground: ground)
            }
    }

    /// The verbs, full width: fills INSIDE the Buttons, shapes as hit areas (the audit's
    /// transparent-hit-area fix), "Check it" primary in the gold.
    private var verbs: some View {
        HStack(spacing: 12) {
            Button(action: onReject) {
                Text(CheckVoteCopy.reject)
                    .font(.body.weight(.medium))
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(ink.opacity(0.08)))
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CheckVoteCopy.reject)

            Button(action: onApprove) {
                Text(CheckVoteCopy.approve)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous).fill(gold))
                    .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(CheckVoteCopy.approve)
        }
    }

    /// A downward drag folds the Bench back to the strip.
    private var collapseDrag: some Gesture {
        DragGesture(minimumDistance: 12)
            .onEnded { value in
                if value.translation.height > 24 { onCollapse() }
            }
    }
}
