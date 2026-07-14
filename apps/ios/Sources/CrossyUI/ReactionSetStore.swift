// The personal reaction set as the client holds it (PROTOCOL.md §9, §12; D25): the
// account-synced five the fan and the lab offer, mirrored from `GET /me` and cached in
// UserDefaults so a cold start offline still shows the last-known set. The
// NavigationSettingsStore convention: an @Observable store over the defaults, built
// once at the composition root and read live, so a Settings edit reaches an open
// room's fan without a restart.
//
// The store is a MIRROR, never a writer: `PATCH /me` is the single write path
// (D25), driven by the composition root's save closure, and only a canonical value
// the server returned (or the `/me` read) lands here through `mirror(fromServer:)`.
// nil is first-class and means the default five (ReactionSetSpec.defaultSet), exactly
// as a null `reactionSet` does on the wire, so an account that never chose reads the
// defaults with no write and no cache entry.

import CrossyProtocol
import Foundation
import Observation

/// The `PATCH /me {reactionSet}` write digested for the Settings editor, the
/// DisplayNameOutcome shape exactly: saved adopts the server's canonical value (nil =
/// the defaults), rejected carries a stable `REACTION_SET_*` code the inline sentence
/// keys on, rate-limited carries the Retry-After, and everything transient stays
/// retryable (never a wall, never a sign-out).
public enum ReactionSetOutcome: Sendable, Equatable {
    /// The server kept the write; carry its canonical `reactionSet` (nil = defaults).
    case saved([String]?)
    /// A named 422 (`REACTION_SET_LENGTH` / `_INVALID` / `_DUPLICATE`, §12).
    case rejected(code: String)
    /// The write window is spent (429); `retryAfter` when the server named one.
    case rateLimited(retryAfter: TimeInterval?)
    /// Transport weather, a 5xx, or an unknown code: keep the edit, try again.
    case retryable(code: String?)
}

@available(iOS 17.0, macOS 14.0, *)
@MainActor
@Observable
public final class ReactionSetStore {
    /// The defaults key, namespaced beside ReactionSettings' receive-haptics key.
    static let personalSetKey = "crossy.reactions.personalSet"

    @ObservationIgnored private let defaults: UserDefaults

    /// The account's chosen five in slot order, or nil for the default five (the
    /// wire's own null). Set only through `mirror(fromServer:)`.
    public private(set) var personal: [String]?

    /// The five the send surfaces offer, in slot order: the chosen set, else the
    /// defaults. Never empty, always exactly five.
    public var slots: [String] { personal ?? ReactionSetSpec.defaultSet }

    /// Reads the cached last-known set, so a cold start offline shows what the account
    /// last synced. A cache that fails the spec (a hand-edited plist, a future format)
    /// reads as unset: the defaults, never a broken fan.
    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        if let cached = defaults.stringArray(forKey: Self.personalSetKey),
            ReactionSetSpec.validate(cached) == nil
        {
            self.personal = cached
        } else {
            self.personal = nil
        }
    }

    /// Adopt a canonical value from the server (`GET /me` on load, or the `PATCH /me`
    /// response after a save; nil = the defaults) and cache it for the next cold
    /// start. Defensive: a set that fails the spec is ignored rather than adopted, so
    /// a misbehaving server can never wedge the fan (the defaults keep standing).
    public func mirror(fromServer set: [String]?) {
        guard ReactionSetSpec.validate(set) == nil else { return }
        personal = set
        if let set {
            defaults.set(set, forKey: Self.personalSetKey)
        } else {
            defaults.removeObject(forKey: Self.personalSetKey)
        }
    }
}
