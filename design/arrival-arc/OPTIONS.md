# The web arrival arc: three directions

The arrival arc is the whole public front door: the landing a stranger hits cold, the
sign-in and sign-up, and the handoff into a signed-in session. It gates launch more than
any single feature, because it is the only surface a first-time visitor judges the product
on before they have played anything.

Three flows have to work end to end, and the seam between them is the hard part:

- **(a) Cold stranger** lands on `crossy.party` with no context and no invite.
- **(b) Invitee** follows a room link, plays as a guest, and later upgrades to an account
  without losing their place.
- **(c) Returning user** is signed in and wants their rooms, fast.

What all three directions share, because the product already commits to it: one warm neutral
(Sand) and one accent (Gold), the display serif as the single confident gesture per screen,
the dashed rule as the structural device, Apple and Discord as the only providers (email
never gets a surface), and the guest-that-upgrades-in-place identity model (DESIGN.md §8).
Every direction reuses the shipping token set verbatim and the real 5x5 preview puzzle
(DASH / FORCE / ANGEL / SOUND / TREE) so a visitor on web sees the same crossword the iOS
demo runs.

The three directions differ on one question: **what is the hero of the front door?**

- **A, The Open Grid** answers: the game itself. A live, half-solved board is the landing.
- **B, The Broadsheet** answers: the argument. A confident editorial front page.
- **C, The Ticket** answers: the invitation. One physical ticket object carries every flow.

---

## Direction A — The Open Grid

**Thesis.** The product is a shared crossword that fills in as friends type. So show that,
literally, on the front door: the right half of the landing is a real, running board with a
teammate's letters already down, her cursor parked, and the active word lit in the shipping
board colors. It is not a screenshot and not an illustration; it is the same SVG grid the
solve screen paints, and the visitor can start typing into it. The argument for the product
is the product, demonstrated in four seconds without a word of marketing. This is the
space-age-optimism read: the grid as a warm, precise, alive object, confident enough to be
the whole pitch.

**End-to-end experience.**

- **(a) Cold stranger.** The serif lede states the one idea ("The grid fills up when a friend
  joins in"), and beside it the Monday Mini is already mid-solve: SOU down in 7-Across, a
  teammate chip named Bee, her cursor flag on the board, the active cell in the yellow the
  live board uses. A caption reads "Bee started this one and left it open. Type a letter to
  jump in." The stranger types; the caret moves; they are inside the product before they have
  decided anything. Primary action stays "Start a puzzle"; the board is the proof, not the CTA.
- **(b) Invitee.** The same idea, but now the board is the real room, live, and the right
  column is the ticket-tray: room name, host, a two-person roster with presence, and the fork
  (sign in to solve, or watch as a guest). Because the board is right there playing, "watch as
  a guest" is obviously safe: you can already see what watching gets you. The upgrade line is
  the load-bearing copy: "Watching keeps your seat. Sign in later and everything you saw is
  still here, under your name."
- **(c) Returning user.** They never see this; they land straight in the shell's home shelf
  (`Home.tsx`, unchanged). The Open Grid is the signed-out door only.

**Cost to build.** Highest of the three. The landing board is a genuine interactive surface,
so it wants the real grid renderer and a small canned session (the demo `fakeSession` and the
mini board already exist, so the letters, teammate, and cursor are real data, not a mock). The
"start typing" affordance needs a keyboard handler scoped to the hero. The invitee variant
needs the live room's board and roster rendered in the gate, which today shows a static ticket
card, so it is new gate wiring against the existing store. Two to three days of real front-end
work, plus the taste passes to keep the board from feeling like a toy.

**Risk.** A live board on the landing raises the bar for every other pixel; if the rest of the
page is quiet the board can read as a novelty widget rather than the hero. It also invites the
"interactive demo" cliche if the typing affordance is over-sold. On a phone the two-column
split collapses and the board has to lead, which needs its own layout. And a board that plays
on the landing but is not the visitor's real game can confuse ("did I just start something?"),
so the caption and the seams have to be exact.

**Borrows from the current app.** The SVG grid and board paint tokens, the `Silhouette`
renderer, the demo mini board and `fakeSession` teammate model, `AvatarStack` presence, the
`TopBar` panel recipe, and the existing gate copy voice. It is the most code-reuse-heavy
direction precisely because it reuses the live product on the door.

Files: `a-open-grid.landing.html`, `a-open-grid.invite.html` (+ PNGs).

---

## Direction B — The Broadsheet

**Thesis.** A crossword is a print object with a century of typographic dignity, so the front
door should read like the front page of a paper you would want to be seen holding. This is the
direction closest in spirit to the current landing (the oversized serif lockup, ranged left,
each line closed by a dashed rule) but pushed from a single hero line to a full composed page:
a masthead with a dateline, an engraved puzzle plate set beside the headline like a newspaper
cut, and a three-line running index at the foot that explains the product without a single
icon or feature card. Panton and Eames by way of editorial restraint. The confidence is in the
typesetting, not in motion or novelty.

**End-to-end experience.**

- **(a) Cold stranger.** The nameplate ("Crossy — The collaborative crossword"), then the lead
  headline "A puzzle reads better with company." set huge in the serif, closed by dashed rules.
  Beside it, a real solution-free 15x15 silhouette printed as an engraving with a caption
  ("Today · 15 x 15 · by A. Reyes"). One gold "Start a puzzle" and a quiet "See a finished one."
  Below the second heavy rule, a running index of three: bring your own puzzle, one link no
  accounts to chase, solve on any screen. No three-column icon grid; it is a newspaper's index,
  not a SaaS features section.
- **(b) Invitee.** The masthead stays; the lead becomes the invitation ("Marta invited you"),
  the plate becomes the room's own silhouette, and the sign-in column sits where the index was.
  It reuses the current gate's ticket feeling but keeps the broadsheet's editorial frame, so an
  invitee sees a consistent publication, not a different site.
- **(c) Returning user.** Straight to the home shelf. The sign-in page (`b-broadsheet.signin`)
  is its own full-page column: the value props ranged left in the serif, the Apple / Discord /
  guest card on the gold-cream face. It is the sign-up and sign-in surface both, since the
  providers are the same and there is no email form to distinguish them.

**Cost to build.** Lowest. It is a layout and typesetting exercise over primitives that already
ship: the serif lockup, the `Silhouette`, the dashed `Divider`, `SignInButtons` verbatim. No
new interactive surface, no store wiring on the landing. One to two days, most of it spent on
responsive behavior and getting the type scale to hold at the largest sizes.

**Risk.** It is the safe direction, so its ceiling is lower: done at 90% it is a very nice
crossword site, but it does not make the shared-play idea unmistakable the way a live board
does. The engraved plate is decorative; a stranger has to read the copy to understand
collaboration, where Direction A shows it. The masthead conceit can tip into pastiche if the
dateline and rules are played too literally.

**Borrows from the current app.** The most of any direction, by design. It is the current
landing's thesis, fully composed. The serif lockup, `Divider`, `Silhouette`, `TopBar`, and
`SignInButtons` all carry over with copy changes only.

Files: `b-broadsheet.landing.html`, `b-broadsheet.signin.html` (+ PNGs).

---

## Direction C — The Ticket

**Thesis.** The invite link is the product's actual growth engine: nobody arrives at a
collaborative solver cold, they arrive because a friend sent one. So make the invitation the
organizing object of the entire arrival arc. Every arrival screen is one physical ticket: two
stubs held by a perforation (the dashed rule, punched with notches), the pitch on the
gold-cream stub, the action on the plain tray. The cold landing is a blank ticket you fill by
starting a room; the invite is a named ticket with the room's silhouette as its stub art and
your friends on the roster; the returning user's shelf is a wall of these same tickets. One
object, three states, so the seam between the flows disappears: the invitee does not cross from
"a marketing page" into "a different app," they were always holding a ticket.

**End-to-end experience.**

- **(a) Cold stranger.** A blank ticket, centered. Stub: "Admit two, or ten. A crossword you
  don't solve alone," with three ticket facts (bring / invite / play on). Tray: "Start a room,"
  the gold "Create a game," a dashed fork to "Sign in to your rooms," and a stub-art line using
  the crossword mark as a stand-in for a barcode. The ticket metaphor is legible in one glance,
  which primes the invitee flow the visitor may hit later.
- **(b) Invitee.** The payoff. The identical ticket object, now a real invitation: "Marta
  invited you. Come solve this one with us," the room's silhouette printed as the stub cut, the
  room name and age, and a live roster ("Marta, host — solving; Jonah — solving"). The tray is
  the fork: Apple, Discord, or "Watch as a guest," under the keep-your-seat promise. Because the
  cold visitor already saw this exact object empty, the invite reads as their ticket filled in.
- **(c) Returning user.** Straight to the shelf. The `Home.tsx` room cards are already tickets
  in miniature (silhouette + name + facts), so the metaphor extends into the signed-in product
  for free; no new signed-in surface is required, only that the arrival tickets and the room
  cards rhyme, which they already nearly do.

**Cost to build.** Medium. The ticket is a bespoke composite (perforation, notches, two-tone
stubs) but it is static CSS over shipping tokens, no interactive surface. The invitee variant
maps cleanly onto the gate's existing data (room name, silhouette mask, roster, invite code)
and is close to what `LiveApp`'s gate renders today, so it is a re-skin of a real screen more
than new plumbing. Two days, most of it on the ticket component and its responsive collapse
(the two stubs stack vertically on a phone, perforation turns horizontal).

**Risk.** The metaphor is load-bearing, so if the ticket does not read as a ticket it reads as
an arbitrary two-panel card. Notches and perforations flirt with skeuomorphic cuteness, which
is exactly the AI-slop-adjacent move to avoid; the restraint has to be surgical (one dashed
rule, two notches, no drop-shadowed torn edges). It also leans hardest on the invite flow, so
for the meaningful share of cold strangers who arrive without an invite, the ticket is
metaphor-without-referent until they create a room.

Files: `c-ticket.landing.html`, `c-ticket.invite.html` (+ PNGs).

---

## Recommendation

**Lead with Direction A (The Open Grid), and carry Direction C's invitee ticket as the gate.**

The single most valuable thing the front door can do is make the shared-play idea undeniable in
the first four seconds, and only A does that by showing rather than telling. A stranger who
watches a letter land on a live board understands the entire product before reading a word; that
is worth the extra build cost because it is the exact thing a screenshot or a headline cannot
convey. B is the safe fallback and the fastest to ship, but its ceiling is "a handsome crossword
site," and the launch needs the door to sell the one idea competitors do not have.

The strongest synthesis is not one direction whole: it is **A's live board on the cold landing,
and C's ticket as the invitee gate.** The cold stranger needs the demonstration (A); the
invitee needs the named, personal, "your seat is waiting" object (C's ticket does this better
than A's tray). Both sit on the same tokens and the same serif, so they read as one system, and
the returning user's shelf already rhymes with the ticket. B's typesetting discipline should
govern both regardless: the serif lockup, the dashed rules, no icon grids.

If build budget forces a single direction: ship **B first** as the launch-blocker-clearing
minimum (it is one to two days and clears the door), then upgrade the landing to **A** and the
gate to **C** as fast-follows. B is the only direction that is fully done with copy changes over
shipping primitives, so it de-risks the launch date while the more ambitious surfaces land.

## Questions the owner must answer

1. **Live board on the landing: worth the cost?** A's hero is a real interactive board, the
   most expensive and most differentiating choice. Is the four-second demonstration worth two
   to three days over B's one to two, or does launch timing force the safe front page first?
2. **One direction, or the A+C synthesis?** Are we willing to run two composed objects (live
   board landing, ticket gate) that share a token system, or does the arc need one metaphor end
   to end for coherence?
3. **How far does "watch as a guest" get promoted?** Today the invite gate offers guest only
   when an invite code is present (a guest without one hits a 403). All three mockups lean on
   watching as the low-friction entry. Confirm guest-watch stays invite-scoped, and that the
   keep-your-seat upgrade promise is real end to end before it is stated this prominently.
4. **Does the cold landing need a create CTA at all, or only sign-in?** Creating a game requires
   a full account (DESIGN.md §8), so "Create a game" on a signed-out landing routes through
   sign-in first. Is that acceptable friction, or should the cold CTA be "Sign in" and creation
   live only behind the account?
5. **Motion.** The current app is deliberately calm (one board motion exception, no landing
   animation). Does the live board earn a small, restrained entrance (a letter settling, a
   cursor drift), or does it stay still and let presence be the only life on the page?
