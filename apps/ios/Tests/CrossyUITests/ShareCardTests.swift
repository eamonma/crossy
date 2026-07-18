import Foundation
import XCTest

@testable import CrossyUI

// The completion share card (Wave 14.5): the analysis surface's "Share card" affordance.
// Pinned headlessly here (the ShareMenuTests pattern): the pure card-URL construction
// from the minted share URL and the current ground, and the fetch state machine's
// transitions. The server card is the single visual source of truth, so nothing about
// its pixels is tested here; only the URL the app fetches and the button's states.

final class ShareCardLinkTests: XCTestCase {
    private let shareURL = URL(string: "https://crossy.ing/s/mZ7x3Kq9pL2vRt8Nw4Ycb6Hs1Ja0Fd5Gg")!

    // The card path is `card.png` appended to the minted share URL verbatim
    // (`/s/{token}/card.png`), so the token stays the sole capability and the host is
    // the share origin the mint returned.
    func test_cardURL_appendsCardPngToTheShareURL() throws {
        let url = try XCTUnwrap(ShareCardLink.cardURL(shareUrl: shareURL, ground: .studio))
        XCTAssertEqual(url.host, "crossy.ing")
        XCTAssertEqual(url.path, "/s/mZ7x3Kq9pL2vRt8Nw4Ycb6Hs1Ja0Fd5Gg/card.png")
    }

    // The Studio ground asks the server for the light card; Observatory for the dark
    // one (ID-3: the card matches the app's current appearance). One bit, no code fork.
    func test_cardURL_carriesPortraitVariantAndTheGroundParameter() throws {
        let light = try XCTUnwrap(ShareCardLink.cardURL(shareUrl: shareURL, ground: .studio))
        let lightQuery = try queryItems(light)
        XCTAssertEqual(lightQuery["variant"], "portrait")
        XCTAssertEqual(lightQuery["ground"], "light")

        let dark = try XCTUnwrap(ShareCardLink.cardURL(shareUrl: shareURL, ground: .observatory))
        let darkQuery = try queryItems(dark)
        XCTAssertEqual(darkQuery["variant"], "portrait")
        XCTAssertEqual(darkQuery["ground"], "dark")
    }

    func test_groundParameter_mapsStudioLightAndObservatoryDark() {
        XCTAssertEqual(ShareCardLink.groundParameter(.studio), "light")
        XCTAssertEqual(ShareCardLink.groundParameter(.observatory), "dark")
    }

    func test_filename_isTheSuggestedPngName() {
        XCTAssertEqual(ShareCardLink.filename, "crossy-card.png")
    }

    private func queryItems(_ url: URL) throws -> [String: String] {
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        var result: [String: String] = [:]
        for item in components.queryItems ?? [] {
            result[item.name] = item.value
        }
        return result
    }
}

@available(iOS 17.0, macOS 14.0, *)
final class ShareCardModelTests: XCTestCase {
    // A fresh model is at rest: no mint has been asked.
    @MainActor
    func test_initialPhase_isIdle() {
        XCTAssertEqual(ShareCardModel().phase, .idle)
    }

    // The tap goes busy synchronously, then returns to idle once the prepare closure
    // succeeds: the system share sheet opening IS the confirmation, so there is no
    // separate confirmed phase to strand behind it.
    @MainActor
    func test_share_success_goesBusyThenBackToIdle() async {
        let model = ShareCardModel()
        model.share { true }
        XCTAssertEqual(model.phase, .busy, "the tap flips to busy before the await")
        await settle(model)
        XCTAssertEqual(model.phase, .idle)
    }

    // Any failure (mint 4xx, PNG fetch, offline) resolves to the quiet failed state the
    // button shows as a re-tappable retry, never a scolding alert.
    @MainActor
    func test_share_failure_resolvesToFailed() async {
        let model = ShareCardModel()
        model.share { false }
        await settle(model)
        XCTAssertEqual(model.phase, .failed)
    }

    // A second tap while a mint is in flight is ignored, so a double tap never mints
    // twice (the idempotent server would return the same token, but the client should
    // not fire two requests).
    @MainActor
    func test_share_ignoresATapWhileBusy() async {
        let model = ShareCardModel()
        var firstRan = false
        var secondRan = false
        // The first prepare parks at the gate, so the model stays busy when the second
        // tap lands. The second share must return early on the busy guard, so its
        // closure never runs.
        let gate = AsyncGate()
        model.share {
            firstRan = true
            await gate.wait()
            return true
        }
        XCTAssertEqual(model.phase, .busy)
        model.share {
            secondRan = true
            return true
        }
        XCTAssertFalse(secondRan, "the second tap is dropped while busy")
        gate.open()
        await settle(model)
        XCTAssertEqual(model.phase, .idle)
        XCTAssertTrue(firstRan, "the first prepare ran to completion")
        XCTAssertFalse(secondRan)
    }

    // A re-tap after a failure retries from idle, and clearFailure dismisses the quiet
    // failure without a tap (the surface calls it when re-entered).
    @MainActor
    func test_failure_retriesAndClears() async {
        let model = ShareCardModel()
        model.share { false }
        await settle(model)
        XCTAssertEqual(model.phase, .failed)

        model.share { true }
        XCTAssertEqual(model.phase, .busy, "a re-tap after a failure retries")
        await settle(model)
        XCTAssertEqual(model.phase, .idle)

        model.share { false }
        await settle(model)
        XCTAssertEqual(model.phase, .failed)
        model.clearFailure()
        XCTAssertEqual(model.phase, .idle)
    }

    /// Yield until the model leaves busy (both the test and the model's task run on the
    /// MainActor, so a bounded yield loop drains the task deterministically).
    @MainActor
    private func settle(
        _ model: ShareCardModel, file: StaticString = #filePath, line: UInt = #line
    ) async {
        for _ in 0..<1000 where model.phase == .busy {
            await Task.yield()
        }
        XCTAssertNotEqual(model.phase, .busy, "the mint task did not settle", file: file, line: line)
    }
}

/// A one-shot gate to park a prepare closure mid-flight, so the busy-guard test can land
/// a second tap while the first is still running.
private final class AsyncGate: @unchecked Sendable {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private var opened = false

    func wait() async {
        if opened { return }
        await withCheckedContinuation { continuations.append($0) }
    }

    func open() {
        opened = true
        let pending = continuations
        continuations = []
        for continuation in pending { continuation.resume() }
    }
}
