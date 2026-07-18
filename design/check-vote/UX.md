# The check vote: UX contract

Owner-ratified 2026-07-18, from the D32 design session. This pins the experience the
Phase 15 client waves (15.4 web, 15.5 iOS, 15.6 Android) build; the wire semantics are
PROTOCOL.md sections 4, 5, 6, 10 and are not restated here. The web UI is not a visual
spec for the native apps; this document is the shared grammar, each platform supplies
its own joinery.

## The frame

A check vote is a social negotiation about spoilers, compressed into thirty seconds.
The design's job is emotional, not informational: proposing must feel legitimate, not
embarrassing; declining must feel kind, not personal; the outcome must read as the
room's decision, not a verdict on the proposer. Every rule below serves that.

## Rulings

**U1 Verbs, not votes.** The ballot reads "Check it" and "Keep solving", never
approve/reject. A no is a vote for continued play, not against a person. Failure copy
is collective and calm: "The room keeps solving" (rejected), "The vote lapsed"
(expired), "Vote ended, the grid changed" (grid broken). A terminal cancellation needs
no line; the completion or abandon surface supersedes. The word "vote" nearly
disappears from the UI; what users see is a question from a teammate.

**U2 Non-blocking, always.** Play continues during a vote by contract, so the vote
lives in transforming product furniture, never a modal, never a corner toast or
snackbar. Focus is never stolen; a solver mid-word loses no keystroke when a vote
opens.

**U3 Hold-to-propose.** In multiplayer the Check control is press-and-hold (~600 ms
fill; early release cancels), replacing the confirm dialog: deliberateness without
double ceremony. Solo keeps the plain confirm, and the solo auto-pass renders as
today's instant check with zero vote chrome, not one frame of it.

**U4 The luminous ring is the only clock.** A rounded-rect halo just outside the grid,
in the warm gold accent (the solo-gold ramp hue; never an identity roster color),
draining continuously against `expiresAt`. No digits, no countdown text anywhere.
It ignites from a pulse that originates at the proposer's cursor position (attribution
made spatial), flashes and dissolves inward on a pass, fades quietly otherwise.
Reduced motion: stepped opacity, no sweep, no pulse.

**U5 Faces, not numbers.** The room reads elector chips (the existing identity
system): settled chips voted, dimmed chips have not. No tallies or counts render for
the room. After a failed vote the proposer alone sees "{approvals} of {needed}".

**U6 The reveal is choreographed.** On a pass: the venue resolves to "Checking...",
one deliberate breath (~600 ms of stillness), the ring flashes and dissolves as the
wrong-cell marks wash across the board in ascending cell order (whole wash under
900 ms, existing check-mark style), and "{n} to fix" lands last. Reduced motion:
marks apply instantly. On phones the pass carries a success haptic timed to the wash.

**U7 Quiet recess, no re-litigation.** A failed, lapsed, or cancelled vote shows its
one line for about 2.5 s and withdraws. No try-again affordance exists; a new proposal
requires a fresh deliberate hold.

**U8 The venues.**

- **Web desktop, the Proscenium**: the room chrome strip above the grid transforms
  into the vote surface for the vote's life (proposer and question, chips, verbs),
  full grid width, and returns on close. The room's own chrome transforming is what
  keeps it from reading as a notification.
- **Web mobile, best effort**: a slim strip docked above the active-clue bar. Same
  store, copy, and ring; no further ceremony owed. Compromises land here, never on
  desktop.
- **iOS and Android, the Bench**: a non-modal partial-height bottom sheet in each
  platform's own material and motion language; the grid stays interactive above it;
  swipe collapses it to a docked strip; it re-rises for the resolution. Predictive
  back on Android never dismisses it. A clue-browser sheet collision resolves by the
  app's own sheet idiom; a pending vote is never invisible.

**U9 Haptic grammar (native apps).** Open: one firm impact. Each ballot: a light
tick. Pass: success, timed to the wash. Fail or lapse: two soft ticks.

**U10 Accessibility.** Vote open and resolution announced politely (aria-live,
VoiceOver, TalkBack); the ring is decorative and hidden from assistive tech; verbs
are labeled and reachable; the hold gesture has an accessible activation path;
reduced-motion signals honored everywhere motion is specified.

## Deferred by owner ruling

- **Dynamic Island / Live Activity** (iOS): the vote is a natural tenant, but the
  Live Activity surface is not touched in Phase 15.
- **Sound**: no audio anywhere; motion and haptics carry the ceremony.
- **Mobile web Bench**: the docked strip is the whole commitment.

## Rejected

A modal or center-stage lightbox (contradicts U2 and the contract's play-continues
rule); a corner card or rail placement on desktop (sidelines the room's shared moment
into notification territory); a clue-bar takeover on mobile (the bar is the steering
wheel of solving; the vote may dock beside it, never take it); approve/reject language
(U1); visible countdown digits (manufactured anxiety); a try-again CTA after a failure
(would turn the no-cooldown rule into a spam affordance); rendering rejector identity
in the resolution line (the chips already told anyone watching; the summary should not
immortalize it).
