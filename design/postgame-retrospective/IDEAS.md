# Post-game retrospective: the idea space

Status: ideation, for owner cull. Not a design doc.

Chess.com hands you an accuracy graph, move-by-move replay, brilliancies and blunders,
and a shareable summary. The crossword-room equivalent is unexplored because nobody
else has the data: `cell_events` is a full per-cell attribution log (who wrote what,
where, when, in server order), the server holds the solution, and the room is a team.
NYT gives solo stats; chess sites analyze one player against another. Cooperative
analytics is open ground.

Ground rules every idea below respects:

- **Everything is a server-computed projection.** The comparator lives server-side
  (INV-6), so any correctness-derived stat (wrongness over time, saves, poison fills)
  is computed on the server and shipped as derived data, never client-derived. For a
  completed game the final board equals the solution and members saw every event live,
  so replaying events and shipping wrongness masks post-completion leaks nothing new.
  For an abandoned or ongoing game, any wrongness signal leaks solution bits; those
  projections are completed-games-only unless the owner rules otherwise.
- **Attribution is design material, not a nuisance.** Last-writer and first-correct
  tell different stories. A comeback square (wrong for minutes, finally fixed) has a
  poisoner and a fixer. Every idea states which attribution it uses when it matters.
- The v3 mining report (reports/v3-mining.md §2a) already sketched a contribution map,
  effort heatmap, and solve replay; D16 kept the event log for exactly this. Those
  appear below as the floor, not the ceiling.

Data tags: `[events]` cell_events only (plus puzzle geometry/clues, which clients
already have). `[+timer]` also needs game_state timestamps. `[+capture]` needs new
capture (cursor traces, check-request log, presence log, reactions: all ephemeral
today by D20, so persisting them is a real decision). Cost: S / M / L.

Top 8 picks are marked **TOP** with a one-line why. Social-toxicity risks are flagged
inline; the line itself is named in its own section near the end.

---

## 1. The replay

**1. The time-lapse.** The grid fills itself in each writer's color, dead time
compressed, the whole solve in 30 to 90 seconds. This is the foundation every
annotation below rides on, and the thing people will point a phone at. `[events]` M.
**TOP: the substrate for everything else, and independently the most rewatchable
artifact.**

**2. Scrubbable timeline with chapters.** A scrub bar with auto-detected chapter
marks: first fill, each region falling, the long stall, the endgame, the finish.
Scrub to any moment and see the exact board, who was writing, what was still wrong.
`[events]` M (given 1, S).

**3. Speed ramps that know the story.** The auto-cut slows down at drama (the save,
the last holdout, a cascade) and sprints through the grind, chess.com's "key moments"
as pacing rather than a list. Requires the drama detectors in section 5. `[events]` M.

**4. The wrongness layer.** A replay toggle that tints cells while their then-current
value fails the comparator: watch the poison spread and get cleaned up.
Server-computed per-tick mask, completed games only (see ground rules). `[events]` M.

**5. Player isolation.** Solo a player: watch only Dan's letters land on a ghosted
board. Instantly shows his path through the grid and makes "you did all of the NE"
checkable. `[events]` S given 1.

**6. Ghost race.** Replay two event streams on the same puzzle side by side or as a
ghost overlay: this room versus its past self, or versus another room. Needs a second
game on the same puzzle, which extension-ingested dailies make plausible. `[events]` M.

**7. Solve-order path.** A static alternative to video: arrows trace the route the
room took through the grid, words numbered in the order they fell. Constructors and
solvers both read these like hiking maps. `[events]` S.

## 2. Individual stories

**8. The contribution mosaic.** The finished grid tinted per cell by its owner, with
a toggle between last-writer and first-correct attribution because they tell different
stories (the closer versus the pioneer). This is v3's contribution map; it becomes the
game's trophy image (idea 33). `[events]` S. **TOP: identity, attribution, and the
share artifact in one object.**

**9. Stat lines.** Per player: cells claimed (first-correct), saves (fixed someone
else's wrong cell), self-corrections, longest correct streak, fastest burst
(cells per minute over their best 60 seconds). The box score under the highlight reel.
`[events]` S.

**10. Archetype titles.** Every player gets exactly one earned title from their event
pattern: The Pioneer (first letters into untouched words), The Closer (finished what
others started), The Long-Hauler (long answers), The Fixer (most saves), The Sprinter
(best burst). Titles, never rankings, and the vocabulary is all-positive by
construction; "The Liability" is funny exactly once. `[events]` M. **TOP: the
screenshot-bait line of the recap, and safe because it compares nobody.**
Toxicity flag: the title list is the safety mechanism; any negative title breaks it.

**11. Personal bests, in-room.** "Your fastest word this game," "your longest streak,"
"your first-try accuracy on your own fills." Private-feeling numbers that never
compare players to each other on the same screen. `[events]` S.

**12. The signature square.** Auto-pick each player's single best moment (their save,
their cascade-starter, their leap of faith) and name it with the clue text: "Priya's
square: 24-Down, MERINGUE, filled with two crossings after a 6-minute stall."
`[events]` M.

## 3. Team dynamics

**13. The assist graph.** Who unblocked whom: player A fills a crossing letter, player
B completes the stalled word within a window, edge A to B. Rendered as a small directed
graph with an assist leader. This is the genuinely new cooperative stat; chess has
nothing like it and neither does NYT. `[events]` M. **TOP: the co-op differentiator
made visible; the stat this product uniquely can compute.**

**14. Cascade chains.** The dominoes: one fill triggering N word completions inside a
window, credited to the initiator. "Ana's K at 12-Down knocked over four answers."
The crossword's tactical shot, and a natural `!!` candidate (idea 24). `[events]` M.

**15. Parallel versus pile-up.** A timeline lane per player colored by grid region:
did the room divide and conquer or swarm one corner? One derived number, the co-op
index (share of words touched by 2+ writers), says whether this was a team solve or
four parallel solitaires. `[events]` M.

**16. Handoffs.** Words started by one player and finished by another, versus solo
words. The relay stat: longest alternating-writer chain within one word gets a
callout. `[events]` S.

**17. Territory map.** The grid partitioned by dominant writer into regions: who owned
the NE, who owned the theme entries. A coarser, funnier cut of the mosaic that reads
at a glance. `[events]` S.

**18. The overwrite ledger.** Same-cell battles: who flipped whom, how often, and who
turned out to be right (the server knows). Framed as comedy ("Dan flipped Ana's E to
I; it was E") it is the best banter generator in the whole list. `[events]` M.
Toxicity flag: "who was right" is a per-person error count in disguise; keep it
per-moment, never aggregated into a season-long wrongness tally.

**19. The empty chair.** What fell while you were disconnected: "you missed the whole
SW corner." Presence is ephemeral today (D20), so this needs a persisted
connect/disconnect log. `[+capture]` M.

## 4. Difficulty forensics

**20. Clue leaderboard of pain.** The five clues that stalled the room longest,
measured from first write in the word to the word going final-correct, with clue text
inline. Without cursor capture, "first attention" is approximated by first write; a
cursor trace would sharpen it to true dwell. `[events]` S, sharper with `[+capture]`.
**TOP: the cheapest stat with table-talk built in ("THAT clue cost us nine
minutes").**

**21. The struggle heatmap.** Per-cell tint by edit count, distinct writers, or
wrong-time (how long the cell held a failing value), the v3 effort heatmap grown a
third, server-computed toggle. Shows where the puzzle fought back. `[events]` S.

**22. The last holdout.** Every game has a final square. How long it stood empty or
wrong, which crossings framed it, who finally filled it, and with how much of the
room watching. The natural closing beat of every recap. `[events]` S. **TOP: a
guaranteed story in 100% of games at trivial cost.**

**23. Phase breakdown.** The crossword's opening, middlegame, endgame: time to 25%
filled, 25 to 75, and the last 25% (which is almost always the longest). One bar with
three segments; rooms will learn their shape. `[+timer]` S.

**24. The momentum graph.** Fill rate over time, the room's heartbeat: spikes are
cascades, plateaus are stalls, and the finish is a cliff. This is the accuracy-graph
equivalent, one line that summarizes the whole game and anchors the recap screen.
`[events]` S. **TOP: chess.com's single most-screenshotted element, translated, at S
cost.**

**25. Check forensics.** Which words drove Check requests and whether Check bailed the
room out or confirmed what they knew. `checkRequest` never enters `cell_events`, so
this needs a persisted check log. `[+capture]` M.

**26. Puzzle-relative difficulty.** Your room's stall map versus all rooms on the same
puzzle: "everyone dies at 24-Down" or "only us." Needs enough rooms per puzzle;
extension-ingested dailies could get there. Aggregate and anonymous across rooms, or
it becomes surveillance. `[events]` M.

## 5. Drama annotations (the brilliant/blunder layer)

**27. Badged moments.** The chess vocabulary, translated: `!!` the save (fixing a
long-wrong cell that unlocked crossings), `!` the leap of faith (long answer, first
try, few crossings present), `?!` the confident gamble that happened to work, `??` the
poison fill (wrong entry that others extended into wrong crossings). Server-detected,
pinned to the timeline and the recap. Annotate moments, never people: no per-player
badge counts, ever. `[events]` M. **TOP: this is the soul of the chess.com recap, and
each badge has a real crossword-native detector.**
Toxicity flag: a `??` names a moment; a "blunders per player" table names a scapegoat.

**28. The poison trace.** For the game's worst wrong fill: the blast radius. Which
crossing entries went wrong because of it, how long the infection lasted, who
disinfected it. Told well this is the game's villain-arc-and-redemption story.
`[events]` M.

**29. The leap of faith.** The correct long answer entered with the fewest crossing
letters on the board, scored by percent-of-crossings-empty at fill time. The purest
crossword brilliancy: knowledge with no scaffolding. `[events]` S.

**30. The comeback square.** Cells wrong for more than N minutes and finally fixed:
duration, what it blocked, and the fix moment. The prompt's own example, and the best
single-square story the log can tell. `[events]` M.

**31. The near-miss reel.** The board at one-cell-from-done, frozen; then how long
that last cell actually took. If two players raced the final cells within seconds,
call the photo finish by seq order, which the server owns. `[events]` S.

## 6. Longitudinal (across games)

**32. Room history.** This crew's page: solve times by puzzle size, streaks (games
and weeks in a row), total squares filled together, the all-time assist graph. The
room, not the player, is the unit with a record. `[events]` M.

**33. Crossy Wrapped.** The annual recap: squares typed, most-assisted teammate, your
dominant archetype, the year's best save replayed. Seasonal, viral, and entirely a
query over data that already exists. `[events]` L.

**34. Rivalry cards.** Head-to-head between two friends across games: assists to each
other, overwrites of each other, words co-finished. Opt-in by both parties, framed as
a duo profile ("you two co-finish 40% of your words") rather than a versus record.
`[events]` M. Toxicity flag: "versus" framing turns a friendship into a ledger;
duo framing is the safe half of the same data.

**35. Solver rating (Glicko-style).** A real skill rating per player from
contribution-weighted solves. Named because the owner asked whether it is wise: it is
the highest-risk item on this list. A visible individual rating converts a living room
into a ladder and makes the weakest solver's contribution legible as a cost.
If rating exists at all: rate the room against its own past, or make individual
ratings private-to-self, never room-visible. `[events]` L. Toxicity flag: this is
the line itself; see the section below.

**36. Room form.** The team-rating alternative: this room versus its own history,
"your fastest medium grid yet," "three solves this week." All competition stays
internal to the group and points at the group. `[+timer]` M.

## 7. Shareable artifacts

**37. The trophy card.** An OG-style card: the contribution mosaic in room colors
(geometry and tint only, no letters, so it spoils nothing outside the room), solve
time, crew names, date. Rides the existing satori OG pipeline. `[events]` M.
**TOP: the fridge-door object; the thing that recruits the next room.**

**38. The filmstrip.** Four frames, the board at 25/50/75/100% as color silhouettes,
with the momentum line under them. The static share for people who will not tap play.
`[events]` M.

**39. The animated share.** The time-lapse as a short MP4/GIF for the group chat,
colors-only by default with a letters toggle (letters spoil the puzzle for anyone who
has not solved it). `[events]` L.

**40. The clue quote card.** Text-only: the clue that broke the room, minutes stalled,
and who cracked it. Reads like a joke format, lands in any chat, costs almost nothing.
Answer text optional and off by default (spoilers). `[events]` S.

**41. The challenge link.** Every share card doubles as "race this room's ghost on
the same puzzle." Collides with the acquisition posture (uploads are private to the
uploader, D21), so the challenged party must bring their own copy or the puzzle must
be shareable; that fight is why this is tagged L. `[events]` L.

## 8. Party and spectator

**42. The post-credits sequence.** In party mode the recap plays on the projector
automatically after the confetti: momentum line drawing itself, awards revealed one at
a time, the last-holdout story told with the room watching. Designed for a crowd and a
couch, not a scroll. `[events]` M.

**43. Spectator predictions.** During play, spectators tap predictions ("NE falls
next," "Ana gets the theme answer") and the recap scores them. Gives spectators a
game of their own and the recap a second cast. `[+capture]` L.

**44. Crowd awards.** After the computed awards, the spectators vote: MVP, best save,
funniest overwrite, chosen from the auto-detected moment list. Human awards beside
machine awards; disagreement is the fun. `[+capture]` M.

**45. The applause track.** Spectator reactions captured with timestamps during play,
replayed as a crowd layer on the time-lapse: the recap literally carries the room's
noise. `[+capture]` M.

## 9. The reveal (sound, haptics, choreography)

**46. The mosaic melt.** The recap does not open on a dashboard. After the confetti
settles, the solved board flips cell by cell from letters to writer colors, sweeping
in solve order, with an accelerating haptic tick per flip on iOS like a riffled deck.
The board becomes the mosaic in front of you; stats follow. `[events]` S/M.
**TOP: the reveal is the product; this one moment decides whether anyone stays for
the rest.**

**47. Dealt cards.** Awards and stat lines deal onto the screen with stagger, each
player's card landing in their color with its own haptic weight. Cheap, native
(iOS spring animations), and it gives every award a beat instead of a list.
`[events]` S.

**48. Open on the holdout.** Reverse-chronology opening: the whole board dark except
the last square, its story told first (how long, who cracked it), then zoom out and
run the time-lapse from the start. A choreography rule, not a feature. `[events]` S.

**49. The solve as sound.** Sonify the event log: each player an instrument, pitch by
grid row, tempo by real event spacing. Every solve gets a 20-second audio signature,
attachable to the share card. Weird, memorable, and nobody else can make it because
nobody else has the log. `[events]` L.

**50. Scrub haptics.** Scrubbing the replay timeline plays each event as a tick,
intensity scaled by cascade size, so the stall and the avalanche feel different under
your thumb before you see them. `[events]` S.

**51. The synchronized reveal.** The recap advances in lockstep for everyone still in
the room (host-paced or auto), over the existing WebSocket, so the MVP card lands on
every screen at the same instant and the gasp is shared. Solo viewers who open it
later get self-paced scroll. `[events]` M.

---

## Top 8, gathered

1. **The time-lapse (1)**: the substrate for everything else, and independently the
   most rewatchable artifact.
2. **The momentum graph (24)**: the accuracy-graph translation, one line that
   summarizes the game, at S cost.
3. **The contribution mosaic (8)**: identity, attribution, and the share artifact in
   one object.
4. **The last holdout (22)**: a guaranteed story in every single game, trivially
   cheap.
5. **Badged moments (27)**: the chess.com soul, with real crossword-native detectors
   behind each badge.
6. **The assist graph (13)**: the cooperative stat only this product can compute; the
   differentiator made visible.
7. **Archetype titles (10)**: the screenshot line of the recap, safe by an
   all-positive vocabulary.
8. **The mosaic melt reveal (46)**: the reveal is the product; this moment earns the
   rest of the recap its audience.

## Where the toxicity line is

The data can rank friends; the product must not. The line, concretely: **moments may
be judged, people may not be scored against each other.** A `??` on a fill at 19:42 is
a story; a blunder count per player is a scapegoat table. Titles and personal bests
compare a player to themselves; leaderboards and visible ratings compare friends to
each other, and the weakest solver in every room reads them as "you are the reason we
are slow." Flagged above: the overwrite ledger (18, no aggregated wrongness tallies),
rivalry cards (34, duo framing not versus), and the Glicko rating (35, the line
itself: room-level or private-to-self if it exists at all). Aggregate cross-room
stats (26) stay anonymous. Everything else on this list compares a player to
themselves, a moment to other moments, or the room to its past, which is safe ground.

## Questions the owner must answer first

1. **The attribution law.** When the recap credits a cell, is it first-correct,
   last-writer, or both with a toggle? And when a save happens, is the original
   writer named or anonymous? This one ruling shapes the mosaic, every stat line,
   every award, and the ledger.
2. **Where exactly is the negativity line?** Are per-person error counts ever shown,
   even inside the room, even for one game? Is any individual number ever placed next
   to another player's? Does a rating exist in any form (room-level, private-to-self,
   none)? Rule once, and every idea above either passes or dies cleanly.
3. **Do abandoned games get a recap?** Wrongness projections on an unfinished board
   leak solution bits (INV-6), so the honest options are: no recap, a wrongness-free
   recap, or recap-on-abandon reveals nothing until someone completes the puzzle.
4. **Is the recap a shared live moment or a private artifact?** Synchronized
   choreography (42, 46, 51) and the self-paced scroll pull in different directions;
   the design budget goes to one of them first.
5. **Which new captures are worth their cost?** Cursor traces, check-request logs,
   presence logs, and spectator reactions are all ephemeral today by D20. Persisting
   cursors especially is a real decision (it records where people looked, not just
   what they did), and it upgrades roughly a third of the ideas above.
