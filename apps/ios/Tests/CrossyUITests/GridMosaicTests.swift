import XCTest

import CrossyDesign
import CrossyStore

@testable import CrossyUI

// The mosaic in its simple form (apps/ios/DESIGN.md §8; EXPERIENCE.md §6): tint,
// hold, settle. The envelope is pure math over elapsed time; the palette derives
// from the sequenced event log's writer attribution, ID-1 gated at the source.

final class GridMosaicTests: XCTestCase {
    // MARK: - The envelope (§8: tint, hold, settle)

    func test_envelope_tintHoldSettle_section8() {
        // Tint: rises from ink.
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: 0), 0)
        XCTAssertGreaterThan(MosaicEnvelope.intensity(elapsed: 0.1), 0)
        // Hold: full tint for a breath.
        let holdStart = MosaicEnvelope.riseDuration
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: holdStart), 1, accuracy: 0.001)
        XCTAssertEqual(
            MosaicEnvelope.intensity(
                elapsed: holdStart + MosaicEnvelope.holdDuration / 2), 1)
        // Settle: the LETTERS back to ink, and they stay there (the wash under
        // them rides its own clock below and never leaves).
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: MosaicEnvelope.duration), 0)
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: MosaicEnvelope.duration + 10), 0)
    }

    // The wash's clock (the flash-then-disappear fix): the same rise as the glyph
    // tint — one bloom, one clock — then 1 forever. The settled wash is the
    // completed board's record (web parity: the reveal arc ends at WASH); an
    // envelope that fell back to zero erased the fingerprint ~3 s after it
    // appeared, which was the bug.
    func test_envelope_washRisesWithTheTintAndStandsForever_section8() {
        XCTAssertEqual(MosaicEnvelope.washIntensity(elapsed: 0), 0)
        // One clock through the rise: wash and glyph bloom together.
        for step in 0...10 {
            let elapsed = MosaicEnvelope.riseDuration * Double(step) / 10
            XCTAssertEqual(
                MosaicEnvelope.washIntensity(elapsed: elapsed),
                MosaicEnvelope.intensity(elapsed: elapsed),
                accuracy: 1e-9, "rise t=\(elapsed)")
        }
        // The hold, the settle, and everything after: the wash stands.
        XCTAssertEqual(MosaicEnvelope.washIntensity(elapsed: MosaicEnvelope.clarityDuration), 1)
        XCTAssertEqual(MosaicEnvelope.washIntensity(elapsed: MosaicEnvelope.duration), 1)
        XCTAssertEqual(MosaicEnvelope.washIntensity(elapsed: MosaicEnvelope.duration + 3600), 1)
    }

    func test_envelope_riseAndSettleAreMonotonic_section8() {
        var previous = -0.001
        for step in 0...20 {
            let elapsed = MosaicEnvelope.riseDuration * Double(step) / 20
            let value = MosaicEnvelope.intensity(elapsed: elapsed)
            XCTAssertGreaterThanOrEqual(value, previous, "rise t=\(elapsed)")
            previous = value
        }
        previous = 1.001
        let settleStart = MosaicEnvelope.riseDuration + MosaicEnvelope.holdDuration
        for step in 0...20 {
            let elapsed = settleStart + MosaicEnvelope.settleDuration * Double(step) / 20
            let value = MosaicEnvelope.intensity(elapsed: elapsed)
            XCTAssertLessThanOrEqual(value, previous, "settle t=\(elapsed)")
            previous = value
        }
    }

    // The rise is the celebration register's response (DESIGN.md §7: celebration
    // is the one register allowed to breathe); the whole envelope is their sum.
    func test_envelope_phasesComposeTheDuration_section8() {
        XCTAssertEqual(MosaicEnvelope.riseDuration, Motion.Springs.celebrationResponse)
        XCTAssertEqual(
            MosaicEnvelope.duration,
            MosaicEnvelope.riseDuration + MosaicEnvelope.holdDuration
                + MosaicEnvelope.settleDuration,
            accuracy: 0.0001)
    }

    // The clarity beat (§4, §8): standing glass clears through tint and hold,
    // refrosts across the settle as the stats arrive.
    func test_envelope_clarityWindowCoversTintAndHold_section8() {
        XCTAssertEqual(
            MosaicEnvelope.clarityDuration,
            MosaicEnvelope.riseDuration + MosaicEnvelope.holdDuration, accuracy: 0.0001)
        XCTAssertFalse(MosaicEnvelope.isClarified(elapsed: -0.1))
        XCTAssertTrue(MosaicEnvelope.isClarified(elapsed: 0.01))
        XCTAssertTrue(MosaicEnvelope.isClarified(elapsed: MosaicEnvelope.clarityDuration - 0.01))
        XCTAssertFalse(MosaicEnvelope.isClarified(elapsed: MosaicEnvelope.clarityDuration + 0.01))
    }

    // MARK: - The palette (§8: every letter tints to its writer's color)

    private let participants = [
        GridPresence.ParticipantInput(
            userId: "you", displayName: "You", color: "#6F66D4", isSpectator: false),
        GridPresence.ParticipantInput(
            userId: "bee", displayName: "Bee", color: "#17917F", isSpectator: false),
    ]

    // The wire color is authoritative for slotting (the presence rule): each
    // writer's cell reads the roster slot the wire string names, not the local
    // hash of the user id.
    func test_colors_writerAttributionResolvesTheRosterColor_section8() {
        let colors = GridMosaic.colors(
            writers: [0: "you", 5: "bee"],
            participants: participants,
            ground: .studio,
            completionMosaicEnabled: true)
        XCTAssertEqual(colors[0], IdentityRoster.color(forWireColor: "#6F66D4")?.lightGround)
        XCTAssertEqual(colors[5], IdentityRoster.color(forWireColor: "#17917F")?.lightGround)
        // The local player tints like everyone else: the mosaic is the whole
        // room's fingerprint, self included.
        XCTAssertNotNil(colors[0])
    }

    // The dark ground reads the pair's other side (ID-8: twelve colors, paired
    // per ground), never a second slotting rule.
    func test_colors_groundReadsItsPairSide_section8() {
        let colors = GridMosaic.colors(
            writers: [3: "bee"],
            participants: participants,
            ground: .observatory,
            completionMosaicEnabled: true)
        XCTAssertEqual(colors[3], IdentityRoster.color(forWireColor: "#17917F")?.darkGround)
    }

    // A writer missing from the roster still tints, by the user-id hash fallback
    // (the presence rule): a late roster must not blank the fingerprint.
    func test_colors_unknownWriterFallsBackToTheHash_section8() {
        let colors = GridMosaic.colors(
            writers: [7: "ghost"],
            participants: participants,
            ground: .studio,
            completionMosaicEnabled: true)
        XCTAssertEqual(
            colors[7], GridGround.studio.rosterColor(IdentityRoster.color(for: "ghost")))
    }

    // ID-1: the completion mosaic is behind a single switch; muted derives
    // nothing, so no draw pass can leak a tint.
    func test_colors_mutedSwitchDerivesNothing_ID1() {
        let colors = GridMosaic.colors(
            writers: [0: "you", 5: "bee"],
            participants: participants,
            ground: .studio,
            completionMosaicEnabled: false)
        XCTAssertTrue(colors.isEmpty)
    }

    // MARK: - The isolation filter (§8: isolation on the settled wash)

    // No isolation is the full wash: the filter is pure presentation, absent by
    // default, so a room that never taps a legend row draws exactly as before.
    func test_isolation_nilIsTheFullWash_section8() {
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "you", isolation: nil, elapsed: 99), 1)
    }

    // Past the fade, the isolated solver's cells hold the full wash and every
    // other hand rests at the dim floor: recessed toward paper (a lower alpha
    // over the ground IS the step toward it), never erased.
    func test_isolation_isolatedKeepsTint_othersDimTowardPaper_section8() {
        let isolation = MosaicIsolation(solverId: "you", previousSolverId: nil, changedAt: 0)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "you", isolation: isolation, elapsed: 1), 1)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: 1),
            GridMosaic.isolationDim)
        XCTAssertGreaterThan(
            GridMosaic.isolationDim, 0, "dimmed, never erased: the record stays traceable")
        XCTAssertLessThan(GridMosaic.isolationDim, 1)
    }

    // The crossfade: the from-side at the toggle, the to-side by the fade's
    // end, monotone between — fast and quiet, a filter, not a celebration (and
    // already the §7 reduced-motion form: a pure opacity crossfade).
    func test_isolation_crossfadeIsMonotoneOverTheFade_section8() {
        let isolation = MosaicIsolation(solverId: "you", previousSolverId: nil, changedAt: 0)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: 0), 1)
        var previous = 1.001
        for step in 0...20 {
            let elapsed = GridMosaic.isolationFadeDuration * Double(step) / 20
            let value = GridMosaic.isolationMultiplier(
                owner: "bee", isolation: isolation, elapsed: elapsed)
            XCTAssertLessThanOrEqual(value, previous, "fade t=\(elapsed)")
            previous = value
        }
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(
                owner: "bee", isolation: isolation,
                elapsed: GridMosaic.isolationFadeDuration),
            GridMosaic.isolationDim)
    }

    // A switch (you -> bee): your hand fades down as bee's fades up, and a
    // third hand holds the floor with no pulse through the crossfade.
    func test_isolation_switchCrossfadesBothHands_section8() {
        let isolation = MosaicIsolation(
            solverId: "bee", previousSolverId: "you", changedAt: 0)
        let fade = GridMosaic.isolationFadeDuration
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "you", isolation: isolation, elapsed: 0), 1)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "you", isolation: isolation, elapsed: fade),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: 0),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: fade), 1)
        for step in 0...10 {
            let elapsed = fade * Double(step) / 10
            XCTAssertEqual(
                GridMosaic.isolationMultiplier(
                    owner: "cee", isolation: isolation, elapsed: elapsed),
                GridMosaic.isolationDim, "a third hand never pulses, t=\(elapsed)")
        }
    }

    // A clear (nil current) fades every hand back to the full wash; the
    // previously isolated hand was already there and stays put.
    func test_isolation_clearReturnsToTheFullWash_section8() {
        let isolation = MosaicIsolation(solverId: nil, previousSolverId: "you", changedAt: 0)
        let fade = GridMosaic.isolationFadeDuration
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: 0),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(owner: "bee", isolation: isolation, elapsed: fade), 1)
        XCTAssertEqual(
            GridMosaic.isolationMultiplier(
                owner: "you", isolation: isolation, elapsed: fade / 2), 1)
    }

    // MARK: - The attribution source (§8: derived entirely from the event log)

    // Sequenced letters tint; a cleared cell (by with no value) and a pending
    // overlay entry (INV-10 composite, not event log) never do.
    @MainActor
    func test_writers_sequencedLettersOnly_neverOverlayOrCleared_section8() {
        let store = GameStore(
            seed: .init(
                seq: 3, sync: .live,
                cells: [
                    0: .init(v: "S", by: "you"),
                    1: .init(v: nil, by: "bee"),  // cleared: clearer kept as by
                    2: .init(v: "L", by: nil),  // no attribution carried
                ],
                overlay: [.init(commandId: "c1", cell: 4, value: "X")]))
        let puzzle = GridPuzzle(rows: 3, cols: 3, blocks: [], circles: [], numbers: [:])
        let writers = CrossyGridView.sequencedWriters(store: store, puzzle: puzzle)
        XCTAssertEqual(writers, [0: "you"])
    }
}
