// Cell background precedence, exactly as root DESIGN.md §10 orders it:
// black square > current cell > check/cross-reference highlight > active word >
// teammate-here > default. One resolver, pinned by GridFillTests, so the order can
// never fork between grounds or code paths.

/// What paints a cell's background. Cases are declared in precedence order.
public enum CellFill: Equatable, Sendable, CaseIterable {
    case block
    case current
    /// Check and cross-reference styling is M6 scope (the store ignores checkResult
    /// today, root ROADMAP Phase 5); the level is declared now so checks slot into
    /// the pinned order later without reordering anything.
    case check
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
        inActiveWord: Bool,
        hasTeammate: Bool
    ) -> CellFill {
        if isBlock { return .block }
        if isCurrent { return .current }
        if isChecked { return .check }
        if inActiveWord { return .activeWord }
        if hasTeammate { return .teammate }
        return .base
    }
}
