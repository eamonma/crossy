import XCTest

@testable import CrossyProtocol
@testable import CrossyUI

// The personal-set store (Wave 8.5; PROTOCOL.md §9, §12, D25): nil is the default
// five (the wire's own null), a mirrored set persists through UserDefaults so a cold
// start offline wears the last-known five, mirroring null resets the cache, and an
// invalid cache or an invalid server value can never dress the fan. A private
// throwaway suite per test keeps these off the real standard defaults (the
// NavigationSettingsStore test convention, sans the setUp override: corelibs-xctest
// runs lifecycle overrides nonisolated, which a @MainActor case cannot touch).

@MainActor
final class ReactionSetStoreTests: XCTestCase {
    /// A fresh, uniquely named defaults suite for one test, removed before return.
    private func withDefaults(_ body: (UserDefaults) -> Void) {
        let name = "test.reactions.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: name) else {
            return XCTFail("could not create the test defaults suite")
        }
        body(defaults)
        defaults.removePersistentDomain(forName: name)
    }

    func test_unsetAccountWearsTheDefaultFive_PROTOCOL9() async {
        withDefaults { defaults in
            let store = ReactionSetStore(defaults: defaults)
            XCTAssertNil(store.personal, "nil is the wire's null: no chosen set")
            XCTAssertEqual(store.slots, ReactionSetSpec.defaultSet)
            XCTAssertEqual(store.slots, ["🔥", "🤔", "🐐", "💀", "😭"])
        }
    }

    func test_mirroringAServerSetDressesTheSlots_D25() async {
        withDefaults { defaults in
            let store = ReactionSetStore(defaults: defaults)
            let chosen = ["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"]
            store.mirror(fromServer: chosen)
            XCTAssertEqual(store.personal, chosen)
            XCTAssertEqual(store.slots, chosen)
        }
    }

    func test_mirroredSetSurvivesAColdStart_theOfflineCache_D25() async {
        withDefaults { defaults in
            let chosen = ["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"]
            ReactionSetStore(defaults: defaults).mirror(fromServer: chosen)

            // A fresh store over the same defaults: the cold start, no network.
            let reborn = ReactionSetStore(defaults: defaults)
            XCTAssertEqual(reborn.personal, chosen)
            XCTAssertEqual(reborn.slots, chosen)
        }
    }

    func test_mirroringNullResets_theDefaultsAndAnEmptyCache_PROTOCOL12() async {
        withDefaults { defaults in
            let store = ReactionSetStore(defaults: defaults)
            store.mirror(fromServer: ["🦆", "👍🏽", "❤️‍🔥", "🇨🇦", "🫶"])
            store.mirror(fromServer: nil)
            XCTAssertNil(store.personal)
            XCTAssertEqual(store.slots, ReactionSetSpec.defaultSet)

            // The cache is gone too: the next cold start is the defaults, not a ghost.
            let reborn = ReactionSetStore(defaults: defaults)
            XCTAssertNil(reborn.personal)
        }
    }

    func test_anInvalidCacheReadsAsUnset_neverABrokenFan_PROTOCOL9() async {
        withDefaults { defaults in
            // A hand-edited plist / future format: four entries, one a letter.
            defaults.set(["🔥", "A", "🐐", "💀"], forKey: ReactionSetStore.personalSetKey)
            let store = ReactionSetStore(defaults: defaults)
            XCTAssertNil(store.personal, "an invalid cache is ignored")
            XCTAssertEqual(store.slots, ReactionSetSpec.defaultSet)
        }
    }

    func test_anInvalidServerValueIsNeverAdopted_defensive_PROTOCOL9() async {
        withDefaults { defaults in
            let store = ReactionSetStore(defaults: defaults)
            store.mirror(fromServer: ["🔥", "🔥", "🐐", "💀", "😭"])
            XCTAssertNil(store.personal, "a duplicate set fails the spec and is refused")
            XCTAssertEqual(store.slots, ReactionSetSpec.defaultSet)
        }
    }
}
