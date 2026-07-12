// The arrival seed (apps/ios/DESIGN.md §4, the live-data birth rule): the facts a
// tapped room card already knows, carried into the room composition so the trailing
// cluster is BORN with the #132 zoom push instead of popping at REST-mount. On live
// data RealRoomView withholds SolveScreen until the REST view lands (the I3f quiet
// canvas), so before this seed there was NOTHING in the withholding room's bar to goo
// into: every item arrived at REST-mount and the fixture only looked right because
// DemoRoom mounts SolveScreen instantly. The seed closes that gap: the players pill
// stands at its true count from the push's first frame, the width count-driven so it
// never settles across beats unless membership genuinely changed since the list row.
//
// The card carries memberCount and name (RoomCardModel); it does NOT carry the
// viewer's role (a list row names the creator, not the reader's seat), so the seed
// carries none and nothing role-gated (the share pill) can stand from it. Deep links
// and code-joins have no card and carry no seed: they keep today's REST-gated arrival.
//
// Each beat only ADDS detail (the roster-seed precedent, GameStore.seedRoster): the
// count comes from the list row here, identities and avatars land at REST, initials at
// welcome. A placeholder puck has no identity yet, so it renders the achromatic hollow
// floor (RosterPuckBody's placeholder branch) rather than a hash color that would flip
// when the real id lands; only the count is honest pre-REST, and only the count drives
// the width.

/// The facts a tapped room card threads into the room composition so the trailing
/// cluster is born with the push (DESIGN.md §4, the live-data birth rule). Pure and
/// pinned (RoomArrivalSeedTests): the app target maps a RoomCardModel here and the
/// room seeds its roster from `memberCount` before the REST view lands.
public struct RoomArrivalSeed: Equatable, Sendable {
    /// The room's member count as the list row reported it (RoomCardModel.memberCount):
    /// the players pill's true width from frame one. Clamped non-negative before use
    /// (placeholderPuckCount), so a malformed row never asks for negative pucks.
    public let memberCount: Int
    /// The room's display name as the card knew it, shown back verbatim (never
    /// normalized, §12). Not rendered in the bar today (the room name lives in the
    /// facts card, which is REST-gated), but carried so a later beat can use it without
    /// re-threading; the seed is the card's whole knowledge in one value.
    public let name: String?

    public init(memberCount: Int, name: String?) {
        self.memberCount = memberCount
        self.name = name
    }

    /// The reserved id prefix for a placeholder puck (DESIGN.md §4): a pre-REST seeded
    /// participant carries a synthetic id under this prefix, distinct from every real
    /// member id (which are server-minted and never take this shape), so the roster can
    /// tell a placeholder from an identified member with one pure predicate and render
    /// it as the achromatic floor. The app target mints ids with this prefix
    /// (RoomMapping.placeholderRoster); SolveScreen reads them back through the
    /// predicate below. One contract shared across the ring seam, the RoomZoomSource
    /// register.
    public static let placeholderIDPrefix = "crossy.seed.placeholder."

    /// A stable synthetic id for the nth placeholder puck. Deterministic so the seed's
    /// ForEach is stable across the few renders it lives through, and prefixed so
    /// `isPlaceholderID` recognizes it. The real REST roster (real ids) overwrites the
    /// count-seed while the store is still `connecting`, and the welcome rebuilds the
    /// roster wholesale, so these ids never survive past the handshake.
    public static func placeholderID(_ index: Int) -> String {
        "\(placeholderIDPrefix)\(index)"
    }

    /// Whether a member id is a placeholder puck's synthetic id (DESIGN.md §4): a real
    /// member id never takes the placeholder shape, so this alone tells the roster to
    /// render the achromatic floor for that puck. Pure so SolveScreen's mapping and the
    /// tests read the one rule.
    public static func isPlaceholderID(_ userId: String) -> Bool {
        userId.hasPrefix(placeholderIDPrefix)
    }

    /// How many placeholder pucks the seed stands, clamped non-negative. The pill shows
    /// at most `RosterList.puckCap` before it collapses the rest to a +N (the cluster's
    /// own rule reads this count downstream), so this is the true membership, not the
    /// shown count: the width is count-driven and the cluster arithmetic does the
    /// capping exactly as it does for a live roster.
    public static func placeholderPuckCount(_ memberCount: Int) -> Int {
        max(memberCount, 0)
    }
}
