# The check vote: UX contract

Owner-ratified 2026-07-18, from the D32 design session. This pins the experience the
Phase 15 client waves (15.4 web, 15.5 iOS, 15.6 Android) build; the wire semantics are
PROTOCOL.md sections 4, 5, 6, 10 and are not restated here. The web UI is not a visual
spec for the native apps; this document is the shared grammar, each platform supplies
its own joinery.

Amended 2026-07-18 (same day, post-audit): a three-platform audit of the shipped waves
produced owner rulings that tighten U1, U4, and U8 below. Amendments are folded into
the rulings in place; the fix waves are 15.7 (web), 15.8 (iOS reference), 15.9
(Android copies iOS after the owner tunes 15.8 on a physical iPhone).

Amended again 2026-07-18 (device tuning): the owner tuned 15.8 on a physical iPhone
and reversed course. The luminous ring is retired on every platform (U4 rewritten);
the strip-first Bench is scrapped wholesale; iOS rebuilds as a native blocking
voting card (U2 and U8 rewritten; wave 15.10, a fresh design), and Android copies
the tuned card. Web keeps its 15.7 Proscenium, minus the ring (wave 15.11).

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

The proposal line is "{name} wants to check the puzzle" to everyone except the
proposer, who reads "Waiting for the room" (amendment: never a self-echo, and never
a second-person contortion of the third-person template). A departed or unknown
proposer falls back to "A teammate", a chip name to "Player"; a raw user id never
renders. "Checking…" uses the single ellipsis character on every platform. Long
names truncate inside the name span only; the verb phrase survives.

**U2 Non-blocking on web; blocking on the phones (rewritten at device tuning).**
Play continues during a vote by wire contract, always: the room's other members keep
solving no matter what any one screen shows. On web the vote stays in transforming
product furniture (the Proscenium), never a modal, and focus is never stolen. On iOS
and Android the owner traded the non-blocking law for decisiveness: the vote presents
as a blocking card, and answering it is the way back to the board. The trade is
deliberate — on a phone the question deserves the screen.

**U3 Hold-to-propose.** In multiplayer the Check control is press-and-hold (~600 ms
fill; early release cancels), replacing the confirm dialog: deliberateness without
double ceremony. Solo keeps the plain confirm, and the solo auto-pass renders as
today's instant check with zero vote chrome, not one frame of it.

**U4 No clock renders (rewritten at device tuning; the ring is retired).** The
luminous ring — in both its original and Meridian registers — is retired on every
platform: the owner judged it a bad look in the hand, and the simplification is the
ruling. Nothing renders the timebox: no ring, no drain, no digits, no progress bar.
The chips settling are the vote's only live signal, and the timebox is felt only at
its end, as the lapse line. If real rooms find silent expiry abrupt, a quiet cue is
a future owner call, not a door for the ring to return through.

**U5 Faces, not numbers.** The room reads elector chips (the existing identity
system): settled chips voted, dimmed chips have not. No tallies or counts render for
the room. After a failed vote the proposer alone sees "{approvals} of {needed}".

**U6 The reveal is choreographed.** On a pass: the venue resolves to "Checking...",
one deliberate breath (~600 ms of stillness), then the wrong-cell marks wash across
the board in ascending cell order (whole wash under 900 ms, existing check-mark
style), and "{n} to fix" lands last. Reduced motion: marks apply instantly. On
phones the pass carries a success haptic timed to the wash.

**U7 Quiet recess, no re-litigation.** A failed, lapsed, or cancelled vote shows its
one line for about 2.5 s and withdraws. No try-again affordance exists; a new proposal
requires a fresh deliberate hold.

**U8 The venues.**

- **Web desktop, the Proscenium**: the room chrome strip above the grid transforms
  into the vote surface for the vote's life (proposer and question, chips, verbs),
  full grid width, and returns on close. The room's own chrome transforming is what
  keeps it from reading as a notification. Amendment: the band holds one fixed
  height through idle, open, resolution, and withdrawal — the clue strip yields for
  the surface's entire life and the swap is one-for-one; the board never moves a
  pixel on any vote transition.
- **Web mobile, best effort**: a slim strip docked above the active-clue bar. Same
  store and copy; no further ceremony owed. Compromises land here, never on
  desktop — but the ballot verb is never unreachable: past a few electors the chips
  collapse to a stack before a verb ever leaves the screen.
- **iOS and Android, the Card (rewritten at device tuning)**: the vote presents as
  a native centered card, blocking, in each platform's own material and idiom —
  deliberately simple: the proposal line, the elector pucks settling as ballots
  land, the two verbs. Casting a ballot is the card's exit; the resolution plays
  in the card (the calm line, the proposer's tally) before it withdraws, and a
  pass yields to the board for the wash. The strip-first Bench and every previous
  iOS vote surface are scrapped. iOS (wave 15.10, a fresh design) is the
  reference; Android copies the tuned card. A clue-browser or facts sheet
  collision still resolves in the vote's favor; a pending vote is never invisible.

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

A modal or center-stage lightbox **on web** (contradicts U2's web law; on the phones
the owner overruled this at device tuning — the Card is the venue); a corner card or
rail placement on desktop (sidelines the room's shared moment into notification
territory); a clue-bar takeover on mobile (the bar is the steering wheel of solving;
the vote may dock beside it, never take it); approve/reject language (U1); visible
countdown digits (manufactured anxiety); any rendered clock at all, the retired ring
included (U4); a try-again CTA after a failure (would turn the no-cooldown rule into
a spam affordance); rendering rejector identity in the resolution line (the chips
already told anyone watching; the summary should not immortalize it).
