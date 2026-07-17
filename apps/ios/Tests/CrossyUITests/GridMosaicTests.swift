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
        // Settle: the LETTERS back to ink, and they stay there. The crisp wash
        // rides this same clock and melts out with them; the blurred field
        // below stands instead (fieldIntensity).
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: MosaicEnvelope.duration), 0)
        XCTAssertEqual(MosaicEnvelope.intensity(elapsed: MosaicEnvelope.duration + 10), 0)
    }

    // The melt (ratified 2026-07-17, the wash-blur study): the blurred FIELD is
    // the record now, and the flash-then-disappear guard moved with it. Zero
    // through the tint and the hold, breathing in across the settle a beat
    // after the crisp cells start letting go, then 1 forever — an envelope
    // that fell back to zero erased the fingerprint ~3 s after it appeared,
    // which was the bug.
    func test_envelope_fieldMeltsInAcrossTheSettleAndStandsForever_section8() {
        let settleStart = MosaicEnvelope.riseDuration + MosaicEnvelope.holdDuration
        XCTAssertEqual(MosaicEnvelope.fieldIntensity(elapsed: 0), 0)
        XCTAssertEqual(MosaicEnvelope.fieldIntensity(elapsed: settleStart), 0)
        // The melt waits out its delay (web parity: the 120 ms transition
        // delay), then rises. One ulp of float noise at the exact boundary is
        // tolerated, the ConfettiEnvelope discipline.
        XCTAssertEqual(
            MosaicEnvelope.fieldIntensity(elapsed: settleStart + MosaicEnvelope.fieldDelay), 0,
            accuracy: 1e-9)
        XCTAssertGreaterThan(
            MosaicEnvelope.fieldIntensity(
                elapsed: settleStart + MosaicEnvelope.fieldDelay + 0.1), 0)
        // At the envelope's own landing the ease-out is sub-perceptually shy of
        // 1 (the fade's tail runs the delay past the settle); the settled draw
        // pass paints the exact resting weight, so the pause frame lands it.
        XCTAssertGreaterThan(
            MosaicEnvelope.fieldIntensity(elapsed: MosaicEnvelope.duration), 0.99)
        // Past the fade, and forever after: the field stands.
        let fadeEnd =
            settleStart + MosaicEnvelope.fieldDelay + MosaicEnvelope.fieldFadeDuration
        XCTAssertEqual(MosaicEnvelope.fieldIntensity(elapsed: fadeEnd), 1)
        XCTAssertEqual(MosaicEnvelope.fieldIntensity(elapsed: fadeEnd + 3600), 1)
    }

    func test_envelope_fieldMeltIsMonotone_section8() {
        var previous = -0.001
        for step in 0...40 {
            let elapsed = (MosaicEnvelope.duration + 1) * Double(step) / 40
            let value = MosaicEnvelope.fieldIntensity(elapsed: elapsed)
            XCTAssertGreaterThanOrEqual(value, previous, "melt t=\(elapsed)")
            previous = value
        }
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

    // MARK: - The settled field (§8: the blurred record, ratified 2026-07-17)

    // The ratified tokens, cross-platform parity (web ContributionMosaic and
    // the Android port render the same numbers): settled alpha 0.5, gaussian
    // radius 20/36 of the cell module (20 module units on the 36-unit cell),
    // edge overscan 1.5 radii. `washAlpha` stays the bloom's crisp 0.3 — and
    // web's time-gated replay weight (mosaicReveal.ts WASH_ALPHA) — so the
    // settled weight is a NEW constant, never a bump.
    func test_settledField_ratifiedTokens_webParity() {
        XCTAssertEqual(GridMosaic.settledAlpha, 0.5)
        XCTAssertEqual(GridMosaic.washAlpha, 0.3)
        XCTAssertEqual(GridMosaic.fieldBlurFraction, 20.0 / 36.0)
        XCTAssertEqual(GridMosaic.fieldBlurRadius, 20, accuracy: 1e-9)
        XCTAssertEqual(GridMosaic.fieldOverscanFactor, 1.5)
        XCTAssertGreaterThanOrEqual(
            GridMosaic.fieldOverscan, 1.5 * GridMosaic.fieldBlurRadius,
            "edge saturation: overscan at least 1.5 radii past the frame")
    }

    // Edge saturation: edge cells' tint rects extend outward past the frame
    // before blurring (the layer clips back to the board), so the field holds
    // full strength at the frame; interior cells are exactly the cell module.
    func test_settledField_overscanGeometry() {
        // 3x3 board: 4 is the center, 0 the top-left corner, 5 the trailing
        // edge, 7 the bottom edge.
        XCTAssertEqual(
            GridMosaic.fieldRect(4, rows: 3, cols: 3), GridModule.cellRect(4, cols: 3))
        let over = GridMosaic.fieldOverscan
        let unit = GridModule.unit
        let corner = GridMosaic.fieldRect(0, rows: 3, cols: 3)
        XCTAssertEqual(corner.minX, -over)
        XCTAssertEqual(corner.minY, -over)
        XCTAssertEqual(corner.maxX, unit)
        XCTAssertEqual(corner.maxY, unit)
        let trailing = GridMosaic.fieldRect(5, rows: 3, cols: 3)
        XCTAssertEqual(trailing.minX, 2 * unit)
        XCTAssertEqual(trailing.maxX, 3 * unit + over)
        XCTAssertEqual(trailing.minY, unit)
        let bottom = GridMosaic.fieldRect(7, rows: 3, cols: 3)
        XCTAssertEqual(bottom.maxY, 3 * unit + over)
        XCTAssertEqual(bottom.minX, unit)
    }

    // MARK: - The isolation filter (§8: the crisp spotlight over the settled record)

    // No isolation is the blurred field, whole: the field multiplier rests at
    // 1 and the crisp spotlight paints nothing.
    func test_isolation_nilIsTheBlurredField_section8() {
        XCTAssertEqual(GridMosaic.fieldMultiplier(isolation: nil, elapsed: 99), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: nil, elapsed: 99), 0)
    }

    // Past the fade, the field has yielded (a blurred single hand has no shape
    // to read) and the crisp spotlight stands: the isolated solver's cells at
    // the full settled weight, every other hand at the dim floor — recessed
    // toward paper (a lower alpha over the ground IS the step toward it),
    // never erased.
    func test_isolation_spotlightKeepsIsolated_othersDimTowardPaper_section8() {
        let isolation = MosaicIsolation(solverId: "you", previousSolverId: nil, changedAt: 0)
        XCTAssertEqual(GridMosaic.fieldMultiplier(isolation: isolation, elapsed: 1), 0)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: 1), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "bee", isolation: isolation, elapsed: 1),
            GridMosaic.isolationDim)
        XCTAssertGreaterThan(
            GridMosaic.isolationDim, 0, "dimmed, never erased: the record stays traceable")
        XCTAssertLessThan(GridMosaic.isolationDim, 1)
    }

    // The crossfade: field and spotlight cross on one clock, the from-side at
    // the toggle, the to-side by the fade's end, monotone between — fast and
    // quiet, a filter, not a celebration (and already the §7 reduced-motion
    // form: a pure opacity crossfade).
    func test_isolation_crossfadeIsMonotoneOverTheFade_section8() {
        let isolation = MosaicIsolation(solverId: "you", previousSolverId: nil, changedAt: 0)
        XCTAssertEqual(GridMosaic.fieldMultiplier(isolation: isolation, elapsed: 0), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: 0), 0)
        var previousField = 1.001
        var previousSpot = -0.001
        for step in 0...20 {
            let elapsed = GridMosaic.isolationFadeDuration * Double(step) / 20
            let field = GridMosaic.fieldMultiplier(isolation: isolation, elapsed: elapsed)
            XCTAssertLessThanOrEqual(field, previousField, "field t=\(elapsed)")
            previousField = field
            let spot = GridMosaic.spotlightMultiplier(
                owner: "you", isolation: isolation, elapsed: elapsed)
            XCTAssertGreaterThanOrEqual(spot, previousSpot, "spotlight t=\(elapsed)")
            previousSpot = spot
        }
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(
                owner: "bee", isolation: isolation,
                elapsed: GridMosaic.isolationFadeDuration),
            GridMosaic.isolationDim)
    }

    // A switch (you -> bee): the field stays hidden with no pulse, your hand
    // fades down as bee's fades up, and a third hand holds the floor.
    func test_isolation_switchCrossfadesBothHands_section8() {
        let isolation = MosaicIsolation(
            solverId: "bee", previousSolverId: "you", changedAt: 0)
        let fade = GridMosaic.isolationFadeDuration
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: 0), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: fade),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "bee", isolation: isolation, elapsed: 0),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "bee", isolation: isolation, elapsed: fade),
            1)
        for step in 0...10 {
            let elapsed = fade * Double(step) / 10
            XCTAssertEqual(
                GridMosaic.fieldMultiplier(isolation: isolation, elapsed: elapsed),
                0, "the field never pulses through a switch, t=\(elapsed)")
            XCTAssertEqual(
                GridMosaic.spotlightMultiplier(
                    owner: "cee", isolation: isolation, elapsed: elapsed),
                GridMosaic.isolationDim, "a third hand never pulses, t=\(elapsed)")
        }
    }

    // A clear (nil current) fades every crisp hand out as the blurred field
    // returns: the record comes back whole, on the same quiet clock.
    func test_isolation_clearReturnsTheBlurredField_section8() {
        let isolation = MosaicIsolation(solverId: nil, previousSolverId: "you", changedAt: 0)
        let fade = GridMosaic.isolationFadeDuration
        XCTAssertEqual(GridMosaic.fieldMultiplier(isolation: isolation, elapsed: 0), 0)
        XCTAssertEqual(GridMosaic.fieldMultiplier(isolation: isolation, elapsed: fade), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: 0), 1)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "you", isolation: isolation, elapsed: fade),
            0)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "bee", isolation: isolation, elapsed: 0),
            GridMosaic.isolationDim)
        XCTAssertEqual(
            GridMosaic.spotlightMultiplier(owner: "bee", isolation: isolation, elapsed: fade),
            0)
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
