// The Keychain behind its own tiny protocol (roadmap I3a; ARCHITECTURE.md AD-4: no
// persistence beyond the Keychain session in v1). AuthSession reads and writes one
// opaque blob through this seam, so tests and the fixture path run in memory and the
// SecItem calls live in exactly one place.

import Foundation
import Security

/// One keyed blob store. Accounts are namespaced under a single fixed service, so
/// this is deliberately not a general Keychain wrapper: it is what the auth session
/// needs and nothing more.
public protocol KeychainStoring: Sendable {
    /// The stored blob for `account`, or nil when none exists.
    func read(account: String) throws -> Data?
    /// Create or replace the blob for `account`.
    func write(_ data: Data, account: String) throws
    /// Remove the blob for `account`; removing a missing account is not an error.
    func remove(account: String) throws
}

/// A SecItem status this module could not absorb, surfaced typed.
public struct KeychainError: Error, Equatable {
    public let status: OSStatus

    public init(status: OSStatus) {
        self.status = status
    }
}

/// The in-memory implementation for tests and the fixture path: same contract, no
/// SecItem, no persistence beyond the process.
public final class InMemoryKeychain: KeychainStoring, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String: Data] = [:]

    public init() {}

    public func read(account: String) throws -> Data? {
        lock.lock()
        defer { lock.unlock() }
        return storage[account]
    }

    public func write(_ data: Data, account: String) throws {
        lock.lock()
        defer { lock.unlock() }
        storage[account] = data
    }

    public func remove(account: String) throws {
        lock.lock()
        defer { lock.unlock() }
        storage[account] = nil
    }
}

/// The real Keychain, generic passwords under one fixed service. Items are
/// `AfterFirstUnlock`: the session must survive a device restart in the background
/// (a silent refresh can run before the first unlock of a foreground launch never
/// happens), and the blob holds tokens, not passwords a user typed.
public struct SystemKeychain: KeychainStoring {
    /// The one service every account lives under.
    public static let service = "me.crossy.auth"

    public init() {}

    public func read(account: String) throws -> Data? {
        var query = base(account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            return result as? Data
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError(status: status)
        }
    }

    public func write(_ data: Data, account: String) throws {
        // Delete-then-add over SecItemUpdate: one code path, and the add carries the
        // full attribute set (accessibility included) on every write.
        try remove(account: account)
        var attributes = base(account: account)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(attributes as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    public func remove(account: String) throws {
        let status = SecItemDelete(base(account: account) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(status: status)
        }
    }

    private func base(account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]
    }
}
