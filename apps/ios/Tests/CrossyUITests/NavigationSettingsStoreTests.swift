import XCTest

@testable import CrossyStore
@testable import CrossyUI

// The per-device typing-preferences store (personal-settings slice 1): the persistence
// convention this slice sets on iOS. An unset device must read the pre-slice defaults
// (skip filled on, wrap to first blank), each write must survive a fresh read of the same
// defaults, and the mapping to BoardNavigation's plain prefs must be exact. A private,
// per-test suite keeps these off the real standard defaults.

@MainActor
final class NavigationSettingsStoreTests: XCTestCase {
    private var suiteName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        suiteName = "test.nav.\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func test_unsetDevice_readsThePreSliceDefaults_zeroChange() {
        let store = NavigationSettingsStore(defaults: defaults)
        XCTAssertTrue(store.skipFilledInWord)
        XCTAssertFalse(store.endOfWordIsNextClue)
        XCTAssertEqual(store.navigationPrefs, .default)
    }

    func test_defaultMappedPrefs_areSkipOnFirstBlank() {
        let store = NavigationSettingsStore(defaults: defaults)
        XCTAssertEqual(
            store.navigationPrefs,
            BoardNavigation.NavigationPrefs(skipFilledInWord: true, endOfWord: .firstBlank))
    }

    func test_writes_persistAcrossAFreshRead_perDevice() {
        let first = NavigationSettingsStore(defaults: defaults)
        first.skipFilledInWord = false
        first.endOfWordIsNextClue = true

        let second = NavigationSettingsStore(defaults: defaults)
        XCTAssertFalse(second.skipFilledInWord)
        XCTAssertTrue(second.endOfWordIsNextClue)
        XCTAssertEqual(
            second.navigationPrefs,
            BoardNavigation.NavigationPrefs(skipFilledInWord: false, endOfWord: .nextClue))
    }

    func test_endOfWordBoolean_mapsToBehavior() {
        let store = NavigationSettingsStore(defaults: defaults)
        store.endOfWordIsNextClue = true
        XCTAssertEqual(store.navigationPrefs.endOfWord, .nextClue)
        store.endOfWordIsNextClue = false
        XCTAssertEqual(store.navigationPrefs.endOfWord, .firstBlank)
    }
}
