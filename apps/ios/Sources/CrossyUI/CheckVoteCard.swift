// The check-vote card (Wave 15.10, owner rulings 2026-07-18): the vote presents as a native,
// centered, BLOCKING card. On the phone the question deserves the screen; answering it is the
// way back to the board. No clock renders anywhere — no ring, no drain, no digits — the elector
// pucks settling as ballots land are the only live signal, and the timebox is felt only as the
// lapse line. The card wears the app's one chrome material (ChromeGlassSurface) over a
// canvas-tinted scrim that really blocks: the scrim and the card both hit-test as their full
// shapes, so nothing leaks through to the grid or the key deck (the iOS 26 glass pass-through
// the Bench shipped with).
//
// Dismissal is policy, not posture (CheckVoteCardPolicy, pinned): the elector's ballot is the
// only exit and their card shows no grabber; the proposer and a non-elector — who have no verb
// and no vote-cancel on the wire — get the sheet grammar (grabber, swipe down, scrim tap) and
// may return to the board while the vote runs. The resolution re-presents in the card, scrim
// lifted (the room has answered; the board is already back), for the ~2.5 s recess (U7). A
// pass condenses into CheckVoteStatusCapsule instead: "Checking…" through the breath and the
// wash, then "{n} to fix" lands there last (U6).

import CrossyDesign
import SwiftUI

extension Animation {
    /// The card's arrival: a people surface, so a whisper of life (Motion.Springs, Wave 15.10).
    static var checkVoteArrival: Animation {
        .spring(
            response: Motion.Springs.voteCardResponse,
            dampingFraction: Motion.Springs.voteCardDampingFraction)
    }

    /// The pucks' settle: people may overshoot (Motion.Springs.celebration*).
    static var checkVoteSettle: Animation {
        .spring(
            response: Motion.Springs.celebrationResponse,
            dampingFraction: Motion.Springs.celebrationDampingFraction)
    }
}

// MARK: - The scrim

/// The blocking dim under the card: the ground's canvas, washed over the whole screen (the
/// RoomWeather dim register, weighted up to modal). It consumes every touch — taps and drags
/// alike — so play genuinely pauses under the question; a tap reports up (the caller dismisses
/// when policy allows, and ignores it for an elector).
@available(iOS 17.0, macOS 14.0, *)
struct CheckVoteScrim: View {
    let ground: GridGround
    let onTap: () -> Void

    var body: some View {
        ZStack {
            // Two washes, one dim: the canvas unifies the room under its own paper, the
            // black lends the modal weight (the system's own alert-dim direction, honest
            // in both grounds).
            Color(rgb: ground.tokens.canvas).opacity(0.40)
            Color.black.opacity(0.14)
        }
            .ignoresSafeArea()
            .contentShape(Rectangle())
            // One gesture consumes both taps and drags (no pass-through, no gesture
            // competition): a near-stationary release reads as the tap.
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onEnded { value in
                        if abs(value.translation.width) < 10, abs(value.translation.height) < 10 {
                            onTap()
                        }
                    })
            .accessibilityHidden(true)
    }
}

// MARK: - The card

@available(iOS 17.0, macOS 14.0, *)
struct CheckVoteCard: View {
    let model: CheckVoteCardModel
    let selfUserId: String?
    let ground: GridGround
    let reduceMotion: Bool
    /// The close posture: when set, the card shows the one calm line (and the proposer's
    /// tally) and nothing else — no pucks (the chips already told anyone watching; the
    /// summary does not immortalize it), no verbs.
    let resolution: CheckVoteResolution?
    /// Resolve an elector or proposer to their roster identity (color, initial, avatar).
    /// The caller supplies the fallback member for a departed elector ("Player").
    let memberFor: (String) -> RosterMember
    let onApprove: () -> Void
    let onReject: () -> Void
    let onDismiss: () -> Void

    private var ink: Color { Color(rgb: ground.tokens.ink) }
    private var gold: Color { Color(rgb: AnalysisPalette.gold(ground)) }
    private var showsVerbs: Bool { resolution == nil && model.showsVerbs(selfUserId: selfUserId) }
    private var dismissible: Bool {
        resolution != nil
            || CheckVoteCardPolicy.isDismissible(
                role: model.viewerRole, hasOpenBallot: model.showsVerbs(selfUserId: selfUserId))
    }

    var body: some View {
        VStack(spacing: 0) {
            if let resolution {
                resolutionBody(resolution)
            } else {
                openBody
            }
        }
        .frame(maxWidth: 340)
        // The paper liner (the ClueFeather principle: canvas under glass for legibility):
        // the card floats over live cells — block cells included — and raw glass refracts
        // their contrast into smears. A translucent canvas wash between the glass and the
        // words keeps the surface calm without giving up the material.
        .background(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Color(rgb: ground.tokens.canvas).opacity(0.55)))
        .modifier(ChromeGlassSurface(cornerRadius: 28))
        // The one shadow in the vote's chrome: the card floats OVER the room (a modal
        // fact), so it separates from the canvas the way a system alert does. Standing
        // bars never carry this.
        .shadow(color: .black.opacity(0.14), radius: 28, y: 10)
        // The card hit-tests as its whole shape and swallows stray taps itself (the verbs
        // are children and win): nothing reaches the board through the glass.
        .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .onTapGesture {}
        .gesture(dismissSwipe)
        .padding(.horizontal, 28)
        // A hair above true center: the deck weighs the screen's foot, so the optical
        // middle sits higher than the geometric one.
        .offset(y: -24)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(resolution == nil ? .isModal : [])
        .accessibilityAction(.escape) {
            if dismissible { onDismiss() }
        }
    }

    // MARK: Open posture

    private var openBody: some View {
        VStack(spacing: 20) {
            if dismissible {
                grabber
            } else {
                Color.clear.frame(height: 6).accessibilityHidden(true)
            }
            Text(verbatim: model.proposalLine)
                .font(.title3.weight(.semibold))
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .accessibilitySortPriority(3)
            puckRow
            if showsVerbs {
                verbs
                    .accessibilitySortPriority(2)
            }
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 22)
    }

    private var grabber: some View {
        Capsule()
            .fill(ink.opacity(0.22))
            .frame(width: 36, height: 5)
            .accessibilityHidden(true)
    }

    /// The electorate as faces (U5): real roster pucks in electorate order. An unvoted puck
    /// waits small and dim; a ballot settles it — full presence, full size, its mark riding
    /// the corner — on the people spring. Decorative to assistive tech (the announcements
    /// carry the motion; no tallies are ever spoken, U5/U10).
    private var puckRow: some View {
        HStack(spacing: 14) {
            ForEach(model.electors, id: \.userId) { chip in
                puck(chip)
            }
        }
        .accessibilityHidden(true)
    }

    private func puck(_ chip: ElectorChip) -> some View {
        let voted = chip.ballot.hasVoted
        // The ballot owns presence on this surface: a disconnected elector who voted still
        // reads settled, so the member renders connected and the dim below is the vote's.
        let member = memberFor(chip.userId)
        let present = RosterMember(
            userId: member.userId, displayName: member.displayName,
            wireColor: member.wireColor, avatarUrl: member.avatarUrl,
            isHost: member.isHost, isSpectator: member.isSpectator, connected: true)
        return RosterPuckView(member: present, ground: ground, diameter: 44)
            .opacity(voted ? 1 : 0.35)
            .scaleEffect(voted ? 1 : 0.86)
            .overlay(alignment: .bottomTrailing) {
                if voted {
                    ballotMark(approved: chip.ballot == .approved)
                }
            }
            .animation(reduceMotion ? nil : .checkVoteSettle, value: chip.ballot)
    }

    private func ballotMark(approved: Bool) -> some View {
        Image(systemName: approved ? "checkmark" : "xmark")
            .font(.system(size: 9, weight: .bold))
            .foregroundStyle(.white)
            .padding(4)
            .background(Circle().fill(approved ? gold : ink.opacity(0.55)))
            .overlay(Circle().stroke(Color(rgb: ground.tokens.cell), lineWidth: 1.5))
            .offset(x: 4, y: 4)
            .transition(reduceMotion ? .opacity : .scale.combined(with: .opacity))
    }

    /// The two verbs (U1): "Keep solving" quiet, "Check it" primary in the warm gold — the
    /// solo-gold ramp hue, never an identity color, so the verb can never be mistaken for a
    /// voter.
    private var verbs: some View {
        HStack(spacing: 12) {
            Button(action: onReject) {
                Text(verbatim: CheckVoteCopy.reject)
                    .font(.body.weight(.medium))
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(ink.opacity(0.08)))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityLabel(CheckVoteCopy.reject)

            Button(action: onApprove) {
                Text(verbatim: CheckVoteCopy.approve)
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(gold))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .accessibilityLabel(CheckVoteCopy.approve)
        }
    }

    // MARK: Resolution posture

    private func resolutionBody(_ resolution: CheckVoteResolution) -> some View {
        VStack(spacing: 6) {
            Text(verbatim: resolution.line)
                .font(.headline)
                .foregroundStyle(ink)
                .multilineTextAlignment(.center)
            if let tally = resolution.tally {
                Text(verbatim: tally)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(gold)
            }
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 24)
        .accessibilityElement(children: .combine)
    }

    /// Swipe down puts a dismissible card away (the sheet grammar). An elector's card
    /// ignores it: the ballot is the exit.
    private var dismissSwipe: some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { value in
                guard dismissible, value.translation.height > 32 else { return }
                onDismiss()
            }
    }
}

// MARK: - The status capsule

/// The pass's condensed voice (U6): a small glass capsule above the clue bar carrying
/// "Checking…" through the breath and the wash, then "{n} to fix", landing last. Inert to
/// touch — the board is the star; this is the caption.
@available(iOS 17.0, macOS 14.0, *)
struct CheckVoteStatusCapsule: View {
    let text: String
    let ground: GridGround

    var body: some View {
        Text(verbatim: text)
            .font(.subheadline.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(Color(rgb: ground.tokens.ink))
            .padding(.horizontal, 18)
            .frame(minHeight: 40)
            .modifier(ChromeGlassSurface(cornerRadius: 20))
            .allowsHitTesting(false)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: text))
    }
}
