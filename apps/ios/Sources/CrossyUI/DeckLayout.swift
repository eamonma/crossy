// Key deck geometry (ID-4; apps/ios/DESIGN.md §4). The numbers are the SP-i2 rig's,
// the deck the owner confirmed on hardware: three letter rows, spacing 6, corner
// radius 10, specials at one and a half letter units. Key height is the exception:
// the rig's 46 read too small in the full room and the owner ruled it 15% taller
// on device (2026-07-10). I2b adds the rebus key (EXPERIENCE.md baseline rebus
// entry) opposite backspace, which keeps the third row full width. Pure math so
// the layout is testable without a view; the material (glass on iOS 26+, one blur
// material below, DESIGN.md §4) is KeyDeck's business.

import CoreGraphics

/// One deck key. Letters are the deck's alphabet; `rebus` opens (and commits) the
/// inline multi-glyph field; `backspace` is the vectored step-back.
public enum DeckKey: Hashable, Sendable {
    case letter(Character)
    case backspace
    case rebus
}

public enum DeckLayout {
    /// The three letter rows, QWERTY order (the SP-i2 rig's rows).
    public static let letterRows: [String] = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"]

    public static let keySpacing: CGFloat = 6
    /// Row pitch from the rig: key spacing plus 2.
    public static let rowSpacing: CGFloat = 8
    /// The rig's 46 plus the owner's on-device ruling: 15% taller (2026-07-10).
    public static let keyHeight: CGFloat = 53
    public static let keyCornerRadius: CGFloat = 10
    /// Special keys (rebus, backspace) span one and a half letter units plus the
    /// half spacing that a letter-and-a-half would have enclosed.
    public static let specialKeyRatio: CGFloat = 1.5

    /// The letter unit: ten keys and nine gaps fill the deck width exactly.
    public static func keyWidth(deckWidth: CGFloat) -> CGFloat {
        (deckWidth - keySpacing * 9) / 10
    }

    /// A special key's width: 1.5 units plus half a spacing, the rig's backspace.
    /// With rebus leading and backspace trailing, the third row (2 specials, 7
    /// letters, 8 gaps) spans exactly the deck width; the layout tests pin this.
    public static func specialKeyWidth(deckWidth: CGFloat) -> CGFloat {
        keyWidth(deckWidth: deckWidth) * specialKeyRatio + keySpacing * 0.5
    }

    /// Total deck height: three key rows and two row gaps.
    public static var deckHeight: CGFloat {
        keyHeight * 3 + rowSpacing * 2
    }

    /// The keys of one row, specials included (row 2 is rebus + ZXCVBNM +
    /// backspace).
    public static func keys(row: Int) -> [DeckKey] {
        let letters = letterRows[row].map { DeckKey.letter($0) }
        guard row == letterRows.count - 1 else { return letters }
        return [.rebus] + letters + [.backspace]
    }

    /// The occupied width of one row at a deck width, for the centering the view
    /// applies to the middle row.
    public static func rowWidth(row: Int, deckWidth: CGFloat) -> CGFloat {
        let keys = keys(row: row)
        let widths = keys.map { key -> CGFloat in
            switch key {
            case .letter: return keyWidth(deckWidth: deckWidth)
            case .backspace, .rebus: return specialKeyWidth(deckWidth: deckWidth)
            }
        }
        return widths.reduce(0, +) + keySpacing * CGFloat(keys.count - 1)
    }
}
