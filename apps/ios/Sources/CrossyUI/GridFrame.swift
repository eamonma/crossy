// One draw pass worth of render state, projected to plain data. INV-10: the values
// here are the store's rendered composite (sequenced state painted with the overlay,
// GameStore.renderValue) and nothing else; the renderer computes no gameplay. Built
// in the view body on purpose: @Observable tracking registers only during body
// evaluation, and a Canvas renderer closure runs outside it, so reads must be
// snapshotted here for the view to invalidate at all.

import CrossyDesign

public struct GridFrame: Equatable, Sendable {
    public let puzzle: GridPuzzle
    /// The user-visible value per cell (INV-10 composite); absent means empty.
    public let values: [Int: String]
    /// Teammate presence marks by cell (GridPresence rules).
    public let presence: [Int: [PresenceMark]]
    public let selection: GridSelection?
    /// The word running through the selection on its axis, highlighted in the local
    /// player's color.
    public let activeWord: Set<Int>
    /// The cells of every clue the current clue cross-references (ClueBook
    /// .referencedCells), faintly tinted relative to the selection. Empty by default,
    /// so a frame built without cross-reference facts tints nothing.
    public let crossReference: Set<Int>
    /// The standing room-check marks to paint (PROTOCOL.md §10, D27), already put
    /// through the overlay-suppression rule (`visibleCheckMarks`). Empty by default,
    /// so a frame built without check facts marks nothing.
    public let checkedWrong: Set<Int>
    /// The tint for the local cursor and active word: the local player's roster
    /// color, or ink when ID-1 mutes color in motion (the cursor is color in motion,
    /// apps/ios/DESIGN.md §9; the presence pucks stay colored, they are the
    /// at-rest marker ID-1 keeps).
    public let cursorTint: RGBColor

    public init(
        puzzle: GridPuzzle,
        values: [Int: String],
        selection: GridSelection?,
        cursors: [GridPresence.CursorInput],
        participants: [GridPresence.ParticipantInput],
        selfUserId: String?,
        ground: GridGround,
        crossReference: Set<Int> = [],
        checkedWrong: Set<Int> = [],
        colorInMotionEnabled: Bool = AttributionSwitches.colorInMotionEnabled
    ) {
        self.puzzle = puzzle
        self.values = values
        self.selection = selection
        self.crossReference = crossReference
        self.checkedWrong = checkedWrong
        self.presence = GridPresence.marks(
            cursors: cursors,
            participants: participants,
            selfUserId: selfUserId,
            ground: ground)
        self.activeWord =
            selection.map { puzzle.wordCells(through: $0.cell, isAcross: $0.isAcross) } ?? []
        self.cursorTint = colorInMotionEnabled
            ? ground.rosterColor(
                Self.selfIdentity(participants: participants, selfUserId: selfUserId))
            : ground.tokens.ink
    }

    /// The background level for one cell, per the pinned precedence (CellFill).
    public func fill(_ cell: Int) -> CellFill {
        CellFill.resolve(
            isBlock: puzzle.blocks.contains(cell),
            isCurrent: cell == selection?.cell,
            isChecked: checkedWrong.contains(cell),
            isCrossReferenced: crossReference.contains(cell),
            inActiveWord: activeWord.contains(cell),
            hasTeammate: presence[cell] != nil)
    }

    /// The overlay-suppression rule, quoted (PROTOCOL.md §10; design R6): a cell
    /// with a pending optimistic overlay entry renders the overlay, not the mark.
    /// Suppression is display only — the store's marks stand untouched, so the mark
    /// repaints if the entry is rejected and the sequenced value still stands.
    public static func visibleCheckMarks(
        _ marks: Set<Int>, overlayCells: Set<Int>
    ) -> Set<Int> {
        marks.subtracting(overlayCells)
    }

    /// The local player's roster identity: wire color when the roster carries us
    /// (authoritative), hash-of-user-id when it does not yet, and violet before the
    /// welcome names us at all (the mock default of apps/ios/DESIGN.md §3, at most a
    /// frame's worth of life).
    static func selfIdentity(
        participants: [GridPresence.ParticipantInput], selfUserId: String?
    ) -> IdentityColor {
        guard let selfUserId else { return IdentityRoster.violet }
        if let own = participants.first(where: { $0.userId == selfUserId }) {
            return GridPresence.rosterColor(wireColor: own.color, userId: selfUserId)
        }
        return IdentityRoster.color(for: selfUserId)
    }
}
