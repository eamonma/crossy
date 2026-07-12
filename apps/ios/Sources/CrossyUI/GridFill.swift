// Cell background precedence, exactly as root DESIGN.md §10 orders it:
// black square > current cell > check highlight > cross-reference highlight >
// active word > teammate-here > default. One resolver, pinned by GridFillTests, so
// the order can never fork between grounds or code paths.

/// What paints a cell's background. Cases are declared in precedence order.
public enum CellFill: Equatable, Sendable, CaseIterable {
    case block
    case current
    /// Check styling is M6 scope (the store ignores checkResult today, root ROADMAP
    /// Phase 5); the level is declared now so checks slot into the pinned order later
    /// without reordering anything.
    case check
    /// The clue under the cursor names this cell's word ("With 27-Down"): a faint
    /// tint relative to the selection. Below check, above the active word, so a
    /// checked cell reads first and a referenced cell outranks the active word
    /// where the two words cross (root DESIGN.md §10, the web's order).
    case crossReference
    case activeWord
    case teammate
    case base

    /// Resolve one cell's fill from its flags. The flash is not a background level:
    /// it paints above everything and decays (GridFlash), per the web renderer and
    /// PROTOCOL.md §8.
    public static func resolve(
        isBlock: Bool,
        isCurrent: Bool,
        isChecked: Bool,
        isCrossReferenced: Bool,
        inActiveWord: Bool,
        hasTeammate: Bool
    ) -> CellFill {
        if isBlock { return .block }
        if isCurrent { return .current }
        if isChecked { return .check }
        if isCrossReferenced { return .crossReference }
        if inActiveWord { return .activeWord }
        if hasTeammate { return .teammate }
        return .base
    }
}
