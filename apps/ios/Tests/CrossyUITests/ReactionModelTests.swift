// The sticker book's semantics (PROTOCOL.md §9; root DESIGN.md D24), pinned with
// injected time so no test owns a clock: the five-second decay, receive-any versus
// the send-gated 5/s sliding window, coalescing (pulse in place, refresh the timer,
// never a new sprite), the four-per-cell pile cap, and the born-correct placement
// rules from the web review (seeded from the stable key alone, immutable for life,
// incumbents hold still when a newcomer lands).

import CrossyUI
import XCTest

@available(iOS 17.0, macOS 14.0, *)
@MainActor
final class ReactionModelTests: XCTestCase {
    func test_decayConstantIsFiveSeconds_PROTOCOL9() async {
        XCTAssertEqual(ReactionPolicy.reactionDecay, .seconds(5))
        XCTAssertEqual(ReactionPolicy.decaySeconds, 5, accuracy: 1e-9)
    }

    func test_sendSetIsTheV1Graphemes_PROTOCOL9() async {
        XCTAssertEqual(ReactionPolicy.sendSet, ["🎉", "🤔", "👀", "💀", "🫡"])
    }

    // MARK: - Receive-any, send-gated (PROTOCOL.md §9)

    func test_receiveRendersAnEmojiOutsideTheSendSet_PROTOCOL9() async {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🔥", cell: 3, at: 100)
        XCTAssertEqual(model.stickers.map(\.emoji), ["🔥"])
    }

    func test_receivesAreNeverRateCapped_PROTOCOL9() async {
        // The server caps each SENDER; a lively room's combined inbound stream
        // renders in full (only the pile cap shapes it).
        let model = ReactionModel()
        for index in 0..<8 {
            model.receive(userId: "u\(index)", emoji: "🎉", cell: index, at: 100)
        }
        XCTAssertEqual(model.stickers.count, 8)
    }

    func test_sendEchoesLocallyAtOnce_PROTOCOL9() async {
        // The server never echoes a react back to its sender (§9), so the sender's
        // own sticker exists only through this local echo.
        let model = ReactionModel()
        XCTAssertTrue(model.send(userId: "me", emoji: "🎉", cell: 7, at: 100))
        XCTAssertEqual(model.stickers.map(\.cell), [7])
        XCTAssertEqual(model.stickers.map(\.userId), ["me"])
    }

    func test_sendCapIsAFiveSlidingWindow_PROTOCOL5() async {
        let model = ReactionModel()
        for step in 0..<5 {
            XCTAssertTrue(
                model.send(userId: "me", emoji: "🎉", cell: step, at: 100 + Double(step) * 0.1))
        }
        // The sixth inside the window: refused, no echo, nothing for the wire.
        XCTAssertFalse(model.send(userId: "me", emoji: "🎉", cell: 9, at: 100.5))
        XCTAssertEqual(model.stickers.count, 5)
        // The window slides: once the first send ages past one second, room opens.
        XCTAssertTrue(model.send(userId: "me", emoji: "🎉", cell: 9, at: 101.05))
    }

    // MARK: - Decay (PROTOCOL.md §9: ~5 seconds, then gone)

    func test_sweepRetiresAStickerAfterTheDecay_PROTOCOL9() async {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        model.sweep(at: 104.9)
        XCTAssertEqual(model.stickers.count, 1, "still inside its five seconds")
        model.sweep(at: 105)
        XCTAssertTrue(model.isEmpty, "gone at bornAt + decay")
    }

    func test_nextExpiryIsTheSoonestEnd() async {
        let model = ReactionModel()
        XCTAssertNil(model.nextExpiry)
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        model.receive(userId: "ada", emoji: "👀", cell: 4, at: 102)
        XCTAssertEqual(model.nextExpiry ?? 0, 105, accuracy: 1e-9)
    }

    // MARK: - Coalescing (PROTOCOL.md §9: repeats coalesce, never stack sprites)

    func test_repeatFromOneSenderCoalescesInPlace_PROTOCOL9() async {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        let born = model.stickers[0]

        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 102)

        XCTAssertEqual(model.stickers.count, 1, "never a new sprite")
        let refreshed = model.stickers[0]
        XCTAssertEqual(refreshed.id, born.id)
        XCTAssertEqual(refreshed.bornAt, born.bornAt, "a coalesce must not replay the entry")
        XCTAssertEqual(refreshed.refreshedAt, 102, "the pulse rides the refresh instant")
        XCTAssertEqual(refreshed.endsAt, 107, accuracy: 1e-9, "the timer refreshes")
        // Born-correct: placement is untouched by the coalesce.
        XCTAssertEqual(refreshed.offsetX, born.offsetX)
        XCTAssertEqual(refreshed.offsetY, born.offsetY)
        XCTAssertEqual(refreshed.leanDegrees, born.leanDegrees)
        XCTAssertEqual(refreshed.rotationDegrees, born.rotationDegrees)
    }

    func test_differentSendersNeverCoalesce_PROTOCOL9() async {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        model.receive(userId: "ada", emoji: "🎉", cell: 3, at: 100.5)
        XCTAssertEqual(model.stickers.count, 2, "coalesce keys on sender+emoji+cell")
    }

    func test_repeatAfterExpiryIsAFreshSticker() async {
        let model = ReactionModel()
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 106)
        model.sweep(at: 106)
        XCTAssertEqual(model.stickers.count, 1)
        XCTAssertEqual(model.stickers[0].bornAt, 106, "past its life, a repeat is a new birth")
    }

    // MARK: - The pile cap (owner spec: at most 4 visible, newest replaces oldest)

    func test_fifthStickerInACellStartsTheStalestOnesExit() async {
        let model = ReactionModel()
        for (index, user) in ["a", "b", "c", "d"].enumerated() {
            model.receive(userId: user, emoji: "🎉", cell: 3, at: 100 + Double(index))
        }
        model.receive(userId: "e", emoji: "🎉", cell: 3, at: 104)

        XCTAssertEqual(model.stickers.count, 5, "the evictee leaves through the exit fade")
        let evicted = model.stickers.first { $0.userId == "a" }
        XCTAssertEqual(
            evicted?.endsAt ?? 0, 104 + StickerEnvelope.exitSeconds, accuracy: 1e-9,
            "the oldest incumbent is clamped to an immediate exit")
        let standing = model.stickers.filter { $0.endsAt > 104 + StickerEnvelope.exitSeconds }
        XCTAssertEqual(standing.count, 4, "at most four keep standing")
    }

    func test_incumbentsHoldStillWhenANewcomerLands() async {
        // The born-correct rule the web shipped as a bug: a newcomer must not move
        // the pile. Placement is a function of each sticker's own key alone.
        let model = ReactionModel()
        model.receive(userId: "a", emoji: "🎉", cell: 3, at: 100)
        model.receive(userId: "b", emoji: "👀", cell: 3, at: 101)
        let before = model.stickers.map { ($0.id, $0.offsetX, $0.offsetY, $0.tiltDegrees) }

        model.receive(userId: "c", emoji: "💀", cell: 3, at: 102)

        for (id, x, y, tilt) in before {
            let now = model.stickers.first { $0.id == id }
            XCTAssertEqual(now?.offsetX, x)
            XCTAssertEqual(now?.offsetY, y)
            XCTAssertEqual(now?.tiltDegrees, tilt)
        }
    }

    // MARK: - Born-correct seeding

    func test_placementIsSeededFromTheKeyAloneNeverFromThePile() async throws {
        // The same sticker key lands identically whether it arrives alone or fifth
        // into a crowd: sibling count and pile index play no part.
        let alone = ReactionModel()
        alone.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)

        let crowded = ReactionModel()
        crowded.receive(userId: "a", emoji: "👀", cell: 3, at: 90)
        crowded.receive(userId: "b", emoji: "💀", cell: 3, at: 91)
        crowded.receive(userId: "c", emoji: "🫡", cell: 3, at: 92)
        crowded.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)

        let lone = alone.stickers[0]
        let piled = try XCTUnwrap(crowded.stickers.first { $0.userId == "bee" })
        XCTAssertEqual(piled.offsetX, lone.offsetX)
        XCTAssertEqual(piled.offsetY, lone.offsetY)
        XCTAssertEqual(piled.leanDegrees, lone.leanDegrees)
        XCTAssertEqual(piled.rotationDegrees, lone.rotationDegrees)
    }

    func test_placementStaysInsideTheScatterBounds() async {
        // Mostly inside the cell (owner ruling: bleed is possible by z-order, not a
        // goal): the scatter disc and the tilt bands are hard bounds.
        let model = ReactionModel()
        for index in 0..<40 {
            model.receive(userId: "u\(index)", emoji: "🎉", cell: index, at: 100)
        }
        for sticker in model.stickers {
            let radius = (sticker.offsetX * sticker.offsetX + sticker.offsetY * sticker.offsetY)
                .squareRoot()
            XCTAssertLessThanOrEqual(radius, ReactionSticker.scatterRadiusUnits + 1e-9)
            XCTAssertLessThanOrEqual(abs(sticker.leanDegrees), ReactionSticker.maxLeanDegrees)
            XCTAssertLessThanOrEqual(
                abs(sticker.rotationDegrees), ReactionSticker.maxRotationDegrees)
        }
    }

    // MARK: - Revision (the hosting view's sweep key)

    func test_revisionBumpsOnEveryMutationAndOnlyOnMutations() async {
        let model = ReactionModel()
        XCTAssertEqual(model.revision, 0)
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 100)
        XCTAssertEqual(model.revision, 1)
        model.receive(userId: "bee", emoji: "🎉", cell: 3, at: 101)  // coalesce
        XCTAssertEqual(model.revision, 2)
        model.sweep(at: 101)  // nothing expired: a no-op
        XCTAssertEqual(model.revision, 2)
        model.sweep(at: 200)
        XCTAssertEqual(model.revision, 3)
    }
}
