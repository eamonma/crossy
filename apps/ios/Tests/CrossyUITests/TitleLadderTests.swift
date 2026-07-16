import XCTest

@testable import CrossyUI

// The Titles display table's contract (design/post-game/TITLES.md; PROTOCOL.md §12
// titles row): the wire's {userId, title, evidence} resolves to render-ready cards, an
// unknown key from a newer server is dropped (the MUST-ignore rule, how the ladder
// grows without client lockstep), and evidence formats per rung semantics: counts as
// pluralized counts, the two whole-seconds rungs as M:SS, no-evidence rungs as their
// fixed line, and a numeric rung with a missing number drops the line rather than
// printing a blank. The copy is pinned string for string against the web's TITLE_COPY
// (apps/web/src/ui/titlesReadout.ts), the Wave 10.6 exit: the same room reads
// identically on both platforms. Twin of titlesReadout.test.ts.

final class TitleLadderTests: XCTestCase {
    private func card(_ key: String, _ evidence: Int?, userId: String = "u1") -> TitleCard? {
        TitleLadder.card(for: RoomTitle(userId: userId, key: key, evidence: evidence))
    }

    // MARK: - Coverage (the pinned ladder)

    func test_ladderCoversExactlyTheSixteenPinnedKeys_inLadderRankOrder() {
        // The TITLES.md ladder table, rank order: exactly the engine TITLE_LADDER's
        // keys, no more, no fewer (v1's fifteen plus the D29 fast-follow's marathoner
        // at rank 8). A ladder edit lands here as a failing diff.
        XCTAssertEqual(
            TitleLadder.keys,
            [
                "saboteur", "one-hit-wonder", "ice-breaker", "bullseye", "headliner",
                "sprinter", "meddler", "marathoner", "quick-starter", "closer",
                "specialist", "long-hauler", "wanderer", "scribbler", "collector",
                "workhorse",
            ])
        for key in TitleLadder.keys {
            // Every pinned key resolves to a card with a non-empty label, and an
            // evidence-bearing rung folds a number into a non-empty line (the web
            // sweep's shape assertion, titlesReadout.test.ts).
            let resolved = card(key, 7)
            XCTAssertNotNil(resolved, "\(key) is a pinned key and must have copy")
            XCTAssertFalse(resolved?.label.isEmpty ?? true, "\(key) must carry a label")
            XCTAssertNotNil(resolved?.detail, "\(key) must carry a detail line for evidence 7")
        }
    }

    func test_copyMatchesTheWebTableStringForString_wave106Exit() {
        // ROADMAP Wave 10.6: "copy and order matching web". These strings are the web's
        // TITLE_COPY verbatim (titlesReadout.ts); a drift on either side fails one of
        // the twin sweeps.
        let expected: [(key: String, evidence: Int?, label: String, detail: String?)] = [
            ("saboteur", 7, "The saboteur", "Overwrote 7 correct squares"),
            ("one-hit-wonder", nil, "The one-hit wonder", "One square, flawlessly chosen"),
            ("ice-breaker", 240, "The ice breaker", "Ended the room's 4:00 silence"),
            ("bullseye", 9, "The bullseye", "9 squares, none wrong"),
            ("headliner", 3, "The headliner", "Led 3 of the long ones"),
            ("sprinter", 9, "The sprinter", "9 squares in 30 seconds"),
            ("meddler", 2, "The meddler", "Finished 2 words others started"),
            ("marathoner", 3, "The marathoner", "Showed up for all 3 sittings"),
            ("quick-starter", 8, "The quick starter", "8 squares in the opening stretch"),
            ("closer", 5, "The closer", "5 squares in the closing stretch"),
            ("specialist", 11, "The specialist", "Kept to one corner, 11 squares"),
            ("long-hauler", 1572, "The long hauler", "On the case for 26:12"),
            ("wanderer", nil, "The wanderer", "Roamed the whole grid"),
            ("scribbler", 61, "The scribbler", "Busiest pencil, 61 letters down"),
            ("collector", 17, "The collector", "Had a hand in 17 words"),
            ("workhorse", 42, "The workhorse", "42 squares filled"),
        ]
        XCTAssertEqual(expected.map(\.key), TitleLadder.keys, "the sweep covers the whole ladder")
        for entry in expected {
            let resolved = card(entry.key, entry.evidence)
            XCTAssertEqual(resolved?.label, entry.label, entry.key)
            XCTAssertEqual(resolved?.detail, entry.detail, entry.key)
        }
    }

    // MARK: - Evidence semantics (TITLES.md ladder table)

    func test_countRungsPluralize_oneSquareNeverOneSquares() {
        XCTAssertEqual(card("quick-starter", 1)?.detail, "1 square in the opening stretch")
        XCTAssertEqual(card("quick-starter", 8)?.detail, "8 squares in the opening stretch")
        XCTAssertEqual(card("scribbler", 1)?.detail, "Busiest pencil, 1 letter down")
        XCTAssertEqual(card("collector", 1)?.detail, "Had a hand in 1 word")
        XCTAssertEqual(card("meddler", 2)?.detail, "Finished 2 words others started")
        XCTAssertEqual(card("workhorse", 1)?.detail, "1 square filled")
        XCTAssertEqual(card("saboteur", 1)?.detail, "Overwrote 1 correct square")
        // The marathoner's evidence is the sitting count, floored at 2 by its gate
        // (TITLES.md rank 8), so the plural branch is the only one the wire can reach.
        XCTAssertEqual(card("marathoner", 2)?.detail, "Showed up for all 2 sittings")
        XCTAssertEqual(card("marathoner", 5)?.detail, "Showed up for all 5 sittings")
    }

    func test_wholeSecondsRungsRenderMSS_iceBreakerStallAndLongHaulerSpan() {
        // The web's formatMSS: seconds floored, hours split out past sixty minutes.
        XCTAssertEqual(card("ice-breaker", 240)?.detail, "Ended the room's 4:00 silence")
        XCTAssertEqual(card("ice-breaker", 150)?.detail, "Ended the room's 2:30 silence")
        XCTAssertEqual(card("long-hauler", 1572)?.detail, "On the case for 26:12")
        // A floor rung can land on a single-fill solver whose span is 0 (the TITLES.md
        // coverage rule), and a multi-sitting span can cross an hour.
        XCTAssertEqual(card("long-hauler", 0)?.detail, "On the case for 0:00")
        XCTAssertEqual(card("long-hauler", 3700)?.detail, "On the case for 1:01:40")
    }

    func test_nullEvidenceOnANumericRungDropsTheLine_neverPrintsABlank() {
        // The web's withCount: null in, null out; the card still renders label + name.
        let resolved = card("saboteur", nil)
        XCTAssertEqual(resolved?.label, "The saboteur")
        XCTAssertNil(resolved?.detail, "a missing number drops the line")
    }

    func test_noEvidenceRungsCarryTheirFixedLine_whateverTheWireSays() {
        // The two no-evidence rungs read the same off null or an unexpected number:
        // their claim is the whole line (the web's () => fixed-copy shape).
        XCTAssertEqual(card("one-hit-wonder", nil)?.detail, "One square, flawlessly chosen")
        XCTAssertEqual(card("one-hit-wonder", 3)?.detail, "One square, flawlessly chosen")
        XCTAssertEqual(card("wanderer", nil)?.detail, "Roamed the whole grid")
        XCTAssertEqual(card("wanderer", 12)?.detail, "Roamed the whole grid")
    }

    // MARK: - Forward compatibility (PROTOCOL §12: a client MUST ignore an unknown key)

    func test_unknownTitleKeyResolvesToNoCard_protocolSection12MustIgnore() {
        // A newer server's ladder grew (as it did with marathoner, once this test's own
        // unknown example): the older client drops the award and keeps the rest, never
        // a crash and never a placeholder.
        XCTAssertNil(card("night-owl", 5))
        XCTAssertNil(card("not-a-title", nil))
        XCTAssertNil(card("", 1))
        // The panel's exact derivation: compactMap keeps the known awards in wire order.
        let titles = [
            RoomTitle(userId: "u-noor", key: "night-owl", evidence: 5),
            RoomTitle(userId: "me", key: "workhorse", evidence: 12),
            RoomTitle(userId: "u-jia", key: "not-a-title", evidence: nil),
        ]
        XCTAssertEqual(titles.compactMap(TitleLadder.card(for:)).map(\.userId), ["me"])
    }

    func test_emptyTitlesYieldNoCards_theSoloRuleRendersNoSection() {
        // A solo solve (or an older API) ships no titles; the panel gates its "Titles"
        // header on the resolved cards, so no card means no section, never an empty box.
        XCTAssertEqual([RoomTitle]().compactMap(TitleLadder.card(for:)), [])
    }

    func test_cardsKeepTheWireOrder_ladderRankNeverReordered() {
        // The server orders by ladder rank; reordering client-side would fork the two
        // platforms' surfaces (titlesReadout.ts carries the same rule).
        let titles = [
            RoomTitle(userId: "b", key: "workhorse", evidence: 42),
            RoomTitle(userId: "a", key: "saboteur", evidence: 7),
        ]
        XCTAssertEqual(
            titles.compactMap(TitleLadder.card(for:)).map(\.userId), ["b", "a"],
            "wire order rides through, whatever the keys' ladder ranks")
    }
}
